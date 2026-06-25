"""In-app notification tests — submit/publish side-effects + read (design 2026-06-14)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


_notif_seq = 0


def _pending_version(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _notif_seq
    _notif_seq += 1
    created = client.post("/api/maps", json={"name": f"notif map {_notif_seq}"}).json()
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
