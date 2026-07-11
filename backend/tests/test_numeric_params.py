"""숫자 파라미터 4필드 — 저장/응답 왕복 + 무효값 경계 소거."""

from fastapi.testclient import TestClient


_numeric_seq = 0


def _create_version(client: TestClient) -> int:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름 (test_graph.py 패턴 미러)
    global _numeric_seq
    _numeric_seq += 1
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"numeric map {_numeric_seq}"},
    ).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


def _node(node_id: str, **overrides: object) -> dict:
    base = {
        "id": node_id, "title": node_id, "node_type": "process",
        "pos_x": 0, "pos_y": 0, "sort_order": 0,
    }
    base.update(overrides)
    return base


def test_numeric_params_round_trip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np1-s1", node_type="start"),
            _node("np1-p1", duration="0.75", headcount="2", etf="1.5", cost="300", extra="7"),
            _node("np1-e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "np1-ed1", "source_node_id": "np1-s1", "target_node_id": "np1-p1", "label": ""},
            {"id": "np1-ed2", "source_node_id": "np1-p1", "target_node_id": "np1-e1", "label": ""},
        ],
        "groups": [],
    }
    resp = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert resp.status_code == 200
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "np1-p1")
    assert node["duration"] == "1.15"  # 0.75 → 60분 이월
    assert (node["headcount"], node["etf"], node["cost"], node["extra"]) == ("2", "1.5", "300", "7")


def test_invalid_numeric_cleared_at_boundary(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np2-s1", node_type="start"),
            _node("np2-p1", duration="2일", headcount="두명", etf="", cost="1.2.3", extra="x"),
            _node("np2-e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "np2-ed1", "source_node_id": "np2-s1", "target_node_id": "np2-p1", "label": ""},
            {"id": "np2-ed2", "source_node_id": "np2-p1", "target_node_id": "np2-e1", "label": ""},
        ],
        "groups": [],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "np2-p1")
    assert node["duration"] == ""
    assert (node["headcount"], node["etf"], node["cost"], node["extra"]) == ("", "", "", "")


def test_numeric_params_upsert_path_updates_existing_node(client: TestClient) -> None:
    """두 번째 PUT은 기존 노드 갱신(upsert existing 분기)을 지난다 — graph.py 필드 열거 검증."""
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np3-s1", node_type="start"),
            _node("np3-p1", headcount="1"),
            _node("np3-e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "np3-ed1", "source_node_id": "np3-s1", "target_node_id": "np3-p1", "label": ""},
            {"id": "np3-ed2", "source_node_id": "np3-p1", "target_node_id": "np3-e1", "label": ""},
        ],
        "groups": [],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)

    graph["nodes"][1] = _node("np3-p1", headcount="4", etf="0.5", cost="10", extra="1")
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "np3-p1")
    assert (node["headcount"], node["etf"], node["cost"], node["extra"]) == ("4", "0.5", "10", "1")
