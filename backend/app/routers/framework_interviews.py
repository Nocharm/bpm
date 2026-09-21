"""AI L5 캠페인 API — sysadmin 전용, AI 게이트, 세션·계획·설문·러너·조립 (spec 2026-09-21 §8)."""

import asyncio
import logging
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, is_ai_access_enabled
from app.auth import require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.framework_interview import runner
from app.framework_interview.ai import ask_schema
from app.framework_interview.answers import fill_answers
from app.framework_interview.assemble import (
    allocate_task_ids, assemble_document, load_category_chain, load_existing_codes, validate_row,
)
from app.framework_interview.contracts import (
    PlanOut, RelationsOut, build_context_text, build_plan_messages, build_relations_messages,
    format_managed_catalog,
)
from app.framework_interview.existing import load_existing_l6
from app.framework_interview.normalize import normalize_plan, normalize_relations
from app.interview.orchestrator import TurnError, sum_usage, usage_log
from app.interview.parsing import ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES, ParseError, parse_attachment
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask, ProcessCategory
from app.prompt_registry import get_prompt_overrides
from app.schemas import (
    FrameworkExistingOut, FrameworkInterviewAnswersIn, FrameworkInterviewCreateIn, FrameworkInterviewOut,
    FrameworkInterviewPlanIn, FrameworkInterviewProgressOut, FrameworkInterviewRelationsIn,
    FrameworkInterviewTaskDetailOut, FrameworkInterviewTaskOut,
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


async def _get_session_row(db: AsyncSession, session_id: int) -> FrameworkInterviewSession:
    """세션 조회 — sysadmin이면 누구의 세션이든 읽고 이어받는다(login_id는 생성자 기록용)."""
    row = await db.get(FrameworkInterviewSession, session_id)
    if row is None:
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
        attachments=[{"name": a.get("name", ""), "chars": int(a.get("chars") or 0)} for a in s.attachments or []],
        relations=s.relations, label=s.label,
        existing=[FrameworkExistingOut(
            map_id=e["map_id"], code=e["code"], name=e["name"], activity_count=len(e.get("activities") or []),
        ) for e in s.existing or []],
        tasks=[FrameworkInterviewTaskOut.model_validate(t) for t in tasks],
        progress=FrameworkInterviewProgressOut(
            total=len(tasks), drawn=sum(t.status == "drawn" for t in tasks),
            failed=sum(t.status == "failed" for t in tasks),
            working=any(t.status in WORKING for t in tasks),
        ),
        created_at=s.created_at, updated_at=s.updated_at,
    )


async def _ask(
    messages: list[dict], schema_cls: type[BaseModel], db: AsyncSession, user: str,
    normalizer: Callable[[Any], Any] | None = None,
) -> BaseModel:
    """AI 호출(최대 3회, 검증 오류 되먹임) + usage 계량(map/version 없음 → 0, kind='fw_interview'). 실패는 502."""
    usage: list = []
    token = usage_log.set(usage)
    try:
        result = await ask_schema(messages, schema_cls, normalizer=normalizer, reasoning="high")
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
        existing=await load_existing_l6(db, payload.category_id),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row, ["tasks"])
    return await _out(db, row)


@router.get("", response_model=list[FrameworkInterviewOut])
async def list_framework_interviews(
    active: int = 0,
    db: AsyncSession = Depends(get_session),
) -> list[FrameworkInterviewOut]:
    # sysadmin 누구나 모든 세션을 이어받는다 — 담당자가 바뀌어도 진행 중인 캠페인이 묻히지 않게.
    query = select(FrameworkInterviewSession)
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
    return await _out(db, await _get_session_row(db, session_id))


@router.delete("/{session_id}", status_code=204)
async def abandon_framework_interview(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> Response:
    row = await _get_session_row(db, session_id)
    row.status = "abandoned"
    row.paused = True
    await db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/attachments", response_model=FrameworkInterviewOut)
async def upload_framework_attachment(
    session_id: int, file: UploadFile,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
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
    # brief(사용자 텍스트)에 섞지 않고 첨부 목록에 담는다 — 잘못 올린 파일은 개별 삭제로 되돌린다
    row.attachments = [*(row.attachments or []), {"name": filename, "chars": len(text), "text": text[:BRIEF_MAX]}]
    await db.commit()
    return await _out(db, row)


@router.delete("/{session_id}/attachments/{index}", response_model=FrameworkInterviewOut)
async def delete_framework_attachment(
    session_id: int, index: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    items = list(row.attachments or [])
    if index < 0 or index >= len(items):
        raise HTTPException(status_code=404, detail="attachment not found")
    del items[index]
    row.attachments = items
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def generate_plan(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    row = await _get_session_row(db, session_id)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    role_catalog = format_managed_catalog(await get_assignee_roles(db))
    # 부서 후보 목록(dept_catalog)은 v1 생략 — 맵이 없어 get_eligible_users 기준이 없다
    chain = await load_category_chain(db, row.category_id)
    existing = await db.scalars(select(FrameworkInterviewTask.name).where(FrameworkInterviewTask.session_id == row.id))
    messages = build_plan_messages(
        lang=row.lang, category_path=" > ".join(c["name"] for c in chain),
        brief=build_context_text(row.brief, row.attachments),
        existing_names=list(existing.all()), role_catalog=role_catalog,
        overrides=await get_prompt_overrides(db),
    )
    plan = await _ask(messages, PlanOut, db, user, normalizer=normalize_plan)
    row.plan = [card.model_dump() for card in plan.cards]
    await db.commit()
    return await _out(db, row)


@router.put("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def save_plan(
    session_id: int, payload: FrameworkInterviewPlanIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    if payload.brief is not None:
        row.brief = payload.brief.strip()[:BRIEF_MAX]
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


async def _get_task(db: AsyncSession, session: FrameworkInterviewSession, task_id: int) -> FrameworkInterviewTask:
    task = next((t for t in session.tasks if t.id == task_id), None)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/{session_id}/tasks/{task_pk}", response_model=FrameworkInterviewTaskDetailOut)
async def get_task_detail(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewTaskDetailOut:
    row = await _get_session_row(db, session_id)
    return FrameworkInterviewTaskDetailOut.model_validate(await _get_task(db, row, task_pk))


@router.post("/{session_id}/tasks/{task_pk}/answers", response_model=FrameworkInterviewOut)
async def submit_answers(
    session_id: int, task_pk: int, payload: FrameworkInterviewAnswersIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    task = await _get_task(db, row, task_pk)
    if task.status != "ready" or not task.questionnaire:
        raise HTTPException(status_code=409, detail="questionnaire is not ready")
    filled, missing = fill_answers(task.questionnaire, payload.answers)
    if missing:
        raise HTTPException(status_code=422, detail={"detail": "missing answers", "missing": missing})
    task.answers = filled
    task.status = "submitted"
    task.error = None
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/tasks/{task_pk}/retry", response_model=FrameworkInterviewOut)
async def retry_task(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    task = await _get_task(db, row, task_pk)
    if task.status != "failed":
        raise HTTPException(status_code=409, detail="task is not failed")
    task.status = "submitted" if task.answers else "pending"
    task.error = None
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/tasks/{task_pk}/skip", response_model=FrameworkInterviewOut)
async def skip_task(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    """실패 카드를 플레이스홀더 행(활동 1개)으로 대체해 진행 — 계속 실패해도 세션을 포기하지 않게 한다."""
    row = await _get_session_row(db, session_id)
    task = await _get_task(db, row, task_pk)
    if task.status != "failed":
        raise HTTPException(status_code=409, detail="only failed tasks can be skipped")
    card = next((c for c in row.plan or [] if c.get("task_id") == task.task_id), {})
    placeholder_row = {
        "l6": task.name,
        "ownerRole": str(card.get("owner_role") or "")[:100],
        "department": str(card.get("department") or "")[:100],
        "fields": {},
        "actions": [{"seq": 1, "label": task.name[:200], "kind": "action"}],
    }
    chain = await load_category_chain(db, row.category_id)
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    issues = validate_row(chain, l5, {"taskId": task.task_id, **placeholder_row})
    issues.append({"severity": "warning", "path": f"rows[{task.seq - 1}]",
                   "message": "placeholder row (skipped after AI failure) - draw the activities by hand"})
    task.row = placeholder_row
    task.issues = issues
    task.placeholder = True
    task.status = "drawn"
    task.error = None
    task.drawn_at = now_kst()
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/tasks/{task_pk}/reopen", response_model=FrameworkInterviewOut)
async def reopen_task(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    """그려진 카드를 다시 연다 — 설문·답은 유지한 채 ready로 되돌려 고쳐 제출하면 다시 그린다 (뒤로 가기, 2026-09-21)."""
    row = await _get_session_row(db, session_id)
    task = await _get_task(db, row, task_pk)
    if row.status == "applied":
        raise HTTPException(status_code=409, detail="session is already applied")
    if task.status != "drawn":
        raise HTTPException(status_code=409, detail="only drawn tasks can be reopened")
    task.status = "ready" if task.questionnaire else "pending"
    task.row = None
    task.issues = []
    task.placeholder = False
    task.error = None
    task.drawn_at = None
    # 연결·조립은 그 카드가 다시 그려진 뒤 다시 해야 한다
    row.status = "plan_locked"
    row.assembled = None
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/reopen-relations", response_model=FrameworkInterviewOut)
async def reopen_relations(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    """등록 단계에서 연결 단계로 되돌아간다(관계 편집 유지, 조립 문서는 확정 시 다시 만든다)."""
    row = await _get_session_row(db, session_id)
    if row.status != "ready":
        raise HTTPException(status_code=409, detail="session is not at the register step")
    row.status = "linking"
    row.assembled = None
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/pause", response_model=FrameworkInterviewOut)
async def pause_session(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    row.paused = True
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/resume", response_model=FrameworkInterviewOut)
async def resume_session(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    row.paused = False
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


def _assert_all_drawn(row: FrameworkInterviewSession) -> None:
    if not row.tasks or any(t.status != "drawn" for t in row.tasks):
        raise HTTPException(status_code=409, detail="all tasks must be drawn first")


def _has_known_task_ids(row: FrameworkInterviewSession, relations: RelationsOut) -> bool:
    """entry/edge가 이 세션의 task_id만 가리키는지. 조립기는 미지의 id를 해석할 수 없다."""
    known = {t.task_id for t in row.tasks}
    return relations.entry.taskId in known and all(
        e.src in known and e.dst in known for e in relations.edges
    )


@router.post("/{session_id}/relations", response_model=FrameworkInterviewOut)
async def generate_relations(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    row = await _get_session_row(db, session_id)
    _assert_all_drawn(row)
    rows_by_task = {t.task_id: t.row or {} for t in row.tasks}
    messages = build_relations_messages(
        lang=row.lang, plan=row.plan or [], rows=rows_by_task, overrides=await get_prompt_overrides(db),
    )
    known = {t.task_id: t.name for t in sorted(row.tasks, key=lambda t: t.seq)}
    # 미지의 taskId·이름 참조는 정규화가 해석하거나 버린다 — 502 대신 부분 결과를 편집 표로 넘긴다
    out = await _ask(messages, RelationsOut, db, user, normalizer=lambda raw: normalize_relations(raw, known))
    row.relations = out.model_dump(by_alias=True, exclude_none=True)
    row.status = "linking"
    await db.commit()
    return await _out(db, row)


@router.put("/{session_id}/relations", response_model=FrameworkInterviewOut)
async def confirm_relations(
    session_id: int, payload: FrameworkInterviewRelationsIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    _assert_all_drawn(row)
    try:
        relations = RelationsOut.model_validate(payload.relations)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid relations: {exc}") from exc
    if not _has_known_task_ids(row, relations):
        raise HTTPException(status_code=422, detail="relations reference unknown taskId")
    row.relations = relations.model_dump(by_alias=True, exclude_none=True)
    await assemble_document(db, row)
    row.status = "ready"
    await db.commit()
    return await _out(db, row)


@router.get("/{session_id}/document")
async def get_document(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> dict:
    row = await _get_session_row(db, session_id)
    if row.status not in ("ready", "applied") or not row.assembled:
        raise HTTPException(status_code=409, detail="document is not assembled yet")
    return row.assembled


@router.post("/{session_id}/mark-applied", response_model=FrameworkInterviewOut)
async def mark_applied(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_session_row(db, session_id)
    if row.status != "ready":
        raise HTTPException(status_code=409, detail="session is not ready")
    row.status = "applied"
    await db.commit()
    return await _out(db, row)
