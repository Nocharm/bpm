"""실행 체크(Run) 관리 — 코멘트·참여자·나만→공유 전환·중단/다시 열기/삭제·보존·알림 끄기. 라우터(`routers/runs.py`)가 얇게 부른다.

설계: docs/superpowers/specs/2026-11-04-run-check-design.md §4.4(개인·공유와 권한)·§4.6(보존과 정리).
동작 하나가 함수 하나다 — 알림(`run_notify`)은 각 함수의 커밋 직전에 같은 트랜잭션으로 보낸다. 보기 규칙·상한·범위 해석은 `run_service`를,
하위 범위 보이기는 `run_access`를 그대로 쓴다. 호출자(라우터)는 실행 행을 잠근 채(`load_visible_run(lock=True)`) 부른다.
"""

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import clock, run_notify, workflow
from app.app_settings import get_run_limits
from app.models import Notification, ProcessMap, Run, RunComment, RunEvent, RunParticipant, RunScope
from app.run_access import get_visible_scope_paths, is_scope_visible
from app.run_service import (
    ERR_KEEP_CAP,
    ERR_NOT_OPEN,
    ERR_PARTICIPANT_ONLY,
    ERR_STARTER_ONLY,
    ERR_SUB_ACCESS,
    assert_open_cap,
    can_keep,
    ensure_eligible_participants,
    get_scope_graph,
    is_actor,
    load_live_map,
    load_version_graph,
    resolve_scope_version,
)
from app.schemas import RunCommentIn, RunParticipantsIn, RunPatchIn, RunShareIn

ERR_NODE_NOT_FOUND = "node not found"
ERR_KEEP_ONLY = "only the starter or the map owner can change keep"
ERR_ALREADY_SHARED = "run is already shared"
ERR_NOT_SHARED = "run is not shared"
ERR_ALREADY_OPEN = "run is already open"
ERR_SUMMARIZED_REOPEN = "summarized runs cannot reopen"
ERR_SUMMARIZED = "summarized runs cannot be changed"
ERR_STARTER_STAYS = "the starter stays in the run"

_ENDED_STATUSES = ("done", "stopped")


def _touch_activity(run: Run, now: datetime) -> None:
    """마지막 손댄 날을 갱신하고 방치 경고를 거둔다 — 방치 30·40일 세기는 여기서 다시 시작한다 (design §4.6)."""
    run.last_activity_at = now
    run.idle_warned_at = None


def _assert_starter(run: Run, user: str) -> None:
    if run.starter != user:
        raise HTTPException(status_code=403, detail=ERR_STARTER_ONLY)


def _assert_not_summarized(run: Run) -> None:
    """요약된 실행은 세부 기록이 없고 요약만 남는다 — 이름·보존·참여자를 더 바꾸지 않는다."""
    if run.status == "summarized":
        raise HTTPException(status_code=409, detail=ERR_SUMMARIZED)


async def _list_participant_logins(session: AsyncSession, run_id: int) -> list[str]:
    rows = await session.scalars(
        select(RunParticipant.login_id).where(RunParticipant.run_id == run_id).order_by(RunParticipant.id)
    )
    return list(rows.all())


async def _get_summarize_after(session: AsyncSession, run: Run, now: datetime) -> datetime | None:
    """끝난 실행의 요약 예정일 — 보존이면 없음, 아니면 끝난(또는 보존을 끈) 날부터 요약 일수 뒤."""
    if run.keep:
        return None
    return now + timedelta(days=(await get_run_limits(session)).summary_days)


async def _assert_keep_cap(session: AsyncSession, run: Run, scope: str) -> None:
    """보존 상한 — 공유는 맵 기준, 개인은 시작한 사람 기준 맵 합산. 휴지통 맵의 실행은 세지 않는다 (design §4.6)."""
    limits = await get_run_limits(session)
    kept = (
        select(func.count())
        .select_from(Run)
        .join(ProcessMap, ProcessMap.id == Run.map_id)
        .where(Run.keep.is_(True), Run.scope == scope, ProcessMap.deleted_at.is_(None))
    )
    if scope == "solo":
        if await session.scalar(kept.where(Run.starter == run.starter)) >= limits.keep_solo_cap:
            raise HTTPException(status_code=409, detail=ERR_KEEP_CAP)
    elif await session.scalar(kept.where(Run.map_id == run.map_id)) >= limits.keep_shared_cap:
        raise HTTPException(status_code=409, detail=ERR_KEEP_CAP)


# ── 코멘트 ──


async def _is_scope_pinned(session: AsyncSession, run_id: int, scope_path: str) -> bool:
    found = await session.scalar(
        select(RunScope.id).where(RunScope.run_id == run_id, RunScope.scope_path == scope_path).limit(1)
    )
    return found is not None


async def list_run_comments(
    session: AsyncSession, run: Run, user: str, *, scope_path: str | None, node_id: str | None
) -> list[RunComment]:
    """오래된 순 코멘트 — 볼 수 있다고 확인된 범위의 것만. 범위를 짚었는데 볼 수 없으면 403, 안 짚으면 보이는 범위 전부.

    고정 전 하위 범위(펼쳤지만 아직 들어가지 않음)는 범위 그래프와 같은 사슬 검사를 고정 없이 거쳐(403·422)
    빈 목록을 준다 — 고정 행이 없는 범위의 코멘트는 기본 가림이라 아무에게도 보이지 않는다.
    """
    visible = await get_visible_scope_paths(session, run, user)
    if scope_path is not None and not is_scope_visible(scope_path, visible):
        if await _is_scope_pinned(session, run.id, scope_path):
            raise HTTPException(status_code=403, detail=ERR_SUB_ACCESS)
        await resolve_scope_version(session, run, scope_path, user)
        return []
    query = select(RunComment).where(RunComment.run_id == run.id)
    if scope_path is not None:
        query = query.where(RunComment.scope_path == scope_path)
    if node_id is not None:
        query = query.where(RunComment.node_id == node_id)
    rows = await session.scalars(query.order_by(RunComment.created_at, RunComment.id))
    return [c for c in rows.all() if is_scope_visible(c.scope_path, visible)]


async def create_run_comment(session: AsyncSession, run: Run, user: str, body: RunCommentIn) -> RunComment:
    """열린 실행의 참여자만 남긴다 — 노드 상태와 무관하게(막힌·완료 노드에도) 쓸 수 있어 호스트·닫힘 게이트는 건너뛴다.

    하위 범위는 노드 동작과 같은 사슬 검사(하위 맵 열람 권한·게시 여부·깊이)를 거치고 처음이면 버전을 고정한다.
    """
    if run.status != "open":
        raise HTTPException(status_code=409, detail=ERR_NOT_OPEN)
    if not is_actor(run, set(await _list_participant_logins(session, run.id)), user):
        raise HTTPException(status_code=403, detail=ERR_PARTICIPANT_ONLY)
    if body.scope_path:
        graph = await get_scope_graph(session, run, body.scope_path, user, pin=True)
    else:
        graph = await load_version_graph(session, run.version_id)
    if not any(node.id == body.node_id for node in graph.nodes):
        raise HTTPException(status_code=422, detail=ERR_NODE_NOT_FOUND)
    now = clock.now()
    comment = RunComment(
        run_id=run.id, scope_path=body.scope_path, node_id=body.node_id, author=user, body=body.body, created_at=now
    )
    session.add(comment)
    await run_notify.attach_problem_note(session, run, user, body.scope_path, body.node_id, body.body)
    _touch_activity(run, now)
    await session.commit()
    return comment


# ── 설정 (이름 · 보존 · 알림 끄기) ──


async def _set_keep(session: AsyncSession, run: Run, user: str, keep: bool) -> None:
    """영구 보존 켜기·끄기 — 공유는 시작한 사람과 맵 오너, 개인은 본인. 켤 때만 상한을 본다 (design §4.4·§4.6)."""
    if not await can_keep(session, run, user):
        raise HTTPException(status_code=403, detail=ERR_KEEP_ONLY)
    _assert_not_summarized(run)
    if keep == run.keep:
        return
    if keep:
        await load_live_map(session, run.map_id, lock=True)  # 같은 맵에서 동시에 켜도 상한 검사를 한 건씩 지나게 한다
        await _assert_keep_cap(session, run, run.scope)
    run.keep = keep
    if run.status in _ENDED_STATUSES:  # 켜면 요약하지 않고, 끄면 그날부터 요약 일수를 센다
        run.summarize_after = await _get_summarize_after(session, run, clock.now())


async def _set_muted(session: AsyncSession, run: Run, user: str, muted: bool) -> None:
    """알림 끄기는 참여자별 설정 — 내 참여자 행만 바꾼다."""
    participant = await session.scalar(
        select(RunParticipant).where(RunParticipant.run_id == run.id, RunParticipant.login_id == user)
    )
    if participant is None:
        raise HTTPException(status_code=403, detail=ERR_PARTICIPANT_ONLY)
    participant.muted = muted


async def update_run(session: AsyncSession, run: Run, user: str, body: RunPatchIn) -> None:
    """보낸 필드만 바꾼다 — 하나라도 거절되면 아무것도 저장하지 않는다(커밋은 마지막에 한 번)."""
    if body.name is not None:
        _assert_starter(run, user)
        _assert_not_summarized(run)
        run.name = body.name
    if body.keep is not None:
        await _set_keep(session, run, user, body.keep)
    if body.muted is not None:
        await _set_muted(session, run, user, body.muted)
    await session.commit()


# ── 나만 → 공유 · 참여자 ──


async def share_run(session: AsyncSession, run: Run, user: str, body: RunShareIn) -> None:
    """실행 중인 개인 실행을 공유로 바꾼다 — 되돌릴 수 없다(남이 남긴 기록·받은 알림이 주인 없이 남는다, design §4.4)."""
    _assert_starter(run, user)
    if run.scope != "solo":
        raise HTTPException(status_code=409, detail=ERR_ALREADY_SHARED)
    if run.status != "open":
        raise HTTPException(status_code=409, detail=ERR_NOT_OPEN)
    invited = list(dict.fromkeys(login for login in body.participants if login != user))
    await ensure_eligible_participants(session, run.map_id, invited)  # 무거운 명단 조회는 잠금 전에 끝낸다
    await load_live_map(session, run.map_id, lock=True)
    await assert_open_cap(session, run.map_id, user, "shared")
    if run.keep:  # 보존한 개인 실행이 공유가 되면 그 맵의 공유 보존 수로 옮겨 세어진다
        await _assert_keep_cap(session, run, "shared")
    run.scope = "shared"
    session.add_all(RunParticipant(run_id=run.id, login_id=login) for login in invited)
    _touch_activity(run, clock.now())
    await run_notify.notify_invited(session, run, user, invited)
    await session.commit()


async def update_run_participants(session: AsyncSession, run: Run, user: str, body: RunParticipantsIn) -> None:
    """공유 실행의 참여자 더하기·빼기 — 시작한 사람만, 열린 실행만(끝난 실행에 초대하지 않는다, R38).

    뺀 사람이 남긴 기록(상태·코멘트)은 이름과 함께 그대로 남는다.
    """
    _assert_starter(run, user)
    _assert_not_summarized(run)
    if run.status != "open":
        raise HTTPException(status_code=409, detail=ERR_NOT_OPEN)
    if run.scope != "shared":
        raise HTTPException(status_code=409, detail=ERR_NOT_SHARED)
    if user in body.remove:
        raise HTTPException(status_code=422, detail=ERR_STARTER_STAYS)
    removed = set(body.remove)
    remaining = {login for login in await _list_participant_logins(session, run.id) if login not in removed}
    added = [login for login in dict.fromkeys(body.add) if login not in remaining]
    await ensure_eligible_participants(session, run.map_id, added)
    if removed:
        await session.execute(
            delete(RunParticipant).where(RunParticipant.run_id == run.id, RunParticipant.login_id.in_(removed))
        )
    session.add_all(RunParticipant(run_id=run.id, login_id=login) for login in added)
    await run_notify.notify_invited(session, run, user, added)
    await session.commit()


# ── 중단 · 다시 열기 · 삭제 ──


async def stop_run(session: AsyncSession, run: Run, user: str) -> None:
    """시작한 사람이 열린 실행을 중단한다 — 읽기 전용이 되고 요약까지 세기가 시작된다(보존이면 세지 않는다)."""
    _assert_starter(run, user)
    if run.status != "open":
        raise HTTPException(status_code=409, detail=ERR_NOT_OPEN)
    now = clock.now()
    run.status = "stopped"
    run.end_reason = "stopped"
    run.ended_at = now
    run.summarize_after = await _get_summarize_after(session, run, now)
    _touch_activity(run, now)
    session.add(RunEvent(run_id=run.id, actor=user, action="stop", created_at=now))
    await run_notify.notify_stopped(session, run, user)
    await session.commit()


async def reopen_run(session: AsyncSession, run: Run, user: str) -> None:
    """끝난·중단된 실행을 다시 연다 — 요약된 실행은 열 수 없고, 열린 실행 상한을 다시 본다 (design §4.6)."""
    _assert_starter(run, user)
    if run.status == "summarized":
        raise HTTPException(status_code=409, detail=ERR_SUMMARIZED_REOPEN)
    if run.status == "open":
        raise HTTPException(status_code=409, detail=ERR_ALREADY_OPEN)
    await load_live_map(session, run.map_id, lock=True)
    await assert_open_cap(session, run.map_id, run.starter, run.scope)
    now = clock.now()
    run.status = "open"
    run.end_reason = None
    run.ended_at = None
    run.summarize_after = None
    _touch_activity(run, now)
    session.add(RunEvent(run_id=run.id, actor=user, action="reopen", created_at=now))
    await session.commit()


async def delete_run(session: AsyncSession, run: Run, user: str) -> None:
    """시작한 사람만 지운다(맵 오너도 못 지운다, design §4.4) — 하위 행은 FK cascade가 함께 지운다.

    알림은 FK가 없는 느슨한 참조라 그 실행의 `run_` 알림을 따로 지운다(R33) — 남기면 누를 때 없는 실행을 열고,
    sqlite는 지운 id를 다시 쓰니 맵까지 맞는 행만 지운다.
    """
    _assert_starter(run, user)
    await _delete_run_notifications(session, run)
    await session.delete(run)
    await session.commit()


async def delete_map_run_notifications(session: AsyncSession, map_ids: list[int]) -> None:
    """맵을 영구 삭제할 때 그 맵 실행들의 `run_` 알림을 지운다(R40) — 실행은 FK cascade로 사라지지만 알림은 느슨한 참조라 남고,
    sqlite는 지운 맵 id를 다시 써 엉뚱한 맵의 실행 알림처럼 보였다. 커밋은 호출자가 한다."""
    if not map_ids:
        return
    await session.execute(
        delete(Notification).where(
            Notification.type.startswith(workflow.RUN_NOTIFICATION_PREFIX, autoescape=True),
            Notification.map_id.in_(map_ids),
        )
    )


async def _delete_run_notifications(session: AsyncSession, run: Run) -> None:
    """payload의 run_id는 JSON이라 sqlite·postgres 공통으로 거르려고 유형·맵으로 좁힌 뒤 파이썬에서 고른다."""
    rows = await session.execute(
        select(Notification.id, Notification.payload).where(
            Notification.type.startswith(workflow.RUN_NOTIFICATION_PREFIX, autoescape=True),
            Notification.map_id == run.map_id,
        )
    )
    stale_ids = [row_id for row_id, payload in rows.all() if isinstance(payload, dict) and payload.get("run_id") == run.id]
    if stale_ids:
        await session.execute(delete(Notification).where(Notification.id.in_(stale_ids)))
