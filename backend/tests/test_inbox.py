"""알림·승인 인박스 — GET /api/inbox/approvals 통합 큐 (S7).

auth 우회 모드: dependency_overrides로 인증 사용자를 바꿔 다중 사용자 시나리오를 재현한다.
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.auth as _auth_mod
from app.db import SessionLocal
from app.main import app as _app
from app.models import CheckoutRequest, MapVersion


@pytest.fixture(autouse=True)
def _clean_auth() -> Iterator[None]:
    yield
    _app.dependency_overrides.pop(_auth_mod.get_current_user, None)


def _act_as(user: str) -> None:
    _app.dependency_overrides[_auth_mod.get_current_user] = lambda: user


def _submit_pending(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    """맵+버전 생성 → 승인자 지정 → 체크아웃 → 제출(pending). (map_id, version_id)."""
    created = client.post("/api/maps", json={"name": f"inbox-{uuid4().hex[:6]}"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    return map_id, version_id


def _seed_checkout_request(version_id: int, holder: str, requester: str) -> int:
    """버전 점유자 설정 + pending 점유권 이전 요청 시드 → request id."""

    async def _run() -> int:
        async with SessionLocal() as session:
            ver = await session.get(MapVersion, version_id)
            ver.checked_out_by = holder
            req = CheckoutRequest(
                version_id=version_id, requested_by=requester, status="pending"
            )
            session.add(req)
            await session.commit()
            await session.refresh(req)
            return req.id

    return asyncio.run(_run())


def test_inbox_version_approval_for_assigned_approver(client: TestClient) -> None:
    """지정 승인자는 pending 버전을 version_approval 항목으로 본다."""
    map_id, version_id = _submit_pending(client, ["a", "b"])

    _act_as("a")
    res = client.get("/api/inbox/approvals")
    assert res.status_code == 200
    mine = [it for it in res.json() if it["version_id"] == version_id]
    assert len(mine) == 1
    item = mine[0]
    assert item["kind"] == "version_approval"
    assert item["id"] == version_id  # approve/reject 엔드포인트가 받는 id
    assert item["map_id"] == map_id
    assert item["status"] == "pending"


def test_inbox_excludes_after_own_approval(client: TestClient) -> None:
    """내가 이미 승인한 버전은 큐에서 빠지고, 남은 승인자는 여전히 본다."""
    _map_id, version_id = _submit_pending(client, ["a", "b"])

    _act_as("a")
    client.post(f"/api/versions/{version_id}/approve")  # 1/2 — 여전히 pending
    a_items = client.get("/api/inbox/approvals").json()
    assert not any(it["version_id"] == version_id for it in a_items)

    _act_as("b")
    b_items = client.get("/api/inbox/approvals").json()
    assert any(it["version_id"] == version_id for it in b_items)


def test_inbox_checkout_transfer_for_holder(client: TestClient) -> None:
    """현 점유자는 자신 버전의 점유권 이전 요청을 checkout_transfer 항목으로 본다."""
    created = client.post("/api/maps", json={"name": f"inbox-co-{uuid4().hex[:6]}"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]
    req_id = _seed_checkout_request(version_id, holder="holder.u", requester="editor.u")

    _act_as("holder.u")
    items = client.get("/api/inbox/approvals").json()
    mine = [it for it in items if it["kind"] == "checkout_transfer" and it["id"] == req_id]
    assert len(mine) == 1
    assert mine[0]["version_id"] == version_id
    assert mine[0]["requester"] == "editor.u"
    assert mine[0]["map_id"] == map_id


def test_inbox_empty_for_unrelated_user(client: TestClient) -> None:
    """무관한 사용자는 남의 승인건을 보지 않는다."""
    _map_id, version_id = _submit_pending(client, ["a", "b"])

    _act_as("stranger")
    items = client.get("/api/inbox/approvals").json()
    assert not any(it.get("version_id") == version_id for it in items)
