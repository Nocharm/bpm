"""세션 연결 캔버스 — relations(엣지 목록) ↔ canvas(노드+엣지 그래프) 변환의 단일 진실 (spec 2026-09-23 §4.2).

expand: import_consultant.expand_linkage_branches와 같은 분기 규칙(팬아웃≥2이고 전부 parallel이 아니면, 또는 자기 반복이면
분기 노드를 세운다) + consultant_layout LR 배치 + start/end 보강. collapse: 분기 노드를 접어 branch 엣지로 되돌린다.
분기 노드 이름은 손실 허용(등록 시 다시 만든다).

캔버스 엣지는 `gateway`를 들고 다닌다 — 전부 parallel인 팬아웃은 분기 노드 없이 직결로 펴지므로, 이 표시가
없으면 확정 게이트 6(plain_fanout 예외)이 읽는 `gateway="parallel"`이 왕복에서 사라진다. 라벨 자리는
relations의 `condition`(branch/loop) 또는 `label`(seq) 한쪽으로만 되돌린다.
"""

from typing import Any, NamedTuple

START_ID = "__start__"
END_ID = "__end__"
BRANCH_PREFIX = "__branch__"
_FANOUT_MIN = 2  # 분기 노드를 세우는 최소 팬아웃 — expand_linkage_branches와 같은 기준


class _FlowEdge(NamedTuple):
    """전개 중간 표현 — kind/gateway는 배치(back_pairs)와 캔버스 필드를 채우는 데 쓴다."""

    source: str
    target: str
    label: str
    kind: str
    gateway: str = ""


def _edge_id(source: str, target: str) -> str:
    """캔버스 엣지 id — (src,dst) 쌍이 유일하므로 쌍에서 파생한다(재제안마다 같은 id)."""
    return f"{source}>{target}"


def _node(node_id: str, node_type: str, title: str, task_id: str | None) -> dict:
    return {"id": node_id, "node_type": node_type, "title": title, "task_id": task_id,
            "pos_x": 0.0, "pos_y": 0.0}


def _apply_layout(
    nodes: list[dict], pairs: list[tuple[str, str]],
    labeled: list[tuple[str, str, str]], back: set[tuple[str, str]],
) -> None:
    """LR 배치를 제자리 적용 — nodes의 pos_x/pos_y를 채운다(expand·relayout 공통 경로)."""
    from scripts.consultant_layout import LayoutNode, layout_flow  # 지연 import — 스크립트 패키지

    placed = [
        LayoutNode(id=str(n["id"]), node_type=str(n.get("node_type") or "subprocess")) for n in nodes
    ]
    layout_flow(placed, pairs, primary_end_id=END_ID, back_pairs=back, labeled=labeled)
    pos = {p.id: (float(p.x), float(p.y)) for p in placed}
    for node in nodes:
        node["pos_x"], node["pos_y"] = pos[str(node["id"])]


def relayout_canvas(canvas: dict) -> dict:
    """노드·엣지는 그대로, LR 배치만 다시 돌린 새 캔버스. 좌표 없이 온 제안(AI 피드백)에 자리를 준다.

    kind가 없으므로 되돌아가는 엣지는 노드 목록 순서로 가린다 — 목록 순서를 거스르는 엣지를
    rank에 넣으면 사이클로 떨어져 배치가 무너진다(layout_flow back_pairs 주석).
    """
    nodes = [dict(n) for n in canvas.get("nodes") or [] if isinstance(n, dict)]
    edges = [dict(e) for e in canvas.get("edges") or [] if isinstance(e, dict)]
    if not nodes:
        return {"nodes": nodes, "edges": edges}
    order = {str(n.get("id")): i for i, n in enumerate(nodes)}
    pairs = [(str(e.get("source_node_id") or ""), str(e.get("target_node_id") or "")) for e in edges]
    back = {(s, d) for s, d in pairs if s in order and d in order and order[d] <= order[s]}
    labeled = [(s, d, str(e.get("label") or "")) for (s, d), e in zip(pairs, edges, strict=True)]
    _apply_layout(nodes, pairs, labeled, back)
    return {"nodes": nodes, "edges": edges}


def expand_relations_to_canvas(relations: dict, tasks: list[tuple[str, str]]) -> dict:
    """relations → 편집용 캔버스 그래프. tasks=[(task_id, name)] seq 순.

    분기 노드 삽입 규칙·start/end 보강 규칙은 FE 미리보기(`lib/interview-preview.ts` buildL5PreviewGraph)와
    같아야 한다 — 두 표면이 같은 그림을 보여야 하므로 한쪽을 고치면 다른 쪽도 옮긴다.
    """
    names = dict(tasks)
    order = [task_id for task_id, _ in tasks]

    # (1) 이 세션의 task만 남긴다 — 조립기가 해석할 수 없는 끝점은 캔버스에도 세우지 않는다
    scoped: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()
    for raw in relations.get("edges") or []:
        src, dst = str(raw.get("src") or ""), str(raw.get("dst") or "")
        if src not in names or dst not in names or (src, dst) in seen_pairs:
            continue
        seen_pairs.add((src, dst))
        scoped.append(raw)

    # (2) src별 팬아웃 → 분기 노드. 라벨·gateway는 분기 노드에서 나가는 엣지가 그대로 들고 간다
    out_by_src: dict[str, list[dict]] = {}
    for edge in scoped:
        out_by_src.setdefault(str(edge["src"]), []).append(edge)
    flow: list[_FlowEdge] = []
    branch_of: dict[str, str] = {}
    back: set[tuple[str, str]] = set()
    for src in order:
        group = out_by_src.get(src) or []
        if not group:
            continue
        has_self = any(str(e.get("dst") or "") == src for e in group)
        all_parallel = (
            len(group) >= _FANOUT_MIN and not has_self
            and all(e.get("gateway") == "parallel" for e in group)
        )
        forks = has_self or (len(group) >= _FANOUT_MIN and not all_parallel)
        origin = src
        if forks:
            origin = f"{BRANCH_PREFIX}{src}"
            branch_of[origin] = src
            flow.append(_FlowEdge(src, origin, "", "seq"))
        for edge in group:
            dst = str(edge["dst"])
            label = str(edge.get("condition") or edge.get("label") or "")
            kind = str(edge.get("kind") or "seq")
            flow.append(_FlowEdge(origin, dst, label, kind, str(edge.get("gateway") or "")))
            # self는 kind와 무관하게 back 등록 — 안 하면 ◇↔A 사이클이 랭크를 무너뜨린다
            if kind == "loop" or dst == src:
                back.add((origin, dst))

    # (3) start/end 보강 — loop 진입은 진입으로 치지 않는다(loop만 들어오는 노드도 start에 매단다)
    body_ids: list[str] = []
    for task_id in order:
        body_ids.append(task_id)
        if f"{BRANCH_PREFIX}{task_id}" in branch_of:
            body_ids.append(f"{BRANCH_PREFIX}{task_id}")
    has_in = {e.target for e in flow if e.kind != "loop"}
    has_out = {e.source for e in flow}
    entry = str((relations.get("entry") or {}).get("taskId") or "")
    heads = [entry] if entry in names else []
    heads += [nid for nid in body_ids if nid not in has_in and nid not in heads]
    for head in heads:
        flow.append(_FlowEdge(START_ID, head, "", "seq"))
    for nid in body_ids:
        if nid not in has_out:
            flow.append(_FlowEdge(nid, END_ID, "", "seq"))

    # (4) 노드 목록(start · task seq 순 + 분기 노드는 앵커 뒤 · end) → LR 배치
    nodes = [_node(START_ID, "start", "Start", None)]
    for task_id in order:
        nodes.append(_node(task_id, "subprocess", names[task_id], task_id))
        branch_id = f"{BRANCH_PREFIX}{task_id}"
        if branch_id in branch_of:
            nodes.append(_node(branch_id, "decision", f"{names[task_id]} 결과", None))
    nodes.append(_node(END_ID, "end", "End", None))

    _apply_layout(
        nodes, [(e.source, e.target) for e in flow],
        [(e.source, e.target, e.label) for e in flow], back,
    )

    edges: list[dict] = []
    for e in flow:
        edge: dict[str, Any] = {
            "id": _edge_id(e.source, e.target), "source_node_id": e.source,
            "target_node_id": e.target, "label": e.label,
        }
        if e.gateway:
            edge["gateway"] = e.gateway
        edges.append(edge)
    return {"nodes": nodes, "edges": edges}


def _flow_order(nodes: list[dict]) -> dict[str, int]:
    """노드별 흐름 순서 — LR 캔버스의 pos_x 순(동석은 목록 순). 되돌아가는 엣지 판정 기준."""
    ranked = sorted(enumerate(nodes), key=lambda pair: (float(pair[1].get("pos_x") or 0), pair[0]))
    return {str(node.get("id")): i for i, (_, node) in enumerate(ranked)}


class _Exit(NamedTuple):
    """분기 노드의 최종 출구 — 라벨·gateway는 가장 안쪽 엣지 값이 이긴다."""

    node_id: str
    label: str
    gateway: str


def collapse_canvas_to_relations(canvas: dict, known_task_ids: set[str]) -> dict:
    """캔버스 → relations. 분기 노드는 접어 branch 엣지로, end 엣지는 버린다.

    분기 노드가 연쇄면(◇→◇) 재귀로 전개하고 안쪽 라벨·gateway를 우선한다. 알 수 없는 task_id를
    가리키는 엣지는 버린다 — 조립기가 해석할 수 없는 끝점이다.
    """
    nodes = [n for n in (canvas.get("nodes") or []) if isinstance(n, dict)]
    by_id = {str(n.get("id")): n for n in nodes}
    order = _flow_order(nodes)
    task_of = {
        str(n.get("id")): str(n.get("task_id"))
        for n in nodes
        if n.get("node_type") == "subprocess" and str(n.get("task_id") or "") in known_task_ids
    }

    outgoing: dict[str, list[_Exit]] = {}
    for raw in canvas.get("edges") or []:
        if not isinstance(raw, dict):
            continue
        source, target = str(raw.get("source_node_id") or ""), str(raw.get("target_node_id") or "")
        if source not in by_id or target not in by_id:
            continue
        outgoing.setdefault(source, []).append(
            _Exit(target, str(raw.get("label") or ""), str(raw.get("gateway") or ""))
        )

    def is_decision(node_id: str) -> bool:
        return by_id[node_id].get("node_type") == "decision"

    def walk_branch(node_id: str, seen: frozenset) -> list[_Exit]:
        """분기 노드의 최종 출구 목록 — 연쇄 분기는 안쪽 값을 쓴다."""
        out: list[_Exit] = []
        for exit_ in outgoing.get(node_id, []):
            if is_decision(exit_.node_id):
                if exit_.node_id in seen:
                    continue  # 분기 사이클 — 무한 재귀 방지
                out += [
                    _Exit(deep.node_id, deep.label or exit_.label, deep.gateway or exit_.gateway)
                    for deep in walk_branch(exit_.node_id, seen | {exit_.node_id})
                ]
            elif exit_.node_id in task_of:
                out.append(exit_)
        return out

    edges: list[dict] = []
    emitted: set[tuple[str, str]] = set()

    def add(src: str, dst: str, kind: str, text: str = "", gateway: str = "") -> None:
        if (src, dst) in emitted:
            return
        emitted.add((src, dst))
        edge: dict[str, Any] = {"src": src, "dst": dst, "kind": kind}
        if kind == "branch":
            edge["gateway"] = gateway or "exclusive"
        if text:
            # seq는 relations의 label, 갈라짐·되돌아감은 condition — 라벨 자리를 한쪽으로만 되돌린다
            edge["label" if kind == "seq" else "condition"] = text
        edges.append(edge)

    for node_id, task_id in task_of.items():
        for exit_ in outgoing.get(node_id, []):
            if is_decision(exit_.node_id):
                for deep in walk_branch(exit_.node_id, frozenset({exit_.node_id})):
                    if deep.node_id == node_id:
                        add(task_id, task_id, "loop", deep.label)
                    else:
                        add(task_id, task_of[deep.node_id], "branch", deep.label, deep.gateway)
            elif exit_.node_id in task_of:
                backward = exit_.node_id == node_id or order[exit_.node_id] < order[node_id]
                # 분기 노드 없는 직결에 gateway가 남아 있으면 전부 parallel이던 팬아웃 — 표시를 되살린다
                kind = "loop" if backward else ("branch" if exit_.gateway else "seq")
                add(task_id, task_of[exit_.node_id], kind, exit_.label, exit_.gateway)

    # entry = start의 첫 출구(subprocess). 없으면 흐름 순 첫 task
    entry_task = ""
    for node_id, node in by_id.items():
        if node.get("node_type") != "start":
            continue
        entry_task = next(
            (task_of[e.node_id] for e in outgoing.get(node_id, []) if e.node_id in task_of), ""
        )
        if entry_task:
            break
    if not entry_task:
        ordered_tasks = sorted(task_of, key=lambda nid: order[nid])
        entry_task = task_of[ordered_tasks[0]] if ordered_tasks else ""
    return {"entry": {"taskId": entry_task, "triggerType": "manual", "label": ""}, "edges": edges}


def validate_canvas(canvas: dict, known_task_ids: set[str]) -> list[str]:
    """저장 전 형태 검증 — 오류 문자열 목록(빈 목록 = 통과). 배치·연결의 의미는 보지 않는다."""
    errors: list[str] = []
    raw_nodes = canvas.get("nodes")
    raw_edges = canvas.get("edges")
    if not isinstance(raw_nodes, list):
        return ["canvas nodes must be a list"]
    if not isinstance(raw_edges, list):
        return ["canvas edges must be a list"]

    ids: set[str] = set()
    task_ids: set[str] = set()
    for node in raw_nodes:
        if not isinstance(node, dict):
            errors.append("canvas node must be an object")
            continue
        node_id = str(node.get("id") or "")
        if not node_id:
            errors.append("canvas node has no id")
            continue
        if node_id in ids:
            errors.append(f"duplicate node id: {node_id}")
        ids.add(node_id)
        task_id = str(node.get("task_id") or "")
        if task_id and task_id not in known_task_ids:
            errors.append(f"unknown task id: {task_id}")
        if task_id and task_id in task_ids:
            # 한 L6가 두 노드에 걸리면 collapse가 어느 쪽 순서를 쓸지 정할 수 없다
            errors.append(f"duplicate task id: {task_id}")
        if task_id:
            task_ids.add(task_id)
        if node.get("node_type") == "subprocess" and not task_id:
            errors.append(f"subprocess node has no task id: {node_id}")
        for axis in ("pos_x", "pos_y"):
            value = node.get(axis)  # 누락은 허용(0으로 읽는다), 숫자 아닌 값은 배치를 깨뜨린다
            if value is not None and (isinstance(value, bool) or not isinstance(value, int | float)):
                errors.append(f"node {node_id} {axis} must be a number")

    for edge in raw_edges:
        if not isinstance(edge, dict):
            errors.append("canvas edge must be an object")
            continue
        edge_id = str(edge.get("id") or "")
        for endpoint in ("source_node_id", "target_node_id"):
            value = str(edge.get(endpoint) or "")
            if value not in ids:
                errors.append(f"edge {edge_id} endpoint not found: {value or '(empty)'}")
    return errors
