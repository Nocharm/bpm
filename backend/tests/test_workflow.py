"""Version approval workflow — transitions, guards, permissions (design 2026-06-14).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증된다. 다중 사용자
시나리오는 dev_user를 monkeypatch로 바꿔 재현한다 (tests/test_collab.py 패턴).
"""

from fastapi.testclient import TestClient


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
