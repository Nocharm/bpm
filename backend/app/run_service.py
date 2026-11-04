"""실행 체크(Run) 서비스 — 보기 규칙·읽기 모델·시작 검증·노드 동작. 라우터(`routers/runs.py`)가 얇게 부른다.

설계: docs/superpowers/specs/2026-11-04-run-check-design.md §4.1(시작·상한)·§4.2(상태 모델·하위프로세스)·
§4.4(개인·공유와 권한). 코멘트·중단은 같은 파일에 이어서 붙는다(Task 5 이후).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app import clock, workflow
from app.app_settings import get_run_limits
from app.models import (
    Edge,
    MapVersion,
    Node,
    ProcessMap,
    Run,
    RunComment,
    RunEvent,
    RunNodeState,
    RunParticipant,
    RunScope,
)
from app.permissions.access import get_effective_role, get_eligible_users
from app.permissions.logic import role_rank
from app.run_graph import (
    ACTIONABLE_TYPES,
    RunGraph,
    RunGraphNode,
    RunScopeState,
    count_run_progress,
    derive_run_statuses,
    find_loop_body,
    find_run_back_edge_ids,
    find_touched_after,
    get_branch_options,
    get_reached_end_key,
    is_run_scope_finished,
)
from app.schemas import (
    RunActionIn,
    RunCommentCountOut,
    RunCreateIn,
    RunDetailOut,
    RunListOut,
    RunNodeStateOut,
    RunOut,
    RunParticipantOut,
    RunProgressOut,
    RunScopeOut,
)
from app.subprocess import is_embeddable_subprocess_map, resolve_linked_version

ERR_NOT_OPEN = "run is not open"
ERR_STARTER_ONLY = "only the starter can do this"
ERR_PARTICIPANT_ONLY = "only participants can change this run"
ERR_NEEDS_PUBLISHED = "run needs a published version"
ERR_FRAMEWORK = "framework maps cannot run"
ERR_SOLO_CAP = "open solo run limit reached"
ERR_SHARED_CAP = "open shared run limit reached"
ERR_KEEP_CAP = "keep limit reached"
ERR_PARTICIPANT_ACCESS = "participant {login} cannot view this map"
ERR_NOT_ACTIONABLE = "node is not actionable"
ERR_BAD_STATE = "action not allowed in this state"
ERR_CHOOSE_BRANCH = "choose a branch"
ERR_CHOOSE_EXIT = "choose an exit"
ERR_TOUCHED_AFTER = "later steps already changed: {title}"
ERR_SUB_PROGRESS = "subprocess has progress"  # FE는 "하위 맵 기록도 모두 취소돼요" 안내 후 cascade=true로 다시 보낸다
ERR_TOO_DEEP = "subprocess is too deep"
ERR_SUB_ACCESS = "cannot view the subprocess map"
ERR_SUB_NOT_PUBLISHED = "subprocess map has no published version"
ERR_SUB_UNAVAILABLE = "subprocess map is unavailable"

MAX_SCOPE_DEPTH = 5  # 하위 맵 중첩 상한(범위 경로 조각 수) — 설계 §4.2 [빌더], 계획에서 5단계로 정함

RUN_LIST_PAGE_SIZE = 8  # 모든 실행 창이 8줄씩 쪽 나눔 (design §4.3)
RunTab = Literal["open", "ended", "summary"]
_TAB_STATUSES: dict[str, tuple[str, ...]] = {
    "open": ("open",),
    "ended": ("done", "stopped"),
    "summary": ("summarized",),
}
_RUNNABLE_VERSION_STATUSES = (workflow.PUBLISHED, workflow.EXPIRED)


async def load_live_map(session: AsyncSession, map_id: int, *, lock: bool = False) -> ProcessMap:
    """휴지통에 있거나 없는 맵은 404 — 권한 게이트(`require_map_role`)는 휴지통을 걸러 주지 않는다."""
    found_map = await session.get(ProcessMap, map_id, with_for_update=lock or None, populate_existing=lock)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found_map


async def load_visible_run(session: AsyncSession, run_id: int, user: str, *, lock: bool = False) -> Run:
    """볼 수 없는 실행은 이유를 가리지 않고 404 — 개인 실행이나 접근을 잃은 맵의 존재를 흘리지 않는다."""
    not_found = HTTPException(status_code=404, detail=f"run {run_id} not found")
    run = await session.get(Run, run_id, with_for_update=lock or None, populate_existing=lock)
    if run is None:
        raise not_found
    found_map = await session.get(ProcessMap, run.map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise not_found
    if role_rank(await get_effective_role(session, user, run.map_id)) < role_rank("viewer"):
        raise not_found
    if run.scope == "solo" and run.starter != user:  # 맵 오너·sysadmin도 남의 개인 실행은 보지 않는다
        raise not_found
    return run


async def load_version_graph(session: AsyncSession, version_id: int) -> RunGraph:
    nodes = (await session.scalars(select(Node).where(Node.version_id == version_id))).all()
    edges = (await session.scalars(select(Edge).where(Edge.version_id == version_id))).all()
    return RunGraph.from_models(list(nodes), list(edges))


async def load_scope_state(session: AsyncSession, run_id: int, scope_path: str) -> RunScopeState:
    rows = (
        await session.scalars(
            select(RunNodeState).where(RunNodeState.run_id == run_id, RunNodeState.scope_path == scope_path)
        )
    ).all()
    scope = await session.scalar(
        select(RunScope).where(RunScope.run_id == run_id, RunScope.scope_path == scope_path)
    )
    state = RunScopeState(closed=scope is not None and scope.closed)
    for row in rows:
        state.manual[row.node_id] = row.status
        if row.chosen_edge_id is not None:
            state.choice[row.node_id] = row.chosen_edge_id
        if row.exit_key is not None:
            state.exit[row.node_id] = row.exit_key
    return state


async def _compute_progress(session: AsyncSession, run: Run) -> RunProgressOut:
    if run.status == "summarized":  # 단계별 기록을 지운 뒤라 계산할 수 없다 — 화면은 `summary`를 보인다
        return RunProgressOut(done=0, total=0)
    done, total = count_run_progress(
        await load_version_graph(session, run.version_id), await load_scope_state(session, run.id, "")
    )
    return RunProgressOut(done=done, total=total)


async def build_run_row(session: AsyncSession, run: Run, user: str) -> RunOut:
    found_map = await session.get(ProcessMap, run.map_id)
    version = await session.get(MapVersion, run.version_id)
    participants = (
        await session.scalars(select(RunParticipant).where(RunParticipant.run_id == run.id).order_by(RunParticipant.id))
    ).all()
    problem_count = await session.scalar(
        select(func.count()).select_from(RunNodeState).where(RunNodeState.run_id == run.id, RunNodeState.status == "problem")
    )
    return RunOut(
        id=run.id,
        map_id=run.map_id,
        map_name=found_map.name,
        version_id=run.version_id,
        version_number=version.version_number,
        version_label=version.label,
        version_is_current=version.status == workflow.PUBLISHED,
        name=run.name,
        scope=run.scope,
        starter=run.starter,
        status=run.status,
        end_reason=run.end_reason,
        keep=run.keep,
        created_at=run.created_at,
        last_activity_at=run.last_activity_at,
        ended_at=run.ended_at,
        summarize_after=run.summarize_after,
        participants=[RunParticipantOut.model_validate(p) for p in participants],
        progress=await _compute_progress(session, run),
        problem_count=problem_count or 0,
        summary=run.summary,
    )


async def _count_comments(session: AsyncSession, run_id: int) -> list[RunCommentCountOut]:
    rows = (
        await session.execute(
            select(RunComment.scope_path, RunComment.node_id, func.count())
            .where(RunComment.run_id == run_id)
            .group_by(RunComment.scope_path, RunComment.node_id)
            .order_by(RunComment.scope_path, RunComment.node_id)
        )
    ).all()
    return [RunCommentCountOut(scope_path=path, node_id=node_id, count=count) for path, node_id, count in rows]


def _is_actor(run: Run, participant_logins: set[str], user: str) -> bool:
    """상태를 바꿀 수 있는 사람 — 열린 실행에서 공유는 참여자, 개인은 시작한 사람 (design §4.4)."""
    if run.status != "open":
        return False
    return user in participant_logins if run.scope == "shared" else run.starter == user


async def _can_keep(session: AsyncSession, run: Run, user: str) -> bool:
    if run.starter == user:
        return True
    # 공유 실행은 맵 오너도 보존 표시를 켜고 끌 수 있다 (design §4.4)
    return run.scope == "shared" and await get_effective_role(session, user, run.map_id) == "owner"


async def build_run_detail(session: AsyncSession, run: Run, user: str) -> RunDetailOut:
    row = await build_run_row(session, run, user)
    states = (
        await session.scalars(select(RunNodeState).where(RunNodeState.run_id == run.id).order_by(RunNodeState.id))
    ).all()
    scopes = (await session.scalars(select(RunScope).where(RunScope.run_id == run.id).order_by(RunScope.id))).all()
    return RunDetailOut(
        **row.model_dump(),
        states=[RunNodeStateOut.model_validate(s) for s in states],
        scopes=[RunScopeOut.model_validate(s) for s in scopes],
        comment_counts=await _count_comments(session, run.id),
        can_act=_is_actor(run, {p.login_id for p in row.participants}, user),
        can_manage=run.starter == user,
        can_keep=await _can_keep(session, run, user),
    )


async def list_runs(
    session: AsyncSession,
    map_id: int,
    user: str,
    *,
    tab: RunTab,
    q: str,
    mine: bool,
    kept: bool,
    page: int,
) -> RunListOut:
    """맵의 실행 한 쪽 — 개인 실행은 시작한 사람에게만 보이고 정렬은 최근 활동순이다."""
    conditions = [
        Run.map_id == map_id,
        Run.status.in_(_TAB_STATUSES[tab]),
        or_(Run.scope == "shared", Run.starter == user),
    ]
    needle = q.strip().lower()
    if needle:
        conditions.append(func.lower(Run.name).contains(needle, autoescape=True))
    if mine:
        conditions.append(Run.id.in_(select(RunParticipant.run_id).where(RunParticipant.login_id == user)))
    if kept:
        conditions.append(Run.keep.is_(True))
    total = await session.scalar(select(func.count()).select_from(Run).where(*conditions))
    runs = (
        await session.scalars(
            select(Run)
            .where(*conditions)
            .order_by(Run.last_activity_at.desc(), Run.id.desc())
            .offset((page - 1) * RUN_LIST_PAGE_SIZE)
            .limit(RUN_LIST_PAGE_SIZE)
        )
    ).all()
    return RunListOut(
        items=[await build_run_row(session, run, user) for run in runs],
        total=total or 0,
        page=page,
        page_size=RUN_LIST_PAGE_SIZE,
    )


async def _assert_version_runnable(session: AsyncSession, map_id: int, version_id: int) -> None:
    version = await session.get(MapVersion, version_id)
    if version is None or version.map_id != map_id or version.status not in _RUNNABLE_VERSION_STATUSES:
        raise HTTPException(status_code=422, detail=ERR_NEEDS_PUBLISHED)


def _list_invited(user: str, body: RunCreateIn) -> list[str]:
    """공유 실행의 초대 대상 — 시작한 사람과 중복을 접는다. 개인 실행은 초대가 없다."""
    if body.scope != "shared":
        return []
    return list(dict.fromkeys(login for login in body.participants if login != user))


async def ensure_eligible_participants(session: AsyncSession, map_id: int, logins: list[str]) -> None:
    """참여자는 맵을 볼 수 있는 재직 직원이어야 한다 — 아니면 422 (design §4.4, 후보 = `get_eligible_users`).

    공개 맵은 유효 역할만 보면 아무 문자열이나 viewer라서, 직원 명단(퇴직자 제외)과 맞춰 본다.
    """
    if not logins:
        return
    eligible = {emp.login_id for emp in await get_eligible_users(session, map_id)}
    for login in logins:
        if login not in eligible:
            raise HTTPException(status_code=422, detail=ERR_PARTICIPANT_ACCESS.format(login=login))


async def _assert_open_cap(session: AsyncSession, map_id: int, user: str, scope: str) -> None:
    """열린 실행 상한 — 개인은 시작한 사람 기준 맵 합산, 공유는 맵 기준. 휴지통 맵의 실행은 세지 않는다."""
    limits = await get_run_limits(session)
    open_runs = (
        select(func.count())
        .select_from(Run)
        .join(ProcessMap, ProcessMap.id == Run.map_id)
        .where(Run.status == "open", Run.scope == scope, ProcessMap.deleted_at.is_(None))
    )
    if scope == "solo":
        if await session.scalar(open_runs.where(Run.starter == user)) >= limits.open_solo_cap:
            raise HTTPException(status_code=409, detail=ERR_SOLO_CAP)
    elif await session.scalar(open_runs.where(Run.map_id == map_id)) >= limits.open_shared_cap:
        raise HTTPException(status_code=409, detail=ERR_SHARED_CAP)


async def create_run(session: AsyncSession, map_id: int, user: str, body: RunCreateIn) -> Run:
    found_map = await load_live_map(session, map_id)
    if found_map.mode == "framework":
        raise HTTPException(status_code=422, detail=ERR_FRAMEWORK)
    await _assert_version_runnable(session, map_id, body.version_id)
    invited = _list_invited(user, body)
    await ensure_eligible_participants(session, map_id, invited)  # 무거운 명단 조회는 잠금 전에 끝낸다
    # 맵 행 잠금(postgres) — 같은 맵에서 동시에 만들어도 상한 검사를 한 건씩 지나게 한다
    await load_live_map(session, map_id, lock=True)
    await _assert_open_cap(session, map_id, user, body.scope)
    run = Run(map_id=map_id, version_id=body.version_id, name=body.name, scope=body.scope, starter=user)
    session.add(run)
    await session.flush()
    # 초대 알림은 Task 6이 이 지점에 붙는다
    session.add_all(RunParticipant(run_id=run.id, login_id=login) for login in [user, *invited])
    await session.commit()
    await session.refresh(run)
    return run


# ── 노드 동작 (design §4.2) ──

# 전이표 — 동작마다 허용하는 지금 상태. 판단 노드의 갈래 선택·하위프로세스 출구는 complete에 실린다
_ALLOWED_FROM: dict[str, tuple[str, ...]] = {
    "start": ("ready",),
    "complete": ("ready", "active", "problem"),
    "problem": ("ready", "active"),
    "resolve": ("problem",),
    "unstart": ("active",),
    "undo": ("done",),
}
_SET_STATUS = {"start": "active", "problem": "problem", "resolve": "active"}
# 하위 범위에서 이 동작을 하면 아직 진행 가능인 바깥 호스트가 진행 중이 된다
_ENTERING_ACTIONS = ("start", "complete", "problem")


@dataclass
class ActionOutcome:
    """동작 결과 — 알림(Task 6)이 읽는다. loop는 역행 갈래로 되감은 것이라 단계 완료로 세지 않는다."""

    kind: Literal["changed", "loop"]
    node_title: str
    finished: bool


@dataclass
class _ActionContext:
    session: AsyncSession
    run: Run
    user: str
    now: datetime
    graphs: dict[str, RunGraph]  # 범위 경로 → 그래프, 최상위부터 동작한 범위까지


def _join_scope(scope_path: str, node_id: str) -> str:
    """하위프로세스 노드가 여는 하위 범위 경로 — 최상위 노드는 id 그대로, 그 아래는 `/`로 잇는다."""
    return f"{scope_path}/{node_id}" if scope_path else node_id


def _split_scope(scope_path: str) -> tuple[str, str]:
    """하위 범위 경로 → (바깥 범위 경로, 호스트 노드 id)."""
    parent_path, _, host_id = scope_path.rpartition("/")
    return parent_path, host_id


def _is_under_scope(column: InstrumentedAttribute[str], scope_path: str) -> ColumnElement[bool]:
    """그 범위와 그 아래 모든 범위 — 노드 id에 LIKE 와일드카드(`_`)가 섞여도 글자 그대로 비교한다."""
    return or_(column == scope_path, column.startswith(f"{scope_path}/", autoescape=True))


async def _load_scope_row(session: AsyncSession, run_id: int, scope_path: str) -> RunScope | None:
    return await session.scalar(select(RunScope).where(RunScope.run_id == run_id, RunScope.scope_path == scope_path))


async def _assert_sub_runnable(session: AsyncSession, user: str, version_id: int) -> None:
    """하위 범위로 밟을 수 있는 버전 — 사용자가 볼 수 있고, 게시본·지난 게시본이며, 임베드 가능한 하위 맵의 것.

    Draft는 편집으로 노드 id가 바뀌어 기록이 엉키고, 휴지통·미지정 맵은 라이브러리 임베드와 같이 막는다.
    """
    version = await session.get(MapVersion, version_id)
    if role_rank(await get_effective_role(session, user, version.map_id)) < role_rank("viewer"):
        raise HTTPException(status_code=403, detail=ERR_SUB_ACCESS)
    if version.status not in _RUNNABLE_VERSION_STATUSES:
        raise HTTPException(status_code=422, detail=ERR_SUB_NOT_PUBLISHED)
    if not is_embeddable_subprocess_map(await session.get(ProcessMap, version.map_id)):
        raise HTTPException(status_code=422, detail=ERR_SUB_UNAVAILABLE)


async def _resolve_child_version(
    session: AsyncSession, run: Run, scope_path: str, parent_version_id: int, user: str, *, pin: bool
) -> int:
    """하위 범위의 버전 — 고정본이 있으면 그것, 없으면 호스트 링크를 에디터 임베드처럼 해석하고 pin이면 고정한다."""
    pinned = await _load_scope_row(session, run.id, scope_path)
    if pinned is not None:
        await _assert_sub_runnable(session, user, pinned.version_id)
        return pinned.version_id
    host = await session.get(Node, _split_scope(scope_path)[1])
    if (
        host is None
        or host.version_id != parent_version_id
        or host.node_type != "subprocess"
        or host.linked_map_id is None
    ):
        raise HTTPException(status_code=422, detail=ERR_NOT_ACTIONABLE)
    # 고정(follow_latest 끔)이 아니면 최신 게시본, 게시본이 없으면 Draft까지 내려간다 — 아래 검사가 Draft를 막는다
    version_id = await resolve_linked_version(session, host.linked_map_id, host.follow_latest, host.linked_version_id)
    if version_id is None:  # 링크 맵이 영구 삭제됐거나 고정 버전이 그 맵 것이 아니다
        raise HTTPException(status_code=422, detail=ERR_SUB_UNAVAILABLE)
    await _assert_sub_runnable(session, user, version_id)
    if pin:
        session.add(RunScope(run_id=run.id, scope_path=scope_path, version_id=version_id))
        await session.flush()
    return version_id


async def _resolve_scope_chain(
    session: AsyncSession, run: Run, scope_path: str, user: str, *, pin: bool
) -> list[tuple[str, int]]:
    """최상위부터 scope_path까지 (범위 경로, 버전 id) — 단계마다 호스트 링크와 하위 맵 열람 권한을 확인한다."""
    segments = scope_path.split("/") if scope_path else []
    if len(segments) > MAX_SCOPE_DEPTH:
        raise HTTPException(status_code=422, detail=ERR_TOO_DEEP)
    chain = [("", run.version_id)]
    for depth in range(1, len(segments) + 1):
        path = "/".join(segments[:depth])
        chain.append((path, await _resolve_child_version(session, run, path, chain[-1][1], user, pin=pin)))
    return chain


async def resolve_scope_version(session: AsyncSession, run: Run, scope_path: str, user: str) -> int:
    """보기용 범위 버전 — 고정본이 있으면 그것, 없으면 해석만 하고 고정하지 않는다."""
    return (await _resolve_scope_chain(session, run, scope_path, user, pin=False))[-1][1]


async def get_scope_graph(session: AsyncSession, run: Run, scope_path: str, user: str, *, pin: bool) -> RunGraph:
    """범위의 그래프 — 최상위는 실행 버전, 하위는 고정본 또는 호스트 링크 해석(pin이면 그때 고정)."""
    chain = await _resolve_scope_chain(session, run, scope_path, user, pin=pin)
    return await load_version_graph(session, chain[-1][1])


async def _derive_scope(ctx: _ActionContext, scope_path: str) -> tuple[RunScopeState, dict[str, str]]:
    state = await load_scope_state(ctx.session, ctx.run.id, scope_path)
    return state, derive_run_statuses(ctx.graphs[scope_path], state)


def _find_actionable(graph: RunGraph, node_id: str) -> RunGraphNode:
    node = next((n for n in graph.nodes if n.id == node_id), None)
    if node is None or node.node_type not in ACTIONABLE_TYPES:  # start·end는 흐름이 지나가며 계산된다
        raise HTTPException(status_code=422, detail=ERR_NOT_ACTIONABLE)
    return node


async def _assert_hosts_reachable(ctx: _ActionContext, scope_paths: list[str], pinned_before: set[str]) -> None:
    """하위 범위는 호스트에 닿은 뒤에만 밟는다 — 대기·건너뜀 호스트, 들어가지 않고 바로 완료한 호스트는 409.

    막지 않으면 앞 단계가 남은 호스트가 하위 범위 완료로 자동 완료된다. 바로 완료한 호스트의 하위 맵은
    남은 단계가 건너뜀이라(design §4.2) 나중에 처음 들어가 밟을 수 없다.
    """
    for path in scope_paths:
        parent_path, host_id = _split_scope(path)
        host_status = (await _derive_scope(ctx, parent_path))[1][host_id]
        if host_status in ("waiting", "skipped") or (host_status == "done" and path not in pinned_before):
            raise HTTPException(status_code=409, detail=ERR_BAD_STATE)


async def _load_state_row(session: AsyncSession, run_id: int, scope_path: str, node_id: str) -> RunNodeState | None:
    return await session.scalar(
        select(RunNodeState).where(
            RunNodeState.run_id == run_id, RunNodeState.scope_path == scope_path, RunNodeState.node_id == node_id
        )
    )


async def _write_state(
    ctx: _ActionContext,
    scope_path: str,
    node: RunGraphNode,
    status: str,
    *,
    chosen_edge_id: str | None = None,
    exit_key: str | None = None,
) -> None:
    """수동 상태 한 행을 덮어쓴다 — 선택·출구는 완료일 때만 실리고, 다른 상태로 바뀌면 지워진다."""
    row = await _load_state_row(ctx.session, ctx.run.id, scope_path, node.id)
    if row is None:
        row = RunNodeState(run_id=ctx.run.id, scope_path=scope_path, node_id=node.id)
        ctx.session.add(row)
    row.node_title = node.title
    row.status = status
    row.chosen_edge_id = chosen_edge_id
    row.exit_key = exit_key
    row.updated_by = ctx.user
    row.updated_at = ctx.now


async def _delete_state(ctx: _ActionContext, scope_path: str, node_id: str) -> None:
    row = await _load_state_row(ctx.session, ctx.run.id, scope_path, node_id)
    if row is not None:
        await ctx.session.delete(row)


def _record(ctx: _ActionContext, action: str, scope_path: str, node: RunGraphNode) -> None:
    ctx.session.add(
        RunEvent(
            run_id=ctx.run.id,
            actor=ctx.user,
            action=action,
            scope_path=scope_path,
            node_id=node.id,
            node_title=node.title,
            created_at=ctx.now,
        )
    )


async def _has_child_progress(session: AsyncSession, run_id: int, child_path: str) -> bool:
    found = await session.scalar(
        select(RunNodeState.id)
        .where(RunNodeState.run_id == run_id, _is_under_scope(RunNodeState.scope_path, child_path))
        .limit(1)
    )
    return found is not None


async def _clear_child_scopes(session: AsyncSession, run_id: int, child_path: str, *, drop_pins: bool) -> None:
    """하위 범위(그 아래 포함)의 상태 행을 지운다 — drop_pins면 고정 버전도 지우고, 아니면 닫힘만 푼다. 코멘트는 남긴다."""
    rows = await session.scalars(
        select(RunNodeState).where(RunNodeState.run_id == run_id, _is_under_scope(RunNodeState.scope_path, child_path))
    )
    for row in rows.all():
        await session.delete(row)
    scopes = await session.scalars(
        select(RunScope).where(RunScope.run_id == run_id, _is_under_scope(RunScope.scope_path, child_path))
    )
    for scope in scopes.all():
        if drop_pins:
            await session.delete(scope)
        else:
            scope.closed = False


async def _close_unfinished_child(session: AsyncSession, run_id: int, child_path: str) -> None:
    """하위프로세스를 바로 완료하면 덜 밟은 하위 범위를 닫는다 — 남은 단계는 건너뜀이 된다."""
    scope = await _load_scope_row(session, run_id, child_path)
    if scope is None or scope.closed:
        return
    child_graph = await load_version_graph(session, scope.version_id)
    if not is_run_scope_finished(derive_run_statuses(child_graph, await load_scope_state(session, run_id, child_path))):
        scope.closed = True


async def _rewind_loop(ctx: _ActionContext, scope_path: str, back_edge_id: str) -> None:
    """역행 갈래 — 고리 안 단계의 기록과 그 단계가 연 하위 범위(고정 버전 포함)를 지워 다시 밟게 한다."""
    for node_id in find_loop_body(ctx.graphs[scope_path], back_edge_id):
        await _delete_state(ctx, scope_path, node_id)
        await _clear_child_scopes(ctx.session, ctx.run.id, _join_scope(scope_path, node_id), drop_pins=True)


async def _complete(ctx: _ActionContext, body: RunActionIn, node: RunGraphNode) -> Literal["changed", "loop"]:
    graph = ctx.graphs[body.scope_path]
    options = get_branch_options(graph, node.id)
    chosen_edge_id = exit_key = None
    if options.kind == "edge":
        if body.edge_id not in options.edge_ids:
            raise HTTPException(status_code=422, detail=ERR_CHOOSE_BRANCH)
        if body.edge_id in find_run_back_edge_ids(graph):
            await _rewind_loop(ctx, body.scope_path, body.edge_id)
            _record(ctx, "loop", body.scope_path, node)
            return "loop"
        chosen_edge_id = body.edge_id
    elif options.kind == "exit":
        if body.exit_key not in options.exit_keys:
            raise HTTPException(status_code=422, detail=ERR_CHOOSE_EXIT)
        exit_key = body.exit_key
    if node.node_type == "subprocess":
        await _close_unfinished_child(ctx.session, ctx.run.id, _join_scope(body.scope_path, node.id))
    await _write_state(ctx, body.scope_path, node, "done", chosen_edge_id=chosen_edge_id, exit_key=exit_key)
    _record(ctx, "complete", body.scope_path, node)
    return "changed"


async def _assert_outer_untouched(ctx: _ActionContext, scope_path: str) -> None:
    """하위 맵 안의 완료 취소는 완료된 바깥 호스트의 뒤 단계를 누가 손댔으면 막는다 — 완료된 호스트를 따라 루트까지."""
    path = scope_path
    while path:
        parent_path, host_id = _split_scope(path)
        parent_state, parent_statuses = await _derive_scope(ctx, parent_path)
        if parent_statuses[host_id] != "done":
            return
        blocker = find_touched_after(ctx.graphs[parent_path], parent_state, host_id)
        if blocker is not None:
            raise HTTPException(status_code=409, detail=ERR_TOUCHED_AFTER.format(title=blocker))
        path = parent_path


async def _clear_node(ctx: _ActionContext, body: RunActionIn, node: RunGraphNode, state: RunScopeState) -> None:
    """시작 취소·완료 취소 — 수동 상태와 선택을 지운다. 하위 기록이 있는 하위프로세스는 cascade여야 함께 지운다."""
    if body.action == "undo":
        blocker = find_touched_after(ctx.graphs[body.scope_path], state, node.id)
        if blocker is not None:
            raise HTTPException(status_code=409, detail=ERR_TOUCHED_AFTER.format(title=blocker))
        await _assert_outer_untouched(ctx, body.scope_path)
    if node.node_type == "subprocess":
        child_path = _join_scope(body.scope_path, node.id)
        if not body.cascade and await _has_child_progress(ctx.session, ctx.run.id, child_path):
            raise HTTPException(status_code=409, detail=ERR_SUB_PROGRESS)
        # 고정 버전은 그대로 두어 다시 들어가도 같은 하위 맵을 밟는다 (사용자 결정 2026-11-04)
        await _clear_child_scopes(ctx.session, ctx.run.id, child_path, drop_pins=False)
    await _delete_state(ctx, body.scope_path, node.id)
    _record(ctx, body.action, body.scope_path, node)


async def _sync_hosts(ctx: _ActionContext, scope_path: str, action: str) -> None:
    """하위 범위에서 바꾼 뒤 바깥 호스트를 맞춘다 — 루트까지 한 단계씩.

    들어가면 진행 중, 하위 범위가 끝나면 완료(닿은 끝이 출구), 다시 안 끝난 상태가 되면 진행 중으로 되돌린다.
    닫힌 하위 범위(호스트를 바로 완료)는 끝난 것으로 치지 않아 호스트를 움직이지 않는다.
    """
    path = scope_path
    while path:
        parent_path, host_id = _split_scope(path)
        host = ctx.graphs[parent_path].node(host_id)
        host_status = (await _derive_scope(ctx, parent_path))[1][host_id]
        child_state, child_statuses = await _derive_scope(ctx, path)
        child_finished = not child_state.closed and is_run_scope_finished(child_statuses)
        if action in _ENTERING_ACTIONS and host_status == "ready":
            await _write_state(ctx, parent_path, host, "active")
            _record(ctx, "start", parent_path, host)
            host_status = "active"
        options = get_branch_options(ctx.graphs[parent_path], host_id)
        if child_finished and host_status != "done" and options.kind != "edge":
            # 택일 갈래(레거시 갈라짐)는 사람이 고를 때까지 진행 중으로 둔다
            exit_key = get_reached_end_key(ctx.graphs[path], child_statuses) if options.kind == "exit" else None
            await _write_state(ctx, parent_path, host, "done", exit_key=exit_key)
            _record(ctx, "complete", parent_path, host)
        elif not child_finished and host_status == "done" and not child_state.closed:
            await _write_state(ctx, parent_path, host, "active")
            _record(ctx, "undo", parent_path, host)
        path = parent_path


async def _finish_if_done(ctx: _ActionContext) -> bool:
    """최상위 범위가 모두 완료·건너뜀이면 실행이 끝난다 — 보존 표시가 없으면 그날부터 요약까지 센다 (design §4.6)."""
    if not is_run_scope_finished((await _derive_scope(ctx, ""))[1]):
        return False
    run = ctx.run
    run.status = "done"
    run.end_reason = "completed"
    run.ended_at = ctx.now
    run.summarize_after = (
        None if run.keep else ctx.now + timedelta(days=(await get_run_limits(ctx.session)).summary_days)
    )
    return True


async def apply_run_action(session: AsyncSession, run: Run, user: str, body: RunActionIn) -> ActionOutcome:
    """노드 동작 하나를 서버가 다시 판정해 적용하고 커밋한다 — 호출자는 실행 행을 잠근 채 부른다(공유 실행 동시 변경)."""
    if run.status != "open":
        raise HTTPException(status_code=409, detail=ERR_NOT_OPEN)
    logins = await session.scalars(select(RunParticipant.login_id).where(RunParticipant.run_id == run.id))
    if not _is_actor(run, set(logins.all()), user):
        raise HTTPException(status_code=403, detail=ERR_PARTICIPANT_ONLY)
    pinned_before = set((await session.scalars(select(RunScope.scope_path).where(RunScope.run_id == run.id))).all())
    # 하위 범위는 처음 건드릴 때 버전을 고정한다 — 거절되면 커밋하지 않으므로 고정도 남지 않는다
    chain = await _resolve_scope_chain(session, run, body.scope_path, user, pin=True)
    graphs = {path: await load_version_graph(session, version_id) for path, version_id in chain}
    ctx = _ActionContext(session=session, run=run, user=user, now=clock.now(), graphs=graphs)
    node = _find_actionable(graphs[body.scope_path], body.node_id)
    await _assert_hosts_reachable(ctx, [path for path, _ in chain[1:]], pinned_before)
    state, statuses = await _derive_scope(ctx, body.scope_path)
    if statuses[node.id] not in _ALLOWED_FROM[body.action]:
        raise HTTPException(status_code=409, detail=ERR_BAD_STATE)

    kind: Literal["changed", "loop"] = "changed"
    if body.action == "complete":
        kind = await _complete(ctx, body, node)
    elif body.action in ("unstart", "undo"):
        await _clear_node(ctx, body, node, state)
    else:
        await _write_state(ctx, body.scope_path, node, _SET_STATUS[body.action])
        _record(ctx, body.action, body.scope_path, node)
    await _sync_hosts(ctx, body.scope_path, body.action)
    finished = await _finish_if_done(ctx)
    run.last_activity_at = ctx.now
    run.idle_warned_at = None
    await session.commit()
    return ActionOutcome(kind=kind, node_title=node.title, finished=finished)
