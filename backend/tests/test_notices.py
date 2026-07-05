"""Notice tests — 게시기간 필터 / 관리 목록 / CRUD / 전체 알림 (design 2026-07-05)."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.clock import now
from app.settings import settings


def _create(
    client: TestClient,
    title: str,
    importance: str = "normal",
    starts: datetime | None = None,
    ends: datetime | None = None,
    notify_all: bool = False,
):
    payload = {
        "title": title,
        "body_md": "# hi",
        "importance": importance,
        "starts_at": (starts or now()).isoformat(),
        "ends_at": ends.isoformat() if ends else None,
        "notify_all": notify_all,
    }
    return client.post("/api/notices", json=payload)


def test_create_and_get(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_user", "admin.notice")
    res = _create(client, "release note")
    assert res.status_code == 201
    data = res.json()
    assert data["created_by"] == "admin.notice"
    assert data["importance"] == "normal"
    got = client.get(f"/api/notices/{data['id']}")
    assert got.status_code == 200
    assert got.json()["title"] == "release note"


def test_list_filters_by_period(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_user", "admin.notice")
    base = now()
    active = _create(client, "active-now").json()
    future = _create(client, "future", starts=base + timedelta(days=5)).json()
    ended = _create(
        client, "ended", starts=base - timedelta(days=10), ends=base - timedelta(days=1)
    ).json()

    ids = {n["id"] for n in client.get("/api/notices").json()}
    assert active["id"] in ids
    assert future["id"] not in ids
    assert ended["id"] not in ids

    manage_ids = {n["id"] for n in client.get("/api/notices/manage").json()}
    assert future["id"] in manage_ids
    assert ended["id"] in manage_ids


def test_patch_to_unlimited(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_user", "admin.notice")
    n = _create(client, "temp", ends=now() + timedelta(days=1)).json()
    patched = client.patch(
        f"/api/notices/{n['id']}", json={"importance": "important", "ends_at": None}
    )
    assert patched.status_code == 200
    assert patched.json()["importance"] == "important"
    assert patched.json()["ends_at"] is None


def test_notify_all_fans_out(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_user", "admin.notice")
    _create(client, "big announcement", notify_all=True)
    # 로컬 시드 활성 유저(admin.kim)가 공지 알림을 받았는지
    monkeypatch.setattr(settings, "dev_user", "admin.kim")
    notifs = client.get("/api/notifications?unread_only=true").json()
    assert any(
        n["type"] == "notice" and n["message"] == "big announcement" for n in notifs
    )


def test_delete(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_user", "admin.notice")
    n = _create(client, "to delete").json()
    assert client.delete(f"/api/notices/{n['id']}").status_code == 204
    assert client.get(f"/api/notices/{n['id']}").status_code == 404
