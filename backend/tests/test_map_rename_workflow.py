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
            # map_id로 스코프 — 세션 전역 Notification 테이블은 다른 테스트(예: sysadmin
            # 개명이 남기는 map_renamed→OWNER)와 공유돼 필터 없인 오염된다.
            rows = await session.scalars(
                select(Notification).where(Notification.map_id == map_id)
            )
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
            if a["kind"] == "approval_request" and a["title"] == "map_rename" and a["map_id"] == map_id
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
