# Framework 슬롯 거버넌스 트랙 A+B — 핫픽스·적용 코어·이력·캔버스 표시 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 슬롯 변경 5액션(assign·unassign·move·replace·delete)을 한 코어 함수로 적용하되 홈 L5 캔버스 재지정·계보·이벤트·알림이 함께 움직이게 하고, 캔버스가 미싱·이양 상태를 표시하며, 조사에서 확인한 결함 ①②③④를 회귀 테스트로 고정한다. 승인 요청 생성은 트랙 C가 맡는다 — 이 플랜에서 비관리자는 409를 받는다.

**Architecture:** 코어는 신설 모듈 `backend/app/framework_slots.py`(검증 `validate_slot_change` → 계획 `SlotPlan` → 적용 `apply_slot_change`)에 두고, 라우터 `backend/app/routers/slot_changes.py`(`POST /api/maps/{id}/slot-changes`, `dry_run`)와 레거시 어댑터(`PUT /category`·`POST /framework-transfer`)가 그 코어를 부른다. 이력은 신설 테이블 `framework_slot_events`, 캔버스 표시는 `SubprocessRefOut` 확장(`superseded`·시각 3종)을 FE가 `lib/framework-slot-state.ts`로 파생한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + vitest / Playwright(playwright-core+시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §3(결함)·§5(액션별 규칙)·§6(데이터)·§7.1~7.2(캔버스·배정 모달)·§9(가드)·§13 트랙 A·B.

## Global Constraints

- 베이스 브랜치 `dev`(9ddd2f3e), 작업 브랜치 `feat/fw-slot-handover`(워크트리 `.claude/worktrees/fw-slot-handover`, venv·node_modules 구성 완료). 커밋은 이 브랜치에만.
- BE 테스트: `backend/`에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider`. 린트 `.venv/bin/ruff check app/ tests/`(py311 — 3.12+ 문법 금지).
- FE 게이트: `frontend/`에서 `npx tsc --noEmit -p tsconfig.json`·`npm run lint`·`npx vitest run`·`npm run build`.
- 신규 **테이블** `framework_slot_events`는 startup `create_all`이 만든다 — `db.py _ADDED_COLUMNS` 등록 불필요(기존 테이블 컬럼 추가 없음). 색은 토큰만. i18n은 `en`/`ko` 두 블록 대칭(Record라 누락은 tsc가 잡음).
- 고정 문자열 — 액션 `assign`·`unassign`·`move`·`replace`·`delete`, 이벤트 액션에 `succeed` 추가. HTTP detail: 422 `"only normal maps can hold a framework slot"` · 422 `"maps can only be attached to a level-5 category"`(기존) · 409 `"source map has no framework slot"`(기존) · 409 `"target map already has a framework slot"`(기존) · 409 `"slot changes require L5 admin approval"` · 409 `"slotted maps are deleted through slot-changes"` · 409 `"slotted maps are retired through slot-changes"`.
- 알림 타입(이 플랜은 1종만 발송): `fw_slot_applied`. 요청/거절 2종은 트랙 C.
- 커밋 메시지 `type(scope): English summary — 한국어 요약`, 말미에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` + `Claude-Session: https://claude.ai/code/session_01WJnAZvozJDizUX2hFzMCRj`. PROGRESS는 마지막 태스크에서 1회.
- 아래 줄번호는 dev 9ddd2f3e 실측(2026-09-04) — 선행 태스크로 어긋나면 심볼/grep으로 재확인. `frontend/`의 `grep`은 ugrep이라 `[mapId]` 디렉터리를 건너뛴다 — `git grep` 사용.
- FE 컴포넌트 사용처를 바꾸면(모달·다이얼로그 신설/이동) 같은 커밋에서 `node scripts/build-component-catalog.mjs`로 `frontend/COMPONENTS.md` 재생성(`rules/frontend/components.md`).

---

### Task 1: 결함 ①②를 회귀 테스트로 고정하고 레거시 엔드포인트에 최소 핫픽스

**Files:**
- Create: `backend/tests/test_framework_slots.py`
- Modify: `backend/app/routers/maps.py:1323-1414` (`set_map_category`, `transfer_framework_slot`)

**Interfaces:**
- Produces: 테스트 헬퍼 `SYSADMIN`, `DEPT`, `act_as`, `enforce`, `_seed_category`, `_seed_l6_map`, `_map_row`, `_draft_id`, `_create_map` — 이후 태스크의 테스트가 같은 파일에 append.

- [ ] **Step 1: 테스트 파일 뼈대 + 결함 ①② 실패 테스트**

`backend/tests/test_framework_slots.py` 신규:

```python
"""Framework 슬롯 변경 — 결함 회귀·코어·slot-changes 엔드포인트 (spec 2026-09-06).

client 픽스처가 세션 스코프 공유 DB라 카테고리 코드는 이 파일 전용 접두사(FWS-*)로 격리한다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapVersion, ProcessCategory, ProcessMap
from app.settings import settings

SYSADMIN = "fws.sysadmin"
DEPT = "Owning Anchor Division"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이어서 권한 분기가 안 걸린다."""
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


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _seed_category(code: str, name: str, level: int = 1, parent_id: int | None = None) -> int:
    async def _seed(session):
        row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
        if row is None:
            row = ProcessCategory(code=code, name=name, level=level, parent_id=parent_id, sort_order=0)
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _seed_l6_map(category_id: int | None, name: str, code: str | None, owner: str = SYSADMIN) -> int:
    """게시본 1개를 가진 일반 맵 — code가 있으면 consultant_code(멱등 키)로 재사용."""

    async def _seed(session):
        row = None
        if code is not None:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
        if row is None:
            row = ProcessMap(name=name, created_by=owner, owner_id=owner, visibility="public",
                             category_id=category_id, consultant_code=code)
            row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _map_row(map_id: int) -> dict:
    async def _get(session):
        m = await session.get(ProcessMap, map_id)
        return {"category_id": m.category_id, "consultant_code": m.consultant_code,
                "deleted": m.deleted_at is not None, "retired_to": m.retired_to_map_id, "mode": m.mode}

    return _run(_get)


def _draft_id(client: TestClient, map_id: int) -> int:
    detail = client.get(f"/api/maps/{map_id}").json()
    return next(v for v in detail["versions"] if v["status"] == "draft")["id"]


def _create_map(client: TestClient, name: str) -> int:
    resp = client.post("/api/maps", json={"name": name, "visibility": "public", "owning_department": DEPT})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


# ── 결함 회귀 (2026-09-03 프로브 승격) ─────────────────────────────────────────


def test_transfer_succeeds_when_target_id_is_lower(client: TestClient) -> None:
    """결함 ①: target.id < source.id 이면 UPDATE 순서(PK 오름차순) 때문에 unique(consultant_code) 충돌."""
    l5 = _seed_category("FWS-A5", "핫픽스A", level=5)
    target = _create_map(client, "fws hotfix target older")
    source = _seed_l6_map(l5, "fws hotfix source", "FWS-A-SRC")
    assert target < source
    resp = client.post(f"/api/maps/{source}/framework-transfer", json={"to_map_id": target})
    assert resp.status_code == 200, resp.text
    assert _map_row(source)["consultant_code"] is None
    assert _map_row(target) == {"category_id": l5, "consultant_code": "FWS-A-SRC", "deleted": False,
                                "retired_to": None, "mode": "normal"}


def test_slot_endpoints_reject_non_normal_maps(client: TestClient) -> None:
    """결함 ②: 연계 캔버스(mode=framework)는 슬롯 대상도 이양 대상도 될 수 없다."""
    l5 = _seed_category("FWS-B5", "핫픽스B", level=5)
    other_l5 = _seed_category("FWS-B5X", "핫픽스BX", level=5)
    canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]
    src = _seed_l6_map(l5, "fws hotfix src", "FWS-B-SRC")
    r1 = client.put(f"/api/maps/{canvas}/category", json={"category_id": l5})
    assert r1.status_code == 422 and "normal maps" in r1.json()["detail"]
    r2 = client.post(f"/api/maps/{src}/framework-transfer", json={"to_map_id": canvas})
    assert r2.status_code == 422 and "normal maps" in r2.json()["detail"]
    assert _map_row(canvas)["category_id"] is None
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py -q -p no:cacheprovider`
Expected: 2 failed — 첫 테스트는 `IntegrityError: UNIQUE constraint failed: process_maps.consultant_code`, 둘째는 `assert 200 == 422`.

- [ ] **Step 3: 레거시 엔드포인트 핫픽스**

`backend/app/routers/maps.py` `set_map_category`(1334 docstring 다음, 404 검사 뒤)에 추가:

```python
    if found_map.mode != "normal":
        # 슬롯 보유 자격은 일반 맵만 — 연계 캔버스·Word 맵은 서랍에 들어가지 않는다 (spec 2026-09-06 §9)
        raise HTTPException(status_code=422, detail="only normal maps can hold a framework slot")
```

`transfer_framework_slot`에서 target 404 검사 뒤에 같은 가드를 target에 추가하고, 마지막 4줄(1409-1412)을 flush 순서 픽스로 교체:

```python
    if target.mode != "normal":
        raise HTTPException(status_code=422, detail="only normal maps can hold a framework slot")
```

```python
    # 결함 ①: SQLAlchemy는 UPDATE를 PK 오름차순으로 내보내 target.id < source.id 이면 target에 코드가
    # 먼저 박혀 unique(consultant_code)에 걸린다 — source를 먼저 비우고 flush한 뒤 target에 붙인다.
    slot_category_id = source.category_id
    slot_code = source.consultant_code
    source.category_id = None
    source.consultant_code = None
    await session.flush()
    target.category_id = slot_category_id
    target.consultant_code = slot_code
    await session.commit()
    return {"from_map_id": map_id, "to_map_id": payload.to_map_id}
```

- [ ] **Step 4: 통과 확인 + 기존 스위트**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py tests/test_categories_api.py -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 모두 passed, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/test_framework_slots.py backend/app/routers/maps.py
git commit -m "fix(framework): flush the source slot before handing it over and reject non-normal maps — 이양 flush 순서·캔버스 맵 슬롯 차단"
```

---

### Task 2: 이력 테이블 `framework_slot_events`

**Files:**
- Modify: `backend/app/models.py` (`CategoryPermission` 클래스 뒤, 683-703 부근)
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces: `FrameworkSlotEvent(map_id, action, from_category_id, to_category_id, to_map_id, actor, request_id, created_at)` — Task 3~6·트랙 C가 기록/조회.

- [ ] **Step 1: 실패 테스트**

`test_framework_slots.py`에 추가:

```python
def test_slot_event_table_roundtrip(client: TestClient) -> None:
    """신설 테이블이 create_all로 존재하고 ORM 왕복이 된다 (spec §6.1)."""
    from app.models import FrameworkSlotEvent

    l5 = _seed_category("FWS-E5", "이벤트", level=5)
    mid = _seed_l6_map(l5, "fws event map", "FWS-E-M1")

    async def _go(session):
        session.add(FrameworkSlotEvent(map_id=mid, action="assign", to_category_id=l5, actor=SYSADMIN))
        await session.flush()
        row = await session.scalar(select(FrameworkSlotEvent).where(FrameworkSlotEvent.map_id == mid))
        return (row.action, row.to_category_id, row.request_id, row.created_at is not None)

    assert _run(_go) == ("assign", l5, None, True)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py::test_slot_event_table_roundtrip -q -p no:cacheprovider`
Expected: FAIL `ImportError: cannot import name 'FrameworkSlotEvent'`.

- [ ] **Step 3: 모델 추가**

`backend/app/models.py`의 `class CategoryPermission(Base)` 정의 끝(다음 클래스 `ApprovalRequest` 앞)에:

```python
class FrameworkSlotEvent(Base):
    """L6 슬롯 변경 이력 — 유지보수 단계의 assign/unassign/move/replace/delete(+후계자 관점 succeed).

    임포트(부트스트랩)는 기록하지 않는다. 캔버스 호버 패널의 시각 3종·최근 이양 배지 소스 (spec 2026-09-06 §6.1).
    """

    __tablename__ = "framework_slot_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(
        ForeignKey("process_maps.id", ondelete="CASCADE"), index=True
    )
    # 'assign' | 'unassign' | 'move' | 'replace' | 'delete' | 'succeed'(후계자 관점)
    action: Mapped[str] = mapped_column(String(20))
    from_category_id: Mapped[int | None] = mapped_column(Integer, default=None)
    to_category_id: Mapped[int | None] = mapped_column(Integer, default=None)
    # replace/delete의 후계자, succeed의 원본
    to_map_id: Mapped[int | None] = mapped_column(Integer, default=None)
    actor: Mapped[str] = mapped_column(String(100))
    request_id: Mapped[int | None] = mapped_column(
        ForeignKey("approval_requests.id", ondelete="SET NULL"), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

(`Integer`·`ForeignKey`·`String`·`DateTime`·`datetime`·`_now`는 파일 상단에 이미 import/정의돼 있다.)

- [ ] **Step 4: 통과 확인**

Run: 같은 명령. Expected: PASS. 기존 테스트 DB는 lifespan `create_all`이 새 테이블을 만든다.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): add framework_slot_events table for L6 slot lifecycle history — 슬롯 변경 이력 테이블"
```

---

### Task 3: 코어 모듈 — 검증·계획·적용(assign/unassign/move)

**Files:**
- Create: `backend/app/framework_slots.py`
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces:
  - `SLOT_ACTIONS: tuple[str, ...]`
  - `@dataclass SlotChange(action: str, map_id: int, to_category_id: int | None = None, to_map_id: int | None = None, note: str = "")`
  - `@dataclass SlotPlan(change, source: ProcessMap, target: ProcessMap | None, from_category_id: int | None, sides: list[int], self_apply: bool)`
  - `async validate_slot_change(session, change, actor) -> SlotPlan` — 404/409/422 HTTPException
  - `async apply_slot_change(session, plan, actor, request_id=None) -> None` — commit은 호출자
  - `async build_preview(session, plan, actor) -> dict` — `{"self_apply", "sides": [{category_id, path, approvers, satisfied_by_caller}], "impact": {...}}`
  - `async can_self_apply(session, actor, sides) -> bool`
- Consumes: `FrameworkSlotEvent`(Task 2), `grid_positions`·`LINKAGE_Y0`·`LINKAGE_Y_STEP`(app.subprocess), `get_category_admin_logins`·`is_direct_l5_admin`(permissions.access).

- [ ] **Step 1: 실패 테스트 — assign/unassign/move 코어 동작**

`test_framework_slots.py`에 추가:

```python
# ── 코어: validate / apply ─────────────────────────────────────────────────────


def _apply(change_kwargs: dict, actor: str = SYSADMIN) -> None:
    from app.framework_slots import SlotChange, apply_slot_change, validate_slot_change

    async def _go(session):
        plan = await validate_slot_change(session, SlotChange(**change_kwargs), actor)
        await apply_slot_change(session, plan, actor)

    _run(_go)


def _events(map_id: int) -> list[tuple[str, int | None, int | None, int | None]]:
    from app.models import FrameworkSlotEvent

    async def _go(session):
        rows = (await session.scalars(
            select(FrameworkSlotEvent).where(FrameworkSlotEvent.map_id == map_id)
            .order_by(FrameworkSlotEvent.id)
        )).all()
        return [(r.action, r.from_category_id, r.to_category_id, r.to_map_id) for r in rows]

    return _run(_go)


def _linked_ids(client: TestClient, canvas_map_id: int) -> list[int]:
    graph = client.get(f"/api/versions/{_draft_id(client, canvas_map_id)}/graph").json()
    return sorted(n["linked_map_id"] for n in graph["nodes"] if n["node_type"] == "subprocess")


def test_core_assign_unassign_move(client: TestClient) -> None:
    """assign은 홈 캔버스에 노드 append, unassign은 노드 유지, move는 새 캔버스 append — 이벤트 각 1행."""
    l5a = _seed_category("FWS-C5A", "코어A", level=5)
    l5b = _seed_category("FWS-C5B", "코어B", level=5)
    canvas_a = client.post(f"/api/categories/{l5a}/linkage-map").json()["map_id"]
    canvas_b = client.post(f"/api/categories/{l5b}/linkage-map").json()["map_id"]
    mid = _create_map(client, "fws core map")

    _apply({"action": "assign", "map_id": mid, "to_category_id": l5a})
    assert _map_row(mid)["category_id"] == l5a
    assert mid in _linked_ids(client, canvas_a)

    _apply({"action": "move", "map_id": mid, "to_category_id": l5b})
    assert _map_row(mid)["category_id"] == l5b
    assert mid in _linked_ids(client, canvas_a)  # 옛 캔버스 노드 유지(외부 L6로 표시)
    assert mid in _linked_ids(client, canvas_b)

    _apply({"action": "unassign", "map_id": mid})
    assert _map_row(mid)["category_id"] is None
    assert mid in _linked_ids(client, canvas_b)  # 노드 유지 → unassigned 상태로 파생 표시

    assert _events(mid) == [("assign", None, l5a, None), ("move", l5a, l5b, None), ("unassign", l5b, None, None)]


def test_core_validation_errors(client: TestClient) -> None:
    from fastapi import HTTPException

    from app.framework_slots import SlotChange, validate_slot_change

    l1 = _seed_category("FWS-V1", "검증L1")
    l5 = _seed_category("FWS-V5", "검증L5", level=5, parent_id=l1)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    slotted = _seed_l6_map(l5, "fws validate slotted", "FWS-V-M1")
    free = _create_map(client, "fws validate free")

    def _status(kwargs: dict) -> int:
        async def _go(session):
            try:
                await validate_slot_change(session, SlotChange(**kwargs), SYSADMIN)
            except HTTPException as exc:
                return exc.status_code
            return 200

        return _run(_go)

    assert _status({"action": "assign", "map_id": free, "to_category_id": l1}) == 422       # L5 아님
    assert _status({"action": "assign", "map_id": slotted, "to_category_id": l5}) == 409    # 이미 슬롯
    assert _status({"action": "assign", "map_id": canvas, "to_category_id": l5}) == 422     # mode
    assert _status({"action": "unassign", "map_id": free}) == 409                           # 슬롯 없음
    assert _status({"action": "move", "map_id": slotted, "to_category_id": l5}) == 409      # 같은 L5
    assert _status({"action": "replace", "map_id": slotted, "to_map_id": canvas}) == 422    # target mode
    assert _status({"action": "replace", "map_id": slotted, "to_map_id": slotted}) == 409   # 자기 자신
    assert _status({"action": "delete", "map_id": free}) == 409                             # 슬롯 없음
    assert _status({"action": "bogus", "map_id": free}) == 422
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py -q -p no:cacheprovider -k core`
Expected: FAIL `ModuleNotFoundError: No module named 'app.framework_slots'`.

- [ ] **Step 3: 코어 모듈 작성 (assign/unassign/move + 공통 골격)**

`backend/app/framework_slots.py` 신규:

```python
"""Framework 슬롯 변경 코어 — 전제 검증·적용(캔버스 재지정·계보·이벤트·알림)의 단일 진입점.

라우터(slot_changes.py)·레거시 어댑터(maps.py)·요청 승인(permissions._apply_request)이 공용으로
부른다. 요청 생성(dry_run)과 승인 적용이 같은 validate를 거쳐 전제가 한 곳에만 산다 (spec 2026-09-06 §5).
"""

from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.clock import now as now_kst
from app.models import (
    Edge,
    FrameworkSlotEvent,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.permissions import logic
from app.permissions.access import get_category_admin_logins, is_direct_l5_admin
from app.subprocess import LINKAGE_Y0, LINKAGE_Y_STEP, grid_positions
from app.version_events import record_version_event

SLOT_ACTIONS: tuple[str, ...] = ("assign", "unassign", "move", "replace", "delete")


@dataclass
class SlotChange:
    action: str
    map_id: int
    to_category_id: int | None = None
    to_map_id: int | None = None
    note: str = ""


@dataclass
class SlotPlan:
    change: SlotChange
    source: ProcessMap
    target: ProcessMap | None
    from_category_id: int | None
    # 승인이 필요한 L5 카테고리 id — move는 [from, to], 나머지는 1개 (spec §4.1)
    sides: list[int] = field(default_factory=list)
    self_apply: bool = False


async def _load_live_map(session: AsyncSession, map_id: int) -> ProcessMap:
    found = await session.get(ProcessMap, map_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found


def _assert_normal(found: ProcessMap) -> None:
    if found.mode != "normal":
        raise HTTPException(status_code=422, detail="only normal maps can hold a framework slot")


async def _load_l5(session: AsyncSession, category_id: int | None) -> ProcessCategory:
    if category_id is None:
        raise HTTPException(status_code=422, detail="to_category_id is required")
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    if category.level != 5:
        raise HTTPException(status_code=422, detail="maps can only be attached to a level-5 category")
    return category


async def can_self_apply(session: AsyncSession, actor: str, sides: list[int]) -> bool:
    """sysadmin이거나 모든 side의 직속 L5 관리자면 요청 없이 즉시 적용 (spec §2 자기결재)."""
    if logic.is_sysadmin(actor):
        return True
    for cid in sides:
        if not await is_direct_l5_admin(session, actor, cid):
            return False
    return bool(sides)


async def validate_slot_change(session: AsyncSession, change: SlotChange, actor: str) -> SlotPlan:
    """액션별 전제(spec §5 표) — 통과하면 적용 계획을 돌려준다. 호출자 자격(owner)은 라우터가 검증."""
    if change.action not in SLOT_ACTIONS:
        raise HTTPException(status_code=422, detail=f"unknown slot action {change.action!r}")
    source = await _load_live_map(session, change.map_id)
    _assert_normal(source)
    from_category_id = source.category_id
    target: ProcessMap | None = None
    sides: list[int]

    if change.action == "assign":
        if from_category_id is not None:
            raise HTTPException(status_code=409, detail="map already has a framework slot")
        category = await _load_l5(session, change.to_category_id)
        sides = [category.id]
    elif change.action == "unassign":
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        sides = [from_category_id]
    elif change.action == "move":
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        category = await _load_l5(session, change.to_category_id)
        if category.id == from_category_id:
            raise HTTPException(status_code=409, detail="map is already in that category")
        sides = [from_category_id, category.id]
    else:  # replace · delete
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        slot_category = await session.get(ProcessCategory, from_category_id)
        if slot_category is None or slot_category.level != 5:
            raise HTTPException(
                status_code=409,
                detail="framework slot must point to a level-5 category - reassign before transfer",
            )
        if change.action == "replace" or change.to_map_id is not None:
            if change.to_map_id is None:
                raise HTTPException(status_code=422, detail="to_map_id is required")
            if change.to_map_id == source.id:
                raise HTTPException(status_code=409, detail="target must differ from source")
            target = await _load_live_map(session, change.to_map_id)
            _assert_normal(target)
            if target.category_id is not None or target.consultant_code is not None:
                raise HTTPException(status_code=409, detail="target map already has a framework slot")
        sides = [from_category_id]

    return SlotPlan(
        change=change, source=source, target=target, from_category_id=from_category_id,
        sides=sides, self_apply=await can_self_apply(session, actor, sides),
    )


async def _home_draft(session: AsyncSession, category_id: int | None) -> tuple[ProcessMap | None, MapVersion | None]:
    """L5의 연계 캔버스 라이브 draft — 캔버스가 없거나 삭제됐으면 (None, None)."""
    if category_id is None:
        return None, None
    category = await session.get(ProcessCategory, category_id)
    if category is None or category.linkage_map_id is None:
        return None, None
    canvas = await session.get(ProcessMap, category.linkage_map_id)
    if canvas is None or canvas.deleted_at is not None:
        return None, None
    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == canvas.id, MapVersion.status == workflow.DRAFT)
        .order_by(MapVersion.id.desc())
    )
    return canvas, draft


async def _append_contained_node(session: AsyncSession, draft: MapVersion, found: ProcessMap) -> bool:
    """소속 L6 노드가 없으면 격자 하단에 append — open_linkage_map 보강과 같은 산식. 추가했으면 True."""
    exists = await session.scalar(
        select(Node.id).where(
            Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == found.id
        )
    )
    if exists is not None:
        return False
    max_y, max_sort, node_count = (
        await session.execute(
            select(func.max(Node.pos_y), func.max(Node.sort_order), func.count())
            .where(Node.version_id == draft.id)
        )
    ).one()
    base_y = (max_y + LINKAGE_Y_STEP) if node_count else LINKAGE_Y0
    (px, py), = grid_positions(0, 1, base_y)
    session.add(
        Node(id=uuid4().hex, version_id=draft.id, title=found.name, node_type="subprocess",
             linked_map_id=found.id, follow_latest=True, pos_x=px, pos_y=py,
             sort_order=(max_sort + 1) if node_count else 0)
    )
    return True


def _record_event(
    session: AsyncSession, *, map_id: int, action: str, actor: str,
    from_category_id: int | None = None, to_category_id: int | None = None,
    to_map_id: int | None = None, request_id: int | None = None,
) -> None:
    session.add(
        FrameworkSlotEvent(
            map_id=map_id, action=action, from_category_id=from_category_id,
            to_category_id=to_category_id, to_map_id=to_map_id, actor=actor, request_id=request_id,
        )
    )


async def _category_path(session: AsyncSession, category_id: int | None) -> str | None:
    if category_id is None:
        return None
    from app.routers.categories import build_category_paths  # 지역 import — 순환 회피(subprocess.py 관례)

    rows = (
        await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name))
    ).all()
    return build_category_paths(rows).get(category_id)


async def _notify_applied(
    session: AsyncSession, plan: SlotPlan, actor: str, drafts: list[MapVersion]
) -> None:
    """L5 직속·조상 관리자 + 대상/후계자 owner + 캔버스 체크아웃 보유자에게 fw_slot_applied (spec §7.4)."""
    recipients: list[str] = []
    for cid in plan.sides:
        recipients += await get_category_admin_logins(session, cid, direct_only=False)
    if plan.source.owner_id:
        recipients.append(plan.source.owner_id)
    if plan.target is not None and plan.target.owner_id:
        recipients.append(plan.target.owner_id)
    recipients += [d.checked_out_by for d in drafts if d.checked_out_by]
    recipients = [r for r in dict.fromkeys(recipients) if r != actor]
    if not recipients:
        return
    actor_name = await workflow.get_display_name(session, actor)
    change = plan.change
    await workflow.create_notifications(
        session,
        recipients,
        type="fw_slot_applied",
        map_id=plan.source.id,
        message=f"{actor_name} applied slot change '{change.action}' on '{plan.source.name}'",
        payload={
            "map_name": plan.source.name, "actor": actor, "actor_name": actor_name,
            "action": change.action,
            "from_path": await _category_path(session, plan.from_category_id),
            "to_path": await _category_path(session, change.to_category_id),
            "to_map_id": plan.target.id if plan.target is not None else None,
            "to_map_name": plan.target.name if plan.target is not None else None,
        },
    )


async def apply_slot_change(
    session: AsyncSession, plan: SlotPlan, actor: str, request_id: int | None = None
) -> None:
    """검증된 계획을 한 세션 트랜잭션에서 적용 — 데이터·캔버스·계보·이벤트·알림. commit은 호출자 책임."""
    change, source, target = plan.change, plan.source, plan.target
    touched_drafts: list[MapVersion] = []

    if change.action == "assign":
        source.category_id = change.to_category_id
        _, draft = await _home_draft(session, change.to_category_id)
        if draft is not None and await _append_contained_node(session, draft, source):
            record_version_event(session, draft.id, "slot_changed", actor, note=f"assign {source.name}")
            touched_drafts.append(draft)
        _record_event(session, map_id=source.id, action="assign", actor=actor,
                      to_category_id=change.to_category_id, request_id=request_id)

    elif change.action == "unassign":
        # consultant_code는 유지 — 재전달 결착 키. 홈 캔버스 노드는 그대로 두고 unassigned 상태로 파생 표시.
        source.category_id = None
        _record_event(session, map_id=source.id, action="unassign", actor=actor,
                      from_category_id=plan.from_category_id, request_id=request_id)

    elif change.action == "move":
        source.category_id = change.to_category_id
        _, draft = await _home_draft(session, change.to_category_id)
        if draft is not None and await _append_contained_node(session, draft, source):
            record_version_event(session, draft.id, "slot_changed", actor, note=f"move-in {source.name}")
            touched_drafts.append(draft)
        _record_event(session, map_id=source.id, action="move", actor=actor,
                      from_category_id=plan.from_category_id, to_category_id=change.to_category_id,
                      request_id=request_id)

    else:
        touched_drafts += await _apply_handover(session, plan, actor, request_id)

    await session.flush()
    await _notify_applied(session, plan, actor, touched_drafts)


async def _apply_handover(
    session: AsyncSession, plan: SlotPlan, actor: str, request_id: int | None
) -> list[MapVersion]:
    """replace / delete — Task 4에서 구현."""
    raise HTTPException(status_code=501, detail="handover not implemented yet")


async def build_preview(session: AsyncSession, plan: SlotPlan, actor: str) -> dict:
    """dry_run 응답 — side별 승인자·호출자 충족 여부 + 영향 집계 (spec §4.1)."""
    sides = []
    for cid in plan.sides:
        approvers = await get_category_admin_logins(session, cid, direct_only=True)
        satisfied = logic.is_sysadmin(actor) or await is_direct_l5_admin(session, actor, cid)
        sides.append({"category_id": cid, "path": await _category_path(session, cid),
                      "approvers": approvers, "satisfied_by_caller": satisfied})
    canvas, draft = await _home_draft(session, plan.from_category_id)
    home_nodes = edges_kept = 0
    if draft is not None:
        node_ids = list(
            (await session.scalars(
                select(Node.id).where(Node.version_id == draft.id, Node.linked_map_id == plan.source.id)
            )).all()
        )
        home_nodes = len(node_ids)
        if node_ids:
            edges_kept = await session.scalar(
                select(func.count()).select_from(Edge).where(
                    Edge.version_id == draft.id,
                    (Edge.source_node_id.in_(node_ids)) | (Edge.target_node_id.in_(node_ids)),
                )
            ) or 0
    other_q = (
        select(func.count(func.distinct(MapVersion.map_id)))
        .select_from(Node).join(MapVersion, MapVersion.id == Node.version_id)
        .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
        .where(Node.linked_map_id == plan.source.id, ProcessMap.deleted_at.is_(None))
    )
    if canvas is not None:
        other_q = other_q.where(MapVersion.map_id != canvas.id)
    other_canvas = await session.scalar(other_q.where(ProcessMap.mode == "framework")) or 0
    referencing = await session.scalar(other_q.where(ProcessMap.mode != "framework")) or 0
    return {
        "self_apply": plan.self_apply,
        "sides": sides,
        "impact": {"home_canvas_nodes": home_nodes, "other_canvas_nodes": other_canvas,
                   "referencing_maps": referencing, "edges_kept": edges_kept},
    }
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 모두 passed(`_apply_handover`는 이 태스크 테스트가 부르지 않음), ruff clean. `now_kst` 미사용 경고가 나면 import에서 제거.

- [ ] **Step 5: Commit**

```bash
git add backend/app/framework_slots.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): slot change core with validate/plan/apply for assign, unassign and move — 슬롯 변경 코어(검증·계획·적용)"
```

---

### Task 4: 코어 — replace·delete(홈 캔버스 재지정·합치기·계보)

**Files:**
- Modify: `backend/app/framework_slots.py` (`_apply_handover`)
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces: `_apply_handover(session, plan, actor, request_id) -> list[MapVersion]` — replace/delete 공용. 이벤트: source에 `replace`/`delete`, target에 `succeed`.

- [ ] **Step 1: 실패 테스트 — 결함 ③④ 회귀 + 합치기**

```python
# ── 코어: replace / delete ─────────────────────────────────────────────────────


def _readiness_codes(client: TestClient, canvas_map_id: int) -> list[str]:
    body = client.get(f"/api/maps/{canvas_map_id}/confirm-readiness").json()
    return sorted(f["code"] for f in body["failures"])


def _put_edge(client: TestClient, draft_id: int, source_map: int, target_map: int) -> None:
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    na = next(n for n in graph["nodes"] if n["linked_map_id"] == source_map)
    nb = next(n for n in graph["nodes"] if n["linked_map_id"] == target_map)
    edge = {"id": uuid4().hex, "source_node_id": na["id"], "target_node_id": nb["id"]}
    r = client.put(f"/api/versions/{draft_id}/graph",
                   json={"nodes": graph["nodes"], "edges": graph["edges"] + [edge], "groups": []})
    assert r.status_code == 200, r.text


def test_core_replace_repoints_home_canvas_and_keeps_edges(client: TestClient) -> None:
    """결함 ③ 회귀: 이양 후 옛 노드가 남지 않고 C 노드가 A 자리에 엣지를 물려받는다. missing_l6 없음."""
    l5 = _seed_category("FWS-R5", "대체", level=5)
    a = _seed_l6_map(l5, "fws replace A", "FWS-R-A")
    b = _seed_l6_map(l5, "fws replace B", "FWS-R-B")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    _put_edge(client, draft, a, b)
    c = _seed_l6_map(None, "fws replace C", None)  # 슬롯 없는 일반 맵(게시본 있음)

    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    assert _map_row(a) == {"category_id": None, "consultant_code": None, "deleted": False,
                           "retired_to": c, "mode": "normal"}
    assert _map_row(c)["category_id"] == l5 and _map_row(c)["consultant_code"] == "FWS-R-A"
    assert _linked_ids(client, canvas) == sorted([b, c])
    graph = client.get(f"/api/versions/{draft}/graph").json()
    nc = next(n for n in graph["nodes"] if n["linked_map_id"] == c)
    assert nc["title"] == "fws replace C"
    assert len(graph["edges"]) == 1 and graph["edges"][0]["source_node_id"] == nc["id"]
    assert "missing_l6" not in _readiness_codes(client, canvas)
    assert _events(a) == [("replace", l5, None, c)]
    assert _events(c) == [("succeed", None, l5, a)]


def test_core_replace_merges_when_target_already_on_canvas(client: TestClient) -> None:
    """C가 이미 캔버스에(외부 노드로) 있으면 A 노드의 엣지를 C 노드로 옮기고 A 노드를 지운다(중복 쌍 제거)."""
    l5 = _seed_category("FWS-M5", "합치기", level=5)
    other = _seed_category("FWS-M5X", "합치기X", level=5)
    a = _seed_l6_map(l5, "fws merge A", "FWS-M-A")
    b = _seed_l6_map(l5, "fws merge B", "FWS-M-B")
    c = _seed_l6_map(other, "fws merge C", "FWS-M-C")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    graph = client.get(f"/api/versions/{draft}/graph").json()
    na = next(n for n in graph["nodes"] if n["linked_map_id"] == a)
    nc = dict(na, id=uuid4().hex, linked_map_id=c, title="fws merge C", pos_y=na["pos_y"] + 240)
    r = client.put(f"/api/versions/{draft}/graph", json={"nodes": graph["nodes"] + [nc], "edges": [], "groups": []})
    assert r.status_code == 200, r.text
    _put_edge(client, draft, a, b)
    _put_edge(client, draft, c, b)  # 합칠 때 (c→b) 중복이 되는 쌍

    # C의 타 L5 슬롯을 먼저 비워 replace 전제를 맞춘다(테스트 셋업 — 실제론 슬롯 없는 맵이 target)
    _apply({"action": "unassign", "map_id": c})

    async def _clear_code(session):
        m = await session.get(ProcessMap, c)
        m.consultant_code = None

    _run(_clear_code)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    graph2 = client.get(f"/api/versions/{draft}/graph").json()
    assert sorted(n["linked_map_id"] for n in graph2["nodes"]) == sorted([b, c])
    pairs = {(e["source_node_id"], e["target_node_id"]) for e in graph2["edges"]}
    nc_id = next(n["id"] for n in graph2["nodes"] if n["linked_map_id"] == c)
    nb_id = next(n["id"] for n in graph2["nodes"] if n["linked_map_id"] == b)
    assert pairs == {(nc_id, nb_id)}


def test_core_delete_with_and_without_successor(client: TestClient) -> None:
    """결함 ④ 회귀: 후계자 있는 delete는 슬롯 승계+재지정, 없는 delete는 노드를 남긴다(stale)."""
    l5 = _seed_category("FWS-D5", "삭제", level=5)
    a = _seed_l6_map(l5, "fws delete A", "FWS-D-A")
    d = _seed_l6_map(l5, "fws delete D", "FWS-D-D")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    c = _seed_l6_map(None, "fws delete C", None)

    _apply({"action": "delete", "map_id": a, "to_map_id": c})
    assert _map_row(a) == {"category_id": None, "consultant_code": None, "deleted": True,
                           "retired_to": c, "mode": "normal"}
    assert _map_row(c)["category_id"] == l5 and _map_row(c)["consultant_code"] == "FWS-D-A"
    assert _linked_ids(client, canvas) == sorted([c, d])
    assert _events(a) == [("delete", l5, None, c)]

    _apply({"action": "delete", "map_id": d})
    row = _map_row(d)
    assert row["deleted"] is True and row["category_id"] == l5 and row["retired_to"] is None
    assert d in _linked_ids(client, canvas)  # 링크는 끊지 않음 — 복구 시 자동 회복, 표시는 stale
    assert "stale_link" in _readiness_codes(client, canvas)
```

파일 상단 import에 `from uuid import uuid4` 추가.

- [ ] **Step 2: 실패 확인**

Run: `... pytest tests/test_framework_slots.py -q -p no:cacheprovider -k "replace or delete"`
Expected: FAIL `HTTPException: 501 handover not implemented yet`.

- [ ] **Step 3: `_apply_handover` 구현**

`framework_slots.py`의 `_apply_handover` 본문 교체:

```python
async def _apply_handover(
    session: AsyncSession, plan: SlotPlan, actor: str, request_id: int | None
) -> list[MapVersion]:
    """replace / delete — 슬롯 승계(flush 순서 안전)·계보·홈 캔버스 재지정. 후계자 없는 delete는 소프트삭제만."""
    change, source, target = plan.change, plan.source, plan.target
    from_category_id = plan.from_category_id
    slot_code = source.consultant_code
    touched: list[MapVersion] = []

    if target is not None:
        # 결함 ①: source를 먼저 비우고 flush — UPDATE는 PK 순이라 target이 먼저 코드를 받으면 unique 충돌
        source.category_id = None
        source.consultant_code = None
        await session.flush()
        target.category_id = from_category_id
        target.consultant_code = slot_code
        source.retired_to_map_id = target.id
        _, draft = await _home_draft(session, from_category_id)
        if draft is not None:
            await _repoint_home_canvas(session, draft, source, target)
            record_version_event(
                session, draft.id, "slot_changed", actor, note=f"{source.name} -> {target.name}"
            )
            touched.append(draft)
        _record_event(session, map_id=target.id, action="succeed", actor=actor,
                      to_category_id=from_category_id, to_map_id=source.id, request_id=request_id)

    if change.action == "delete":
        # delete_map(maps.py)와 동일 — 소프트삭제 + KB 청크 제거. 슬롯은 후계자가 없으면 그대로(휴지통 복구 시 회복)
        from app.routers.maps import _delete_map_kb_chunks  # 지역 import — 라우터 순환 회피

        source.deleted_at = now_kst()
        await _delete_map_kb_chunks(session, [source.id])

    _record_event(session, map_id=source.id, action=change.action, actor=actor,
                  from_category_id=from_category_id, to_map_id=target.id if target else None,
                  request_id=request_id)
    return touched


async def _repoint_home_canvas(
    session: AsyncSession, draft: MapVersion, source: ProcessMap, target: ProcessMap
) -> None:
    """홈 캔버스 draft에서 source를 가리키는 노드를 target으로 — 엣지·좌표·폭 유지.
    target 노드가 이미 있으면 source 노드의 엣지를 target 노드로 옮기고(중복 쌍 제거) source 노드를 지운다."""
    source_nodes = list(
        (await session.scalars(
            select(Node).where(
                Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == source.id
            )
        )).all()
    )
    if not source_nodes:
        return
    existing_target = await session.scalar(
        select(Node).where(
            Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == target.id
        )
    )
    if existing_target is None:
        for node in source_nodes:
            node.linked_map_id = target.id
            node.title = target.name
            node.linked_version_id = None  # 고정 버전은 옛 맵의 것 — 후계자는 최신 추종으로 시작
            node.follow_latest = True
        return
    source_ids = {n.id for n in source_nodes}
    edges = list((await session.scalars(select(Edge).where(Edge.version_id == draft.id))).all())
    pairs = {(e.source_node_id, e.target_node_id) for e in edges if e.source_node_id not in source_ids
             and e.target_node_id not in source_ids}
    for edge in edges:
        new_src = existing_target.id if edge.source_node_id in source_ids else edge.source_node_id
        new_tgt = existing_target.id if edge.target_node_id in source_ids else edge.target_node_id
        if (new_src, new_tgt) == (edge.source_node_id, edge.target_node_id):
            continue
        if new_src == new_tgt or (new_src, new_tgt) in pairs:
            await session.delete(edge)  # 자기루프·중복 쌍은 버린다
            continue
        edge.source_node_id, edge.target_node_id = new_src, new_tgt
        pairs.add((new_src, new_tgt))
    for node in source_nodes:
        await session.delete(node)
```

`from app.clock import now as now_kst`는 이미 import돼 있다(Task 3에서 미사용으로 지웠다면 되살린다). `_delete_map_kb_chunks`는 `maps.py`에 정의된 기존 헬퍼(`delete_map`이 사용) — 시그니처 `(session, map_ids: list[int])`를 실측해 맞춘다.

- [ ] **Step 4: 통과 확인 + 전체**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py tests/test_framework_canvas.py tests/test_fw_confirm_workflow.py -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 모두 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/framework_slots.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): hand a slot over with lineage and home-canvas node re-pointing — 대체·삭제 시 계보 기록·홈 캔버스 재지정"
```

---

### Task 5: 스키마·라우터 `slot-changes` + 레거시 어댑터 + 슬롯 맵 DELETE/copy 차단

**Files:**
- Modify: `backend/app/schemas.py` (`FrameworkTransferIn` 뒤 1027-1030 부근)
- Create: `backend/app/routers/slot_changes.py`
- Modify: `backend/app/main.py:21-127` (import + include_router), `backend/app/routers/maps.py` (`set_map_category`·`transfer_framework_slot` 본문, `delete_map` 1778-1787, `copy_map` 427 부근)
- Test: `backend/tests/test_framework_slots.py`, `backend/tests/test_categories_api.py:276-329`

**Interfaces:**
- Produces: `POST /api/maps/{map_id}/slot-changes` body `SlotChangeIn{action, to_category_id?, to_map_id?, note?, dry_run}` → `SlotChangeOut{mode, request_id, self_apply, sides[], impact{}}`. 비관리자(`self_apply=False`, `dry_run=False`)는 409 `"slot changes require L5 admin approval"` — 트랙 C가 요청 생성으로 대체.
- FE(Task 7)가 소비.

- [ ] **Step 1: 실패 테스트**

```python
# ── 라우터: slot-changes / 어댑터 / 삭제·복사 차단 ───────────────────────────────


def test_slot_changes_preview_and_apply(client: TestClient) -> None:
    l5 = _seed_category("FWS-P5", "프리뷰", level=5)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    a = _seed_l6_map(l5, "fws preview A", "FWS-P-A")
    b = _seed_l6_map(l5, "fws preview B", "FWS-P-B")
    _put_edge(client, _draft_id(client, canvas), a, b)
    c = _create_map(client, "fws preview C")
    preview = client.post(f"/api/maps/{a}/slot-changes",
                          json={"action": "replace", "to_map_id": c, "dry_run": True})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["mode"] == "preview" and body["self_apply"] is True  # auth OFF → 전원 sysadmin
    assert [s["category_id"] for s in body["sides"]] == [l5]
    assert body["impact"] == {"home_canvas_nodes": 1, "other_canvas_nodes": 0,
                              "referencing_maps": 0, "edges_kept": 1}
    assert _map_row(a)["category_id"] == l5  # dry_run은 아무것도 바꾸지 않는다

    applied = client.post(f"/api/maps/{a}/slot-changes", json={"action": "replace", "to_map_id": c})
    assert applied.status_code == 200 and applied.json()["mode"] == "applied"
    assert _map_row(c)["category_id"] == l5 and _map_row(a)["retired_to"] == c
    assert client.post(f"/api/maps/{a}/slot-changes", json={"action": "unassign"}).status_code == 409


def test_slot_changes_non_admin_owner_gets_409_until_track_c(client: TestClient, enforce: None) -> None:
    """owner지만 L5 직속 관리자가 아니면 즉시 적용 불가 — 이 트랙에선 409(요청 생성은 트랙 C)."""
    l5 = _seed_category("FWS-N5", "비관리자", level=5)
    act_as("fws.owner")
    mid = _create_map(client, "fws non-admin owner map")
    r = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert r.status_code == 409 and "approval" in r.json()["detail"]
    preview = client.post(f"/api/maps/{mid}/slot-changes",
                          json={"action": "assign", "to_category_id": l5, "dry_run": True}).json()
    assert preview["self_apply"] is False and preview["sides"][0]["satisfied_by_caller"] is False
    # 직속 관리자로 임명되면 즉시 적용
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fws.owner"}]})
    act_as("fws.owner")
    r2 = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert r2.status_code == 200 and r2.json()["mode"] == "applied"
    # 비-owner(viewer)는 경로 의존성에서 403
    act_as("fws.stranger")
    assert client.post(f"/api/maps/{mid}/slot-changes", json={"action": "unassign"}).status_code == 403


def test_legacy_adapters_follow_slot_policy(client: TestClient, enforce: None) -> None:
    """PUT /category·POST /framework-transfer는 어댑터 — 관리자/sysadmin만 즉시, 그 외 409."""
    l5 = _seed_category("FWS-L5", "레거시", level=5)
    act_as("fws.legacy.owner")
    mid = _create_map(client, "fws legacy owner map")
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": l5}).status_code == 409
    act_as(SYSADMIN)
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": l5}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_id"] == l5


def test_slotted_map_delete_and_copy_retire_are_blocked(client: TestClient) -> None:
    l5 = _seed_category("FWS-X5", "차단", level=5)
    slotted = _seed_l6_map(l5, "fws blocked slotted", "FWS-X-M1")
    free = _seed_l6_map(None, "fws blocked free", None)
    r = client.delete(f"/api/maps/{slotted}")
    assert r.status_code == 409 and "slot-changes" in r.json()["detail"]
    r2 = client.post(f"/api/maps/{slotted}/copy", json={"name": "fws blocked copy", "retire_source": True})
    assert r2.status_code == 409 and "slot-changes" in r2.json()["detail"]
    assert client.post(f"/api/maps/{slotted}/copy", json={"name": "fws plain copy"}).status_code == 201
    assert client.delete(f"/api/maps/{free}").status_code == 204
```

- [ ] **Step 2: 실패 확인**

Run: `... pytest tests/test_framework_slots.py -q -p no:cacheprovider -k "slot_changes or legacy or blocked"`
Expected: 404(라우트 없음)·200≠409 등으로 FAIL.

- [ ] **Step 3: 스키마**

`backend/app/schemas.py` `FrameworkTransferIn` 뒤에:

```python
class SlotChangeIn(BaseModel):
    # L6 슬롯 변경 요청 — 5액션 공용 (spec 2026-09-06 §4.1)
    action: Literal["assign", "unassign", "move", "replace", "delete"]
    to_category_id: int | None = None
    to_map_id: int | None = None
    note: str | None = Field(None, max_length=500)
    dry_run: bool = False


class SlotChangeSideOut(BaseModel):
    category_id: int
    path: str | None = None
    approvers: list[str]
    satisfied_by_caller: bool


class SlotChangeImpactOut(BaseModel):
    home_canvas_nodes: int
    other_canvas_nodes: int
    referencing_maps: int
    edges_kept: int


class SlotChangeOut(BaseModel):
    # preview=dry_run, applied=관리자 즉시 적용, requested=승인 요청 생성(트랙 C)
    mode: Literal["preview", "applied", "requested"]
    request_id: int | None = None
    self_apply: bool
    sides: list[SlotChangeSideOut]
    impact: SlotChangeImpactOut
```

(`Literal`은 schemas.py에 이미 import돼 있다 — 없으면 `from typing import Literal` 추가.)

- [ ] **Step 4: 라우터**

`backend/app/routers/slot_changes.py` 신규:

```python
"""L6 슬롯 변경 엔드포인트 — dry_run 미리보기 · 관리자 즉시 적용 · (트랙 C) 승인 요청 생성.

경로는 maps 라우터와 같은 prefix(/api/maps/{map_id}/slot-changes)지만 파일을 분리해 maps.py 비대화를 막는다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.framework_slots import SlotChange, apply_slot_change, build_preview, validate_slot_change
from app.permissions.access import assert_map_role
from app.permissions.deps import require_map_role
from app.schemas import SlotChangeIn, SlotChangeOut

router = APIRouter(
    prefix="/api/maps", tags=["slot-changes"], dependencies=[Depends(get_current_user)]
)


@router.post(
    "/{map_id}/slot-changes",
    response_model=SlotChangeOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def create_slot_change(
    map_id: int,
    payload: SlotChangeIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> SlotChangeOut:
    """슬롯 변경 — dry_run이면 미리보기, 호출자가 side 전부의 직속 L5 관리자(또는 sysadmin)면 즉시 적용.
    그 외는 승인 요청(트랙 C) — 이 트랙에선 409.
    """
    change = SlotChange(
        action=payload.action, map_id=map_id, to_category_id=payload.to_category_id,
        to_map_id=payload.to_map_id, note=payload.note or "",
    )
    plan = await validate_slot_change(session, change, user)
    if plan.target is not None:
        # 이양 대상·후계자 맵의 owner도 겸해야 한다 (현행 framework-transfer 가드 유지)
        await assert_map_role(session, user, plan.target.id, "owner")
    preview = await build_preview(session, plan, user)
    if payload.dry_run:
        return SlotChangeOut(mode="preview", request_id=None, **preview)
    if not plan.self_apply:
        raise HTTPException(status_code=409, detail="slot changes require L5 admin approval")
    await apply_slot_change(session, plan, user)
    await session.commit()
    return SlotChangeOut(mode="applied", request_id=None, **preview)
```

`backend/app/main.py`: `from app.routers import (` 목록에 `slot_changes` 추가, `app.include_router(maps.router)` 다음 줄에 `app.include_router(slot_changes.router)`.

- [ ] **Step 5: 레거시 어댑터 + 삭제/복사 차단**

`maps.py` `set_map_category` 본문을 어댑터로 교체(시그니처·데코레이터·응답 조립은 유지):

```python
    """체계 카테고리 연결/해제 어댑터 — 슬롯 정책(spec 2026-09-06)에 위임. 관리자/sysadmin만 즉시 적용, 그 외 409."""
    found_map = await session.get(
        ProcessMap, map_id, options=[selectinload(ProcessMap.versions).selectinload(MapVersion.events)]
    )
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.category_id is None:
        change = SlotChange(action="unassign", map_id=map_id)
    elif found_map.category_id is None:
        change = SlotChange(action="assign", map_id=map_id, to_category_id=payload.category_id)
    elif found_map.category_id == payload.category_id:
        change = None  # 무변경
    else:
        change = SlotChange(action="move", map_id=map_id, to_category_id=payload.category_id)
    if change is not None:
        plan = await validate_slot_change(session, change, user)
        if not plan.self_apply:
            raise HTTPException(status_code=409, detail="slot changes require L5 admin approval - use slot-changes")
        await apply_slot_change(session, plan, user)
    await session.commit()
    # (이하 기존 refresh·my_role·category_path 조립 그대로)
```

`transfer_framework_slot` 본문도 같은 방식으로:

```python
    plan = await validate_slot_change(
        session, SlotChange(action="replace", map_id=map_id, to_map_id=payload.to_map_id), user
    )
    await assert_map_role(session, user, payload.to_map_id, "owner")
    if not plan.self_apply:
        raise HTTPException(status_code=409, detail="slot changes require L5 admin approval - use slot-changes")
    await apply_slot_change(session, plan, user)
    await session.commit()
    return {"from_map_id": map_id, "to_map_id": payload.to_map_id}
```

import 추가: `from app.framework_slots import SlotChange, apply_slot_change, validate_slot_change`. Task 1의 인라인 가드/flush 코드는 코어가 대신하므로 제거한다(Task 1 테스트는 그대로 통과해야 한다).

`delete_map`(1778) 404 검사 뒤:

```python
    if found_map.category_id is not None:
        # 슬롯 있는 L6는 L5 승인·캔버스 반영이 필요 — slot-changes{action: delete}로만 (spec §7.3)
        raise HTTPException(status_code=409, detail="slotted maps are deleted through slot-changes")
```

`copy_map`의 `if payload.retire_source:`(427) 블록 첫 줄에:

```python
        if source_map.category_id is not None:
            raise HTTPException(status_code=409, detail="slotted maps are retired through slot-changes")
```

- [ ] **Step 6: 기존 테스트 정합**

`backend/tests/test_categories_api.py:276-297` `test_framework_transfer_moves_slot` — `pub`은 시드에서 L2(`A1`)에 직결된 레거시 슬롯이라 첫 transfer가 409(`level-5`)인 단언은 유지된다(코어의 replace 전제와 동일 문구). 이후 `PUT /category`로 L5 재배정은 `move`이며 auth OFF(sysadmin)라 200 유지. 재이양 409 단언(`source map has no framework slot`)도 유지. 파일 전체를 돌려 깨지는 단언만 코어 문구에 맞춘다.

`test_categories_api.py:308-329` `test_framework_transfer_target_not_owned_403` — target owner 검사는 어댑터에서 `assert_map_role` 유지 → 403 그대로.

- [ ] **Step 7: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 전체 passed(기존 1347 + 신규). 3.11 호환 확인: `.venv/bin/python -c "import ast,sys; ast.parse(open('app/framework_slots.py').read(), feature_version=(3,11))"`.

- [ ] **Step 8: Commit**

```bash
git add backend/app/schemas.py backend/app/routers/slot_changes.py backend/app/main.py backend/app/routers/maps.py backend/tests/test_framework_slots.py backend/tests/test_categories_api.py
git commit -m "feat(framework): slot-changes endpoint with dry-run preview, admin self-apply and legacy adapters — 슬롯 변경 엔드포인트·어댑터·슬롯 맵 삭제/복사 차단"
```

---

### Task 6: refs 확장(superseded·시각 3종·후계자 체인 완화) + `stale_link` 게이트 확장

**Files:**
- Modify: `backend/app/schemas.py:1325-1370` (`SubprocessRefOut`), `backend/app/subprocess.py:131-288` (`get_subprocess_refs`), `:453-531` (`validate_confirm_readiness`), `:534-650` (`validate_confirm_readiness_batch`)
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces: `SubprocessRefOut.superseded: bool`, `slot_changed_at: datetime | None`, `slot_changed_action: str | None`, `succeeded_at: datetime | None`, `map_updated_at: datetime | None`. FE(Task 7·9·10)가 소비.

- [ ] **Step 1: 실패 테스트**

```python
# ── refs 확장 · stale_link 확장 ──────────────────────────────────────────────────


def test_refs_expose_slot_state_and_timestamps(client: TestClient) -> None:
    l5 = _seed_category("FWS-F5", "refs", level=5)
    a = _seed_l6_map(l5, "fws refs A", "FWS-F-A")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    other_l5 = _seed_category("FWS-F5X", "refsX", level=5)
    other_canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]
    other_draft = _draft_id(client, other_canvas)
    graph = client.get(f"/api/versions/{other_draft}/graph").json()
    ext = {"id": uuid4().hex, "title": "fws refs A", "node_type": "subprocess", "linked_map_id": a,
           "follow_latest": True, "pos_x": 120, "pos_y": 120, "sort_order": 0}
    assert client.put(f"/api/versions/{other_draft}/graph",
                      json={"nodes": graph["nodes"] + [ext], "edges": [], "groups": []}).status_code == 200
    c = _seed_l6_map(None, "fws refs C", None)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    other_refs = client.get(f"/api/versions/{other_draft}/graph").json()["subprocess_refs"]
    ref_a = other_refs[str(a)]
    assert ref_a["deleted"] is False and ref_a["superseded"] is True
    assert ref_a["successor_map_id"] == c and ref_a["slot_changed_action"] == "replace"
    assert ref_a["slot_changed_at"] is not None and ref_a["map_updated_at"] is not None
    home_refs = client.get(f"/api/versions/{_draft_id(client, canvas)}/graph").json()["subprocess_refs"]
    assert home_refs[str(c)]["succeeded_at"] is not None and home_refs[str(c)]["superseded"] is False
    # 타 캔버스의 옛 노드는 stale_link 위반
    assert "stale_link" in _readiness_codes(client, other_canvas)


def test_unassigned_link_counts_as_stale(client: TestClient) -> None:
    l5 = _seed_category("FWS-U5", "해제stale", level=5)
    a = _seed_l6_map(l5, "fws stale A", "FWS-U-A")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    assert "stale_link" not in _readiness_codes(client, canvas)
    _apply({"action": "unassign", "map_id": a})
    assert _readiness_codes(client, canvas) == ["stale_link"]  # missing_l6는 아님(소속이 아니니)
    refs = client.get(f"/api/versions/{_draft_id(client, canvas)}/graph").json()["subprocess_refs"]
    assert refs[str(a)]["category_id"] is None and refs[str(a)]["slot_changed_action"] == "unassign"
```

- [ ] **Step 2: 실패 확인**

Run: `... -k "refs or stale"` → KeyError `'superseded'` 등으로 FAIL.

- [ ] **Step 3: 스키마 필드**

`SubprocessRefOut`의 `successor_name` 다음에:

```python
    # 살아 있지만 슬롯을 넘긴 맵(retired_to_map_id 존재) — 캔버스 stale 룩 + Replace CTA (spec 2026-09-06 §6.2)
    superseded: bool = False
    # 이 맵의 최신 슬롯 변경(assign/unassign/move/replace/delete) — 호버 패널 "해제된 날" 등
    slot_changed_at: datetime | None = None
    slot_changed_action: str | None = None
    # 이 맵이 후계자로 슬롯을 받은 시각 — "이양된 날" + 최근 이양 배지
    succeeded_at: datetime | None = None
    map_updated_at: datetime | None = None
```

- [ ] **Step 4: `get_subprocess_refs` 확장**

`subprocess.py` import에 `FrameworkSlotEvent` 추가(`from app.models import Edge, FrameworkSlotEvent, MapVersion, Node, ProcessCategory, ProcessMap`). select 컬럼 목록 끝(`ProcessMap.retired_to_map_id,` 다음)에 `ProcessMap.updated_at,` 추가하고 언패킹 튜플 끝에 `map_updated_at,` 추가. `SubprocessRefOut(...)` 생성 인자에 추가:

```python
            superseded=deleted_at is None and retired_to_map_id is not None,
            map_updated_at=map_updated_at,
```

은퇴 체인 출발 조건(현재 `if deleted_at is not None and retired_to_map_id is not None:`)을 다음으로:

```python
        if retired_to_map_id is not None:  # 살아 있는 superseded 맵도 후계자를 동봉 (spec §6.2)
            retire_heads[mid] = retired_to_map_id
```

`return refs` 직전에 이벤트 시각 주입:

```python
    # 슬롯 이력 시각 — 맵별 최신 변경 1건 + 후계자로 받은 최신 1건 (spec §6.2)
    if refs:
        ids = list(refs.keys())
        rows = (
            await session.execute(
                select(FrameworkSlotEvent.map_id, FrameworkSlotEvent.action, FrameworkSlotEvent.created_at)
                .where(FrameworkSlotEvent.map_id.in_(ids))
                .order_by(FrameworkSlotEvent.created_at.desc(), FrameworkSlotEvent.id.desc())
            )
        ).all()
        seen_change: set[int] = set()
        seen_succeed: set[int] = set()
        for mid, action, at in rows:
            if action == "succeed":
                if mid not in seen_succeed:
                    seen_succeed.add(mid)
                    refs[mid].succeeded_at = at
            elif mid not in seen_change:
                seen_change.add(mid)
                refs[mid].slot_changed_at = at
                refs[mid].slot_changed_action = action
    return refs
```

- [ ] **Step 5: 게이트 확장(단건·배치)**

`validate_confirm_readiness`(:478-489): select에 `ProcessMap.category_id` 추가, stale 판정을

```python
        rows = (
            await session.execute(
                select(ProcessMap.id, ProcessMap.deleted_at, ProcessMap.retired_to_map_id, ProcessMap.category_id)
                .where(ProcessMap.id.in_(linked.keys()))
            )
        ).all()
        by_id = {r[0]: r for r in rows}
        # 3) stale_link — 삭제/이양/영구삭제(맵 실종)/해제(category_id NULL)된 링크 (spec 2026-09-06 §6.3)
        stale = [
            nid for mid, nid in linked.items()
            if mid not in by_id or by_id[mid][1] is not None or by_id[mid][2] is not None
            or by_id[mid][3] is None
        ]
```

`validate_confirm_readiness_batch`(:595-600 `link_status` 조립): select에 `ProcessMap.category_id`를 4번째로 추가하고 stale 조건(:633-636)에 `or link_status[mid][2] is None` 추가(튜플 인덱스는 `(deleted_at, retired_to_map_id, category_id)` 순 — 실측해 맞춘다).

- [ ] **Step 6: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 전체 passed. `test_framework_overview.py`(배치 검사기 단건 동치 테스트)가 깨지면 배치판 인덱스를 재확인.

- [ ] **Step 7: Commit**

```bash
git add backend/app/schemas.py backend/app/subprocess.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): expose superseded/slot timestamps in subprocess refs and treat unassigned links as stale — refs 슬롯 상태·시각 노출, 해제 링크 stale 판정"
```

---

### Task 7: FE api 타입·함수 + 상태 파생 라이브러리(vitest)

**Files:**
- Modify: `frontend/src/lib/api.ts` (`SubprocessRef` 인터페이스 220-260 부근, 2769-2790 레거시 함수 자리)
- Create: `frontend/src/lib/framework-slot-state.ts`, `frontend/src/lib/framework-slot-state.test.ts`

**Interfaces:**
- Produces: `SlotChangeAction`, `SlotChangeIn`, `SlotChangeSide`, `SlotChangeOut`, `postSlotChange(mapId, body)`; `SubprocessRef` 필드 `superseded?`, `slot_changed_at?`, `slot_changed_action?`, `succeeded_at?`, `map_updated_at?`; `SlotState`, `deriveSlotState(ref, linkedMapId, canvasCategoryId)`, `RECENT_HANDOVER_DAYS = 14`, `isRecentHandover(succeededAt, now?)`.
- 레거시 `putMapCategory`·`postFrameworkTransfer`는 Task 8에서 제거(이 태스크는 추가만).

- [ ] **Step 1: 실패 테스트**

`frontend/src/lib/framework-slot-state.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { SubprocessRef } from "./api";
import { deriveSlotState, isRecentHandover, RECENT_HANDOVER_DAYS } from "./framework-slot-state";

const base = (over: Partial<SubprocessRef>): SubprocessRef =>
  ({
    designated: true, name: "m", department: null, assignee: null, system: null, duration: null,
    cost_krw: null, cost_usd: null, headcount: null, touch_time: null, input: null, output: null,
    input_forms: null, output_forms: null, input_ids: null, output_ids: null, start_condition: null,
    end_condition: null, frequency_fallback: null, gmp: null, url: null, url_label: null,
    ...over,
  }) as SubprocessRef;

describe("deriveSlotState", () => {
  it("placeholder when no linked map", () => {
    expect(deriveSlotState(undefined, null, 5)).toBe("placeholder");
  });
  it("unknown while refs are not loaded", () => {
    expect(deriveSlotState(undefined, 7, 5)).toBe("unknown");
  });
  it("deleted beats superseded, superseded beats category", () => {
    expect(deriveSlotState(base({ deleted: true, superseded: true, category_id: 5 }), 7, 5)).toBe("deleted");
    expect(deriveSlotState(base({ superseded: true, category_id: null }), 7, 5)).toBe("superseded");
  });
  it("unassigned when the linked map has no category", () => {
    expect(deriveSlotState(base({ category_id: null }), 7, 5)).toBe("unassigned");
  });
  it("contained vs external by canvas category", () => {
    expect(deriveSlotState(base({ category_id: 5 }), 7, 5)).toBe("contained");
    expect(deriveSlotState(base({ category_id: 9 }), 7, 5)).toBe("external");
  });
});

describe("isRecentHandover", () => {
  const now = Date.parse("2026-09-06T00:00:00+09:00");
  it("true within the window, false after or without a date", () => {
    expect(isRecentHandover("2026-09-01T10:00:00+09:00", now)).toBe(true);
    expect(isRecentHandover(`2026-08-${String(23 - 1).padStart(2, "0")}T00:00:00+09:00`, now)).toBe(false);
    expect(isRecentHandover(null, now)).toBe(false);
    expect(RECENT_HANDOVER_DAYS).toBe(14);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/framework-slot-state.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: api.ts 확장**

`SubprocessRef`의 `successor_name` 다음에:

```ts
  // 살아 있지만 슬롯을 넘긴 맵 — 캔버스 stale 룩 + Replace CTA (spec 2026-09-06 §6.2)
  superseded?: boolean;
  // 슬롯 이력 시각 — 최신 변경(해제/삭제/이동…)·후계자로 받은 시각·맵 갱신 시각 (호버 패널·최근 이양 배지)
  slot_changed_at?: string | null;
  slot_changed_action?: string | null;
  succeeded_at?: string | null;
  map_updated_at?: string | null;
```

`postFrameworkTransfer` 정의 바로 뒤에:

```ts
// ── L6 슬롯 변경 — 5액션 공용, dry_run이면 승인자·영향 미리보기 (spec 2026-09-06 §4.1) ──
export type SlotChangeAction = "assign" | "unassign" | "move" | "replace" | "delete";
export interface SlotChangeIn {
  action: SlotChangeAction;
  to_category_id?: number | null;
  to_map_id?: number | null;
  note?: string;
  dry_run?: boolean;
}
export interface SlotChangeSide {
  category_id: number;
  path: string | null;
  approvers: string[];
  satisfied_by_caller: boolean;
}
export interface SlotChangeOut {
  mode: "preview" | "applied" | "requested";
  request_id: number | null;
  self_apply: boolean;
  sides: SlotChangeSide[];
  impact: { home_canvas_nodes: number; other_canvas_nodes: number; referencing_maps: number; edges_kept: number };
}
export function postSlotChange(mapId: number, body: SlotChangeIn): Promise<SlotChangeOut> {
  return request<SlotChangeOut>(`/maps/${mapId}/slot-changes`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
```

- [ ] **Step 4: 상태 파생 lib**

`frontend/src/lib/framework-slot-state.ts`:

```ts
// L5 캔버스 subprocess 노드의 슬롯 상태 파생 — refs(라이브)와 캔버스 L5 id로만 결정 (spec 2026-09-06 §6.2·§7.1)
import type { SubprocessRef } from "./api";

export type SlotState =
  | "placeholder" // linkedMapId 없음(미등록)
  | "unknown" // refs 미수신
  | "deleted" // 링크 맵 휴지통/영구삭제
  | "superseded" // 살아 있지만 슬롯을 넘김(retired_to_map_id)
  | "unassigned" // 살아 있고 체계 밖(category_id NULL)
  | "contained" // 이 캔버스 L5 소속
  | "external"; // 다른 L5 소속

export function deriveSlotState(
  ref: SubprocessRef | undefined,
  linkedMapId: number | null | undefined,
  canvasCategoryId: number | null,
): SlotState {
  if (linkedMapId == null) return "placeholder";
  if (!ref) return "unknown";
  if (ref.deleted) return "deleted";
  if (ref.superseded) return "superseded";
  if (ref.category_id == null) return "unassigned";
  if (canvasCategoryId != null && ref.category_id === canvasCategoryId) return "contained";
  return "external";
}

// "최근 이양" 배지 기간(일) — FE 단일 소스 (spec §7.1)
export const RECENT_HANDOVER_DAYS = 14;

export function isRecentHandover(succeededAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!succeededAt) return false;
  const at = Date.parse(succeededAt);
  if (!Number.isFinite(at) || at > now) return false;
  return now - at <= RECENT_HANDOVER_DAYS * 86_400_000;
}
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/framework-slot-state.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: 6 passed, tsc 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/framework-slot-state.ts frontend/src/lib/framework-slot-state.test.ts
git commit -m "feat(frontend): slot-change api client and canvas slot-state derivation — 슬롯 변경 API 클라이언트·노드 슬롯 상태 파생"
```

---

### Task 8: 배정 모달 → slot-changes(dry-run → 안내 모달 → 적용), 대체 섹션 전면 노출, 피커 mode 필터

**Files:**
- Modify: `frontend/src/components/maps/framework-assign-modal.tsx`(전체), `frontend/src/components/maps/map-detail-card.tsx:1087-1098`(prop 제거), `frontend/src/lib/api.ts:2769-2790`(레거시 함수 제거), `frontend/src/lib/i18n-messages.ts`(en `home.frameworkTransferPick` 근처 1928 / ko 4122 근처)

**Interfaces:**
- Consumes: `postSlotChange`, `SlotChangeIn/Out`(Task 7), `ConfirmDialog`(`components/confirm-dialog.tsx` — props `title, message?, confirmLabel, cancelLabel?, danger?, onConfirm, onClose, icon?`).
- Produces: 모달 내부 상태 `pending: { body: SlotChangeIn; preview: SlotChangeOut } | null`(트랙 C가 요청 모달로 확장). `hasConsultantCode` prop 제거.

- [ ] **Step 1: i18n 키 추가 (en 블록 `home.frameworkTransferPick` 뒤 / ko 블록 대칭)**

```ts
  "home.frameworkSelfApplyTitle": "Applies immediately",
  "home.frameworkSelfApplyDesc": "You administer this level-5 category, so the change skips approval and lands now.",
  "home.frameworkApplyNow": "Apply now",
  "home.frameworkSlotNeedsApproval": "This change needs approval from the level-5 admins: {names}",
  "home.frameworkSlotNoApprovers": "This level-5 category has no admin yet - ask a sysadmin.",
  "home.frameworkImpactSummary": "{home} node(s) on the home canvas · {other} on other canvases · {refs} referencing map(s)",
  "home.frameworkTransferPickMode": "Only plain maps without a slot can take it over.",
```

```ts
  "home.frameworkSelfApplyTitle": "바로 적용됩니다",
  "home.frameworkSelfApplyDesc": "이 L5 카테고리의 관리자라 승인 없이 지금 반영됩니다.",
  "home.frameworkApplyNow": "바로 적용",
  "home.frameworkSlotNeedsApproval": "L5 관리자 승인이 필요합니다: {names}",
  "home.frameworkSlotNoApprovers": "이 L5 카테고리에 관리자가 없습니다 - sysadmin에게 요청하세요.",
  "home.frameworkImpactSummary": "홈 캔버스 노드 {home}개 · 다른 캔버스 {other}개 · 참조 맵 {refs}개",
  "home.frameworkTransferPickMode": "슬롯 없는 일반 맵만 넘겨받을 수 있습니다.",
```

- [ ] **Step 2: 모달 재배선**

`framework-assign-modal.tsx` 변경 요지(전체 파일 기준):

1. import 교체: `putMapCategory`, `postFrameworkTransfer` 제거 → `postSlotChange, type SlotChangeIn, type SlotChangeOut` 추가. `import { ConfirmDialog } from "@/components/confirm-dialog";`, `ShieldCheck` 아이콘 추가(lucide).
2. props에서 `hasConsultantCode` 제거(인터페이스·구조분해 둘 다).
3. 상태 추가: `const [pending, setPending] = useState<{ body: SlotChangeIn; preview: SlotChangeOut } | null>(null);` 기존 `gate` 상태·`usage` 조회·`framework-slot-gate` JSX는 삭제(영향 목록은 preview.impact가 대체).
4. 공통 실행기(plain 함수 — React Compiler 자동 메모):

```ts
  async function planChange(body: SlotChangeIn) {
    setSubmitting(true);
    setError(null);
    try {
      const preview = await postSlotChange(mapId, { ...body, dry_run: true });
      if (!preview.self_apply) {
        const names = preview.sides.flatMap((s) => s.approvers);
        setError(
          names.length > 0
            ? t("home.frameworkSlotNeedsApproval", { names: names.join(", ") })
            : t("home.frameworkSlotNoApprovers"),
        );
        return;
      }
      setPending({ body, preview });
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function applyPending() {
    if (pending === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await postSlotChange(mapId, pending.body);
      setPending(null);
      onChanged();
      onClose();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setSubmitting(false);
    }
  }
```

5. 기존 핸들러 교체:
   - `requestAssign`/`handleAssign` → `function requestAssign() { if (selectedId === null) return; if (currentCategoryId == null) void planChange({ action: "assign", to_category_id: selectedId }); else if (selectedId !== currentCategoryId) void planChange({ action: "move", to_category_id: selectedId }); }`
   - `handleUnassign` → `() => void planChange({ action: "unassign" })` (해제 버튼 onClick).
   - `handleTransfer` → `() => void planChange({ action: "replace", to_map_id: Number(transferTargetId) })`.
6. 대체 섹션: `{hasConsultantCode && (` → `{currentCategoryId != null && (`. 안내 문구 `home.frameworkTransferPick` 아래에 `<p className="text-fine text-ink-tertiary">{t("home.frameworkTransferPickMode")}</p>`.
7. 피커 필터: `mapOptions`를 `.filter((m) => m.id !== mapId && (m.mode ?? "normal") === "normal" && m.category_id == null && m.consultant_code == null)`.
8. 안내 모달 렌더(모달 JSX 끝, `{error && ...}` 뒤):

```tsx
        {pending !== null && (
          <ConfirmDialog
            icon={<ShieldCheck size={18} strokeWidth={1.5} />}
            title={t("home.frameworkSelfApplyTitle")}
            message={`${t("home.frameworkSelfApplyDesc")}\n${t("home.frameworkImpactSummary", {
              home: String(pending.preview.impact.home_canvas_nodes),
              other: String(pending.preview.impact.other_canvas_nodes),
              refs: String(pending.preview.impact.referencing_maps),
            })}`}
            confirmLabel={t("home.frameworkApplyNow")}
            cancelLabel={t("summary.cancel")}
            danger={pending.body.action === "unassign" || pending.body.action === "delete"}
            onConfirm={() => void applyPending()}
            onClose={() => setPending(null)}
          />
        )}
```

(`ConfirmDialog`가 message 개행을 무시하면 두 문장을 ` · `로 이어 붙인다.) `data-id` 유지: 연결 `framework-assign-btn`, 해제 `framework-unassign-btn`, 대체 `framework-transfer-open`/`framework-transfer-btn`. 삭제된 `framework-slot-gate`·`framework-gate-*`·`framework-transfer-l5only`를 참조하는 스모크(`git grep -l framework-slot-gate frontend/scripts`)가 있으면 해당 스크립트 단언을 새 안내 모달(`confirm-dialog-confirm`)로 갱신.

9. `map-detail-card.tsx:1092`의 `hasConsultantCode={Boolean(detail.consultant_code)}` 줄 삭제. `api.ts`의 `putMapCategory`·`postFrameworkTransfer` 정의 삭제(다른 사용처 없음 — `git grep`으로 확인).

- [ ] **Step 3: 게이트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs && git status --short`
Expected: tsc 0·lint 0·vitest 전체 통과. 카탈로그 변경이 있으면 함께 커밋.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/maps/framework-assign-modal.tsx frontend/src/components/maps/map-detail-card.tsx frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md
git commit -m "feat(frontend): route the framework assign modal through slot-changes with an admin self-apply notice — 배정 모달 slot-changes 전환·관리자 안내 모달·대체 섹션 전면 노출"
```

---

### Task 9: 캔버스 노드 슬롯 상태 룩·최근 이양 배지·Replace CTA 조건 확장

**Files:**
- Modify: `frontend/src/lib/canvas.ts:95-100` (`NodeData`), `frontend/src/app/maps/[mapId]/page.tsx:1677-1772` (`injectSubEnds`), `:5559-5563` (`openConnectPlaceholder`), `frontend/src/components/process-node.tsx:934-950, 1000-1060, 1077-1104`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: `NodeData.spSlotState?: SlotState`, `spRecentHandover?: boolean`, `spSuccessorName?: string | null`, `spSlotInfo?: { succeededAt: string | null; updatedAt: string | null; changedAt: string | null; changedAction: string | null } | null`. Task 10의 호버 패널이 `spSlotInfo`를 읽는다.

- [ ] **Step 1: NodeData 필드**

`canvas.ts` `spLinkDeleted?: boolean;` 다음에:

```ts
  // 연계 캔버스 전용 — refs+캔버스 L5로 파생한 슬롯 상태·최근 이양·후계자·이력 시각 (spec 2026-09-06 §7.1)
  spSlotState?: import("./framework-slot-state").SlotState;
  spRecentHandover?: boolean;
  spSuccessorName?: string | null;
  spSlotInfo?: {
    succeededAt: string | null;
    updatedAt: string | null;
    changedAt: string | null;
    changedAction: string | null;
  } | null;
```

- [ ] **Step 2: page.tsx 주입**

`import { deriveSlotState, isRecentHandover } from "@/lib/framework-slot-state";` 추가. `injectSubEnds` 안 `const liveLabel = ...` 다음에:

```ts
      // 슬롯 상태 — 연계 캔버스에서만 파생. contained/external은 기존 spOriginPath 로직과 같은 결론이지만
      // unassigned/superseded/deleted를 한 축으로 묶어 process-node가 미싱 룩·배너를 고른다 (spec §7.1)
      const slotState = isFrameworkMap ? deriveSlotState(ref, node.data.linkedMapId, linkageCategoryId) : undefined;
      const slotExtras = isFrameworkMap
        ? {
            spSlotState: slotState,
            spRecentHandover: slotState === "contained" && isRecentHandover(ref?.succeeded_at),
            spSuccessorName: ref?.successor_name ?? null,
            spSlotInfo: ref
              ? {
                  succeededAt: ref.succeeded_at ?? null,
                  updatedAt: ref.map_updated_at ?? null,
                  changedAt: ref.slot_changed_at ?? null,
                  changedAction: ref.slot_changed_action ?? null,
                }
              : null,
          }
        : {};
```

세 return의 `data` 객체 각각에 `...slotExtras,` 추가(1753 잠금 분기, 1757 미해결 분기, 1759-1770 해결 분기 — `updateAvailable` 앞).

`openConnectPlaceholder`(5559-5563)의 조건 교체:

```ts
      // 스테일 링크(삭제·이양·해제된 맵) 교체 — 출처는 옛 맵의 카테고리, 추천은 이양 후계자 (spec 2026-09-06 §7.1)
      const ref = subprocessRefs.get(linked);
      const stale = ref?.deleted === true || ref?.superseded === true || (isFrameworkMap && ref != null && ref.category_id == null);
      if (!stale) {
        return;
      }
```

- [ ] **Step 3: process-node.tsx**

`spUndesignated` 정의 다음에:

```tsx
  // 슬롯 미싱 3상태 — 해제·이양·삭제 모두 플레이스홀더와 같은 점선 에러 룩 (spec 2026-09-06 §7.1)
  const spMissing =
    spUndesignated ||
    data.spSlotState === "unassigned" ||
    data.spSlotState === "superseded" ||
    data.spSlotState === "deleted";
```

`style` 계산의 `spPlaceholder || spUndesignated` → `spPlaceholder || spMissing`.

배너 체인에서 `) : data.undesignated ? (` 앞에 새 분기 삽입:

```tsx
        ) : data.spSlotState === "unassigned" || data.spSlotState === "superseded" ? (
          <button
            type="button"
            data-id="sp-banner-slot-missing"
            title={t("framework.replaceCta")}
            className="mt-1 flex w-full items-center gap-1 rounded-xs border border-error/40 bg-error/10 px-1.5 py-0.5 text-left text-xs text-error"
            onClick={(event) => {
              event.stopPropagation();
              onConnectPlaceholder?.(id);
            }}
          >
            <TriangleAlert size={12} strokeWidth={1.5} className="shrink-0" />
            <span className="truncate">
              {data.spSlotState === "superseded"
                ? t("framework.slotState.superseded", { name: data.spSuccessorName ?? "" })
                : t("framework.slotState.unassigned")}
            </span>
          </button>
```

(`TriangleAlert`는 lucide import에 없으면 추가. 기존 undesignated 분기는 `spLinkDeleted`(deleted) 케이스를 그대로 처리한다.)

최근 이양 배지 — 출처 배지 블록(`{originPath && (` 시작, `data-id="node-origin-badge"`) 바로 앞에:

```tsx
        {data.spRecentHandover && (
          <span
            data-id="node-recent-handover"
            className="mt-0.5 self-start rounded-xs border border-accent/40 bg-accent-tint px-1 py-px text-xs text-accent"
          >
            {t("framework.recentHandover")}
          </span>
        )}
```

- [ ] **Step 4: i18n (en `framework.replaceCta` 근처 / ko 대칭)**

```ts
  "framework.slotState.unassigned": "Removed from the framework - replace",
  "framework.slotState.superseded": "Handed over to {name} - replace",
  "framework.recentHandover": "Recently handed over",
```

```ts
  "framework.slotState.unassigned": "체계에서 해제됨 - 교체",
  "framework.slotState.superseded": "{name}(으)로 이양됨 - 교체",
  "framework.recentHandover": "최근 이양",
```

- [ ] **Step 5: 게이트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`
Expected: 모두 그린. `react-hooks/preserve-manual-memoization`이 `injectSubEnds`(useCallback)의 deps를 지적하면 `linkageCategoryId`·`isFrameworkMap`을 deps 배열에 추가한다.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/canvas.ts 'frontend/src/app/maps/[mapId]/page.tsx' frontend/src/components/process-node.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(editor): render unassigned and superseded L6 nodes as missing with a replace CTA and a recent-handover badge — 캔버스 미싱 룩·교체 CTA·최근 이양 배지"
```

---

### Task 10: 좌하단 "기타 정보" 호버 패널

**Files:**
- Create: `frontend/src/components/l5-node-info-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (state + `<ReactFlow onNodeMouseEnter/onNodeMouseLeave>` 9552-9575 + 캔버스 오버레이 렌더 — `<FrameworkL5Explorer` 9410 근처의 같은 오버레이 컨테이너), `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: `L5NodeInfo { name: string; succeededAt: string | null; updatedAt: string | null; changedAt: string | null; changedAction: string | null }`, `<L5NodeInfoPanel info={L5NodeInfo | null} />`.
- Consumes: `NodeData.spSlotInfo`(Task 9), `formatKstShort`(`@/lib/datetime`).

- [ ] **Step 1: 컴포넌트**

```tsx
"use client";
// L5 캔버스 좌하단 "기타 정보" 플로팅 — subprocess 노드 호버 시 이양·업데이트·해제 시각 (spec 2026-09-06 §7.1)
import { Info } from "lucide-react";

import { formatKstShort } from "@/lib/datetime";
import { useI18n, type MessageKey } from "@/lib/i18n";

export interface L5NodeInfo {
  name: string;
  succeededAt: string | null;
  updatedAt: string | null;
  changedAt: string | null;
  changedAction: string | null;
}

const CHANGE_LABEL: Record<string, MessageKey> = {
  unassign: "framework.nodeInfo.changed.unassign",
  delete: "framework.nodeInfo.changed.delete",
  move: "framework.nodeInfo.changed.move",
  assign: "framework.nodeInfo.changed.assign",
  replace: "framework.nodeInfo.changed.replace",
};

export function L5NodeInfoPanel({ info }: { info: L5NodeInfo | null }) {
  const { t } = useI18n();
  if (info === null) return null;
  const rows: { key: MessageKey; value: string | null }[] = [
    { key: "framework.nodeInfo.succeededAt", value: info.succeededAt },
    { key: "framework.nodeInfo.updatedAt", value: info.updatedAt },
    {
      key: (info.changedAction && CHANGE_LABEL[info.changedAction]) ?? "framework.nodeInfo.changed.other",
      value: info.changedAt,
    },
  ].filter((r) => r.value);
  return (
    <div
      data-id="l5-node-info-panel"
      className="pointer-events-none absolute bottom-4 left-4 z-20 flex w-64 flex-col gap-1 rounded-md border border-hairline bg-surface/95 p-3 shadow-md"
    >
      <div className="flex items-center gap-1.5 text-caption-strong text-ink">
        <Info size={14} strokeWidth={1.5} className="shrink-0 text-ink-secondary" />
        <span className="truncate">{info.name}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-fine text-ink-tertiary">{t("framework.nodeInfo.empty")}</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-fine">
          {rows.map((r) => (
            <div key={r.key} className="contents">
              <dt className="text-ink-tertiary">{t(r.key)}</dt>
              <dd className="text-ink tabular-nums">{formatKstShort(r.value as string)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
```

(`useI18n`이 `MessageKey`를 재export하지 않으면 `import type { MessageKey } from "@/lib/i18n-messages"`.)

- [ ] **Step 2: page.tsx 배선**

- import: `import { L5NodeInfoPanel, type L5NodeInfo } from "@/components/l5-node-info-panel";`
- 상태(`linkageCategoryId` state 근처 1189): `const [hoverNodeInfo, setHoverNodeInfo] = useState<L5NodeInfo | null>(null);`
- `<ReactFlow ...>` props에 추가(`onNodeClick` 앞):

```tsx
                      onNodeMouseEnter={(_, node) => {
                        if (!isFrameworkMap || node.data.nodeType !== "subprocess" || !node.data.spSlotInfo) return;
                        setHoverNodeInfo({ name: node.data.label, ...node.data.spSlotInfo });
                      }}
                      onNodeMouseLeave={() => setHoverNodeInfo(null)}
```

- 렌더: `<FrameworkL5Explorer`를 감싸는 캔버스 오버레이 컨테이너(스코프 창 `titleSlot`이 아닌, 캔버스 영역의 `relative` 래퍼 — `<ReactFlow>`의 부모 `div`)의 마지막 자식으로 `{isFrameworkMap && <L5NodeInfoPanel info={hoverNodeInfo} />}`. 좌하단에 기존 컨트롤이 있으면 `bottom-4`를 그 위(`bottom-16`)로 조정한다.

- [ ] **Step 3: i18n (en `framework.recentHandover` 뒤 / ko 대칭)**

```ts
  "framework.nodeInfo.succeededAt": "Handed over",
  "framework.nodeInfo.updatedAt": "Map updated",
  "framework.nodeInfo.changed.unassign": "Unassigned",
  "framework.nodeInfo.changed.delete": "Deleted",
  "framework.nodeInfo.changed.move": "Moved",
  "framework.nodeInfo.changed.assign": "Assigned",
  "framework.nodeInfo.changed.replace": "Slot handed off",
  "framework.nodeInfo.changed.other": "Slot changed",
  "framework.nodeInfo.empty": "No slot history yet",
```

```ts
  "framework.nodeInfo.succeededAt": "이양된 날",
  "framework.nodeInfo.updatedAt": "업데이트된 날",
  "framework.nodeInfo.changed.unassign": "해제된 날",
  "framework.nodeInfo.changed.delete": "삭제된 날",
  "framework.nodeInfo.changed.move": "이동한 날",
  "framework.nodeInfo.changed.assign": "배정된 날",
  "framework.nodeInfo.changed.replace": "슬롯 넘긴 날",
  "framework.nodeInfo.changed.other": "슬롯 변경",
  "framework.nodeInfo.empty": "슬롯 이력 없음",
```

- [ ] **Step 4: 게이트 + 1회 렌더 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`
그리고 backend(8000)·frontend(3000) 네이티브 기동 후 임의 L5 캔버스에서 노드 호버 → 좌하단 패널 스크린샷 1장(`/tmp/bpm-slot-shots/hover-panel.png`, Playwright 또는 수동) — QA 문서(트랙 C)에 첨부.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/l5-node-info-panel.tsx 'frontend/src/app/maps/[mapId]/page.tsx' frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md
git commit -m "feat(editor): floating slot-history panel on L6 node hover in the L5 canvas — 좌하단 슬롯 이력 호버 패널"
```

---

### Task 11: 게이트 라벨 갱신·문서·PROGRESS·최종 게이트

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts:2013,2021,4226,4234` (`framework.gate.stale_link`, `framework.gateFail.stale_link`), `PROGRESS.md`

- [ ] **Step 1: 라벨**

en: `"framework.gate.stale_link": "No stale links (deleted, handed over or unassigned)"`, `"framework.gateFail.stale_link": "Stale links (deleted / handed over / unassigned)"`.
ko: `"framework.gate.stale_link": "끊긴 링크 없음(삭제·이양·해제)"`, `"framework.gateFail.stale_link": "끊긴 링크(삭제·이양·해제)"`.

- [ ] **Step 2: PROGRESS.md** — 최상단 `## 2026-09-06 — Framework 슬롯 거버넌스 설계 스펙` 섹션 아래에 2줄:

```
- **트랙 A+B 구현**: 결함 ①②를 회귀 테스트로 고정(flush 순서·mode 가드) → `framework_slot_events` + `app/framework_slots.py` 코어(validate/plan/apply, 대체·삭제 시 홈 캔버스 재지정·합치기·계보) → `POST /maps/{id}/slot-changes`(dry_run·관리자 즉시 적용, 비관리자 409) + 레거시 어댑터 + 슬롯 맵 DELETE/copy 409 → refs `superseded`·시각 3종·stale_link 해제 포함 → FE 배정 모달 slot-changes 전환(안내 모달)·미싱 룩·최근 이양 배지·좌하단 호버 패널.
- 검증: pytest 신규 test_framework_slots.py(결함 ③④ 회귀 포함)·vitest framework-slot-state·tsc/lint 그린. 승인 요청·알림 표면은 트랙 C.
```

- [ ] **Step 3: 최종 게이트**

Run:
```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/
cd ../frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && npm run build
```
Expected: 전부 그린(BE 1347+신규 ≥ 12, FE 850+6).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "docs(progress): framework slot track A+B — stale gate label, progress entry — 슬롯 트랙 A+B 정리"
```
