"""임포트 가로 자동정렬 + IO 자동 연결 — 순수 함수 단위(DB 없이).

설계: docs/design/2026-09-01-interview-import-v04-design.md §6·§7.
정렬은 `frontend/src/lib/flow-layout.ts`(autoLayoutFlow, LR)와 동치 이중 구현 —
한쪽을 고치면 이 테스트와 `flow-layout.test.ts`를 같이 옮긴다.
"""

from app.models import Edge, Node
from scripts.consultant_layout import (
    LayoutNode,
    compute_ranks,
    compute_spine,
    compute_spine_for,
    find_main_path,
    layout_flow,
    resolve_handles,
)
from scripts.import_consultant import link_matching_io, make_item_id


def _chain(n: int) -> tuple[list[LayoutNode], list[tuple[str, str]]]:
    nodes = [LayoutNode(id="s", node_type="start")]
    nodes += [LayoutNode(id=f"a{i}", node_type="process") for i in range(1, n + 1)]
    nodes.append(LayoutNode(id="e", node_type="end"))
    ids = [x.id for x in nodes]
    return nodes, list(zip(ids, ids[1:]))


def test_ranks_place_chain_left_to_right() -> None:
    nodes, pairs = _chain(3)
    layout_flow(nodes, pairs, primary_end_id="e")
    xs = [n.x for n in nodes]
    assert xs == sorted(xs) and len(set(xs)) == len(xs)  # rank마다 한 칸씩 오른쪽


def test_straight_chain_lands_on_one_backbone_line() -> None:
    """분기 없는 체인은 전부 spine — 중심 Y가 한 줄로 정렬된다."""
    nodes, pairs = _chain(4)
    layout_flow(nodes, pairs, primary_end_id="e")
    centers = {round(n.cy, 3) for n in nodes}
    assert len(centers) == 1


def test_branch_is_pushed_off_the_backbone() -> None:
    """곁가지는 주 흐름 라인에서 BRANCH_PUSH만큼 이격된다(엣지 꺾임 1회화)."""
    nodes = [
        LayoutNode(id="s", node_type="start"),
        LayoutNode(id="a1", node_type="decision"),
        LayoutNode(id="a2", node_type="process"),
        LayoutNode(id="a3", node_type="process"),
        LayoutNode(id="a4", node_type="process"),
        LayoutNode(id="e", node_type="end"),
    ]
    pairs = [("s", "a1"), ("a1", "a2"), ("a1", "a3"), ("a2", "a4"), ("a3", "a4"), ("a4", "e")]
    layout_flow(nodes, pairs, primary_end_id="e")
    by_id = {n.id: n for n in nodes}
    spine = compute_spine_for(nodes, pairs, "e")
    off = [n for n in nodes if n.id not in spine]
    assert off, "분기가 있으면 spine 밖 노드가 있어야 한다"
    backbone = by_id["s"].cy
    assert all(abs(n.cy - backbone) >= 60 for n in off)


def test_loop_edge_does_not_collapse_the_layout() -> None:
    """loop(재수행)을 선행으로 세면 사이클이라 전체가 뒤 rank로 밀린다 — 제외해야 한다."""
    nodes, pairs = _chain(3)
    pairs = [*pairs, ("a3", "a1")]
    layout_flow(nodes, pairs, primary_end_id="e", back_pairs={("a3", "a1")})
    by_id = {n.id: n for n in nodes}
    assert by_id["s"].x < by_id["a1"].x < by_id["a2"].x < by_id["a3"].x < by_id["e"].x


def test_back_edge_uses_top_handle() -> None:
    nodes, pairs = _chain(3)
    pairs = [*pairs, ("a3", "a1")]
    layout_flow(nodes, pairs, primary_end_id="e", back_pairs={("a3", "a1")})
    spine = compute_spine_for(nodes, pairs, "e", {("a3", "a1")})
    sides = resolve_handles(nodes, pairs, spine)
    assert sides[("a3", "a1")] == ("top", "top")  # 역행 엣지는 위로 뽑는다
    assert sides[("a1", "a2")] == ("right", "left")


def test_find_main_path_empty_without_terminals() -> None:
    nodes = [LayoutNode(id="a1", node_type="process"), LayoutNode(id="a2", node_type="process")]
    assert find_main_path(nodes, [("a1", "a2")], None) == set()


def test_compute_ranks_places_cycle_leftovers_after() -> None:
    ranks = compute_ranks(["a", "b", "c"], [("a", "b"), ("b", "c"), ("c", "b")])
    assert ranks["a"] == 0 and ranks["b"] > 0 and ranks["c"] > 0


def test_compute_spine_stops_at_branch() -> None:
    pairs = [("s", "a1"), ("a1", "a2"), ("a1", "a3")]
    spine = compute_spine({"s", "a1", "a2", "a3"}, {"s", "a1"}, pairs)
    assert spine == {"s", "a1"}  # outDeg 2 → 분기 너머는 spine 아님


def _node(nid: str, order: int, *, inp: str = "", out: str = "") -> Node:
    return Node(id=nid, source_node_id=nid, title=nid, node_type="process",
                sort_order=order, input=inp, output=out)


def _edge(src: str, dst: str) -> Edge:
    return Edge(id=f"{src}-{dst}", source_node_id=src, target_node_id=dst)


def test_exact_io_match_links_downstream_input() -> None:
    nodes = [_node("n1", 1, out="표준기 후보"), _node("n2", 2, inp="표준기 후보")]
    assert link_matching_io(nodes, [_edge("n1", "n2")], "L6-1") == 1
    item_id = nodes[0].output_ids
    assert item_id and nodes[1].input_links == item_id
    assert item_id == make_item_id("L6-1", "n1", 0)  # 결정적 id — 재임포트에도 불변


def test_link_only_follows_the_flow_direction() -> None:
    """텍스트가 같아도 흐름상 도달 불가면 잇지 않는다 — 무관 분기의 동명 항목 오연결 차단."""
    nodes = [_node("n1", 1, out="검체"), _node("n2", 2, inp="검체")]
    assert link_matching_io(nodes, [_edge("n2", "n1")], "L6-1") == 0  # 역방향
    assert link_matching_io(nodes, [], "L6-1") == 0  # 무관


def test_nearest_upstream_origin_wins_when_several_match() -> None:
    """한 항목 = 링크 1개 — 원본 후보가 여럿이면 최근접 상류를 고른다."""
    nodes = [
        _node("far", 1, out="채취 검체"),
        _node("mid", 2),
        _node("near", 3, out="채취 검체"),
        _node("sink", 4, inp="채취 검체"),
    ]
    edges = [_edge("far", "mid"), _edge("mid", "near"), _edge("near", "sink"),
             _edge("mid", "sink")]
    assert link_matching_io(nodes, edges, "L6-1") == 1
    near = next(n for n in nodes if n.id == "near")
    assert nodes[3].input_links == near.output_ids != ""
    assert next(n for n in nodes if n.id == "far").output_ids in (None, "")


def test_one_origin_serves_many_mirrors() -> None:
    nodes = [
        _node("src", 1, out="양식 준비 방식"),
        _node("b1", 2, inp="양식 준비 방식"),
        _node("b2", 3, inp="양식 준비 방식"),
    ]
    edges = [_edge("src", "b1"), _edge("src", "b2")]
    assert link_matching_io(nodes, edges, "L6-1") == 2
    assert nodes[1].input_links == nodes[2].input_links == nodes[0].output_ids


def test_line_level_matching_keeps_alignment() -> None:
    """매칭 단위는 줄(항목) — 인풋 2줄 중 두 번째만 이어도 줄 정렬이 유지된다."""
    nodes = [_node("n1", 1, out="지참 목록"), _node("n2", 2, inp="표준기 후보\n지참 목록")]
    assert link_matching_io(nodes, [_edge("n1", "n2")], "L6-1") == 1
    assert nodes[1].input_links.split("\n") == ["", nodes[0].output_ids]


def test_existing_link_is_not_overwritten() -> None:
    """재임포트가 사용자 편집(수동 링크)을 덮지 않는다."""
    nodes = [_node("n1", 1, out="검체"), _node("n2", 2, inp="검체")]
    nodes[1].input_links = "manual-item-id"
    assert link_matching_io(nodes, [_edge("n1", "n2")], "L6-1") == 0
    assert nodes[1].input_links == "manual-item-id"


def test_blank_lines_are_ignored() -> None:
    nodes = [_node("n1", 1, out="\n  \n"), _node("n2", 2, inp="\n")]
    assert link_matching_io(nodes, [_edge("n1", "n2")], "L6-1") == 0


def test_label_width_estimate_clamps_and_takes_widest_line() -> None:
    from scripts.consultant_layout import EDGE_LABEL_MAX_WIDTH, estimate_label_width

    assert estimate_label_width("") == 0
    # 한글은 대략 1em(11px) — 5자면 55px 안팎
    assert 45 <= estimate_label_width("표준기 선정") <= 70
    # 논리 줄이 여럿이면 가장 넓은 줄이 상자 폭
    assert estimate_label_width("짧음\n아주 많이 긴 조건 문장입니다") > estimate_label_width("짧음")
    # 최대폭을 넘으면 자동 줄바꿈 — 상자 폭은 최대폭에서 고정
    assert estimate_label_width("가" * 200) == EDGE_LABEL_MAX_WIDTH


def _gap(nodes: list[LayoutNode], a: str, b: str) -> float:
    """노드 a의 오른쪽 끝과 b의 왼쪽 끝 사이 빈 가로 공간."""
    from scripts.consultant_layout import node_size

    by_id = {n.id: n for n in nodes}
    return by_id[b].x - (by_id[a].x + node_size(by_id[a].node_type)[0])


def test_labeled_gap_fits_the_label_box() -> None:
    """첫 자동배치에서 라벨이 노드를 덮지 않으려면 그 구간이 라벨 상자보다 넓어야 한다."""
    from scripts.consultant_layout import EDGE_LABEL_PAD_X, estimate_label_width

    label = "표준기 라인\n작업지시 확인 후 표준기 선정과 양식 준비를 동시에 진행"
    nodes, pairs = _chain(2)
    layout_flow(nodes, pairs, primary_end_id="e", labeled=[("a1", "a2", label)])
    assert _gap(nodes, "a1", "a2") >= estimate_label_width(label) + EDGE_LABEL_PAD_X


def test_unlabeled_gap_stays_compact() -> None:
    """라벨이 없는 구간까지 넓히면 맵이 쓸데없이 커진다 — 기본 간격을 유지한다."""
    nodes, pairs = _chain(2)
    layout_flow(nodes, pairs, primary_end_id="e", labeled=[("a1", "a2", "긴 조건 문장입니다 " * 3)])
    narrow = _gap(nodes, "s", "a1")
    wide = _gap(nodes, "a1", "a2")
    assert wide > narrow
    assert narrow == 240 - 96  # 기본 스텝 − Start 노드 폭


def test_multi_rank_edge_widens_every_gap_it_crosses() -> None:
    """여러 랭크를 건너뛰는 엣지는 라벨 위치를 확정할 수 없다 — 지나는 구간을 전부 넓힌다."""
    nodes, pairs = _chain(3)
    long_label = "이 구간을 지나는 아주 긴 조건 문장"
    layout_flow(nodes, pairs, primary_end_id="e", labeled=[("a1", "a3", long_label)])
    assert _gap(nodes, "a1", "a2") > 240 - 170
    assert _gap(nodes, "a2", "a3") > 240 - 170
