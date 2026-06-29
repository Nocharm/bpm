"""Tests for version numbering (version_number) and expired status — Task 1."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings

_lc_seq = 0


def _create_map(client: TestClient) -> tuple[int, int]:
    """새 맵 생성 후 (map_id, initial_version_id) 반환."""
    global _lc_seq
    _lc_seq += 1
    created = client.post("/api/maps", json={"name": f"lc map {_lc_seq}"}).json()
    return created["id"], created["versions"][0]["id"]


def _publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    map_id: int,
    version_id: int,
) -> dict:
    """Checkout → submit → approve (approver='a') → publish. 게시된 VersionOut 반환."""
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    return client.post(f"/api/versions/{version_id}/publish").json()


def test_publish_numbers_and_expires(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    ① 첫 게시 → version_number == 1.
    ② 두 번째 게시 → 직전 published는 'expired'(approved 아님), 새 버전은 version_number == 2.
    ③ 만료된 버전의 version_number는 이후 게시에도 불변.
    """
    map_id, v1 = _create_map(client)

    # ① 첫 게시 → version_number 1
    result_v1 = _publish(client, monkeypatch, map_id, v1)
    assert result_v1["status"] == "published"
    assert result_v1["version_number"] == 1

    # v2 생성 (v1이 published → 새 버전 허용)
    v2 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be", "source_version_id": v1},
    ).json()["id"]

    # ② 두 번째 게시 → v1은 expired, v2는 version_number 2
    result_v2 = _publish(client, monkeypatch, map_id, v2)
    assert result_v2["status"] == "published"
    assert result_v2["version_number"] == 2

    detail = client.get(f"/api/maps/{map_id}").json()
    by_id = {v["id"]: v for v in detail["versions"]}

    assert by_id[v1]["status"] == "expired"        # approved 아님
    assert by_id[v1]["version_number"] == 1        # 불변

    # v3 생성 (v2가 published → 새 버전 허용)
    v3 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be v3", "source_version_id": v2},
    ).json()["id"]

    # ③ 세 번째 게시 → v2는 expired, v3는 version_number 3, v1 번호 불변
    result_v3 = _publish(client, monkeypatch, map_id, v3)
    assert result_v3["status"] == "published"
    assert result_v3["version_number"] == 3

    detail = client.get(f"/api/maps/{map_id}").json()
    by_id = {v["id"]: v for v in detail["versions"]}

    assert by_id[v1]["status"] == "expired"
    assert by_id[v1]["version_number"] == 1        # 만료 후에도 불변
    assert by_id[v2]["status"] == "expired"
    assert by_id[v2]["version_number"] == 2        # 만료 후에도 불변
    assert by_id[v3]["status"] == "published"
    assert by_id[v3]["version_number"] == 3
