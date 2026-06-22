# Map Card & Detail Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 맵 목록의 카드/상세 UX를 정리하고, 버전 영역을 "누가·언제 절차를 진행했는지" 보이는 git-log 타임라인으로 바꾸며, description 입력 경로(생성 다이얼로그 + 설정 페이지)를 복원한다.

**Architecture:** 백엔드에 버전 생애주기 이벤트 로그 테이블(`version_events`)을 추가하고 워크플로 엔드포인트에서 기록한다. 상세 응답(`get_map`)에 버전별 events + created_at을 임베드한다. 프론트는 카드/상세 컴포넌트를 수정하고 신규 `ConfirmDialog`·`VersionTimeline` 컴포넌트를 추가하며, 폭이 좁을 때 상세를 선택 카드 아래 아코디언으로 펼친다.

**Tech Stack:** Backend — FastAPI, SQLAlchemy(async, aiosqlite/postgres), Pydantic, pytest. Frontend — Next.js(App Router) + React + TypeScript, @xyflow/react, Tailwind 토큰, Lucide.

## Global Constraints

- 디자인 토큰만 사용 — raw hex 금지(데이터/출력 예외). 색은 `bg-surface`/`text-ink`/`border-hairline`/`text-error` 등 토큰 또는 `var(--color-*)`. (`rules/frontend/design.md`)
- UI 영어 기본, 동적 데이터·주석만 한글. 아이콘 Lucide 16px strokeWidth 1.5. 이모지 금지.
- 디자인 변경/신규 컴포넌트의 주요 구조 요소에 `data-id` 부여(메모리 규칙: `frontend-data-id-convention`).
- id 생성은 `genId()`(`@/lib/id`), `crypto.randomUUID` 금지.
- 버튼 커서·클릭 눌림은 globals.css 전역 base — 컴포넌트엔 hover 배경만.
- Python: 타입힌트 필수, `X | None`/`list[X]`, 함수명 동사 시작, ruff clean.
- TypeScript: `strict`, `any` 금지, named export 선호, interface for props.
- i18n: en이 권위, ko는 동일 키 강제(tsc). 새 키는 en+ko 양쪽에 추가.
- 줄바꿈 LF 고정.
- 검증: 백엔드 `python -m pytest tests/ -q` (baseline 266 passed 유지) + `ruff check app/ tests/`. 프론트 `npx tsc --noEmit`.

---

## File Structure

**Backend (create)**
- `app/version_events.py` — `record_version_event(...)` 단일 헬퍼.
- `tests/test_version_events.py` — 모델·기록·직렬화·백필 테스트.

**Backend (modify)**
- `app/models.py` — `VersionEvent` 모델 + `MapVersion.events` 관계.
- `app/schemas.py` — `VersionOut.created_at`, `VersionEventOut`, `VersionDetailOut`, `MapDetailOut.versions`.
- `app/routers/maps.py` — 초기 버전 "created" 이벤트 기록 + `get_map` events eager-load.
- `app/routers/versions.py` — `create_version`에 `user` 의존성 + 생애주기 이벤트 기록.
- `scripts/reset_db.py` — `backfill_version_events()` + main 배선.

**Frontend (create)**
- `src/components/confirm-dialog.tsx` — 범용 확인 모달.
- `src/components/maps/version-timeline.tsx` — git-log 세로 타임라인.
- `src/components/permissions/map-details-panel.tsx` — 설정 페이지 description 편집 패널.

**Frontend (modify)**
- `src/lib/api.ts` — 타입(`VersionEvent`/`VersionDetail`/`VersionSummary.created_at`/`MapDetail.versions`) + `createMap(name, description)` + `updateMap(...)`.
- `src/lib/i18n-messages.ts` — 신규 키 en+ko.
- `src/components/maps/map-card.tsx` — description 제거, 이름 링크, 우상단 새 탭.
- `src/components/maps/map-detail-card.tsx` — description 박스, 버전 타임라인, footer Open 삭제, delete 확인.
- `src/app/page.tsx` — 반응형 아코디언.
- `src/components/permissions/create-map-dialog.tsx` — description textarea.
- `src/app/maps/[mapId]/settings/page.tsx` — Details 탭 추가.

---

## Task 1: VersionEvent model + relationship

**Files:**
- Modify: `backend/app/models.py` (add class after `MapVersion`, ~line 79; add relationship inside `MapVersion`)
- Test: `backend/tests/test_version_events.py` (create)

**Interfaces:**
- Produces: `VersionEvent` ORM (`id:int, version_id:int, event_type:str, actor:str, note:str|None, created_at:datetime`); `MapVersion.events: list[VersionEvent]` (created_at 오름차순).

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_version_events.py`:

```python
"""버전 생애주기 이벤트 로그 — 모델/기록/직렬화/백필 (design 2026-06-23)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import MapVersion, ProcessMap, VersionEvent

T = TypeVar("T")


def _run(coro_factory: Callable[..., Awaitable[T]]) -> T:
    async def _inner() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_inner())


def test_version_event_relationship_orders_by_created_at(client: TestClient) -> None:
    async def scenario(session) -> int:
        m = ProcessMap(name="evt model", owner_id="boss")
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        vid = m.versions[0].id
        session.add(VersionEvent(version_id=vid, event_type="created", actor="boss"))
        session.add(VersionEvent(version_id=vid, event_type="submitted", actor="boss"))
        return vid

    vid = _run(scenario)

    async def read(session) -> list[str]:
        version = await session.get(MapVersion, vid)
        # selectinload 없이도 같은 세션에서 lazy 접근 (테스트 한정)
        events = (
            await session.scalars(
                select(VersionEvent)
                .where(VersionEvent.version_id == vid)
                .order_by(VersionEvent.created_at, VersionEvent.id)
            )
        ).all()
        assert version is not None
        return [e.event_type for e in events]

    assert _run(read) == ["created", "submitted"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: FAIL — `ImportError: cannot import name 'VersionEvent' from 'app.models'`

- [ ] **Step 3: Add the model + relationship**

In `backend/app/models.py`, inside class `MapVersion` add (after the `approvals` relationship, ~line 78):

```python
    events: Mapped[list["VersionEvent"]] = relationship(
        cascade="all, delete-orphan", order_by="VersionEvent.created_at"
    )
```

After class `MapVersion` (before `class Node`, ~line 80) add:

```python
class VersionEvent(Base):
    """버전 생애주기 이벤트 로그 — created/submitted/approved/rejected/published (누가·언제). git-log 타임라인 소스."""

    __tablename__ = "version_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE"), index=True
    )
    # created|submitted|approved|rejected|published
    event_type: Mapped[str] = mapped_column(String(20))
    actor: Mapped[str] = mapped_column(String(100))
    # 거절 사유 등 부가 텍스트
    note: Mapped[str | None] = mapped_column(String(500), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

(All names — `Base`, `Mapped`, `mapped_column`, `ForeignKey`, `String`, `DateTime`, `datetime`, `_now` — are already imported/defined in this file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: PASS (1 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_version_events.py
git commit -m "feat(version-events): add VersionEvent model + MapVersion.events relationship — 버전 이벤트 로그 모델"
```

---

## Task 2: Record lifecycle events

**Files:**
- Create: `backend/app/version_events.py`
- Modify: `backend/app/routers/maps.py` (create_map: initial "created"; imports)
- Modify: `backend/app/routers/versions.py` (create_version `user` dep + emits in create/submit/approve/reject/publish; imports)
- Test: `backend/tests/test_version_events.py` (append)

**Interfaces:**
- Consumes: `VersionEvent` (Task 1).
- Produces: `record_version_event(session: AsyncSession, version_id: int, event_type: str, actor: str, note: str | None = None) -> None` — adds a row, caller commits.

- [ ] **Step 1: Write the failing test (append to `tests/test_version_events.py`)**

```python
def test_create_map_records_created_event(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "evt create"}).json()
    version_id = created["versions"][0]["id"]

    async def read(session) -> list[tuple[str, str]]:
        rows = (
            await session.scalars(
                select(VersionEvent).where(VersionEvent.version_id == version_id)
            )
        ).all()
        return [(e.event_type, e.actor) for e in rows]

    events = _run(read)
    assert ("created", "local-dev") in events  # settings.dev_user 기본값


def test_full_lifecycle_records_events(client: TestClient) -> None:
    from app.settings import settings

    created = client.post("/api/maps", json={"name": "evt lifecycle"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    client.post(f"/api/versions/{version_id}/approve")
    client.post(f"/api/versions/{version_id}/publish")

    async def read(session) -> list[str]:
        rows = (
            await session.scalars(
                select(VersionEvent)
                .where(VersionEvent.version_id == version_id)
                .order_by(VersionEvent.created_at, VersionEvent.id)
            )
        ).all()
        return [e.event_type for e in rows]

    assert _run(read) == ["created", "submitted", "approved", "published"]


def test_reject_records_event_with_reason(client: TestClient) -> None:
    from app.settings import settings

    created = client.post("/api/maps", json={"name": "evt reject"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    client.post(f"/api/versions/{version_id}/reject", json={"reason": "needs work"})

    async def read(session) -> tuple[str, str | None]:
        row = (
            await session.scalars(
                select(VersionEvent)
                .where(
                    VersionEvent.version_id == version_id,
                    VersionEvent.event_type == "rejected",
                )
            )
        ).one()
        return row.event_type, row.note

    event_type, note = _run(read)
    assert event_type == "rejected"
    assert note == "needs work"
```

> Note: tests assume the auth-bypass default user is `local-dev`. If `settings.dev_user` differs, the first test's literal must match; the others use `settings.dev_user`. Verify `settings.dev_user` value and adjust the `"local-dev"` literal if needed.

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: FAIL — created/submit/etc. produce no event rows (only the model test passes).

- [ ] **Step 3: Create the helper**

Create `backend/app/version_events.py`:

```python
"""버전 생애주기 이벤트 적재 — git-log 타임라인의 단일 기록 진입점."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VersionEvent


def record_version_event(
    session: AsyncSession,
    version_id: int,
    event_type: str,
    actor: str,
    note: str | None = None,
) -> None:
    """버전 이벤트 1건을 세션에 추가한다 (commit은 호출자 책임)."""
    session.add(
        VersionEvent(
            version_id=version_id,
            event_type=event_type,
            actor=actor,
            note=note,
        )
    )
```

- [ ] **Step 4: Emit "created" for the initial version in `maps.py`**

In `backend/app/routers/maps.py`, add import (with other `app.` imports near top):

```python
from app.version_events import record_version_event
```

In `create_map`, after `await session.flush()` (currently line 115, version id now assigned), before the `session.add(MapPermission(...))` block, add:

```python
    # 초기 버전 생성 이벤트 — 버전 히스토리 타임라인 시작점
    record_version_event(session, new_map.versions[0].id, "created", user)
```

- [ ] **Step 5: Add `user` dep + emits in `versions.py`**

In `backend/app/routers/versions.py`:

(a) Add import (in the `from app...` block near top):

```python
from app.version_events import record_version_event
```

(b) `create_version` — add the `user` dependency and emit. Change the signature:

```python
async def create_version(
    map_id: int,
    payload: VersionCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
```

Then, immediately before `await session.commit()` (currently line 149), add:

```python
    record_version_event(session, new_version.id, "created", user)
```

(c) `submit_version` — before `await session.commit()` (line 346), add:

```python
    record_version_event(session, version_id, "submitted", user)
```

(d) `approve_version` — inside the `if existing is None:` block (after `await session.flush()`, line 379), add:

```python
        record_version_event(session, version_id, "approved", user)
```

(e) `reject_version` — before `await session.commit()` (line 435), add:

```python
    record_version_event(session, version_id, "rejected", user, note=payload.reason)
```

(f) `publish_version` — before `await session.commit()` (line 476), add:

```python
    record_version_event(session, version_id, "published", user)
```

- [ ] **Step 6: Run tests to verify pass**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: PASS (all event tests pass)

- [ ] **Step 7: Run full suite + lint (no regressions)**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: all pass (baseline + new), ruff clean

- [ ] **Step 8: Commit**

```bash
git add backend/app/version_events.py backend/app/routers/maps.py backend/app/routers/versions.py backend/tests/test_version_events.py
git commit -m "feat(version-events): record created/submitted/approved/rejected/published — 생애주기 이벤트 기록"
```

---

## Task 3: Expose created_at + events in API

**Files:**
- Modify: `backend/app/schemas.py` (VersionOut.created_at; VersionEventOut; VersionDetailOut; MapDetailOut.versions)
- Modify: `backend/app/routers/maps.py` (`get_map` eager-load events)
- Test: `backend/tests/test_version_events.py` (append)

**Interfaces:**
- Consumes: `VersionEvent` rows (Task 2).
- Produces: `GET /api/maps/{id}` → `versions[].created_at` (ISO str) + `versions[].events: [{id, event_type, actor, note, created_at}]` (created_at 오름차순).

- [ ] **Step 1: Write the failing test (append)**

```python
def test_get_map_serializes_versions_with_events(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "evt serialize"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)

    assert "created_at" in version and version["created_at"]
    assert isinstance(version["events"], list)
    types = [e["event_type"] for e in version["events"]]
    assert types == ["created"]
    evt = version["events"][0]
    assert {"id", "event_type", "actor", "note", "created_at"} <= set(evt.keys())
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_version_events.py::test_get_map_serializes_versions_with_events -q`
Expected: FAIL — `KeyError: 'events'` (VersionOut has no events/created_at)

- [ ] **Step 3: Update schemas**

In `backend/app/schemas.py`:

(a) Add `created_at` to `VersionOut` (currently lines 19-26):

```python
class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    status: str
    submitted_by: str | None
    reject_reason: str | None
    created_at: datetime
```

(b) Immediately after `VersionOut`, add:

```python
class VersionEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: str
    actor: str
    note: str | None
    created_at: datetime


class VersionDetailOut(VersionOut):
    # 상세 응답 전용 — 워크플로 단건 응답(VersionOut)에는 events를 싣지 않아 lazy-load 회피
    events: list[VersionEventOut]
```

(c) Change `MapDetailOut` (line 178-179) to use the detail variant:

```python
class MapDetailOut(MapOut):
    versions: list[VersionDetailOut]
```

(`datetime` is already imported at top of schemas.py.)

- [ ] **Step 4: Eager-load events in `get_map`**

In `backend/app/routers/maps.py` `get_map` (line 142-144), change the eager-load to chain events:

```python
    found_map = await session.get(
        ProcessMap,
        map_id,
        options=[selectinload(ProcessMap.versions).selectinload(MapVersion.events)],
    )
```

(`MapVersion` and `selectinload` are already imported in maps.py.)

- [ ] **Step 5: Run test to verify pass**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: PASS

- [ ] **Step 6: Run full suite + lint**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: all pass, ruff clean. (Workflow endpoints still return `VersionOut`; `created_at` is a column so `session.refresh` covers it — no lazy-load error.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/maps.py backend/tests/test_version_events.py
git commit -m "feat(version-events): expose created_at + events in map detail — 상세 응답에 이벤트 임베드"
```

---

## Task 4: Backfill created events

**Files:**
- Modify: `backend/scripts/reset_db.py` (add `backfill_version_events` + wire into `main`)
- Test: `backend/tests/test_version_events.py` (append)

**Interfaces:**
- Produces: `backfill_version_events(session: AsyncSession) -> int` — 버전별 `created` 이벤트가 없으면 `created_at` 기준 1건 합성(actor = owner_id → created_by → "unknown"). 멱등. 반환=추가 건수.

- [ ] **Step 1: Write the failing test (append)**

```python
def test_backfill_created_events_idempotent(client: TestClient) -> None:
    from scripts.reset_db import backfill_version_events

    async def seed_legacy(session) -> int:
        m = ProcessMap(name="legacy map", owner_id="legacy.owner")
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        return m.versions[0].id

    vid = _run(seed_legacy)  # 직접 시드 — create_map 엔드포인트를 거치지 않아 created 이벤트 없음

    async def run_backfill(session) -> int:
        return await backfill_version_events(session)

    first = _run(run_backfill)
    second = _run(run_backfill)

    async def read(session) -> tuple[int, str]:
        rows = (
            await session.scalars(
                select(VersionEvent).where(
                    VersionEvent.version_id == vid,
                    VersionEvent.event_type == "created",
                )
            )
        ).all()
        return len(rows), rows[0].actor

    count, actor = _run(read)
    assert first >= 1
    assert second == 0
    assert count == 1
    assert actor == "legacy.owner"
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_version_events.py::test_backfill_created_events_idempotent -q`
Expected: FAIL — `ImportError: cannot import name 'backfill_version_events'`

- [ ] **Step 3: Add the backfill function**

In `backend/scripts/reset_db.py`, add imports at top (with existing imports):

```python
from sqlalchemy import select
from app.db import SessionLocal, engine
from app.models import Base, MapVersion, ProcessMap, VersionEvent
```

(Replace the existing `from app.models import Base` line; merge into one import.)

Add the function (module level, before `main`):

```python
async def backfill_version_events(session: AsyncSession) -> int:
    """created 이벤트가 없는 버전에 created_at 기준 created 1건을 합성한다 (멱등). 반환=추가 건수."""
    have_created = set(
        (
            await session.scalars(
                select(VersionEvent.version_id).where(
                    VersionEvent.event_type == "created"
                )
            )
        ).all()
    )
    rows = (
        await session.execute(
            select(MapVersion, ProcessMap.owner_id, ProcessMap.created_by).join(
                ProcessMap, ProcessMap.id == MapVersion.map_id
            )
        )
    ).all()
    added = 0
    for version, owner_id, created_by in rows:
        if version.id in have_created:
            continue
        session.add(
            VersionEvent(
                version_id=version.id,
                event_type="created",
                actor=owner_id or created_by or "unknown",
                created_at=version.created_at,
            )
        )
        added += 1
    await session.commit()
    return added
```

Add the `AsyncSession` import if not present:

```python
from sqlalchemy.ext.asyncio import AsyncSession
```

- [ ] **Step 4: Wire into `main`**

In `reset_db.py` `main()`, after the permission demo seed block (step 4), add:

```python
    # 5. 버전 created 이벤트 백필 (멱등 — 시드가 만든 버전들에 타임라인 시작점 부여)
    async with SessionLocal() as session:
        added = await backfill_version_events(session)
    print(f"backfill version 'created' events: {added}건")
```

- [ ] **Step 5: Run test to verify pass**

Run: `.venv/bin/python -m pytest tests/test_version_events.py -q`
Expected: PASS (all)

- [ ] **Step 6: Run full suite + lint**

Run: `.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/ scripts/`
Expected: all pass, ruff clean

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/reset_db.py backend/tests/test_version_events.py
git commit -m "feat(version-events): idempotent backfill of created events in reset_db — 기존 버전 백필"
```

---

## Task 5: Frontend API types + createMap/updateMap

**Files:**
- Modify: `frontend/src/lib/api.ts`

**Interfaces:**
- Produces (frontend types):
  - `interface VersionEvent { id: number; event_type: string; actor: string; note: string | null; created_at: string }`
  - `VersionSummary` gains `created_at: string`
  - `interface VersionDetail extends VersionSummary { events: VersionEvent[] }`
  - `MapDetail.versions: VersionDetail[]`
  - `createMap(name: string, description?: string): Promise<MapDetail>` (description 기본값 `""` — 기존 호출부 무수정으로 tsc green 유지)
  - `updateMap(mapId: number, patch: { name?: string; description?: string }): Promise<MapSummary>`

- [ ] **Step 1: Update `VersionSummary` + add event/detail types**

In `frontend/src/lib/api.ts`, replace the `VersionSummary` interface (lines 10-16) and the `MapDetail` interface (lines 33-35):

```typescript
export interface VersionSummary {
  id: number;
  label: string;
  status: VersionStatus;
  submitted_by: string | null;
  reject_reason: string | null;
  created_at: string;
}

// 버전 생애주기 이벤트 — git-log 타임라인 행 / version lifecycle event.
export interface VersionEvent {
  id: number;
  event_type: string;
  actor: string;
  note: string | null;
  created_at: string;
}

export interface VersionDetail extends VersionSummary {
  events: VersionEvent[];
}
```

Then change `MapDetail`:

```typescript
export interface MapDetail extends MapSummary {
  versions: VersionDetail[];
}
```

- [ ] **Step 2: Update `createMap`, add `updateMap`**

Replace `createMap` (lines 142-147):

```typescript
export function createMap(name: string, description = ""): Promise<MapDetail> {
  return request<MapDetail>("/maps", {
    method: "POST",
    body: JSON.stringify({ name, description }),
  });
}

export function updateMap(
  mapId: number,
  patch: { name?: string; description?: string },
): Promise<MapSummary> {
  return request<MapSummary>(`/maps/${mapId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}
```

- [ ] **Step 3: Verify typecheck (must be green)**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (0 errors). `createMap`'s `description` defaults to `""`, so the existing `createMap(trimmed)` call site still compiles. `submitVersion`/etc. return `VersionSummary` which now requires `created_at` — backend supplies it, type is fine.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(api): version events types + createMap(description) + updateMap — 이벤트 타입·설명 전달"
```

---

## Task 6: ConfirmDialog component

**Files:**
- Create: `frontend/src/components/confirm-dialog.tsx`

**Interfaces:**
- Produces: `ConfirmDialog` with props `{ title: string; message: string; confirmLabel: string; cancelLabel: string; danger?: boolean; onConfirm: () => void; onClose: () => void }`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/confirm-dialog.tsx`:

```tsx
"use client";

// 범용 확인 모달 — ModalBackdrop + portal. danger=true면 confirm 버튼 error 토큰 /
// Generic confirm dialog. First use: delete map.

import { createPortal } from "react-dom";

import { ModalBackdrop } from "@/components/modal-backdrop";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20"
    >
      <div
        data-id="confirm-dialog"
        className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
      >
        <div className="flex flex-col gap-1">
          <h2 className="text-body-strong text-ink">{title}</h2>
          <p className="text-caption text-ink-secondary">{message}</p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-id="confirm-dialog-cancel"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt"
            onClick={onClose}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-id="confirm-dialog-confirm"
            className={`rounded-sm px-3 py-1.5 text-caption ${
              danger
                ? "bg-error text-on-accent hover:opacity-90"
                : "bg-accent text-on-accent hover:bg-accent-focus"
            }`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
```

> If the token `bg-error` / `text-on-accent` combination does not exist, fall back to `bg-error text-surface`. Verify against `globals.css` `@theme` during implementation; use whichever error-fill token pair exists. Do not introduce raw hex.

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no NEW errors from this file (transient Task 5 arity error may remain).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/confirm-dialog.tsx
git commit -m "feat(ui): add ConfirmDialog component — 범용 확인 모달"
```

---

## Task 7: i18n keys (en + ko)

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces message keys: `home.openNewWindow`, `home.descEmpty`, `home.confirmDeleteTitle`, `home.confirmDeleteMessage`, `common.confirm`, `common.cancel`, `home.verEvent.created|submitted|approved|rejected|published`, `perm.createDialog.descriptionLabel`, `perm.createDialog.descriptionPlaceholder`, `perm.tabDetails`, `perm.details.descriptionLabel`, `perm.details.descriptionPlaceholder`, `perm.details.save`, `perm.details.saved`.

- [ ] **Step 1: Add keys to the `en` block**

In `frontend/src/lib/i18n-messages.ts`, after the `home.verStatus.rejected` line in the **en** object (line 30), add:

```typescript
  "home.openNewWindow": "Open in new window",
  "home.descEmpty": "No description",
  "home.confirmDeleteTitle": "Delete map",
  "home.confirmDeleteMessage": "This permanently deletes the map and all its versions. This cannot be undone.",
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "home.verEvent.created": "created",
  "home.verEvent.submitted": "submitted for approval",
  "home.verEvent.approved": "approved",
  "home.verEvent.rejected": "rejected",
  "home.verEvent.published": "published",
```

Locate the `perm.createDialog.*` keys in the **en** block and add nearby:

```typescript
  "perm.createDialog.descriptionLabel": "Description",
  "perm.createDialog.descriptionPlaceholder": "What is this process map about? (optional)",
  "perm.tabDetails": "Details",
  "perm.details.descriptionLabel": "Description",
  "perm.details.descriptionPlaceholder": "Describe this process map…",
  "perm.details.save": "Save",
  "perm.details.saved": "Description saved",
```

- [ ] **Step 2: Add the SAME keys (Korean values) to the `ko` block**

After the `home.verStatus.rejected` line in the **ko** object (line 565), add:

```typescript
  "home.openNewWindow": "새 창으로 열기",
  "home.descEmpty": "설명 없음",
  "home.confirmDeleteTitle": "맵 삭제",
  "home.confirmDeleteMessage": "맵과 모든 버전이 영구 삭제됩니다. 되돌릴 수 없습니다.",
  "common.confirm": "확인",
  "common.cancel": "취소",
  "home.verEvent.created": "생성",
  "home.verEvent.submitted": "승인 요청",
  "home.verEvent.approved": "승인",
  "home.verEvent.rejected": "반려",
  "home.verEvent.published": "게시",
```

Near the ko `perm.createDialog.*` keys add:

```typescript
  "perm.createDialog.descriptionLabel": "설명",
  "perm.createDialog.descriptionPlaceholder": "이 프로세스맵에 대한 설명 (선택)",
  "perm.tabDetails": "정보",
  "perm.details.descriptionLabel": "설명",
  "perm.details.descriptionPlaceholder": "이 프로세스맵을 설명하세요…",
  "perm.details.save": "저장",
  "perm.details.saved": "설명이 저장되었습니다",
```

- [ ] **Step 3: Verify typecheck (en/ko key parity enforced by tsc)**

Run: `cd frontend && npx tsc --noEmit`
Expected: no key-parity errors. (Transient Task 5 arity error may remain.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/i18n-messages.ts
git commit -m "feat(i18n): keys for new-window/confirm-delete/version events/description — 신규 문구"
```

---

## Task 8: MapCard — remove desc, name link, new-tab open

**Files:**
- Modify: `frontend/src/components/maps/map-card.tsx`

**Interfaces:**
- Consumes: `home.openNewWindow` (Task 7).

- [ ] **Step 1: Top-right icon → new tab**

In `frontend/src/components/maps/map-card.tsx`, replace the quick-open `<Link>` (lines 68-76) with:

```tsx
      {/* 호버 시 새 탭으로 열기 / Hover: open in a new tab */}
      <a
        data-id="map-card-open-newtab"
        href={`/maps/${map.id}`}
        target="_blank"
        rel="noopener"
        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-caption text-ink-tertiary opacity-0 transition-opacity duration-150 hover:bg-surface hover:text-ink group-hover:opacity-100 focus-within:opacity-100"
        aria-label={t("home.openNewWindow")}
        title={t("home.openNewWindow")}
        onClick={(e) => e.stopPropagation()}
      >
        <ExternalLink size={16} strokeWidth={1.5} />
      </a>
```

- [ ] **Step 2: Name → same-tab open link; remove description**

Replace the name span + description block (lines 78-81) with:

```tsx
      <Link
        data-id="map-card-name"
        href={`/maps/${map.id}`}
        className="block truncate pr-6 text-body-strong text-ink hover:text-accent hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {map.name}
      </Link>
```

(`Link` is already imported. `map.description` is no longer referenced — leaving it unused is fine since it is a field on `map`, not a separate import.)

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/maps/map-card.tsx
git commit -m "feat(home): card name opens map, top-right opens new tab, drop description — 카드 인터랙션 정리"
```

---

## Task 9: VersionTimeline component

**Files:**
- Create: `frontend/src/components/maps/version-timeline.tsx`

**Interfaces:**
- Consumes: `VersionDetail`, `VersionEvent` (Task 5); `home.verEvent.*` (Task 7); `VERSION_STATUS_LABEL`/`VERSION_STATUS_STYLE` (`@/lib/version-status`).
- Produces: `VersionTimeline({ versions }: { versions: VersionDetail[] })`.

- [ ] **Step 1: Create the component**

Create `frontend/src/components/maps/version-timeline.tsx`:

```tsx
"use client";

// 버전 git-log 타임라인 — 버전별 생애주기 이벤트(누가·언제)를 커밋 점+세로선으로 / version history as a git log.

import { Check, GitCommit, Send, Upload, X } from "lucide-react";

import type { VersionDetail, VersionEvent } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";
import { VERSION_STATUS_LABEL, VERSION_STATUS_STYLE } from "@/lib/version-status";

// event_type → 아이콘 / icon per event type.
function EventIcon({ type }: { type: string }) {
  if (type === "submitted") return <Send size={14} strokeWidth={1.5} />;
  if (type === "approved") return <Check size={14} strokeWidth={1.5} />;
  if (type === "rejected") return <X size={14} strokeWidth={1.5} />;
  if (type === "published") return <Upload size={14} strokeWidth={1.5} />;
  return <GitCommit size={14} strokeWidth={1.5} />;
}

const EVENT_LABEL: Record<string, MessageKey> = {
  created: "home.verEvent.created",
  submitted: "home.verEvent.submitted",
  approved: "home.verEvent.approved",
  rejected: "home.verEvent.rejected",
  published: "home.verEvent.published",
};

// created_at(ISO) → "MM-DD HH:mm" 절대 표기 (의존성 없이) / compact absolute timestamp.
function formatStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function VersionTimeline({ versions }: { versions: VersionDetail[] }) {
  const { t } = useI18n();

  return (
    <div data-id="version-timeline" className="flex flex-col gap-4">
      {versions.map((version) => {
        // 최신이 위로 — created_at 오름차순 응답을 역순 렌더 / newest first.
        const events: VersionEvent[] = [...version.events].reverse();
        return (
          <div key={version.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-caption-strong text-ink">
                {version.label}
              </span>
              <span
                className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-fine ${VERSION_STATUS_STYLE[version.status]}`}
              >
                {t(VERSION_STATUS_LABEL[version.status])}
              </span>
            </div>

            {events.length === 0 ? null : (
              <ol className="flex flex-col">
                {events.map((evt, i) => (
                  <li
                    key={evt.id}
                    data-id={`version-event-${evt.id}`}
                    className="relative flex gap-2 pb-2 pl-1"
                  >
                    {/* 세로 연결선 (마지막 행 제외) / connecting line */}
                    {i < events.length - 1 && (
                      <span className="absolute left-[0.69rem] top-5 h-full w-px bg-divider" />
                    )}
                    <span className="z-[1] mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface text-ink-tertiary ring-1 ring-hairline">
                      <EventIcon type={evt.event_type} />
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-1.5 text-caption text-ink">
                      <span className="text-ink-secondary">
                        {EVENT_LABEL[evt.event_type] ? t(EVENT_LABEL[evt.event_type]) : evt.event_type}
                      </span>
                      <span className="text-ink">{evt.actor}</span>
                      <span className="text-fine text-ink-tertiary">{formatStamp(evt.created_at)}</span>
                      {evt.note && (
                        <span className="basis-full text-fine text-ink-tertiary">“{evt.note}”</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

> Verify `bg-divider` token exists (design.md references `border-divider`); if only `border-divider` exists, use `bg-[color:var(--color-divider)]` or the hairline token. Do not use raw hex.

- [ ] **Step 2: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/maps/version-timeline.tsx
git commit -m "feat(home): add VersionTimeline (git-log style) — 버전 히스토리 타임라인"
```

---

## Task 10: MapDetailCard — desc box, timeline, footer, delete confirm

**Files:**
- Modify: `frontend/src/components/maps/map-detail-card.tsx`

**Interfaces:**
- Consumes: `VersionTimeline` (Task 9), `ConfirmDialog` (Task 6), `home.descEmpty`/`home.confirmDelete*`/`common.*` (Task 7).

- [ ] **Step 1: Add imports + delete-confirm state**

In `frontend/src/components/maps/map-detail-card.tsx`:

Add imports near the existing ones:

```tsx
import { ConfirmDialog } from "@/components/confirm-dialog";
import { VersionTimeline } from "@/components/maps/version-timeline";
```

Inside the component (after the `myGroupIds` state, ~line 59), add:

```tsx
  const [confirmDelete, setConfirmDelete] = useState(false);
```

- [ ] **Step 2: Description → bordered read-only box**

Replace the description block (lines 122-124):

```tsx
      <div
        data-id="map-detail-description"
        className="rounded-sm border border-hairline bg-surface p-3 text-caption text-ink"
      >
        {detail.description ? (
          detail.description
        ) : (
          <span className="text-ink-tertiary">{t("home.descEmpty")}</span>
        )}
      </div>
```

- [ ] **Step 3: Versions list → timeline**

Replace the versions `<div>` block (lines 137-158) with:

```tsx
        <div data-id="map-detail-versions" className="flex min-w-[12rem] flex-1 flex-col gap-1">
          <p className="text-fine uppercase tracking-wide text-ink-tertiary">
            {t("home.versions")}
          </p>
          {detail.versions.length === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("perm.version.noVersions")}</p>
          ) : (
            <VersionTimeline versions={detail.versions} />
          )}
        </div>
```

- [ ] **Step 4: Remove footer Open link**

In the footer (lines 213-227), remove the first `<Link>` (the Open link, lines 215-220), keeping only the Settings link. The footer's left `<div>` becomes:

```tsx
        <div className="flex items-center gap-2">
          <Link
            href={`/maps/${detail.id}/settings`}
            className="rounded-sm border border-hairline px-2.5 py-1 text-caption text-ink hover:bg-surface"
          >
            {t("perm.settingsTitle")}
          </Link>
        </div>
```

- [ ] **Step 5: Delete button → open ConfirmDialog**

Replace the delete button (lines 228-236) with:

```tsx
        {isOwner && onDelete && (
          <button
            type="button"
            data-id="map-detail-delete"
            className="rounded-sm px-2.5 py-1 text-caption text-error hover:bg-surface"
            onClick={() => setConfirmDelete(true)}
          >
            {t("home.delete")}
          </button>
        )}
```

Then, at the end of the `showFooter` return (right before the final closing `</div>` of the outer container, after the footer `<div>`), render the dialog:

```tsx
      {confirmDelete && onDelete && (
        <ConfirmDialog
          title={t("home.confirmDeleteTitle")}
          message={t("home.confirmDeleteMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(detail.id);
          }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
```

- [ ] **Step 6: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/maps/map-detail-card.tsx
git commit -m "feat(home): detail desc box + version timeline + delete confirm, drop footer open — 상세 패널 개편"
```

---

## Task 11: page.tsx responsive accordion + create-dialog description

**Files:**
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/components/permissions/create-map-dialog.tsx`

**Interfaces:**
- Consumes: `createMap(name, description)` (Task 5), `perm.createDialog.description*` (Task 7).

- [ ] **Step 1: create-map-dialog — add description state**

In `frontend/src/components/permissions/create-map-dialog.tsx`, after the `name` state (line 115) add:

```tsx
  const [description, setDescription] = useState("");
```

- [ ] **Step 2: Pass description to createMap**

In `handleCreate`, change the createMap call (line 179):

```tsx
      const detail = await createMap(trimmed, description.trim());
```

Add `description` to the `useCallback` deps array (line 194): change `[currentUser, name, collaborators, approvers, onCreated, onClose, t]` to `[currentUser, name, description, collaborators, approvers, onCreated, onClose, t]`.

- [ ] **Step 3: Render the description textarea**

After the name field block (after line 259, before the visibility block at line 261), add:

```tsx
        {/* 설명 / description */}
        <div className="flex flex-col gap-1">
          <label className="text-caption text-ink-secondary">
            {t("perm.createDialog.descriptionLabel")}
          </label>
          <textarea
            data-id="create-map-description"
            className="min-h-[4rem] resize-y rounded-sm border border-hairline bg-surface px-3 py-1.5 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
            placeholder={t("perm.createDialog.descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
          />
        </div>
```

- [ ] **Step 4: page.tsx — responsive accordion under selected card**

In `frontend/src/app/page.tsx`, replace the master-detail block (lines 109-137). The list `<li>`s come from `MapCard`; to insert an accordion under the selected card on `< xl`, render the inline detail right after the matching card inside the `.map()`, and keep the side `<aside>` for `≥ xl`.

Replace lines 109-137 with:

```tsx
      <div className="mx-auto flex min-h-0 w-full max-w-[72rem] flex-1 gap-4">
        {visibleMaps.length === 0 ? (
          <p className="min-w-[18rem] max-w-[34rem] flex-1 rounded-sm border border-hairline bg-surface p-4 text-caption text-ink-tertiary">
            {t("home.empty")}
          </p>
        ) : (
          <ul className="flex min-w-[18rem] max-w-[34rem] flex-1 flex-col gap-2 overflow-y-auto pr-1">
            {visibleMaps.map((processMap) => (
              <li key={processMap.id} className="flex flex-col">
                <MapCard
                  map={processMap}
                  selected={effectiveSelected === processMap.id}
                  onSelect={setSelectedId}
                />
                {/* 폭이 좁을 때(< xl)만 — 선택 카드 아래 펼침 아코디언 / inline accordion below the selected card on narrow screens */}
                <div
                  data-id="map-detail-accordion"
                  className={`grid overflow-hidden transition-[grid-template-rows] duration-350 ease-smooth xl:hidden ${
                    effectiveSelected === processMap.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                >
                  <div className="min-h-0 overflow-hidden">
                    {effectiveSelected === processMap.id && (
                      <div className="mt-2 rounded-sm border border-hairline bg-surface-alt">
                        <MapDetailCard
                          mapId={processMap.id}
                          onDelete={(id) => void handleDelete(id)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {effectiveSelected !== null && (
          // ≥ xl — 우측 사이드 패널(현행) / wide screens: side panel
          <aside
            data-id="map-detail-aside"
            className="hidden min-w-[18rem] max-w-[34rem] flex-1 flex-col rounded-sm border border-hairline bg-surface-alt xl:flex"
          >
            <MapDetailCard
              key={effectiveSelected}
              mapId={effectiveSelected}
              onDelete={(id) => void handleDelete(id)}
            />
          </aside>
        )}
      </div>
```

> Note: `MapCard` currently renders its own `<li>`. After this change the parent wraps each card in a `<li>`, so `MapCard`'s root must become a non-`li` element OR keep `MapCard` as the `<li>` and move the accordion outside the list. To avoid nested `<li>`, change `MapCard`'s root element from `<li>` to `<div>` (and move `key` to the parent `<li>`). Apply that adjustment in this step: in `map-card.tsx`, change the root `<li ...>`/`</li>` (lines 61, 150) to `<div ...>`/`</div>`. The `onClick`/className stay identical.

- [ ] **Step 5: Verify typecheck (should now be fully green)**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (0 errors) — the Task 5 arity error is resolved here.

- [ ] **Step 6: Verify lint**

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/page.tsx frontend/src/components/permissions/create-map-dialog.tsx frontend/src/components/maps/map-card.tsx
git commit -m "feat(home): responsive detail accordion + create-dialog description — 반응형 펼침·설명 입력"
```

---

## Task 12: Settings page — Details tab (description editing)

**Files:**
- Create: `frontend/src/components/permissions/map-details-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/settings/page.tsx`

**Interfaces:**
- Consumes: `updateMap` (Task 5), `getMap` (existing), `perm.tabDetails`/`perm.details.*` (Task 7).
- Produces: `MapDetailsPanel({ mapId, canEdit, onToast }: { mapId: string; canEdit: boolean; onToast: (msg: string) => void })`.

- [ ] **Step 1: Create the panel**

Create `frontend/src/components/permissions/map-details-panel.tsx`:

```tsx
"use client";

// 맵 정보 탭 — description 편집(편집자+). 저장 시 PATCH /maps/{id} / Map details: edit description (editor+).

import { useEffect, useState } from "react";

import { getMap, updateMap } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface MapDetailsPanelProps {
  mapId: string;
  canEdit: boolean;
  onToast: (message: string) => void;
}

export function MapDetailsPanel({ mapId, canEdit, onToast }: MapDetailsPanelProps) {
  const { t } = useI18n();
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMap(Number(mapId))
      .then((d) => {
        if (active) setDescription(d.description);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      active = false;
    };
  }, [mapId]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await updateMap(Number(mapId), { description });
      onToast(t("perm.details.saved"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-id="settings-details" className="flex max-w-xl flex-col gap-3">
      <label className="text-caption text-ink-secondary">
        {t("perm.details.descriptionLabel")}
      </label>
      <textarea
        data-id="settings-description"
        className="min-h-[6rem] resize-y rounded-sm border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none placeholder:text-ink-tertiary focus:border-accent disabled:opacity-60"
        placeholder={t("perm.details.descriptionPlaceholder")}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={!canEdit || saving}
      />
      {error && <p className="text-caption text-error">{error}</p>}
      {canEdit && (
        <div>
          <button
            type="button"
            data-id="settings-description-save"
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
            onClick={() => void handleSave()}
            disabled={saving}
          >
            {t("perm.details.save")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the tab in settings page**

In `frontend/src/app/maps/[mapId]/settings/page.tsx`:

(a) Import the panel (with other component imports, ~line 16):

```tsx
import { MapDetailsPanel } from "@/components/permissions/map-details-panel";
```

(b) Add `"details"` to the `TabId` union (line 26):

```tsx
type TabId = "details" | "collaborators" | "approvers" | "visibility" | "versions" | "danger" | "approvals";
```

(c) Extend the `Tab.labelKey` union (line 30) to include `"perm.tabDetails"`:

```tsx
  labelKey: "perm.tabDetails" | "perm.tabCollaborators" | "perm.tabApprovers" | "perm.tabVisibility" | "perm.tabVersions" | "perm.tabDanger" | "perm.tabPendingApprovals";
```

(d) Add the tab as the FIRST entry of `ALL_TABS` (line 35):

```tsx
const ALL_TABS: Tab[] = [
  { id: "details", labelKey: "perm.tabDetails" },
  { id: "collaborators", labelKey: "perm.tabCollaborators" },
```

(e) Change the default active tab (line 93) to details:

```tsx
  const [activeTab, setActiveTab] = useState<TabId>("details");
```

(f) Add the render branch — insert before the `activeTab === "collaborators"` branch (line 276), right after the `!currentMockUser` branch:

```tsx
          ) : activeTab === "details" ? (
            <MapDetailsPanel mapId={mapIdStr} canEdit={canEdit} onToast={showToast} />
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (0 errors)

- [ ] **Step 4: Verify lint**

Run: `cd frontend && npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/permissions/map-details-panel.tsx frontend/src/app/maps/[mapId]/settings/page.tsx
git commit -m "feat(settings): Details tab to edit map description — 설정 페이지 설명 편집"
```

---

## Task 13: Integration verification

**Files:** none (verification only)

- [ ] **Step 1: Backend — full suite + lint**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/ scripts/`
Expected: all pass (266 baseline + new tests), ruff clean.

- [ ] **Step 2: Frontend — typecheck + lint + build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 3: Manual smoke (local native, per CLAUDE.md ops)**

Reseed + run servers, then verify in browser (system Chrome). Reseed: `cd backend && .venv/bin/python -m scripts.reset_db` (confirms backfill prints "backfill version 'created' events: N건"). Start backend (`uvicorn app.main:app --reload --port 8000`) and frontend (`npm run dev`). Check:
  - 카드: 이름 클릭 → 같은 탭 에디터 이동; 우상단 아이콘 → 새 탭; description 미표시.
  - 상세: description 경계 박스(빈 맵은 "No description"); 버전 = 타임라인(생성 이벤트 보임, actor/시각); footer에 Open 없음(Settings만); Delete → 확인 모달.
  - 폭 좁힘(< 1280px): 사이드 패널 사라지고 선택 카드 아래 펼침 아코디언(부드러운 높이 전환).
  - 생성 다이얼로그: description 입력 → 생성 후 설정 Details 탭/상세 박스에 반영.
  - 설정: Details 탭에서 description 편집·저장(토스트).
  - 워크플로 1회전(submit→approve→publish) 후 상세 타임라인에 이벤트 누적.

Record actual observed output. If any step fails, fix before declaring complete (do not claim "verified" from reading alone).

---

## Self-Review (completed during planning)

- **Spec coverage:** 맵카드 1(확인/카드 description 숨김)=Task 8; 2(이름 열기)=Task 8; 3(우상단 새 탭)=Task 8. 상세 1(반응형 아코디언)=Task 11; 2(유저/버전 분리·git-graph)=Task 9/10; 3(타임스탬프+who, DB)=Task 1-4; 4(description 경계/패딩)=Task 10; 5(좌하단 Open 삭제)=Task 10; 6(삭제 확인 모달)=Task 6/10. description 입력처(생성+설정)=Task 11/12.
- **Type consistency:** `record_version_event` 시그니처 동일하게 사용; `VersionDetail`/`VersionEvent` 프론트 타입이 백엔드 `VersionDetailOut`/`VersionEventOut`와 필드 일치; `createMap(name, description)`/`updateMap` 호출부(Task 11/12)와 정의(Task 5) 일치.
- **tsc green 유지:** `createMap`의 `description`은 기본값 `""` — 기존 호출부가 깨지지 않아 매 태스크 tsc green. (Task 11에서 실제 description 전달로 교체.)
- **Token caveats:** `bg-error`/`text-on-accent`/`bg-divider` 토큰 존재를 globals.css에서 확인하고 없으면 명시된 대체 토큰 사용(raw hex 금지).
