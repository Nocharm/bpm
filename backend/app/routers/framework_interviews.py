"""AI L5 캠페인 API — sysadmin 전용, AI 게이트, 세션·계획·설문·러너·조립 (spec 2026-09-21 §8)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems, is_ai_access_enabled
from app.auth import require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.framework_interview import runner
from app.framework_interview.assemble import (
    allocate_task_ids, load_category_chain, load_existing_codes,
)
from app.framework_interview.contracts import PlanOut, build_plan_messages, format_managed_catalog
from app.interview.orchestrator import TurnError, _ask_json, sum_usage, usage_log  # noqa: PLC2701 -- 재사용
from app.interview.parsing import ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES, ParseError, parse_attachment
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask, ProcessCategory
from app.prompt_registry import get_prompt_overrides
from app.schemas import (
    FrameworkInterviewCreateIn, FrameworkInterviewOut, FrameworkInterviewPlanIn,
    FrameworkInterviewProgressOut, FrameworkInterviewTaskOut,
)

router = APIRouter(
    prefix="/api/framework-interviews", tags=["framework-interviews"],
    dependencies=[Depends(require_sysadmin)],
)
logger = logging.getLogger(__name__)
_parse_lock = asyncio.Lock()
BRIEF_MAX = 20_000  # 첨부 병합 상한(문자) — 프롬프트 예산
WORKING = {"generating", "drawing"}


async def _require_ai_enabled(db: AsyncSession) -> None:
    if not await is_ai_access_enabled(db):
        raise HTTPException(status_code=503, detail="AI is disabled")


async def _get_owned(db: AsyncSession, session_id: int, user: str) -> FrameworkInterviewSession:
    row = await db.get(FrameworkInterviewSession, session_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail="framework interview not found")
    await db.refresh(row, ["tasks"])
    return row


async def _out(db: AsyncSession, s: FrameworkInterviewSession) -> FrameworkInterviewOut:
    category = await db.get(ProcessCategory, s.category_id)
    tasks = sorted(s.tasks, key=lambda t: t.seq)
    return FrameworkInterviewOut(
        id=s.id, category_id=s.category_id,
        category_code=category.code if category else "", category_name=category.name if category else "",
        status=s.status, paused=s.paused, lang=s.lang, brief=s.brief, plan=s.plan,
        relations=s.relations, label=s.label,
        tasks=[FrameworkInterviewTaskOut.model_validate(t) for t in tasks],
        progress=FrameworkInterviewProgressOut(
            total=len(tasks), drawn=sum(t.status == "drawn" for t in tasks),
            failed=sum(t.status == "failed" for t in tasks),
            working=any(t.status in WORKING for t in tasks),
        ),
        created_at=s.created_at, updated_at=s.updated_at,
    )


async def _ask(messages: list[dict], schema_cls: type[BaseModel], db: AsyncSession, user: str) -> BaseModel:
    """AI 1콜 + JSON 검증 + usage 계량(map/version 없음 → 0, kind='fw_interview'). 실패는 502."""
    usage: list = []
    token = usage_log.set(usage)
    try:
        result = await _ask_json(messages, None, schema_cls, reasoning="high")
    except TurnError as exc:
        usage_log.reset(token)
        prompt_total, completion_total = sum_usage(usage)
        # 실패도 계량 — 이벤트 기록이 502 전파를 막지 않게 별도 커밋·예외 무시 (app/routers/ai.py와 동일 패턴)
        try:
            db.add(AiUsageEvent(
                login_id=user, map_id=0, version_id=0, model="", kind=None,
                ok=False, prompt_tokens=prompt_total, completion_tokens=completion_total,
            ))
            await db.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답(502)을 바꾸지 않는다
            await db.rollback()
            logger.warning("fw interview AI usage event insert failed (failure path)")
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    usage_log.reset(token)
    prompt_total, completion_total = sum_usage(usage)
    db.add(AiUsageEvent(
        login_id=user, map_id=0, version_id=0, model="", kind="fw_interview",
        ok=True, prompt_tokens=prompt_total, completion_tokens=completion_total,
    ))
    return result


async def _catalogs(db: AsyncSession) -> tuple[str, str]:
    return (
        format_managed_catalog(await get_assignee_roles(db)),
        format_managed_catalog(await get_systems(db)),
    )


async def _category_path(db: AsyncSession, category_id: int) -> str:
    chain = await load_category_chain(db, category_id)
    return " > ".join(c["name"] for c in chain)


@router.post("", response_model=FrameworkInterviewOut)
async def create_framework_interview(
    payload: FrameworkInterviewCreateIn,
    user: str = Depends(require_sysadmin),
    db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    category = await db.get(ProcessCategory, payload.category_id)
    if category is None or category.level != 5:
        raise HTTPException(status_code=422, detail="category must be a level-5 category")
    active = (await db.scalars(select(FrameworkInterviewSession).where(
        FrameworkInterviewSession.category_id == payload.category_id,
        FrameworkInterviewSession.status.notin_(("applied", "abandoned")),
    ))).first()
    if active is not None:
        raise HTTPException(status_code=409, detail=f"active session {active.id} exists for this category")
    row = FrameworkInterviewSession(
        login_id=user, category_id=payload.category_id, brief=payload.brief.strip(), lang=payload.lang,
        label=f"AI consult {now_kst():%Y-%m-%d}",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row, ["tasks"])
    return await _out(db, row)


@router.get("", response_model=list[FrameworkInterviewOut])
async def list_framework_interviews(
    active: int = 0,
    user: str = Depends(require_sysadmin),
    db: AsyncSession = Depends(get_session),
) -> list[FrameworkInterviewOut]:
    query = select(FrameworkInterviewSession).where(FrameworkInterviewSession.login_id == user)
    if active:
        query = query.where(FrameworkInterviewSession.status.notin_(("applied", "abandoned")))
    rows = (await db.scalars(query.order_by(FrameworkInterviewSession.updated_at.desc()))).all()
    out: list[FrameworkInterviewOut] = []
    for row in rows:
        await db.refresh(row, ["tasks"])
        out.append(await _out(db, row))
    return out


@router.get("/{session_id}", response_model=FrameworkInterviewOut)
async def get_framework_interview(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    return await _out(db, await _get_owned(db, session_id, user))


@router.delete("/{session_id}", status_code=204)
async def abandon_framework_interview(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> Response:
    row = await _get_owned(db, session_id, user)
    row.status = "abandoned"
    row.paused = True
    await db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/attachments", response_model=FrameworkInterviewOut)
async def upload_framework_attachment(
    session_id: int, file: UploadFile,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    filename = file.filename or "attachment"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"unsupported file type: {ext or filename}")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="file too large (max 20MB)")
    async with _parse_lock:
        try:
            text = await asyncio.to_thread(parse_attachment, filename, data)
        except ParseError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    merged = f"{row.brief}\n\n[첨부 {filename}]\n{text}".strip()
    row.brief = merged[:BRIEF_MAX]
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def generate_plan(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    row = await _get_owned(db, session_id, user)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    role_catalog, _ = await _catalogs(db)
    # 부서 후보 목록(dept_catalog)은 v1 생략 — 맵이 없어 get_eligible_users 기준이 없다
    chain = await load_category_chain(db, row.category_id)
    existing = await db.scalars(select(FrameworkInterviewTask.name).where(FrameworkInterviewTask.session_id == row.id))
    messages = build_plan_messages(
        lang=row.lang, category_path=" > ".join(c["name"] for c in chain), brief=row.brief,
        existing_names=list(existing.all()), role_catalog=role_catalog,
        overrides=await get_prompt_overrides(db),
    )
    plan = await _ask(messages, PlanOut, db, user)
    row.plan = [card.model_dump() for card in plan.cards]
    await db.commit()
    return await _out(db, row)


@router.put("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def save_plan(
    session_id: int, payload: FrameworkInterviewPlanIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    cards = [card.model_dump() for card in payload.cards]
    if payload.lock:
        if not cards:
            raise HTTPException(status_code=422, detail="plan needs at least one card")
        names = [c["name"] for c in cards]
        if len(set(names)) != len(names):
            raise HTTPException(status_code=422, detail="duplicate card names")
        category = await db.get(ProcessCategory, row.category_id)
        ids = allocate_task_ids(category.code, await load_existing_codes(db, row.category_id), len(cards))
        for seq, (card, task_id) in enumerate(zip(cards, ids, strict=True), start=1):
            card["task_id"] = task_id
            db.add(FrameworkInterviewTask(session_id=row.id, task_id=task_id, seq=seq, name=card["name"]))
        row.status = "plan_locked"
    row.plan = cards
    await db.commit()
    await db.refresh(row, ["tasks"])
    if payload.lock:
        runner.kick(row.id)
    return await _out(db, row)
