# HR 웹훅 디렉터리 소스 교체 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** employees·조직도의 단일 소스를 AD LDAP에서 사내 n8n HR 웹훅으로 교체한다 (설계: `docs/design/2026-08-10-hr-webhook-directory-design.md`).

**Architecture:** 신규 `backend/app/hr/`(웹훅 클라이언트 + 동기화 서비스)가 employees를 소유하고, `app/ad/`는 client 보존 + title 전용 패스(`refresh_titles`)로 축소. 퇴직자는 삭제 대신 `active=false`(피커·디렉터리 제외 + reconcile), 완전 부재만 청크 삭제. 이행 안전장치로 드라이런 프리뷰 API + 삭제 20% 상한 가드.

**Tech Stack:** FastAPI + SQLAlchemy(async) + `httpx2`(사내 httpx 미러 — 이미 requirements에 있음, httpx 신규 추가 금지) + pytest(monkeypatch 목 — 기존 `test_employees.py` 패턴).

## Global Constraints

- **작업 위치**: dev 브랜치 기준. `feat/hr-webhook-directory` 브랜치를 dev에서 분기(워크트리 권장, `superpowers:using-git-worktrees`). 각 태스크 시작 전 `pwd`·`git branch --show-current`로 위치 실측(서브에이전트 이탈 사고 전례).
- **백엔드 게이트**(전체 그린 기준): `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`.
- **커밋**: `type(scope): English summary — 한국어 요약` + 같은 커밋에 `PROGRESS.md` 한 줄 갱신 동반(`rules/common/git.md`).
- **운영 DB 물리 변경 금지**: email 컬럼 드랍 금지(NOT NULL 완화만), 신규 컬럼은 `db.py` `_ADDED_COLUMNS` 등록, 신규 테이블은 create_all.
- **불변**: `dept_info.manager` 절대 미변경. `korean-names`/`dept-info` 수동 임포트 경로 존치. `app/ad/client.py`·LDAP settings 삭제 금지. HR upsert는 `title` 절대 미터치.
- 신규 파일은 모듈 docstring + `설계: docs/design/2026-08-10-hr-webhook-directory-design.md` 참조 주석. 줄바꿈 LF.
- 주석·코드 컨벤션: why-only 주석, 함수명 동사 시작, 타입힌트 전 시그니처.

---

### Task 1: settings + HR 웹훅 클라이언트 (`app/hr/client.py`)

**Files:**
- Modify: `backend/app/settings.py` (LDAP 블록 아래에 HR 블록 추가)
- Modify: `.env.example` (LDAP 블록 아래), `docker-compose.yml` (backend `environment:` 블록)
- Create: `backend/app/hr/__init__.py` (빈 파일)
- Create: `backend/app/hr/client.py`
- Test: `backend/tests/test_hr_client.py`

**Interfaces:**
- Produces: `settings.n8n_hr_url: str`, `settings.n8n_hr_token: str`, `settings.hr_sync_interval_hours: int`(기본 24), `settings.hr_sync_delete_cap_pct: int`(기본 20), `settings.hr_enabled: bool`(property, URL·TOKEN 둘 다 있을 때 True)
- Produces: `RawHrEmployee(login_id, status, name, name_ko, dept_code, department, department_ko, org_levels: list[str])`, `RawHrDepartment(dept_code, name, name_ko, parent_dept_code, level)`, `parse_employee_row(row: object) -> RawHrEmployee | None`, `parse_department_row(row: object) -> RawHrDepartment | None`, `async fetch_all_employees() -> tuple[int, list[RawHrEmployee | None]]`(count, 파싱 결과 — None=loginId 결측 행), `async fetch_employee(login_id: str) -> RawHrEmployee | None`, `async fetch_departments() -> list[RawHrDepartment]`

- [ ] **Step 1: settings 필드 추가** — `backend/app/settings.py`의 LDAP 블록(`ldap_user_filter` 줄) 뒤에:

```python
    # 사내 n8n HR 웹훅 — 사용자·조직도 단일 소스 (design 2026-08-10). 둘 다 비우면 비활성.
    n8n_hr_url: str = ""  # 예: http://<n8n-host>:5678/webhook/hr-dept
    n8n_hr_token: str = ""  # X-API-Key 시크릿 (.env만)
    hr_sync_interval_hours: int = 24  # 내장 스케줄러 주기(시간). 0 = off
    hr_sync_delete_cap_pct: int = 20  # 전체 동기화 삭제 상한(% of 배치 관리 행). 0 = 가드 off
```

`ldap_enabled` property 아래에:

```python
    @property
    def hr_enabled(self) -> bool:
        """HR 웹훅 동기화 활성 여부 — URL·토큰이 모두 설정된 경우만."""
        return bool(self.n8n_hr_url and self.n8n_hr_token)
```

- [ ] **Step 2: env 3종 세트 동기화** — `.env.example` LDAP 블록 뒤에(값 비움 + 주석), `docker-compose.yml` backend `environment:`(`CSV_MANUAL_URL` 근처)에 추가. **compose 누락 = 컨테이너 미도달 랜드마인**(`rules/backend/config.md`):

```
# === 사내 n8n HR 웹훅 동기화 (design 2026-08-10) ===
# 사용자·조직도 단일 소스. 둘 다 비우면 비활성(로컬 개발). 시크릿(N8N_HR_TOKEN) 커밋 금지.
N8N_HR_URL=
N8N_HR_TOKEN=
HR_SYNC_INTERVAL_HOURS=24
HR_SYNC_DELETE_CAP_PCT=20
```

```yaml
      N8N_HR_URL: ${N8N_HR_URL:-}
      N8N_HR_TOKEN: ${N8N_HR_TOKEN:-}
      HR_SYNC_INTERVAL_HOURS: ${HR_SYNC_INTERVAL_HOURS:-24}
      HR_SYNC_DELETE_CAP_PCT: ${HR_SYNC_DELETE_CAP_PCT:-20}
```

- [ ] **Step 3: 파싱 실패 테스트 작성** — `backend/tests/test_hr_client.py`:

```python
"""HR 웹훅 클라이언트 파싱 테스트 — 순수 함수(HTTP 없음). 설계 §1 계약: loginId 외 전부 null 가능."""

from app.hr.client import RawHrEmployee, parse_department_row, parse_employee_row


def test_parse_employee_full_row() -> None:
    row = {
        "loginId": "hong.gd", "status": "active", "name": "Gildong Hong",
        "nameKo": "홍길동", "deptCode": "D100", "department": "Sourcing Team 1",
        "departmentKo": "구매1팀",
        "orgLevels": ["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    }
    parsed = parse_employee_row(row)
    assert parsed == RawHrEmployee(
        login_id="hong.gd", status="active", name="Gildong Hong", name_ko="홍길동",
        dept_code="D100", department="Sourcing Team 1", department_ko="구매1팀",
        org_levels=["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    )


def test_parse_employee_nulls_and_blank_levels() -> None:
    # loginId 외 전부 null/공백 — 전부 None, orgLevels의 빈 항목은 압축
    row = {"loginId": " kim.cs ", "status": None, "name": "", "orgLevels": ["A", "", None, "B"]}
    parsed = parse_employee_row(row)
    assert parsed is not None
    assert parsed.login_id == "kim.cs"
    assert parsed.status is None and parsed.name is None
    assert parsed.org_levels == ["A", "B"]


def test_parse_employee_missing_login_id_returns_none() -> None:
    assert parse_employee_row({"name": "X"}) is None
    assert parse_employee_row({"loginId": "  "}) is None
    assert parse_employee_row("not-a-dict") is None


def test_parse_department_row() -> None:
    parsed = parse_department_row(
        {"deptCode": "D100", "name": "HR Team", "nameKo": "인사팀", "parentDeptCode": "D1", "level": 3}
    )
    assert parsed is not None
    assert (parsed.dept_code, parsed.parent_dept_code, parsed.level) == ("D100", "D1", 3)
    assert parse_department_row({"name": "no code"}) is None
    assert parse_department_row({"deptCode": "D2", "level": "bad"}).level is None
```

- [ ] **Step 4: 실패 확인** — `cd backend && .venv/bin/python -m pytest tests/test_hr_client.py -q` → `ModuleNotFoundError: app.hr` FAIL 확인.

- [ ] **Step 5: 구현** — `backend/app/hr/__init__.py`(빈 파일) + `backend/app/hr/client.py`:

```python
"""n8n HR 웹훅 클라이언트 — 사용자·조직도 단일 소스.

설계: docs/design/2026-08-10-hr-webhook-directory-design.md §1·§2.
부분검색 불가 계약 — 단건은 반드시 loginId, 전수는 status=all.
"""

from dataclasses import dataclass

import httpx2

from app.settings import settings

# 계약 §1 — 전수 약 6,000명/3MB/수초, 상한 180초
HR_TIMEOUT_SECONDS = 180.0


@dataclass(frozen=True)
class RawHrEmployee:
    login_id: str
    status: str | None  # "active" | "inactive" | None(결측 → 서비스가 active 보수 판정)
    name: str | None
    name_ko: str | None
    dept_code: str | None
    department: str | None
    department_ko: str | None
    org_levels: list[str]  # 루트→리프, 빈 단계 압축(최대 6)


@dataclass(frozen=True)
class RawHrDepartment:
    dept_code: str
    name: str | None
    name_ko: str | None
    parent_dept_code: str | None
    level: int | None


def _clean(value: object) -> str | None:
    """문자열 필드 정규화 — 비문자열·공백은 None (loginId 외 전 필드 null 가능 계약)."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def parse_employee_row(row: object) -> RawHrEmployee | None:
    """employees row → RawHrEmployee. loginId 결측·비객체 행은 None — 호출부가 skip 카운트."""
    if not isinstance(row, dict):
        return None
    login_id = _clean(row.get("loginId"))
    if login_id is None:
        return None
    levels_raw = row.get("orgLevels")
    org_levels = (
        [lv for lv in (_clean(x) for x in levels_raw) if lv is not None]
        if isinstance(levels_raw, list)
        else []
    )
    return RawHrEmployee(
        login_id=login_id,
        status=_clean(row.get("status")),
        name=_clean(row.get("name")),
        name_ko=_clean(row.get("nameKo")),
        dept_code=_clean(row.get("deptCode")),
        department=_clean(row.get("department")),
        department_ko=_clean(row.get("departmentKo")),
        org_levels=org_levels,
    )


def parse_department_row(row: object) -> RawHrDepartment | None:
    """departments row → RawHrDepartment. deptCode 결측 행은 None."""
    if not isinstance(row, dict):
        return None
    dept_code = _clean(row.get("deptCode"))
    if dept_code is None:
        return None
    level = row.get("level")
    return RawHrDepartment(
        dept_code=dept_code,
        name=_clean(row.get("name")),
        name_ko=_clean(row.get("nameKo")),
        parent_dept_code=_clean(row.get("parentDeptCode")),
        level=level if isinstance(level, int) else None,
    )


async def _post(payload: dict) -> dict:
    async with httpx2.AsyncClient(timeout=HR_TIMEOUT_SECONDS) as client:
        response = await client.post(
            settings.n8n_hr_url,
            json=payload,
            headers={"X-API-Key": settings.n8n_hr_token},
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}


async def fetch_all_employees() -> tuple[int, list[RawHrEmployee | None]]:
    """전 직원(퇴직 포함, status=all). (응답 count, 행별 파싱 결과) — count·len 정합은 서비스가 검증."""
    body = await _post({"kind": "employees", "status": "all"})
    rows = body.get("rows") or []
    return int(body.get("count") or 0), [parse_employee_row(r) for r in rows]


async def fetch_employee(login_id: str) -> RawHrEmployee | None:
    """단건 조회 — 계약상 부분검색 불가, loginId 정확 일치만 신뢰."""
    body = await _post({"kind": "employees", "loginId": login_id})
    for row in body.get("rows") or []:
        parsed = parse_employee_row(row)
        if parsed is not None and parsed.login_id == login_id:
            return parsed
    return None


async def fetch_departments() -> list[RawHrDepartment]:
    body = await _post({"kind": "departments"})
    return [d for d in (parse_department_row(r) for r in body.get("rows") or []) if d is not None]
```

- [ ] **Step 6: 통과 확인** — `pytest tests/test_hr_client.py -q` PASS + `ruff check app/hr tests/test_hr_client.py` 0건.

- [ ] **Step 7: 커밋** — PROGRESS.md 한 줄 추가 후:

```bash
git add backend/app/settings.py backend/app/hr .env.example docker-compose.yml backend/tests/test_hr_client.py PROGRESS.md
git commit -m "feat(hr): n8n HR webhook client + settings — HR 웹훅 클라이언트·설정 3종 세트"
```

---

### Task 2: 스키마 — `dept_code`·`departments` 신설, `email` 제거

**Files:**
- Modify: `backend/app/models.py` (Employee 462줄 근처 email 제거·dept_code 추가, Department 클래스 신설)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` + 부트스트랩 스텝)
- Modify: `backend/app/ad/service.py` (email 잔재만 — sync 기계는 이 태스크에서 유지)
- Modify: `backend/scripts/seed_org_demo.py` (188·202줄 `email=` 인자 제거)
- Test: `backend/tests/test_hr_schema.py`

**Interfaces:**
- Produces: `models.Department`(`__tablename__="departments"`: `dept_code` PK str(100), `parent_dept_code: str | None`, `level: int`, `name: str`, `name_ko: str`, `updated_at`), `Employee.dept_code: str | None`, Employee에서 `email` 소멸
- Consumes: 없음 (독립)

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_schema.py`:

```python
"""HR 스키마 테스트 — departments 테이블·dept_code 컬럼·email 모델 제거 회귀."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Department, Employee


def test_employee_insert_without_email_and_department_table(client: TestClient) -> None:
    """email 모델 제거 후 신규 INSERT 성공 + departments 테이블 생성 확인 (설계 §3)."""

    async def _run() -> tuple[bool, bool]:
        async with SessionLocal() as session:
            emp = Employee(login_id="hr.schema-probe", name="Probe", source="hr", dept_code="D9")
            session.add(emp)
            session.add(Department(dept_code="D9", name="Probe Team", name_ko="프로브팀", level=3))
            await session.commit()
            saved = await session.get(Employee, "hr.schema-probe")
            dept = await session.get(Department, "D9")
            return saved is not None and saved.dept_code == "D9", dept is not None

    emp_ok, dept_ok = asyncio.run(_run())
    assert emp_ok and dept_ok


def test_employee_model_has_no_email() -> None:
    assert not hasattr(Employee, "email")
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_hr_schema.py -q` → `ImportError: Department` FAIL.

- [ ] **Step 3: models.py 수정** — Employee에서 `email: Mapped[str] = ...` 줄 삭제, `department` 줄 아래에:

```python
    # HR deptCode — departments.dept_code 느슨 참조 (design 2026-08-10 §3). AD 시절 행은 NULL.
    dept_code: Mapped[str | None] = mapped_column(String(100), default=None)
```

Employee 449줄 근처 docstring·주석의 "email from mail attr" 문구 제거, source 주석을 `ad | local | hr`로 갱신. DeptInfo 클래스 아래에 신설:

```python
class Department(Base):
    """HR 조직도 미러 — kind=departments 응답 그대로, dept_code 키.

    이번 범위 소비처 없음(조직도 트리 후속 기반). 설계: docs/design/2026-08-10-hr-webhook-directory-design.md §3.
    """

    __tablename__ = "departments"

    dept_code: Mapped[str] = mapped_column(String(100), primary_key=True)
    parent_dept_code: Mapped[str | None] = mapped_column(String(100), default=None)
    level: Mapped[int] = mapped_column(Integer, default=0)
    name: Mapped[str] = mapped_column(String(300), default="")
    name_ko: Mapped[str] = mapped_column(String(300), default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

- [ ] **Step 4: db.py 수정** — `_ADDED_COLUMNS` 말미에:

```python
    # HR 웹훅 동기화 — deptCode 미러 (design 2026-08-10 §3)
    ("employees", "dept_code", "VARCHAR(100)"),
```

부트스트랩 함수 신설(`_widen_interview_message_kind` 아래) 후 `init_models`의 스텝 튜플에 `_relax_employees_email_not_null` 추가:

```python
def _relax_employees_email_not_null(conn: Connection) -> None:
    """employees.email 모델 제거(design 2026-08-10 §3) 후속 — 운영 Postgres 컬럼이 NOT NULL(서버 default 없음)이라
    ORM INSERT가 email을 안 보내면 즉사. 물리 드랍 없이 NULL 허용 완화만. sqlite는 ALTER 불가 → 로컬 reset_db로 흡수."""
    if conn.dialect.name != "postgresql":
        return
    inspector = inspect(conn)
    if "employees" not in inspector.get_table_names():
        return
    cols = {c["name"]: c for c in inspector.get_columns("employees")}
    if "email" in cols and not cols["email"].get("nullable", True):
        conn.execute(text("ALTER TABLE employees ALTER COLUMN email DROP NOT NULL"))
```

- [ ] **Step 5: email 잔재 제거** — `app/ad/service.py`: `LOCAL_USERS` 시드 루프의 `emp.email = f"{spec['login_id']}@corp"` 줄과 그 주석, `EmployeeFields.email` 필드, `to_employee_fields(...)의 email=raw.mail or ""`, `_upsert`의 `emp.email = fields.email` 삭제(그 외 sync 기계는 그대로 — Task 6에서 제거). `scripts/seed_org_demo.py` 188·202줄 `email=...` 인자 삭제. `git grep -n "\.email\|email=" backend/app backend/scripts backend/tests`로 잔재 0 확인(ad/client.py의 `mail` attr은 LDAP 클라이언트 보존 대상 — 유지).

- [ ] **Step 6: 통과 확인** — `pytest tests/test_hr_schema.py -q` PASS, 이어서 전체 게이트 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` 그린(기존 테스트 중 email 단언이 있으면 이 스텝에서 함께 수정).

- [ ] **Step 7: 커밋**

```bash
git add backend/app/models.py backend/app/db.py backend/app/ad/service.py backend/scripts/seed_org_demo.py backend/tests/test_hr_schema.py PROGRESS.md
git commit -m "feat(hr): departments mirror table + dept_code, drop email from model — 부서 미러·dept_code 신설, email 모델 제거(운영 NOT NULL 완화)"
```

---

### Task 3: HR 매핑 (`app/hr/service.py` 1부 — 순수 함수)

**Files:**
- Create: `backend/app/hr/service.py`
- Test: `backend/tests/test_hr_mapping.py`

**Interfaces:**
- Consumes: Task 1 `RawHrEmployee`
- Produces: `HrEmployeeFields(login_id, name, korean_name: str | None, korean_dept: str | None, dept_code: str | None, department, org_l1..org_l5, active: bool, role: str, dept_mismatch: bool, truncated: bool)`, `to_employee_fields(raw: RawHrEmployee) -> HrEmployeeFields`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_mapping.py`:

```python
"""HR 행 → Employee 필드 매핑 테스트 — 순수 함수. 설계 §4 매핑 표·불변식 감시."""

from app.hr.client import RawHrEmployee
from app.hr.service import to_employee_fields


def _raw(**overrides) -> RawHrEmployee:
    base = dict(
        login_id="hong.gd", status="active", name="Gildong Hong", name_ko="홍길동",
        dept_code="D100", department="Sourcing Team 1", department_ko="구매1팀",
        org_levels=["Div", "Office", "Sourcing Team 1"],
    )
    base.update(overrides)
    return RawHrEmployee(**base)


def test_basic_mapping() -> None:
    f = to_employee_fields(_raw())
    assert (f.login_id, f.name, f.korean_name, f.korean_dept) == ("hong.gd", "Gildong Hong", "홍길동", "구매1팀")
    assert (f.org_l1, f.org_l2, f.org_l3, f.org_l4, f.org_l5) == ("Div", "Office", "Sourcing Team 1", None, None)
    assert f.department == "Sourcing Team 1"
    assert f.active is True and f.dept_mismatch is False and f.truncated is False


def test_null_fallbacks() -> None:
    # name null → login_id, department null → orgLevels 리프, korean 계열 null 그대로(보존 신호)
    f = to_employee_fields(_raw(name=None, name_ko=None, department=None, department_ko=None))
    assert f.name == "hong.gd"
    assert f.department == "Sourcing Team 1"
    assert f.korean_name is None and f.korean_dept is None


def test_status_mapping() -> None:
    assert to_employee_fields(_raw(status="inactive")).active is False
    assert to_employee_fields(_raw(status=None)).active is True  # 결측 → 보수적으로 활성(AD uac None 관례)


def test_six_levels_truncated_and_mismatch_flagged() -> None:
    # 6레벨 → org_l1~l5는 루트 쪽 5개, department(리프 L6)는 저장 경로 리프와 어긋남 → 리포트 플래그
    f = to_employee_fields(_raw(org_levels=["A", "B", "C", "D", "E", "F"], department="F"))
    assert (f.org_l1, f.org_l5) == ("A", "E")
    assert f.truncated is True and f.dept_mismatch is True


def test_department_mismatch_without_truncation() -> None:
    f = to_employee_fields(_raw(department="Other Team"))
    assert f.dept_mismatch is True and f.truncated is False


def test_empty_org_levels() -> None:
    f = to_employee_fields(_raw(org_levels=[], department="Solo Team"))
    assert f.org_l1 is None and f.department == "Solo Team" and f.dept_mismatch is False
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_hr_mapping.py -q` → FAIL(`app.hr.service` 없음).

- [ ] **Step 3: 구현** — `backend/app/hr/service.py` 신설(이 태스크는 매핑까지만):

```python
"""HR 웹훅 동기화 서비스 — 전체/단건 동기화·부서 미러·이행 프리뷰.

설계: docs/design/2026-08-10-hr-webhook-directory-design.md §4~§6·§9.
title은 절대 건드리지 않는다 — AD title 패스(app/ad/service.refresh_titles) 전용.
"""

import logging
from dataclasses import dataclass

from app.hr.client import RawHrEmployee
from app.settings import settings

logger = logging.getLogger(__name__)


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
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_hr_mapping.py -q` PASS + ruff 0.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/hr/service.py backend/tests/test_hr_mapping.py PROGRESS.md
git commit -m "feat(hr): pure mapping HR row -> employee fields — HR 매핑(널 폴백·절사·불일치 플래그)"
```

---

### Task 4: 전체 동기화 코어 (`sync_all` — upsert·비활성·청크 삭제·가드·미러·고아 리포트)

**Files:**
- Modify: `backend/app/hr/service.py`
- Test: `backend/tests/test_hr_sync.py`

**Interfaces:**
- Consumes: Task 1 `fetch_all_employees`/`fetch_departments`(테스트에서 monkeypatch), Task 3 `to_employee_fields`, 기존 `workflow.reconcile_departures(session, departed: set[str])`
- Produces: `HrSyncSummary(scanned, upserted, deactivated, deleted, skipped, org_mismatches, truncated_levels, departments_upserted, dept_info_orphans: list[str], title_refreshed: int | None = None, aborted_reason: str | None = None)`, `async sync_all(session) -> HrSyncSummary`, `async run_full_sync(session) -> HrSyncSummary`(5분 가드), `class SyncTooSoon(Exception)`(`.remaining_seconds`), `_chunks(items: list, size: int)`

- [ ] **Step 1: 공유 헬퍼 + 실패 테스트 작성** — 먼저 `backend/tests/hr_sync_helpers.py` 신설(테스트 파일 간 직접 import는 `tests/`가 패키지가 아니라 불가 — conftest 로드 시 tests/가 sys.path에 올라 평모듈 import는 가능). 목 패턴은 `test_employees.py::_mock_ldap`와 동일하게 모듈 함수 monkeypatch(HTTP 없음):

```python
# backend/tests/hr_sync_helpers.py
"""HR 동기화 테스트 공유 헬퍼 — 행 빌더·목·시드 (test_hr_sync/endpoints/title_pass/active_filter 공용)."""

import asyncio

from app.db import SessionLocal
from app.hr.client import RawHrEmployee
from app.models import Employee
from app.settings import settings


def _hr_row(login_id: str, **overrides) -> RawHrEmployee:
    base = dict(
        login_id=login_id, status="active", name=login_id, name_ko=None, dept_code=None,
        department="Team A", department_ko=None, org_levels=["Div", "Team A"],
    )
    base.update(overrides)
    return RawHrEmployee(**base)


def _mock_hr(monkeypatch, employees: list, count: int | None = None, departments: list | None = None) -> None:
    """HR 설정 위장 + 가드 리셋 + fetch 목 — parsed 리스트(None=skip 행 포함)를 그대로 주입.

    삭제 상한 가드는 기본 해제(cap=0) — 세션 공유 DB에 다른 테스트의 hr/ad 잔류 행이 있어
    소규모 피드가 상한을 오탐하면 무관 테스트가 abort로 오염된다. 가드 테스트만 명시적으로 켠다."""
    from app.hr import client as hr_client
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.local/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 0)
    monkeypatch.setattr(hr_service, "_last_full_sync_at", None)

    async def fake_all():
        return (count if count is not None else sum(1 for e in employees)), employees

    async def fake_depts():
        return departments or []

    monkeypatch.setattr(hr_client, "fetch_all_employees", fake_all)
    monkeypatch.setattr(hr_client, "fetch_departments", fake_depts)


def _seed_employee(login_id: str, *, source: str, active: bool = True, **cols) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id)
                session.add(emp)
            emp.source = source
            emp.active = active
            for key, value in cols.items():
                setattr(emp, key, value)
            await session.commit()

    asyncio.run(_run())


def _get_employee(login_id: str) -> Employee | None:
    async def _run() -> Employee | None:
        async with SessionLocal() as session:
            return await session.get(Employee, login_id)

    return asyncio.run(_run())


def _run_sync():
    from app.hr.service import sync_all

    async def _run():
        async with SessionLocal() as session:
            return await sync_all(session)

    return asyncio.run(_run())
```

이어서 `backend/tests/test_hr_sync.py`:

```python
"""HR 전체 동기화 테스트 — 목·시드 헬퍼는 hr_sync_helpers 공유(실 HTTP 없음). 설계 §5."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.hr.client import RawHrDepartment
from app.models import Department, DeptInfo
from app.settings import settings
from hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee


def test_sync_upserts_and_converts_ad_source(client: TestClient, monkeypatch) -> None:
    _seed_employee("legacy.ad", source="ad", title="Manager", korean_name="레거시")
    _mock_hr(monkeypatch, [_hr_row("legacy.ad", name="Legacy Kim"), _hr_row("new.hr")])
    summary = _run_sync()
    assert summary.upserted == 2 and summary.aborted_reason is None
    emp = _get_employee("legacy.ad")
    assert emp.source == "hr" and emp.name == "Legacy Kim"
    assert emp.title == "Manager"       # title 미터치 (§4)
    assert emp.korean_name == "레거시"   # nameKo null → 보존
    assert _get_employee("new.hr") is not None


def test_sync_deactivates_and_preserves_local(client: TestClient, monkeypatch) -> None:
    _seed_employee("quit.user", source="hr", active=True)
    _seed_employee("local.dev1", source="local")
    _mock_hr(monkeypatch, [_hr_row("quit.user", status="inactive")])
    summary = _run_sync()
    assert summary.deactivated == 1
    assert _get_employee("quit.user").active is False       # 삭제 아님 (§5-2)
    assert _get_employee("local.dev1") is not None          # local 보존 (§5-3)


def test_sync_deletes_absent_managed_rows(client: TestClient, monkeypatch) -> None:
    _seed_employee("gone.ad", source="ad")
    _seed_employee("gone.hr", source="hr")
    _seed_employee("stay.local", source="local")
    _mock_hr(monkeypatch, [_hr_row("alive.hr")])  # 가드는 _mock_hr가 기본 해제
    summary = _run_sync()
    assert summary.deleted >= 2
    assert _get_employee("gone.ad") is None and _get_employee("gone.hr") is None
    assert _get_employee("stay.local") is not None


def test_sync_delete_cap_aborts_without_changes(client: TestClient, monkeypatch) -> None:
    _seed_employee("cap.a", source="hr")
    _seed_employee("cap.b", source="hr")
    _mock_hr(monkeypatch, [_hr_row("cap.new")])  # 기존 배치 관리 행 대부분 삭제될 피드
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 20)  # _mock_hr 기본 해제 후 가드 재활성
    summary = _run_sync()
    assert summary.aborted_reason is not None and "delete cap" in summary.aborted_reason
    assert _get_employee("cap.a") is not None    # 아무것도 안 바뀜
    assert _get_employee("cap.new") is None


def test_sync_count_mismatch_aborts(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("x.y")], count=99)
    summary = _run_sync()
    assert summary.aborted_reason is not None and "count" in summary.aborted_reason


def test_sync_skips_rows_without_login_id_and_reports(client: TestClient, monkeypatch) -> None:
    rows = [_hr_row("ok.user"), None,
            _hr_row("deep.user", org_levels=["A", "B", "C", "D", "E", "F"], department="F")]
    _mock_hr(monkeypatch, rows)
    summary = _run_sync()
    assert summary.skipped == 1
    assert summary.truncated_levels == 1 and summary.org_mismatches == 1


def test_sync_chunked_delete_over_bind_limit(client: TestClient, monkeypatch) -> None:
    # SQLite 바인드 상한(구버전 999) 초과 삭제가 청크로 완료되는지 (§5-3)
    for i in range(1100):
        _seed_employee(f"bulk{i}.hr", source="hr")
    _mock_hr(monkeypatch, [_hr_row("survivor.hr")])
    summary = _run_sync()
    assert summary.deleted >= 1100
    assert _get_employee("bulk0.hr") is None and _get_employee("bulk1099.hr") is None


def test_sync_mirrors_departments_and_reports_dept_info_orphans(client: TestClient, monkeypatch) -> None:
    async def _seed_info() -> None:
        async with SessionLocal() as session:
            if await session.get(DeptInfo, "Ghost Team") is None:
                session.add(DeptInfo(department="Ghost Team", korean_name="유령팀", manager="ghost.mgr"))
            await session.commit()

    asyncio.run(_seed_info())
    depts = [RawHrDepartment("D1", "Div", "본부", None, 1), RawHrDepartment("D11", "Team A", "A팀", "D1", 2)]
    _mock_hr(monkeypatch, [_hr_row("mirror.user")], departments=depts)
    summary = _run_sync()
    assert summary.departments_upserted == 2
    assert "Ghost Team" in summary.dept_info_orphans

    async def _check() -> tuple:
        async with SessionLocal() as session:
            dept = await session.get(Department, "D11")
            info = await session.get(DeptInfo, "Ghost Team")
            return dept, info

    dept, info = asyncio.run(_check())
    assert dept is not None and dept.parent_dept_code == "D1"
    assert info is not None and info.manager == "ghost.mgr"  # dept_info 절대 미변경 (§5-6)


def test_reconcile_releases_checkout_of_deactivated(client: TestClient, monkeypatch) -> None:
    # 비활성 전환자가 잡던 점유가 해제되는지 — reconcile_departures 경유 (§5-2)
    from app.models import MapVersion, ProcessMap

    async def _seed() -> int:
        async with SessionLocal() as session:
            pmap = ProcessMap(name="HR Reconcile Map", created_by="local-dev",
                              owning_department="Owning Anchor Division")
            session.add(pmap)
            await session.flush()
            version = MapVersion(map_id=pmap.id, label="draft", created_by="local-dev",
                                 checked_out_by="hold.user", status="draft")
            session.add(version)
            await session.commit()
            return version.id

    version_id = asyncio.run(_seed())
    _seed_employee("hold.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("hold.user", status="inactive")])
    _run_sync()

    async def _checked_out() -> str | None:
        async with SessionLocal() as session:
            return (await session.get(MapVersion, version_id)).checked_out_by

    assert asyncio.run(_checked_out()) is None
```

주의: `MapVersion`/`ProcessMap` 생성 인자는 실제 모델 필수 컬럼에 맞춰 실행 시점에 조정(기존 테스트 예: `test_employees.py`의 프룬-리컨사일 테스트를 먼저 읽고 같은 시드 방식을 재사용할 것).

- [ ] **Step 2: 실패 확인** — `pytest tests/test_hr_sync.py -q` → FAIL(`sync_all` 없음).

- [ ] **Step 3: 구현** — `app/hr/service.py`에 추가:

```python
import asyncio
import time

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.hr import client
from app.models import Department, DeptInfo, Employee

_DELETE_CHUNK = 500  # SQLite IN 바인드 상한(구버전 999) 아래로 유지 (§5-3)


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
```

(`from dataclasses import dataclass, field`로 상단 import 갱신 — mutable 기본값은 `field(default_factory=list)` 필수.)

```python
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
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_hr_sync.py -q` PASS + ruff 0. (`refresh_titles` 지연 import는 `ldap_enabled=False` 테스트 기본에서 실행 안 됨 — Task 6 전까지 안전.)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/hr/service.py backend/tests/hr_sync_helpers.py backend/tests/test_hr_sync.py PROGRESS.md
git commit -m "feat(hr): full sync core with safety guards — 전체 동기화(비활성 전환·청크 삭제·상한 가드·부서 미러·고아 리포트)"
```

---

### Task 5: 소스 교체 — sync 엔드포인트·프리뷰·`/api/me` 1인 동기화·FE 요약

**Files:**
- Modify: `backend/app/hr/service.py` (`sync_one` + 스로틀, `build_sync_preview`)
- Modify: `backend/app/routers/employees.py` (HR 경로로 교체 + `/sync-preview` 신설)
- Modify: `backend/app/main.py` (`/api/me` 1인 동기화 게이트·호출 교체)
- Modify: `backend/app/schemas.py` (`SyncSummaryOut` 개편 + `HrSyncPreviewOut` 신설)
- Modify: `frontend/src/lib/api.ts` (SyncSummary 타입), `frontend/src/components/admin/employee-table.tsx` (38줄 요약 문자열)
- Test: `backend/tests/test_hr_endpoints.py`

**Interfaces:**
- Consumes: Task 4 `run_full_sync`/`SyncTooSoon`, Task 1 `fetch_employee`
- Produces: `async sync_one(session, login_id: str) -> Employee | None`(하루 1회 스로틀, `_one_sync_done: dict[str, str]` 모듈 상태), `async build_sync_preview(session) -> HrSyncPreview`, `HrSyncPreview(scanned, skipped, would_upsert, would_deactivate, would_delete, org_mismatches, truncated_levels, korean_overwrites, new_login_ids: list[str], delete_login_ids: list[str], case_mismatches: list[str], orphan_dept_paths: list[str], dept_info_orphans: list[str])`(샘플 리스트는 50개 캡), 스키마 `SyncSummaryOut`/`HrSyncPreviewOut`

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_endpoints.py`(목 헬퍼는 `hr_sync_helpers.py` 재사용):

```python
"""HR 엔드포인트 테스트 — sync 503/429/요약, 프리뷰(무변경·diff), /api/me 1인 동기화 스로틀."""

import asyncio

from fastapi.testclient import TestClient

from app.settings import settings
from hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _seed_employee


def test_sync_503_without_hr_config(client: TestClient) -> None:
    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 503


def test_sync_endpoint_returns_new_summary_and_guard(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("ep.user"), None])
    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["upserted"] == 1 and body["skipped"] == 1
    assert "dept_info_orphans" in body and body["aborted_reason"] is None
    assert client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"}).status_code == 429


def test_sync_preview_reports_without_writes(client: TestClient, monkeypatch) -> None:
    _seed_employee("pv.gone", source="hr")
    _seed_employee("PV.case", source="hr")
    _mock_hr(monkeypatch, [_hr_row("pv.new"), _hr_row("pv.case")])
    res = client.post("/api/employees/sync-preview", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert "pv.new" in body["new_login_ids"]
    assert "pv.gone" in body["delete_login_ids"]
    assert any("pv.case" in m for m in body["case_mismatches"])  # 표기 불일치 감지 (§9)
    assert _get_employee("pv.new") is None            # 무변경
    assert _get_employee("pv.gone") is not None


def test_me_syncs_once_per_day(client: TestClient, monkeypatch) -> None:
    from app.hr import client as hr_client
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.local/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    hr_service._one_sync_done.clear()
    calls = {"n": 0}

    async def fake_one(login_id: str):
        calls["n"] += 1
        return _hr_row(login_id, name="Fresh Name")

    monkeypatch.setattr(hr_client, "fetch_employee", fake_one)
    # auth ON이므로 JWT 검증을 우회해 사용자 주입
    from app import auth as auth_mod
    from app.main import app

    app.dependency_overrides[auth_mod.get_current_user] = lambda: "me.user"
    try:
        assert client.get("/api/me").status_code == 200
        assert client.get("/api/me").status_code == 200
    finally:
        app.dependency_overrides.pop(auth_mod.get_current_user, None)
    assert calls["n"] == 1                       # 하루 1회 스로틀 (§6)
    assert _get_employee("me.user").name == "Fresh Name"
```

주의: `/api/me` 의존성 오버라이드 방식은 기존 auth 테스트(`grep -rn "dependency_overrides" tests/`)가 있으면 그 방식을 따른다. 없고 auth OFF 헤더 방식이 더 맞으면 `auth_enabled` 게이트를 monkeypatch로 켠 채 `X-Dev-User` 대신 오버라이드 사용 — 게이트 조건이 `auth_enabled and hr_enabled`이므로 auth ON 위장이 필수.

- [ ] **Step 2: 실패 확인** — `pytest tests/test_hr_endpoints.py -q` FAIL.

- [ ] **Step 3: 서비스 구현** — `app/hr/service.py`에 추가:

```python
from dataclasses import field

from app.clock import now_kst
from app.models import MapPermission, ProcessMap, UserGroupMember

_PREVIEW_SAMPLE_CAP = 50  # 프리뷰 샘플 리스트 상한 — 6천명 전수 나열 방지

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
        logger.exception("HR single sync failed for %s — keeping existing row", login_id)
        return None
    _one_sync_done[login_id] = today  # 미존재·성공 모두 오늘 재조회 안 함
    if raw is None:
        return None
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
    dept_info_orphans: list[str] = field(default_factory=list)


async def build_sync_preview(session: AsyncSession) -> HrSyncPreview:
    """이행 드라이런 (§9) — DB 무변경으로 첫 실동기화 영향 정량화. 가드 미소모."""
    _, parsed = await client.fetch_all_employees()
    skipped = sum(1 for p in parsed if p is None)
    fields_by_id = {r.login_id: to_employee_fields(r) for r in parsed if r is not None}

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
        dept_info_orphans=(await _find_dept_info_orphans(session))[:_PREVIEW_SAMPLE_CAP],
    )
```

- [ ] **Step 4: 스키마 개편** — `app/schemas.py`의 `SyncSummaryOut`을 교체 + 프리뷰 신설:

```python
class SyncSummaryOut(BaseModel):
    """HR 전체 동기화 요약 (design 2026-08-10 §5-9). aborted_reason 있으면 DB 무변경 중단."""

    scanned: int
    upserted: int
    deactivated: int
    deleted: int
    skipped: int
    org_mismatches: int
    truncated_levels: int
    departments_upserted: int
    dept_info_orphans: list[str]
    title_refreshed: int | None = None
    aborted_reason: str | None = None


class HrSyncPreviewOut(BaseModel):
    """이행 드라이런 리포트 (design 2026-08-10 §9) — 샘플 리스트는 50개 캡."""

    scanned: int
    skipped: int
    would_upsert: int
    would_deactivate: int
    would_delete: int
    org_mismatches: int
    truncated_levels: int
    korean_overwrites: int
    new_login_ids: list[str]
    delete_login_ids: list[str]
    case_mismatches: list[str]
    orphan_dept_paths: list[str]
    dept_info_orphans: list[str]
```

- [ ] **Step 5: 라우터 교체** — `app/routers/employees.py`: `from app.ad.service import SyncTooSoon, run_full_sync` → `from app.hr.service import SyncTooSoon, build_sync_preview, run_full_sync`. `sync_employees`의 게이트를 `if not settings.hr_enabled: raise HTTPException(503, "HR webhook not configured")`로, 반환을 `SyncSummaryOut(**asdict(summary))`(`from dataclasses import asdict`)로. 프리뷰 신설:

```python
@router.post("/sync-preview", response_model=HrSyncPreviewOut)
async def preview_sync(
    _: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> HrSyncPreviewOut:
    """이행 드라이런 — DB 무변경 diff 리포트. 5분 가드 미소모 (design §9 운영 이행 절차 2단계)."""
    if not settings.hr_enabled:
        raise HTTPException(status_code=503, detail="HR webhook not configured")
    return HrSyncPreviewOut(**asdict(await build_sync_preview(session)))
```

- [ ] **Step 6: `/api/me` 교체** — `app/main.py` get_me의 동기화 블록을:

```python
    # 인증 ON + HR 웹훅 설정 시 로그인 시점 1인 동기화 — 하루 1회 스로틀은 서비스가 담당 (design §6)
    if settings.auth_enabled and settings.hr_enabled:
        from app.hr.service import sync_one

        await sync_one(session, login_id)
```

- [ ] **Step 7: FE 갱신** — `frontend/src/lib/api.ts` SyncSummary 인터페이스를 새 필드로 교체(`scanned, upserted, deactivated, deleted, skipped, org_mismatches, truncated_levels, departments_upserted, dept_info_orphans: string[], title_refreshed: number | null, aborted_reason: string | null`), `employee-table.tsx` 38줄 요약을:

```tsx
        s.aborted_reason
          ? `aborted — ${s.aborted_reason}`
          : `scanned ${s.scanned} · upserted ${s.upserted} · deactivated ${s.deactivated} · deleted ${s.deleted} · skipped ${s.skipped}`,
```

- [ ] **Step 8: 구 AD sync 테스트 임시 제거 대상 확인** — `tests/test_employees.py`의 LDAP sync 테스트(`test_sync_503_without_ldap`, `test_sync_mocked_filters_and_guards`, 프룬 테스트들)는 이 태스크로 라우터가 HR을 보므로 깨진다. **이 태스크에서 함께 개편**: 503 테스트는 Step 1의 HR 503 테스트가 대체(구 테스트 삭제), mocked-sync·프룬·가드 테스트는 `test_hr_sync.py`/`test_hr_endpoints.py`가 대체(구 테스트 삭제). `to_employee_fields`(AD) 직접 테스트(`test_ad_active.py` 일부, `test_employees.py` 일부)는 Task 6에서 함수가 사라질 때 정리하되, 여기서 이미 깨지면 여기서 삭제. `test_sync_requires_admin`은 유지(경로 무관).

- [ ] **Step 9: 통과 확인** — `pytest tests/test_hr_endpoints.py tests/test_employees.py -q` PASS → 전체 게이트 그린 + ruff. FE: `cd frontend && npx tsc --noEmit && npm run lint`.

- [ ] **Step 10: 커밋**

```bash
git add backend/app/hr/service.py backend/app/routers/employees.py backend/app/main.py backend/app/schemas.py backend/tests/test_hr_endpoints.py backend/tests/test_employees.py frontend/src/lib/api.ts frontend/src/components/admin/employee-table.tsx PROGRESS.md
git commit -m "feat(hr): switch sync endpoints + /api/me to HR source, add migration preview — 동기화 소스 교체·이행 프리뷰·하루 1회 1인 동기화"
```

---

### Task 6: AD title 패스 + `ad/service.py` 축소

**Files:**
- Modify: `backend/app/ad/service.py`
- Modify: `backend/tests/test_ad_active.py`, `backend/tests/test_employees.py` (구 sync 기계 참조 정리)
- Test: `backend/tests/test_hr_title_pass.py`

**Interfaces:**
- Consumes: 기존 `ad/client.fetch_all_users() -> list[RawUser]`
- Produces: `async refresh_titles(session) -> int`(갱신 행 수). 제거: `EmployeeFields`, `SyncSummary`, `to_employee_fields`, `resolve_role`, `_upsert`, `sync_one`, `sync_all`, `run_full_sync`, `SyncTooSoon`, `_FULL_SYNC_MIN_INTERVAL`, `_last_full_sync_at`(ad 쪽) — `LOCAL_USERS`·`seed_local_employees`는 유지. `ad/org.py`·`ad/client.py`는 무변경(보존 원칙).

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_title_pass.py`:

```python
"""AD title 패스 테스트 — title만 갱신, 이름·조직·active 미터치. HR sync가 title을 안 덮는 회귀 포함."""

import asyncio

from fastapi.testclient import TestClient

from app.ad.client import RawUser
from app.db import SessionLocal
from app.settings import settings
from hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee


def _mock_ldap_titles(monkeypatch, raws: list) -> None:
    from app.ad import client as ldap_client

    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)


def test_refresh_titles_updates_title_only(client: TestClient, monkeypatch) -> None:
    _seed_employee("title.user", source="hr", name="HR Name", title="Old", org_l1="HR Div")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("title.user", "AD Display", "Principal", "OU=Elsewhere,DC=corp", 0x200, None, []),
         RawUser("no.row", "Ghost", "Lead", "OU=X,DC=corp", 0x200, None, [])],
    )
    from app.ad.service import refresh_titles

    async def _run() -> int:
        async with SessionLocal() as session:
            return await refresh_titles(session)

    assert asyncio.run(_run()) == 1
    emp = _get_employee("title.user")
    assert emp.title == "Principal"
    assert emp.name == "HR Name" and emp.org_l1 == "HR Div"  # title 외 미터치


def test_full_sync_runs_title_pass_after_hr(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("combo.user")])
    _mock_ldap_titles(monkeypatch, [RawUser("combo.user", "X", "Senior", "OU=Y,DC=corp", 0x200, None, [])])
    summary = _run_sync()
    assert summary.title_refreshed == 1
    assert _get_employee("combo.user").title == "Senior"
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_hr_title_pass.py -q` FAIL(`refresh_titles` 없음).

- [ ] **Step 3: 구현** — `app/ad/service.py`: 모듈 docstring을 "로컬 시드 + AD title 전용 패스(HR 전환 2026-08-10 — 디렉터리 소스는 app/hr)"로 갱신, Interfaces에 명시한 구 sync 기계 제거(+ 그로 인해 unused가 된 import 정리 — `workflow`, `delete`, `is_active`/`is_excluded`/`parse_org` 등. `ad/org.py` 자체는 무변경: `org_path`는 permissions가 계속 사용, `is_active` 순수 테스트 유지). 신설:

```python
async def refresh_titles(session: AsyncSession) -> int:
    """HR 전체 동기화 후속 — AD에서 title만 갱신(이름·조직·active 미터치). 반환: 갱신 행 수.

    HR 응답에 title이 없어 AD 조인 유지 (design 2026-08-10 §5-7). 실패는 호출부가 삼켜 sync를 지키다.
    """
    raws = await asyncio.to_thread(client.fetch_all_users)
    updated = 0
    for raw in raws:
        if not raw.title:
            continue
        emp = await session.get(Employee, raw.sam_account_name)
        if emp is not None and emp.title != raw.title:
            emp.title = raw.title
            updated += 1
    await session.commit()
    return updated
```

- [ ] **Step 4: 구 테스트 정리** — `test_ad_active.py`: `to_employee_fields` 참조 테스트 삭제, `is_active` 순수 테스트·시드 active·admin/directory 단언은 유지. `test_employees.py`: 남은 ad sync 기계 참조를 전수 정리(`git grep -n "ad.service\|ad import service\|to_employee_fields\|EmployeeFields" backend/tests`). 관리 목록·한글이름 임포트·403 테스트는 유지.

- [ ] **Step 5: 통과 확인** — 전체 게이트 그린 + ruff 0.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/ad/service.py backend/tests/test_hr_title_pass.py backend/tests/test_ad_active.py backend/tests/test_employees.py PROGRESS.md
git commit -m "feat(hr): AD title-only refresh pass, shrink ad service — AD는 title 조인 전용으로 축소(클라이언트·설정 보존)"
```

---

### Task 7: 소비처 active 필터 스윕 — 퇴직자 피커 노출 차단

**Files:**
- Modify: `backend/app/routers/directory.py:30` (`select(Employee)`에 active 필터)
- Modify: `backend/app/permissions/access.py:128` (get_eligible_users)
- Modify: `backend/app/routers/maps.py:504`·`:518` (list_editors의 두 Employee 조회)
- Test: `backend/tests/test_hr_active_filter.py`

**Interfaces:**
- Consumes: Employee.active(기존 컬럼)
- Produces: 동작 변경만 — 시그니처 불변. **필터 제외 대상(건드리지 말 것)**: `admin.py`(콘솔 표시), `employees.py`(sysadmin 목록), `maps.py:202`·`categories.py:175`·`dashboard.py`(이름 해석), `notices.py:82`(이미 active 필터 있음), `workflow.load_active_approvers`(이미 있음)

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_active_filter.py`:

```python
"""active=false 행의 소비처 노출 테스트 — 디렉터리·eligible 제외, admin 포함 (설계 §7)."""

from fastapi.testclient import TestClient

from hr_sync_helpers import _seed_employee


def test_directory_excludes_inactive(client: TestClient) -> None:
    _seed_employee("act.on", source="hr", active=True, name="Active One",
                   org_l1="Filter Div", department="Filter Div")
    _seed_employee("act.off", source="hr", active=False, name="Gone One",
                   org_l1="Filter Div", department="Filter Div")
    body = client.get("/api/directory").json()
    ids = {u["id"] for u in body["users"]}
    assert "act.on" in ids and "act.off" not in ids


def test_admin_users_still_include_inactive(client: TestClient) -> None:
    _seed_employee("adm.off", source="hr", active=False)
    body = client.get("/api/admin/users").json()
    row = next(u for u in body["users"] if u["login_id"] == "adm.off")
    assert row["active"] is False


def test_eligible_users_exclude_inactive(client: TestClient) -> None:
    # 공개 맵 생성 → eligible-assignees 후보에 비활성 제외 확인
    created = client.post(
        "/api/maps",
        json={"name": "Active Filter Map", "owning_department": "Owning Anchor Division"},
    )
    assert created.status_code in (200, 201)
    map_id = created.json()["id"]
    _seed_employee("elig.off", source="hr", active=False)
    res = client.get(f"/api/maps/{map_id}/eligible-assignees")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()["users"]}
    assert "elig.off" not in ids
```

주의: 맵 생성 페이로드·eligible 엔드포인트 경로는 기존 테스트(`git grep -n "eligible" backend/tests | head`)의 실제 사용례를 그대로 복제할 것 — 필수 필드가 다르면 그쪽이 정답.

- [ ] **Step 2: 실패 확인** — directory 테스트가 FAIL(현재 비활성도 반환).

- [ ] **Step 3: 구현** — 세 파일 네 지점에 필터:

```python
# directory.py:30
    rows = (
        await session.scalars(
            select(Employee).where(Employee.active.is_(True)).order_by(Employee.login_id)
        )
    ).all()
# access.py:128 (get_eligible_users)
    employees = list(
        (
            await session.scalars(
                select(Employee).where(Employee.active.is_(True)).order_by(Employee.name)
            )
        ).all()
    )
# maps.py:504 (list_editors — dept 멤버십 판정 모수)
            all_emps = list(
                (await session.scalars(select(Employee).where(Employee.active.is_(True)))).all()
            )
# maps.py:518 (list_editors — 이름 머지 대상)
            await session.scalars(
                select(Employee).where(
                    Employee.active.is_(True), Employee.login_id.in_(login_ids)
                )
            )
```

각 지점에 한 줄 주석: `# 퇴직자(active=false) 제외 — HR 전환 후 행이 잔류 (design 2026-08-10 §7)`.

- [ ] **Step 4: 통과 확인** — `pytest tests/test_hr_active_filter.py tests/test_directory.py -q` PASS → 전체 게이트 그린(기존 테스트가 비활성 시드에 의존해 깨지면 해당 시드를 active로 수정 — conftest `owning.anchor`는 active=False 의도 시드이므로 known-path 검증 로직에 영향 없는지 확인).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/directory.py backend/app/permissions/access.py backend/app/routers/maps.py backend/tests/test_hr_active_filter.py PROGRESS.md
git commit -m "feat(hr): exclude inactive employees from pickers/directory — 퇴직자 피커·디렉터리 노출 차단"
```

---

### Task 8: 내장 스케줄러 (lifespan 주기 태스크)

**Files:**
- Modify: `backend/app/main.py` (lifespan)
- Test: `backend/tests/test_hr_scheduler.py`

**Interfaces:**
- Consumes: Task 4 `run_full_sync`/`SyncTooSoon`, Task 1 `settings.hr_enabled`/`hr_sync_interval_hours`
- Produces: `main._run_hr_sync_loop() -> None`(무한 루프, sleep-first), lifespan에서 조건부 `asyncio.create_task` + shutdown cancel

- [ ] **Step 1: 실패 테스트 작성** — `backend/tests/test_hr_scheduler.py`(루프 1회분 검증 — sleep을 짧게 목):

```python
"""내장 HR 스케줄러 테스트 — sleep-first 루프가 run_full_sync를 호출하고 예외에 견디는지."""

import asyncio

from fastapi.testclient import TestClient

from app.settings import settings


def test_sync_loop_calls_full_sync_and_survives_errors(client: TestClient, monkeypatch) -> None:
    from app import main as main_mod
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.local/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_interval_hours", 1)
    calls = {"n": 0}

    async def fake_full_sync(session):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")  # 1회차 실패 — 루프 생존 확인
        raise asyncio.CancelledError    # 2회차에서 루프 탈출

    monkeypatch.setattr(hr_service, "run_full_sync", fake_full_sync)

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(main_mod.asyncio, "sleep", fast_sleep)

    async def _run() -> None:
        try:
            await main_mod._run_hr_sync_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())
    assert calls["n"] == 2
```

- [ ] **Step 2: 실패 확인** — FAIL(`_run_hr_sync_loop` 없음).

- [ ] **Step 3: 구현** — `app/main.py`:

```python
async def _run_hr_sync_loop() -> None:
    """내장 HR 동기화 스케줄러 — sleep-first(첫 자동 실행은 1주기 후, 배포 직후 실동기화는 수동 절차 §9)."""
    from app.hr import service as hr_service

    interval = settings.hr_sync_interval_hours * 3600
    while True:
        await asyncio.sleep(interval)
        try:
            async with SessionLocal() as session:
                summary = await hr_service.run_full_sync(session)
                logger.info("scheduled HR sync: %s", summary)
        except hr_service.SyncTooSoon:
            pass  # 수동 sync 직후 겹침 — 다음 주기로
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- 주기 실패가 프로세스를 죽이면 안 됨
            logger.exception("scheduled HR sync failed — retrying next interval")
```

lifespan에서 기동/정리(기존 lifespan yield 전후에):

```python
    hr_task: asyncio.Task | None = None
    if settings.hr_enabled and settings.hr_sync_interval_hours > 0:
        hr_task = asyncio.create_task(_run_hr_sync_loop())
    yield
    if hr_task is not None:
        hr_task.cancel()
```

(`import asyncio`·`logger`·`SessionLocal` import는 main.py 기존 것 확인 후 없으면 추가.)

- [ ] **Step 4: 통과 확인** — `pytest tests/test_hr_scheduler.py -q` PASS → 전체 게이트 그린 + ruff.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/main.py backend/tests/test_hr_scheduler.py PROGRESS.md
git commit -m "feat(hr): built-in periodic sync scheduler — 내장 주기 동기화(수동 절차 이후 자동화)"
```

---

### Task 9: 최종 게이트 + 문서 마감

**Files:**
- Modify: `PROGRESS.md`, `docs/design/2026-08-10-hr-webhook-directory-design.md` (구현 결과 상태줄), `docs/deploy/db-seed.md` (email 컬럼·HR env 관련 한 줄 있으면 갱신)
- Verify: 전체 게이트

- [ ] **Step 1: 백엔드 전체 게이트** — `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` 그린 + `.venv/bin/ruff check app/ tests/` 0.
- [ ] **Step 2: FE 게이트** — `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build` 전부 통과.
- [ ] **Step 3: 잔재 스윕** — `git grep -n "ldap_enabled" backend/app`(main.py `/api/me`에 남아 있으면 안 됨 — refresh_titles 게이트는 hr/service의 것만 정상), `git grep -n "email" backend/app backend/scripts`(ad/client.py `mail`만 잔존 허용), `git grep -n "purged\|excluded" frontend/src/lib/api.ts`(구 요약 필드 잔재 0).
- [ ] **Step 4: 설계 문서에 상태 갱신** — 문서 상단에 `> 상태: 구현 완료(feat/hr-webhook-directory → dev). 운영 이행은 §9 절차 대기.` 한 줄 추가.
- [ ] **Step 5: 커밋 + dev 머지 준비** — `git commit -m "docs(hr): finalize HR webhook migration docs — HR 전환 문서 마감"`. dev 머지는 `superpowers:finishing-a-development-branch`로 진행(머지 후 전체 게이트 재실행).

---

## 이행(운영) 체크리스트 — 코드 밖 절차 (참고용, 이 플랜의 태스크 아님)

1. 서버 배포(스키마 자동 보강: email NOT NULL 완화·dept_code·departments)
2. `.env`에 `N8N_HR_URL`/`N8N_HR_TOKEN` 설정(스케줄러는 아직 `HR_SYNC_INTERVAL_HOURS=0` 권장)
3. `POST /api/employees/sync-preview` → `case_mismatches`(0 필수)·`orphan_dept_paths`·`would_delete` 검토
4. 첫 실동기화 수동 실행 → 요약 검토, 고아 부서 경로는 dept-remap 콘솔로 이관
5. `HR_SYNC_INTERVAL_HOURS=24`로 스케줄러 활성
