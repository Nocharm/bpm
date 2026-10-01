"""출력 규칙의 시작 노드 예외 — start는 기본 병렬이라 연결 수(1개 이상)를 따지지 않는다 (사용자 결정 2026-10-02).

FE `frontend/src/lib/output-rules.test.ts`의 start 케이스와 같은 판정을 고정한다.
"""

from app.models import Edge, Node
from app.subprocess import find_output_rule_violations


def _edge(edge_id: str, source: str, target: str) -> Edge:
    return Edge(id=edge_id, source_node_id=source, target_node_id=target, label="")


def test_start_with_one_connection_is_not_a_violation() -> None:
    nodes = [Node(id="s", node_type="start", parallel_outputs=[]), Node(id="a", node_type="process", parallel_outputs=[])]

    assert find_output_rule_violations(nodes, [_edge("e1", "s", "a")]) == []


def test_start_fan_out_without_flag_is_parallel() -> None:
    nodes = [
        Node(id="s", node_type="start", parallel_outputs=[]),
        Node(id="a", node_type="process", parallel_outputs=[]),
        Node(id="b", node_type="process", parallel_outputs=[]),
    ]

    assert find_output_rule_violations(nodes, [_edge("e1", "s", "a"), _edge("e2", "s", "b")]) == []


def test_process_fan_out_without_flag_is_still_a_violation() -> None:
    nodes = [
        Node(id="p", node_type="process", parallel_outputs=[]),
        Node(id="a", node_type="process", parallel_outputs=[]),
        Node(id="b", node_type="process", parallel_outputs=[]),
    ]

    assert find_output_rule_violations(nodes, [_edge("e1", "p", "a"), _edge("e2", "p", "b")]) == ["p"]
