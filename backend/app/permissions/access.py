"""DB-aware effective-role 해석 — 순수 logic.py에 DB 로딩을 더한 얇은 래퍼.

logic.effective_role 는 입력값을 받는 순수 함수. 이 모듈이 map/employee/permissions/
approver 를 DB에서 로드해 그 입력을 채우고, 게이트용 assert 헬퍼를 제공한다.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from app.models import (
    Employee,
    MapApprover,
    MapPermission,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
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

    emp = await session.get(Employee, login_id)
    emp_org_path = (
        logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
        if emp is not None
        else ""
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
