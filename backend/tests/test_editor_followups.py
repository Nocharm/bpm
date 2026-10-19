"""편집·SP·비교 잔여 — 시스템 리뷰 2026-10-19 7b(A-2·A-4·F-4·F-6·F-7·F-8·F-9) 회귀."""

import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.app_settings import normalize_managed_entries, normalize_to_catalog
from app.duration import normalize_duration, normalize_numeric_param
from app.framework_confirm import _canvas_content_signature
from app.models import Node
from app.schemas import NodeIn
from tests.test_approval_integrity import _people, _post, _seed_flow, act_as, enforce  # noqa: F401


def _graph(prefix: str, *, fanout: bool = False) -> dict:
    """시작 → 작업 → 끝. fanout이면 작업이 판단·병렬 없이 두 갈래로 나간다(출력 규칙 위반)."""
    nodes = [
        {"id": f"{prefix}-s", "title": "Start", "node_type": "start", "pos_x": 0, "pos_y": 0},
        {"id": f"{prefix}-t", "title": "작업", "node_type": "process", "pos_x": 200, "pos_y": 0},
        {"id": f"{prefix}-e", "title": "", "node_type": "end", "pos_x": 400, "pos_y": 0},
    ]
    edges = [
        {"id": f"{prefix}-1", "source_node_id": f"{prefix}-s", "target_node_id": f"{prefix}-t", "label": ""},
        {"id": f"{prefix}-2", "source_node_id": f"{prefix}-t", "target_node_id": f"{prefix}-e", "label": ""},
    ]
    if fanout:
        nodes.append({"id": f"{prefix}-x", "title": "곁가지", "node_type": "process", "pos_x": 300, "pos_y": 100})
        edges.append({"id": f"{prefix}-3", "source_node_id": f"{prefix}-t", "target_node_id": f"{prefix}-x", "label": ""})
        edges.append({"id": f"{prefix}-4", "source_node_id": f"{prefix}-x", "target_node_id": f"{prefix}-e", "label": ""})
    return {"nodes": nodes, "edges": edges, "groups": []}


def _draft(client: TestClient) -> tuple[str, int]:
    p = _people("own", "ap")
    _, vid = _seed_flow(owner=p["own"], approvers=[p["ap"]])
    return p["own"], vid


# ── A-2·A-4 그래프 저장 id·그룹 검증 ─────────────────────────────────────────


def test_duplicate_ids_and_group_cycles_are_rejected(client: TestClient, enforce: None) -> None:  # noqa: F811
    owner, vid = _draft(client)
    act_as(owner)
    tag = uuid4().hex[:6]
    base = _graph(f"a2-{tag}")
    dup_edge = dict(base, edges=base["edges"] + [dict(base["edges"][0])])
    r = client.put(f"/api/versions/{vid}/graph", json=dup_edge)
    assert r.status_code == 422 and "duplicate edge ids" in r.json()["detail"]
    dup_node = dict(base, nodes=base["nodes"] + [dict(base["nodes"][1], title="둘째")])
    r = client.put(f"/api/versions/{vid}/graph", json=dup_node)
    assert r.status_code == 422 and "duplicate node ids" in r.json()["detail"]
    cyclic = dict(base, groups=[
        {"id": f"g1-{tag}", "parent_group_id": f"g2-{tag}", "label": "A"},
        {"id": f"g2-{tag}", "parent_group_id": f"g1-{tag}", "label": "B"},
    ])
    r = client.put(f"/api/versions/{vid}/graph", json=cyclic)
    assert r.status_code == 422 and "cycle" in r.json()["detail"]
    assert client.put(f"/api/versions/{vid}/graph", json=base).status_code == 200


# ── F-4 제출 때 서버 출력 규칙 ───────────────────────────────────────────────


def test_submit_refuses_a_plain_fanout(client: TestClient, enforce: None) -> None:  # noqa: F811
    """설정 패널의 제출·셀프 게시가 저장 체크리스트를 건너뛰어 규칙을 어긴 맵이 게시됐다 (사용자 결정 A)."""
    owner, vid = _draft(client)
    act_as(owner)
    tag = uuid4().hex[:6]
    assert client.put(f"/api/versions/{vid}/graph", json=_graph(f"f4-{tag}", fanout=True)).status_code == 200
    r = client.post(f"/api/versions/{vid}/submit", json={})
    assert r.status_code == 422 and r.json()["detail"].startswith("splits need a decision node or a parallel exit")
    assert client.put(f"/api/versions/{vid}/graph", json=_graph(f"f4b-{tag}")).status_code == 200
    assert _post(client, owner, f"/api/versions/{vid}/submit") == 200


# ── F-6 고정 버전은 확정 서명에 든다 ─────────────────────────────────────────


def _sp_node(**overrides) -> Node:
    base = dict(
        id="n", version_id=1, title="SP", description="", node_type="subprocess", color="",
        assignee="", assignee_role="", department="", system="", duration="", touch_time="",
        cost_krw="", cost_usd="", headcount="", annual_count="", fte="", input="", output="",
        input_forms="", output_forms="", gmp="", start_condition="", end_condition="",
        url="", url_label="", linked_map_id=7, follow_latest=False, linked_version_id=10,
        is_primary_end=False, parallel_outputs=[], placeholder_category_id=None, source_node_id=None,
    )
    base.update(overrides)
    return Node(**base)


def test_repin_counts_as_a_change_only_when_pinned() -> None:
    """다시 고정만 한 캔버스가 "무변경" 409로 확정되지 않았다. 최신 추종 중엔 저장된 핀을 쓰지 않는다."""
    pinned = _canvas_content_signature([_sp_node()], [])
    repinned = _canvas_content_signature([_sp_node(linked_version_id=11)], [])
    assert pinned != repinned
    following = _canvas_content_signature([_sp_node(follow_latest=True)], [])
    following_other = _canvas_content_signature([_sp_node(follow_latest=True, linked_version_id=99)], [])
    assert following == following_other


# ── F-7·F-8 SP 상속 파라미터·병렬 출구 키 ────────────────────────────────────


def test_subprocess_nodes_do_not_store_inherited_params() -> None:
    node = NodeIn(id="sp", title="SP", node_type="subprocess", duration="1.30", touch_time="0.30",
                  cost_krw="1000", cost_usd="5", headcount="2", annual_count="12", fte="0.5")
    assert (node.duration, node.touch_time, node.cost_krw, node.cost_usd, node.headcount) == ("",) * 5
    assert (node.annual_count, node.fte) == ("12", "0.5")
    process = NodeIn(id="p", title="P", node_type="process", duration="1.30", cost_krw="1000")
    assert (process.duration, process.cost_krw) == ("1.30", "1000")


def test_parallel_exit_keys_keep_the_end_title_verbatim() -> None:
    """끝 제목에 앞뒤 공백이 있으면 키만 잘려 핸들과 어긋나 병렬이 저장마다 사라졌다."""
    node = NodeIn(id="sp", title="SP", node_type="subprocess", parallel_outputs=[" 승인 ", "", " ", " 승인 "])
    assert node.parallel_outputs == [" 승인 "]


# ── F-9 FE·BE 정규화 ─────────────────────────────────────────────────────────

# 프론트 lib/duration.test.ts의 같은 표와 짝 — 한쪽을 바꾸면 다른 쪽도
NORMALIZATION_CASES = [
    ("1.30", "1.30", "1.30"),
    (" 1.30 ", "1.30", "1.30"),
    ("１．３０", "1.30", "1.30"),
    ("﻿2", "2", "2"),
    (" 3", "3", "3"),
    ("\x1f1.3", None, ""),
    ("١٢", None, ""),
    ("0.75", "1.15", "0.75"),
    ("1e3", None, ""),
]


def test_duration_and_numeric_normalization_match_the_frontend() -> None:
    for raw, duration, numeric in NORMALIZATION_CASES:
        assert normalize_duration(raw) == duration, raw
        assert normalize_numeric_param(raw) == numeric, raw


def test_catalog_matching_uses_plain_lowercase_and_drops_lone_surrogates() -> None:
    entries = normalize_managed_entries(["SAP\ud83d", "sap", {"value": "Straße", "aliases": ["STRASSE"]}])
    assert entries == [{"value": "SAP", "aliases": []}, {"value": "Straße", "aliases": ["STRASSE"]}]
    assert normalize_to_catalog("STRAßE", entries) == "Straße"
    assert normalize_to_catalog("strasse", entries) == "Straße"  # 별칭으로


def test_app_settings_survive_a_half_emoji(client: TestClient) -> None:
    """프론트가 UTF-16 단위로 자른 이모지 반쪽이 오면 저장 응답이 500이었다."""
    before = client.get("/api/admin/app-settings").json()
    try:
        # 브라우저 JSON.stringify처럼 \uXXXX 이스케이프로 보낸다(테스트 클라이언트는 고립 서러게이트를 직접 인코딩하지 못한다)
        body = json.dumps({"exposed_positions": ["팀장\ud83d"], "systems": ["MES\ude00"]})
        r = client.put("/api/admin/app-settings", content=body, headers={"Content-Type": "application/json"})
        assert r.status_code == 200, r.text
        saved = r.json()
        assert "팀장" in saved["exposed_positions"]
        assert any(entry["value"] == "MES" for entry in saved["systems"])
    finally:
        # 공유 세션 DB — 다른 테스트가 쓰는 목록을 되돌린다
        client.put("/api/admin/app-settings", json={
            "exposed_positions": before["exposed_positions"], "systems": before["systems"],
        })
