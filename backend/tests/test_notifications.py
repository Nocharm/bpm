"""In-app notification tests — submit/publish side-effects + read (design 2026-06-14)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


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
