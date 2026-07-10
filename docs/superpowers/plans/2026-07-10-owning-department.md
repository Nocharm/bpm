# 맵 필수 필드 '오우닝 부서' Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 맵에 오우닝 부서(org_path)를 필수 지정하고, 그 부서 소속원에게 파생 editor 권한을 부여하며, 생성 모달·설정·홈에 지정/누락 UX를 붙인다.

**Architecture:** `process_maps.owning_department` 컬럼 하나가 진실의 원천. 권한 행(MapPermission)은 만들지 않고 `logic.effective_role`에 "오우닝 부서 소속이면 editor 바닥값"을 파생 계산한다. 변경은 owner 전용 PUT 엔드포인트. 스펙: `docs/superpowers/specs/2026-07-10-owning-department-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + TypeScript + 기존 `PrincipalPicker`.

## Global Constraints

- **파생 권한 불변식**: 오우닝 부서를 위한 `MapPermission` 행을 **절대 삽입하지 않는다**. 잠금은 행이 없다는 사실 자체로 달성된다.
- 오우닝 부서 값은 **org_path 문자열**(예: `"Management Support Division/Procurement Office"`), `VARCHAR(200)`, NULL=누락.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`. **PROGRESS.md를 같은 커밋에** 한 줄 갱신 (`rules/common/git.md`).
- 프론트: raw hex 금지(토큰만), 이모지 금지(Lucide 16px/strokeWidth 1.5), UI 문자열은 `i18n-messages.ts` en+ko 양쪽에, **역할/상태 단어(Editor 등)는 ko에서도 영어 유지**.
- id 생성은 `genId()`(`@/lib/id`) — `crypto.randomUUID` 금지(평문 HTTP 서버).
- React Compiler: 수동 `useCallback`/`useMemo` deps 불일치는 빌드 실패 — 트리비얼 핸들러는 plain 함수로.
- 백엔드: 함수 시그니처 전부 타입힌트, 함수명은 동사 시작, `X | None` 표기.
- frontend `grep`은 ugrep이라 브래킷 디렉터리(`[mapId]`)를 건너뛴다 — 그 아래 파일은 Read/find로 확인.
- 게이트: `cd backend && .venv/bin/python -m pytest tests/ -q` · `.venv/bin/ruff check app/ tests/` · `cd frontend && npm run lint && npm run build` (+ 기존 vitest `npx vitest run`).
- 실행은 워크트리 브랜치 `worktree-owning-dept`에서 (superpowers:using-git-worktrees).

## File Structure

| 파일 | 책임 |
|------|------|
| `backend/app/models.py` | `ProcessMap.owning_department` 컬럼 |
| `backend/app/db.py` | `_ADDED_COLUMNS` 등록 |
| `backend/app/schemas.py` | `MapCreate` 필수 필드, `MapOut` 노출, `OwningDepartmentIn` |
| `backend/app/routers/maps.py` | known-path 검증 헬퍼, create 반영, copy 상속, `PUT /{id}/owning-department` |
| `backend/app/permissions/logic.py` | `effective_role`/`is_visible`에 `owning_department` 파라미터 + editor 바닥값 |
| `backend/app/permissions/access.py` | `get_effective_role`/`get_eligible_users` 패스스루 |
| `backend/app/routers/permissions.py` | 오우닝 부서 중복 grant 409 가드 |
| `backend/tests/conftest.py` | 앵커 부서 직원 시드(파생 editor 오염 방지) |
| `backend/tests/test_owning_department.py` | 신규 테스트 |
| `frontend/src/lib/api.ts` | `MapSummary.owning_department`, `createMap` 시그니처, `setOwningDepartment` |
| `frontend/src/components/permissions/principal-picker.tsx` | `pinnedIds` prop + Dept Lead 배지 |
| `frontend/src/components/permissions/create-map-dialog.tsx` | 필수 필드·리더 자동 승인자·잠금 행·후보군 |
| `frontend/src/components/permissions/map-details-panel.tsx` | 오우닝 부서 표시/Assign/Change |
| `frontend/src/components/permissions/collaborators-panel.tsx` | 잠금 행 합성 표시 |
| `frontend/src/app/maps/[mapId]/settings/page.tsx` | isOwner/owningDepartment 배선 |
| `frontend/src/app/page.tsx` + `frontend/src/components/maps/map-card.tsx` | 누락 필터·배지 |
| `frontend/src/lib/i18n-messages.ts` | 신규 키 en/ko |
| `backend/scripts/seed_org_demo.py` | 데모 맵 2/3 지정, 1/3 누락 |
| `backend/scripts/pw-verify-owning-dept.mjs` | 브라우저 검증 |

---

### Task 1: Backend — 컬럼 + 생성 필수 + known-path 검증 + copy 상속

**Files:**
- Modify: `backend/app/models.py:85-88` (deleted_at 아래), `backend/app/db.py:53-55`, `backend/app/schemas.py:16-21` + `:359-391`, `backend/app/routers/maps.py` (create_map:218, copy_map:298, 헬퍼 신설), `backend/tests/conftest.py`
- Create: `backend/tests/test_owning_department.py`
- Modify: `backend/tests/test_*.py` 중 `.post("/api/maps"` 호출부 전부 (기계적)

**Interfaces:**
- Produces: `ProcessMap.owning_department: str | None` · `MapCreate.owning_department: str`(필수) · `MapOut.owning_department: str | None` · `async def _assert_known_department(session, dept_path) -> None`(maps.py 내부, 422) · conftest 앵커 부서 리터럴 `"Owning Anchor Division"`
- Consumes: 없음 (첫 태스크)

- [ ] **Step 1: conftest에 앵커 부서 직원 시드 추가**

기존 테스트 52곳이 오우닝 부서를 갖게 되면, LOCAL_USERS 조직(`Management Support Division/...`)을 쓸 경우 **모든 테스트 액터가 파생 editor가 되어 기존 403 단언이 깨진다.** 어떤 액터도 소속되지 않는 앵커 부서를 시드하고 그 경로를 쓴다. `backend/tests/conftest.py`의 `seed_test_approvers` 내부 `_run()`에, approver 루프 다음에 추가:

```python
            # 오우닝 부서 필수화(2026-07-10) — 기존 테스트가 쓸 앵커 부서.
            # 어떤 테스트 액터도 이 org에 속하지 않아 파생 editor가 발동하지 않는다.
            # active=False: 공지 브로드캐스트 수신자 수 단언 오염 방지(known-path 검증은 active 무관).
            if await session.get(Employee, "owning.anchor") is None:
                session.add(
                    Employee(
                        login_id="owning.anchor",
                        name="Owning Anchor",
                        source="local",
                        active=False,
                        org_l1="Owning Anchor Division",
                        department="Owning Anchor Division",
                    )
                )
```

- [ ] **Step 2: 신규 테스트 파일 작성 (RED)**

`backend/tests/test_owning_department.py` 생성:

```python
"""오우닝 부서 — 생성 필수·known-path 검증·copy 상속 (spec 2026-07-10)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import SessionLocal

# LOCAL_USERS(app/ad/service.py) org 경로 — 테스트 DB lifespan에 항상 시드됨
MSD = "Management Support Division"
PROC_OFFICE = f"{MSD}/Procurement Office"
SOURCING_1 = f"{PROC_OFFICE}/Sourcing Team 1"
# conftest 앵커 부서와 동기 — 어떤 테스트 액터도 소속되지 않음
ANCHOR = "Owning Anchor Division"


def _name() -> str:
    return f"owning-{uuid4().hex[:8]}"


def test_create_requires_owning_department(client: TestClient) -> None:
    res = client.post("/api/maps", json={"name": _name()})
    assert res.status_code == 422


def test_create_rejects_unknown_department(client: TestClient) -> None:
    res = client.post(
        "/api/maps", json={"owning_department": "No Such Division", "name": _name()}
    )
    assert res.status_code == 422
    assert "unknown department" in res.json()["detail"]


def test_create_persists_owning_department(client: TestClient) -> None:
    name = _name()
    res = client.post(
        "/api/maps", json={"owning_department": PROC_OFFICE, "name": name}
    )
    assert res.status_code == 201
    body = res.json()
    assert body["owning_department"] == PROC_OFFICE
    # 목록에도 노출
    listed = client.get("/api/maps").json()
    mine = next(m for m in listed if m["name"] == name)
    assert mine["owning_department"] == PROC_OFFICE


def test_legacy_map_null_owning_department_ok(client: TestClient) -> None:
    """레거시(직접 DB 삽입, NULL) 맵도 목록·상세가 정상 — 누락 상태 표현."""
    from app.models import MapVersion, ProcessMap

    name = _name()

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, visibility="public")
            m.versions.append(MapVersion(label="As-Is"))
            session.add(m)
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    detail = client.get(f"/api/maps/{map_id}")
    assert detail.status_code == 200
    assert detail.json()["owning_department"] is None


def test_copy_inherits_owning_department(client: TestClient) -> None:
    """copy는 설명처럼 오우닝 부서도 원본에서 상속한다."""
    from app.models import MapVersion, ProcessMap

    name = _name()

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name, visibility="public", owning_department=SOURCING_1
            )
            m.versions.append(MapVersion(label="As-Is", status="approved"))
            session.add(m)
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(f"/api/maps/{map_id}/copy", json={})
    assert res.status_code == 201
    assert res.json()["owning_department"] == SOURCING_1
```

- [ ] **Step 3: RED 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_owning_department.py -q`
Expected: FAIL — `owning_department` 필드 부재로 422가 안 나오거나(201) KeyError.

- [ ] **Step 4: 모델 컬럼 + \_ADDED_COLUMNS**

`backend/app/models.py` — `deleted_at` 필드 블록(line 86-88) 바로 아래에:

```python
    # 오우닝 부서 — org_path 문자열(예: "Division/Office/Team"). NULL=누락(레거시 맵).
    # 소속 직원은 effective_role에서 editor 바닥값을 파생받는다 — 권한 행 없음 (spec 2026-07-10)
    owning_department: Mapped[str | None] = mapped_column(String(200), default=None)
```

`backend/app/db.py` `_ADDED_COLUMNS` 리스트 끝에:

```python
    # 오우닝 부서 — 기존 행은 NULL=누락, 설정에서 owner가 수동 지정 (spec 2026-07-10)
    ("process_maps", "owning_department", "VARCHAR(200)"),
```

- [ ] **Step 5: 스키마**

`backend/app/schemas.py` `MapCreate`(line 16)에 필드 추가:

```python
class MapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    # 생성 시 초기 공개 범위 — 생성자=owner라 즉시 반영(승인 워크플로 불필요)
    visibility: Literal["private", "public"] = "private"
    # 오우닝 부서(필수) — known org_path 검증은 라우터에서 (spec 2026-07-10)
    owning_department: str = Field(min_length=1, max_length=200)
```

`MapOut`(line 359)의 `sp_changed_at` 아래에:

```python
    # 오우닝 부서 org_path — None=누락(레거시). 홈 배지·필터, 설정 표시용 (spec 2026-07-10)
    owning_department: str | None = None
```

- [ ] **Step 6: 라우터 — 검증 헬퍼 + create + copy**

`backend/app/routers/maps.py`의 `_assert_unique_name`(line 59) 아래에 헬퍼 추가 (Employee는 이미 import돼 있다):

```python
async def _assert_known_department(session: AsyncSession, dept_path: str) -> None:
    """오우닝 부서는 실제 조직 경로여야 한다 — 직원 org 레벨의 전 prefix와 대조, 아니면 422.

    directory.py의 부서 목록과 같은 규약(각 깊이 슬라이스의 "/" 조인). active 여부는 무관.
    """
    rows = (
        await session.execute(
            select(
                Employee.org_l1,
                Employee.org_l2,
                Employee.org_l3,
                Employee.org_l4,
                Employee.org_l5,
            )
        )
    ).all()
    known: set[str] = set()
    for levels in rows:
        parts = [lv for lv in levels if lv]
        for i in range(1, len(parts) + 1):
            known.add("/".join(parts[:i]))
    if dept_path not in known:
        raise HTTPException(status_code=422, detail=f"unknown department: {dept_path}")
```

`create_map`(line 218): `await _assert_unique_name(...)` 다음 줄에 `await _assert_known_department(session, payload.owning_department)` 추가, `ProcessMap(...)` 생성자에 `owning_department=payload.owning_department,` 추가.

`copy_map`의 `new_map = ProcessMap(...)`(line 298)에 `owning_department=source_map.owning_department,` 추가 (설명 상속과 동일 취급 — 같은 부서 프로세스의 사본).

- [ ] **Step 7: 신규 테스트 GREEN 확인**

Run: `.venv/bin/python -m pytest tests/test_owning_department.py -q`
Expected: PASS (5 passed)

- [ ] **Step 8: 기존 테스트 기계적 업데이트**

```bash
cd backend
# 인라인 json={...} 생성 호출 전부에 앵커 부서 삽입 (신규 테스트 파일 제외)
grep -rl -F '.post("/api/maps", json={' tests --include="test_*.py" \
  | grep -v test_owning_department \
  | xargs sed -i '' 's|\.post("/api/maps", json={|.post("/api/maps", json={"owning_department": "Owning Anchor Division", |g'
# 잔여(변수 payload 등) 수동 확인 — 결과가 남으면 해당 dict 정의에 필드 추가
grep -rn -F '.post("/api/maps"' tests | grep -v owning_department
```

- [ ] **Step 9: 전체 스위트 + 린트**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, 린트 0에러. 공지/알림 개수 단언이 앵커 직원 때문에 깨지면 앵커가 `active=False`인지 확인(수신자 제외), 그래도 깨지면 해당 테스트의 기대 수를 늘리지 말고 원인을 보고.

- [ ] **Step 10: Commit**

PROGRESS.md 최신 섹션에 한 줄 추가 후:

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/maps.py backend/tests/ PROGRESS.md
git commit -m "feat(maps): require owning department on create with known-path validation — 맵 생성 시 오우닝 부서 필수화(known org_path 검증)"
```

---

### Task 2: Backend — 파생 editor 바닥값

**Files:**
- Modify: `backend/app/permissions/logic.py:57-131`, `backend/app/permissions/access.py:92-100` + `:169-177`, `backend/app/routers/maps.py:202-210`
- Test: `backend/tests/test_owning_department.py` (추가)

**Interfaces:**
- Produces: `logic.effective_role(..., owning_department: str | None = None)` — 키워드 기본값 None(기존 순수 로직 테스트 무변경). `is_visible`도 동일 파라미터.
- Consumes: Task 1의 `ProcessMap.owning_department`.

- [ ] **Step 1: 순수 로직 테스트 추가 (RED)**

`tests/test_owning_department.py`에 추가:

```python
from app.permissions import logic

PIT = f"{MSD}/Process Innovation Office/Process Innovation Team"  # admin.kim 소속


def test_logic_owning_member_gets_editor_floor() -> None:
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", [], False, set(),
        owning_department=PROC_OFFICE,  # 상위 부서 지정 → 하위 팀원 포함
    )
    assert role == "editor"


def test_logic_owning_floor_upgrades_viewer_grant() -> None:
    perms: list[logic.Permission] = [("user", "user.lee", "viewer")]
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", perms, False, set(),
        owning_department=SOURCING_1,
    )
    assert role == "editor"


def test_logic_owner_grant_beats_owning_floor() -> None:
    perms: list[logic.Permission] = [("user", "user.lee", "owner")]
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", perms, False, set(),
        owning_department=SOURCING_1,
    )
    assert role == "owner"


def test_logic_non_member_stays_none() -> None:
    role = logic.effective_role(
        "admin.kim", False, PIT, "private", [], False, set(),
        owning_department=PROC_OFFICE,
    )
    assert role is None
```

- [ ] **Step 2: RED 확인**

Run: `.venv/bin/python -m pytest tests/test_owning_department.py -q`
Expected: FAIL — `effective_role() got an unexpected keyword argument 'owning_department'`

- [ ] **Step 3: logic.py 구현**

`effective_role` 시그니처 끝에 `owning_department: str | None = None,` 추가하고, 독스트링 우선순위 목록의 2와 3 사이에 `2.5 오우닝 부서 소속(하위 포함) → 'editor' 바닥값 — 권한 행 없는 파생 (2026-07-10)` 줄을 추가. grants 루프(line 82-93)와 `if best is not None`(line 95) 사이에:

```python
    # 2.5 오우닝 부서 파생 editor — 소속(prefix 하위 포함)이면 바닥값. 권한 행이 없어
    # 해제·다운그레이드가 불가능하다 = "잠금" (spec 2026-07-10)
    if (
        owning_department
        and belongs_to_department(emp_org_path, owning_department)
        and role_rank("editor") > role_rank(best)
    ):
        best = "editor"
```

`is_visible`에도 같은 파라미터를 추가하고 내부 `effective_role(...)` 호출에 `owning_department=owning_department,`로 전달.

- [ ] **Step 4: 호출부 3곳 패스스루**

- `access.py get_effective_role`(line 92): `logic.effective_role(...)` 마지막 인자로 `owning_department=found_map.owning_department,`
- `access.py get_eligible_users`(line 169): `owning_department=found_map.owning_department if found_map is not None else None,`
- `routers/maps.py list_maps` 루프(line 202): `owning_department=m.owning_department,`

- [ ] **Step 5: 통합 테스트 추가 — enforce + act_as**

`tests/test_owning_department.py`에 추가 (test_permission_gates.py의 픽스처 패턴 복제):

```python
from collections.abc import Iterator

import pytest

import app.auth as auth_mod
from app.main import app
from app.models import MapVersion, ProcessMap
from app.settings import settings

SYSADMIN = "admin.sys"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — test_permission_gates.py와 동일 패턴."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def seed_owning_map(owning: str | None, visibility: str = "private") -> int:
    """직접 DB 시드 — API 경유 없이 오우닝 부서만 통제."""

    async def _make() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=_name(), visibility=visibility, owning_department=owning
            )
            m.versions.append(MapVersion(label="As-Is"))
            session.add(m)
            await session.commit()
            return m.id

    return asyncio.run(_make())


def test_owning_member_sees_private_map_as_editor(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as("user.lee")  # Sourcing Team 1 ⊂ Procurement Office
    listed = client.get("/api/maps").json()
    mine = next(m for m in listed if m["id"] == map_id)
    assert mine["my_role"] == "editor"
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_non_member_gets_403_on_private_owned_map(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as("admin.kim")  # Process Innovation — 비소속
    assert all(m["id"] != map_id for m in client.get("/api/maps").json())
    assert client.get(f"/api/maps/{map_id}").status_code == 403


def test_owning_member_in_eligible_approvers(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(SOURCING_1)
    act_as(SYSADMIN)
    ids = {u["id"] for u in client.get(f"/api/maps/{map_id}/eligible-approvers").json()}
    assert "user.lee" in ids       # 파생 editor → viewer+ 후보
    assert "admin.kim" not in ids  # 비소속·무권한
```

- [ ] **Step 6: GREEN + 전체 스위트**

Run: `.venv/bin/python -m pytest tests/test_owning_department.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS. (eligible-approvers 엔드포인트는 `maps.py:329` — 응답 형식이 다르면 실제 응답 키에 맞춰 단언만 조정, 구현은 유지)

- [ ] **Step 7: Commit**

```bash
git add backend/app/permissions/logic.py backend/app/permissions/access.py backend/app/routers/maps.py backend/tests/test_owning_department.py PROGRESS.md
git commit -m "feat(perm): derive locked editor role from owning department — 오우닝 부서 소속 파생 editor 바닥값(잠금 권한)"
```

---

### Task 3: Backend — PUT owning-department + 중복 grant 가드

**Files:**
- Modify: `backend/app/schemas.py` (MapUpdate 아래), `backend/app/routers/maps.py` (subprocess PUT 위나 아래), `backend/app/routers/permissions.py:78-96`, `docs/superpowers/specs/2026-07-10-owning-department-design.md` (400→409 한 줄)
- Test: `backend/tests/test_owning_department.py` (추가)

**Interfaces:**
- Produces: `PUT /api/maps/{map_id}/owning-department` body `{"owning_department": str}` → `MapOut` (owner 게이트). `OwningDepartmentIn` 스키마. permissions POST 409 가드.
- Consumes: Task 1 헬퍼 `_assert_known_department`, Task 2 파생 로직.

- [ ] **Step 1: 테스트 추가 (RED)**

```python
def test_put_owning_department_owner_only(client: TestClient, enforce: None) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as("user.lee")  # 파생 editor일 뿐 owner 아님
    res = client.put(
        f"/api/maps/{map_id}/owning-department",
        json={"owning_department": SOURCING_1},
    )
    assert res.status_code == 403


def test_put_owning_department_moves_derived_editor(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as(SYSADMIN)
    res = client.put(
        f"/api/maps/{map_id}/owning-department",
        json={"owning_department": PIT},
    )
    assert res.status_code == 200
    assert res.json()["owning_department"] == PIT
    # 파생 권한이 새 부서로 이동 — 이전 부서원은 접근 상실, 새 부서원은 editor
    act_as("user.lee")
    assert client.get(f"/api/maps/{map_id}").status_code == 403
    act_as("admin.kim")
    assert client.get(f"/api/maps/{map_id}").json()["my_role"] == "editor"


def test_put_owning_department_unknown_422(client: TestClient) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    res = client.put(
        f"/api/maps/{map_id}/owning-department",
        json={"owning_department": "No Such Division"},
    )
    assert res.status_code == 422


def test_put_owning_department_assigns_missing(client: TestClient) -> None:
    """레거시 누락 맵의 최초 지정 — 같은 엔드포인트."""
    map_id = seed_owning_map(None, visibility="public")
    res = client.put(
        f"/api/maps/{map_id}/owning-department",
        json={"owning_department": SOURCING_1},
    )
    assert res.status_code == 200
    assert res.json()["owning_department"] == SOURCING_1


def test_add_permission_for_owning_department_409(client: TestClient) -> None:
    map_id = seed_owning_map(PROC_OFFICE, visibility="public")
    res = client.post(
        f"/api/maps/{map_id}/permissions",
        json={
            "principal_type": "department",
            "principal_id": PROC_OFFICE,
            "role": "editor",
        },
    )
    assert res.status_code == 409
    # 하위 부서 grant는 별개 의미 — 허용
    res2 = client.post(
        f"/api/maps/{map_id}/permissions",
        json={
            "principal_type": "department",
            "principal_id": SOURCING_1,
            "role": "editor",
        },
    )
    assert res2.status_code == 201
```

Run: `.venv/bin/python -m pytest tests/test_owning_department.py -q` → Expected: 신규분 FAIL (405/404/201).

- [ ] **Step 2: 스키마 + 엔드포인트**

`backend/app/schemas.py` `MapUpdate` 아래에:

```python
class OwningDepartmentIn(BaseModel):
    # 오우닝 부서 지정/변경 — known org_path 검증은 라우터에서 (spec 2026-07-10)
    owning_department: str = Field(min_length=1, max_length=200)
```

`backend/app/routers/maps.py` — `designate_subprocess`(line 481) 위에 추가하고 `OwningDepartmentIn`을 schemas import에 추가:

```python
@router.put(
    "/{map_id}/owning-department",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def set_owning_department(
    map_id: int,
    payload: OwningDepartmentIn,
    session: AsyncSession = Depends(get_session),
) -> ProcessMap:
    """오우닝 부서 지정/변경 — owner/sysadmin 전용. 파생 editor가 자동으로 새 부서를 따라간다."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    await _assert_known_department(session, payload.owning_department)
    found_map.owning_department = payload.owning_department
    await session.commit()
    await session.refresh(found_map)
    return found_map
```

- [ ] **Step 3: permissions POST 가드**

`backend/app/routers/permissions.py` `add_permission` — public viewer 가드(line 81-85) 다음에:

```python
    # 오우닝 부서는 이미 파생 editor(잠금) — 동일 부서 행은 혼란만 준다 (spec 2026-07-10)
    if (
        payload.principal_type == "department"
        and payload.principal_id == found_map.owning_department
    ):
        raise HTTPException(
            status_code=409,
            detail="department already owns this map — editor role is derived",
        )
```

스펙 문서의 "중복 방지 가드" 절에서 400을 409로 정정(기존 중복 grant 409와 일관).

- [ ] **Step 4: GREEN + 전체 게이트**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, 린트 0에러.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/maps.py backend/app/routers/permissions.py backend/tests/test_owning_department.py docs/superpowers/specs/2026-07-10-owning-department-design.md PROGRESS.md
git commit -m "feat(maps): owner-gated owning-department PUT + duplicate grant guard — 오우닝 부서 변경 엔드포인트·중복 grant 409 가드"
```

---

### Task 4: Frontend — api 계층 + PrincipalPicker pinnedIds

**Files:**
- Modify: `frontend/src/lib/api.ts:35-65` + `:241-253` 인근, `frontend/src/components/permissions/principal-picker.tsx:32-45` + `:155-162` + `:307-335`, `frontend/src/lib/i18n-messages.ts` (en/ko 두 블록)

**Interfaces:**
- Produces: `MapSummary.owning_department?: string | null` · `setOwningDepartment(mapId: number, owningDepartment: string): Promise<MapSummary>` · `PrincipalPickerProps.pinnedIds?: Set<string>`(빈 검색 시 해당 user 옵션 최상단 + "Dept Lead" 배지) · i18n 키 `perm.principalDeptLead`
- Consumes: Task 3 PUT 엔드포인트.

- [ ] **Step 1: api.ts**

`MapSummary`의 `sp_changed_at` 아래에:

```ts
  // 오우닝 부서 org_path — null=누락(레거시). 홈 배지·필터, 설정 표시 (spec 2026-07-10)
  owning_department?: string | null;
```

`updateMap` 아래에:

```ts
// 오우닝 부서 지정/변경 — owner/sysadmin 전용. 파생 editor가 새 부서를 따라간다 (spec 2026-07-10)
export function setOwningDepartment(
  mapId: number,
  owningDepartment: string,
): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}/owning-department`, {
    method: "PUT",
    body: JSON.stringify({ owning_department: owningDepartment }),
  });
}
```

- [ ] **Step 2: PrincipalPicker — pinnedIds prop**

`PrincipalPickerProps`(line 32)에 추가:

```ts
  /** 빈 검색(브라우즈) 시 최상단 고정할 user principalId — 오우닝 부서 리더 노출용. 검색 랭킹은 불변. */
  pinnedIds?: Set<string>;
```

컴포넌트 시그니처에 `pinnedIds,` 구조분해 추가. 브라우즈 분기(line 155-162)를 다음으로 교체:

```ts
    : (() => {
        const browse = managersFirst
          ? sortManagersFirst(
              all,
              (o) => (o.principalType === "user" ? o.principalId : null),
              managerIds,
            )
          : all;
        // 핀 고정 — 오우닝 부서 리더 등은 검색 없이도 맨 위 (안정 파티션)
        const pinnedFirst = pinnedIds?.size
          ? [
              ...browse.filter((o) => o.principalType === "user" && pinnedIds.has(o.principalId)),
              ...browse.filter((o) => !(o.principalType === "user" && pinnedIds.has(o.principalId))),
            ]
          : browse;
        return pinnedFirst.map((item) => ({
          item,
          matches: [] as { field: string; ranges: MatchRange[] }[],
        }));
      })();
```

배지 IIFE(line 307-335)의 라벨 판정에 핀 우선 추가:

```ts
                  const isPinnedLead =
                    opt.principalType === "user" && (pinnedIds?.has(opt.principalId) ?? false);
                  const isManager =
                    opt.principalType === "user" && managerSet.has(opt.principalId);
                  const isMine =
                    opt.principalType === "department" && isMyDept(opt.principalId);
                  const label = isPinnedLead
                    ? t("perm.principalDeptLead")
                    : isManager
                      ? t("perm.principalManager")
                      : ...  // 이하 기존 그대로
```

강조 필 조건 `isManager || isMine`을 `isPinnedLead || isManager || isMine`으로 확장.

- [ ] **Step 3: i18n 키**

`frontend/src/lib/i18n-messages.ts` — `perm.principalManager` 키 인근(en 블록·ko 블록 각각):

```ts
  "perm.principalDeptLead": "Dept Lead",   // en 블록
  "perm.principalDeptLead": "부서장",       // ko 블록
```

- [ ] **Step 4: 게이트 + Commit**

Run: `cd frontend && npm run lint && npm run build` → Expected: 0에러.

```bash
git add frontend/src/lib/api.ts frontend/src/components/permissions/principal-picker.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(picker): pinnedIds browse pinning + owning-department api — 피커 핀 고정 prop·오우닝 부서 API 함수"
```

---

### Task 5: Frontend — 생성 모달

**Files:**
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`, `frontend/src/lib/api.ts:205-214` (createMap 시그니처), `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `PrincipalPicker pinnedIds`(Task 4), `DirectoryDept.manager`, `createMap`.
- Produces: `createMap(name, description, visibility, owningDepartment: string)` — 4번째 인자 필수. 호출부는 이 파일뿐(grep으로 확인 완료).

- [ ] **Step 1: createMap 시그니처 (api.ts) — 같은 커밋에 호출부 동반**

```ts
export function createMap(
  name: string,
  description: string,
  visibility: MapSummary["visibility"],
  owningDepartment: string,
): Promise<MapDetail> {
  return request<MapDetail>("/maps", {
    method: "POST",
    body: JSON.stringify({
      name,
      description,
      visibility,
      owning_department: owningDepartment,
    }),
  });
}
```

- [ ] **Step 2: 다이얼로그 상태 + 리더 자동 승인자**

`create-map-dialog.tsx` — `pendingVisibility` state 아래에:

```ts
  // 오우닝 부서(필수) — DirectoryDept 그대로 보관(id=org_path, manager=리더 login_id)
  const [owningDept, setOwningDept] = useState<DirectoryDept | null>(null);
  // 자동 추가한 리더 승인자 추적 — 부서 변경 시 자동분만 교체하고 수동 추가는 보존
  const autoLeaderRef = useRef<string | null>(null);
```

`applyVisibilityChange`를 다음으로 교체 (승인자 초기화 후 리더 자동분 재심기):

```ts
  const applyVisibilityChange = (v: MapVisibility) => {
    setVisibility(v);
    // 후보군 변경 → 승인자 초기화. 오우닝 부서 리더 자동 추가분은 다시 심는다(양쪽 후보군에서 유효).
    const leader = owningDept?.manager ? userById.get(owningDept.manager) : undefined;
    setApprovers(
      leader ? [{ key: genId(), userId: leader.id, displayName: leader.name }] : [],
    );
    autoLeaderRef.current = leader?.id ?? null;
    if (v === "public" && pendingCollabRole === "viewer") {
      setPendingCollabRole("editor");
    }
  };
```

`addCollaborator` 근처에 plain 함수 2개 추가:

```ts
  // 오우닝 부서 선택 — 리더를 승인자로 자동 추가(제거 가능), 이전 자동분은 교체
  const applyOwningDept = (opt: PrincipalOption) => {
    const dept = dirDepts.find((d) => d.id === opt.principalId);
    if (!dept) return;
    const removeId = autoLeaderRef.current;
    const leader = dept.manager ? userById.get(dept.manager) : undefined;
    setApprovers((prev) => {
      const kept = removeId ? prev.filter((a) => a.userId !== removeId) : prev;
      if (!leader || kept.some((a) => a.userId === leader.id)) return kept;
      return [...kept, { key: genId(), userId: leader.id, displayName: leader.name }];
    });
    autoLeaderRef.current = leader?.id ?? null;
    setOwningDept(dept);
  };

  const clearOwningDept = () => {
    const removeId = autoLeaderRef.current;
    autoLeaderRef.current = null;
    if (removeId) setApprovers((prev) => prev.filter((a) => a.userId !== removeId));
    setOwningDept(null);
  };
```

- [ ] **Step 3: 생성 게이트 + createMap 호출**

`handleCreate`의 얼리리턴을 `if (!trimmed || approvers.length === 0 || !owningDept) return;`으로, `createMap` 호출을:

```ts
        const detail = await createMap(trimmed, description.trim(), visibility, owningDept.id);
```

`handleCreate`의 useCallback deps에 `owningDept` 추가. `canCreate`에 `&& owningDept !== null` 추가. 버튼 행의 approversHint 옆에 같은 패턴으로:

```tsx
          {name.trim().length > 0 && owningDept === null && (
            <p className="mr-auto text-fine text-error">{t("perm.owningDept.requiredHint")}</p>
          )}
```

(approversHint 조건과 동시 성립 시 둘 다 `mr-auto`가 겹치므로, 기존 approversHint 조건에 `&& owningDept !== null`을 추가해 한 번에 하나만 노출.)

- [ ] **Step 4: 필드 UI — 설명과 공개범위 사이**

description 블록(line 391 종료) 다음에:

```tsx
        {/* 오우닝 부서(필수) — 선택 전 피커, 선택 후 잠금 표시 행 + X(재선택) */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">
            {t("perm.owningDept.label")}
          </label>
          {owningDept === null ? (
            <PrincipalPicker
              users={[]}
              departments={pickerDepts}
              groups={[]}
              excludeIds={new Set<string>()}
              deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
              onSelect={applyOwningDept}
            />
          ) : (
            <div
              data-id="owning-dept-selected"
              className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-2 py-1.5 text-caption text-ink"
            >
              <PrincipalIcon type="department" />
              <span className="min-w-0 flex-1 truncate">
                {owningDept.korean_name || owningDept.name}
                <span className="ml-1.5 text-fine text-ink-tertiary">{owningDept.id}</span>
              </span>
              <span
                title={t("perm.owningDept.lockedNote")}
                className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
              >
                <LockKeyhole size={12} strokeWidth={1.5} />
                {t("perm.owningDept.lockedEditor")}
              </span>
              <button
                type="button"
                onClick={clearOwningDept}
                className="text-ink-tertiary hover:text-ink"
                aria-label={t("perm.removeButton")}
                disabled={submitting}
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
        </div>
```

lucide import에 `LockKeyhole` 추가.

- [ ] **Step 5: 승인자 후보군 + 리더 핀**

`approverEligibleIds` 계산 직전에:

```ts
  // 오우닝 부서 소속원 — 파생 editor라 private 후보군에 포함 (org_path prefix, 서버 parity)
  const owningDeptMemberIds = owningDept
    ? dirUsers
        .filter((u) => {
          const p = u.org_path || (deptOrgPathByLeaf.get(u.department) ?? u.department);
          return p === owningDept.id || p.startsWith(`${owningDept.id}/`);
        })
        .map((u) => u.id)
    : [];
  const owningLeaderId =
    owningDept?.manager && userById.has(owningDept.manager) ? owningDept.manager : null;
```

`approverEligibleIds` Set 스프레드에 `...owningDeptMemberIds,`와 `...(owningLeaderId ? [owningLeaderId] : []),` 추가. 승인자 `PrincipalPicker`(line 548)에 prop 추가:

```tsx
            pinnedIds={owningLeaderId ? new Set([owningLeaderId]) : undefined}
```

- [ ] **Step 6: 협업자 목록 잠금 행**

협업자 `<ul>`(line 504) 맨 앞, `{collaborators.map(...)}` 위에:

```tsx
              {owningDept && (
                <li
                  data-id="owning-dept-locked-row"
                  className="flex shrink-0 items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-2 py-1 text-caption text-ink"
                >
                  <PrincipalIcon type="department" />
                  <span className="flex-1 truncate">
                    {owningDept.korean_name || owningDept.name}
                  </span>
                  <span
                    title={t("perm.owningDept.lockedNote")}
                    className="inline-flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
                  >
                    <LockKeyhole size={12} strokeWidth={1.5} />
                    {t("perm.owningDept.lockedEditor")}
                  </span>
                </li>
              )}
```

- [ ] **Step 7: i18n 키 (en/ko 두 블록, perm.createDialog.* 인근)**

```ts
  // en
  "perm.owningDept.label": "Owning department (required)",
  "perm.owningDept.requiredHint": "Select the owning department.",
  "perm.owningDept.lockedEditor": "Editor · locked",
  "perm.owningDept.lockedNote": "Owning department members always have editor access.",
  // ko — 역할 단어는 영어 유지
  "perm.owningDept.label": "오우닝 부서 (필수)",
  "perm.owningDept.requiredHint": "오우닝 부서를 선택하세요.",
  "perm.owningDept.lockedEditor": "Editor · 고정",
  "perm.owningDept.lockedNote": "오우닝 부서 구성원은 항상 Editor 권한을 가집니다.",
```

- [ ] **Step 8: 게이트 + Commit**

Run: `npm run lint && npm run build && npx vitest run` → Expected: 0에러, vitest 전부 PASS.

```bash
git add frontend/src/lib/api.ts frontend/src/components/permissions/create-map-dialog.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(create-map): required owning department with auto dept-lead approver — 생성 모달 오우닝 부서 필수화·리더 자동 승인자·잠금 행"
```

---

### Task 6: Frontend — 설정 화면 (Assign/Change + 잠금 행)

**Files:**
- Modify: `frontend/src/components/permissions/map-details-panel.tsx`(전면), `frontend/src/components/permissions/collaborators-panel.tsx`, `frontend/src/app/maps/[mapId]/settings/page.tsx:71-83` + `:353-364`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `setOwningDepartment`(Task 4), `MapSummary.owning_department`, `getDirectory`, `PrincipalPicker`, `buildKoreanDeptByPath`/`formatDeptName`(`@/lib/korean-dept`).
- Produces: `MapDetailsPanelProps`에 `isOwner: boolean`, `onChanged?: () => void` 추가 · `CollaboratorsPanelProps`에 `owningDepartment?: string | null` 추가.

- [ ] **Step 1: MapDetailsPanel — 오우닝 부서 블록**

`map-details-panel.tsx`를 다음 구조로 확장 (기존 description 편집은 그대로 두고 아래에 블록 추가):

```tsx
"use client";

// 맵 정보 탭 — description 편집(편집자+) + 오우닝 부서 표시/지정(owner) / Map details:
// edit description (editor+); show/assign owning department (owner-gated, spec 2026-07-10).

import { useEffect, useState } from "react";
import { Building2, LockKeyhole, TriangleAlert } from "lucide-react";

import { getDirectory, getMap, setOwningDepartment, updateMap } from "@/lib/api";
import type { DirectoryDept, DirectoryUser } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { buildKoreanDeptByPath, deriveDeptKoreanKeywords, formatDeptName } from "@/lib/korean-dept";
import { PrincipalPicker } from "@/components/permissions/principal-picker";
import type { PrincipalOption } from "@/components/permissions/principal-picker";

interface MapDetailsPanelProps {
  mapId: string;
  canEdit: boolean;
  /** 오우닝 부서 지정/변경은 owner(sysadmin 포함) 전용 */
  isOwner: boolean;
  onToast: (message: string) => void;
  /** 오우닝 부서 변경 후 부모 갱신(협업자 잠금 행 동기화) */
  onChanged?: () => void;
}
```

state 추가: `owningDept: string | null`, `dirUsers: DirectoryUser[]`, `dirDepts: DirectoryDept[]`, `pickingOwning: boolean`. 기존 `getMap` effect에서 `setOwningDept(d.owning_department ?? null)`도 세팅하고, `getDirectory()`를 같은 effect에서 병렬 로드(`Promise.all`). 피커용 어댑터는 create-map-dialog.tsx:117-132의 `pickerDepts` 변환을 그대로 복제(부서만 필요하므로 users 변환은 생략, `userById`는 manager 키워드용으로 유지).

선택 핸들러:

```ts
  async function handlePickOwning(opt: PrincipalOption) {
    try {
      const updated = await setOwningDepartment(Number(mapId), opt.principalId);
      setOwningDept(updated.owning_department ?? opt.principalId);
      setPickingOwning(false);
      onToast(t("perm.owningDept.saved"));
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }
```

렌더 — description 블록 아래에:

```tsx
      <div data-id="settings-owning-dept" className="flex flex-col gap-1.5">
        <label className="text-caption text-ink-secondary">{t("perm.owningDept.title")}</label>
        {owningDept ? (
          <div className="flex items-center gap-2 rounded-sm border border-hairline px-3 py-2">
            <Building2 size={16} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
            <span className="min-w-0 flex-1 truncate text-body text-ink">
              {formatDeptName(owningDept, lang, koreanByPath)}
              <span className="ml-1.5 text-fine text-ink-tertiary">{owningDept}</span>
            </span>
            <span
              title={t("perm.owningDept.lockedNote")}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary"
            >
              <LockKeyhole size={12} strokeWidth={1.5} />
              {t("perm.owningDept.lockedEditor")}
            </span>
            {isOwner && (
              <button
                type="button"
                data-id="owning-dept-change"
                className="rounded-sm border border-hairline px-2 py-1 text-caption text-ink hover:bg-surface-alt"
                onClick={() => setPickingOwning((v) => !v)}
              >
                {t("perm.owningDept.changeBtn")}
              </button>
            )}
          </div>
        ) : (
          <div
            data-id="owning-dept-missing"
            className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2"
          >
            <TriangleAlert size={16} strokeWidth={1.5} className="shrink-0 text-error" />
            <span className="min-w-0 flex-1 text-caption text-ink-secondary">
              {t("perm.owningDept.missingNotice")}
            </span>
            {isOwner && (
              <button
                type="button"
                data-id="owning-dept-assign"
                className="rounded-sm bg-accent px-2.5 py-1 text-caption text-on-accent hover:bg-accent-focus"
                onClick={() => setPickingOwning((v) => !v)}
              >
                {t("perm.owningDept.assignBtn")}
              </button>
            )}
          </div>
        )}
        {pickingOwning && isOwner && (
          <PrincipalPicker
            users={[]}
            departments={pickerDepts}
            groups={[]}
            excludeIds={new Set(owningDept ? [owningDept] : [])}
            deptKoreanKeywords={deriveDeptKoreanKeywords(dirUsers)}
            onSelect={(opt) => void handlePickOwning(opt)}
          />
        )}
      </div>
```

`lang`은 `useI18n()`에서, `koreanByPath`는 `buildKoreanDeptByPath(dirDepts, dirUsers)`로 렌더 중 계산. `bg-accent`/`text-on-accent`/`hover:bg-accent-focus` 클래스는 이 파일의 기존 저장 버튼(line 68)과 동일 — 새 토큰 발명 금지.

- [ ] **Step 2: CollaboratorsPanel — 잠금 행 합성**

props에 `owningDepartment?: string | null;` 추가. 권한 행 목록 렌더(rows.map→`CollaboratorRow` 위치는 파일 하단 — `rows.map(` 검색)에서 목록 맨 위에:

```tsx
        {owningDepartment && (
          <div
            data-id="owning-dept-locked-row"
            className="flex items-center gap-2 rounded-sm bg-surface-alt px-2 py-1.5"
          >
            <PrincipalIcon type="department" />
            <span className="min-w-0 flex-1 truncate text-caption text-ink">
              {resolvePrincipalName("department", owningDepartment, dirUsers, dirDepts, groups)}
              <span className="ml-1.5 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-tertiary">
                {t("perm.owningDept.title")}
              </span>
            </span>
            <span
              title={t("perm.owningDept.lockedNote")}
              className="inline-flex shrink-0 items-center gap-1 text-fine text-ink-tertiary"
            >
              <LockKeyhole size={14} strokeWidth={1.5} />
              {t("perm.owningDept.lockedEditor")}
            </span>
          </div>
        )}
```

lucide import에 `LockKeyhole` 추가.

- [ ] **Step 3: settings page 배선**

`settings/page.tsx` — state 추가 `const [owningDepartment, setOwningDept] = useState<string | null>(null);`, `refreshMap` 내부에 `setOwningDept(detail.owning_department ?? null);` 추가. 렌더 스위치에서:

```tsx
                  {tab.id === "details" ? (
                    <MapDetailsPanel
                      mapId={mapIdStr}
                      canEdit={canEdit}
                      isOwner={isOwner}
                      onToast={showToast}
                      onChanged={() => void refreshMap()}
                    />
                  ) : ...
```

`CollaboratorsPanel`에 `owningDepartment={owningDepartment}` prop 추가.

- [ ] **Step 4: i18n 키 (en/ko)**

```ts
  // en
  "perm.owningDept.title": "Owning department",
  "perm.owningDept.missingNotice": "No owning department assigned yet. The owner can assign one.",
  "perm.owningDept.assignBtn": "Assign",
  "perm.owningDept.changeBtn": "Change",
  "perm.owningDept.saved": "Owning department updated.",
  // ko
  "perm.owningDept.title": "오우닝 부서",
  "perm.owningDept.missingNotice": "오우닝 부서가 아직 지정되지 않았습니다. 오너가 지정할 수 있습니다.",
  "perm.owningDept.assignBtn": "지정",
  "perm.owningDept.changeBtn": "변경",
  "perm.owningDept.saved": "오우닝 부서가 변경되었습니다.",
```

- [ ] **Step 5: 게이트 + Commit**

Run: `npm run lint && npm run build` → Expected: 0에러. (set-state-in-effect 린트: getMap/getDirectory then-콜백의 setState는 비동기라 비해당 — 기존 패턴 그대로.)

```bash
git add frontend/src/components/permissions/map-details-panel.tsx frontend/src/components/permissions/collaborators-panel.tsx "frontend/src/app/maps/[mapId]/settings/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(settings): owning department assign/change + locked collaborator row — 설정에서 오우닝 부서 지정·변경·잠금 행 표시"
```

---

### Task 7: Frontend — 홈 누락 배지 + 필터

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx:164-171` 인근, `frontend/src/app/page.tsx` (state·복원·저장·filteredMaps·listKey·필터 행·Clear), `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `MapSummary.owning_department`(Task 4).
- Produces: 없음 (말단 UI).

- [ ] **Step 1: 카드 배지**

`map-card.tsx` — 상태 배지 블록(line 164-171) 바로 아래에 (departed 배지와 동일한 error 톤):

```tsx
          {!map.owning_department && (
            <span
              data-id="map-card-owning-missing"
              title={t("home.owningMissingNote")}
              className="shrink-0 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-error"
            >
              {t("home.owningMissingBadge")}
            </span>
          )}
```

- [ ] **Step 2: 홈 필터 상태 + 영속**

`page.tsx` — `permFilter` 아래에 `const [owningFilter, setOwningFilter] = useState<Set<string>>(new Set());`.

복원 effect(line 123-141): 파싱 타입에 `owning?: unknown;` 추가 후

```ts
      if (Array.isArray(s.owning)) {
        setOwningFilter(new Set(s.owning.filter((x): x is string => typeof x === "string")));
      }
```

저장 effect(line 154-163): `owning: [...owningFilter],` 추가 + deps에 `owningFilter`.

`filteredMaps`(line 251-263): 조건 추가

```ts
        const owningOk =
          owningFilter.size === 0 || (owningFilter.has("missing") && !m.owning_department);
        return visOk && statusOk && permOk && owningOk;
```

deps에 `owningFilter` 추가. `listKey`(line 299)에 `|${[...owningFilter].sort().join(",")}` 추가.

- [ ] **Step 3: 필터 드롭다운 + Clear**

역할 FilterDropdown(line 501-519) 아래에:

```tsx
                <FilterDropdown
                  label={t("home.filterOwning")}
                  dataId="home-owning-filter"
                  icon={<Building2 size={14} strokeWidth={1.5} />}
                  options={[
                    {
                      value: "missing",
                      label: t("home.owningMissingOption"),
                      icon: <TriangleAlert size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />,
                    },
                  ]}
                  selected={owningFilter}
                  onToggle={(v) =>
                    setOwningFilter((prev) => {
                      const next = new Set(prev);
                      if (next.has(v)) next.delete(v);
                      else next.add(v);
                      return next;
                    })
                  }
                />
```

lucide import에 `Building2`, `TriangleAlert` 추가. Clear 버튼 노출 조건에 `|| owningFilter.size > 0`, onClick에 `setOwningFilter(new Set());` 추가.

- [ ] **Step 4: i18n 키 (en/ko)**

```ts
  // en
  "home.filterOwning": "Owning",
  "home.owningMissingOption": "Missing owning dept",
  "home.owningMissingBadge": "No owning dept",
  "home.owningMissingNote": "Owning department not assigned — assign it in map settings.",
  // ko
  "home.filterOwning": "오우닝",
  "home.owningMissingOption": "오우닝 부서 누락",
  "home.owningMissingBadge": "오우닝 부서 없음",
  "home.owningMissingNote": "오우닝 부서가 지정되지 않은 맵입니다 — 맵 설정에서 지정하세요.",
```

- [ ] **Step 5: 게이트 + Commit**

Run: `npm run lint && npm run build` → Expected: 0에러.

```bash
git add frontend/src/components/maps/map-card.tsx frontend/src/app/page.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(home): missing owning-department badge and filter — 홈 오우닝 부서 누락 배지·필터"
```

---

### Task 8: 시드 + 브라우저 검증 + 최종 게이트

**Files:**
- Modify: `backend/scripts/seed_org_demo.py:278-291`
- Create: `backend/scripts/pw-verify-owning-dept.mjs`

**Interfaces:**
- Consumes: 전 태스크 전부.

- [ ] **Step 1: 데모 시드 — 2/3 지정, 1/3 누락**

`seed_org_demo.py` `_seed_maps`의 `m = ProcessMap(...)` 직후(line 281 아래)에:

```python
        # 오우닝 부서 — 2/3은 오너 소속 경로로 지정, 1/3(idx%3==0)은 누락으로 남겨
        # 홈 배지·누락 필터·설정 Assign 플로우를 시연 가능하게 한다 (spec 2026-07-10)
        if idx % 3 != 0:
            m.owning_department = owner["path"]
```

- [ ] **Step 2: 브라우저 검증 스크립트**

`backend/scripts/pw-verify-owning-dept.mjs` 신규 — **`pw-verify-csv-create-flow.mjs`를 열어 그 스캐폴딩(시스템 Chrome 기동·베이스 URL·devUser 로그인·콘솔 로그 수집)을 그대로 복제**하고 시나리오만 교체한다. 검증 항목(각각 PASS/FAIL 출력):

1. 홈 → New map 다이얼로그: 이름+승인자만 채우면 Create 비활성, `perm.owningDept.requiredHint` 노출.
2. `/api/directory`를 페이지 컨텍스트에서 fetch해 `manager`가 비어있지 않은 부서를 하나 고르고, 오우닝 부서 피커에서 그 부서를 검색·선택 → 리더 승인자 pill(`create-approver-pill-<manager>`) 자동 생성 확인.
3. `owning-dept-locked-row`(잠금 행)와 `owning-dept-selected` 표시 확인, 승인자 pill X로 리더 제거 → 승인자 피커 포커스 시 최상단에 리더(Dept Lead 배지) 노출 확인.
4. Create → 에디터 진입 → 설정 페이지 `settings-owning-dept`에 지정 부서 표시.
5. 홈 복귀: 시드된 누락 맵(idx%3==0)에 `map-card-owning-missing` 배지 → `home-owning-filter`에서 Missing 토글 → 목록이 누락 맵만 남는지 확인.
6. sysadmin(devUser admin.sys)으로 누락 맵 설정 → `owning-dept-assign` → 부서 선택 → 표시 전환 + 협업자 섹션 `owning-dept-locked-row` 확인.

실행 전제(스크립트 헤더 주석에 명기): `python -m scripts.reset_db` 시드 + 백엔드 :8000 + 프론트 :3000 기동, 좀비 next dev 전수 pkill(`docs/lessons/browser-verification.md`).

- [ ] **Step 3: 브라우저 검증 실행**

Run (저장소 루트 아님 — backend/에서): 백엔드·프론트 기동 후 `node scripts/pw-verify-owning-dept.mjs`
Expected: 전 시나리오 PASS. **서버 기동이 불가능한 환경이면 스크립트만 커밋하고 "미실행"을 PROGRESS.md와 최종 보고에 정직하게 기록** — PASS로 위장 금지.

- [ ] **Step 4: 최종 전체 게이트**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && npm run lint && npm run build
```

Expected: 전부 PASS/0에러.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/seed_org_demo.py backend/scripts/pw-verify-owning-dept.mjs PROGRESS.md
git commit -m "test(owning-dept): demo seed split + browser verification script — 데모 시드 지정/누락 분배·브라우저 검증 스크립트"
```

---

## Self-Review 결과

- **스펙 커버리지**: 컬럼/검증(T1) · 파생 editor(T2) · PUT+가드(T3) · 생성 모달 필수·리더·잠금행·후보군(T5, pinned는 T4) · 설정 Assign/Change+잠금행(T6) · 홈 배지+필터(T7) · 시드/검증(T8). 스펙의 "vitest: 리더 해석 순수 로직"은 신규 lib 함수가 없어(전부 기존 유틸 재사용) 해당 없음 — 기존 vitest 전체 통과로 대체.
- **타입 일관성**: `owning_department`(snake, API/DB) ↔ `owningDepartment`(camel, TS 함수 인자) ↔ `owningDept`(컴포넌트 state). `setOwningDepartment` 명칭은 api.ts와 T6 호출부 동일.
- **주의**: T1의 sed 후 남는 비인라인 payload 호출부는 반드시 grep으로 확인. 앵커 부서(`Owning Anchor Division`)는 conftest와 테스트 파일 리터럴이 동기여야 한다.
