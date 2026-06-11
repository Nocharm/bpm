"""Version management — create (optionally cloning), rename, delete (docs/spec.md §3.4)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.db import get_session
from app.models import Edge, MapVersion, Node, ProcessMap
from app.schemas import VersionCreate, VersionOut, VersionUpdate

router = APIRouter(
    prefix="/api", tags=["versions"], dependencies=[Depends(get_current_user)]
)


async def _clone_graph(
    session: AsyncSession, source: MapVersion, target_version_id: int
) -> None:
    """source 버전의 노드/엣지를 새 ID로 깊은 복사. 계층(parent)·엣지 참조를 재매핑한다."""
    id_map = {node.id: uuid.uuid4().hex for node in source.nodes}

    # 1차: parent=None으로 먼저 삽입 (postgres 자기참조 FK 순서 문제 회피)
    cloned: dict[str, Node] = {}
    for node in source.nodes:
        clone = Node(
            id=id_map[node.id],
            version_id=target_version_id,
            parent_node_id=None,
            title=node.title,
            description=node.description,
            node_type=node.node_type,
            pos_x=node.pos_x,
            pos_y=node.pos_y,
            sort_order=node.sort_order,
        )
        session.add(clone)
        cloned[node.id] = clone
    await session.flush()

    # 2차: 계층 포인터 채우기
    for node in source.nodes:
        if node.parent_node_id is not None:
            cloned[node.id].parent_node_id = id_map[node.parent_node_id]

    for edge in source.edges:
        session.add(
            Edge(
                id=uuid.uuid4().hex,
                version_id=target_version_id,
                source_node_id=id_map[edge.source_node_id],
                target_node_id=id_map[edge.target_node_id],
                label=edge.label,
            )
        )


@router.post("/maps/{map_id}/versions", response_model=VersionOut, status_code=201)
async def create_version(
    map_id: int,
    payload: VersionCreate,
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")

    new_version = MapVersion(map_id=map_id, label=payload.label)
    session.add(new_version)
    await session.flush()

    if payload.source_version_id is not None:
        source = await session.get(
            MapVersion,
            payload.source_version_id,
            options=[selectinload(MapVersion.nodes), selectinload(MapVersion.edges)],
        )
        if source is None or source.map_id != map_id:
            raise HTTPException(
                status_code=404, detail="source version not found in this map"
            )
        await _clone_graph(session, source, new_version.id)

    await session.commit()
    await session.refresh(new_version)
    return new_version


@router.patch("/versions/{version_id}", response_model=VersionOut)
async def rename_version(
    version_id: int,
    payload: VersionUpdate,
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    version.label = payload.label
    await session.commit()
    await session.refresh(version)
    return version


@router.delete("/versions/{version_id}", status_code=204)
async def delete_version(
    version_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    remaining = await session.scalar(
        select(func.count())
        .select_from(MapVersion)
        .where(MapVersion.map_id == version.map_id)
    )
    if remaining is not None and remaining <= 1:
        raise HTTPException(
            status_code=409, detail="cannot delete the last version of a map"
        )

    await session.delete(version)
    await session.commit()
