"""버전 제출 시 가시성 변경 동봉 — 승인요청 이중 병합 (Task A1).

동봉: 버전 승인과 가시성 변경을 하나의 승인 흐름으로 통합.
- 단독 pending 가시성 요청이 있으면 동봉이 supersede(대체).
- 동봉 payload는 version_id를 포함해 버전과 링크.
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

import app.auth as _auth_mod
from app.db import SessionLocal
from app.main import app as _app
from app.models import ApprovalRequest, MapPermission, MapVersion
from app.settings import settings


@pytest.fixture(autouse=True)
def _clean_auth() -> None:
    yield
    _app.dependency_overrides.pop(_auth_mod.get_current_user, None)


@pytest.fixture
def enforce() -> Iterator[None]:
    """enforcement ON — 기본 baseline 은 is_sysadmin 이 전원 True 라 오너 게이트가 무의미하다."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = "admin.sys"
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys


def _act_as(user: str) -> None:
    _app.dependency_overrides[_auth_mod.get_current_user] = lambda: user


def _create_map(client: TestClient, visibility: str = "private") -> tuple[int, int]:
    """새 맵 생성 후 (map_id, version_id) 반환."""
    created = client.post(
        "/api/maps",
        json={
            "owning_department": "Owning Anchor Division",
            "name": f"bundle-test-{uuid4().hex[:6]}",
            "visibility": visibility,
        },
    ).json()
    return created["id"], created["versions"][0]["id"]


def _set_approvers(client: TestClient, map_id: int, approvers: list[str]) -> None:
    """승인자 지정."""
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})


def _checkout(client: TestClient, version_id: int) -> None:
    """버전 체크아웃."""
    client.post(f"/api/versions/{version_id}/checkout", json={})


def _grant(map_id: int, user_id: str, role: str) -> None:
    """권한 행 직접 시드 — PUT /permissions 의 교체 의미론에 의존하지 않는다."""

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(
                MapPermission(
                    map_id=map_id,
                    principal_type="user",
                    principal_id=user_id,
                    role=role,
                    granted_by="seed",
                )
            )
            await session.commit()

    asyncio.run(_run())


def _grant_id(map_id: int, principal_id: str) -> int:
    """권한 행 id 조회 — R2 뮤텍스 테스트에서 대상 grant 를 특정."""

    async def _run() -> int:
        async with SessionLocal() as session:
            return await session.scalar(
                select(MapPermission.id).where(
                    MapPermission.map_id == map_id,
                    MapPermission.principal_id == principal_id,
                )
            )

    return asyncio.run(_run())  # type: ignore[return-value]


def _seed_pending_downgrade(
    map_id: int, permission_id: int, principal_id: str, *, requested_by: str
) -> None:
    """다운그레이드 pending 요청 직접 시드 — R2 정방향 뮤텍스가 체크아웃 보유자 대상 PATCH 를
    막으므로, '체크아웃 보유 + 본인 다운그레이드 pending' 동시 상태는 ORM 으로 우회해 만든다."""

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(
                ApprovalRequest(
                    map_id=map_id,
                    kind="permission_downgrade",
                    payload={
                        "permission_id": permission_id,
                        "principal_type": "user",
                        "principal_id": principal_id,
                        "from_role": "editor",
                        "to_role": "viewer",
                    },
                    requested_by=requested_by,
                    status="pending",
                )
            )
            await session.commit()

    asyncio.run(_run())


def _seed_spare_version(map_id: int) -> None:
    """'마지막 버전은 삭제 불가' 가드 회피용 여분 버전 (API 는 게시 후에만 생성 허용)."""

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(MapVersion(map_id=map_id, label="spare"))
            await session.commit()

    asyncio.run(_run())


def _get_all_approval_requests(map_id: int) -> list[ApprovalRequest]:
    """맵의 모든 ApprovalRequest 조회."""

    async def _run() -> list[ApprovalRequest]:
        async with SessionLocal() as session:
            from sqlalchemy import select

            reqs = (
                await session.execute(
                    select(ApprovalRequest).where(ApprovalRequest.map_id == map_id)
                )
            ).scalars()
            return list(reqs)

    return asyncio.run(_run())


def test_submit_with_bundle_creates_linked_request(client: TestClient) -> None:
    """Draft 버전을 checkout 후 submit body {"to_visibility":"public"}(맵은 private) → 200.
    ApprovalRequest: kind visibility_change·status pending·payload["version_id"]==version_id·
    payload["to_visibility"]=="public"·requested_by==제출자. 행 수 정확히 1."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a", "b"])
    _checkout(client, version_id)

    # Submit with bundle payload
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # ORM으로 ApprovalRequest 조회
    reqs = _get_all_approval_requests(map_id)
    assert len(reqs) == 1
    req = reqs[0]
    assert req.kind == "visibility_change"
    assert req.status == "pending"
    assert req.payload["version_id"] == version_id
    assert req.payload["to_visibility"] == "public"
    assert req.requested_by == "local-dev"  # default dev_user)


def test_submit_bundle_noop_visibility_422(client: TestClient) -> None:
    """맵이 private인데 body {"to_visibility":"private"} → 422, 버전 status는 draft 유지,
    ApprovalRequest 0행."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _checkout(client, version_id)

    # Submit with no-op visibility
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "private"},
    )
    assert resp.status_code == 422
    assert "nothing to bundle" in resp.text.lower()

    # 버전은 여전히 draft
    detail = client.get(f"/api/versions/{version_id}/workflow").json()
    assert detail["status"] == "draft"

    # ApprovalRequest 0행
    reqs = _get_all_approval_requests(map_id)
    assert len(reqs) == 0


def test_submit_bundle_supersedes_standalone(client: TestClient) -> None:
    """다른 유저(a)의 단독 가시성 요청이 있는 상태에서 오너(local-dev)가 submit with bundle →
    standalone 행 status=="superseded" + 요청자 a 에게만 type=="permission_superseded" 알림 존재,
    동봉 제출자(오너)는 받지 않음, 동봉 행만 pending.

    동봉은 오너 전용 게이트라(제출자 == 오너), 요청자 ≠ 제출자 대비를 위해 standalone 은 a 명의로 시드한다."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a", "b"])

    # Step 1: 다른 유저 "a" 명의의 단독 가시성 요청 (ORM 시드 — 요청자를 제출자와 분리)
    async def _seed_standalone_by_a() -> None:
        async with SessionLocal() as session:
            session.add(
                ApprovalRequest(
                    map_id=map_id,
                    kind="visibility_change",
                    payload={
                        "from_visibility": "private",
                        "to_visibility": "public",
                    },
                    requested_by="a",
                    status="pending",
                )
            )
            await session.commit()

    asyncio.run(_seed_standalone_by_a())

    # Step 2: Owner(local-dev) checks out version and submits with bundle
    _checkout(client, version_id)
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Step 3: Verify standalone is superseded + rows match expectations
    reqs = _get_all_approval_requests(map_id)
    # Should have 1 standalone (superseded) + 1 bundled (pending)
    assert len(reqs) == 2

    standalone = next(
        (r for r in reqs if r.status == "superseded"), None
    )
    assert standalone is not None
    assert standalone.kind == "visibility_change"

    bundled = next((r for r in reqs if r.status == "pending"), None)
    assert bundled is not None
    assert bundled.kind == "visibility_change"
    assert bundled.payload["version_id"] == version_id

    # Step 4: Verify notification was sent ONLY to standalone requester ("a")
    _act_as("a")
    requester_notifications = client.get("/api/notifications").json()
    requester_got = [
        n
        for n in requester_notifications
        if n["type"] == "permission_superseded" and n["map_id"] == map_id
    ]
    assert len(requester_got) == 1, "Standalone requester should receive permission_superseded"

    # Step 5: Verify submitter (owner "local-dev") did NOT receive supersede notification
    _act_as("local-dev")
    submitter_notifications = client.get("/api/notifications").json()
    submitter_got = [
        n
        for n in submitter_notifications
        if n["type"] == "permission_superseded" and n["map_id"] == map_id
    ]
    assert len(submitter_got) == 0, "Submitter should NOT receive permission_superseded"


def test_submit_without_body_unchanged(client: TestClient) -> None:
    """Body 없이 submit(기존 계약) → 200 pending 전이, ApprovalRequest 0행."""

    map_id, version_id = _create_map(client)
    _set_approvers(client, map_id, ["a"])
    _checkout(client, version_id)

    # Submit without body
    resp = client.post(f"/api/versions/{version_id}/submit")
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending"

    # ApprovalRequest 0행
    reqs = _get_all_approval_requests(map_id)
    assert len(reqs) == 0


def test_publish_applies_bundle(client: TestClient) -> None:
    """Submit(bundle "public", 맵 private + viewer 그랜트 1명 시드) → 승인자 전원 approve →
    submitter publish → 맵 visibility=="public", 동봉 행 status=="applied"·decided_by==publisher,
    viewer 그랜트 제거됨, 요청자에게 type=="permission_approved" 알림."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a", "b"])

    # Grant viewer permission to test sweep
    client.put(
        f"/api/maps/{map_id}/permissions",
        json={
            "members": [{"user_id": "viewer_user", "role": "viewer"}]
        },
    )

    _checkout(client, version_id)

    # Submit with bundle
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Approve by both approvers
    _act_as("a")
    client.post(f"/api/versions/{version_id}/approve", json={})
    _act_as("b")
    client.post(f"/api/versions/{version_id}/approve", json={})

    # Publish by submitter
    _act_as("local-dev")
    resp = client.post(f"/api/versions/{version_id}/publish", json={})
    assert resp.status_code == 200
    assert resp.json()["status"] == "published"

    # Verify map visibility changed
    map_detail = client.get(f"/api/maps/{map_id}").json()
    assert map_detail["visibility"] == "public"

    # Verify bundled request was applied
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled is not None
    assert bundled.status == "applied"
    assert bundled.decided_by == "local-dev"

    # Verify viewer grant was removed — check via direct DB query
    async def _check_no_viewer_grants() -> bool:
        async with SessionLocal() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(MapPermission)
                .where(
                    MapPermission.map_id == map_id,
                    MapPermission.role == "viewer",
                )
            )
            return count == 0

    assert asyncio.run(_check_no_viewer_grants()), "Viewer grants should be removed"

    # Verify permission_approved notification sent to requester
    _act_as("local-dev")
    notifications = client.get("/api/notifications").json()
    perm_approved = [
        n for n in notifications
        if n["type"] == "permission_approved" and n["map_id"] == map_id
    ]
    assert len(perm_approved) == 1


def test_reject_sweeps_bundle(client: TestClient) -> None:
    """Submit(bundle) → 승인자 reject(reason 필수) → 동봉 행 status=="rejected"·decided_by==반려자,
    요청자에게 type=="permission_rejected" 알림. 맵 visibility 불변."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    _checkout(client, version_id)

    # Submit with bundle
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Reject by approver
    _act_as("a")
    resp = client.post(
        f"/api/versions/{version_id}/reject",
        json={"reason": "needs more discussion"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "rejected"

    # Verify map visibility unchanged
    map_detail = client.get(f"/api/maps/{map_id}").json()
    assert map_detail["visibility"] == "private"

    # Verify bundled request was rejected
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled is not None
    assert bundled.status == "rejected"
    assert bundled.decided_by == "a"

    # Verify permission_rejected notification sent to requester
    _act_as("local-dev")
    notifications = client.get("/api/notifications").json()
    perm_rejected = [
        n for n in notifications
        if n["type"] == "permission_rejected" and n["map_id"] == map_id
    ]
    assert len(perm_rejected) == 1


def test_withdraw_sweeps_bundle(client: TestClient) -> None:
    """Submit(bundle) → submitter withdraw → 동봉 행 status=="withdrawn". 맵 visibility 불변."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    _checkout(client, version_id)

    # Submit with bundle
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Withdraw by submitter
    resp = client.post(f"/api/versions/{version_id}/withdraw", json={})
    assert resp.status_code == 200
    assert resp.json()["status"] == "draft"

    # Verify map visibility unchanged
    map_detail = client.get(f"/api/maps/{map_id}").json()
    assert map_detail["visibility"] == "private"

    # Verify bundled request was withdrawn
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled is not None
    assert bundled.status == "withdrawn"


def test_direct_decide_on_bundle_409(client: TestClient) -> None:
    """동봉 행 id로 승인자가 POST /api/approval-requests/{id}/decide approve/reject → 409
    (detail에 "version" 포함); 행 status는 pending 유지."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    _checkout(client, version_id)

    # Submit with bundle
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Get bundled request id
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled is not None
    bundled_id = bundled.id

    # Try to decide the bundled request directly
    _act_as("a")
    resp = client.post(
        f"/api/approval-requests/{bundled_id}/decide",
        json={"decision": "approve"},
    )
    assert resp.status_code == 409
    assert "version" in resp.text.lower()

    # Try reject as well
    resp = client.post(
        f"/api/approval-requests/{bundled_id}/decide",
        json={"decision": "reject"},
    )
    assert resp.status_code == 409

    # Verify status is still pending
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled.status == "pending"


def test_inbox_hides_bundled_rows(client: TestClient) -> None:
    """동봉 pending 존재 상태에서 승인자 GET /api/inbox/approvals →
    kind=="approval_request"인 항목 중 그 행 id 없음."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    _checkout(client, version_id)

    # Submit with bundle
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Get bundled request id
    reqs = _get_all_approval_requests(map_id)
    bundled = next((r for r in reqs if r.kind == "visibility_change"), None)
    assert bundled is not None
    bundled_id = bundled.id
    assert bundled.payload.get("version_id") is not None, "Bundled request should have version_id"

    # Check inbox as approver
    _act_as("a")
    inbox = client.get("/api/inbox/approvals").json()

    # Find version approval for this map
    version_approval = next(
        (item for item in inbox if item["kind"] == "version_approval" and item["map_id"] == map_id),
        None,
    )
    assert version_approval is not None, "Version approval should be in inbox"

    # Bundled request should NOT be in inbox (check for approval_request kind, not version_approval)
    bundled_in_inbox = next(
        (item for item in inbox if item["id"] == bundled_id and item["kind"] == "approval_request"),
        None,
    )
    assert bundled_in_inbox is None, "Bundled visibility_change request should not be in inbox"


def test_second_bundle_does_not_supersede_first_versions_bundle(client: TestClient) -> None:
    """동시-pending 버전들의 동봉 요청이 서로 대체되지 않음 (Step 3.5: supersede query filters bundled).

    ORM 직접 시딩으로 다른 버전의 동봉을 미리 두고, 우리 버전 submit 시
    - 그 foreign bundle은 pending 유지 (NOT superseded — version_id 필터)
    - 우리 bundle은 새로 pending 생성 (2개 pending 존재)
    - standalone은 superseded (version_id is None 만 대체 가능함을 증명)."""

    map_id, version_id_1 = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    _checkout(client, version_id_1)

    # Step 1: ORM 시딩 — 다른 버전(999999)의 pending 동봉 요청
    async def _seed_foreign_bundle() -> None:
        async with SessionLocal() as session:
            session.add(
                ApprovalRequest(
                    map_id=map_id,
                    kind="visibility_change",
                    payload={
                        "from_visibility": "private",
                        "to_visibility": "public",
                        "version_id": 999999,  # "다른 버전"의 동봉
                    },
                    requested_by="other_submitter",
                    status="pending",
                )
            )
            await session.commit()

    asyncio.run(_seed_foreign_bundle())

    # Step 2: ORM 시딩 — standalone (no version_id) 요청도 시딩
    # 이를 통해 standalone은 대체되지만 foreign bundle은 대체되지 않음을 증명
    async def _seed_standalone() -> None:
        async with SessionLocal() as session:
            session.add(
                ApprovalRequest(
                    map_id=map_id,
                    kind="visibility_change",
                    payload={
                        "from_visibility": "private",
                        "to_visibility": "public",
                    },
                    requested_by="standalone_requester",
                    status="pending",
                )
            )
            await session.commit()

    asyncio.run(_seed_standalone())

    # Step 3: 시딩 검증 — 1 foreign bundle + 1 standalone = 2 total
    reqs_before = _get_all_approval_requests(map_id)
    foreign_bundle = [r for r in reqs_before if r.payload.get("version_id") == 999999]
    standalone = [r for r in reqs_before if r.payload.get("version_id") is None]
    assert len(foreign_bundle) == 1, "Foreign bundled request should be seeded"
    assert len(standalone) == 1, "Standalone request should be seeded"

    # Step 4: 우리 버전 submit with bundle
    # submit_version의 supersede query는 version_id is None 만 대체 가능
    resp = client.post(
        f"/api/versions/{version_id_1}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    # Step 5: 최종 상태 검증
    reqs_after = _get_all_approval_requests(map_id)
    visibility_reqs = [r for r in reqs_after if r.kind == "visibility_change"]

    # 우리 새 동봉 요청
    our_bundle = next((r for r in visibility_reqs if r.payload.get("version_id") == version_id_1), None)
    assert our_bundle is not None, "Our bundled request should exist"
    assert our_bundle.status == "pending", "Our bundle should be pending"
    assert our_bundle.requested_by == "local-dev"

    # Foreign bundle은 pending 유지 (NOT superseded — Step 3.5 filter 작동 증명)
    foreign_still = next((r for r in visibility_reqs if r.payload.get("version_id") == 999999), None)
    assert foreign_still is not None, "Foreign bundled request should not be deleted"
    assert (
        foreign_still.status == "pending"
    ), "Foreign bundle should still be pending (NOT superseded — version_id filter prevents it)"

    # Standalone은 superseded (version_id None 만 대체 가능함을 증명)
    standalone_after = next((r for r in visibility_reqs if r.payload.get("version_id") is None), None)
    assert standalone_after is not None, "Standalone request should exist"
    assert standalone_after.status == "superseded", "Standalone should be superseded by our bundle"

    # 최종 카운트: 3개 (우리 bundle, foreign bundle, superseded standalone)
    assert len(visibility_reqs) == 3, f"Should have 3 visibility requests total, got {len(visibility_reqs)}"


def test_submit_bundle_requires_owner(client: TestClient, enforce: None) -> None:
    """동봉 가시성 변경은 오너 전용 — 편집자 점유 보유자는 403·요청 0행, 오너는 200·요청 1행."""

    _act_as("owner.u")
    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _grant(map_id, "ed.u", "editor")

    # 편집자가 점유 후 동봉 제출 → 403 (단독 visibility-request 게이트와 대칭)
    _act_as("ed.u")
    _checkout(client, version_id)
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 403
    assert "owner" in resp.text.lower()
    assert len(_get_all_approval_requests(map_id)) == 0
    assert client.get(f"/api/versions/{version_id}/workflow").json()["status"] == "draft"

    # 오너가 점유를 넘겨받아 동봉 제출 → 200 + 동봉 행 1개
    client.delete(f"/api/versions/{version_id}/checkout")
    _act_as("owner.u")
    _checkout(client, version_id)
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200
    reqs = _get_all_approval_requests(map_id)
    assert len(reqs) == 1
    assert reqs[0].payload["version_id"] == version_id
    assert reqs[0].requested_by == "owner.u"


def test_withdraw_bundled_409(client: TestClient) -> None:
    """동봉 행은 범용 철회 엔드포인트로 지울 수 없다 — 409, 행은 pending 유지."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _checkout(client, version_id)
    assert (
        client.post(
            f"/api/versions/{version_id}/submit", json={"to_visibility": "public"}
        ).status_code
        == 200
    )

    bundled = _get_all_approval_requests(map_id)[0]
    resp = client.delete(f"/api/approval-requests/{bundled.id}")
    assert resp.status_code == 409
    assert "version" in resp.text.lower()

    still = _get_all_approval_requests(map_id)[0]
    assert still.status == "pending"


def test_pending_peek_excludes_bundled(client: TestClient) -> None:
    """동봉 pending 만 있으면 Settings 의 pending 마커 조회는 null — 단독 요청만 노출."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _checkout(client, version_id)
    assert (
        client.post(
            f"/api/versions/{version_id}/submit", json={"to_visibility": "public"}
        ).status_code
        == 200
    )

    resp = client.get(f"/api/maps/{map_id}/visibility-requests/pending")
    assert resp.status_code == 200
    assert resp.json() is None


def test_sysadmin_queue_excludes_bundled(client: TestClient) -> None:
    """sysadmin 전역 큐는 동봉 행을 숨긴다(decide 가 409라 죽은 버튼) — 단독 행은 그대로 노출."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _checkout(client, version_id)
    assert (
        client.post(
            f"/api/versions/{version_id}/submit", json={"to_visibility": "public"}
        ).status_code
        == 200
    )
    bundled = _get_all_approval_requests(map_id)[0]

    # 대조군 — 다른 맵의 단독 요청은 큐에 남아야 필터가 과잉이 아님이 증명된다
    other_map_id, _ = _create_map(client, visibility="private")
    _set_approvers(client, other_map_id, ["a"])
    standalone = client.post(
        f"/api/maps/{other_map_id}/visibility-request",
        json={"to_visibility": "public"},
    ).json()

    ids = [r["id"] for r in client.get("/api/approval-requests").json()]
    assert bundled.id not in ids
    assert standalone["id"] in ids


def test_delete_version_sweeps_bundle(client: TestClient) -> None:
    """approved 버전 삭제 시 동봉 행을 withdrawn 으로 스윕 — 안 하면 pending 이 박제돼
    dedupe 가드가 이후 단독 요청까지 영구 차단한다."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _seed_spare_version(map_id)  # 마지막 버전 삭제 금지 가드 회피
    _checkout(client, version_id)
    assert (
        client.post(
            f"/api/versions/{version_id}/submit", json={"to_visibility": "public"}
        ).status_code
        == 200
    )

    _act_as("a")
    assert client.post(f"/api/versions/{version_id}/approve", json={}).status_code == 200

    _act_as("local-dev")
    assert client.get(f"/api/versions/{version_id}/workflow").json()["status"] == "approved"
    assert client.delete(f"/api/versions/{version_id}").status_code == 204

    bundled = _get_all_approval_requests(map_id)[0]
    assert bundled.status == "withdrawn"

    # dedupe 해제 확인 — 새 단독 요청이 통과해야 한다
    resp = client.post(
        f"/api/maps/{map_id}/visibility-request",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 201


# ── R2: 동봉 가시성 공개 + 워크플로 상호 배제(역방향) ──────────


def test_workflow_state_exposes_bundled_visibility(client: TestClient) -> None:
    """동봉 제출 후 GET workflow 는 bundled_visibility 를 3필드로 노출, 동봉 없으면 null."""
    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])

    before = client.get(f"/api/versions/{version_id}/workflow").json()
    assert before["bundled_visibility"] is None

    _checkout(client, version_id)
    resp = client.post(
        f"/api/versions/{version_id}/submit",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 200

    after = client.get(f"/api/versions/{version_id}/workflow").json()
    assert after["bundled_visibility"] == {
        "from_visibility": "private",
        "to_visibility": "public",
        "requested_by": "local-dev",
    }


def test_checkout_blocked_when_own_downgrade_pending(client: TestClient, enforce: None) -> None:
    """actor 본인 grant 에 pending 다운그레이드가 있으면 체크아웃 차단 — 상호 배제 역방향."""
    _act_as("owner.u")
    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _grant(map_id, "ed.u", "editor")
    _grant(map_id, "actor.ed", "editor")

    _act_as("actor.ed")
    gid = _grant_id(map_id, "ed.u")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["pending"] is True

    _act_as("ed.u")
    resp = client.post(f"/api/versions/{version_id}/checkout", json={})
    assert resp.status_code == 409
    assert "pending approval" in resp.text.lower()


def test_submit_blocked_when_own_downgrade_pending(client: TestClient, enforce: None) -> None:
    """같은 상태에서 제출도 차단 — 체크아웃은 pending 생성 전에 확보(정방향 뮤텍스 회피 위해
    다운그레이드는 ORM 시드)."""
    _act_as("owner.u")
    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a"])
    _grant(map_id, "ed.u", "editor")

    _act_as("ed.u")
    _checkout(client, version_id)

    gid = _grant_id(map_id, "ed.u")
    _seed_pending_downgrade(map_id, gid, "ed.u", requested_by="owner.u")

    resp = client.post(f"/api/versions/{version_id}/submit", json={})
    assert resp.status_code == 409
    assert "pending approval" in resp.text.lower()
