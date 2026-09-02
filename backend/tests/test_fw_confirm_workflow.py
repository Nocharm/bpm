"""확정 요청 승인 워크플로우 테스트 — kind='fw_confirm' (spec 2026-09-02 §5, Track B Task 5).

test_map_rename_workflow.py 구조를 준용. 캔버스 셋업은 test_framework_canvas.py의
카테고리/L6/체크아웃 헬퍼를 재사용한다(client 픽스처가 세션 스코프 공유 DB — 카테고리
코드는 이 파일 전용 접두사(FWCF-*)로 격리).
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import ApprovalRequest, Notification
from app.settings import settings
from tests.test_framework_canvas import (
    SYSADMIN,
    _checkout,
    _put_graph,
    _seed_category,
    _seed_l6_map,
    act_as,
)

UPPER = "fwct5.upper"    # L1 상위 체인 관리자 — 요청만 가능(직속 아님)
DIRECT = "fwct5.direct"  # L5 직속 관리자 — can_confirm, decide 처리자


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + test_framework_canvas와 동일 sysadmin — 카테고리 권한 PUT은 sysadmin 전용."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def _seed(coro_factory):
    async def _run():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def _make_hierarchical_canvas(client: TestClient, code: str, name: str) -> tuple[int, int]:
    """L1(UPPER)+L5(DIRECT) 연계 캔버스 — L6 1개 연결, draft는 DIRECT가 체크아웃.

    test_framework_canvas._make_canvas와 달리 상위 체인 관리자를 별도로 둬 "요청은 상위,
    확정은 직속" 워크플로를 시험한다. 게이트 통과형이라 DIRECT가 그대로 confirm하면 200 —
    게이트 위반 시나리오는 호출부가 별도로 미해소 상태(플레이스홀더 등)를 만든다.
    """
    l1 = _seed_category(client, f"{code}-L1", f"{name}L1")
    l5 = _seed_category(client, f"{code}-L5", f"{name}L5", level=5, parent_id=l1)
    _seed_l6_map(client, l5, f"{name}업무1", f"{code}M1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": UPPER}]})
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": DIRECT}]})
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    act_as(DIRECT)
    _checkout(client, draft["id"])
    return map_id, draft["id"]


def _pending(map_id: int) -> ApprovalRequest | None:
    async def _q(session):
        return await session.scalar(
            select(ApprovalRequest).where(
                ApprovalRequest.map_id == map_id,
                ApprovalRequest.kind == "fw_confirm",
                ApprovalRequest.status == "pending",
            )
        )

    return _seed(_q)


def _notes_for(map_id: int) -> list[tuple[str, str]]:
    async def _q(session):
        rows = await session.scalars(select(Notification).where(Notification.map_id == map_id))
        return [(n.type, n.recipient) for n in rows.all()]

    return _seed(_q)


class TestCreateFwConfirmRequest:
    def test_request_created_and_notifies_l5_admins(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-REQ", "요청확정")
        act_as(UPPER)
        r = client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={"note": "please confirm"})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["kind"] == "fw_confirm"
        assert body["status"] == "pending"
        assert body["requested_by"] == UPPER
        assert body["payload"]["note"] == "please confirm"

        notes = _notes_for(map_id)
        assert ("fw_confirm_requested", DIRECT) in notes
        assert all(rcpt != UPPER for _, rcpt in notes)

    def test_second_pending_request_conflicts(self, client: TestClient, enforce: None) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-DUP", "중복확정")
        act_as(UPPER)
        assert client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={}).status_code == 201
        r = client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={})
        assert r.status_code == 409

    def test_direct_l5_admin_cannot_request(self, client: TestClient, enforce: None) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-DIR", "직속확정")
        act_as(DIRECT)  # can_confirm 보유자 — 요청 대신 직접 확정
        r = client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={})
        assert r.status_code == 409
        assert r.json()["detail"] == "you can confirm directly"


class TestDecideFwConfirmRequest:
    def _make_request(self, client: TestClient, map_id: int) -> int:
        act_as(UPPER)
        r = client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={"note": "go"})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_decide_approve_runs_confirm_with_gates(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-OK", "게이트통과")
        rid = self._make_request(client, map_id)
        act_as(DIRECT)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "applied"

        detail = client.get(f"/api/maps/{map_id}").json()
        confirmed = [v for v in detail["versions"] if v["status"] == "confirmed"]
        assert len(confirmed) == 1 and confirmed[0]["label"] == "v1.0"

        notes = _notes_for(map_id)
        assert ("fw_confirm_done", UPPER) in notes

    def test_decide_approve_fails_on_gate_violation(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, draft_id = _make_hierarchical_canvas(client, "FWCF-GATE", "게이트위반")
        # 플레이스홀더(미해소 링크) 유입 — 확정 게이트 6종 중 placeholder 위반을 만든다
        act_as(DIRECT)
        graph = client.get(f"/api/versions/{draft_id}/graph").json()
        node = graph["nodes"][0]
        ph = dict(node, id="fwcf-gate-ph-1", title="자리", linked_map_id=None)
        _put_graph(client, draft_id, [node, ph])
        rid = self._make_request(client, map_id)
        act_as(DIRECT)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 422
        assert "placeholder" in r.json()["detail"]
        assert _pending(map_id) is not None

    def test_decide_reject_records_reason(self, client: TestClient, enforce: None) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-REJ", "반려확정")
        rid = self._make_request(client, map_id)
        act_as(DIRECT)
        r = client.post(
            f"/api/approval-requests/{rid}/decide",
            json={"decision": "reject", "reason": "not ready"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        assert r.json()["decision_reason"] == "not ready"

        notes = _notes_for(map_id)
        assert ("fw_confirm_rejected", UPPER) in notes

    def test_decide_requires_direct_l5_or_sysadmin(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-403", "권한확정")
        rid = self._make_request(client, map_id)
        act_as(UPPER)  # 요청자 본인(상위 체인 관리자·editor 등급이나 직속 아님)
        r = client.post(f"/api/approval-requests/{rid}/decide", json={"decision": "approve"})
        assert r.status_code == 403


class TestDirectConfirmSupersedesPending:
    def test_direct_confirm_supersedes_pending(self, client: TestClient, enforce: None) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-SUP", "슈퍼시드")
        act_as(UPPER)
        client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={})
        act_as(DIRECT)
        r = client.post(f"/api/maps/{map_id}/framework-confirm", json={})
        assert r.status_code == 200, r.text
        assert _pending(map_id) is None

        async def _req(session):
            return await session.scalar(
                select(ApprovalRequest).where(
                    ApprovalRequest.map_id == map_id,
                    ApprovalRequest.kind == "fw_confirm",
                )
            )

        req = _seed(_req)
        assert req.status == "superseded"


class TestListApprovalRequestsFrameworkAccess:
    """GET /maps/{map_id}/approval-requests — framework 맵에선 owner=sysadmin뿐이라
    카테고리 체인 관리자(직속·상위)도 통과해야 fw_confirm 카드가 실제 처리자/요청자에게
    보인다 (Task 7 리뷰가 실증한 공백, Task 5 후속 fix)."""

    def test_direct_l5_admin_lists_pending_fw_confirm(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-LST-DIR", "목록직속")
        act_as(UPPER)
        client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={})
        act_as(DIRECT)
        r = client.get(f"/api/maps/{map_id}/approval-requests")
        assert r.status_code == 200, r.text
        kinds = [row["kind"] for row in r.json()]
        assert "fw_confirm" in kinds

    def test_requester_lists_own_pending_fw_confirm(
        self, client: TestClient, enforce: None
    ) -> None:
        map_id, _ = _make_hierarchical_canvas(client, "FWCF-LST-UP", "목록상위")
        act_as(UPPER)
        client.post(f"/api/maps/{map_id}/fw-confirm-requests", json={})
        r = client.get(f"/api/maps/{map_id}/approval-requests")
        assert r.status_code == 200, r.text
        kinds = [row["kind"] for row in r.json()]
        assert "fw_confirm" in kinds
