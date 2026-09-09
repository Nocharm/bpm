"""고아 참조 감사 — 현 조직에 없는 부서·사용자를 참조하는 12곳 온디맨드 스캔·일괄 재지정·오너 알림.

설계: docs/design/2026-09-09-ref-audit-design.md. 저장 테이블 없음 — 호출 시점에 계산한다.
"""

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Employee,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.orgchart import load_valid_org_prefixes
from app.workflow import DRAFT, PUBLISHED

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
        if m is None or m.deleted_at is not None or grant.principal_id in valid.dept_paths:
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
        if member.member_id in valid.dept_paths:
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
