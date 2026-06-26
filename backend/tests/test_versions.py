"""Version create/clone/rename/delete tests."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import MapVersion


_map_seq = 0


def _create_map(client: TestClient) -> dict:
    # 세션 공유 DB + 맵 이름 전역 유니크라 호출마다 고유 이름 사용
    global _map_seq
    _map_seq += 1
    return client.post("/api/maps", json={"name": f"version map {_map_seq}"}).json()


def _approve_version(version_id: int) -> None:
    """버전 status 를 직접 approved 로 설정 — 'draft 1개 제한' 가드를 위해 소스 draft 해소용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            version = await session.get(MapVersion, version_id)
            version.status = "approved"
            await session.commit()

    asyncio.run(_run())


def test_create_version_blocked_when_draft_exists(client: TestClient) -> None:
    created = _create_map(client)  # 초기 As-Is 는 draft
    # 초기 draft 가 있으므로 새 버전 생성은 409 (맵당 draft 1개 제한, request #11)
    blocked = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    assert blocked.status_code == 409

    # As-Is 를 승인해 draft 를 해소하면 새 버전 생성이 허용된다
    _approve_version(created["versions"][0]["id"])
    allowed = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    assert allowed.status_code == 201


def _set_version_status(version_id: int, status: str) -> None:
    """버전 status 직접 설정 — '진행중 작업본' 가드(draft/pending/rejected) 테스트용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            version = await session.get(MapVersion, version_id)
            version.status = status
            await session.commit()

    asyncio.run(_run())


def test_create_version_blocked_when_pending(client: TestClient) -> None:
    """진행중(pending=승인대기) 버전이 있으면 새 버전 생성 차단 (request #11 강화)."""
    created = _create_map(client)
    _set_version_status(created["versions"][0]["id"], "pending")
    blocked = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    assert blocked.status_code == 409, blocked.text


def test_create_version_blocked_when_rejected(client: TestClient) -> None:
    """진행중(rejected=수정대기) 버전이 있으면 새 버전 생성 차단 (request #11 강화)."""
    created = _create_map(client)
    _set_version_status(created["versions"][0]["id"], "rejected")
    blocked = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    assert blocked.status_code == 409, blocked.text


def test_create_version_allowed_after_published(client: TestClient) -> None:
    """마무리(published) 버전만 있으면 작업본이 없으므로 새 버전 생성 허용."""
    created = _create_map(client)
    _set_version_status(created["versions"][0]["id"], "published")
    allowed = client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    assert allowed.status_code == 201, allowed.text


def test_create_plain_version(client: TestClient) -> None:
    created = _create_map(client)
    _approve_version(created["versions"][0]["id"])  # 초기 draft 해소 → 새 버전 허용

    response = client.post(
        f"/api/maps/{created['id']}/versions", json={"label": "To-Be"}
    )

    assert response.status_code == 201
    assert response.json()["label"] == "To-Be"


def test_create_version_clones_graph(client: TestClient) -> None:
    created = _create_map(client)
    source_version = created["versions"][0]["id"]
    # 평면 그래프를 source 버전에 저장 — PUT /graph는 체크아웃 보유자만
    client.post(f"/api/versions/{source_version}/checkout", json={})
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
    _approve_version(source_version)  # draft 해소 → 클론용 새 버전 허용

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
    client.post(f"/api/versions/{source_version}/checkout", json={})
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
    _approve_version(source_version)  # draft 해소 → 클론용 새 버전 허용

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
    client.post(f"/api/versions/{source_version}/checkout", json={})
    client.put(
        f"/api/versions/{source_version}/graph",
        json={"nodes": [{"id": "orig", "title": "원본", "node_type": "start"}], "edges": []},
    )
    _approve_version(source_version)  # 소스 draft 해소 → clone1 생성 허용

    clone1 = client.post(
        f"/api/maps/{created['id']}/versions",
        json={"label": "To-Be", "source_version_id": source_version},
    ).json()
    clone1_nodes = client.get(f"/api/versions/{clone1['id']}/graph/all").json()["nodes"]
    _approve_version(clone1["id"])  # clone1 draft 해소 → clone2 생성 허용
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
    client.post(f"/api/versions/{source_version}/checkout", json={})
    client.put(
        f"/api/versions/{source_version}/graph",
        json={"nodes": [{"id": "p", "title": "발주", "node_type": "start"}], "edges": []},
    )
    _approve_version(source_version)  # draft 해소 → 클론용 새 버전 허용

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
    _approve_version(created["versions"][0]["id"])  # 초기 draft 해소 → 추가 버전 생성 허용
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


def test_copy_map_from_approved(client: TestClient) -> None:
    created = _create_map(client)
    src_version = created["versions"][0]["id"]
    client.post(f"/api/versions/{src_version}/checkout", json={})
    client.put(
        f"/api/versions/{src_version}/graph",
        json={
            "nodes": [{"id": "s", "node_type": "start"}, {"id": "p", "title": "발주"}],
            "edges": [],
        },
    )
    _approve_version(src_version)  # 승인본 — 복사 기준 (request #12)

    copy = client.post(f"/api/maps/{created['id']}/copy", json={"name": "복사본"})
    assert copy.status_code == 201
    body = copy.json()
    assert body["name"] == "복사본"
    assert body["my_role"] == "owner"
    # 새 맵의 초기 버전은 편집 가능한 draft, 승인본 그래프가 복제됨
    new_version = body["versions"][0]
    assert new_version["status"] == "draft"
    cloned = client.get(f"/api/versions/{new_version['id']}/graph").json()
    assert len(cloned["nodes"]) == 2


def test_copy_map_without_approved_409(client: TestClient) -> None:
    created = _create_map(client)  # 초기 As-Is 는 draft → 승인본 없음
    response = client.post(f"/api/maps/{created['id']}/copy", json={})
    assert response.status_code == 409
