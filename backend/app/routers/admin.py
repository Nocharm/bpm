"""관리 콘솔 API — sysadmin-only 직원·부서 디렉터리 (Layer 4 Task 0b).

/api/directory (피커용)보다 풍부한 필드를 반환하되, sysadmin 만 접근 가능.
Admin console directory — richer fields than /api/directory, sysadmin-gated.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, Text, asc, cast, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Base, Employee
from app.permissions.logic import is_sysadmin
from app.schemas import (
    AdminDeptOut,
    AdminDirectoryOut,
    AdminUserOut,
    DeptKoreanDeptIn,
    DeptKoreanDeptOut,
    TableDataOut,
    TableInfoOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 테이블 뷰어 페이지 크기 — 기본 50, 상한 200 (대량 테이블 보호) / page-size bounds.
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


@router.get("/users", response_model=AdminDirectoryOut)
async def get_admin_users(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AdminDirectoryOut:
    """sysadmin 전용 — 전 직원 + 부서 목록 (영문, 풍부한 필드).

    Sysadmin-only. Returns all employees with org_levels + per-user is_sysadmin flag
    + real active status (from AD userAccountControl, Task 2), plus a derived department list.
    """
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")

    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()

    users: list[AdminUserOut] = []
    # Track distinct leaf org-paths for department list.
    # Key = tuple of non-null levels (unique leaf path); value = list[str] of levels.
    seen_leaves: dict[tuple[str, ...], list[str]] = {}

    for emp in rows:
        levels = [lv for lv in (emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5) if lv is not None]
        users.append(
            AdminUserOut(
                login_id=emp.login_id,
                name=emp.name,
                department=emp.department,
                role=emp.role,
                is_sysadmin=is_sysadmin(emp.login_id),
                org_levels=levels,
                active=emp.active,
                korean_name=emp.korean_name,
                korean_dept=emp.korean_dept,
            )
        )
        if levels:
            key = tuple(levels)
            if key not in seen_leaves:
                seen_leaves[key] = levels

    departments = [
        AdminDeptOut(name=levels[-1] if levels else "", org_levels=levels)
        for levels in sorted(seen_leaves.values(), key=lambda lv: lv)
    ]

    return AdminDirectoryOut(users=users, departments=departments)


@router.put("/departments/korean-dept", response_model=DeptKoreanDeptOut)
async def set_department_korean_dept(
    payload: DeptKoreanDeptIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeptKoreanDeptOut:
    """부서(org 경로 정확 일치) 전원의 korean_dept 덮어쓰기 — sysadmin 전용."""
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")
    korean_dept = payload.korean_dept.strip()
    if not korean_dept or not payload.org_levels:
        raise HTTPException(status_code=422, detail="org_levels and korean_dept required")
    target = tuple(payload.org_levels)
    rows = (await session.scalars(select(Employee))).all()
    updated = 0
    for emp in rows:
        levels = tuple(
            lv
            for lv in (emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5)
            if lv is not None
        )
        if levels == target:
            emp.korean_dept = korean_dept
            updated += 1
    await session.commit()
    return DeptKoreanDeptOut(updated=updated)


def _require_sysadmin(login_id: str) -> None:
    """공통 게이트 — sysadmin 아니면 403 / Shared gate: 403 unless sysadmin."""
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")


@router.get("/tables", response_model=list[TableInfoOut])
async def list_tables(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TableInfoOut]:
    """sysadmin 전용 — 등록된 모든 테이블 이름 + 행수(읽기전용 COUNT). 뷰어 선택 pill 표시용.

    Sysadmin-only. Names come from SQLAlchemy metadata (no DDL, no schema change);
    each count is a plain SELECT COUNT(*).
    """
    _require_sysadmin(login_id)
    out: list[TableInfoOut] = []
    for name in sorted(Base.metadata.tables.keys()):
        table = Base.metadata.tables[name]
        count = (await session.execute(select(func.count()).select_from(table))).scalar_one()
        out.append(TableInfoOut(name=name, count=count))
    return out


@router.get("/tables/{name}", response_model=TableDataOut)
async def read_table(
    name: str,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    sort: str | None = Query(None),
    order: str = Query("asc"),
    q: str | None = Query(None),
) -> TableDataOut:
    """sysadmin 전용 — 선택 테이블의 행을 서버측 페이징/정렬/필터로 반환 (읽기전용 SELECT).

    Sysadmin-only, read-only. Safe by construction: table & sort columns are validated
    against SQLAlchemy metadata; `q` is bound (no SQL injection); only SELECT is issued.
    """
    _require_sysadmin(login_id)

    # 테이블명 검증 — 메타데이터에 있는 테이블만 (임의 SQL 차단) / validate against metadata.
    table = Base.metadata.tables.get(name)
    if table is None:
        raise HTTPException(status_code=404, detail="unknown table")

    columns = [c.name for c in table.columns]

    # 필터 — 문자열 컬럼에 대해서만 ILIKE(OR). q는 바인드 파라미터 / text-column ILIKE, q is bound.
    where = None
    if q:
        text_cols = [c for c in table.columns if isinstance(c.type, (String, Text))]
        if text_cols:
            where = or_(*[cast(c, String).ilike(f"%{q}%") for c in text_cols])

    count_stmt = select(func.count()).select_from(table)
    if where is not None:
        count_stmt = count_stmt.where(where)
    total = (await session.execute(count_stmt)).scalar_one()

    stmt = select(table)
    if where is not None:
        stmt = stmt.where(where)
    # 정렬 — sort 컬럼은 실제 컬럼만 허용, 아니면 PK(없으면 무정렬) / validate sort col.
    if sort and sort in columns:
        col = table.c[sort]
        stmt = stmt.order_by(desc(col) if order == "desc" else asc(col))
    elif table.primary_key.columns:
        stmt = stmt.order_by(*table.primary_key.columns)
    stmt = stmt.limit(size).offset((page - 1) * size)

    result = (await session.execute(stmt)).mappings().all()
    rows = [dict(row) for row in result]
    return TableDataOut(columns=columns, rows=rows, total=total, page=page, size=size)
