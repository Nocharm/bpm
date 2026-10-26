"""고아 참조 감사 스캔 — 현 조직에 없는 부서·사용자를 참조하는 12곳을 온디맨드로 찾는다.

설계: 2026-09-09-ref-audit-design.md (git history), 2026-10-23-orphan-refs-open. 저장 테이블 없음 — 호출 시점에 계산한다.
줄별 판정은 `ref_audit_policy`, 카드 조립은 `ref_audit_cards`, 미리보기·적용은 `ref_audit_apply`.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CategoryPermission,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.orgchart import load_valid_org_prefixes
from app.workflow import (
    APPROVED,
    CONFIRMED,
    DRAFT,
    IN_PROGRESS_STATUSES,
    PENDING,
    PUBLISHED,
    REJECTED,
)

Source = Literal[
    "map_grant", "group_member", "owning_dept", "sp_dept", "node_dept",
    "map_owner", "map_collab", "map_approver", "group_user", "category_perm",
    "sp_assignee", "node_assignee",
]
DEPT_SOURCES: tuple[str, ...] = ("map_grant", "group_member", "owning_dept", "sp_dept", "node_dept")
USER_SOURCES: tuple[str, ...] = (
    "map_owner", "map_collab", "map_approver", "group_user", "category_perm",
    "sp_assignee", "node_assignee",
)
# 제거 모드가 없는 소스 — 오너·주관 부서·SP 부서는 대체만 된다
REMOVE_BLOCKED: frozenset[str] = frozenset({"map_owner", "owning_dept", "sp_dept"})
# 노드 줄이 싣는 노드 제목 상한(상세 창 호버 목록) — 곳 수(count)는 그대로 세고 제목만 자른다. 한 맵에 수백 노드가 걸려도 응답이 커지지 않게
NODE_TITLE_LIMIT = 20


@dataclass
class ValidSets:
    dept_paths: set[str]
    dept_leaves: set[str]
    user_ids: set[str]
    user_names: set[str]


@dataclass
class RefLine:
    source: str
    count: int
    target_id: str
    map_id: int | None = None
    map_name: str | None = None
    owner_id: str | None = None
    owner_name: str | None = None
    group_id: int | None = None
    group_name: str | None = None
    category_id: int | None = None
    category_name: str | None = None
    version_id: int | None = None
    version_status: str | None = None
    # 노드 줄 전용 — 작업본(W)에는 이미 고쳐져 게시본에만 남은 줄(고칠 것 없이 게시를 기다린다)
    pending: bool = False
    # 노드 줄 전용 — 그 맵 작업본의 상태·점유자(작업본이 없으면 None). 줄별 결과 판정이 읽는다
    working_status: str | None = None
    checked_out_by: str | None = None
    # 노드 줄 전용 — 그 버전에서 이 값을 가진 노드 제목(정렬, NODE_TITLE_LIMIT까지). 빈 제목은 끝 노드 등
    node_titles: list[str] = field(default_factory=list)
    # 이 줄이 속한 그룹의 값 — 스캔이 모든 소스의 줄에 채운다(카드로 합쳐도 줄마다 적용 대상 값을 안다)
    from_value: str = ""


@dataclass
class RefGroup:
    kind: str  # dept | user
    value: str
    value_kind: str  # path | leaf | login | name
    lines: list[RefLine] = field(default_factory=list)


@dataclass
class NodeTarget:
    """맵 하나의 노드 스캔 대상 — 게시본과 작업본(W). W = 최신 버전이 진행 중 상태일 때 그 버전."""

    map_id: int
    published_id: int | None
    working_id: int | None
    working_status: str | None
    checked_out_by: str | None


@dataclass
class ScanContext:
    """스캔이 공유하는 맵·오너 표시명·노드 스캔 대상 — 한 번만 로드."""

    maps: dict[int, ProcessMap]
    owner_names: dict[str, str]
    node_targets: dict[int, NodeTarget]


def split_names(value: str | None) -> list[str]:
    """콤마 구분 담당자 문자열 → 이름 목록(공백 트림, 빈 값 제외) — FE parseAssignees와 동치."""
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


async def load_valid_sets(session: AsyncSession) -> ValidSets:
    """active 직원 기준 유효 집합 — 부서 경로(remap과 동일 소스)·리프(모든 세그먼트∪department)·login·이름."""
    paths = await load_valid_org_prefixes(session, active_only=True)
    leaves = {segment for path in paths for segment in path.split("/") if segment}
    rows = (
        await session.execute(
            select(Employee.login_id, Employee.name, Employee.korean_name, Employee.department)
            .where(Employee.active.is_(True))
        )
    ).all()
    user_ids: set[str] = set()
    user_names: set[str] = set()
    for login_id, name, korean_name, department in rows:
        user_ids.add(login_id)
        if name:
            user_names.add(name)
        if korean_name:
            user_names.add(korean_name)
        if department:
            leaves.add(department)
    return ValidSets(dept_paths=paths, dept_leaves=leaves, user_ids=user_ids, user_names=user_names)


async def load_target_versions(session: AsyncSession) -> dict[int, list[tuple[int, str]]]:
    """홈 배지용 맵별 노드 대상 — 게시본 + 최신 드래프트 + 최신 반려·결재 대기·승인 완료본(각 최대 id).

    만료본·확정 스냅샷은 제외. 반려·결재 대기 작업본이 빠져 고아 참조가 숨었고 (리뷰 2026-10-19),
    승인 완료(APPROVED) 작업본도 같은 빈틈이었다 (2026-10-23). 표시는 모두 draft.
    감사 화면의 노드 줄은 이 목록이 아니라 `load_node_targets`(맵당 게시본+작업본 하나)를 쓴다.
    """
    rows = (
        await session.execute(
            select(MapVersion.map_id, MapVersion.id, MapVersion.status).order_by(MapVersion.id)
        )
    ).all()
    published: dict[int, int] = {}
    draft: dict[int, int] = {}
    in_review: dict[int, int] = {}
    for map_id, version_id, status in rows:
        if status == PUBLISHED:
            published[map_id] = version_id
        elif status == DRAFT:
            draft[map_id] = version_id  # id 오름차순 → 마지막이 최신
        elif status in (REJECTED, PENDING, APPROVED):
            in_review[map_id] = version_id
    out: dict[int, list[tuple[int, str]]] = {}
    for map_id, version_id in published.items():
        out.setdefault(map_id, []).append((version_id, "published"))
    for map_id, version_id in [*draft.items(), *in_review.items()]:
        out.setdefault(map_id, []).append((version_id, "draft"))  # 에디터 버전 필과 같은 표기
    return out


async def load_node_targets(session: AsyncSession) -> dict[int, NodeTarget]:
    """맵별 노드 스캔 대상 — 게시본(최대 id)과 작업본 W. 확정 스냅샷은 별도 트랙이라 최신 판정에서 뺀다.

    W = 최신 버전이 DRAFT·PENDING·APPROVED·REJECTED일 때 그 버전, 게시본·만료본이면 없음.
    새 버전은 최신이 게시된 뒤에만 만들어져 맵당 진행 중 버전은 하나다. 게시본도 W도 없는 맵은 뺀다.
    """
    rows = (
        await session.execute(
            select(MapVersion.map_id, MapVersion.id, MapVersion.status, MapVersion.checked_out_by)
            .order_by(MapVersion.id)
        )
    ).all()
    published: dict[int, int] = {}
    latest: dict[int, tuple[int, str, str | None]] = {}
    for map_id, version_id, status, holder in rows:
        if status == CONFIRMED:
            continue
        latest[map_id] = (version_id, status, holder)  # id 오름차순 → 마지막이 최신
        if status == PUBLISHED:
            published[map_id] = version_id
    targets: dict[int, NodeTarget] = {}
    for map_id, (version_id, status, holder) in latest.items():
        is_working = status in IN_PROGRESS_STATUSES
        published_id = published.get(map_id)
        if published_id is None and not is_working:
            continue
        targets[map_id] = NodeTarget(
            map_id=map_id, published_id=published_id,
            working_id=version_id if is_working else None,
            working_status=status if is_working else None,
            checked_out_by=holder if is_working else None,
        )
    return targets


async def load_scan_context(session: AsyncSession) -> ScanContext:
    maps = {m.id: m for m in (await session.scalars(select(ProcessMap))).all()}
    owner_ids = {m.owner_id or m.created_by for m in maps.values() if m.owner_id or m.created_by}
    owner_names: dict[str, str] = {}
    if owner_ids:
        owner_names = dict(
            (
                await session.execute(
                    select(Employee.login_id, Employee.name).where(Employee.login_id.in_(owner_ids))
                )
            ).all()
        )
    return ScanContext(maps=maps, owner_names=owner_names, node_targets=await load_node_targets(session))


def _map_line(ctx: ScanContext, source: str, m: ProcessMap, target_id: str, *,
              count: int = 1, version_id: int | None = None, version_status: str | None = None,
              pending: bool = False, target: NodeTarget | None = None,
              node_titles: list[str] | None = None) -> RefLine:
    owner = m.owner_id or m.created_by
    return RefLine(
        source=source, count=count, target_id=target_id,
        map_id=m.id, map_name=m.name, owner_id=owner,
        owner_name=ctx.owner_names.get(owner) if owner else None,
        version_id=version_id, version_status=version_status, pending=pending,
        working_status=target.working_status if target else None,
        checked_out_by=target.checked_out_by if target else None,
        node_titles=node_titles or [],
    )


class _Groups:
    """(value, value_kind) → RefGroup 누적기. 출력은 value 순, 라인은 (맵·그룹 이름, source)."""

    def __init__(self, kind: str) -> None:
        self.kind = kind
        self._by_key: dict[tuple[str, str], RefGroup] = {}

    def add(self, value: str, value_kind: str, line: RefLine) -> None:
        line.from_value = value
        group = self._by_key.setdefault((value, value_kind), RefGroup(self.kind, value, value_kind))
        group.lines.append(line)

    def finish(self) -> list[RefGroup]:
        groups = sorted(self._by_key.values(), key=lambda g: (g.value, g.value_kind))
        for group in groups:
            group.lines.sort(key=lambda ln: (ln.map_name or ln.group_name or "", ln.source))
        return groups


def _get_node_version_roles(ctx: ScanContext) -> dict[int, tuple[int, bool]]:
    """스캔할 노드 버전 id → (맵 id, 작업본 여부) — 소프트삭제 맵은 뺀다."""
    roles: dict[int, tuple[int, bool]] = {}
    for map_id, target in ctx.node_targets.items():
        m = ctx.maps.get(map_id)
        if m is None or m.deleted_at is not None:
            continue
        if target.published_id is not None:
            roles[target.published_id] = (map_id, False)
        if target.working_id is not None:
            roles[target.working_id] = (map_id, True)
    return roles


async def _collect_stale_nodes(
    session: AsyncSession, ctx: ScanContext, stale_values: Callable[[str, str], Iterable[str]]
) -> tuple[dict[tuple[int, str], list[str]], dict[tuple[int, str], list[str]]]:
    """(맵, 낡은 값) → 그 값을 가진 노드 제목(노드마다 하나, 길이=노드 수) — (게시본, 작업본) 따로.

    stale_values(부서, 담당자)가 노드 하나의 낡은 값 목록을 낸다.
    """
    roles = _get_node_version_roles(ctx)
    published: dict[tuple[int, str], list[str]] = {}
    working: dict[tuple[int, str], list[str]] = {}
    if not roles:
        return published, working
    rows = (
        await session.execute(
            select(Node.version_id, Node.department, Node.assignee, Node.title)
            .where(Node.version_id.in_(list(roles)))
        )
    ).all()
    for version_id, department, assignee, title in rows:
        map_id, is_working = roles[version_id]
        bucket = working if is_working else published
        for value in stale_values(department, assignee):
            bucket.setdefault((map_id, value), []).append(title or "")
    return published, working


def _add_node_lines(groups: _Groups, ctx: ScanContext, source: str, value_kind: str,
                    published: dict[tuple[int, str], list[str]], working: dict[tuple[int, str], list[str]]) -> None:
    """(맵, 값)당 노드 줄 하나 — 고칠 대상은 작업본, 작업본이 없으면 게시본.

    작업본에도 있으면 작업본 기준 곳 수. 작업본이 있는데 값이 게시본에만 남았으면 이미 고쳐진 것이라
    pending(게시 대기) — 게시본 곳 수를 보여 주되 고칠 것은 없다.
    """
    for map_id, value in sorted(published.keys() | working.keys()):
        target = ctx.node_targets[map_id]
        m = ctx.maps[map_id]
        if (map_id, value) in working:
            version_id, titles, pending = target.working_id, working[(map_id, value)], False
        else:
            version_id, titles, pending = target.published_id, published[(map_id, value)], target.working_id is not None
        groups.add(value, value_kind, _map_line(
            ctx, source, m, f"{source}:{map_id}", count=len(titles), version_id=version_id,
            version_status="draft" if version_id == target.working_id else "published",
            pending=pending, target=target, node_titles=sorted(titles)[:NODE_TITLE_LIMIT],
        ))


def _live_maps(ctx: ScanContext) -> list[ProcessMap]:
    return [m for m in ctx.maps.values() if m.deleted_at is None]


async def scan_dept_refs(session: AsyncSession, valid: ValidSets, ctx: ScanContext) -> list[RefGroup]:
    """부서 참조 5곳 — 경로 3곳(권한·그룹 멤버·오우닝)은 경로 집합, 리프 2곳(SP·노드)은 리프 집합과 대조."""
    groups = _Groups("dept")

    grants = (await session.scalars(select(MapPermission).where(MapPermission.principal_type == "department"))).all()
    for grant in grants:
        m = ctx.maps.get(grant.map_id)
        if m is None or m.deleted_at is not None or not grant.principal_id or grant.principal_id in valid.dept_paths:
            continue
        line = _map_line(ctx, "map_grant", m, f"map_grant:{grant.id}")
        groups.add(grant.principal_id, "path", line)

    member_rows = (
        await session.execute(
            select(UserGroupMember, UserGroup.name)
            .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
            .where(UserGroupMember.member_type == "department", UserGroup.deleted_at.is_(None))
        )
    ).all()
    for member, group_name in member_rows:
        if not member.member_id or member.member_id in valid.dept_paths:
            continue
        groups.add(member.member_id, "path", RefLine(
            source="group_member", count=1, target_id=f"group_member:{member.id}",
            group_id=member.group_id, group_name=group_name,
        ))

    # 오우닝은 소프트삭제 맵 포함(복구 시 일관성) — 기존 dept-remap 동작 유지
    for m in ctx.maps.values():
        if m.owning_department and m.owning_department not in valid.dept_paths:
            groups.add(m.owning_department, "path", _map_line(ctx, "owning_dept", m, f"owning_dept:{m.id}"))

    for m in _live_maps(ctx):
        if m.sp_department and m.sp_department not in valid.dept_leaves:
            groups.add(m.sp_department, "leaf", _map_line(ctx, "sp_dept", m, f"sp_dept:{m.id}"))

    def stale_departments(department: str, _assignee: str) -> list[str]:
        return [department] if department and department not in valid.dept_leaves else []

    published, working = await _collect_stale_nodes(session, ctx, stale_departments)
    _add_node_lines(groups, ctx, "node_dept", "leaf", published, working)
    return groups.finish()


async def scan_user_refs(session: AsyncSession, valid: ValidSets, ctx: ScanContext) -> list[RefGroup]:
    """사용자 참조 7곳 — login 5곳은 active login 집합, 이름 2곳(SP·노드 담당자)은 이름 집합과 대조."""
    groups = _Groups("user")

    for m in _live_maps(ctx):
        if m.owner_id and m.owner_id not in valid.user_ids:
            groups.add(m.owner_id, "login", _map_line(ctx, "map_owner", m, f"map_owner:{m.id}"))

    grants = (await session.scalars(select(MapPermission).where(MapPermission.principal_type == "user"))).all()
    for grant in grants:
        m = ctx.maps.get(grant.map_id)
        if m is None or m.deleted_at is not None or not grant.principal_id or grant.principal_id in valid.user_ids:
            continue
        groups.add(grant.principal_id, "login", _map_line(ctx, "map_collab", m, f"map_collab:{grant.id}"))

    approvers = (await session.scalars(select(MapApprover))).all()
    for approver in approvers:
        m = ctx.maps.get(approver.map_id)
        if m is None or m.deleted_at is not None or not approver.user_id or approver.user_id in valid.user_ids:
            continue
        groups.add(approver.user_id, "login", _map_line(ctx, "map_approver", m, f"map_approver:{m.id}"))

    member_rows = (
        await session.execute(
            select(UserGroupMember, UserGroup.name)
            .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
            .where(UserGroupMember.member_type == "user", UserGroup.deleted_at.is_(None))
        )
    ).all()
    for member, group_name in member_rows:
        if not member.member_id or member.member_id in valid.user_ids:
            continue
        groups.add(member.member_id, "login", RefLine(
            source="group_user", count=1, target_id=f"group_user:{member.id}",
            group_id=member.group_id, group_name=group_name,
        ))

    perm_rows = (
        await session.execute(
            select(CategoryPermission, ProcessCategory.name)
            .join(ProcessCategory, ProcessCategory.id == CategoryPermission.category_id)
            .where(CategoryPermission.principal_type == "user")
        )
    ).all()
    for perm, category_name in perm_rows:
        if not perm.principal_id or perm.principal_id in valid.user_ids:
            continue
        groups.add(perm.principal_id, "login", RefLine(
            source="category_perm", count=1, target_id=f"category_perm:{perm.id}",
            category_id=perm.category_id, category_name=category_name,
        ))

    for m in _live_maps(ctx):
        for name in split_names(m.sp_assignee):
            if name not in valid.user_names:
                groups.add(name, "name", _map_line(ctx, "sp_assignee", m, f"sp_assignee:{m.id}"))

    def stale_assignees(_department: str, assignee: str) -> list[str]:
        return [name for name in split_names(assignee) if name not in valid.user_names]

    published, working = await _collect_stale_nodes(session, ctx, stale_assignees)
    _add_node_lines(groups, ctx, "node_assignee", "name", published, working)
    return groups.finish()


async def scan_refs(session: AsyncSession) -> tuple[list[RefGroup], list[RefGroup]]:
    """전체 스캔 — (departments, users). 유효 집합·컨텍스트는 1회만 로드."""
    valid = await load_valid_sets(session)
    ctx = await load_scan_context(session)
    return await scan_dept_refs(session, valid, ctx), await scan_user_refs(session, valid, ctx)


async def count_stale_refs_by_map(
    session: AsyncSession, maps: list[ProcessMap], version_ids_by_map: dict[int, list[int]]
) -> dict[int, int]:
    """홈 카드용 경량 집계 — 오너가 손댈 수 있는 4곳(노드 부서·담당자, SP 부서·담당자)만. 쿼리 3개 고정."""
    valid = await load_valid_sets(session)
    counts: dict[int, int] = {}
    for m in maps:
        stale = 0
        if m.sp_department and m.sp_department not in valid.dept_leaves:
            stale += 1
        stale += sum(1 for name in split_names(m.sp_assignee) if name not in valid.user_names)
        if stale:
            counts[m.id] = stale
    map_by_vid = {vid: mid for mid, vids in version_ids_by_map.items() for vid in vids}
    if map_by_vid:
        # 후보만 SQL에서 걸러 행 볼륨을 줄인다 — GET /api/maps 핫패스라 맵마다 전체 노드를 끌어오면 느리다.
        # 판정 자체(department가 valid.dept_leaves에 있는지 등)는 Python에서 그대로 재확인.
        rows = (
            await session.execute(
                select(Node.version_id, Node.department, Node.assignee).where(
                    Node.version_id.in_(list(map_by_vid)),
                    or_(
                        and_(Node.department != "", Node.department.notin_(sorted(valid.dept_leaves))),
                        Node.assignee != "",
                    ),
                )
            )
        ).all()
        for version_id, department, assignee in rows:
            stale = 0
            if department and department not in valid.dept_leaves:
                stale += 1
            stale += sum(1 for name in split_names(assignee) if name not in valid.user_names)
            if stale:
                map_id = map_by_vid[version_id]
                counts[map_id] = counts.get(map_id, 0) + stale
    return counts
