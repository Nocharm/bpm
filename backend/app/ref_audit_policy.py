"""고아 참조 줄별 평소 권한 판정 — actor 범위와 줄마다 하나의 결과(설계 2026-10-23-orphan-refs-open §4~§6).

감사 경로가 평소 화면과 같은 거버넌스 결과를 내도록(공통 규칙, sysadmin 포함) 판정은 `decide` 한 곳에 두고,
판정에 필요한 사실은 `load_actor_scope`·`load_decision_context`가 줄 수와 무관한 고정 쿼리로 한 번에 읽는다.
"""

from dataclasses import dataclass, field, replace
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import (
    ApprovalRequest,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessCategory,
    ProcessMap,
    UserGroup,
    UserGroupManager,
)
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic
from app.permissions.access import get_admin_scope, load_my_roles
from app.ref_audit import NodeTarget, RefLine, load_node_targets

Outcome = Literal["direct", "checkout", "new_draft", "approval", "notify", "locked", "pending"]
# 빨간 점·summary.actionable이 세는 결과 — actor가 지금 직접 고칠 수 있는 줄
ACTIONABLE: frozenset[str] = frozenset({"direct", "checkout", "new_draft", "approval"})

GROUP_SOURCES: frozenset[str] = frozenset({"group_member", "group_user"})
GRANT_SOURCES: frozenset[str] = frozenset({"map_grant", "map_collab"})
NODE_SOURCES: frozenset[str] = frozenset({"node_dept", "node_assignee"})
EDIT_ROLES: frozenset[str] = frozenset({"editor", "owner"})


@dataclass
class NotifyTo:
    id: str
    name: str
    role: Literal["owner", "holder"]


@dataclass
class Decision:
    outcome: Outcome
    reason: str | None = None
    notify_to: NotifyTo | None = None
    warning: str | None = None


@dataclass
class ActorScope:
    """actor가 평소에 고칠 수 있는 범위 — roles는 editor·owner인 맵만(sysadmin은 소프트삭제 맵 포함 전부 owner)."""

    login_id: str
    is_sysadmin: bool
    roles: dict[int, str]
    managed_group_ids: set[int]
    manageable_category_ids: set[int]


@dataclass
class DecisionContext:
    """줄 판정에 필요한 사실 묶음 — decide가 DB 없이 판정하도록 한 번에 로드한다."""

    maps: dict[int, ProcessMap]
    grants: dict[int, MapPermission]
    in_approval_map_ids: set[int]
    active_approvers: dict[int, list[str]]
    # (map_id, permission_id) — find_pending_downgrade와 같은 짝
    pending_downgrades: set[tuple[int, int]]
    # (map_id, login) — is_in_active_workflow 참여자(편집 가능 버전 점유자·결재 중 버전 제출자)
    workflow_pairs: set[tuple[int, str]]
    actor_pending_downgrade_map_ids: set[int]
    node_targets: dict[int, NodeTarget]
    # 판정에 나오는 사람(오너·점유자) 중 재직자의 표시명·login
    display_names: dict[str, str]
    active_logins: set[str]
    # 그룹 id → status — 멤버십 변경은 active 그룹만(groups._ensure_active)
    group_statuses: dict[int, str]
    # 고른 대체 값에 달린 사실 — to_value 없이 로드하면 비어 있다
    to_value: str | None = None
    owner_candidate_map_ids: set[int] = field(default_factory=set)
    to_value_viewable_map_ids: set[int] = field(default_factory=set)


async def load_actor_scope(session: AsyncSession, login_id: str) -> ActorScope:
    """actor 범위 — 맵 역할·관리 그룹·임명 가능 카테고리. 쿼리 수는 데이터 양과 무관하게 고정."""
    is_sysadmin = logic.is_sysadmin(login_id)
    maps = list((await session.scalars(select(ProcessMap))).all())
    if not is_sysadmin:
        # 소프트삭제 맵(오우닝 줄만 스캔됨)은 sysadmin만 다룬다 — 현행 유지
        maps = [m for m in maps if m.deleted_at is None]
    all_roles = await load_my_roles(session, login_id, maps)
    roles = {map_id: role for map_id, role in all_roles.items() if role in EDIT_ROLES}
    # deps.is_group_manager의 일괄판 — user_group_managers 행이 있으면 관리자
    managed = set((await session.scalars(
        select(UserGroupManager.group_id).where(UserGroupManager.user_id == login_id)
    )).all())
    return ActorScope(
        login_id=login_id, is_sysadmin=is_sysadmin, roles=roles, managed_group_ids=managed,
        manageable_category_ids=await _load_manageable_category_ids(session, login_id, is_sysadmin),
    )


async def _load_manageable_category_ids(session: AsyncSession, login_id: str, is_sysadmin: bool) -> set[int]:
    """categories._assert_can_manage_appointments와 같은 규칙 — 위임 서브트리 안 + level > min(seed levels)."""
    admin_ids, seeds = await get_admin_scope(session, login_id)
    if is_sysadmin:
        return admin_ids
    if not seeds:
        return set()
    floor = min(seeds.values())
    levels = dict((await session.execute(
        select(ProcessCategory.id, ProcessCategory.level).where(ProcessCategory.id.in_(admin_ids))
    )).all())
    return {cid for cid in admin_ids if levels[cid] > floor}


def is_line_visible(line: RefLine, scope: ActorScope, ctx: DecisionContext | None = None) -> bool:
    """설계 §4 — 맵 줄은 editor 이상, 그룹 줄은 그룹 관리자·sysadmin, 카테고리 줄은 임명 관리자.

    ctx를 넘기면 스캔 뒤 사라진 대상(맵·grant·노드 대상·그룹)의 줄도 뺀다 — decide는 보이는 줄만 받는다.
    """
    if ctx is not None and not _is_line_loaded(line, ctx):
        return False
    if line.source in GROUP_SOURCES:
        return scope.is_sysadmin or line.group_id in scope.managed_group_ids
    if line.source == "category_perm":
        return line.category_id in scope.manageable_category_ids
    return line.map_id in scope.roles


def _is_line_loaded(line: RefLine, ctx: DecisionContext) -> bool:
    """판정에 쓸 사실이 ctx에 있는지 — 스캔과 로드 사이에 대상이 지워졌으면 False."""
    if line.source in GROUP_SOURCES:
        return line.group_id in ctx.group_statuses
    if line.source == "category_perm":
        return True
    if line.map_id not in ctx.maps:
        return False
    if line.source in GRANT_SOURCES:
        return _parse_grant_id(line.target_id) in ctx.grants
    if line.source in NODE_SOURCES:
        return line.map_id in ctx.node_targets
    return True


def _parse_grant_id(target_id: str) -> int:
    return int(target_id.partition(":")[2])


async def load_decision_context(
    session: AsyncSession, lines: list[RefLine], scope: ActorScope, *, to_value: str | None = None
) -> DecisionContext:
    """줄들의 판정 사실을 IN 일괄 로드 — 쿼리 수는 줄 수와 무관하다.

    to_value가 있으면 그 값에 달린 사실(오너 이전 후보 여부, 노드 담당자 대상의 맵 열람권)도 함께 읽는다.
    """
    map_ids = sorted({ln.map_id for ln in lines if ln.map_id is not None})
    grant_ids = sorted({_parse_grant_id(ln.target_id) for ln in lines if ln.source in GRANT_SOURCES})

    maps = {m.id: m for m in (await session.scalars(select(ProcessMap).where(ProcessMap.id.in_(map_ids)))).all()}
    grants = {g.id: g for g in (await session.scalars(
        select(MapPermission).where(MapPermission.id.in_(grant_ids))
    )).all()}

    # has_version_in_approval·is_in_active_workflow의 일괄판 — 버전 상태 한 번으로 둘 다 낸다
    in_approval: set[int] = set()
    workflow_pairs: set[tuple[int, str]] = set()
    version_rows = (await session.execute(
        select(MapVersion.map_id, MapVersion.status, MapVersion.checked_out_by, MapVersion.submitted_by)
        .where(MapVersion.map_id.in_(map_ids))
    )).all()
    for map_id, status, holder, submitter in version_rows:
        if status in (workflow.PENDING, workflow.APPROVED):
            in_approval.add(map_id)
            if submitter:
                workflow_pairs.add((map_id, submitter))
        if holder and workflow.is_editable_status(status):
            workflow_pairs.add((map_id, holder))

    # workflow.load_active_approvers의 일괄판 — 재직(active) 직원 행이 있는 승인자만
    active_approvers: dict[int, list[str]] = {}
    for map_id, user_id in (await session.execute(
        select(MapApprover.map_id, MapApprover.user_id)
        .join(Employee, Employee.login_id == MapApprover.user_id)
        .where(MapApprover.map_id.in_(map_ids), Employee.active.is_(True))
        .order_by(MapApprover.user_id)
    )).all():
        active_approvers.setdefault(map_id, []).append(user_id)

    request_rows = (await session.scalars(select(ApprovalRequest).where(
        ApprovalRequest.map_id.in_(map_ids),
        ApprovalRequest.kind == "permission_downgrade",
        ApprovalRequest.status == "pending",
    ))).all()
    pending_downgrades = {(r.map_id, r.payload.get("permission_id")) for r in request_rows}
    # has_own_pending_downgrade의 일괄판 — actor 본인 user grant에 걸린 대기 다운그레이드
    actor_grants = (await session.execute(
        select(MapPermission.map_id, MapPermission.id).where(
            MapPermission.map_id.in_(map_ids),
            MapPermission.principal_type == "user",
            MapPermission.principal_id == scope.login_id,
        )
    )).all()
    actor_pending = {map_id for map_id, grant_id in actor_grants if (map_id, grant_id) in pending_downgrades}

    node_targets = await load_node_targets(session)
    people = {m.owner_id or m.created_by for m in maps.values()} | {
        node_targets[mid].checked_out_by for mid in map_ids if mid in node_targets
    }
    people.discard(None)
    employees = (await session.execute(
        select(Employee.login_id, Employee.name).where(Employee.login_id.in_(people), Employee.active.is_(True))
    )).all()
    group_ids = sorted({ln.group_id for ln in lines if ln.source in GROUP_SOURCES and ln.group_id is not None})
    group_statuses = dict((await session.execute(
        select(UserGroup.id, UserGroup.status).where(UserGroup.id.in_(group_ids))
    )).all())

    ctx = DecisionContext(
        maps=maps, grants=grants, in_approval_map_ids=in_approval, active_approvers=active_approvers,
        pending_downgrades=pending_downgrades, workflow_pairs=workflow_pairs,
        actor_pending_downgrade_map_ids=actor_pending, node_targets=node_targets,
        display_names={login: name or login for login, name in employees},
        active_logins={login for login, _ in employees}, group_statuses=group_statuses,
        to_value=to_value or None,
    )
    if to_value:
        # 사라진 맵의 줄은 is_line_visible(ctx=)이 걸러 낸다 — 여기선 남은 맵만 본다
        owner_maps = [maps[ln.map_id] for ln in lines if ln.source == "map_owner" and ln.map_id in maps]
        if owner_maps:
            ctx.owner_candidate_map_ids = await _load_owner_candidate_map_ids(session, to_value, owner_maps)
        assignee_maps = [maps[ln.map_id] for ln in lines if ln.source == "node_assignee" and ln.map_id in maps]
        if assignee_maps:
            ctx.to_value_viewable_map_ids = set(await load_my_roles(session, to_value, assignee_maps))
    return ctx


async def _load_owner_candidate_map_ids(session: AsyncSession, login_id: str, maps: list[ProcessMap]) -> set[int]:
    """오너 이전 후보인 맵 — transfer_owner와 같은 규칙.

    명시 user grant가 있으면 그 역할이 editor 이상이어야 하고(viewer grant는 주관 부서 소속이어도 탈락),
    grant가 없을 때만 주관 부서 소속(파생 editor)이 후보가 된다.
    """
    explicit_roles: dict[int, str] = dict((await session.execute(
        select(MapPermission.map_id, MapPermission.role).where(
            MapPermission.map_id.in_([m.id for m in maps]),
            MapPermission.principal_type == "user",
            MapPermission.principal_id == login_id,
        )
    )).all())
    # governance.is_owning_department_member와 같은 판정 — 조직 경로를 한 번만 풀어 맵마다 접두 비교
    emp = await session.get(Employee, login_id)
    org_path = resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    candidates: set[int] = set()
    for m in maps:
        if m.id in explicit_roles:
            is_candidate = logic.role_rank(explicit_roles[m.id]) >= logic.role_rank("editor")
        else:
            is_candidate = bool(m.owning_department) and logic.belongs_to_department(org_path, m.owning_department)
        if is_candidate:
            candidates.add(m.id)
    return candidates


def decide(
    line: RefLine, scope: ActorScope, ctx: DecisionContext, *, mode: str = "replace", to_value: str | None = None
) -> Decision:
    """줄 하나의 결과 — 설계 §5·§6 판정표. 순수 함수, 보이는 줄(is_line_visible)만 판정한다.

    mode="remove"인데 제거 금지 소스(오너·주관 부서·SP 부서)면 판정 대상이 아니다(호출부가 422).
    to_value는 ctx를 로드할 때 넘긴 값과 같아야 한다 — 후보·열람권 사실이 그 값 기준이라서.
    """
    if to_value and to_value != ctx.to_value:
        raise ValueError(f"to_value {to_value!r} was not loaded into the decision context")
    if line.source in GROUP_SOURCES:
        if ctx.group_statuses[line.group_id] != "active":
            return Decision("locked", reason="group_inactive")  # groups._ensure_active — pending·rejected는 409
        return Decision("direct")
    if line.source == "category_perm":
        return Decision("direct")
    m = ctx.maps[line.map_id]
    if m.mode == "framework":
        return Decision("locked", reason="framework")  # 확정 흐름 전용 — 평소에도 협업자·승인자 API가 422
    role = scope.roles.get(line.map_id)
    replacing = mode == "replace" and bool(to_value)

    if line.source in NODE_SOURCES:
        decision = _decide_node(line, scope, ctx)
        if (line.source == "node_assignee" and replacing and decision.outcome in ACTIONABLE
                and line.map_id not in ctx.to_value_viewable_map_ids):
            # 평소에도 서버가 막지 않는다(피커만 거름) — 판정은 그대로, 캔버스 "열람권 없음" 경고 예고
            return replace(decision, warning="no_access")
        return decision
    if line.source in GRANT_SOURCES:
        return _decide_grant(ctx.grants[_parse_grant_id(line.target_id)], role, m, ctx)
    if line.source == "map_owner":
        if role != "owner":
            return Decision("locked", reason="owner_left")
        if replacing and line.map_id not in ctx.owner_candidate_map_ids:
            return Decision("locked", reason="not_eligible")
        return Decision("direct")
    if line.source == "map_approver" and line.map_id in ctx.in_approval_map_ids:
        return Decision("locked", reason="in_approval")  # 승인 tally 보호 — sysadmin도 같은 규칙
    # map_approver·owning_dept·sp_dept·sp_assignee — 오너가 고친다
    return Decision("direct") if role == "owner" else _notify_owner(m, ctx)


def _decide_grant(grant: MapPermission, role: str | None, m: ProcessMap, ctx: DecisionContext) -> Decision:
    """사람·부서 grant — 라우터 delete_permission과 같은 가드 순서(오너 grant → 워크플로 참여 → 오너 즉시 → 대기 요청)."""
    if grant.role == "owner":
        return Decision("locked", reason="owner_left")  # 오너 grant는 map_owner 줄이 오너 이전으로 고친다
    if grant.principal_type == "user" and (grant.map_id, grant.principal_id) in ctx.workflow_pairs:
        return Decision("locked", reason="in_workflow")
    if role == "owner":
        return Decision("direct")  # 오너(sysadmin 포함)의 직접 적용은 대기 요청을 대체한다(governance.supersede_pending_downgrades)
    if (grant.map_id, grant.id) in ctx.pending_downgrades:
        return Decision("locked", reason="request_pending")
    # 대체도 옛 grant는 사라진다 — 제거와 같은 다운그레이드 규칙(editor 제거는 오너가 아니면 승인)
    if not logic.requires_downgrade_approval(grant.role, None):
        return Decision("direct")
    if not ctx.active_approvers.get(grant.map_id):
        return _notify_owner(m, ctx)  # 재직 승인자가 없으면 요청이 영영 대기 — 바로 고칠 수 있는 오너에게
    return Decision("approval")


def _decide_node(line: RefLine, scope: ActorScope, ctx: DecisionContext) -> Decision:
    """설계 §6 — 작업본(W) 상태·점유로 쓸 버전을 정한다. 게시본은 직접 건드리지 않는다."""
    if line.pending:
        return Decision("pending")
    target = ctx.node_targets[line.map_id]
    if target.working_id is None:
        return Decision("new_draft")
    if not workflow.is_editable_status(target.working_status or ""):
        return Decision("locked", reason="in_approval")
    holder = target.checked_out_by
    if holder == scope.login_id:
        return Decision("direct")
    if holder is None:
        if line.map_id in ctx.actor_pending_downgrade_map_ids:
            return Decision("locked", reason="request_pending")  # acquire_checkout과 같은 가드
        return Decision("checkout")
    if holder not in ctx.active_logins:
        return Decision("locked", reason="in_workflow")  # 퇴직자 점유 — 알릴 사람이 없고 감사는 강제 인수하지 않는다
    return Decision("notify", notify_to=NotifyTo(id=holder, name=ctx.display_names[holder], role="holder"))


def _notify_owner(m: ProcessMap, ctx: DecisionContext) -> Decision:
    """오너(owner_id, 없으면 created_by)에게 알림 — 재직 오너가 없으면 잠김."""
    owner = m.owner_id or m.created_by
    if not owner or owner not in ctx.active_logins:
        return Decision("locked", reason="owner_left")
    return Decision("notify", notify_to=NotifyTo(id=owner, name=ctx.display_names[owner], role="owner"))
