"""캠페인 백그라운드 러너 — 세션당 루프 1개, 한 스텝 = AI 1콜 (spec 2026-09-21 §6).

우선순위: 제출된 카드 드로잉 > 설문 prefetch(ready 2장 유지). 일시정지·비활성 세션이면 즉시 종료.
단일 uvicorn 워커 전제(kb/indexing.spawn 패턴). 재기동 시 drawing→submitted, generating→pending 복구.
"""

import asyncio
import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems, is_ai_access_enabled
from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview.assemble import load_category_chain, validate_row
from app.framework_interview.contracts import (
    QuestionnaireOut, RowOut, build_questionnaire_messages, build_row_messages, format_managed_catalog,
)
from app.interview.orchestrator import TurnError, _ask_json, sum_usage, usage_log  # noqa: PLC2701 -- 재사용
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask
from app.prompt_registry import get_prompt_overrides
from app.settings import settings

logger = logging.getLogger(__name__)

PREFETCH_READY = 2  # 현재 답변 중 1장 + 다음 1장
LIVE_STATUSES = ("plan_locked", "linking")

_tasks: set[asyncio.Task] = set()
_active: set[int] = set()


def spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _tasks.discard(t)
        _ = t.cancelled() or t.exception()

    task.add_done_callback(_done)


def kick(session_id: int) -> None:
    """세션 루프를 깨운다 — 이미 돌고 있으면 무시(루프가 다음 스텝에서 새 작업을 집는다)."""
    if session_id in _active:
        return
    spawn(process_session(session_id))


async def process_session(session_id: int) -> None:
    if session_id in _active:
        return
    _active.add(session_id)
    try:
        while True:
            async with SessionLocal() as db:
                try:
                    progressed = await run_one_step(db, session_id)
                except Exception:  # noqa: BLE001 -- 루프는 죽지 않고 로그만
                    logger.exception("framework interview step failed (session %s)", session_id)
                    await db.rollback()
                    return
            if not progressed:
                return
    finally:
        _active.discard(session_id)


async def _record_usage(db: AsyncSession, login_id: str, usage: list, ok: bool) -> None:
    prompt_total, completion_total = sum_usage(usage)
    db.add(AiUsageEvent(
        login_id=login_id, map_id=0, version_id=0, model="", kind="fw_interview" if ok else None,
        ok=ok, prompt_tokens=prompt_total, completion_tokens=completion_total,
    ))


def _card_of(session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> dict:
    for card in session.plan or []:
        if card.get("task_id") == task.task_id:
            return card
    return {"name": task.name}


def _neighbors_of(session: FrameworkInterviewSession, card: dict) -> list[dict]:
    names = set(card.get("depends_on") or [])
    me = card.get("name")
    return [c for c in session.plan or [] if c.get("name") in names or me in (c.get("depends_on") or [])]


async def _generate_questionnaire(db: AsyncSession, session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> None:
    task.status = "generating"
    await db.commit()
    role_catalog = format_managed_catalog(await get_assignee_roles(db))
    system_catalog = format_managed_catalog(await get_systems(db))
    chain = await load_category_chain(db, session.category_id)
    card = _card_of(session, task)
    messages = build_questionnaire_messages(
        lang=session.lang, category_path=" > ".join(c["name"] for c in chain), brief=session.brief,
        card=card, neighbors=_neighbors_of(session, card),
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await _ask_json(messages, None, QuestionnaireOut, reasoning="high")
        task.questionnaire = out.model_dump()
        task.status = "ready"
        task.error = None
        await _record_usage(db, session.login_id, usage, ok=True)
    except TurnError as exc:
        task.status = "pending"
        task.error = str(exc)
        await _record_usage(db, session.login_id, usage, ok=False)
    finally:
        usage_log.reset(token)
    await db.commit()


async def _draw_row(db: AsyncSession, session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> None:
    task.status = "drawing"
    await db.commit()
    role_catalog = format_managed_catalog(await get_assignee_roles(db))
    system_catalog = format_managed_catalog(await get_systems(db))
    card = _card_of(session, task)
    messages = build_row_messages(
        lang=session.lang, card=card, questionnaire=task.questionnaire or {}, answers=task.answers or {},
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await _ask_json(messages, None, RowOut, reasoning=None)
        row = out.model_dump(by_alias=True, exclude_none=True)
        row["department"] = row.get("department") or card.get("department", "")
        chain = await load_category_chain(db, session.category_id)
        l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
        issues = validate_row(chain, l5, {"taskId": task.task_id, **row})
        task.row = row
        task.issues = issues
        if any(i["severity"] == "error" for i in issues):
            task.status = "failed"
            task.error = "; ".join(i["message"] for i in issues if i["severity"] == "error")[:2000]
        else:
            task.status = "drawn"
            task.error = None
            task.drawn_at = now_kst()
        await _record_usage(db, session.login_id, usage, ok=True)
    except TurnError as exc:
        task.status = "failed"
        task.error = str(exc)
        await _record_usage(db, session.login_id, usage, ok=False)
    finally:
        usage_log.reset(token)
    await db.commit()


async def run_one_step(db: AsyncSession, session_id: int) -> bool:
    """작업 1개 처리. False = 더 할 일 없음(일시정지·비활성·AI 꺼짐·큐 비움)."""
    if not settings.ai_enabled or not await is_ai_access_enabled(db):
        return False
    session = await db.get(FrameworkInterviewSession, session_id)
    if session is None or session.paused or session.status not in LIVE_STATUSES:
        return False
    await db.refresh(session, ["tasks"])
    tasks = sorted(session.tasks, key=lambda t: t.seq)
    submitted = next((t for t in tasks if t.status == "submitted"), None)
    if submitted is not None:
        await _draw_row(db, session, submitted)
        return True
    ready_count = sum(t.status == "ready" for t in tasks)
    pending = next((t for t in tasks if t.status == "pending"), None)
    if pending is not None and ready_count < PREFETCH_READY:
        await _generate_questionnaire(db, session, pending)
        return True
    return False


async def recover_stale_tasks(db: AsyncSession) -> int:
    """재기동 복구 — 진행 중이던 상태를 큐로 되돌린다(중복 실행 대신 재시도)."""
    drawing = await db.execute(
        update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "drawing").values(status="submitted")
    )
    generating = await db.execute(
        update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "generating").values(status="pending")
    )
    return (drawing.rowcount or 0) + (generating.rowcount or 0)


async def resume_live_sessions(db: AsyncSession) -> None:
    """앱 시작 시 살아있는 세션의 루프를 다시 깨운다(정지 안 된 것만)."""
    ids = await db.scalars(select(FrameworkInterviewSession.id).where(
        FrameworkInterviewSession.status.in_(LIVE_STATUSES), FrameworkInterviewSession.paused.is_(False)
    ))
    for session_id in ids.all():
        kick(session_id)
