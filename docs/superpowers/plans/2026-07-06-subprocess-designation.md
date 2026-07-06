# Subprocess Designation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맵 오너가 설정에서 "서브프로세스 지정"을 해야만 피커에 노출되고, 지정 어트리뷰트(부서 필수)가 모든 사용처에 라이브 참조·읽기전용으로 적용되며, 미지정 대상은 경고+잠금 처리된다. 스펙: `docs/superpowers/specs/2026-07-06-subprocess-designation-design.md`.

**Architecture:** `ProcessMap`에 designation 컬럼 7개(접근 A) + PUT/DELETE API. 라이브러리 피커는 지정 맵만 반환. 그래프/resolved 응답에 `subprocess_refs`(링크 대상별 지정 정보)를 서버가 동봉 → 프론트는 노드에 값 복사 없이 refs만 렌더(라이브 참조). 미지정은 서버 resolved locked + 프론트 경고 배지·펼침 차단.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + @xyflow/react. 테스트: pytest(백), lint·build·Playwright 스모크(프론트).

## Global Constraints

- **검토 단위(U1~U7) = 사용자 체크포인트.** 한 단위 커밋 후 **정지하고 사용자 시현/검토 대기**. 여러 단위를 한 턴에 밀지 말 것.
- **트래커 `SUBPROCESS-DESIGNATION.md`(루트) + `PROGRESS.md`를 코드와 같은 커밋에 갱신** (`rules/common/git.md`). 트래커의 **완료(✅) 표시는 사용자가 완료를 선언했을 때만** — Claude 자체검증 후 상태는 "검토 대기"까지.
- 커밋 메시지: `type(scope): English summary — 한국어 요약`.
- UI 텍스트 영어 (`rules/frontend/design.md` §5). raw hex 금지·토큰만 (§1, 노드 색 데이터는 예외). Lucide 16px strokeWidth 1.5. 새 구조 요소에 `data-id` 부여.
- `crypto.randomUUID` 금지 → `genId()` (`frontend/src/lib/id.ts`).
- 백엔드 실행: `backend/`에서 `.venv/bin/python -m pytest tests/ -q`, `.venv/bin/ruff check app/ tests/`. 프론트: `frontend/`에서 `npm run lint`, `npm run build`.
- 백엔드 워크트리 최초 1회: `cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.
- 새 컬럼은 nullable + `db.py _ADDED_COLUMNS` 백필 필수(기존 DB 무중단).

## 파일 지도

| 파일 | 역할 (이번 변경) |
|---|---|
| `backend/app/models.py` | `ProcessMap`에 sp_* 컬럼 7개 |
| `backend/app/db.py` | `_ADDED_COLUMNS` 7줄 |
| `backend/app/schemas.py` | `SubprocessDesignationIn`, `SubprocessRefOut`, `MapOut`·`GraphOut` 확장 |
| `backend/app/routers/maps.py` | PUT/DELETE `/api/maps/{id}/subprocess-designation` |
| `backend/app/routers/library.py` | 피커 필터 + attrs, resolved 미지정 잠금 |
| `backend/app/subprocess.py` | `get_subprocess_refs()` 헬퍼 |
| `backend/app/routers/graph.py` | `_load_graph`에 refs 동봉 |
| `backend/tests/test_subprocess_designation.py` | 신규 테스트 (API·필터·refs·잠금) |
| `frontend/src/lib/api.ts` | 타입·클라이언트 함수 확장 |
| `frontend/src/components/permissions/subprocess-designation-panel.tsx` | 신규 — 설정 섹션 패널(상태카드+모달+해제확인) |
| `frontend/src/app/maps/[mapId]/settings/page.tsx` | `ALL_TABS`에 subprocess 섹션 등록 |
| `frontend/src/components/process-library-panel.tsx` | 부서 칩·빈 상태 |
| `frontend/src/components/process-node.tsx` | 경고 배지·어트리뷰트 행·색 강제 |
| `frontend/src/app/maps/[mapId]/page.tsx` | refs 상태·lockedKeys 병합·인스펙터 읽기전용·색 제한 |
| `backend/scripts/seed_org_demo.py`(또는 reset_db 구성 시드) | 데모 맵 지정 심기 |
| `SUBPROCESS-DESIGNATION.md` | 신규 — 검토 트래커 |

---

## U1 — 백엔드 지정 기반 (검증: pytest)

### Task 0: 검토 트래커 생성

**Files:** Create: `SUBPROCESS-DESIGNATION.md`

- [ ] **Step 0-1:** 루트에 트래커 작성 — 단위 표(U1~U7: 내용·시현 시나리오·상태·커밋), 상태 값은 `대기|구현중|검토 대기|✅ 완료(사용자)`. 시현 시나리오에는 실행 명령을 bash/PowerShell 병기.
- [ ] **Step 0-2:** Commit: `docs(tracker): subprocess designation review tracker — 서브프로세스 지정 검토 트래커` (PROGRESS.md 동반 갱신).

### Task 1: 스키마 + 지정 API

**Files:**
- Modify: `backend/app/models.py` (ProcessMap, ~19-44행), `backend/app/db.py` (`_ADDED_COLUMNS` ~16-32행), `backend/app/schemas.py` (MapUpdate 근처 ~21행 + MapOut ~294행), `backend/app/routers/maps.py` (update_map ~456행 아래)
- Test: `backend/tests/test_subprocess_designation.py` (신규)

**Interfaces:**
- Produces: `PUT /api/maps/{map_id}/subprocess-designation` (body `SubprocessDesignationIn`) → `MapOut`, `DELETE /api/maps/{map_id}/subprocess-designation` → `MapOut`. `MapOut`에 `sp_designated_at, sp_department, sp_assignee, sp_system, sp_duration, sp_changed_by, sp_changed_at` 추가. ProcessMap 동명 컬럼.

- [ ] **Step 1-1: 실패하는 테스트 작성** — `backend/tests/test_subprocess_designation.py`. `test_library_mask.py`의 픽스처 패턴(enforce/act_as/_seed) 재사용:

```python
"""서브프로세스 지정 API — 가드(오너·게시버전·부서필수)·해제·변경기록. (spec 2026-07-06)"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapPermission, MapVersion, ProcessMap
from app.settings import settings

SYSADMIN = "desig.sysadmin"
OWNER = "desig.owner"
OTHER = "desig.other"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
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


def _seed(coro_factory):
    async def _run():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_map(name: str, *, published: bool, owner: str = OWNER) -> int:
    """맵 + 버전 1개(published 여부 선택) + owner 권한행. map_id 반환."""

    async def _make(session) -> int:
        m = ProcessMap(name=name, visibility="private", owner_id=owner)
        v = MapVersion(label="As-Is", status="published" if published else "draft")
        m.versions.append(v)
        session.add(m)
        await session.flush()
        session.add(
            MapPermission(map_id=m.id, principal_type="user", principal_id=owner, role="owner")
        )
        return m.id

    return _seed(_make)


BODY = {"department": "Sales", "assignee": "Kim", "system": "SAP", "duration": "2d"}


def test_designate_happy_path(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-happy", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 200
    data = res.json()
    assert data["sp_designated_at"] is not None
    assert data["sp_department"] == "Sales"
    assert data["sp_changed_by"] == OWNER
    assert data["sp_changed_at"] is not None


def test_designate_requires_published_version(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-draft-only", published=False)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 409


def test_designate_requires_owner(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-not-owner", published=True)
    act_as(OTHER)  # 권한행 없는 사용자
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 403


def test_designate_department_required(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-no-dept", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json={"department": "  "})
    assert res.status_code == 422


def test_attr_edit_keeps_designated_at(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-edit", published=True)
    act_as(OWNER)
    first = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY).json()
    second = client.put(
        f"/api/maps/{map_id}/subprocess-designation", json={**BODY, "system": "ERP"}
    ).json()
    assert second["sp_designated_at"] == first["sp_designated_at"]  # 지정 중 수정은 유지
    assert second["sp_system"] == "ERP"


def test_undesignate_keeps_attrs_and_is_idempotent(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-undo", published=True)
    act_as(OWNER)
    client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    res = client.delete(f"/api/maps/{map_id}/subprocess-designation")
    assert res.status_code == 200
    data = res.json()
    assert data["sp_designated_at"] is None
    assert data["sp_department"] == "Sales"  # 어트리뷰트는 유지 → 재지정 프리필
    # 멱등 — 이미 미지정이어도 200
    assert client.delete(f"/api/maps/{map_id}/subprocess-designation").status_code == 200
```

- [ ] **Step 1-2: 실패 확인** — Run: `cd backend && .venv/bin/python -m pytest tests/test_subprocess_designation.py -q`
  Expected: FAIL (405/404 — 엔드포인트 없음).

- [ ] **Step 1-3: 구현.**

`models.py` — ProcessMap `deleted_at` 아래(45행 근처, relationship 위)에:

```python
    # ── 서브프로세스 지정(designation) — 지정된 맵만 라이브러리 피커 노출 (spec 2026-07-06) ──
    # NULL=미지정. 값 있으면 지정 시각(플래그 겸용, KST).
    sp_designated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # 지정 어트리뷰트 — 노드 BPM 필드와 1:1 (department 지정 시 필수). 해제해도 유지(재지정 프리필).
    sp_department: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_assignee: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_system: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_duration: Mapped[str | None] = mapped_column(String(50), default=None)
    # 최근 지정/해제/수정 1건 기록 — 이력 테이블 없이 맵과 1:1
    sp_changed_by: Mapped[str | None] = mapped_column(String(100), default=None)
    sp_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
```

`db.py` — `_ADDED_COLUMNS` 끝에:

```python
    # 서브프로세스 지정 — 지정 맵만 피커 노출 + 라이브 어트리뷰트 (2026-07-06)
    ("process_maps", "sp_designated_at", "TIMESTAMP"),
    ("process_maps", "sp_department", "VARCHAR(100)"),
    ("process_maps", "sp_assignee", "VARCHAR(100)"),
    ("process_maps", "sp_system", "VARCHAR(100)"),
    ("process_maps", "sp_duration", "VARCHAR(50)"),
    ("process_maps", "sp_changed_by", "VARCHAR(100)"),
    ("process_maps", "sp_changed_at", "TIMESTAMP"),
```

`schemas.py` — `MapUpdate` 아래에 입력 모델, `MapOut`(294행)에 필드 추가:

```python
class SubprocessDesignationIn(BaseModel):
    # 부서 필수 — 공백만은 불가 (지정의 핵심 메타)
    department: str = Field(min_length=1, max_length=100)
    assignee: str = Field(default="", max_length=100)
    system: str = Field(default="", max_length=100)
    duration: str = Field(default="", max_length=50)

    @field_validator("department")
    @classmethod
    def _department_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("department must not be blank")
        return value.strip()
```

```python
    # MapOut에 추가 — 서브프로세스 지정 상태·어트리뷰트·최근 변경 (설정 페이지 표시용)
    sp_designated_at: datetime | None = None
    sp_department: str | None = None
    sp_assignee: str | None = None
    sp_system: str | None = None
    sp_duration: str | None = None
    sp_changed_by: str | None = None
    sp_changed_at: datetime | None = None
```

`routers/maps.py` — `update_map` 아래에 (imports에 `SubprocessDesignationIn` 추가, `require_map_role("owner")`·`now_kst`·`get_current_user` 기존 패턴 재사용):

```python
@router.put(
    "/{map_id}/subprocess-designation",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def designate_subprocess(
    map_id: int,
    payload: SubprocessDesignationIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """서브프로세스 지정/속성수정(upsert) — 게시 버전 필수, 오너/sysadmin 전용."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    has_published = await session.scalar(
        select(MapVersion.id).where(
            MapVersion.map_id == map_id, MapVersion.status == "published"
        )
    )
    if has_published is None:
        raise HTTPException(
            status_code=409, detail="map has no published version to designate"
        )
    if found_map.sp_designated_at is None:  # 미지정→지정 전환만 시각 갱신 (수정은 유지)
        found_map.sp_designated_at = now_kst()
    found_map.sp_department = payload.department
    found_map.sp_assignee = payload.assignee
    found_map.sp_system = payload.system
    found_map.sp_duration = payload.duration
    found_map.sp_changed_by = user
    found_map.sp_changed_at = now_kst()
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.delete(
    "/{map_id}/subprocess-designation",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def undesignate_subprocess(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """지정 해제 — 어트리뷰트는 유지(재지정 프리필), 멱등."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.sp_designated_at = None
    found_map.sp_changed_by = user
    found_map.sp_changed_at = now_kst()
    await session.commit()
    await session.refresh(found_map)
    return found_map
```

- [ ] **Step 1-4: 통과 확인** — Run: `.venv/bin/python -m pytest tests/test_subprocess_designation.py -q` → PASS. 전체 회귀: `.venv/bin/python -m pytest tests/ -q` → 전부 PASS. `.venv/bin/ruff check app/ tests/` → clean.
- [ ] **Step 1-5: Commit** — `feat(backend): subprocess designation columns + PUT/DELETE API — 서브프로세스 지정 컬럼·API` (models/db/schemas/maps/tests + PROGRESS/트래커).

**→ U1 끝. 정지: 사용자 검토 대기 (pytest 결과 보고).**

---

## U2 — 설정 페이지 지정 UI (시현: 설정 → Subprocess 섹션)

### Task 2: api 클라이언트 + 설정 패널

**Files:**
- Modify: `frontend/src/lib/api.ts` (MapOut 대응 타입 + 함수 2개, `updateMap` ~194행 근처), `frontend/src/app/maps/[mapId]/settings/page.tsx` (`ALL_TABS` 39-48행, 섹션 렌더 336-401행)
- Create: `frontend/src/components/permissions/subprocess-designation-panel.tsx`

**Interfaces:**
- Consumes: Task 1의 PUT/DELETE 엔드포인트, `MapOut` sp_* 필드.
- Produces: `putSubprocessDesignation(mapId, body)` / `deleteSubprocessDesignation(mapId)` (api.ts), `<SubprocessDesignationPanel mapId map onChanged />`.

- [ ] **Step 2-1:** `api.ts` — 맵 타입에 sp_* 필드 추가(기존 맵 타입 인터페이스 확장) + 함수:

```typescript
export interface SubprocessDesignationBody {
  department: string;
  assignee?: string;
  system?: string;
  duration?: string;
}

export function putSubprocessDesignation(mapId: number, body: SubprocessDesignationBody) {
  return request<MapOut>(`/api/maps/${mapId}/subprocess-designation`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export function deleteSubprocessDesignation(mapId: number) {
  return request<MapOut>(`/api/maps/${mapId}/subprocess-designation`, { method: "DELETE" });
}
```

(실제 fetch 래퍼 이름·맵 타입명은 api.ts의 기존 컨벤션을 따를 것 — `updateMap` 정의부를 그대로 모방.)

- [ ] **Step 2-2:** `subprocess-designation-panel.tsx` 신규 — 기존 `map-details-panel.tsx` 구조 모방:
  - 지정 안 됨: 설명 문구 + `Designate as subprocess` 버튼. **게시 버전 없으면 disabled + "Requires a published version" 캡션** (게시 버전 유무는 settings 페이지가 이미 가진 맵 상세/버전 데이터에서 판별 — 없으면 `latest_version_status`·버전 목록 활용).
  - 지정됨: 어트리뷰트 4종 요약(부서는 강조), "Last changed by {name} · {time}" (이름 해석은 기존 디렉터리 패턴 — `frontend-name-first-id-secondary` 참고), `Edit` / `Un-designate` 버튼.
  - 지정/수정 모달: Department(필수, `bpm-attribute-picker` 부서 피커 재사용) · Assignee(피커) · System/Duration(text input). 저장 시 `putSubprocessDesignation` → `onChanged()` 콜백으로 부모 리프레시. 부서 비면 저장 버튼 disabled.
  - 해제: `ConfirmDialog`(모달 컨벤션 — 아이콘+요약박스) — 본문 "Maps using this subprocess will show a warning and become locked." 확인 시 `deleteSubprocessDesignation`.
  - 루트에 `data-id="subprocess-designation-panel"`, 모달 `data-id="subprocess-designation-modal"`.
- [ ] **Step 2-3:** settings `page.tsx` — `ALL_TABS`에 `{ id: "subprocess", ... }`(Details 다음) 추가, **오너만** 노출(기존 owner 게이팅 분기 재사용), 섹션 렌더에 패널 연결.
- [ ] **Step 2-4: 검증** — `npm run lint` → 0 errors. dev 서버로 브라우저 확인: 오너 계정으로 `/maps/{id}/settings` → 지정 → 새로고침 후 유지 → 수정 → 해제. 비오너 계정은 섹션 미노출.
- [ ] **Step 2-5: Commit** — `feat(settings): subprocess designation section + modal — 설정 서브프로세스 지정 섹션·모달` (+PROGRESS/트래커).

**→ U2 끝. 정지: 사용자 시현 대기 (시나리오: 트래커 참조).**

---

## U3 — 피커 필터 + 부서 칩 (시현: 에디터 라이브러리 패널)

### Task 3: 라이브러리 필터 (backend)

**Files:** Modify: `backend/app/routers/library.py` (`list_processes` 21-61행) / Test: `backend/tests/test_subprocess_designation.py` 추가

**Interfaces:**
- Produces: `GET /api/library/processes` 응답 항목에 `department, assignee, system, duration` 추가, **지정+미삭제 맵만** 반환.

- [ ] **Step 3-1: 실패 테스트 추가:**

```python
def test_library_lists_only_designated(client: TestClient, enforce) -> None:
    designated = seed_map("lib-designated", published=True)
    seed_map("lib-plain", published=True)  # 미지정 — 목록 제외 기대
    act_as(OWNER)
    client.put(f"/api/maps/{designated}/subprocess-designation", json=BODY)
    rows = client.get("/api/library/processes").json()
    ids = [r["map_id"] for r in rows]
    assert designated in ids
    assert all(r["map_id"] != designated or r["department"] == "Sales" for r in rows)
    plain_ids = [r["map_id"] for r in rows if r["name"] == "lib-plain"]
    assert plain_ids == []


def test_library_excludes_soft_deleted(client: TestClient, enforce) -> None:
    map_id = seed_map("lib-deleted", published=True)
    act_as(OWNER)
    client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    client.delete(f"/api/maps/{map_id}")  # soft-delete (owner)
    rows = client.get("/api/library/processes").json()
    assert map_id not in [r["map_id"] for r in rows]
```

- [ ] **Step 3-2:** 실패 확인 (`pytest tests/test_subprocess_designation.py -q`).
- [ ] **Step 3-3: 구현** — `list_processes`의 latest_rows 쿼리에 where + select 컬럼 확장:

```python
    latest_rows = (
        await session.execute(
            select(
                ProcessMap.id,
                ProcessMap.name,
                func.max(MapVersion.id),
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
            )
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            # 지정된 맵만 피커 노출 + 휴지통 제외 (spec 2026-07-06)
            .where(ProcessMap.sp_designated_at.is_not(None), ProcessMap.deleted_at.is_(None))
            .group_by(
                ProcessMap.id,
                ProcessMap.name,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
            )
            .order_by(ProcessMap.name)
        )
    ).all()
```

반환 dict에 `"department": dept, "assignee": ..., "system": ..., "duration": ...` 추가 (언패킹 변수 갱신).

- [ ] **Step 3-4:** 통과 + 전체 회귀 + ruff. **주의:** 기존 `test_subprocess.py`·`test_library_mask.py`가 미지정 맵으로 라이브러리를 조회한다면 시드에 지정을 추가해 갱신(동작 변화가 의도임을 테스트에 주석).
- [ ] **Step 3-5: Commit** — `feat(library): list only designated subprocess maps — 피커에 지정 맵만 노출` (+PROGRESS/트래커).

### Task 4: 피커 UI (frontend)

**Files:** Modify: `frontend/src/lib/api.ts` (`LibraryProcess` ~208행), `frontend/src/components/process-library-panel.tsx`

- [ ] **Step 4-1:** `LibraryProcess`에 `department/assignee/system/duration: string | null` 추가. 패널 행에 부서 칩(`bg-accent-tint text-accent` 토큰, `text-fine`) 표시, 목록 비면 "No designated subprocesses yet — a map owner can designate one in map settings." 빈 상태 문구. `data-id="library-empty-state"`.
- [ ] **Step 4-2:** `npm run lint` → 0. 브라우저: 에디터 라이브러리 패널에 지정 맵만 + 부서 칩. 전부 해제 시 빈 상태 문구.
- [ ] **Step 4-3: Commit** — `feat(editor): library panel department chip + empty state — 피커 부서 칩·빈 상태` (+PROGRESS/트래커).

**→ U3 끝. 정지: 사용자 시현 대기.**

---

## U4 — subprocess_refs + 캔버스 경고·잠금 (시현: 캔버스 노드)

### Task 5: refs 동봉 + 미지정 잠금 (backend)

**Files:**
- Modify: `backend/app/schemas.py` (GraphOut ~396행), `backend/app/subprocess.py`, `backend/app/routers/graph.py` (`_load_graph` 40-65행), `backend/app/routers/library.py` (`resolved_graph` 64-80행)
- Test: `backend/tests/test_subprocess_designation.py` 추가

**Interfaces:**
- Produces: `GraphOut.subprocess_refs: dict[int, SubprocessRefOut]` — `{designated: bool, department|assignee|system|duration: str|None}`. resolved는 미지정 시 `locked=True` 빈 응답.

- [ ] **Step 5-1: 실패 테스트** (subprocess 노드 가진 그래프 시드 헬퍼는 `test_library_mask.py`의 `seed_map_with_graph` 모방 — 노드에 `node_type="subprocess"`, `linked_map_id` 지정):

```python
def test_graph_includes_subprocess_refs(client: TestClient, enforce) -> None:
    target = seed_map("refs-target", published=True)
    act_as(OWNER)
    client.put(f"/api/maps/{target}/subprocess-designation", json=BODY)
    host_map, host_version = seed_host_with_subprocess_node(target)  # 헬퍼: 아래 참조
    act_as(SYSADMIN)
    g = client.get(f"/api/versions/{host_version}/graph").json()
    ref = g["subprocess_refs"][str(target)]
    assert ref["designated"] is True
    assert ref["department"] == "Sales"


def test_refs_undesignated_and_resolved_locked(client: TestClient, enforce) -> None:
    target = seed_map("refs-undesig", published=True)
    host_map, host_version = seed_host_with_subprocess_node(target)
    act_as(SYSADMIN)  # 권한 최상위여도 미지정이면 잠금
    g = client.get(f"/api/versions/{host_version}/graph").json()
    assert g["subprocess_refs"][str(target)]["designated"] is False
    resolved = client.get(f"/api/library/processes/{target}/resolved").json()
    assert resolved["locked"] is True
    assert resolved["nodes"] == []
```

`seed_host_with_subprocess_node(target_map_id)` 헬퍼: 맵+버전+`Node(id="sp1", node_type="subprocess", linked_map_id=target_map_id, version_id=...)` 시드, `(map_id, version_id)` 반환. start 노드 없이 저장 검증을 안 타도록 **DB 직접 시드**(REST PUT 아님).

- [ ] **Step 5-2:** 실패 확인.
- [ ] **Step 5-3: 구현.**

`schemas.py`:

```python
class SubprocessRefOut(BaseModel):
    # 링크 대상 맵의 지정 상태·어트리뷰트 — 라이브 참조 렌더 소스 (spec 2026-07-06)
    designated: bool
    department: str | None = None
    assignee: str | None = None
    system: str | None = None
    duration: str | None = None
```

`GraphOut`에 `subprocess_refs: dict[int, SubprocessRefOut] = {}` 추가.

`subprocess.py`:

```python
async def get_subprocess_refs(
    session: AsyncSession, nodes: list[NodeIn]
) -> dict[int, "SubprocessRefOut"]:
    """그래프 내 subprocess 노드들의 링크 대상 지정 정보 — 라이브 참조 (spec 2026-07-06).

    soft-delete·부재 맵은 designated=False 취급(경고+잠금 렌더).
    """
    targets = {
        n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id
    }
    if not targets:
        return {}
    rows = (
        await session.execute(
            select(
                ProcessMap.id,
                ProcessMap.sp_designated_at,
                ProcessMap.deleted_at,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
            ).where(ProcessMap.id.in_(targets))
        )
    ).all()
    refs = {
        mid: SubprocessRefOut(
            designated=designated_at is not None and deleted_at is None,
            department=dept, assignee=assignee, system=system, duration=duration,
        )
        for mid, designated_at, deleted_at, dept, assignee, system, duration in rows
    }
    for missing in targets - refs.keys():  # 링크 대상 맵이 영구삭제된 경우
        refs[missing] = SubprocessRefOut(designated=False)
    return refs
```

(`ProcessMap`·`SubprocessRefOut` import 추가.)

`graph.py` `_load_graph` 끝 GraphOut 생성부를:

```python
    refs = await get_subprocess_refs(session, nodes)
    return GraphOut(nodes=nodes, edges=edges, groups=groups, subprocess_refs=refs)
```

`library.py` `resolved_graph` — role 체크 앞에 지정 게이트:

```python
    # 미지정/삭제 맵은 권한과 무관하게 잠금 — 지정된 맵만 임베드 허용 (spec 2026-07-06)
    target = await session.get(ProcessMap, map_id)
    if target is None or target.deleted_at is not None or target.sp_designated_at is None:
        return GraphOut(nodes=[], edges=[], locked=True)
```

- [ ] **Step 5-4:** 통과 + 전체 회귀(기존 resolved 테스트들이 미지정 맵으로 호출한다면 시드에 지정 추가) + ruff.
- [ ] **Step 5-5: Commit** — `feat(backend): subprocess_refs in graph + undesignated resolve lock — refs 동봉·미지정 잠금` (+PROGRESS/트래커).

### Task 6: 캔버스 경고 배지 + 펼침 잠금 (frontend)

**Files:** Modify: `frontend/src/app/maps/[mapId]/page.tsx` (그래프 로드부, lockedKeys ~612-617·977-990행, canExpand ~4364행), `frontend/src/components/process-node.tsx` (subprocess 분기 393-426행, 배지 선례 279-302행), `frontend/src/lib/api.ts` (GraphOut 대응 타입)

**Interfaces:**
- Consumes: `GraphOut.subprocess_refs`.
- Produces: `subprocessRefs` state (page.tsx) → 노드 data로 `undesignated: boolean` 전달, `AlertTriangle` 경고 배지 컴포넌트.

- [ ] **Step 6-1:** api.ts 그래프 타입에 `subprocess_refs?: Record<number, SubprocessRef>` 추가. page.tsx 그래프 로드 시 state 보관, subprocess 노드 data에 `undesignated: !refs[linked_map_id]?.designated` 매핑.
- [ ] **Step 6-2:** `process-node.tsx` — subprocess 분기에서 `data.undesignated`면: `AlertTriangle` 배지(기존 `AssigneeWarningBadge` 스타일·`text-error`, 툴팁 "Not a designated subprocess") + 펼침 토글 대신 `LockedBadge`. `data-id="subprocess-undesignated-badge"`.
- [ ] **Step 6-3:** page.tsx — 미지정 linked_map_id를 `lockedKeys`에 병합해 `canExpand`가 자연 차단(기존 게이트 재사용). 이미 펼쳐진 상태에서 로드된 경우도 refs 기준으로 접힘 처리.
- [ ] **Step 6-4:** lint 0 + 브라우저: 미지정 맵을 가리키는 노드에 경고+잠금, 설정에서 지정하면(새로고침 후) 해소, 해제하면 다시 경고. 권한 낮은 계정은 지정 맵이어도 기존 LockedBadge 유지.
- [ ] **Step 6-5: Commit** — `feat(editor): warn + lock undesignated subprocess nodes — 미지정 노드 경고·잠금` (+PROGRESS/트래커).

**→ U4 끝. 정지: 사용자 시현 대기.**

---

## U5 — 노드 어트리뷰트 표시 + 인스펙터 읽기전용 (시현: 캔버스·인스펙터)

### Task 7: 노드 카드 어트리뷰트 행

**Files:** Modify: `frontend/src/components/process-node.tsx` (NodeFields ~40-46행, subprocess 분기), `frontend/src/app/maps/[mapId]/page.tsx` (노드 data 매핑 — Task 6에서 만든 refs 매핑에 어트리뷰트 4종 추가)

- [ ] **Step 7-1:** refs의 department/assignee/system/duration을 subprocess 노드 data로 전달(`spDepartment` 등 — 노드 자체 BPM 필드와 충돌 방지 네이밍). `NodeFields` 행 렌더를 subprocess 분기에서 refs 값으로 표시(지정된 경우만, 미지정은 경고 상태 유지).
- [ ] **Step 7-2:** lint 0 + 브라우저: 지정 맵 노드 카드에 부서 등 표시, 오너가 설정에서 값 수정 → 소비 맵 새로고침 시 반영(라이브 참조).
- [ ] **Step 7-3: Commit** — `feat(editor): show designation attributes on subprocess nodes — 노드 카드 지정 어트리뷰트` (+PROGRESS/트래커).

### Task 8: 인스펙터 읽기전용 표시

**Files:** Modify: `frontend/src/app/maps/[mapId]/page.tsx` (속성폼 ~6959-7079행, `hasBpmAttributes` 게이트 7049행 근처)

- [ ] **Step 8-1:** subprocess 선택 시 BPM 속성 카드 노출하되 **항구 읽기전용**(기존 설명 필드의 읽기전용 회색 패턴·`bpm-attribute-picker readOnly`). 값 소스는 refs. 캡션 "Set by the subprocess owner in map settings." `data-id="inspector-subprocess-attrs"`.
- [ ] **Step 8-2:** lint 0 + 브라우저: 값 표시·수정 불가 확인. 일반 process 노드 폼 회귀 없음.
- [ ] **Step 8-3: Commit** — `feat(editor): read-only designation attrs in inspector — 인스펙터 읽기전용 표시` (+PROGRESS/트래커).

**→ U5 끝. 정지: 사용자 시현 대기.**

---

## U6 — 색상 고정 (시현: 인스펙터 색 섹션)

### Task 9: subprocess 단일색

**Files:** Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`colorsForType` 232-236행, 색 섹션 6990-7047행), `frontend/src/components/process-node.tsx` (색 소스 ~385행)

- [ ] **Step 9-1:** `colorsForType`에 subprocess → `[DEFAULT_COLORS.subprocess]` 단일 배열 분기. 속성폼: subprocess면 색 프리셋·헥스 입력 숨김.
- [ ] **Step 9-2:** `process-node.tsx` 색 결정을 subprocess는 `DEFAULT_COLORS.subprocess` 강제(`data.color` 무시) — 기존 다른 색 저장 노드도 렌더만 통일(데이터 무변경).
- [ ] **Step 9-3:** lint 0 + 브라우저: 색 UI 숨김·기존 색 노드 강제 통일·다른 타입 색 변경 회귀 없음.
- [ ] **Step 9-4: Commit** — `feat(editor): single accent color for subprocess nodes — 서브프로세스 단일색 고정` (+PROGRESS/트래커).

**→ U6 끝. 정지: 사용자 시현 대기.**

---

## U7 — 시드 + 통합 검증 (시현: 데모 리셋 후 전체 플로우)

### Task 10: 시드 지정 + 통합 스모크

**Files:** Modify: `backend/scripts/seed_org_demo.py` (혹은 reset_db가 조합하는 데모 시드 — 실행 시 `docs/db-seed.md`와 스크립트를 읽고 subprocess 링크가 있는 데모 맵 확인), Test: `backend/tests/test_seed_invariants.py` (시드 불변식 파일이 지정을 검증하도록 확장)

- [ ] **Step 10-1:** 데모 시드에서 subprocess 링크 대상 맵들에 지정 심기(`sp_designated_at=now`, 부서 등 어트리뷰트 — 데모 조직 데이터와 일관되게). 미지정 경고 시연용 맵 1개는 의도적으로 남기고 시드 주석으로 명시.
- [ ] **Step 10-2:** `python -m scripts.reset_db` 후 백엔드 기동 → Playwright 스모크(기존 하네스: 시스템 Chrome + `bpm.devUser`, `docs/lessons/browser-verification.md`): 피커 노출 → 드래그 링크 → 어트리뷰트 표시 → 펼침 → 설정 해제 → 경고+잠금.
- [ ] **Step 10-3:** 최종 회귀 — backend: pytest 전체 + ruff. frontend: lint + build.
- [ ] **Step 10-4: Commit** — `feat(seed): designate demo subprocess maps + invariants — 데모 시드 지정·불변식` (+PROGRESS/트래커: U7 검토 대기).

**→ U7 끝. 정지: 사용자 최종 검토. 이후 finishing-a-development-branch 스킬로 머지 논의.**

---

## Self-Review 체크 결과

- 스펙 §3→Task 1, §4→Task 1, §5→Task 3·4, §6→Task 5·6, §7→Task 2, §8→Task 6·7·8, §9→Task 9, §10→Task 1·3·5·10, §11 엣지(soft-delete refs)→Task 5. 커버 누락 없음.
- 프론트 코드 블록은 6700줄 파일 특성상 앵커+계약 중심 — 실행 시 해당 라인 주변을 읽고 기존 스타일에 맞출 것(라인 번호는 2026-07-06 기준).
- 타입 일관성: `SubprocessDesignationIn`(백)↔`SubprocessDesignationBody`(프론트), `SubprocessRefOut`↔`SubprocessRef`, dict 키는 JSON 직렬화 시 문자열(테스트에서 `str(target)`) — 프론트 `Record<number, ...>`는 인덱싱 시 숫자 키로 동작(JS 객체 키 강제 변환) 확인됨.
