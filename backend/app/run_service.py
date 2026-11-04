"""실행 체크(Run) 서비스 — 보기 규칙·읽기 모델·시작 검증. 라우터(`routers/runs.py`)가 얇게 부른다.

설계: docs/superpowers/specs/2026-11-04-run-check-design.md §4.1(시작·상한)·§4.4(개인·공유와 권한).
노드 동작·코멘트·중단은 같은 파일에 이어서 붙는다(Task 4 이후).
"""

from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import get_run_limits
from app.models import (
    Edge,
    MapVersion,
    Node,
    ProcessMap,
    Run,
    RunComment,
    RunNodeState,
    RunParticipant,
    RunScope,
)
from app.permissions.access import get_effective_role
from app.permissions.logic import role_rank
from app.run_graph import RunGraph, RunScopeState, count_run_progress
from app.schemas import (
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

ERR_NOT_OPEN = "run is not open"
ERR_STARTER_ONLY = "only the starter can do this"
ERR_PARTICIPANT_ONLY = "only participants can change this run"
ERR_NEEDS_PUBLISHED = "run needs a published version"
ERR_FRAMEWORK = "framework maps cannot run"
ERR_SOLO_CAP = "open solo run limit reached"
ERR_SHARED_CAP = "open shared run limit reached"
ERR_KEEP_CAP = "keep limit reached"
ERR_PARTICIPANT_ACCESS = "participant {login} cannot view this map"

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
    logins = {p.login_id for p in row.participants}
    can_act = run.status == "open" and (user in logins if run.scope == "shared" else run.starter == user)
    return RunDetailOut(
        **row.model_dump(),
        states=[RunNodeStateOut.model_validate(s) for s in states],
        scopes=[RunScopeOut.model_validate(s) for s in scopes],
        comment_counts=await _count_comments(session, run.id),
        can_act=can_act,
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


async def _resolve_participants(session: AsyncSession, map_id: int, user: str, body: RunCreateIn) -> list[str]:
    """공유 실행의 초대 대상 — 시작한 사람과 중복을 접고, 맵을 볼 수 없는 사람이 있으면 422."""
    if body.scope != "shared":
        return []
    logins = list(dict.fromkeys(login for login in body.participants if login != user))
    for login in logins:
        if role_rank(await get_effective_role(session, login, map_id)) < role_rank("viewer"):
            raise HTTPException(status_code=422, detail=ERR_PARTICIPANT_ACCESS.format(login=login))
    return logins


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
    # 맵 행 잠금(postgres) — 같은 맵에서 동시에 만들어도 상한 검사를 한 건씩 지나게 한다
    found_map = await load_live_map(session, map_id, lock=True)
    if found_map.mode == "framework":
        raise HTTPException(status_code=422, detail=ERR_FRAMEWORK)
    await _assert_version_runnable(session, map_id, body.version_id)
    invited = await _resolve_participants(session, map_id, user, body)
    await _assert_open_cap(session, map_id, user, body.scope)
    run = Run(map_id=map_id, version_id=body.version_id, name=body.name, scope=body.scope, starter=user)
    session.add(run)
    await session.flush()
    # 초대 알림은 Task 6이 이 지점에 붙는다
    session.add_all(RunParticipant(run_id=run.id, login_id=login) for login in [user, *invited])
    await session.commit()
    await session.refresh(run)
    return run
