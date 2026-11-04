"""실행 체크(Run) 알림 — 7종 생성, 같은 실행의 단계 완료 묶기, 문제 알림에 메모 붙이기. 커밋은 호출자가 한다.

설계: 2026-11-04-run-check-design.md §4.5(알림).
받는 사람은 공유 실행의 참여자 중 알림을 끄지 않았고(muted) 맵을 아직 볼 수 있는 사람이다. 행동한 본인은 빼고,
개인 실행은 방치 알림만 본인에게 간다. 하위 맵 안의 노드 제목·id·범위는 그 범위를 볼 수 있는 받는 사람에게만 싣는다(R16):
못 보는 사람에게는 같은 알림을 그 키 없이 보내고, 묶인 행에도 숨은 제목을 넣지 않는다.
알림 유형이 `run_` 접두인 이유는 인당 상한을 넘길 때 결재 알림보다 먼저 지우기 위해서다(`workflow._trim_notifications`).
"""

from collections.abc import Callable
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import get_run_limits
from app.clock import now
from app.models import Notification, Run, RunParticipant
from app.permissions.access import get_effective_role
from app.permissions.logic import role_rank
from app.run_access import get_visible_scope_paths, is_scope_visible

RUN_INVITED = "run_invited"
RUN_STEPS_DONE = "run_steps_done"
RUN_PROBLEM = "run_problem"
RUN_RESOLVED = "run_resolved"
RUN_FINISHED = "run_finished"
RUN_STOPPED = "run_stopped"
RUN_IDLE_WARNING = "run_idle_warning"

PROBLEM_NOTE_WINDOW = timedelta(seconds=60)  # 문제를 표시하고 이 안에 같은 사람이 남긴 코멘트가 그 알림에 붙는다
SNIPPET_LENGTH = 120  # 문제 알림에 붙는 메모 앞부분 글자 수

Built = tuple[str, dict]  # (영어 폴백 message, payload)


async def _list_recipients(
    session: AsyncSession, run: Run, *, exclude: str | None, include_solo: bool = False
) -> list[str]:
    """알림 대상 — 알림을 끄지 않은 참여자 중 `exclude`를 빼고 맵 유효 역할이 viewer 이상인 사람(접근을 잃으면 더 가지 않는다)."""
    if run.scope != "shared" and not include_solo:
        return []
    logins = await session.scalars(
        select(RunParticipant.login_id)
        .where(RunParticipant.run_id == run.id, RunParticipant.muted.is_(False))
        .order_by(RunParticipant.id)
    )
    return [
        login
        for login in logins.all()
        if login != exclude and role_rank(await get_effective_role(session, login, run.map_id)) >= role_rank("viewer")
    ]


async def get_run_recipients(session: AsyncSession, run: Run, *, exclude: str | None) -> list[str]:
    """공유 실행의 알림 대상 — 개인 실행은 빈 목록이다(방치 알림만 예외라 `notify_idle_warning`이 따로 찾는다)."""
    return await _list_recipients(session, run, exclude=exclude)


async def _build_payload(session: AsyncSession, run: Run, actor: str | None) -> dict:
    """모든 실행 알림의 공통 payload — 자동 중단·방치처럼 행동한 사람이 없으면 actor는 None이다."""
    return {
        "map_name": await workflow.get_map_name(session, run.map_id),
        "run_id": run.id,
        "run_name": run.name,
        "actor": actor,
        "actor_name": await workflow.get_display_name(session, actor) if actor else "",
    }


async def _split_by_visibility(
    session: AsyncSession, run: Run, recipients: list[str], scope_path: str
) -> tuple[list[str], list[str]]:
    """(그 범위를 볼 수 있는 사람, 못 보는 사람) — 최상위 범위는 모두 볼 수 있어 조회하지 않는다."""
    if not scope_path:
        return recipients, []
    seen: list[str] = []
    hidden: list[str] = []
    for login in recipients:
        visible = is_scope_visible(scope_path, await get_visible_scope_paths(session, run, login))
        (seen if visible else hidden).append(login)
    return seen, hidden


async def _send(session: AsyncSession, run: Run, recipients: list[str], type_: str, message: str, payload: dict) -> None:
    if recipients:
        await workflow.create_notifications(
            session,
            recipients,
            type=type_,
            map_id=run.map_id,
            version_id=run.version_id,
            message=message,
            payload=payload,
        )


async def _send_by_visibility(
    session: AsyncSession,
    run: Run,
    recipients: list[str],
    scope_path: str,
    type_: str,
    build: Callable[[bool], Built],
) -> None:
    """범위를 볼 수 있는 사람과 못 보는 사람에게 각자의 내용(`build(볼 수 있는가)`)으로 보낸다."""
    seen, hidden = await _split_by_visibility(session, run, recipients, scope_path)
    for logins, visible in ((seen, True), (hidden, False)):
        if logins:
            message, payload = build(visible)
            await _send(session, run, logins, type_, message, payload)


def _at(node_title: str) -> str:
    return f" at '{node_title}'" if node_title else ""


# ── 초대 · 문제 · 해결 · 끝 · 중단 · 방치 ──


async def notify_invited(session: AsyncSession, run: Run, actor: str, logins: list[str]) -> None:
    """공유 시작·전환·참여자 추가로 새로 참여하게 된 사람에게 초대를 알린다."""
    invited = set(logins)
    recipients = [login for login in await get_run_recipients(session, run, exclude=actor) if login in invited]
    if not recipients:
        return
    payload = await _build_payload(session, run, actor)
    message = f"{payload['actor_name']} invited you to run '{run.name}' of '{payload['map_name']}'"
    await _send(session, run, recipients, RUN_INVITED, message, payload)


async def notify_problem(
    session: AsyncSession, run: Run, actor: str, scope_path: str, node_id: str, node_title: str
) -> None:
    """문제 표시는 묶지 않고 하나씩 보낸다 — 노드 정보는 그 범위를 볼 수 있는 사람에게만."""
    recipients = await get_run_recipients(session, run, exclude=actor)
    if not recipients:
        return
    base = await _build_payload(session, run, actor)

    def build(visible: bool) -> Built:
        if not visible:
            return f"{base['actor_name']} flagged a problem in run '{run.name}'", base
        message = f"{base['actor_name']} flagged a problem{_at(node_title)} in run '{run.name}'"
        return message, {**base, "node_title": node_title, "node_id": node_id, "scope_path": scope_path}

    await _send_by_visibility(session, run, recipients, scope_path, RUN_PROBLEM, build)


async def notify_resolved(
    session: AsyncSession, run: Run, actor: str, scope_path: str, node_id: str, node_title: str
) -> None:
    """문제 해결 — 노드 정보는 문제 알림과 같은 규칙으로 그 범위를 볼 수 있는 사람에게만 싣는다."""
    recipients = await get_run_recipients(session, run, exclude=actor)
    if not recipients:
        return
    base = await _build_payload(session, run, actor)

    def build(visible: bool) -> Built:
        if not visible:
            return f"{base['actor_name']} resolved a problem in run '{run.name}'", base
        message = f"{base['actor_name']} resolved the problem{_at(node_title)} in run '{run.name}'"
        return message, {**base, "node_title": node_title, "node_id": node_id, "scope_path": scope_path}

    await _send_by_visibility(session, run, recipients, scope_path, RUN_RESOLVED, build)


async def notify_finished(session: AsyncSession, run: Run, actor: str) -> None:
    recipients = await get_run_recipients(session, run, exclude=actor)
    if recipients:
        await _send(
            session, run, recipients, RUN_FINISHED, f"All steps of run '{run.name}' are done",
            await _build_payload(session, run, actor),
        )


async def notify_stopped(session: AsyncSession, run: Run, actor: str | None) -> None:
    """직접 중단은 한 사람을 뺀 참여자에게, 자동 중단(actor 없음)은 참여자 모두에게 — 자동은 방치 일수를 싣는다."""
    recipients = await get_run_recipients(session, run, exclude=actor)
    if not recipients:
        return
    payload = await _build_payload(session, run, actor)
    if actor is None:
        days = (await get_run_limits(session)).idle_stop_days
        message = f"Run '{run.name}' was stopped after {days} days without activity"
        payload = {**payload, "auto": True, "days": days}
    else:
        message = f"{payload['actor_name']} stopped run '{run.name}'"
        payload = {**payload, "auto": False}
    await _send(session, run, recipients, RUN_STOPPED, message, payload)


async def notify_idle_warning(session: AsyncSession, run: Run, days_left: int) -> None:
    """방치 경고 — 자동 중단까지 남은 날을 싣는다. 개인 실행은 시작한 사람에게만 가고, 나머지 규칙은 공유와 같다."""
    recipients = await _list_recipients(session, run, exclude=None, include_solo=True)
    if not recipients:
        return
    unit = "day" if days_left == 1 else "days"
    message = f"Run '{run.name}' will stop automatically in {days_left} {unit} without activity"
    payload = {**await _build_payload(session, run, None), "days": days_left}
    await _send(session, run, recipients, RUN_IDLE_WARNING, message, payload)


# ── 단계 완료 묶기 ──


def _build_group_payload(base: dict, actors: list[str], count: int, node_title: str | None) -> dict:
    payload = {**base, "count": count, "actors": actors}
    if node_title is not None:  # 숨은 제목이면 키 자체를 두지 않는다
        payload["node_title"] = node_title
    return payload


def _format_group_message(payload: dict) -> str:
    count, actors = payload["count"], payload["actors"]
    who = payload["actor_name"] if len(actors) <= 1 else f"{payload['actor_name']} and {len(actors) - 1} more"
    steps = "a step" if count == 1 else f"{count} steps"
    message = f"{who} completed {steps} in run '{payload['run_name']}'"
    title = payload.get("node_title")
    return f"{message}. Latest: {title}" if title else message


async def _load_open_group_rows(session: AsyncSession, run: Run, recipients: list[str]) -> dict[str, Notification]:
    """받는 사람별로 이 실행의 안 읽은 단계 완료 행(가장 최근 것) — 읽은 행은 묶지 않고 새로 시작한다."""
    rows = await session.scalars(
        select(Notification)
        .where(
            Notification.type == RUN_STEPS_DONE,
            Notification.read.is_(False),
            Notification.map_id == run.map_id,
            Notification.recipient.in_(recipients),
        )
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    found: dict[str, Notification] = {}
    for row in rows.all():
        if (row.payload or {}).get("run_id") == run.id:
            found.setdefault(row.recipient, row)
    return found


async def notify_step_done(
    session: AsyncSession, run: Run, actor: str, node_title: str, *, scope_path: str = ""
) -> None:
    """같은 실행의 완료는 받는 사람마다 안 읽은 한 줄로 묶는다 — 개수·행동한 사람·최근 제목을 갱신하고 끌어올린다."""
    recipients = await get_run_recipients(session, run, exclude=actor)
    if not recipients:
        return
    base = await _build_payload(session, run, actor)
    seen, _ = await _split_by_visibility(session, run, recipients, scope_path)
    open_rows = await _load_open_group_rows(session, run, recipients)
    fresh: dict[bool, list[str]] = {True: [], False: []}  # 볼 수 있는가 → 새 행을 만들 사람
    for login in recipients:
        title = node_title if login in seen else None
        row = open_rows.get(login)
        if row is None:
            fresh[title is not None].append(login)
            continue
        old = row.payload or {}
        actors = [*old.get("actors", [])]
        if actor not in actors:
            actors.append(actor)
        payload = _build_group_payload(base, actors, old.get("count", 1) + 1, title)
        row.payload = payload  # 새 dict로 갈아 끼워야 JSON 변경이 추적된다
        row.message = _format_group_message(payload)
        row.created_at = now()
    for visible, logins in fresh.items():
        if logins:
            payload = _build_group_payload(base, [actor], 1, node_title if visible else None)
            await _send(session, run, logins, RUN_STEPS_DONE, _format_group_message(payload), payload)


# ── 문제 메모 ──


async def attach_problem_note(
    session: AsyncSession, run: Run, author: str, scope_path: str, node_id: str, body: str
) -> None:
    """문제를 표시하고 1분 안에 같은 사람이 같은 노드에 남긴 코멘트를 그 문제 알림에 붙인다 — 받는 사람별 가장 최근 행 하나, 먼저 붙은 메모 우선.

    노드 키를 못 받은 사람(숨은 범위)의 행은 짝이 맞지 않아 자연히 건너뛴다.
    """
    snippet = body.strip()[:SNIPPET_LENGTH]
    if not snippet:
        return
    rows = await session.scalars(
        select(Notification)
        .where(
            Notification.type == RUN_PROBLEM,
            Notification.map_id == run.map_id,
            Notification.created_at >= now() - PROBLEM_NOTE_WINDOW,
        )
        .order_by(Notification.created_at.desc(), Notification.id.desc())
    )
    handled: set[str] = set()
    for row in rows.all():
        payload = row.payload or {}
        matches = (
            payload.get("run_id") == run.id
            and payload.get("actor") == author
            and payload.get("node_id") == node_id
            and payload.get("scope_path") == scope_path
        )
        if not matches or row.recipient in handled:
            continue
        handled.add(row.recipient)
        if "snippet" not in payload:
            row.payload = {**payload, "snippet": snippet}
