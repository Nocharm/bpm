"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapVersion, Node, ProcessMap
from app.permissions.access import get_effective_role
from app.permissions.logic import role_rank
from app.routers.graph import _load_graph
from app.schemas import GraphOut
from app.subprocess import resolve_linked_version

router = APIRouter(
    prefix="/api/library", tags=["library"], dependencies=[Depends(get_current_user)]
)


@router.get("/processes")
async def list_processes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    # 맵별 최신/최신발행 버전 — 단일 그룹 쿼리(N+1 회피).
    latest_rows = (
        await session.execute(
            select(ProcessMap.id, ProcessMap.name, func.max(MapVersion.id))
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            .group_by(ProcessMap.id, ProcessMap.name)
            .order_by(ProcessMap.name)
        )
    ).all()
    pub_rows = (
        await session.execute(
            select(MapVersion.map_id, func.max(MapVersion.id))
            .where(MapVersion.status == "published")
            .group_by(MapVersion.map_id)
        )
    ).all()
    published = {mid: vid for mid, vid in pub_rows}
    # 맵별 참조 맵 집합 — 전 버전 노드의 linked_map_id 합집합(순환 차단 클로저와 동일 소스).
    ref_rows = (
        await session.execute(
            select(MapVersion.map_id, Node.linked_map_id)
            .join(Node, Node.version_id == MapVersion.id)
            .where(Node.linked_map_id.is_not(None))
            .distinct()
        )
    ).all()
    refs: dict[int, list[int]] = {}
    for mid, linked in ref_rows:
        refs.setdefault(mid, []).append(linked)
    return [
        {
            "map_id": mid,
            "name": name,
            "latest_version_id": latest,
            "latest_published_version_id": published.get(mid),
            "refs": sorted(refs.get(mid, [])),
        }
        for mid, name, latest in latest_rows
    ]


@router.get("/processes/{map_id}/resolved", response_model=GraphOut)
async def resolved_graph(
    map_id: int,
    follow_latest: bool = Query(False),
    pinned: int | None = Query(None),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    # 마스킹(옵션1 완전 잠금): viewer 미만은 자식 그래프를 만들지 않고 잠금 응답 — 데이터 자체를 안 싣는다.
    # Masking (full lock): below-viewer never builds the child graph — return empty locked payload.
    role = await get_effective_role(session, user, map_id)
    if role_rank(role) < role_rank("viewer"):
        return GraphOut(nodes=[], edges=[], locked=True)
    version_id = await resolve_linked_version(session, map_id, follow_latest, pinned)
    if version_id is None:
        raise HTTPException(status_code=404, detail="해석할 버전이 없습니다.")
    return await _load_graph(session, version_id)
