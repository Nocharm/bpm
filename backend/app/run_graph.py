"""실행 체크(Run) 상태 엔진 — 맵 그래프 + 수동으로 저장된 소수의 상태에서 노드별 실행 상태를 계산한다.

FE `frontend/src/lib/run-graph.ts`와 이중 구현이며, 두 구현은 사례 파일
`backend/tests/fixtures/run_graph_cases.json`을 단일 소스로 맞물린다. 한쪽 규칙을 바꾸면 사례와 양쪽을 같이 옮긴다.
설계: 2026-11-04-run-check-design.md §4.2.

두 구현이 같아야 하는 세부(사례 파일이 직접 가두지 못하는 것):
- 위상 순서는 라운드 단위 Kahn이다 — 매 라운드에 진입차수 0인 노드를 id 오름차순으로 한꺼번에 내보낸다.
- `closed`는 정상 계산을 마친 뒤 `done`·`problem`이 아닌 상태를 일괄 `skipped`로 바꾼다(계산 중 전파에는 영향 없음).
"""

from dataclasses import dataclass, field, replace
from typing import Literal

from app.models import Edge, Node
from app.subprocess import PRIMARY_END_HANDLE, get_output_key

# 진행률 분모 후보이자 사람이 직접 처리하는 노드 유형 — start·end는 흐름이 자동으로 지나간다
ACTIONABLE_TYPES = frozenset({"process", "decision", "subprocess"})

_PARALLEL_GATEWAY = "parallel"


@dataclass(frozen=True)
class RunGraphNode:
    id: str
    node_type: str
    title: str
    is_primary_end: bool = False
    parallel_outputs: tuple[str, ...] = ()


@dataclass(frozen=True)
class RunGraphEdge:
    id: str
    source: str
    target: str
    source_handle: str | None = None
    label: str = ""
    gateway: str | None = None


@dataclass(frozen=True)
class RunGraph:
    nodes: tuple[RunGraphNode, ...]
    edges: tuple[RunGraphEdge, ...]

    @classmethod
    def from_models(cls, nodes: list[Node], edges: list[Edge]) -> "RunGraph":
        # JSON·문자열 컬럼은 ALTER 이전 행에서 NULL일 수 있어 기본값으로 접는다
        return cls(
            nodes=tuple(
                RunGraphNode(
                    id=n.id,
                    node_type=n.node_type,
                    title=n.title or "",
                    is_primary_end=bool(n.is_primary_end),
                    parallel_outputs=tuple(n.parallel_outputs or ()),
                )
                for n in nodes
            ),
            edges=tuple(
                RunGraphEdge(
                    id=e.id,
                    source=e.source_node_id,
                    target=e.target_node_id,
                    source_handle=e.source_handle,
                    label=e.label or "",
                    gateway=e.gateway,
                )
                for e in edges
            ),
        )

    def node(self, node_id: str) -> RunGraphNode:
        for n in self.nodes:
            if n.id == node_id:
                return n
        raise KeyError(node_id)


@dataclass
class RunScopeState:
    """범위 하나의 저장 상태 — manual: 노드→active|done|problem, choice: 노드→연결선 id, exit: 노드→출구 키."""

    manual: dict[str, str] = field(default_factory=dict)
    choice: dict[str, str] = field(default_factory=dict)
    exit: dict[str, str] = field(default_factory=dict)
    closed: bool = False


@dataclass(frozen=True)
class BranchOptions:
    kind: Literal["none", "edge", "exit"]
    edge_ids: tuple[str, ...] = ()
    exit_keys: tuple[str, ...] = ()


_NO_BRANCH = BranchOptions("none")


def _get_known_edges(graph: RunGraph) -> list[RunGraphEdge]:
    """양 끝이 모두 그래프에 있는 연결선 — 끝점이 없는 연결선(FK 없음)은 계산에서 빠진다."""
    ids = {n.id for n in graph.nodes}
    return [e for e in graph.edges if e.source in ids and e.target in ids]


def find_run_back_edge_ids(graph: RunGraph) -> set[str]:
    """역행(루프) 연결선 id — 레이아웃 엔진과 같은 DFS 판정을 써서 에디터가 보여 주는 루프와 일치시킨다."""
    # scripts는 app 모듈을 가져와 순환참조가 생기므로 함수 지역에서 지연 임포트한다 (routers/categories.py 선례)
    from scripts.consultant_layout import find_back_edges

    edges = _get_known_edges(graph)
    codes = sorted(n.id for n in graph.nodes)
    pairs = [(e.source, e.target) for e in edges]
    labels = {(e.source, e.target): e.label for e in edges}
    back_pairs = find_back_edges(codes, pairs, labels)
    # 같은 (출발, 도착) 쌍의 연결선은 모두 역행이다
    return {e.id for e in edges if (e.source, e.target) in back_pairs}


def _order_nodes(graph: RunGraph, forward: list[RunGraphEdge]) -> list[str]:
    """역행을 뺀 연결선으로 라운드 단위 Kahn — 라운드 안에선 id 오름차순, 남는 노드는 id 순으로 뒤에 붙인다."""
    indegree = {n.id: 0 for n in graph.nodes}
    successors: dict[str, list[str]] = {n.id: [] for n in graph.nodes}
    for e in forward:
        indegree[e.target] += 1
        successors[e.source].append(e.target)
    order: list[str] = []
    ready = sorted(i for i, d in indegree.items() if d == 0)
    while ready:
        order.extend(ready)
        next_ready: list[str] = []
        for node_id in ready:
            for target in successors[node_id]:
                indegree[target] -= 1
                if indegree[target] == 0:
                    next_ready.append(target)
        ready = sorted(next_ready)
    placed = set(order)
    order.extend(sorted(n.id for n in graph.nodes if n.id not in placed))
    return order


def _get_forward_edges(graph: RunGraph) -> list[RunGraphEdge]:
    back_ids = find_run_back_edge_ids(graph)
    return [e for e in _get_known_edges(graph) if e.id not in back_ids]


def get_run_topo_order(graph: RunGraph) -> list[str]:
    return _order_nodes(graph, _get_forward_edges(graph))


def _build_branch_options(node: RunGraphNode, outgoing: list[RunGraphEdge]) -> BranchOptions:
    """나가는 연결선(역행 포함, 그래프 순서)에서 갈래 종류를 정한다."""
    if node.node_type == "decision":
        if len(outgoing) >= 2:
            return BranchOptions("edge", edge_ids=tuple(e.id for e in outgoing))
        return _NO_BRANCH
    keys = list(dict.fromkeys(get_output_key(node.node_type, e.source_handle) for e in outgoing))
    if node.node_type == "subprocess" and len(keys) >= 2:
        return BranchOptions("exit", exit_keys=tuple(keys))
    if len(outgoing) <= 1:
        return _NO_BRANCH
    # 출구가 하나뿐인 묶음(일반 노드 전부, 끝이 하나인 SP)이 병렬이면 전 갈래 동시, 아니면 레거시 택일
    is_parallel = (
        node.node_type == "start"
        or keys[0] in node.parallel_outputs
        or all(e.gateway == _PARALLEL_GATEWAY for e in outgoing)
    )
    if is_parallel:
        return _NO_BRANCH
    return BranchOptions("edge", edge_ids=tuple(e.id for e in outgoing))


def get_branch_options(graph: RunGraph, node_id: str) -> BranchOptions:
    node = graph.node(node_id)
    outgoing = [e for e in _get_known_edges(graph) if e.source == node_id]
    return _build_branch_options(node, outgoing)


def _is_edge_live(
    edge: RunGraphEdge,
    source: RunGraphNode,
    source_status: str,
    options: BranchOptions,
    state: RunScopeState,
) -> bool:
    """건너뛴 출발의 연결선은 죽고, 완료된 갈래 노드는 사람이 고른 연결선·출구만 산다."""
    if source_status == "skipped":
        return False
    if source_status != "done":
        return True
    if options.kind == "edge":
        return state.choice.get(source.id) == edge.id
    if options.kind == "exit":
        return get_output_key(source.node_type, edge.source_handle) == state.exit.get(source.id)
    return True


def derive_run_statuses(graph: RunGraph, state: RunScopeState) -> dict[str, str]:
    forward = _get_forward_edges(graph)
    order = _order_nodes(graph, forward)
    nodes = {n.id: n for n in graph.nodes}
    incoming: dict[str, list[RunGraphEdge]] = {}
    for e in forward:
        incoming.setdefault(e.target, []).append(e)
    outgoing: dict[str, list[RunGraphEdge]] = {}
    for e in _get_known_edges(graph):
        outgoing.setdefault(e.source, []).append(e)
    options = {i: _build_branch_options(n, outgoing.get(i, [])) for i, n in nodes.items()}

    statuses: dict[str, str] = {}
    for node_id in order:
        node = nodes[node_id]
        if node.node_type == "start":
            statuses[node_id] = "done"
            continue
        live = [
            e
            for e in incoming.get(node_id, [])
            if _is_edge_live(e, nodes[e.source], statuses[e.source], options[e.source], state)
        ]
        if not live:
            statuses[node_id] = "skipped"
        elif node_id in state.manual:
            statuses[node_id] = state.manual[node_id]
        elif all(statuses[e.source] == "done" for e in live):
            statuses[node_id] = "done" if node.node_type == "end" else "ready"
        else:
            statuses[node_id] = "waiting"

    if state.closed:
        statuses = {i: s if s in ("done", "problem") else "skipped" for i, s in statuses.items()}
    return statuses


def count_run_progress(graph: RunGraph, state: RunScopeState) -> tuple[int, int]:
    """(완료 수, 건너뛰지 않은 처리 대상 수) — 중단(closed) 전 기준이라 closed를 끄고 계산한다."""
    statuses = derive_run_statuses(graph, replace(state, closed=False))
    counted = [statuses[n.id] for n in graph.nodes if n.node_type in ACTIONABLE_TYPES and statuses[n.id] != "skipped"]
    return counted.count("done"), len(counted)


def is_run_scope_finished(statuses: dict[str, str]) -> bool:
    return all(s in ("done", "skipped") for s in statuses.values())


def get_reached_end_key(graph: RunGraph, statuses: dict[str, str]) -> str | None:
    """닿은 끝의 키 — 대표 끝이면 `__primary__`, 아니면 위상 순서상 첫 끝의 제목, 없으면 None."""
    reached = [n for n in graph.nodes if n.node_type == "end" and statuses.get(n.id) == "done"]
    if not reached:
        return None
    if any(n.is_primary_end for n in reached):
        return PRIMARY_END_HANDLE
    rank = {node_id: i for i, node_id in enumerate(get_run_topo_order(graph))}
    return min(reached, key=lambda n: rank[n.id]).title


def _collect_reachable(adjacency: dict[str, list[str]], start: str) -> set[str]:
    """start에서 인접 관계를 따라 닿는 노드 id(start 포함)."""
    seen = {start}
    stack = [start]
    while stack:
        for nxt in adjacency.get(stack.pop(), []):
            if nxt not in seen:
                seen.add(nxt)
                stack.append(nxt)
    return seen


def list_touched_after(graph: RunGraph, state: RunScopeState, node_id: str) -> list[str]:
    """정방향으로 닿는 뒤 단계 중 이미 손댄(수동 상태·선택·출구) 노드 id, 위상 순서 — 완료 취소를 막거나 함께 지울 노드."""
    forward = _get_forward_edges(graph)
    successors: dict[str, list[str]] = {}
    for e in forward:
        successors.setdefault(e.source, []).append(e.target)
    after = _collect_reachable(successors, node_id) - {node_id}
    touched = set(state.manual) | set(state.choice) | set(state.exit)
    return [candidate for candidate in _order_nodes(graph, forward) if candidate in after and candidate in touched]


def find_touched_after(graph: RunGraph, state: RunScopeState, node_id: str) -> str | None:
    """되돌리기를 막는 첫 뒤 단계의 제목 — 없으면 None."""
    touched = list_touched_after(graph, state, node_id)
    return graph.node(touched[0]).title if touched else None


def find_loop_body(graph: RunGraph, back_edge_id: str) -> list[str]:
    """역행 연결선이 되감는 구간 — 도착에서 정방향으로 닿고 출발로 정방향 도달하는 노드(위상 순서)."""
    back = next((e for e in _get_known_edges(graph) if e.id == back_edge_id), None)
    if back is None:
        return []
    forward = _get_forward_edges(graph)
    successors: dict[str, list[str]] = {}
    predecessors: dict[str, list[str]] = {}
    for e in forward:
        successors.setdefault(e.source, []).append(e.target)
        predecessors.setdefault(e.target, []).append(e.source)
    body = _collect_reachable(successors, back.target) & _collect_reachable(predecessors, back.source)
    return [i for i in _order_nodes(graph, forward) if i in body]
