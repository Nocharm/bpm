"""운영 대시보드 지표 API — 접속자 현황(login_records)·AI 사용량(ai_usage_events) 집계 (S10, B1)."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, delete, false, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.models import (
    AiUsageEvent,
    CheckoutRequest,
    Comment,
    DashboardCoverageDept,
    DashboardPermission,
    DeptInfo,
    Employee,
    LoginRecord,
    MapVersion,
    Notification,
    ProcessMap,
    UserGroup,
    VersionEvent,
)
from app.permissions.deps import require_dashboard_viewer
from app.permissions.logic import belongs_to_department
from app.schemas import (
    AiUsageOut,
    AiUsagePeriodOut,
    AiUsageTopMapOut,
    AiUsageTopUserOut,
    CoverageDeptsIn,
    CoverageDeptsOut,
    DashboardCoverageOut,
    DashboardCoverageRowOut,
    DashboardEventOut,
    DashboardMapCountsOut,
    DashboardMetricsOut,
    DashboardOpsOut,
    DashboardPermissionIn,
    DashboardPermissionOut,
    DashboardSummaryOut,
    DashboardVersionStatusOut,
)

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get(
    "/dashboard",
    response_model=DashboardMetricsOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_dashboard(session: AsyncSession = Depends(get_session)) -> DashboardMetricsOut:
    """접속자 현황 — 고유 접속자·전체 로그인·최근 7일 로그인 (login_records 집계)."""
    since = now_kst() - timedelta(days=7)
    visitors = await session.scalar(select(func.count(func.distinct(LoginRecord.login_id))))
    total = await session.scalar(select(func.count()).select_from(LoginRecord))
    last7 = await session.scalar(
        select(func.count()).select_from(LoginRecord).where(LoginRecord.occurred_at >= since)
    )
    return DashboardMetricsOut(
        visitors_unique=visitors or 0,
        logins_total=total or 0,
        logins_7d=last7 or 0,
    )


@router.get(
    "/dashboard/ai-usage",
    response_model=AiUsageOut,
    dependencies=[Depends(require_sysadmin)],  # AI 토큰·비용은 sysadmin 전용 유지
)
async def get_ai_usage(session: AsyncSession = Depends(get_session)) -> AiUsageOut:
    """AI 호출 사용량 — 7/30일 합계와 30일 상위 사용자/맵 (ai_usage_events 집계)."""

    async def period(days: int) -> AiUsagePeriodOut:
        since = now_kst() - timedelta(days=days)
        row = (
            await session.execute(
                select(
                    func.count().label("calls"),
                    func.sum(case((AiUsageEvent.ok.is_(False), 1), else_=0)).label("failed"),
                    func.coalesce(func.sum(AiUsageEvent.prompt_tokens), 0).label("prompt"),
                    func.coalesce(func.sum(AiUsageEvent.completion_tokens), 0).label("completion"),
                ).where(AiUsageEvent.occurred_at >= since)
            )
        ).one()
        return AiUsagePeriodOut(
            calls=row.calls or 0, failed=row.failed or 0,
            prompt_tokens=row.prompt or 0, completion_tokens=row.completion or 0,
        )

    since30 = now_kst() - timedelta(days=30)
    total_expr = func.coalesce(func.sum(AiUsageEvent.prompt_tokens), 0) + func.coalesce(
        func.sum(AiUsageEvent.completion_tokens), 0
    )
    user_rows = (
        await session.execute(
            select(AiUsageEvent.login_id, func.count().label("calls"), total_expr.label("total"))
            .where(AiUsageEvent.occurred_at >= since30)
            .group_by(AiUsageEvent.login_id)
            .order_by(total_expr.desc())
            .limit(5)
        )
    ).all()
    # 이름 해석 — Employee 스냅샷(없으면 login_id)
    names = {
        emp.login_id: emp.name
        for emp in (
            await session.scalars(
                select(Employee).where(Employee.login_id.in_([r.login_id for r in user_rows]))
            )
        ).all()
    }
    map_rows = (
        await session.execute(
            select(AiUsageEvent.map_id, func.count().label("calls"), total_expr.label("total"))
            .where(AiUsageEvent.occurred_at >= since30)
            .group_by(AiUsageEvent.map_id)
            .order_by(total_expr.desc())
            .limit(5)
        )
    ).all()
    map_names = {
        m.id: m.name
        for m in (
            await session.scalars(
                select(ProcessMap).where(ProcessMap.id.in_([r.map_id for r in map_rows]))
            )
        ).all()
    }
    return AiUsageOut(
        last7=await period(7),
        last30=await period(30),
        top_users=[
            AiUsageTopUserOut(
                login_id=r.login_id, name=names.get(r.login_id) or r.login_id,
                calls=r.calls, total_tokens=r.total or 0,
            )
            for r in user_rows
        ],
        top_maps=[
            AiUsageTopMapOut(
                map_id=r.map_id, name=map_names.get(r.map_id) or "(deleted)",
                calls=r.calls, total_tokens=r.total or 0,
            )
            for r in map_rows
        ],
    )


async def _resolve_display_name(
    session: AsyncSession, principal_type: str, principal_id: str
) -> str:
    """principal → 사람이 읽는 표시명. 해석 실패 시 principal_id 그대로."""
    if principal_type == "user":
        emp = await session.get(Employee, principal_id)
        return emp.name if emp else principal_id
    if principal_type == "department":
        leaf = principal_id.rsplit("/", maxsplit=1)[-1]
        info = await session.get(DeptInfo, leaf)
        return info.korean_name if info and info.korean_name else leaf
    if principal_type == "group":
        group = await session.get(UserGroup, int(principal_id)) if principal_id.isdigit() else None
        return group.name if group else principal_id
    return principal_id


async def _to_permission_out(
    session: AsyncSession, row: DashboardPermission
) -> DashboardPermissionOut:
    """권한 행 → 응답 스키마. 표시명 해석을 한 곳에 모은다."""
    return DashboardPermissionOut(
        id=row.id,
        principal_type=row.principal_type,
        principal_id=row.principal_id,
        display_name=await _resolve_display_name(session, row.principal_type, row.principal_id),
        granted_by=row.granted_by,
        granted_at=row.granted_at,
    )


@router.get(
    "/dashboard/permissions",
    response_model=list[DashboardPermissionOut],
    dependencies=[Depends(require_sysadmin)],
)
async def list_dashboard_permissions(
    session: AsyncSession = Depends(get_session),
) -> list[DashboardPermissionOut]:
    rows = (
        await session.scalars(
            select(DashboardPermission).order_by(DashboardPermission.granted_at.desc())
        )
    ).all()
    return [await _to_permission_out(session, row) for row in rows]


@router.post(
    "/dashboard/permissions",
    response_model=DashboardPermissionOut,
    status_code=201,
    dependencies=[Depends(require_sysadmin)],
)
async def add_dashboard_permission(
    body: DashboardPermissionIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DashboardPermissionOut:
    existing = await session.scalar(
        select(DashboardPermission.id).where(
            DashboardPermission.principal_type == body.principal_type,
            DashboardPermission.principal_id == body.principal_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="grant already exists")
    row = DashboardPermission(
        principal_type=body.principal_type,
        principal_id=body.principal_id,
        granted_by=login_id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return await _to_permission_out(session, row)


@router.delete(
    "/dashboard/permissions/{permission_id}",
    status_code=204,
    dependencies=[Depends(require_sysadmin)],
)
async def delete_dashboard_permission(
    permission_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    row = await session.get(DashboardPermission, permission_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"permission {permission_id} not found")
    await session.delete(row)
    await session.commit()


@router.get(
    "/dashboard/coverage-depts",
    response_model=CoverageDeptsOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_coverage_depts(session: AsyncSession = Depends(get_session)) -> CoverageDeptsOut:
    rows = (
        await session.scalars(
            select(DashboardCoverageDept).order_by(DashboardCoverageDept.org_path)
        )
    ).all()
    return CoverageDeptsOut(org_paths=[row.org_path for row in rows])


@router.put(
    "/dashboard/coverage-depts",
    response_model=CoverageDeptsOut,
    dependencies=[Depends(require_sysadmin)],
)
async def set_coverage_depts(
    body: CoverageDeptsIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CoverageDeptsOut:
    """목록 통째 교체 — 멱등. 부분 갱신 API는 두지 않는다(우측 사이드바가 항상 전체를 보낸다)."""
    await session.execute(delete(DashboardCoverageDept))
    wanted = sorted({path.strip() for path in body.org_paths if path.strip()})
    for path in wanted:
        session.add(DashboardCoverageDept(org_path=path, added_by=login_id))
    await session.commit()
    return CoverageDeptsOut(org_paths=wanted)


_VERSION_STATUSES = ("published", "draft", "approved", "pending", "rejected")
_RECENT_EVENT_LIMIT = 10  # 좌측 이벤트 리스트에 담기는 최대 건수


@router.get(
    "/dashboard/summary",
    response_model=DashboardSummaryOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_dashboard_summary(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DashboardSummaryOut:
    """기간 무관 스냅샷 — 맵 현황·버전 상태·부서 커버리지·운영 항목·최근 이벤트."""
    live_maps = (
        await session.scalars(select(ProcessMap).where(ProcessMap.deleted_at.is_(None)))
    ).all()
    live_ids = [m.id for m in live_maps]
    trashed = await session.scalar(
        select(func.count()).select_from(ProcessMap).where(ProcessMap.deleted_at.is_not(None))
    )

    # 버전 status 집계 — 미삭제 맵의 버전만.
    # 맵이 하나도 없을 때 in_([])를 쓰면 SQLAlchemy가 경고를 내므로 명시적 거짓 조건(false())을 준다.
    status_rows = (
        await session.execute(
            select(MapVersion.map_id, MapVersion.status).where(
                MapVersion.map_id.in_(live_ids) if live_ids else false()
            )
        )
    ).all()
    status_counts = {status: 0 for status in _VERSION_STATUSES}
    maps_with_status: dict[str, set[int]] = {status: set() for status in _VERSION_STATUSES}
    for map_id, status in status_rows:
        if status in status_counts:
            status_counts[status] += 1
            maps_with_status[status].add(map_id)

    # 부서 커버리지 — 지정 부서별로 하위 포함 매칭 (belongs_to_department 규약)
    dept_paths = [
        row.org_path
        for row in (
            await session.scalars(
                select(DashboardCoverageDept).order_by(DashboardCoverageDept.org_path)
            )
        ).all()
    ]
    korean = {
        info.department: info.korean_name
        for info in (await session.scalars(select(DeptInfo))).all()
    }
    coverage_rows: list[DashboardCoverageRowOut] = []
    for path in dept_paths:
        owned = [
            m
            for m in live_maps
            if m.owning_department
            and belongs_to_department(m.owning_department, path)
        ]
        leaf = path.rsplit("/", maxsplit=1)[-1]
        coverage_rows.append(
            DashboardCoverageRowOut(
                org_path=path,
                name=korean.get(leaf) or leaf,
                maps=len(owned),
                published=sum(
                    1 for m in owned if m.id in maps_with_status["published"]
                ),
            )
        )
    coverage_rows.sort(key=lambda row: (-row.maps, row.org_path))
    with_map = sum(1 for row in coverage_rows if row.maps > 0)
    coverage = DashboardCoverageOut(
        depts_total=len(dept_paths),
        depts_with_map=with_map,
        coverage_pct=round(with_map / len(dept_paths) * 100) if dept_paths else 0,
        rows=coverage_rows,
    )

    ops = DashboardOpsOut(
        unresolved_comments=await session.scalar(
            select(func.count()).select_from(Comment).where(Comment.resolved.is_(False))
        )
        or 0,
        unread_notifications=await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient == login_id, Notification.read.is_(False))
        )
        or 0,
        pending_checkouts=await session.scalar(
            select(func.count())
            .select_from(CheckoutRequest)
            .where(CheckoutRequest.status == "pending")
        )
        or 0,
    )

    event_rows = (
        await session.execute(
            select(VersionEvent, MapVersion, ProcessMap)
            .join(MapVersion, MapVersion.id == VersionEvent.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .order_by(VersionEvent.created_at.desc())
            .limit(_RECENT_EVENT_LIMIT)
        )
    ).all()
    actor_names = {
        emp.login_id: emp.name
        for emp in (
            await session.scalars(
                select(Employee).where(
                    Employee.login_id.in_([event.actor for event, _, _ in event_rows])
                )
            )
        ).all()
    }
    recent_events = [
        DashboardEventOut(
            event_type=event.event_type,
            map_name=found_map.name,
            version_label=version.label,
            actor_name=actor_names.get(event.actor) or event.actor,
            created_at=event.created_at,
        )
        for event, version, found_map in event_rows
    ]

    return DashboardSummaryOut(
        generated_at=now_kst(),
        maps=DashboardMapCountsOut(
            total=len(live_maps),
            published=len(maps_with_status["published"]),
            draft=len(maps_with_status["draft"]),
            trashed=trashed or 0,
        ),
        version_status=DashboardVersionStatusOut(**status_counts),
        coverage=coverage,
        ops=ops,
        recent_events=recent_events,
    )
