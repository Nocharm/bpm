"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapVersion, ProcessMap
from app.routers.graph import _load_graph
from app.subprocess import resolve_linked_version

router = APIRouter(
    prefix="/api/library", tags=["library"], dependencies=[Depends(get_current_user)]
)


@router.get("/processes")
async def list_processes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    maps = (await session.scalars(select(ProcessMap).order_by(ProcessMap.name))).all()
    out: list[dict] = []
    for m in maps:
        latest = await session.scalar(
            select(MapVersion.id)
            .where(MapVersion.map_id == m.id)
            .order_by(MapVersion.id.desc())
        )
        out.append({"map_id": m.id, "name": m.name, "latest_version_id": latest})
    return out


@router.get("/processes/{map_id}/resolved")
async def resolved_graph(
    map_id: int,
    follow_latest: bool = Query(False),
    pinned: int | None = Query(None),
    session: AsyncSession = Depends(get_session),
) -> object:
    version_id = await resolve_linked_version(session, map_id, follow_latest, pinned)
    if version_id is None:
        raise HTTPException(status_code=404, detail="해석할 버전이 없습니다.")
    return await _load_graph(session, version_id)
