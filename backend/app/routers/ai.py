"""AI 채팅 — 순서도 생성/편집 제안 + 사용법 안내 (design 2026-06-15)."""

import logging
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ai_client, workflow
from app.app_settings import (
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_tips,
    get_assignee_roles,
    get_systems,
    is_ai_access_enabled,
)
from app.manual_select import select_manual_sections
from app.chat_history import (
    derive_chat_title,
    prune_chat_session_messages,
    prune_map_chat_sessions,
    serialize_proposal_payload,
)
from app.clock import now as now_kst
from app.ai_prompt import build_messages
from app.auth import get_current_user
from app.checkout import is_checkout_active
from app.db import get_session
from app.permissions.deps import require_map_role, require_version_map_role
from app.manual import get_manual
from app.models import (
    AiChatMessage,
    AiChatSession,
    AiCompareSummary,
    AiUsageEvent,
    ManualDoc,
    MapVersion,
    ProcessMap,
    VersionEvent,
)
from app.prompt_registry import get_prompt_overrides
from app.routers.graph import _load_graph
from app.compare_summary import (
    CompareSummaryContext,
    build_compare_summary_messages,
    compute_diff_hash,
    resolve_contract,
)
from app.schemas import (
    AiChatRequest,
    AiModelsOut,
    AiProposal,
    AiTipsOut,
    CompareSummaryOut,
    CompareSummaryRequest,
)
from app.settings import settings

router = APIRouter(prefix="/api", tags=["ai"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

_NOT_EDITABLE_MSG = "이 버전은 편집할 수 없어 그래프를 적용할 수 없습니다. 도움말만 가능합니다."
_UNKNOWN_NODES_MSG = "참고: 현재 맵에 없는 노드를 참조했습니다 - {ids}"


def _missing_node_ids(proposal: AiProposal, valid_ids: set[str]) -> list[str]:
    """proposal이 참조하는 기존 node_id 중 현 그래프에 없는 것 — drop 대신 표면화 (계약 규칙 ④).

    ops의 add는 새 임시키라 유효 참조로 인정. graph/answer는 대상 아님(빈 리스트).
    """
    known = set(valid_ids)
    referenced: list[str] = []
    if proposal.kind == "ops":
        for op in proposal.ops:
            if op.action == "add" and op.node is not None:
                known.add(op.node.key)
        for op in proposal.ops:
            if op.action in ("remove", "relabel", "set_attr", "set_desc") and op.node_id:
                referenced.append(op.node_id)
            elif op.action in ("connect", "disconnect", "set_edge_label"):
                referenced += [ref for ref in (op.source, op.target) if ref]
    elif proposal.kind == "walkthrough":
        referenced = [step.node_id for step in proposal.steps]
    elif proposal.kind == "analysis":
        referenced = [nid for finding in proposal.findings for nid in finding.node_ids]
    else:
        return []
    missing: list[str] = []
    seen: set[str] = set()
    for node_id in referenced:
        if node_id not in known and node_id not in seen:
            seen.add(node_id)
            missing.append(node_id)
    return missing


_MANUAL_AI_LIMIT = 30000  # 프롬프트 크기 가드 — 등록 매뉴얼 합본 상한(문자)
_MANUAL_SELECT_BUDGET = 12000  # 섹션 선별 예산(자) — 전체가 이하면 무변화


async def _load_manual_text(session: AsyncSession) -> str:
    """AI 답변 근거 매뉴얼 — 등록 문서(manual_docs) 기준 동기화, 없으면 번들 manual.md 폴백.

    한국어 문서 우선(프롬프트 언어와 일치), ko가 없으면 등록된 전체. html 문서는 태그 노이즈라 제외.
    """
    docs = (
        await session.scalars(
            select(ManualDoc)
            .where(ManualDoc.format == "markdown")
            .order_by(ManualDoc.sort_order, ManualDoc.id)
        )
    ).all()
    korean = [doc for doc in docs if doc.language == "ko"]
    picked = korean or list(docs)
    if not picked:
        return get_manual()
    text = "\n\n".join(
        f"# {doc.title}\n{doc.content}" if doc.title else doc.content for doc in picked
    )
    return text[:_MANUAL_AI_LIMIT]


def _extract_json(text: str) -> str:
    """모델이 ```json 펜스나 앞뒤 설명을 붙여도 본문 JSON 오브젝트만 추출 — 첫 '{' ~ 마지막 '}'."""
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


@dataclass
class AiUsageTotals:
    """한 요청의 AI 호출 usage 누적 — 재프롬프트 재시도분 포함(둘 다 과금되므로 합산)."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None

    def add(self, reply: ai_client.AiReply) -> None:
        if reply.prompt_tokens is not None:
            self.prompt_tokens = (self.prompt_tokens or 0) + reply.prompt_tokens
        if reply.completion_tokens is not None:
            self.completion_tokens = (self.completion_tokens or 0) + reply.completion_tokens


_ReplyT = TypeVar("_ReplyT", bound=BaseModel)


async def _ask_and_validate(
    messages: list[dict], model: str | None, *, schema: type[_ReplyT] = AiProposal
) -> tuple[_ReplyT, AiUsageTotals]:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502.

    usage는 시도 전체를 누적해 반환 — 실패로 끝나도 호출자가 기록할 수 있게
    HTTPException에 totals를 실어 던진다(exc.usage_totals).
    schema: 응답 모델 — 챗은 AiProposal, 비교 요약은 CompareSummaryOut.
    """
    totals = AiUsageTotals()
    for attempt in range(2):
        try:
            # 대화형 챗 — 중간 사고("high")로 지연/품질 균형 (GLM-5.2 사고 모드, ai_client.AiReasoning)
            reply = await ai_client.call_ai(messages, model, reasoning="high")
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            # exc는 내부 GPU 주소를 담을 수 있어 클라이언트엔 노출 금지 — 서버 로그에만 기록
            logger.warning("AI server call failed: %s", exc)
            http_exc = HTTPException(status_code=502, detail="AI server error")
            http_exc.usage_totals = totals  # type: ignore[attr-defined]
            raise http_exc from exc
        totals.add(reply)
        try:
            return schema.model_validate_json(_extract_json(reply.content)), totals
        except ValueError as exc:
            # 원본 출력(모델 텍스트, 비밀 아님)을 서버 로그에만 기록 — 502 원인 진단용. 클라이언트엔 일반 메시지만.
            logger.warning(
                "AI response invalid (attempt %d): %s | raw=%.800s", attempt, exc, reply.content
            )
            if attempt == 0:
                messages = [*messages, {"role": "user", "content": "유효한 JSON 한 개만 반환하세요."}]
                continue
    http_exc = HTTPException(status_code=502, detail="AI returned invalid response")
    http_exc.usage_totals = totals  # type: ignore[attr-defined]
    raise http_exc


@router.post(
    "/versions/{version_id}/ai/chat",
    response_model=AiProposal,
    # viewer 게이트 — 무권한자는 그래프가 프롬프트에 실리기 전에 403 (design 2026-07-10)
    dependencies=[Depends(require_version_map_role("viewer"))],
)
async def ai_chat(
    version_id: int,
    payload: AiChatRequest,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiProposal:
    if not await is_ai_access_enabled(session):
        raise HTTPException(status_code=503, detail="AI is disabled")
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    # 이어쓰기 대상 세션 검증 — 소유·맵 일치 아니면 404(존재 노출 안 함). AI 호출 전에 확인.
    chat_session: AiChatSession | None = None
    if payload.session_id is not None:
        chat_session = await session.get(AiChatSession, payload.session_id)
        if (
            chat_session is None
            or chat_session.login_id != user
            or chat_session.map_id != version.map_id
        ):
            raise HTTPException(
                status_code=404, detail=f"chat session {payload.session_id} not found"
            )

    now = now_kst()
    can_edit = (
        workflow.is_editable_status(version.status)
        and is_checkout_active(version, now)
        and version.checked_out_by == user
    )
    current = await _load_graph(session, version_id)
    manual_text = select_manual_sections(
        await _load_manual_text(session), payload.instruction, _MANUAL_SELECT_BUDGET
    )
    messages = build_messages(
        manual_text, current, can_edit, payload.instruction, payload.history,
        overrides=await get_prompt_overrides(session),
        # 관리 목록 — 모델이 역할·시스템을 정식 표기로 적게 (FE 변환단이 다시 정규화하지만 프롬프트가 1차)
        catalogs={
            "assignee_roles": await get_assignee_roles(session),
            "systems": await get_systems(session),
        },
    )

    try:
        proposal, usage = await _ask_and_validate(messages, payload.model)
    except HTTPException as exc:
        totals = getattr(exc, "usage_totals", None)
        # 실패도 계량 — 이벤트 기록이 502 전파를 막지 않게 별도 커밋·예외 무시
        try:
            session.add(
                AiUsageEvent(
                    login_id=user,
                    map_id=version.map_id,
                    version_id=version_id,
                    model=payload.model or "",
                    kind=None,
                    prompt_tokens=getattr(totals, "prompt_tokens", None),
                    completion_tokens=getattr(totals, "completion_tokens", None),
                    ok=False,
                )
            )
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답(502)을 바꾸지 않는다
            await session.rollback()
            logger.warning("AI usage event insert failed (failure path)")
        raise
    # 편집 불가인데 편집계열(graph/ops)을 제안하면 적용 불가 — answer로 다운그레이드 (최종 가드는 saveGraph)
    if proposal.kind in ("graph", "ops") and not can_edit:
        proposal = AiProposal(kind="answer", message=_NOT_EDITABLE_MSG)
    else:
        # 현 그래프에 없는 node_id 참조는 drop하지 말고 message로 표면화 (계약 규칙 ④)
        missing = _missing_node_ids(proposal, {node.id for node in current.nodes})
        if missing:
            warning = _UNKNOWN_NODES_MSG.format(ids=", ".join(missing))
            proposal.message = f"{proposal.message}\n{warning}" if proposal.message else warning
    # 대화 서버 적재(write-through) — 질문+최종 답변을 한 트랜잭션. AI 실패 시 여기 도달 안 함.
    if chat_session is None:
        chat_session = AiChatSession(
            map_id=version.map_id,
            login_id=user,
            title=derive_chat_title(payload.instruction),
        )
        session.add(chat_session)
        await session.flush()  # id 채번 — 메시지 FK에 필요
    session.add(
        AiChatMessage(
            session_id=chat_session.id,
            role="user",
            content=payload.instruction,
            version_id=version_id,
        )
    )
    session.add(
        AiChatMessage(
            session_id=chat_session.id,
            role="assistant",
            content=proposal.message,
            kind=proposal.kind,
            payload=serialize_proposal_payload(proposal),
            version_id=version_id,
        )
    )
    chat_session.updated_at = now  # 메시지 추가만으로는 onupdate가 안 돎 — 명시 갱신
    # 보존 정리 — 세션 내 메시지 상한·사용자×맵 세션 상한(설정 콘솔에서 런타임 조정)
    await prune_chat_session_messages(
        session, chat_session.id, await get_ai_chat_max_messages(session)
    )
    await prune_map_chat_sessions(
        session, user, version.map_id, await get_ai_chat_max_sessions(session)
    )
    # 사용량 이벤트 — 대화와 같은 트랜잭션(원문 없이 계량만)
    session.add(
        AiUsageEvent(
            login_id=user,
            map_id=version.map_id,
            version_id=version_id,
            model=payload.model or "",
            kind=proposal.kind,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            ok=True,
        )
    )
    await session.commit()
    proposal.session_id = chat_session.id
    return proposal


@router.post(
    "/maps/{map_id}/compare/ai-summary",
    response_model=CompareSummaryOut,
    # viewer 게이트 — 비교 화면 열람 권한과 동일. diff는 프론트 계산본이라 그래프 재적재 없음.
    dependencies=[Depends(require_map_role("viewer"))],
)
async def ai_compare_summary(
    map_id: int,
    payload: CompareSummaryRequest,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CompareSummaryOut:
    """비교 화면 AI 보고서 — 게시본 vs 대기본 diff를 결재자에게 올리는 보고체 서술로 (2026-09-20).

    (맵, base, target, 언어)당 캐시 1행 — diff 해시가 같으면 모델을 부르지 않는다. 초안이 더 편집되거나
    프롬프트 계약이 바뀌면 해시가 달라져 재생성하고, force면 무조건 재생성해 캐시를 교체한다.
    """
    if not await is_ai_access_enabled(session):
        raise HTTPException(status_code=503, detail="AI is disabled")
    base = await session.get(MapVersion, payload.base_version_id)
    target = await session.get(MapVersion, payload.target_version_id)
    # 두 버전 모두 경로의 맵 소속이어야 — 타 맵 버전 id로 권한 우회 금지(존재 노출 안 함)
    if base is None or base.map_id != map_id:
        raise HTTPException(status_code=404, detail=f"version {payload.base_version_id} not found")
    if target is None or target.map_id != map_id:
        raise HTTPException(status_code=404, detail=f"version {payload.target_version_id} not found")

    overrides = await get_prompt_overrides(session)
    digest = compute_diff_hash(payload.diff, payload.lang, resolve_contract(overrides))
    cached = await session.scalar(
        select(AiCompareSummary).where(
            AiCompareSummary.map_id == map_id,
            AiCompareSummary.base_version_id == base.id,
            AiCompareSummary.target_version_id == target.id,
            AiCompareSummary.lang == payload.lang,
        )
    )
    if cached is not None and cached.diff_hash == digest and not payload.force:
        summary = CompareSummaryOut.model_validate(cached.content)
        summary.stats = payload.diff.totals
        summary.generated_at = cached.created_at
        summary.cached = True
        return summary

    messages = build_compare_summary_messages(
        payload.diff,
        context=await _load_compare_context(session, map_id, base, target),
        lang=payload.lang,
        overrides=overrides,
    )
    try:
        summary, usage = await _ask_and_validate(messages, None, schema=CompareSummaryOut)
    except HTTPException as exc:
        totals = getattr(exc, "usage_totals", None)
        try:
            session.add(
                AiUsageEvent(
                    login_id=user,
                    map_id=map_id,
                    version_id=target.id,
                    model="",
                    kind=None,
                    prompt_tokens=getattr(totals, "prompt_tokens", None),
                    completion_tokens=getattr(totals, "completion_tokens", None),
                    ok=False,
                )
            )
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답(502)을 바꾸지 않는다
            await session.rollback()
            logger.warning("AI usage event insert failed (compare summary failure path)")
        raise
    content = summary.model_dump(mode="json", exclude={"stats", "generated_at", "cached"})
    if cached is None:
        cached = AiCompareSummary(
            map_id=map_id, base_version_id=base.id, target_version_id=target.id, lang=payload.lang
        )
        session.add(cached)
    cached.diff_hash = digest
    cached.content = content
    cached.created_by = user
    cached.created_at = now_kst()
    session.add(
        AiUsageEvent(
            login_id=user,
            map_id=map_id,
            version_id=target.id,
            model="",
            kind="compare_summary",
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            ok=True,
        )
    )
    await session.commit()
    await session.refresh(cached)  # DB가 돌려주는 시각 표현으로 통일 — 캐시 히트 응답과 같은 값
    summary.stats = payload.diff.totals
    summary.generated_at = cached.created_at
    summary.cached = False
    return summary


async def _load_compare_context(
    session: AsyncSession, map_id: int, base: MapVersion, target: MapVersion
) -> CompareSummaryContext:
    """보고서 맥락 — 맵 이름·오너 부서·제출자 이름·제출 코멘트(가장 최근 submitted 이벤트)."""
    process_map = await session.get(ProcessMap, map_id)
    submitted_by = ""
    if target.submitted_by:
        submitted_by = await workflow.get_display_name(session, target.submitted_by)
    submit_note = await session.scalar(
        select(VersionEvent.note)
        .where(VersionEvent.version_id == target.id, VersionEvent.event_type == "submitted")
        .order_by(VersionEvent.created_at.desc(), VersionEvent.id.desc())
        .limit(1)
    )
    return CompareSummaryContext(
        map_name=process_map.name if process_map is not None else "",
        owning_department=(process_map.owning_department or "") if process_map is not None else "",
        base_label=_version_label(base),
        target_label=_version_label(target),
        submitted_by=submitted_by,
        submit_note=submit_note or "",
    )


def _version_label(version: MapVersion) -> str:
    number = f"v{version.version_number} " if version.version_number is not None else ""
    return f"{number}{version.label} ({version.status})"


@router.get("/ai/models", response_model=AiModelsOut)
async def ai_models(session: AsyncSession = Depends(get_session)) -> AiModelsOut:
    """서빙 중인 모델 목록 — 프론트 모델 선택용. 조회 실패 시 기본 모델로 폴백."""
    if not await is_ai_access_enabled(session):
        raise HTTPException(status_code=503, detail="AI is disabled")
    try:
        models = await ai_client.list_models()
    except Exception as exc:  # noqa: BLE001 -- 목록 조회 실패는 기본 모델로 폴백
        logger.warning("AI models list failed: %s", exc)
        models = []
    if not models and settings.ai_model:
        models = [settings.ai_model]
    return AiModelsOut(models=models)


@router.get("/ai/tips", response_model=AiTipsOut)
async def ai_tips(session: AsyncSession = Depends(get_session)) -> AiTipsOut:
    """AI 챗 기능 팁 — 이전 기록 로딩 중 노출용. 설정 콘솔에서 교체, 미설정 시 기본 20종."""
    return AiTipsOut(tips=await get_ai_chat_tips(session))
