# Assignee Role + Catalog Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 노드에 단일값 역할(`assignee_role`) 칸을 추가하고, 관리자 목록 기반 자동완성 엔진(`SuggestInput` + `/catalogs`)을 만들어 역할과 시스템(`system`, 자유값→`Other`+폴백) 두 필드에 적용하며, 설정에 Catalogs 탭(CSV 임포트)을 둔다.

**Architecture:** 백엔드는 `app_settings` 키-값에 관리 목록 2종(`assignee_roles`·`systems`)을 얹고, 로그인 유저용 읽기 `GET /catalogs`와 sysadmin용 쓰기(`PUT /admin/app-settings`)를 분리한다. 노드·맵 컬럼(`assignee_role`·`sp_assignee_role`)은 기존 `assignee`/`sp_assignee`와 같은 열거 지점을 따라간다(단, 경고·감사·부서 페어 로직에는 넣지 않는다). 프론트는 `lib/catalogs.ts`(캐시·정규화 순수 함수) + `SuggestInput`(포털 드롭다운) 위에 역할 행/타일과 시스템 입력 교체를 얹는다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic v2 · Next.js/React 19 + TypeScript · vitest(jsdom, 컴포넌트 테스트 없음) · pytest · Playwright(`playwright-core` + 시스템 Chrome)

**Spec:** `docs/design/2026-09-11-assignee-role-catalog-design.md`

## Global Constraints

- Python 3.11 문법까지만(`backend/ruff.toml target-version = "py311"`, PEP 695 금지). Node 20 호환.
- 신규 DB 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS`에 수동 등록(운영 DB 리셋 금지, 자동 ALTER).
- UI 문자열은 en 권위 + ko 동일 키 강제(`frontend/src/lib/i18n-messages.ts`, `ko: Record<MessageKey, string>` — 한쪽만 넣으면 tsc 실패).
- 색은 토큰 클래스만(raw hex 금지). 굵기 300/400/600만(`font-medium` 금지). 아이콘 Lucide 16px/1.5(작은 줄은 11~12px 허용, 기존 관례).
- 오버레이 z: 모달 1200 · 확인/토스트 1300 · 타일 팝오버 1350 · 자동완성 드롭다운 1400.
- 체크박스는 공용 `CheckInput`(`frontend/src/components/check-input.tsx`), 네이티브 `<input type="checkbox">` 금지.
- 컴포넌트 파일 머리 주석 1줄 필수 + 컴포넌트 추가 시 `cd frontend && node scripts/build-component-catalog.mjs` 재생성(같은 커밋).
- `data-id`는 `surface-role` kebab-case.
- 커밋 메시지: `type(scope): English summary — 한국어 요약` + 트레일러 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`. 각 커밋에 `PROGRESS.md` 1~3줄.
- 게이트 명령(작업 디렉터리 기준):
  - backend: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` · `.venv/bin/ruff check app/ tests/`
  - frontend: `npx tsc --noEmit -p tsconfig.json` · `npx vitest run` · `npm run lint` · `node scripts/build-component-catalog.mjs --check`
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`에서 직접 커밋(사용자 지시: dev = 통합 브랜치). `cd`는 절대경로로.
- CSV 열·AI 계약·인터뷰 수집 노출은 **범위 밖**(패스스루 보존만). 그룹 벌크 모달·라이브러리 행·SP 피크 역할 표시도 범위 밖.

---

## File Structure

**Backend (create)**
- `backend/app/routers/catalogs.py` — `GET /api/catalogs`(로그인 유저 전원) 한 엔드포인트.

**Backend (modify)**
- `backend/app/app_settings.py` — 관리 목록 공용 헬퍼(`normalize_managed_list`·`get_managed_list`·`set_managed_list`), 키 상수, `get_assignee_roles`·`get_systems`(`Other` 보강).
- `backend/app/routers/app_settings.py` — `_to_out`에 목록 2종 + `available_systems`, PUT 처리.
- `backend/app/schemas.py` — `CatalogsOut`, `AppSettingsOut`/`AppSettingsUpdate` 필드, `NodeIn.assignee_role`, `SubprocessDesignationIn.assignee_role`, `MapOut.sp_assignee_role`, `SubprocessRefOut.assignee_role`.
- `backend/app/models.py` — `Node.assignee_role`, `ProcessMap.sp_assignee_role`.
- `backend/app/db.py` — `_ADDED_COLUMNS` 2건.
- `backend/app/routers/graph.py`(upsert) · `backend/app/routers/versions.py`(clone) · `backend/app/routers/maps.py`(SP 지정 PUT) · `backend/app/subprocess.py`(ref 빌드) · `backend/app/main.py`(라우터 등록).
- 테스트: `tests/test_app_settings.py` · `tests/test_graph.py` · `tests/test_versions.py` · `tests/test_subprocess_designation.py` · `tests/test_ref_audit.py`.

**Frontend (create)**
- `frontend/src/lib/catalogs.ts` — 캐시 훅 `useCatalogs`·`invalidateCatalogs`, 순수 함수 `normalizeToCatalog`·`commitSystem`·`formatSystem`, 상수 `OTHER_SYSTEM`. (+ `catalogs.test.ts`)
- `frontend/src/lib/catalog-csv.ts` — `parseCatalogCsv`·`mergeCatalogValues`. (+ `catalog-csv.test.ts`)
- `frontend/src/components/suggest-input.tsx` — `SuggestInput` 엔진.
- `frontend/src/components/role-chip.tsx` — `RoleChip`.
- `frontend/src/components/system-suggest-input.tsx` — `SystemSuggestInput`(SuggestInput + 정규화 + 원문 메모 교체 확인).
- `frontend/src/components/permissions/role-tile.tsx` — `RoleTile`(타일 + 팝오버).
- `frontend/src/components/settings/catalogs-panel.tsx` — `CatalogsPanel` + 내부 `ManagedListCard`.
- `frontend/scripts/pw-smoke-assignee-role.mjs` — Playwright 스모크.

**Frontend (modify)**
- `frontend/src/lib/api.ts` — 타입·`getCatalogs`·`AppSettings`·`putAppSettings`·`SubprocessDesignationBody`.
- `frontend/src/lib/canvas.ts` — `NodeData.assignee_role`·`spAssigneeRole`, `buildNodeData`.
- `frontend/src/app/maps/[mapId]/page.tsx` — 그래프↔노드 변환·AI 변환·SP ref 주입·신규 노드 리터럴·인스펙터(역할 행·시스템 입력 교체·읽기 행)·노드 모달 props.
- `frontend/src/lib/csv-import.ts` · `frontend/src/lib/diff.ts` · `frontend/src/lib/excel-export.ts` · `frontend/src/lib/excel-wbs.ts` (+ 각 테스트).
- `frontend/src/components/process-node.tsx` · `attribute-read-rows.tsx` · `bpm-attribute-picker.tsx` · `node-summary-modal.tsx` · `subprocess-usage-tab.tsx` · `subprocess-inspector-card.tsx` · `maps/map-detail-sp-section.tsx` · `subprocess-preview-peek.tsx` · `permissions/subprocess-designation-modal.tsx` · `permissions/subprocess-designation-panel.tsx` · `app/inbox/page.tsx` · `app/settings/page.tsx` · `lib/i18n-messages.ts`.
- 문서: `PROGRESS.md` · `CLAUDE.md`(노드 속성 체크리스트에 카탈로그 한 줄) · `docs/design/2026-08-24-data-surface-parity-design.md`(후속 항목) · `frontend/COMPONENTS.md`(생성).

---

### Task 1: 관리 목록 엔진(백엔드) — 헬퍼·`/catalogs`·app-settings 필드

**Files:**
- Modify: `backend/app/app_settings.py`
- Modify: `backend/app/routers/app_settings.py`
- Create: `backend/app/routers/catalogs.py`
- Modify: `backend/app/main.py:21-60`(import 튜플), `:102-131`(include_router)
- Modify: `backend/app/schemas.py:1998-2025`
- Test: `backend/tests/test_app_settings.py`

**Interfaces:**
- Produces: `app.app_settings.ASSIGNEE_ROLES_KEY = "assignee_roles"`, `SYSTEMS_KEY = "systems"`, `OTHER_SYSTEM = "Other"`, `normalize_managed_list(values: list[object]) -> list[str]`, `get_managed_list(session, key, default) -> list[str]`, `set_managed_list(session, key, values, user) -> list[str]`, `get_assignee_roles(session) -> list[str]`, `get_systems(session) -> list[str]`(항상 `Other`가 0번).
- Produces: `GET /api/catalogs` → `{"assignee_roles": [...], "systems": ["Other", ...]}`; `AppSettingsOut.assignee_roles/systems/available_systems`; `AppSettingsUpdate.assignee_roles/systems`.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_app_settings.py` 끝에 추가

```python
import uuid


def test_catalogs_default_has_other_only(client: TestClient) -> None:
    # 관리 목록 미설정 상태 — 역할은 빈 목록, 시스템은 예약 항목 Other만
    body = client.get("/api/catalogs").json()
    assert body["assignee_roles"] == []
    assert body["systems"] == ["Other"]


def test_app_settings_managed_lists_roundtrip(client: TestClient) -> None:
    body = client.put(
        "/api/admin/app-settings",
        json={"assignee_roles": [" 실험자 ", "검토자", "실험자", ""], "systems": ["lims", "LIMS", "SAP", "other"]},
    ).json()
    # trim·빈값 제거·대소문자 무시 중복 제거(첫 표기 유지), Other는 항상 맨 앞 1개
    assert body["assignee_roles"] == ["실험자", "검토자"]
    assert body["systems"] == ["Other", "lims", "SAP"]
    catalogs = client.get("/api/catalogs").json()
    assert catalogs == {"assignee_roles": ["실험자", "검토자"], "systems": ["Other", "lims", "SAP"]}
    # 빈 목록 저장 = 역할 없음 / 시스템은 Other만 남는다
    body = client.put("/api/admin/app-settings", json={"assignee_roles": [], "systems": []}).json()
    assert body["assignee_roles"] == [] and body["systems"] == ["Other"]


def test_app_settings_available_systems_lists_values_in_use(client: TestClient) -> None:
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"catalog probe {uuid.uuid4().hex[:6]}"}
    ).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    probe = f"Probe-{uuid.uuid4().hex[:6]}"
    client.put(
        f"/api/versions/{version_id}/graph",
        json={
            "nodes": [
                {"id": f"cat-s-{probe}", "title": "시작", "node_type": "start"},
                {"id": f"cat-p-{probe}", "title": "작업", "system": probe},
            ],
            "edges": [],
        },
    )
    body = client.get("/api/admin/app-settings").json()
    assert probe in body["available_systems"]


def test_catalogs_readable_by_non_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    assert client.get("/api/catalogs", headers=headers).status_code == 200
    assert client.get("/api/admin/app-settings", headers=headers).status_code == 403
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_app_settings.py -q`
Expected: 4 FAIL (404 on `/api/catalogs`, KeyError `assignee_roles`).

- [ ] **Step 3: 헬퍼 구현** — `backend/app/app_settings.py`

`EXPOSED_POSITIONS_KEY` 아래에 상수 추가:

```python
# 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션. 설정 Catalogs 탭에서 편집 (design 2026-09-11 §3.1)
ASSIGNEE_ROLES_KEY = "assignee_roles"
SYSTEMS_KEY = "systems"
# 시스템 예약 항목 — 목록 밖 자유값은 FE가 Other로 분류하고 원문을 system_fallback에 남긴다
OTHER_SYSTEM = "Other"
MANAGED_LIST_MAX = 500
MANAGED_ITEM_MAX_LEN = 100
```

`get_exposed_positions`를 아래로 교체하고, 그 위에 공용 헬퍼 3개 + 아래에 목록 2종 getter를 추가:

```python
def normalize_managed_list(values: list[object]) -> list[str]:
    """trim · 빈값 제거 · 대소문자 무시 중복 제거(첫 표기 유지) · 항목 100자 컷. 순서는 입력 순."""
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        if not isinstance(raw, str):
            continue
        value = raw.strip()[:MANAGED_ITEM_MAX_LEN]
        if not value:
            continue
        key = value.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(value)
    return out


async def get_managed_list(session: AsyncSession, key: str, default: list[str]) -> list[str]:
    """JSON 배열 설정 — 행 부재/파싱 불가/배열 아님이면 default. 저장된 빈 목록은 그대로 존중."""
    row = await session.get(AppSetting, key)
    if row is None:
        return list(default)
    try:
        stored = json.loads(row.value)
    except ValueError:
        return list(default)
    if not isinstance(stored, list):
        return list(default)
    return normalize_managed_list(stored)


async def set_managed_list(session: AsyncSession, key: str, values: list[str], user: str) -> list[str]:
    """정규화 후 upsert(호출자가 commit). 상한 초과분은 잘라낸다."""
    cleaned = normalize_managed_list(list(values))[:MANAGED_LIST_MAX]
    await set_app_setting(session, key, json.dumps(cleaned, ensure_ascii=False), user)
    return cleaned


async def get_exposed_positions(session: AsyncSession) -> list[str]:
    """노출 직책 allowlist — 저장된 빈 목록은 그대로(전부 비노출은 유효한 관리자 의도)."""
    return await get_managed_list(session, EXPOSED_POSITIONS_KEY, DEFAULT_EXPOSED_POSITIONS)


async def get_assignee_roles(session: AsyncSession) -> list[str]:
    return await get_managed_list(session, ASSIGNEE_ROLES_KEY, [])


def ensure_other_first(systems: list[str]) -> list[str]:
    """예약 항목 불변식 — Other는 항상 1개, 맨 앞."""
    rest = [s for s in systems if s.casefold() != OTHER_SYSTEM.casefold()]
    return [OTHER_SYSTEM, *rest]


async def get_systems(session: AsyncSession) -> list[str]:
    return ensure_other_first(await get_managed_list(session, SYSTEMS_KEY, []))
```

`set_app_setting`은 헬퍼들보다 아래에 있으므로 함수 정의 순서는 무관(런타임 조회). 모듈 상단 docstring은 유지.

- [ ] **Step 4: 스키마** — `backend/app/schemas.py`

`AppSettingsOut`의 `available_positions` 아래에:

```python
    # 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션 (design 2026-09-11 §3.1)
    assignee_roles: list[str] = []
    systems: list[str] = []
    # nodes.system ∪ process_maps.sp_system distinct — 관리자가 사용 중 값을 목록으로 승격하는 후보(읽기전용)
    available_systems: list[str] = []
```

`AppSettingsUpdate`의 `exposed_positions` 아래에:

```python
    # 관리 목록 — 서버가 trim·중복 제거·100자 컷. 빈 목록 저장 허용(시스템은 Other만 남는다)
    assignee_roles: list[str] | None = Field(default=None, max_length=500)
    systems: list[str] | None = Field(default=None, max_length=500)
```

`AppSettingsUpdate` 클래스 뒤(=`AiPromptOut` 앞)에:

```python
class CatalogsOut(BaseModel):
    """관리 목록 읽기 — 로그인 유저 전원(에디터 자동완성 소스). 편집은 /admin/app-settings(sysadmin)."""

    assignee_roles: list[str]
    systems: list[str]
```

- [ ] **Step 5: app-settings 라우터** — `backend/app/routers/app_settings.py`

import 블록에 `ASSIGNEE_ROLES_KEY, SYSTEMS_KEY, get_assignee_roles, get_systems, set_managed_list` 추가(알파벳 순 유지). `from app.models import AppSetting, Employee` → `from app.models import AppSetting, Employee, Node, ProcessMap`.

`_to_out`: `managed` 목록에 `ASSIGNEE_ROLES_KEY, SYSTEMS_KEY` 추가. `available_positions` 조회 아래에:

```python
    # 사용 중인 시스템 값 — 노드 system ∪ SP 지정 sp_system (빈값 제외, 대소문자 무시 정렬)
    node_systems = (await session.scalars(select(distinct(Node.system)).where(Node.system != ""))).all()
    sp_systems = (
        await session.scalars(
            select(distinct(ProcessMap.sp_system)).where(
                ProcessMap.sp_system.is_not(None), ProcessMap.sp_system != ""
            )
        )
    ).all()
    available_systems = sorted({*node_systems, *sp_systems}, key=str.casefold)
```

`AppSettingsOut(...)` 생성에 `assignee_roles=await get_assignee_roles(session), systems=await get_systems(session), available_systems=available_systems,` 추가.

`put_app_settings`: `exposed_positions` 처리 블록 아래에:

```python
    if payload.assignee_roles is not None:
        await set_managed_list(session, ASSIGNEE_ROLES_KEY, payload.assignee_roles, user)
    if payload.systems is not None:
        # Other는 저장값에서 빼고 읽기 시 보강 — 관리자가 지워도 목록에서 사라지지 않는다
        systems = [s for s in payload.systems if s.strip().casefold() != OTHER_SYSTEM.casefold()]
        await set_managed_list(session, SYSTEMS_KEY, systems, user)
```

(`OTHER_SYSTEM`도 import.)

- [ ] **Step 6: `/catalogs` 라우터** — Create `backend/app/routers/catalogs.py`

```python
"""관리 목록(카탈로그) 읽기 API — 에디터 자동완성(역할·시스템) 소스. 로그인 유저 전원."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems
from app.auth import get_current_user
from app.db import get_session
from app.schemas import CatalogsOut

router = APIRouter(prefix="/api", tags=["catalogs"], dependencies=[Depends(get_current_user)])


@router.get("/catalogs", response_model=CatalogsOut)
async def get_catalogs(session: AsyncSession = Depends(get_session)) -> CatalogsOut:
    return CatalogsOut(
        assignee_roles=await get_assignee_roles(session),
        systems=await get_systems(session),
    )
```

`backend/app/main.py`: `from app.routers import (...)` 튜플에 `catalogs,` 추가(알파벳 순), `app.include_router(app_settings.router)` 아래에 `app.include_router(catalogs.router)`.

- [ ] **Step 7: 통과 확인 + 린트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_app_settings.py -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, ruff clean.

- [ ] **Step 8: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add backend/app/app_settings.py backend/app/routers/app_settings.py backend/app/routers/catalogs.py backend/app/main.py backend/app/schemas.py backend/tests/test_app_settings.py PROGRESS.md
git commit -m "feat(catalogs): managed lists for assignee roles and systems with a read endpoint — 역할·시스템 관리 목록 + /catalogs 읽기 API"
```

---

### Task 2: 노드 `assignee_role` 컬럼(백엔드)

**Files:**
- Modify: `backend/app/models.py:332`(Node.assignee 아래)
- Modify: `backend/app/db.py:_ADDED_COLUMNS`(마지막 항목 뒤)
- Modify: `backend/app/schemas.py:1240`(NodeIn.assignee 아래) + validator
- Modify: `backend/app/routers/graph.py:429`, `backend/app/routers/versions.py:84`
- Test: `backend/tests/test_graph.py`, `backend/tests/test_versions.py`, `backend/tests/test_ref_audit.py`

**Interfaces:**
- Produces: `NodeIn.assignee_role: str`(trim, ≤100), GET graph 노드에 `assignee_role` 키.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_graph.py` 끝:

```python
def test_assignee_role_roundtrips_and_clears_when_omitted(client: TestClient) -> None:
    # 단일값 역할 — trim 저장, 페이로드에서 빠지면 ""로 소거(기존 assignee와 같은 규칙)
    version_id = _create_version(client)
    nodes = [
        {"id": f"role-s-{version_id}", "title": "시작", "node_type": "start"},
        {"id": f"role-p-{version_id}", "title": "칭량", "assignee_role": "  Reviewer  "},
    ]
    client.put(f"/api/versions/{version_id}/graph", json={"nodes": nodes, "edges": []})
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    assert next(n for n in saved["nodes"] if n["title"] == "칭량")["assignee_role"] == "Reviewer"

    nodes[1] = {"id": f"role-p-{version_id}", "title": "칭량"}
    client.put(f"/api/versions/{version_id}/graph", json={"nodes": nodes, "edges": []})
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    assert next(n for n in saved["nodes"] if n["title"] == "칭량")["assignee_role"] == ""
```

`backend/tests/test_versions.py` 끝:

```python
def test_new_version_clone_preserves_assignee_role(client: TestClient) -> None:
    created = _create_map(client)
    v1 = created["versions"][0]["id"]
    client.post(f"/api/versions/{v1}/checkout", json={})
    client.put(
        f"/api/versions/{v1}/graph",
        json={
            "nodes": [
                {"id": f"role-c0-{v1}", "title": "시작", "node_type": "start"},
                {"id": f"role-c1-{v1}", "title": "검토", "assignee_role": "Reviewer"},
            ],
            "edges": [],
        },
    )
    _set_version_status(v1, "published")
    v2 = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be", "source_version_id": v1}).json()["id"]
    cloned = client.get(f"/api/versions/{v2}/graph").json()
    assert next(n for n in cloned["nodes"] if n["title"] == "검토")["assignee_role"] == "Reviewer"
```

`backend/tests/test_ref_audit.py` 끝(경고·감사 무영향 고정):

```python
def test_scan_user_refs_ignores_assignee_role(client: TestClient) -> None:
    """역할(assignee_role)은 사람 이름이 아니다 — 감사가 고아 사용자로 잡으면 안 된다 (design 2026-09-11 §2)."""

    async def _seed() -> None:
        async with SessionLocal() as session:
            m = await _new_map(session, "role refs", owning_department=LIVE)
            pub = MapVersion(map_id=m.id, label="pub", status="published")
            session.add(pub)
            await session.flush()
            session.add(Node(id=f"role-{pub.id}", version_id=pub.id, title="r", assignee="", assignee_role="Phantom Reviewer"))
            await session.commit()

    asyncio.run(_seed())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_user_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    assert all(g.value != "Phantom Reviewer" for g in groups)
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py tests/test_versions.py tests/test_ref_audit.py -q -k assignee_role`
Expected: 3 FAIL(KeyError/TypeError — 컬럼 없음).

- [ ] **Step 3: 모델·DDL·스키마·라우터**

`backend/app/models.py` `Node.assignee` 줄 아래:

```python
    # 단일값 역할(실험자/검토자…) — 담당자와 같이 표시, 부서 페어·경고·감사 대상 아님 (design 2026-09-11 §2)
    assignee_role: Mapped[str] = mapped_column(String(100), default="")
```

`backend/app/db.py` `_ADDED_COLUMNS` 마지막 `("nodes", "width", "INTEGER"),` 아래:

```python
    # 노드 역할 + SP 지정 역할 — 단일값, 담당자 옆 표시 (design 2026-09-11)
    ("nodes", "assignee_role", "VARCHAR(100) DEFAULT ''"),
    ("process_maps", "sp_assignee_role", "VARCHAR(100)"),
```

(맵 컬럼은 Task 3에서 모델을 붙이지만 DDL 등록은 여기서 함께 한다.)

`backend/app/schemas.py` `NodeIn.assignee` 줄 아래:

```python
    # 단일값 역할 — trim만, 목록 강제 없음 (design 2026-09-11 §2)
    assignee_role: str = Field(default="", max_length=100)
```

`NodeIn`의 `_coerce_group_ids` validator 위에:

```python
    @field_validator("assignee_role", mode="after")
    @classmethod
    def _strip_assignee_role(cls, value: str) -> str:
        return value.strip()
```

`backend/app/routers/graph.py` upsert: `existing.assignee = node.assignee` 아래 `existing.assignee_role = node.assignee_role`.
`backend/app/routers/versions.py` clone: `assignee=node.assignee,` 아래 `assignee_role=node.assignee_role,`.

- [ ] **Step 4: 통과 확인**

Run: 위 Step 2 명령. Expected: 3 PASS. 이어서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/` — 전체 green(로컬 sqlite는 `create_all` + 자동 ALTER로 컬럼이 생긴다).

- [ ] **Step 5: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/graph.py backend/app/routers/versions.py backend/tests/test_graph.py backend/tests/test_versions.py backend/tests/test_ref_audit.py PROGRESS.md
git commit -m "feat(nodes): single-value assignee_role column carried through upsert and clone — 노드 역할 컬럼(저장·복제 이월, 감사 제외)"
```

---

### Task 3: 맵 `sp_assignee_role`(SP 지정 대칭, 백엔드)

**Files:**
- Modify: `backend/app/models.py:153`(ProcessMap.sp_assignee 아래)
- Modify: `backend/app/schemas.py:98`(SubprocessDesignationIn.assignee 아래) · `:735`(MapOut.sp_assignee 아래) · `:1409`(SubprocessRefOut.assignee 아래)
- Modify: `backend/app/routers/maps.py:1487`, `backend/app/subprocess.py:151,190,225`
- Test: `backend/tests/test_subprocess_designation.py`

**Interfaces:**
- Consumes: Task 2의 DDL 등록.
- Produces: `PUT /maps/{id}/subprocess-designation` body `assignee_role`; `MapOut.sp_assignee_role: str | None`; graph `subprocess_refs[map_id].assignee_role: str | None`.

- [ ] **Step 1: 실패하는 테스트** — `backend/tests/test_subprocess_designation.py` `test_designate_happy_path` 아래

```python
def test_designate_saves_assignee_role_and_exposes_it_to_hosts(client: TestClient, enforce) -> None:
    """SP 지정 역할 — trim 저장, 상세 응답·호스트 그래프 subprocess_refs에 노출. 빈값은 None (design 2026-09-11 §2)."""
    map_id = seed_map("desig-role", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json={**BODY, "assignee_role": "  Reviewer "})
    assert res.status_code == 200
    assert res.json()["sp_assignee_role"] == "Reviewer"
    assert client.get(f"/api/maps/{map_id}").json()["sp_assignee_role"] == "Reviewer"

    _, host_version_id = seed_host_with_subprocess_node(map_id, f"role-host-{map_id}")
    refs = client.get(f"/api/versions/{host_version_id}/graph").json()["subprocess_refs"]
    assert refs[str(map_id)]["assignee_role"] == "Reviewer"

    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.json()["sp_assignee_role"] is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_subprocess_designation.py -q -k assignee_role`
Expected: FAIL(KeyError `sp_assignee_role`).

- [ ] **Step 3: 구현**

`backend/app/models.py` `sp_assignee` 줄 아래:

```python
    sp_assignee_role: Mapped[str | None] = mapped_column(String(100), default=None)
```

`backend/app/schemas.py`:
- `SubprocessDesignationIn.assignee` 아래: `assignee_role: str = Field(default="", max_length=100)`
- `MapOut.sp_assignee` 아래: `sp_assignee_role: str | None = None`
- `SubprocessRefOut.assignee` 아래: `assignee_role: str | None = None`

`backend/app/routers/maps.py` `found_map.sp_assignee = payload.assignee` 아래:

```python
    found_map.sp_assignee_role = payload.assignee_role.strip() or None
```

`backend/app/subprocess.py`: select 목록 `ProcessMap.sp_assignee,` 아래 `ProcessMap.sp_assignee_role,`; 언패킹 튜플 `assignee,` 아래 `assignee_role,`; `SubprocessRefOut(... assignee=assignee,` 아래 `assignee_role=assignee_role,`.

- [ ] **Step 4: 통과 확인**

Run: Step 2 명령 → PASS. 이어서 전체 pytest + ruff green.

- [ ] **Step 5: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add backend/app/models.py backend/app/schemas.py backend/app/routers/maps.py backend/app/subprocess.py backend/tests/test_subprocess_designation.py PROGRESS.md
git commit -m "feat(subprocess): sp_assignee_role on designation, inherited by host graphs — SP 지정 역할 저장·호스트 그래프 상속"
```

---

### Task 4: 프론트 카탈로그 라이브러리 + API 타입

**Files:**
- Modify: `frontend/src/lib/api.ts:1416-1447`(AppSettings·putAppSettings) + `getCatalogs` 추가
- Create: `frontend/src/lib/catalogs.ts`
- Test: `frontend/src/lib/catalogs.test.ts`
- Modify: `frontend/src/lib/i18n-messages.ts`(en·ko 각각)

**Interfaces:**
- Produces: `api.Catalogs {assignee_roles: string[]; systems: string[]}`, `getCatalogs()`; `AppSettings.assignee_roles/systems/available_systems`; `putAppSettings({assignee_roles?, systems?})`.
- Produces: `lib/catalogs.ts` — `OTHER_SYSTEM`, `useCatalogs(): Catalogs`, `invalidateCatalogs(): void`, `normalizeToCatalog(value, list): string | null`, `commitSystem(raw, systems, currentFallback): SystemCommit`, `formatSystem(value, otherLabel): string`.
- Produces i18n 키: `field.assigneeRole`, `system.other`, `suggest.noMatch`, `suggest.noMatchFree`, `sp.tile.hint.role`, `catalog.rolePlaceholder`, `catalog.systemPlaceholder`, `catalog.systemKeptNote`, `catalog.systemReplaceNoteTitle`, `catalog.systemReplaceNoteBody`, `catalog.systemReplaceNoteConfirm`, `catalog.systemKeepNote`.

- [ ] **Step 1: 실패하는 테스트** — Create `frontend/src/lib/catalogs.test.ts`

```ts
// 카탈로그 순수 함수 — 시스템 정규화·Other 폴백 규칙 (design 2026-09-11 §4.2)
import { describe, expect, it } from "vitest";

import { commitSystem, formatSystem, normalizeToCatalog, OTHER_SYSTEM } from "./catalogs";

const SYSTEMS = [OTHER_SYSTEM, "LIMS", "SAP"];

describe("normalizeToCatalog", () => {
  it("matches case-insensitively and returns the catalog spelling", () => {
    expect(normalizeToCatalog(" lims ", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog("other", SYSTEMS)).toBe("Other");
  });
  it("returns null for empty or unknown values", () => {
    expect(normalizeToCatalog("", SYSTEMS)).toBeNull();
    expect(normalizeToCatalog("Excel", SYSTEMS)).toBeNull();
  });
});

describe("commitSystem", () => {
  it("empty input clears the system and keeps the note", () => {
    expect(commitSystem("  ", SYSTEMS, "memo")).toEqual({ system: "", system_fallback: "memo", keptNote: false });
  });
  it("catalog match stores the catalog spelling and keeps the note", () => {
    expect(commitSystem("sap", SYSTEMS, "memo")).toEqual({ system: "SAP", system_fallback: "memo", keptNote: false });
  });
  it("unknown value becomes Other and fills an empty note with the raw text", () => {
    expect(commitSystem(" Excel macro ", SYSTEMS, "")).toEqual({
      system: "Other", system_fallback: "Excel macro", keptNote: false,
    });
  });
  it("unknown value keeps an existing different note and flags it", () => {
    expect(commitSystem("Excel macro", SYSTEMS, "old memo")).toEqual({
      system: "Other", system_fallback: "old memo", keptNote: true,
    });
  });
  it("unknown value equal to the note is not flagged", () => {
    expect(commitSystem("old memo", SYSTEMS, "old memo")).toEqual({
      system: "Other", system_fallback: "old memo", keptNote: false,
    });
  });
});

describe("formatSystem", () => {
  it("renders Other through the label and passes other values through", () => {
    expect(formatSystem("Other", "기타")).toBe("기타");
    expect(formatSystem("SAP", "기타")).toBe("SAP");
    expect(formatSystem(null, "기타")).toBe("");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalogs.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: api.ts**

`AppSettings` 인터페이스 `available_positions` 아래:

```ts
  // 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션 (design 2026-09-11 §3.1)
  assignee_roles: string[];
  systems: string[];
  // nodes.system ∪ sp_system distinct — 사용 중 값을 목록으로 승격하는 후보(읽기전용)
  available_systems: string[];
```

`putAppSettings` patch 타입에 `assignee_roles?: string[]; systems?: string[];` 추가. `getAppSettings` 위에:

```ts
// 관리 목록 읽기 — 로그인 유저 전원(에디터 자동완성 소스). 편집은 putAppSettings(sysadmin)
export interface Catalogs {
  assignee_roles: string[];
  systems: string[];
}

export function getCatalogs(): Promise<Catalogs> {
  return request<Catalogs>("/catalogs");
}
```

- [ ] **Step 4: lib/catalogs.ts** — Create

```ts
"use client";

// 관리 목록(카탈로그) — 역할·시스템 자동완성 옵션의 단일 소스 + 시스템 정규화 순수 함수.
// 모듈 캐시(세션당 1회 fetch, lib/directory.ts 패턴). 관리자 저장 후 invalidateCatalogs()로 재조회.
// 설계: docs/design/2026-09-11-assignee-role-catalog-design.md §3.2·§4.2

import { useEffect, useState } from "react";

import { getCatalogs, type Catalogs } from "@/lib/api";

// 시스템 예약 항목 — 목록 밖 자유값은 Other로 분류하고 원문을 system_fallback에 남긴다 (저장값 고정, 표시는 i18n)
export const OTHER_SYSTEM = "Other";

const EMPTY: Catalogs = { assignee_roles: [], systems: [OTHER_SYSTEM] };

let cache: Catalogs | null = null;
let inflight: Promise<Catalogs> | null = null;
const listeners = new Set<() => void>();

function loadCatalogs(): Promise<Catalogs> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = getCatalogs()
      .then((data) => {
        cache = data;
        return data;
      })
      .catch((err) => {
        inflight = null; // 실패 약속을 캐시에 남기면 이후 마운트가 전부 같은 실패를 물려받는다
        throw err;
      });
  }
  return inflight;
}

/** 관리자 저장 후 호출 — 캐시를 비우고 마운트된 훅들을 재조회시킨다 */
export function invalidateCatalogs(): void {
  cache = null;
  inflight = null;
  for (const listener of listeners) listener();
}

/** 카탈로그 2종. 도착 전엔 캐시(있으면) 또는 빈 목록(시스템은 Other만). */
export function useCatalogs(): Catalogs {
  const [data, setData] = useState<Catalogs>(cache ?? EMPTY);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      loadCatalogs()
        .then((next) => {
          if (alive) setData(next);
        })
        .catch(() => {
          // 조회 실패 — 자동완성 없이 자유입력만 남는다
        });
    };
    refresh();
    listeners.add(refresh);
    return () => {
      alive = false;
      listeners.delete(refresh);
    };
  }, []);
  return data;
}

/** trim 후 대소문자 무시 일치 → 목록 표기. 빈값·불일치는 null. */
export function normalizeToCatalog(value: string, list: readonly string[]): string | null {
  const key = value.trim().toLocaleLowerCase();
  if (key === "") return null;
  return list.find((item) => item.toLocaleLowerCase() === key) ?? null;
}

export interface SystemCommit {
  system: string;
  system_fallback: string;
  // 자유값인데 기존 원문 메모가 다른 내용이라 유지했다 — 호출부가 확인/안내를 띄운다
  keptNote: boolean;
}

/** 시스템 커밋 규칙 — 4 표면(인스펙터·노드 모달·SP 지정·적용) 공용.
 *  빈값=시스템 비움 · 목록 일치=표기 저장 · 불일치=Other + 원문 메모(비어 있을 때만 채움) */
export function commitSystem(raw: string, systems: readonly string[], currentFallback: string): SystemCommit {
  const trimmed = raw.trim();
  if (trimmed === "") return { system: "", system_fallback: currentFallback, keptNote: false };
  const matched = normalizeToCatalog(trimmed, systems);
  if (matched !== null) return { system: matched, system_fallback: currentFallback, keptNote: false };
  const note = currentFallback.trim();
  if (note === "" || note === trimmed) return { system: OTHER_SYSTEM, system_fallback: trimmed, keptNote: false };
  return { system: OTHER_SYSTEM, system_fallback: currentFallback, keptNote: true };
}

/** 표시용 — 저장값 Other만 i18n 라벨로, 나머지는 그대로 */
export function formatSystem(value: string | null | undefined, otherLabel: string): string {
  const system = value ?? "";
  return system === OTHER_SYSTEM ? otherLabel : system;
}
```

- [ ] **Step 5: i18n 키** — `frontend/src/lib/i18n-messages.ts`

`en`의 `"field.system": "System",` 아래:

```ts
  "field.assigneeRole": "Role",
  "system.other": "Other",
  "suggest.noMatch": "No matches",
  "suggest.noMatchFree": "No matches - Enter keeps your text",
  "catalog.rolePlaceholder": "e.g. Reviewer",
  "catalog.systemPlaceholder": "Pick a system or type one",
  "catalog.systemKeptNote": "Not in the system list - saved as Other. The existing source note was kept.",
  "catalog.systemReplaceNoteTitle": "Replace the source note?",
  "catalog.systemReplaceNoteBody": "\"{value}\" is not in the system list, so the system becomes Other. Replace the existing source note with this text?",
  "catalog.systemReplaceNoteConfirm": "Replace",
  "catalog.systemKeepNote": "Keep note",
```

`en`의 `"sp.tile.hint.system": ...` 아래: `"sp.tile.hint.role": "Free text. Suggestions come from the roles list in Settings > Catalogs.",`

`ko`의 `"field.system": "시스템",` 아래:

```ts
  "field.assigneeRole": "역할",
  "system.other": "기타",
  "suggest.noMatch": "일치 항목 없음",
  "suggest.noMatchFree": "일치 항목 없음 - Enter로 입력값 그대로 저장",
  "catalog.rolePlaceholder": "예: 검토자",
  "catalog.systemPlaceholder": "시스템을 고르거나 입력",
  "catalog.systemKeptNote": "시스템 목록에 없어 기타로 저장했습니다. 기존 원문 메모는 유지했습니다.",
  "catalog.systemReplaceNoteTitle": "원문 메모를 교체할까요?",
  "catalog.systemReplaceNoteBody": "\"{value}\"은(는) 시스템 목록에 없어 기타로 저장됩니다. 기존 원문 메모를 이 입력값으로 교체할까요?",
  "catalog.systemReplaceNoteConfirm": "교체",
  "catalog.systemKeepNote": "메모 유지",
```

`ko`의 `"sp.tile.hint.system"` 아래: `"sp.tile.hint.role": "자유 입력. 제안 목록은 설정 > Catalogs의 역할 목록입니다.",`

- [ ] **Step 6: 통과 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalogs.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, tsc clean.

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/lib/api.ts frontend/src/lib/catalogs.ts frontend/src/lib/catalogs.test.ts frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(catalogs): client cache hook and system normalization rules — 카탈로그 캐시 훅·시스템 정규화(Other+폴백) 순수 함수"
```

---

### Task 5: `SuggestInput` 엔진

**Files:**
- Create: `frontend/src/components/suggest-input.tsx`
- Modify: `frontend/COMPONENTS.md`(생성 스크립트)

**Interfaces:**
- Consumes: `lib/search.filterByQuery(items, query, getFields)`.
- Produces: `SuggestInput({ value, options, onCommit, dataId, placeholder?, mode?: "row"|"field", maxLength?, allowFree?, autoFocus?, ariaLabel? })`. `onCommit`은 값이 바뀔 때만(trim) 호출. 드롭다운 `data-id={dataId}-menu`, 항목 `{dataId}-option-{i}`.

- [ ] **Step 1: 컴포넌트 작성** — Create `frontend/src/components/suggest-input.tsx`

```tsx
"use client";

// 단일값 자유입력 + 제안 드롭다운 — 관리 목록(카탈로그) 자동완성 필드의 공용 엔진(역할·시스템).
// 제안은 lib/search filterByQuery 랭킹(부분일치·초성·로마자), ↑↓ 이동·Enter 확정·Esc 되돌림·blur 확정.
// 일치 없으면 입력값 그대로 확정(allowFree). 드롭다운은 body 포털 fixed z-[1400] — 타일 팝오버(1350) 위,
// DataFormPicker와 같은 층. row=인스펙터 행(우측 정렬 w-32) / field=팝오버·폼 전폭.
// 설계: docs/design/2026-09-11-assignee-role-catalog-design.md §3.2

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useI18n } from "@/lib/i18n";
import { filterByQuery } from "@/lib/search";

interface SuggestInputProps {
  value: string;
  options: readonly string[];
  // 확정 콜백 — 값이 바뀐 경우에만(trim 적용)
  onCommit: (next: string) => void;
  dataId: string;
  placeholder?: string;
  mode?: "row" | "field";
  maxLength?: number;
  // false면 목록 밖 값은 버리고 이전 값으로 되돌린다
  allowFree?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}

const DROPDOWN_WIDTH = 224;
const MAX_SUGGESTIONS = 8;
const MARGIN = 8; // 뷰포트 가장자리 최소 여백

// 인스펙터 시스템 입력(page.tsx)과 같은 행 문법 / 모달 팝오버 INPUT_CLASS와 같은 필드 문법
const ROW_CLASS =
  "w-32 min-w-0 truncate rounded-sm border border-hairline bg-surface-alt px-1.5 py-0.5 text-right text-caption text-ink placeholder:italic placeholder:text-ink-tertiary focus:border-accent focus:outline-none";
const FIELD_CLASS =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";

export function SuggestInput({
  value, options, onCommit, dataId, placeholder, mode = "field", maxLength = 100, allowFree = true, autoFocus, ariaLabel,
}: SuggestInputProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLUListElement | null>(null);
  // 바깥 값 변경(다른 노드 선택 등) → 초안 동기화. 편집 중엔 사용자 입력을 지킨다 (렌더 중 상태 조정, effect 아님)
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!open) setDraft(value);
  }

  const hits = open
    ? filterByQuery([...options], draft, (item) => [{ field: "value", text: item }])
        .slice(0, MAX_SUGGESTIONS)
        .map((hit) => hit.item)
    : [];

  const closeMenu = () => {
    setOpen(false);
    setPos(null);
    setHighlight(-1);
  };
  const openMenu = () => {
    const el = inputRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = mode === "row" ? rect.right - DROPDOWN_WIDTH : rect.left;
    setPos({
      top: rect.bottom + 4,
      left: Math.max(MARGIN, Math.min(left, window.innerWidth - DROPDOWN_WIDTH - MARGIN)),
    });
    setHighlight(-1);
    setOpen(true);
  };
  const commit = (next: string) => {
    const trimmed = next.trim();
    closeMenu();
    setDraft(trimmed);
    if (trimmed !== value.trim()) onCommit(trimmed);
  };
  // Enter/blur — 하이라이트 항목 > 대소문자 무시 정확 일치(표기 정규화) > 자유값 > 되돌림
  const settle = () => {
    if (highlight >= 0 && highlight < hits.length) {
      commit(hits[highlight]);
      return;
    }
    const key = draft.trim().toLocaleLowerCase();
    const exact = options.find((option) => option.toLocaleLowerCase() === key);
    if (exact !== undefined) {
      commit(exact);
      return;
    }
    if (allowFree || key === "") {
      commit(draft);
      return;
    }
    setDraft(value);
    closeMenu();
  };

  // 스크롤·리사이즈로 앵커가 움직이면 닫는다(fixed 좌표 드리프트 방지). 메뉴 자체 스크롤은 예외
  useEffect(() => {
    if (!open) return undefined;
    const close = (event?: Event) => {
      if (event?.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
      setPos(null);
      setHighlight(-1);
    };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return (
    <>
      <input
        ref={inputRef}
        data-id={dataId}
        role="combobox"
        aria-expanded={open}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        autoComplete="off"
        className={mode === "row" ? ROW_CLASS : FIELD_CLASS}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        title={mode === "row" && draft !== "" ? draft : undefined}
        onFocus={openMenu}
        onChange={(event) => {
          setDraft(event.target.value);
          setHighlight(-1);
          if (!open) openMenu();
        }}
        onBlur={settle}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              openMenu();
              return;
            }
            if (hits.length === 0) return;
            const delta = event.key === "ArrowDown" ? 1 : -1;
            setHighlight((current) => (current + delta + hits.length) % hits.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation(); // 팝오버 전역 Enter 확정·모달 submit과 분리
            settle();
          } else if (event.key === "Escape") {
            event.stopPropagation(); // 모달/인스펙터 Esc 닫힘으로 번지지 않게
            setDraft(value);
            closeMenu();
          } else if (event.key === "Tab") {
            closeMenu(); // 포커스 이동의 blur가 settle
          }
        }}
      />
      {open &&
        pos !== null &&
        createPortal(
          <ul
            ref={menuRef}
            data-id={`${dataId}-menu`}
            role="listbox"
            className="fixed z-[1400] max-h-56 overflow-y-auto rounded-sm border border-hairline bg-surface py-1 shadow-lg"
            style={{ top: pos.top, left: pos.left, width: DROPDOWN_WIDTH }}
          >
            {hits.map((item, index) => (
              <li key={item} role="option" aria-selected={highlight === index}>
                <button
                  type="button"
                  data-id={`${dataId}-option-${index}`}
                  className={`flex w-full items-center px-2 py-1 text-left text-caption ${
                    highlight === index ? "bg-accent-tint text-accent" : "text-ink hover:bg-surface-alt"
                  }`}
                  // mousedown + preventDefault — 포커스가 안 움직여 blur(settle)가 안 나고, 여기서만 확정
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(item);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                >
                  <span className="min-w-0 truncate">{item}</span>
                </button>
              </li>
            ))}
            {hits.length === 0 && (
              <li className="px-2 py-1 text-fine text-ink-tertiary">
                {t(allowFree ? "suggest.noMatchFree" : "suggest.noMatch")}
              </li>
            )}
          </ul>,
          document.body,
        )}
    </>
  );
}
```

- [ ] **Step 2: 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && node scripts/build-component-catalog.mjs`
Expected: clean. `COMPONENTS.md`에 `suggest-input.tsx` 행이 생긴다(사용처는 다음 태스크에서 채워진다).

- [ ] **Step 3: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/suggest-input.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(ui): SuggestInput free-text field with catalog suggestions — 자유입력+제안 드롭다운 공용 엔진"
```

---

### Task 6: 프론트 데이터 배관(역할 필드 왕복·패스스루 보존·diff·Excel)

**Files:**
- Modify: `frontend/src/lib/api.ts:136`(GraphNode.assignee 아래) · `:240`(SubprocessRef.assignee 아래) · `:68`(MapSummary.sp_assignee 아래) · `:530`(SubprocessDesignationBody.assignee 아래)
- Modify: `frontend/src/lib/canvas.ts:40,129,198`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:705,802,864,1713,1754` + `assignee: "",` 리터럴 3곳(4843·5023·5085)
- Modify: `frontend/src/lib/csv-import.ts:184,290,914` · `frontend/src/lib/diff.ts:14,62,88` · `frontend/src/lib/excel-export.ts:18,174,257,302` · `frontend/src/lib/excel-wbs.ts:16,160,184,280`
- Test: `frontend/src/lib/csv-import.test.ts` · `diff.test.ts` · `excel-export.test.ts`

**Interfaces:**
- Produces: `GraphNode.assignee_role?: string`, `SubprocessRef.assignee_role?: string | null`, `MapSummary.sp_assignee_role?: string | null`, `SubprocessDesignationBody.assignee_role?: string`, `NodeData.assignee_role?: string`, `NodeData.spAssigneeRole?: string | null`, `ChangedField "assignee_role"`, Excel `COLUMNS` "Role" 열(Assignee 다음).

- [ ] **Step 1: 실패하는 테스트**

`frontend/src/lib/csv-import.test.ts`:
- `baseGraph()`(436행)의 `id: "a1"` 노드 리터럴에 `assignee_role: "Reviewer",` 추가.
- `it("CSV가 싣지 않는 필드는 언제나 보존한다", ...)`에 `expect(node.assignee_role).toBe("Reviewer");` 추가.
- `it("reuses matched node id and preserves coords/color/group/assignee", ...)`: `const existing = baseNode("n1", "견적 검토", { assignee_role: "Reviewer" });`로 바꾸고 `expect(merged?.assignee_role).toBe("Reviewer"); // 역할은 AI 표면 제외 — 기존 유지` 추가.

`frontend/src/lib/diff.test.ts` 끝:

```ts
describe("computeVersionDiff - assignee_role", () => {
  it("역할 변경을 changedFields로 잡는다", () => {
    const left: VersionGraph = {
      nodes: [{ ...FLAT, id: "r1", title: "Weigh", node_type: "process", assignee_role: "Operator", source_node_id: null }],
      edges: [],
    };
    const right: VersionGraph = {
      nodes: [{ ...FLAT, id: "r2", title: "Weigh", node_type: "process", assignee_role: "Reviewer", source_node_id: "r1" }],
      edges: [],
    };
    const entry = computeVersionDiff(left, right).entries.find((e) => e.title === "Weigh");
    expect(entry?.status).toBe("changed");
    expect(entry?.changedFields).toContain("assignee_role");
  });
});
```

`frontend/src/lib/excel-export.test.ts` `describe("COLUMNS")`의 헤더 기대 배열에서 `"Assignee",` 다음에 `"Role",` 삽입.

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/csv-import.test.ts src/lib/diff.test.ts src/lib/excel-export.test.ts`
Expected: 역할 관련 3~4개 FAIL(타입 에러는 vitest에서 안 잡히므로 값 불일치로 실패).

- [ ] **Step 3: 타입** — `frontend/src/lib/api.ts`

- `GraphNode.assignee: string;` 아래: `assignee_role?: string; // 단일값 역할 — 담당자 옆 표시, CSV/AI 표면 제외(패스스루) (design 2026-09-11)`
- `SubprocessRef.assignee: string | null;` 아래: `assignee_role?: string | null;`
- `MapSummary.sp_assignee?: string | null;` 아래: `sp_assignee_role?: string | null;`
- `SubprocessDesignationBody.assignee?: string;` 아래: `assignee_role?: string;`

`frontend/src/lib/canvas.ts`:
- `NodeData.assignee: string;` 아래: `assignee_role?: string;`
- `spAssignee?: string | null;` 아래: `spAssigneeRole?: string | null;`
- `buildNodeData`의 `assignee: "",` 아래: `assignee_role: "",`

- [ ] **Step 4: page.tsx 변환 5곳 + 리터럴 3곳**

- 705행 부근(그래프→노드 `assignee: node.assignee,`) 아래: `assignee_role: node.assignee_role ?? "",`
- 864행 부근(노드→그래프 `assignee: node.data.assignee,`) 아래: `assignee_role: node.data.assignee_role ?? "",`
- `aiNodeToGraphNode`(802행 `assignee: attr?.assignee ?? "",`) 아래: `assignee_role: "",  // 역할은 AI 표면 제외 — 매칭 노드는 mergeNode가 기존값 보존 (design 2026-09-11 §4.3)`
- 1713행 `spAssignee: ref.assignee,` 아래: `spAssigneeRole: ref.assignee_role ?? null,`
- 1754행 `spAssignee: null,` 아래: `spAssigneeRole: null,`
- `grep -n 'assignee: "",' 'src/app/maps/[mapId]/page.tsx'`로 나오는 신규 노드 data 리터럴 3곳(4843·5023·5085 부근) 각각 바로 아래에 `assignee_role: "",` 추가.

- [ ] **Step 5: csv-import / diff / excel**

`frontend/src/lib/csv-import.ts`:
- `NODE_DEFAULTS`의 `assignee: "",` 아래: `assignee_role: "",  // CSV/AI 표면 제외 — 병합은 기존값 보존 (design 2026-09-11 §4.3)`
- `mergeNode` 반환 객체의 `assignee: pick(next.assignee, existing.assignee),` 아래: `assignee_role: existing.assignee_role ?? "",  // 후보에 열이 없다 — 항상 기존값`
- `buildGraphFromAiProposal`(914행 `assignee: attr?.assignee ?? "",`) 아래: `assignee_role: "",`

`frontend/src/lib/diff.ts`:
- `ChangedField` 유니온 `| "assignee"` 아래 `| "assignee_role"`
- `FIELD_KEYS` `["assignee", "assignee"],` 아래 `["assignee_role", "assignee_role"],`
- `FIELD_MSG` `assignee: "field.assignee",` 아래 `assignee_role: "field.assigneeRole",`

`frontend/src/lib/excel-export.ts`:
- 행 타입 `assignee: string;` 아래 `assignee_role: string;`
- 행 생성(174행) `assignee: node.assignee,` 아래 `assignee_role: node.assignee_role ?? "",`
- `COLUMNS`: `{ header: "Assignee", width: 16 },` 다음에 `{ header: "Role", width: 14 },`
- `sheet.addRow([... row.assignee, row.department, ...])` → `row.assignee, row.assignee_role, row.department,`

`frontend/src/lib/excel-wbs.ts`(헤더는 `COLUMNS.slice(2)` 재사용이라 자동):
- 행 타입 `assignee: string;` 아래 `assignee_role: string;`
- 행 생성 2곳(160·184행) `assignee: node.assignee,` 아래 `assignee_role: node.assignee_role ?? "",`
- `sheet.addRow([row.no, ...levelCells, row.title, row.type, row.description, row.assignee, row.department, ...])` → `row.assignee, row.assignee_role, row.department,`

- [ ] **Step 6: 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint`
Expected: 전부 green(excel-wbs.test는 `COLUMNS.slice(2)`로 헤더를 만들어 자동 통과).

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/lib/api.ts frontend/src/lib/canvas.ts 'frontend/src/app/maps/[mapId]/page.tsx' frontend/src/lib/csv-import.ts frontend/src/lib/csv-import.test.ts frontend/src/lib/diff.ts frontend/src/lib/diff.test.ts frontend/src/lib/excel-export.ts frontend/src/lib/excel-export.test.ts frontend/src/lib/excel-wbs.ts PROGRESS.md
git commit -m "feat(editor): carry assignee_role through graph round-trip, merge pass-through, diff and Excel — 역할 필드 왕복·병합 보존·비교·Excel 열"
```

---

### Task 7: 역할 표시·편집 — 칩·캔버스·인스펙터

**Files:**
- Create: `frontend/src/components/role-chip.tsx`
- Modify: `frontend/src/components/process-node.tsx:100-140`(NodeFields)
- Modify: `frontend/src/components/attribute-read-rows.tsx`
- Modify: `frontend/src/components/bpm-attribute-picker.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10821-10827`(attrsFilled) · `:10858`(AttributeReadRows) · `:10871`(BpmAttributePicker) · `:11013`(SP AttributeReadRows)

**Interfaces:**
- Consumes: `SuggestInput`, `useCatalogs`, `NodeData.assignee_role/spAssigneeRole`.
- Produces: `RoleChip({ role, dataId })`; `AttributeReadRows` prop `assigneeRole?: string`; `BpmAttributePicker` prop `assigneeRole: string`, `onChange` patch에 `assignee_role?: string`.

- [ ] **Step 1: RoleChip** — Create `frontend/src/components/role-chip.tsx`

```tsx
"use client";

// 역할 칩 — 단일 역할(assignee_role)을 캔버스 담당자 줄·인스펙터 읽기 행·타일 값에 표시. 인물 필(AssigneePills,
// 중립 톤 알약)과 한눈에 구분되는 액센트 틴트 사각 라운드 + BriefcaseBusiness 아이콘 (design 2026-09-11 §4.1).

import { BriefcaseBusiness } from "lucide-react";

interface RoleChipProps {
  role: string;
  dataId: string;
}

export function RoleChip({ role, dataId }: RoleChipProps) {
  if (role.trim() === "") return null;
  return (
    <span
      data-id={dataId}
      title={role}
      className="inline-flex max-w-full items-center gap-1 rounded-sm border border-accent-tint-border bg-accent-tint px-1.5 py-0.5 text-fine text-accent"
    >
      <BriefcaseBusiness size={11} strokeWidth={1.5} className="shrink-0" />
      <span className="min-w-0 truncate">{role}</span>
    </span>
  );
}
```

- [ ] **Step 2: 캔버스 담당자 줄** — `frontend/src/components/process-node.tsx`

import 추가: `import { RoleChip } from "@/components/role-chip";` · `import { formatSystem } from "@/lib/catalogs";`

`NodeFields`를 아래로 교체(기존 함수 본문 전체):

```tsx
function NodeFields({ data }: { data: AppNode["data"] }) {
  const { displayFields } = useNodeActions();
  const { t } = useI18n();
  const warnings = useNodeWarnings(data);
  const isSubprocess = data.nodeType === "subprocess";
  if (!hasBpmAttributes(data.nodeType) && !isSubprocess) return null;
  // 경고 줄은 아이콘만 경고색으로 바꾼다(글자색 유지) — 노드가 많아도 캔버스가 경고색으로 안 도배된다
  const warnedFields = {
    department: warnings.some((w) => w.kind === "deptOrphan"),
    assignee: hasAssigneeWarning(warnings),
    system: false,
  };
  const spValues: Record<(typeof ATTR_FIELD_ORDER)[number], string | null | undefined> = {
    assignee: data.spAssignee,
    department: data.spDepartment,
    system: data.spSystem,
  };
  // 역할은 담당자 줄에 같이 — 이름 앞 칩, 별도 토글 없이 assignee 토글에 묶인다 (design 2026-09-11 §4.1)
  const role = (isSubprocess ? data.spAssigneeRole : data.assignee_role) ?? "";
  return (
    <>
      {ATTR_FIELD_ORDER.filter((field) => displayFields.includes(field)).map((field) => {
        const value = (isSubprocess ? spValues[field] : data[field]) ?? "";
        const roleForField = field === "assignee" ? role : "";
        if (!value && !roleForField) return null;
        const warned = warnedFields[field];
        const Icon = warned ? TriangleAlert : FIELD_ICON[field];
        return (
          <div key={field} className="mt-0.5 text-xs text-ink-tertiary">
            <span className="inline-flex items-center gap-1">
              <Icon size={12} strokeWidth={1.5} className={warned ? "text-warn" : undefined} />
              {roleForField !== "" && <RoleChip role={roleForField} dataId="node-role-chip" />}
              {value !== "" && <span>{field === "system" ? formatSystem(value, t("system.other")) : value}</span>}
            </span>
          </div>
        );
      })}
    </>
  );
}
```

- [ ] **Step 3: 읽기 행** — `frontend/src/components/attribute-read-rows.tsx`

import 추가: `import { RoleChip } from "@/components/role-chip";` · `import { formatSystem } from "@/lib/catalogs";`
props 인터페이스 `assignee: string;` 아래: `// 단일 역할 — 담당자 필 앞 칩 (design 2026-09-11)` / `assigneeRole?: string;`
구조분해에 `assigneeRole = "",` 추가. 담당자 행의 값 부분을 교체:

```tsx
        {assignee.trim() !== "" || assigneeRole.trim() !== "" ? (
          <span className="flex min-w-0 flex-wrap items-center justify-end gap-1">
            {assigneeRole.trim() !== "" && <RoleChip role={assigneeRole} dataId={`${dataIdPrefix}-role-chip`} />}
            <AssigneePills assignee={assignee} dataIdPrefix={dataIdPrefix} />
          </span>
        ) : (
          <span className="mt-1 text-caption text-ink">-</span>
        )}
```

시스템 값 `{system || "-"}` → `{formatSystem(system, t("system.other")) || "-"}` (`title`도 같은 표현).

- [ ] **Step 4: 인스펙터 편집 행** — `frontend/src/components/bpm-attribute-picker.tsx`

import: `BriefcaseBusiness` 추가(`lucide-react`), `import { SuggestInput } from "@/components/suggest-input";`, `import { useCatalogs } from "@/lib/catalogs";`
props: `assignee: string;` 아래 `assigneeRole: string;`; `onChange: (patch: { assignee?: string; department?: string; assignee_role?: string }) => void;`
구조분해에 `assigneeRole,` 추가. 본문 상단 `const { t, lang } = useI18n();` 아래 `const { assignee_roles: roleOptions } = useCatalogs();`
담당자 행(`{/* 담당자 — ... */}` div) 바로 아래, 부서 변경 확인 모달 위에 역할 행 추가:

```tsx
      {/* 역할 — 단일값 자유입력 + 관리 목록 자동완성. 부서·담당자 페어 로직과 무관 (design 2026-09-11 §4.1) */}
      <div className={ROW}>
        <span className={LABEL}>
          <BriefcaseBusiness size={12} strokeWidth={1.5} className="text-ink-muted" />
          {t("field.assigneeRole")}
        </span>
        <SuggestInput
          mode="row"
          dataId="inspector-field-role"
          value={assigneeRole}
          options={roleOptions}
          placeholder={t("catalog.rolePlaceholder")}
          ariaLabel={t("field.assigneeRole")}
          onCommit={(next) => onChange({ assignee_role: next })}
        />
      </div>
```

- [ ] **Step 5: page.tsx 배선**

- `attrsFilled` 배열(10821행)에 `selectedNode.data.assignee_role,` 추가(assignee 다음).
- 읽기 전용 `AttributeReadRows`(10858행 `assignee={selectedNode.data.assignee}`) 아래: `assigneeRole={selectedNode.data.assignee_role ?? ""}`
- `BpmAttributePicker`(10871행)에 `assigneeRole={selectedNode.data.assignee_role ?? ""}` 추가. `onChange={(patch) => updateSelectedData(patch, true)}`는 그대로(patch 키가 `NodeData` 키와 같다).
- SP 읽기 `AttributeReadRows`(11013행 `assignee={selectedSpRef.assignee ?? ""}`) 아래: `assigneeRole={selectedSpRef.assignee_role ?? ""}`

- [ ] **Step 6: 게이트 + 카탈로그 재생성**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`
Expected: clean.

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/role-chip.tsx frontend/src/components/process-node.tsx frontend/src/components/attribute-read-rows.tsx frontend/src/components/bpm-attribute-picker.tsx 'frontend/src/app/maps/[mapId]/page.tsx' frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(editor): role chip on the assignee line and a Role row in the inspector — 캔버스 역할 칩·인스펙터 역할 행"
```

---

### Task 8: 역할 타일 — 노드 모달·SP 지정 모달·Usage 탭·SP 표면

**Files:**
- Create: `frontend/src/components/permissions/role-tile.tsx`
- Modify: `frontend/src/components/node-summary-modal.tsx`(NodeEditPatch·Form·FORM_KEYS·props·propsForm·sp 타입·attrTiles·filledAttrCount)
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`(DesignationForm·handleSave·attr 타일·filledAttrCount)
- Modify: `DesignationForm` 생성 4곳 + 초기값 2곳: `subprocess-usage-tab.tsx:50` · `subprocess-inspector-card.tsx:65,178` · `permissions/subprocess-designation-panel.tsx:40,118` · `app/inbox/page.tsx:385`
- Modify: `subprocess-usage-tab.tsx`(읽기 타일) · `subprocess-inspector-card.tsx:229`(attrRows) · `maps/map-detail-sp-section.tsx:350-368`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10419`(NodeSummaryModal props)

**Interfaces:**
- Produces: `RoleTile({ value, readOnly?, dataIdPrefix, labels, placeholder?, onChange })`, `DesignationForm.assignee_role: string`, `NodeSummaryModal` prop `assigneeRole: string`, `sp.assignee_role?: string | null`.

- [ ] **Step 1: RoleTile** — Create `frontend/src/components/permissions/role-tile.tsx`

```tsx
"use client";

// 역할 타일 — 부서·담당자 타일 옆 단일값 역할(assignee_role). 클릭 위치 팝오버 안 SuggestInput(관리 목록 자동완성).
// DeptAssigneeTiles와 분리한 이유: 역할은 부서 페어(addAssignee)와 무관하다 (design 2026-09-11 §4.1).
// 노드 편집 모달·SP 지정 모달(편집)·Subprocess 탭·노드 모달 SP 상속(읽기)이 공유.

import { BriefcaseBusiness } from "lucide-react";
import { useState } from "react";

import { SpFieldPopover } from "@/components/permissions/sp-field-popover";
import { SpFieldTile } from "@/components/permissions/sp-field-tile";
import type { PopoverActionLabels } from "@/components/popover-action-bar";
import { RoleChip } from "@/components/role-chip";
import { SuggestInput } from "@/components/suggest-input";
import { useCatalogs } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n";

interface RoleTileProps {
  value: string;
  readOnly?: boolean;
  // data-id 접두 — `${prefix}-role` / `${prefix}-role-chip` / `${prefix}-popover-role` / `${prefix}-role-input`
  dataIdPrefix: string;
  labels: PopoverActionLabels;
  // 읽기 전용에서 빈 값도 타일로 남길 때의 안내("미입력") — 없으면 빈 타일은 숨긴다
  placeholder?: string;
  onChange: (next: string) => void;
}

export function RoleTile({ value, readOnly = false, dataIdPrefix, labels, placeholder, onChange }: RoleTileProps) {
  const { t } = useI18n();
  const { assignee_roles: roleOptions } = useCatalogs();
  // 팝오버 로컬 초안 — 확정 시에만 부모에 반영, Esc면 폐기
  const [active, setActive] = useState<{ at: { x: number; y: number }; draft: string } | null>(null);
  if (readOnly && value === "" && !placeholder) return null;
  const tile = (
    <SpFieldTile
      dataId={`${dataIdPrefix}-role`}
      icon={BriefcaseBusiness}
      label={t("field.assigneeRole")}
      value=""
      valueNode={value !== "" ? <RoleChip role={value} dataId={`${dataIdPrefix}-role-chip`} /> : undefined}
      placeholder={placeholder}
      wide
      readOnly={readOnly}
      active={active !== null}
      onOpen={(at) => setActive({ at, draft: value })}
    />
  );
  if (readOnly || active === null) return tile;
  const dirty = active.draft !== value;
  const apply = () => onChange(active.draft.trim());
  return (
    <>
      {tile}
      <SpFieldPopover
        dataId={`${dataIdPrefix}-popover-role`}
        anchor={active.at}
        title={t("field.assigneeRole")}
        hint={t("sp.tile.hint.role")}
        width={320}
        dirty={dirty}
        // 입력 안 Enter는 제안 확정 — 전역 Enter 확정을 끈다(DeptAssigneeTiles와 동일)
        enterCommits={false}
        onApply={apply}
        onCommit={() => {
          apply();
          setActive(null);
        }}
        onCancel={() => setActive(null)}
        labels={labels}
      >
        <SuggestInput
          mode="field"
          autoFocus
          dataId={`${dataIdPrefix}-role-input`}
          value={active.draft}
          options={roleOptions}
          placeholder={t("catalog.rolePlaceholder")}
          ariaLabel={t("field.assigneeRole")}
          onCommit={(next) => setActive((prev) => (prev ? { ...prev, draft: next } : prev))}
        />
      </SpFieldPopover>
    </>
  );
}
```

- [ ] **Step 2: 노드 편집 모달** — `frontend/src/components/node-summary-modal.tsx`

- import: `import { RoleTile } from "@/components/permissions/role-tile";`
- `NodeEditPatch`의 `assignee: string;` 아래 `assignee_role: string;`
- `Form`의 `assignee: string;` 아래 `assignee_role: string;`; `FORM_KEYS` 배열에 `"assignee"` 다음 `"assignee_role"`
- props 인터페이스 `assignee: string;` 아래 `// 단일 역할 — 담당자 타일 옆 역할 타일 (design 2026-09-11)` / `assigneeRole: string;`; 구조분해(505행 부근 `assignee,`)에 `assigneeRole,` 추가
- `sp?: { ... assignee?: string | null;` 아래 `assignee_role?: string | null;`
- `propsForm`에 `assignee_role: assigneeRole,` (assignee 다음)
- `filledAttrCount`: SP 분기 배열에 `sp?.assignee_role ?? ""` 추가, 일반 분기에 `form.assignee_role` 추가
- `attrTiles` SP 분기: `<DeptAssigneeTiles ... />` 바로 아래 `<RoleTile value={sp?.assignee_role ?? ""} readOnly dataIdPrefix="summary-tile" labels={labels} onChange={() => {}} />`
- `attrTiles` 편집 분기: `<DeptAssigneeTiles ... onChange={(patch) => patchLive(patch)} />` 바로 아래
  `<RoleTile value={form.assignee_role} readOnly={readOnly} dataIdPrefix="summary-tile" labels={labels} onChange={(next) => patchLive({ assignee_role: next })} />`

`page.tsx` 10419행 `assignee={node.data.assignee}` 아래: `assigneeRole={node.data.assignee_role ?? ""}`.

- [ ] **Step 3: SP 지정 모달** — `subprocess-designation-modal.tsx`

- import `RoleTile`.
- `DesignationForm.assignee: string;` 아래 `assignee_role: string;`
- `filledAttrCount` 배열에 `form.assignee_role` 추가.
- `handleSave` payload `assignee: form.assignee,` 아래 `assignee_role: form.assignee_role.trim(),`
- 속성 타일 그리드: `<DeptAssigneeTiles ... onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />` 아래
  `<RoleTile value={form.assignee_role} dataIdPrefix="sp-tile" labels={labels} onChange={(next) => setForm((prev) => ({ ...prev, assignee_role: next }))} />`

`DesignationForm` 생성/초기값 6곳 — 각 `assignee: ...` 줄 아래 한 줄:
- `subprocess-usage-tab.tsx` `toDesignationForm`: `assignee_role: detail.sp_assignee_role ?? "",`
- `subprocess-inspector-card.tsx` 65행 초기값: `assignee_role: "",`; 178행: `assignee_role: detail.sp_assignee_role ?? "",`
- `permissions/subprocess-designation-panel.tsx` 40행 초기값: `assignee_role: "",`; 118행: `assignee_role: detail?.sp_assignee_role ?? "",`
- `app/inbox/page.tsx` 385행: `assignee_role: spModal.detail.sp_assignee_role ?? "",`

- [ ] **Step 4: 읽기 표면**

`subprocess-usage-tab.tsx`: import `RoleTile`; `<DeptAssigneeTiles ... readOnly placeholder={notSet} ... />` 아래
`<RoleTile value={form.assignee_role} readOnly placeholder={notSet} dataIdPrefix="sp-usage-tile" labels={labels} onChange={() => {}} />`

`subprocess-inspector-card.tsx` `attrRows`: `{ label: t("field.assignee"), value: detail.sp_assignee },` 아래 `{ label: t("field.assigneeRole"), value: detail.sp_assignee_role },`

`maps/map-detail-sp-section.tsx`: import `RoleChip`; 담당자 타일에서
- `const names = parseAssignees(str(detail.sp_assignee));` 아래 `const role = str(detail.sp_assignee_role);`
- `data-filled={names.length > 0 ? ...}`와 톤 조건을 `const assigneeFilled = names.length > 0 || role !== "";`로 묶어 `assigneeFilled` 사용(`vertHead(..., assigneeFilled, ...)` 포함).
- `{names.length > 0 && (<div className="min-h-0">` 블록을 아래로 교체:

```tsx
                      {assigneeFilled && (
                        <div className="flex min-h-0 flex-wrap items-start gap-1">
                          {role !== "" && <RoleChip role={role} dataId="map-detail-sp-role-chip" />}
                          {/* 인물 필 — 호버 0.7초/클릭으로 인물 카드(이름·아이디·말단 부서·조직 경로), 줄바꿈 나열 */}
                          {names.length > 0 && <AssigneePills assignee={str(detail.sp_assignee)} dataIdPrefix="map-detail-sp" align="start" />}
                        </div>
                      )}
```

- [ ] **Step 5: 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`
Expected: clean. tsc가 `DesignationForm` 누락 지점을 잡으면 그 자리에 `assignee_role`를 채운다.

- [ ] **Step 6: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/permissions/role-tile.tsx frontend/src/components/node-summary-modal.tsx frontend/src/components/permissions/subprocess-designation-modal.tsx frontend/src/components/subprocess-usage-tab.tsx frontend/src/components/subprocess-inspector-card.tsx frontend/src/components/permissions/subprocess-designation-panel.tsx frontend/src/app/inbox/page.tsx frontend/src/components/maps/map-detail-sp-section.tsx 'frontend/src/app/maps/[mapId]/page.tsx' frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(sp): role tile in node and designation modals, inherited on subprocess surfaces — 역할 타일(노드·SP 지정)·상속 표시"
```

---

### Task 9: 시스템 정규화 — 입력 교체·Other 표시

**Files:**
- Create: `frontend/src/components/system-suggest-input.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10876-10904`(인스펙터 시스템 행)
- Modify: `frontend/src/components/node-summary-modal.tsx`(ActiveTile.keptNote·FallbackHint onApply·팝오버 system 입력·tileValue)
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`(ActiveTile.keptNote·팝오버 system 입력·tileValue)
- Modify: `subprocess-usage-tab.tsx:302` · `subprocess-inspector-card.tsx:230` · `maps/map-detail-sp-section.tsx:375` · `subprocess-preview-peek.tsx:297,338`

**Interfaces:**
- Consumes: `commitSystem`, `formatSystem`, `OTHER_SYSTEM`, `useCatalogs`, `SuggestInput`, `ConfirmDialog`(`@/components/confirm-dialog`, props `title/message/confirmLabel/cancelLabel/onConfirm/onClose`).
- Produces: `SystemSuggestInput({ system, systemFallback, mode, dataId, confirmReplace?, autoFocus?, onCommit(patch, keptNote) })`.

- [ ] **Step 1: SystemSuggestInput** — Create `frontend/src/components/system-suggest-input.tsx`

```tsx
"use client";

// 시스템 입력 — SuggestInput(관리 목록 자동완성) + 커밋 정규화(commitSystem): 목록 일치=표기 저장, 자유값=Other +
// 원문 메모(system_fallback). 기존 메모가 다른 내용이면 confirmReplace 표면(인스펙터 행)은 ConfirmDialog로
// 교체/유지를 묻고, 타일 팝오버(메모 칸이 같이 보임)는 keptNote만 알려 안내문을 띄운다 (design 2026-09-11 §4.2).
// 인스펙터 시스템 행·노드 편집 모달·SP 지정 모달 시스템 팝오버가 공유.

import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SuggestInput } from "@/components/suggest-input";
import { commitSystem, OTHER_SYSTEM, useCatalogs } from "@/lib/catalogs";
import { useI18n } from "@/lib/i18n";

interface SystemSuggestInputProps {
  system: string;
  systemFallback: string;
  mode: "row" | "field";
  dataId: string;
  // true면 기존 원문 메모가 다를 때 교체 확인 다이얼로그(인스펙터 행). false면 keptNote로만 알린다(팝오버)
  confirmReplace?: boolean;
  autoFocus?: boolean;
  onCommit: (patch: { system: string; system_fallback: string }, keptNote: boolean) => void;
}

export function SystemSuggestInput({
  system, systemFallback, mode, dataId, confirmReplace = false, autoFocus, onCommit,
}: SystemSuggestInputProps) {
  const { t } = useI18n();
  const { systems } = useCatalogs();
  // 원문 메모 교체 확인 대기 중인 입력값
  const [pending, setPending] = useState<string | null>(null);

  const handleCommit = (raw: string) => {
    const result = commitSystem(raw, systems, systemFallback);
    if (result.keptNote && confirmReplace) {
      setPending(raw.trim());
      return;
    }
    onCommit({ system: result.system, system_fallback: result.system_fallback }, result.keptNote);
  };

  return (
    <>
      <SuggestInput
        mode={mode}
        dataId={dataId}
        value={system}
        options={systems}
        maxLength={100}
        autoFocus={autoFocus}
        placeholder={t("catalog.systemPlaceholder")}
        ariaLabel={t("field.system")}
        onCommit={handleCommit}
      />
      {pending !== null && (
        <ConfirmDialog
          title={t("catalog.systemReplaceNoteTitle")}
          message={t("catalog.systemReplaceNoteBody", { value: pending })}
          confirmLabel={t("catalog.systemReplaceNoteConfirm")}
          cancelLabel={t("catalog.systemKeepNote")}
          onConfirm={() => {
            onCommit({ system: OTHER_SYSTEM, system_fallback: pending }, false);
            setPending(null);
          }}
          onClose={() => {
            onCommit({ system: OTHER_SYSTEM, system_fallback: systemFallback }, true);
            setPending(null);
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: 인스펙터** — `page.tsx`

- import 추가: `import { SystemSuggestInput } from "@/components/system-suggest-input";` · `import { commitSystem, useCatalogs } from "@/lib/catalogs";`
- 에디터 컴포넌트 본문 상단(다른 훅들 옆)에 `const { systems: systemCatalog } = useCatalogs();`
- 시스템 행의 `<input data-id="inspector-field-system" ... />` 전체를 교체:

```tsx
                            <SystemSuggestInput
                              mode="row"
                              dataId="inspector-field-system"
                              confirmReplace
                              system={selectedNode.data.system ?? ""}
                              systemFallback={selectedNode.data.system_fallback ?? ""}
                              onCommit={(patch) => updateSelectedData(patch, true)}
                            />
```

- 같은 행 `FallbackHint`의 `onApply`를 교체(원문→대표값도 정규화 통과):

```tsx
                                onApply={() => {
                                  const note = selectedNode.data.system_fallback ?? "";
                                  const result = commitSystem(note, systemCatalog, note);
                                  updateSelectedData({ system: result.system, system_fallback: result.system_fallback }, true);
                                }}
```

- [ ] **Step 3: 노드 편집 모달** — `node-summary-modal.tsx`

- import: `SystemSuggestInput`, `import { commitSystem, formatSystem, useCatalogs } from "@/lib/catalogs";`
- `ActiveTile`에 `keptNote?: boolean; // 시스템 자유값 커밋에서 기존 원문 메모를 유지했다 — 팝오버 안내문` 추가.
- 컴포넌트 상단 `const { systems: systemCatalog } = useCatalogs();`
- `tileValue`의 `case "system":`을 `case "start_condition"/"end_condition"` 묶음에서 떼어 `case "system": return formatSystem(form.system, t("system.other"));`
- `noteIcon`의 시스템 `FallbackHint onApply`: `() => { const r = commitSystem(form.system_fallback, systemCatalog, form.system_fallback); patchLive({ system: r.system, system_fallback: r.system_fallback }); }`
- `renderPopover`: `{(field === "system" || field === "start_condition" || field === "end_condition") && (<input .../>)}` 조건에서 `"system"`을 빼고, 그 위에 추가:

```tsx
        {field === "system" && (
          <div className="flex flex-col gap-1">
            <SystemSuggestInput
              mode="field"
              autoFocus
              dataId="summary-tile-input-system"
              system={active.value}
              systemFallback={active.note}
              onCommit={(patch, keptNote) =>
                setActive((prev) => (prev ? { ...prev, value: patch.system, note: patch.system_fallback, keptNote } : prev))
              }
            />
            {active.keptNote && (
              <p data-id="summary-tile-system-kept-note" className="text-fine text-ink-tertiary">{t("catalog.systemKeptNote")}</p>
            )}
          </div>
        )}
```

(SP 상속 표시 `spSystem`은 `formatSystem(sp?.system ?? "", t("system.other"))`로.)

- [ ] **Step 4: SP 지정 모달** — `subprocess-designation-modal.tsx`

- import `SystemSuggestInput`, `formatSystem`.
- `ActiveTile`에 `keptNote?: boolean;`.
- `tileValue`: `case "system": return formatSystem(form.system, t("system.other"));`로 분리.
- `renderPopover`의 `(field === "system" || ...)` 입력에서 `"system"`을 빼고 위에 추가:

```tsx
        {field === "system" && (
          <div className="flex flex-col gap-1">
            <SystemSuggestInput
              mode="field"
              autoFocus
              dataId="sp-tile-input-system"
              system={active.value}
              systemFallback={active.note}
              onCommit={(patch, keptNote) =>
                setActive((prev) => (prev ? { ...prev, value: patch.system, note: patch.system_fallback, keptNote } : prev))
              }
            />
            {active.keptNote && (
              <p data-id="sp-tile-system-kept-note" className="text-fine text-ink-tertiary">{t("catalog.systemKeptNote")}</p>
            )}
          </div>
        )}
```

- [ ] **Step 5: 표시 4곳 Other 라벨** (각 파일에 `import { formatSystem } from "@/lib/catalogs";`)

- `subprocess-usage-tab.tsx` 302행: `valueOrNote(form.system, form.system_fallback)` → `valueOrNote(formatSystem(form.system, t("system.other")), form.system_fallback)`
- `subprocess-inspector-card.tsx` 230행: `value: detail.sp_system` → `value: formatSystem(detail.sp_system, t("system.other"))`
- `maps/map-detail-sp-section.tsx` 375행: `str(detail.sp_system)` → `formatSystem(str(detail.sp_system), t("system.other"))`
- `subprocess-preview-peek.tsx` 297·338행: `info.system ?? ""` → `formatSystem(info.system, t("system.other"))` (두 곳 모두 `t`가 이미 스코프에 있음을 확인; 없으면 `useI18n` 반환값에서 꺼낸다)

- [ ] **Step 6: 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`
Expected: clean.

- [ ] **Step 7: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/components/system-suggest-input.tsx 'frontend/src/app/maps/[mapId]/page.tsx' frontend/src/components/node-summary-modal.tsx frontend/src/components/permissions/subprocess-designation-modal.tsx frontend/src/components/subprocess-usage-tab.tsx frontend/src/components/subprocess-inspector-card.tsx frontend/src/components/maps/map-detail-sp-section.tsx frontend/src/components/subprocess-preview-peek.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(editor): system field normalized against the catalog, free values become Other with a source note — 시스템 목록 정규화(자유값→기타+원문 메모)"
```

---

### Task 10: 설정 Catalogs 탭(CSV 임포트 포함)

**Files:**
- Create: `frontend/src/lib/catalog-csv.ts` (+ `catalog-csv.test.ts`)
- Create: `frontend/src/components/settings/catalogs-panel.tsx`
- Modify: `frontend/src/app/settings/page.tsx:38-55`(TabId) · `:76-85`(CATEGORIES 조직 카테고리) · `:293`(패널 분기) · import
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `csv-import.decodeCsvBuffer/parseCsvRecords`, `api.getAppSettings/putAppSettings/getCatalogs`, `CheckInput`, `invalidateCatalogs`, `OTHER_SYSTEM`.
- Produces: `parseCatalogCsv(text): string[]`, `mergeCatalogValues(current, incoming): { next; added; duplicates }`, `CatalogsPanel({ isSysadmin, onToast })`, 탭 id `"catalogs"`.
- i18n 키: `catalog.tab`, `catalog.pageHint`, `catalog.readOnly`, `catalog.loading`, `catalog.rolesTitle`, `catalog.rolesHint`, `catalog.systemsTitle`, `catalog.systemsHint`, `catalog.empty`, `catalog.addPlaceholder`, `catalog.add`, `catalog.remove`, `catalog.otherLocked`, `catalog.inUse`, `catalog.importCsv`, `catalog.importResult`, `catalog.save`, `catalog.saved`.

- [ ] **Step 1: 실패하는 테스트** — Create `frontend/src/lib/catalog-csv.test.ts`

```ts
// 카탈로그 CSV 임포트 — 1열 파싱(헤더 value 허용)·대소문자 무시 병합 (설정 Catalogs 탭)
import { describe, expect, it } from "vitest";

import { mergeCatalogValues, parseCatalogCsv } from "./catalog-csv";

describe("parseCatalogCsv", () => {
  it("reads the first column, skips a value header and blank lines", () => {
    expect(parseCatalogCsv("value\r\n실험자\r\n\r\n 검토자 ,ignored\r\n")).toEqual(["실험자", "검토자"]);
  });
  it("accepts a headerless file", () => {
    expect(parseCatalogCsv("LIMS\nSAP\n")).toEqual(["LIMS", "SAP"]);
  });
});

describe("mergeCatalogValues", () => {
  it("appends new values, counts duplicates case-insensitively and keeps the existing spelling", () => {
    const { next, added, duplicates } = mergeCatalogValues(["LIMS"], ["lims", "SAP", " SAP ", ""]);
    expect(next).toEqual(["LIMS", "SAP"]);
    expect(added).toBe(1);
    expect(duplicates).toBe(2);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalog-csv.test.ts`
Expected: FAIL(module not found).

- [ ] **Step 3: lib/catalog-csv.ts** — Create

```ts
// 카탈로그 CSV 임포트 순수 함수 — 1열 값 목록 파싱·대소문자 무시 병합(설정 Catalogs 탭). 파서는 csv-import
// parseCsvRecords(RFC4180) 재사용. 헤더 "value"(대소문자 무시)는 건너뛰고 각 레코드 첫 셀만 읽는다.

import { parseCsvRecords } from "@/lib/csv-import";

const ITEM_MAX_LEN = 100; // 서버 MANAGED_ITEM_MAX_LEN과 동일

export function parseCatalogCsv(text: string): string[] {
  const values = parseCsvRecords(text)
    .map((record) => (record.cells[0] ?? "").trim())
    .filter((value) => value !== "");
  if (values.length > 0 && values[0].toLocaleLowerCase() === "value") values.shift();
  return values;
}

export function mergeCatalogValues(
  current: readonly string[],
  incoming: readonly string[],
): { next: string[]; added: number; duplicates: number } {
  const next = [...current];
  const seen = new Set(current.map((value) => value.toLocaleLowerCase()));
  let added = 0;
  let duplicates = 0;
  for (const raw of incoming) {
    const value = raw.trim().slice(0, ITEM_MAX_LEN);
    if (value === "") continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) {
      duplicates += 1;
      continue;
    }
    seen.add(key);
    next.push(value);
    added += 1;
  }
  return { next, added, duplicates };
}
```

- [ ] **Step 4: i18n 키**

`en` `"admin.exposedPositionsSaved"` 아래:

```ts
  "catalog.tab": "Catalogs",
  "catalog.pageHint": "Suggestion lists for node fields. Roles are free text with suggestions; systems outside the list are saved as Other with a source note.",
  "catalog.readOnly": "Only system administrators can edit these lists.",
  "catalog.loading": "Loading catalogs…",
  "catalog.rolesTitle": "Roles",
  "catalog.rolesHint": "Suggested in the node Role field (e.g. Operator, Reviewer).",
  "catalog.systemsTitle": "Systems",
  "catalog.systemsHint": "Canonical system names. \"Other\" is reserved and cannot be removed.",
  "catalog.empty": "No entries yet.",
  "catalog.addPlaceholder": "Type a value and press Enter",
  "catalog.add": "Add",
  "catalog.remove": "Remove",
  "catalog.otherLocked": "reserved",
  "catalog.inUse": "Values in use - check to add to the list",
  "catalog.importCsv": "Import CSV",
  "catalog.importResult": "Added {added}, skipped {duplicates} duplicate(s).",
  "catalog.save": "Save",
  "catalog.saved": "{title} saved.",
```

`ko` 같은 자리:

```ts
  "catalog.tab": "카탈로그",
  "catalog.pageHint": "노드 필드의 제안 목록입니다. 역할은 자유 입력+제안, 목록 밖 시스템은 기타로 저장되고 원문 메모에 남습니다.",
  "catalog.readOnly": "시스템 관리자만 목록을 편집할 수 있습니다.",
  "catalog.loading": "카탈로그 불러오는 중…",
  "catalog.rolesTitle": "역할",
  "catalog.rolesHint": "노드 역할 필드에서 제안됩니다(예: 실험자, 검토자).",
  "catalog.systemsTitle": "시스템",
  "catalog.systemsHint": "정식 시스템 이름 목록. \"Other\"는 예약 항목이라 삭제할 수 없습니다.",
  "catalog.empty": "항목이 없습니다.",
  "catalog.addPlaceholder": "값을 입력하고 Enter",
  "catalog.add": "추가",
  "catalog.remove": "삭제",
  "catalog.otherLocked": "예약",
  "catalog.inUse": "사용 중인 값 - 체크하면 목록에 추가됩니다",
  "catalog.importCsv": "CSV 임포트",
  "catalog.importResult": "{added}건 추가, 중복 {duplicates}건 제외.",
  "catalog.save": "저장",
  "catalog.saved": "{title} 목록을 저장했습니다.",
```

- [ ] **Step 5: 패널** — Create `frontend/src/components/settings/catalogs-panel.tsx`

```tsx
"use client";

// 관리 목록(카탈로그) 탭 — 역할·시스템 자동완성 목록을 sysadmin이 편집(칩 삭제·직접 추가·사용 중 값 승격·CSV 임포트·저장).
// 저장 API(/admin/app-settings)는 sysadmin 전용 — 비sysadmin은 /catalogs로 읽기 전용 표시 (design 2026-09-11 §5).

import { Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { CheckInput } from "@/components/check-input";
import { getAppSettings, getCatalogs, putAppSettings } from "@/lib/api";
import { humanizeApiError } from "@/lib/api-errors";
import { mergeCatalogValues, parseCatalogCsv } from "@/lib/catalog-csv";
import { invalidateCatalogs, OTHER_SYSTEM } from "@/lib/catalogs";
import { decodeCsvBuffer } from "@/lib/csv-import";
import { useI18n } from "@/lib/i18n";

interface Lists {
  assignee_roles: string[];
  systems: string[];
  available_systems: string[];
}

interface CatalogsPanelProps {
  isSysadmin: boolean;
  onToast: (message: string) => void;
}

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-1.5 text-caption text-ink outline-none placeholder:italic placeholder:text-ink-tertiary focus:border-accent";
const SECONDARY_BUTTON =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border border-hairline px-2 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface ManagedListCardProps {
  dataId: string;
  title: string;
  hint: string;
  values: string[];
  // 삭제 불가 항목(시스템 Other)
  lockedValues?: readonly string[];
  // 사용 중 값 후보 — 체크하면 목록에 추가(시스템 카드만)
  available?: string[];
  readOnly: boolean;
  onSave: (next: string[]) => Promise<string[]>;
  onToast: (message: string) => void;
}

function ManagedListCard({
  dataId, title, hint, values, lockedValues = [], available = [], readOnly, onSave, onToast,
}: ManagedListCardProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string[]>(values);
  // 서버 값이 바뀌면(저장·재조회) 초안을 새 값으로 — 렌더 중 상태 조정
  const [seen, setSeen] = useState(values);
  if (values !== seen) {
    setSeen(values);
    setDraft(values);
  }
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNote, setImportNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const dirty = draft.join(" ") !== values.join(" ");
  const isLocked = (value: string) => lockedValues.some((locked) => locked.toLocaleLowerCase() === value.toLocaleLowerCase());
  const has = (value: string) => draft.some((item) => item.toLocaleLowerCase() === value.trim().toLocaleLowerCase());
  const addValues = (incoming: string[]) => {
    const result = mergeCatalogValues(draft, incoming);
    setDraft(result.next);
    return result;
  };
  const handleAdd = () => {
    if (adding.trim() === "") return;
    addValues([adding]);
    setAdding("");
  };
  const handleFile = async (file: File) => {
    const text = decodeCsvBuffer(await file.arrayBuffer());
    const { added, duplicates } = addValues(parseCatalogCsv(text));
    setImportNote(t("catalog.importResult", { added, duplicates }));
  };
  const handleSave = async () => {
    setBusy(true);
    try {
      const saved = await onSave(draft);
      setDraft(saved);
      invalidateCatalogs();
      onToast(t("catalog.saved", { title }));
    } catch (err) {
      onToast(humanizeApiError(err, t));
    } finally {
      setBusy(false);
    }
  };
  const candidates = available.filter((value) => !has(value));

  return (
    <section data-id={dataId} className="flex flex-col gap-3 rounded-md border border-hairline bg-surface-alt p-4">
      <div>
        <p className="text-caption-strong text-ink">{title}</p>
        <p className="text-fine text-ink-tertiary">{hint}</p>
      </div>
      <div className="flex flex-wrap gap-1.5" data-id={`${dataId}-chips`}>
        {draft.length === 0 && <span className="text-fine text-ink-tertiary">{t("catalog.empty")}</span>}
        {draft.map((value) => {
          const locked = isLocked(value);
          return (
            <span
              key={value}
              data-id={`${dataId}-chip`}
              className="inline-flex items-center gap-1 rounded-sm border border-hairline bg-surface px-2 py-0.5 text-caption text-ink"
            >
              {value}
              {locked && <span className="text-fine text-ink-tertiary">{t("catalog.otherLocked")}</span>}
              {!readOnly && !locked && (
                <button
                  type="button"
                  aria-label={t("catalog.remove")}
                  className="text-ink-tertiary hover:text-ink"
                  onClick={() => setDraft((prev) => prev.filter((item) => item !== value))}
                >
                  <X size={11} strokeWidth={1.5} />
                </button>
              )}
            </span>
          );
        })}
      </div>
      {!readOnly && (
        <>
          <div className="flex items-center gap-2">
            <input
              data-id={`${dataId}-add-input`}
              className={INPUT_CLASS}
              value={adding}
              placeholder={t("catalog.addPlaceholder")}
              maxLength={100}
              onChange={(event) => setAdding(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleAdd();
                }
              }}
            />
            <button type="button" data-id={`${dataId}-add`} className={SECONDARY_BUTTON} disabled={adding.trim() === ""} onClick={handleAdd}>
              <Plus size={14} strokeWidth={1.5} />
              {t("catalog.add")}
            </button>
            <button type="button" data-id={`${dataId}-import`} className={SECONDARY_BUTTON} onClick={() => fileRef.current?.click()}>
              <Upload size={14} strokeWidth={1.5} />
              {t("catalog.importCsv")}
            </button>
            <input
              ref={fileRef}
              data-id={`${dataId}-file`}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = ""; // 같은 파일 재선택 허용
              }}
            />
          </div>
          {importNote !== "" && (
            <p data-id={`${dataId}-import-note`} className="text-fine text-ink-tertiary">{importNote}</p>
          )}
          {candidates.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="text-fine text-ink-secondary">{t("catalog.inUse")}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5" data-id={`${dataId}-candidates`}>
                {candidates.map((value) => (
                  <label key={value} className="flex cursor-pointer items-center gap-1.5 text-caption text-ink-secondary">
                    <CheckInput checked={false} onChange={() => addValues([value])} />
                    {value}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              data-id={`${dataId}-save`}
              disabled={busy || !dirty}
              className="rounded-sm bg-accent px-3 py-1.5 text-caption font-semibold text-on-accent hover:bg-accent-focus disabled:opacity-40"
              onClick={() => void handleSave()}
            >
              {t("catalog.save")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

export function CatalogsPanel({ isSysadmin, onToast }: CatalogsPanelProps) {
  const { t } = useI18n();
  const [lists, setLists] = useState<Lists | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // 편집 권한이 있으면 후보(available_systems)까지 실린 관리자 응답, 아니면 읽기 전용 /catalogs
    const load: Promise<Lists> = isSysadmin
      ? getAppSettings().then((s) => ({ assignee_roles: s.assignee_roles, systems: s.systems, available_systems: s.available_systems }))
      : getCatalogs().then((c) => ({ ...c, available_systems: [] }));
    void load
      .then((next) => {
        if (alive) setLists(next);
      })
      .catch((err) => {
        if (alive) setError(humanizeApiError(err, t));
      });
    return () => {
      alive = false;
    };
  }, [isSysadmin, t]);

  const save = async (patch: { assignee_roles?: string[]; systems?: string[] }): Promise<string[]> => {
    const saved = await putAppSettings(patch);
    setLists({ assignee_roles: saved.assignee_roles, systems: saved.systems, available_systems: saved.available_systems });
    return patch.assignee_roles !== undefined ? saved.assignee_roles : saved.systems;
  };

  if (error !== null) return <p className="text-caption text-error">{error}</p>;
  if (lists === null) return <p className="text-caption text-ink-tertiary">{t("catalog.loading")}</p>;
  return (
    <div className="flex max-w-3xl flex-col gap-6" data-id="catalogs-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("catalog.tab")}</h2>
        <p className="text-caption text-ink-tertiary">{isSysadmin ? t("catalog.pageHint") : t("catalog.readOnly")}</p>
      </div>
      <ManagedListCard
        dataId="catalog-roles"
        title={t("catalog.rolesTitle")}
        hint={t("catalog.rolesHint")}
        values={lists.assignee_roles}
        readOnly={!isSysadmin}
        onSave={(next) => save({ assignee_roles: next })}
        onToast={onToast}
      />
      <ManagedListCard
        dataId="catalog-systems"
        title={t("catalog.systemsTitle")}
        hint={t("catalog.systemsHint")}
        values={lists.systems}
        lockedValues={[OTHER_SYSTEM]}
        available={lists.available_systems}
        readOnly={!isSysadmin}
        onSave={(next) => save({ systems: next })}
        onToast={onToast}
      />
    </div>
  );
}
```

- [ ] **Step 6: 설정 페이지 탭** — `frontend/src/app/settings/page.tsx`

- import: `import { CatalogsPanel } from "@/components/settings/catalogs-panel";`
- `TabId` 유니온에 `| "catalogs"` 추가.
- `CATEGORIES`의 `admin.catDirectory` 카테고리 `tabs`에서 `{ id: "depts", labelKey: "perm.sysadmin.tabDepts" },` 다음에 `{ id: "catalogs", labelKey: "catalog.tab" },`
- 패널 분기 `{current === "depts" && <DepartmentTable />}` 아래:

```tsx
          {current === "catalogs" && (
            <CatalogsPanel
              isSysadmin={user?.isSysadmin ?? false}
              onToast={(message) => showToast({ id: genId(), message })}
            />
          )}
```

- [ ] **Step 7: 게이트**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx vitest run src/lib/catalog-csv.test.ts && npx tsc --noEmit -p tsconfig.json && npm run lint && node scripts/build-component-catalog.mjs`
Expected: clean.

- [ ] **Step 8: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/src/lib/catalog-csv.ts frontend/src/lib/catalog-csv.test.ts frontend/src/components/settings/catalogs-panel.tsx frontend/src/app/settings/page.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(settings): Catalogs tab to manage role and system lists with CSV import — 설정 Catalogs 탭(역할·시스템 목록, CSV 임포트)"
```

---

### Task 11: Playwright 스모크 + 문서 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-assignee-role.mjs`
- Modify: `CLAUDE.md`(Lessons 노드 속성 체크리스트 줄 끝에 카탈로그 한 문장) · `docs/design/2026-08-24-data-surface-parity-design.md`(후속 항목) · `docs/design/README.md`·`docs/README.md`(상태를 "dev 구현 완료"로) · `PROGRESS.md`

**Interfaces:**
- Consumes: 백엔드 8000 + 프론트 3000 네이티브 기동, dev 인증 `X-Dev-User: admin.sys` / localStorage `bpm.devUser`.

- [ ] **Step 1: 서버 기동 확인**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && (curl -sf http://localhost:8000/api/catalogs -H 'X-Dev-User: admin.sys' >/dev/null && echo backend-up) || echo "backend down: start with .venv/bin/uvicorn app.main:app --reload --port 8000"
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && (curl -sf http://localhost:3000 >/dev/null && echo frontend-up) || echo "frontend down: start with npm run dev"
```

서버가 없으면 사용자 터미널에서 기동하도록 요청한다(하네스 백그라운드 서버는 턴 끝에 회수됨 — `docs/lessons/browser-verification.md`).

- [ ] **Step 2: 스모크 스크립트** — Create `frontend/scripts/pw-smoke-assignee-role.mjs`

```js
// 역할(assignee_role)·시스템 정규화·Catalogs 탭 스모크. API로 맵/드래프트를 만든 뒤 브라우저에서
// (1) 인스펙터 역할 입력→새로고침→캔버스 칩 (2) 시스템 자유값→Other+원문 메모 (3) Catalogs 탭 추가·CSV 임포트→피커 옵션.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node scripts/pw-smoke-assignee-role.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, dev 인증(admin.sys=sysadmin). 스크린샷은 SHOT_DIR(기본 /tmp).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const API = process.env.API_URL ?? "http://localhost:8000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp";
const ADMIN = "admin.sys";
const HEADERS = { "Content-Type": "application/json", "X-Dev-User": ADMIN };

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
};
const api = async (method, url, body) => {
  const res = await fetch(`${API}/api${url}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.json();
};

// ── API 시드: 맵 + 드래프트 체크아웃 + 노드 3개 ───────────────────────────────
const stamp = Date.now().toString(36);
const map = await api("POST", "/maps", { owning_department: "Owning Anchor Division", name: `Role smoke ${stamp}` });
const versionId = map.versions[0].id;
await api("POST", `/versions/${versionId}/checkout`, {});
const nodeId = `role-smoke-${stamp}`;
await api("PUT", `/versions/${versionId}/graph`, {
  nodes: [
    { id: `${nodeId}-s`, title: "Start", node_type: "start", pos_x: 0, pos_y: 0, sort_order: 0 },
    { id: nodeId, title: "Weigh sample", node_type: "process", pos_x: 240, pos_y: 0, sort_order: 1 },
    { id: `${nodeId}-e`, title: "End", node_type: "end", pos_x: 480, pos_y: 0, sort_order: 2, is_primary_end: true },
  ],
  edges: [
    { id: `${nodeId}-e1`, source_node_id: `${nodeId}-s`, target_node_id: nodeId, label: "" },
    { id: `${nodeId}-e2`, source_node_id: nodeId, target_node_id: `${nodeId}-e`, label: "" },
  ],
});
// 카탈로그 초기화 — 역할 목록에 "Reviewer"만
await api("PUT", "/admin/app-settings", { assignee_roles: ["Reviewer"], systems: ["LIMS"] });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((user) => {
    window.localStorage.setItem("bpm.devUser", user);
    window.localStorage.setItem("bpm.lang", "en");
  }, ADMIN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // ── 1) 인스펙터 역할 행 — 자동완성 선택 → 저장 → 새로고침 → 캔버스 칩 ────────
  await page.goto(`${BASE}/maps/${map.id}`, { waitUntil: "networkidle" });
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().click();
  const attrsToggle = page.locator('[data-id="inspector-attrs-toggle"]');
  await attrsToggle.waitFor({ state: "visible", timeout: 10000 });
  if ((await attrsToggle.getAttribute("aria-expanded")) !== "true") await attrsToggle.click();
  const roleInput = page.locator('[data-id="inspector-field-role"]');
  await roleInput.click();
  await roleInput.fill("rev");
  await page.locator('[data-id="inspector-field-role-option-0"]').waitFor({ state: "visible", timeout: 3000 });
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200); // 자동 저장 디바운스
  let graph = await api("GET", `/versions/${versionId}/graph`);
  let node = graph.nodes.find((n) => n.id === nodeId);
  check("role saved via inspector suggestion (catalog spelling)", node?.assignee_role === "Reviewer", `got=${node?.assignee_role}`);
  await page.reload({ waitUntil: "networkidle" });
  const chip = page.locator(".react-flow__node", { hasText: "Weigh sample" }).locator('[data-id="node-role-chip"]');
  await chip.waitFor({ state: "visible", timeout: 10000 });
  check("canvas shows the role chip on the assignee line", ((await chip.textContent()) ?? "").trim() === "Reviewer");
  await page.screenshot({ path: path.join(SHOT_DIR, "assignee-role-canvas.png") });

  // ── 2) 시스템 자유값 → Other + 원문 메모 ──────────────────────────────────
  await page.locator(".react-flow__node", { hasText: "Weigh sample" }).first().click();
  if ((await attrsToggle.getAttribute("aria-expanded")) !== "true") await attrsToggle.click();
  const systemInput = page.locator('[data-id="inspector-field-system"]');
  await systemInput.click();
  await systemInput.fill("Excel macro");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("free system value stored as Other", node?.system === "Other", `got=${node?.system}`);
  check("raw system text kept as source note", node?.system_fallback === "Excel macro", `got=${node?.system_fallback}`);
  await systemInput.click();
  await systemInput.fill("lims");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1200);
  graph = await api("GET", `/versions/${versionId}/graph`);
  node = graph.nodes.find((n) => n.id === nodeId);
  check("catalog system value normalized to catalog spelling", node?.system === "LIMS", `got=${node?.system}`);
  await page.locator('[data-id="inspector-field-system"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-system-row.png") });

  // ── 3) Catalogs 탭 — 직접 추가 + CSV 임포트 → 저장 → /catalogs 반영 ─────────
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Catalogs" }).click();
  await page.locator('[data-id="catalogs-panel"]').waitFor({ state: "visible", timeout: 10000 });
  const addInput = page.locator('[data-id="catalog-roles-add-input"]');
  await addInput.fill("Approver");
  await addInput.press("Enter");
  const csvPath = path.join(os.tmpdir(), `catalog-roles-${stamp}.csv`);
  fs.writeFileSync(csvPath, "value\r\nOperator\r\nreviewer\r\n");
  await page.locator('[data-id="catalog-roles-file"]').setInputFiles(csvPath);
  await page.locator('[data-id="catalog-roles-import-note"]').waitFor({ state: "visible", timeout: 3000 });
  check("csv import note reports added/duplicates",
    /Added 1, skipped 1/.test((await page.locator('[data-id="catalog-roles-import-note"]').textContent()) ?? ""));
  await page.locator('[data-id="catalog-roles-save"]').click();
  await page.waitForTimeout(800);
  const catalogs = await api("GET", "/catalogs");
  check("saved roles reach /catalogs", JSON.stringify(catalogs.assignee_roles) === JSON.stringify(["Reviewer", "Approver", "Operator"]),
    JSON.stringify(catalogs.assignee_roles));
  check("systems keep the reserved Other first", catalogs.systems[0] === "Other" && catalogs.systems.includes("LIMS"));
  await page.locator('[data-id="catalogs-panel"]').screenshot({ path: path.join(SHOT_DIR, "assignee-role-catalogs-tab.png") });
} finally {
  await browser.close();
  // 시드 정리 — 카탈로그는 비우고 맵은 남긴다(휴지통 절차 대신 이름에 stamp)
  await api("PUT", "/admin/app-settings", { assignee_roles: [], systems: [] }).catch(() => undefined);
}
check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 3: 스모크 실행**

Run: `cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && BASE_URL=http://localhost:3000 API_URL=http://localhost:8000 node scripts/pw-smoke-assignee-role.mjs`
Expected: 모든 check PASS. 실패하면 셀렉터(`inspector-attrs-toggle` 접힘 상태·노드 텍스트)부터 확인. 스크린샷 3장(`/tmp/assignee-role-*.png`)을 사용자에게 공유(SendUserFile).

- [ ] **Step 4: 전체 게이트**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev/frontend && npx tsc --noEmit -p tsconfig.json && npx vitest run && npm run lint && node scripts/build-component-catalog.mjs --check
```

Expected: 전부 green.

- [ ] **Step 5: 문서**

- `CLAUDE.md` Lessons "노드 속성 추가 체크리스트" 항목 끝에 한 문장 추가: `관리 목록 자동완성 필드(역할·시스템)는 app_settings 키 + GET /catalogs + lib/catalogs.ts useCatalogs + SuggestInput 한 벌 — 새 목록은 이 4곳에 얹고 설정 Catalogs 탭 카드 하나를 추가한다(design 2026-09-11).`
- `docs/design/2026-08-24-data-surface-parity-design.md` 끝에 후속 항목 절 추가: "역할(`assignee_role`) CSV `Role` 열·Excel 왕복·AI `attributes.assignee_role`·인터뷰 에이전트 역할 수집, 시스템 CSV 값의 카탈로그 정규화 — 2026-09-11 설계 §4.3 이관".
- `docs/design/README.md`·`docs/README.md`의 이 설계 항목 상태를 "**dev 구현 완료**(CSV/AI 노출 후속)"로.
- `PROGRESS.md` 브랜치 요약 1~3줄.

- [ ] **Step 6: 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/dev
git add frontend/scripts/pw-smoke-assignee-role.mjs CLAUDE.md docs/design/2026-08-24-data-surface-parity-design.md docs/design/README.md docs/README.md PROGRESS.md
git commit -m "test(editor): Playwright smoke for assignee role, system normalization and the Catalogs tab — 역할·시스템 정규화·카탈로그 스모크 + 문서"
```

---

## Self-Review (작성자 확인)

- **Spec coverage**: §2 컬럼 2종(Task 2·3) · §3.1 헬퍼/`/catalogs`/app-settings(Task 1) · §3.2 캐시·정규화·SuggestInput(Task 4·5) · §4.1 역할 편집(Task 7·8)·표시(7·8)·diff/Excel(6) · §4.2 시스템 4표면·FallbackHint 적용·Other 표시(Task 9) · §4.3 패스스루(Task 6) · §5 Catalogs 탭·CSV(Task 10) · §6 검증(각 태스크 + Task 11). 설계 §6의 "suggest-input 키 내비(jsdom)"는 컴포넌트 테스트 인프라(testing-library)가 없어 Playwright로 대체 — 설계 문서에서 그 문구를 삭제한다(Task 11 Step 5에 포함).
- **Type consistency**: `assignee_role`(BE·GraphNode·NodeData·Form·DesignationForm) / `spAssigneeRole`(NodeData) / `sp_assignee_role`(MapSummary·MapOut) / `assigneeRole`(컴포넌트 prop) / `SystemCommit.keptNote` / `SuggestInput.onCommit` / `RoleTile.onChange(next)` 로 통일. i18n 키는 Task 4·10에서 en·ko 쌍으로 정의하고 Task 5·7·8·9·10이 소비.
- **Placeholders**: 없음. 행 번호는 작성 시점 기준이며 실제 편집은 인용된 코드 조각으로 찾는다.
