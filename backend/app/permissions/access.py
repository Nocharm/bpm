"""DB-aware effective-role 해석 — 순수 logic.py에 DB 로딩을 더한 얇은 래퍼.

logic.effective_role 는 입력값을 받는 순수 함수. 이 모듈이 map/employee/permissions/
approver 를 DB에서 로드해 그 입력을 채우고, 게이트용 assert 헬퍼를 제공한다.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import (
    CategoryPermission,
    DashboardPermission,
    Employee,
    MapApprover,
    MapPermission,
    ProcessCategory,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic


async def get_user_active_group_ids(
    session: AsyncSession, login_id: str, emp_org_path: str
) -> set[str]:
    """호출자가 속한 ACTIVE 사용자 그룹 id 집합(문자열).

    멤버십: user 멤버(member_id==login_id) 또는 department 멤버
    (belongs_to_department(emp_org_path, member_id), Layer-2 규약의 org_path 문자열).
    status='active' 그룹만 — pending/rejected 는 제외.
    """
    rows = (
        await session.execute(
            select(
                UserGroupMember.group_id,
                UserGroupMember.member_type,
                UserGroupMember.member_id,
            ).join(UserGroup, UserGroup.id == UserGroupMember.group_id)
            .where(UserGroup.status == "active")
        )
    ).all()
    group_ids: set[str] = set()
    for group_id, member_type, member_id in rows:
        if member_type == "user" and member_id == login_id:
            group_ids.add(str(group_id))
        elif member_type == "department" and logic.belongs_to_department(
            emp_org_path, member_id
        ):
            group_ids.add(str(group_id))
    return group_ids


async def get_framework_category_id(session: AsyncSession, map_id: int) -> int | None:
    """캔버스 맵 → 결착 카테고리 역조회 (linkage_map_id 1:1)."""
    return await session.scalar(
        select(ProcessCategory.id).where(ProcessCategory.linkage_map_id == map_id)
    )


@dataclass
class CategoryAdminInfo:
    """카테고리 (자기+조상) 체인 권한 판정 결과 — resolve_category_admin 반환형.

    admin_level/admin_category_id는 매치된 행 중 최소 level(최상위)을 채택한다(다중 매치 시
    상위 체인 관리자를 대표로 노출 — 대시보드 스코프용). direct는 category_id 자신에 매치
    행이 있는지를 레벨 채택과 무관하게 별도로 보므로, 조상도 함께 권한자인 이중 부여
    상황에서도 True — is_direct_l5_admin(framework-confirm 게이트)이 이런 사용자를
    잘못 걸러내지 않도록 보존한다.
    """

    is_admin: bool
    admin_level: int | None
    admin_category_id: int | None
    direct: bool


async def resolve_category_admin(
    session: AsyncSession, login_id: str, category_id: int
) -> CategoryAdminInfo:
    """카테고리 (자기+조상) 체인 권한자를 레벨 인지로 판정 (design 2026-08-28 §4 확장).

    sysadmin은 여기서 판정하지 않는다 — 호출부가 logic.is_sysadmin을 먼저 본다.
    """
    rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level)
        )
    ).all()
    parent_by_id = {cid: pid for cid, pid, _ in rows}
    level_by_id = {cid: lvl for cid, _, lvl in rows}
    chain: list[int] = []
    cursor: int | None = category_id
    while cursor is not None and cursor in parent_by_id and cursor not in chain:
        chain.append(cursor)  # not-in-chain 가드 — (동시성) 부모 사이클에도 종료 보장
        cursor = parent_by_id[cursor]
    if not chain:
        return CategoryAdminInfo(False, None, None, False)
    perm_rows = (
        await session.execute(
            select(
                CategoryPermission.category_id,
                CategoryPermission.principal_type,
                CategoryPermission.principal_id,
            ).where(CategoryPermission.category_id.in_(chain))
        )
    ).all()
    if not perm_rows:
        return CategoryAdminInfo(False, None, None, False)
    group_pids = {pid for _, ptype, pid in perm_rows if ptype == "group"}
    user_group_ids: set[str] = set()
    if group_pids:
        emp = await session.get(Employee, login_id)
        emp_org_path = (
            resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
        )
        user_group_ids = await get_user_active_group_ids(session, login_id, emp_org_path)
    matched_ids = {
        cid for cid, ptype, pid in perm_rows
        if (ptype == "user" and pid == login_id) or (ptype == "group" and pid in user_group_ids)
    }
    if not matched_ids:
        return CategoryAdminInfo(False, None, None, False)
    best_id = min(matched_ids, key=lambda cid: level_by_id[cid])
    return CategoryAdminInfo(
        is_admin=True,
        admin_level=level_by_id[best_id],
        admin_category_id=best_id,
        direct=category_id in matched_ids,
    )


async def is_category_admin(
    session: AsyncSession, login_id: str, category_id: int
) -> bool:
    """카테고리 권한자 판정 — resolve_category_admin의 얇은 래퍼 (design 2026-08-28 §4)."""
    return (await resolve_category_admin(session, login_id, category_id)).is_admin


async def is_direct_l5_admin(
    session: AsyncSession, login_id: str, category_id: int
) -> bool:
    """카테고리에 직접 붙은 권한자인지 — resolve_category_admin의 얇은 래퍼 (spec §5).

    is_category_admin 과 달리 상속만으로는 True가 안 된다 — 확정(framework-confirm)은
    직속 L5 관리자 전용이라 상위 체인 관리자는 편집은 되지만 확정은 403.
    """
    return (await resolve_category_admin(session, login_id, category_id)).direct


async def get_category_admin_logins(
    session: AsyncSession, category_id: int, direct_only: bool = True
) -> list[str]:
    """카테고리 관리자 로그인 id 열거 — is_direct_l5_admin/is_category_admin(단건 판정)의
    역방향(알림 수신자 산출용, Track B Task 5). user 행은 그대로, group 행은 active 그룹
    멤버십을 전 직원 순회로 실제 로그인으로 확장한다(get_eligible_users 패턴).

    direct_only=False 는 is_category_admin과 같은 조상 체인 전체를 포함.
    """
    if direct_only:
        category_ids = [category_id]
    else:
        rows = (
            await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id))
        ).all()
        parent_by_id = {cid: pid for cid, pid in rows}
        category_ids = []
        cursor: int | None = category_id
        while cursor is not None and cursor in parent_by_id and cursor not in category_ids:
            category_ids.append(cursor)
            cursor = parent_by_id[cursor]

    perm_rows = (
        await session.execute(
            select(CategoryPermission.principal_type, CategoryPermission.principal_id)
            .where(CategoryPermission.category_id.in_(category_ids))
        )
    ).all()
    logins: set[str] = {pid for ptype, pid in perm_rows if ptype == "user"}
    group_pids = {pid for ptype, pid in perm_rows if ptype == "group"}
    if group_pids:
        employees = list(
            (await session.scalars(select(Employee).where(Employee.active.is_(True)))).all()
        )
        dept_index = await load_dept_index(session)
        member_rows = (
            await session.execute(
                select(
                    UserGroupMember.group_id,
                    UserGroupMember.member_type,
                    UserGroupMember.member_id,
                )
                .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
                .where(UserGroup.status == "active")
            )
        ).all()
        for emp in employees:
            emp_org_path = resolve_org_path(emp, dept_index)
            for gid, member_type, member_id in member_rows:
                if str(gid) not in group_pids:
                    continue
                if member_type == "user" and member_id == emp.login_id:
                    logins.add(emp.login_id)
                elif member_type == "department" and logic.belongs_to_department(
                    emp_org_path, member_id
                ):
                    logins.add(emp.login_id)
    return sorted(logins)


async def get_admin_scope(
    session: AsyncSession, user: str
) -> tuple[set[int], dict[int, int]]:
    """호출자가 권한자인 카테고리 id 전체(직접 부여 + 서브트리 하향 상속) + seed id→level.

    categories.py의 _admin_category_ids 확장판 — CRUD 게이트(Track C 다음 태스크)와 /me가
    함께 쓰므로 체인 판정과 같은 access.py에 둔다(categories.py→access.py 단방향 import라
    순환 없음). sysadmin은 (전체 id, {}) — 전권이라 seed(루트) 개념이 없다.
    """
    rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level)
        )
    ).all()
    if logic.is_sysadmin(user):
        return {cid for cid, _, _ in rows}, {}
    perm_rows = (
        await session.execute(
            select(CategoryPermission.category_id, CategoryPermission.principal_type,
                   CategoryPermission.principal_id)
        )
    ).all()
    if not perm_rows:
        return set(), {}
    emp = await session.get(Employee, user)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )
    group_ids = await get_user_active_group_ids(session, user, emp_org_path)
    level_by_id = {cid: lvl for cid, _, lvl in rows}
    seeds: dict[int, int] = {
        cid: level_by_id[cid] for cid, ptype, pid in perm_rows
        if (ptype == "user" and pid == user) or (ptype == "group" and pid in group_ids)
    }
    if not seeds:
        return set(), {}
    children_by_parent: dict[int | None, list[int]] = {}
    for cid, pid, _ in rows:
        children_by_parent.setdefault(pid, []).append(cid)
    admin_ids = set(seeds)
    frontier = [c for s in seeds for c in children_by_parent.get(s, [])]
    while frontier:
        admin_ids.update(frontier)
        frontier = [c for f in frontier for c in children_by_parent.get(f, []) if c not in admin_ids]
    return admin_ids, seeds


async def get_effective_role(
    session: AsyncSession, login_id: str, map_id: int
) -> str | None:
    """맵에 대한 사용자 유효 역할. 맵이 없으면 None (caller가 404로 변환).

    None 은 (a) 맵 부재 또는 (b) 접근 권한 없음 두 경우를 의미한다 — 구분이 필요하면
    호출부에서 맵 존재를 별도로 확인한다. assert_map_role 은 단순화를 위해 둘 다 403 처리.
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        return None

    # framework 캔버스 — map_permissions 무시, 카테고리 권한자 체인에서 파생 (design 2026-08-28 §4)
    if found_map.mode == "framework":
        if logic.is_sysadmin(login_id):
            return "owner"
        category_id = await get_framework_category_id(session, map_id)
        if category_id is not None and await is_category_admin(session, login_id, category_id):
            return "editor"
        return "viewer" if found_map.visibility == "public" else None

    emp = await session.get(Employee, login_id)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )

    perm_rows = (
        await session.execute(
            select(
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            ).where(MapPermission.map_id == map_id)
        )
    ).all()
    permissions: list[logic.Permission] = [(p, pid, role) for p, pid, role in perm_rows]

    is_approver = (
        await session.scalar(
            select(MapApprover.user_id).where(
                MapApprover.map_id == map_id, MapApprover.user_id == login_id
            )
        )
    ) is not None

    user_group_ids = await get_user_active_group_ids(session, login_id, emp_org_path)

    return logic.effective_role(
        login_id,
        logic.is_sysadmin(login_id),
        emp_org_path,
        found_map.visibility,
        permissions,
        is_approver,
        user_group_ids,
        owning_department=found_map.owning_department,
    )


async def assert_map_role(
    session: AsyncSession, login_id: str, map_id: int, min_role: str
) -> None:
    """역할 서열이 min_role 미만이면 403, 맵 자체가 없으면 404 (brief §A).

    존재는 하나 권한 부족(private 비가시 포함)은 403 — require_admin과 동일 일관.
    존재 자체를 숨기는 private→404 분기는 도입하지 않는다.
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    role = await get_effective_role(session, login_id, map_id)
    if logic.role_rank(role) < logic.role_rank(min_role):
        raise HTTPException(status_code=403, detail="insufficient permission")


async def get_eligible_users(session: AsyncSession, map_id: int) -> list[Employee]:
    """맵 조회권한(viewer+) 보유 직원 목록 — 담당자(F5)·승인자(AP) 후보 공용.

    공개 맵은 전원 열람이라 모든 직원. 비공개는 effective_role>=viewer 인 직원만.
    데이터(grants·approvers·group 멤버십)는 1회씩만 로드하고 직원별로 순수 effective_role 재사용.
    """
    found_map = await session.get(ProcessMap, map_id)
    # 퇴직자(active=false) 제외 — HR 전환 후 행이 잔류 (design 2026-08-10 §7)
    employees = list(
        (
            await session.scalars(
                select(Employee).where(Employee.active.is_(True)).order_by(Employee.name)
            )
        ).all()
    )
    if found_map is not None and found_map.visibility == "public":
        return employees

    visibility = found_map.visibility if found_map is not None else "private"
    perm_rows = (
        await session.execute(
            select(
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            ).where(MapPermission.map_id == map_id)
        )
    ).all()
    permissions: list[logic.Permission] = [(p, pid, role) for p, pid, role in perm_rows]
    approver_ids = set(
        (
            await session.scalars(select(MapApprover.user_id).where(MapApprover.map_id == map_id))
        ).all()
    )
    # 모든 active 그룹 멤버십 1회 로드 → 직원별 그룹 소속을 메모리에서 판정 (N+1 회피)
    member_rows = (
        await session.execute(
            select(
                UserGroupMember.group_id,
                UserGroupMember.member_type,
                UserGroupMember.member_id,
            )
            .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
            .where(UserGroup.status == "active")
        )
    ).all()
    dept_index = await load_dept_index(session)
    eligible: list[Employee] = []
    for emp in employees:
        emp_org_path = resolve_org_path(emp, dept_index)
        group_ids: set[str] = set()
        for gid, member_type, member_id in member_rows:
            if member_type == "user" and member_id == emp.login_id:
                group_ids.add(str(gid))
            elif member_type == "department" and logic.belongs_to_department(emp_org_path, member_id):
                group_ids.add(str(gid))
        role = logic.effective_role(
            emp.login_id,
            logic.is_sysadmin(emp.login_id),
            emp_org_path,
            visibility,
            permissions,
            emp.login_id in approver_ids,
            group_ids,
            owning_department=found_map.owning_department if found_map is not None else None,
        )
        if role is not None:  # None=접근 불가, 그 외(viewer+)는 후보
            eligible.append(emp)
    return eligible


async def can_view_dashboard_db(session: AsyncSession, login_id: str) -> bool:
    """대시보드 열람 가능 여부 — dashboard_permissions 로딩 후 순수 판정에 위임."""
    if logic.is_sysadmin(login_id):
        return True

    emp = await session.get(Employee, login_id)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )
    rows = (
        await session.execute(
            select(DashboardPermission.principal_type, DashboardPermission.principal_id)
        )
    ).all()
    principals: list[logic.DashboardPrincipal] = [(p, pid) for p, pid in rows]
    user_group_ids = await get_user_active_group_ids(session, login_id, emp_org_path)
    return logic.can_view_dashboard(
        False, login_id, emp_org_path, user_group_ids, principals
    )
