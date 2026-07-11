"""AI 채팅 — 순서도 생성/편집 제안 + 사용법 안내 (design 2026-06-15)."""

import logging
from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import ai_client, workflow
from app.app_settings import (
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_tips,
)
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
from app.permissions.deps import require_version_map_role
from app.manual import get_manual
from app.models import AiChatMessage, AiChatSession, ManualDoc, MapVersion
from app.routers.graph import _load_graph
from app.schemas import AiChatRequest, AiModelsOut, AiProposal, AiTipsOut
from app.settings import settings

router = APIRouter(prefix="/api", tags=["ai"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

_NOT_EDITABLE_MSG = "이 버전은 편집할 수 없어 그래프를 적용할 수 없습니다. 도움말만 가능합니다."
_UNKNOWN_NODES_MSG = "참고: 현재 맵에 없는 노드를 참조했습니다 — {ids}"


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


async def _ask_and_validate(
    messages: list[dict], model: str | None
) -> tuple[AiProposal, AiUsageTotals]:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502.

    usage는 시도 전체를 누적해 반환 — 실패로 끝나도 호출자가 기록할 수 있게
    HTTPException에 totals를 실어 던진다(exc.usage_totals).
    """
    totals = AiUsageTotals()
    for attempt in range(2):
        try:
            reply = await ai_client.call_ai(messages, model)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            # exc는 내부 GPU 주소를 담을 수 있어 클라이언트엔 노출 금지 — 서버 로그에만 기록
            logger.warning("AI server call failed: %s", exc)
            http_exc = HTTPException(status_code=502, detail="AI server error")
            http_exc.usage_totals = totals  # type: ignore[attr-defined]
            raise http_exc from exc
        totals.add(reply)
        try:
            return AiProposal.model_validate_json(_extract_json(reply.content)), totals
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
    if not settings.ai_enabled:
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
    manual_text = await _load_manual_text(session)
    messages = build_messages(
        manual_text, current, can_edit, payload.instruction, payload.history
    )

    proposal, _usage = await _ask_and_validate(messages, payload.model)
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
    await session.commit()
    proposal.session_id = chat_session.id
    return proposal


@router.get("/ai/models", response_model=AiModelsOut)
async def ai_models() -> AiModelsOut:
    """서빙 중인 모델 목록 — 프론트 모델 선택용. 조회 실패 시 기본 모델로 폴백."""
    if not settings.ai_enabled:
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
