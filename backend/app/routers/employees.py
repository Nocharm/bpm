"""직원(employees) 조회 + HR 전체 동기화 — sysadmin 전용 (design 2026-08-10 §5~§9, F6 흡수)."""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.db import get_session
from app.hr.service import SyncTooSoon, build_sync_preview, run_full_sync
from app.models import Employee
from app.permissions.logic import is_sysadmin
from app.schemas import (
    EmployeeOut,
    HrSyncPreviewOut,
    SyncSummaryOut,
)
from app.settings import settings

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeOut])
async def list_employees(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> list[EmployeeOut]:
    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()
    out = []
    for emp in rows:
        item = EmployeeOut.model_validate(emp)
        item.is_sysadmin = is_sysadmin(emp.login_id)
        out.append(item)
    return out


@router.post("/sync", response_model=SyncSummaryOut)
async def sync_employees(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> SyncSummaryOut:
    if not settings.hr_enabled:
        raise HTTPException(status_code=503, detail="HR webhook not configured")
    try:
        summary = await run_full_sync(session)
    except SyncTooSoon as exc:
        raise HTTPException(
            status_code=429, detail=f"sync throttled — retry in {exc.remaining_seconds}s"
        ) from exc
    return SyncSummaryOut(**asdict(summary))


@router.post("/sync-preview", response_model=HrSyncPreviewOut)
async def preview_sync(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> HrSyncPreviewOut:
    """이행 드라이런 — DB 무변경 diff 리포트. 5분 가드 미소모 (design §9 운영 이행 절차 2단계)."""
    if not settings.hr_enabled:
        raise HTTPException(status_code=503, detail="HR webhook not configured")
    return HrSyncPreviewOut(**asdict(await build_sync_preview(session)))
