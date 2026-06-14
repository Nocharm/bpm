"""맵별 지정 승인자 관리 — 조회는 누구나, 변경은 맵 소유자만 (design 2026-06-14)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapApprover, ProcessMap
from app.schemas import ApproversUpdate

router = APIRouter(
    prefix="/api/maps", tags=["approvers"], dependencies=[Depends(get_current_user)]
)


@router.get("/{map_id}/approvers", response_model=list[str])
async def list_approvers(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    rows = await session.scalars(
        select(MapApprover.user_id)
        .where(MapApprover.map_id == map_id)
        .order_by(MapApprover.user_id)
    )
    return list(rows.all())


@router.put("/{map_id}/approvers", response_model=list[str])
async def set_approvers(
    map_id: int,
    payload: ApproversUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    # 소유자 미상(created_by=None, seed/legacy 맵)은 잠그지 않고 개방 — 누구나 관리 허용
    if found_map.created_by is not None and found_map.created_by != user:
        raise HTTPException(status_code=403, detail="only the map owner can set approvers")

    await session.execute(delete(MapApprover).where(MapApprover.map_id == map_id))
    unique_ids = sorted({uid for uid in payload.user_ids if uid})
    for uid in unique_ids:
        session.add(MapApprover(map_id=map_id, user_id=uid))
    await session.commit()
    return unique_ids
