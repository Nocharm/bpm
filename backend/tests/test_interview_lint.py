"""톤 결정적 린트 — '~하기'/존댓말 어미·활동 수 10±3 검출 (hardening T19)."""

from app.interview.lint import lint_graph


def _graph(titles: list[str]) -> dict:
    nodes = [
        {"key": "s", "title": "시작", "node_type": "start"},
        *({"key": f"n{i}", "title": t, "node_type": "process"} for i, t in enumerate(titles)),
        {"key": "e", "title": "끝", "node_type": "end"},
    ]
    return {"nodes": nodes, "edges": [], "groups": []}


def test_clean_graph_passes() -> None:
    titles = ["요청 접수", "요청서 작성", "견적 취합", "견적 비교", "공급사 선정",
              "계약 검토", "발주 확정", "결과 통보"]  # 8개 — 표준 범위(7~13) 내
    assert lint_graph(_graph(titles)) == []


def test_gerund_and_sentence_titles_flagged() -> None:
    titles = ["요청서 작성하기", "견적을 비교합니다", "발주 확정", "계약 검토",
              "공급사 선정", "결과 통보", "요청 접수"]  # 7개 — 개수 경고 없이 톤만
    warnings = lint_graph(_graph(titles))
    assert len(warnings) == 1
    assert "2건" in warnings[0]
    assert "작성하기" in warnings[0]


def test_activity_count_deviation_flagged() -> None:
    warnings = lint_graph(_graph([f"활동 {i}" for i in range(16)]))
    assert any("16개" in w for w in warnings)


def test_start_end_titles_exempt() -> None:
    """start/end 제목은 자유(드래프터 규칙 2) — 린트 대상 아님."""
    titles = ["요청 검토", "견적 취합", "견적 비교", "공급사 선정", "계약 검토",
              "발주 확정", "결과 통보"]
    graph = _graph(titles)
    graph["nodes"][0]["title"] = "주문 접수하기"  # start
    graph["nodes"][-1]["title"] = "완료합니다"  # end
    assert lint_graph(graph) == []
