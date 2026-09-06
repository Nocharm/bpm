# Framework 슬롯 거버넌스 트랙 C — 승인 워크플로·FE 표면·스모크·QA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비관리자 owner의 슬롯 변경을 `ApprovalRequest(kind="fw_slot")` 요청으로 만들고, L5 직속 관리자(이동은 양측 각 1명)가 승인하면 트랙 B의 `apply_slot_change`가 적용되게 한다. 승인 큐·대기 패널·인박스·알림·배정 모달·삭제·복사 표면을 붙이고, 스모크와 QA 문서(기능·시나리오)로 마감하며 브라우저 검증을 직접 수행한다.

**Architecture:** 요청 생성·대기 조회·철회는 트랙 B의 `routers/slot_changes.py`에 추가하고, 결정은 기존 `routers/permissions.py decide_approval_request`에 `fw_slot` 분기(다측 승인은 payload `approvals`에 side별 기록, 전부 채워지면 `_apply_request` → `apply_slot_change(request_id=...)`)를 넣는다. FE는 공용 `SlotChangeDialog`(안내/요청 2모드) 하나를 배정 모달·삭제·복사 세 진입점이 공유한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest / Next.js + TypeScript + vitest / Playwright(playwright-core+시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md` §4(요청 모델)·§7.2~7.4(모달·삭제·복사·승인 표면)·§11(테스트·QA·브라우저 검증)·§13 트랙 C.

## Global Constraints

- 트랙 A+B 플랜(`2026-09-06-fw-slot-track-ab-core.md`) 완료 상태에서 시작 — `framework_slots.py`의 `SlotChange`·`SlotPlan`·`validate_slot_change`·`apply_slot_change`·`build_preview`·`can_self_apply`, `routers/slot_changes.py`, `SlotChangeIn/Out`, FE `postSlotChange`가 존재한다.
- 브랜치 `feat/fw-slot-handover`(워크트리 `.claude/worktrees/fw-slot-handover`). 게이트 명령은 트랙 A+B 플랜과 동일.
- 고정 문자열 — 요청 kind `fw_slot`(ApprovalRequest.kind String(30) 내). 알림 타입 `fw_slot_requested`·`fw_slot_applied`(트랙 B 기존)·`fw_slot_rejected`. HTTP detail: 409 `"a slot change is already pending"` · 403 `"direct L5 admin of a side or sysadmin only"` · 404 `"no pending slot change"` · 403 `"only the requester can withdraw"`.
- payload 계약(spec §4.1): `{action, map_name, from_category_id, to_category_id, to_map_id, to_map_name, note, sides: [category_id…], approvals: {"<category_id>": {"by", "at"}}}`.
- 알림 신규 타입은 FE 4지점 동시 갱신(`notification-format.ts KNOWN_TYPES`·아이콘·`notifLabel.*`/`notifBody.*` i18n·payload 구조화). 모달 z: 배정 모달이 `z-[1300]`이라 그 위에 뜨는 `SlotChangeDialog`는 `z-[1400]`.
- 컴포넌트 신설/사용처 변경 커밋마다 `node scripts/build-component-catalog.mjs` 재생성.
- 스모크·수동 검증은 `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false`로 backend를 띄운다 — 기본값(enforce=false)은 전원 sysadmin이라 승인 분기가 재현되지 않는다.

---

### Task 1: BE — `fw_slot` 요청 생성·대기 조회·철회 + `fw_slot_requested` 알림

**Files:**
- Modify: `backend/app/framework_slots.py` (payload 빌더·요청 알림·요청→계획 복원), `backend/app/routers/slot_changes.py` (409 → 요청 생성, GET/DELETE pending), `backend/app/schemas.py` (`PendingSlotChangeOut`)
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces:
  - `build_request_payload(plan: SlotPlan, note: str) -> dict`
  - `change_from_payload(map_id: int, payload: dict) -> SlotChange`
  - `async notify_slot_requested(session, plan, req, actor) -> None`
  - `async remaining_sides(session, req) -> list[int]` (approvals에 없는 side)
  - `GET /api/maps/{id}/slot-changes/pending -> PendingSlotChangeOut | None` = `{request: ApprovalRequestOut, sides: [SlotChangeSideOut], remaining: [int], can_decide: bool}`
  - `DELETE /api/maps/{id}/slot-changes/pending` 204
  - `POST /slot-changes`의 비관리자 응답 `mode="requested"`, `request_id`.

- [ ] **Step 1: 실패 테스트**

`test_framework_slots.py`에 추가(기존 `test_slot_changes_non_admin_owner_gets_409_until_track_c`는 삭제하고 아래로 대체):

```python
# ── 트랙 C: 요청 생성 · 대기 · 철회 ────────────────────────────────────────────

L5ADMIN = "fws.l5admin"
OWNER = "fws.owner2"


def _notif_types(user: str) -> list[str]:
    from app.models import Notification

    async def _go(session):
        rows = (await session.scalars(
            select(Notification).where(Notification.recipient == user).order_by(Notification.id)
        )).all()
        return [r.type for r in rows]

    return _run(_go)


def _seed_l5_with_admin(client: TestClient, code: str, name: str, admin: str = L5ADMIN) -> int:
    l5 = _seed_category(code, name, level=5)
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": admin}]})
    return l5


def test_non_admin_owner_creates_request_and_can_withdraw(client: TestClient, enforce: None) -> None:
    l5 = _seed_l5_with_admin(client, "FWS-Q5", "요청")
    act_as(OWNER)
    mid = _create_map(client, "fws request map")
    r = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5, "note": "please"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "requested" and body["request_id"] is not None and body["self_apply"] is False
    assert _map_row(mid)["category_id"] is None  # 요청만, 적용 아님
    # 중복 요청 409
    dup = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert dup.status_code == 409 and "pending" in dup.json()["detail"]
    # 대기 조회 — 요청자는 can_decide False, 직속 관리자는 True
    pending = client.get(f"/api/maps/{mid}/slot-changes/pending").json()
    assert pending["request"]["kind"] == "fw_slot" and pending["request"]["payload"]["note"] == "please"
    assert pending["remaining"] == [l5] and pending["can_decide"] is False
    act_as(L5ADMIN)
    # L5 관리자는 이 맵의 viewer도 아닐 수 있다 — pending 조회는 체인 관리자에게 열려야 한다
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json()["can_decide"] is True
    assert "fw_slot_requested" in _notif_types(L5ADMIN)
    # 철회는 요청자만
    assert client.delete(f"/api/maps/{mid}/slot-changes/pending").status_code == 403
    act_as(OWNER)
    assert client.delete(f"/api/maps/{mid}/slot-changes/pending").status_code == 204
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json() is None
```

`Notification.recipient` 컬럼명은 `app/models.py`의 `Notification` 클래스에서 실측(`user_id`일 수 있음)해 맞춘다.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_slots.py -q -p no:cacheprovider -k request`
Expected: FAIL (`assert 409 == 200`).

- [ ] **Step 3: 코어 — payload·알림·복원**

`framework_slots.py`에 추가(`build_preview` 아래):

```python
def build_request_payload(plan: SlotPlan, note: str) -> dict:
    """ApprovalRequest.payload — 승인 시 재검증에 필요한 최소 좌표 + 표시용 이름 (spec §4.1)."""
    change = plan.change
    return {
        "action": change.action,
        "map_name": plan.source.name,
        "from_category_id": plan.from_category_id,
        "to_category_id": change.to_category_id,
        "to_map_id": change.to_map_id,
        "to_map_name": plan.target.name if plan.target is not None else None,
        "note": note,
        "sides": list(plan.sides),
        "approvals": {},
    }


def change_from_payload(map_id: int, payload: dict) -> SlotChange:
    return SlotChange(
        action=str(payload.get("action")), map_id=map_id,
        to_category_id=payload.get("to_category_id"), to_map_id=payload.get("to_map_id"),
        note=str(payload.get("note") or ""),
    )


async def remaining_sides(session: AsyncSession, req: ApprovalRequest) -> list[int]:
    approvals = req.payload.get("approvals") or {}
    return [int(c) for c in req.payload.get("sides", []) if str(c) not in approvals]


async def notify_slot_requested(
    session: AsyncSession, plan: SlotPlan, req: ApprovalRequest, actor: str
) -> None:
    """side 직속 관리자 + sysadmin(대체 처리자)에게 fw_slot_requested — fw_confirm 요청 알림과 같은 수신 규칙."""
    recipients: list[str] = []
    for cid in plan.sides:
        recipients += await get_category_admin_logins(session, cid, direct_only=True)
    recipients += list(logic.list_sysadmin_logins())
    recipients = [r for r in dict.fromkeys(recipients) if r != actor]
    actor_name = await workflow.get_display_name(session, actor)
    await workflow.create_notifications(
        session,
        recipients,
        type="fw_slot_requested",
        map_id=plan.source.id,
        message=f"{actor_name} requested slot change '{plan.change.action}' on '{plan.source.name}'",
        payload={
            "map_name": plan.source.name, "actor": actor, "actor_name": actor_name,
            "action": plan.change.action, "note": plan.change.note,
            "from_path": await category_path(session, plan.from_category_id),
            "to_path": await category_path(session, plan.change.to_category_id),
            "to_map_name": plan.target.name if plan.target is not None else None,
            "request_id": req.id,
        },
    )
```

`from app.models import ApprovalRequest`를 import 목록에 추가. 트랙 B의 `_category_path`는 라우터·인박스가 밖에서 쓰게 되므로 이 태스크에서 `category_path`로 개명하고 `framework_slots.py` 안의 호출부(`_notify_applied`·`build_preview`)도 함께 바꾼다.

- [ ] **Step 4: 스키마 + 라우터**

`schemas.py` `SlotChangeOut` 뒤:

```python
class PendingSlotChangeOut(BaseModel):
    # 대기 중 슬롯 변경 요청 + side별 승인자 + 호출자 결정권 (spec 2026-09-06 §4.2)
    request: ApprovalRequestOut
    sides: list[SlotChangeSideOut]
    remaining: list[int]
    can_decide: bool
```

`routers/slot_changes.py` — `create_slot_change`의 `raise HTTPException(409, "slot changes require L5 admin approval")` 블록을 요청 생성으로 교체하고 GET/DELETE 추가:

```python
    if not plan.self_apply:
        pending_id = await session.scalar(
            select(ApprovalRequest.id).where(
                ApprovalRequest.map_id == map_id, ApprovalRequest.kind == "fw_slot",
                ApprovalRequest.status == "pending",
            )
        )
        if pending_id is not None:
            raise HTTPException(status_code=409, detail="a slot change is already pending")
        req = ApprovalRequest(
            map_id=map_id, kind="fw_slot", payload=build_request_payload(plan, change.note),
            requested_by=user, status="pending",
        )
        session.add(req)
        await session.flush()
        await notify_slot_requested(session, plan, req, user)
        await session.commit()
        return SlotChangeOut(mode="requested", request_id=req.id, **preview)
```

```python
async def _load_pending(session: AsyncSession, map_id: int) -> ApprovalRequest | None:
    return await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id, ApprovalRequest.kind == "fw_slot",
            ApprovalRequest.status == "pending",
        )
    )


@router.get("/{map_id}/slot-changes/pending", response_model=PendingSlotChangeOut | None)
async def get_pending_slot_change(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> PendingSlotChangeOut | None:
    """대기 요청 — owner·지정 승인자·side 체인 관리자·sysadmin. 배정 모달 배너·승인 탭 소스."""
    found = await session.get(ProcessMap, map_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    req = await _load_pending(session, map_id)
    if req is None:
        return None
    sides = [int(c) for c in req.payload.get("sides", [])]
    role = await get_effective_role(session, user, map_id)
    is_side_admin = False
    for cid in sides:
        if await is_category_admin(session, user, cid):
            is_side_admin = True
            break
    if role is None and not is_side_admin and not logic.is_sysadmin(user):
        raise HTTPException(status_code=403, detail="viewer, side admin or sysadmin only")
    remaining = await remaining_sides(session, req)
    can_decide = logic.is_sysadmin(user)
    side_out = []
    for cid in sides:
        direct = await is_direct_l5_admin(session, user, cid)
        if cid in remaining and direct:
            can_decide = True
        side_out.append({
            "category_id": cid, "path": await _category_path(session, cid),
            "approvers": await get_category_admin_logins(session, cid, direct_only=True),
            "satisfied_by_caller": direct or logic.is_sysadmin(user),
        })
    return PendingSlotChangeOut(
        request=ApprovalRequestOut.model_validate(req), sides=side_out, remaining=remaining,
        can_decide=can_decide,
    )


@router.delete("/{map_id}/slot-changes/pending", status_code=204)
async def withdraw_slot_change(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> None:
    """본인 pending 요청 철회 → withdrawn(행 보존). 알림 없음 (fw_confirm 철회와 동일)."""
    req = await _load_pending(session, map_id)
    if req is None:
        raise HTTPException(status_code=404, detail="no pending slot change")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()
```

import 추가: `from sqlalchemy import select`, `from app.models import ApprovalRequest, ProcessMap`, `from app.permissions import logic`, `from app.permissions.access import assert_map_role, get_effective_role, is_category_admin, is_direct_l5_admin`, `from app.schemas import ApprovalRequestOut, PendingSlotChangeOut, SlotChangeIn, SlotChangeOut`, `from app.framework_slots import (SlotChange, apply_slot_change, build_preview, build_request_payload, category_path, notify_slot_requested, remaining_sides, validate_slot_change)`.

- [ ] **Step 5: 통과 확인**

Run: `... pytest tests/test_framework_slots.py -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 모두 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/app/framework_slots.py backend/app/routers/slot_changes.py backend/app/schemas.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): create fw_slot approval requests with pending lookup, withdrawal and admin notifications — 슬롯 변경 승인 요청 생성·대기 조회·철회·알림"
```

---

### Task 2: BE — 다측 승인 decide·`_apply_request`·거절 알림·인박스·`can_decide_slot`

**Files:**
- Modify: `backend/app/routers/permissions.py:587-668` (decide), `:669-733` (`_apply_request`), `:754-816` (`_notify_permission_decision`), `backend/app/framework_slots.py` (`record_slot_approvals`), `backend/app/routers/inbox.py:105-150`, `backend/app/routers/maps.py:743-770` (`get_map`), `backend/app/schemas.py:767` (`MapDetailOut`)
- Test: `backend/tests/test_framework_slots.py`

**Interfaces:**
- Produces: `async record_slot_approvals(session, req, user) -> list[int]`(남은 side), `MapDetailOut.can_decide_slot: bool`, 인박스 항목 `kind="approval_request", title="fw_slot"`.

- [ ] **Step 1: 실패 테스트**

```python
# ── 트랙 C: 결정(다측)·적용·인박스 ────────────────────────────────────────────

L5ADMIN_B = "fws.l5admin.b"
BOTH_ADMIN = "fws.both.admin"


def _decide(client: TestClient, request_id: int, decision: str, reason: str | None = None):
    body = {"decision": decision}
    if reason:
        body["reason"] = reason
    return client.post(f"/api/approval-requests/{request_id}/decide", json=body)


def test_move_needs_both_sides_and_same_person_satisfies_both(client: TestClient, enforce: None) -> None:
    l5a = _seed_l5_with_admin(client, "FWS-M5A", "이동A", admin=L5ADMIN)
    l5b = _seed_l5_with_admin(client, "FWS-M5B", "이동B", admin=L5ADMIN_B)
    act_as(SYSADMIN)
    for cid in (l5a, l5b):
        client.put(f"/api/categories/{cid}/permissions", json={"permissions": [
            {"principal_type": "user", "principal_id": L5ADMIN if cid == l5a else L5ADMIN_B},
            {"principal_type": "user", "principal_id": BOTH_ADMIN},
        ]})
    act_as(OWNER)
    mid = _create_map(client, "fws move map")
    # 셋업: sysadmin이 슬롯을 먼저 준다(즉시 적용)
    act_as(SYSADMIN)
    assert client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5a}).json()["mode"] == "applied"
    # 비관리자 owner의 이동 요청 → 양측 side
    act_as(OWNER)
    req_id = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "move", "to_category_id": l5b}).json()["request_id"]
    # 무관한 사용자 403, A측 관리자 승인 → 아직 pending(B 남음)
    act_as("fws.nobody")
    assert _decide(client, req_id, "approve").status_code == 403
    act_as(L5ADMIN)
    r = _decide(client, req_id, "approve")
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json()["remaining"] == [l5b]
    assert _map_row(mid)["category_id"] == l5a
    # B측 승인 → applied + 이동 반영
    act_as(L5ADMIN_B)
    r2 = _decide(client, req_id, "approve")
    assert r2.status_code == 200 and r2.json()["status"] == "applied"
    assert _map_row(mid)["category_id"] == l5b
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json() is None
    # 양쪽 관리자 한 사람이면 한 번에 적용
    act_as(OWNER)
    req2 = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "move", "to_category_id": l5a}).json()["request_id"]
    act_as(BOTH_ADMIN)
    assert _decide(client, req2, "approve").json()["status"] == "applied"
    assert _map_row(mid)["category_id"] == l5a
    # 양쪽 관리자라도 맵 owner가 아니면 변경을 시작할 수는 없다(승인만) — 경로 의존성 403
    act_as(BOTH_ADMIN)
    assert client.post(f"/api/maps/{mid}/slot-changes", json={"action": "unassign"}).status_code == 403


def test_reject_and_stale_apply_keep_state(client: TestClient, enforce: None) -> None:
    l5 = _seed_l5_with_admin(client, "FWS-J5", "거절", admin=L5ADMIN)
    act_as(OWNER)
    src = _create_map(client, "fws reject src")
    tgt = _create_map(client, "fws reject tgt")
    act_as(SYSADMIN)
    client.post(f"/api/maps/{src}/slot-changes", json={"action": "assign", "to_category_id": l5})
    act_as(OWNER)
    req_id = client.post(f"/api/maps/{src}/slot-changes", json={"action": "replace", "to_map_id": tgt}).json()["request_id"]
    act_as(L5ADMIN)
    r = _decide(client, req_id, "reject", reason="not now")
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    assert _map_row(src)["category_id"] == l5 and _map_row(tgt)["category_id"] is None
    assert "fw_slot_rejected" in _notif_types(OWNER)
    # 재요청 후 승인 사이에 target이 다른 슬롯을 얻으면 적용은 409로 멈추고 pending 유지
    act_as(OWNER)
    req2 = client.post(f"/api/maps/{src}/slot-changes", json={"action": "replace", "to_map_id": tgt}).json()["request_id"]
    other = _seed_l5_with_admin(client, "FWS-J5X", "거절X", admin=L5ADMIN)
    act_as(SYSADMIN)
    client.post(f"/api/maps/{tgt}/slot-changes", json={"action": "assign", "to_category_id": other})
    act_as(L5ADMIN)
    r3 = _decide(client, req2, "approve")
    assert r3.status_code == 409
    assert client.get(f"/api/maps/{src}/slot-changes/pending").json()["request"]["status"] == "pending"


def test_inbox_and_detail_expose_slot_decision_rights(client: TestClient, enforce: None) -> None:
    l5 = _seed_l5_with_admin(client, "FWS-I5", "인박스", admin=L5ADMIN)
    act_as(OWNER)
    mid = _create_map(client, "fws inbox map")
    req_id = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5}).json()["request_id"]
    act_as(L5ADMIN)
    inbox = client.get("/api/inbox").json()
    mine = [it for it in inbox["approvals"] if it["kind"] == "approval_request" and it["id"] == req_id]
    assert len(mine) == 1 and mine[0]["title"] == "fw_slot" and mine[0]["after"] is not None
    act_as("fws.nobody")
    assert not [it for it in client.get("/api/inbox").json()["approvals"] if it.get("id") == req_id]
    act_as(SYSADMIN)
    assert any(r["id"] == req_id for r in client.get("/api/approval-requests").json())
    _decide(client, req_id, "approve")
    detail = client.get(f"/api/maps/{mid}").json()
    assert detail["can_decide_slot"] is True  # sysadmin
    act_as(L5ADMIN)
    assert client.get(f"/api/maps/{mid}").json()["can_decide_slot"] is True
    act_as(OWNER)
    assert client.get(f"/api/maps/{mid}").json()["can_decide_slot"] is False
```

요청자 본인이 관리자인 self_apply 경로는 트랙 B의 `test_slot_changes_preview_and_apply`가 커버한다. `/api/inbox` 응답 키(`approvals`)는 `routers/inbox.py` 응답 스키마에서 실측.

- [ ] **Step 2: 실패 확인**

Run: `... -k "move_needs or reject_and or inbox_and"` → 403/`KeyError` 등으로 FAIL.

- [ ] **Step 3: 코어 — 승인 기록**

`framework_slots.py`:

```python
async def record_slot_approvals(session: AsyncSession, req: ApprovalRequest, user: str) -> list[int]:
    """호출자가 관리자인 side 전부를 approvals에 기록 — JSON 컬럼은 재할당해야 변경이 감지된다. 남은 side 반환."""
    sides = [int(c) for c in req.payload.get("sides", [])]
    approvals = dict(req.payload.get("approvals") or {})
    for cid in sides:
        if str(cid) in approvals:
            continue
        if logic.is_sysadmin(user) or await is_direct_l5_admin(session, user, cid):
            approvals[str(cid)] = {"by": user, "at": now_kst().isoformat()}
    req.payload = {**req.payload, "approvals": approvals}
    return [c for c in sides if str(c) not in approvals]
```

- [ ] **Step 4: decide·apply·알림 분기 (`permissions.py`)**

`decide_approval_request`의 kind 게이트 체인에 `elif req.kind == "fw_slot":` 추가(fw_confirm 분기 뒤):

```python
    elif req.kind == "fw_slot":
        # 슬롯 변경 결정권 = 남은 side 중 하나의 직속 L5 관리자 또는 sysadmin (spec 2026-09-06 §4.2)
        if not logic.is_sysadmin(user):
            remaining = await remaining_sides(session, req)
            allowed = False
            for cid in remaining:
                if await is_direct_l5_admin(session, user, cid):
                    allowed = True
                    break
            if not allowed:
                raise HTTPException(status_code=403, detail="direct L5 admin of a side or sysadmin only")
```

`# approve → payload 적용` 직전(reject 처리 뒤)에 다측 기록:

```python
    if req.kind == "fw_slot":
        left = await record_slot_approvals(session, req, user)
        if left:
            # 아직 다른 side의 승인이 남았다 — pending 유지, decided_by는 마지막 결정자 기록
            await session.commit()
            await session.refresh(req)
            return req
```

`_apply_request`에 분기:

```python
    elif req.kind == "fw_slot":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None or found_map.deleted_at is not None:
            return  # 멱등 — 삭제된 맵이면 적용 없이 applied
        # 승인~적용 사이 전제가 깨졌으면(target이 슬롯을 얻음 등) 409 전파 → decide 커밋 전이라 pending 유지
        plan = await validate_slot_change(
            session, change_from_payload(req.map_id, req.payload), req.requested_by
        )
        await apply_slot_change(session, plan, req.decided_by or req.requested_by, request_id=req.id)
```

`_notify_permission_decision`에 fw_slot 분기(fw_confirm 분기 앞):

```python
    if req.kind == "fw_slot":
        if outcome == "approved":
            return  # 적용 알림(fw_slot_applied)은 apply_slot_change가 owner·관리자에게 이미 보냈다
        map_name = req.payload.get("map_name", "")
        actor_name = (
            await workflow.get_display_name(session, req.decided_by) if req.decided_by else ""
        )
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type="fw_slot_rejected",
            map_id=req.map_id,
            message=f"Your slot change request on '{map_name}' was rejected{suffix}",
            payload={"map_name": map_name, "actor": req.decided_by, "actor_name": actor_name,
                     "action": req.payload.get("action"), "outcome": outcome, "reason": reason},
        )
        return
```

import: `from app.framework_slots import apply_slot_change, change_from_payload, record_slot_approvals, remaining_sides, validate_slot_change`, `from app.permissions.access import is_direct_l5_admin`(이미 있으면 생략).

- [ ] **Step 5: 인박스 (`inbox.py`)**

블록 3의 필터 `ApprovalRequest.kind.not_in(["map_rename", "sp_designation"])`에 `"fw_slot"` 추가. 블록 5 뒤에 블록 6:

```python
    # 6) 슬롯 변경 요청 — 남은 side의 직속 L5 관리자, 또는 sysadmin (spec 2026-09-06 §4.2)
    fs_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            ApprovalRequest.kind == "fw_slot",
            ProcessMap.deleted_at.is_(None),
        )
    )
    for req, pm in (await session.execute(fs_q)).all():
        remaining = await remaining_sides(session, req)
        if not sysadmin:
            allowed = False
            for cid in remaining:
                if await is_direct_l5_admin(session, user, cid):
                    allowed = True
                    break
            if not allowed:
                continue
        deciders: list[str] = []
        for cid in remaining:
            deciders += await get_category_admin_logins(session, cid, direct_only=True)
        deciders = list(dict.fromkeys(deciders))
        payload = req.payload
        after = payload.get("to_map_name") or await category_path(session, payload.get("to_category_id"))
        items.append(
            {
                "kind": "approval_request",
                "id": req.id,
                "title": req.kind,
                "map_id": pm.id,
                "map_name": pm.name,
                "requester": req.requested_by,
                "status": req.status,
                "created_at": req.created_at,
                "version_id": None,
                "detail": payload,
                "updated_at": pm.updated_at,
                "version_label": None,
                "version_number": None,
                "holder": None,
                "before": await category_path(session, payload.get("from_category_id")),
                "after": after,
                "principal": None,
                "deciders": deciders,
                "pending_on": deciders,
                "approved_by": [a["by"] for a in (payload.get("approvals") or {}).values()],
            }
        )
```

블록 3 dict의 키 집합과 정확히 같게 맞춘다(실측). import: `from app.framework_slots import category_path, remaining_sides`, `from app.permissions.access import get_category_admin_logins, is_direct_l5_admin`.

- [ ] **Step 6: `can_decide_slot`**

`schemas.py` `MapDetailOut` `can_confirm: bool = False` 다음에 `can_decide_slot: bool = False  # 슬롯 변경 요청 결정권(직속 L5 관리자/sysadmin) — 승인 탭 fw_slot 행 게이트`.
`maps.py get_map` — `found_map.category_path = ...` 설정(751) 직후:

```python
        found_map.can_decide_slot = logic.is_sysadmin(user) or await is_direct_l5_admin(
            session, user, found_map.category_id
        )
```

- [ ] **Step 7: 통과 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/`
Expected: 전체 passed(`test_inbox.py`·`test_permission_endpoints.py` 회귀 포함).

- [ ] **Step 8: Commit**

```bash
git add backend/app/framework_slots.py backend/app/routers/permissions.py backend/app/routers/inbox.py backend/app/routers/maps.py backend/app/schemas.py backend/tests/test_framework_slots.py
git commit -m "feat(framework): decide fw_slot requests per L5 side, apply on completion, surface in inbox — 슬롯 요청 다측 승인·적용·인박스 노출"
```

---

### Task 3: FE — api·승인 큐·대기 패널·인박스·알림 포맷·i18n

**Files:**
- Modify: `frontend/src/lib/api.ts` (`postSlotChange` 뒤, `MapDetail`), `frontend/src/components/admin/approval-queue.tsx:53-57, 240-300, 430-450`, `frontend/src/components/permissions/pending-approvals-panel.tsx:17-60, 140-200`, `frontend/src/app/maps/[mapId]/page.tsx:11598-11606`, `frontend/src/app/inbox/page.tsx:85-125`, `frontend/src/lib/notification-format.ts:37-60, 70-80`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Produces: `PendingSlotChange`, `getPendingSlotChange(mapId)`, `withdrawSlotChange(mapId)`, `MapDetail.can_decide_slot?: boolean`, `slotActionLabel(action, t)` (`lib/framework-slot-state.ts`에 추가, MessageKey `slot.action.*`).

- [ ] **Step 1: api.ts**

```ts
export interface PendingSlotChange {
  request: ApprovalRequest;
  sides: SlotChangeSide[];
  remaining: number[];
  can_decide: boolean;
}
export function getPendingSlotChange(mapId: number): Promise<PendingSlotChange | null> {
  return request<PendingSlotChange | null>(`/maps/${mapId}/slot-changes/pending`);
}
export function withdrawSlotChange(mapId: number): Promise<void> {
  return request<void>(`/maps/${mapId}/slot-changes/pending`, { method: "DELETE" });
}
```

`MapDetail`(119)에 `can_decide_slot?: boolean;` 추가.

- [ ] **Step 2: 라벨 헬퍼 + i18n**

`lib/framework-slot-state.ts` 끝에:

```ts
import type { MessageKey } from "./i18n-messages";
import type { SlotChangeAction } from "./api";

export const SLOT_ACTION_KEY: Record<SlotChangeAction, MessageKey> = {
  assign: "slot.action.assign",
  unassign: "slot.action.unassign",
  move: "slot.action.move",
  replace: "slot.action.replace",
  delete: "slot.action.delete",
};

export function isSlotAction(value: unknown): value is SlotChangeAction {
  return typeof value === "string" && value in SLOT_ACTION_KEY;
}
```

i18n en(`home.frameworkTransferPickMode` 뒤) / ko 대칭:

```ts
  "slot.action.assign": "Add to the framework",
  "slot.action.unassign": "Remove from the framework",
  "slot.action.move": "Move to another level-5",
  "slot.action.replace": "Hand the slot to another map",
  "slot.action.delete": "Delete a slotted map",
  "slot.selfApplyDesc": "You administer the level-5 category involved, so this lands now without a request.",
  "slot.requestDesc": "Level-5 admins must approve this change. Leave them a note.",
  "slot.sideApprovers": "Approvers",
  "slot.noApprovers": "no admin yet - a sysadmin will decide",
  "slot.notePlaceholder": "Why this change? (optional)",
  "slot.applyNow": "Apply now",
  "slot.request": "Request approval",
  "slot.requestedToast": "Approval requested - level-5 admins were notified.",
  "slot.appliedToast": "Slot change applied.",
  "slot.pendingBanner": "{action} is waiting for approval ({done}/{total} sides) - requested by {who}",
  "slot.withdraw": "Withdraw request",
  "slot.progress": "{done}/{total} sides approved",
  "slot.successor": "Successor map",
  "slot.successorNone": "No successor - leave a missing placeholder",
  "slot.retireMode.unassign": "Free the slot (original leaves the framework)",
  "slot.retireMode.replace": "Copy inherits the slot",
  "perm.sysadmin.kindFwSlot": "Slot change",
  "approval.kindFwSlot": "Slot change",
  "inbox.reqKind.fw_slot": "Framework slot change",
  "inbox.summary.fw_slot": "{action}: {before} → {after}",
  "notifLabel.fw_slot_requested": "Slot change request",
  "notifLabel.fw_slot_applied": "Slot change applied",
  "notifLabel.fw_slot_rejected": "Slot change rejected",
  "notifBody.fw_slot_requested": "{actor} requested a slot change on this map",
  "notifBody.fw_slot_applied": "{actor} applied a slot change on this map",
  "notifBody.fw_slot_rejected": "Your slot change request was rejected",
```

```ts
  "slot.action.assign": "업무 체계에 추가",
  "slot.action.unassign": "업무 체계에서 해제",
  "slot.action.move": "다른 L5로 이동",
  "slot.action.replace": "슬롯을 다른 맵에 이양",
  "slot.action.delete": "슬롯 맵 삭제",
  "slot.selfApplyDesc": "해당 L5 카테고리의 관리자라 요청 없이 지금 반영됩니다.",
  "slot.requestDesc": "L5 관리자의 승인이 필요합니다. 승인자에게 남길 메모를 적어 주세요.",
  "slot.sideApprovers": "승인자",
  "slot.noApprovers": "관리자 없음 - sysadmin이 결정",
  "slot.notePlaceholder": "변경 사유 (선택)",
  "slot.applyNow": "바로 적용",
  "slot.request": "승인 요청",
  "slot.requestedToast": "승인을 요청했습니다 - L5 관리자에게 알림을 보냈습니다.",
  "slot.appliedToast": "슬롯 변경을 적용했습니다.",
  "slot.pendingBanner": "{action} 승인 대기 중 ({done}/{total} 측) - 요청자 {who}",
  "slot.withdraw": "요청 철회",
  "slot.progress": "{done}/{total} 측 승인",
  "slot.successor": "후계 맵",
  "slot.successorNone": "후계자 없음 - 미싱 플레이스홀더로 남김",
  "slot.retireMode.unassign": "슬롯 해제 (원본은 체계 밖으로)",
  "slot.retireMode.replace": "복사본이 슬롯 승계",
  "perm.sysadmin.kindFwSlot": "슬롯 변경",
  "approval.kindFwSlot": "슬롯 변경",
  "inbox.reqKind.fw_slot": "업무 체계 슬롯 변경",
  "inbox.summary.fw_slot": "{action}: {before} → {after}",
  "notifLabel.fw_slot_requested": "슬롯 변경 요청",
  "notifLabel.fw_slot_applied": "슬롯 변경 적용",
  "notifLabel.fw_slot_rejected": "슬롯 변경 거절",
  "notifBody.fw_slot_requested": "{actor}님이 이 맵의 슬롯 변경을 요청했습니다",
  "notifBody.fw_slot_applied": "{actor}님이 이 맵의 슬롯 변경을 적용했습니다",
  "notifBody.fw_slot_rejected": "슬롯 변경 요청이 거절되었습니다",
```

- [ ] **Step 3: 승인 큐 (`approval-queue.tsx`)**

`type QueueRequestKind = "permission_downgrade" | "visibility_change" | "fw_confirm" | "fw_slot";` + `QUEUE_REQUEST_KINDS`에 `"fw_slot"`. `kindIcon`: `if (item.kind === "fw_slot") return <ArrowLeftRight size={14} strokeWidth={1.5} className="shrink-0 text-accent" />;`(lucide import 확인). `kindPill`: `if (item.kind === "fw_slot") return <Pill className="border-accent text-accent">{t("perm.sysadmin.kindFwSlot")}</Pill>;`. `brief`:

```tsx
    if (item.kind === "fw_slot") {
      const p = item.req.payload;
      const action = isSlotAction(p.action) ? t(SLOT_ACTION_KEY[p.action]) : String(p.action ?? "");
      const sides = Array.isArray(p.sides) ? p.sides.length : 0;
      const done = p.approvals && typeof p.approvals === "object" ? Object.keys(p.approvals).length : 0;
      const target = typeof p.to_map_name === "string" ? p.to_map_name : "";
      return (
        <>
          <Pill>
            <MapIcon size={11} strokeWidth={1.5} />
            {String(p.map_name ?? item.req.map_id)}
          </Pill>
          <span className="truncate text-caption text-ink-secondary">
            {action}{target ? ` → ${target}` : ""}
          </span>
          {sides > 1 && (
            <Pill className="border-hairline text-ink-tertiary">{t("slot.progress", { done: String(done), total: String(sides) })}</Pill>
          )}
        </>
      );
    }
```

승인 버튼 라벨은 기존(`perm.sysadmin.approve`) 그대로. `decideItem` 후 목록 재조회는 기존 로직이 처리한다(다측이면 항목이 pending으로 남는다).

- [ ] **Step 4: 대기 패널 + page.tsx**

`pending-approvals-panel.tsx`: `APPROVAL_KINDS`에 `"fw_slot"`; Props에 `/** fw_slot 행 결정권 — 직속 L5 관리자 또는 sysadmin(`MapDetail.can_decide_slot`). */ canDecideSlot: boolean;`; `canDecideKind`: `if (kind === "fw_slot") return canDecideSlot;`; `renderDetail`:

```ts
    if (req.kind === "fw_slot") {
      const p = req.payload;
      const action = isSlotAction(p.action) ? t(SLOT_ACTION_KEY[p.action]) : String(p.action ?? "");
      const target = typeof p.to_map_name === "string" && p.to_map_name ? ` → ${p.to_map_name}` : "";
      return `${action}${target}${p.note ? ` · ${String(p.note)}` : ""}`;
    }
```

kindLabel 체인에 `: req.kind === "fw_slot" ? t("approval.kindFwSlot")` 추가.
`page.tsx:11598`의 `<PendingApprovalsPanel ...>`에 `canDecideSlot={canDecideSlot}` — `canConfirmFw`가 파생되는 곳(`git grep -n canConfirmFw`)을 찾아 같은 방식으로 `const canDecideSlot = isSysadmin || Boolean(mapDetail?.can_decide_slot);`(변수명은 실측한 MapDetail state 이름으로).

- [ ] **Step 5: 인박스 + 알림 포맷**

`inbox/page.tsx` `approvalTitle`에 `if (a.title === "fw_slot") return t("inbox.reqKind.fw_slot");`. `approvalSummary`에 (visibility 기본 return 앞):

```ts
  if (a.kind === "approval_request" && a.title === "fw_slot") {
    const raw = a.detail?.action;
    const action = isSlotAction(raw) ? t(SLOT_ACTION_KEY[raw]) : String(raw ?? "");
    return t("inbox.summary.fw_slot", { action, before: a.before ?? "-", after: a.after ?? "-" });
  }
```

`notification-format.ts`: `KNOWN_TYPES`에 `"fw_slot_requested", "fw_slot_applied", "fw_slot_rejected",`; 사유 접미 집합(`REASON_SUFFIX_TYPES`)에 `"fw_slot_rejected"`; 아이콘 함수에 `if (type.startsWith("fw_slot")) return ArrowLeftRight;`(fw_confirm 줄 앞).

- [ ] **Step 6: 게이트 + Commit**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`

```bash
git add frontend/src/lib/api.ts frontend/src/lib/framework-slot-state.ts frontend/src/lib/i18n-messages.ts frontend/src/components/admin/approval-queue.tsx frontend/src/components/permissions/pending-approvals-panel.tsx 'frontend/src/app/maps/[mapId]/page.tsx' frontend/src/app/inbox/page.tsx frontend/src/lib/notification-format.ts
git commit -m "feat(frontend): render fw_slot requests in the approval queue, per-map panel, inbox and bell — 슬롯 요청 승인 표면·알림 포맷·i18n"
```

---

### Task 4: FE — 공용 `SlotChangeDialog`(안내/요청) + 배정 모달 요청 모드·대기 배너·철회

**Files:**
- Create: `frontend/src/components/maps/slot-change-dialog.tsx`
- Modify: `frontend/src/components/maps/framework-assign-modal.tsx`

**Interfaces:**
- Produces: `<SlotChangeDialog mapId body preview onDone(result: SlotChangeOut) onClose />` — `data-id="slot-change-dialog"`, 확정 버튼 `data-id="slot-change-submit"`, 메모 `data-id="slot-change-note"`. Task 5의 삭제·복사가 재사용.

- [ ] **Step 1: 컴포넌트**

```tsx
"use client";
// 슬롯 변경 확인 — dry_run 결과로 두 모드: 관리자 즉시 적용 안내 / L5 승인 요청(승인자 목록+메모) (spec 2026-09-06 §4.1·§7.2)
import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ShieldCheck, X } from "lucide-react";

import { getApiErrorDetail, postSlotChange, type SlotChangeIn, type SlotChangeOut } from "@/lib/api";
import { SLOT_ACTION_KEY } from "@/lib/framework-slot-state";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { UserPill } from "@/components/user-pill";
import { useI18n } from "@/lib/i18n";

interface Props {
  mapId: number;
  body: SlotChangeIn;
  preview: SlotChangeOut;
  onDone: (result: SlotChangeOut) => void;
  onClose: () => void;
}

export function SlotChangeDialog({ mapId, body, preview, onDone, onClose }: Props) {
  const { t } = useI18n();
  const [note, setNote] = useState(body.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selfApply = preview.self_apply;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await postSlotChange(mapId, { ...body, note, dry_run: false }));
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <ModalBackdrop
      onClose={onClose}
      className="fixed inset-0 z-[1400] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
    >
      <div
        data-id="slot-change-dialog"
        className="flex w-full max-w-md flex-col gap-4 rounded-md bg-surface p-6 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-tint text-accent">
              {selfApply ? <ShieldCheck size={18} strokeWidth={1.5} /> : <ArrowLeftRight size={18} strokeWidth={1.5} />}
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t(SLOT_ACTION_KEY[body.action])}</h2>
              <p className="text-fine text-ink-tertiary">{selfApply ? t("slot.selfApplyDesc") : t("slot.requestDesc")}</p>
            </div>
          </div>
          <button type="button" aria-label={t("summary.close")} className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <ul className="flex flex-col gap-1 rounded-sm bg-surface-alt px-3 py-2 text-fine text-ink-secondary">
          <li>{t("home.frameworkImpactSummary", {
            home: String(preview.impact.home_canvas_nodes),
            other: String(preview.impact.other_canvas_nodes),
            refs: String(preview.impact.referencing_maps),
          })}</li>
          {preview.sides.map((side) => (
            <li key={side.category_id} className="flex flex-wrap items-center gap-1">
              <span className="truncate">{side.path ?? side.category_id}</span>
              <span className="text-ink-tertiary">· {t("slot.sideApprovers")}:</span>
              {side.approvers.length === 0 ? (
                <span className="text-ink-tertiary">{t("slot.noApprovers")}</span>
              ) : (
                side.approvers.map((login) => <UserPill key={login} userId={login} />)
              )}
            </li>
          ))}
        </ul>

        {!selfApply && (
          <textarea
            data-id="slot-change-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("slot.notePlaceholder")}
            rows={2}
            className="w-full resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-caption text-ink"
          />
        )}

        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-40" onClick={onClose}>
            {t("summary.cancel")}
          </button>
          <button
            type="button"
            data-id="slot-change-submit"
            disabled={busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
            onClick={() => void submit()}
          >
            {selfApply ? t("slot.applyNow") : t("slot.request")}
          </button>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
```

(`UserPill` props는 `components/user-pill.tsx`에서 실측 — `userId`가 아니면 맞춘다.)

- [ ] **Step 2: 배정 모달 재배선**

`framework-assign-modal.tsx`:
- 트랙 B의 `ConfirmDialog` 안내 모달을 `SlotChangeDialog`로 교체: `pending !== null && <SlotChangeDialog mapId={mapId} body={pending.body} preview={pending.preview} onDone={(out) => { setPending(null); onChanged(); onClose(); onToast?.(out.mode === "requested" ? t("slot.requestedToast") : t("slot.appliedToast")); }} onClose={() => setPending(null)} />`. `onToast?: (message: string) => void` prop 추가(상세 카드가 `showToast`를 넘김 — 없으면 무시).
- `planChange`에서 `!preview.self_apply`일 때 에러 대신 `setPending({ body, preview })`(요청 모드).
- 대기 배너: 상태 `const [pendingReq, setPendingReq] = useState<PendingSlotChange | null | undefined>(undefined);` 마운트 시 `getPendingSlotChange(mapId)` → 세팅. 배너 JSX(트리 위):

```tsx
        {pendingReq && (
          <div data-id="slot-pending-banner" className="flex items-start gap-2 rounded-sm border border-changed/40 bg-changed/10 px-3 py-2 text-fine">
            <Clock size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-changed" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-semibold text-changed">
                {t("slot.pendingBanner", {
                  action: isSlotAction(pendingReq.request.payload.action) ? t(SLOT_ACTION_KEY[pendingReq.request.payload.action]) : "",
                  done: String(pendingReq.sides.length - pendingReq.remaining.length),
                  total: String(pendingReq.sides.length),
                  who: pendingReq.request.requested_by,
                })}
              </span>
              {pendingReq.request.requested_by === currentUser && (
                <button type="button" data-id="slot-withdraw-btn" className="self-start text-caption text-accent hover:underline"
                  onClick={() => void withdrawSlotChange(mapId).then(() => setPendingReq(null)).catch((err) => setError(getApiErrorDetail(err)))}>
                  {t("slot.withdraw")}
                </button>
              )}
            </div>
          </div>
        )}
```

`currentUser`는 prop으로 받는다(`currentUser: string | null` — 상세 카드가 `getMe` 결과의 login을 넘김; 없으면 철회 버튼 숨김). 대기 중이면 연결·해제·대체 버튼 `disabled`.

- [ ] **Step 3: 게이트 + 카탈로그 + Commit**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`

```bash
git add frontend/src/components/maps/slot-change-dialog.tsx frontend/src/components/maps/framework-assign-modal.tsx frontend/src/components/maps/map-detail-card.tsx frontend/COMPONENTS.md
git commit -m "feat(frontend): shared slot-change dialog with request mode, pending banner and withdrawal in the assign modal — 슬롯 변경 다이얼로그(요청 모드)·대기 배너·철회"
```

---

### Task 5: FE — 슬롯 맵 삭제 요청 다이얼로그·복사+은퇴 승계 선택

**Files:**
- Create: `frontend/src/components/maps/slot-delete-dialog.tsx`
- Modify: `frontend/src/components/maps/map-detail-card.tsx:165-190, 1520-1545`, `frontend/src/app/page.tsx:395-410, 575, 1000`, `frontend/src/components/permissions/create-map-dialog.tsx:191, 367, 430-445`, 그 `copy` prop 타입과 `app/page.tsx`의 `<CreateMapDialog copy={...}>` 호출부

**Interfaces:**
- Produces: `<SlotDeleteDialog mapId mapName onDone(result) onClose />`(후계자 선택 → dry_run → `SlotChangeDialog`), `MapDetailCard.onSlotChangeApplied?: () => void`, `CreateMapDialog.copy.categoryId?: number | null`.

- [ ] **Step 1: 삭제 다이얼로그**

```tsx
"use client";
// 슬롯 있는 L6 삭제 — 후계자(선택) 고른 뒤 slot-changes{delete} dry_run → SlotChangeDialog (spec 2026-09-06 §7.3)
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2, X } from "lucide-react";

import { getApiErrorDetail, listMaps, postSlotChange, type MapSummary, type SlotChangeIn, type SlotChangeOut } from "@/lib/api";
import { ModalBackdrop } from "@/components/modal-backdrop";
import { SearchSelect } from "@/components/search-select";
import { SlotChangeDialog } from "@/components/maps/slot-change-dialog";
import { useI18n } from "@/lib/i18n";

interface Props {
  mapId: number;
  mapName: string;
  onDone: (result: SlotChangeOut) => void;
  onClose: () => void;
}

export function SlotDeleteDialog({ mapId, mapName, onDone, onClose }: Props) {
  const { t } = useI18n();
  const [maps, setMaps] = useState<MapSummary[] | null>(null);
  const [successor, setSuccessor] = useState("");
  const [pending, setPending] = useState<{ body: SlotChangeIn; preview: SlotChangeOut } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listMaps().then((rows) => { if (active) setMaps(rows); }).catch((err: unknown) => setError(getApiErrorDetail(err)));
    return () => { active = false; };
  }, []);

  const options = (maps ?? [])
    .filter((m) => m.id !== mapId && (m.mode ?? "normal") === "normal" && m.category_id == null && m.consultant_code == null)
    .map((m) => ({ value: String(m.id), label: m.name }));

  async function next() {
    setBusy(true);
    setError(null);
    const body: SlotChangeIn = { action: "delete", to_map_id: successor ? Number(successor) : null };
    try {
      setPending({ body, preview: await postSlotChange(mapId, { ...body, dry_run: true }) });
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }

  if (pending !== null) {
    return <SlotChangeDialog mapId={mapId} body={pending.body} preview={pending.preview} onDone={onDone} onClose={() => setPending(null)} />;
  }
  return createPortal(
    <ModalBackdrop onClose={onClose} className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm">
      <div data-id="slot-delete-dialog" className="flex w-full max-w-sm flex-col gap-4 rounded-md bg-surface p-6 shadow-lg" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
              <Trash2 size={18} strokeWidth={1.5} />
            </div>
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-strong text-ink">{t("slot.action.delete")}</h2>
              <p className="truncate text-fine text-ink-tertiary">{mapName}</p>
            </div>
          </div>
          <button type="button" aria-label={t("summary.close")} className="shrink-0 rounded-xs p-0.5 text-ink-tertiary hover:bg-surface-alt" onClick={onClose}>
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>
        <label className="flex flex-col gap-1 text-caption text-ink">
          {t("slot.successor")}
          <SearchSelect value={successor} options={options} emptyLabel={t("slot.successorNone")} placeholder={t("field.searchPlaceholder")} onChange={setSuccessor} />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt" onClick={onClose}>{t("summary.cancel")}</button>
          <button type="button" data-id="slot-delete-next" disabled={busy} className="rounded-sm bg-error px-3 py-1.5 text-caption text-on-accent hover:opacity-90 disabled:opacity-40" onClick={() => void next()}>
            {t("summary.next")}
          </button>
        </div>
        {error && <p className="text-caption text-error">{error}</p>}
      </div>
    </ModalBackdrop>,
    document.body,
  );
}
```

(`summary.next` 키가 없으면 `slot.next`: "Next" / "다음"을 i18n에 추가. `SearchSelect`의 빈 옵션 처리는 기존 이양 피커 사용법을 따른다.)

- [ ] **Step 2: 상세 카드·홈 배선**

`map-detail-card.tsx`: props에 `onSlotChangeApplied?: () => void;` `onToast?: (message: string) => void;` 추가. 삭제 렌더(1532) 교체:

```tsx
      {confirmDelete && onDelete && (
        detail.category_id != null ? (
          <SlotDeleteDialog
            mapId={detail.id}
            mapName={detail.name}
            onDone={(result) => {
              setConfirmDelete(false);
              onToast?.(result.mode === "requested" ? t("slot.requestedToast") : t("slot.appliedToast"));
              if (result.mode === "applied") onSlotChangeApplied?.();
              else setLocalReloadKey((n) => n + 1);
            }}
            onClose={() => setConfirmDelete(false)}
          />
        ) : (
          <DeleteMapDialog mapName={detail.name} onConfirm={() => { setConfirmDelete(false); onDelete(detail.id); }} onClose={() => setConfirmDelete(false)} />
        )
      )}
```

`app/page.tsx`의 두 `<MapDetailCard ... onDelete={(id) => void handleDelete(id)}>`(575·1000)에 `onSlotChangeApplied={() => void refresh()}` `onToast={(m) => showToast(m)}` 추가. `handleDelete`는 그대로(슬롯 없는 맵 전용).

- [ ] **Step 3: 복사 모달 은퇴 선택**

`create-map-dialog.tsx`: `copy` prop 타입에 `categoryId?: number | null;` 추가(`app/page.tsx` 호출부에서 `categoryId: copyTarget.category_id ?? null` 전달). 상태 `const [retireMode, setRetireMode] = useState<"unassign" | "replace">("replace");`. 은퇴 체크박스(367 `setRetire(next)` 근처 JSX) 아래에 `retire && copy?.categoryId != null`일 때 라디오 2개(`data-id="copy-retire-mode-unassign|replace"`, 라벨 `slot.retireMode.*`). `handleCreate`의 `copyMap(... retireSource: retire)`를 `retireSource: retire && copy.categoryId == null`로 바꾸고, 복사 성공 직후(`createdRef.current` 확정 뒤) 슬롯 있는 원본이면:

```ts
      if (copy && retire && copy.categoryId != null && !slotHandledRef.current) {
        const body = { action: "delete" as const, to_map_id: retireMode === "replace" ? created.mapId : null };
        const preview = await postSlotChange(copy.mapId, { ...body, dry_run: true });
        const result = await postSlotChange(copy.mapId, body);
        slotHandledRef.current = true;
        onToast?.(result.mode === "requested" ? t("slot.requestedToast") : t("slot.appliedToast"));
        void preview;
      }
```

(`slotHandledRef = useRef(false)` — 재시도 시 중복 요청 방지. `dry_run`은 관리자 여부에 따라 즉시/요청이 갈리는 것을 서버가 결정하므로 결과 `mode`만 토스트한다. `onToast`가 없으면 `setError` 대신 무시.)

- [ ] **Step 4: 게이트 + 카탈로그 + Commit**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`

```bash
git add frontend/src/components/maps/slot-delete-dialog.tsx frontend/src/components/maps/map-detail-card.tsx frontend/src/app/page.tsx frontend/src/components/permissions/create-map-dialog.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md
git commit -m "feat(frontend): route slotted-map deletion and copy-with-retire through slot-change requests — 슬롯 맵 삭제·복사은퇴를 승인 요청으로"
```

---

### Task 6: 스모크 `pw-smoke-framework-slot.mjs`

**Files:**
- Create: `frontend/scripts/pw-smoke-framework-slot.mjs`

**Interfaces:**
- 실행: backend `DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false`(8000) + frontend(3000), `reset_db` 직후. `BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/bpm-slot-smoke node scripts/pw-smoke-framework-slot.mjs` (frontend/ cwd).

- [ ] **Step 1: 스크립트**

```js
// Framework 슬롯 거버넌스 스모크 — 비관리자 owner 요청 → L5 관리자 승인 → 캔버스 재지정·배지·호버 패널 → 해제 요청 → 미싱 룩.
// 시드는 pw-smoke-framework-canvas.mjs와 동일(인터뷰 샘플 웹 임포트, 멱등). 계정 전환은 localStorage bpm.devUser + API는 X-Dev-User.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=/tmp/bpm-slot-smoke node scripts/pw-smoke-framework-slot.mjs
// 전제: backend(8000, DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false)+frontend(3000), reset_db 직후.
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/bpm-slot-smoke";
const SAMPLE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/samples/consultant-interview-sample");
const ADMIN = "admin.sys";
const L5ADMIN = "slot.l5admin";
const OWNER = "slot.owner";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const pageErrors = [];
let shotIndex = 0;
const shot = (page, name) => page.screenshot({ path: path.join(SHOT_DIR, `${String(++shotIndex).padStart(2, "0")}-${name}.png`), fullPage: false });

async function newSession(user) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((u) => {
    window.localStorage.setItem("bpm.devUser", u);
    window.localStorage.setItem("bpm.lang", "en");
    window.localStorage.removeItem("bpm.framework.tree");
  }, user);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${user}: ${e.message}`));
  const api = (p, opts = {}) => page.evaluate(async ({ p, opts, u }) => {
    const res = await fetch(`/api${p}`, { ...opts, headers: { "Content-Type": "application/json", "X-Dev-User": u, ...(opts.headers ?? {}) } });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }, { p, opts, u: user });
  return { ctx, page, api };
}

try {
  // ── 0) 시드: 인터뷰 샘플 임포트(sysadmin) + L5 관리자 임명 + 비관리자 owner 맵 C ─────────
  const admin = await newSession(ADMIN);
  await admin.page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await admin.page.getByRole("button", { name: "Categories & import" }).first().click();
  await admin.page.locator('[data-id="interview-import-files"]').setInputFiles([
    path.join(SAMPLE_DIR, "calibration-l5.json"), path.join(SAMPLE_DIR, "utility-l5.json"),
  ]);
  await admin.page.locator('[data-id="interview-import-dryrun"]').click();
  await admin.page.waitForSelector('[data-id="interview-import-report"]', { timeout: 15000 });
  await admin.page.locator('[data-id="interview-import-apply"]').click();
  await admin.page.locator('[data-id="confirm-dialog-confirm"]').click();
  await admin.page.waitForSelector('[data-id="interview-import-report"]', { timeout: 20000 });
  const search = await admin.api(`/categories/search?q=${encodeURIComponent("Calibration 수행")}`);
  const l5 = search.body.categories.find((c) => c.level === 5) ?? search.body.categories[0];
  check("seeded L5 found", Boolean(l5), JSON.stringify(l5));
  await admin.api(`/categories/${l5.id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: [{ principal_type: "user", principal_id: L5ADMIN }] }) });
  const canvas = (await admin.api(`/categories/${l5.id}/linkage-map`, { method: "POST" })).body;
  const l6s = (await admin.api(`/categories/${l5.id}/maps`)).body.maps;
  const a = l6s[0];
  check("canvas + first L6 (A) available", Boolean(canvas?.map_id && a), `canvas=${canvas?.map_id} A=${a?.id}`);
  // A의 owner를 비관리자 owner로 — sysadmin이 transfer-owner (editor 요구 시 권한 먼저 부여)
  await admin.api(`/maps/${a.id}/permissions`, { method: "POST", body: JSON.stringify({ principal_type: "user", principal_id: OWNER, role: "editor" }) });
  const xfer = await admin.api(`/maps/${a.id}/transfer-owner`, { method: "POST", body: JSON.stringify({ new_owner: OWNER }) });
  check("A owner handed to non-admin owner", xfer.status === 200, `status=${xfer.status}`);

  // ── 1) owner 세션: 슬롯 없는 새 맵 C 생성 → 배정 모달에서 대체 요청 ───────────────────
  const owner = await newSession(OWNER);
  const created = await owner.api(`/maps`, { method: "POST", body: JSON.stringify({ name: "Slot smoke successor", visibility: "public", owning_department: a.owning_department }) });
  check("owner created successor C", created.status === 200 || created.status === 201, `status=${created.status}`);
  const c = created.body;
  await owner.page.goto(`${BASE}/?map=${a.id}`, { waitUntil: "networkidle" });
  await owner.page.locator('[data-id="map-detail-category"]').first().click();
  await owner.page.waitForSelector('[data-id="framework-assign-modal"]', { timeout: 8000 });
  await owner.page.locator('[data-id="framework-transfer-open"]').click();
  // SearchSelect: 입력 후 옵션 클릭 — 포털 드롭다운은 evaluate 클릭(memory: compare-refresh)
  const picker = owner.page.locator('[data-id="framework-assign-modal"] input').last();
  await picker.fill("Slot smoke successor");
  await owner.page.locator('[role="option"]', { hasText: "Slot smoke successor" }).first().evaluate((el) => el.click());
  await owner.page.locator('[data-id="framework-transfer-btn"]').click();
  await owner.page.waitForSelector('[data-id="slot-change-dialog"]', { timeout: 8000 });
  const requestMode = await owner.page.locator('[data-id="slot-change-note"]').count();
  check("non-admin owner sees request mode (note field)", requestMode === 1);
  await owner.page.locator('[data-id="slot-change-note"]').fill("smoke: replace A with C");
  await owner.page.locator('[data-id="slot-change-submit"]').click();
  await owner.page.waitForSelector('[data-id="slot-change-dialog"]', { state: "detached", timeout: 8000 });
  const pending = await owner.api(`/maps/${a.id}/slot-changes/pending`);
  check("request pending with one side", pending.body?.remaining?.length === 1, JSON.stringify(pending.body?.remaining));
  await shot(owner.page, "owner-request-sent");

  // ── 2) L5 관리자 세션: 인박스에서 승인 ───────────────────────────────────────────────
  const l5admin = await newSession(L5ADMIN);
  await l5admin.page.goto(`${BASE}/inbox`, { waitUntil: "networkidle" });
  const row = l5admin.page.locator('[data-id^="inbox-approval-"]', { hasText: a.name }).first();
  const rowVisible = await row.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false);
  check("L5 admin sees the slot request in inbox", rowVisible);
  await shot(l5admin.page, "l5admin-inbox");
  const decided = await l5admin.api(`/approval-requests/${pending.body.request.id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  check("L5 admin approves → applied", decided.body?.status === "applied", `status=${decided.status} ${decided.body?.status}`);

  // ── 3) 캔버스: C 노드가 A 자리에, 최근 이양 배지, 호버 패널 ───────────────────────────
  await l5admin.page.goto(`${BASE}/maps/${canvas.map_id}`, { waitUntil: "networkidle" });
  await l5admin.page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const cNode = l5admin.page.locator(".react-flow__node", { hasText: "Slot smoke successor" }).first();
  check("canvas shows successor C node", await cNode.count() === 1);
  check("old A node is gone", (await l5admin.page.locator(".react-flow__node", { hasText: a.name }).count()) === 0);
  check("recent handover badge on C", (await cNode.locator('[data-id="node-recent-handover"]').count()) === 1);
  await cNode.hover();
  const panel = await l5admin.page.locator('[data-id="l5-node-info-panel"]').waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false);
  check("hover shows bottom-left slot history panel", panel);
  await shot(l5admin.page, "canvas-after-replace-hover");

  // ── 4) 해제 요청 → 승인 → 미싱 룩 ────────────────────────────────────────────────────
  const unassignReq = await owner.api(`/maps/${c.id}/slot-changes`, { method: "POST", body: JSON.stringify({ action: "unassign", note: "smoke unassign" }) });
  check("owner unassign request created", unassignReq.body?.mode === "requested", JSON.stringify(unassignReq.body?.mode));
  const dec2 = await l5admin.api(`/approval-requests/${unassignReq.body.request_id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) });
  check("unassign approved", dec2.body?.status === "applied");
  await l5admin.page.reload({ waitUntil: "networkidle" });
  await l5admin.page.waitForSelector(".react-flow__node", { timeout: 15000 });
  const missing = await l5admin.page.locator('[data-id="sp-banner-slot-missing"]').count();
  check("unassigned node renders missing banner", missing >= 1, `banners=${missing}`);
  const ready = await l5admin.api(`/maps/${canvas.map_id}/confirm-readiness`);
  check("stale_link gate flags the unassigned link", ready.body?.failures?.some((f) => f.code === "stale_link"));
  await shot(l5admin.page, "canvas-unassigned-missing");

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  process.exitCode = passed === results.length ? 0 : 1;
}
```

`inbox-approval-*` data-id·`/maps/{id}/permissions` POST body·`/?map=` 딥링크·상세 카드 필 `map-detail-category`는 실측해 맞춘다(`git grep -n 'data-id="inbox-approval'`, `addMapPermission` 구현).

- [ ] **Step 2: 실행**

backend/frontend 네이티브 기동 후 스크립트 실행. Expected: `N/N checks passed`, 스크린샷 4장.

- [ ] **Step 3: Commit**

```bash
git add frontend/scripts/pw-smoke-framework-slot.mjs
git commit -m "test(smoke): framework slot governance end-to-end — request, approve, canvas re-point, hover panel, unassign — 슬롯 거버넌스 스모크"
```

---

### Task 7: QA 문서(기능·시나리오) + 브라우저 검증 실행 + PROGRESS

**Files:**
- Create: `docs/qa/2026-09-fw-slot-governance-qa.md`
- Modify: `PROGRESS.md`, `docs/README.md`(qa 인덱스 한 줄)

- [ ] **Step 1: QA 문서 작성**

```markdown
# Framework 슬롯 거버넌스 QA (2026-09)

설계 `docs/superpowers/specs/2026-09-06-fw-slot-governance-design.md`. 자동 항목은 `frontend/scripts/pw-smoke-framework-slot.mjs`·pytest `tests/test_framework_slots.py`가 검사하고, 수동 항목은 구현자가 실브라우저로 확인해 결과 열에 기록한다(사용자 지시 2026-09-06: 기능·시나리오 둘 다, 브라우저 검증 직접 수행).

**환경**: `reset_db` 시드 + backend 8000(`DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false`) + frontend 3000 네이티브, 시스템 Chrome(playwright-core). 계정: `admin.sys`(sysadmin) · `slot.l5admin`(L5 직속 관리자) · `slot.owner`(L6 owner, 비관리자).

## 1. 기능 체크리스트

| # | 표면 | 항목 | 방식 | 결과 |
|---|---|---|---|---|
| 1 | API | assign/unassign/move/replace/delete 전제(422/409) — 캔버스 맵·비L5·중복 슬롯·자기 자신 | pytest test_core_validation_errors | |
| 2 | API | target.id < source.id 이양 200 (결함 ①) | pytest test_transfer_succeeds_when_target_id_is_lower | |
| 3 | API | 캔버스 맵에 슬롯 부여 422 (결함 ②) | pytest test_slot_endpoints_reject_non_normal_maps | |
| 4 | 캔버스 | replace 후 옛 노드 없음·엣지 유지·missing_l6 없음 (결함 ③) | pytest test_core_replace_repoints_home_canvas_and_keeps_edges | |
| 5 | 캔버스 | target이 이미 있으면 엣지 합치기·중복 쌍 제거 | pytest test_core_replace_merges_when_target_already_on_canvas | |
| 6 | API | delete: 후계자 있으면 승계, 없으면 노드 유지(stale) (결함 ④) | pytest test_core_delete_with_and_without_successor | |
| 7 | API | dry_run 미리보기(self_apply·sides·impact) → 즉시 적용 | pytest test_slot_changes_preview_and_apply | |
| 8 | API | 비관리자 owner 요청 생성·중복 409·대기 조회 can_decide·철회 권한 | pytest test_non_admin_owner_creates_request_and_can_withdraw | |
| 9 | API | move 양측 승인(한쪽만 → pending, 동일인 → 1회 적용) | pytest test_move_needs_both_sides_and_same_person_satisfies_both | |
| 10 | API | 거절 → rejected+알림, 승인 시 전제 깨짐 → 409·pending 유지 | pytest test_reject_and_stale_apply_keep_state | |
| 11 | API | 인박스에 fw_slot(관리자만)·sysadmin 큐·can_decide_slot | pytest test_inbox_and_detail_expose_slot_decision_rights | |
| 12 | API | refs superseded·시각 3종·후계자, 해제 링크 stale_link | pytest test_refs_expose_slot_state_and_timestamps / test_unassigned_link_counts_as_stale | |
| 13 | API | 슬롯 맵 DELETE 409·copy retire_source 409·레거시 어댑터 409 | pytest test_slotted_map_delete_and_copy_retire_are_blocked / test_legacy_adapters_follow_slot_policy | |
| 14 | FE lib | 슬롯 상태 파생 6종·최근 이양 14일 경계 | vitest framework-slot-state.test | |
| 15 | 배정 모달 | 관리자: 안내 모달 → 바로 적용 / 비관리자: 요청 모달(승인자·메모) → 요청 토스트 | 스모크 + 수동 | |
| 16 | 배정 모달 | 대기 배너 + 요청자 철회 버튼, 대기 중 버튼 비활성 | 수동 | |
| 17 | 배정 모달 | 대체 섹션 슬롯 보유 L6 전부 노출, 피커에 캔버스·Word 맵 없음 | 수동 | |
| 18 | 승인 | 설정 승인 큐·맵 승인 탭·인박스에 fw_slot 행(액션·대상·n/m) 렌더, 승인/거절 동작 | 스모크(인박스) + 수동 | |
| 19 | 알림 | fw_slot_requested(관리자)·fw_slot_applied(owner·관리자)·fw_slot_rejected(요청자) 벨 렌더 | 수동 | |
| 20 | 캔버스 | 후계자 노드 최근 이양 배지 · 호버 좌하단 패널(이양/업데이트/해제 시각) | 스모크 | |
| 21 | 캔버스 | 해제·이양·삭제 노드 미싱 룩 + 배너 클릭 → 교체 다이얼로그(후계자 추천) | 스모크(배너) + 수동(다이얼로그) | |
| 22 | 상세 카드 | 슬롯 맵 삭제 → 후계자 선택 다이얼로그 → 요청/적용 | 수동 | |
| 23 | 복사 모달 | 슬롯 원본 은퇴 시 해제/승계 라디오 → 복사 후 요청/적용 | 수동 | |
| 24 | 게이트 | 확정 체크리스트 stale_link 라벨(삭제·이양·해제) | 수동 | |
| 25 | 회귀 | pw-smoke-framework-canvas · pw-smoke-framework-delegation · pw-smoke-copy-purge | 스모크 | |
| 26 | 게이트 | pytest·ruff / tsc·lint·vitest·build 그린 | 명령 | |

## 2. 사용자 시나리오 (유지보수 10항목 재현 대본)

각 시나리오: 사전 데이터 → 조작 → 기대 화면 → 확인 포인트. 계정은 §환경.

| # | 시나리오 | 대본 | 기대 | 결과 |
|---|---|---|---|---|
| S1 | 해제 → 미싱 | owner가 L6 A 상세 카드 → 체계 필 → Unassign → 요청 모달 → 요청. l5admin 인박스 승인 | L5 캔버스 A 노드가 점선 에러 룩 + "체계에서 해제됨 - 교체" 배너, 게이트 stale_link 위반, 호버 패널 "해제된 날" | |
| S2 | 대체 승인 → 반영·알림·최근 이양 | owner가 A 카드 → Transfer slot → C 선택 → 요청. l5admin 승인 | 캔버스 A 자리에 C(엣지 유지), C에 "최근 이양" 배지, l5admin·상위 관리자·owner 벨에 fw_slot_applied | |
| S3 | 이동 → 외부 디자인·양측 승인 | owner가 A(L5-X) → L5-Y 선택 → Add to framework(=move) 요청. X 관리자 승인 → 대기 1/2, Y 관리자 승인 → 적용 | X 캔버스 A 노드가 외부 L6 색+출처 배지, Y 캔버스에 A 소속 노드 append | |
| S4 | 해제 승인자 = L5 관리자 | S1의 요청을 무관 사용자로 결정 시도 | 403, l5admin만 승인 가능 | |
| S5 | 캔버스 맵 슬롯 지정 차단 | 이양 피커에서 연계 캔버스 검색 / API로 PUT category | 피커에 없음, API 422 | |
| S6 | 새 L6 생성 승인 | owner가 새 맵 생성 후 체계 필(유령 필) → L5 선택 → Add to framework | 요청 모달(승인자 표시) → 승인 후 캔버스 append | |
| S7 | 삭제 승인 + 플레이스홀더 | owner가 슬롯 맵 삭제 클릭 → 후계자 없음 → 요청 → 승인 | 맵 휴지통행, 캔버스 노드 점선 에러 룩(삭제됨 - 교체), 복구 시 자동 회복 | |
| S8 | 임포트 플레이스홀더 | (트랙 D) 미배치 코드 엣지가 있는 인터뷰 JSON 임포트 | 플레이스홀더 노드 + 엣지 유지, 재전달로 해소 | 트랙 D에서 기록 |
| S9 | 복사+은퇴 선택·승인 | owner가 A 복사 모달 → 원본 은퇴 체크 → "복사본이 슬롯 승계" → 생성 | 복사본 생성 즉시, 은퇴+승계는 요청 → 승인 후 A 휴지통·C 슬롯·캔버스 재지정 | |
| S10 | 호버 시각 3종 | 캔버스에서 S1·S2 노드 호버 | 좌하단 패널에 이양된 날/업데이트된 날/해제된 날 | |

## 3. 검증 기록

- 실행일·커밋·환경·스크린샷 경로(`/tmp/bpm-slot-smoke/*.png` → 세션 공유)·미통과 항목과 조치를 여기에 남긴다.
```

- [ ] **Step 2: 브라우저 검증 수행**

1. `cd backend && DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false .venv/bin/python -m scripts.reset_db && DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys AI_ENABLED=false .venv/bin/uvicorn app.main:app --port 8000` (사용자 터미널 또는 background) · `cd frontend && npm run dev`.
2. `node scripts/pw-smoke-framework-slot.mjs` + 회귀 스모크 3종 실행.
3. 수동 항목(15~24, S3·S6·S7·S9)을 Claude in Chrome 확장 또는 Playwright 임시 스크립트로 수행하며 스크린샷 저장 → QA 문서 결과 열에 ✅/❌ + 비고, §3에 스크린샷 경로 기록. 스크린샷은 `SendUserFile`로 세션에 공유.
4. 실패 항목은 systematic-debugging으로 원인 확정 후 수정·재검증(동일 문서에 기록).

- [ ] **Step 3: 인덱스·PROGRESS**

`docs/README.md`의 qa 목록에 `- docs/qa/2026-09-fw-slot-governance-qa.md — 슬롯 거버넌스 기능·시나리오 QA` 한 줄. `PROGRESS.md` 2026-09-06 섹션에:

```
- **트랙 C 구현**: `fw_slot` 승인 요청(생성·대기·철회·다측 decide·적용·거절 알림·인박스·can_decide_slot) + FE `SlotChangeDialog`(안내/요청) 공용화 → 배정 모달 대기 배너·철회, 슬롯 맵 삭제 다이얼로그(후계자), 복사+은퇴 승계 라디오, 승인 큐·대기 패널·인박스·벨 렌더. 스모크 `pw-smoke-framework-slot.mjs` N/N, QA `docs/qa/2026-09-fw-slot-governance-qa.md`(기능 26·시나리오 10) 실브라우저 기록.
```

- [ ] **Step 4: 최종 게이트 + Commit**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -p no:cacheprovider && .venv/bin/ruff check app/ tests/
cd ../frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && npm run build
git add docs/qa/2026-09-fw-slot-governance-qa.md docs/README.md PROGRESS.md
git commit -m "docs(qa): framework slot governance QA checklist and scenario script with browser verification results — 슬롯 거버넌스 QA 문서·검증 기록"
```
