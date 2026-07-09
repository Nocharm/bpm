"""AD 동기화 서비스 — 로컬 시드 + 단일/전체 동기화 (design 2026-06-16)."""

import asyncio
import time
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad import client
from app.ad.org import is_active, is_excluded, parse_org
from app.models import Employee
from app.settings import settings

# 로컬 임시 유저 5명 (auth OFF). loginId는 '.' 포함·'_' 미포함(필터 비충돌), name 무 '_'.
# AD-aligned English data — login_id(=sAMAccountName) 불변, name/title/org만 영문화.
# 3가지 패턴: ① lee==park(same team), ② choi(same Procurement Office prefix, diff team),
#             ③ jung(no l3 → parent Procurement Office prefix).
LOCAL_USERS: list[dict] = [
    {
        "login_id": "admin.kim", "name": "Junho Kim", "title": "Manager", "role": "admin",
        "org_l1": "Management Support Division", "org_l2": "Process Innovation Office",
        "org_l3": "Process Innovation Team",
        "org_l4": None, "org_l5": None, "department": "Process Innovation Team",
    },
    {
        "login_id": "user.lee", "name": "Minjae Lee", "title": "Senior", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 1",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 1",
    },
    {
        "login_id": "user.park", "name": "Soyeon Park", "title": "Associate", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 1",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 1",
    },
    {
        "login_id": "user.choi", "name": "Daehyun Choi", "title": "Principal", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 2",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 2",
    },
    {
        "login_id": "user.jung", "name": "Hana Jung", "title": "Senior", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": None,
        "org_l4": None, "org_l5": None, "department": "Procurement Office",
    },
]


async def seed_local_employees(session: AsyncSession) -> None:
    """로컬 임시 유저 멱등 upsert — auth OFF일 때만 호출.

    이미 직원이 있으면(예: reset_db 종합 시드로 채워진 DB) 재시드하지 않는다 —
    기동 시 구 5명이 종합 시드 DB에 다시 섞이는 것 방지. 빈 DB(테스트·최초 기동)만 시드.
    """
    if await session.scalar(select(Employee.login_id).limit(1)) is not None:
        return
    for spec in LOCAL_USERS:
        emp = await session.get(Employee, spec["login_id"])
        if emp is None:
            emp = Employee(login_id=spec["login_id"], source="local")
            session.add(emp)
        # 매번 갱신 — 스키마 변경(org_l* 추가) 후에도 기존 행이 채워지도록
        emp.name = spec["name"]
        emp.title = spec["title"]
        emp.role = spec["role"]
        emp.org_l1 = spec["org_l1"]
        emp.org_l2 = spec["org_l2"]
        emp.org_l3 = spec["org_l3"]
        emp.org_l4 = spec["org_l4"]
        emp.org_l5 = spec["org_l5"]
        emp.department = spec["department"]
        # Dev users are always active; placeholder email for local testing
        emp.active = True
        emp.email = f"{spec['login_id']}@corp"
    await session.commit()


@dataclass(frozen=True)
class EmployeeFields:
    login_id: str
    name: str
    title: str
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    org_l4: str | None
    org_l5: str | None
    department: str
    role: str
    active: bool        # derived from AD userAccountControl bit 0x2
    email: str          # derived from AD mail attribute (empty string if absent)


@dataclass(frozen=True)
class SyncSummary:
    scanned: int
    upserted: int
    excluded: int
    # 전체 동기화에서 삭제된 스테일 source='ad' 행 수 — 비활성·퇴사·신규 제외 대상 (2026-07-09)
    purged: int


def resolve_role(login_id: str) -> str:
    return "admin" if login_id in settings.admin_login_ids() else "user"


def to_employee_fields(raw: client.RawUser) -> EmployeeFields | None:
    """RawUser → EmployeeFields. 제외 대상이면 None (순수 — DB 미접근)."""
    if not is_active(raw.user_account_control):
        return None  # AD 비활성(uac 0x2) 계정 — 동기화 제외 (design 2026-07-09)
    login_id = raw.sam_account_name
    name = raw.display_name or login_id
    org = parse_org(raw.distinguished_name)
    if is_excluded(org.org_l1, login_id, name):
        return None
    return EmployeeFields(
        login_id=login_id,
        name=name,
        title=raw.title,
        org_l1=org.org_l1,
        org_l2=org.org_l2,
        org_l3=org.org_l3,
        org_l4=org.org_l4,
        org_l5=org.org_l5,
        department=org.department,
        role=resolve_role(login_id),
        active=True,  # 비활성은 위에서 제외 — 도달 시 항상 활성
        email=raw.mail or "",
    )


async def _upsert(session: AsyncSession, fields: EmployeeFields) -> Employee:
    emp = await session.get(Employee, fields.login_id)
    if emp is None:
        emp = Employee(login_id=fields.login_id, source="ad")
        session.add(emp)
    emp.name = fields.name
    emp.title = fields.title
    emp.source = "ad"
    emp.role = fields.role
    emp.org_l1 = fields.org_l1
    emp.org_l2 = fields.org_l2
    emp.org_l3 = fields.org_l3
    emp.org_l4 = fields.org_l4
    emp.org_l5 = fields.org_l5
    emp.department = fields.department
    emp.active = fields.active
    emp.email = fields.email
    return emp


async def sync_one(session: AsyncSession, login_id: str) -> Employee | None:
    """로그인 시 1인 동기화. LDAP 미설정/미존재/제외면 None (기존 행 유지)."""
    if not settings.ldap_enabled:
        return None
    raw = await asyncio.to_thread(client.fetch_user, login_id)
    if raw is None:
        return None
    fields = to_employee_fields(raw)
    if fields is None:
        return None
    emp = await _upsert(session, fields)
    await session.commit()
    return emp


async def sync_all(session: AsyncSession) -> SyncSummary:
    raws = await asyncio.to_thread(client.fetch_all_users)
    upserted = 0
    excluded = 0
    valid_ids: set[str] = set()
    for raw in raws:
        fields = to_employee_fields(raw)
        if fields is None:
            excluded += 1
            continue
        await _upsert(session, fields)
        upserted += 1
        valid_ids.add(fields.login_id)
    purged = 0
    if valid_ids:
        # 스테일 프룬 — 이번 스캔 유효 집합 밖 ad 행 삭제(비활성·퇴사·신규 제외 대상).
        # 유효 집합이 비면 스킵(빈 스캔·전원 제외 → NOT IN 전삭제 방지). source='local' 시드는 보존.
        result = await session.execute(
            delete(Employee).where(
                Employee.source == "ad", Employee.login_id.not_in(list(valid_ids))
            )
        )
        purged = result.rowcount or 0
    await session.commit()
    return SyncSummary(scanned=len(raws), upserted=upserted, excluded=excluded, purged=purged)


# 전체 동기화 5분 가드 — 인메모리(단일 컨테이너 전제)
_FULL_SYNC_MIN_INTERVAL = 300.0
_last_full_sync_at: float | None = None


class SyncTooSoon(Exception):
    def __init__(self, remaining_seconds: int) -> None:
        self.remaining_seconds = remaining_seconds


async def run_full_sync(session: AsyncSession) -> SyncSummary:
    """5분 가드 적용 전체 동기화. 과빈도면 SyncTooSoon. 실패 시엔 가드를 소모하지 않아 재시도 가능."""
    global _last_full_sync_at
    now = time.monotonic()
    if _last_full_sync_at is not None and now - _last_full_sync_at < _FULL_SYNC_MIN_INTERVAL:
        raise SyncTooSoon(int(_FULL_SYNC_MIN_INTERVAL - (now - _last_full_sync_at)))
    summary = await sync_all(session)
    _last_full_sync_at = now
    return summary
