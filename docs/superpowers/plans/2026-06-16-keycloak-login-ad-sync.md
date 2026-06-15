# Keycloak 로그인 화면 + AD/LDAP 동기화 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keycloak 로그인 화면(와일드카드 리다이렉트) + 사내 AD(LDAP) → `employees` 동기화 + 로컬 임시 로그인(5명)을 추가한다.

**Architecture:** 백엔드는 `app/ad/`에 순수 파싱·LDAP 클라이언트·동기화 서비스를 두고 `employees` 테이블에 upsert하며, `/api/me`(로그인 시 1인 동기화)·`/api/employees`·`/api/employees/sync`(admin) 엔드포인트로 노출한다. 프론트는 `/login` 라우트 + 게이트로 미인증 접근을 막고, 인증 OFF면 `X-Dev-User` 헤더 기반 임시 로그인을 쓴다.

**Tech Stack:** FastAPI, SQLAlchemy(async), Pydantic, ldap3, pytest / Next.js(App Router), react-oidc-context, TypeScript.

**Spec:** `docs/superpowers/specs/2026-06-16-keycloak-login-ad-sync-design.md`

---

## File Structure

**백엔드 (신규/수정)**
- `backend/app/ad/__init__.py` — 패키지
- `backend/app/ad/org.py` — DN 파싱·필터 **순수 함수** (의존성 없음)
- `backend/app/ad/client.py` — ldap3 래퍼 (블로킹, `asyncio.to_thread`로 호출)
- `backend/app/ad/service.py` — 변환·upsert·`sync_one`/`sync_all`·로컬 시드·5분 가드
- `backend/app/models.py` — `Employee` 모델 추가 (수정)
- `backend/app/schemas.py` — `MeOut` 확장 + `EmployeeOut`·`SyncSummaryOut` 추가 (수정)
- `backend/app/settings.py` — LDAP/admin 설정 추가 (수정)
- `backend/app/auth.py` — `X-Dev-User` + `get_current_employee`/`require_admin` (수정)
- `backend/app/routers/employees.py` — `/api/employees`·`/api/employees/sync` (신규)
- `backend/app/main.py` — `/api/me` 확장 + employees 라우터 등록 + 시드 (수정)
- `backend/requirements.txt` — `ldap3` 추가 (수정)
- `backend/tests/test_org.py`, `test_employees.py` — 신규
- `.env.example` — LDAP 변수 (수정)

**프론트 (신규/수정)**
- `frontend/src/lib/dev-auth.ts` — 로컬 임시 유저 fixture·localStorage (신규)
- `frontend/src/lib/api.ts` — `X-Dev-User`·`setDevUser`·`getMe` 타입·employees API (수정)
- `frontend/src/lib/current-user.ts` — `role`/`department` 확장 (수정)
- `frontend/src/components/providers.tsx` — `/login` 게이트(Auth/Dev) (수정)
- `frontend/src/app/login/page.tsx` — 로그인 화면 (신규)
- `frontend/src/components/dev-login-modal.tsx` — 임시 로그인 모달 (신규)
- `frontend/src/components/top-nav.tsx` — 유저 드롭다운(관리자/로그아웃) (수정)
- `frontend/src/app/admin/page.tsx` — 관리자 테이블 + 동기화 버튼 (신규)
- `frontend/src/lib/i18n-messages.ts` — 신규 키 (수정)

---

## Task 1: `Employee` 모델 + 스키마

**Files:**
- Modify: `backend/app/models.py` (끝에 추가)
- Modify: `backend/app/schemas.py` (`MeOut` 확장 + 신규)
- Test: `backend/tests/test_employees.py`

- [ ] **Step 1: 모델 추가** — `backend/app/models.py` 끝에 append:

```python
class Employee(Base):
    """사내 AD 동기화 사용자 — loginId(sAMAccountName) PK. source=ad|local (design 2026-06-16)."""

    __tablename__ = "employees"

    login_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), default="")
    title: Mapped[str] = mapped_column(String(100), default="")
    source: Mapped[str] = mapped_column(String(10), default="ad")  # ad | local
    role: Mapped[str] = mapped_column(String(10), default="user")  # admin | user
    org_l1: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l2: Mapped[str | None] = mapped_column(String(200), default=None)
    org_l3: Mapped[str | None] = mapped_column(String(200), default=None)
    department: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

- [ ] **Step 2: 스키마** — `backend/app/schemas.py`의 `MeOut`를 교체하고 신규 추가:

```python
class MeOut(BaseModel):
    username: str
    ai_enabled: bool
    name: str
    role: str
    department: str


class EmployeeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    login_id: str
    name: str
    title: str
    source: str
    role: str
    department: str


class SyncSummaryOut(BaseModel):
    scanned: int
    upserted: int
    excluded: int
```

- [ ] **Step 3: 테이블 생성 검증 테스트** — `backend/tests/test_employees.py` 신규:

```python
"""Employee 모델·동기화·엔드포인트 테스트."""

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee


def test_employees_table_created(client: TestClient) -> None:
    # client fixture의 lifespan이 create_all 실행 → 테이블 존재 + 로컬 시드 5명
    import asyncio

    async def _count() -> int:
        async with SessionLocal() as session:
            from sqlalchemy import select

            return len(list((await session.scalars(select(Employee))).all()))

    assert asyncio.get_event_loop().run_until_complete(_count()) >= 5
```

> 참고: 이 테스트는 Task 3의 시드가 있어야 통과한다. Task 1~3을 한 번에 구현 후 실행해도 된다. 우선 모델/스키마만 두고 Step 4로 진행.

- [ ] **Step 4: 린트** — Run: `cd backend && .venv/bin/ruff check app/ tests/` → Expected: PASS (미사용 import 없게).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_employees.py
git commit -m "feat(db): add Employee model + Me/Employee schemas — employees 테이블·스키마"
```

---

## Task 2: LDAP/admin 설정 + .env.example

**Files:**
- Modify: `backend/app/settings.py`
- Modify: `.env.example`

- [ ] **Step 1: Settings 필드 추가** — `app/settings.py`의 `Settings` 클래스에 `ai_*` 아래 추가:

```python
    # 사내 AD(LDAP) 동기화 — 비우면 비활성(로컬). 시크릿은 .env만 (design 2026-06-16)
    ldap_url: str = ""  # 예: ldaps://ad.example.com:636
    ldap_bind_dn: str = ""  # 서비스 계정 DN
    ldap_bind_credentials: str = ""  # 서비스 계정 비밀번호 (시크릿)
    ldap_user_search_base: str = ""  # 사용자 검색 기준 DN
    ldap_start_tls: bool = False  # ldap:// + StartTLS 쓸 때만 True
    ldap_user_filter: str = ""  # 비우면 기본 enumerate 필터
    # admin role을 부여할 loginId(콤마 구분). 비우면 AD 유저는 전부 user
    system_admin_login_ids: str = ""

    @property
    def ldap_enabled(self) -> bool:
        """필수 4종이 모두 채워졌는지 — 로그인/전체 동기화 동작 게이트."""
        return bool(
            self.ldap_url
            and self.ldap_bind_dn
            and self.ldap_bind_credentials
            and self.ldap_user_search_base
        )

    def admin_login_ids(self) -> set[str]:
        return {x.strip() for x in self.system_admin_login_ids.split(",") if x.strip()}
```

- [ ] **Step 2: .env.example 추가** — `.env.example` 끝에 append:

```bash
# === 사내 AD(LDAP) 동기화 (design 2026-06-16) ===
# 비우면 동기화 비활성(로컬 개발). 시크릿(LDAP_BIND_CREDENTIALS)은 절대 커밋 금지.
LDAP_URL=
LDAP_BIND_DN=
LDAP_BIND_CREDENTIALS=
LDAP_USER_SEARCH_BASE=
LDAP_START_TLS=false
# 전체 enumerate 필터 — 비우면 기본 (&(objectCategory=person)(objectClass=user)(sAMAccountName=*))
LDAP_USER_FILTER=
# admin role loginId 콤마 구분 (예: hong.gildong,kim.cheolsu)
SYSTEM_ADMIN_LOGIN_IDS=
```

- [ ] **Step 3: 검증** — Run: `cd backend && .venv/bin/python -c "from app.settings import settings; print(settings.ldap_enabled, settings.admin_login_ids())"` → Expected: `False set()`

- [ ] **Step 4: Commit**

```bash
git add backend/app/settings.py .env.example
git commit -m "feat(config): LDAP + SYSTEM_ADMIN_LOGIN_IDS settings — AD 설정·env"
```

---

## Task 3: 로컬 임시 5명 시드 + startup 훅

**Files:**
- Create: `backend/app/ad/__init__.py` (빈 파일)
- Create: `backend/app/ad/service.py` (시드 함수만 — 동기화는 Task 6에서 확장)
- Modify: `backend/app/main.py` (lifespan에서 시드 호출)

- [ ] **Step 1: 패키지·시드 함수** — `backend/app/ad/__init__.py`(빈), `backend/app/ad/service.py` 신규:

```python
"""AD 동기화 서비스 — 로컬 시드 + 단일/전체 동기화 (design 2026-06-16)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee

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
            session.add(Employee(source="local", department=spec["department"], **{
                k: spec[k] for k in ("login_id", "name", "title", "role")
            }))
    await session.commit()
```

- [ ] **Step 2: lifespan에서 시드** — `app/main.py`의 `lifespan` 수정:

```python
@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_models()
    # 로컬(인증 OFF)은 임시 유저 5명 시드 — role별 테스트용
    if not settings.auth_enabled:
        from app.ad.service import seed_local_employees
        from app.db import SessionLocal

        async with SessionLocal() as session:
            await seed_local_employees(session)
    yield
```

- [ ] **Step 3: 시드 검증** — Run: `cd backend && .venv/bin/python -m pytest tests/test_employees.py::test_employees_table_created -v` → Expected: PASS (5명 시드됨).

- [ ] **Step 4: Commit**

```bash
git add backend/app/ad/__init__.py backend/app/ad/service.py backend/app/main.py
git commit -m "feat(ad): seed 5 local employees on startup (auth off) — 로컬 임시 5명 시드"
```

---

## Task 4: DN 파싱·필터 순수 함수 (TDD)

**Files:**
- Create: `backend/app/ad/org.py`
- Test: `backend/tests/test_org.py`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_org.py` 신규:

```python
"""DN 조직 파싱·필터 순수 함수 테스트 (AAA)."""

from app.ad.org import is_excluded, parse_org


def test_parse_org_four_levels() -> None:
    dn = "CN=Hong,OU=Team A,OU=Dept B,OU=Div C,OU=SAMSUNGBIOLOGICS,DC=corp,DC=com"
    org = parse_org(dn)
    # 제외 토큰(SAMSUNGBIOLOGICS) 제거 후 루트→리프: Div C, Dept B, Team A
    assert (org.org_l1, org.org_l2, org.org_l3) == ("Div C", "Dept B", "Team A")
    assert org.department == "Team A"


def test_parse_org_excludes_tokens_exact_case() -> None:
    dn = "OU=Team,OU=President & CEO,OU=BioLogics Users,DC=corp"
    org = parse_org(dn)
    assert org.org_l1 == "Team"  # 제외 토큰 모두 제거, 남은 Team 하나
    assert org.department == "Team"


def test_parse_org_more_than_three_uses_root_three() -> None:
    dn = "OU=Leaf,OU=L3,OU=L2,OU=L1,DC=corp"  # 리프→루트: Leaf,L3,L2,L1
    org = parse_org(dn)
    # 루트→리프 L1,L2,L3,Leaf 중 루트 3개
    assert (org.org_l1, org.org_l2, org.org_l3) == ("L1", "L2", "L3")
    assert org.department == "L3"


def test_parse_org_fewer_levels_department_fallback() -> None:
    org = parse_org("OU=Only,DC=corp")
    assert (org.org_l1, org.org_l2, org.org_l3) == ("Only", None, None)
    assert org.department == "Only"
    empty = parse_org("CN=NoOu,DC=corp")
    assert empty.department == ""


def test_is_excluded_rules() -> None:
    assert is_excluded("Partners", "a.b", "Name") is True  # org_l1 블랙리스트
    assert is_excluded("Sales", "nodot", "Name") is True  # loginId에 '.' 없음
    assert is_excluded("Sales", "a.b", "Bad_Name") is True  # name에 '_' 포함
    assert is_excluded("Sales", "a.b", "Good Name") is False
```

- [ ] **Step 2: 실패 확인** — Run: `cd backend && .venv/bin/python -m pytest tests/test_org.py -v` → Expected: FAIL (`ModuleNotFoundError: app.ad.org`).

- [ ] **Step 3: 구현** — `backend/app/ad/org.py` 신규:

```python
"""AD distinguishedName → 조직 레벨 파싱 + 동기화 제외 판정 (순수 함수, design 2026-06-16 §4)."""

import re
from dataclasses import dataclass

# 조직 OU에서 제외할 토큰 — 대소문자·공백 정확 일치
EXCLUDED_OU_TOKENS = frozenset(
    {"BioLogics Users", "BioLogics Groups", "SAMSUNGBIOLOGICS", "President & CEO"}
)
# org_l1이 이 중 하나면 동기화 제외
EXCLUDED_ORG_L1 = frozenset(
    {"Partners", "Partner", "External users", "delete", "Client", "TEST", "View"}
)


@dataclass(frozen=True)
class OrgLevels:
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    department: str


def _extract_ou_values(dn: str) -> list[str]:
    """DN에서 OU= 값만 등장순(리프→루트)으로. 이스케이프된 콤마(\\,)는 분리하지 않는다."""
    parts = re.split(r"(?<!\\),", dn)
    values: list[str] = []
    for part in parts:
        attr, sep, value = part.strip().partition("=")
        if sep and attr.strip().upper() == "OU":
            values.append(value.strip().replace("\\,", ","))
    return values


def parse_org(dn: str) -> OrgLevels:
    leaf_to_root = _extract_ou_values(dn)
    kept = [ou for ou in leaf_to_root if ou not in EXCLUDED_OU_TOKENS]
    root_to_leaf = list(reversed(kept))
    top3 = root_to_leaf[:3]  # 3개 초과면 루트 쪽 3개
    l1 = top3[0] if len(top3) > 0 else None
    l2 = top3[1] if len(top3) > 1 else None
    l3 = top3[2] if len(top3) > 2 else None
    department = l3 or l2 or l1 or ""
    return OrgLevels(l1, l2, l3, department)


def is_excluded(org_l1: str | None, login_id: str, name: str) -> bool:
    if org_l1 in EXCLUDED_ORG_L1:
        return True
    if "." not in login_id:
        return True
    if "_" in name:
        return True
    return False
```

- [ ] **Step 4: 통과 확인** — Run: `cd backend && .venv/bin/python -m pytest tests/test_org.py -v` → Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/ad/org.py backend/tests/test_org.py
git commit -m "feat(ad): DN org parsing + sync filter pure functions — DN 파싱·필터 + 테스트"
```

---

## Task 5: LDAP 클라이언트 (ldap3)

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/app/ad/client.py`

- [ ] **Step 1: 의존성 추가** — `backend/requirements.txt`에 추가: `ldap3==2.9.1`

- [ ] **Step 2: 설치** — Run: `cd backend && .venv/bin/pip install ldap3==2.9.1` (uv 불가 환경은 pip).

- [ ] **Step 3: 클라이언트 구현** — `backend/app/ad/client.py` 신규:

```python
"""ldap3 기반 AD 조회 — 블로킹. async 호출부는 asyncio.to_thread로 감싼다 (design 2026-06-16 §5.1)."""

from dataclasses import dataclass

from ldap3 import SUBTREE, Connection, Server, Tls

from app.settings import settings

_DEFAULT_FILTER = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=*))"
_ATTRS = ["sAMAccountName", "displayName", "title", "distinguishedName"]


@dataclass(frozen=True)
class RawUser:
    sam_account_name: str
    display_name: str
    title: str
    distinguished_name: str


def _connect() -> Connection:
    use_ssl = settings.ldap_url.lower().startswith("ldaps://")
    server = Server(settings.ldap_url, use_ssl=use_ssl, tls=Tls() if use_ssl else None)
    conn = Connection(
        server,
        user=settings.ldap_bind_dn,
        password=settings.ldap_bind_credentials,
        auto_bind=False,
    )
    if settings.ldap_start_tls:
        conn.start_tls()
    conn.bind()
    return conn


def _to_raw(entry: object) -> RawUser:
    def val(attr: str) -> str:
        v = getattr(entry, attr, None)
        return str(v.value) if v is not None and v.value is not None else ""

    return RawUser(
        sam_account_name=val("sAMAccountName"),
        display_name=val("displayName"),
        title=val("title"),
        distinguished_name=val("distinguishedName"),
    )


def fetch_user(login_id: str) -> RawUser | None:
    safe = login_id.replace("(", "").replace(")", "").replace("*", "")  # filter 인젝션 방지
    conn = _connect()
    try:
        conn.search(
            settings.ldap_user_search_base,
            f"(&(objectCategory=person)(objectClass=user)(sAMAccountName={safe}))",
            search_scope=SUBTREE,
            attributes=_ATTRS,
        )
        if not conn.entries:
            return None
        return _to_raw(conn.entries[0])
    finally:
        conn.unbind()


def fetch_all_users() -> list[RawUser]:
    conn = _connect()
    try:
        entries = conn.extend.standard.paged_search(
            settings.ldap_user_search_base,
            settings.ldap_user_filter or _DEFAULT_FILTER,
            search_scope=SUBTREE,
            attributes=_ATTRS,
            paged_size=500,
            generator=False,
        )
        return [
            RawUser(
                sam_account_name=str(e["attributes"].get("sAMAccountName", "")),
                display_name=str(e["attributes"].get("displayName", "")),
                title=str(e["attributes"].get("title", "")),
                distinguished_name=str(e["attributes"].get("distinguishedName", "")),
            )
            for e in entries
            if e.get("type") == "searchResEntry"
        ]
    finally:
        conn.unbind()
```

- [ ] **Step 4: import 검증** — Run: `cd backend && .venv/bin/python -c "from app.ad import client; print('ok')"` → Expected: `ok` (LDAP 미연결이라도 import만 확인).

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/ad/client.py
git commit -m "feat(ad): ldap3 client (fetch_user/fetch_all_users) — LDAP 조회 클라이언트"
```

---

## Task 6: 동기화 서비스 (변환·upsert·sync_one/sync_all·가드)

**Files:**
- Modify: `backend/app/ad/service.py`
- Test: `backend/tests/test_employees.py` (변환 단위 테스트 추가)

- [ ] **Step 1: 변환·동기화 구현** — `backend/app/ad/service.py`에 추가(상단 import 보강):

```python
import asyncio
import time
from dataclasses import dataclass

from app.ad import client
from app.ad.org import is_excluded, parse_org
from app.settings import settings


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
```

> 주의: `service.py` 최상단 기존 import(`from app.models import Employee`, `from sqlalchemy.ext.asyncio import AsyncSession`)가 이미 있는지 확인하고 중복 없이 정리한다.

- [ ] **Step 2: 변환 단위 테스트** — `backend/tests/test_employees.py`에 추가:

```python
def test_to_employee_fields_maps_and_filters() -> None:
    from app.ad.client import RawUser
    from app.ad.service import to_employee_fields

    raw = RawUser(
        sam_account_name="hong.gildong",
        display_name="홍길동",
        title="책임",
        distinguished_name="CN=H,OU=TeamA,OU=DeptB,OU=SAMSUNGBIOLOGICS,DC=corp",
    )
    fields = to_employee_fields(raw)
    assert fields is not None
    assert fields.login_id == "hong.gildong"
    assert fields.department == "TeamA"  # 루트→리프 중 가장 깊은 레벨
    assert fields.role == "user"

    excluded = RawUser("nodot", "이름", "", "OU=TeamA,DC=corp")  # loginId에 '.' 없음
    assert to_employee_fields(excluded) is None
```

- [ ] **Step 3: 테스트 통과** — Run: `cd backend && .venv/bin/python -m pytest tests/test_employees.py::test_to_employee_fields_maps_and_filters -v` → Expected: PASS.

- [ ] **Step 4: 린트** — Run: `cd backend && .venv/bin/ruff check app/ tests/` → Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/ad/service.py backend/tests/test_employees.py
git commit -m "feat(ad): sync service (to_employee/sync_one/sync_all + 5min guard) — 동기화 서비스"
```

---

## Task 7: 인증 의존성 — X-Dev-User + get_current_employee/require_admin

**Files:**
- Modify: `backend/app/auth.py`
- Test: `backend/tests/test_employees.py`

- [ ] **Step 1: auth.py 수정** — `get_current_user`에 `X-Dev-User` 추가 + 의존성 신설:

```python
from fastapi import Depends, Header, HTTPException

from app.db import get_session
from app.models import Employee
from sqlalchemy.ext.asyncio import AsyncSession


def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
) -> str:
    """요청 사용자 loginId. auth OFF면 X-Dev-User(없으면 dev_user), ON이면 JWT preferred_username."""
    if not settings.auth_enabled:
        return x_dev_user or settings.dev_user  # 헤더는 auth OFF에서만 신뢰
    # ... (기존 JWT 검증 로직 그대로) ...


async def get_current_employee(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Employee:
    """현재 사용자 Employee. 행이 없으면 임시 Employee(role=user, 미영속)."""
    emp = await session.get(Employee, login_id)
    if emp is None:
        return Employee(login_id=login_id, name=login_id, source="ad", role="user", department="")
    return emp


async def require_admin(emp: Employee = Depends(get_current_employee)) -> Employee:
    if emp.role != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return emp
```

> 기존 `get_current_user`의 JWT 검증 본문은 유지하고, 맨 앞 `if not settings.auth_enabled` 분기만 `x_dev_user` 우선으로 교체한다.

- [ ] **Step 2: 의존성 테스트** — `backend/tests/test_employees.py`에 추가:

```python
def test_me_uses_dev_user_header(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "admin.kim"
    assert body["role"] == "admin"


def test_employees_list_requires_admin(client: TestClient) -> None:
    # 일반 유저 → 403
    assert client.get("/api/employees", headers={"X-Dev-User": "user.lee"}).status_code == 403
    # admin → 200
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    assert len(res.json()) >= 5
```

> 이 테스트는 Task 8(`/api/me` 확장)·Task 9(`/api/employees`) 구현 후 통과한다. Step 3은 import 에러만 확인.

- [ ] **Step 3: import 검증** — Run: `cd backend && .venv/bin/python -c "from app.auth import require_admin, get_current_employee; print('ok')"` → Expected: `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/auth.py backend/tests/test_employees.py
git commit -m "feat(auth): X-Dev-User header + get_current_employee/require_admin — 의존성 신설"
```

---

## Task 8: `/api/me` 확장 (로그인 시 1인 동기화 + 직원 정보)

**Files:**
- Modify: `backend/app/main.py`

- [ ] **Step 1: /api/me 교체** — `app/main.py`의 `get_me` 수정:

```python
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Employee


@app.get("/api/me", response_model=MeOut)
async def get_me(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    # 인증 ON + LDAP 설정 시 로그인 시점 1인 동기화 (로컬은 skip)
    if settings.auth_enabled and settings.ldap_enabled:
        from app.ad.service import sync_one

        await sync_one(session, login_id)
    emp = await session.get(Employee, login_id)
    return MeOut(
        username=login_id,
        ai_enabled=settings.ai_enabled,
        name=emp.name if emp else login_id,
        role=emp.role if emp else "user",
        department=emp.department if emp else "",
    )
```

- [ ] **Step 2: 테스트 통과 확인** — Run: `cd backend && .venv/bin/python -m pytest tests/test_employees.py::test_me_uses_dev_user_header -v` → Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "feat(api): enrich /api/me with employee + login-time sync — /me 확장"
```

---

## Task 9: employees 라우터 (목록 + 전체 동기화)

**Files:**
- Create: `backend/app/routers/employees.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Test: `backend/tests/test_employees.py`

- [ ] **Step 1: 라우터 구현** — `backend/app/routers/employees.py` 신규:

```python
"""직원(employees) 조회 + AD 전체 동기화 — admin 전용 (design 2026-06-16 §6)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.service import SyncTooSoon, run_full_sync
from app.auth import require_admin
from app.db import get_session
from app.models import Employee
from app.schemas import EmployeeOut, SyncSummaryOut
from app.settings import settings

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("", response_model=list[EmployeeOut])
async def list_employees(
    _: Employee = Depends(require_admin),
    session: AsyncSession = Depends(get_session),
) -> list[Employee]:
    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()
    return list(rows)


@router.post("/sync", response_model=SyncSummaryOut)
async def sync_employees(
    _: Employee = Depends(require_admin),
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
```

- [ ] **Step 2: 라우터 등록** — `app/main.py`의 import·include 수정:

```python
from app.routers import (
    ai, approvers, comments, employees, graph, maps, notifications, versions,
)
# ...
app.include_router(employees.router)
```

- [ ] **Step 3: 테스트 통과** — Run: `cd backend && .venv/bin/python -m pytest tests/test_employees.py -v` → Expected: PASS (전체).

- [ ] **Step 4: 전체 백엔드 검증** — Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/` → Expected: 전체 PASS, 린트 clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/employees.py backend/app/main.py
git commit -m "feat(api): employees list + admin full-sync endpoint (5min guard) — 직원 목록·동기화 API"
```

---

## Task 10: 프론트 API 클라이언트 — X-Dev-User + employees + role

**Files:**
- Create: `frontend/src/lib/dev-auth.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/current-user.ts`

- [ ] **Step 1: dev-auth 모듈** — `frontend/src/lib/dev-auth.ts` 신규:

```typescript
// 로컬(인증 OFF) 임시 로그인 — fixture 5명 + 선택값 localStorage 영속. 백엔드 LOCAL_USERS와 loginId 일치.

export interface LocalUser {
  loginId: string;
  name: string;
  department: string;
  role: "admin" | "user";
}

export const LOCAL_USERS: LocalUser[] = [
  { loginId: "admin.kim", name: "김관리", department: "프로세스혁신팀", role: "admin" },
  { loginId: "user.lee", name: "이업무", department: "구매팀", role: "user" },
  { loginId: "user.park", name: "박담당", department: "인사팀", role: "user" },
  { loginId: "user.choi", name: "최실무", department: "생산관리팀", role: "user" },
  { loginId: "user.jung", name: "정사용", department: "품질팀", role: "user" },
];

const KEY = "bpm.devUser";

export function getStoredDevUser(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(KEY);
}

export function storeDevUser(loginId: string | null): void {
  if (typeof window === "undefined") {
    return;
  }
  if (loginId) {
    window.localStorage.setItem(KEY, loginId);
  } else {
    window.localStorage.removeItem(KEY);
  }
}
```

- [ ] **Step 2: api.ts 수정** — `setAuthToken` 아래에 dev-user + 헤더 분기, `getMe` 타입 교체, employees API 추가:

```typescript
let devUser: string | null = null;

export function setDevUser(loginId: string | null): void {
  devUser = loginId;
}
```

`request`의 헤더 부분 교체:

```typescript
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (devUser) {
    headers["X-Dev-User"] = devUser;
  }
```

`getMe`와 employees API:

```typescript
export interface Me {
  username: string;
  ai_enabled: boolean;
  name: string;
  role: "admin" | "user";
  department: string;
}

export function getMe(): Promise<Me> {
  return request<Me>("/me");
}

export interface EmployeeRow {
  login_id: string;
  name: string;
  title: string;
  source: string;
  role: string;
  department: string;
}

export function listEmployees(): Promise<EmployeeRow[]> {
  return request<EmployeeRow[]>("/employees");
}

export interface SyncSummary {
  scanned: number;
  upserted: number;
  excluded: number;
}

export function syncEmployees(): Promise<SyncSummary> {
  return request<SyncSummary>("/employees/sync", { method: "POST" });
}
```

> 기존 `getMe`(username/ai_enabled 반환) 정의는 삭제하고 위로 교체. `getMe` 호출부(ai_enabled 사용처)가 있으면 새 `Me` 타입으로 호환됨(필드 추가만).

- [ ] **Step 3: current-user 확장** — `frontend/src/lib/current-user.ts`의 `CurrentUser` 교체:

```typescript
export interface CurrentUser {
  name: string;
  email: string | null;
  loginId: string;
  role: "admin" | "user";
  department: string;
}
```

- [ ] **Step 4: 검증** — Run: `cd frontend && npm run lint` → Expected: PASS (호출부 타입 에러 없으면). 에러 시 `setCurrentUser` 호출부(providers.tsx)는 Task 11에서 함께 수정.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dev-auth.ts frontend/src/lib/api.ts frontend/src/lib/current-user.ts
git commit -m "feat(web): X-Dev-User header + employees API + role in current-user — API·role 확장"
```

---

## Task 11: 로그인 화면 + 게이트(와일드카드) + 임시 모달

**Files:**
- Create: `frontend/src/app/login/page.tsx`
- Create: `frontend/src/components/dev-login-modal.tsx`
- Modify: `frontend/src/components/providers.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: i18n 키** — `i18n-messages.ts`의 en/ko 양쪽에 추가(기존 키 사이에 맞춰):

```typescript
  "login.title": "BPM 로그인",            // en도 동일 톤이면 영문 문구로
  "login.keycloak": "Keycloak으로 로그인",
  "login.dev": "임시 아이디로 로그인",
  "login.devPick": "임시 사용자 선택",
  "nav.adminPage": "관리자 페이지",
  "nav.logout": "로그아웃",
  "admin.title": "직원 관리",
  "admin.sync": "AD 전체 동기화",
  "admin.syncing": "동기화 중…",
```

> en 맵에는 영어 문구로, ko 맵에는 위 한국어로 각각 넣는다(기존 파일의 en/ko 이중 구조 준수).

- [ ] **Step 2: 임시 로그인 모달** — `frontend/src/components/dev-login-modal.tsx` 신규:

```typescript
"use client";

import { createPortal } from "react-dom";

import { LOCAL_USERS } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

export function DevLoginModal({
  onPick,
  onClose,
}: {
  onPick: (loginId: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return createPortal(
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center"
      style={{ background: "color-mix(in srgb, var(--color-ink) 20%, transparent)" }}
      onClick={onClose}
    >
      <div
        className="w-80 rounded-md bg-surface p-4 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-3 text-body-strong text-ink">{t("login.devPick")}</p>
        <div className="flex flex-col gap-1.5">
          {LOCAL_USERS.map((user) => (
            <button
              key={user.loginId}
              type="button"
              className="flex items-center justify-between rounded-sm border border-hairline px-3 py-2 text-caption text-ink hover:bg-surface-alt"
              onClick={() => onPick(user.loginId)}
            >
              <span>
                {user.name} <span className="text-ink-tertiary">({user.loginId})</span>
              </span>
              <span className="text-fine text-ink-tertiary">
                {user.department} · {user.role}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: 로그인 페이지** — `frontend/src/app/login/page.tsx` 신규:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { DevLoginModal } from "@/components/dev-login-modal";
import { setDevUser } from "@/lib/api";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [picking, setPicking] = useState(false);

  // 인증 ON: Keycloak 리디렉트. dynamic import로 useAuth를 provider 밖에서도 안전하게.
  const onKeycloak = async () => {
    const { signinRedirectFromLogin } = await import("@/lib/keycloak-login");
    await signinRedirectFromLogin();
  };

  const onPickDev = (loginId: string) => {
    storeDevUser(loginId);
    setDevUser(loginId);
    setPicking(false);
    router.replace("/");
  };

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="w-80 rounded-md bg-surface p-6 shadow-md">
        <p className="mb-4 text-body-strong text-ink">{t("login.title")}</p>
        <button
          type="button"
          className="w-full rounded-sm bg-accent px-3 py-2 text-caption font-medium text-on-accent hover:bg-accent-focus"
          onClick={() => (AUTH_ENABLED ? void onKeycloak() : setPicking(true))}
        >
          {AUTH_ENABLED ? t("login.keycloak") : t("login.dev")}
        </button>
      </div>
      {picking && <DevLoginModal onPick={onPickDev} onClose={() => setPicking(false)} />}
    </div>
  );
}
```

- [ ] **Step 4: Keycloak 로그인 헬퍼** — `frontend/src/lib/keycloak-login.ts` 신규(provider 밖에서 signinRedirect 트리거):

```typescript
// /login은 AuthProvider 안에서 렌더되므로(게이트가 통과시킴) UserManager를 직접 구성해 호출한다.
import { UserManager } from "oidc-client-ts";

export async function signinRedirectFromLogin(): Promise<void> {
  const mgr = new UserManager({
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
  });
  await mgr.signinRedirect();
}
```

> `oidc-client-ts`는 `react-oidc-context`의 피어 의존성이라 이미 설치돼 있다. 미설치면 `npm i oidc-client-ts`.

- [ ] **Step 5: providers.tsx 게이트 재구성** — 전체 교체:

```typescript
"use client";

import { AuthProvider, useAuth } from "react-oidc-context";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore, type ReactNode } from "react";

import { getMe, setAuthToken, setDevUser } from "@/lib/api";
import { setCurrentUser } from "@/lib/current-user";
import { getStoredDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const subscribe = () => () => {};
function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

function buildOidcConfig() {
  return {
    authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
    client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
    redirect_uri: window.location.origin,
    onSigninCallback: () => {
      window.history.replaceState({}, document.title, window.location.pathname);
    },
  };
}

// 로그인 후 /api/me로 표시 프로필 + role 발행
async function publishMe(): Promise<void> {
  try {
    const me = await getMe();
    setCurrentUser({
      name: me.name || me.username,
      email: null,
      loginId: me.username,
      role: me.role,
      department: me.department,
    });
  } catch {
    setCurrentUser(null);
  }
}

function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setAuthToken(auth.user?.access_token ?? null);
    if (auth.user?.access_token) {
      void publishMe();
    } else {
      setCurrentUser(null);
    }
  }, [auth.user]);

  // 미인증 + /login 외 경로 → /login (와일드카드)
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error) {
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>; // 로그인 화면은 게이트 통과
  }
  if (auth.error) {
    return <div className="p-8 text-caption text-error">{t("auth.error", { msg: auth.error.message })}</div>;
  }
  if (auth.isLoading || !auth.isAuthenticated) {
    return <div className="p-8 text-caption text-ink-tertiary">{t("auth.signingIn")}</div>;
  }
  return <>{children}</>;
}

// 인증 OFF — localStorage devUser 기반 게이트
function DevGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = getStoredDevUser();

  useEffect(() => {
    setDevUser(stored);
    if (stored) {
      void publishMe();
    } else {
      setCurrentUser(null);
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [stored, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (!stored) {
    return null; // 리다이렉트 진행 중
  }
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useMounted();
  if (!mounted) {
    return null;
  }
  if (!AUTH_ENABLED) {
    return <DevGate>{children}</DevGate>;
  }
  return (
    <AuthProvider {...buildOidcConfig()}>
      <AuthGate>{children}</AuthGate>
    </AuthProvider>
  );
}
```

- [ ] **Step 6: 검증** — Run: `cd frontend && npm run lint && npm run build` → Expected: PASS. 수동: `NEXT_PUBLIC_AUTH_ENABLED` 미설정으로 `npm run dev` → `/` 접근 시 `/login`으로, 버튼→모달→선택→메인 진입 확인.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/login frontend/src/components/dev-login-modal.tsx frontend/src/components/providers.tsx frontend/src/lib/keycloak-login.ts frontend/src/lib/i18n-messages.ts
git commit -m "feat(web): /login screen + wildcard gate + dev login modal — 로그인 화면·게이트·임시 모달"
```

---

## Task 12: TopNav 드롭다운 + 관리자 페이지 + 로그아웃

**Files:**
- Modify: `frontend/src/components/top-nav.tsx`
- Create: `frontend/src/app/admin/page.tsx`

- [ ] **Step 1: TopNav 드롭다운** — `top-nav.tsx`에서 유저 표시 영역을 버튼+드롭다운으로. 현재 사용자 구독(`subscribeCurrentUser`/`getCurrentUser`) 부분에 다음 패턴 추가:

```typescript
"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";

import { setDevUser } from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser, setCurrentUser } from "@/lib/current-user";
import { storeDevUser } from "@/lib/dev-auth";
import { useI18n } from "@/lib/i18n";

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

// TopNav 컴포넌트 내부:
function UserMenu() {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);

  if (!user) {
    return null;
  }

  const onLogout = async () => {
    if (AUTH_ENABLED) {
      const { UserManager } = await import("oidc-client-ts");
      const mgr = new UserManager({
        authority: process.env.NEXT_PUBLIC_KEYCLOAK_ISSUER ?? "",
        client_id: process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "",
        redirect_uri: window.location.origin,
      });
      await mgr.removeUser();
    } else {
      storeDevUser(null);
      setDevUser(null);
    }
    setCurrentUser(null);
    router.replace("/login");
  };

  return (
    <div className="relative">
      <button
        type="button"
        className="rounded-sm px-2 py-1 text-caption text-ink hover:bg-surface-alt"
        onClick={() => setOpen((v) => !v)}
      >
        {user.name}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1001] mt-1 w-40 rounded-md border border-hairline bg-surface py-1 shadow-lg">
            {user.role === "admin" && (
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
                onClick={() => {
                  setOpen(false);
                  router.push("/admin");
                }}
              >
                {t("nav.adminPage")}
              </button>
            )}
            <button
              type="button"
              className="block w-full px-3 py-1.5 text-left text-caption text-ink hover:bg-surface-alt"
              onClick={() => void onLogout()}
            >
              {t("nav.logout")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
```

> 기존 TopNav가 사용자명을 표시하던 부분을 `<UserMenu />`로 교체한다. 기존 구독 로직과 중복되면 정리.

- [ ] **Step 2: 관리자 페이지** — `frontend/src/app/admin/page.tsx` 신규:

```typescript
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  listEmployees,
  syncEmployees,
  type EmployeeRow,
  type SyncSummary,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { useI18n } from "@/lib/i18n";
import { useSyncExternalStore } from "react";

export default function AdminPage() {
  const { t } = useI18n();
  const router = useRouter();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  // 비-admin은 메인으로
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/");
    }
  }, [user, router]);

  const load = () => {
    void listEmployees().then(setRows).catch(() => setRows([]));
  };
  useEffect(load, []);

  const onSync = async () => {
    setBusy(true);
    setMsg("");
    try {
      const s: SyncSummary = await syncEmployees();
      setMsg(`scanned ${s.scanned} · upserted ${s.upserted} · excluded ${s.excluded}`);
      load();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "sync failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-3 p-6">
      <div className="flex items-center justify-between">
        <p className="text-body-strong text-ink">{t("admin.title")}</p>
        <button
          type="button"
          className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-40"
          onClick={() => void onSync()}
          disabled={busy}
        >
          {busy ? t("admin.syncing") : t("admin.sync")}
        </button>
      </div>
      {msg && <p className="text-fine text-ink-tertiary">{msg}</p>}
      <table className="w-full text-caption">
        <thead>
          <tr className="border-b border-hairline text-left text-ink-tertiary">
            <th className="py-1">loginId</th>
            <th>name</th>
            <th>title</th>
            <th>department</th>
            <th>role</th>
            <th>source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.login_id} className="border-b border-divider">
              <td className="py-1">{r.login_id}</td>
              <td>{r.name}</td>
              <td>{r.title}</td>
              <td>{r.department}</td>
              <td>{r.role}</td>
              <td>{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 3: 검증** — Run: `cd frontend && npm run lint && npm run build` → Expected: PASS. 수동: `npm run dev` → `admin.kim`으로 로그인 → 유저명 클릭 → "관리자 페이지" → 테이블에 5명, 로그아웃 → `/login` 복귀. `user.lee`는 드롭다운에 관리자 항목 미노출.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/top-nav.tsx frontend/src/app/admin
git commit -m "feat(web): user dropdown (admin/logout) + admin employees table — 유저 드롭다운·관리자 페이지"
```

---

## 최종 검증 · 머지

- [ ] **백엔드**: Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/` → 전체 PASS.
- [ ] **프론트**: Run: `cd frontend && npm run lint && npm run build` → PASS.
- [ ] **수동 플로우**(로컬, auth OFF): `/` → `/login` → 임시 모달 → `admin.kim` → 메인 → 관리자 페이지(5명) → 로그아웃 → `/login`. `user.lee`는 관리자 항목 없음.
- [ ] **머지**: `main` 체크아웃 → `git merge --no-ff feat/auth-login-ad-sync` → `git push origin main` → 브랜치 삭제(로컬·원격).

---

## Self-Review 메모 (작성자 확인 완료)

- **Spec 커버리지**: §3 모델(T1), §4 파싱·필터+테스트(T4), §5 클라이언트·서비스(T5·T6), §6 엔드포인트·가드·admin(T7·T8·T9), §7 설정·시드(T2·T3), §8 프론트(T10·T11·T12) — 전 항목 매핑됨.
- **타입 일관성**: `Me`(api.ts) ↔ `MeOut`(schemas) 필드 일치, `EmployeeRow` ↔ `EmployeeOut`, `SyncSummary` ↔ `SyncSummaryOut`, `LOCAL_USERS` loginId가 백엔드 `LOCAL_USERS`와 일치.
- **블로킹 처리**: ldap3 동기 호출은 `asyncio.to_thread`로 감쌈(이벤트 루프 비차단).
- **주의**: Task 6에서 `service.py`의 import 중복 정리, Task 11에서 `current-user` 변경에 따른 기존 호출부 동시 수정.
