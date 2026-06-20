"""Canvas graph read/replace tests."""

from fastapi.testclient import TestClient


def _create_version(client: TestClient) -> int:
    created = client.post("/api/maps", json={"name": "graph map"}).json()
    return created["versions"][0]["id"]


def test_new_version_has_empty_graph(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.get(f"/api/versions/{version_id}/graph")

    assert response.status_code == 200
    assert response.json() == {"nodes": [], "edges": [], "groups": []}


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


def test_bpm_attributes_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {
                "id": "n1",
                "title": "발주",
                "assignee": "김담당",
                "department": "구매팀",
                "system": "ERP",
                "duration": "2일",
            }
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    node = saved["nodes"][0]
    assert node["assignee"] == "김담당"
    assert node["department"] == "구매팀"
    assert node["system"] == "ERP"
    assert node["duration"] == "2일"


def test_full_graph_returns_all_nodes(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "p", "title": "발주"}, {"id": "c", "title": "승인"}], "edges": []},
    )

    full = client.get(f"/api/versions/{version_id}/graph/all").json()

    by_id = {n["id"]: n for n in full["nodes"]}
    assert set(by_id) == {"p", "c"}
    assert by_id["p"]["source_node_id"] is None


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


def test_all_nodes_coexist_in_flat_graph(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "p", "title": "발주"}, {"id": "c", "title": "승인요청"}], "edges": []},
    )

    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert {n["id"] for n in saved["nodes"]} == {"p", "c"}


def test_removing_nodes_cleans_up(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "p", "title": "p"}, {"id": "c", "title": "c"}], "edges": []},
    )

    # 노드 제거 → 이후 조회에서 사라져야 함
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert saved == {"nodes": [], "edges": [], "groups": []}


def test_put_missing_version_404(client: TestClient) -> None:
    response = client.put(
        "/api/versions/999999/graph",
        json={"nodes": [], "edges": []},
    )

    assert response.status_code == 404


def test_group_roundtrips_with_membership(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "A", "group_ids": ["g1"]},
            {"id": "n2", "title": "B", "group_ids": ["g1", "g2"]},
        ],
        "edges": [],
        "groups": [
            {"id": "g1", "label": "영업팀", "color": "#6a41ff"},
            {"id": "g2", "label": "프로젝트", "color": ""},
        ],
    }

    put_response = client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert put_response.status_code == 200
    assert saved["groups"][0] == {
        "id": "g1",
        "parent_group_id": None,
        "label": "영업팀",
        "color": "#6a41ff",
    }
    # 다중 그룹(태그) 멤버십 왕복
    assert {n["id"]: n["group_ids"] for n in saved["nodes"]} == {
        "n1": ["g1"],
        "n2": ["g1", "g2"],
    }


def test_nested_groups_roundtrip_and_sanitize(client: TestClient) -> None:
    """중첩 그룹(parent_group_id) 왕복 + 고아/자기참조 상위는 None으로 정리."""
    version_id = _create_version(client)
    graph = {
        "nodes": [{"id": "n1", "title": "A", "group_ids": ["child"]}],
        "edges": [],
        "groups": [
            {"id": "parent", "label": "부서", "color": ""},
            {"id": "child", "parent_group_id": "parent", "label": "하위팀", "color": ""},
            # 자기참조 + 고아 상위 — 둘 다 None으로 정리되어야 함
            {"id": "selfref", "parent_group_id": "selfref", "label": "", "color": ""},
            {"id": "orphan", "parent_group_id": "ghost", "label": "", "color": ""},
        ],
    }

    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    saved = {g["id"]: g for g in client.get(f"/api/versions/{version_id}/graph").json()["groups"]}

    assert saved["child"]["parent_group_id"] == "parent"
    assert saved["parent"]["parent_group_id"] is None
    assert saved["selfref"]["parent_group_id"] is None
    assert saved["orphan"]["parent_group_id"] is None


def test_node_referencing_unknown_group_rejected(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "n1", "group_ids": ["ghost"]}], "edges": [], "groups": []},
    )

    assert response.status_code == 422


def test_edge_handle_side_roundtrips(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "hside-n1", "title": "A", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "hside-n2", "title": "B", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [
            {
                "id": "hside-e1",
                "source_node_id": "hside-n1",
                "target_node_id": "hside-n2",
                "label": "",
                "source_side": "top",
                "target_side": "bottom",
            }
        ],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    edge = saved["edges"][0]
    assert edge["source_side"] == "top"
    assert edge["target_side"] == "bottom"


def test_edge_handle_side_defaults(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "hdef-n1", "title": "A", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "hdef-n2", "title": "B", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [{"id": "hdef-e1", "source_node_id": "hdef-n1", "target_node_id": "hdef-n2"}],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    edge = saved["edges"][0]
    assert edge["source_side"] == "right"
    assert edge["target_side"] == "left"


def test_edge_handle_side_invalid_rejected(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "hbad-n1", "title": "A", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "hbad-n2", "title": "B", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [
            {
                "id": "hbad-e1",
                "source_node_id": "hbad-n1",
                "target_node_id": "hbad-n2",
                "source_side": "banana",
            }
        ],
    }
    response = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert response.status_code == 422


def test_removed_group_is_cleaned(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={
            "nodes": [{"id": "n1", "group_ids": ["g1"]}],
            "edges": [],
            "groups": [{"id": "g1", "label": "팀", "color": ""}],
        },
    )
    # 그룹 해제 — group_ids 비움 + groups 비움
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "n1"}], "edges": [], "groups": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert saved["groups"] == []
    assert saved["nodes"][0]["group_ids"] == []


def test_graph_is_flat_per_version(client: TestClient) -> None:
    version_id = _create_version(client)
    # 예전엔 parent 스코프로 분리됐던 노드들이 이제 한 평면에 공존
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "a"}, {"id": "b"}, {"id": "c"}], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    assert {n["id"] for n in saved["nodes"]} == {"a", "b", "c"}
    assert "has_children" not in saved["nodes"][0]  # 계층 개념 제거


def test_subprocess_and_handle_fields_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "s", "title": "시작", "node_type": "start", "sort_order": 0},
            {
                "id": "sub",
                "title": "결재",
                "node_type": "subprocess",
                "linked_map_id": 999,
                "follow_latest": True,
                "sort_order": 1,
            },
            {"id": "e", "title": "끝", "node_type": "end", "is_primary_end": True, "sort_order": 2},
        ],
        "edges": [
            {
                "id": "x1",
                "source_node_id": "sub",
                "target_node_id": "e",
                "source_handle": "__primary__",
            }
        ],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    sub = next(n for n in saved["nodes"] if n["id"] == "sub")
    assert sub["node_type"] == "subprocess"
    assert sub["linked_map_id"] == 999
    assert sub["follow_latest"] is True
    end = next(n for n in saved["nodes"] if n["id"] == "e")
    assert end["is_primary_end"] is True
    assert saved["edges"][0]["source_handle"] == "__primary__"
