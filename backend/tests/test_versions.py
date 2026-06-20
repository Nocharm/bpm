"""Version create/clone/rename/delete tests."""

from fastapi.testclient import TestClient


def _create_map(client: TestClient) -> dict:
    return client.post("/api/maps", json={"name": "version map"}).json()


def test_create_plain_version(client: TestClient) -> None:
    created = _create_map(client)

    response = client.post(
        f"/api/maps/{created['id']}/versions", json={"label": "To-Be"}
    )

    assert response.status_code == 201
    assert response.json()["label"] == "To-Be"


def test_create_version_clones_graph(client: TestClient) -> None:
    created = _create_map(client)
    source_version = created["versions"][0]["id"]
    # 평면 그래프를 source 버전에 저장
    client.put(
        f"/api/versions/{source_version}/graph",
        json={
            "nodes": [
                {"id": "s", "title": "시작", "node_type": "start"},
                {"id": "p", "title": "발주"},
                {"id": "c", "title": "승인"},
            ],
            "edges": [],
        },
    )

    clone = client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be", "source_version_id": source_version},
    ).json()
    cloned_graph = client.get(f"/api/versions/{clone['id']}/graph").json()

    # 구조는 같지만 노드 ID는 새로 발급 (원본과 충돌하지 않음)
    assert len(cloned_graph["nodes"]) == 3
    cloned_ids = {n["id"] for n in cloned_graph["nodes"]}
    assert "p" not in cloned_ids
    assert "c" not in cloned_ids


def test_clone_preserves_groups_and_membership(client: TestClient) -> None:
    created = _create_map(client)
    source_version = created["versions"][0]["id"]
    client.put(
        f"/api/versions/{source_version}/graph",
        json={
            "nodes": [
                {"id": "s", "node_type": "start"},
                {"id": "n1", "title": "A", "group_ids": ["g1"]},
            ],
            "edges": [],
            "groups": [{"id": "g1", "label": "영업팀", "color": "#6a41ff"}],
        },
    )

    clone = client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be", "source_version_id": source_version},
    ).json()
    top = client.get(f"/api/versions/{clone['id']}/graph").json()

    # 그룹은 새 ID로 복제되고, 멤버 노드의 group_ids도 복제된 그룹을 가리킴
    assert len(top["groups"]) == 1
    cloned_group_id = top["groups"][0]["id"]
    assert cloned_group_id != "g1"
    assert top["groups"][0]["label"] == "영업팀"
    n1 = next(n for n in top["nodes"] if n["title"] == "A")
    assert n1["group_ids"] == [cloned_group_id]


def test_clone_records_source_lineage(client: TestClient) -> None:
    created = _create_map(client)
    source_version = created["versions"][0]["id"]
    client.put(
        f"/api/versions/{source_version}/graph",
        json={"nodes": [{"id": "orig", "title": "원본", "node_type": "start"}], "edges": []},
    )

    clone1 = client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be", "source_version_id": source_version},
    ).json()
    clone1_nodes = client.get(f"/api/versions/{clone1['id']}/graph/all").json()["nodes"]
    clone2 = client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be-2", "source_version_id": clone1["id"]},
    ).json()
    clone2_nodes = client.get(f"/api/versions/{clone2['id']}/graph/all").json()["nodes"]

    # 1차 복제는 원본을, 복제의 복제도 같은 계보 루트(원본)를 가리킨다
    assert clone1_nodes[0]["source_node_id"] == "orig"
    assert clone2_nodes[0]["source_node_id"] == "orig"


def test_clone_leaves_source_untouched(client: TestClient) -> None:
    created = _create_map(client)
    source_version = created["versions"][0]["id"]
    client.put(
        f"/api/versions/{source_version}/graph",
        json={"nodes": [{"id": "p", "title": "발주", "node_type": "start"}], "edges": []},
    )

    client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be", "source_version_id": source_version},
    )
    source_graph = client.get(f"/api/versions/{source_version}/graph").json()

    assert [n["id"] for n in source_graph["nodes"]] == ["p"]


def test_rename_version(client: TestClient) -> None:
    created = _create_map(client)
    version_id = created["versions"][0]["id"]

    response = client.patch(f"/api/versions/{version_id}", json={"label": "현행"})

    assert response.status_code == 200
    assert response.json()["label"] == "현행"


def test_delete_version(client: TestClient) -> None:
    created = _create_map(client)
    extra = client.post(
        f"/api/maps/{created['id']}/versions", json={"label": "To-Be"}
    ).json()

    response = client.delete(f"/api/versions/{extra['id']}")

    assert response.status_code == 204


def test_cannot_delete_last_version(client: TestClient) -> None:
    created = _create_map(client)
    only_version = created["versions"][0]["id"]

    response = client.delete(f"/api/versions/{only_version}")

    assert response.status_code == 409
