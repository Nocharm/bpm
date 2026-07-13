"""숫자 파라미터(회당 소요시간·비용 KRW/USD·투입인원·연간건수·FTE) — 저장/응답 왕복 + 무효값 경계 소거."""

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
            _node(
                "np1-p1",
                duration="0.75",
                headcount="2",
                cost_krw="300",
                annual_count="1200",
                fte="0.8",
            ),
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
    assert (node["headcount"], node["cost_krw"], node["cost_usd"], node["annual_count"], node["fte"]) == (
        "2",
        "300",
        "",
        "1200",
        "0.8",
    )


def test_invalid_numeric_cleared_at_boundary(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np2-s1", node_type="start"),
            _node(
                "np2-p1",
                duration="2일",
                headcount="두명",
                cost_krw="1.2.3",
                annual_count="x",
                fte="",
            ),
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
    assert (node["headcount"], node["cost_krw"], node["cost_usd"], node["annual_count"], node["fte"]) == (
        "",
        "",
        "",
        "",
        "",
    )


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

    graph["nodes"][1] = _node(
        "np3-p1", headcount="4", cost_usd="10", annual_count="500", fte="1"
    )
    client.put(f"/api/versions/{version_id}/graph", json=graph)
    node = next(n for n in client.get(f"/api/versions/{version_id}/graph").json()["nodes"] if n["id"] == "np3-p1")
    assert (node["headcount"], node["cost_krw"], node["cost_usd"], node["annual_count"], node["fte"]) == (
        "4",
        "",
        "10",
        "500",
        "1",
    )


def test_node_rejects_both_currencies(client: TestClient) -> None:
    """cost_krw와 cost_usd를 동시에 채우면 422 — 조용한 소거는 데이터 유실이라 거절한다.

    시작/끝 노드를 갖춘 유효한 그래프로 구성 — 배타 검증이 아닌 다른 사유(시작 노드 누락 등)로
    422가 나와 테스트가 우연히 통과하는 것을 막는다.
    """
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np4-s1", node_type="start"),
            _node("np4-p1", cost_krw="1000", cost_usd="10"),
            _node("np4-e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "np4-ed1", "source_node_id": "np4-s1", "target_node_id": "np4-p1", "label": ""},
            {"id": "np4-ed2", "source_node_id": "np4-p1", "target_node_id": "np4-e1", "label": ""},
        ],
        "groups": [],
    }
    resp = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert resp.status_code == 422


def test_node_accepts_single_currency(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            _node("np5-s1", node_type="start"),
            _node(
                "np5-p1",
                cost_krw="1250000",
                annual_count="1200",
                fte="0.8",
                headcount="2",
            ),
            _node("np5-e1", node_type="end", is_primary_end=True),
        ],
        "edges": [
            {"id": "np5-ed1", "source_node_id": "np5-s1", "target_node_id": "np5-p1", "label": ""},
            {"id": "np5-ed2", "source_node_id": "np5-p1", "target_node_id": "np5-e1", "label": ""},
        ],
        "groups": [],
    }
    resp = client.put(f"/api/versions/{version_id}/graph", json=graph)
    assert resp.status_code == 200
    node = next(n for n in resp.json()["nodes"] if n["id"] == "np5-p1")
    assert node["cost_krw"] == "1250000"
    assert node["cost_usd"] == ""
    assert node["annual_count"] == "1200"
    assert node["fte"] == "0.8"
