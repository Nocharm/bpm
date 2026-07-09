"""디렉터리 API — 협업자 피커용 인증 사용자 공개 엔드포인트 (Layer 4 Task 0).

/api/employees 는 admin 전용. 이 라우터는 편집자/소유자도 피커 후보를 조회할 수 있도록
인증 사용자(require_admin 제외)에게 공개한다.
Directory endpoint for the collaborator picker — any authenticated user (not admin-only).
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Employee
from app.schemas import DirectoryDeptOut, DirectoryOut, DirectoryUserOut

router = APIRouter(prefix="/api/directory", tags=["directory"])


@router.get("", response_model=DirectoryOut)
async def get_directory(
    _: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DirectoryOut:
    """인증 사용자에게 전 직원 + 부서 org-path 프리픽스 목록 반환.

    Returns all employees + distinct org-path prefixes at each level so the
    collaborator picker can target both leaf teams and parent offices.
    """
    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()

    users = [
        DirectoryUserOut(
            id=emp.login_id,
            name=emp.name,
            department=emp.department,
            title=emp.title,
            org_path="/".join(
                lv
                for lv in (emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5)
                if lv is not None
            ),
            role=emp.role,
            korean_name=emp.korean_name,
            korean_dept=emp.korean_dept,
        )
        for emp in rows
    ]

    # 각 직원의 org 레벨에서 "/" 구분 프리픽스를 모두 수집 (l1, l1/l2, l1/l2/l3, …).
    # org_path(l1,l2,l3,l4,l5, dept) 규약을 그대로 따르되, 각 깊이별 슬라이스를 직접 조합.
    # Collect all "/"-joined org-level prefixes at each depth per employee.
    seen_paths: set[str] = set()
    for emp in rows:
        levels = [lv for lv in (emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5) if lv is not None]
        for i in range(1, len(levels) + 1):
            seen_paths.add("/".join(levels[:i]))

    departments = [
        DirectoryDeptOut(
            id=path,
            name=path.split("/")[-1],  # 리프 세그먼트를 표시명으로 / leaf segment as label
        )
        for path in sorted(seen_paths)
    ]

    return DirectoryOut(users=users, departments=departments)
