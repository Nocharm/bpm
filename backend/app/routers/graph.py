"""Canvas graph read / full-replace, flat per version (docs/spec.md §1, §3.1).

그래프는 version 단위 평면 저장. GET/PUT /versions/{id}/graph 가 버전 전체를 다룬다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.subprocess import assert_no_cycle, get_subprocess_refs, validate_process
from app.checkout import is_checkout_active, is_locked_by_other
from app.db import get_session
from app.models import Comment, Edge, Group, MapVersion, Node
from app.permissions.deps import require_version_map_role
from app.schemas import (
    EdgeIn,
    FlatNodeOut,
    GraphIn,
    GraphOut,
    GroupIn,
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


async def _load_graph(session: AsyncSession, version_id: int) -> GraphOut:
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
    refs = await get_subprocess_refs(session, nodes)
    return GraphOut(nodes=nodes, edges=edges, groups=groups, subprocess_refs=refs)


async def _get_version_or_404(session: AsyncSession, version_id: int) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    return version


@router.get("/{version_id}/graph/all", response_model=VersionGraphOut)
async def get_full_graph(
    version_id: int,
    session: AsyncSession = Depends(get_session),
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
    return VersionGraphOut(
        nodes=nodes,
        edges=[EdgeIn.model_validate(e) for e in edge_rows],
        # 에디터가 실제로 로드하는 루트 그래프 — 지정 정보 동봉 (spec 2026-07-06)
        subprocess_refs=await get_subprocess_refs(session, nodes),
    )


@router.get("/{version_id}/graph", response_model=GraphOut)
async def get_graph(
    version_id: int,
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    await _get_version_or_404(session, version_id)
    return await _load_graph(session, version_id)


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
            status_code=409, detail=f"version is {version.status} — not editable"
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

    try:
        validate_process(payload.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    try:
        await assert_no_cycle(session, version_id, payload.nodes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

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
        await session.execute(
            delete(Edge).where(
                or_(
                    Edge.source_node_id.in_(removed),
                    Edge.target_node_id.in_(removed),
                )
            )
        )
        # 삭제 노드의 코멘트 정리 — sqlite는 FK pragma 비활성이라 명시적으로 수행
        await session.execute(delete(Comment).where(Comment.node_id.in_(removed)))
        await session.execute(delete(Node).where(Node.id.in_(removed)))

    # 남은 노드들의 엣지를 비우고 payload로 재삽입
    if existing_ids:
        await session.execute(
            delete(Edge).where(Edge.source_node_id.in_(existing_ids))
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
            existing.department = node.department
            existing.system = node.system
            existing.duration = node.duration
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
            existing.is_primary_end = node.is_primary_end
        else:
            session.add(Node(version_id=version_id, **node.model_dump()))
    for edge in payload.edges:
        session.add(Edge(version_id=version_id, **edge.model_dump()))

    await session.commit()
    return await _load_graph(session, version_id)
