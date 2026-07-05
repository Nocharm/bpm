"""Feedback tests — create / list+counts / status patch (design 2026-07-05)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _post(client: TestClient, kind: str, body: str) -> dict:
    return client.post("/api/feedback", json={"kind": kind, "body": body}).json()


def test_create_sets_author_and_defaults(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-author-1")
    res = client.post(
        "/api/feedback",
        json={
            "kind": "bug",
            "body": "auto sort overlaps",
            "context": {"route": "/maps/7"},
        },
    )
    assert res.status_code == 201
    data = res.json()
    assert data["author"] == "fb-author-1"
    assert data["kind"] == "bug"
    assert data["status"] == "new"
    assert data["context"] == {"route": "/maps/7"}


def test_list_counts_reflect_mine(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-author-2")
    _post(client, "bug", "b1")
    _post(client, "suggestion", "s1")

    listing = client.get("/api/feedback").json()
    mine = [f for f in listing["items"] if f["author"] == "fb-author-2"]
    assert len(mine) == 2
    assert listing["counts"]["mine"] == 2
    assert listing["counts"]["total"] >= 2


def test_patch_status_updates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-author-3")
    fb = _post(client, "question", "q1")

    patched = client.patch(f"/api/feedback/{fb['id']}", json={"status": "in_progress"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "in_progress"


def test_create_rejects_blank_body(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-author-4")
    res = client.post("/api/feedback", json={"kind": "etc", "body": ""})
    assert res.status_code == 422
