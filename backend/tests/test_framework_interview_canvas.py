"""세션 연결 캔버스 변환 — relations↔canvas 왕복·검증 (spec 2026-09-23 §4.2)."""

import pytest

from app.framework_interview.canvas import (
    collapse_canvas_to_relations, expand_relations_to_canvas, validate_canvas,
)

TASKS = [("t1", "접수"), ("t2", "검토"), ("t3", "반려 처리"), ("t4", "완료")]
KNOWN = {t for t, _ in TASKS}


def test_expand_inserts_branch_node_for_fanout_and_lays_out_left_to_right() -> None:
    relations = {"entry": {"taskId": "t1", "triggerType": "manual", "label": ""}, "edges": [
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "t3", "kind": "branch", "gateway": "exclusive", "condition": "반려"},
        {"src": "t2", "dst": "t4", "kind": "branch", "gateway": "exclusive", "condition": "승인"},
    ]}
    canvas = expand_relations_to_canvas(relations, TASKS)
    ids = {n["id"]: n for n in canvas["nodes"]}
    assert ids["__branch__t2"]["node_type"] == "decision"
    assert {n["node_type"] for n in canvas["nodes"]} == {"start", "end", "subprocess", "decision"}
    labels = {(e["source_node_id"], e["target_node_id"]): e["label"] for e in canvas["edges"]}
    assert labels[("__branch__t2", "t3")] == "반려" and labels[("t2", "__branch__t2")] == ""
    assert ids["t1"]["pos_x"] < ids["t2"]["pos_x"] < ids["__branch__t2"]["pos_x"] < ids["t3"]["pos_x"]


def test_collapse_round_trips_expand() -> None:
    relations = {"entry": {"taskId": "t1", "triggerType": "manual", "label": ""}, "edges": [
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "t3", "kind": "branch", "gateway": "exclusive", "condition": "반려"},
        {"src": "t2", "dst": "t4", "kind": "branch", "gateway": "exclusive", "condition": "승인"},
        {"src": "t3", "dst": "t2", "kind": "loop"},
    ]}
    back = collapse_canvas_to_relations(expand_relations_to_canvas(relations, TASKS), {t for t, _ in TASKS})
    assert back["entry"]["taskId"] == "t1"

    def key(edge: dict) -> tuple[str, str]:
        return (edge["src"], edge["dst"])

    assert sorted(back["edges"], key=key) == sorted(relations["edges"], key=key)


def _edge_key(edge: dict) -> tuple[str, str]:
    return (edge["src"], edge["dst"])


# 왕복이 지켜야 하는 나머지 모양 — 전부 parallel인 팬아웃(분기 노드 없이 직결로 펴진다)·라벨 있는 seq·자기 반복
ROUND_TRIP_SHAPES = [
    pytest.param([
        {"src": "t1", "dst": "t2", "kind": "branch", "gateway": "parallel"},
        {"src": "t1", "dst": "t3", "kind": "branch", "gateway": "parallel"},
    ], id="all-parallel-fanout"),
    pytest.param([
        {"src": "t1", "dst": "t2", "kind": "seq", "label": "즉시"},
        {"src": "t2", "dst": "t3", "kind": "seq"},
    ], id="labeled-seq"),
    pytest.param([
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "t2", "kind": "loop"},
    ], id="lone-self-loop"),
]


@pytest.mark.parametrize("edges", ROUND_TRIP_SHAPES)
def test_collapse_round_trips_gateway_labels_and_self_loops(edges: list[dict]) -> None:
    relations = {"entry": {"taskId": "t1", "triggerType": "manual", "label": ""}, "edges": edges}
    canvas = expand_relations_to_canvas(relations, TASKS)
    assert validate_canvas(canvas, KNOWN) == []
    back = collapse_canvas_to_relations(canvas, KNOWN)
    assert back["entry"]["taskId"] == "t1"
    assert sorted(back["edges"], key=_edge_key) == sorted(edges, key=_edge_key)


def test_collapse_folds_chained_decision_nodes_with_inner_label_winning() -> None:
    canvas = {"nodes": [
        {"id": "__start__", "node_type": "start", "title": "Start", "task_id": None, "pos_x": 0, "pos_y": 0},
        {"id": "t1", "node_type": "subprocess", "title": "a", "task_id": "t1", "pos_x": 100, "pos_y": 0},
        {"id": "__branch__t1", "node_type": "decision", "title": "1", "task_id": None, "pos_x": 200, "pos_y": 0},
        {"id": "__branch__t1__1", "node_type": "decision", "title": "2", "task_id": None, "pos_x": 300, "pos_y": 0},
        {"id": "t2", "node_type": "subprocess", "title": "b", "task_id": "t2", "pos_x": 400, "pos_y": 0},
        {"id": "t3", "node_type": "subprocess", "title": "c", "task_id": "t3", "pos_x": 400, "pos_y": 100},
    ], "edges": [
        {"id": "e0", "source_node_id": "__start__", "target_node_id": "t1", "label": ""},
        {"id": "e1", "source_node_id": "t1", "target_node_id": "__branch__t1", "label": ""},
        {"id": "e2", "source_node_id": "__branch__t1", "target_node_id": "__branch__t1__1", "label": "1차 통과"},
        {"id": "e3", "source_node_id": "__branch__t1__1", "target_node_id": "t2", "label": "승인"},
        {"id": "e4", "source_node_id": "__branch__t1__1", "target_node_id": "t3", "label": ""},
    ]}
    back = collapse_canvas_to_relations(canvas, {"t1", "t2", "t3"})
    assert sorted(back["edges"], key=_edge_key) == [
        {"src": "t1", "dst": "t2", "kind": "branch", "gateway": "exclusive", "condition": "승인"},
        {"src": "t1", "dst": "t3", "kind": "branch", "gateway": "exclusive", "condition": "1차 통과"},
    ]


def test_collapse_marks_backward_direct_edges_as_loop_and_drops_unknown() -> None:
    canvas = {"nodes": [
        {"id": "__start__", "node_type": "start", "title": "Start", "task_id": None, "pos_x": 0, "pos_y": 0},
        {"id": "t1", "node_type": "subprocess", "title": "a", "task_id": "t1", "pos_x": 100, "pos_y": 0},
        {"id": "t2", "node_type": "subprocess", "title": "b", "task_id": "t2", "pos_x": 200, "pos_y": 0},
        {"id": "ghost", "node_type": "subprocess", "title": "g", "task_id": "zz", "pos_x": 300, "pos_y": 0},
    ], "edges": [
        {"id": "e0", "source_node_id": "__start__", "target_node_id": "t1", "label": ""},
        {"id": "e1", "source_node_id": "t1", "target_node_id": "t2", "label": ""},
        {"id": "e2", "source_node_id": "t2", "target_node_id": "t1", "label": ""},
        {"id": "e3", "source_node_id": "t2", "target_node_id": "ghost", "label": ""},
    ]}
    back = collapse_canvas_to_relations(canvas, {"t1", "t2"})
    kinds = {(e["src"], e["dst"]): e["kind"] for e in back["edges"]}
    assert kinds == {("t1", "t2"): "seq", ("t2", "t1"): "loop"}


def test_validate_canvas_reports_shape_errors() -> None:
    bad = {"nodes": [{"id": "t1", "node_type": "subprocess", "title": "a", "task_id": None, "pos_x": 0, "pos_y": 0},
                     {"id": "t1", "node_type": "subprocess", "title": "b", "task_id": "t9", "pos_x": 0, "pos_y": 0}],
           "edges": [{"id": "e", "source_node_id": "t1", "target_node_id": "nope", "label": ""}]}
    errors = validate_canvas(bad, {"t1"})
    assert any("duplicate" in e for e in errors) and any("unknown task" in e for e in errors) and any("edge" in e for e in errors)
    assert "subprocess node has no task id: t1" in errors


def test_validate_canvas_rejects_shared_task_id_and_non_numeric_position() -> None:
    bad = {"nodes": [
        {"id": "a", "node_type": "subprocess", "title": "a", "task_id": "t1", "pos_x": 0, "pos_y": 0},
        {"id": "b", "node_type": "subprocess", "title": "b", "task_id": "t1", "pos_x": 0, "pos_y": 0},
        {"id": "c", "node_type": "subprocess", "title": "c", "task_id": "t2", "pos_x": "left", "pos_y": 0},
        {"id": "d", "node_type": "decision", "title": "d", "task_id": None, "pos_y": 0},
    ], "edges": []}
    errors = validate_canvas(bad, {"t1", "t2"})
    assert "duplicate task id: t1" in errors
    assert "node c pos_x must be a number" in errors
    # pos_x 누락은 허용 — 0으로 읽는다
    assert not any(e.startswith("node d") for e in errors)
