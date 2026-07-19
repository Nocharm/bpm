"""프로세스 라이브러리 — 링크 가능한 프로세스 목록 + 링크 해석 그래프 (읽기전용)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.duration import normalize_duration
from app.models import Employee, MapApprover, MapPermission, MapVersion, Node, ProcessMap
from app.permissions import logic
from app.permissions.access import get_effective_role, get_user_active_group_ids
from app.permissions.logic import role_rank
from app.routers.graph import _load_graph
from app.schemas import GraphOut
from app.subprocess import resolve_linked_version

router = APIRouter(
    prefix="/api/library", tags=["library"], dependencies=[Depends(get_current_user)]
)


async def _filter_visible_map_ids(
    session: AsyncSession, user: str, candidates: list[tuple[int, str, str | None]]
) -> set[int]:
    """(map_id, visibility, owning_department) 후보 중 user 가시(role≥viewer) 맵 id.

    maps.list_maps 의 배치 패턴 미러 — 권한/승인자/그룹을 한 번씩만 로드해 N+1 회피.
    """
    if not candidates:
        return set()
    if logic.is_sysadmin(user):
        return {mid for mid, _, _ in candidates}
    emp = await session.get(Employee, user)
    emp_org_path = (
        logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
        if emp is not None
        else ""
    )
    perm_rows = (
        await session.execute(
            select(
                MapPermission.map_id,
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            ).where(MapPermission.map_id.in_([mid for mid, _, _ in candidates]))
        )
    ).all()
    perms_by_map: dict[int, list[logic.Permission]] = {}
    for mid, ptype, pid, role in perm_rows:
        perms_by_map.setdefault(mid, []).append((ptype, pid, role))
    approver_map_ids = set(
        (
            await session.scalars(
                select(MapApprover.map_id).where(MapApprover.user_id == user)
            )
        ).all()
    )
    user_group_ids = await get_user_active_group_ids(session, user, emp_org_path)
    visible: set[int] = set()
    for mid, visibility, owning_department in candidates:
        role = logic.effective_role(
            user,
            False,  # sysadmin은 위에서 조기 반환
            emp_org_path,
            visibility,
            perms_by_map.get(mid, []),
            mid in approver_map_ids,
            user_group_ids,
            owning_department=owning_department,
        )
        if role is not None:
            visible.add(mid)
    return visible


@router.get("/processes")
async def list_processes(
    include_undesignated: bool = Query(False),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    # 맵별 최신/최신발행 버전 — 단일 그룹 쿼리(N+1 회피).
    # 기본은 지정(designated)된 맵만 피커 노출 + 휴지통 제외 — 어트리뷰트는 행 칩 표시용 (spec 2026-07-06).
    # include_undesignated=true 는 미지정 맵도 포함하되 가시성(role≥viewer) 필터 (spec 2026-07-19).
    where_clauses = [ProcessMap.deleted_at.is_(None)]
    if not include_undesignated:
        where_clauses.append(ProcessMap.sp_designated_at.is_not(None))
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
                ProcessMap.sp_designated_at,
                ProcessMap.visibility,
                ProcessMap.owning_department,
            )
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            .where(*where_clauses)
            .group_by(
                ProcessMap.id,
                ProcessMap.name,
                ProcessMap.sp_department,
                ProcessMap.sp_assignee,
                ProcessMap.sp_system,
                ProcessMap.sp_duration,
                ProcessMap.sp_designated_at,
                ProcessMap.visibility,
                ProcessMap.owning_department,
            )
            .order_by(ProcessMap.name)
        )
    ).all()
    # 미지정 맵은 비공개 이름 유출 방지를 위해 가시성 판정 후 남긴다 (지정 맵은 기존대로 전체 공개 라이브러리)
    undesignated_candidates = [
        (mid, visibility, owning_department)
        for (mid, _, _, _, _, _, _, designated_at, visibility, owning_department) in latest_rows
        if designated_at is None
    ]
    visible_undesignated = await _filter_visible_map_ids(session, user, undesignated_candidates)
    latest_rows = [
        row
        for row in latest_rows
        if row[7] is not None or row[0] in visible_undesignated
    ]
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
            "designated": designated_at is not None,
            # 미지정 행은 직전 지정 잔존값 유출 방지 — sp 어트리뷰트 마스킹 (spec 2026-07-19)
            "department": department if designated_at is not None else None,
            "assignee": assignee if designated_at is not None else None,
            "system": system if designated_at is not None else None,
            # raw dict 직렬화는 MapOut/SubprocessRefOut validator를 안 탄다 —
            # 레거시 자유텍스트("2일")를 여기서도 소거(무효→None) (design 2026-07-11 SP)
            "duration": (normalize_duration(duration) if duration else duration)
            if designated_at is not None
            else None,
        }
        for mid, name, latest, department, assignee, system, duration, designated_at, _, _ in latest_rows
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
