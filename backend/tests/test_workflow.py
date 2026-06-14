"""Version approval workflow — transitions, guards, permissions (design 2026-06-14).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증된다. 다중 사용자
시나리오는 dev_user를 monkeypatch로 바꿔 재현한다 (tests/test_collab.py 패턴).
"""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": "wf map"}).json()
    return created["id"], created["versions"][0]["id"]


def test_new_version_defaults_to_draft(client: TestClient) -> None:
    _map_id, version_id = _create_map_with_version(client)

    detail = client.get(f"/api/maps/{_map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)

    assert version["status"] == "draft"
    assert version["submitted_by"] is None
    assert version["reject_reason"] is None


def test_is_editable_status() -> None:
    from app import workflow

    assert workflow.is_editable_status("draft") is True
    assert workflow.is_editable_status("rejected") is True
    assert workflow.is_editable_status("pending") is False
    assert workflow.is_editable_status("approved") is False
    assert workflow.is_editable_status("published") is False


def test_set_and_list_approvers(client: TestClient) -> None:
    map_id, _version_id = _create_map_with_version(client)

    put = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss", "lead"]})
    listed = client.get(f"/api/maps/{map_id}/approvers").json()

    assert put.status_code == 200
    assert listed == ["boss", "lead"]


def test_set_approvers_owner_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    map_id, _version_id = _create_map_with_version(client)

    monkeypatch.setattr(settings, "dev_user", "intruder")
    forbidden = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["x"]})

    assert forbidden.status_code == 403
