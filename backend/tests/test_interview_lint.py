"""톤 결정적 린트 — '~하기'/존댓말 어미·활동 수 6±3 검출 (hardening T19)."""

from app.interview.lint import lint_graph


def _graph(titles: list[str]) -> dict:
    nodes = [
        {"key": "s", "title": "시작", "node_type": "start"},
        *({"key": f"n{i}", "title": t, "node_type": "process"} for i, t in enumerate(titles)),
        {"key": "e", "title": "끝", "node_type": "end"},
    ]
    return {"nodes": nodes, "edges": [], "groups": []}


def test_clean_graph_passes() -> None:
    assert lint_graph(_graph(["요청서 작성", "견적 비교", "발주 확정"])) == []


def test_gerund_and_sentence_titles_flagged() -> None:
    warnings = lint_graph(_graph(["요청서 작성하기", "견적을 비교합니다", "발주 확정"]))
    assert len(warnings) == 1
    assert "2건" in warnings[0]
    assert "작성하기" in warnings[0]


def test_activity_count_deviation_flagged() -> None:
    warnings = lint_graph(_graph([f"활동 {i}" for i in range(12)]))
    assert any("12개" in w for w in warnings)


def test_start_end_titles_exempt() -> None:
    """start/end 제목은 자유(드래프터 규칙 2) — 린트 대상 아님."""
    graph = {"nodes": [
        {"key": "s", "title": "주문 접수하기", "node_type": "start"},
        {"key": "a", "title": "요청 검토", "node_type": "process"},
        {"key": "b", "title": "견적 비교", "node_type": "process"},
        {"key": "c", "title": "발주 확정", "node_type": "process"},
        {"key": "e", "title": "완료합니다", "node_type": "end"},
    ], "edges": [], "groups": []}
    assert lint_graph(graph) == []
