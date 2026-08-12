"""버전 제출 시 가시성 변경 동봉 — 승인요청 이중 병합 (Task A1).

동봉: 버전 승인과 가시성 변경을 하나의 승인 흐름으로 통합.
- 단독 pending 가시성 요청이 있으면 동봉이 supersede(대체).
- 동봉 payload는 version_id를 포함해 버전과 링크.
"""

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.auth as _auth_mod
from app.db import SessionLocal
from app.main import app as _app
from app.models import ApprovalRequest


@pytest.fixture(autouse=True)
def _clean_auth() -> None:
    yield
    _app.dependency_overrides.pop(_auth_mod.get_current_user, None)


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
    """오너(local-dev)가 POST /api/maps/{id}/visibility-request 생성 →
    다른 유저(a, 편집자+승인자)가 submit with bundle → standalone 행 status=="superseded" +
    오너에게만 type=="permission_superseded" 알림 존재, 편집자는 받지 않음, 동봉 행만 pending."""

    map_id, version_id = _create_map(client, visibility="private")
    _set_approvers(client, map_id, ["a", "b"])

    # 편집자 "a"에게 editor 권한 부여 (버전 체크아웃·제출 가능하도록)
    client.put(
        f"/api/maps/{map_id}/permissions",
        json={
            "members": [{"user_id": "a", "role": "editor"}]
        },
    )

    # Step 1: Owner(local-dev) creates standalone visibility request
    resp = client.post(
        f"/api/maps/{map_id}/visibility-request",
        json={"to_visibility": "public"},
    )
    assert resp.status_code == 201

    # Step 2: Editor(a) checks out version and submits with bundle
    _act_as("a")
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

    # Step 4: Verify notification was sent ONLY to standalone requester (owner)
    _act_as("local-dev")  # Owner checks their notifications
    owner_notifications = client.get("/api/notifications").json()
    owner_got = [
        n
        for n in owner_notifications
        if n["type"] == "permission_superseded" and n["map_id"] == map_id
    ]
    assert len(owner_got) == 1, "Owner should receive permission_superseded notification"

    # Step 5: Verify submitter (editor "a") did NOT receive supersede notification
    _act_as("a")
    editor_notifications = client.get("/api/notifications").json()
    editor_got = [
        n
        for n in editor_notifications
        if n["type"] == "permission_superseded" and n["map_id"] == map_id
    ]
    assert len(editor_got) == 0, "Editor should NOT receive permission_superseded notification"


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
