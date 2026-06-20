"""하위프로세스 검증·순환·해석 테스트."""

from fastapi.testclient import TestClient


def _new_version(client: TestClient, name: str = "p") -> int:
    return client.post("/api/maps", json={"name": name}).json()["versions"][0]["id"]


def test_rejects_two_starts(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s1", "node_type": "start"},
                {"id": "s2", "node_type": "start"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "시작" in r.json()["detail"]


def test_rejects_duplicate_end_names(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "e1", "title": "종료", "node_type": "end"},
                {"id": "e2", "title": "종료", "node_type": "end"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "끝" in r.json()["detail"]


def test_accepts_valid_process(client: TestClient) -> None:
    vid = _new_version(client)
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "e1", "title": "승인", "node_type": "end", "is_primary_end": True},
                {"id": "e2", "title": "반려", "node_type": "end"},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 200


def _map_and_version(client: TestClient, name: str) -> tuple[int, int]:
    created = client.post("/api/maps", json={"name": name}).json()
    return created["id"], created["versions"][0]["id"]


def test_rejects_indirect_cycle(client: TestClient) -> None:
    a_id, a_vid = _map_and_version(client, "cycle-A")
    b_id, b_vid = _map_and_version(client, "cycle-B")
    # B → A (saved first, valid)
    client.put(f"/api/versions/{b_vid}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start"},
            {"id": "sub", "node_type": "subprocess", "linked_map_id": a_id},
            {"id": "e", "node_type": "end", "is_primary_end": True},
        ],
        "edges": [],
    })
    # A → B now forms A→B→A → must be rejected
    r = client.put(f"/api/versions/{a_vid}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start"},
            {"id": "sub", "node_type": "subprocess", "linked_map_id": b_id},
            {"id": "e", "node_type": "end", "is_primary_end": True},
        ],
        "edges": [],
    })
    assert r.status_code == 422
    assert "순환" in r.json()["detail"]


def test_rejects_self_reference(client: TestClient) -> None:
    map_id, vid = _map_and_version(client, "selfref")
    r = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "sub", "node_type": "subprocess", "linked_map_id": map_id},
                {"id": "e", "node_type": "end", "is_primary_end": True},
            ],
            "edges": [],
        },
    )
    assert r.status_code == 422
    assert "순환" in r.json()["detail"]


def test_library_lists_processes(client: TestClient) -> None:
    client.post("/api/maps", json={"name": "재사용 프로세스"})
    r = client.get("/api/library/processes")
    assert r.status_code == 200
    names = [p["name"] for p in r.json()]
    assert "재사용 프로세스" in names


def test_resolved_returns_pinned_graph(client: TestClient) -> None:
    map_id, vid = _map_and_version(client, "lib-target")
    client.put(
        f"/api/versions/{vid}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}], "edges": []},
    )
    r = client.get(
        f"/api/library/processes/{map_id}/resolved",
        params={"follow_latest": "false", "pinned": vid},
    )
    assert r.status_code == 200
    assert [n["id"] for n in r.json()["nodes"]] == ["s"]
