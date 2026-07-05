"""운영 대시보드 지표 API — 현재는 접속자 현황(login_records 집계), 상세 지표는 후속 (S10)."""

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.models import LoginRecord
from app.schemas import DashboardMetricsOut

router = APIRouter(prefix="/api", tags=["dashboard"], dependencies=[Depends(require_sysadmin)])


@router.get("/dashboard", response_model=DashboardMetricsOut)
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
