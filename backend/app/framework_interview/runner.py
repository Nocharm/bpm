"""캠페인 백그라운드 러너 — 세션당 루프 1개, 한 바퀴 = 실행 가능한 잡 전부 병렬 (spec 2026-09-21 §6).

잡 순서: 제출된 카드 드로잉 먼저, 설문 생성 다음(ready 장수 제한 없음 — 전부 미리 받는다).
동시 실행은 settings.fw_consult_concurrency로 제한하고, 전역 상한은 ai_client의 ai_max_concurrency가 맡는다.
일시정지·비활성 세션이면 즉시 종료. 단일 uvicorn 워커 전제(kb/indexing.spawn 패턴).
재기동 시 drawing→submitted, generating→pending 복구.
"""

import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems, is_ai_access_enabled
from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview.ai import ask_schema
from app.framework_interview.assemble import load_category_chain, validate_row
from app.framework_interview.contracts import (
    QuestionnaireOut, RowOut, build_context_text, build_questionnaire_messages, build_row_messages,
    format_managed_catalog,
)
from app.framework_interview.existing import existing_row_of
from app.framework_interview.normalize import normalize_questionnaire, normalize_row
from app.interview.orchestrator import TurnError, sum_usage, usage_log
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask
from app.prompt_registry import get_prompt_overrides
from app.settings import settings

logger = logging.getLogger(__name__)

LIVE_STATUSES = ("plan_locked", "linking")

_tasks: set[asyncio.Task] = set()
_active: set[int] = set()
# kick()이 이미 활성인 세션에 도착하면 여기 표시만 하고 반환 — 루프가 스텝 종료 후
# _active를 비우기 전에 이 표시를 확인해, DB 커밋 직후 걸린 kick을 놓치지 않는다(lost-kick 방지).
_wake: set[int] = set()


def spawn(coro: Coroutine[Any, Any, None]) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _tasks.discard(t)
        _ = t.cancelled() or t.exception()

    task.add_done_callback(_done)


def kick(session_id: int) -> None:
    """세션 루프를 깨운다 — 이미 돌고 있으면 wake 플래그만 세워 루프가 한 바퀴 더 돌게 한다."""
    _wake.add(session_id)
    if session_id in _active:
        return
    spawn(process_session(session_id))


async def process_session(session_id: int) -> None:
    if session_id in _active:
        return
    _active.add(session_id)
    try:
        while True:
            _wake.discard(session_id)
            async with SessionLocal() as db:
                try:
                    progressed = await run_jobs(db, session_id)
                except Exception:  # noqa: BLE001 -- 루프는 죽지 않고 로그만, 대신 걸린 작업은 되돌린다
                    logger.exception("framework interview step failed (session %s)", session_id)
                    await db.rollback()
                    async with SessionLocal() as recovery_db:
                        await recover_stale_tasks(recovery_db, session_id)
                        await recovery_db.commit()
                    return
            # db 컨텍스트가 닫힌 뒤에야 wake를 다시 본다 — 스텝 도중 도착한 kick이
            # _active 확인 때문에 무시됐더라도 여기서 잡아 한 바퀴 더 돈다.
            if not progressed and session_id not in _wake:
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


def _existing_row_of_task(session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> dict | None:
    """정정 태스크만 현재 등록된 행을 프롬프트에 싣는다 — 새 카드는 백지에서 그린다."""
    return existing_row_of(session.existing, task.task_id) if task.mode == "revise" else None


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
        lang=session.lang, category_path=" > ".join(c["name"] for c in chain),
        brief=build_context_text(session.brief, session.attachments),
        card=card, neighbors=_neighbors_of(session, card), existing_row=_existing_row_of_task(session, task),
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await ask_schema(messages, QuestionnaireOut, normalizer=normalize_questionnaire, reasoning="high")
        task.questionnaire = out.model_dump()
        task.status = "ready"
        task.error = None
        await _record_usage(db, session.login_id, usage, ok=True)
    except TurnError as exc:
        # pending으로 되돌리면 run_jobs가 같은 카드를 다시 집어 루프가 무한히 돈다 —
        # failed로 멈춰 보드의 재시도 버튼으로 넘긴다(retry_task가 답변 없으면 pending으로 되돌린다).
        task.status = "failed"
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
        existing_row=_existing_row_of_task(session, task),
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await ask_schema(messages, RowOut, normalizer=normalize_row, reasoning=None)
        row = out.model_dump(by_alias=True, exclude_none=True)
        row.pop("owner", None)  # 담당자 실명은 AI가 짓지 않는다 — 역할(ownerRole)만 받는다
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


def collect_jobs(tasks: list[FrameworkInterviewTask]) -> list[tuple[str, FrameworkInterviewTask]]:
    """드로잉(submitted) 먼저, 설문 생성(pending) 다음 — 둘 다 seq 순. ready 장수 제한은 없다(전부 미리 받는다)."""
    ordered = sorted(tasks, key=lambda t: t.seq)
    return ([("draw", t) for t in ordered if t.status == "submitted"]
            + [("generate", t) for t in ordered if t.status == "pending"])


async def _run_job(sem: asyncio.Semaphore, kind: str, session_id: int, task_id: int) -> None:
    """잡 하나를 자기 DB 세션에서 — 동시 커밋이 서로의 flush에 끼어들지 않게 세션을 공유하지 않는다."""
    async with sem, SessionLocal() as db:
        # 대기 중에 일시정지·종료·AI 차단이 걸렸을 수 있으니 시작 직전 다시 본다.
        if not await is_ai_access_enabled(db):
            return
        session = await db.get(FrameworkInterviewSession, session_id)
        if session is None or session.paused or session.status not in LIVE_STATUSES:
            return
        task = await db.get(FrameworkInterviewTask, task_id)
        if task is None:
            return
        if kind == "draw":
            await _draw_row(db, session, task)
        else:
            await _generate_questionnaire(db, session, task)


async def run_jobs(db: AsyncSession, session_id: int) -> bool:
    """실행 가능한 잡 전부를 세마포어 안에서 병렬로. False = 할 일 없음(일시정지·비활성·AI 꺼짐·큐 비움).

    세마포어는 호출마다 새로 만든다 — 세션당 루프는 하나(`_active` 가드)고 gather가 끝난 뒤에야
    반환하므로 세션 단위 상한과 동치이며, 모듈 전역 캐시(이벤트 루프 바인딩·미회수 항목)를 피한다.
    """
    if not await is_ai_access_enabled(db):  # settings.ai_enabled을 포함(app_settings.is_ai_access_enabled)
        return False
    session = await db.get(FrameworkInterviewSession, session_id)
    if session is None or session.paused or session.status not in LIVE_STATUSES:
        return False
    await db.refresh(session, ["tasks"])
    jobs = collect_jobs(list(session.tasks))
    if not jobs:
        return False
    sem = asyncio.Semaphore(max(1, settings.fw_consult_concurrency))
    await asyncio.gather(*(_run_job(sem, kind, session_id, task.id) for kind, task in jobs))
    return True


async def recover_stale_tasks(db: AsyncSession, session_id: int | None = None) -> int:
    """진행 중이던 상태를 큐로 되돌린다(중복 실행 대신 재시도).

    session_id 없으면 재기동 전수 복구, 주면 그 세션만(러너 예외 처리에서 wedge 방지로 재사용).
    """
    drawing_stmt = update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "drawing")
    generating_stmt = update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "generating")
    if session_id is not None:
        drawing_stmt = drawing_stmt.where(FrameworkInterviewTask.session_id == session_id)
        generating_stmt = generating_stmt.where(FrameworkInterviewTask.session_id == session_id)
    drawing = await db.execute(drawing_stmt.values(status="submitted"))
    generating = await db.execute(generating_stmt.values(status="pending"))
    return (drawing.rowcount or 0) + (generating.rowcount or 0)


async def resume_live_sessions(db: AsyncSession) -> None:
    """앱 시작 시 살아있는 세션의 루프를 다시 깨운다(정지 안 된 것만)."""
    ids = await db.scalars(select(FrameworkInterviewSession.id).where(
        FrameworkInterviewSession.status.in_(LIVE_STATUSES), FrameworkInterviewSession.paused.is_(False)
    ))
    for session_id in ids.all():
        kick(session_id)
