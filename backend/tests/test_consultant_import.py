"""컨설턴트 임포트 — 스키마·엔진 테스트. 설계: docs/design/2026-08-08-consultant-hierarchy-design.md"""

from fastapi.testclient import TestClient


def test_schema_has_consultant_columns(client: TestClient) -> None:
    # 신규 테이블·컬럼이 create_all로 생기고, 운영 ALTER 목록에도 등록돼 있는지(_ADDED_COLUMNS 누락 방지)
    import asyncio

    from sqlalchemy import text

    from app.db import _ADDED_COLUMNS, SessionLocal

    async def _check() -> None:
        async with SessionLocal() as session:
            await session.execute(text("SELECT id, code, name, level, parent_id, sort_order FROM process_categories"))
            await session.execute(text(
                "SELECT category_id, consultant_code, sp_input, sp_output FROM process_maps"
            ))

    asyncio.run(_check())
    added = {(t, c) for t, c, _ in _ADDED_COLUMNS}
    for col in ("category_id", "consultant_code", "sp_input", "sp_output"):
        assert ("process_maps", col) in added


def _canonical_map(**over: object):
    from scripts.consultant_canonical import CanonicalMap

    base = {
        "code": "L6-01", "name": "원자재 구매", "category": "A1", "owner": "cons.owner",
        "approvers": ["cons.appr"], "department": "Consult Div/Consult Team",
        "params": {"duration": "1.30", "annual_count": "12", "fte": "0.5", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "발주", "type": "process", "seq": 2},
        ],
        "edges": [], "links": [],
    }
    base.update(over)
    return CanonicalMap.model_validate(base)


def test_build_graph_rows_chain_and_ids() -> None:
    from scripts.import_consultant import build_graph_rows, make_node_id

    nodes, edges, warnings = build_graph_rows(_canonical_map(), link_targets={})
    assert warnings == []
    by_type = {}
    for n in nodes:
        by_type.setdefault(n.node_type, []).append(n)
    assert len(by_type["start"]) == 1 and len(by_type["end"]) == 1
    assert by_type["end"][0].is_primary_end is True
    # 결정적 id — 같은 입력이면 재실행에도 동일 (버전 비교 매칭의 핵심)
    assert by_type["process"][0].id == make_node_id("L6-01", "N1")
    nodes2, _, _ = build_graph_rows(_canonical_map(), link_targets={})
    assert sorted(n.id for n in nodes) == sorted(n.id for n in nodes2)
    # 체인: Start→N1→N2→End
    pairs = {(e.source_node_id, e.target_node_id) for e in edges}
    n1, n2 = make_node_id("L6-01", "N1"), make_node_id("L6-01", "N2")
    start_id, end_id = make_node_id("L6-01", "__start__"), make_node_id("L6-01", "__end__")
    assert pairs == {(start_id, n1), (n1, n2), (n2, end_id)}
    # 레이아웃 — rank가 x로 단조 증가
    xs = {n.id: n.pos_x for n in nodes}
    assert xs[start_id] < xs[n1] < xs[n2] < xs[end_id]


def test_build_graph_rows_link_node_seeds_params() -> None:
    from scripts.consultant_canonical import CanonicalParams
    from scripts.import_consultant import build_graph_rows, make_node_id

    cmap = _canonical_map(links=[{"to_map": "L6-02", "after_node": "N1"}])
    target_params = CanonicalParams(annual_count="7", fte="1.5")
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={"L6-02": (99, target_params)})
    sp = next(n for n in nodes if n.node_type == "subprocess")
    assert sp.linked_map_id == 99 and sp.follow_latest is True
    assert sp.annual_count == "7" and sp.fte == "1.5"
    assert sp.id == make_node_id("L6-01", "__link__L6-02")
    pairs = {(e.source_node_id, e.target_node_id) for e in edges}
    assert (make_node_id("L6-01", "N1"), sp.id) in pairs


def test_build_graph_rows_missing_link_target_warns() -> None:
    from scripts.import_consultant import build_graph_rows

    cmap = _canonical_map(links=[{"to_map": "GHOST"}])
    nodes, edges, warnings = build_graph_rows(cmap, link_targets={})
    assert not any(n.node_type == "subprocess" for n in nodes)
    assert any("GHOST" in w for w in warnings)
