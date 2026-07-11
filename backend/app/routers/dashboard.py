"""운영 대시보드 지표 API — 접속자 현황(login_records)·AI 사용량(ai_usage_events) 집계 (S10, B1)."""

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.models import AiUsageEvent, Employee, LoginRecord, ProcessMap
from app.permissions.deps import require_dashboard_viewer
from app.schemas import (
    AiUsageOut,
    AiUsagePeriodOut,
    AiUsageTopMapOut,
    AiUsageTopUserOut,
    DashboardMetricsOut,
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
