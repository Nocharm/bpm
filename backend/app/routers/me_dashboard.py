"""홈 개인 대시보드 집계 API — 호출자 기준 활동 카운터·점유·요청·최근 이벤트·체계 요약 1회 응답.

각 블록은 기존 목록 API와 같은 집합을 센다(승인 큐=inbox, 접근 맵=list_maps의 load_my_roles,
체계 seed=/me의 get_admin_scope) — 숫자가 화면마다 어긋나지 않도록 계산을 재사용한다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import get_run_limits
from app.auth import get_current_user
from app.clock import KST
from app.clock import now as now_kst
from app.db import get_session
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    Employee,
    Feedback,
    LoginRecord,
    MapVersion,
    Notification,
    ProcessCategory,
    ProcessMap,
    Run,
    RunNodeState,
    RunParticipant,
    VersionEvent,
)
from app.framework_slots import load_pending_slot_sides
from app.permissions.access import get_admin_scope, load_my_roles
from app.permissions.logic import role_rank
from app.routers.inbox import list_inbox_approvals
from app.run_access import get_visible_scope_paths, is_scope_visible
from app.run_graph import (
    RunGraph,
    RunScopeState,
    count_run_progress,
    derive_run_statuses,
    get_run_topo_order,
)
from app.run_service import build_scope_state, load_version_graph
from app.subprocess import live_linkage_map_id
from app.schemas import (
    MeDashboardActivityOut,
    MeDashboardCategoryOut,
    MeDashboardCheckoutOut,
    MeDashboardEventOut,
    MeDashboardOut,
    MeDashboardRequestOut,
    MeDashboardRunOut,
)

router = APIRouter(prefix="/api/me", tags=["me"], dependencies=[Depends(get_current_user)])

_CHECKOUT_LIMIT = 10
_REQUEST_LIMIT = 10
_EVENT_LIMIT = 20
_RUN_LIMIT = 30  # 홈 실행 줄 상한 — 숫자(runs_open 등)는 상한과 무관하게 전부 센다
# 내 드래프트 잡음(created/submitted/withdrawn)은 숨기고, 결과가 확정된 이벤트만 본인 것도 노출
_OWN_EVENTS_KEPT = ("published", "confirmed", "rejected", "approved")
_EDITING_ROLES = ("owner", "editor")


@router.get("/dashboard", response_model=MeDashboardOut)
async def get_me_dashboard(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeDashboardOut:
    checkouts = await _load_checkouts(session, user)
    requests = await _load_requests(session, user)
    runs = await _load_runs(session, user)
    activity = MeDashboardActivityOut(
        approvals_pending=len(await list_inbox_approvals(user=user, session=session)),
        requests_pending=len(requests),
        checkouts_held=await session.scalar(
            select(func.count())
            .select_from(MapVersion)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(MapVersion.checked_out_by == user, ProcessMap.deleted_at.is_(None))
        )
        or 0,
        unread_notifications=await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient == user, Notification.read.is_(False))
        )
        or 0,
        feedback_mine=await session.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.author == user)
        )
        or 0,
        feedback_mine_open=await session.scalar(
            select(func.count())
            .select_from(Feedback)
            .where(Feedback.author == user, Feedback.status != "done")
        )
        or 0,
        last_login_at=await _load_previous_login(session, user),
        runs_open=len(runs),
        runs_problem=sum(1 for r in runs if r.state_kind == "problem"),
        runs_idle=sum(1 for r in runs if r.state_kind == "idle"),
    )
    return MeDashboardOut(
        activity=activity,
        checkouts=checkouts[:_CHECKOUT_LIMIT],
        requests=requests[:_REQUEST_LIMIT],
        recent_events=await _load_recent_events(session, user),
        framework=await _load_framework(session, user),
        runs=runs[:_RUN_LIMIT],
    )


def _as_kst(stamp: datetime) -> datetime:
    """sqlite는 시각의 시간대를 떼고 KST 벽시계로 돌려주고 postgres는 접속 시간대로 돌려준다 — 날짜 계산 전에 KST로 맞춘다."""
    return stamp.astimezone(KST) if stamp.tzinfo else stamp.replace(tzinfo=KST)


async def _load_previous_login(session: AsyncSession, user: str) -> datetime | None:
    """오늘(KST 자정) 이전의 마지막 접속 — /me가 하루 1건 기록하므로 '직전 접속일'과 같다."""
    day_start = now_kst().replace(hour=0, minute=0, second=0, microsecond=0)
    return await session.scalar(
        select(func.max(LoginRecord.occurred_at)).where(
            LoginRecord.login_id == user, LoginRecord.occurred_at < day_start
        )
    )


async def _load_checkouts(session: AsyncSession, user: str) -> list[MeDashboardCheckoutOut]:
    rows = (
        await session.execute(
            select(MapVersion, ProcessMap)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(MapVersion.checked_out_by == user, ProcessMap.deleted_at.is_(None))
            .order_by(MapVersion.checked_out_at.desc(), MapVersion.id.desc())
        )
    ).all()
    version_ids = [ver.id for ver, _ in rows]
    waiting: dict[int, int] = {}
    if version_ids:
        waiting = {
            vid: cnt
            for vid, cnt in (
                await session.execute(
                    select(CheckoutRequest.version_id, func.count())
                    .where(
                        CheckoutRequest.version_id.in_(version_ids),
                        CheckoutRequest.status == "pending",
                    )
                    .group_by(CheckoutRequest.version_id)
                )
            ).all()
        }
    return [
        MeDashboardCheckoutOut(
            map_id=pm.id,
            map_name=pm.name,
            visibility=pm.visibility,
            version_id=ver.id,
            version_label=ver.label,
            version_number=ver.version_number,
            checked_out_at=ver.checked_out_at,
            waiting_requests=waiting.get(ver.id, 0),
        )
        for ver, pm in rows
    ]


@dataclass(frozen=True)
class _VersionView:
    """게시본 하나의 그래프와 파생값 — 같은 버전의 실행이 여럿이어도 한 번만 읽고 계산한다."""

    graph: RunGraph
    topo_rank: dict[str, int]
    titles: dict[str, str]


async def _get_version_view(session: AsyncSession, cache: dict[int, _VersionView], version_id: int) -> _VersionView:
    if version_id not in cache:
        graph = await load_version_graph(session, version_id)
        cache[version_id] = _VersionView(
            graph=graph,
            topo_rank={node_id: i for i, node_id in enumerate(get_run_topo_order(graph))},
            titles={n.id: n.title for n in graph.nodes},
        )
    return cache[version_id]


def _sort_problem_rows(rows: list[RunNodeState], topo_rank: dict[str, int]) -> list[RunNodeState]:
    """바깥 맵은 위상 순서, 하위 범위는 그 뒤에 바깥 범위부터 기록 순 — 하위 맵 그래프는 읽지 않는다."""
    return sorted(
        rows,
        key=lambda r: (
            r.scope_path != "",
            topo_rank.get(r.node_id, len(topo_rank)) if r.scope_path == "" else 0,
            r.scope_path,
            r.id,
        ),
    )


_RUN_KIND_ORDER = {"problem": 0, "idle": 1, "next": 2}


async def _load_runs(session: AsyncSession, user: str) -> list[MeDashboardRunOut]:
    """내가 참여한 열린 실행 전부를 급한 순(문제 → 방치 → 다음, 같은 묶음은 최근 손댄 순)으로 — 상한은 호출자가 자른다.

    `run_service.build_run_row`는 실행마다 질의가 여럿이라 쓰지 않고, 참여자 수·상태 행은 한꺼번에 읽고 그래프는 버전당 한 번 읽는다.
    휴지통 맵과 맵을 볼 수 없게 된 실행은 줄과 숫자에서 모두 뺀다.
    """
    rows = (
        await session.execute(
            select(Run, ProcessMap)
            .join(ProcessMap, ProcessMap.id == Run.map_id)
            .join(RunParticipant, RunParticipant.run_id == Run.id)
            .where(
                RunParticipant.login_id == user,
                Run.status == "open",
                ProcessMap.deleted_at.is_(None),
                or_(Run.scope == "shared", Run.starter == user),  # 남의 개인 실행은 참여자 행이 있어도 보이지 않는다
            )
        )
    ).all()
    if not rows:
        return []
    roles = await load_my_roles(session, user, list({pm.id: pm for _, pm in rows}.values()))
    viewable = [(run, pm) for run, pm in rows if role_rank(roles.get(pm.id)) >= role_rank("viewer")]
    if not viewable:
        return []

    run_ids = [run.id for run, _ in viewable]
    participant_counts = dict(
        (
            await session.execute(
                select(RunParticipant.run_id, func.count())
                .where(RunParticipant.run_id.in_(run_ids))
                .group_by(RunParticipant.run_id)
            )
        ).all()
    )
    # 바깥 범위 상태(진행률·다음 노드)와 모든 범위의 문제 행을 한 번에 읽는다
    state_rows = (
        await session.scalars(
            select(RunNodeState)
            .where(
                RunNodeState.run_id.in_(run_ids),
                or_(RunNodeState.scope_path == "", RunNodeState.status == "problem"),
            )
            .order_by(RunNodeState.id)
        )
    ).all()
    root_rows: dict[int, list[RunNodeState]] = {}
    problem_rows: dict[int, list[RunNodeState]] = {}
    for row in state_rows:
        if row.scope_path == "":
            root_rows.setdefault(row.run_id, []).append(row)
        if row.status == "problem":
            problem_rows.setdefault(row.run_id, []).append(row)

    limits = await get_run_limits(session)
    stop_days = max(limits.idle_stop_days, limits.idle_warn_days + 1)  # 정리 잡과 같은 자동 중단 일수
    now = now_kst()
    views: dict[int, _VersionView] = {}
    out: list[MeDashboardRunOut] = []
    for run, pm in viewable:
        view = await _get_version_view(session, views, run.version_id)
        state = build_scope_state(root_rows.get(run.id, []))
        done, total = count_run_progress(view.graph, state)
        elapsed = now - _as_kst(run.last_activity_at)
        idle_days = stop_in_days = 0
        problems = _sort_problem_rows(problem_rows.get(run.id, []), view.topo_rank)
        if problems:
            kind, title, more = "problem", problems[0].node_title, len(problems) - 1
            if problems[0].scope_path != "":  # 하위 맵 노드 제목은 그 맵을 볼 수 있는 사람에게만 (R16)
                visible = await get_visible_scope_paths(session, run, user)
                if not is_scope_visible(problems[0].scope_path, visible):
                    title = ""
        elif elapsed >= timedelta(days=limits.idle_warn_days):
            kind, title, more = "idle", "", 0
            idle_days = elapsed.days
            stop_in_days = max(0, stop_days - idle_days)
        else:
            kind = "next"
            title, more = _pick_next_nodes(view, state)
        out.append(
            MeDashboardRunOut(
                run_id=run.id,
                map_id=pm.id,
                map_name=pm.name,
                version_id=run.version_id,
                name=run.name,
                scope=run.scope,
                participant_count=participant_counts.get(run.id, 0),
                state_kind=kind,
                state_title=title,
                state_more=more,
                idle_days=idle_days,
                stop_in_days=stop_in_days,
                done=done,
                total=total,
                last_activity_at=run.last_activity_at,
            )
        )
    out.sort(key=lambda r: (_RUN_KIND_ORDER[r.state_kind], -_as_kst(r.last_activity_at).timestamp(), -r.run_id))
    return out


def _pick_next_nodes(view: _VersionView, state: RunScopeState) -> tuple[str, int]:
    """바깥 맵에서 지금 손댈 수 있는(ready|active) 노드 — 위상 순서상 첫 제목과 나머지 수. 없으면 ("", 0)."""
    statuses = derive_run_statuses(view.graph, state)
    pending = sorted(
        (node_id for node_id, status in statuses.items() if status in ("ready", "active")),
        key=lambda node_id: view.topo_rank[node_id],
    )
    if not pending:
        return "", 0
    return view.titles[pending[0]], len(pending) - 1


async def _load_requests(session: AsyncSession, user: str) -> list[MeDashboardRequestOut]:
    """내가 올린 pending 요청 — 승인 요청(kind별) + 점유권 이전 요청, 최신순. 소프트삭제 맵은 제외."""
    items: list[MeDashboardRequestOut] = []
    ar_rows = (
        await session.execute(
            select(ApprovalRequest, ProcessMap)
            .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
            .where(
                ApprovalRequest.requested_by == user,
                ApprovalRequest.status == "pending",
                ProcessMap.deleted_at.is_(None),
            )
        )
    ).all()
    for req, pm in ar_rows:
        items.append(
            MeDashboardRequestOut(
                kind=req.kind, id=req.id, map_id=pm.id, map_name=pm.name,
                status=req.status, created_at=req.created_at,
            )
        )
    co_rows = (
        await session.execute(
            select(CheckoutRequest, ProcessMap)
            .join(MapVersion, MapVersion.id == CheckoutRequest.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(
                CheckoutRequest.requested_by == user,
                CheckoutRequest.status == "pending",
                ProcessMap.deleted_at.is_(None),
            )
        )
    ).all()
    for req, pm in co_rows:
        items.append(
            MeDashboardRequestOut(
                kind="checkout_transfer", id=req.id, map_id=pm.id, map_name=pm.name,
                status=req.status, created_at=req.created_at,
            )
        )
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


async def _load_recent_events(session: AsyncSession, user: str) -> list[MeDashboardEventOut]:
    """내가 owner/editor인 맵의 최근 버전 이벤트 — 역할 판정은 홈 목록과 같은 load_my_roles."""
    maps = list(
        (await session.scalars(select(ProcessMap).where(ProcessMap.deleted_at.is_(None)))).all()
    )
    roles = await load_my_roles(session, user, maps)
    map_ids = [mid for mid, role in roles.items() if role in _EDITING_ROLES]
    if not map_ids:
        return []
    rows = (
        await session.execute(
            select(VersionEvent, MapVersion, ProcessMap)
            .join(MapVersion, MapVersion.id == VersionEvent.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(
                MapVersion.map_id.in_(map_ids),
                or_(VersionEvent.actor != user, VersionEvent.event_type.in_(_OWN_EVENTS_KEPT)),
            )
            .order_by(VersionEvent.created_at.desc(), VersionEvent.id.desc())
            .limit(_EVENT_LIMIT)
        )
    ).all()
    actor_ids = {event.actor for event, _, _ in rows}
    actor_name: dict[str, str] = {}
    if actor_ids:
        actor_name = {
            lid: nm
            for lid, nm in (
                await session.execute(
                    select(Employee.login_id, Employee.name).where(Employee.login_id.in_(actor_ids))
                )
            ).all()
        }
    return [
        MeDashboardEventOut(
            event_type=event.event_type,
            map_id=pm.id,
            map_name=pm.name,
            version_id=ver.id,
            version_label=ver.label,
            version_number=ver.version_number,
            actor=event.actor,
            actor_name=actor_name.get(event.actor),
            note=event.note,
            created_at=event.created_at,
        )
        for event, ver, pm in rows
    ]


async def _load_framework(session: AsyncSession, user: str) -> list[MeDashboardCategoryOut]:
    """seed 카테고리(=/me category_admin_root_ids)별 서브트리 L5 현황 — sysadmin은 seed가 없어 빈 목록."""
    _admin_ids, seeds = await get_admin_scope(session, user)
    if not seeds:
        return []
    cat_rows = (
        await session.execute(
            select(
                ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level,
                ProcessCategory.name, live_linkage_map_id(),
            )
        )
    ).all()
    by_id = {cid: (pid, level, name, lmid) for cid, pid, level, name, lmid in cat_rows}
    children_by_parent: dict[int | None, list[int]] = {}
    for cid, pid, _level, _name, _lmid in cat_rows:
        children_by_parent.setdefault(pid, []).append(cid)

    # seed별 서브트리(자기 자신 포함) — 중첩 seed는 각자 따로 센다. seen 가드는 get_admin_scope와 동일(순환 방어)
    subtree_by_root: dict[int, list[int]] = {}
    for root in sorted(seeds):
        seen = {root}
        frontier = [c for c in children_by_parent.get(root, []) if c not in seen]
        while frontier:
            seen.update(frontier)
            frontier = [c for f in frontier for c in children_by_parent.get(f, []) if c not in seen]
        subtree_by_root[root] = sorted(seen)

    all_ids = {cid for ids in subtree_by_root.values() for cid in ids}
    linkage_ids = {by_id[cid][3] for cid in all_ids if by_id[cid][3] is not None}
    confirmed_map_ids: set[int] = set()
    if linkage_ids:
        confirmed_map_ids = set(
            (
                await session.scalars(
                    select(MapVersion.map_id)
                    .where(MapVersion.map_id.in_(linkage_ids), MapVersion.status == workflow.CONFIRMED)
                    .distinct()
                )
            ).all()
        )
    pending_slot_sides = await load_pending_slot_sides(session)

    out: list[MeDashboardCategoryOut] = []
    for root, ids in subtree_by_root.items():
        _pid, level, name, lmid = by_id[root]
        l5_ids = [cid for cid in ids if by_id[cid][1] == 5]
        unconfirmed = sum(
            1 for cid in l5_ids
            if by_id[cid][3] is not None and by_id[cid][3] not in confirmed_map_ids
        )
        out.append(
            MeDashboardCategoryOut(
                category_id=root,
                name=name,
                level=level,
                linkage_map_id=lmid,
                l5_count=len(l5_ids),
                unconfirmed_count=unconfirmed,
                # 결정할 side가 이 서브트리에 있는 요청 수 — 인박스와 같은 단위(요청 1건 = 1)
                slot_pending_count=sum(1 for sides in pending_slot_sides if any(c in ids for c in sides)),
            )
        )
    return out
