"""Canvas graph read / full-replace, flat per version (docs/spec.md §1, §3.1).

그래프는 version 단위 평면 저장. GET/PUT /versions/{id}/graph 가 버전 전체를 다룬다.
"""

from collections import Counter
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.subprocess import (
    assert_no_cycle,
    get_placeholder_category_paths,
    get_subprocess_refs,
    validate_framework_canvas,
    validate_process,
)
from app.checkout import is_checkout_active, is_locked_by_other
from app.db import get_session
from app.models import Comment, Edge, Group, MapVersion, Node, ProcessCategory, ProcessMap
from app.permissions import logic
from app.permissions.access import get_effective_role
from app.permissions.deps import require_version_map_role
from app.schemas import (
    EdgeIn,
    FlatNodeOut,
    GraphIn,
    GraphOut,
    GroupIn,
    NodeIn,
    NodeOut,
    VersionGraphOut,
)

router = APIRouter(
    prefix="/api/versions", tags=["graph"], dependencies=[Depends(get_current_user)]
)


def _node_group_ids(node: Node) -> list[str]:
    """다중 그룹(group_ids) + 레거시 단일(group_id)을 합쳐 반환 — 무손실 마이그레이션."""
    if node.group_ids:
        return list(node.group_ids)
    return [node.group_id] if node.group_id else []


async def _load_graph(session: AsyncSession, version_id: int, user: str) -> GraphOut:
    """버전 그래프 + subprocess refs. refs는 user가 볼 수 없는 미지정 링크 맵을 가린다."""
    node_rows = (
        await session.scalars(
            select(Node).where(Node.version_id == version_id).order_by(Node.sort_order)
        )
    ).all()
    node_ids = [n.id for n in node_rows]
    edges: list[EdgeIn] = []
    if node_ids:
        edge_rows = (
            await session.scalars(
                select(Edge).where(
                    Edge.version_id == version_id, Edge.source_node_id.in_(node_ids)
                )
            )
        ).all()
        edges = [EdgeIn.model_validate(e) for e in edge_rows]
    nodes = [
        NodeOut.model_validate(n).model_copy(update={"group_ids": _node_group_ids(n)})
        for n in node_rows
    ]
    group_rows = (
        await session.scalars(select(Group).where(Group.version_id == version_id))
    ).all()
    groups = [GroupIn.model_validate(g) for g in group_rows]
    # subprocess 링크 대상 지정 정보 동봉 — 에디터 그래프·임베드 resolved 공통 (spec 2026-07-06)
    refs = await get_subprocess_refs(session, nodes, user)
    # 플레이스홀더 출처 L5 경로 주입 — 에디터 출처 배지 소스 (design 2026-08-28 §10.1)
    nodes = _apply_placeholder_paths(
        nodes, await get_placeholder_category_paths(session, nodes)
    )
    return GraphOut(nodes=nodes, edges=edges, groups=groups, subprocess_refs=refs)


# 배포 런타임이 python:3.11-slim이라 PEP 695 제네릭 문법(`def f[T]()`, 3.12+)은 쓸 수 없다 — TypeVar로 표기.
NodeT = TypeVar("NodeT", bound=NodeIn)


def _apply_placeholder_paths(
    nodes: list[NodeT], ph_paths: dict[int, str]
) -> list[NodeT]:
    """플레이스홀더 노드에 출처 경로 트랜지언트 주입 — /graph·/graph/all 공용 (2026-08-30 #5)."""
    if not ph_paths:
        return nodes
    return [
        n.model_copy(
            update={"placeholder_category_path": ph_paths.get(n.placeholder_category_id)}
        )
        if n.node_type == "subprocess"
        and n.linked_map_id is None
        and n.placeholder_category_id
        else n
        for n in nodes
    ]


async def _get_version_or_404(session: AsyncSession, version_id: int) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    return version


async def _find_foreign_ids(
    session: AsyncSession, model: type[Node] | type[Group] | type[Edge], ids: set[str], version_id: int
) -> list[str]:
    """ids 중 다른 버전 소속 행 — 전역 PK라 upsert가 남의 버전 행을 이 버전으로 끌고 온다 (리뷰 2026-10-19 P0-1)."""
    if not ids:
        return []
    rows = await session.scalars(
        select(model.id).where(
            model.id.in_(ids),
            or_(model.version_id != version_id, model.version_id.is_(None)),
        )
    )
    return sorted(rows.all())


async def _assert_new_links_allowed(
    session: AsyncSession,
    version: MapVersion,
    nodes: list[NodeIn],
    user: str,
    contained_map_ids: set[int],
) -> None:
    """새로 생긴 subprocess 링크·핀만 검사한다 (리뷰 2026-10-19 F-2·P0-2).

    링크 대상: 실존 + (지정·미삭제 = 라이브러리 공개 | 호출자 viewer 이상 | 이 캔버스의 소속 L6).
    핀: 고정 버전이 링크 대상 맵의 버전이어야. 이미 저장된 링크·핀은 grandfather — 매 PUT마다
    걸리면 그 맵이 영구히 저장 불가가 된다(링크 유일성 가드와 같은 이유).
    """
    stored = (
        await session.execute(
            select(Node.linked_map_id, Node.linked_version_id).where(
                Node.version_id == version.id,
                Node.node_type == "subprocess",
                Node.linked_map_id.is_not(None),
            )
        )
    ).all()
    stored_maps = {mid for mid, _ in stored}
    stored_pins = {(mid, vid) for mid, vid in stored if vid is not None}
    sp_nodes = [n for n in nodes if n.node_type == "subprocess" and n.linked_map_id is not None]
    new_map_ids = {n.linked_map_id for n in sp_nodes} - stored_maps - contained_map_ids
    for mid in sorted(new_map_ids):
        target = await session.get(ProcessMap, mid)
        if target is not None and target.sp_designated_at is not None and target.deleted_at is None:
            continue
        # 부재와 권한 부족을 같은 응답으로 — 다르면 비공개 맵의 존재를 캐는 오라클이 된다
        if target is None or logic.role_rank(
            await get_effective_role(session, user, mid)
        ) < logic.role_rank("viewer"):
            raise HTTPException(status_code=422, detail=f"linked map {mid} is not accessible")
    new_pins = {
        (n.linked_map_id, n.linked_version_id)
        for n in sp_nodes
        if n.linked_version_id is not None
    } - stored_pins
    for mid, vid in sorted(new_pins):
        pinned = await session.get(MapVersion, vid)
        if pinned is None or pinned.map_id != mid:
            raise HTTPException(
                status_code=422, detail=f"linked_version_id {vid} is not a version of map {mid}"
            )


@router.get(
    "/{version_id}/graph/all",
    response_model=VersionGraphOut,
    # 읽기 viewer 게이트(framework draft 룰 포함) — AI 챗 게이트와 짝(우회로 차단) (design 2026-07-10)
    dependencies=[Depends(require_version_map_role("viewer"))],
)
async def get_full_graph(
    version_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> VersionGraphOut:
    """버전 전체 노드/엣지 — 노드 검색·버전 diff 용 (spec §7 Phase B)."""
    await _get_version_or_404(session, version_id)
    node_rows = (
        await session.scalars(
            select(Node).where(Node.version_id == version_id).order_by(Node.sort_order)
        )
    ).all()
    edge_rows = (
        await session.scalars(select(Edge).where(Edge.version_id == version_id))
    ).all()
    nodes = [
        FlatNodeOut.model_validate(n).model_copy(
            update={"group_ids": _node_group_ids(n)}
        )
        for n in node_rows
    ]
    # 비교 화면 배지 소스 — /graph와 동일한 플레이스홀더 출처 주입 (2026-08-30 #5)
    nodes = _apply_placeholder_paths(
        nodes, await get_placeholder_category_paths(session, nodes)
    )
    return VersionGraphOut(
        nodes=nodes,
        edges=[EdgeIn.model_validate(e) for e in edge_rows],
        # 에디터가 실제로 로드하는 루트 그래프 — 지정 정보 동봉 (spec 2026-07-06)
        subprocess_refs=await get_subprocess_refs(session, nodes, user),
    )


@router.get(
    "/{version_id}/graph",
    response_model=GraphOut,
    dependencies=[Depends(require_version_map_role("viewer"))],
)
async def get_graph(
    version_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> GraphOut:
    await _get_version_or_404(session, version_id)
    return await _load_graph(session, version_id, user)


@router.put(
    "/{version_id}/graph",
    response_model=GraphOut,
    dependencies=[Depends(require_version_map_role("editor"))],
)
async def replace_graph(
    version_id: int,
    payload: GraphIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    """버전의 전체 그래프를 교체."""
    version = await _get_version_or_404(session, version_id)

    # 승인 워크플로우 — 편집 가능 상태(draft/rejected)만 저장 허용
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"version is {version.status} - not editable"
        )

    # 체크아웃 보유 강제 — 저장하려면 호출자가 활성 체크아웃을 쥐고 있어야 한다.
    # 권한 게이트(editor+)와 별개의 동시편집 규칙이라 sysadmin도 우회하지 못한다.
    now = now_kst()
    if is_locked_by_other(version, user, now):
        raise HTTPException(
            status_code=423,
            detail=f"version checked out by {version.checked_out_by}",
        )
    if not (is_checkout_active(version, now) and version.checked_out_by == user):
        raise HTTPException(
            status_code=409, detail="must hold checkout to edit"
        )

    payload_ids = {n.id for n in payload.nodes}
    for edge in payload.edges:
        if edge.source_node_id not in payload_ids or edge.target_node_id not in payload_ids:
            raise HTTPException(
                status_code=422,
                detail=f"edge {edge.id} references a node not in the payload",
            )

    payload_group_ids = {g.id for g in payload.groups}
    for node in payload.nodes:
        for gid in node.group_ids:
            if gid not in payload_group_ids:
                raise HTTPException(
                    status_code=422,
                    detail=f"node {node.id} references a group not in the payload",
                )

    # 소속 검증 — 다른 버전의 node·group·edge id는 거부. 정상 경로(복제·CSV/AI·붙여넣기·임포트)는
    # 항상 새 id를 발급하므로 여기 걸리는 건 조작된 요청뿐이다 (리뷰 2026-10-19 P0-1).
    for model, ids in (
        (Node, payload_ids),
        (Group, payload_group_ids),
        (Edge, {e.id for e in payload.edges}),
    ):
        foreign = await _find_foreign_ids(session, model, ids, version_id)
        if foreign:
            raise HTTPException(
                status_code=409,
                detail=f"{model.__tablename__} ids belong to another version: {foreign[:5]}",
            )

    # 플레이스홀더 출처 카테고리 실존 검증 — 노드 FK 부재 관례라 앱 경계에서 (design 2026-08-28 §10.1)
    ph_cat_ids = {
        n.placeholder_category_id
        for n in payload.nodes
        if n.placeholder_category_id is not None
    }
    if ph_cat_ids:
        found_cats = set(
            (
                await session.scalars(
                    select(ProcessCategory.id).where(ProcessCategory.id.in_(ph_cat_ids))
                )
            ).all()
        )
        unknown_cats = sorted(ph_cat_ids - found_cats)
        if unknown_cats:
            raise HTTPException(
                status_code=422,
                detail=f"placeholder_category_id references unknown categories: {unknown_cats}",
            )

    # framework 캔버스는 별도 규칙(start 불요·subprocess+분기·끝) — 일반 맵은 기존 검증 유지
    canvas_map = await session.get(ProcessMap, version.map_id)
    is_framework_canvas = canvas_map is not None and canvas_map.mode == "framework"
    try:
        if is_framework_canvas:
            validate_framework_canvas(payload.nodes)
        else:
            validate_process(payload.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    contained_ids: set[int] = set()
    if is_framework_canvas:
        # 소속 L6 삭제 금지 — 이미 저장돼 있던 소속 L6 노드가 payload에서 사라지면 422.
        # 신규 소속 L6 미반영은 허용(열 때 자동 보강 담당) (2026-08-28 개선).
        linkage_cat_id = await session.scalar(
            select(ProcessCategory.id).where(
                ProcessCategory.linkage_map_id == version.map_id
            )
        )
        if linkage_cat_id is not None:
            contained_ids = set(
                (
                    await session.scalars(
                        select(ProcessMap.id).where(
                            ProcessMap.category_id == linkage_cat_id,
                            ProcessMap.deleted_at.is_(None),
                        )
                    )
                ).all()
            )
            stored_linked = set(
                (
                    await session.scalars(
                        select(Node.linked_map_id).where(
                            Node.version_id == version_id,
                            Node.node_type == "subprocess",
                            Node.linked_map_id.is_not(None),
                        )
                    )
                ).all()
            )
            payload_linked = {
                n.linked_map_id
                for n in payload.nodes
                if n.node_type == "subprocess" and n.linked_map_id is not None
            }
            missing = sorted((stored_linked & contained_ids) - payload_linked)
            if missing:
                raise HTTPException(
                    status_code=422,
                    detail=f"contained L6 nodes cannot be removed from the canvas: {missing}",
                )
            # 슬롯 교체로 은퇴한 맵을 새로 링크하면 막는다 — 후계가 이미 캔버스에 있으면 서버가 옛 노드를 지우고
            # 엣지를 후계로 옮기는데, 점유자의 낡은 자동저장이 옛 노드·엣지를 그대로 되살렸다. 이미 저장된 링크는 둔다.
            # 접두어는 FE isCanvasRepointedError가 새로고침 안내로 받는다 (리뷰 E-6)
            new_linked = payload_linked - stored_linked
            if new_linked:
                retired = sorted(
                    (
                        await session.scalars(
                            select(ProcessMap.id).where(
                                ProcessMap.id.in_(new_linked),
                                ProcessMap.retired_to_map_id.is_not(None),
                            )
                        )
                    ).all()
                )
                if retired:
                    raise HTTPException(
                        status_code=422,
                        detail=f"retired L6 maps cannot be linked on the canvas: {retired}",
                    )

    await _assert_new_links_allowed(session, version, payload.nodes, user, contained_ids)

    try:
        await assert_no_cycle(session, version_id, payload.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # 링크 유일성 — 같은 대상 맵을 2개 이상 노드가 링크하면 거부 (design 2026-07-16)
    # 가드 도입 전 이미 저장된 중복은 grandfather — 매 PUT마다 걸리면 그 맵이 영구히
    # 저장 불가(사실상 읽기전용)가 된다. 새로 도입되는 중복만 차단한다 (design 2026-07-17).
    stored_linked_ids = (
        await session.scalars(
            select(Node.linked_map_id).where(
                Node.version_id == version_id,
                Node.node_type == "subprocess",
                Node.linked_map_id.is_not(None),
            )
        )
    ).all()
    stored_counts = Counter(stored_linked_ids)
    incoming_counts = Counter(
        n.linked_map_id
        for n in payload.nodes
        if n.node_type == "subprocess" and n.linked_map_id is not None
    )
    # count > stored_counts[mid] (not just <= 1) so a target already grandfathered
    # at 2+ still gets flagged when a NEW dupe pushes it higher (e.g. 2 -> 3).
    dupes = sorted(
        mid
        for mid, count in incoming_counts.items()
        if count > 1 and count > stored_counts[mid]
    )
    if dupes:
        raise HTTPException(
            status_code=422,
            detail=f"subprocess map already linked in this map: {dupes}",
        )

    # 버전 전체 노드를 payload로 교체 — 사라진 노드의 엣지·코멘트도 정리
    existing_ids = set(
        (
            await session.scalars(
                select(Node.id).where(Node.version_id == version_id)
            )
        ).all()
    )
    removed = existing_ids - payload_ids
    if removed:
        # 삭제는 이 버전 행으로 한정 — node_id만으로 지우면 남의 버전 엣지·코멘트까지 지운다 (P0-1)
        await session.execute(
            delete(Edge).where(
                Edge.version_id == version_id,
                or_(
                    Edge.source_node_id.in_(removed),
                    Edge.target_node_id.in_(removed),
                ),
            )
        )
        # 삭제 노드의 코멘트 정리 — sqlite는 FK pragma 비활성이라 명시적으로 수행
        await session.execute(
            delete(Comment).where(
                Comment.version_id == version_id, Comment.node_id.in_(removed)
            )
        )
        await session.execute(delete(Node).where(Node.id.in_(removed)))

    # 남은 노드들의 엣지를 비우고 payload로 재삽입
    if existing_ids:
        await session.execute(
            delete(Edge).where(
                Edge.version_id == version_id, Edge.source_node_id.in_(existing_ids)
            )
        )

    # 그룹도 버전 단위 교체
    existing_group_ids = set(
        (
            await session.scalars(
                select(Group.id).where(Group.version_id == version_id)
            )
        ).all()
    )
    removed_groups = existing_group_ids - payload_group_ids
    if removed_groups:
        await session.execute(delete(Group).where(Group.id.in_(removed_groups)))
    for group in payload.groups:
        # 중첩 상위 그룹 — 같은 페이로드에 있고 자기 자신이 아닐 때만 유지(고아·자기참조 차단)
        parent_group_id = (
            group.parent_group_id
            if group.parent_group_id is not None
            and group.parent_group_id != group.id
            and group.parent_group_id in payload_group_ids
            else None
        )
        existing_group = await session.get(Group, group.id)
        if existing_group is not None:
            existing_group.version_id = version_id
            existing_group.parent_group_id = parent_group_id
            existing_group.label = group.label
            existing_group.color = group.color
        else:
            session.add(
                Group(
                    id=group.id,
                    version_id=version_id,
                    parent_group_id=parent_group_id,
                    label=group.label,
                    color=group.color,
                )
            )

    # 노드 upsert
    for node in payload.nodes:
        existing = await session.get(Node, node.id)
        if existing is not None:
            existing.version_id = version_id
            existing.title = node.title
            existing.description = node.description
            existing.node_type = node.node_type
            existing.color = node.color
            existing.assignee = node.assignee
            existing.assignee_role = node.assignee_role
            existing.department = node.department
            existing.system = node.system
            existing.duration = node.duration
            existing.cost_krw = node.cost_krw
            existing.cost_usd = node.cost_usd
            existing.headcount = node.headcount
            existing.annual_count = node.annual_count
            existing.fte = node.fte
            existing.touch_time = node.touch_time
            existing.input = node.input
            existing.output = node.output
            existing.input_forms = node.input_forms
            existing.output_forms = node.output_forms
            existing.output_ids = node.output_ids
            existing.input_links = node.input_links
            existing.output_links = node.output_links
            existing.input_flags = node.input_flags
            existing.start_condition = node.start_condition
            existing.end_condition = node.end_condition
            existing.system_fallback = node.system_fallback
            existing.gmp = node.gmp
            existing.url = node.url
            existing.url_label = node.url_label
            existing.pos_x = node.pos_x
            existing.pos_y = node.pos_y
            existing.sort_order = node.sort_order
            existing.group_ids = list(node.group_ids)
            existing.group_id = None  # 레거시 단일 소속 정리 — group_ids로 일원화
            existing.linked_map_id = node.linked_map_id
            existing.follow_latest = node.follow_latest
            existing.linked_version_id = node.linked_version_id
            existing.placeholder_category_id = node.placeholder_category_id
            existing.width = node.width
            existing.is_primary_end = node.is_primary_end
            existing.parallel_outputs = list(node.parallel_outputs)
        else:
            session.add(Node(version_id=version_id, **node.model_dump()))
    for edge in payload.edges:
        session.add(Edge(version_id=version_id, **edge.model_dump()))

    version.updated_at = now  # 그래프 내용 갱신도 버전 갱신 시각에 반영 — 인터뷰 충돌 경고의 신호원 (final review C1)
    await session.commit()
    return await _load_graph(session, version_id, user)
