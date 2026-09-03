"""HR 웹훅 동기화 서비스 — 전체/단건 동기화·부서 미러·이행 프리뷰.

설계: 2026-08-10-hr-webhook-directory-design.md §4~§6·§9.
title은 절대 건드리지 않는다 — AD title 패스(app/ad/service.refresh_titles_and_positions) 전용.
"""

import logging
import time
from dataclasses import dataclass, field

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.batch_runs import JOB_HR_SYNC, record_batch_run
from app.clock import now as now_kst
from app.hr import client
from app.hr.client import RawHrEmployee
from app.models import Department, Employee, MapPermission, ProcessMap, UserGroupMember
from app.settings import settings

logger = logging.getLogger(__name__)

_DELETE_CHUNK = 500  # SQLite IN 바인드 상한(구버전 999) 아래로 유지 (§5-3)
_PREVIEW_SAMPLE_CAP = 50  # 프리뷰 샘플 리스트 상한 — 6천명 전수 나열 방지


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


def _clip(value: str | None, limit: int) -> str | None:
    """길이 초과 문자열 자르기 — sqlite는 VARCHAR 미강제지만 운영 Postgres는 초과 시 sync 전체가 실패 (§3)."""
    return value if value is None else value[:limit]


def to_employee_fields(raw: RawHrEmployee) -> HrEmployeeFields:
    """RawHrEmployee → 저장 필드. 순수 — DB 미접근. 매핑 표는 설계 §4.

    login_id 길이(100자 초과) 검증은 호출부 책임(파싱 직후 skip) — 여기선 나머지 문자열만 클램프.
    """
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
        name=(raw.name or raw.login_id)[:200],
        korean_name=_clip(raw.name_ko, 200),
        korean_dept=_clip(raw.department_ko, 200),
        dept_code=_clip(raw.dept_code, 100),
        department=department[:200],
        org_l1=_clip(l1, 200), org_l2=_clip(l2, 200), org_l3=_clip(l3, 200),
        org_l4=_clip(l4, 200), org_l5=_clip(l5, 200),
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
    title_refreshed: int | None = None
    position_refreshed: int | None = None
    position_unmatched: int | None = None
    # 미매칭 EMPID 샘플(≤10) — 사번 포맷(zero-padding 등) 불일치 진단용
    position_unmatched_sample: list[str] = field(default_factory=list)
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
        if raw is None:
            continue
        if len(raw.login_id) > 100:
            skipped += 1  # Postgres VARCHAR(100) 초과 — 매핑 불가 (§3)
            continue
        fields_by_id[raw.login_id] = to_employee_fields(raw)  # 중복 loginId는 마지막 행 우선
    org_mismatches = sum(1 for f in fields_by_id.values() if f.dept_mismatch)
    truncated_levels = sum(1 for f in fields_by_id.values() if f.truncated)

    if not fields_by_id:
        # 유효 직원 0명 = 전멸 사고 방어 — 캡(0=off)과 무관하게 항상 중단 (§5-4 ②)
        return HrSyncSummary(
            scanned=scanned, skipped=skipped, org_mismatches=org_mismatches,
            truncated_levels=truncated_levels,
            aborted_reason="empty feed: no valid employee rows",
        )

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
    await session.commit()

    title_refreshed: int | None = None
    position_refreshed: int | None = None
    position_unmatched: int | None = None
    position_unmatched_sample: list[str] = []
    if settings.ldap_enabled:
        positions: list[client.RawHrPosition] = []
        if not settings.position_enabled:
            logger.info("position pass disabled - N8N_POSITION_URL unset")
        if settings.position_enabled:
            try:
                positions = await client.fetch_positions()
            except Exception:  # noqa: BLE001 -- EDW 실패 시 title만 갱신 (설계 §4-2)
                logger.exception("EDW positions fetch failed - proceeding with title-only AD pass")
        try:
            from app.ad.service import refresh_titles_and_positions  # 지연 import(LDAP 미설정 무부하)

            title_refreshed, position_refreshed, position_unmatched, position_unmatched_sample = (
                await refresh_titles_and_positions(session, positions)
            )
        except Exception:  # noqa: BLE001 -- AD 패스 실패가 sync 자체를 깨면 안 됨 (§5-7)
            logger.exception("AD title/position refresh failed - HR sync itself succeeded")

    return HrSyncSummary(
        scanned=scanned, upserted=len(fields_by_id), deactivated=len(deactivated_now),
        deleted=len(delete_ids), skipped=skipped, org_mismatches=org_mismatches,
        truncated_levels=truncated_levels, departments_upserted=departments_upserted,
        title_refreshed=title_refreshed,
        position_refreshed=position_refreshed, position_unmatched=position_unmatched,
        position_unmatched_sample=position_unmatched_sample,
    )


async def _mirror_departments(session: AsyncSession) -> int:
    """kind=departments 미러 — dept_code 업서트 + 피드 부재 코드 삭제. 빈 응답이면 삭제 스킵(사고 방어)."""
    rows = await client.fetch_departments()
    seen: set[str] = set()
    for row in rows:
        if len(row.dept_code) > 100:
            continue  # Postgres VARCHAR(100) 초과 — 매핑 불가 (§3)
        dept = await session.get(Department, row.dept_code)
        if dept is None:
            dept = Department(dept_code=row.dept_code)
            session.add(dept)
        dept.name = (row.name or "")[:300]
        dept.name_ko = (row.name_ko or "")[:300]
        dept.parent_dept_code = _clip(row.parent_dept_code, 100)
        dept.level = row.level if row.level is not None else 0
        seen.add(row.dept_code)
    if seen:
        existing_codes = set((await session.scalars(select(Department.dept_code))).all())
        for chunk in _chunks(sorted(existing_codes - seen), _DELETE_CHUNK):
            await session.execute(delete(Department).where(Department.dept_code.in_(chunk)))
    return len(seen)


# 전체 동기화 5분 가드 — 인메모리(단일 컨테이너 전제, AD 시절과 동일 규약)
_FULL_SYNC_MIN_INTERVAL = 300.0
_last_full_sync_at: float | None = None


class SyncTooSoon(Exception):
    def __init__(self, remaining_seconds: int) -> None:
        self.remaining_seconds = remaining_seconds


def _summarize_for_record(summary: HrSyncSummary) -> str:
    """성공 기록 detail — 요약 카운트 압축 한 줄."""
    return (
        f"scanned {summary.scanned} · upserted {summary.upserted}"
        f" · deactivated {summary.deactivated} · deleted {summary.deleted}"
        f" · skipped {summary.skipped}"
    )


async def run_full_sync(session: AsyncSession) -> HrSyncSummary:
    """5분 가드 적용 전체 동기화 — 실패·중단 시 가드 미소모(재시도 가능).

    실행 기록(batch_job_runs): 정상 완료=success, 가드 중단·예외=failure.
    스로틀(SyncTooSoon)은 시도가 아니므로 기록하지 않는다.
    """
    global _last_full_sync_at
    now = time.monotonic()
    if _last_full_sync_at is not None and now - _last_full_sync_at < _FULL_SYNC_MIN_INTERVAL:
        raise SyncTooSoon(int(_FULL_SYNC_MIN_INTERVAL - (now - _last_full_sync_at)))
    try:
        summary = await sync_all(session)
    except Exception as exc:
        # 실패 기록 전 rollback — sync_all이 중간 상태로 남긴 세션을 정리
        await session.rollback()
        await record_batch_run(session, JOB_HR_SYNC, "failure", str(exc)[:500])
        raise
    if summary.aborted_reason is None:
        _last_full_sync_at = now
        await record_batch_run(session, JOB_HR_SYNC, "success", _summarize_for_record(summary))
    else:
        await record_batch_run(session, JOB_HR_SYNC, "failure", summary.aborted_reason)
    return summary


# 1인 동기화 하루 1회 스로틀 — login_id → KST 날짜 iso (인메모리, 단일 컨테이너 전제)
_one_sync_done: dict[str, str] = {}


async def sync_one(session: AsyncSession, login_id: str) -> Employee | None:
    """로그인 시 1인 동기화 — HR 미설정/미존재/오늘 기동기화면 None(기존 행 유지). title 보존."""
    if not settings.hr_enabled:
        return None
    today = now_kst().date().isoformat()
    if _one_sync_done.get(login_id) == today:
        return None
    try:
        raw = await client.fetch_employee(login_id)
    except Exception:  # noqa: BLE001 -- 웹훅 장애가 로그인을 막으면 안 됨 — 기존 행으로 동작
        logger.exception("HR single sync failed for %s - keeping existing row", login_id)
        return None
    _one_sync_done[login_id] = today  # 미존재·성공 모두 오늘 재조회 안 함
    if raw is None:
        return None
    if len(raw.login_id) > 100:
        return None  # Postgres VARCHAR(100) 초과 — 매핑 불가, 기존 행 유지 (§3)
    newly_inactive = await _upsert(session, to_employee_fields(raw))
    if newly_inactive:
        await workflow.reconcile_departures(session, {login_id})
    await session.commit()
    return await session.get(Employee, login_id)


@dataclass(frozen=True)
class HrSyncPreview:
    scanned: int
    skipped: int
    would_upsert: int
    would_deactivate: int
    would_delete: int
    org_mismatches: int
    truncated_levels: int
    korean_overwrites: int
    new_login_ids: list[str] = field(default_factory=list)
    delete_login_ids: list[str] = field(default_factory=list)
    case_mismatches: list[str] = field(default_factory=list)
    orphan_dept_paths: list[str] = field(default_factory=list)


async def build_sync_preview(session: AsyncSession) -> HrSyncPreview:
    """이행 드라이런 (§9) — DB 무변경으로 첫 실동기화 영향 정량화. 가드 미소모."""
    _, parsed = await client.fetch_all_employees()
    skipped = sum(1 for p in parsed if p is None)
    fields_by_id: dict[str, HrEmployeeFields] = {}
    for r in parsed:
        if r is None:
            continue
        if len(r.login_id) > 100:
            skipped += 1  # Postgres VARCHAR(100) 초과 — 매핑 불가 (§3)
            continue
        fields_by_id[r.login_id] = to_employee_fields(r)

    rows = (await session.execute(
        select(Employee.login_id, Employee.source, Employee.active, Employee.korean_name)
    )).all()
    db_ids = {r.login_id for r in rows}
    managed_ids = {r.login_id for r in rows if r.source in ("ad", "hr")}
    active_ids = {r.login_id for r in rows if r.active}
    korean_by_id = {r.login_id: r.korean_name for r in rows}

    new_ids = sorted(fields_by_id.keys() - db_ids)
    delete_ids = sorted(managed_ids - fields_by_id.keys())
    lower_db = {lid.lower(): lid for lid in db_ids}
    case_mismatches = sorted(
        f"{f.login_id} != db:{lower_db[f.login_id.lower()]}"
        for f in fields_by_id.values()
        if f.login_id not in db_ids and f.login_id.lower() in lower_db
    )
    korean_overwrites = sum(
        1 for f in fields_by_id.values()
        if f.korean_name and korean_by_id.get(f.login_id) and korean_by_id[f.login_id] != f.korean_name
    )

    # 새 피드 기준 유효 org 경로 프리픽스 ∪ local 행 경로 — 여기 없는 부서 principal 참조 = 이행 후 고아
    valid_paths: set[str] = set()
    for f in fields_by_id.values():
        levels = [lv for lv in (f.org_l1, f.org_l2, f.org_l3, f.org_l4, f.org_l5) if lv]
        for i in range(1, len(levels) + 1):
            valid_paths.add("/".join(levels[:i]))
    local_levels = (await session.execute(
        select(Employee.org_l1, Employee.org_l2, Employee.org_l3,
               Employee.org_l4, Employee.org_l5).where(Employee.source == "local")
    )).all()
    for row in local_levels:
        levels = [lv for lv in row if lv]
        for i in range(1, len(levels) + 1):
            valid_paths.add("/".join(levels[:i]))

    referenced: set[str] = set(
        (await session.scalars(
            select(MapPermission.principal_id).where(MapPermission.principal_type == "department").distinct()
        )).all()
    )
    referenced.update((await session.scalars(
        select(UserGroupMember.member_id).where(UserGroupMember.member_type == "department").distinct()
    )).all())
    referenced.update(
        p for p in (await session.scalars(select(ProcessMap.owning_department).distinct())).all() if p
    )

    return HrSyncPreview(
        scanned=len(parsed),
        skipped=skipped,
        would_upsert=len(fields_by_id),
        would_deactivate=sum(
            1 for f in fields_by_id.values() if not f.active and f.login_id in active_ids
        ),
        would_delete=len(delete_ids),
        org_mismatches=sum(1 for f in fields_by_id.values() if f.dept_mismatch),
        truncated_levels=sum(1 for f in fields_by_id.values() if f.truncated),
        korean_overwrites=korean_overwrites,
        new_login_ids=new_ids[:_PREVIEW_SAMPLE_CAP],
        delete_login_ids=delete_ids[:_PREVIEW_SAMPLE_CAP],
        case_mismatches=case_mismatches[:_PREVIEW_SAMPLE_CAP],
        orphan_dept_paths=sorted(referenced - valid_paths)[:_PREVIEW_SAMPLE_CAP],
    )
