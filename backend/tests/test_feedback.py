"""Feedback tests — create / list / partial update (perms) / delete (design 2026-07-05)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _post(client: TestClient, kind: str = "bug", body: str = "body") -> dict:
    return client.post("/api/feedback", json={"kind": kind, "body": body}).json()


def test_create_defaults_to_draft(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-create")
    res = client.post(
        "/api/feedback",
        json={"kind": "bug", "body": "overlap", "context": {"route": "/maps/7"}},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["author"] == "fb-create"
    assert data["status"] == "draft"
    assert data["reply"] == ""
    assert data["done_at"] is None
    assert data["body_edited_at"] is None
    assert data["reply_at"] is None


def test_list_counts_reflect_mine(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-list")
    _post(client, "bug", "b1")
    _post(client, "suggestion", "s1")
    listing = client.get("/api/feedback").json()
    mine = [f for f in listing["items"] if f["author"] == "fb-list"]
    assert len(mine) == 2
    assert listing["counts"]["mine"] == 2


def test_status_change_stamps_done_at(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-status")
    fb = _post(client)
    done = client.patch(f"/api/feedback/{fb['id']}", json={"status": "done"})
    assert done.status_code == 200
    assert done.json()["status"] == "done"
    assert done.json()["done_at"] is not None
    reopened = client.patch(f"/api/feedback/{fb['id']}", json={"status": "in_progress"})
    assert reopened.json()["done_at"] is None


def test_reply_locked_when_done(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-reply")
    fb = _post(client)
    ok = client.patch(f"/api/feedback/{fb['id']}", json={"reply": "looking into it"})
    assert ok.status_code == 200
    assert ok.json()["reply"] == "looking into it"
    assert ok.json()["reply_at"] is not None
    client.patch(f"/api/feedback/{fb['id']}", json={"status": "done"})
    locked = client.patch(f"/api/feedback/{fb['id']}", json={"reply": "more"})
    assert locked.status_code == 400


def test_body_edit_author_draft_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-body")
    fb = _post(client, "bug", "original")
    edited = client.patch(f"/api/feedback/{fb['id']}", json={"body": "edited"})
    assert edited.status_code == 200
    assert edited.json()["body"] == "edited"
    assert edited.json()["body_edited_at"] is not None

    # 다른 사용자는 본문 수정 불가
    monkeypatch.setattr(settings, "dev_user", "fb-body-other")
    forbidden = client.patch(f"/api/feedback/{fb['id']}", json={"body": "hack"})
    assert forbidden.status_code == 403

    # draft가 아니면 작성자도 수정 불가
    client.patch(f"/api/feedback/{fb['id']}", json={"status": "in_progress"})
    monkeypatch.setattr(settings, "dev_user", "fb-body")
    blocked = client.patch(f"/api/feedback/{fb['id']}", json={"body": "late"})
    assert blocked.status_code == 400


def test_delete_author_draft_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-del")
    fb = _post(client)
    # draft가 아니면 삭제 불가
    client.patch(f"/api/feedback/{fb['id']}", json={"status": "in_progress"})
    blocked = client.delete(f"/api/feedback/{fb['id']}")
    assert blocked.status_code == 403
    # draft로 되돌리면 작성자 삭제 가능
    client.patch(f"/api/feedback/{fb['id']}", json={"status": "draft"})
    ok = client.delete(f"/api/feedback/{fb['id']}")
    assert ok.status_code == 204


def test_create_rejects_blank_body(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-blank")
    res = client.post("/api/feedback", json={"kind": "etc", "body": ""})
    assert res.status_code == 422
