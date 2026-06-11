"""Canvas graph read / full-replace, scoped by parent node (docs/spec.md §1, §3.1).

각 캔버스는 (version, parent_node_id) 스코프. parent=None 은 버전 최상위 캔버스,
parent=<node id> 는 그 노드의 하위 프로세스맵. 저장은 해당 스코프만 교체해 다른 계층을 보존한다.
"""

from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Edge, MapVersion, Node
from app.schemas import EdgeIn, GraphIn, GraphOut, NodeOut

router = APIRouter(
    prefix="/api/versions", tags=["graph"], dependencies=[Depends(get_current_user)]
)


async def _load_scope(
    session: AsyncSession, version_id: int, parent_node_id: str | None
) -> GraphOut:
    node_rows = (
        await session.scalars(
            select(Node)
            .where(Node.version_id == version_id, Node.parent_node_id == parent_node_id)
            .order_by(Node.sort_order)
        )
    ).all()
    node_ids = [n.id for n in node_rows]

    parents_with_children: set[str] = set()
    edges: list[EdgeIn] = []
    if node_ids:
        parents_with_children = set(
            (
                await session.scalars(
                    select(Node.parent_node_id).where(
                        Node.version_id == version_id,
                        Node.parent_node_id.in_(node_ids),
                    )
                )
            ).all()
        )
        edge_rows = (
            await session.scalars(
                select(Edge).where(
                    Edge.version_id == version_id,
                    Edge.source_node_id.in_(node_ids),
                )
            )
        ).all()
        edges = [EdgeIn.model_validate(e) for e in edge_rows]

    nodes = [
        NodeOut.model_validate(n).model_copy(
            update={"has_children": n.id in parents_with_children}
        )
        for n in node_rows
    ]
    return GraphOut(nodes=nodes, edges=edges)


async def _get_version_or_404(session: AsyncSession, version_id: int) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    return version


@router.get("/{version_id}/graph", response_model=GraphOut)
async def get_graph(
    version_id: int,
    parent: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    await _get_version_or_404(session, version_id)
    return await _load_scope(session, version_id, parent)


@router.put("/{version_id}/graph", response_model=GraphOut)
async def replace_graph(
    version_id: int,
    payload: GraphIn,
    parent: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    """한 캔버스 스코프(version, parent)만 교체. 다른 계층의 노드/엣지는 보존."""
    await _get_version_or_404(session, version_id)

    if parent is not None:
        parent_node = await session.get(Node, parent)
        if parent_node is None or parent_node.version_id != version_id:
            raise HTTPException(
                status_code=404, detail=f"parent node {parent} not in version"
            )

    payload_ids = {n.id for n in payload.nodes}
    for edge in payload.edges:
        if edge.source_node_id not in payload_ids or edge.target_node_id not in payload_ids:
            raise HTTPException(
                status_code=422,
                detail=f"edge {edge.id} references a node not in the payload",
            )

    existing_ids = set(
        (
            await session.scalars(
                select(Node.id).where(
                    Node.version_id == version_id,
                    Node.parent_node_id == parent,
                )
            )
        ).all()
    )

    # 이 스코프에서 사라진 노드 → 하위 서브트리까지 재귀 삭제 (계층 고아 방지)
    removed = existing_ids - payload_ids
    if removed:
        pairs = (
            await session.execute(
                select(Node.id, Node.parent_node_id).where(
                    Node.version_id == version_id
                )
            )
        ).all()
        children: dict[str | None, list[str]] = defaultdict(list)
        for node_id, parent_id in pairs:
            children[parent_id].append(node_id)
        to_delete: set[str] = set()
        stack = list(removed)
        while stack:
            current = stack.pop()
            if current in to_delete:
                continue
            to_delete.add(current)
            stack.extend(children.get(current, []))
        await session.execute(
            delete(Edge).where(
                or_(
                    Edge.source_node_id.in_(to_delete),
                    Edge.target_node_id.in_(to_delete),
                )
            )
        )
        await session.execute(delete(Node).where(Node.id.in_(to_delete)))

    # 이 스코프(형제) 엣지를 비우고 payload로 재삽입
    if existing_ids:
        await session.execute(
            delete(Edge).where(Edge.source_node_id.in_(existing_ids))
        )

    # 노드는 upsert — 유지되는 노드를 지우지 않아 자식 계층이 끊기지 않는다
    for node in payload.nodes:
        existing = await session.get(Node, node.id)
        if existing is not None:
            existing.version_id = version_id
            existing.parent_node_id = parent
            existing.title = node.title
            existing.description = node.description
            existing.node_type = node.node_type
            existing.pos_x = node.pos_x
            existing.pos_y = node.pos_y
            existing.sort_order = node.sort_order
        else:
            session.add(Node(version_id=version_id, parent_node_id=parent, **node.model_dump()))
    for edge in payload.edges:
        session.add(Edge(version_id=version_id, **edge.model_dump()))

    await session.commit()
    return await _load_scope(session, version_id, parent)
