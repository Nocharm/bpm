# Map Rename Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 맵 이름 변경 기능 — 에디터는 승인 요청(오너/sysadmin 1인 decide), 오너/sysadmin은 즉시 적용, 알림·토스트 연동.

**Architecture:** 기존 `ApprovalRequest` 테이블에 `kind='map_rename'` 확장(DDL 불요). 요청 생성/조회/취소는 maps.py 신설 3엔드포인트, 결정은 기존 decide 엔드포인트의 kind별 게이트 분기, Inbox 통합 큐에 오너 관점 노출. 프론트는 Settings Details 패널의 이름 필드 + Inbox 카드 + 토스트.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + Playwright 검증 스크립트.

**Spec:** `docs/superpowers/specs/2026-07-18-map-rename-workflow-design.md`

## Global Constraints

- 작업 위치: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/map-rename-workflow` (브랜치 `worktree-map-rename-workflow`, dev 기준). **절대 다른 체크아웃에서 커밋 금지** — 커밋 전 `pwd`·`git branch --show-current` 확인.
- 모든 커밋: `type(scope): English summary — 한국어 요약` + **PROGRESS.md 갱신을 같은 커밋에** 포함.
- 백엔드 테스트 실행: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (개발 중엔 단일 파일, 커밋 전 전체).
- 프론트 게이트: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`.
- UI 문구 영어(디자인 룰 §5), i18n 키는 EN/KO 두 블록 모두 추가. raw hex 금지 — 토큰만.
- id 생성은 `frontend/src/lib/id.ts`의 `genId()` (crypto.randomUUID 금지).
- 알림 type 신규 5종(고정 문자열): `rename_requested` `rename_approved` `rename_rejected` `rename_superseded` `map_renamed`.
- ApprovalRequest 신규 status 값(문자열): `superseded`, `withdrawn`.

---

### Task 1: Backend — 요청 생성·pending 조회·취소 엔드포인트 + 공용 알림 헬퍼

**Files:**
- Modify: `backend/app/schemas.py` (MapUpdate 근처, ~41행)
- Modify: `backend/app/workflow.py` (create_notifications 아래)
- Modify: `backend/app/routers/maps.py` (update_map 아래, ~525행)
- Test: `backend/tests/test_map_rename_workflow.py` (신규)

**Interfaces:**
- Consumes: `_assert_unique_name(session, name, exclude_map_id=...)` (maps.py:61), `workflow.create_notifications(session, recipients, *, type, map_id=None, version_id=None, message)`, `workflow.get_display_name(session, login_id)`, `require_map_role(min_role)`, `ApprovalRequest` 모델, `ApprovalRequestOut` 스키마.
- Produces:
  - `RenameRequestIn(BaseModel)` — `to_name: str` (1~200자) — schemas.py
  - `workflow.load_map_user_collaborators(session, map_id, *, role: str | None = None) -> list[str]`
  - `POST /api/maps/{map_id}/rename-requests` → 201 `ApprovalRequestOut` (editor+)
  - `GET /api/maps/{map_id}/rename-requests/pending` → `ApprovalRequestOut | None` (viewer+)
  - `DELETE /api/maps/{map_id}/rename-requests/pending` → 204 (요청자 본인만)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_map_rename_workflow.py` 신규. 파일 상단은 `tests/test_permission_endpoints.py`의 enforce/act_as/_seed 패턴을 그대로 복사해 시작한다(동일 import + `SYSADMIN = "admin.sys"` + `enforce` fixture + `act_as` + `_seed`). `seed_map` 헬퍼도 test_permission_endpoints.py의 것을 참고해 이 파일에 필요한 최소형으로 작성:

```python
"""맵 이름 변경 승인 워크플로우 테스트 (spec 2026-07-18).

test_permission_endpoints.py 의 enforce/act_as/_seed 패턴을 따른다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import ApprovalRequest, MapPermission, Notification, ProcessMap
from app.settings import settings

SYSADMIN = "admin.sys"
OWNER = "owner.user"
EDITOR = "editor.user"
VIEWER = "viewer.user"


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


def seed_rename_map(name: str = "Rename Target") -> int:
    """owner/editor/viewer 그랜트가 있는 맵 시드. map_id 반환."""

    async def _factory(session):
        m = ProcessMap(name=name, description="", owning_department="Owning Anchor Division")
        session.add(m)
        await session.flush()
        for login, role in ((OWNER, "owner"), (EDITOR, "editor"), (VIEWER, "viewer")):
            session.add(
                MapPermission(
                    map_id=m.id, principal_type="user", principal_id=login,
                    role=role, granted_by=SYSADMIN,
                )
            )
        return m.id

    return _seed(_factory)


def _pending_request(map_id: int) -> ApprovalRequest | None:
    async def _q(session):
        return await session.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.map_id == map_id,
                ApprovalRequest.kind == "map_rename",
                ApprovalRequest.status == "pending",
            )
        )

    return _seed(_q)


class TestCreateRenameRequest:
    def test_editor_creates_pending_request_and_notifies_owner(self, client, enforce):
        map_id = seed_rename_map("Alpha Process")
        act_as(EDITOR)
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Beta Process"})
        assert r.status_code == 201
        body = r.json()
        assert body["kind"] == "map_rename"
        assert body["status"] == "pending"
        assert body["payload"] == {"from_name": "Alpha Process", "to_name": "Beta Process"}
        assert body["requested_by"] == EDITOR

        async def _notes(session):
            rows = await session.scalars(
                select(Notification).where(Notification.type == "rename_requested")
            )
            return [(n.recipient, n.map_id) for n in rows.all()]

        notes = _seed(_notes)
        assert (OWNER, map_id) in notes
        assert all(rcpt != EDITOR for rcpt, _ in notes)

    def test_duplicate_name_409(self, client, enforce):
        seed_rename_map("Taken Name")
        map_id = seed_rename_map("Second Map")
        act_as(EDITOR)
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Taken Name"})
        assert r.status_code == 409

    def test_second_pending_409(self, client, enforce):
        map_id = seed_rename_map("Gamma")
        act_as(EDITOR)
        assert client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Gamma2"}).status_code == 201
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Gamma3"})
        assert r.status_code == 409

    def test_same_name_422(self, client, enforce):
        map_id = seed_rename_map("Delta")
        act_as(EDITOR)
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Delta"})
        assert r.status_code == 422

    def test_viewer_403(self, client, enforce):
        map_id = seed_rename_map("Epsilon")
        act_as(VIEWER)
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Epsilon2"})
        assert r.status_code == 403


class TestPendingAndWithdraw:
    def test_get_pending_returns_request_then_null(self, client, enforce):
        map_id = seed_rename_map("Zeta")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Zeta2"})
        act_as(VIEWER)
        r = client.get(f"/api/maps/{map_id}/rename-requests/pending")
        assert r.status_code == 200
        assert r.json()["payload"]["to_name"] == "Zeta2"

    def test_withdraw_own_204_sets_withdrawn(self, client, enforce):
        map_id = seed_rename_map("Eta")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Eta2"})
        r = client.delete(f"/api/maps/{map_id}/rename-requests/pending")
        assert r.status_code == 204
        assert _pending_request(map_id) is None
        assert client.get(f"/api/maps/{map_id}/rename-requests/pending").json() is None

    def test_withdraw_by_other_403(self, client, enforce):
        map_id = seed_rename_map("Theta")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Theta2"})
        act_as(OWNER)
        assert client.delete(f"/api/maps/{map_id}/rename-requests/pending").status_code == 403

    def test_withdraw_none_404(self, client, enforce):
        map_id = seed_rename_map("Iota")
        act_as(EDITOR)
        assert client.delete(f"/api/maps/{map_id}/rename-requests/pending").status_code == 404
```

주의: `Notification` 모델의 수신자 컬럼명은 `app/models.py`의 실제 정의를 확인해 맞춘다(`recipient`가 아니면 해당 이름으로 수정 — workflow.create_notifications의 session.add 부분에서 확인 가능).

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py -q`
Expected: FAIL — 404 (엔드포인트 미존재) 계열 실패.

- [ ] **Step 3: 구현**

`backend/app/schemas.py` — `MapUpdate` 클래스(38행) 바로 아래에 추가:

```python
class RenameRequestIn(BaseModel):
    # 이름 변경 승인 요청 — 오너/sysadmin 1인 decide로 적용 (spec 2026-07-18)
    to_name: str = Field(min_length=1, max_length=200)
```

`backend/app/workflow.py` — `create_notifications` 아래에 추가 (MapPermission import가 없으면 모델 import 라인에 추가):

```python
async def load_map_user_collaborators(
    session: AsyncSession, map_id: int, *, role: str | None = None
) -> list[str]:
    """맵의 user principal 협업자 login_id — role 지정 시 해당 역할만 (rename 알림 대상)."""
    q = select(MapPermission.principal_id).where(
        MapPermission.map_id == map_id,
        MapPermission.principal_type == "user",
    )
    if role is not None:
        q = q.where(MapPermission.role == role)
    rows = await session.scalars(q)
    return list(rows.all())


async def notify_map_renamed(
    session: AsyncSession, map_id: int, *, old_name: str, new_name: str, actor: str
) -> None:
    """이름 변경 확정(직접·승인 공통) → 협업자 전원 알림 (행위자 제외, spec 2026-07-18)."""
    actor_name = await get_display_name(session, actor)
    recipients = [
        c for c in await load_map_user_collaborators(session, map_id) if c != actor
    ]
    await create_notifications(
        session,
        recipients,
        type="map_renamed",
        map_id=map_id,
        message=f"{actor_name} renamed '{old_name}' to '{new_name}'",
    )
```

`backend/app/routers/maps.py` — import 추가: `from app.models import ...` 라인에 `ApprovalRequest`, `from app.schemas import ...`에 `ApprovalRequestOut, RenameRequestIn`. `update_map` 함수 아래에 3개 엔드포인트 추가:

```python
@router.post(
    "/{map_id}/rename-requests",
    response_model=ApprovalRequestOut,
    status_code=201,
    dependencies=[Depends(require_map_role("editor"))],
)
async def create_rename_request(
    map_id: int,
    payload: RenameRequestIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalRequest:
    """이름 변경 승인 요청 — 오너/sysadmin 1인이 decide로 적용 (spec 2026-07-18)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    to_name = payload.to_name.strip()
    if not to_name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    if to_name == found_map.name:
        raise HTTPException(status_code=422, detail="new name equals current name")
    await _assert_unique_name(session, to_name, exclude_map_id=map_id)
    pending = await session.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(status_code=409, detail="a rename request is already pending")
    req = ApprovalRequest(
        map_id=map_id,
        kind="map_rename",
        payload={"from_name": found_map.name, "to_name": to_name},
        requested_by=user,
        status="pending",
    )
    session.add(req)
    requester_name = await workflow.get_display_name(session, user)
    recipients = [
        o
        for o in await workflow.load_map_user_collaborators(session, map_id, role="owner")
        if o != user
    ]
    await workflow.create_notifications(
        session,
        recipients,
        type="rename_requested",
        map_id=map_id,
        message=f"{requester_name} requested to rename '{found_map.name}' to '{to_name}'",
    )
    await session.commit()
    await session.refresh(req)
    return req


@router.get(
    "/{map_id}/rename-requests/pending",
    response_model=ApprovalRequestOut | None,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_pending_rename_request(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ApprovalRequest | None:
    """pending rename 요청 조회 — Settings 배지·중복요청 안내용 (없으면 null)."""
    return await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )


@router.delete("/{map_id}/rename-requests/pending", status_code=204)
async def withdraw_rename_request(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 pending rename 요청 취소 → withdrawn (행 보존 — 이력)."""
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        raise HTTPException(status_code=404, detail="no pending rename request")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py -q && .venv/bin/ruff check app/ tests/`
Expected: PASS (9 tests), ruff clean.

- [ ] **Step 5: 커밋** (PROGRESS.md에 Task 1 한 줄 추가 후)

```bash
git add backend/app/schemas.py backend/app/workflow.py backend/app/routers/maps.py backend/tests/test_map_rename_workflow.py PROGRESS.md
git commit -m "feat(maps): rename request create/pending/withdraw endpoints — 이름변경 요청 생성·조회·취소 API"
```

---

### Task 2: Backend — PATCH /maps name 오너 전용 조임 + supersede + 협업자 알림

**Files:**
- Modify: `backend/app/routers/maps.py` (`update_map`, ~505행)
- Test: `backend/tests/test_map_rename_workflow.py` (클래스 추가)

**Interfaces:**
- Consumes: Task 1의 `workflow.notify_map_renamed`, `get_effective_role(session, user, map_id)` (이미 maps.py에 import됨 — sysadmin은 owner로 해석됨), `_now` (app.models — import 추가).
- Produces: `PATCH /api/maps/{map_id}`에서 name 변경은 오너/sysadmin 전용(에디터 403), pending rename `superseded` 전이 + `rename_superseded` 알림 + `map_renamed` 협업자 알림.

- [ ] **Step 1: 실패하는 테스트 작성** — test_map_rename_workflow.py에 클래스 추가:

```python
class TestDirectRename:
    def test_editor_patch_name_403(self, client, enforce):
        map_id = seed_rename_map("Kappa")
        act_as(EDITOR)
        r = client.patch(f"/api/maps/{map_id}", json={"name": "Kappa2"})
        assert r.status_code == 403

    def test_editor_patch_description_still_ok(self, client, enforce):
        map_id = seed_rename_map("Lambda")
        act_as(EDITOR)
        r = client.patch(f"/api/maps/{map_id}", json={"description": "updated"})
        assert r.status_code == 200
        assert r.json()["description"] == "updated"

    def test_owner_patch_name_applies_and_notifies(self, client, enforce):
        map_id = seed_rename_map("Mu")
        act_as(OWNER)
        r = client.patch(f"/api/maps/{map_id}", json={"name": "Mu Renamed"})
        assert r.status_code == 200
        assert r.json()["name"] == "Mu Renamed"

        async def _notes(session):
            rows = await session.scalars(
                select(Notification).where(Notification.type == "map_renamed")
            )
            return [n.recipient for n in rows.all()]

        recipients = _seed(_notes)
        assert EDITOR in recipients and VIEWER in recipients
        assert OWNER not in recipients

    def test_owner_patch_name_supersedes_pending(self, client, enforce):
        map_id = seed_rename_map("Nu")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Nu Editor"})
        act_as(OWNER)
        client.patch(f"/api/maps/{map_id}", json={"name": "Nu Owner"})
        assert _pending_request(map_id) is None

        async def _req(session):
            return await session.scalar(
                select(ApprovalRequest).where(
                    ApprovalRequest.map_id == map_id,
                    ApprovalRequest.kind == "map_rename",
                )
            )

        req = _seed(_req)
        assert req.status == "superseded"

        async def _notes(session):
            rows = await session.scalars(
                select(Notification).where(Notification.type == "rename_superseded")
            )
            return [n.recipient for n in rows.all()]

        assert EDITOR in _seed(_notes)

    def test_sysadmin_patch_name_ok(self, client, enforce):
        map_id = seed_rename_map("Xi")
        act_as(SYSADMIN)
        r = client.patch(f"/api/maps/{map_id}", json={"name": "Xi Renamed"})
        assert r.status_code == 200
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py::TestDirectRename -q`
Expected: FAIL — editor 403이 현재는 200, 알림/supersede 부재.

- [ ] **Step 3: 구현** — maps.py import에 `_now` 추가(`from app.models import ..., _now`), `update_map`을 다음으로 교체:

```python
@router.patch(
    "/{map_id}",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def update_map(
    map_id: int,
    payload: MapUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.name is not None and payload.name != found_map.name:
        # 이름 변경은 오너/sysadmin 전용 — 에디터는 rename-requests 승인 경로 (spec 2026-07-18)
        role = await get_effective_role(session, user, map_id)
        if role != "owner":
            raise HTTPException(
                status_code=403,
                detail="renaming requires owner — submit a rename request instead",
            )
        await _assert_unique_name(session, payload.name, exclude_map_id=map_id)
        old_name = found_map.name
        found_map.name = payload.name
        await _supersede_pending_rename(session, map_id, actor=user, new_name=payload.name)
        await workflow.notify_map_renamed(
            session, map_id, old_name=old_name, new_name=payload.name, actor=user
        )
    if payload.description is not None:
        found_map.description = payload.description
    await session.commit()
    await session.refresh(found_map)
    return found_map


async def _supersede_pending_rename(
    session: AsyncSession, map_id: int, *, actor: str, new_name: str
) -> None:
    """오너 직접 변경 시 pending rename 요청 무효화 + 요청자 알림 (spec 2026-07-18)."""
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        return
    req.status = "superseded"
    req.decided_by = actor
    req.decided_at = _now()
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type="rename_superseded",
        map_id=map_id,
        message=f"Your rename request was superseded — the map is now '{new_name}'",
    )
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py -q && .venv/bin/ruff check app/ tests/`
Expected: PASS (14 tests). 이어서 전체 스위트: `... -m pytest tests/ -q` — 기존 update_map rename 테스트가 있으면 새 403 규칙에 맞게 수정(기존 테스트가 editor로 name을 바꾸는 케이스가 깨질 수 있음 — 오너로 전환하거나 기대값 갱신).
Expected: 전체 그린.

- [ ] **Step 5: 커밋** (PROGRESS.md 갱신 포함)

```bash
git add backend/app/routers/maps.py backend/tests/ PROGRESS.md
git commit -m "feat(maps): owner-only direct rename with supersede + collaborator notify — 직접 이름변경 오너 전용·pending 무효화·알림"
```

---

### Task 3: Backend — decide 확장 (kind별 게이트 + rename 적용 + 알림)

**Files:**
- Modify: `backend/app/routers/permissions.py` (`decide_approval_request`, `_apply_request`, `_notify_permission_decision`)
- Test: `backend/tests/test_map_rename_workflow.py` (클래스 추가)

**Interfaces:**
- Consumes: `assert_map_role` (`from app.permissions.access import assert_map_role` — deps.py가 쓰는 그 함수, sysadmin은 owner로 통과), `_assert_unique_name` (`from app.routers.maps import _assert_unique_name` — maps.py는 permissions 라우터를 import하지 않으므로 순환 없음, versions→maps cross-import 전례 있음), Task 1 `workflow.notify_map_renamed`.
- Produces: `POST /api/approval-requests/{id}/decide`가 `kind='map_rename'`에서 오너/sysadmin 게이트·이름 적용·`rename_approved`/`rename_rejected` 알림·approve 시 `map_renamed` 협업자 알림. 이름 선점 경합 시 409 + pending 유지.

- [ ] **Step 1: 실패하는 테스트 작성** — 클래스 추가. 승인자(approver)이지만 오너가 아닌 사용자를 만들기 위해 `MapApprover` 시드 헬퍼 사용:

```python
APPROVER = "approver.user"


def seed_approver(map_id: int, login: str = APPROVER) -> None:
    async def _factory(session):
        from app.models import MapApprover

        session.add(MapApprover(map_id=map_id, user_id=login))

    _seed(_factory)


def _request_id(map_id: int) -> int:
    req = _pending_request(map_id)
    assert req is not None
    return req.id


class TestDecideRename:
    def _make_request(self, client, map_id: int, to_name: str) -> int:
        act_as(EDITOR)
        r = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": to_name})
        assert r.status_code == 201
        return r.json()["id"]

    def test_owner_approve_applies_name(self, client, enforce):
        map_id = seed_rename_map("Omicron")
        rid = self._make_request(client, map_id, "Omicron2")
        act_as(OWNER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 200
        assert r.json()["status"] == "applied"
        act_as(VIEWER)
        assert client.get(f"/api/maps/{map_id}").json()["name"] == "Omicron2"

        async def _notes(session):
            rows = await session.scalars(select(Notification))
            return [(n.type, n.recipient) for n in rows.all()]

        notes = _seed(_notes)
        assert ("rename_approved", EDITOR) in notes
        assert ("map_renamed", VIEWER) in notes  # 협업자 통지 — 행위자(OWNER) 제외
        assert ("map_renamed", OWNER) not in notes

    def test_nonowner_approver_403(self, client, enforce):
        map_id = seed_rename_map("Pi")
        seed_approver(map_id)
        rid = self._make_request(client, map_id, "Pi2")
        act_as(APPROVER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 403

    def test_editor_decide_403(self, client, enforce):
        map_id = seed_rename_map("Rho")
        rid = self._make_request(client, map_id, "Rho2")
        act_as(EDITOR)
        assert client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"}).status_code == 403

    def test_sysadmin_approve_ok(self, client, enforce):
        map_id = seed_rename_map("Sigma")
        rid = self._make_request(client, map_id, "Sigma2")
        act_as(SYSADMIN)
        assert client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"}).status_code == 200

    def test_reject_keeps_name(self, client, enforce):
        map_id = seed_rename_map("Tau")
        rid = self._make_request(client, map_id, "Tau2")
        act_as(OWNER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "reject"})
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        act_as(VIEWER)
        assert client.get(f"/api/maps/{map_id}").json()["name"] == "Tau"

        async def _notes(session):
            rows = await session.scalars(
                select(Notification).where(Notification.type == "rename_rejected")
            )
            return [n.recipient for n in rows.all()]

        assert EDITOR in _seed(_notes)

    def test_approve_name_conflict_409_stays_pending(self, client, enforce):
        map_id = seed_rename_map("Upsilon")
        rid = self._make_request(client, map_id, "Phi Target")
        seed_rename_map("Phi Target")  # 요청 후 다른 맵이 이름 선점
        act_as(OWNER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 409
        req = _pending_request(map_id)
        assert req is not None and req.status == "pending"
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py::TestDecideRename -q`
Expected: FAIL — 게이트/적용/알림 미구현 (`assert_approver_or_sysadmin`이 403을 내거나 `_apply_request`가 무시).

- [ ] **Step 3: 구현** — permissions.py:

import 변경: `from app.permissions.access import get_effective_role` 라인을 `from app.permissions.access import assert_map_role, get_effective_role`로, 파일 하단 헬퍼에서 쓰도록 `from app.routers.maps import _assert_unique_name` 추가 (모듈 상단 — 순환 없음 확인: maps.py는 app.routers.permissions를 import하지 않음).

`decide_approval_request`의 게이트 한 줄을 kind 분기로 교체:

```python
    if req.kind == "map_rename":
        # rename 결정권자는 오너/sysadmin — 승인자 게이트와 다름 (spec 2026-07-18)
        await assert_map_role(session, user, req.map_id, "owner")
    else:
        await assert_approver_or_sysadmin(session, user, req.map_id)
```

`_apply_request`에 분기 추가 (기존 두 분기 뒤):

```python
    elif req.kind == "map_rename":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None:
            return  # 멱등 — 맵이 사라졌으면 그대로 applied
        to_name = req.payload.get("to_name") or ""
        # 요청~승인 사이 이름 선점 경합 — 409로 중단하면 decide가 커밋 전이라 pending 유지
        await _assert_unique_name(session, to_name, exclude_map_id=req.map_id)
        old_name = found_map.name
        found_map.name = to_name
        await workflow.notify_map_renamed(
            session, req.map_id, old_name=old_name, new_name=to_name, actor=req.decided_by or ""
        )
```

`_notify_permission_decision` 상단에 rename 분기 추가:

```python
    if req.kind == "map_rename":
        from_name = req.payload.get("from_name", "")
        to_name = req.payload.get("to_name", "")
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=f"rename_{outcome}",
            map_id=req.map_id,
            message=f"Your request to rename '{from_name}' to '{to_name}' was {outcome}",
        )
        return
```

- [ ] **Step 4: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 신규 21 tests + 전체 그린.

- [ ] **Step 5: 커밋** (PROGRESS.md 갱신 포함)

```bash
git add backend/app/routers/permissions.py backend/tests/test_map_rename_workflow.py PROGRESS.md
git commit -m "feat(permissions): kind-aware decide gate + map_rename apply — rename 결정 오너 게이트·적용·알림"
```

---

### Task 4: Backend — Inbox 통합 큐에 rename 요청 노출

**Files:**
- Modify: `backend/app/routers/inbox.py` (ar_q 블록 111~118행 + 신규 블록)
- Test: `backend/tests/test_map_rename_workflow.py` (클래스 추가)

**Interfaces:**
- Consumes: 기존 `ar_q` 쿼리·`items` dict 형태(위 3블록과 동일 키 세트), `MapPermission`.
- Produces: `GET /api/inbox/approvals`가 `kind='approval_request'`, `title='map_rename'`, `before=현재 맵명`, `after=payload.to_name` 항목을 **오너/sysadmin에게만** 반환. 기존 kind 노출은 불변.

- [ ] **Step 1: 실패하는 테스트 작성**:

```python
class TestInboxRename:
    def _titles(self, client) -> list[str]:
        r = client.get("/api/inbox/approvals")
        assert r.status_code == 200
        return [a["title"] for a in r.json() if a["kind"] == "approval_request"]

    def test_owner_sees_rename_with_before_after(self, client, enforce):
        map_id = seed_rename_map("Chi")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Chi2"})
        act_as(OWNER)
        items = [
            a for a in client.get("/api/inbox/approvals").json()
            if a["kind"] == "approval_request" and a["title"] == "map_rename"
        ]
        assert len(items) == 1
        assert items[0]["before"] == "Chi"
        assert items[0]["after"] == "Chi2"
        assert items[0]["map_id"] == map_id

    def test_nonowner_approver_does_not_see_rename(self, client, enforce):
        map_id = seed_rename_map("Psi")
        seed_approver(map_id)
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Psi2"})
        act_as(APPROVER)
        assert "map_rename" not in self._titles(client)

    def test_sysadmin_sees_rename(self, client, enforce):
        map_id = seed_rename_map("Omega")
        act_as(EDITOR)
        client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "Omega2"})
        act_as(SYSADMIN)
        assert "map_rename" in self._titles(client)
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py::TestInboxRename -q`
Expected: FAIL — 오너에게 안 보이거나(승인자 필터) 비오너 승인자에게 보임.

- [ ] **Step 3: 구현** — inbox.py: 기존 ar_q `.where(...)`에 `ApprovalRequest.kind != "map_rename"` 조건 추가, 그 for 루프 아래에 신규 블록:

```python
    # 4) 이름 변경 승인 요청 — 내가 오너인 맵, 또는 sysadmin (결정권자 관점, spec 2026-07-18)
    rn_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            ApprovalRequest.kind == "map_rename",
        )
    )
    if not sysadmin:
        rename_owner_map_ids = select(MapPermission.map_id).where(
            MapPermission.principal_type == "user",
            MapPermission.principal_id == user,
            MapPermission.role == "owner",
        )
        rn_q = rn_q.where(ApprovalRequest.map_id.in_(rename_owner_map_ids))
    for req, pm in (await session.execute(rn_q)).all():
        items.append(
            {
                "kind": "approval_request",
                "id": req.id,  # decide 엔드포인트가 받는 request id
                "title": req.kind,
                "map_id": pm.id,
                "map_name": pm.name,
                "requester": req.requested_by,
                "status": req.status,
                "created_at": req.created_at,
                "version_id": None,
                "detail": None,
                "version_label": None,
                "version_number": None,
                "updated_at": None,
                "holder": None,
                "before": pm.name,
                "after": req.payload.get("to_name"),
                "principal": None,
            }
        )
```

주의: dict 키 세트는 기존 3블록과 동일해야 한다(`InboxApprovalOut` 검증) — 기존 approval_request 블록의 실제 키를 보고 맞춘다.

- [ ] **Step 4: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_map_rename_workflow.py tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 그린.

- [ ] **Step 5: 커밋** (PROGRESS.md 갱신 포함)

```bash
git add backend/app/routers/inbox.py backend/tests/test_map_rename_workflow.py PROGRESS.md
git commit -m "feat(inbox): surface map_rename requests to owners/sysadmin — Inbox 큐 rename 오너 노출"
```

---

### Task 5: Frontend — api 클라이언트 + Settings Details 이름 필드·pending 배지·토스트

**Files:**
- Modify: `frontend/src/lib/api.ts` (updateMap 근처 266행)
- Modify: `frontend/src/components/permissions/map-details-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN·KO 두 블록)

**Interfaces:**
- Consumes: Task 1 백엔드 3엔드포인트, `updateMap`, `getMe` (api.ts:594 — `me.username`이 login_id), `ApprovalRequest` 타입(api.ts 기존 — decideApprovalRequest 반환형), `MapDetailsPanel` props(`mapId, canEdit, isOwner, onToast, onChanged` — settings 페이지가 이미 전달).
- Produces:
  - `createRenameRequest(mapId: number, toName: string): Promise<ApprovalRequest>`
  - `getPendingRenameRequest(mapId: number): Promise<ApprovalRequest | null>`
  - `withdrawRenameRequest(mapId: number): Promise<void>`
  - i18n 키: `perm.rename.label/save/applied/appliedSuperseded/requested/withdrawn/withdraw/pendingBadge/requestedBy`

- [ ] **Step 1: api.ts 함수 추가** — `updateMap` 아래:

```ts
export function createRenameRequest(mapId: number, toName: string): Promise<ApprovalRequest> {
  return request<ApprovalRequest>(`/maps/${mapId}/rename-requests`, {
    method: "POST",
    body: JSON.stringify({ to_name: toName }),
  });
}

export function getPendingRenameRequest(mapId: number): Promise<ApprovalRequest | null> {
  return request<ApprovalRequest | null>(`/maps/${mapId}/rename-requests/pending`);
}

export function withdrawRenameRequest(mapId: number): Promise<void> {
  return request<void>(`/maps/${mapId}/rename-requests/pending`, { method: "DELETE" });
}
```

(`ApprovalRequest` 타입이 api.ts에 이미 있는지 확인 — decideApprovalRequest:850이 반환. payload 필드가 타입에 없으면 `payload: Record<string, unknown>` 추가.)

- [ ] **Step 2: i18n 키 추가** — i18n-messages.ts의 `perm.details.*` 근처, EN 블록:

```ts
"perm.rename.label": "Map name",
"perm.rename.save": "Rename",
"perm.rename.applied": "Map renamed",
"perm.rename.appliedSuperseded": "Map renamed — the pending request was superseded",
"perm.rename.requested": "Rename request sent for approval",
"perm.rename.withdrawn": "Rename request withdrawn",
"perm.rename.withdraw": "Withdraw",
"perm.rename.pendingBadge": "Rename to '{name}' pending approval",
"perm.rename.requestedBy": "Requested by {user}",
```

KO 블록(같은 키):

```ts
"perm.rename.label": "맵 이름",
"perm.rename.save": "이름 변경",
"perm.rename.applied": "맵 이름이 변경되었습니다",
"perm.rename.appliedSuperseded": "맵 이름이 변경되었습니다 — 대기 중이던 요청은 무효화되었습니다",
"perm.rename.requested": "이름 변경 승인 요청을 보냈습니다",
"perm.rename.withdrawn": "이름 변경 요청을 취소했습니다",
"perm.rename.withdraw": "요청 취소",
"perm.rename.pendingBadge": "'{name}'(으)로 변경 승인 대기 중",
"perm.rename.requestedBy": "요청자 {user}",
```

- [ ] **Step 3: 패널 구현** — map-details-panel.tsx:

import에 `createRenameRequest, getPendingRenameRequest, withdrawRenameRequest, getMe` + `type ApprovalRequest` 추가. 상태 추가:

```tsx
const [name, setName] = useState("");
const [savedName, setSavedName] = useState("");
const [pendingRename, setPendingRename] = useState<ApprovalRequest | null>(null);
const [me, setMe] = useState("");
```

기존 로드 effect의 `Promise.all`에 `getPendingRenameRequest(Number(mapId))`, `getMe()` 추가하고 `setName(d.name); setSavedName(d.name);` (getMap 응답 `d.name`).

핸들러 추가 (handleSave 아래):

```tsx
async function handleSaveName() {
  const next = name.trim();
  if (!next || next === savedName) return;
  setSaving(true);
  setError(null);
  try {
    if (isOwner) {
      const hadPending = pendingRename !== null;
      await updateMap(Number(mapId), { name: next });
      setSavedName(next);
      setPendingRename(null);
      onToast(t(hadPending ? "perm.rename.appliedSuperseded" : "perm.rename.applied"));
      onChanged?.();
    } else {
      const req = await createRenameRequest(Number(mapId), next);
      setPendingRename(req);
      setName(savedName); // 이름 자체는 미변경 — 입력은 저장명으로 복원
      onToast(t("perm.rename.requested"));
    }
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  } finally {
    setSaving(false);
  }
}

async function handleWithdraw() {
  try {
    await withdrawRenameRequest(Number(mapId));
    setPendingRename(null);
    onToast(t("perm.rename.withdrawn"));
  } catch (err) {
    setError(err instanceof Error ? err.message : String(err));
  }
}
```

JSX — description label 위에 이름 섹션 추가 (기존 톤 그대로: `text-caption text-ink-secondary` 라벨, `border-hairline bg-surface` 입력, 저장 버튼은 description 저장 버튼과 동일 클래스):

```tsx
<label className="text-caption text-ink-secondary">{t("perm.rename.label")}</label>
<div className="flex items-center gap-2">
  <input
    data-id="settings-map-name"
    className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-3 py-2 text-body text-ink outline-none focus:border-accent disabled:opacity-60"
    value={name}
    onChange={(e) => setName(e.target.value)}
    disabled={!canEdit || saving || (!isOwner && pendingRename !== null)}
  />
  {canEdit && (
    <button
      type="button"
      data-id="settings-map-name-save"
      className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-60"
      onClick={() => void handleSaveName()}
      disabled={saving || name.trim() === "" || name.trim() === savedName || (!isOwner && pendingRename !== null)}
    >
      {t("perm.rename.save")}
    </button>
  )}
</div>
{pendingRename && (
  <div
    data-id="settings-rename-pending"
    className="flex flex-wrap items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary"
  >
    <span>{t("perm.rename.pendingBadge", { name: String(pendingRename.payload?.to_name ?? "") })}</span>
    <span className="text-ink-tertiary">{t("perm.rename.requestedBy", { user: pendingRename.requested_by })}</span>
    {pendingRename.requested_by === me && (
      <button
        type="button"
        data-id="settings-rename-withdraw"
        className="ml-auto rounded-sm border border-hairline px-2 py-1 text-fine text-ink hover:bg-surface"
        onClick={() => void handleWithdraw()}
      >
        {t("perm.rename.withdraw")}
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: 게이트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run`
Expected: tsc 0 / lint 0 err / vitest 전체 그린.

- [ ] **Step 5: 커밋** (PROGRESS.md 갱신 포함)

```bash
git add frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts frontend/src/components/permissions/map-details-panel.tsx PROGRESS.md
git commit -m "feat(settings): map name field with owner-direct / editor-request flows — Settings 이름변경 필드·pending 배지·토스트"
```

---

### Task 6: Frontend — Inbox 카드 map_rename 표시 + decide 토스트 + 알림 카테고리

**Files:**
- Modify: `frontend/src/app/inbox/page.tsx` (`approvalTitle`:66, `approvalSummary`:75, decide 핸들러 ~268)
- Modify: `frontend/src/lib/notification-categories.ts`
- Modify: `frontend/src/lib/notification-categories.test.ts`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `InboxApproval`(before/after 필드 기존), `decideApprovalRequest`, `ToastStack`/`ToastItem` (`@/components/toast-stack` — settings/page.tsx:16·241 사용 패턴), `genId` (`@/lib/id`).
- Produces: Inbox에서 map_rename 카드 제목/요약(before→after) 렌더, approve/reject 성공·실패 토스트, `rename_*`/`map_renamed` 알림이 permission 카테고리로 분류.

- [ ] **Step 1: 실패하는 테스트 작성** — notification-categories.test.ts에 추가:

```ts
it("classifies rename types as permission", () => {
  expect(getNotificationCategory("rename_requested")).toBe("permission");
  expect(getNotificationCategory("rename_approved")).toBe("permission");
  expect(getNotificationCategory("rename_rejected")).toBe("permission");
  expect(getNotificationCategory("rename_superseded")).toBe("permission");
  expect(getNotificationCategory("map_renamed")).toBe("permission");
});
```

Run: `cd frontend && npx vitest run src/lib/notification-categories.test.ts` — Expected: FAIL (null 반환).

- [ ] **Step 2: 카테고리 구현** — notification-categories.ts `getNotificationCategory`에 permission 분기 다음 줄 추가:

```ts
if (type.startsWith("rename_") || type === "map_renamed") return "permission";
```

Run: 같은 vitest — Expected: PASS.

- [ ] **Step 3: i18n 키 추가** — EN 블록 (`inbox.reqKind.*` 근처):

```ts
"inbox.reqKind.map_rename": "Map rename",
"inbox.summary.map_rename": "Rename `{from}` → **`{to}`**",
"inbox.toast.renameApproved": "Rename approved — new name applied",
"inbox.toast.renameRejected": "Rename request rejected",
```

KO 블록:

```ts
"inbox.reqKind.map_rename": "맵 이름 변경",
"inbox.summary.map_rename": "이름 변경 `{from}` → **`{to}`**",
"inbox.toast.renameApproved": "이름 변경을 승인했습니다 — 새 이름이 적용되었습니다",
"inbox.toast.renameRejected": "이름 변경 요청을 반려했습니다",
```

(기존 `inbox.summary.*` 키의 실제 포맷을 보고 마크다운 관례를 맞춘다 — 이미 inline code 강조를 쓰는 패턴.)

- [ ] **Step 4: inbox/page.tsx 수정**

`approvalTitle`에 분기 추가:

```ts
if (a.title === "map_rename") return t("inbox.reqKind.map_rename");
```

`approvalSummary`의 approval_request 처리부에 분기 추가 (기존 visibility/downgrade 요약과 나란히):

```ts
if (a.kind === "approval_request" && a.title === "map_rename")
  return t("inbox.summary.map_rename", { from: a.before ?? "", to: a.after ?? "" });
```

토스트 인프라 (settings/page.tsx 패턴): import `{ ToastStack, type ToastItem } from "@/components/toast-stack"`, `{ genId } from "@/lib/id"`. 컴포넌트 상태·헬퍼:

```tsx
const [toasts, setToasts] = useState<ToastItem[]>([]);
const pushToast = (message: string) => setToasts((prev) => [{ id: genId(), message }, ...prev]);
const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id));
```

decide 핸들러(268행 부근)의 `decideApprovalRequest` 호출 경로를 try/catch로 감싸고 rename이면 성공 토스트, 실패면 에러 토스트:

```tsx
} else {
  try {
    await decideApprovalRequest(a.id, approve ? "approve" : "reject");
    if (a.title === "map_rename")
      pushToast(t(approve ? "inbox.toast.renameApproved" : "inbox.toast.renameRejected"));
  } catch (err) {
    // 승인 시점 이름 선점 409 등 — 백엔드 detail 노출
    pushToast(err instanceof Error ? err.message : String(err));
  }
}
```

렌더 최하단(기존 return의 루트 안)에 `<ToastStack toasts={toasts} onDismiss={dismissToast} />` 추가.

- [ ] **Step 5: 게이트 확인**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build`
Expected: 전부 그린.

- [ ] **Step 6: 커밋** (PROGRESS.md 갱신 포함)

```bash
git add frontend/src/app/inbox/page.tsx frontend/src/lib/notification-categories.ts frontend/src/lib/notification-categories.test.ts frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(inbox): map_rename card + decide toasts + notification category — Inbox 카드·토스트·알림 분류"
```

---

### Task 7: Playwright 왕복 검증 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-map-rename.mjs`
- Test: 실기동 왕복 검증 (스크립트 자체가 검증물)

**Interfaces:**
- Consumes: Task 1~6 전체. 기존 `frontend/scripts/pw-verify-params-ui-sync.mjs`의 하네스 관례(시스템 Chrome + playwright-core, 백엔드 89xx·프론트 32xx 포트, `bpm.devUser`/`bpm.lang` localStorage, `python -m scripts.reset_db` 시드).
- Produces: 시나리오 그린 로그 (표준출력 PASS 카운트).

- [ ] **Step 1: 스크립트 작성** — `pw-verify-params-ui-sync.mjs`를 열어 서버 기동/브라우저 헬퍼 보일러플레이트를 복사하고 시나리오만 교체한다. 검증 시나리오(권한 차등이 필요하므로 backend는 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys`로 기동, 시드 유저는 `docs/db-seed.md`의 데모 조직 사용 — 맵 오너/에디터 계정은 시드 후 `/api/maps/{id}/permissions`로 실측 선택):

1. **오너 즉시 변경**: 오너 계정으로 Settings > Details → `settings-map-name` 입력 → `settings-map-name-save` 클릭 → 토스트 "Map renamed" 노출 → `getMap` 이름 변경 확인.
2. **에디터 요청**: 에디터 계정 전환 → 같은 맵 Settings → 새 이름 저장 → 토스트 "Rename request sent for approval" → `settings-rename-pending` 배지 노출(요청명 포함) → 이름 필드 disabled.
3. **에디터 취소·재요청**: `settings-rename-withdraw` 클릭 → 토스트 → 배지 소멸 → 재요청.
4. **오너 승인**: 오너 전환 → Inbox Approvals 탭 → "Map rename" 카드(before→after 요약) → Approve → 토스트 "Rename approved — new name applied" → 맵 이름 반영 확인.
5. **알림 수신**: 에디터 전환 → Inbox Notifications에 `rename_approved` 계열 메시지 존재.

각 단계는 `PASS/FAIL` 라인을 출력하고 실패 시 exit 1.

- [ ] **Step 2: 실기동 검증**

Run (저장소 루트 아님 — 워크트리 각 디렉터리):
```bash
cd backend && DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false .venv/bin/python -m scripts.reset_db
# backend 8909, frontend 3209 등 빈 포트로 기동 후
cd frontend && node scripts/pw-verify-map-rename.mjs
```
Expected: 전 단계 PASS. (좀비 next dev 주의 — 기동 전 포트 점유 확인, `docs/lessons/browser-verification.md`.)

- [ ] **Step 3: 전체 게이트 최종 확인**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd frontend && npx tsc --noEmit && npm run lint && npx vitest run && npm run build
```
Expected: 전부 그린.

- [ ] **Step 4: 커밋** (PROGRESS.md에 검증 결과 라인 포함)

```bash
git add frontend/scripts/pw-verify-map-rename.mjs PROGRESS.md
git commit -m "test(e2e): map rename workflow round-trip verification — 이름변경 워크플로 pw 왕복 검증"
```

---

## Self-Review Checklist (플랜 작성자 완료 항목)

- Spec 커버리지: §1 상태값(T1·T2), §2.1(T1), §2.2(T3), §2.3(T1), §2.4(T2), §3(T4), §4 알림 5종(T1 rename_requested·T2 map_renamed/rename_superseded·T3 rename_approved/rejected+map_renamed), §5.1(T5), §5.2(T6), §5.3(T5), §5.4 토스트(T5·T6), 테스트 절(T1~T4 pytest·T7 pw) — 전 항목 태스크 매핑 확인.
- 타입 일관성: `RenameRequestIn.to_name` ↔ 프론트 `{ to_name: toName }`, 알림 type 5종 문자열 ↔ 카테고리 분기 ↔ 테스트, `workflow.load_map_user_collaborators`/`notify_map_renamed` 시그니처 T1 정의·T2/T3 소비 일치.
- 실측 필요 지점(플랜에 명시): Notification 수신자 컬럼명, api.ts ApprovalRequest 타입의 payload 필드, InboxApprovalOut dict 키 세트, inbox.summary.* 마크다운 관례, pw 시드 계정.
