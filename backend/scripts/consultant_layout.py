"""임포트 그래프 가로 자동정렬 — rank 배치 + 교차 감소 + 백본(주 흐름) 직선화 + 엣지 핸들.

에디터 "자동 정렬"(`frontend/src/lib/flow-layout.ts` `autoLayoutFlow`, LR)과 **동형 목표**의
파이썬 구현. dagre는 파이썬에 없으므로 레이어 배치를 rank(Kahn 최장경로) + 배리센터 정렬로
대체하고, 그 뒤 단계(`computeSpine`·`alignBackbone`·`pickHandleSide`·`isBackEdge`)는 TS를 그대로
이식했다. `duration.ts`↔`duration.py`와 같은 **동치 이중 구현** — 한쪽을 고치면 다른 쪽과
테스트를 같이 옮긴다.

좌표는 노드 좌상단(React Flow `position`), 정렬 판정은 중심 기준 — TS와 동일.
"""

from dataclasses import dataclass

# 노드 크기 — frontend/src/lib/canvas.ts nodeSizeOf와 수동 동기(실측 measured가 없는 서버 배치용)
_NODE_SIZE: dict[str, tuple[int, int]] = {
    "decision": (116, 96),
    "start": (96, 40),
    "end": (96, 40),
    "subprocess": (180, 64),
}
_DEFAULT_SIZE = (170, 52)  # NODE_WIDTH · NODE_HEIGHT

# 엣지 라벨 최대폭 + 좌우 패딩 — frontend/src/lib/canvas.ts EDGE_LABEL_MAX_WIDTH·EDGE_LABEL_PAD_X와
# 수동 동기. 라벨은 경로 중앙(랭크 사이)에 놓이므로 이 폭만큼은 노드가 비켜 줘야 한다.
EDGE_LABEL_MAX_WIDTH = 160
EDGE_LABEL_PAD_X = 12
_LABEL_MARGIN = 20  # 라벨 상자와 노드 사이 최소 여백(좌우 각각)
_MAX_NODE_W = max(w for w, _ in [*_NODE_SIZE.values(), _DEFAULT_SIZE])

# rank 간 가로 간격 — 라벨 없는 구간의 기본값. create_map Start/End 시드(120→480)와 같은 리듬
_X_STEP = 240
# 라벨이 있는 구간은 그 라벨이 들어갈 만큼만 넓힌다. 240 고정이던 시절엔 틈이 70px뿐이라
# 160px 라벨이 양옆 노드를 덮었다(2026-09-01 실측 17건).
_Y_STEP = 120  # rank 내 세로 간격
_X0, _Y0 = 120, 200
_BRANCH_PUSH = 60  # 곁가지 추가 이격 — flow-layout.ts와 동일 상수


def node_size(node_type: str) -> tuple[int, int]:
    return _NODE_SIZE.get(node_type, _DEFAULT_SIZE)


@dataclass
class LayoutNode:
    """배치 대상 — ORM Node와 분리한 순수 값(테스트가 DB 없이 돈다)."""

    id: str
    node_type: str
    x: float = 0.0
    y: float = 0.0

    @property
    def cx(self) -> float:
        return self.x + node_size(self.node_type)[0] / 2

    @property
    def cy(self) -> float:
        return self.y + node_size(self.node_type)[1] / 2


def estimate_label_width(label: str) -> float:
    """엣지 라벨 렌더 폭(px) 추정 — 줄바꿈으로 나뉜 논리 줄 중 가장 넓은 것, 최대폭에서 클램프.

    canvas가 없는 서버에서 텍스트를 실측할 수 없어 글자폭을 근사한다(11px/600 기준):
    한글·CJK는 1em, 그 외는 0.55em, 공백은 0.32em. 과소평가하면 라벨이 노드를 덮으므로
    올림 처리한다. 최대폭을 넘는 줄은 자동 줄바꿈되어 상자 폭이 최대폭으로 고정된다.
    """
    if not label:
        return 0.0
    widest = 0.0
    for line in label.split("\n"):
        width = 0.0
        for ch in line:
            if ch == " ":
                width += 3.5
            elif ord(ch) > 0x1100:  # 한글·CJK·전각 — 대략 1em
                width += 11.0
            else:
                width += 6.1
        widest = max(widest, width)
    return min(float(EDGE_LABEL_MAX_WIDTH), widest)


def _gap_steps(
    layers: dict[int, list[str]],
    ranks: dict[str, int],
    labeled: list[tuple[str, str, str]],
) -> dict[int, float]:
    """랭크 구간(g = rank g→g+1)별 가로 간격 — 그 구간을 지나는 라벨이 들어갈 만큼만 넓힌다.

    엣지가 여러 랭크를 건너뛰면(bypass 등) 라벨이 어느 구간에 놓일지 확정할 수 없어 지나는
    구간 전부를 후보로 본다 — 과소평가(=겹침)보다 과대평가(=여백)가 낫다.
    """
    steps = {g: float(_X_STEP) for g in range(max(layers, default=0))}
    for src, dst, label in labeled:
        need = estimate_label_width(label)
        if need <= 0:
            continue
        want = _MAX_NODE_W + need + EDGE_LABEL_PAD_X + 2 * _LABEL_MARGIN
        lo, hi = sorted((ranks[src], ranks[dst]))
        for g in range(lo, hi):
            if g in steps:
                steps[g] = max(steps[g], want)
    return steps


def compute_ranks(codes: list[str], pairs: list[tuple[str, str]]) -> dict[str, int]:
    """Kahn 토폴로지 순서로 rank(=max(선행)+1). 사이클 잔여 노드는 뒤 rank로 순차 배정(전량 배치)."""
    indeg = {c: 0 for c in codes}
    out: dict[str, list[str]] = {c: [] for c in codes}
    for src, dst in pairs:
        if src not in out or dst not in indeg:
            continue
        out[src].append(dst)
        indeg[dst] += 1
    rank = {c: 0 for c in codes}
    queue = [c for c in codes if indeg[c] == 0]
    seen: list[str] = []
    while queue:
        cur = queue.pop(0)
        seen.append(cur)
        for nxt in out[cur]:
            rank[nxt] = max(rank[nxt], rank[cur] + 1)
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    leftover = [c for c in codes if c not in seen]
    base = (max(rank[c] for c in seen) + 1) if seen and leftover else 0
    for i, code in enumerate(leftover):
        rank[code] = base + i
    return rank


def _order_by_barycenter(
    layers: dict[int, list[str]], pairs: list[tuple[str, str]]
) -> dict[int, list[str]]:
    """레이어 내 순서를 선행 레이어 위치의 평균(배리센터)으로 정렬 — dagre 교차 감소의 축소판.

    앞→뒤 1회 스윕. 선행이 없는 노드는 현재 순서를 유지한다(안정 정렬).
    """
    incoming: dict[str, list[str]] = {}
    for src, dst in pairs:
        incoming.setdefault(dst, []).append(src)
    pos: dict[str, int] = {}
    for rank in sorted(layers):
        row = layers[rank]
        if rank > 0:
            keyed = [
                (
                    sum(pos[p] for p in incoming.get(nid, []) if p in pos)
                    / max(1, len([p for p in incoming.get(nid, []) if p in pos]))
                    if any(p in pos for p in incoming.get(nid, []))
                    else float(i),
                    i,
                    nid,
                )
                for i, nid in enumerate(row)
            ]
            keyed.sort()
            row = [nid for _, _, nid in keyed]
            layers[rank] = row
        for i, nid in enumerate(row):
            pos[nid] = i
    return layers


def compute_spine(
    present: set[str], seed: set[str], pairs: list[tuple[str, str]]
) -> set[str]:
    """spine 판정 — seed에서 "분기 없는 단일 연속" 링크로 이어지는 노드까지 확장.

    flow-layout.ts computeSpine 이식: 선행 outDeg==1 → 후행도 spine, 후행 inDeg==1 → 선행도 spine.
    """
    out_deg: dict[str, int] = {}
    in_deg: dict[str, int] = {}
    for src, dst in pairs:
        if src not in present or dst not in present:
            continue
        out_deg[src] = out_deg.get(src, 0) + 1
        in_deg[dst] = in_deg.get(dst, 0) + 1
    spine = {nid for nid in present if nid in seed}
    grew = True
    while grew:
        grew = False
        for src, dst in pairs:
            if src not in present or dst not in present:
                continue
            if src in spine and out_deg.get(src, 0) == 1 and dst not in spine:
                spine.add(dst)
                grew = True
            if dst in spine and in_deg.get(dst, 0) == 1 and src not in spine:
                spine.add(src)
                grew = True
    return spine


def find_main_path(
    nodes: list[LayoutNode], pairs: list[tuple[str, str]], primary_end_id: str | None
) -> set[str]:
    """시작→대표 끝 BFS 최단 경로 — 척추 시드. 시작/끝이 없거나 미연결이면 빈 집합(직선화 생략)."""
    start = next((n for n in nodes if n.node_type == "start"), None)
    end_id = primary_end_id or next((n.id for n in nodes if n.node_type == "end"), None)
    if start is None or end_id is None:
        return set()
    adjacency: dict[str, list[str]] = {}
    for src, dst in pairs:
        adjacency.setdefault(src, []).append(dst)
    prev: dict[str, str] = {}
    seen = {start.id}
    queue = [start.id]
    while queue:
        current = queue.pop(0)
        if current == end_id:
            break
        for nxt in adjacency.get(current, []):
            if nxt in seen:
                continue
            seen.add(nxt)
            prev[nxt] = current
            queue.append(nxt)
    if end_id not in seen:
        return set()
    path: set[str] = set()
    cursor: str | None = end_id
    while cursor is not None:
        path.add(cursor)
        cursor = prev.get(cursor)
    return path


def align_backbone(nodes: list[LayoutNode], spine: set[str], seed: set[str]) -> None:
    """백본 직선화(LR) — spine을 공통 Y로 스냅, 곁가지는 BRANCH_PUSH만큼 추가 이격. 제자리 변형.

    flow-layout.ts alignBackbone 이식(dir="LR" 고정: cross=Y, flow=X).
    """
    kept = [n for n in nodes if n.id in seed]
    if not kept:
        return
    backbone_cross = sum(n.cy for n in kept) / len(kept)

    groups: dict[int, list[LayoutNode]] = {}
    for node in nodes:
        groups.setdefault(round(node.cx / 10), []).append(node)

    spine_shift: dict[int, float] = {}
    for key, col in groups.items():
        anchor = next((n for n in col if n.id in spine), None)
        if anchor is not None:
            spine_shift[key] = backbone_cross - anchor.cy

    def nearest_shift(key: int) -> float:
        best, best_dist = 0.0, float("inf")
        for spine_key, shift in spine_shift.items():
            dist = abs(spine_key - key)
            if dist < best_dist:
                best_dist, best = dist, shift
        return best

    shift_by_id: dict[str, float] = {}
    for key, col in groups.items():
        shift = spine_shift[key] if key in spine_shift else nearest_shift(key)
        for node in col:
            shift_by_id[node.id] = shift

    for node in nodes:
        shift = shift_by_id.get(node.id, 0.0)
        if node.id not in spine:
            # 정렬 후 backbone 기준 편차 부호로 위/아래를 정해 라인에서 밀어낸다
            resid = node.cy + shift - backbone_cross
            shift += -_BRANCH_PUSH if resid < 0 else _BRANCH_PUSH
        node.y += shift


def is_back_edge(source: LayoutNode, target: LayoutNode) -> bool:
    """흐름 역행 루프 판정(LR) — 타겟이 뒤쪽이고 세로 이동이 작을 때만."""
    return target.cx < source.cx - 40 and abs(target.cy - source.cy) < 150


def pick_handle_side(
    this_node: LayoutNode,
    other: LayoutNode,
    this_on_spine: bool,
    other_on_spine: bool,
    back: bool,
) -> str:
    """한 끝의 출입 변(LR) — 역행=top, spine→곁가지 진입=cross측(top/bottom), 그 외=흐름측."""
    if back:
        return "top"
    dx = other.cx - this_node.cx
    dy = other.cy - this_node.cy
    flow_side = "right" if dx >= 0 else "left"
    cross_side = "top" if dy < 0 else "bottom"
    return cross_side if (this_on_spine and not other_on_spine) else flow_side


def layout_flow(
    nodes: list[LayoutNode],
    pairs: list[tuple[str, str]],
    *,
    primary_end_id: str | None = None,
    back_pairs: set[tuple[str, str]] | None = None,
    labeled: list[tuple[str, str, str]] | None = None,
) -> None:
    """가로 자동정렬 전체 파이프라인 — 제자리 변형(nodes의 x/y를 채운다).

    back_pairs(재수행 loop 엣지)는 rank 계산에서 제외한다 — 되돌아가는 엣지를 선행으로 세면
    사이클로 떨어져 전체가 뒤 rank로 밀린다(레이아웃 붕괴).
    """
    if not nodes:
        return
    ids = [n.id for n in nodes]
    present = set(ids)
    forward = [
        (s, d) for s, d in pairs
        if s in present and d in present and (s, d) not in (back_pairs or set())
    ]
    ranks = compute_ranks(ids, forward)

    layers: dict[int, list[str]] = {}
    for nid in ids:
        layers.setdefault(ranks[nid], []).append(nid)
    layers = _order_by_barycenter(layers, forward)

    # 구간별 간격 — 라벨이 놓이는 구간만 그 라벨 폭만큼 넓힌다
    steps = _gap_steps(layers, ranks, [
        (s, d, text) for s, d, text in (labeled or [])
        if s in present and d in present and text
    ])
    rank_x: dict[int, float] = {}
    cursor = float(_X0)
    for rank in sorted(layers):
        rank_x[rank] = cursor
        cursor += steps.get(rank, float(_X_STEP))

    by_id = {n.id: n for n in nodes}
    for rank in sorted(layers):
        for row, nid in enumerate(layers[rank]):
            node = by_id[nid]
            node.x = rank_x[rank]
            node.y = _Y0 + row * _Y_STEP

    all_pairs = [(s, d) for s, d in pairs if s in present and d in present]
    seed = find_main_path(nodes, forward, primary_end_id)
    spine = compute_spine(present, seed, all_pairs) if seed else set()
    if seed:
        align_backbone(nodes, spine, seed)


def resolve_handles(
    nodes: list[LayoutNode],
    pairs: list[tuple[str, str]],
    spine: set[str],
) -> dict[tuple[str, str], tuple[str, str]]:
    """엣지별 (source_side, target_side) — 배치가 끝난 좌표 기준."""
    by_id = {n.id: n for n in nodes}
    sides: dict[tuple[str, str], tuple[str, str]] = {}
    for src, dst in pairs:
        s, t = by_id.get(src), by_id.get(dst)
        if s is None or t is None:
            continue
        back = is_back_edge(s, t)
        sides[(src, dst)] = (
            pick_handle_side(s, t, src in spine, dst in spine, back),
            pick_handle_side(t, s, dst in spine, src in spine, back),
        )
    return sides


def compute_spine_for(
    nodes: list[LayoutNode], pairs: list[tuple[str, str]], primary_end_id: str | None,
    back_pairs: set[tuple[str, str]] | None = None,
) -> set[str]:
    """layout_flow와 동일한 seed/spine 재계산 — 핸들 지정에 쓴다."""
    present = {n.id for n in nodes}
    forward = [
        (s, d) for s, d in pairs
        if s in present and d in present and (s, d) not in (back_pairs or set())
    ]
    seed = find_main_path(nodes, forward, primary_end_id)
    if not seed:
        return set()
    all_pairs = [(s, d) for s, d in pairs if s in present and d in present]
    return compute_spine(present, seed, all_pairs)
