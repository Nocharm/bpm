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

    def test_withdraw_by_stranger_403_even_without_pending(self, client, enforce):
        map_id = seed_rename_map("Iota Stranger")
        act_as("stranger.user")
        assert client.delete(f"/api/maps/{map_id}/rename-requests/pending").status_code == 403
