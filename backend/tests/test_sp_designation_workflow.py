"""sp_designation 워크플로 테스트 — 플레이스홀더 링크·등록 요청·수락 (spec 2026-07-19).

test_map_rename_workflow.py 의 enforce/act_as/_seed 패턴을 따른다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.clock import now as now_kst
from app.db import SessionLocal
from app.main import app
from app.models import (
    ApprovalRequest,
    MapApprover,
    MapPermission,
    MapVersion,
    Notification,
    ProcessMap,
)
from app.settings import settings

SYSADMIN = "admin.sys"
OWNER = "sp.owner"
EDITOR = "sp.editor"
VIEWER = "sp.viewer"
STRANGER = "sp.stranger"
APPROVER = "sp.approver"


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


def seed_sp_map(
    name: str,
    *,
    designated: bool = False,
    visibility: str = "public",
    published: bool = True,
    stale_department: str | None = None,
) -> int:
    """owner/editor/viewer 그랜트 + (옵션) 게시 버전이 있는 맵 시드. map_id 반환.

    stale_department: 미지정 맵에 남은 직전 지정 잔존값 재현용(마스킹 검증).
    """

    async def _factory(session):
        m = ProcessMap(
            name=name,
            description="",
            owning_department="Owning Anchor Division",
            visibility=visibility,
        )
        if designated:
            m.sp_designated_at = now_kst()
            m.sp_department = "Design Dept"
        elif stale_department is not None:
            m.sp_department = stale_department
        session.add(m)
        await session.flush()
        if published:
            session.add(
                MapVersion(map_id=m.id, label="v1", status="published", version_number=1)
            )
        for login, role in ((OWNER, "owner"), (EDITOR, "editor"), (VIEWER, "viewer")):
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id=login,
                    role=role,
                    granted_by=SYSADMIN,
                )
            )
        return m.id

    return _seed(_factory)


def _rows_by_id(body: list[dict]) -> dict[int, dict]:
    return {row["map_id"]: row for row in body}


def soft_delete_map(map_id: int) -> None:
    async def _del(session):
        m = await session.get(ProcessMap, map_id)
        m.deleted_at = now_kst()

    _seed(_del)


def seed_approver(map_id: int, login: str = APPROVER) -> None:
    async def _add(session):
        session.add(MapApprover(map_id=map_id, user_id=login, assigned_by=SYSADMIN))

    _seed(_add)


def designate_directly(map_id: int) -> None:
    """PUT 경로를 우회한 직접 지정 재현 — decide-approve 경합 케이스용."""

    async def _set(session):
        m = await session.get(ProcessMap, map_id)
        m.sp_designated_at = now_kst()
        m.sp_department = "Race Dept"

    _seed(_set)


def _pending_sp_request(map_id: int) -> ApprovalRequest | None:
    async def _q(session):
        return await session.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.map_id == map_id,
                ApprovalRequest.kind == "sp_designation",
                ApprovalRequest.status == "pending",
            )
        )

    return _seed(_q)


def _notes_for_map(map_id: int) -> list[tuple[str, str]]:
    """맵 스코프 알림 (type, recipient) — 전역 테이블 오염 방지로 map_id 필터 필수."""

    async def _q(session):
        rows = await session.scalars(
            select(Notification).where(Notification.map_id == map_id)
        )
        return [(n.type, n.recipient) for n in rows.all()]

    return _seed(_q)


class TestLibraryUndesignated:
    def test_default_excludes_undesignated(self, client, enforce):
        designated_id = seed_sp_map("Lib Designated A", designated=True)
        undesignated_id = seed_sp_map("Lib Undesignated A")
        act_as(VIEWER)
        rows = _rows_by_id(client.get("/api/library/processes").json())
        assert designated_id in rows
        assert undesignated_id not in rows

    def test_designated_rows_have_designated_true(self, client, enforce):
        designated_id = seed_sp_map("Lib Designated B", designated=True)
        act_as(VIEWER)
        rows = _rows_by_id(client.get("/api/library/processes").json())
        assert rows[designated_id]["designated"] is True

    def test_flag_includes_visible_undesignated_with_masked_attrs(self, client, enforce):
        undesignated_id = seed_sp_map(
            "Lib Undesignated B", stale_department="Stale Dept"
        )
        act_as(VIEWER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        row = rows[undesignated_id]
        assert row["designated"] is False
        # 직전 지정 잔존값 유출 방지 — 미지정 행은 sp 어트리뷰트 마스킹
        assert row["department"] is None
        assert row["assignee"] is None
        assert row["system"] is None
        assert row["duration"] is None

    def test_flag_hides_private_undesignated_from_stranger(self, client, enforce):
        private_id = seed_sp_map("Lib Private Undesignated", visibility="private")
        act_as(STRANGER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        assert private_id not in rows
        # 권한 보유자(owner)에게는 보인다
        act_as(OWNER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        assert private_id in rows


class TestCreateSpRequest:
    def test_viewer_creates_pending_request_and_notifies_owner(self, client, enforce):
        host_id = seed_sp_map("SP Host Alpha")
        target_id = seed_sp_map("SP Target Alpha")
        act_as(VIEWER)
        r = client.post(
            f"/api/maps/{target_id}/sp-designation-requests",
            json={"from_map_id": host_id},
        )
        assert r.status_code == 201
        body = r.json()
        assert body["kind"] == "sp_designation"
        assert body["status"] == "pending"
        assert body["requested_by"] == VIEWER
        assert body["payload"] == {
            "from_map_id": host_id,
            "from_map_name": "SP Host Alpha",
            "map_name": "SP Target Alpha",
        }
        notes = _notes_for_map(target_id)
        assert ("sp_designation_requested", OWNER) in notes
        assert ("sp_designation_requested", VIEWER) not in notes

    def test_already_designated_409(self, client, enforce):
        target_id = seed_sp_map("SP Target Designated", designated=True)
        act_as(VIEWER)
        r = client.post(
            f"/api/maps/{target_id}/sp-designation-requests", json={"from_map_id": 0}
        )
        assert r.status_code == 409

    def test_duplicate_pending_409(self, client, enforce):
        host_id = seed_sp_map("SP Host Beta")
        target_id = seed_sp_map("SP Target Beta")
        act_as(VIEWER)
        assert (
            client.post(
                f"/api/maps/{target_id}/sp-designation-requests",
                json={"from_map_id": host_id},
            ).status_code
            == 201
        )
        act_as(EDITOR)
        r = client.post(
            f"/api/maps/{target_id}/sp-designation-requests",
            json={"from_map_id": host_id},
        )
        assert r.status_code == 409

    def test_deleted_map_404(self, client, enforce):
        target_id = seed_sp_map("SP Target Deleted")
        soft_delete_map(target_id)
        act_as(SYSADMIN)  # 삭제 맵은 권한 게이트보다 404 확인이 목적 — sysadmin으로 게이트 통과
        r = client.post(
            f"/api/maps/{target_id}/sp-designation-requests", json={"from_map_id": 0}
        )
        assert r.status_code == 404


class TestPendingWithdraw:
    def test_pending_null_then_row(self, client, enforce):
        host_id = seed_sp_map("SP Host Gamma")
        target_id = seed_sp_map("SP Target Gamma")
        act_as(VIEWER)
        assert (
            client.get(f"/api/maps/{target_id}/sp-designation-requests/pending").json()
            is None
        )
        client.post(
            f"/api/maps/{target_id}/sp-designation-requests",
            json={"from_map_id": host_id},
        )
        body = client.get(
            f"/api/maps/{target_id}/sp-designation-requests/pending"
        ).json()
        assert body["kind"] == "sp_designation"
        assert body["status"] == "pending"

    def test_withdraw_requester_only(self, client, enforce):
        host_id = seed_sp_map("SP Host Delta")
        target_id = seed_sp_map("SP Target Delta")
        act_as(VIEWER)
        client.post(
            f"/api/maps/{target_id}/sp-designation-requests",
            json={"from_map_id": host_id},
        )
        act_as(EDITOR)
        r = client.delete(f"/api/maps/{target_id}/sp-designation-requests/pending")
        assert r.status_code == 403

    def test_withdraw_ok_204(self, client, enforce):
        host_id = seed_sp_map("SP Host Epsilon")
        target_id = seed_sp_map("SP Target Epsilon")
        act_as(VIEWER)
        client.post(
            f"/api/maps/{target_id}/sp-designation-requests",
            json={"from_map_id": host_id},
        )
        r = client.delete(f"/api/maps/{target_id}/sp-designation-requests/pending")
        assert r.status_code == 204
        assert _pending_sp_request(target_id) is None

    def test_withdraw_no_pending_404(self, client, enforce):
        target_id = seed_sp_map("SP Target Zeta")
        act_as(VIEWER)
        r = client.delete(f"/api/maps/{target_id}/sp-designation-requests/pending")
        assert r.status_code == 404


def _make_sp_request(client, target_id: int, host_id: int, requester: str = VIEWER) -> int:
    act_as(requester)
    r = client.post(
        f"/api/maps/{target_id}/sp-designation-requests", json={"from_map_id": host_id}
    )
    assert r.status_code == 201
    return r.json()["id"]


class TestDecideSp:
    def test_owner_reject_notifies_requester(self, client, enforce):
        host_id = seed_sp_map("Decide Host A")
        target_id = seed_sp_map("Decide Target A")
        rid = _make_sp_request(client, target_id, host_id)
        act_as(OWNER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "reject"})
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        assert ("sp_designation_rejected", VIEWER) in _notes_for_map(target_id)

    def test_editor_decide_403(self, client, enforce):
        host_id = seed_sp_map("Decide Host B")
        target_id = seed_sp_map("Decide Target B")
        rid = _make_sp_request(client, target_id, host_id)
        act_as(EDITOR)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "reject"})
        assert r.status_code == 403

    def test_approver_non_owner_403(self, client, enforce):
        host_id = seed_sp_map("Decide Host C")
        target_id = seed_sp_map("Decide Target C")
        seed_approver(target_id)
        rid = _make_sp_request(client, target_id, host_id)
        act_as(APPROVER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "reject"})
        assert r.status_code == 403

    def test_approve_undesignated_409_stays_pending(self, client, enforce):
        host_id = seed_sp_map("Decide Host D")
        target_id = seed_sp_map("Decide Target D")
        rid = _make_sp_request(client, target_id, host_id)
        act_as(OWNER)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 409
        assert _pending_sp_request(target_id) is not None  # 커밋 전 중단 — pending 유지

    def test_approve_after_direct_designation_applied(self, client, enforce):
        host_id = seed_sp_map("Decide Host E")
        target_id = seed_sp_map("Decide Target E")
        rid = _make_sp_request(client, target_id, host_id)
        designate_directly(target_id)
        act_as(SYSADMIN)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 200
        assert r.json()["status"] == "applied"
        assert ("sp_designation_approved", VIEWER) in _notes_for_map(target_id)

    def test_approve_deleted_map_idempotent_applied(self, client, enforce):
        host_id = seed_sp_map("Decide Host F")
        target_id = seed_sp_map("Decide Target F")
        rid = _make_sp_request(client, target_id, host_id)
        soft_delete_map(target_id)
        act_as(SYSADMIN)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 200
        assert r.json()["status"] == "applied"


class TestAutoApplyOnDesignate:
    def test_put_designation_auto_applies_pending(self, client, enforce):
        host_id = seed_sp_map("AutoApply Host")
        target_id = seed_sp_map("AutoApply Target", published=True)
        _make_sp_request(client, target_id, host_id)
        act_as(OWNER)
        r = client.put(
            f"/api/maps/{target_id}/subprocess-designation",
            json={"department": "Ops Division"},
        )
        assert r.status_code == 200
        assert _pending_sp_request(target_id) is None
        assert ("sp_designation_approved", VIEWER) in _notes_for_map(target_id)

    def test_put_without_pending_still_works(self, client, enforce):
        target_id = seed_sp_map("AutoApply Solo", published=True)
        act_as(OWNER)
        r = client.put(
            f"/api/maps/{target_id}/subprocess-designation",
            json={"department": "Ops Division"},
        )
        assert r.status_code == 200


class TestInboxSp:
    def _titles_for(self, client, user: str) -> list[dict]:
        act_as(user)
        return [
            a
            for a in client.get("/api/inbox/approvals").json()
            if a["kind"] == "approval_request" and a["title"] == "sp_designation"
        ]

    def test_owner_sees_card_with_context(self, client, enforce):
        host_id = seed_sp_map("Inbox Host A")
        target_id = seed_sp_map("Inbox Target A")
        _make_sp_request(client, target_id, host_id)
        cards = [a for a in self._titles_for(client, OWNER) if a["map_id"] == target_id]
        assert len(cards) == 1
        assert cards[0]["detail"]["from_map_name"] == "Inbox Host A"
        assert cards[0]["requester"] == VIEWER

    def test_approver_non_owner_does_not_see(self, client, enforce):
        host_id = seed_sp_map("Inbox Host B")
        target_id = seed_sp_map("Inbox Target B")
        seed_approver(target_id)
        _make_sp_request(client, target_id, host_id)
        cards = [a for a in self._titles_for(client, APPROVER) if a["map_id"] == target_id]
        assert cards == []

    def test_deleted_map_hidden(self, client, enforce):
        host_id = seed_sp_map("Inbox Host C")
        target_id = seed_sp_map("Inbox Target C")
        _make_sp_request(client, target_id, host_id)
        soft_delete_map(target_id)
        cards = [a for a in self._titles_for(client, OWNER) if a["map_id"] == target_id]
        assert cards == []
