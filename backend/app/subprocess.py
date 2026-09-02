"""하위프로세스 참조 모델 — 프로세스 검증·순환 탐지·링크 버전 해석·확정 게이트."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import Edge, MapVersion, Node, ProcessCategory, ProcessMap
from app.permissions.access import get_framework_category_id
from app.schemas import NodeIn, SubprocessRefOut


# 하위프로세스 노드 전용 핸들 — SP 노드는 이 두 핸들만 렌더한다(입력 "in" / 대표끝 출력 "__primary__").
# 서버가 SP 끝점 엣지를 만들 때 이 값을 안 넣으면 React Flow가 붙일 핸들을 못 찾아 **엣지를 조용히
# 버린다**(노드만 뜨고 선이 안 보임). frontend/src/lib/subprocess-embed.ts와 수동 동기.
SUBPROCESS_IN_HANDLE = "in"
PRIMARY_END_HANDLE = "__primary__"
# 일반 노드(분기·끝)의 변별 핸들 id — frontend process-node.tsx의 `s-{side}`/`t-{side}`와 동기.
# 연계 캔버스에 분기 노드를 끼울 때 SP 전용 핸들을 그대로 쓰면 또 엣지가 사라진다.
DEFAULT_TARGET_HANDLE = "t-left"


def side_source_handle(side: str) -> str:
    """변 이름 → 출구 핸들 id. 분기 노드는 4면을 다 쓴다(SP는 __primary__ 고정)."""
    return f"s-{side}"

# L5 연계 캔버스 그리드 레이아웃 — 캔버스 열기(routers/categories)와 인터뷰 임포트(scripts/import_consultant)가
# 같은 좌표 규칙을 쓴다. 한쪽만 바꾸면 임포트가 보강한 노드가 사용자 캔버스와 어긋난 격자에 놓인다.
LINKAGE_X0, LINKAGE_Y0 = 120, 120
LINKAGE_X_STEP, LINKAGE_Y_STEP = 240, 120
LINKAGE_COLS = 4


def grid_positions(start_index: int, count: int, base_y: float) -> list[tuple[float, float]]:
    """row-major 그리드 좌표 — start_index부터 count개."""
    out: list[tuple[float, float]] = []
    for i in range(start_index, start_index + count):
        col, row = i % LINKAGE_COLS, i // LINKAGE_COLS
        out.append((LINKAGE_X0 + col * LINKAGE_X_STEP, base_y + row * LINKAGE_Y_STEP))
    return out


async def unique_linkage_name(
    session: AsyncSession, category: ProcessCategory, exclude_map_id: int | None = None
) -> str:
    """캔버스 맵 이름 자동 — "{카테고리명} 연계", 전역 충돌 시 코드/카운터 서픽스."""
    base = f"{category.name} 연계"
    candidates = [base, f"{base} ({category.code})"]
    n = 2
    while True:
        for candidate in candidates:
            query = select(ProcessMap.id).where(ProcessMap.name == candidate)
            if exclude_map_id is not None:
                query = query.where(ProcessMap.id != exclude_map_id)
            if await session.scalar(query) is None:
                return candidate
        candidates = [f"{base} ({category.code}) ({n})"]
        n += 1


def validate_process(nodes: list[NodeIn]) -> None:
    """프로세스 그래프 규칙 검증 + 대표 끝 기본값 설정 — 위반 시 ValueError. (spec §3.3)

    끝 노드가 있고 is_primary_end 미지정(0개)이면 sort_order 최소 끝을 대표로 기본 지정.
    """
    if not nodes:
        return
    starts = [n for n in nodes if n.node_type == "start"]
    if len(starts) != 1:
        raise ValueError(f"시작 노드는 정확히 1개여야 합니다 (현재 {len(starts)}개).")
    ends = [n for n in nodes if n.node_type == "end"]
    names = [e.title for e in ends]
    if len(names) != len(set(names)):
        raise ValueError("끝 노드 이름이 중복되었습니다 (끝 이름은 유니크해야 함).")
    primaries = [e for e in ends if e.is_primary_end]
    if len(primaries) > 1:
        raise ValueError(f"대표 끝은 1개여야 합니다 (현재 {len(primaries)}개).")
    # spec §3.3: 끝이 있는데 대표가 없으면 sort_order 최소(동점은 payload 순서) 끝을 기본 지정
    if ends and not primaries:
        first_end = min(ends, key=lambda e: e.sort_order)
        first_end.is_primary_end = True


def validate_framework_canvas(nodes: list[NodeIn]) -> None:
    """framework 연계 캔버스 규칙 — subprocess(링크드·플레이스홀더) + 분기·끝 허용, start/process 차단.

    링크 없는 subprocess = 플레이스홀더(미등록 L6 자리, design 2026-08-28 §10.1) — 임포트가 파두고
    후차 연결한다. 끝 노드는 일반 맵과 동일 규칙(이름 유니크·대표 ≤1·자동 대표 지정)을 적용한다.
    """
    for n in nodes:
        if n.node_type not in ("subprocess", "decision", "end"):
            raise ValueError(
                "framework canvas allows subprocess, decision, and end nodes only"
            )
    ends = [n for n in nodes if n.node_type == "end"]
    names = [e.title for e in ends]
    if len(names) != len(set(names)):
        raise ValueError("끝 노드 이름이 중복되었습니다 (끝 이름은 유니크해야 함).")
    primaries = [e for e in ends if e.is_primary_end]
    if len(primaries) > 1:
        raise ValueError(f"대표 끝은 1개여야 합니다 (현재 {len(primaries)}개).")
    if ends and not primaries:
        first_end = min(ends, key=lambda e: e.sort_order)
        first_end.is_primary_end = True


async def resolve_linked_version(
    session: AsyncSession,
    map_id: int,
    follow_latest: bool,
    pinned_version_id: int | None,
) -> int | None:
    """렌더할 버전 id 결정 — follow_latest면 최신 발행본, 아니면 고정. (spec §5)"""
    if not follow_latest and pinned_version_id is not None:
        return pinned_version_id
    published = await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id, MapVersion.status == "published")
        .order_by(MapVersion.id.desc())
    )
    if published is not None:
        return published
    return await session.scalar(
        select(MapVersion.id)
        .where(MapVersion.map_id == map_id)
        .order_by(MapVersion.id.desc())
    )


async def get_subprocess_refs(
    session: AsyncSession, nodes: list[NodeIn]
) -> dict[int, SubprocessRefOut]:
    """그래프 내 subprocess 노드들의 링크 대상 지정 정보 — 라이브 참조 (spec 2026-07-06).

    soft-delete·영구삭제된 맵은 designated=False 취급 → 프론트가 경고+잠금 렌더.
    """
    targets = {
        n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id
    }
    if not targets:
        return {}
    rows = (
        await session.execute(
            select(
                ProcessMap.id,
                ProcessMap.name,
                ProcessMap.sp_designated_at,
                ProcessMap.deleted_at,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
                ProcessMap.sp_cost_krw,
                ProcessMap.sp_cost_usd,
                ProcessMap.sp_headcount,
                ProcessMap.sp_touch_time,
                ProcessMap.sp_input,
                ProcessMap.sp_output,
                ProcessMap.sp_input_forms,
                ProcessMap.sp_output_forms,
                ProcessMap.sp_input_ids,
                ProcessMap.sp_output_ids,
                ProcessMap.sp_start_condition,
                ProcessMap.sp_end_condition,
                ProcessMap.sp_frequency_fallback,
                ProcessMap.sp_gmp,
                ProcessMap.sp_url,
                ProcessMap.sp_url_label,
                # 지정 설명 = 맵 설명(sp_description 폐기, 2026-08-31)
                ProcessMap.description,
                ProcessMap.category_id,
                ProcessMap.retired_to_map_id,
            ).where(ProcessMap.id.in_(targets))
        )
    ).all()
    refs: dict[int, SubprocessRefOut] = {}
    category_id_by_map: dict[int, int | None] = {}
    # 은퇴 체인 출발점 — 삭제된 링크맵의 retired_to (후계자 추적용, 2026-08-30)
    retire_heads: dict[int, int] = {}
    for (
        mid,
        name,
        designated_at,
        deleted_at,
        department,
        assignee,
        system,
        duration,
        cost_krw,
        cost_usd,
        headcount,
        touch_time,
        sp_input,
        sp_output,
        sp_input_forms,
        sp_output_forms,
        sp_input_ids,
        sp_output_ids,
        start_condition,
        end_condition,
        frequency_fallback,
        sp_gmp,
        url,
        url_label,
        map_description,
        category_id,
        retired_to_map_id,
    ) in rows:
        if deleted_at is not None and retired_to_map_id is not None:
            retire_heads[mid] = retired_to_map_id
        refs[mid] = SubprocessRefOut(
            designated=designated_at is not None and deleted_at is None,
            deleted=deleted_at is not None,
            name=name,
            department=department,
            assignee=assignee,
            system=system,
            duration=duration,
            cost_krw=cost_krw,
            cost_usd=cost_usd,
            headcount=headcount,
            touch_time=touch_time,
            input=sp_input,
            output=sp_output,
            input_forms=sp_input_forms,
            output_forms=sp_output_forms,
            input_ids=sp_input_ids,
            output_ids=sp_output_ids,
            start_condition=start_condition,
            end_condition=end_condition,
            frequency_fallback=frequency_fallback,
            gmp=sp_gmp,
            url=url,
            url_label=url_label,
            # 빈 문자열은 None으로 — 소비측(캔버스 설명 합성·Excel)이 "값 없음"으로 다루게
            sp_description=map_description or None,
        )
        category_id_by_map[mid] = category_id
    # 링크맵 체계 경로 — 캔버스 외부 L6 출신 배지 소스(라이브 파생) (design 2026-08-28 §8)
    if any(cid is not None for cid in category_id_by_map.values()):
        from app.routers.categories import build_category_paths  # 지역 관례 — 순환 회피(maps.py:66)

        cat_rows = (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
        paths = build_category_paths(cat_rows)
        for mid, cid in category_id_by_map.items():
            if cid is not None:
                refs[mid].category_path = paths.get(cid)
                # 홈 L5 id — 캔버스 외부 L6 색상 키(같은 L5=같은 색) (2026-08-28 개선)
                refs[mid].category_id = cid
    for missing in targets - refs.keys():  # 링크 대상 맵이 영구삭제된 경우
        refs[missing] = SubprocessRefOut(designated=False, deleted=True)
    # 이양 후계자 — 은퇴 체인을 살아있는 맵까지 추적해 동봉(교체 다이얼로그 추천 소스) (2026-08-30)
    for mid, head in retire_heads.items():
        cursor: int | None = head
        seen: set[int] = set()
        for _ in range(5):  # 연쇄 이양 상한 — 순환·폭주 방어
            if cursor is None or cursor in seen:
                break
            seen.add(cursor)
            row = (
                await session.execute(
                    select(
                        ProcessMap.id,
                        ProcessMap.name,
                        ProcessMap.deleted_at,
                        ProcessMap.retired_to_map_id,
                    ).where(ProcessMap.id == cursor)
                )
            ).first()
            if row is None:
                break
            if row.deleted_at is None:
                refs[mid].successor_map_id = row.id
                refs[mid].successor_name = row.name
                break
            cursor = row.retired_to_map_id
    return refs


async def get_placeholder_category_paths(
    session: AsyncSession, nodes: list[NodeIn]
) -> dict[int, str]:
    """플레이스홀더(미등록 SP)의 출처 L5 경로 — 배지 표시 소스 (design 2026-08-28 §10.1)."""
    targets = {
        n.placeholder_category_id
        for n in nodes
        if n.node_type == "subprocess"
        and n.linked_map_id is None
        and n.placeholder_category_id
    }
    if not targets:
        return {}
    from app.routers.categories import build_category_paths  # 지역 관례 — 순환 회피(maps.py:66)

    cat_rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
        )
    ).all()
    paths = build_category_paths(cat_rows)
    return {cid: path for cid in targets if (path := paths.get(cid)) is not None}


async def assert_no_cycle(
    session: AsyncSession, version_id: int, nodes: list[NodeIn]
) -> None:
    """이 버전 저장이 참조 사이클을 만들면 ValueError. (spec §4)"""
    self_map_id = await session.scalar(
        select(MapVersion.map_id).where(MapVersion.id == version_id)
    )
    targets = {n.linked_map_id for n in nodes if n.node_type == "subprocess" and n.linked_map_id}
    seen: set[int] = set()
    stack = list(targets)
    while stack:
        m = stack.pop()
        if m == self_map_id:
            raise ValueError("순환 참조입니다 — 자기 자신을 직접/간접 하위로 가져올 수 없습니다.")
        if m in seen:
            continue
        seen.add(m)
        # m 맵의 모든 버전 노드가 참조하는 맵들을 따라간다
        refs = (
            await session.scalars(
                select(Node.linked_map_id)
                .join(MapVersion, Node.version_id == MapVersion.id)
                .where(MapVersion.map_id == m, Node.linked_map_id.is_not(None))
            )
        ).all()
        stack.extend(r for r in refs if r is not None)


@dataclass
class GateFailure:
    """확정 게이트 위반 1건 — code는 6종 고정, node_ids는 위반 노드(없으면 빈 리스트)."""

    code: str
    count: int
    node_ids: list[str]


async def find_missing_l6_ids(
    session: AsyncSession, category_id: int, draft: MapVersion
) -> list[int]:
    """소속 L6 중 캔버스 미배치 map_id — linkage-map 보강(categories.py open_linkage_map)과 동일 산식."""
    contained_ids = (
        await session.scalars(
            select(ProcessMap.id).where(
                ProcessMap.category_id == category_id, ProcessMap.deleted_at.is_(None)
            )
        )
    ).all()
    linked_ids = set(
        (
            await session.scalars(
                select(Node.linked_map_id).where(
                    Node.version_id == draft.id,
                    Node.node_type == "subprocess",
                    Node.linked_map_id.is_not(None),
                )
            )
        ).all()
    )
    return [mid for mid in contained_ids if mid not in linked_ids]


def _find_scc_iterative(node_ids: list[str], adj: dict[str, list[str]]) -> list[list[str]]:
    """반복형 Tarjan SCC — 재귀 없이 대형 캔버스(268노드+ 실존)를 안전 처리한다."""
    next_index = 0
    node_stack: list[str] = []
    on_stack: set[str] = set()
    indices: dict[str, int] = {}
    lowlink: dict[str, int] = {}
    components: list[list[str]] = []

    for start in node_ids:
        if start in indices:
            continue
        # (node, 다음에 살펴볼 이웃 인덱스) 명시적 워크 스택 — 재귀 프레임을 대체
        work: list[list] = [[start, 0]]
        indices[start] = lowlink[start] = next_index
        next_index += 1
        node_stack.append(start)
        on_stack.add(start)
        while work:
            frame = work[-1]
            node, i = frame[0], frame[1]
            neighbors = adj.get(node, [])
            if i < len(neighbors):
                frame[1] += 1
                nxt = neighbors[i]
                if nxt not in indices:
                    indices[nxt] = lowlink[nxt] = next_index
                    next_index += 1
                    node_stack.append(nxt)
                    on_stack.add(nxt)
                    work.append([nxt, 0])
                elif nxt in on_stack:
                    lowlink[node] = min(lowlink[node], indices[nxt])
            else:
                work.pop()
                if work:
                    parent = work[-1][0]
                    lowlink[parent] = min(lowlink[parent], lowlink[node])
                if lowlink[node] == indices[node]:
                    comp: list[str] = []
                    while True:
                        w = node_stack.pop()
                        on_stack.discard(w)
                        comp.append(w)
                        if w == node:
                            break
                    components.append(comp)
    return components


def _find_noexit_cycle_nodes(nodes: list[Node], edges: list[Edge]) -> list[str]:
    """탈출구 없는 순환에 속한 노드 id들 — SCC(크기≥2) 또는 자기루프(크기1)이며,
    그 성분 밖으로 나가는 엣지가 하나도 없는 경우만 위반(§4 게이트 5)."""
    node_ids = [n.id for n in nodes]
    node_id_set = set(node_ids)
    adj: dict[str, list[str]] = {nid: [] for nid in node_ids}
    self_loops: set[str] = set()
    for e in edges:
        if e.source_node_id not in node_id_set or e.target_node_id not in node_id_set:
            continue  # 방어 — 저장 시점 검증이 막지만 검사기는 이중 방어
        adj[e.source_node_id].append(e.target_node_id)
        if e.source_node_id == e.target_node_id:
            self_loops.add(e.source_node_id)

    violations: list[str] = []
    for comp in _find_scc_iterative(node_ids, adj):
        comp_set = set(comp)
        is_cycle = len(comp) >= 2 or (len(comp) == 1 and comp[0] in self_loops)
        if not is_cycle:
            continue
        has_exit = any(target not in comp_set for nid in comp for target in adj[nid])
        if not has_exit:
            violations.extend(comp)
    return violations


async def validate_confirm_readiness(
    session: AsyncSession, found_map: ProcessMap, draft: MapVersion
) -> list[GateFailure]:
    """확정 게이트 6종 — 통과면 빈 리스트 (spec §4). draft는 nodes/edges selectinload 전제.

    저장은 막지 않고 확정(framework-confirm) 시점에만 검사한다.
    """
    failures: list[GateFailure] = []
    sub_nodes = [n for n in draft.nodes if n.node_type == "subprocess"]

    # 1) placeholder — linked_map_id 없는 subprocess (validate_framework_canvas와 동일 정의)
    ph = [n.id for n in sub_nodes if n.linked_map_id is None]
    if ph:
        failures.append(GateFailure("placeholder", len(ph), ph))

    linked = {n.linked_map_id: n.id for n in sub_nodes if n.linked_map_id is not None}

    # 2) missing_l6 — 소속 L6 미배치 (categories.py 보강 산식 공유)
    category_id = await get_framework_category_id(session, found_map.id)
    if category_id is not None:
        missing = await find_missing_l6_ids(session, category_id, draft)
        if missing:
            failures.append(GateFailure("missing_l6", len(missing), []))

    if linked:
        rows = (
            await session.execute(
                select(ProcessMap.id, ProcessMap.deleted_at, ProcessMap.retired_to_map_id)
                .where(ProcessMap.id.in_(linked.keys()))
            )
        ).all()
        by_id = {r[0]: r for r in rows}
        # 3) stale_link — 삭제/이양/영구삭제(맵 실종)된 링크
        stale = [
            nid for mid, nid in linked.items()
            if mid not in by_id or by_id[mid][1] is not None or by_id[mid][2] is not None
        ]
        if stale:
            failures.append(GateFailure("stale_link", len(stale), stale))
        # 4) l6_unpublished — 게시본 없는 링크 L6 (stale 대상은 제외 — 이미 다른 코드로 잡힘)
        pub_ids = set(
            (
                await session.scalars(
                    select(MapVersion.map_id)
                    .where(
                        MapVersion.map_id.in_(linked.keys()),
                        MapVersion.status == workflow.PUBLISHED,
                    )
                    .distinct()
                )
            ).all()
        )
        unpub = [
            nid for mid, nid in linked.items()
            if mid in by_id and nid not in stale and mid not in pub_ids
        ]
        if unpub:
            failures.append(GateFailure("l6_unpublished", len(unpub), unpub))

    # 5) noexit_cycle — 밖으로 나가는 엣지가 없는 순환(SCC≥2 또는 탈출구 없는 자기루프)
    cyclic = _find_noexit_cycle_nodes(draft.nodes, draft.edges)
    if cyclic:
        failures.append(GateFailure("noexit_cycle", len(cyclic), cyclic))

    # 6) plain_fanout — 비-decision out-degree≥2, 단 전부 gateway=="parallel"이면 허용
    node_type_by_id = {n.id: n.node_type for n in draft.nodes}
    out_by_src: dict[str, list[Edge]] = {}
    for e in draft.edges:
        out_by_src.setdefault(e.source_node_id, []).append(e)
    fanout = [
        src for src, group in out_by_src.items()
        if len(group) >= 2
        and node_type_by_id.get(src) != "decision"
        and not all(e.gateway == "parallel" for e in group)
    ]
    if fanout:
        failures.append(GateFailure("plain_fanout", len(fanout), fanout))

    return failures


async def validate_confirm_readiness_batch(
    session: AsyncSession, canvases: list[tuple[ProcessMap, int]]
) -> dict[int, list[GateFailure]]:
    """확정 게이트 6종 배치판 — 판정은 validate_confirm_readiness와 동치, 쿼리 수는 캔버스 수와 무관.

    canvases: (캔버스 맵, draft version_id) 목록. 반환은 map_id → 실패 목록. Node/Edge는
    version_id.in_() 2쿼리로 일괄 로드하고, 링크맵 상태·published 존재·소속 L6 판정도 전
    캔버스 합산 1쿼리씩으로 처리해 게이트당 N+1을 피한다 (categories.py framework-overview 전용).
    """
    if not canvases:
        return {}
    version_id_by_map: dict[int, int] = {m.id: vid for m, vid in canvases}
    version_ids = list(version_id_by_map.values())

    nodes_by_version: dict[int, list[Node]] = {vid: [] for vid in version_ids}
    for n in (await session.scalars(select(Node).where(Node.version_id.in_(version_ids)))).all():
        nodes_by_version.setdefault(n.version_id, []).append(n)
    edges_by_version: dict[int, list[Edge]] = {vid: [] for vid in version_ids}
    for e in (await session.scalars(select(Edge).where(Edge.version_id.in_(version_ids)))).all():
        edges_by_version.setdefault(e.version_id, []).append(e)

    map_ids = list(version_id_by_map.keys())
    category_by_map: dict[int, int] = dict(
        (
            await session.execute(
                select(ProcessCategory.linkage_map_id, ProcessCategory.id).where(
                    ProcessCategory.linkage_map_id.in_(map_ids)
                )
            )
        ).all()
    )

    # 소속 L6(카테고리별) — find_missing_l6_ids 단건 산식(포함 ∖ 링크됨)을 배치 전개
    category_ids = set(category_by_map.values())
    contained_by_category: dict[int, set[int]] = {cid: set() for cid in category_ids}
    if category_ids:
        for cat_id, l6_id in (
            await session.execute(
                select(ProcessMap.category_id, ProcessMap.id).where(
                    ProcessMap.category_id.in_(category_ids), ProcessMap.deleted_at.is_(None)
                )
            )
        ).all():
            contained_by_category[cat_id].add(l6_id)

    linked_by_version: dict[int, dict[int, str]] = {
        vid: {
            n.linked_map_id: n.id
            for n in nodes if n.node_type == "subprocess" and n.linked_map_id
        }
        for vid, nodes in nodes_by_version.items()
    }
    all_linked_ids: set[int] = {mid for linked in linked_by_version.values() for mid in linked}

    link_status: dict[int, tuple] = {}
    pub_ids: set[int] = set()
    if all_linked_ids:
        link_status = {
            mid: (deleted_at, retired_to)
            for mid, deleted_at, retired_to in (
                await session.execute(
                    select(ProcessMap.id, ProcessMap.deleted_at, ProcessMap.retired_to_map_id)
                    .where(ProcessMap.id.in_(all_linked_ids))
                )
            ).all()
        }
        pub_ids = set(
            (
                await session.scalars(
                    select(MapVersion.map_id)
                    .where(
                        MapVersion.map_id.in_(all_linked_ids),
                        MapVersion.status == workflow.PUBLISHED,
                    )
                    .distinct()
                )
            ).all()
        )

    results: dict[int, list[GateFailure]] = {}
    for found_map, draft_id in canvases:
        nodes = nodes_by_version.get(draft_id, [])
        edges = edges_by_version.get(draft_id, [])
        sub_nodes = [n for n in nodes if n.node_type == "subprocess"]
        failures: list[GateFailure] = []

        ph = [n.id for n in sub_nodes if n.linked_map_id is None]
        if ph:
            failures.append(GateFailure("placeholder", len(ph), ph))

        linked = linked_by_version.get(draft_id, {})
        category_id = category_by_map.get(found_map.id)
        if category_id is not None:
            missing = [mid for mid in contained_by_category.get(category_id, set()) if mid not in linked]
            if missing:
                failures.append(GateFailure("missing_l6", len(missing), []))

        stale: list[str] = []
        if linked:
            stale = [
                nid for mid, nid in linked.items()
                if mid not in link_status or link_status[mid][0] is not None or link_status[mid][1] is not None
            ]
            if stale:
                failures.append(GateFailure("stale_link", len(stale), stale))
            unpub = [
                nid for mid, nid in linked.items()
                if mid in link_status and nid not in stale and mid not in pub_ids
            ]
            if unpub:
                failures.append(GateFailure("l6_unpublished", len(unpub), unpub))

        cyclic = _find_noexit_cycle_nodes(nodes, edges)
        if cyclic:
            failures.append(GateFailure("noexit_cycle", len(cyclic), cyclic))

        node_type_by_id = {n.id: n.node_type for n in nodes}
        out_by_src: dict[str, list[Edge]] = {}
        for e in edges:
            out_by_src.setdefault(e.source_node_id, []).append(e)
        fanout = [
            src for src, group in out_by_src.items()
            if len(group) >= 2
            and node_type_by_id.get(src) != "decision"
            and not all(e.gateway == "parallel" for e in group)
        ]
        if fanout:
            failures.append(GateFailure("plain_fanout", len(fanout), fanout))

        results[found_map.id] = failures

    return results
