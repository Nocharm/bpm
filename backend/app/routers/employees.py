"""직원(employees) 조회 + AD 전체 동기화 — sysadmin 전용 (design 2026-06-16 §6, F6 흡수)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.service import SyncTooSoon, run_full_sync
from app.auth import require_sysadmin
from app.db import get_session
from app.models import Employee
from app.schemas import EmployeeOut, SyncSummaryOut
from app.settings import settings

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeOut])
async def list_employees(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> list[Employee]:
    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()
    return list(rows)


@router.post("/sync", response_model=SyncSummaryOut)
async def sync_employees(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> SyncSummaryOut:
    if not settings.ldap_enabled:
        raise HTTPException(status_code=503, detail="LDAP not configured")
    try:
        summary = await run_full_sync(session)
    except SyncTooSoon as exc:
        raise HTTPException(
            status_code=429, detail=f"sync throttled — retry in {exc.remaining_seconds}s"
        ) from exc
    return SyncSummaryOut(
        scanned=summary.scanned, upserted=summary.upserted, excluded=summary.excluded
    )
