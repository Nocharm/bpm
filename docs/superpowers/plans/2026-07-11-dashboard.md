# 운영 대시보드 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 › 분석 › Dashboard 스텁을, 지정된 인원·부서·유저그룹도 열람 가능한 리더 보고용 실운영 대시보드로 완성한다.

**Architecture:** 백엔드에 신규 테이블 2개(`dashboard_permissions` 열람 권한 · `dashboard_coverage_depts` 커버리지 분모 부서)를 추가하고, 지표 API를 스냅샷(`/summary`)과 시계열(`/timeseries`)로 분리한다. 프론트는 Dashboard 탭 선택 시 설정 탭 레일을 풀블리드 3열 대시보드로 교체하며(좌 요약 레일 · 중앙 지표 그리드 · 우 인스펙터형 사이드바), 차트는 의존성 추가 없이 자체 SVG/CSS로 그린다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js(App Router) + TypeScript + Tailwind v4 토큰 / pytest · vitest · Playwright.

**설계 스펙:** `docs/superpowers/specs/2026-07-11-dashboard-design.md` (커밋 dd9694c)

## Global Constraints

- 브랜치는 `worktree-dashboard-design`. 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dashboard-design/`에서만 작업한다.
- **시각은 KST 고정** — 백엔드는 `app.clock.now()`(UTC+9), 프론트 표시는 `lib/datetime`의 `formatKst`/`formatKstShort`. 브라우저 `toLocaleString()`/`getHours()` 금지.
- **raw hex 금지** — 색은 디자인 토큰(`bg-surface`, `text-ink`, `text-accent`, `border-hairline`, `bg-accent-tint`, `text-error` 등) 또는 `var(--color-*)`로만 (`rules/frontend/design.md`).
- **타입** — 폰트 굵기 사다리 300/400/600(500 금지), 스케일은 `text-tagline`/`text-body-strong`/`text-body`/`text-caption`/`text-caption-strong`/`text-fine`.
- **아이콘** — Lucide 16px / `strokeWidth={1.5}`. 이모지 금지.
- **UI 문구는 영어**(i18n 키 경유), 코드 주석은 한국어 허용. i18n 키는 `frontend/src/lib/i18n-messages.ts`의 **en 블록과 ko 블록 양쪽**에 추가한다.
- **React Compiler** — 핸들러는 평범한 함수로 둔다. 수동 `useCallback`/`useMemo`의 deps 불일치는 `npm run lint`/`build`를 깨뜨린다(`react-hooks/preserve-manual-memoization`). 효과 안 동기 setState 금지(`react-hooks/set-state-in-effect`).
- **id 생성은 `genId()`**(`@/lib/id`) — `crypto.randomUUID()` 금지(서버는 평문 HTTP = insecure context).
- **신규 테이블은 `db.py _ADDED_COLUMNS` 등록 불요** — `create_all`이 생성한다. 등록은 *기존 테이블에 컬럼을 더할 때만* 필요하다.
- **`grep`은 ugrep이라 `[mapId]` 같은 대괄호 디렉터리를 조용히 건너뛴다** — 재귀 검색 시 `find`+개별 grep으로 교차 확인.
- 커밋 메시지는 `type(scope): English summary — 한국어 요약` 형식. 커밋마다 `PROGRESS.md`를 같은 커밋에 갱신한다(`rules/common/git.md`).

**명령어** (bash / PowerShell 병기 — 로컬 검증은 Windows PC):

```bash
# backend (backend/ 에서)
.venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/
# frontend (frontend/ 에서)
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

```powershell
# backend (backend\ 에서)
.venv\Scripts\python -m pytest tests\ -q
.venv\Scripts\ruff check app\ tests\
# frontend (frontend\ 에서)
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```

---

## File Structure

**Backend**
| 파일 | 책임 |
|------|------|
| `backend/app/models.py` (수정) | `DashboardPermission` · `DashboardCoverageDept` 모델 추가 |
| `backend/app/permissions/logic.py` (수정) | `can_view_dashboard()` 순수 판정 함수 |
| `backend/app/permissions/access.py` (수정) | `can_view_dashboard_db()` — DB 로딩 래퍼 |
| `backend/app/permissions/deps.py` (수정) | `require_dashboard_viewer` FastAPI 의존성 |
| `backend/app/schemas.py` (수정) | 대시보드 응답/입력 스키마 · `MeOut.can_view_dashboard` |
| `backend/app/routers/dashboard.py` (수정) | 게이트 교체 + `/summary` · `/timeseries` · 설정 API |
| `backend/app/main.py` (수정) | `/api/me`에 `can_view_dashboard` 채우기 |
| `backend/tests/test_dashboard_access.py` (신규) | 권한 판정 순수 함수 + 게이트 403/200 |
| `backend/tests/test_dashboard_metrics.py` (신규) | `/summary` · `/timeseries` 집계 |
| `backend/tests/test_dashboard.py` (수정) | 기존 sysadmin 403 테스트가 새 게이트에서도 성립하는지 |

**Frontend**
| 파일 | 책임 |
|------|------|
| `frontend/src/lib/dashboard-chart.ts` (신규) | 순수 함수 — 축 스케일/틱, 기간 프리셋→날짜범위, KST 날짜키 |
| `frontend/src/lib/dashboard-chart.test.ts` (신규) | 위 순수 함수 vitest |
| `frontend/src/lib/api.ts` (수정) | 대시보드 API 바인딩 + 타입 |
| `frontend/src/lib/current-user.ts` (수정) | `CurrentUser.canViewDashboard` |
| `frontend/src/components/providers.tsx` (수정) | `/api/me` → `canViewDashboard` 전달 |
| `frontend/src/components/dashboard/stat-card.tsx` (신규) | 좌 레일 스탯 카드 |
| `frontend/src/components/dashboard/bar-chart.tsx` (신규) | 세로 막대(시계열) |
| `frontend/src/components/dashboard/line-chart.tsx` (신규) | 라인(누적 성장) |
| `frontend/src/components/dashboard/hbar-list.tsx` (신규) | 가로 막대 리스트(버전 상태·부서 커버리지 공용) |
| `frontend/src/components/dashboard/period-filter.tsx` (신규) | 7일/1개월/3개월/달력 |
| `frontend/src/components/dashboard/access-sidebar.tsx` (신규) | 우측 사이드바 — Access · Coverage 탭 |
| `frontend/src/components/settings/dashboard-panel.tsx` (재작성) | 3열 조립 |
| `frontend/src/app/settings/page.tsx` (수정) | Dashboard 탭 = 풀블리드 레이아웃 교체 + 탭 게이팅 |
| `frontend/src/lib/i18n-messages.ts` (수정) | `dashboard.*` 키 (en/ko 양쪽) |
| `frontend/scripts/pw-verify-dashboard.mjs` (신규) | Playwright 브라우저 검증 |

---

### Task 1: 모델 2개 + 권한 판정 순수 함수

**Files:**
- Modify: `backend/app/models.py` (파일 끝 — `AiUsageEvent` 다음)
- Modify: `backend/app/permissions/logic.py` (파일 끝)
- Test: `backend/tests/test_dashboard_access.py` (신규)

**Interfaces:**
- Produces: `models.DashboardPermission`, `models.DashboardCoverageDept`, `logic.can_view_dashboard(is_sysadmin_flag: bool, login_id: str, emp_org_path: str, user_group_ids: set[str], principals: list[tuple[str, str]]) -> bool`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_dashboard_access.py` 신규 생성:

```python
"""대시보드 열람 권한 — 순수 판정 함수 (design 2026-07-11)."""

from app.permissions.logic import can_view_dashboard


def test_sysadmin_always_views() -> None:
    """sysadmin은 권한 행이 없어도 통과."""
    assert can_view_dashboard(True, "admin.sys", "", set(), []) is True


def test_no_principal_row_denied() -> None:
    """권한 행이 없으면 비-sysadmin은 거부."""
    assert can_view_dashboard(False, "u1", "Div/Office", set(), []) is False


def test_user_principal_matches() -> None:
    assert can_view_dashboard(False, "u1", "Div/Office", set(), [("user", "u1")]) is True
    assert can_view_dashboard(False, "u2", "Div/Office", set(), [("user", "u1")]) is False


def test_department_principal_includes_descendants() -> None:
    """부서 권한은 하위 부서 소속까지 포함 (belongs_to_department 규약)."""
    perms = [("department", "Div/Office")]
    assert can_view_dashboard(False, "u1", "Div/Office", set(), perms) is True
    assert can_view_dashboard(False, "u1", "Div/Office/Team1", set(), perms) is True
    # 경계 없는 부분 일치는 거부 — "Div/OfficeX"는 하위가 아니다
    assert can_view_dashboard(False, "u1", "Div/OfficeX", set(), perms) is False


def test_group_principal_requires_membership() -> None:
    """그룹 권한은 caller가 속한 ACTIVE 그룹일 때만 (user_group_ids는 caller가 주입)."""
    perms = [("group", "7")]
    assert can_view_dashboard(False, "u1", "", {"7"}, perms) is True
    assert can_view_dashboard(False, "u1", "", {"8"}, perms) is False
    assert can_view_dashboard(False, "u1", "", set(), perms) is False
```

- [ ] **Step 2: 실패를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py -q`
Expected: FAIL — `ImportError: cannot import name 'can_view_dashboard' from 'app.permissions.logic'`

- [ ] **Step 3: 순수 함수를 구현한다**

`backend/app/permissions/logic.py` 파일 끝에 추가:

```python
# 대시보드 열람 principal 튜플: (principal_type, principal_id) — 역할 구분 없음
DashboardPrincipal = tuple[str, str]


def can_view_dashboard(
    is_sysadmin_flag: bool,
    login_id: str,
    emp_org_path: str,
    user_group_ids: set[str],
    principals: list[DashboardPrincipal],
) -> bool:
    """대시보드 열람 가능 여부 — sysadmin이거나 principal 매칭 1건 이상.

    principal 해석은 map_permissions와 동일 규약: user→login_id 일치,
    department→belongs_to_department(하위 포함), group→caller가 속한 ACTIVE 그룹.
    """
    if is_sysadmin_flag:
        return True
    for ptype, pid in principals:
        if ptype == "user" and pid == login_id:
            return True
        if ptype == "department" and belongs_to_department(emp_org_path, pid):
            return True
        if ptype == "group" and pid in user_group_ids:
            return True
    return False
```

- [ ] **Step 4: 모델 2개를 추가한다**

`backend/app/models.py` 파일 끝(`AiUsageEvent` 클래스 다음)에 추가:

```python
class DashboardPermission(Base):
    """대시보드 열람 권한 행 — principal(사용자/부서/그룹)에게 부여. 역할 구분 없음
    (행이 있으면 열람, 없으면 403). principal 해석 규약은 map_permissions와 동일.
    """

    __tablename__ = "dashboard_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    # 'user' | 'department' | 'group'
    principal_type: Mapped[str] = mapped_column(String(20))
    # user→login_id; department→org_path 문자열; group→user_groups.id 문자열
    principal_id: Mapped[str] = mapped_column(String(200))
    granted_by: Mapped[str] = mapped_column(String(100))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DashboardCoverageDept(Base):
    """커버리지 % 의 분모가 되는 부서 목록 — sysadmin이 지정, 전원에게 동일 적용."""

    __tablename__ = "dashboard_coverage_depts"

    # org_path 문자열(루트→리프, "A/B/C") — 하위 부서 맵도 이 부서에 귀속해 센다
    org_path: Mapped[str] = mapped_column(String(200), primary_key=True)
    added_by: Mapped[str] = mapped_column(String(100))
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py -q`
Expected: PASS (5 passed)

- [ ] **Step 6: 전체 백엔드 게이트**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, ruff 0 에러. (신규 테이블은 `create_all`이 만들므로 기존 테스트가 깨지지 않는다.)

- [ ] **Step 7: 커밋**

`PROGRESS.md` 최상단 섹션(`## 2026-07-11 — 운영 대시보드 설계 (dashboard-design)`) 아래에 한 줄 추가:

```markdown
- T1 모델·권한 판정 — `dashboard_permissions`·`dashboard_coverage_depts` 테이블 + `logic.can_view_dashboard()` 순수 함수(sysadmin·user·department 하위·group 멤버십 5케이스 테스트).
```

```bash
git add backend/app/models.py backend/app/permissions/logic.py backend/tests/test_dashboard_access.py PROGRESS.md
git commit -m "feat(dashboard): permission tables + can_view_dashboard logic — 대시보드 열람 권한 모델·판정"
```

---

### Task 2: 열람 게이트 + MeOut 확장

**Files:**
- Modify: `backend/app/permissions/access.py` (파일 끝)
- Modify: `backend/app/permissions/deps.py` (파일 끝)
- Modify: `backend/app/routers/dashboard.py:22` (라우터 선언부)
- Modify: `backend/app/schemas.py` (`MeOut`)
- Modify: `backend/app/main.py` (`get_me`)
- Test: `backend/tests/test_dashboard_access.py` (Task 1에서 만든 파일에 추가)

**Interfaces:**
- Consumes: `logic.can_view_dashboard` (Task 1)
- Produces: `access.can_view_dashboard_db(session, login_id) -> bool`, `deps.require_dashboard_viewer` (FastAPI 의존성), `MeOut.can_view_dashboard: bool`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_dashboard_access.py` 끝에 추가:

```python
import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import DashboardPermission, Employee
from app.settings import settings


def _seed(rows: list) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for row in rows:
                session.add(row)
            await session.commit()

    asyncio.run(_run())


def test_non_sysadmin_without_grant_is_403(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 행이 없는 비-sysadmin은 지표 API 403."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    response = client.get("/api/dashboard", headers={"X-Dev-User": "dash.nobody"})
    assert response.status_code == 403


def test_granted_user_can_view(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """user principal 행이 있으면 비-sysadmin도 200."""
    _seed([
        Employee(login_id="dash.viewer", name="Dash Viewer", source="local", active=True),
        DashboardPermission(
            principal_type="user", principal_id="dash.viewer", granted_by="admin.sys"
        ),
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    response = client.get("/api/dashboard", headers={"X-Dev-User": "dash.viewer"})
    assert response.status_code == 200


def test_me_exposes_can_view_dashboard(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """/api/me가 탭 게이팅용 플래그를 싣는다."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    granted = client.get("/api/me", headers={"X-Dev-User": "dash.viewer"}).json()
    denied = client.get("/api/me", headers={"X-Dev-User": "dash.nobody"}).json()
    assert granted["can_view_dashboard"] is True
    assert denied["can_view_dashboard"] is False
```

> 게이트 검증에는 **기존 엔드포인트 `/api/dashboard`**를 쓴다 — `/summary`는 Task 4에서 생기므로 여기서 치면 404가 나 게이트를 검증하지 못한다. Task 4 이후에도 이 테스트는 그대로 둔다(구 엔드포인트와 게이트가 유지되므로).

- [ ] **Step 2: 실패를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py -q`
Expected: FAIL — `test_granted_user_can_view`가 403(아직 sysadmin 게이트), `test_me_exposes_can_view_dashboard`가 KeyError

- [ ] **Step 3: DB 래퍼를 구현한다**

`backend/app/permissions/access.py` — import에 `DashboardPermission` 추가하고 파일 끝에:

```python
async def can_view_dashboard_db(session: AsyncSession, login_id: str) -> bool:
    """대시보드 열람 가능 여부 — dashboard_permissions 로딩 후 순수 판정에 위임."""
    if logic.is_sysadmin(login_id):
        return True

    emp = await session.get(Employee, login_id)
    emp_org_path = (
        logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
        if emp is not None
        else ""
    )
    rows = (
        await session.execute(
            select(DashboardPermission.principal_type, DashboardPermission.principal_id)
        )
    ).all()
    principals: list[logic.DashboardPrincipal] = [(p, pid) for p, pid in rows]
    user_group_ids = await get_user_active_group_ids(session, login_id, emp_org_path)
    return logic.can_view_dashboard(
        False, login_id, emp_org_path, user_group_ids, principals
    )
```

- [ ] **Step 4: FastAPI 의존성을 만든다**

`backend/app/permissions/deps.py` — import에 `from app.permissions.access import assert_map_role, can_view_dashboard_db` 로 확장하고 파일 끝에:

```python
async def require_dashboard_viewer(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> str:
    """대시보드 열람 권한(sysadmin 또는 dashboard_permissions 매칭)이 없으면 403."""
    if not await can_view_dashboard_db(session, user):
        raise HTTPException(status_code=403, detail="dashboard access required")
    return user
```

- [ ] **Step 5: 라우터 게이트를 교체한다**

`backend/app/routers/dashboard.py` — 라우터 선언부(현재 `dependencies=[Depends(require_sysadmin)]`)를 게이트 없는 선언으로 바꾸고, **엔드포인트별로** 의존성을 건다:

```python
from app.permissions.deps import require_dashboard_viewer

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get(
    "/dashboard",
    response_model=DashboardMetricsOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_dashboard(...):
    ...


@router.get(
    "/dashboard/ai-usage",
    response_model=AiUsageOut,
    dependencies=[Depends(require_sysadmin)],  # AI 토큰·비용은 sysadmin 전용 유지
)
async def get_ai_usage(...):
    ...
```

`require_sysadmin` import는 유지한다(ai-usage와 Task 3의 설정 API가 쓴다).

- [ ] **Step 6: MeOut을 확장한다**

`backend/app/schemas.py`의 `MeOut`에 필드 추가 (`is_sysadmin` 다음 줄):

```python
    # 대시보드 열람 가능 여부 — 설정 탭 노출 게이팅 (design 2026-07-11)
    can_view_dashboard: bool = False
```

`backend/app/main.py`의 `get_me` — import에 `from app.permissions.access import can_view_dashboard_db` 추가하고, `MeOut(...)` 생성부에 필드를 채운다:

```python
        is_sysadmin=is_sysadmin(login_id),
        can_view_dashboard=await can_view_dashboard_db(session, login_id),
        manager_ids=manager_ids,
```

- [ ] **Step 7: 테스트 통과를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py tests/test_dashboard.py -q`
Expected: PASS. 기존 `test_dashboard_requires_sysadmin`도 여전히 통과한다(권한 행이 없는 비-sysadmin은 새 게이트에서도 403).

- [ ] **Step 8: 전체 게이트 + 커밋**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`

`PROGRESS.md`에 한 줄:

```markdown
- T2 열람 게이트 — `require_dashboard_viewer`(sysadmin 또는 권한 행) 도입, 라우터 게이트를 엔드포인트별로 분리(ai-usage는 sysadmin 유지), `/api/me`에 `can_view_dashboard` 노출.
```

```bash
git add backend/app/permissions/access.py backend/app/permissions/deps.py backend/app/routers/dashboard.py backend/app/schemas.py backend/app/main.py backend/tests/test_dashboard_access.py PROGRESS.md
git commit -m "feat(dashboard): viewer gate + me flag — 열람 게이트·MeOut 플래그"
```

---

### Task 3: 설정 API — 권한 CRUD + 커버리지 부서

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/dashboard.py`
- Test: `backend/tests/test_dashboard_access.py` (추가)

**Interfaces:**
- Consumes: `deps.require_dashboard_viewer` (Task 2), `models.DashboardPermission`/`DashboardCoverageDept` (Task 1)
- Produces: `GET/POST/DELETE /api/dashboard/permissions`, `GET/PUT /api/dashboard/coverage-depts`, 스키마 `DashboardPermissionIn`/`DashboardPermissionOut`/`CoverageDeptsIn`/`CoverageDeptsOut`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_dashboard_access.py` 끝에 추가:

```python
def test_permission_crud_roundtrip(client: TestClient) -> None:
    """권한 행 추가 → 목록 노출 → 중복 409 → 삭제."""
    body = {"principal_type": "user", "principal_id": "dash.crud"}
    created = client.post("/api/dashboard/permissions", json=body)
    assert created.status_code == 201
    row_id = created.json()["id"]

    listed = client.get("/api/dashboard/permissions").json()
    assert any(r["id"] == row_id for r in listed)

    assert client.post("/api/dashboard/permissions", json=body).status_code == 409

    assert client.delete(f"/api/dashboard/permissions/{row_id}").status_code == 204
    after = client.get("/api/dashboard/permissions").json()
    assert all(r["id"] != row_id for r in after)


def test_permission_settings_require_sysadmin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 행이 있어 열람은 되더라도, 설정 API는 sysadmin만."""
    _seed([
        DashboardPermission(
            principal_type="user", principal_id="dash.viewer2", granted_by="admin.sys"
        )
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    headers = {"X-Dev-User": "dash.viewer2"}
    assert client.get("/api/dashboard/permissions", headers=headers).status_code == 403
    assert client.put(
        "/api/dashboard/coverage-depts", json={"org_paths": []}, headers=headers
    ).status_code == 403


def test_coverage_depts_put_replaces(client: TestClient) -> None:
    """PUT은 목록 통째 교체(멱등) — 같은 목록을 두 번 보내도 결과 동일."""
    paths = ["Div A/Office 1", "Div B"]
    first = client.put("/api/dashboard/coverage-depts", json={"org_paths": paths})
    assert first.status_code == 200
    assert sorted(first.json()["org_paths"]) == sorted(paths)

    again = client.put("/api/dashboard/coverage-depts", json={"org_paths": paths})
    assert sorted(again.json()["org_paths"]) == sorted(paths)

    replaced = client.put("/api/dashboard/coverage-depts", json={"org_paths": ["Div C"]})
    assert replaced.json()["org_paths"] == ["Div C"]
    assert client.get("/api/dashboard/coverage-depts").json()["org_paths"] == ["Div C"]
```

- [ ] **Step 2: 실패를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py -q -k "crud or coverage or settings_require"`
Expected: FAIL — 404 (엔드포인트 없음)

- [ ] **Step 3: 스키마를 추가한다**

`backend/app/schemas.py` — 기존 `DashboardMetricsOut` 근처에 추가:

```python
class DashboardPermissionIn(BaseModel):
    """대시보드 열람 권한 부여 입력."""

    principal_type: Literal["user", "department", "group"]
    principal_id: str = Field(min_length=1, max_length=200)


class DashboardPermissionOut(BaseModel):
    id: int
    principal_type: str
    principal_id: str
    # 표시명 — user→직원 이름, department→한글 부서명(없으면 리프), group→그룹명. 해석 실패 시 principal_id
    display_name: str
    granted_by: str
    granted_at: datetime


class CoverageDeptsIn(BaseModel):
    """커버리지 분모 부서 목록 — 통째 교체(멱등)."""

    org_paths: list[str] = Field(default_factory=list)


class CoverageDeptsOut(BaseModel):
    org_paths: list[str]
```

`Literal`이 아직 import되지 않았다면 `from typing import Literal`을 추가한다.

- [ ] **Step 4: 설정 엔드포인트를 구현한다**

`backend/app/routers/dashboard.py`에 추가:

```python
async def _resolve_display_name(
    session: AsyncSession, principal_type: str, principal_id: str
) -> str:
    """principal → 사람이 읽는 표시명. 해석 실패 시 principal_id 그대로."""
    if principal_type == "user":
        emp = await session.get(Employee, principal_id)
        return emp.name if emp else principal_id
    if principal_type == "department":
        leaf = principal_id.rsplit("/", maxsplit=1)[-1]
        info = await session.get(DeptInfo, leaf)
        return info.korean_name if info and info.korean_name else leaf
    if principal_type == "group":
        group = await session.get(UserGroup, int(principal_id)) if principal_id.isdigit() else None
        return group.name if group else principal_id
    return principal_id


@router.get(
    "/dashboard/permissions",
    response_model=list[DashboardPermissionOut],
    dependencies=[Depends(require_sysadmin)],
)
async def list_dashboard_permissions(
    session: AsyncSession = Depends(get_session),
) -> list[DashboardPermissionOut]:
    rows = (
        await session.scalars(
            select(DashboardPermission).order_by(DashboardPermission.granted_at.desc())
        )
    ).all()
    return [
        DashboardPermissionOut(
            id=row.id,
            principal_type=row.principal_type,
            principal_id=row.principal_id,
            display_name=await _resolve_display_name(
                session, row.principal_type, row.principal_id
            ),
            granted_by=row.granted_by,
            granted_at=row.granted_at,
        )
        for row in rows
    ]


@router.post(
    "/dashboard/permissions",
    response_model=DashboardPermissionOut,
    status_code=201,
    dependencies=[Depends(require_sysadmin)],
)
async def add_dashboard_permission(
    body: DashboardPermissionIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DashboardPermissionOut:
    existing = await session.scalar(
        select(DashboardPermission.id).where(
            DashboardPermission.principal_type == body.principal_type,
            DashboardPermission.principal_id == body.principal_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="grant already exists")
    row = DashboardPermission(
        principal_type=body.principal_type,
        principal_id=body.principal_id,
        granted_by=login_id,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return DashboardPermissionOut(
        id=row.id,
        principal_type=row.principal_type,
        principal_id=row.principal_id,
        display_name=await _resolve_display_name(
            session, row.principal_type, row.principal_id
        ),
        granted_by=row.granted_by,
        granted_at=row.granted_at,
    )


@router.delete(
    "/dashboard/permissions/{permission_id}",
    status_code=204,
    dependencies=[Depends(require_sysadmin)],
)
async def delete_dashboard_permission(
    permission_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    row = await session.get(DashboardPermission, permission_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"permission {permission_id} not found")
    await session.delete(row)
    await session.commit()


@router.get(
    "/dashboard/coverage-depts",
    response_model=CoverageDeptsOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_coverage_depts(session: AsyncSession = Depends(get_session)) -> CoverageDeptsOut:
    rows = (
        await session.scalars(
            select(DashboardCoverageDept).order_by(DashboardCoverageDept.org_path)
        )
    ).all()
    return CoverageDeptsOut(org_paths=[row.org_path for row in rows])


@router.put(
    "/dashboard/coverage-depts",
    response_model=CoverageDeptsOut,
    dependencies=[Depends(require_sysadmin)],
)
async def set_coverage_depts(
    body: CoverageDeptsIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CoverageDeptsOut:
    """목록 통째 교체 — 멱등. 부분 갱신 API는 두지 않는다(우측 사이드바가 항상 전체를 보낸다)."""
    await session.execute(delete(DashboardCoverageDept))
    wanted = sorted({path.strip() for path in body.org_paths if path.strip()})
    for path in wanted:
        session.add(DashboardCoverageDept(org_path=path, added_by=login_id))
    await session.commit()
    return CoverageDeptsOut(org_paths=wanted)
```

import 보강 — `from sqlalchemy import case, delete, func, select`, `from app.auth import get_current_user, require_sysadmin`, `from app.models import (AiUsageEvent, DashboardCoverageDept, DashboardPermission, DeptInfo, Employee, LoginRecord, ProcessMap, UserGroup)`, `from app.permissions.deps import require_dashboard_viewer`, `from fastapi import APIRouter, Depends, HTTPException`, 그리고 새 스키마 4종.

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_access.py -q`
Expected: PASS (전부)

- [ ] **Step 6: 전체 게이트 + 커밋**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`

`PROGRESS.md`:

```markdown
- T3 설정 API — 대시보드 권한 행 CRUD(중복 409·삭제 204)와 커버리지 분모 부서 GET/PUT(통째 교체·멱등). 열람은 뷰어, 변경은 sysadmin.
```

```bash
git add backend/app/schemas.py backend/app/routers/dashboard.py backend/tests/test_dashboard_access.py PROGRESS.md
git commit -m "feat(dashboard): settings API for grants and coverage depts — 권한·커버리지 부서 설정 API"
```

---

### Task 4: `/summary` 스냅샷 집계

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/dashboard.py`
- Test: `backend/tests/test_dashboard_metrics.py` (신규)

**Interfaces:**
- Consumes: Task 1~3의 모델·게이트
- Produces: `GET /api/dashboard/summary` → `DashboardSummaryOut`

**집계 정의 (모호함 제거):**
- `maps.total` = `deleted_at IS NULL` 인 맵 수
- `maps.published` = 그중 `status='published'` 버전을 1개 이상 가진 맵 수
- `maps.draft` = 그중 `status='draft'` 버전을 1개 이상 가진 맵 수 (편집 중)
- `maps.trashed` = `deleted_at IS NOT NULL` 인 맵 수
- `version_status.*` = **미삭제 맵의** 버전만 status별로 센다. `expired`는 5종에 없으므로 집계하지 않는다.
- `coverage` = `dashboard_coverage_depts`의 각 org_path에 대해, 미삭제 맵 중 `belongs_to_department(map.owning_department, dept_path)`가 참인 맵을 센다 — **하위 부서 맵도 상위 부서에 귀속**. SQL prefix 매칭 대신 파이썬에서 판정한다(맵 수가 적고 규약 함수를 재사용).
- `ops.unresolved_comments` = `resolved IS FALSE` 코멘트 전체 수
- `ops.unread_notifications` = **요청자 본인** 기준 `read IS FALSE` 알림 수
- `ops.pending_checkouts` = `status='pending'` 점유 이전 요청 수
- `recent_events` = `version_events` 최신 10건

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_dashboard_metrics.py` 신규 생성:

```python
"""운영 대시보드 집계 — /summary 스냅샷, /timeseries 시계열 (design 2026-07-11)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import DashboardCoverageDept, MapVersion, ProcessMap


def _seed_map(name: str, owning_department: str, statuses: list[str]) -> int:
    """맵 1개 + 주어진 status의 버전들을 시드하고 map_id 반환."""

    async def _run() -> int:
        async with SessionLocal() as session:
            found_map = ProcessMap(
                name=name, owner_id="admin.sys", owning_department=owning_department
            )
            session.add(found_map)
            await session.flush()
            for index, status in enumerate(statuses):
                session.add(
                    MapVersion(map_id=found_map.id, label=f"v{index + 1}", status=status)
                )
            await session.commit()
            return found_map.id

    return asyncio.run(_run())


def _set_coverage(paths: list[str]) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for path in paths:
                if await session.get(DashboardCoverageDept, path) is None:
                    session.add(DashboardCoverageDept(org_path=path, added_by="admin.sys"))
            await session.commit()

    asyncio.run(_run())


def test_summary_counts_maps_and_version_status(client: TestClient) -> None:
    before = client.get("/api/dashboard/summary").json()
    _seed_map("Cov Map A", "Cov Div/Cov Office", ["published", "draft"])
    after = client.get("/api/dashboard/summary").json()

    assert after["maps"]["total"] == before["maps"]["total"] + 1
    assert after["maps"]["published"] == before["maps"]["published"] + 1
    assert after["maps"]["draft"] == before["maps"]["draft"] + 1
    assert after["version_status"]["published"] == before["version_status"]["published"] + 1
    assert after["version_status"]["draft"] == before["version_status"]["draft"] + 1


def test_coverage_counts_descendant_department_maps(client: TestClient) -> None:
    """하위 부서(Cov Div/Cov Office)의 맵이 상위 지정 부서(Cov Div)에 귀속된다."""
    _seed_map("Cov Map B", "Cov Div/Cov Office", ["published"])
    _set_coverage(["Cov Div", "Empty Div"])

    coverage = client.get("/api/dashboard/summary").json()["coverage"]
    rows = {row["org_path"]: row for row in coverage["rows"]}

    assert rows["Cov Div"]["maps"] >= 1
    assert rows["Empty Div"]["maps"] == 0
    assert "Empty Div" in [row["org_path"] for row in coverage["rows"] if row["maps"] == 0]
    assert coverage["depts_total"] >= 2
    # 커버리지 % = 맵 보유 부서 / 전체 지정 부서
    assert 0 <= coverage["coverage_pct"] <= 100


def test_coverage_pct_is_zero_when_no_depts_configured(client: TestClient) -> None:
    """지정 부서가 0개면 0으로 나누지 않고 0%."""

    async def _clear() -> None:
        from sqlalchemy import delete

        async with SessionLocal() as session:
            await session.execute(delete(DashboardCoverageDept))
            await session.commit()

    asyncio.run(_clear())
    coverage = client.get("/api/dashboard/summary").json()["coverage"]
    assert coverage["depts_total"] == 0
    assert coverage["coverage_pct"] == 0
    assert coverage["rows"] == []
```

- [ ] **Step 2: 실패를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_metrics.py -q`
Expected: FAIL — 404 (`/api/dashboard/summary` 없음)

- [ ] **Step 3: 스키마를 추가한다**

`backend/app/schemas.py`:

```python
class DashboardMapCountsOut(BaseModel):
    total: int
    published: int
    draft: int
    trashed: int


class DashboardVersionStatusOut(BaseModel):
    published: int
    draft: int
    approved: int
    pending: int
    rejected: int


class DashboardCoverageRowOut(BaseModel):
    org_path: str
    name: str  # 한글 부서명(dept_info) 없으면 리프 세그먼트
    maps: int
    published: int


class DashboardCoverageOut(BaseModel):
    depts_total: int
    depts_with_map: int
    coverage_pct: int  # 0..100, 반올림. depts_total=0이면 0
    rows: list[DashboardCoverageRowOut]


class DashboardOpsOut(BaseModel):
    unresolved_comments: int
    unread_notifications: int  # 요청자 본인 기준
    pending_checkouts: int


class DashboardEventOut(BaseModel):
    event_type: str
    map_name: str
    version_label: str
    actor_name: str
    created_at: datetime


class DashboardSummaryOut(BaseModel):
    generated_at: datetime
    maps: DashboardMapCountsOut
    version_status: DashboardVersionStatusOut
    coverage: DashboardCoverageOut
    ops: DashboardOpsOut
    recent_events: list[DashboardEventOut]
```

- [ ] **Step 4: 엔드포인트를 구현한다**

`backend/app/routers/dashboard.py`에 추가:

```python
_VERSION_STATUSES = ("published", "draft", "approved", "pending", "rejected")
_RECENT_EVENT_LIMIT = 10  # 좌측 이벤트 리스트에 담기는 최대 건수


@router.get(
    "/dashboard/summary",
    response_model=DashboardSummaryOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_dashboard_summary(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DashboardSummaryOut:
    """기간 무관 스냅샷 — 맵 현황·버전 상태·부서 커버리지·운영 항목·최근 이벤트."""
    live_maps = (
        await session.scalars(select(ProcessMap).where(ProcessMap.deleted_at.is_(None)))
    ).all()
    live_ids = [m.id for m in live_maps]
    trashed = await session.scalar(
        select(func.count()).select_from(ProcessMap).where(ProcessMap.deleted_at.is_not(None))
    )

    # 버전 status 집계 — 미삭제 맵의 버전만.
    # 맵이 하나도 없을 때 in_([])를 쓰면 SQLAlchemy가 경고를 내므로 명시적 거짓 조건(false())을 준다.
    status_rows = (
        await session.execute(
            select(MapVersion.map_id, MapVersion.status).where(
                MapVersion.map_id.in_(live_ids) if live_ids else false()
            )
        )
    ).all()
    status_counts = {status: 0 for status in _VERSION_STATUSES}
    maps_with_status: dict[str, set[int]] = {status: set() for status in _VERSION_STATUSES}
    for map_id, status in status_rows:
        if status in status_counts:
            status_counts[status] += 1
            maps_with_status[status].add(map_id)

    # 부서 커버리지 — 지정 부서별로 하위 포함 매칭 (belongs_to_department 규약)
    dept_paths = [
        row.org_path
        for row in (
            await session.scalars(
                select(DashboardCoverageDept).order_by(DashboardCoverageDept.org_path)
            )
        ).all()
    ]
    korean = {
        info.department: info.korean_name
        for info in (await session.scalars(select(DeptInfo))).all()
    }
    coverage_rows: list[DashboardCoverageRowOut] = []
    for path in dept_paths:
        owned = [
            m
            for m in live_maps
            if m.owning_department
            and belongs_to_department(m.owning_department, path)
        ]
        leaf = path.rsplit("/", maxsplit=1)[-1]
        coverage_rows.append(
            DashboardCoverageRowOut(
                org_path=path,
                name=korean.get(leaf) or leaf,
                maps=len(owned),
                published=sum(
                    1 for m in owned if m.id in maps_with_status["published"]
                ),
            )
        )
    coverage_rows.sort(key=lambda row: (-row.maps, row.org_path))
    with_map = sum(1 for row in coverage_rows if row.maps > 0)
    coverage = DashboardCoverageOut(
        depts_total=len(dept_paths),
        depts_with_map=with_map,
        coverage_pct=round(with_map / len(dept_paths) * 100) if dept_paths else 0,
        rows=coverage_rows,
    )

    ops = DashboardOpsOut(
        unresolved_comments=await session.scalar(
            select(func.count()).select_from(Comment).where(Comment.resolved.is_(False))
        )
        or 0,
        unread_notifications=await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient == login_id, Notification.read.is_(False))
        )
        or 0,
        pending_checkouts=await session.scalar(
            select(func.count())
            .select_from(CheckoutRequest)
            .where(CheckoutRequest.status == "pending")
        )
        or 0,
    )

    event_rows = (
        await session.execute(
            select(VersionEvent, MapVersion, ProcessMap)
            .join(MapVersion, MapVersion.id == VersionEvent.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .order_by(VersionEvent.created_at.desc())
            .limit(_RECENT_EVENT_LIMIT)
        )
    ).all()
    actor_names = {
        emp.login_id: emp.name
        for emp in (
            await session.scalars(
                select(Employee).where(
                    Employee.login_id.in_([event.actor for event, _, _ in event_rows])
                )
            )
        ).all()
    }
    recent_events = [
        DashboardEventOut(
            event_type=event.event_type,
            map_name=found_map.name,
            version_label=version.label,
            actor_name=actor_names.get(event.actor) or event.actor,
            created_at=event.created_at,
        )
        for event, version, found_map in event_rows
    ]

    return DashboardSummaryOut(
        generated_at=now_kst(),
        maps=DashboardMapCountsOut(
            total=len(live_maps),
            published=len(maps_with_status["published"]),
            draft=len(maps_with_status["draft"]),
            trashed=trashed or 0,
        ),
        version_status=DashboardVersionStatusOut(**status_counts),
        coverage=coverage,
        ops=ops,
        recent_events=recent_events,
    )
```

import 보강 — `from sqlalchemy import case, delete, false, func, select`, `from app.models import (..., CheckoutRequest, Comment, MapVersion, Notification, VersionEvent)`, `from app.permissions.logic import belongs_to_department`, `from app.clock import now as now_kst`(이미 있음), 그리고 위 스키마들.

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_metrics.py -q`
Expected: PASS (3 passed)

- [ ] **Step 6: 전체 게이트 + 커밋**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`

`PROGRESS.md`:

```markdown
- T4 `/summary` 스냅샷 — 맵 현황·버전 상태 분포·부서 커버리지(하위 부서 맵을 상위 지정 부서에 귀속)·운영 항목(코멘트/알림/점유요청)·최근 버전 이벤트 10건. 지정 부서 0개면 0% (0 나눗셈 차단).
```

```bash
git add backend/app/schemas.py backend/app/routers/dashboard.py backend/tests/test_dashboard_metrics.py PROGRESS.md
git commit -m "feat(dashboard): summary snapshot API — 스냅샷 집계(맵·버전·커버리지·운영)"
```

---

### Task 5: `/timeseries` 시계열 집계

**Files:**
- Modify: `backend/app/schemas.py`
- Modify: `backend/app/routers/dashboard.py`
- Test: `backend/tests/test_dashboard_metrics.py` (추가)

**Interfaces:**
- Produces: `GET /api/dashboard/timeseries?from=YYYY-MM-DD&to=YYYY-MM-DD` → `DashboardTimeseriesOut`

**규약:** `from`/`to`는 **KST 날짜**. 서버는 프리셋(7일/1개월/3개월) 개념을 모른다 — 프론트가 날짜로 환산해 보낸다. 범위의 모든 날짜를 0으로 채워 반환한다(빈 날 누락 금지). `from > to`면 422, 범위가 366일을 넘으면 422.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`backend/tests/test_dashboard_metrics.py` 끝에 추가:

```python
from datetime import timedelta

from app.clock import now as now_kst
from app.models import LoginRecord


def _date_key(value) -> str:
    return value.strftime("%Y-%m-%d")


def test_timeseries_zero_fills_and_buckets_logins(client: TestClient) -> None:
    """빈 날도 0으로 채우고, 로그인은 KST 날짜 버킷에 담긴다."""
    today = now_kst()
    start = today - timedelta(days=2)

    async def _seed() -> None:
        async with SessionLocal() as session:
            session.add(LoginRecord(login_id="ts.user"))  # 오늘
            await session.commit()

    asyncio.run(_seed())

    response = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(start), "to": _date_key(today)},
    )
    assert response.status_code == 200
    body = response.json()
    assert [point["date"] for point in body["points"]] == [
        _date_key(start),
        _date_key(start + timedelta(days=1)),
        _date_key(today),
    ]
    today_point = body["points"][-1]
    assert today_point["logins"] >= 1


def test_timeseries_rejects_inverted_and_oversized_range(client: TestClient) -> None:
    today = now_kst()
    inverted = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today), "to": _date_key(today - timedelta(days=1))},
    )
    assert inverted.status_code == 422

    oversized = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today - timedelta(days=400)), "to": _date_key(today)},
    )
    assert oversized.status_code == 422
```

- [ ] **Step 2: 실패를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_metrics.py -q -k timeseries`
Expected: FAIL — 404

- [ ] **Step 3: 스키마를 추가한다**

`backend/app/schemas.py`:

```python
class DashboardTimeseriesPointOut(BaseModel):
    date: str  # YYYY-MM-DD (KST)
    logins: int
    maps_created: int
    versions_created: int


class DashboardTimeseriesOut(BaseModel):
    from_date: str
    to_date: str
    points: list[DashboardTimeseriesPointOut]
```

- [ ] **Step 4: 엔드포인트를 구현한다**

`backend/app/routers/dashboard.py`에 추가:

```python
_MAX_RANGE_DAYS = 366  # 기간 상한 — 넘으면 422 (버킷 폭주 방지)


def _parse_date(raw: str, field: str) -> date:
    try:
        return date.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(
            status_code=422, detail=f"{field} must be YYYY-MM-DD, got {raw!r}"
        ) from exc


@router.get(
    "/dashboard/timeseries",
    response_model=DashboardTimeseriesOut,
    dependencies=[Depends(require_dashboard_viewer)],
)
async def get_dashboard_timeseries(
    from_: str = Query(alias="from"),
    to: str = Query(),
    session: AsyncSession = Depends(get_session),
) -> DashboardTimeseriesOut:
    """일별 로그인·맵 생성·버전 생성 (KST 날짜 버킷). 빈 날은 0으로 채운다."""
    start = _parse_date(from_, "from")
    end = _parse_date(to, "to")
    if start > end:
        raise HTTPException(status_code=422, detail="from must be on or before to")
    span = (end - start).days + 1
    if span > _MAX_RANGE_DAYS:
        raise HTTPException(
            status_code=422, detail=f"range must be {_MAX_RANGE_DAYS} days or fewer, got {span}"
        )

    # 경계 — [start 00:00, end+1일 00:00). 저장 시각이 KST이므로 그대로 비교한다.
    lower = datetime.combine(start, time.min)
    upper = datetime.combine(end + timedelta(days=1), time.min)

    buckets: dict[str, dict[str, int]] = {
        (start + timedelta(days=offset)).isoformat(): {
            "logins": 0,
            "maps_created": 0,
            "versions_created": 0,
        }
        for offset in range(span)
    }

    async def _tally(column, key: str) -> None:
        for (occurred,) in (
            await session.execute(select(column).where(column >= lower, column < upper))
        ).all():
            bucket = buckets.get(occurred.date().isoformat())
            if bucket is not None:
                bucket[key] += 1

    await _tally(LoginRecord.occurred_at, "logins")
    await _tally(ProcessMap.created_at, "maps_created")
    await _tally(MapVersion.created_at, "versions_created")

    return DashboardTimeseriesOut(
        from_date=start.isoformat(),
        to_date=end.isoformat(),
        points=[
            DashboardTimeseriesPointOut(date=day, **counts)
            for day, counts in buckets.items()
        ],
    )
```

import 보강 — `from datetime import date, datetime, time, timedelta`, `from fastapi import APIRouter, Depends, HTTPException, Query`.

- [ ] **Step 5: 테스트 통과를 확인한다**

Run: `.venv/bin/python -m pytest tests/test_dashboard_metrics.py -q`
Expected: PASS (5 passed)

- [ ] **Step 6: 전체 게이트 + 커밋**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`

`PROGRESS.md`:

```markdown
- T5 `/timeseries` — 일별 로그인·맵 생성·버전 생성(KST 버킷, 빈 날 0 채움). from>to·366일 초과는 422. 프리셋 환산은 프론트 책임.
```

```bash
git add backend/app/schemas.py backend/app/routers/dashboard.py backend/tests/test_dashboard_metrics.py PROGRESS.md
git commit -m "feat(dashboard): timeseries API — 일별 시계열 집계(KST 버킷·범위 검증)"
```

---

### Task 6: 프론트 순수 함수 + API 바인딩 + i18n

**Files:**
- Create: `frontend/src/lib/dashboard-chart.ts`
- Create: `frontend/src/lib/dashboard-chart.test.ts`
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/lib/current-user.ts`
- Modify: `frontend/src/components/providers.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 2~5의 API
- Produces: `buildScale(values, tickCount?) → { max, ticks }`, `resolvePeriod(preset, todayKey) → { from, to }`, `todayKeyKst() → string`, `getDashboardSummary()`, `getDashboardTimeseries(from, to)`, `listDashboardPermissions()`, `addDashboardPermission(type, id)`, `deleteDashboardPermission(id)`, `getCoverageDepts()`, `setCoverageDepts(paths)`, `CurrentUser.canViewDashboard`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`frontend/src/lib/dashboard-chart.test.ts` 신규:

```ts
import { describe, expect, it } from "vitest";

import { buildScale, resolvePeriod, todayKeyKst } from "./dashboard-chart";

describe("buildScale", () => {
  it("올림한 nice max와 균등 틱을 만든다", () => {
    const scale = buildScale([3, 7, 12], 4);
    expect(scale.max).toBe(20);
    expect(scale.ticks).toEqual([0, 5, 10, 15, 20]);
  });

  it("전부 0이면 max를 1로 둬 0 나눗셈을 막는다", () => {
    const scale = buildScale([0, 0], 4);
    expect(scale.max).toBe(1);
    expect(scale.ticks[0]).toBe(0);
  });

  it("빈 배열도 안전하다", () => {
    expect(buildScale([], 4).max).toBe(1);
  });
});

describe("resolvePeriod", () => {
  it("7일은 오늘 포함 7일 창을 만든다", () => {
    expect(resolvePeriod("7d", "2026-07-11")).toEqual({
      from: "2026-07-05",
      to: "2026-07-11",
    });
  });

  it("1개월은 30일, 3개월은 90일 창", () => {
    expect(resolvePeriod("1m", "2026-07-11").from).toBe("2026-06-12");
    expect(resolvePeriod("3m", "2026-07-11").from).toBe("2026-04-13");
  });

  it("월 경계를 넘어도 정확하다", () => {
    expect(resolvePeriod("7d", "2026-03-02")).toEqual({
      from: "2026-02-24",
      to: "2026-03-02",
    });
  });
});

describe("todayKeyKst", () => {
  it("KST 기준 YYYY-MM-DD를 만든다 — 브라우저 tz와 무관", () => {
    // UTC 2026-07-11T20:00Z = KST 2026-07-12 05:00 → 날짜키는 07-12
    expect(todayKeyKst(new Date("2026-07-11T20:00:00Z"))).toBe("2026-07-12");
    expect(todayKeyKst(new Date("2026-07-11T10:00:00Z"))).toBe("2026-07-11");
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run src/lib/dashboard-chart.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: 순수 함수를 구현한다**

`frontend/src/lib/dashboard-chart.ts` 신규:

```ts
// 대시보드 차트 순수 계산 — 축 스케일/틱, 기간 프리셋→KST 날짜범위. DOM·fetch 미접근.

export interface ChartScale {
  max: number;
  ticks: number[];
}

// nice 단계 — 1·2·5 × 10^n 사다리로 올림해 축 눈금을 읽기 좋게 만든다.
const NICE_STEPS = [1, 2, 5];

/** 데이터 최댓값을 nice한 상한으로 올리고 균등 틱을 만든다. 전부 0이면 max=1(0 나눗셈 차단). */
export function buildScale(values: number[], tickCount = 4): ChartScale {
  const peak = Math.max(0, ...values);
  if (peak <= 0) {
    return { max: 1, ticks: [0, 1] };
  }
  const rough = peak / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    (NICE_STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude;
  const max = step * tickCount;
  const ticks = Array.from({ length: tickCount + 1 }, (_, index) => index * step);
  return { max, ticks };
}

export type PeriodPreset = "7d" | "1m" | "3m";

export interface DateRange {
  from: string; // YYYY-MM-DD (KST)
  to: string;
}

// 프리셋 → 오늘 포함 창의 길이(일). 서버는 프리셋을 모르고 날짜만 받는다.
const PRESET_DAYS: Record<PeriodPreset, number> = { "7d": 7, "1m": 30, "3m": 90 };

/** KST 날짜키(YYYY-MM-DD) — 브라우저 tz와 무관하게 Asia/Seoul 기준. */
export function todayKeyKst(now: Date = new Date()): string {
  // en-CA 로케일이 ISO 형태(YYYY-MM-DD)를 준다 — 수동 포맷보다 tz 처리가 안전하다.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** 날짜키에서 n일 뺀 날짜키. UTC 기준으로 더해 DST·tz 이동의 영향을 받지 않는다. */
function shiftDays(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** 프리셋 → 날짜 범위(오늘 포함). 예: 7d + 2026-07-11 → 2026-07-05 ~ 2026-07-11 */
export function resolvePeriod(preset: PeriodPreset, todayKey: string): DateRange {
  return { from: shiftDays(todayKey, -(PRESET_DAYS[preset] - 1)), to: todayKey };
}
```

- [ ] **Step 4: 테스트 통과를 확인한다**

Run: `npx vitest run src/lib/dashboard-chart.test.ts`
Expected: PASS

- [ ] **Step 5: API 바인딩을 추가한다**

`frontend/src/lib/api.ts` — 기존 `getAiUsage` 아래에 추가:

```ts
export interface DashboardMapCounts {
  total: number;
  published: number;
  draft: number;
  trashed: number;
}

export interface DashboardVersionStatus {
  published: number;
  draft: number;
  approved: number;
  pending: number;
  rejected: number;
}

export interface DashboardCoverageRow {
  org_path: string;
  name: string;
  maps: number;
  published: number;
}

export interface DashboardCoverage {
  depts_total: number;
  depts_with_map: number;
  coverage_pct: number;
  rows: DashboardCoverageRow[];
}

export interface DashboardOps {
  unresolved_comments: number;
  unread_notifications: number;
  pending_checkouts: number;
}

export interface DashboardEvent {
  event_type: string;
  map_name: string;
  version_label: string;
  actor_name: string;
  created_at: string;
}

export interface DashboardSummary {
  generated_at: string;
  maps: DashboardMapCounts;
  version_status: DashboardVersionStatus;
  coverage: DashboardCoverage;
  ops: DashboardOps;
  recent_events: DashboardEvent[];
}

export interface DashboardTimeseriesPoint {
  date: string;
  logins: number;
  maps_created: number;
  versions_created: number;
}

export interface DashboardTimeseries {
  from_date: string;
  to_date: string;
  points: DashboardTimeseriesPoint[];
}

export interface DashboardPermission {
  id: number;
  principal_type: PrincipalType;
  principal_id: string;
  display_name: string;
  granted_by: string;
  granted_at: string;
}

/** 기간 무관 스냅샷 — 맵·버전·커버리지·운영·최근 이벤트. */
export function getDashboardSummary(): Promise<DashboardSummary> {
  return request<DashboardSummary>("/dashboard/summary");
}

/** 일별 시계열 — from/to는 KST 날짜키(YYYY-MM-DD). */
export function getDashboardTimeseries(
  from: string,
  to: string,
): Promise<DashboardTimeseries> {
  return request<DashboardTimeseries>(
    `/dashboard/timeseries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
}

export function listDashboardPermissions(): Promise<DashboardPermission[]> {
  return request<DashboardPermission[]>("/dashboard/permissions");
}

export function addDashboardPermission(
  principalType: PrincipalType,
  principalId: string,
): Promise<DashboardPermission> {
  return request<DashboardPermission>("/dashboard/permissions", {
    method: "POST",
    body: JSON.stringify({ principal_type: principalType, principal_id: principalId }),
  });
}

export function deleteDashboardPermission(permissionId: number): Promise<void> {
  return request<void>(`/dashboard/permissions/${permissionId}`, { method: "DELETE" });
}

export function getCoverageDepts(): Promise<string[]> {
  return request<{ org_paths: string[] }>("/dashboard/coverage-depts").then(
    (body) => body.org_paths,
  );
}

/** 목록 통째 교체 — 멱등. 항상 전체 목록을 보낸다. */
export function setCoverageDepts(orgPaths: string[]): Promise<string[]> {
  return request<{ org_paths: string[] }>("/dashboard/coverage-depts", {
    method: "PUT",
    body: JSON.stringify({ org_paths: orgPaths }),
  }).then((body) => body.org_paths);
}
```

`PrincipalType`이 `api.ts`에 이미 있는지 확인하고(맵 권한에서 사용), 없으면 `export type PrincipalType = "user" | "department" | "group";`를 추가한다.

`MeResponse`(또는 `getMe`의 반환 타입) 인터페이스에 `can_view_dashboard: boolean;`을 추가한다.

- [ ] **Step 6: CurrentUser에 플래그를 흘린다**

`frontend/src/lib/current-user.ts`의 `CurrentUser` 인터페이스에 추가:

```ts
  // 서버(/api/me)가 산정한 대시보드 열람 가능 여부 — 설정 탭 노출 게이팅
  canViewDashboard: boolean;
```

`frontend/src/components/providers.tsx`의 `setCurrentUser({...})` 호출에 추가:

```ts
      canViewDashboard: me.can_view_dashboard ?? false,
```

- [ ] **Step 7: i18n 키를 추가한다**

`frontend/src/lib/i18n-messages.ts` — **en 블록**의 기존 `dashboard.*` 키 근처(958번 줄 인근)와 **ko 블록**(2291번 줄 인근) 양쪽에 넣는다. 기존 `dashboard.openCard`/`dashboard.openCardDesc`/`dashboard.comingSoonNote`/`dashboard.metricsComingSoon`은 진입 카드 제거로 쓰이지 않게 되므로 **삭제**한다(Task 8에서 참조가 사라지는 것을 확인한 뒤 지운다).

en:

```ts
  "dashboard.opsTitle": "Operations",
  "dashboard.mapsTotal": "All maps",
  "dashboard.mapsPublished": "Published",
  "dashboard.mapsDraft": "In progress",
  "dashboard.mapsTrashed": "Trash",
  "dashboard.opsComments": "Open comments",
  "dashboard.opsNotifications": "Unread notifications (you)",
  "dashboard.opsCheckouts": "Checkout transfer requests",
  "dashboard.activityTitle": "Login & activity",
  "dashboard.growthTitle": "Cumulative growth",
  "dashboard.growthMaps": "Maps created",
  "dashboard.growthVersions": "Versions created",
  "dashboard.versionStatusTitle": "Version status",
  "dashboard.coverageTitle": "Adoption by department",
  "dashboard.coverageSummary": "{withMap} of {total} departments have a map ({pct}%)",
  "dashboard.coverageEmpty": "No departments selected yet — pick them in the Coverage tab.",
  "dashboard.coverageMissing": "No map yet",
  "dashboard.eventsTitle": "Recent version events",
  "dashboard.eventsEmpty": "No version events yet.",
  "dashboard.snapshotNote": "Current state — not affected by the period filter.",
  "dashboard.period7d": "7 days",
  "dashboard.period1m": "1 month",
  "dashboard.period3m": "3 months",
  "dashboard.periodCustom": "Custom",
  "dashboard.periodFrom": "From",
  "dashboard.periodTo": "To",
  "dashboard.sidebarAccess": "Access",
  "dashboard.sidebarCoverage": "Coverage",
  "dashboard.accessDesc": "People, departments, and groups that can open this dashboard. System admins always can.",
  "dashboard.accessAdd": "Grant access",
  "dashboard.accessEmpty": "No grants yet — only system admins can open the dashboard.",
  "dashboard.accessRemove": "Remove access",
  "dashboard.coverageDesc": "Departments counted in the adoption coverage denominator. Applies to everyone.",
  "dashboard.coverageAdd": "Add department",
  "dashboard.coverageSaved": "Coverage departments saved.",
  "dashboard.principalUser": "Person",
  "dashboard.principalDepartment": "Department",
  "dashboard.principalGroup": "Group",
  "dashboard.loadFailed": "Could not load dashboard metrics.",
```

ko(같은 키, 한국어 값):

```ts
  "dashboard.opsTitle": "운영 현황",
  "dashboard.mapsTotal": "전체 맵",
  "dashboard.mapsPublished": "게시본",
  "dashboard.mapsDraft": "편집 중",
  "dashboard.mapsTrashed": "휴지통",
  "dashboard.opsComments": "미해결 코멘트",
  "dashboard.opsNotifications": "미읽음 알림 (본인)",
  "dashboard.opsCheckouts": "점유 이전 요청",
  "dashboard.activityTitle": "로그인·활동 추이",
  "dashboard.growthTitle": "누적 성장 추이",
  "dashboard.growthMaps": "맵 생성",
  "dashboard.growthVersions": "버전 생성",
  "dashboard.versionStatusTitle": "버전 상태 분포",
  "dashboard.coverageTitle": "부서별 도입 현황",
  "dashboard.coverageSummary": "전체 {total}개 부서 중 {withMap}개가 맵 보유 ({pct}%)",
  "dashboard.coverageEmpty": "지정된 부서가 없습니다 — Coverage 탭에서 선택하세요.",
  "dashboard.coverageMissing": "맵 없음",
  "dashboard.eventsTitle": "최근 버전 이벤트",
  "dashboard.eventsEmpty": "버전 이벤트가 없습니다.",
  "dashboard.snapshotNote": "현재 기준 — 기간 필터의 영향을 받지 않습니다.",
  "dashboard.period7d": "7일",
  "dashboard.period1m": "1개월",
  "dashboard.period3m": "3개월",
  "dashboard.periodCustom": "직접 지정",
  "dashboard.periodFrom": "시작",
  "dashboard.periodTo": "종료",
  "dashboard.sidebarAccess": "접근 권한",
  "dashboard.sidebarCoverage": "커버리지",
  "dashboard.accessDesc": "이 대시보드를 열 수 있는 인원·부서·그룹입니다. 시스템 관리자는 항상 가능합니다.",
  "dashboard.accessAdd": "권한 부여",
  "dashboard.accessEmpty": "부여된 권한이 없습니다 — 시스템 관리자만 열 수 있습니다.",
  "dashboard.accessRemove": "권한 제거",
  "dashboard.coverageDesc": "도입 커버리지 분모에 포함되는 부서입니다. 전원에게 동일 적용됩니다.",
  "dashboard.coverageAdd": "부서 추가",
  "dashboard.coverageSaved": "커버리지 부서를 저장했습니다.",
  "dashboard.principalUser": "인원",
  "dashboard.principalDepartment": "부서",
  "dashboard.principalGroup": "그룹",
  "dashboard.loadFailed": "대시보드 지표를 불러오지 못했습니다.",
```

> UI 문구는 영어가 기본이므로 실제 화면에는 en 값이 뜬다. ko는 로케일 전환 시 쓰인다.

- [ ] **Step 8: 게이트 + 커밋**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전부 PASS, 타입 에러 0. (아직 `canViewDashboard`를 안 읽는 컴포넌트가 있어도 무방 — 필드 추가는 타입 확장이다.)

`PROGRESS.md`:

```markdown
- T6 프론트 기반 — `lib/dashboard-chart.ts` 순수 함수(nice 스케일·프리셋→KST 날짜범위·todayKeyKst, vitest 8케이스), api.ts 대시보드 바인딩 8종, `CurrentUser.canViewDashboard`, i18n 키 en/ko.
```

```bash
git add frontend/src/lib/dashboard-chart.ts frontend/src/lib/dashboard-chart.test.ts frontend/src/lib/api.ts frontend/src/lib/current-user.ts frontend/src/components/providers.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(dashboard): chart math, API bindings, i18n — 차트 순수함수·API 바인딩·i18n"
```

---

### Task 7: 차트 컴포넌트 5종

**Files:**
- Create: `frontend/src/components/dashboard/stat-card.tsx`
- Create: `frontend/src/components/dashboard/bar-chart.tsx`
- Create: `frontend/src/components/dashboard/line-chart.tsx`
- Create: `frontend/src/components/dashboard/hbar-list.tsx`
- Create: `frontend/src/components/dashboard/period-filter.tsx`

**Interfaces:**
- Consumes: `buildScale`, `resolvePeriod`, `todayKeyKst`, `PeriodPreset`, `DateRange` (Task 6)
- Produces:
  - `<StatCard label={string} value={string} hint?={string} tone?={"default" | "accent"} />`
  - `<BarChart points={{ label: string; value: number }[]} />`
  - `<LineChart series={{ label: string; color: string; values: number[] }[]} labels={string[]} />` — `color`는 `var(--color-*)` 문자열
  - `<HBarList rows={{ label: string; value: number; hint?: string; tone?: string }[]} />` — `tone`은 CSS 변수 문자열
  - `<PeriodFilter range={DateRange} onChange={(range: DateRange) => void} />`

- [ ] **Step 1: StatCard**

`frontend/src/components/dashboard/stat-card.tsx`:

```tsx
// 좌 레일 요약 스탯 — 라벨·큰 값·보조 설명. 값이 아직 없으면 "—".

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      data-id="dashboard-stat-card"
      className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-4 py-3"
    >
      <span className="text-fine uppercase tracking-wide text-ink-tertiary">{label}</span>
      <span
        className={`text-tagline ${tone === "accent" ? "text-accent" : "text-ink"}`}
      >
        {value}
      </span>
      {hint ? <span className="text-fine text-ink-tertiary">{hint}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: BarChart**

`frontend/src/components/dashboard/bar-chart.tsx`:

```tsx
// 시계열 세로 막대 — 값 비례 높이, 최댓값 막대만 액센트. SVG 없이 flex + 높이 %로 그린다.

import { buildScale } from "@/lib/dashboard-chart";

export interface BarPoint {
  label: string; // 툴팁·접근성용 (예: 2026-07-11)
  value: number;
}

export function BarChart({ points }: { points: BarPoint[] }) {
  const scale = buildScale(points.map((point) => point.value));
  const peak = Math.max(0, ...points.map((point) => point.value));

  return (
    <div data-id="dashboard-bar-chart" className="flex h-40 items-end gap-1.5">
      {points.map((point) => {
        const ratio = point.value / scale.max;
        return (
          <div
            key={point.label}
            title={`${point.label} · ${point.value}`}
            className="flex flex-1 items-end"
            style={{ height: "100%" }}
          >
            <div
              className="w-full rounded-sm transition-[height] duration-350 ease-smooth"
              style={{
                // 0건도 흔적을 남겨야 "빈 날"이 읽힌다 — 최소 2%
                height: `${Math.max(ratio * 100, 2)}%`,
                backgroundColor:
                  point.value === peak && peak > 0
                    ? "var(--color-accent)"
                    : "var(--color-accent-tint)",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: LineChart**

`frontend/src/components/dashboard/line-chart.tsx`:

```tsx
// 누적 성장 라인 — 자체 SVG. viewBox 100×40 정규화 좌표로 그리고 CSS가 늘린다.

import { buildScale } from "@/lib/dashboard-chart";

export interface LineSeries {
  label: string;
  color: string; // "var(--color-accent)" 같은 토큰 참조
  values: number[];
}

const VIEW_W = 100;
const VIEW_H = 40;

function toPath(values: number[], max: number): string {
  if (values.length === 0) return "";
  const step = values.length > 1 ? VIEW_W / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const x = index * step;
      const y = VIEW_H - (value / max) * VIEW_H;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function LineChart({
  series,
  labels,
}: {
  series: LineSeries[];
  labels: string[];
}) {
  const scale = buildScale(series.flatMap((line) => line.values));

  return (
    <div data-id="dashboard-line-chart" className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-32 w-full"
        role="img"
        aria-label={series.map((line) => line.label).join(", ")}
      >
        {series.map((line) => (
          <path
            key={line.label}
            d={toPath(line.values, scale.max)}
            fill="none"
            stroke={line.color}
            strokeWidth={0.8}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <div className="flex items-center justify-between text-fine text-ink-tertiary">
        <span>{labels[0] ?? ""}</span>
        <span className="flex gap-3">
          {series.map((line) => (
            <span key={line.label} className="flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-3 rounded-sm"
                style={{ backgroundColor: line.color }}
              />
              {line.label}
            </span>
          ))}
        </span>
        <span>{labels[labels.length - 1] ?? ""}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: HBarList**

`frontend/src/components/dashboard/hbar-list.tsx`:

```tsx
// 가로 막대 리스트 — 버전 상태 분포와 부서 커버리지가 공유. 라벨·막대·값 3열.

export interface HBarRow {
  label: string;
  value: number;
  hint?: string; // 값 우측 보조 표기(예: "게시 3")
  tone?: string; // 막대 색 — "var(--color-*)" 문자열. 미지정 시 액센트
}

export function HBarList({ rows }: { rows: HBarRow[] }) {
  const peak = Math.max(1, ...rows.map((row) => row.value)); // 0 나눗셈 차단

  return (
    <ul data-id="dashboard-hbar-list" className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-caption text-ink-secondary">
            {row.label}
          </span>
          <span className="h-2 flex-1 rounded-sm bg-surface-alt">
            <span
              className="block h-full rounded-sm"
              style={{
                width: `${(row.value / peak) * 100}%`,
                backgroundColor: row.tone ?? "var(--color-accent)",
              }}
            />
          </span>
          <span className="w-24 shrink-0 text-right text-caption-strong tabular-nums text-ink">
            {row.value.toLocaleString()}
            {row.hint ? (
              <span className="ml-1.5 text-fine text-ink-tertiary">{row.hint}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: PeriodFilter**

`frontend/src/components/dashboard/period-filter.tsx`:

```tsx
"use client";

// 기간 선택 — 프리셋 3종 + 달력 직접 지정. 시계열 섹션에만 걸린다(스냅샷은 무관).

import { useState } from "react";

import {
  resolvePeriod,
  todayKeyKst,
  type DateRange,
  type PeriodPreset,
} from "@/lib/dashboard-chart";
import { useI18n } from "@/lib/i18n";

const PRESETS: { id: PeriodPreset; labelKey: "dashboard.period7d" | "dashboard.period1m" | "dashboard.period3m" }[] = [
  { id: "7d", labelKey: "dashboard.period7d" },
  { id: "1m", labelKey: "dashboard.period1m" },
  { id: "3m", labelKey: "dashboard.period3m" },
];

export function PeriodFilter({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const today = todayKeyKst();

  // 현재 range가 어느 프리셋과 일치하는지 — 활성 표시용
  const activePreset = PRESETS.find(
    (preset) => {
      const resolved = resolvePeriod(preset.id, today);
      return resolved.from === range.from && resolved.to === range.to;
    },
  )?.id;

  return (
    <div data-id="dashboard-period-filter" className="flex items-center gap-1.5">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => {
            setCustom(false);
            onChange(resolvePeriod(preset.id, today));
          }}
          className={`rounded-sm px-2.5 py-1 text-fine transition-colors ${
            !custom && activePreset === preset.id
              ? "bg-accent text-on-accent"
              : "border border-hairline text-ink-secondary hover:bg-surface-alt"
          }`}
        >
          {t(preset.labelKey)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCustom((prev) => !prev)}
        className={`rounded-sm px-2.5 py-1 text-fine transition-colors ${
          custom
            ? "bg-accent text-on-accent"
            : "border border-hairline text-ink-secondary hover:bg-surface-alt"
        }`}
      >
        {t("dashboard.periodCustom")}
      </button>
      {custom ? (
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => onChange({ ...range, from: event.target.value })}
            aria-label={t("dashboard.periodFrom")}
            className="rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink"
          />
          <span className="text-fine text-ink-tertiary">–</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(event) => onChange({ ...range, to: event.target.value })}
            aria-label={t("dashboard.periodTo")}
            className="rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink"
          />
        </span>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: 게이트 + 커밋**

Run: `npx tsc --noEmit && npm run lint`
Expected: 타입 에러 0, lint 신규 경고 0. (컴포넌트가 아직 어디서도 import되지 않아 "unused"로 잡히지 않는지 확인 — export만 있으면 문제없다.)

`PROGRESS.md`:

```markdown
- T7 차트 컴포넌트 — StatCard·BarChart(값 비례 막대, 최댓값 액센트)·LineChart(자체 SVG viewBox)·HBarList(버전상태·커버리지 공용)·PeriodFilter(프리셋 3종+달력). 라이브러리 무추가, 색은 전부 토큰.
```

```bash
git add frontend/src/components/dashboard/ PROGRESS.md
git commit -m "feat(dashboard): SVG/CSS chart components — 자체 차트 컴포넌트 5종"
```

---

### Task 8: 대시보드 패널 재작성 + 풀블리드 레이아웃 교체

**Files:**
- Rewrite: `frontend/src/components/settings/dashboard-panel.tsx`
- Modify: `frontend/src/app/settings/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (사용처가 사라진 키 삭제)

**Interfaces:**
- Consumes: Task 6의 API 바인딩·`CurrentUser.canViewDashboard`, Task 7의 컴포넌트
- Produces: `<DashboardPanel onBack={() => void} />` — 우측 사이드바 슬롯은 Task 9에서 채운다

- [ ] **Step 1: 설정 탭 게이팅을 바꾼다**

`frontend/src/app/settings/page.tsx`:

`Access` 타입에 `"dashboard"`를 더한다:

```ts
type Access = "everyone" | "admin" | "sysadmin" | "dashboard";
```

Analytics 카테고리의 `access`를 바꾼다:

```ts
  {
    labelKey: "admin.catAnalytics",
    access: "dashboard",
    tabs: [{ id: "dashboard", labelKey: "dashboard.tab" }],
  },
```

`canAccess`에 분기를 더한다:

```ts
  const canAccess = (access: Access): boolean => {
    if (access === "everyone") return true;
    // 대시보드는 sysadmin 외에 dashboard_permissions로 부여된 인원·부서·그룹도 열람 (design 2026-07-11)
    if (access === "dashboard") return Boolean(user?.canViewDashboard);
    // admin 권한은 시스템 관리자(sysadmin)가 흡수 (F6) — admin/sysadmin 모두 sysadmin 게이트.
    return Boolean(user?.isSysadmin);
  };
```

- [ ] **Step 2: 풀블리드 레이아웃으로 교체한다**

같은 파일 — `return (...)` 최상단에서 Dashboard 탭일 때는 탭 레일을 그리지 않고 대시보드를 전체 폭으로 렌더한다. `ToastStack` 아래, `<div className="flex h-full">` 앞에 분기를 넣는다:

```tsx
  // Dashboard 탭은 설정 탭 레일을 대시보드 전용 풀블리드 레이아웃으로 교체한다 —
  // 좌측 레일까지 지표로 쓰기 위해서(design 2026-07-11). 복귀는 패널의 '설정으로 돌아가기'.
  if (current === "dashboard") {
    return (
      <>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <DashboardPanel
          onBack={() => setActiveTab(allTabs.find((tab) => tab.id !== "dashboard")?.id ?? null)}
        />
      </>
    );
  }
```

> `onBack`은 대시보드가 아닌 첫 가용 탭으로 돌아간다. 대시보드가 유일한 가시 탭인 사용자(권한만 받은 비-sysadmin)에게는 `null`이 되어 폴백이 다시 대시보드를 고르므로, 그 경우 **뒤로가기 버튼을 감춘다** — 아래 패널이 `onBack`을 받지 않으면(undefined) 버튼을 렌더하지 않는다.

따라서 분기를 다음처럼 쓴다:

```tsx
  if (current === "dashboard") {
    const fallbackTab = allTabs.find((tab) => tab.id !== "dashboard")?.id;
    return (
      <>
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        <DashboardPanel
          onBack={fallbackTab ? () => setActiveTab(fallbackTab) : undefined}
          onToast={(message) => showToast({ id: genId(), message })}
        />
      </>
    );
  }
```

기존 `{current === "dashboard" && <DashboardPanel />}` 줄은 `<main>`에서 **삭제**한다.

- [ ] **Step 3: 패널을 재작성한다**

`frontend/src/components/settings/dashboard-panel.tsx` 전체 교체:

```tsx
"use client";

// 운영 대시보드 — 풀블리드 3열(좌 요약 레일 · 중앙 지표 · 우 Access/Coverage 사이드바).
// 스냅샷(/summary)과 시계열(/timeseries)을 분리 조회 — 기간 필터는 시계열만 재조회한다.
// (design 2026-07-11)

import { ArrowLeft, Info } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

import { AccessSidebar } from "@/components/dashboard/access-sidebar";
import { BarChart } from "@/components/dashboard/bar-chart";
import { HBarList } from "@/components/dashboard/hbar-list";
import { LineChart } from "@/components/dashboard/line-chart";
import { PeriodFilter } from "@/components/dashboard/period-filter";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  getAiUsage,
  getDashboardSummary,
  getDashboardTimeseries,
  type AiUsageMetrics,
  type DashboardSummary,
  type DashboardTimeseries,
} from "@/lib/api";
import { getCurrentUser, subscribeCurrentUser } from "@/lib/current-user";
import { resolvePeriod, todayKeyKst, type DateRange } from "@/lib/dashboard-chart";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

// 버전 상태별 막대 색 — 반드시 globals.css @theme에 실재하는 토큰만 쓴다(Step 0에서 확인).
// 없는 토큰을 참조하면 CSS 변수가 빈 값이 되어 막대가 투명해진다. raw hex 도입 금지.
const STATUS_TONES: Record<string, string> = {
  published: "var(--color-accent)",
  approved: "var(--color-accent)",
  pending: "var(--color-ink-secondary)",
  draft: "var(--color-ink-tertiary)",
  rejected: "var(--color-error)",
};

export function DashboardPanel({
  onBack,
  onToast,
}: {
  onBack?: () => void;
  onToast?: (message: string) => void;
}) {
  const { t } = useI18n();
  const user = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, () => null);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [series, setSeries] = useState<DashboardTimeseries | null>(null);
  const [aiUsage, setAiUsage] = useState<AiUsageMetrics | null>(null);
  const [range, setRange] = useState<DateRange>(() => resolvePeriod("7d", todayKeyKst()));
  const [failed, setFailed] = useState(false);

  // 스냅샷 — 마운트 1회. 기간 필터와 무관하다.
  useEffect(() => {
    let alive = true;
    getDashboardSummary()
      .then((data) => {
        if (alive) setSummary(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 시계열 — 기간이 바뀔 때만 재조회.
  useEffect(() => {
    let alive = true;
    getDashboardTimeseries(range.from, range.to)
      .then((data) => {
        if (alive) setSeries(data);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [range.from, range.to]);

  // AI 사용량 — sysadmin 전용 엔드포인트라 sysadmin일 때만 조회한다(아니면 403).
  useEffect(() => {
    if (!user?.isSysadmin) return;
    let alive = true;
    getAiUsage()
      .then((data) => {
        if (alive) setAiUsage(data);
      })
      .catch(() => {
        /* AI 사용량은 비핵심 — 실패해도 대시보드는 뜬다 */
      });
    return () => {
      alive = false;
    };
  }, [user?.isSysadmin]);

  const count = (value: number | undefined) =>
    value === undefined ? "—" : value.toLocaleString();

  const points = series?.points ?? [];

  return (
    <div data-id="dashboard" className="flex h-full">
      {/* 좌 요약 레일 — 설정 탭 레일 자리를 대신한다 */}
      <aside className="flex w-64 shrink-0 flex-col gap-4 border-r border-hairline bg-surface p-4">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex w-fit items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
          >
            <ArrowLeft size={16} strokeWidth={1.5} />
            {t("dashboard.back")}
          </button>
        ) : null}

        <div>
          <h1 className="text-body-strong text-ink">{t("dashboard.opsTitle")}</h1>
          <p className="mt-0.5 text-fine text-ink-tertiary">
            {summary ? formatKstShort(summary.generated_at) : "—"}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <StatCard label={t("dashboard.mapsTotal")} value={count(summary?.maps.total)} />
          <StatCard
            label={t("dashboard.mapsPublished")}
            value={count(summary?.maps.published)}
            tone="accent"
          />
          <div className="grid grid-cols-2 gap-2">
            <StatCard label={t("dashboard.mapsDraft")} value={count(summary?.maps.draft)} />
            <StatCard label={t("dashboard.mapsTrashed")} value={count(summary?.maps.trashed)} />
          </div>
        </div>

        <ul className="mt-auto flex flex-col gap-1.5 border-t border-hairline pt-3">
          {[
            { key: "dashboard.opsComments" as const, value: summary?.ops.unresolved_comments },
            {
              key: "dashboard.opsNotifications" as const,
              value: summary?.ops.unread_notifications,
            },
            { key: "dashboard.opsCheckouts" as const, value: summary?.ops.pending_checkouts },
          ].map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-fine text-ink-tertiary">{t(row.key)}</span>
              <span className="shrink-0 text-caption-strong tabular-nums text-ink">
                {count(row.value)}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      {/* 중앙 지표 그리드 */}
      <main className="flex-1 overflow-y-auto bg-canvas p-6">
        {failed ? (
          <p className="flex items-center gap-1.5 pb-4 text-caption text-error">
            <Info size={16} strokeWidth={1.5} />
            {t("dashboard.loadFailed")}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <section
            data-id="dashboard-activity"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <div className="flex items-center justify-between gap-4 pb-4">
              <h2 className="text-body-strong text-ink">{t("dashboard.activityTitle")}</h2>
              <PeriodFilter range={range} onChange={setRange} />
            </div>
            <BarChart
              points={points.map((point) => ({ label: point.date, value: point.logins }))}
            />
          </section>

          <section
            data-id="dashboard-growth"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.growthTitle")}</h2>
            <LineChart
              labels={points.map((point) => point.date)}
              series={[
                {
                  label: t("dashboard.growthMaps"),
                  color: "var(--color-accent)",
                  values: points.map((point) => point.maps_created),
                },
                {
                  label: t("dashboard.growthVersions"),
                  color: "var(--color-ink-tertiary)",
                  values: points.map((point) => point.versions_created),
                },
              ]}
            />
          </section>

          <div className="grid grid-cols-2 gap-4">
            <section
              data-id="dashboard-version-status"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-1 text-body-strong text-ink">
                {t("dashboard.versionStatusTitle")}
              </h2>
              <p className="pb-4 text-fine text-ink-tertiary">{t("dashboard.snapshotNote")}</p>
              <HBarList
                rows={Object.entries(summary?.version_status ?? {}).map(([status, value]) => ({
                  label: status,
                  value,
                  tone: STATUS_TONES[status],
                }))}
              />
            </section>

            <section
              data-id="dashboard-coverage"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-1 text-body-strong text-ink">{t("dashboard.coverageTitle")}</h2>
              {summary && summary.coverage.depts_total === 0 ? (
                <p className="pt-3 text-caption text-ink-tertiary">
                  {t("dashboard.coverageEmpty")}
                </p>
              ) : (
                <>
                  <p className="pb-4 text-fine text-ink-tertiary">
                    {summary
                      ? t("dashboard.coverageSummary", {
                          withMap: summary.coverage.depts_with_map,
                          total: summary.coverage.depts_total,
                          pct: summary.coverage.coverage_pct,
                        })
                      : ""}
                  </p>
                  <HBarList
                    rows={(summary?.coverage.rows ?? []).map((row) => ({
                      label: row.name,
                      value: row.maps,
                      hint:
                        row.maps === 0
                          ? t("dashboard.coverageMissing")
                          : `↑${row.published}`,
                    }))}
                  />
                </>
              )}
            </section>
          </div>

          <section
            data-id="dashboard-events"
            className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
          >
            <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.eventsTitle")}</h2>
            {summary && summary.recent_events.length === 0 ? (
              <p className="text-caption text-ink-tertiary">{t("dashboard.eventsEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {(summary?.recent_events ?? []).map((event) => (
                  <li
                    key={`${event.created_at}-${event.map_name}-${event.version_label}`}
                    className="flex items-center gap-3"
                  >
                    <span className="w-20 shrink-0 rounded-sm bg-surface-alt px-2 py-0.5 text-center text-fine text-ink-secondary">
                      {event.event_type}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-caption text-ink">
                      {event.map_name} {event.version_label} — {event.actor_name}
                    </span>
                    <span className="shrink-0 text-fine text-ink-tertiary">
                      {formatKstShort(event.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* AI 사용량 — sysadmin 전용(엔드포인트가 sysadmin 게이트라 뷰어에겐 403) */}
          {user?.isSysadmin && aiUsage ? (
            <section
              data-id="dashboard-ai-usage"
              className="rounded-sm border border-hairline bg-surface p-5 shadow-md"
            >
              <h2 className="pb-4 text-body-strong text-ink">{t("dashboard.aiHeading")}</h2>
              {aiUsage.last30.calls === 0 ? (
                <p className="text-caption text-ink-tertiary">{t("dashboard.aiEmpty")}</p>
              ) : (
                <div className="grid grid-cols-4 gap-3">
                  <StatCard
                    label={t("dashboard.aiCalls7d")}
                    value={count(aiUsage.last7.calls)}
                  />
                  <StatCard
                    label={t("dashboard.aiFailRate7d")}
                    value={
                      aiUsage.last7.calls > 0
                        ? `${Math.round((aiUsage.last7.failed / aiUsage.last7.calls) * 100)}%`
                        : "—"
                    }
                  />
                  <StatCard
                    label={t("dashboard.aiTokens7d")}
                    value={count(
                      aiUsage.last7.prompt_tokens + aiUsage.last7.completion_tokens,
                    )}
                  />
                  <StatCard
                    label={t("dashboard.aiTokens30d")}
                    value={count(
                      aiUsage.last30.prompt_tokens + aiUsage.last30.completion_tokens,
                    )}
                  />
                </div>
              )}
            </section>
          ) : null}
        </div>
      </main>

      {/* 우 사이드바 — sysadmin만 (Task 9) */}
      {user?.isSysadmin ? <AccessSidebar onToast={onToast} /> : null}
    </div>
  );
}
```

- [ ] **Step 4: 색 토큰 실재 여부를 확인한다**

`STATUS_TONES`·`LineChart` 호출부가 참조하는 CSS 변수가 실제로 정의돼 있어야 한다 — 없는 변수는 빈 값이 되어 막대·선이 투명해진다(빌드는 통과하므로 눈으로만 잡힌다).

Run:

```bash
grep -n -- "--color-accent\b\|--color-accent-tint\|--color-error\|--color-ink-secondary\|--color-ink-tertiary\|--color-surface-alt\|--color-canvas\b" frontend/src/app/globals.css
```

Expected: 위 변수 전부가 `@theme` 블록에 존재. 없는 이름이 있으면 **있는 토큰으로 교체**한다. raw hex를 새로 도입하지 않는다.

- [ ] **Step 5: 죽은 i18n 키를 지운다**

`dashboard.openCard`, `dashboard.openCardDesc`, `dashboard.comingSoonNote`, `dashboard.metricsComingSoon`, `dashboard.opsHeading`, `dashboard.visitors`, `dashboard.visitorsHint`, `dashboard.loginsTotal`, `dashboard.logins7d`이 더 이상 참조되지 않는지 확인하고 en/ko 양쪽에서 삭제한다:

Run: `npx tsc --noEmit` 후, 각 키를 grep해 참조 0건인지 본다.

```bash
grep -rn "dashboard.openCard\|dashboard.comingSoonNote\|dashboard.metricsComingSoon\|dashboard.visitors\|dashboard.loginsTotal\|dashboard.logins7d\|dashboard.opsHeading" frontend/src --include=*.tsx --include=*.ts
```

Expected: `i18n-messages.ts`의 정의부만 나온다 → 그 줄들을 삭제한다. (`dashboard.tab`/`dashboard.heading`/`dashboard.subtitle`/`dashboard.back`/`dashboard.ai*`는 계속 쓰이므로 남긴다.)

`getDashboard()`/`DashboardMetrics`(구 `/api/dashboard`)는 프론트에서 더 이상 쓰이지 않는다 — `api.ts`에서 **삭제하지 않고 남긴다**(백엔드 엔드포인트와 기존 pytest가 유지되므로). 다만 `dashboard-panel.tsx`에서 import하지 않는다.

- [ ] **Step 6: 게이트**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 에러 0. (Task 9의 `AccessSidebar`가 아직 없으므로, **Task 9를 먼저 만들거나** 이 단계에서 임시로 `null`을 렌더하고 Task 9에서 교체한다. 순서를 지키려면 Task 9를 Task 8보다 먼저 수행해도 된다 — 두 태스크는 파일이 겹치지 않는다.)

> **실행 순서 권고:** Task 9(AccessSidebar)를 Task 8보다 **먼저** 구현하면 Task 8의 빌드가 한 번에 통과한다.

- [ ] **Step 7: 커밋**

`PROGRESS.md`:

```markdown
- T8 대시보드 패널 재작성 — 진입 카드 제거(탭 클릭이 곧 대시보드), 설정 탭 레일을 풀블리드 3열로 교체. 좌 요약 레일·중앙 지표 그리드(활동·성장·버전상태·커버리지·최근 이벤트)·AI 사용량은 sysadmin 한정. 설정 탭 게이팅에 `dashboard` Access 추가.
```

```bash
git add frontend/src/components/settings/dashboard-panel.tsx frontend/src/app/settings/page.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(dashboard): full-bleed panel + tab gating — 풀블리드 대시보드·탭 게이팅"
```

---

### Task 9: 우측 사이드바 — Access · Coverage 탭

**Files:**
- Create: `frontend/src/components/dashboard/access-sidebar.tsx`

**Interfaces:**
- Consumes: `listDashboardPermissions`, `addDashboardPermission`, `deleteDashboardPermission`, `getCoverageDepts`, `setCoverageDepts`, `getDirectory`, `listGroups` (Task 6 / 기존 api.ts), `SearchSelect`(`@/components/search-select`)
- Produces: `<AccessSidebar onToast?={(message: string) => void} />`

**동작:** 탭 2개. **Access** — 권한 행 목록 + 인원/부서/그룹 피커로 추가, 행별 삭제. **Coverage** — 커버리지 분모 부서 목록 + 부서 피커로 추가, 행별 삭제, 변경 시 전체 목록을 `setCoverageDepts`로 PUT(멱등 교체).

- [ ] **Step 1: 컴포넌트를 만든다**

`frontend/src/components/dashboard/access-sidebar.tsx`:

```tsx
"use client";

// 대시보드 우측 사이드바 — 에디터 인스펙터형. sysadmin 전용 설정 2탭.
// Access: 열람 권한(인원·부서·그룹). Coverage: 커버리지 % 분모가 되는 부서 목록.
// 탭 배열 구조라 추후 일반 유저용 탭을 더할 수 있다 (design 2026-07-11).

import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { SearchSelect, type SelectOption } from "@/components/search-select";
import {
  addDashboardPermission,
  deleteDashboardPermission,
  getCoverageDepts,
  getDirectory,
  listDashboardPermissions,
  listGroups,
  setCoverageDepts,
  type DashboardPermission,
  type Directory,
  type Group,
  type PrincipalType,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";

type SidebarTab = "access" | "coverage";

const PRINCIPAL_TABS: { id: PrincipalType; labelKey: "dashboard.principalUser" | "dashboard.principalDepartment" | "dashboard.principalGroup" }[] = [
  { id: "user", labelKey: "dashboard.principalUser" },
  { id: "department", labelKey: "dashboard.principalDepartment" },
  { id: "group", labelKey: "dashboard.principalGroup" },
];

export function AccessSidebar({ onToast }: { onToast?: (message: string) => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<SidebarTab>("access");
  const [permissions, setPermissions] = useState<DashboardPermission[]>([]);
  const [coverage, setCoverage] = useState<string[]>([]);
  const [directory, setDirectory] = useState<Directory | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [principalType, setPrincipalType] = useState<PrincipalType>("user");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [perms, depts, dir, groupList] = await Promise.all([
          listDashboardPermissions(),
          getCoverageDepts(),
          getDirectory(),
          listGroups(),
        ]);
        if (!alive) return;
        setPermissions(perms);
        setCoverage(depts);
        setDirectory(dir);
        setGroups(groupList.filter((group) => group.status === "active"));
      } catch {
        /* 사이드바 로딩 실패는 대시보드 본문을 막지 않는다 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 피커 후보 — principalType에 따라 바뀐다. 부서는 org_path, 그룹은 id 문자열이 값.
  const options: SelectOption[] = (() => {
    if (principalType === "user") {
      return (directory?.users ?? []).map((entry) => ({
        value: entry.login_id,
        label: entry.name,
        sub: entry.department,
        keywords: `${entry.login_id} ${entry.korean_name ?? ""}`,
      }));
    }
    if (principalType === "department") {
      return (directory?.departments ?? []).map((dept) => ({
        value: dept.id,
        label: dept.korean_name || dept.name,
        sub: dept.id,
        keywords: dept.name,
      }));
    }
    return groups.map((group) => ({
      value: String(group.id),
      label: group.name,
      sub: group.description,
    }));
  })();

  async function handleGrant(principalId: string): Promise<void> {
    if (!principalId) return;
    try {
      const created = await addDashboardPermission(principalType, principalId);
      setPermissions((prev) => [created, ...prev]);
    } catch {
      onToast?.(t("dashboard.loadFailed"));
    }
  }

  async function handleRevoke(permissionId: number): Promise<void> {
    await deleteDashboardPermission(permissionId);
    setPermissions((prev) => prev.filter((row) => row.id !== permissionId));
  }

  // 커버리지는 항상 전체 목록을 PUT — 서버가 통째 교체(멱등)한다.
  async function saveCoverage(next: string[]): Promise<void> {
    const saved = await setCoverageDepts(next);
    setCoverage(saved);
    onToast?.(t("dashboard.coverageSaved"));
  }

  return (
    <aside
      data-id="dashboard-sidebar"
      className="flex w-80 shrink-0 flex-col border-l border-hairline bg-surface"
    >
      <div className="flex border-b border-hairline">
        {([
          { id: "access" as const, labelKey: "dashboard.sidebarAccess" as const },
          { id: "coverage" as const, labelKey: "dashboard.sidebarCoverage" as const },
        ]).map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`flex-1 px-3 py-2 text-caption transition-colors ${
              tab === entry.id
                ? "border-b-2 border-accent text-accent"
                : "text-ink-tertiary hover:bg-surface-alt hover:text-ink"
            }`}
          >
            {t(entry.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "access" ? (
          <div className="flex flex-col gap-3">
            <p className="text-fine text-ink-tertiary">{t("dashboard.accessDesc")}</p>

            <div className="flex gap-1">
              {PRINCIPAL_TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setPrincipalType(entry.id)}
                  className={`flex-1 rounded-sm px-2 py-1 text-fine transition-colors ${
                    principalType === entry.id
                      ? "bg-accent-tint text-accent"
                      : "border border-hairline text-ink-secondary hover:bg-surface-alt"
                  }`}
                >
                  {t(entry.labelKey)}
                </button>
              ))}
            </div>

            <SearchSelect
              value=""
              options={options}
              emptyLabel={t("dashboard.accessAdd")}
              placeholder={t("dashboard.accessAdd")}
              onChange={(value) => void handleGrant(value)}
            />

            {permissions.length === 0 ? (
              <p className="text-fine text-ink-tertiary">{t("dashboard.accessEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {permissions.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center gap-2 rounded-sm border border-hairline px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-caption text-ink">
                        {row.display_name}
                      </span>
                      <span className="block truncate text-fine text-ink-tertiary">
                        {row.principal_type}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleRevoke(row.id)}
                      aria-label={t("dashboard.accessRemove")}
                      className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                    >
                      <X size={16} strokeWidth={1.5} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-fine text-ink-tertiary">{t("dashboard.coverageDesc")}</p>

            <SearchSelect
              value=""
              options={(directory?.departments ?? [])
                .filter((dept) => !coverage.includes(dept.id))
                .map((dept) => ({
                  value: dept.id,
                  label: dept.korean_name || dept.name,
                  sub: dept.id,
                  keywords: dept.name,
                }))}
              emptyLabel={t("dashboard.coverageAdd")}
              placeholder={t("dashboard.coverageAdd")}
              onChange={(value) => {
                if (value) void saveCoverage([...coverage, value]);
              }}
            />

            <ul className="flex flex-col gap-1">
              {coverage.map((path) => (
                <li
                  key={path}
                  className="flex items-center gap-2 rounded-sm border border-hairline px-2.5 py-1.5"
                >
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{path}</span>
                  <button
                    type="button"
                    onClick={() =>
                      void saveCoverage(coverage.filter((entry) => entry !== path))
                    }
                    aria-label={t("dashboard.accessRemove")}
                    className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-ink"
                  >
                    <X size={16} strokeWidth={1.5} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: 게이트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 에러 0. `SearchSelect`의 실제 props(`value`/`options`/`emptyLabel`/`placeholder`/`onChange`/`addMode`/`fitContent`)와 `SelectOption` 필드(`value`/`label`/`sub`/`keywords`)를 다시 확인해 시그니처를 맞춘다.

- [ ] **Step 3: 커밋**

`PROGRESS.md`:

```markdown
- T9 우측 사이드바 — Access(인원·부서·그룹 피커로 권한 부여/제거)·Coverage(분모 부서 선택, 항상 전체 목록 PUT=멱등) 2탭. sysadmin에게만 렌더.
```

```bash
git add frontend/src/components/dashboard/access-sidebar.tsx PROGRESS.md
git commit -m "feat(dashboard): access sidebar with grants and coverage depts — 우측 사이드바 2탭"
```

---

### Task 10: 브라우저 검증 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-dashboard.mjs`

**Interfaces:**
- Consumes: 전 태스크의 결과물

**참조:** 기존 검증 스크립트 `frontend/scripts/pw-verify-ai-usage.mjs`의 부트 패턴(시스템 Chrome + `X-Dev-User`)을 그대로 따른다. **`playwright-core`는 `--no-save`로 설치**한다(`package.json` 오염 방지).

**함정(과거 실측):**
- 좀비 `next dev`가 3000을 점유하면 새 프론트가 3001로 폴백해 **구버전에 붙는다** — 실행 전 전수 `pkill -f "next dev"`.
- `dev.db` 오염 시 "0 events"가 코드 버그처럼 보인다 — 필요하면 `python -m scripts.reset_db`.
- 스크립트가 시드를 누적하므로 재실행 전 DB를 리셋한다.

- [ ] **Step 1: 검증 스크립트를 쓴다**

`frontend/scripts/pw-verify-dashboard.mjs` 신규:

```js
// 운영 대시보드 검증 — 풀블리드 교체·스냅샷/시계열 분리·커버리지·권한 탭 노출.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 node scripts/pw-verify-dashboard.mjs
// 전제: backend(:8000, DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys) + 프론트(:3000).
// 재실행 전제: 권한 행을 누적 시드하므로(check 6 오염) 재실행 전 reset_db 권장.
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 뷰어 권한 시드 — 앱 모델 경유(sqlite raw INSERT는 tz-aware DateTime 비교 함정).
execSync(
  `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import DashboardPermission, Employee

async def seed():
    async with SessionLocal() as s:
        if await s.get(Employee, 'dash.viewer') is None:
            s.add(Employee(login_id='dash.viewer', name='Dash Viewer', source='local', active=True))
        if await s.get(Employee, 'dash.nobody') is None:
            s.add(Employee(login_id='dash.nobody', name='Dash Nobody', source='local', active=True))
        s.add(DashboardPermission(principal_type='user', principal_id='dash.viewer', granted_by='admin.sys'))
        await s.commit()

asyncio.run(seed())
"`,
  { stdio: "inherit" },
);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

async function openDashboard(devUser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
  }, devUser);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  return { ctx, page };
}

// ── sysadmin 시나리오 (check 1~5) ───────────────────────────────
const { ctx, page } = await openDashboard("admin.sys");

const dashboardTab = page.getByRole("button", { name: /^(Dashboard|대시보드)$/ });
await dashboardTab.waitFor({ state: "visible", timeout: 8000 });

// 스냅샷·시계열 응답을 기다려야 "—" 자리표시를 실값으로 오탐하지 않는다.
const summaryDone = page.waitForResponse((r) => r.url().includes("/dashboard/summary"), {
  timeout: 8000,
});
await dashboardTab.click();
await summaryDone.catch(() => undefined);

const root = page.locator('[data-id="dashboard"]');
await root.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
// 풀블리드 교체 = 설정 탭 레일(제목 "Settings")이 더는 없다
const railGone = (await page.getByRole("heading", { name: /^(Settings|설정)$/ }).count()) === 0;
check("1 full-bleed replaces settings rail", (await root.isVisible().catch(() => false)) && railGone);

const cards = page.locator('[data-id="dashboard-stat-card"]');
const cardCount = await cards.count();
const railText = await page.locator('[data-id="dashboard"] aside').first().innerText();
check(
  "2 summary stats rendered (not placeholder)",
  cardCount >= 4 && !railText.includes("—"),
  `${cardCount} cards`,
);
const statsBefore = railText;

const bars = page.locator('[data-id="dashboard-bar-chart"] > div');
check("3 bar count matches 7d preset", (await bars.count()) === 7, `${await bars.count()} bars`);

// 기간 1개월 → 막대 30개, 좌 레일 스탯은 불변(스냅샷은 필터 영향권 밖 — 핵심 불변식)
const seriesDone = page.waitForResponse((r) => r.url().includes("/dashboard/timeseries"), {
  timeout: 8000,
});
await page.getByRole("button", { name: /^(1 month|1개월)$/ }).click();
await seriesDone.catch(() => undefined);
await page.waitForTimeout(300); // 리렌더 안정화
const barsAfter = await bars.count();
const statsAfter = await page.locator('[data-id="dashboard"] aside').first().innerText();
check("4 period change refetches series only", barsAfter === 30 && statsAfter === statsBefore, `${barsAfter} bars`);

// Coverage 탭에서 부서 추가 → 커버리지 섹션에 행 등장
const sidebar = page.locator('[data-id="dashboard-sidebar"]');
await sidebar.getByRole("button", { name: /^(Coverage|커버리지)$/ }).click();
const coverageAdd = sidebar.getByPlaceholder(/Add department|부서 추가/);
await coverageAdd.click();
const firstDept = page.locator('[role="option"], button').filter({ hasText: /Division|본부|팀/ }).first();
const coverageSaved = page.waitForResponse(
  (r) => r.url().includes("/dashboard/coverage-depts") && r.request().method() === "PUT",
  { timeout: 8000 },
);
await firstDept.click();
await coverageSaved.catch(() => undefined);
await page.reload({ waitUntil: "domcontentloaded" });
await dashboardTab.click();
await page.waitForResponse((r) => r.url().includes("/dashboard/summary")).catch(() => undefined);
const coverageText = await page.locator('[data-id="dashboard-coverage"]').innerText();
check("5 coverage dept appears after add", !/No departments selected|지정된 부서가 없습니다/.test(coverageText), coverageText.slice(0, 80));

await ctx.close();

// ── 권한 시나리오 (check 6) ─────────────────────────────────────
const granted = await openDashboard("dash.viewer");
const grantedTabVisible = await granted.page
  .getByRole("button", { name: /^(Dashboard|대시보드)$/ })
  .isVisible({ timeout: 8000 })
  .catch(() => false);
await granted.ctx.close();

const denied = await openDashboard("dash.nobody");
await denied.page.waitForTimeout(1500); // /api/me 왕복 대기
const deniedTabVisible = await denied.page
  .getByRole("button", { name: /^(Dashboard|대시보드)$/ })
  .isVisible()
  .catch(() => false);
await denied.ctx.close();

check("6 tab shown to granted user, hidden from others", grantedTabVisible && !deniedTabVisible, `granted=${grantedTabVisible} denied=${deniedTabVisible}`);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
```

> **check 4가 이 계획의 핵심 불변식**이다 — 기간 필터를 움직였을 때 시계열만 다시 그려지고 좌 레일 스냅샷은 문자 그대로 동일해야 한다. 여기서 실패하면 스냅샷/시계열 분리가 깨진 것이다.
> `playwright-core`가 없으면 `npm install --no-save playwright-core`로 설치한다(`package.json` 오염 방지 — 프로젝트 관례).

- [ ] **Step 2: 서버를 띄우고 스크립트를 돌린다**

```bash
# backend (backend/ 에서) — 권한 시뮬레이션 ON
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/uvicorn app.main:app --port 8000
# frontend (frontend/ 에서)
npm run dev
# 검증
node scripts/pw-verify-dashboard.mjs
```

Expected: 6/6 PASS

> `--reload`는 `.env`를 다시 읽지 않는다 — 환경변수를 바꿨으면 **완전 재기동**한다.

- [ ] **Step 3: 전 게이트**

```bash
# backend/
.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
# frontend/
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

Expected: pytest 전부 PASS · ruff 0 · vitest 전부 PASS · tsc 0 · lint 신규 경고 0 · build 0

- [ ] **Step 4: 커밋**

`PROGRESS.md`:

```markdown
- T10 브라우저 검증 — `frontend/scripts/pw-verify-dashboard.mjs` 6항목(풀블리드 교체·스탯 렌더·막대 수=기간·기간 변경 시 스냅샷 불변·커버리지 부서 추가 반영·권한 유저 탭 노출). 전 게이트 초록.
```

```bash
git add frontend/scripts/pw-verify-dashboard.mjs PROGRESS.md
git commit -m "test(dashboard): playwright verification — 브라우저 검증 6항목"
```

---

## 실행 순서 메모

Task 1 → 2 → 3 → 4 → 5 (백엔드, 각자 독립 테스트) → 6 (프론트 기반) → **9 → 8** (사이드바를 먼저 만들어야 패널 빌드가 한 번에 통과) → 10 (검증).
