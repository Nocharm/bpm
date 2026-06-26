"""Process map CRUD endpoints (docs/spec.md §3.5)."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.db import get_session
from app.models import Employee, MapApprover, MapPermission, MapVersion, Node, ProcessMap
from app.permissions import logic
from app.permissions.access import (
    get_effective_role,
    get_eligible_users,
    get_user_active_group_ids,
)
from app.permissions.deps import require_map_role
from app.routers.versions import clone_graph
from app.schemas import (
    EligibleApproverOut,
    MapCopy,
    MapCreate,
    MapDetailOut,
    MapOut,
    MapUpdate,
)
from app.version_events import record_version_event

router = APIRouter(
    prefix="/api/maps", tags=["maps"], dependencies=[Depends(get_current_user)]
)

# 소프트삭제 후 복구 가능 기간 — 경과분은 조회 시 lazy 영구삭제 (DL)
RECOVERY_WINDOW = timedelta(days=7)


async def _purge_expired(session: AsyncSession) -> None:
    """복구 기간(7일) 경과한 소프트삭제 맵을 영구 삭제 (별도 배치 없이 조회 시 lazy 정리)."""
    cutoff = now_kst() - RECOVERY_WINDOW
    expired = (
        await session.scalars(
            select(ProcessMap).where(
                ProcessMap.deleted_at.is_not(None), ProcessMap.deleted_at < cutoff
            )
        )
    ).all()
    if expired:
        for stale_map in expired:
            await session.delete(stale_map)
        await session.commit()


async def _assert_unique_name(
    session: AsyncSession, name: str, exclude_map_id: int | None = None
) -> None:
    """프로세스맵 이름 전역 중복 금지 (생성·복사·이름변경 공통). 중복이면 409."""
    query = select(ProcessMap.id).where(ProcessMap.name == name)
    if exclude_map_id is not None:
        query = query.where(ProcessMap.id != exclude_map_id)
    if await session.scalar(query) is not None:
        raise HTTPException(status_code=409, detail="map name already exists")


@router.get("", response_model=list[MapOut])
async def list_maps(
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[ProcessMap]:
    await _purge_expired(session)  # 7일 경과 소프트삭제분 정리 (DL lazy)
    # 가시성 필터 — 사용자 권한/승인자/부서를 한 번씩만 로드해 맵별 effective_role을
    # 메모리에서 계산(N+1 회피). role이 None(접근 불가)인 맵은 제외. 소프트삭제 맵 제외.
    maps = list(
        (
            await session.scalars(
                select(ProcessMap)
                .where(ProcessMap.deleted_at.is_(None))
                .order_by(ProcessMap.updated_at.desc())
            )
        ).all()
    )
    is_admin = logic.is_sysadmin(user)
    # 맵별 최신 버전(최대 id) 상태·id — 홈 카드 표시용. 한 번의 쿼리로 N+1 회피.
    latest_status: dict[int, str] = {}
    latest_vid: dict[int, int] = {}
    for mid, vid, status in (
        await session.execute(
            select(MapVersion.map_id, MapVersion.id, MapVersion.status).order_by(MapVersion.id)
        )
    ).all():
        latest_status[mid] = status  # id 오름차순 → 마지막이 최신
        latest_vid[mid] = vid
    # H5b 집계 — 전체 버전 수 / 라이브(published) 버전 id / 소유자 직원명 (각 1쿼리, N+1 회피)
    version_count: dict[int, int] = {
        mid: cnt
        for mid, cnt in (
            await session.execute(
                select(MapVersion.map_id, func.count()).group_by(MapVersion.map_id)
            )
        ).all()
    }
    published_vid: dict[int, int] = {
        mid: vid
        for mid, vid in (
            await session.execute(
                select(MapVersion.map_id, MapVersion.id).where(
                    MapVersion.status == workflow.PUBLISHED
                )
            )
        ).all()
    }
    # 노드 수는 라이브(published) 버전 기준 — 없으면 최신 버전으로 폴백
    target_vids = {published_vid.get(m.id, latest_vid.get(m.id)) for m in maps}
    target_vids.discard(None)
    node_count_by_vid: dict[int, int] = {}
    if target_vids:
        node_count_by_vid = {
            vid: cnt
            for vid, cnt in (
                await session.execute(
                    select(Node.version_id, func.count())
                    .where(Node.version_id.in_(target_vids))
                    .group_by(Node.version_id)
                )
            ).all()
        }
    owner_ids = {m.created_by for m in maps if m.created_by}
    owner_name: dict[str, str] = {}
    if owner_ids:
        owner_name = {
            lid: nm
            for lid, nm in (
                await session.execute(
                    select(Employee.login_id, Employee.name).where(
                        Employee.login_id.in_(owner_ids)
                    )
                )
            ).all()
        }

    def _set_card_metrics(m: ProcessMap) -> None:
        """홈 카드 표시용 파생값 주입 (목록 응답 전용 transient attr)."""
        m.latest_version_status = latest_status.get(m.id)
        m.version_count = version_count.get(m.id, 0)
        tvid = published_vid.get(m.id, latest_vid.get(m.id))
        m.node_count = node_count_by_vid.get(tvid, 0) if tvid is not None else 0
        m.owner_name = owner_name.get(m.created_by) if m.created_by else None
    if is_admin:
        for m in maps:
            m.my_role = "owner"  # sysadmin → 전 맵 owner (effective_role parity)
            _set_card_metrics(m)
        return maps  # 필터 불필요(쿼리도 생략)

    emp = await session.get(Employee, user)
    emp_org_path = (
        logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
        if emp is not None
        else ""
    )
    # 사용자에게 걸린 권한 행 전체(맵별로 묶어 메모리 판정)
    perm_rows = (
        await session.execute(
            select(
                MapPermission.map_id,
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            )
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
    # 호출자가 속한 active 그룹 id — 맵 무관이라 루프 밖에서 1회만 산정
    user_group_ids = await get_user_active_group_ids(session, user, emp_org_path)

    # 가시성 필터와 my_role 노출을 한 번의 effective_role 계산으로 처리 (이중 계산 회피).
    visible: list[ProcessMap] = []
    for m in maps:
        role = logic.effective_role(
            user,
            False,  # is_admin True는 위에서 조기 반환
            emp_org_path,
            m.visibility,
            perms_by_map.get(m.id, []),
            m.id in approver_map_ids,
            user_group_ids,
        )
        if role is not None:  # is_visible == (effective_role is not None)
            m.my_role = role
            _set_card_metrics(m)
            visible.append(m)
    return visible


@router.post("", response_model=MapDetailOut, status_code=201)
async def create_map(
    payload: MapCreate,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    # 맵 생성 시 기본 버전(As-Is) 1개를 함께 만든다 — 캔버스는 버전에 귀속 (spec §1)
    await _assert_unique_name(session, payload.name)
    new_map = ProcessMap(
        name=payload.name,
        description=payload.description,
        created_by=user,
        owner_id=user,
        visibility=payload.visibility,  # 생성자가 고른 초기 공개 범위(기본 private)
    )
    new_map.versions.append(MapVersion(label="As-Is"))
    session.add(new_map)
    await session.flush()
    # 초기 버전 생성 이벤트 — 버전 히스토리 타임라인 시작점
    record_version_event(session, new_map.versions[0].id, "created", user)
    # 생성자에게 owner 권한 행 부여 — enforcement ON에서 본인 맵 잠금 방지 (brief §C)
    session.add(
        MapPermission(
            map_id=new_map.id,
            principal_type="user",
            principal_id=user,
            role="owner",
            granted_by=user,
        )
    )
    await session.commit()
    await session.refresh(new_map, attribute_names=["versions"])
    # versions[].events를 미리 로드 — MapDetailOut 직렬화 시 lazy-load(MissingGreenlet) 방지
    for version in new_map.versions:
        await session.refresh(version, attribute_names=["events"])
    new_map.my_role = "owner"  # 생성자는 owner 권한 행 부여됨
    return new_map


@router.post(
    "/{map_id}/copy",
    response_model=MapDetailOut,
    status_code=201,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def copy_map(
    map_id: int,
    payload: MapCopy,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """승인본(approved/published) 기준으로 맵 복사 — 새 맵의 초기 draft에 그래프 복제 (request #12).

    복사 가능 조건: 원본 맵에 승인된 버전이 1개 이상. 없으면 409.
    """
    source_map = await session.get(ProcessMap, map_id)
    if source_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    # 최신 승인본 1개 — 그래프 즉시 클론을 위해 nodes/edges/groups eager-load
    source_version = (
        await session.scalars(
            select(MapVersion)
            .where(
                MapVersion.map_id == map_id,
                MapVersion.status.in_([workflow.APPROVED, workflow.PUBLISHED]),
            )
            .order_by(MapVersion.id.desc())
            .limit(1)
            .options(
                selectinload(MapVersion.nodes),
                selectinload(MapVersion.edges),
                selectinload(MapVersion.groups),
            )
        )
    ).first()
    if source_version is None:
        raise HTTPException(status_code=409, detail="map has no approved version to copy")

    copy_name = payload.name or f"{source_map.name} (Copy)"
    await _assert_unique_name(session, copy_name)
    new_map = ProcessMap(
        name=copy_name,
        description=source_map.description,
        created_by=user,
        owner_id=user,
        visibility="private",
    )
    new_version = MapVersion(label="As-Is")
    new_map.versions.append(new_version)
    session.add(new_map)
    await session.flush()
    await clone_graph(session, source_version, new_version.id)
    record_version_event(session, new_version.id, "created", user)
    session.add(
        MapPermission(
            map_id=new_map.id,
            principal_type="user",
            principal_id=user,
            role="owner",
            granted_by=user,
        )
    )
    await session.commit()
    await session.refresh(new_map, attribute_names=["versions"])
    for version in new_map.versions:
        await session.refresh(version, attribute_names=["events"])
    new_map.my_role = "owner"
    return new_map


@router.get(
    "/{map_id}/eligible-approvers",
    response_model=list[EligibleApproverOut],
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_eligible_approvers(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[EligibleApproverOut]:
    """승인자 지정 후보 — 맵 조회권한(viewer+) 보유 직원만 (AP). 담당자 후보와 동일 자격."""
    eligible = await get_eligible_users(session, map_id)
    return [
        EligibleApproverOut(
            id=e.login_id,
            name=e.name or e.login_id,
            department=e.department or "",
            # 소속 경로(센터/부서/팀/그룹/파트) — 승인자 카드 표시용 (ST)
            org_path=logic.org_path(
                e.org_l1, e.org_l2, e.org_l3, e.org_l4, e.org_l5, e.department or ""
            ),
        )
        for e in eligible
    ]


@router.get(
    "/{map_id}",
    response_model=MapDetailOut,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_map(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    found_map = await session.get(
        ProcessMap,
        map_id,
        options=[selectinload(ProcessMap.versions).selectinload(MapVersion.events)],
    )
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    # 호출자의 서버 산정 역할을 응답에 부착 — 프론트 게이팅 단일 소스
    found_map.my_role = await get_effective_role(session, user, map_id)
    return found_map


@router.patch(
    "/{map_id}",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def update_map(
    map_id: int, payload: MapUpdate, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.name is not None:
        await _assert_unique_name(session, payload.name, exclude_map_id=map_id)
        found_map.name = payload.name
    if payload.description is not None:
        found_map.description = payload.description
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.delete(
    "/{map_id}",
    status_code=204,
    dependencies=[Depends(require_map_role("owner"))],
)
async def delete_map(map_id: int, session: AsyncSession = Depends(get_session)) -> None:
    # 소프트 삭제 — 즉시 제거 대신 deleted_at 기록(1주 내 복구 가능, DL).
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.deleted_at = now_kst()
    await session.commit()


@router.get("/deleted/list", response_model=list[MapOut])
async def list_deleted_maps(
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[ProcessMap]:
    """휴지통 — 소프트삭제된 맵. 오너는 본인 것만, sysadmin은 전체 (DL). 조회 시 만료분 정리."""
    await _purge_expired(session)
    is_admin = logic.is_sysadmin(user)
    query = select(ProcessMap).where(ProcessMap.deleted_at.is_not(None))
    if not is_admin:
        query = query.where(ProcessMap.owner_id == user)
    rows = list((await session.scalars(query.order_by(ProcessMap.deleted_at.desc()))).all())
    for row in rows:
        row.my_role = "owner"  # 휴지통 표시용
    return rows


@router.post(
    "/{map_id}/restore",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def restore_map(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    """소프트삭제 맵 복구 — deleted_at 해제. 오너(또는 sysadmin)만 (require_map_role owner)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.deleted_at = None
    await session.commit()
    await session.refresh(found_map)
    return found_map
