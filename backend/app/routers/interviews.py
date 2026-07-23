"""AI 컨설턴트 인터뷰 API — 세션·턴·첨부·체크포인트·완료 (design 2026-07-23 §5)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.interview.orchestrator import TurnError, run_turn
from app.interview.parsing import (
    ALLOWED_EXTENSIONS,
    MAX_ATTACHMENT_BYTES,
    ParseError,
    clip_to_budget,
    parse_attachment,
)
from app.models import (
    AiUsageEvent,
    InterviewAttachment,
    InterviewMessage,
    InterviewSession,
    MapVersion,
)
from app.permissions.access import assert_map_role
from app.permissions.deps import require_map_role
from app.routers.graph import _load_graph
from app.schemas import (
    InterviewAttachmentOut,
    InterviewCreateIn,
    InterviewRevertIn,
    InterviewStateOut,
    InterviewTurnIn,
)
from app.settings import settings

router = APIRouter(prefix="/api", tags=["interviews"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

# 파싱 직렬화 — 무거운 파싱이 동시에 몰리지 않게 1개씩 (스펙 §4 백그라운드 직렬화의 단순화)
_parse_lock = asyncio.Lock()

_GREETING = {
    "ko": "안녕하세요, 프로세스 컨설턴트입니다. 지금부터 몇 가지 질문으로 프로세스 맵을 함께 만들어보겠습니다. 먼저, 이 프로세스의 이름과 목적을 알려주세요. 참고할 문서가 있다면 지금 첨부하셔도 좋습니다.",
    "en": "Hello, I'm your process consultant. I'll ask a few questions to build the process map together. First, what is this process called and what is its purpose? Feel free to attach reference documents.",
}


def _require_ai_enabled() -> None:
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")


async def _get_owned_interview(
    session: AsyncSession, interview_id: int, user: str
) -> InterviewSession:
    """본인 세션만 — 없거나 타인 것이면 404(존재 노출 안 함)."""
    row = await session.get(InterviewSession, interview_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail=f"interview {interview_id} not found")
    # 세션 생성 이후 editor 권한이 회수됐을 수 있어 매 접근마다 재검증 (final review I3)
    await assert_map_role(session, user, row.map_id, "editor")
    await session.refresh(row, ["messages", "checkpoints", "attachments"])
    return row


async def _state_out(session: AsyncSession, interview: InterviewSession) -> InterviewStateOut:
    version = await session.get(MapVersion, interview.version_id)
    return InterviewStateOut(
        id=interview.id,
        map_id=interview.map_id,
        version_id=interview.version_id,
        status=interview.status,
        current_stage=interview.current_stage,
        lang=interview.lang,
        working_graph=interview.working_graph,
        messages=sorted(interview.messages, key=lambda m: m.seq),
        checkpoints=sorted(interview.checkpoints, key=lambda c: c.id),
        attachments=sorted(interview.attachments, key=lambda a: a.id),
        version_updated_at=version.updated_at if version else None,
        base_graph_updated_at=interview.base_graph_updated_at,
    )


def _graph_summary(graph) -> str:
    """작업 컨텍스트용 현재 저장 그래프 요약 — 제목 나열(프롬프트 예산 절약)."""
    titles = [f"{n.node_type}:{n.title}" for n in graph.nodes]
    return ", ".join(titles) if titles else ""


async def _context_text(interview: InterviewSession) -> str:
    sections = [
        (a.filename, a.parsed_text)
        for a in interview.attachments
        if a.status == "parsed" and a.parsed_text
    ]
    return clip_to_budget(sections, settings.interview_context_budget)


@router.post(
    "/maps/{map_id}/interviews",
    response_model=InterviewStateOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def create_or_resume_interview(
    map_id: int,
    payload: InterviewCreateIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    _require_ai_enabled()
    existing = (
        await session.scalars(
            select(InterviewSession).where(
                InterviewSession.map_id == map_id,
                InterviewSession.login_id == user,
                InterviewSession.status == "active",
            )
        )
    ).first()
    if existing is not None:
        await session.refresh(existing, ["messages", "checkpoints", "attachments"])
        return await _state_out(session, existing)

    version = await session.get(MapVersion, payload.version_id)
    if version is None or version.map_id != map_id:
        raise HTTPException(status_code=404, detail=f"version {payload.version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(status_code=409, detail="version is not editable")

    interview = InterviewSession(
        map_id=map_id,
        version_id=payload.version_id,
        login_id=user,
        lang=payload.lang,
        facts={},
        base_graph_updated_at=version.updated_at,
    )
    session.add(interview)
    await session.flush()  # id 채번 — 메시지 FK
    session.add(
        InterviewMessage(
            session_id=interview.id, seq=1, role="consultant", kind="question",
            content=_GREETING.get(payload.lang, _GREETING["ko"]), stage="scope",
        )
    )
    await session.commit()
    loaded = await _get_owned_interview(session, interview.id, user)
    return await _state_out(session, loaded)


@router.get(
    "/maps/{map_id}/interviews/active",
    response_model=InterviewStateOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def get_active_interview(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    row = (
        await session.scalars(
            select(InterviewSession).where(
                InterviewSession.map_id == map_id,
                InterviewSession.login_id == user,
                InterviewSession.status == "active",
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="no active interview")
    loaded = await _get_owned_interview(session, row.id, user)
    return await _state_out(session, loaded)


@router.get("/interviews/{interview_id}", response_model=InterviewStateOut)
async def get_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, interview)


@router.post("/interviews/{interview_id}/turns", response_model=InterviewStateOut)
async def post_turn(
    interview_id: int,
    payload: InterviewTurnIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    _require_ai_enabled()
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")

    # rollback 후 만료 대비 스칼라 선캡처
    map_id, version_id = interview.map_id, interview.version_id

    current = await _load_graph(session, interview.version_id)
    context_text = await _context_text(interview)
    try:
        await run_turn(
            session, interview, payload, _graph_summary(current), context_text
        )
    except TurnError as exc:
        await session.rollback()
        # 실패도 계량 — 별도 커밋, 실패해도 502 전파 유지
        try:
            session.add(AiUsageEvent(
                login_id=user, map_id=map_id, version_id=version_id,
                model="", kind=None, ok=False,
            ))
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답을 바꾸지 않는다
            logger.warning("interview usage event insert failed (failure path)")
            await session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    session.add(AiUsageEvent(
        login_id=user, map_id=map_id, version_id=version_id,
        model="", kind="interview", ok=True,
    ))
    interview.updated_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.post("/interviews/{interview_id}/attachments", response_model=InterviewAttachmentOut)
async def upload_attachment(
    interview_id: int,
    file: UploadFile,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewAttachmentOut:
    interview = await _get_owned_interview(session, interview_id, user)
    filename = file.filename or "attachment"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"unsupported file type: {ext or filename}")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="file too large (max 20MB)")

    row = InterviewAttachment(
        session_id=interview.id, filename=filename,
        mime=file.content_type or "", size=len(data),
    )
    async with _parse_lock:
        try:
            row.parsed_text = await asyncio.to_thread(parse_attachment, filename, data)
            row.status = "parsed"
        except ParseError as exc:
            row.status = "failed"
            row.error = str(exc)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return InterviewAttachmentOut.model_validate(row)


@router.post("/interviews/{interview_id}/revert", response_model=InterviewStateOut)
async def revert_to_checkpoint(
    interview_id: int,
    payload: InterviewRevertIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    target = next(
        (c for c in sorted(interview.checkpoints, key=lambda c: c.id, reverse=True)
         if c.stage == payload.stage),
        None,
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"no checkpoint for stage {payload.stage}")

    interview.facts = target.facts
    interview.working_graph = target.working_graph
    interview.current_stage = target.stage
    interview.pending_choices = None
    for msg in interview.messages:
        if msg.seq > target.message_seq:
            msg.superseded = True
    # 복원 지점 이후의 체크포인트 제거(대상 stage 포함 이후 단계) — 재진행 시 새로 생성
    for cp in list(interview.checkpoints):
        if cp.id >= target.id:
            await session.delete(cp)
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.post("/interviews/{interview_id}/complete", response_model=InterviewStateOut)
async def complete_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    interview.status = "completed"
    interview.completed_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.delete("/interviews/{interview_id}", status_code=204)
async def abandon_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    interview = await _get_owned_interview(session, interview_id, user)
    interview.status = "abandoned"
    await session.commit()
