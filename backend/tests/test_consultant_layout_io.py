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
    split_forward_edges,
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


def test_cycle_would_collapse_ranks_without_back_edge_removal() -> None:
    """사이클이 남으면 Kahn 큐가 비어 전원이 leftover → 랭크가 입력 순서로 매겨진다(회귀 방지)."""
    cyclic = [("a", "b"), ("b", "c"), ("b", "a")]
    # 사이클이 남으면 랭크가 그래프가 아니라 codes 나열 순서를 따라간다 — 순서만 바꿔도 뒤집힌다
    assert compute_ranks(["a", "b", "c"], cyclic) == {"a": 0, "b": 1, "c": 2}
    assert compute_ranks(["c", "b", "a"], cyclic) == {"c": 0, "b": 1, "a": 2}
    ids = ["a", "b", "c"]
    forward, back = split_forward_edges(ids, cyclic)
    assert back == {("b", "a")}
    assert compute_ranks(ids, forward) == {"a": 0, "b": 1, "c": 2}


def test_declared_loop_fixes_the_order_regardless_of_node_order() -> None:
    """전원이 사이클에 묶이면 DFS 시작점에 결과가 좌우된다 — kind="loop" 표시가 확정한다.

    L5 연계 캔버스가 이 모양이다(준비→수행→준비). 표시를 안 주면 노드 나열 순서만 바꿔도 배치가 뒤집힌다.
    """
    pairs = [("준비", "수행"), ("준비", "보고"), ("수행", "보고"), ("수행", "준비")]
    declared = {("수행", "준비")}
    for ids in (["준비", "수행", "보고"], ["보고", "수행", "준비"]):
        forward, back = split_forward_edges(ids, pairs, declared)
        assert back == declared
        assert compute_ranks(ids, forward) == {"준비": 0, "수행": 1, "보고": 2}


def test_back_edge_search_starts_from_entry_nodes() -> None:
    """사슬에 사이클이 매달린 흔한 모양 — 진입 노드부터 훑어야 진짜 되돌아가는 엣지를 고른다."""
    ids = ["c", "b", "s", "a"]  # 일부러 진입(s)을 뒤에 둔다
    pairs = [("s", "a"), ("a", "b"), ("b", "c"), ("c", "a")]
    forward, back = split_forward_edges(ids, pairs)
    assert back == {("c", "a")}
    assert compute_ranks(ids, forward) == {"s": 0, "a": 1, "b": 2, "c": 3}


def test_linkage_canvas_cycle_lays_out_in_flow_order() -> None:
    """SP 노드끼리 loop이 걸려도 선행 순서가 좌→우로 잡힌다 (사용자 지적 2026-09-01)."""
    nodes = [LayoutNode(id=n, node_type="subprocess") for n in ("준비", "수행", "보고")]
    pairs = [("준비", "수행"), ("준비", "보고"), ("수행", "보고"), ("수행", "준비")]
    layout_flow(nodes, pairs, primary_end_id=None, back_pairs={("수행", "준비")})
    xs = {n.id: n.x for n in nodes}
    assert xs["준비"] < xs["수행"] < xs["보고"]


def test_undeclared_cycle_still_gets_a_sane_layout() -> None:
    """kind 표시가 없는 사이클(seq 두 개가 서로를 가리킴)도 배치가 무너지지 않는다."""
    nodes = [LayoutNode(id=n, node_type="subprocess") for n in ("a", "b", "c")]
    pairs = [("a", "b"), ("b", "c"), ("c", "b")]
    layout_flow(nodes, pairs, primary_end_id=None)
    xs = {n.id: n.x for n in nodes}
    assert xs["a"] < xs["b"] < xs["c"]


def _lk(source: str, target: str, *, kind: str = "seq", gateway: str = "", label: str = ""):
    from scripts.consultant_interview import InterviewLinkageEdge

    return InterviewLinkageEdge(source=source, target=target, label=label, kind=kind, gateway=gateway)


def test_branch_node_splits_a_fanout() -> None:
    """A→B, B→A(loop)/B→C — B 뒤에 분기 노드를 세우고 거기서 A·C로 가른다 (사용자 결정 2026-09-01)."""
    from scripts.import_consultant import expand_linkage_branches

    edges = [
        _lk("A", "B"),
        _lk("B", "A", kind="loop", label="되돌아감"),
        _lk("B", "C", label="진행"),
    ]
    flow, branch_of, back = expand_linkage_branches(edges, {"A", "B", "C"})
    assert branch_of == {"__branch__B": "B"}
    assert flow == [
        ("A", "B", "", None),
        ("B", "__branch__B", "", None),
        ("__branch__B", "A", "되돌아감", None),
        ("__branch__B", "C", "진행", None),
    ]
    # 되돌아가는 쌍은 재작성 좌표계로 옮겨진다 — 안 그러면 사이클이 되살아나 랭크가 무너진다
    assert back == {("__branch__B", "A")}


def test_single_out_edge_gets_no_branch_node() -> None:
    from scripts.import_consultant import expand_linkage_branches

    flow, branch_of, _ = expand_linkage_branches([_lk("A", "B"), _lk("B", "C")], {"A", "B", "C"})
    assert branch_of == {}
    assert flow == [("A", "B", "", None), ("B", "C", "", None)]


def test_parallel_fanout_gets_no_branch_node() -> None:
    """병행 팬아웃은 택일이 아니다 — 마름모를 세우면 오독된다(L6 승격 제외 규칙과 동일)."""
    from scripts.import_consultant import expand_linkage_branches

    edges = [
        _lk("A", "B", kind="branch", gateway="parallel"),
        _lk("A", "C", kind="branch", gateway="parallel"),
    ]
    flow, branch_of, _ = expand_linkage_branches(edges, {"A", "B", "C"})
    assert branch_of == {}
    # 비-fork·전부-parallel 그룹은 gateway="parallel"을 실어 확정 게이트 6 예외 판정 재료가 된다
    assert flow == [("A", "B", "", "parallel"), ("A", "C", "", "parallel")]


def test_mixed_gateway_fanout_still_branches() -> None:
    """하나라도 병행이 아니면 택일 요소가 있는 것 — 분기 노드를 세운다."""
    from scripts.import_consultant import expand_linkage_branches

    edges = [
        _lk("A", "B", kind="branch", gateway="parallel"),
        _lk("A", "C", kind="bypass"),
    ]
    _, branch_of, _ = expand_linkage_branches(edges, {"A", "B", "C"})
    assert branch_of == {"__branch__A": "A"}


def test_edges_outside_the_canvas_are_ignored() -> None:
    from scripts.import_consultant import expand_linkage_branches

    flow, branch_of, _ = expand_linkage_branches(
        [_lk("A", "B"), _lk("A", "GONE")], {"A", "B"})
    assert flow == [("A", "B", "", None)]
    assert branch_of == {}  # 남은 out-edge가 1개 → 분기 아님


def test_branch_fanout_goes_top_then_bottom_then_side() -> None:
    """분기 출구는 오른쪽 위 → 아래 → 옆 순 (사용자 결정 2026-09-01)."""
    from scripts.consultant_layout import plan_branch_fanout

    flow = [
        ("A", "◇A", ""),
        ("◇A", "X", ""),
        ("◇A", "Y", ""),
        ("◇A", "Z", ""),
    ]
    rows, sides = plan_branch_fanout(flow, {"◇A": "A"}, {"A": 0, "◇A": 1, "X": 2, "Y": 2, "Z": 2})
    assert rows["X"] == -1 and rows["Y"] == 1 and rows["Z"] == 0
    assert sides[("◇A", "X")] == "top"
    assert sides[("◇A", "Y")] == "bottom"
    assert sides[("◇A", "Z")] == "right"


def test_fanout_beyond_three_keeps_spreading() -> None:
    from scripts.consultant_layout import plan_branch_fanout

    flow = [("A", "◇A", "")] + [("◇A", f"T{i}", "") for i in range(5)]
    ranks = {"A": 0, "◇A": 1}
    rows, sides = plan_branch_fanout(flow, {"◇A": "A"}, ranks)
    assert [rows[f"T{i}"] for i in range(5)] == [-1, 1, 0, -2, 2]
    assert sides[("◇A", "T3")] == "top" and sides[("◇A", "T4")] == "bottom"


def test_shared_target_keeps_its_first_row() -> None:
    """두 분기가 같은 L6로 합류하면 나중 분기가 위치를 흔들지 않는다."""
    from scripts.consultant_layout import plan_branch_fanout

    flow = [
        ("A", "◇A", ""), ("◇A", "M", ""), ("◇A", "N", ""),
        ("N", "◇N", ""), ("◇N", "M", ""), ("◇N", "Q", ""),
    ]
    ranks = {"A": 0, "◇A": 1, "M": 2, "N": 2, "◇N": 3, "Q": 4}
    rows, sides = plan_branch_fanout(flow, {"◇A": "A", "◇N": "N"}, ranks)
    assert rows["M"] == -1  # 첫 배정 유지
    # 변은 최종 행에서 되뽑는다 — 기하와 항상 일치
    assert rows["◇N"] == rows["N"] == 1
    assert sides[("◇N", "M")] == "top"  # M(-1)이 ◇N(1)보다 위


def test_branch_node_inherits_its_feeder_row() -> None:
    from scripts.consultant_layout import plan_branch_fanout

    flow = [("A", "◇A", ""), ("◇A", "B", ""), ("◇A", "C", ""), ("B", "◇B", ""), ("◇B", "D", "")]
    ranks = {"A": 0, "◇A": 1, "B": 2, "C": 2, "◇B": 3, "D": 4}
    rows, _ = plan_branch_fanout(flow, {"◇A": "A", "◇B": "B"}, ranks)
    assert rows["B"] == -1 and rows["◇B"] == -1  # 선행 행을 물려받는다
    assert rows["D"] == -2  # 그 위로 한 칸 더


def test_self_edge_forces_branch_loop() -> None:
    """자기 반복(A→A)은 분기 노드를 세워 ◇→A 루프백으로 — 셀프 엣지를 캔버스에 직접 그리지 않는다 (2026-09-02)."""
    from scripts.import_consultant import expand_linkage_branches

    flow, branch_of, back = expand_linkage_branches(
        [_lk("A", "A", kind="loop", label="반복"), _lk("A", "B", label="진행")], {"A", "B"}
    )
    assert branch_of == {"__branch__A": "A"}
    assert flow == [
        ("A", "__branch__A", "", None),
        ("__branch__A", "A", "반복", None),
        ("__branch__A", "B", "진행", None),
    ]
    assert back == {("__branch__A", "A")}


def test_self_origin_branch_is_detectable_via_back_pairs() -> None:
    """(origin, 원본 src) ∈ back ⇔ self 유래 — L5 창작부가 이 시그니처로 '반복 여부(자동 생성됨)' 이름을 고른다."""
    from scripts.import_consultant import expand_linkage_branches

    _, branch_of, back = expand_linkage_branches(
        [_lk("A", "A", label="반복"), _lk("B", "A", kind="loop"), _lk("B", "C"), _lk("B", "D")],
        {"A", "B", "C", "D"},
    )
    assert ("__branch__A", branch_of["__branch__A"]) in back  # self 유래
    assert ("__branch__B", branch_of["__branch__B"]) not in back  # 팬아웃(+타 노드 loop) 유래
    assert ("__branch__B", "A") in back  # 타 노드로 되돌아가는 loop은 그대로 back


def test_solo_self_edge_still_gets_branch_node() -> None:
    """다른 진출이 없어도 분기 노드를 세운다 — kind가 loop가 아니어도 self는 back 쌍으로 등록(랭크 보호)."""
    from scripts.import_consultant import expand_linkage_branches

    flow, branch_of, back = expand_linkage_branches([_lk("A", "A", label="재수행")], {"A"})
    assert branch_of == {"__branch__A": "A"}
    assert flow == [("A", "__branch__A", "", None), ("__branch__A", "A", "재수행", None)]
    assert back == {("__branch__A", "A")}
