"""Process map CRUD endpoints (docs/spec.md §3.5)."""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.db import get_session
from app.models import ApprovalRequest, Employee, MapApprover, MapPermission, MapVersion, Node, ProcessMap, UserGroup, UserGroupMember, _now
from app.permissions import logic
from app.permissions.access import (
    get_effective_role,
    get_eligible_users,
    get_user_active_group_ids,
)
from app.permissions.deps import require_map_role
from app.routers.versions import clone_graph
from app.schemas import (
    ApprovalRequestOut,
    DirectoryUserOut,
    EligibleApproverOut,
    MapCopy,
    MapCreate,
    MapDetailOut,
    MapOut,
    MapUpdate,
    OwningDepartmentIn,
    RenameRequestIn,
    SubprocessDesignationIn,
    SubprocessUsageOut,
    SubprocessUsedByOut,
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


async def _assert_known_department(session: AsyncSession, dept_path: str) -> None:
    """오우닝 부서는 실제 조직 경로여야 한다 — 직원 org 레벨의 전 prefix와 대조, 아니면 422.

    directory.py의 부서 목록과 같은 규약(각 깊이 슬라이스의 "/" 조인). active 여부는 무관.
    """
    rows = (
        await session.execute(
            select(
                Employee.org_l1,
                Employee.org_l2,
                Employee.org_l3,
                Employee.org_l4,
                Employee.org_l5,
            )
        )
    ).all()
    known: set[str] = set()
    for levels in rows:
        parts = [lv for lv in levels if lv]
        for i in range(1, len(parts) + 1):
            known.add("/".join(parts[:i]))
    if dept_path not in known:
        raise HTTPException(status_code=422, detail=f"unknown department: {dept_path}")


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

    member_count: dict[int, int] = {
        mid: cnt
        for mid, cnt in (
            await session.execute(
                select(MapPermission.map_id, func.count()).group_by(MapPermission.map_id)
            )
        ).all()
    }

    def _set_card_metrics(m: ProcessMap) -> None:
        """홈 카드 표시용 파생값 주입 (목록 응답 전용 transient attr)."""
        m.latest_version_status = latest_status.get(m.id)
        m.version_count = version_count.get(m.id, 0)
        tvid = published_vid.get(m.id, latest_vid.get(m.id))
        m.node_count = node_count_by_vid.get(tvid, 0) if tvid is not None else 0
        m.member_count = member_count.get(m.id, 0)
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
            owning_department=m.owning_department,
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
    await _assert_known_department(session, payload.owning_department)
    new_map = ProcessMap(
        name=payload.name,
        description=payload.description,
        created_by=user,
        owner_id=user,
        visibility=payload.visibility,  # 생성자가 고른 초기 공개 범위(기본 private)
        owning_department=payload.owning_department,
    )
    new_map.versions.append(MapVersion(label="As-Is"))
    session.add(new_map)
    await session.flush()
    # 빈 캔버스 대신 Start·End 노드로 시작 — CSV 임포트가 생성하는 것과 동일한 사용자 경험.
    # 엣지는 만들지 않는다(사용자가 사이에 노드를 넣어 연결). 고정 좌표(LR), id는 clone_graph 스타일(uuid hex).
    version_id = new_map.versions[0].id
    session.add(
        Node(id=uuid.uuid4().hex, version_id=version_id, title="Start", node_type="start", pos_x=120, pos_y=200, sort_order=0)
    )
    session.add(
        Node(id=uuid.uuid4().hex, version_id=version_id, title="End", node_type="end", is_primary_end=True, pos_x=480, pos_y=200, sort_order=1)
    )
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
        owning_department=source_map.owning_department,
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
            korean_name=e.korean_name,
            korean_dept=e.korean_dept,
        )
        for e in eligible
    ]


@router.get(
    "/{map_id}/editors",
    response_model=list[DirectoryUserOut],
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_editors(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[DirectoryUserOut]:
    """점유권 이전 피커 — role∈{owner,editor} user principal(직접+그룹) + Employee 이름 머지 (Task 2).

    get_user_active_group_ids 와 동일한 그룹 멤버십 로직을 적용해 그룹 경유 편집자도 포함한다.
    """
    perm_rows = list(
        (
            await session.execute(
                select(MapPermission.principal_type, MapPermission.principal_id).where(
                    MapPermission.map_id == map_id,
                    MapPermission.role.in_(["owner", "editor"]),
                )
            )
        ).all()
    )

    login_ids: set[str] = {pid for ptype, pid in perm_rows if ptype == "user"}
    # principal_id는 문자열로 저장된 정수 — UserGroup.id(int)와 맞추기 위해 캐스팅
    group_ids: set[int] = set()
    for ptype, pid in perm_rows:
        if ptype == "group":
            try:
                group_ids.add(int(pid))
            except ValueError:
                pass

    if group_ids:
        # active 그룹의 멤버 로드 — get_user_active_group_ids 와 동일 패턴
        member_rows = list(
            (
                await session.execute(
                    select(UserGroupMember.member_type, UserGroupMember.member_id)
                    .join(UserGroup, UserGroup.id == UserGroupMember.group_id)
                    .where(
                        UserGroup.status == "active",
                        UserGroupMember.group_id.in_(group_ids),
                    )
                )
            ).all()
        )
        dept_patterns: list[str] = []
        for mtype, mid in member_rows:
            if mtype == "user":
                login_ids.add(mid)
            elif mtype == "department":
                dept_patterns.append(mid)

        if dept_patterns:
            # department 멤버: 모든 직원의 org_path로 판정 (belongs_to_department 재사용)
            all_emps = list((await session.scalars(select(Employee))).all())
            for emp in all_emps:
                org = logic.org_path(
                    emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department or ""
                )
                if any(logic.belongs_to_department(org, d) for d in dept_patterns):
                    login_ids.add(emp.login_id)

    if not login_ids:
        return []

    emp_map: dict[str, Employee] = {
        e.login_id: e
        for e in (
            await session.scalars(select(Employee).where(Employee.login_id.in_(login_ids)))
        ).all()
    }
    return [
        DirectoryUserOut(
            id=lid,
            name=emp_map[lid].name if lid in emp_map else lid,
            department=emp_map[lid].department or "" if lid in emp_map else "",
            korean_name=emp_map[lid].korean_name if lid in emp_map else "",
        )
        for lid in sorted(login_ids)
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
    map_id: int,
    payload: MapUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.name is not None:
        new_name = payload.name.strip()
        if not new_name:
            raise HTTPException(status_code=422, detail="name must not be blank")
        if new_name != found_map.name:
            # 이름 변경은 오너/sysadmin 전용 — 에디터는 rename-requests 승인 경로 (spec 2026-07-18)
            role = await get_effective_role(session, user, map_id)
            if role != "owner":
                raise HTTPException(
                    status_code=403,
                    detail="renaming requires owner — submit a rename request instead",
                )
            await _assert_unique_name(session, new_name, exclude_map_id=map_id)
            old_name = found_map.name
            found_map.name = new_name
            await _supersede_pending_rename(session, map_id, actor=user, new_name=new_name)
            await workflow.notify_map_renamed(
                session, map_id, old_name=old_name, new_name=new_name, actor=user
            )
    if payload.description is not None:
        found_map.description = payload.description
    await session.commit()
    await session.refresh(found_map)
    return found_map


async def _supersede_pending_rename(
    session: AsyncSession, map_id: int, *, actor: str, new_name: str
) -> None:
    """오너 직접 변경 시 pending rename 요청 무효화 + 요청자 알림 (spec 2026-07-18)."""
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        return
    req.status = "superseded"
    req.decided_by = actor
    req.decided_at = _now()
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type="rename_superseded",
        map_id=map_id,
        message=f"Your rename request was superseded — the map is now '{new_name}'",
    )


@router.post(
    "/{map_id}/rename-requests",
    response_model=ApprovalRequestOut,
    status_code=201,
    dependencies=[Depends(require_map_role("editor"))],
)
async def create_rename_request(
    map_id: int,
    payload: RenameRequestIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalRequest:
    """이름 변경 승인 요청 — 오너/sysadmin 1인이 decide로 적용 (spec 2026-07-18)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    to_name = payload.to_name.strip()
    if not to_name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    if to_name == found_map.name:
        raise HTTPException(status_code=422, detail="new name equals current name")
    await _assert_unique_name(session, to_name, exclude_map_id=map_id)
    pending = await session.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(status_code=409, detail="a rename request is already pending")
    req = ApprovalRequest(
        map_id=map_id,
        kind="map_rename",
        payload={"from_name": found_map.name, "to_name": to_name},
        requested_by=user,
        status="pending",
    )
    session.add(req)
    requester_name = await workflow.get_display_name(session, user)
    recipients = [
        o
        for o in await workflow.load_map_user_collaborators(session, map_id, role="owner")
        if o != user
    ]
    await workflow.create_notifications(
        session,
        recipients,
        type="rename_requested",
        map_id=map_id,
        message=f"{requester_name} requested to rename '{found_map.name}' to '{to_name}'",
    )
    await session.commit()
    await session.refresh(req)
    return req


@router.get(
    "/{map_id}/rename-requests/pending",
    response_model=ApprovalRequestOut | None,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_pending_rename_request(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ApprovalRequest | None:
    """pending rename 요청 조회 — Settings 배지·중복요청 안내용 (없으면 null)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )


@router.delete(
    "/{map_id}/rename-requests/pending",
    status_code=204,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def withdraw_rename_request(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 pending rename 요청 취소 → withdrawn (행 보존 — 이력)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "map_rename",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        raise HTTPException(status_code=404, detail="no pending rename request")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()


@router.put(
    "/{map_id}/owning-department",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def set_owning_department(
    map_id: int,
    payload: OwningDepartmentIn,
    session: AsyncSession = Depends(get_session),
) -> ProcessMap:
    """오우닝 부서 지정/변경 — owner/sysadmin 전용. 파생 editor가 자동으로 새 부서를 따라간다."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    await _assert_known_department(session, payload.owning_department)
    found_map.owning_department = payload.owning_department
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.put(
    "/{map_id}/subprocess-designation",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def designate_subprocess(
    map_id: int,
    payload: SubprocessDesignationIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """서브프로세스 지정/속성수정(upsert) — 게시 버전 필수, 오너/sysadmin 전용 (spec 2026-07-06)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    has_published = await session.scalar(
        select(MapVersion.id).where(
            MapVersion.map_id == map_id, MapVersion.status == "published"
        )
    )
    if has_published is None:
        raise HTTPException(
            status_code=409, detail="map has no published version to designate"
        )
    was_new = found_map.sp_designated_at is None  # 최초 지정 전이 여부 — 등록 알림은 이때만
    if was_new:  # 미지정→지정 전환만 시각 갱신 (지정 중 수정은 유지)
        found_map.sp_designated_at = now_kst()
    found_map.sp_department = payload.department
    found_map.sp_assignee = payload.assignee
    found_map.sp_system = payload.system
    found_map.sp_duration = payload.duration
    found_map.sp_cost_krw = payload.cost_krw
    found_map.sp_cost_usd = payload.cost_usd
    found_map.sp_headcount = payload.headcount
    found_map.sp_url = payload.url
    found_map.sp_url_label = payload.url_label
    found_map.sp_description = payload.description or None
    found_map.sp_changed_by = user
    found_map.sp_changed_at = now_kst()
    if was_new:
        approvers = await workflow.load_active_approvers(session, map_id)
        recipients = [
            r
            for r in dict.fromkeys([found_map.owner_id, *approvers])
            if r and r != user
        ]
        if recipients:
            await workflow.create_notifications(
                session,
                recipients,
                type="subprocess_registered",
                map_id=map_id,
                message=f"'{found_map.name}' was registered as a subprocess",
            )
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.delete(
    "/{map_id}/subprocess-designation",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def undesignate_subprocess(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """지정 해제 — 어트리뷰트는 유지(재지정 프리필), 멱등 (spec 2026-07-06)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.sp_designated_at = None
    found_map.sp_changed_by = user
    found_map.sp_changed_at = now_kst()
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.get(
    "/{map_id}/subprocess-usage",
    response_model=SubprocessUsageOut,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_subprocess_usage(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> SubprocessUsageOut:
    """SP 지정 메타 + 이 맵을 링크한 부모 맵 목록 — 인스펙터 Subprocess 탭 소스 (design 2026-07-18).

    사용처 판정은 부모의 라이브 버전(게시본 max id, 없으면 최신) 기준 — list_maps 노드 수 규칙과 동일.
    호출자가 볼 수 없는 부모 맵은 이름을 노출하지 않고 hidden_count로만 집계한다.
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    # 지정이 가리키는 버전 = 최신 게시본(라이브 참조, resolve_linked_version과 동일 규칙)
    live_pub = (
        await session.execute(
            select(MapVersion.id, MapVersion.version_number, MapVersion.label)
            .where(MapVersion.map_id == map_id, MapVersion.status == workflow.PUBLISHED)
            .order_by(MapVersion.id.desc())
            .limit(1)
        )
    ).first()
    # 후보 부모 맵 — 어떤 버전에서든 이 맵을 링크한 적 있는 맵(순환 클로저와 동일 소스)
    candidate_ids = set(
        (
            await session.scalars(
                select(MapVersion.map_id)
                .join(Node, Node.version_id == MapVersion.id)
                .where(Node.linked_map_id == map_id)
                .distinct()
            )
        ).all()
    )
    used_by: list[SubprocessUsedByOut] = []
    hidden = 0
    if candidate_ids:
        parents = (
            await session.scalars(
                select(ProcessMap).where(
                    ProcessMap.id.in_(candidate_ids), ProcessMap.deleted_at.is_(None)
                )
            )
        ).all()
        pub_vid: dict[int, int] = {
            mid: vid
            for mid, vid in (
                await session.execute(
                    select(MapVersion.map_id, func.max(MapVersion.id))
                    .where(
                        MapVersion.map_id.in_(candidate_ids),
                        MapVersion.status == workflow.PUBLISHED,
                    )
                    .group_by(MapVersion.map_id)
                )
            ).all()
        }
        latest_vid: dict[int, int] = {
            mid: vid
            for mid, vid in (
                await session.execute(
                    select(MapVersion.map_id, func.max(MapVersion.id))
                    .where(MapVersion.map_id.in_(candidate_ids))
                    .group_by(MapVersion.map_id)
                )
            ).all()
        }
        live_vid = {p.id: pub_vid.get(p.id, latest_vid.get(p.id)) for p in parents}
        target_vids = {v for v in live_vid.values() if v is not None}
        link_count: dict[int, int] = {}
        if target_vids:
            link_count = {
                vid: cnt
                for vid, cnt in (
                    await session.execute(
                        select(Node.version_id, func.count())
                        .where(
                            Node.version_id.in_(target_vids),
                            Node.linked_map_id == map_id,
                        )
                        .group_by(Node.version_id)
                    )
                ).all()
            }
        for parent in sorted(parents, key=lambda p: p.name.lower()):
            vid = live_vid.get(parent.id)
            cnt = link_count.get(vid, 0) if vid is not None else 0
            if cnt == 0:  # 과거 버전에만 링크가 남은 맵 — 현재 사용처 아님
                continue
            role = await get_effective_role(session, user, parent.id)
            if role is None:
                hidden += 1
                continue
            used_by.append(
                SubprocessUsedByOut(
                    map_id=parent.id,
                    name=parent.name,
                    owning_department=parent.owning_department,
                    node_count=cnt,
                )
            )
    return SubprocessUsageOut(
        designated=found_map.sp_designated_at is not None,
        designated_at=found_map.sp_designated_at,
        changed_by=found_map.sp_changed_by,
        changed_at=found_map.sp_changed_at,
        designated_version_id=live_pub[0] if live_pub else None,
        designated_version_number=live_pub[1] if live_pub else None,
        designated_version_label=live_pub[2] if live_pub else None,
        used_by=used_by,
        hidden_count=hidden,
    )


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
