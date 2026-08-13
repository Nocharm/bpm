"""버전 워크플로 단계 코멘트 — VersionEvent.note 스레딩 + 바로철회 동반삭제 (spec 2026-08-14)."""

from fastapi.testclient import TestClient

from app.settings import settings

_seq = 0


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    global _seq
    _seq += 1
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"cmt map {_seq}"},
    ).json()
    return created["id"], created["versions"][0]["id"]


def _events(client: TestClient, map_id: int, version_id: int) -> list[dict]:
    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    return version["events"]


def _submit(client: TestClient, map_id: int, version_id: int, comment: str | None = None):
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    body: dict = {}
    if comment is not None:
        body["comment"] = comment
    return client.post(f"/api/versions/{version_id}/submit", json=body)


def test_submit_comment_recorded(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    assert _submit(client, map_id, version_id, "please review the new branch").status_code == 200

    submitted = [e for e in _events(client, map_id, version_id) if e["event_type"] == "submitted"]
    assert submitted and submitted[-1]["note"] == "please review the new branch"


def test_approve_and_publish_comments_recorded(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id)

    ok_approve = client.post(f"/api/versions/{version_id}/approve", json={"comment": "lgtm"})
    ok_publish = client.post(f"/api/versions/{version_id}/publish", json={"comment": "shipping v1"})

    assert ok_approve.status_code == 200 and ok_publish.status_code == 200
    events = _events(client, map_id, version_id)
    assert next(e for e in events if e["event_type"] == "approved")["note"] == "lgtm"
    assert next(e for e in events if e["event_type"] == "published")["note"] == "shipping v1"


def test_withdraw_after_approval_records_comment(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "cycle 1")
    client.post(f"/api/versions/{version_id}/approve", json={})

    ok = client.post(f"/api/versions/{version_id}/withdraw", json={"comment": "rolling back"})

    assert ok.status_code == 200
    events = _events(client, map_id, version_id)
    assert next(e for e in events if e["event_type"] == "withdrawn")["note"] == "rolling back"
    # 승인 1건 이상 후 회수 → submitted 이력은 유지
    assert any(e["event_type"] == "submitted" and e["note"] == "cycle 1" for e in events)


def test_immediate_withdraw_deletes_submit_comment(client: TestClient) -> None:
    """승인 0건 회수 → submitted 이벤트(코멘트 포함) 하드삭제 + withdrawn 무기록."""
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "will vanish")

    ok = client.post(f"/api/versions/{version_id}/withdraw", json={"comment": "ignored"})

    assert ok.status_code == 200
    types = [e["event_type"] for e in _events(client, map_id, version_id)]
    assert "submitted" not in types and "withdrawn" not in types


def test_blank_comment_normalized_to_none(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "   ")

    submitted = [e for e in _events(client, map_id, version_id) if e["event_type"] == "submitted"]
    assert submitted and submitted[-1]["note"] is None
