"""CSV 왕복 잔여 — 시스템 리뷰 2026-10-19 7c(D-3·D-7·D-8) 회귀."""

from app.framework_interview.existing import map_to_row
from app.models import Edge, Node
from app.routers.admin import _escape_csv_cell
from app.schemas import NodeIn
from scripts.consultant_interview import (
    LOOP_BRANCH_NODE_NAME,
    convert_interview,
    is_loop_branch_title,
    loop_branch_name,
)
from tests.test_consultant_interview import _edge, _interview


def test_decision_nodes_do_not_keep_parallel_exits() -> None:
    """판단 노드에 남은 병렬 플래그가 CSV로 나갔다 들어오며 판단을 병렬 일반 노드로 뒤집었다 (D-3)."""
    decision = NodeIn(id="d", title="판단", node_type="decision", parallel_outputs=["__primary__"])
    assert decision.parallel_outputs == []
    process = NodeIn(id="p", title="작업", node_type="process", parallel_outputs=["__primary__"])
    assert process.parallel_outputs == ["__primary__"]


def test_loop_branch_names_number_from_the_second() -> None:
    assert loop_branch_name(1) == LOOP_BRANCH_NODE_NAME
    assert loop_branch_name(2) == f"{LOOP_BRANCH_NODE_NAME} 2"
    assert is_loop_branch_title(f" {LOOP_BRANCH_NODE_NAME} 3 ")
    assert is_loop_branch_title(LOOP_BRANCH_NODE_NAME)
    assert not is_loop_branch_title(f"{LOOP_BRANCH_NODE_NAME} 결과")


def test_two_self_loops_in_one_map_get_distinct_titles() -> None:
    """같은 제목 ◇가 둘이면 그 맵의 CSV 내보내기를 다시 가져오기가 중복 이름으로 실패했다 (D-7)."""
    data = _interview()
    data["rows"][0]["relations"]["edges"] = [
        _edge(1, 2),
        _edge(2, 2, label="재작업"),
        _edge(2, 3),
        _edge(3, 3, label="보완"),
        _edge(3, 4),
    ]
    res = convert_interview(data)
    assert not res.has_error()
    loops = [n.name for n in res.maps[0].nodes if n.code.endswith("r")]
    assert loops == [LOOP_BRANCH_NODE_NAME, f"{LOOP_BRANCH_NODE_NAME} 2"]


def test_map_to_row_folds_numbered_loop_branches() -> None:
    nodes = [
        Node(id="s", version_id=1, title="Start", node_type="start", sort_order=0),
        Node(id="a", version_id=1, title="A", node_type="process", sort_order=1),
        Node(id="r", version_id=1, title=f"{LOOP_BRANCH_NODE_NAME} 2", node_type="decision", sort_order=2),
        Node(id="b", version_id=1, title="B", node_type="process", sort_order=3),
        Node(id="e", version_id=1, title="End", node_type="end", sort_order=4),
    ]
    edges = [
        Edge(id="1", version_id=1, source_node_id="s", target_node_id="a"),
        Edge(id="2", version_id=1, source_node_id="a", target_node_id="r"),
        Edge(id="3", version_id=1, source_node_id="r", target_node_id="a", label="보완 필요"),
        Edge(id="4", version_id=1, source_node_id="r", target_node_id="b"),
        Edge(id="5", version_id=1, source_node_id="b", target_node_id="e"),
    ]
    row = map_to_row("맵", None, nodes, edges)
    assert [a["label"] for a in row["actions"]] == ["A", "B"]


def test_admin_csv_guard_matches_the_frontend_for_apostrophe_values() -> None:
    """FE lib/csv.ts FORMULA_LEAD와 동치 — '=x 원문도 한 번 더 가드해야 가져오기가 원문을 돌려받는다 (D-8)."""
    assert _escape_csv_cell("'=x") == "''=x"
    assert _escape_csv_cell("'abc") == "'abc"
    assert _escape_csv_cell("=a,b") == "\"'=a,b\""
