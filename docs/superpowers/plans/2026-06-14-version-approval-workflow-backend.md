# Version Approval Workflow — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-side version lifecycle (Draft→Pending→Approved→Published, +Rejected) with per-map unanimous approvers, manual publish + prior-version demotion, and in-app notifications — all behind the existing FastAPI/SQLAlchemy/pytest stack.

**Architecture:** Add a `status` + actor-stamp columns to `map_versions`, three new tables (`map_approvers`, `version_approvals`, `notifications`), transition endpoints on the existing versions router, and two small new routers (`approvers`, `notifications`). State/transition constants and a notification-insert helper live in a new pure-ish module `app/workflow.py` (mirrors `app/checkout.py`). All decisions enforced at the API boundary with status guards (409) and permission guards (403).

**Tech Stack:** Python 3.10+, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest + `fastapi.testclient.TestClient`. Tests run in auth-bypass mode; multi-user is simulated by `monkeypatch.setattr(settings, "dev_user", ...)` (existing `tests/test_collab.py` pattern).

**Spec:** `docs/superpowers/specs/2026-06-14-version-approval-workflow-design.md`

**Run commands (bash / PowerShell):**
- Single test: `.venv/bin/python -m pytest tests/test_workflow.py::test_name -v` / `.venv\Scripts\python -m pytest tests\test_workflow.py::test_name -v`
- Full suite: `.venv/bin/python -m pytest tests/ -q` / `.venv\Scripts\python -m pytest tests\ -q`
- Lint: `.venv/bin/ruff check app/ tests/` / `.venv\Scripts\ruff check app\ tests\`

All paths below are relative to `backend/`. Run all commands from `backend/`.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `app/models.py` | ORM tables | Modify: add 3 columns to `MapVersion`; add `MapApprover`, `VersionApproval`, `Notification` |
| `app/workflow.py` | Status constants, `is_editable_status`, `create_notifications` helper | Create |
| `app/schemas.py` | API boundary models | Modify: extend `VersionOut`; add `RejectIn`, `ApproversUpdate`, `WorkflowStateOut`, `NotificationOut` |
| `app/routers/versions.py` | Transition endpoints + guards | Modify: add submit/approve/reject/publish/withdraw + workflow-state GET; guard checkout & delete |
| `app/routers/approvers.py` | Per-map approver list (owner-only) | Create |
| `app/routers/notifications.py` | Per-user notification read | Create |
| `app/main.py` | Router registration | Modify: include 2 new routers |
| `tests/test_workflow.py` | Transition/guard/permission tests | Create |
| `tests/test_notifications.py` | Notification creation + read tests | Create |

`app/db.py` needs **no change** — `init_models()` calls `Base.metadata.create_all`, and the new model classes register on import. New tables are created at startup / on the test `TestClient` lifespan.

---

### Task 1: Data model — version status columns + new tables

**Files:**
- Modify: `app/models.py`
- Modify: `app/schemas.py:18-22` (`VersionOut`)
- Test: `tests/test_workflow.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_workflow.py`:

```python
"""Version approval workflow — transitions, guards, permissions (design 2026-06-14).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증된다. 다중 사용자
시나리오는 dev_user를 monkeypatch로 바꿔 재현한다 (tests/test_collab.py 패턴).
"""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": "wf map"}).json()
    return created["id"], created["versions"][0]["id"]


def test_new_version_defaults_to_draft(client: TestClient) -> None:
    _map_id, version_id = _create_map_with_version(client)

    detail = client.get(f"/api/maps/{_map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)

    assert version["status"] == "draft"
    assert version["submitted_by"] is None
    assert version["reject_reason"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_new_version_defaults_to_draft -v`
Expected: FAIL with `KeyError: 'status'` (VersionOut has no status field yet).

- [ ] **Step 3: Add columns to `MapVersion`**

In `app/models.py`, inside `class MapVersion`, after the `checked_out_at` block (line 42-44) and before `created_at` (line 45), add:

```python
    # 승인 워크플로우 상태 — draft|pending|approved|published|rejected (design 2026-06-14)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    # 현재 사이클 제출자(=submit 시점 체크아웃 보유자 박제) — 게시/회수 권한자
    submitted_by: Mapped[str | None] = mapped_column(String(100), default=None)
    # 최신 반려 사유만 보관 (전이 이력 로그는 두지 않음)
    reject_reason: Mapped[str | None] = mapped_column(String(500), default=None)
```

- [ ] **Step 4: Add the `approvals` relationship to `MapVersion`**

In `app/models.py`, inside `class MapVersion`, after the `groups` relationship (line 60-62), add:

```python
    approvals: Mapped[list["VersionApproval"]] = relationship(
        cascade="all, delete-orphan"
    )
```

- [ ] **Step 5: Add the `approvers` relationship to `ProcessMap`**

In `app/models.py`, inside `class ProcessMap`, after the `versions` relationship (line 29-31), add:

```python
    approvers: Mapped[list["MapApprover"]] = relationship(
        cascade="all, delete-orphan"
    )
```

- [ ] **Step 6: Add the three new model classes**

In `app/models.py`, append at the end of the file (after `class Group`):

```python
class MapApprover(Base):
    """맵별 지정 승인자 — 전원 승인(만장일치) 게이트 (design 2026-06-14)."""

    __tablename__ = "map_approvers"

    map_id: Mapped[int] = mapped_column(
        ForeignKey("process_maps.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(String(100), primary_key=True)


class VersionApproval(Base):
    """현재 제출 사이클의 승인 집계 — 재제출 시 해당 version 행 전체 삭제(리셋)."""

    __tablename__ = "version_approvals"

    id: Mapped[int] = mapped_column(primary_key=True)
    version_id: Mapped[int] = mapped_column(
        ForeignKey("map_versions.id", ondelete="CASCADE")
    )
    approver: Mapped[str] = mapped_column(String(100))
    approved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Notification(Base):
    """인앱 알림 — 5초 폴링으로 본인 수신분 조회 (design 2026-06-14)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    recipient: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(50))
    map_id: Mapped[int | None] = mapped_column(Integer, default=None)
    version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    message: Mapped[str] = mapped_column(Text, default="")
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

(`Integer`, `Boolean`, `Text`, `String`, `DateTime`, `ForeignKey` are already imported at line 5; `_now` is defined at line 9.)

- [ ] **Step 7: Extend `VersionOut`**

In `app/schemas.py`, replace the `VersionOut` class (lines 18-22):

```python
class VersionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    status: str
    submitted_by: str | None
    reject_reason: str | None
```

- [ ] **Step 8: Run the new test + full suite**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_new_version_defaults_to_draft -v`
Expected: PASS.

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: All existing tests still PASS (the three new VersionOut fields are additive; existing assertions check individual keys, not exact-dict equality). If any test fails on an exact-dict comparison of a version payload, update that assertion to include the new keys.

- [ ] **Step 9: Commit**

```bash
git add app/models.py app/schemas.py tests/test_workflow.py
git commit -m "feat(backend): version workflow data model — status + approver/approval/notification tables — 버전 워크플로우 데이터 모델"
```

---

### Task 2: Workflow module — constants + notification helper

**Files:**
- Create: `app/workflow.py`
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def test_is_editable_status() -> None:
    from app import workflow

    assert workflow.is_editable_status("draft") is True
    assert workflow.is_editable_status("rejected") is True
    assert workflow.is_editable_status("pending") is False
    assert workflow.is_editable_status("approved") is False
    assert workflow.is_editable_status("published") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_is_editable_status -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.workflow'`.

- [ ] **Step 3: Create `app/workflow.py`**

```python
"""승인 워크플로우 — 상태 상수, 편집가능 판정, 알림 생성 헬퍼 (design 2026-06-14)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Notification

DRAFT = "draft"
PENDING = "pending"
APPROVED = "approved"
PUBLISHED = "published"
REJECTED = "rejected"

# 편집·체크아웃 가능한 상태 — 검토중/확정 버전은 읽기 전용
EDITABLE_STATUSES = frozenset({DRAFT, REJECTED})


def is_editable_status(status: str) -> bool:
    """이 상태의 버전을 편집/체크아웃할 수 있는지."""
    return status in EDITABLE_STATUSES


def create_notifications(
    session: AsyncSession,
    recipients: list[str],
    *,
    type: str,
    map_id: int,
    version_id: int,
    message: str,
) -> None:
    """수신자별 알림 행을 세션에 추가한다 — commit은 호출자 책임."""
    for recipient in recipients:
        session.add(
            Notification(
                recipient=recipient,
                type=type,
                map_id=map_id,
                version_id=version_id,
                message=message,
            )
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_is_editable_status -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/workflow.py tests/test_workflow.py
git commit -m "feat(backend): workflow status constants + notification helper — 워크플로우 상수·알림 헬퍼"
```

---

### Task 3: Approver assignment endpoints (owner-only)

**Files:**
- Create: `app/routers/approvers.py`
- Modify: `app/schemas.py` (add `ApproversUpdate`)
- Modify: `app/main.py` (register router)
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def test_set_and_list_approvers(client: TestClient) -> None:
    map_id, _version_id = _create_map_with_version(client)

    put = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss", "lead"]})
    listed = client.get(f"/api/maps/{map_id}/approvers").json()

    assert put.status_code == 200
    assert listed == ["boss", "lead"]


def test_set_approvers_owner_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    map_id, _version_id = _create_map_with_version(client)

    monkeypatch.setattr(settings, "dev_user", "intruder")
    forbidden = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["x"]})

    assert forbidden.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_set_and_list_approvers -v`
Expected: FAIL with 404 (route not mounted).

- [ ] **Step 3: Add `ApproversUpdate` schema**

In `app/schemas.py`, after the `VersionUpdate` class (line 31-32), add:

```python
class ApproversUpdate(BaseModel):
    user_ids: list[str]
```

- [ ] **Step 4: Create `app/routers/approvers.py`**

```python
"""맵별 지정 승인자 관리 — 조회는 누구나, 변경은 맵 소유자만 (design 2026-06-14)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapApprover, ProcessMap
from app.schemas import ApproversUpdate

router = APIRouter(
    prefix="/api/maps", tags=["approvers"], dependencies=[Depends(get_current_user)]
)


@router.get("/{map_id}/approvers", response_model=list[str])
async def list_approvers(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    rows = await session.scalars(
        select(MapApprover.user_id)
        .where(MapApprover.map_id == map_id)
        .order_by(MapApprover.user_id)
    )
    return list(rows.all())


@router.put("/{map_id}/approvers", response_model=list[str])
async def set_approvers(
    map_id: int,
    payload: ApproversUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.created_by is not None and found_map.created_by != user:
        raise HTTPException(status_code=403, detail="only the map owner can set approvers")

    await session.execute(delete(MapApprover).where(MapApprover.map_id == map_id))
    unique_ids = sorted({uid for uid in payload.user_ids if uid})
    for uid in unique_ids:
        session.add(MapApprover(map_id=map_id, user_id=uid))
    await session.commit()
    return unique_ids
```

- [ ] **Step 5: Register the router**

In `app/main.py`, line 9, change the import:

```python
from app.routers import approvers, comments, graph, maps, versions
```

Then after `app.include_router(comments.router)` (line 22), add:

```python
app.include_router(approvers.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_set_and_list_approvers tests/test_workflow.py::test_set_approvers_owner_only -v`
Expected: Both PASS.

- [ ] **Step 7: Commit**

```bash
git add app/routers/approvers.py app/schemas.py app/main.py tests/test_workflow.py
git commit -m "feat(backend): per-map approver assignment endpoints — 맵별 승인자 지정 API"
```

---

### Task 4: Submit transition + workflow-state endpoint

**Files:**
- Modify: `app/schemas.py` (add `WorkflowStateOut`)
- Modify: `app/routers/versions.py` (add imports, submit, workflow-state GET)
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def test_submit_requires_checkout_and_approvers(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # 승인자 미지정 → 제출 차단
    blocked = client.post(f"/api/versions/{version_id}/submit")
    assert blocked.status_code == 409

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss"]})
    ok = client.post(f"/api/versions/{version_id}/submit")
    assert ok.status_code == 200
    assert ok.json()["status"] == "pending"
    assert ok.json()["submitted_by"] == settings.dev_user


def test_submit_requires_checkout_holder(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss"]})
    client.post(f"/api/versions/{version_id}/checkout", json={})  # local-dev holds it

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/submit")
    assert forbidden.status_code == 403


def test_workflow_state_endpoint(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a", "b"]})

    state = client.get(f"/api/versions/{version_id}/workflow").json()

    assert state["status"] == "draft"
    assert state["approvers"] == ["a", "b"]
    assert state["approvals"] == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_submit_requires_checkout_and_approvers -v`
Expected: FAIL with 404 (submit route not defined).

- [ ] **Step 3: Add `WorkflowStateOut` schema**

In `app/schemas.py`, after `ApproversUpdate` (added in Task 3), add:

```python
class WorkflowStateOut(BaseModel):
    version_id: int
    status: str
    submitted_by: str | None
    reject_reason: str | None
    # 맵의 지정 승인자 전체
    approvers: list[str]
    # 이번 사이클에 이미 승인한 승인자
    approvals: list[str]


class RejectIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)
```

(`Field` is already imported at line 5 of `schemas.py`. `RejectIn` is added here so Task 5 needs no further schema edit.)

- [ ] **Step 4: Extend imports in `versions.py`**

In `app/routers/versions.py`, replace the import block (lines 6-15) with:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.auth import get_current_user
from app.checkout import is_checkout_active, is_locked_by_other
from app.db import get_session
from app.models import (
    Edge,
    Group,
    MapApprover,
    MapVersion,
    Node,
    ProcessMap,
    VersionApproval,
)
from app.schemas import (
    CheckoutIn,
    CheckoutOut,
    RejectIn,
    VersionCreate,
    VersionOut,
    VersionUpdate,
    WorkflowStateOut,
)
```

- [ ] **Step 5: Add a small approver-loading helper + submit + workflow-state endpoints**

In `app/routers/versions.py`, append at the end of the file:

```python
async def _load_approvers(session: AsyncSession, map_id: int) -> list[str]:
    rows = await session.scalars(
        select(MapApprover.user_id).where(MapApprover.map_id == map_id)
    )
    return list(rows.all())


@router.get("/versions/{version_id}/workflow", response_model=WorkflowStateOut)
async def get_workflow_state(
    version_id: int, session: AsyncSession = Depends(get_session)
) -> WorkflowStateOut:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    approvers = await _load_approvers(session, version.map_id)
    approvals = list(
        (
            await session.scalars(
                select(VersionApproval.approver).where(
                    VersionApproval.version_id == version_id
                )
            )
        ).all()
    )
    return WorkflowStateOut(
        version_id=version_id,
        status=version.status,
        submitted_by=version.submitted_by,
        reject_reason=version.reject_reason,
        approvers=approvers,
        approvals=approvals,
    )


@router.post("/versions/{version_id}/submit", response_model=VersionOut)
async def submit_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Draft/Rejected → Pending. 체크아웃 보유자만. 승인 tally 리셋 + 승인자 전원 알림."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"cannot submit from status {version.status}"
        )
    now = datetime.now(timezone.utc)
    if not (is_checkout_active(version, now) and version.checked_out_by == user):
        raise HTTPException(status_code=403, detail="only the checkout holder can submit")

    approvers = await _load_approvers(session, version.map_id)
    if not approvers:
        raise HTTPException(
            status_code=409, detail="map has no approvers — assign approvers first"
        )

    await session.execute(
        delete(VersionApproval).where(VersionApproval.version_id == version_id)
    )
    version.status = workflow.PENDING
    version.submitted_by = user
    version.reject_reason = None
    version.checked_out_by = None
    version.checked_out_at = None
    workflow.create_notifications(
        session,
        approvers,
        type="review_requested",
        map_id=version.map_id,
        version_id=version_id,
        message=f"{user} requested approval for '{version.label}'",
    )
    await session.commit()
    await session.refresh(version)
    return version
```

(`datetime` and `timezone` are already imported at line 4 of `versions.py`.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_submit_requires_checkout_and_approvers tests/test_workflow.py::test_submit_requires_checkout_holder tests/test_workflow.py::test_workflow_state_endpoint -v`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add app/schemas.py app/routers/versions.py tests/test_workflow.py
git commit -m "feat(backend): submit transition + workflow-state endpoint — 제출 전이·상태 조회"
```

---

### Task 5: Approve (unanimous) + reject transitions

**Files:**
- Modify: `app/routers/versions.py` (add approve, reject)
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def _submit_with_approvers(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    return map_id, version_id


def test_unanimous_approval(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])

    monkeypatch.setattr(settings, "dev_user", "a")
    after_first = client.post(f"/api/versions/{version_id}/approve").json()
    assert after_first["status"] == "pending"  # 1/2 — 아직 미통과

    monkeypatch.setattr(settings, "dev_user", "b")
    after_second = client.post(f"/api/versions/{version_id}/approve").json()
    assert after_second["status"] == "approved"  # 2/2 — 만장일치 통과


def test_approve_non_approver_forbidden(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/approve")
    assert forbidden.status_code == 403


def test_approve_on_draft_conflicts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]})

    monkeypatch.setattr(settings, "dev_user", "a")
    conflict = client.post(f"/api/versions/{version_id}/approve")  # still draft
    assert conflict.status_code == 409


def test_reject_sets_reason_and_resets_tally(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # 1/2 recorded

    monkeypatch.setattr(settings, "dev_user", "b")
    rejected = client.post(
        f"/api/versions/{version_id}/reject", json={"reason": "needs rework"}
    ).json()
    assert rejected["status"] == "rejected"
    assert rejected["reject_reason"] == "needs rework"

    # 재제출 시 tally 리셋 — rejected는 편집 가능. submitter(local-dev)로 복귀해 재제출
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["approvals"] == []


def test_reject_requires_reason(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "a")
    missing = client.post(f"/api/versions/{version_id}/reject", json={})
    assert missing.status_code == 422
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_unanimous_approval -v`
Expected: FAIL with 404 (approve route not defined).

- [ ] **Step 3: Add approve + reject endpoints**

In `app/routers/versions.py`, append at the end of the file:

```python
@router.post("/versions/{version_id}/approve", response_model=VersionOut)
async def approve_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """지정 승인자의 승인 1건 기록. 전원 승인되면 Pending → Approved 자동 전이."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.PENDING:
        raise HTTPException(
            status_code=409, detail=f"cannot approve from status {version.status}"
        )
    approvers = await _load_approvers(session, version.map_id)
    if user not in approvers:
        raise HTTPException(
            status_code=403, detail="only a designated approver can approve"
        )

    existing = await session.scalar(
        select(VersionApproval).where(
            VersionApproval.version_id == version_id,
            VersionApproval.approver == user,
        )
    )
    if existing is None:
        session.add(VersionApproval(version_id=version_id, approver=user))
        await session.flush()

    approved_count = await session.scalar(
        select(func.count())
        .select_from(VersionApproval)
        .where(VersionApproval.version_id == version_id)
    )
    if approved_count is not None and approved_count >= len(approvers):
        version.status = workflow.APPROVED
        if version.submitted_by:
            workflow.create_notifications(
                session,
                [version.submitted_by],
                type="approved",
                map_id=version.map_id,
                version_id=version_id,
                message=f"'{version.label}' is fully approved — ready to publish",
            )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/reject", response_model=VersionOut)
async def reject_version(
    version_id: int,
    payload: RejectIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """지정 승인자 1인의 반려 — 사유 필수. Pending → Rejected, submitter 알림."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.PENDING:
        raise HTTPException(
            status_code=409, detail=f"cannot reject from status {version.status}"
        )
    approvers = await _load_approvers(session, version.map_id)
    if user not in approvers:
        raise HTTPException(
            status_code=403, detail="only a designated approver can reject"
        )

    version.status = workflow.REJECTED
    version.reject_reason = payload.reason
    if version.submitted_by:
        workflow.create_notifications(
            session,
            [version.submitted_by],
            type="rejected",
            map_id=version.map_id,
            version_id=version_id,
            message=f"'{version.label}' was rejected: {payload.reason}",
        )
    await session.commit()
    await session.refresh(version)
    return version
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_workflow.py -k "approval or approve or reject" -v`
Expected: All PASS.

> Note: the duplicate `monkeypatch.setattr(settings, "dev_user", ...)` line in `test_reject_sets_reason_and_resets_tally` is intentional belt-and-suspenders to restore the submitter identity before re-checkout; the second call wins. If you prefer, delete the first of the two lines — behavior is identical.

- [ ] **Step 5: Commit**

```bash
git add app/routers/versions.py tests/test_workflow.py
git commit -m "feat(backend): approve (unanimous) + reject transitions — 만장일치 승인·반려 전이"
```

---

### Task 6: Publish (with demotion) + withdraw transitions

**Files:**
- Modify: `app/routers/versions.py` (add publish, withdraw)
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def test_publish_demotes_prior(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v1}/approve")  # approved
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    published = client.post(f"/api/versions/{v1}/publish").json()
    assert published["status"] == "published"

    # v2 클론 → 승인 → 게시. v1은 approved로 강등되어야 한다.
    v2 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be", "source_version_id": v1},
    ).json()["id"]
    client.post(f"/api/versions/{v2}/checkout", json={})
    client.post(f"/api/versions/{v2}/submit")
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v2}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{v2}/publish")

    detail = client.get(f"/api/maps/{map_id}").json()
    statuses = {v["id"]: v["status"] for v in detail["versions"]}
    assert statuses[v1] == "approved"
    assert statuses[v2] == "published"


def test_publish_submitter_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # approved; a is not submitter
    forbidden = client.post(f"/api/versions/{version_id}/publish")
    assert forbidden.status_code == 403


def test_publish_on_pending_conflicts(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])
    conflict = client.post(f"/api/versions/{version_id}/publish")  # still pending
    assert conflict.status_code == 409


def test_withdraw_returns_to_draft(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    withdrawn = client.post(f"/api/versions/{version_id}/withdraw").json()
    assert withdrawn["status"] == "draft"

    # 체크아웃 재획득됨 → 즉시 저장 가능
    save = client.put(
        f"/api/versions/{version_id}/graph", json={"nodes": [], "edges": []}
    )
    assert save.status_code == 200


def test_withdraw_submitter_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/withdraw")
    assert forbidden.status_code == 403
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_publish_demotes_prior -v`
Expected: FAIL with 404 (publish route not defined).

- [ ] **Step 3: Add publish + withdraw endpoints**

In `app/routers/versions.py`, append at the end of the file:

```python
@router.post("/versions/{version_id}/publish", response_model=VersionOut)
async def publish_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Approved → Published. submitter만. 같은 맵의 기존 Published는 Approved로 강등."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.APPROVED:
        raise HTTPException(
            status_code=409, detail=f"cannot publish from status {version.status}"
        )
    if version.submitted_by != user:
        raise HTTPException(status_code=403, detail="only the submitter can publish")

    prior_published = await session.scalars(
        select(MapVersion).where(
            MapVersion.map_id == version.map_id,
            MapVersion.status == workflow.PUBLISHED,
        )
    )
    for prior in prior_published:
        prior.status = workflow.APPROVED

    version.status = workflow.PUBLISHED
    approvers = await _load_approvers(session, version.map_id)
    workflow.create_notifications(
        session,
        approvers,
        type="published",
        map_id=version.map_id,
        version_id=version_id,
        message=f"'{version.label}' was published",
    )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/withdraw", response_model=VersionOut)
async def withdraw_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Pending/Approved/Rejected → Draft. submitter만. 회수자에게 체크아웃 재부여."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status not in (workflow.PENDING, workflow.APPROVED, workflow.REJECTED):
        raise HTTPException(
            status_code=409, detail=f"cannot withdraw from status {version.status}"
        )
    if version.submitted_by != user:
        raise HTTPException(status_code=403, detail="only the submitter can withdraw")

    version.status = workflow.DRAFT
    version.checked_out_by = user
    version.checked_out_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(version)
    return version
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_workflow.py -k "publish or withdraw" -v`
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add app/routers/versions.py tests/test_workflow.py
git commit -m "feat(backend): publish (with demotion) + withdraw transitions — 게시·회수 전이"
```

---

### Task 7: Guard checkout & delete by status

**Files:**
- Modify: `app/routers/versions.py` (`acquire_checkout`, `delete_version`)
- Test: `tests/test_workflow.py` (append)

- [ ] **Step 1: Write the failing test**

Append to `tests/test_workflow.py`:

```python
def test_checkout_blocked_on_pending(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])  # now pending

    blocked = client.post(f"/api/versions/{version_id}/checkout", json={})
    assert blocked.status_code == 409


def test_delete_blocked_on_published(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])
    client.post(f"/api/maps/{map_id}/versions", json={"label": "keep"})  # not last
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v1}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{v1}/publish")

    blocked = client.delete(f"/api/versions/{v1}")
    assert blocked.status_code == 409


def test_delete_blocked_on_pending(client: TestClient) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])  # pending
    client.post(f"/api/maps/{map_id}/versions", json={"label": "keep"})  # not last

    blocked = client.delete(f"/api/versions/{v1}")
    assert blocked.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_workflow.py::test_checkout_blocked_on_pending -v`
Expected: FAIL — checkout currently succeeds (200) on a pending version, so the `== 409` assert fails.

- [ ] **Step 3: Guard `acquire_checkout`**

In `app/routers/versions.py`, inside `acquire_checkout`, immediately after the 404 check (the block that raises `f"version {version_id} not found"`) and before `now = datetime.now(...)`, add:

```python
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"version is {version.status} — not editable"
        )
```

- [ ] **Step 4: Guard `delete_version`**

In `app/routers/versions.py`, inside `delete_version`, immediately after the 404 check and before the `is_locked_by_other` check, add:

```python
    if version.status in (workflow.PENDING, workflow.PUBLISHED):
        raise HTTPException(
            status_code=409, detail=f"cannot delete a {version.status} version"
        )
```

- [ ] **Step 5: Run tests + full suite**

Run: `.venv/bin/python -m pytest tests/test_workflow.py -k "blocked" -v`
Expected: All PASS.

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: Entire suite PASS (confirm Task 1's existing-test note still holds — the checkout-on-draft tests in `test_collab.py` still work because new versions default to `draft`, which is editable).

- [ ] **Step 6: Commit**

```bash
git add app/routers/versions.py tests/test_workflow.py
git commit -m "feat(backend): guard checkout/delete by version status — 상태별 체크아웃·삭제 가드"
```

---

### Task 8: Notifications endpoints (list + mark-read)

**Files:**
- Modify: `app/schemas.py` (add `NotificationOut`)
- Create: `app/routers/notifications.py`
- Modify: `app/main.py` (register router)
- Test: `tests/test_notifications.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_notifications.py`:

```python
"""In-app notification tests — submit/publish side-effects + read (design 2026-06-14)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _pending_version(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": "notif map"}).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    return map_id, version_id


def test_submit_notifies_each_approver(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, _version_id = _pending_version(client, ["a", "b"])

    monkeypatch.setattr(settings, "dev_user", "a")
    a_notifs = client.get("/api/notifications?unread_only=true").json()
    monkeypatch.setattr(settings, "dev_user", "b")
    b_notifs = client.get("/api/notifications?unread_only=true").json()

    assert len(a_notifs) == 1
    assert a_notifs[0]["type"] == "review_requested"
    assert len(b_notifs) == 1


def test_mark_read_filters_unread(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, _version_id = _pending_version(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "a")
    notif_id = client.get("/api/notifications?unread_only=true").json()[0]["id"]
    read = client.post(f"/api/notifications/{notif_id}/read")
    remaining = client.get("/api/notifications?unread_only=true").json()

    assert read.status_code == 200
    assert read.json()["read"] is True
    assert remaining == []


def test_mark_read_other_recipient_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, _version_id = _pending_version(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    notif_id = client.get("/api/notifications").json()[0]["id"]

    monkeypatch.setattr(settings, "dev_user", "b")
    forbidden = client.post(f"/api/notifications/{notif_id}/read")
    assert forbidden.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_notifications.py::test_submit_notifies_each_approver -v`
Expected: FAIL with 404 (notifications route not mounted).

- [ ] **Step 3: Add `NotificationOut` schema**

In `app/schemas.py`, append at the end of the file:

```python
class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: str
    map_id: int | None
    version_id: int | None
    message: str
    read: bool
    created_at: datetime
```

(`ConfigDict` and `datetime` are already imported at the top of `schemas.py`.)

- [ ] **Step 4: Create `app/routers/notifications.py`**

```python
"""인앱 알림 — 본인 수신분 조회 / 읽음 처리 (design 2026-06-14)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Notification
from app.schemas import NotificationOut

router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = False,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Notification]:
    query = select(Notification).where(Notification.recipient == user)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    query = query.order_by(Notification.created_at.desc(), Notification.id.desc())
    rows = await session.scalars(query)
    return list(rows.all())


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notification:
    notif = await session.get(Notification, notification_id)
    if notif is None or notif.recipient != user:
        raise HTTPException(
            status_code=404, detail=f"notification {notification_id} not found"
        )
    notif.read = True
    await session.commit()
    await session.refresh(notif)
    return notif
```

- [ ] **Step 5: Register the router**

In `app/main.py`, update the import (line 9) to include `notifications`:

```python
from app.routers import approvers, comments, graph, maps, notifications, versions
```

Then after `app.include_router(approvers.router)` (added in Task 3), add:

```python
app.include_router(notifications.router)
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_notifications.py -v`
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add app/schemas.py app/routers/notifications.py app/main.py tests/test_notifications.py
git commit -m "feat(backend): in-app notification list/read endpoints — 인앱 알림 조회·읽음 API"
```

---

### Task 9: Full verification + lint

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: All tests PASS (existing + new `test_workflow.py` + `test_notifications.py`).

- [ ] **Step 2: Run the linter**

Run: `.venv/bin/ruff check app/ tests/`
Expected: `All checks passed!` — fix any unused-import / unused-variable findings.

- [ ] **Step 3: Update PROGRESS.md**

Add a dated entry under `## 2026-06-14` in repo-root `PROGRESS.md` summarizing the backend workflow implementation (what + why), per `rules/common/git.md`.

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md
git commit -m "chore: record version approval workflow backend in PROGRESS — 진행 기록"
```

---

## Self-Review (completed during authoring)

**Spec coverage:**
- §3 state model / transitions / roles → Tasks 4-7 (submit/approve/reject/publish/withdraw, editable-status gating).
- §4 data model (status, submitted_by, reject_reason, map_approvers, version_approvals, notifications) → Task 1.
- §5 unanimous logic (reset on submit, count==len(approvers) → approved, block on 0 approvers) → Tasks 4-5.
- §6 API surface (submit/approve/reject/publish/withdraw, approvers GET/PUT, notifications GET/read, workflow-state GET) → Tasks 3-8.
- §8 existing-feature interaction (checkout editable-only, delete published/pending blocked) → Task 7; clone default draft verified in Task 6 `test_publish_demotes_prior`.
- §9 test list → mapped 1:1 across `test_workflow.py` / `test_notifications.py`.

**Out of scope for this plan (frontend, by design — separate follow-up plan):** §7 status badges, action buttons, notification bell, rejected banner. The `GET /api/versions/{id}/workflow` and `VersionOut.status` additions here are the contract the frontend will consume.

**Type consistency:** `workflow.PENDING/APPROVED/PUBLISHED/REJECTED/DRAFT` constants used uniformly; `_load_approvers(session, map_id) -> list[str]` reused by submit/approve/reject/publish/workflow-state; `create_notifications(...)` signature identical at every call site (keyword-only `type/map_id/version_id/message`).

**Placeholder scan:** none — every step contains full code or an exact command + expected output.
