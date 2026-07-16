"""Canvas graph read/replace tests."""

from fastapi.testclient import TestClient


_graph_seq = 0


def _create_version(client: TestClient) -> int:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _graph_seq
    _graph_seq += 1
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"graph map {_graph_seq}"}).json()
    version_id = created["versions"][0]["id"]
    # PUT /graph는 이제 호출자가 체크아웃을 쥐고 있어야 한다 — 실제 편집 워크플로우 재현
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


def test_new_map_version_seeds_start_end(client: TestClient) -> None:
    # 새 맵의 초기 버전은 Start·End 노드로 시작한다(빈 캔버스 아님). 엣지·그룹은 없음.
    version_id = _create_version(client)

    response = client.get(f"/api/versions/{version_id}/graph")

    assert response.status_code == 200
    body = response.json()
    assert sorted(n["node_type"] for n in body["nodes"]) == ["end", "start"]
    assert body["edges"] == []
    assert body["groups"] == []
    assert body["locked"] is False
    assert body["subprocess_refs"] == {}


def test_replace_graph_roundtrips(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "시작", "node_type": "start", "pos_x": 0, "pos_y": 0, "sort_order": 0},
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
        json={"nodes": [{"id": "a", "title": "A", "node_type": "start"}], "edges": []},
    )

    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "b", "title": "B", "node_type": "start"}], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert [n["id"] for n in saved["nodes"]] == ["b"]


def test_node_type_and_color_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "분기", "node_type": "decision", "color": "#3b82f6"},
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    n1 = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert n1["node_type"] == "decision"
    assert n1["color"] == "#3b82f6"


def test_bpm_attributes_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {
                "id": "n1",
                "title": "발주",
                "assignee": "김담당",
                "department": "구매팀",
                "system": "ERP",
                "duration": "2",
            },
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["assignee"] == "김담당"
    assert node["department"] == "구매팀"
    assert node["system"] == "ERP"
    # duration은 경계에서 H.MM 숫자로 정규화됨(design 2026-07-11) — 자유텍스트는 여기서 다루지 않음
    assert node["duration"] == "2"


def test_full_graph_returns_all_nodes(client: TestClient) -> None:
    version_id = _create_version(client)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={
            "nodes": [
                {"id": "s", "title": "시작", "node_type": "start"},
                {"id": "p", "title": "발주"},
                {"id": "c", "title": "승인"},
            ],
            "edges": [],
        },
    )

    full = client.get(f"/api/versions/{version_id}/graph/all").json()

    by_id = {n["id"]: n for n in full["nodes"]}
    assert set(by_id) == {"s", "p", "c"}
    assert by_id["p"]["source_node_id"] is None


def test_invalid_color_rejected(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}, {"id": "n1", "color": "red"}], "edges": []},
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
        json={
            "nodes": [
                {"id": "s", "title": "시작", "node_type": "start"},
                {"id": "p", "title": "발주"},
                {"id": "c", "title": "승인요청"},
            ],
            "edges": [],
        },
    )

    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert {n["id"] for n in saved["nodes"]} == {"s", "p", "c"}


def test_removing_nodes_cleans_up(client: TestClient) -> None:
    version_id = _create_version(client)
    # start node required for non-empty graph to pass validation
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}, {"id": "p", "title": "p"}, {"id": "c", "title": "c"}], "edges": []},
    )

    # 노드 제거 → 이후 조회에서 사라져야 함 (빈 그래프는 start 불필요)
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert saved == {
        "nodes": [], "edges": [], "groups": [], "locked": False, "subprocess_refs": {},
    }


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
            {"id": "s", "title": "시작", "node_type": "start"},
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
    groups_by_id = {g["id"]: g for g in saved["groups"]}
    assert groups_by_id["g1"] == {
        "id": "g1",
        "parent_group_id": None,
        "label": "영업팀",
        "color": "#6a41ff",
    }
    # 다중 그룹(태그) 멤버십 왕복
    nodes_by_id = {n["id"]: n for n in saved["nodes"]}
    assert nodes_by_id["n1"]["group_ids"] == ["g1"]
    assert nodes_by_id["n2"]["group_ids"] == ["g1", "g2"]


def test_nested_groups_roundtrip_and_sanitize(client: TestClient) -> None:
    """중첩 그룹(parent_group_id) 왕복 + 고아/자기참조 상위는 None으로 정리."""
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "s", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "A", "group_ids": ["child"]},
        ],
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
            {"id": "hside-n1", "title": "A", "node_type": "start", "pos_x": 0, "pos_y": 0, "sort_order": 0},
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
            {"id": "hdef-n1", "title": "A", "node_type": "start", "pos_x": 0, "pos_y": 0, "sort_order": 0},
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
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "n1", "group_ids": ["g1"]},
            ],
            "edges": [],
            "groups": [{"id": "g1", "label": "팀", "color": ""}],
        },
    )
    # 그룹 해제 — group_ids 비움 + groups 비움
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}, {"id": "n1"}], "edges": [], "groups": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    assert saved["groups"] == []
    assert next(n for n in saved["nodes"] if n["id"] == "n1")["group_ids"] == []


def test_graph_is_flat_per_version(client: TestClient) -> None:
    version_id = _create_version(client)
    # 예전엔 parent 스코프로 분리됐던 노드들이 이제 한 평면에 공존
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "s", "node_type": "start"}, {"id": "a"}, {"id": "b"}, {"id": "c"}], "edges": []},
    )
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    assert {n["id"] for n in saved["nodes"]} == {"s", "a", "b", "c"}
    assert all("has_children" not in n for n in saved["nodes"])  # 계층 개념 제거


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


def test_subprocess_follow_latest_defaults_on(client: TestClient) -> None:
    """follow_latest 생략 시 기본 True(최신본 추종)로 저장된다."""
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "s", "title": "시작", "node_type": "start", "sort_order": 0},
            {
                "id": "sub",
                "title": "결재",
                "node_type": "subprocess",
                "linked_map_id": 999,
                # follow_latest 생략 — 기본값 검증
                "sort_order": 1,
            },
            {"id": "e", "title": "끝", "node_type": "end", "is_primary_end": True, "sort_order": 2},
        ],
        "edges": [],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    sub = next(n for n in saved["nodes"] if n["id"] == "sub")
    assert sub["follow_latest"] is True


def test_node_url_roundtrip(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "계약", "url": "https://contract.example.com/doc/1"},
        ],
        "edges": [],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url"] == "https://contract.example.com/doc/1"
    # 미지정 노드는 빈 문자열 기본값
    start = next(n for n in saved["nodes"] if n["id"] == "n0")
    assert start["url"] == ""

    # 두 번째 PUT은 기존 노드 갱신(upsert existing 분기) 경로를 지난다
    graph["nodes"][1]["url"] = "https://updated.example.com"
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url"] == "https://updated.example.com"


def test_node_url_too_long_rejected(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {"id": "n1", "title": "긴 URL", "url": "https://e.com/" + "a" * 500},
        ],
        "edges": [],
    }

    response = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert response.status_code == 422


def test_node_url_label_roundtrip_and_cascade(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n0", "title": "시작", "node_type": "start"},
            {
                "id": "n1",
                "title": "계약",
                "url": "https://contract.example.com/doc/1",
                "url_label": "계약서",
            },
            # url 없이 라벨만 — 서버 validator가 라벨을 소거해야 한다(캐스케이드)
            {"id": "n2", "title": "고아라벨", "url_label": "orphan"},
        ],
        "edges": [],
    }
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url_label"] == "계약서"
    orphan = next(n for n in saved["nodes"] if n["id"] == "n2")
    assert orphan["url_label"] == ""

    # url을 지우면 라벨도 함께 소거된다
    graph["nodes"][1]["url"] = ""
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()
    node = next(n for n in saved["nodes"] if n["id"] == "n1")
    assert node["url"] == ""
    assert node["url_label"] == ""


def test_node_url_label_too_long_rejected(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "긴 라벨", "url": "https://e.com/", "url_label": "a" * 101},
        ],
        "edges": [],
    }
    res = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert res.status_code == 422
