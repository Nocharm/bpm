"""직원(employees) 조회 + AD 전체 동기화 — sysadmin 전용 (design 2026-06-16 §6, F6 흡수)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.service import SyncTooSoon, run_full_sync
from app.auth import require_sysadmin
from app.db import get_session
from app.models import Employee
from app.schemas import (
    EmployeeOut,
    KoreanNamesImportIn,
    KoreanNamesImportOut,
    SyncSummaryOut,
)
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


@router.put("/korean-names", response_model=KoreanNamesImportOut)
async def import_korean_names(
    payload: KoreanNamesImportIn,
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> KoreanNamesImportOut:
    """한글이름 일괄 등록 — AD 미제공 필드. 서버가 mode 판정(클라이언트 diff 미신뢰)."""
    updated = 0
    skipped = 0
    unknown: list[str] = []
    for login_id, raw_name in payload.entries.items():
        name = raw_name.strip()
        if not name:
            continue  # 빈 값은 이름 삭제가 아니라 미기입 — 무시
        emp = await session.get(Employee, login_id)
        if emp is None:
            unknown.append(login_id)
            continue
        if emp.korean_name and payload.mode == "skip":
            skipped += 1
            continue
        emp.korean_name = name
        updated += 1
    await session.commit()
    return KoreanNamesImportOut(updated=updated, skipped=skipped, unknown=unknown)
