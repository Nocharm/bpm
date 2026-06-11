"""Process map CRUD endpoints (docs/spec.md §3.5)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.db import get_session
from app.models import MapVersion, ProcessMap
from app.schemas import MapCreate, MapDetailOut, MapOut, MapUpdate

router = APIRouter(
    prefix="/api/maps", tags=["maps"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[MapOut])
async def list_maps(session: AsyncSession = Depends(get_session)) -> list[ProcessMap]:
    result = await session.scalars(
        select(ProcessMap).order_by(ProcessMap.updated_at.desc())
    )
    return list(result)


@router.post("", response_model=MapDetailOut, status_code=201)
async def create_map(
    payload: MapCreate,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    # 맵 생성 시 기본 버전(As-Is) 1개를 함께 만든다 — 캔버스는 버전에 귀속 (spec §1)
    new_map = ProcessMap(
        name=payload.name, description=payload.description, created_by=user
    )
    new_map.versions.append(MapVersion(label="As-Is"))
    session.add(new_map)
    await session.commit()
    await session.refresh(new_map, attribute_names=["versions"])
    return new_map


@router.get("/{map_id}", response_model=MapDetailOut)
async def get_map(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    found_map = await session.get(
        ProcessMap, map_id, options=[selectinload(ProcessMap.versions)]
    )
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found_map


@router.patch("/{map_id}", response_model=MapOut)
async def update_map(
    map_id: int, payload: MapUpdate, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.name is not None:
        found_map.name = payload.name
    if payload.description is not None:
        found_map.description = payload.description
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.delete("/{map_id}", status_code=204)
async def delete_map(map_id: int, session: AsyncSession = Depends(get_session)) -> None:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    await session.delete(found_map)
    await session.commit()
