"""출력 규칙 순수 단위 — get_output_key·find_output_rule_violations (DB 없이 transient 행).

FE `frontend/src/lib/output-rules.test.ts`(getOutputViolations)와 케이스를 1:1로 맞춘다 — 두 구현은
동치 이중 구현이라 한쪽을 고치면 양쪽 테스트를 같이 옮긴다. Start 노드 전용 규칙은 검토 보류(D7)라 다루지 않는다.
"""

import pytest

from app.models import Edge, Node
from app.subprocess import PRIMARY_END_HANDLE, find_output_rule_violations, get_output_key


def _node(node_id: str, node_type: str, parallel: list[str] | None = None) -> Node:
    return Node(id=node_id, version_id=1, node_type=node_type, parallel_outputs=parallel or [])


def _edges(*specs: tuple[str, str | None, str | None]) -> list[Edge]:
    """(source, source_handle, gateway) 목록 → 엣지. 타깃은 출구 판정과 무관해 고유 더미로 채운다."""
    return [
        Edge(id=f"e{i}", version_id=1, source_node_id=src, target_node_id=f"t{i}",
             source_handle=handle, gateway=gateway)
        for i, (src, handle, gateway) in enumerate(specs)
    ]


@pytest.mark.parametrize(
    ("node_type", "handle", "expected"),
    [
        ("subprocess", None, PRIMARY_END_HANDLE),
        ("subprocess", "", PRIMARY_END_HANDLE),
        ("subprocess", "__primary__", PRIMARY_END_HANDLE),
        ("subprocess", "s-right", PRIMARY_END_HANDLE),  # 레거시 변 id → 대표 끝
        ("subprocess", "t-left", PRIMARY_END_HANDLE),
        ("subprocess", "in", PRIMARY_END_HANDLE),  # 들어오는 문 변형은 끝이 아니다
        ("subprocess", "in:top", PRIMARY_END_HANDLE),
        ("subprocess", "Rejected", "Rejected"),  # 끝 제목은 그대로 끝 키
        ("process", "Rejected", PRIMARY_END_HANDLE),  # SP 밖은 출구 하나
        ("decision", "s-bottom", PRIMARY_END_HANDLE),
    ],
)
def test_get_output_key(node_type: str, handle: str | None, expected: str) -> None:
    assert get_output_key(node_type, handle) == expected


def test_flags_a_plain_node_with_two_outputs() -> None:
    edges = _edges(("A", None, None), ("A", None, None), ("A", None, None))
    assert find_output_rule_violations([_node("A", "process")], edges) == ["A"]


def test_allows_one_output_per_subprocess_end() -> None:
    edges = _edges(("S", "__primary__", None), ("S", "Rejected", None))
    assert find_output_rule_violations([_node("S", "subprocess")], edges) == []


def test_counts_legacy_side_and_in_handles_as_the_primary_end() -> None:
    edges = _edges(("S", "__primary__", None), ("S", "s-right", None), ("S", "Rejected", None))
    assert find_output_rule_violations([_node("S", "subprocess")], edges) == ["S"]
    in_variant = _edges(("S", "in:top", None), ("S", "Rejected", None))
    assert find_output_rule_violations([_node("S", "subprocess")], in_variant) == []


def test_exempts_decision_nodes() -> None:
    edges = _edges(("D", None, None), ("D", None, None))
    assert find_output_rule_violations([_node("D", "decision")], edges) == []


def test_parallel_output_needs_two_or_more_edges() -> None:
    edges = _edges(("A", None, None), ("A", None, None), ("B", None, None))
    nodes = [_node("A", "process", ["__primary__"]), _node("B", "process", ["__primary__"])]
    assert find_output_rule_violations(nodes, edges) == ["B"]


def test_parallel_output_without_edges_is_not_flagged() -> None:
    assert find_output_rule_violations([_node("A", "process", ["__primary__"])], []) == []


def test_applies_parallel_per_subprocess_end() -> None:
    edges = _edges(
        ("S", "__primary__", None), ("S", "__primary__", None),
        ("S", "Rejected", None), ("S", "Rejected", None),
    )
    assert find_output_rule_violations([_node("S", "subprocess", ["__primary__"])], edges) == ["S"]


def test_reads_an_all_parallel_gateway_fanout_as_parallel_without_the_attribute() -> None:
    legacy = _edges(("A", None, "parallel"), ("A", None, "parallel"))
    assert find_output_rule_violations([_node("A", "process")], legacy) == []
    mixed = _edges(("A", None, "parallel"), ("A", None, None))
    assert find_output_rule_violations([_node("A", "process")], mixed) == ["A"]
