"""하위프로세스 검증·순환·해석 테스트."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def _new_version(client: TestClient, name: str = "p") -> int:
    version_id = client.post("/api/maps", json={"name": name}).json()["versions"][0]["id"]
    # PUT /graph는 체크아웃 보유자만 — 편집 워크플로우 재현
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


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
    version_id = created["versions"][0]["id"]
    # PUT /graph는 체크아웃 보유자만 — 편집 워크플로우 재현
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return created["id"], version_id


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


def _make_map(client: TestClient, name: str) -> dict:
    """Create a map and return its full JSON (id + versions list)."""
    return client.post("/api/maps", json={"name": name}).json()


def _make_map_with_published(
    client: TestClient, name: str, monkeypatch: pytest.MonkeyPatch
) -> dict:
    """Create a map and publish its first version. Returns {map_id, published_version_id}."""
    created = client.post("/api/maps", json={"name": name}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]
    # Workflow: set approvers → checkout → submit → approve (as "boss") → publish
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss"]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    monkeypatch.setattr(settings, "dev_user", "boss")
    client.post(f"/api/versions/{version_id}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{version_id}/publish")
    return {"map_id": map_id, "published_version_id": version_id}


def test_library_list_includes_published_and_refs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # map A: published version; map B: draft referencing A → B.refs == [A.map_id]
    a = _make_map_with_published(client, name="lib-A-pub", monkeypatch=monkeypatch)
    b = _make_map(client, name="lib-B-ref")
    b_map_id = b["id"]
    b_ver = b["versions"][0]["id"]
    client.post(f"/api/versions/{b_ver}/checkout", json={})  # PUT /graph는 체크아웃 필요
    client.put(f"/api/versions/{b_ver}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start", "title": "S"},
            {"id": "sub", "node_type": "subprocess", "title": "call A",
             "linked_map_id": a["map_id"]},
        ],
        "edges": [],
    })
    rows = client.get("/api/library/processes").json()
    by_id = {r["map_id"]: r for r in rows}
    assert by_id[a["map_id"]]["latest_published_version_id"] == a["published_version_id"]
    assert by_id[b_map_id]["refs"] == [a["map_id"]]
    assert by_id[a["map_id"]]["refs"] == []


# ── FIX 1: _clone_graph preserves subprocess link fields + edge handles ──────

def test_clone_preserves_subprocess_fields(client: TestClient) -> None:
    """버전 복제 시 subprocess 링크 필드·is_primary_end·엣지 핸들이 유지돼야 한다."""
    src_map_id, src_vid = _map_and_version(client, "clone-src")
    linked_map_id, _ = _map_and_version(client, "clone-linked")

    # Source graph: subprocess node with link fields + end with is_primary_end + branch edge
    r = client.put(f"/api/versions/{src_vid}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start"},
            {
                "id": "sub",
                "node_type": "subprocess",
                "linked_map_id": linked_map_id,
                "linked_version_id": None,
                "follow_latest": True,
            },
            {"id": "e", "title": "완료", "node_type": "end", "is_primary_end": True},
        ],
        "edges": [
            {
                "id": "edge1",
                "source_node_id": "s",
                "target_node_id": "sub",
                "source_handle": "bottom-handle",
                "target_handle": "top-handle",
            }
        ],
    })
    assert r.status_code == 200, r.json()

    # Clone by creating a new version with source_version_id
    clone_r = client.post(f"/api/maps/{src_map_id}/versions", json={
        "label": "To-Be",
        "source_version_id": src_vid,
    })
    assert clone_r.status_code == 201, clone_r.json()
    cloned_vid = clone_r.json()["id"]

    # Fetch the cloned graph and verify fields
    g = client.get(f"/api/versions/{cloned_vid}/graph").json()
    by_type = {n["node_type"]: n for n in g["nodes"]}

    # Subprocess node: link fields must survive
    sub = by_type["subprocess"]
    assert sub["linked_map_id"] == linked_map_id, f"linked_map_id lost: {sub}"
    assert sub["follow_latest"] is True, f"follow_latest lost: {sub}"
    # is_primary_end on end node
    end = by_type["end"]
    assert end["is_primary_end"] is True, f"is_primary_end lost: {end}"

    # Edge: source_handle / target_handle must survive
    assert len(g["edges"]) == 1
    edge = g["edges"][0]
    assert edge["source_handle"] == "bottom-handle", f"source_handle lost: {edge}"
    assert edge["target_handle"] == "top-handle", f"target_handle lost: {edge}"


# ── FIX 2: primary end defaults to first end (by sort_order) if unspecified ──

def test_primary_end_defaults_to_first(client: TestClient) -> None:
    """끝 노드가 있고 is_primary_end 미지정 시 sort_order 최소 끝이 기본 대표가 돼야 한다."""
    vid = _new_version(client, "default-primary")
    r = client.put(f"/api/versions/{vid}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start"},
            # sort_order 2 — listed first in payload but higher sort_order
            {"id": "e2", "title": "반려", "node_type": "end", "sort_order": 2},
            # sort_order 1 — smallest, should become primary
            {"id": "e1", "title": "승인", "node_type": "end", "sort_order": 1},
        ],
        "edges": [],
    })
    assert r.status_code == 200, r.json()

    g = client.get(f"/api/versions/{vid}/graph").json()
    ends = {n["id"]: n for n in g["nodes"] if n["node_type"] == "end"}
    primaries = [n for n in ends.values() if n["is_primary_end"]]
    assert len(primaries) == 1, f"Expected exactly 1 primary end, got: {primaries}"
    assert primaries[0]["id"] == "e1", (
        f"Expected e1 (sort_order=1) to be primary, got: {primaries[0]}"
    )
    # e2 must NOT be primary
    assert ends["e2"]["is_primary_end"] is False


def test_rejects_multiple_primaries(client: TestClient) -> None:
    """既存 동작 확인 — 대표 끝이 2개 이상이면 422 반환."""
    vid = _new_version(client, "multi-primary")
    r = client.put(f"/api/versions/{vid}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start"},
            {"id": "e1", "title": "승인", "node_type": "end", "is_primary_end": True},
            {"id": "e2", "title": "반려", "node_type": "end", "is_primary_end": True},
        ],
        "edges": [],
    })
    assert r.status_code == 422
    assert "대표" in r.json()["detail"]
