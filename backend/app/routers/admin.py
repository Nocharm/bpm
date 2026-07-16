"""관리 콘솔 API — sysadmin-only 직원·부서 디렉터리 (Layer 4 Task 0b).

/api/directory (피커용)보다 풍부한 필드를 반환하되, sysadmin 만 접근 가능.
Admin console directory — richer fields than /api/directory, sysadmin-gated.
"""

from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, Text, and_, asc, cast, delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import KST
from app.db import get_session
from app.models import Base, DeptInfo, Employee, MapPermission, Notification, UserGroupMember
from app.permissions.logic import is_sysadmin, role_rank
from app.schemas import (
    AdminDeptOut,
    AdminDirectoryOut,
    AdminUserOut,
    DeptInfoImportIn,
    DeptInfoImportOut,
    DeptRemapIn,
    DeptRemapItemOut,
    DeptRemapOut,
    NotificationBulkDeleteOut,
    NotificationPurgeGroupOut,
    NotificationPurgeIn,
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

    # dept_info 조인 — 임포트된 한글 부서명·부서장 (리프명 키)
    infos = {d.department: d for d in (await session.scalars(select(DeptInfo))).all()}
    departments = []
    for levels in sorted(seen_leaves.values(), key=lambda lv: lv):
        leaf = levels[-1] if levels else ""
        info = infos.get(leaf)
        departments.append(
            AdminDeptOut(
                name=leaf,
                org_levels=levels,
                korean_name=info.korean_name if info else "",
                manager=info.manager if info else "",
            )
        )

    return AdminDirectoryOut(users=users, departments=departments)


def _require_sysadmin(login_id: str) -> None:
    """공통 게이트 — sysadmin 아니면 403 / Shared gate: 403 unless sysadmin."""
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")


async def _load_valid_org_paths(session: AsyncSession) -> set[str]:
    """현 employees org 레벨에서 파생되는 모든 경로 프리픽스 — /api/directory 파생과 동일 규약."""
    rows = (
        await session.execute(
            select(Employee.org_l1, Employee.org_l2, Employee.org_l3, Employee.org_l4, Employee.org_l5)
        )
    ).all()
    paths: set[str] = set()
    for level_row in rows:
        levels = [lv for lv in level_row if lv is not None]
        for i in range(1, len(levels) + 1):
            paths.add("/".join(levels[:i]))
    return paths


@router.get("/dept-remap", response_model=list[DeptRemapItemOut])
async def list_missing_dept_refs(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[DeptRemapItemOut]:
    """sysadmin 전용 — 현 조직에 없는 부서 경로를 참조 중인 맵 권한·그룹 멤버 집계 (조직개편 잔재)."""
    _require_sysadmin(login_id)
    valid = await _load_valid_org_paths(session)
    grant_counts = dict(
        (
            await session.execute(
                select(MapPermission.principal_id, func.count())
                .where(MapPermission.principal_type == "department")
                .group_by(MapPermission.principal_id)
            )
        ).all()
    )
    member_counts = dict(
        (
            await session.execute(
                select(UserGroupMember.member_id, func.count())
                .where(UserGroupMember.member_type == "department")
                .group_by(UserGroupMember.member_id)
            )
        ).all()
    )
    missing = sorted((set(grant_counts) | set(member_counts)) - valid)
    return [
        DeptRemapItemOut(
            path=path,
            map_grants=grant_counts.get(path, 0),
            group_members=member_counts.get(path, 0),
        )
        for path in missing
    ]


@router.post("/dept-remap", response_model=DeptRemapOut)
async def remap_dept_refs(
    payload: DeptRemapIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeptRemapOut:
    """sysadmin 전용 — from_path를 참조하는 맵 권한·그룹 멤버를 to_path(현존 경로)로 일괄 이동.

    대상에 같은 부서 행이 이미 있으면 병합 — 맵 권한은 높은 역할 유지, 그룹 멤버는 중복 제거.
    """
    _require_sysadmin(login_id)
    valid = await _load_valid_org_paths(session)
    if payload.to_path not in valid:
        raise HTTPException(status_code=422, detail="to_path is not a current department path")

    grants = (
        await session.scalars(
            select(MapPermission).where(
                MapPermission.principal_type == "department",
                MapPermission.principal_id == payload.from_path,
            )
        )
    ).all()
    moved_grants = 0
    for grant in grants:
        dup = await session.scalar(
            select(MapPermission).where(
                MapPermission.map_id == grant.map_id,
                MapPermission.principal_type == "department",
                MapPermission.principal_id == payload.to_path,
            )
        )
        if dup is not None:
            if role_rank(grant.role) > role_rank(dup.role):
                dup.role = grant.role
            await session.delete(grant)
        else:
            grant.principal_id = payload.to_path
        moved_grants += 1

    members = (
        await session.scalars(
            select(UserGroupMember).where(
                UserGroupMember.member_type == "department",
                UserGroupMember.member_id == payload.from_path,
            )
        )
    ).all()
    moved_members = 0
    for member in members:
        dup = await session.scalar(
            select(UserGroupMember).where(
                UserGroupMember.group_id == member.group_id,
                UserGroupMember.member_type == "department",
                UserGroupMember.member_id == payload.to_path,
            )
        )
        if dup is not None:
            await session.delete(member)
        else:
            member.member_id = payload.to_path
        moved_members += 1

    await session.commit()
    return DeptRemapOut(map_grants=moved_grants, group_members=moved_members)


@router.put("/dept-info", response_model=DeptInfoImportOut)
async def import_dept_info(
    payload: DeptInfoImportIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DeptInfoImportOut:
    """부서 한글명·부서장 일괄 등록 — 현존 부서만 반영, 미존재는 unknown.

    현존 판정에 org_l1~l5를 모두 포함한다: 조직도 tree는 본부·실까지 담고, 상위 레벨
    dept_info가 있어야 /api/me의 상위 부서장 체인과 피커의 상위 부서 한글 검색이 산다.
    """
    _require_sysadmin(login_id)
    rows = await session.execute(
        select(
            Employee.org_l1,
            Employee.org_l2,
            Employee.org_l3,
            Employee.org_l4,
            Employee.org_l5,
            Employee.department,
        ).distinct()
    )
    known = {name for row in rows for name in row if name}
    updated = 0
    unknown: list[str] = []
    for dept_name, entry in payload.entries.items():
        korean = entry.korean_name.strip()
        manager = entry.manager.strip()
        if not korean and not manager:
            continue  # 둘 다 빈 항목은 통째로 무시 — 삭제 기능 아님
        if dept_name not in known:
            unknown.append(dept_name)
            continue
        info = await session.get(DeptInfo, dept_name)
        if info is None:
            info = DeptInfo(department=dept_name)
            session.add(info)
        # 빈 필드는 미기입 — 기존 값을 지우지 않는다 (korean-names의 dept 보존 규칙과 동일)
        if korean:
            info.korean_name = korean
        if manager:
            info.manager = manager
        updated += 1
    await session.commit()
    return DeptInfoImportOut(updated=updated, unknown=unknown)


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


def _build_kst_range(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    """[from 00:00, to+1일 00:00) KST — to 날짜 하루 전체 포함."""
    start = datetime.combine(from_date, time.min, tzinfo=KST)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=KST)
    return start, end


@router.get("/notifications/purge-preview", response_model=list[NotificationPurgeGroupOut])
async def preview_notification_purge(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
) -> list[NotificationPurgeGroupOut]:
    """sysadmin 전용 — 기간 내 알림을 (type, message)로 묶어 검토 목록 반환 (last_at desc)."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(from_date, to_date)
    rows = await session.execute(
        select(
            Notification.type,
            Notification.message,
            func.count(),
            func.min(Notification.created_at),
            func.max(Notification.created_at),
        )
        .where(Notification.created_at >= start, Notification.created_at < end)
        .group_by(Notification.type, Notification.message)
        .order_by(func.max(Notification.created_at).desc())
    )
    return [
        NotificationPurgeGroupOut(type=r[0], message=r[1], count=r[2], first_at=r[3], last_at=r[4])
        for r in rows.all()
    ]


@router.post("/notifications/purge", response_model=NotificationBulkDeleteOut)
async def purge_notifications(
    payload: NotificationPurgeIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """sysadmin 전용 — 확정된 (type, message) 묶음의 기간 내 전 수신자 행 하드 삭제."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(payload.from_date, payload.to_date)
    group_match = or_(
        *[
            and_(Notification.type == g.type, Notification.message == g.message)
            for g in payload.groups
        ]
    )
    result = await session.execute(
        delete(Notification).where(
            Notification.created_at >= start, Notification.created_at < end, group_match
        )
    )
    await session.commit()
    return NotificationBulkDeleteOut(deleted=max(result.rowcount, 0))
