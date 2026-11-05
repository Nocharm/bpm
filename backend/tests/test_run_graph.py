"""실행 상태 계산 엔진(app.run_graph) 테스트 — 공용 사례 파일 기반.

FE `frontend/src/lib/run-graph.test.ts`와 같은 사례 파일을 쓴다. 한쪽 규칙을 바꾸면 사례와 양쪽 구현을 같이 옮긴다.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from app.models import Edge, Node
from app.run_graph import (
    BranchOptions,
    RunGraph,
    RunGraphEdge,
    RunGraphNode,
    RunScopeState,
    count_run_progress,
    derive_run_statuses,
    find_loop_body,
    find_run_back_edge_ids,
    find_touched_after,
    get_branch_options,
    get_reached_end_key,
    get_run_topo_order,
    is_run_scope_finished,
    list_touched_after,
)

CASES: dict[str, Any] = json.loads(
    (Path(__file__).parent / "fixtures" / "run_graph_cases.json").read_text(encoding="utf-8")
)


def _build_graph(raw: dict[str, Any]) -> RunGraph:
    nodes = tuple(
        RunGraphNode(
            id=n["id"],
            node_type=n["node_type"],
            title=n["title"],
            is_primary_end=n.get("is_primary_end", False),
            parallel_outputs=tuple(n.get("parallel_outputs", [])),
        )
        for n in raw["nodes"]
    )
    edges = tuple(
        RunGraphEdge(
            id=e["id"],
            source=e["source"],
            target=e["target"],
            source_handle=e.get("source_handle"),
            label=e.get("label", ""),
            gateway=e.get("gateway"),
        )
        for e in raw["edges"]
    )
    return RunGraph(nodes=nodes, edges=edges)


def _build_state(raw: dict[str, Any]) -> RunScopeState:
    return RunScopeState(
        manual=dict(raw.get("manual", {})),
        choice=dict(raw.get("choice", {})),
        exit=dict(raw.get("exit", {})),
        closed=raw.get("closed", False),
    )


def _graph(name: str) -> RunGraph:
    return _build_graph(CASES["graphs"][name])


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["name"])
def test_derive_statuses_match_cases(case: dict[str, Any]) -> None:
    statuses = derive_run_statuses(_graph(case["graph"]), _build_state(case["state"]))

    assert statuses == case["statuses"]


@pytest.mark.parametrize("case", CASES["cases"], ids=lambda c: c["name"])
def test_progress_finished_end_match_cases(case: dict[str, Any]) -> None:
    graph = _graph(case["graph"])
    state = _build_state(case["state"])
    statuses = derive_run_statuses(graph, state)

    assert count_run_progress(graph, state) == tuple(case["progress"])
    assert is_run_scope_finished(statuses) is case["finished"]
    assert get_reached_end_key(graph, statuses) == case["reached_end"]


@pytest.mark.parametrize("graph_name", list(CASES["back_edges"]))
def test_back_edges_match_cases(graph_name: str) -> None:
    back_ids = find_run_back_edge_ids(_graph(graph_name))

    assert sorted(back_ids) == CASES["back_edges"][graph_name]


@pytest.mark.parametrize("entry", CASES["options"], ids=lambda o: f"{o['graph']}-{o['node']}")
def test_branch_options_match_cases(entry: dict[str, Any]) -> None:
    options = get_branch_options(_graph(entry["graph"]), entry["node"])

    assert options == BranchOptions(entry["kind"], tuple(entry["edge_ids"]), tuple(entry["exit_keys"]))


@pytest.mark.parametrize(
    "entry", CASES["touched_after"], ids=lambda t: f"{t['graph']}-{t['node']}-{len(t['state']['manual'])}"
)
def test_touched_after_match_cases(entry: dict[str, Any]) -> None:
    graph, state = _graph(entry["graph"]), _build_state(entry["state"])

    assert find_touched_after(graph, state, entry["node"]) == entry["title"]
    assert list_touched_after(graph, state, entry["node"]) == entry["ids"]  # 함께 지울 뒤 단계, 위상 순서


@pytest.mark.parametrize("entry", CASES["loop_body"], ids=lambda b: f"{b['graph']}-{b['edge']}")
def test_loop_body_match_cases(entry: dict[str, Any]) -> None:
    assert find_loop_body(_graph(entry["graph"]), entry["edge"]) == entry["nodes"]


def test_topo_order_excludes_back_edges() -> None:
    assert get_run_topo_order(_graph("loop")) == ["s", "w", "r", "e"]


def test_topo_order_ties_break_by_round_then_id() -> None:
    # 같은 차례(라운드)에 나온 노드끼리 id 순: m→a라 a는 2라운드, 1라운드의 m·n 뒤에 온다
    nodes = tuple(RunGraphNode(id=i, node_type="process", title=i) for i in ("m", "n", "a"))
    graph = RunGraph(nodes=nodes, edges=(RunGraphEdge(id="x", source="m", target="a"),))

    assert get_run_topo_order(graph) == ["m", "n", "a"]


def test_from_models_maps_orm_fields() -> None:
    nodes = [
        Node(id="s", node_type="start", title="", is_primary_end=False, parallel_outputs=[]),
        Node(id="e", node_type="end", title="완료", is_primary_end=True, parallel_outputs=["__primary__"]),
    ]
    edges = [
        Edge(id="k1", source_node_id="s", target_node_id="e", source_handle="s-right", label="예", gateway="parallel")
    ]

    graph = RunGraph.from_models(nodes, edges)

    assert graph.nodes == (
        RunGraphNode("s", "start", ""),
        RunGraphNode("e", "end", "완료", True, ("__primary__",)),
    )
    assert graph.edges == (RunGraphEdge("k1", "s", "e", "s-right", "예", "parallel"),)
    assert graph.node("e").title == "완료"
