"""Canvas graph read/replace tests."""

from fastapi.testclient import TestClient


def _create_version(client: TestClient) -> int:
    created = client.post("/api/maps", json={"name": "graph map"}).json()
    return created["versions"][0]["id"]


def test_new_version_has_empty_graph(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.get(f"/api/versions/{version_id}/graph")

    assert response.status_code == 200
    assert response.json() == {"nodes": [], "edges": []}


def test_replace_graph_roundtrips(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "시작", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "n2", "title": "검토", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [
            {"id": "e1", "source_node_id": "n1", "target_node_id": "n2", "label": ""}
        ],
    }

    put_response = client.put(f"/api/versions/{version_id}/graph", json=graph)
    get_response = client.get(f"/api/versions/{version_id}/graph")

    assert put_response.status_code == 200
    saved = get_response.json()
    assert {n["id"] for n in saved["nodes"]} == {"n1", "n2"}
    assert saved["edges"][0]["source_node_id"] == "n1"


def test_replace_graph_overwrites_previous(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "a", "title": "A"}], "edges": []},
    )

    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "b", "title": "B"}], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert [n["id"] for n in saved["nodes"]] == ["b"]


def test_node_type_and_color_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "분기", "node_type": "decision", "color": "#3b82f6"}
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert saved["nodes"][0]["node_type"] == "decision"
    assert saved["nodes"][0]["color"] == "#3b82f6"


def test_invalid_color_rejected(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "n1", "color": "red"}], "edges": []},
    )

    assert response.status_code == 422


def test_edge_referencing_unknown_node_rejected(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.put(
        f"/api/versions/{version_id}/graph",
        json={
            "nodes": [{"id": "n1", "title": "only"}],
            "edges": [
                {"id": "e1", "source_node_id": "n1", "target_node_id": "ghost"}
            ],
        },
    )

    assert response.status_code == 422


def test_graph_for_missing_version_404(client: TestClient) -> None:
    response = client.get("/api/versions/999999/graph")

    assert response.status_code == 404


def test_child_scope_is_isolated_from_parent(client: TestClient) -> None:
    version_id = _create_version(client)
    # 최상위에 부모 노드 p
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "p", "title": "발주"}], "edges": []},
    )
    # p의 하위 캔버스에 자식 노드 c
    client.put(
        f"/api/versions/{version_id}/graph?parent=p",
        json={"nodes": [{"id": "c", "title": "승인요청"}], "edges": []},
    )

    top = client.get(f"/api/versions/{version_id}/graph").json()
    child = client.get(f"/api/versions/{version_id}/graph?parent=p").json()

    # 최상위는 p만, 자식 저장이 최상위를 덮어쓰지 않음
    assert [n["id"] for n in top["nodes"]] == ["p"]
    assert top["nodes"][0]["has_children"] is True
    assert [n["id"] for n in child["nodes"]] == ["c"]


def test_removing_node_deletes_descendants(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "p", "title": "p"}], "edges": []},
    )
    client.put(
        f"/api/versions/{version_id}/graph?parent=p",
        json={"nodes": [{"id": "c", "title": "c"}], "edges": []},
    )

    # 최상위에서 p 제거 → c(하위)도 함께 삭제돼야 함
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [], "edges": []},
    )
    child = client.get(f"/api/versions/{version_id}/graph?parent=p").json()

    assert child == {"nodes": [], "edges": []}


def test_put_with_unknown_parent_404(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.put(
        f"/api/versions/{version_id}/graph?parent=ghost",
        json={"nodes": [], "edges": []},
    )

    assert response.status_code == 404
