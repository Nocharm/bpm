"""HR 웹훅 동기화 서비스 — 전체/단건 동기화·부서 미러·이행 프리뷰.

설계: docs/design/2026-08-10-hr-webhook-directory-design.md §4~§6·§9.
title은 절대 건드리지 않는다 — AD title 패스(app/ad/service.refresh_titles) 전용.
"""

import logging
import time
from dataclasses import dataclass, field

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.hr import client
from app.hr.client import RawHrEmployee
from app.models import Department, DeptInfo, Employee
from app.settings import settings

logger = logging.getLogger(__name__)

_DELETE_CHUNK = 500  # SQLite IN 바인드 상한(구버전 999) 아래로 유지 (§5-3)


@dataclass(frozen=True)
class HrEmployeeFields:
    login_id: str
    name: str
    korean_name: str | None  # None = HR 결측 → 기존값 보존(소거 아님)
    korean_dept: str | None
    dept_code: str | None
    department: str
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    org_l4: str | None
    org_l5: str | None
    active: bool
    role: str
    dept_mismatch: bool  # department != 저장 경로 리프 — 부서 권한 매칭 사각 리포트용 (§4)
    truncated: bool      # orgLevels 6단계 이상 절사 리포트용


def _resolve_role(login_id: str) -> str:
    return "admin" if login_id in settings.admin_login_ids() else "user"


def to_employee_fields(raw: RawHrEmployee) -> HrEmployeeFields:
    """RawHrEmployee → 저장 필드. 순수 — DB 미접근. 매핑 표는 설계 §4."""
    top5 = raw.org_levels[:5]  # 5레벨 초과는 루트 쪽 5개 (AD parse_org와 동일 규약)
    l1 = top5[0] if len(top5) > 0 else None
    l2 = top5[1] if len(top5) > 1 else None
    l3 = top5[2] if len(top5) > 2 else None
    l4 = top5[3] if len(top5) > 3 else None
    l5 = top5[4] if len(top5) > 4 else None
    stored_leaf = l5 or l4 or l3 or l2 or l1
    department = raw.department or stored_leaf or ""
    return HrEmployeeFields(
        login_id=raw.login_id,
        name=raw.name or raw.login_id,
        korean_name=raw.name_ko,
        korean_dept=raw.department_ko,
        dept_code=raw.dept_code,
        department=department,
        org_l1=l1, org_l2=l2, org_l3=l3, org_l4=l4, org_l5=l5,
        # status 결측은 보수적으로 활성 — AD uac None 관례와 동일
        active=(raw.status or "active") == "active",
        role=_resolve_role(raw.login_id),
        dept_mismatch=bool(department and stored_leaf and department != stored_leaf),
        truncated=len(raw.org_levels) > 5,
    )


def _chunks(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


@dataclass(frozen=True)
class HrSyncSummary:
    scanned: int = 0
    upserted: int = 0
    deactivated: int = 0
    deleted: int = 0
    skipped: int = 0
    org_mismatches: int = 0
    truncated_levels: int = 0
    departments_upserted: int = 0
    dept_info_orphans: list[str] = field(default_factory=list)
    title_refreshed: int | None = None
    aborted_reason: str | None = None


async def _upsert(session: AsyncSession, fields: HrEmployeeFields) -> bool:
    """HR 필드 upsert — 반환: 이번 호출로 활성→비활성 전환됐는지(리컨사일 대상)."""
    emp = await session.get(Employee, fields.login_id)
    if emp is None:
        emp = Employee(login_id=fields.login_id, source="hr")
        session.add(emp)
    was_active = bool(emp.active)
    emp.source = "hr"  # 레거시 'ad' 행도 HR 관리로 전환 (§5-1)
    emp.name = fields.name
    emp.role = fields.role
    emp.department = fields.department
    emp.dept_code = fields.dept_code
    emp.org_l1 = fields.org_l1
    emp.org_l2 = fields.org_l2
    emp.org_l3 = fields.org_l3
    emp.org_l4 = fields.org_l4
    emp.org_l5 = fields.org_l5
    if fields.korean_name is not None:
        emp.korean_name = fields.korean_name
    if fields.korean_dept is not None:
        emp.korean_dept = fields.korean_dept
    # emp.title 미터치 — AD title 패스 전용 (§4)
    emp.active = fields.active
    return was_active and not fields.active


async def sync_all(session: AsyncSession) -> HrSyncSummary:
    """전수 스냅샷 동기화 — 사전 계산 후 일괄 반영. 중단(abort) 시 DB 무변경."""
    count, parsed = await client.fetch_all_employees()
    scanned = len(parsed)
    skipped = sum(1 for p in parsed if p is None)
    if count and count != scanned:
        return HrSyncSummary(scanned=scanned, skipped=skipped,
                             aborted_reason=f"count mismatch: header {count} != rows {scanned}")

    fields_by_id: dict[str, HrEmployeeFields] = {}
    for raw in parsed:
        if raw is not None:
            fields_by_id[raw.login_id] = to_employee_fields(raw)  # 중복 loginId는 마지막 행 우선
    org_mismatches = sum(1 for f in fields_by_id.values() if f.dept_mismatch)
    truncated_levels = sum(1 for f in fields_by_id.values() if f.truncated)

    existing = (await session.execute(select(Employee.login_id, Employee.source))).all()
    managed_ids = {lid for lid, src in existing if src in ("ad", "hr")}
    delete_ids = sorted(managed_ids - fields_by_id.keys())
    cap = settings.hr_sync_delete_cap_pct
    if cap > 0 and managed_ids and len(delete_ids) * 100 > cap * len(managed_ids):
        return HrSyncSummary(
            scanned=scanned, skipped=skipped, org_mismatches=org_mismatches,
            truncated_levels=truncated_levels,
            aborted_reason=(
                f"delete cap exceeded: would delete {len(delete_ids)}/{len(managed_ids)} managed rows"
            ),
        )

    deactivated_now: set[str] = set()
    for fields in fields_by_id.values():
        if await _upsert(session, fields):
            deactivated_now.add(fields.login_id)

    for chunk in _chunks(delete_ids, _DELETE_CHUNK):
        await session.execute(delete(Employee).where(Employee.login_id.in_(chunk)))

    departed = deactivated_now | set(delete_ids)
    if departed:
        await workflow.reconcile_departures(session, departed)

    departments_upserted = await _mirror_departments(session)
    dept_info_orphans = await _find_dept_info_orphans(session)
    await session.commit()

    title_refreshed: int | None = None
    if settings.ldap_enabled:
        try:
            from app.ad.service import refresh_titles  # Task 6 신설 — 지연 import(LDAP 미설정 환경 무부하)

            title_refreshed = await refresh_titles(session)
        except Exception:  # noqa: BLE001 -- title 패스 실패가 sync 자체를 깨면 안 됨 (§5-7)
            logger.exception("AD title refresh failed — HR sync itself succeeded")

    return HrSyncSummary(
        scanned=scanned, upserted=len(fields_by_id), deactivated=len(deactivated_now),
        deleted=len(delete_ids), skipped=skipped, org_mismatches=org_mismatches,
        truncated_levels=truncated_levels, departments_upserted=departments_upserted,
        dept_info_orphans=dept_info_orphans, title_refreshed=title_refreshed,
    )


async def _mirror_departments(session: AsyncSession) -> int:
    """kind=departments 미러 — dept_code 업서트 + 피드 부재 코드 삭제. 빈 응답이면 삭제 스킵(사고 방어)."""
    rows = await client.fetch_departments()
    seen: set[str] = set()
    for row in rows:
        dept = await session.get(Department, row.dept_code)
        if dept is None:
            dept = Department(dept_code=row.dept_code)
            session.add(dept)
        dept.name = row.name or ""
        dept.name_ko = row.name_ko or ""
        dept.parent_dept_code = row.parent_dept_code
        dept.level = row.level if row.level is not None else 0
        seen.add(row.dept_code)
    if seen:
        existing_codes = set((await session.scalars(select(Department.dept_code))).all())
        for chunk in _chunks(sorted(existing_codes - seen), _DELETE_CHUNK):
            await session.execute(delete(Department).where(Department.dept_code.in_(chunk)))
    return len(seen)


async def _find_dept_info_orphans(session: AsyncSession) -> list[str]:
    """dept_info 키 중 현 조직(업서트 반영 후 employees org 전 레벨 ∪ department)에 없는 것 — 리포트만 (§5-6)."""
    rows = await session.execute(
        select(Employee.org_l1, Employee.org_l2, Employee.org_l3,
               Employee.org_l4, Employee.org_l5, Employee.department).distinct()
    )
    known = {name for row in rows for name in row if name}
    info_keys = set((await session.scalars(select(DeptInfo.department))).all())
    return sorted(info_keys - known)


# 전체 동기화 5분 가드 — 인메모리(단일 컨테이너 전제, AD 시절과 동일 규약)
_FULL_SYNC_MIN_INTERVAL = 300.0
_last_full_sync_at: float | None = None


class SyncTooSoon(Exception):
    def __init__(self, remaining_seconds: int) -> None:
        self.remaining_seconds = remaining_seconds


async def run_full_sync(session: AsyncSession) -> HrSyncSummary:
    """5분 가드 적용 전체 동기화 — 실패·중단 시 가드 미소모(재시도 가능)."""
    global _last_full_sync_at
    now = time.monotonic()
    if _last_full_sync_at is not None and now - _last_full_sync_at < _FULL_SYNC_MIN_INTERVAL:
        raise SyncTooSoon(int(_FULL_SYNC_MIN_INTERVAL - (now - _last_full_sync_at)))
    summary = await sync_all(session)
    if summary.aborted_reason is None:
        _last_full_sync_at = now
    return summary
