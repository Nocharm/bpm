"""디렉터리 API — 협업자 피커용 인증 사용자 공개 엔드포인트 (Layer 4 Task 0).

/api/employees 는 admin 전용. 이 라우터는 편집자/소유자도 피커 후보를 조회할 수 있도록
인증 사용자(require_admin 제외)에게 공개한다.
Directory endpoint for the collaborator picker — any authenticated user (not admin-only).
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_exposed_positions
from app.auth import get_current_user
from app.db import get_session
from app.models import Employee
from app.orgchart import load_dept_index, resolve_org_path, resolve_org_prefixes
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
    # 퇴직자(active=false) 제외 — HR 전환 후 행이 잔류 (design 2026-08-10 §7)
    rows = (
        await session.scalars(
            select(Employee).where(Employee.active.is_(True)).order_by(Employee.login_id)
        )
    ).all()

    dept_index = await load_dept_index(session)
    exposed = set(await get_exposed_positions(session))
    # 직원별 조직 경로 — resolver(departments 체인 우선, org 컬럼 폴백) 1회씩 (design 2026-08-11 §2)
    org_paths = {emp.login_id: resolve_org_path(emp, dept_index) for emp in rows}

    users = [
        DirectoryUserOut(
            id=emp.login_id,
            name=emp.name,
            department=emp.department,
            title=emp.title,
            org_path=org_paths[emp.login_id],
            role=emp.role,
            korean_name=emp.korean_name,
            korean_dept=emp.korean_dept,
            position=emp.position if emp.position and emp.position in exposed else "",
        )
        for emp in rows
    ]

    # 각 직원의 조직 경로에서 "/" 구분 프리픽스를 모두 수집 (l1, l1/l2, l1/l2/l3, …).
    # Collect all "/"-joined org-level prefixes at each depth per employee.
    seen_paths: set[str] = set()
    for path in org_paths.values():
        seen_paths.update(resolve_org_prefixes(path))

    departments = []
    for path in sorted(seen_paths):
        leaf = path.split("/")[-1]  # 리프 세그먼트를 표시명으로 / leaf segment as label
        departments.append(
            DirectoryDeptOut(
                id=path,
                name=leaf,
                korean_name=dept_index.name_ko_by_name.get(leaf, ""),
            )
        )

    return DirectoryOut(users=users, departments=departments)
