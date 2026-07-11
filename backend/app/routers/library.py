"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.duration import normalize_duration
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
    # 지정(designated)된 맵만 피커 노출 + 휴지통 제외 — 어트리뷰트는 행 칩 표시용 (spec 2026-07-06)
    latest_rows = (
        await session.execute(
            select(
                ProcessMap.id,
                ProcessMap.name,
                func.max(MapVersion.id),
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
            )
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            .where(
                ProcessMap.sp_designated_at.is_not(None),
                ProcessMap.deleted_at.is_(None),
            )
            .group_by(
                ProcessMap.id,
                ProcessMap.name,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
            )
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
            "department": department,
            "assignee": assignee,
            "system": system,
            # raw dict 직렬화는 MapOut/SubprocessRefOut validator를 안 탄다 —
            # 레거시 자유텍스트("2일")를 여기서도 소거(무효→None) (design 2026-07-11 SP)
            "duration": normalize_duration(duration) if duration else duration,
        }
        for mid, name, latest, department, assignee, system, duration in latest_rows
    ]


@router.get("/processes/{map_id}/resolved", response_model=GraphOut)
async def resolved_graph(
    map_id: int,
    follow_latest: bool = Query(False),
    pinned: int | None = Query(None),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GraphOut:
    # 미지정/삭제 맵은 권한과 무관하게 잠금 — 지정된 맵만 임베드 허용 (spec 2026-07-06)
    target = await session.get(ProcessMap, map_id)
    if target is None or target.deleted_at is not None or target.sp_designated_at is None:
        return GraphOut(nodes=[], edges=[], locked=True)
    # 마스킹(옵션1 완전 잠금): viewer 미만은 자식 그래프를 만들지 않고 잠금 응답 — 데이터 자체를 안 싣는다.
    # Masking (full lock): below-viewer never builds the child graph — return empty locked payload.
    role = await get_effective_role(session, user, map_id)
    if role_rank(role) < role_rank("viewer"):
        return GraphOut(nodes=[], edges=[], locked=True)
    version_id = await resolve_linked_version(session, map_id, follow_latest, pinned)
    if version_id is None:
        raise HTTPException(status_code=404, detail="해석할 버전이 없습니다.")
    return await _load_graph(session, version_id)
