"""In-app notification tests — submit/publish side-effects + read (design 2026-06-14)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings
from app.workflow import create_notifications


_notif_seq = 0


def _add_employee(login_id: str, name: str) -> None:
    """디렉터리에 이름 있는 직원 1명 추가 — 알림 메시지 이름 해석 테스트용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(Employee(login_id=login_id, name=name, source="local"))
            await session.commit()

    asyncio.run(_run())


def _ensure_employee(login_id: str) -> None:
    """승인자 직원 행 지연 시드 — 전역 선시드하면 공지 브로드캐스트 수신자에 섞여 개수 단언 오염."""

    async def _run() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, login_id) is None:
                session.add(Employee(login_id=login_id, name=login_id, source="local", active=True))
                await session.commit()

    asyncio.run(_run())


def _pending_version(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _notif_seq
    _notif_seq += 1
    for approver in approvers:
        _ensure_employee(approver)  # 정족수 의미론(직원 행 필수, 2026-07-09)
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"notif map {_notif_seq}"}).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    return map_id, version_id


def test_submit_notifies_each_approver(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # unique users per test to avoid cross-test notification leakage in session-scoped DB
    _map_id, _version_id = _pending_version(client, ["notif-a1", "notif-b1"])

    monkeypatch.setattr(settings, "dev_user", "notif-a1")
    a_notifs = client.get("/api/notifications?unread_only=true").json()
    monkeypatch.setattr(settings, "dev_user", "notif-b1")
    b_notifs = client.get("/api/notifications?unread_only=true").json()

    assert len(a_notifs) == 1
    assert a_notifs[0]["type"] == "review_requested"
    assert len(b_notifs) == 1


def test_submit_notification_uses_requester_name(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """알림 메시지는 요청자 login_id 대신 등록된 이름을 노출한다 (id→name)."""
    _add_employee("req.named", "Named Requester")
    monkeypatch.setattr(settings, "dev_user", "req.named")
    _pending_version(client, ["notif-appr-name"])

    monkeypatch.setattr(settings, "dev_user", "notif-appr-name")
    message = client.get("/api/notifications?unread_only=true").json()[0]["message"]
    assert "Named Requester" in message
    assert "req.named" not in message


def test_mark_read_filters_unread(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, _version_id = _pending_version(client, ["notif-a2"])

    monkeypatch.setattr(settings, "dev_user", "notif-a2")
    notif_id = client.get("/api/notifications?unread_only=true").json()[0]["id"]
    read = client.post(f"/api/notifications/{notif_id}/read")
    remaining = client.get("/api/notifications?unread_only=true").json()

    assert read.status_code == 200
    assert read.json()["read"] is True
    assert remaining == []


def test_mark_read_other_recipient_404(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, _version_id = _pending_version(client, ["notif-a3"])
    monkeypatch.setattr(settings, "dev_user", "notif-a3")
    notif_id = client.get("/api/notifications").json()[0]["id"]

    monkeypatch.setattr(settings, "dev_user", "notif-b3")
    forbidden = client.post(f"/api/notifications/{notif_id}/read")
    assert forbidden.status_code == 404


def test_read_all_marks_every_unread(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _pending_version(client, ["notif-rall"])
    monkeypatch.setattr(settings, "dev_user", "notif-rall")
    assert len(client.get("/api/notifications?unread_only=true").json()) >= 1
    resp = client.post("/api/notifications/read-all")
    assert resp.status_code == 204
    assert client.get("/api/notifications?unread_only=true").json() == []


def test_notification_cap_trims_oldest(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """인당 100개 초과분은 읽음 여부 무관 오래된 순 삭제 — 생성 시점 트리밍."""

    async def _run() -> None:
        async with SessionLocal() as session:
            for i in range(105):
                await create_notifications(
                    session, ["cap-user"], type="notice", message=f"cap {i}"
                )
            await session.commit()

    asyncio.run(_run())
    monkeypatch.setattr(settings, "dev_user", "cap-user")
    items = client.get("/api/notifications").json()
    assert len(items) == 100
    messages = {n["message"] for n in items}
    assert "cap 104" in messages  # 최신 생존
    assert "cap 4" not in messages  # 최고령 5개(0..4) 삭제


def _checkout_map(client: TestClient, monkeypatch: pytest.MonkeyPatch, owner: str, seq: str) -> tuple[int, int]:
    """owner가 맵 생성(+v1 점유). 반환 (map_id, version_id)."""
    monkeypatch.setattr(settings, "dev_user", owner)
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"co map {seq}"},
    ).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})  # 이미 점유 중이면 409 — 무시
    return map_id, version_id


def test_checkout_request_notifies_holder_and_owner(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """점유 요청 → 현 점유자+오너에게 checkout_requested (요청자 제외, 중복 제거로 1건)."""
    _map_id, version_id = _checkout_map(client, monkeypatch, "co-owner1", "n1")
    monkeypatch.setattr(settings, "dev_user", "co-req1")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 201

    monkeypatch.setattr(settings, "dev_user", "co-owner1")
    got = [n for n in client.get("/api/notifications?unread_only=true").json() if n["type"] == "checkout_requested"]
    assert len(got) == 1  # holder==owner 중복 제거
    assert got[0]["version_id"] == version_id
    monkeypatch.setattr(settings, "dev_user", "co-req1")
    assert [n for n in client.get("/api/notifications").json() if n["type"] == "checkout_requested"] == []


def test_checkout_decision_notifies_requester(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """승인/거절 결과가 요청자에게 checkout_approved/rejected로 간다."""
    _map_id, version_id = _checkout_map(client, monkeypatch, "co-owner2", "n2")
    monkeypatch.setattr(settings, "dev_user", "co-req2")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]
    monkeypatch.setattr(settings, "dev_user", "co-owner2")
    assert client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": False}).status_code == 200

    monkeypatch.setattr(settings, "dev_user", "co-req2")
    types = [n["type"] for n in client.get("/api/notifications?unread_only=true").json()]
    assert "checkout_rejected" in types


def test_checkout_approve_notifies_winner_and_auto_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """승인 시 승자에게 checkout_approved, 자동거절된 다른 미결 요청자에게 checkout_rejected."""
    _map_id, version_id = _checkout_map(client, monkeypatch, "co-owner3", "n3")
    monkeypatch.setattr(settings, "dev_user", "co-req3a")
    req_a_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]
    monkeypatch.setattr(settings, "dev_user", "co-req3b")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 201

    monkeypatch.setattr(settings, "dev_user", "co-owner3")
    assert client.post(f"/api/checkout-requests/{req_a_id}/decide", json={"approve": True}).status_code == 200

    monkeypatch.setattr(settings, "dev_user", "co-req3a")
    approved = [n for n in client.get("/api/notifications?unread_only=true").json() if n["type"] == "checkout_approved"]
    assert len(approved) == 1
    assert "approved" in approved[0]["message"]
    monkeypatch.setattr(settings, "dev_user", "co-req3b")
    rejected = [n for n in client.get("/api/notifications?unread_only=true").json() if n["type"] == "checkout_rejected"]
    assert len(rejected) == 1  # 벌크 자동거절 전 캡처된 통지
