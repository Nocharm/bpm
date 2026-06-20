"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapVersion, ProcessMap
from app.routers.graph import _load_graph
from app.schemas import GraphOut
from app.subprocess import resolve_linked_version

router = APIRouter(
    prefix="/api/library", tags=["library"], dependencies=[Depends(get_current_user)]
)


@router.get("/processes")
async def list_processes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    # Single grouped query — avoids N+1 (one SELECT per map).
    rows = (
        await session.execute(
            select(ProcessMap.id, ProcessMap.name, func.max(MapVersion.id))
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            .group_by(ProcessMap.id, ProcessMap.name)
            .order_by(ProcessMap.name)
        )
    ).all()
    return [{"map_id": mid, "name": name, "latest_version_id": latest} for mid, name, latest in rows]


@router.get("/processes/{map_id}/resolved", response_model=GraphOut)
async def resolved_graph(
    map_id: int,
    follow_latest: bool = Query(False),
    pinned: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    version_id = await resolve_linked_version(session, map_id, follow_latest, pinned)
    if version_id is None:
        raise HTTPException(status_code=404, detail="해석할 버전이 없습니다.")
    return await _load_graph(session, version_id)
