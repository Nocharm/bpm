"""AD 동기화 서비스 — 로컬 시드 + 단일/전체 동기화 (design 2026-06-16)."""

import asyncio
import time
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.ad import client
from app.ad.org import is_excluded, parse_org
from app.models import Employee
from app.settings import settings

# 로컬 임시 유저 5명 (auth OFF). loginId는 '.' 포함·'_' 미포함(필터 비충돌), name 무 '_'.
LOCAL_USERS: list[dict[str, str]] = [
    {"login_id": "admin.kim", "name": "김관리", "title": "팀장", "department": "프로세스혁신팀", "role": "admin"},
    {"login_id": "user.lee", "name": "이업무", "title": "선임", "department": "구매팀", "role": "user"},
    {"login_id": "user.park", "name": "박담당", "title": "사원", "department": "인사팀", "role": "user"},
    {"login_id": "user.choi", "name": "최실무", "title": "책임", "department": "생산관리팀", "role": "user"},
    {"login_id": "user.jung", "name": "정사용", "title": "선임", "department": "품질팀", "role": "user"},
]


async def seed_local_employees(session: AsyncSession) -> None:
    """로컬 임시 유저 멱등 upsert — auth OFF일 때만 호출."""
    for spec in LOCAL_USERS:
        emp = await session.get(Employee, spec["login_id"])
        if emp is None:
            session.add(
                Employee(
                    login_id=spec["login_id"],
                    name=spec["name"],
                    title=spec["title"],
                    department=spec["department"],
                    role=spec["role"],
                    source="local",
                )
            )
    await session.commit()


@dataclass(frozen=True)
class EmployeeFields:
    login_id: str
    name: str
    title: str
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    department: str
    role: str


@dataclass(frozen=True)
class SyncSummary:
    scanned: int
    upserted: int
    excluded: int


def resolve_role(login_id: str) -> str:
    return "admin" if login_id in settings.admin_login_ids() else "user"


def to_employee_fields(raw: client.RawUser) -> EmployeeFields | None:
    """RawUser → EmployeeFields. 제외 대상이면 None (순수 — DB 미접근)."""
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
        department=org.department,
        role=resolve_role(login_id),
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
    emp.department = fields.department
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
    for raw in raws:
        fields = to_employee_fields(raw)
        if fields is None:
            excluded += 1
            continue
        await _upsert(session, fields)
        upserted += 1
    await session.commit()
    return SyncSummary(scanned=len(raws), upserted=upserted, excluded=excluded)


# 전체 동기화 5분 가드 — 인메모리(단일 컨테이너 전제)
_FULL_SYNC_MIN_INTERVAL = 300.0
_last_full_sync_at: float | None = None


class SyncTooSoon(Exception):
    def __init__(self, remaining_seconds: int) -> None:
        self.remaining_seconds = remaining_seconds


async def run_full_sync(session: AsyncSession) -> SyncSummary:
    """5분 가드 적용 전체 동기화. 과빈도면 SyncTooSoon."""
    global _last_full_sync_at
    now = time.monotonic()
    if _last_full_sync_at is not None and now - _last_full_sync_at < _FULL_SYNC_MIN_INTERVAL:
        raise SyncTooSoon(int(_FULL_SYNC_MIN_INTERVAL - (now - _last_full_sync_at)))
    _last_full_sync_at = now
    return await sync_all(session)
