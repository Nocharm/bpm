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


def _notifications(client: TestClient, kind: str) -> list[dict]:
    return [n for n in client.get("/api/notifications").json() if n["type"] == kind]


def test_saving_reply_does_not_notify(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """답글 저장은 무통지 — 알림은 관리자가 버튼으로 명시 발송한다."""
    monkeypatch.setattr(settings, "dev_user", "fb-quiet")
    fb = _post(client, body="silent save")

    monkeypatch.setattr(settings, "dev_user", "fb-admin")
    ok = client.patch(f"/api/feedback/{fb['id']}", json={"reply": "on it"})
    assert ok.status_code == 200
    assert ok.json()["reply_notified_at"] is None

    monkeypatch.setattr(settings, "dev_user", "fb-quiet")
    assert _notifications(client, "feedback_reply") == []


def test_notify_reply_sends_and_is_resendable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-author")
    fb = _post(client, body="please fix the export button because it fails")

    monkeypatch.setattr(settings, "dev_user", "fb-admin")
    # 답글이 없으면 보낼 것이 없다
    assert client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "reply"}).status_code == 400
    client.patch(f"/api/feedback/{fb['id']}", json={"reply": "on it"})
    sent = client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "reply"})
    assert sent.status_code == 200
    assert sent.json()["reply_notified_at"] is not None

    monkeypatch.setattr(settings, "dev_user", "fb-author")
    mine = _notifications(client, "feedback_reply")
    assert len(mine) == 1
    assert "please fix the export button" in mine[0]["message"]

    # 답글 알림은 재발송 허용 — 답글을 고쳐 다시 알릴 수 있다
    monkeypatch.setattr(settings, "dev_user", "fb-admin")
    assert client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "reply"}).status_code == 200
    monkeypatch.setattr(settings, "dev_user", "fb-author")
    assert len(_notifications(client, "feedback_reply")) == 2


def test_notify_status_is_once_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-st-author")
    fb = _post(client, body="status change please")

    monkeypatch.setattr(settings, "dev_user", "fb-admin")
    client.patch(f"/api/feedback/{fb['id']}", json={"status": "in_progress"})
    first = client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "status"})
    assert first.status_code == 200
    assert first.json()["status_notified_at"] is not None
    # 1회 한정 — 두 번째는 차단
    assert client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "status"}).status_code == 400

    monkeypatch.setattr(settings, "dev_user", "fb-st-author")
    mine = _notifications(client, "feedback_status")
    assert len(mine) == 1
    assert "In progress" in mine[0]["message"]


def test_notify_requires_sysadmin_and_other_author(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-plain")
    fb = _post(client, body="who can notify")
    monkeypatch.setattr(settings, "dev_user", "fb-admin")
    client.patch(f"/api/feedback/{fb['id']}", json={"reply": "hi"})

    # 비관리자 차단 — 로컬 기본은 전원 sysadmin이라 권한 시뮬레이션을 켜고 검증
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "fb-admin")
    monkeypatch.setattr(settings, "dev_user", "fb-other")
    assert client.post(f"/api/feedback/{fb['id']}/notify", json={"kind": "reply"}).status_code == 403
    monkeypatch.setattr(settings, "dev_enforce_permissions", False)

    # 본인 피드백에 본인이 발송 — 자기 자신에게 알림은 무의미하므로 차단
    monkeypatch.setattr(settings, "dev_user", "fb-selfadmin")
    own = _post(client, body="mine")
    client.patch(f"/api/feedback/{own['id']}", json={"reply": "ack"})
    assert client.post(f"/api/feedback/{own['id']}/notify", json={"kind": "reply"}).status_code == 400


def test_notes_are_open_to_everyone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-note-author")
    fb = _post(client, body="needs notes")

    # 작성자가 아닌 사람도 노트를 달 수 있다
    monkeypatch.setattr(settings, "dev_user", "fb-passerby")
    created = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "reproduced on chrome"})
    assert created.status_code == 201
    assert created.json()["author"] == "fb-passerby"

    monkeypatch.setattr(settings, "dev_user", "fb-note-author")
    client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "thanks"})

    notes = client.get(f"/api/feedback/{fb['id']}/notes").json()
    assert [n["body"] for n in notes] == ["reproduced on chrome", "thanks"]  # 시간순 로그
    assert client.post(f"/api/feedback/{fb['id']}/notes", json={"body": ""}).status_code == 422
    assert client.get("/api/feedback/99999/notes").status_code == 404


def test_note_edit_keeps_revision_history(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """수정은 가능하되 직전 본문이 이력으로 남는다."""
    monkeypatch.setattr(settings, "dev_user", "fb-editor")
    fb = _post(client, body="editable notes")
    note = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "first draft"}).json()

    edited = client.patch(
        f"/api/feedback/{fb['id']}/notes/{note['id']}", json={"body": "second draft"}
    )
    assert edited.status_code == 200
    assert edited.json()["body"] == "second draft"
    assert edited.json()["edited_at"] is not None

    revisions = client.get(f"/api/feedback/{fb['id']}/notes/{note['id']}/revisions").json()
    assert [r["body"] for r in revisions] == ["first draft"]

    # 다른 사람은 남의 노트를 고칠 수 없다
    monkeypatch.setattr(settings, "dev_user", "fb-stranger")
    blocked = client.patch(
        f"/api/feedback/{fb['id']}/notes/{note['id']}", json={"body": "hijack"}
    )
    assert blocked.status_code == 403


def test_note_delete_is_archive_not_permanent(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-arch")
    fb = _post(client, body="archive me")
    note = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "temporary"}).json()

    archived = client.post(f"/api/feedback/{fb['id']}/notes/{note['id']}/archive")
    assert archived.status_code == 200
    assert archived.json()["archived_at"] is not None

    # 기본 목록에서는 숨고, 행 자체는 남아 include_archived로 보인다
    assert client.get(f"/api/feedback/{fb['id']}/notes").json() == []
    kept = client.get(f"/api/feedback/{fb['id']}/notes?include_archived=true").json()
    assert [n["id"] for n in kept] == [note["id"]]

    # 아카이브된 노트는 수정 불가
    assert (
        client.patch(
            f"/api/feedback/{fb['id']}/notes/{note['id']}", json={"body": "edit after archive"}
        ).status_code
        == 400
    )


def test_admin_purge_removes_archived_notes_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """영구 삭제는 관리자 퍼지에서만 — 살아있는 노트는 남는다."""
    monkeypatch.setattr(settings, "dev_user", "fb-purge")
    fb = _post(client, body="purge target")
    keep = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "keep me"}).json()
    drop = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "drop me"}).json()
    client.patch(f"/api/feedback/{fb['id']}/notes/{drop['id']}", json={"body": "drop me v2"})
    client.post(f"/api/feedback/{fb['id']}/notes/{drop['id']}/archive")

    purged = client.post("/api/admin/feedback-notes/purge-archived")
    assert purged.status_code == 200
    # 퍼지는 전역(다른 테스트가 남긴 아카이브도 함께) — 이 노트가 지워졌는지는 아래 행으로 단언
    assert purged.json()["deleted"] >= 1

    remaining = client.get(f"/api/feedback/{fb['id']}/notes?include_archived=true").json()
    assert [n["id"] for n in remaining] == [keep["id"]]
    # 이력도 함께 사라진다
    assert client.get(f"/api/feedback/{fb['id']}/notes/{drop['id']}/revisions").status_code == 404


def test_deleting_feedback_cleans_up_notes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_user", "fb-cascade")
    fb = _post(client, body="draft with notes")
    note = client.post(f"/api/feedback/{fb['id']}/notes", json={"body": "note on draft"}).json()
    client.patch(f"/api/feedback/{fb['id']}/notes/{note['id']}", json={"body": "edited"})

    assert client.delete(f"/api/feedback/{fb['id']}").status_code == 204
    assert client.get(f"/api/feedback/{fb['id']}/notes").status_code == 404
