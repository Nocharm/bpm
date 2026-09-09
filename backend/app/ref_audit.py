"""고아 참조 감사 — 현 조직에 없는 부서·사용자를 참조하는 12곳 온디맨드 스캔·일괄 재지정·오너 알림.

설계: docs/design/2026-09-09-ref-audit-design.md. 저장 테이블 없음 — 호출 시점에 계산한다.
"""

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
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
from app.permissions.logic import role_rank
from app.workflow import DRAFT, PUBLISHED, create_notifications

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
# 노드 필드는 드래프트에서만 고칠 수 있다 — 캐치·알림 전용
FIXABLE: dict[str, bool] = {s: s not in ("node_dept", "node_assignee") for s in DEPT_SOURCES + USER_SOURCES}
# 오너가 직접 고쳐야 하는(또는 고칠 수 있는) 소스 — 홈 배지 집계·알림 대상
OWNER_ACTIONABLE: frozenset[str] = frozenset({"node_dept", "node_assignee", "sp_dept", "sp_assignee"})


@dataclass
class ValidSets:
    dept_paths: set[str]
    dept_leaves: set[str]
    user_ids: set[str]
    user_names: set[str]


@dataclass
class RefLine:
    source: str
    fixable: bool
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


@dataclass
class RefGroup:
    kind: str  # dept | user
    value: str
    value_kind: str  # path | leaf | login | name
    lines: list[RefLine] = field(default_factory=list)


@dataclass
class ScanContext:
    """스캔이 공유하는 맵·오너 표시명·대상 버전 — 한 번만 로드."""

    maps: dict[int, ProcessMap]
    owner_names: dict[str, str]
    versions: dict[int, list[tuple[int, str]]]


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
    """맵별 노드 스캔 대상 — 게시본 + 최신 드래프트(최대 id). 그 외 버전은 제외."""
    rows = (
        await session.execute(
            select(MapVersion.map_id, MapVersion.id, MapVersion.status).order_by(MapVersion.id)
        )
    ).all()
    published: dict[int, int] = {}
    draft: dict[int, int] = {}
    for map_id, version_id, status in rows:
        if status == PUBLISHED:
            published[map_id] = version_id
        elif status == DRAFT:
            draft[map_id] = version_id  # id 오름차순 → 마지막이 최신
    out: dict[int, list[tuple[int, str]]] = {}
    for map_id, version_id in published.items():
        out.setdefault(map_id, []).append((version_id, "published"))
    for map_id, version_id in draft.items():
        out.setdefault(map_id, []).append((version_id, "draft"))
    return out


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
    return ScanContext(maps=maps, owner_names=owner_names, versions=await load_target_versions(session))


def _map_line(ctx: ScanContext, source: str, m: ProcessMap, target_id: str, *,
              count: int = 1, version_id: int | None = None, version_status: str | None = None) -> RefLine:
    owner = m.owner_id or m.created_by
    return RefLine(
        source=source, fixable=FIXABLE[source], count=count, target_id=target_id,
        map_id=m.id, map_name=m.name, owner_id=owner,
        owner_name=ctx.owner_names.get(owner) if owner else None,
        version_id=version_id, version_status=version_status,
    )


class _Groups:
    """(value, value_kind) → RefGroup 누적기. 출력은 value 순, 라인은 (fixable desc, map_name, source)."""

    def __init__(self, kind: str) -> None:
        self.kind = kind
        self._by_key: dict[tuple[str, str], RefGroup] = {}

    def add(self, value: str, value_kind: str, line: RefLine) -> None:
        group = self._by_key.setdefault((value, value_kind), RefGroup(self.kind, value, value_kind))
        group.lines.append(line)

    def finish(self) -> list[RefGroup]:
        groups = sorted(self._by_key.values(), key=lambda g: (g.value, g.value_kind))
        for group in groups:
            group.lines.sort(key=lambda ln: (not ln.fixable, ln.map_name or ln.group_name or "", ln.source))
        return groups


async def _load_node_columns(session: AsyncSession, ctx: ScanContext) -> list[tuple[int, str, str]]:
    version_ids = [vid for pairs in ctx.versions.values() for vid, _ in pairs]
    if not version_ids:
        return []
    return list(
        (
            await session.execute(
                select(Node.version_id, Node.department, Node.assignee).where(Node.version_id.in_(version_ids))
            )
        ).all()
    )


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
            source="group_member", fixable=True, count=1, target_id=f"group_member:{member.id}",
            group_id=member.group_id, group_name=group_name,
        ))

    # 오우닝은 소프트삭제 맵 포함(복구 시 일관성) — 기존 dept-remap 동작 유지
    for m in ctx.maps.values():
        if m.owning_department and m.owning_department not in valid.dept_paths:
            groups.add(m.owning_department, "path", _map_line(ctx, "owning_dept", m, f"owning_dept:{m.id}"))

    for m in _live_maps(ctx):
        if m.sp_department and m.sp_department not in valid.dept_leaves:
            groups.add(m.sp_department, "leaf", _map_line(ctx, "sp_dept", m, f"sp_dept:{m.id}"))

    status_by_vid = {vid: (mid, status) for mid, pairs in ctx.versions.items() for vid, status in pairs}
    counts: dict[tuple[int, str], int] = {}
    for version_id, department, _assignee in await _load_node_columns(session, ctx):
        if department and department not in valid.dept_leaves:
            counts[(version_id, department)] = counts.get((version_id, department), 0) + 1
    for (version_id, department), count in counts.items():
        map_id, status = status_by_vid[version_id]
        m = ctx.maps.get(map_id)
        if m is None or m.deleted_at is not None:
            continue
        groups.add(department, "leaf", _map_line(
            ctx, "node_dept", m, f"node_dept:{version_id}", count=count,
            version_id=version_id, version_status=status,
        ))
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
            source="group_user", fixable=True, count=1, target_id=f"group_user:{member.id}",
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
            source="category_perm", fixable=True, count=1, target_id=f"category_perm:{perm.id}",
            category_id=perm.category_id, category_name=category_name,
        ))

    for m in _live_maps(ctx):
        for name in split_names(m.sp_assignee):
            if name not in valid.user_names:
                groups.add(name, "name", _map_line(ctx, "sp_assignee", m, f"sp_assignee:{m.id}"))

    status_by_vid = {vid: (mid, status) for mid, pairs in ctx.versions.items() for vid, status in pairs}
    counts: dict[tuple[int, str], int] = {}
    for version_id, _department, assignee in await _load_node_columns(session, ctx):
        for name in split_names(assignee):
            if name not in valid.user_names:
                counts[(version_id, name)] = counts.get((version_id, name), 0) + 1
    for (version_id, name), count in counts.items():
        map_id, status = status_by_vid[version_id]
        m = ctx.maps.get(map_id)
        if m is None or m.deleted_at is not None:
            continue
        groups.add(name, "name", _map_line(
            ctx, "node_assignee", m, f"node_assignee:{version_id}", count=count,
            version_id=version_id, version_status=status,
        ))
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


class RemapError(ValueError):
    """요청 전체를 거부하는 검증 실패 — 라우터가 422로 변환."""


@dataclass
class NotifyResult:
    recipients: int
    maps: int
    skipped_maps: list[dict] = field(default_factory=list)


async def send_fix_requests(session: AsyncSession, target_ids: list[str], actor: str) -> NotifyResult:
    """오너 액션 대상 라인을 맵→오너로 묶어 오너당 알림 1건. 오너 없음/퇴직은 skipped. commit은 호출자."""
    for target_id in target_ids:
        source = target_id.partition(":")[0]
        if source not in OWNER_ACTIONABLE:
            raise RemapError(f"{source} is not owner-actionable")
    wanted = set(target_ids)
    valid = await load_valid_sets(session)
    ctx = await load_scan_context(session)
    lines = [ln for group in (await scan_dept_refs(session, valid, ctx)) + (await scan_user_refs(session, valid, ctx))
             for ln in group.lines if ln.target_id in wanted and ln.map_id is not None]
    per_map: dict[int, dict] = {}
    for ln in lines:
        entry = per_map.setdefault(ln.map_id, {
            "id": ln.map_id, "name": ln.map_name or "", "node_dept": 0, "node_assignee": 0,
            "sp_dept": 0, "sp_assignee": 0, "_owner": ln.owner_id,
        })
        entry[ln.source] += ln.count
    by_owner: dict[str, list[dict]] = {}
    skipped: list[dict] = []
    for entry in per_map.values():
        owner = entry.pop("_owner")
        if not owner or owner not in valid.user_ids:
            skipped.append({"id": entry["id"], "name": entry["name"], "reason": "owner_missing"})
            continue
        by_owner.setdefault(owner, []).append(entry)
    actor_emp = await session.get(Employee, actor)
    actor_name = actor_emp.name if actor_emp and actor_emp.name else actor
    for owner, maps in by_owner.items():
        await create_notifications(
            session, [owner], type="ref_fix_requested",
            message=f"{actor_name} asked you to fix stale department/assignee references in {len(maps)} map(s)",
            payload={"actor": actor, "actor_name": actor_name, "count": len(maps), "maps": maps},
        )
    return NotifyResult(recipients=len(by_owner), maps=sum(len(v) for v in by_owner.values()), skipped_maps=skipped)


@dataclass
class RemapResult:
    applied: dict[str, int] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)

    def hit(self, source: str) -> None:
        self.applied[source] = self.applied.get(source, 0) + 1


REMOVE_BLOCKED: frozenset[str] = frozenset({"map_owner", "owning_dept", "sp_dept"})


def _parse_target(target_id: str) -> tuple[str, int]:
    source, _, pk = target_id.partition(":")
    if source not in FIXABLE or not pk.isdigit():
        raise RemapError(f"invalid target_id {target_id!r}")
    if not FIXABLE[source]:
        raise RemapError(f"{source} is not fixable")
    return source, int(pk)


def _leaf(path: str) -> str:
    return path.rsplit("/", 1)[-1]


async def _resolve_to_value(session: AsyncSession, kind: str, mode: str, to_value: str) -> tuple[str, str]:
    """(to_id, to_name) — dept는 (경로, 리프), user는 (login, 직원 name). remove면 ("", "")."""
    if mode == "remove":
        return "", ""
    valid = await load_valid_sets(session)
    if kind == "dept":
        if to_value not in valid.dept_paths:
            raise RemapError("to_value is not a current department path")
        return to_value, _leaf(to_value)
    if to_value not in valid.user_ids:
        raise RemapError("to_value is not an active employee")
    emp = await session.get(Employee, to_value)
    return to_value, (emp.name if emp and emp.name else to_value)


async def _replace_owner(session: AsyncSession, m: ProcessMap, to_login: str, actor: str) -> None:
    """퇴직 오너 → 새 오너. transfer_owner와 결과 상태 동일(owner grant 정확히 1개) + owner_assigned 알림."""
    old_owner = m.owner_id
    grants = (await session.scalars(select(MapPermission).where(
        MapPermission.map_id == m.id, MapPermission.principal_type == "user"))).all()
    new_grant = None
    for grant in grants:
        if grant.principal_id == old_owner:
            await session.delete(grant)
        elif grant.principal_id == to_login:
            new_grant = grant
        elif grant.role == "owner":
            grant.role = "editor"
    if new_grant is None:
        session.add(MapPermission(map_id=m.id, principal_type="user", principal_id=to_login,
                                  role="owner", granted_by=actor))
    else:
        new_grant.role = "owner"
    m.owner_id = to_login
    m.consultant_owner_pending = False
    actor_emp = await session.get(Employee, actor)
    old_emp = await session.get(Employee, old_owner) if old_owner else None
    actor_name = actor_emp.name if actor_emp and actor_emp.name else actor
    from_name = old_emp.name if old_emp and old_emp.name else (old_owner or "")
    await create_notifications(
        session, [to_login], type="owner_assigned", map_id=m.id,
        message=f"{actor_name} made you the owner of '{m.name}' (previous owner {from_name} has left)",
        payload={"map_name": m.name, "actor": actor, "actor_name": actor_name, "from_name": from_name},
    )


async def _apply_line(session: AsyncSession, source: str, pk: int, *, from_value: str, mode: str,
                      to_id: str, to_name: str, actor: str, result: RemapResult, target_id: str) -> None:
    if mode == "remove" and source in REMOVE_BLOCKED:
        raise RemapError(f"{source} cannot be removed")

    if source in ("map_grant", "map_collab"):
        grant = await session.get(MapPermission, pk)
        if grant is None or grant.principal_id != from_value:
            result.skipped.append(target_id)
            return
        if source == "map_collab" and grant.role == "owner":
            result.skipped.append(target_id)  # 오너 grant는 map_owner 절차가 담당
            return
        if mode == "remove":
            await session.delete(grant)
        else:
            dup = await session.scalar(select(MapPermission).where(
                MapPermission.map_id == grant.map_id, MapPermission.principal_type == grant.principal_type,
                MapPermission.principal_id == to_id))
            if dup is not None:
                if role_rank(grant.role) > role_rank(dup.role):
                    dup.role = grant.role
                await session.delete(grant)
            else:
                grant.principal_id = to_id
        result.hit(source)
        return

    if source in ("group_member", "group_user"):
        member = await session.get(UserGroupMember, pk)
        if member is None or member.member_id != from_value:
            result.skipped.append(target_id)
            return
        if mode == "remove":
            await session.delete(member)
        else:
            dup = await session.scalar(select(UserGroupMember).where(
                UserGroupMember.group_id == member.group_id, UserGroupMember.member_type == member.member_type,
                UserGroupMember.member_id == to_id))
            if dup is not None:
                await session.delete(member)
            else:
                member.member_id = to_id
        result.hit(source)
        return

    if source == "category_perm":
        perm = await session.get(CategoryPermission, pk)
        if perm is None or perm.principal_id != from_value:
            result.skipped.append(target_id)
            return
        if mode == "remove":
            await session.delete(perm)
        else:
            dup = await session.scalar(select(CategoryPermission).where(
                CategoryPermission.category_id == perm.category_id, CategoryPermission.principal_type == "user",
                CategoryPermission.principal_id == to_id))
            if dup is not None:
                await session.delete(perm)
            else:
                perm.principal_id = to_id
        result.hit(source)
        return

    if source == "map_approver":
        approver = await session.get(MapApprover, (pk, from_value))
        if approver is None:
            result.skipped.append(target_id)
            return
        if mode == "remove":
            await session.delete(approver)
        else:
            dup = await session.get(MapApprover, (pk, to_id))
            if dup is not None:
                await session.delete(approver)
            else:
                await session.delete(approver)
                await session.flush()
                session.add(MapApprover(map_id=pk, user_id=to_id, assigned_by=actor))
        result.hit(source)
        return

    # 이하 맵 컬럼 계열 — pk = map_id
    m = await session.get(ProcessMap, pk)
    if m is None:
        result.skipped.append(target_id)
        return
    if source == "owning_dept":
        if m.owning_department != from_value:
            result.skipped.append(target_id)
            return
        m.owning_department = to_id
    elif source == "sp_dept":
        if m.sp_department != from_value:
            result.skipped.append(target_id)
            return
        m.sp_department = to_name
        m.sp_changed_by, m.sp_changed_at = actor, now_kst()
    elif source == "sp_assignee":
        names = split_names(m.sp_assignee)
        if from_value not in names:
            result.skipped.append(target_id)
            return
        kept = [n for n in names if n != from_value]
        if mode == "replace" and to_name not in kept:
            kept.append(to_name)
        m.sp_assignee = ", ".join(kept)
        m.sp_changed_by, m.sp_changed_at = actor, now_kst()
    elif source == "map_owner":
        if m.owner_id != from_value:
            result.skipped.append(target_id)
            return
        await _replace_owner(session, m, to_id, actor)
    result.hit(source)


async def apply_remap(session: AsyncSession, *, kind: str, from_value: str, mode: str, to_value: str,
                      target_ids: list[str], actor: str) -> RemapResult:
    """검증은 적용 전 전부(target 파싱·대상 존재·remove 금지) → 라인별 적용. commit은 호출자."""
    parsed = [_parse_target(t) for t in target_ids]
    expected = DEPT_SOURCES if kind == "dept" else USER_SOURCES
    for (source, _), target_id in zip(parsed, target_ids):
        if source not in expected:
            raise RemapError(f"{target_id} does not belong to kind {kind}")
        if mode == "remove" and source in REMOVE_BLOCKED:
            raise RemapError(f"{source} cannot be removed")
    to_id, to_name = await _resolve_to_value(session, kind, mode, to_value)
    result = RemapResult()
    for (source, pk), target_id in zip(parsed, target_ids):
        await _apply_line(session, source, pk, from_value=from_value, mode=mode, to_id=to_id,
                          to_name=to_name, actor=actor, result=result, target_id=target_id)
    return result
