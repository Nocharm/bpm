"""Process map CRUD endpoints (docs/spec.md §3.5)."""

import uuid
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.db import get_session
from app.models import ApprovalRequest, CheckoutRequest, Comment, Edge, Employee, Group, MapApprover, MapNote, MapPermission, MapVersion, Node, ProcessCategory, ProcessMap, UserGroup, UserGroupMember, VersionApproval, VersionEvent, _now
from app.orgchart import load_dept_index, load_valid_org_prefixes, resolve_org_path
from app.permissions import logic
from app.permissions.access import (
    assert_map_role,
    get_effective_role,
    get_eligible_users,
    get_framework_category_id,
    get_user_active_group_ids,
    is_category_admin,
)
from app.permissions.deps import require_map_role
from app.routers.categories import build_category_paths
from app.routers.versions import clone_graph
from app.schemas import (
    ApprovalRequestOut,
    DirectoryUserOut,
    EligibleApproverOut,
    FrameworkConfirmIn,
    FrameworkConfirmOut,
    FrameworkTransferIn,
    MapCategoryIn,
    MapCopy,
    MapCreate,
    MapDetailOut,
    MapNoteOut,
    MapOut,
    MapUpdate,
    OwningDepartmentIn,
    RenameRequestIn,
    SpDesignationRequestIn,
    ProcessFieldsIn,
    SubprocessDesignationIn,
    SubprocessUsageOut,
    SubprocessUsedByOut,
    VersionOut,
    WordDocIn,
)
from app.version_events import record_version_event

router = APIRouter(
    prefix="/api/maps", tags=["maps"], dependencies=[Depends(get_current_user)]
)

# 소프트삭제 후 복구 가능 기간 — 경과분은 조회 시 lazy 영구삭제 (DL)
RECOVERY_WINDOW = timedelta(days=7)


async def _delete_map_kb_chunks(session: AsyncSession, map_ids: list[int]) -> None:
    """맵 KB 청크 제거 — 삭제된 맵이 무기한 검색·프롬프트 주입되지 않게 (hardening T16).

    복구(restore) 시엔 재게시 훅이 다시 인덱싱한다(kb-embedding.md 절차).
    """
    if not map_ids:
        return
    from app.kb import retrieval  # 최상단 import 시 kb→models 외 순환 여지 회피(지역 관례)
    from app.models import KbChunk

    await session.execute(
        sa_delete(KbChunk).where(KbChunk.source_type == "map", KbChunk.source_id.in_(map_ids))
    )
    retrieval.invalidate_cache()


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
        await _delete_map_kb_chunks(session, [m.id for m in expired])
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


async def _build_retired_name(session: AsyncSession, base: str) -> str:
    """원본 은퇴 rename — "(Pending deletion)" 태그, 200자 한도 절단, 중복 시 카운터."""
    n = 1
    while True:
        tag = " (Pending deletion)" if n == 1 else f" (Pending deletion {n})"
        candidate = base[: 200 - len(tag)] + tag
        if await session.scalar(select(ProcessMap.id).where(ProcessMap.name == candidate)) is None:
            return candidate
        n += 1


async def _assert_known_department(session: AsyncSession, dept_path: str) -> None:
    """오우닝 부서는 실제 조직 경로여야 한다 — resolver 유효 경로 프리픽스와 대조, 아니면 422.

    피커(directory)와 같은 소스(orgchart.load_valid_org_prefixes) — org 컬럼 인라인 조합을 쓰면
    체인 해석과 어긋나 피커에서 고른 값이 여기서 거부된다 (9910 검증 적발). active 여부는 무관.
    """
    if dept_path not in await load_valid_org_prefixes(session):
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
    # 카테고리 트리 전체를 1회 로드(수천 행) → id별 "L1/.../연결노드" 경로 dict (design 2026-08-08)
    category_paths = build_category_paths(
        (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
    )
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
        m.category_path = category_paths.get(m.category_id) if m.category_id else None
    if is_admin:
        for m in maps:
            m.my_role = "owner"  # sysadmin → 전 맵 owner (effective_role parity)
            _set_card_metrics(m)
        return maps  # 필터 불필요(쿼리도 생략)

    emp = await session.get(Employee, user)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
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
        mode=payload.mode,
        doc_name=payload.doc_name,
        doc_sections=[s.model_dump() for s in payload.doc_sections],
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
    """맵 복사 — 새 맵의 초기 draft에 그래프 복제, 원본 오너 알림 (request #12 재편).

    게시(published/expired) 이력 1회 이상인 맵만 복사 가능 — Word 승격(convert)은 예외로
    기존 승인본 기준 유지. version_id 지정 시 그 버전(상태 무관)을 원본으로, 미지정이면
    최신 게시본. retire_source(오너 전용)는 원본을 "(Pending deletion)" rename 후
    휴지통으로 보내고 승인자·editor+ 협업자에게 알린다.
    """
    source_map = await session.get(ProcessMap, map_id)
    if source_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if source_map.mode == "framework":
        # 캔버스는 카테고리와 1:1 — 복제본은 결착이 없어 의미 불명 (design 2026-08-28 §9)
        raise HTTPException(
            status_code=422, detail="framework linkage canvas cannot be copied"
        )
    original_name = source_map.name
    convert = payload.convert_to_normal
    # 게시 이력 게이트 — 프론트 버튼 비활성과 동일 판정(status 기준: version_number는
    # pre-ALTER 게시본이 NULL일 수 있어 부적합)
    if not convert:
        has_publish = await session.scalar(
            select(MapVersion.id)
            .where(
                MapVersion.map_id == map_id,
                MapVersion.status.in_([workflow.PUBLISHED, workflow.EXPIRED]),
            )
            .limit(1)
        )
        if has_publish is None:
            raise HTTPException(status_code=409, detail="map has never been published")
    # 원본 버전 1개 — 그래프 즉시 클론을 위해 nodes/edges/groups eager-load
    version_query = select(MapVersion).where(MapVersion.map_id == map_id)
    if payload.version_id is not None:
        version_query = version_query.where(MapVersion.id == payload.version_id)
    elif convert:
        version_query = version_query.where(
            MapVersion.status.in_([workflow.APPROVED, workflow.PUBLISHED])
        )
    else:
        version_query = version_query.where(
            MapVersion.status.in_([workflow.PUBLISHED, workflow.EXPIRED])
        )
    source_version = (
        await session.scalars(
            version_query.order_by(MapVersion.id.desc())
            .limit(1)
            .options(
                selectinload(MapVersion.nodes),
                selectinload(MapVersion.edges),
                selectinload(MapVersion.groups),
            )
        )
    ).first()
    if source_version is None:
        if payload.version_id is not None:
            raise HTTPException(
                status_code=404,
                detail=f"version {payload.version_id} not found in map {map_id}",
            )
        raise HTTPException(status_code=409, detail="map has no approved version to copy")

    copy_name = payload.name or f"{original_name} (Copy)"
    if payload.owning_department:
        await _assert_known_department(session, payload.owning_department)
    actor_name = await workflow.get_display_name(session, user)
    if payload.retire_source:
        # 원본 은퇴는 오너 전용 — viewer 복사 권한과 별개로 상향 검증 (B4)
        await assert_map_role(session, user, map_id, "owner")
        retire_recipients = [
            r
            for r in dict.fromkeys(
                [
                    *(await workflow.load_active_approvers(session, map_id)),
                    *(await workflow.load_map_user_collaborators(session, map_id, role="editor")),
                    *(await workflow.load_map_user_collaborators(session, map_id, role="owner")),
                ]
            )
            if r != user
        ]
        # rename을 먼저 — 새 맵이 원본 이름을 그대로 물려받아도 중복 검사를 통과한다 (B5)
        source_map.name = await _build_retired_name(session, original_name)
        source_map.deleted_at = now_kst()
        await _delete_map_kb_chunks(session, [map_id])
        await workflow.create_notifications(
            session,
            retire_recipients,
            type="map_retired",
            map_id=map_id,
            message=f"{actor_name} copied '{original_name}' and moved the original to the trash",
            payload={"map_name": original_name, "actor": user, "actor_name": actor_name},
        )
    await _assert_unique_name(session, copy_name)
    new_map = ProcessMap(
        name=copy_name,
        description=source_map.description,
        created_by=user,
        owner_id=user,
        visibility=payload.visibility,
        owning_department=payload.owning_department or source_map.owning_department,
        # Word 맵 복사는 mode·문서 카탈로그도 함께 상속 — 승격(convert)은 일반 맵으로 소거 (design 2026-07-24 §6)
        mode="normal" if convert else source_map.mode,
        doc_name="" if convert else source_map.doc_name,
        # or [] — pre-ALTER 운영 행은 doc_sections NULL(DDL DEFAULT 없음, db.py _ADDED_COLUMNS)
        doc_sections=[] if convert else list(source_map.doc_sections or []),
    )
    new_version = MapVersion(label="As-Is")
    new_map.versions.append(new_version)
    session.add(new_map)
    await session.flush()
    if payload.retire_source:
        # 이양 계보 기록 — 은퇴 맵을 가리키는 SP 노드의 교체 추천이 이 체인을 따른다 (2026-08-30)
        source_map.retired_to_map_id = new_map.id
    await clone_graph(session, source_version, new_version.id)
    if convert:
        # 승격: 섹션 노드 → 일반 process 노드 일괄 변환(앵커 소거·url은 유지) (design 2026-07-24 §6)
        for node in await session.scalars(
            select(Node).where(Node.version_id == new_version.id, Node.node_type == "section")
        ):
            node.node_type = "process"
            node.section_anchor = ""
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
    # 원본 오너에게 복사 사실 알림 — 행위자 본인 제외 (A1)
    owner_recipients = [
        o
        for o in dict.fromkeys(
            [
                *(await workflow.load_map_user_collaborators(session, map_id, role="owner")),
                *([source_map.owner_id] if source_map.owner_id else []),
            ]
        )
        if o != user
    ]
    await workflow.create_notifications(
        session,
        owner_recipients,
        type="map_copied",
        map_id=map_id,
        message=f"{actor_name} copied '{original_name}' as '{copy_name}'",
        payload={"map_name": original_name, "copy_name": copy_name,
                 "actor": user, "actor_name": actor_name},
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
    dept_index = await load_dept_index(session)  # 다수 루프 — 인덱스 1회 로드 후 재사용
    return [
        EligibleApproverOut(
            id=e.login_id,
            name=e.name or e.login_id,
            department=e.department or "",
            # 소속 경로(센터/부서/팀/그룹/파트) — 승인자 카드 표시용 (ST)
            org_path=resolve_org_path(e, dept_index),
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
            # 퇴직자(active=false) 제외 — HR 전환 후 행이 잔류 (design 2026-08-10 §7)
            all_emps = list(
                (await session.scalars(select(Employee).where(Employee.active.is_(True)))).all()
            )
            dept_index = await load_dept_index(session)  # 다수 루프 — 인덱스 1회 로드 후 재사용
            for emp in all_emps:
                org = resolve_org_path(emp, dept_index)
                if any(logic.belongs_to_department(org, d) for d in dept_patterns):
                    login_ids.add(emp.login_id)

    if not login_ids:
        return []

    # 퇴직자(active=false) 제외 — HR 전환 후 행이 잔류 (design 2026-08-10 §7)
    emp_map: dict[str, Employee] = {
        e.login_id: e
        for e in (
            await session.scalars(
                select(Employee).where(
                    Employee.active.is_(True), Employee.login_id.in_(login_ids)
                )
            )
        ).all()
    }
    return [
        DirectoryUserOut(
            id=lid,
            name=emp_map[lid].name,
            department=emp_map[lid].department or "",
            korean_name=emp_map[lid].korean_name,
        )
        for lid in sorted(login_ids)
        if lid in emp_map  # 퇴직자·소멸 계정은 점유권 이전 후보에서 제외 (design 2026-08-10 §7)
    ]


@router.get(
    "/{map_id}/notes",
    response_model=list[MapNoteOut],
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_map_notes(
    map_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[MapNote]:
    """맵 노트(인터뷰 예외 규칙·VOC) 읽기전용 목록 (design 2026-08-18 §5·§6)."""
    return list((await session.scalars(
        select(MapNote).where(MapNote.map_id == map_id).order_by(MapNote.id)
    )).all())


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
    # 소유자 직원명 — 목록 응답과 동일 소스(Employee). PNG 정보 카드 등 상세 화면 표기용.
    if found_map.created_by:
        found_map.owner_name = (
            await session.execute(
                select(Employee.name).where(Employee.login_id == found_map.created_by)
            )
        ).scalars().first()
    if found_map.category_id is not None:
        category_paths = build_category_paths(
            (
                await session.execute(
                    select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
                )
            ).all()
        )
        found_map.category_path = category_paths.get(found_map.category_id)
    if found_map.mode == "framework":
        # 캔버스 → 결착 카테고리 역조회 — FrameworkChip·자동 보강 호출 소스 (design 2026-08-28 §8)
        linkage_cat_id = await session.scalar(
            select(ProcessCategory.id).where(ProcessCategory.linkage_map_id == map_id)
        )
        if linkage_cat_id is not None:
            found_map.linkage_category_id = linkage_cat_id
            linkage_paths = build_category_paths(
                (
                    await session.execute(
                        select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
                    )
                ).all()
            )
            found_map.linkage_category_path = linkage_paths.get(linkage_cat_id)
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
        payload={"map_name": new_name, "to_name": new_name},
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
    if found_map.mode == "framework":
        # framework 캔버스는 확정(framework-confirm) 전용 — 이름변경 승인 워크플로 옆문 차단 (spec 2026-09-02 §6)
        raise HTTPException(
            status_code=422, detail="framework maps use the confirm workflow"
        )
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
        payload={"map_name": found_map.name, "from_name": found_map.name,
                 "to_name": to_name, "actor": user, "actor_name": requester_name},
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


@router.post(
    "/{map_id}/sp-designation-requests",
    response_model=ApprovalRequestOut,
    status_code=201,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def create_sp_designation_request(
    map_id: int,
    payload: SpDesignationRequestIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalRequest:
    """SP 등록(지정) 요청 — 오너/sysadmin이 지정 모달 저장(PUT)으로 수락 (spec 2026-07-19).

    게이트는 viewer — 피커에 노출되는(가시성 있는) 맵만 요청 가능 조건과 일치.
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.mode == "framework":
        # framework 캔버스는 확정(framework-confirm) 전용 — SP 등록 요청은 승인자 없는 영구
        # pending 좀비를 만든다(spec 2026-09-02 §6)
        raise HTTPException(
            status_code=422, detail="framework maps use the confirm workflow"
        )
    if found_map.sp_designated_at is not None:
        raise HTTPException(status_code=409, detail="map is already designated")
    pending = await session.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "sp_designation",
            ApprovalRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(
            status_code=409, detail="a designation request is already pending"
        )
    # from_map 이름은 서버에서 박제 — 클라이언트 값 신뢰하지 않음.
    # 요청자가 볼 수 없는 맵이면 이름을 싣지 않는다(임의 from_map_id로 비공개 맵 이름을
    # 알아내는 IDOR 차단). 미존재와 무권한 모두 "" — 존재 여부 오라클도 남기지 않음.
    from_map = await session.get(ProcessMap, payload.from_map_id)
    from_map_name = ""
    if from_map is not None and from_map.deleted_at is None:
        if await get_effective_role(session, user, payload.from_map_id) is not None:
            from_map_name = from_map.name
    req = ApprovalRequest(
        map_id=map_id,
        kind="sp_designation",
        payload={
            "from_map_id": payload.from_map_id,
            "from_map_name": from_map_name,
            "map_name": found_map.name,
        },
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
        type="sp_designation_requested",
        map_id=map_id,
        message=f"{requester_name} requested to register '{found_map.name}' as a subprocess",
        payload={"map_name": found_map.name, "actor": user, "actor_name": requester_name},
    )
    await session.commit()
    await session.refresh(req)
    return req


@router.get(
    "/{map_id}/sp-designation-requests/pending",
    response_model=ApprovalRequestOut | None,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_pending_sp_designation_request(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ApprovalRequest | None:
    """pending SP 등록 요청 조회 — 인스펙터 배지·중복요청 안내용 (없으면 null)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "sp_designation",
            ApprovalRequest.status == "pending",
        )
    )


@router.delete(
    "/{map_id}/sp-designation-requests/pending",
    status_code=204,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def withdraw_sp_designation_request(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 pending SP 등록 요청 취소 → withdrawn (행 보존 — 이력)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "sp_designation",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        raise HTTPException(status_code=404, detail="no pending designation request")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()


@router.put(
    "/{map_id}/word-doc",
    response_model=MapDetailOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def set_word_doc(
    map_id: int,
    payload: WordDocIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """Word 맵 재임포트 — doc_name·doc_sections을 통째로 교체한다 (design 2026-07-18)."""
    found_map = await session.get(
        ProcessMap,
        map_id,
        options=[selectinload(ProcessMap.versions).selectinload(MapVersion.events)],
    )
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.doc_name = payload.doc_name
    found_map.doc_sections = [s.model_dump() for s in payload.sections]
    found_map.doc_imported_at = _now()
    await session.commit()
    await session.refresh(found_map, attribute_names=["versions"])
    for version in found_map.versions:
        await session.refresh(version, attribute_names=["events"])
    found_map.my_role = await get_effective_role(session, user, map_id)
    return found_map


@router.post(
    "/{map_id}/word-doc/generated",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def mark_word_doc_generated(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """완결 문서 생성 성공 기록 — 생성은 클라이언트 전용이라 서버는 시각만 스탬프 (design 2026-07-24 §5)."""
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    found_map.doc_generated_at = _now()
    await session.commit()
    found_map.my_role = await get_effective_role(session, user, map_id)
    return found_map


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
    "/{map_id}/category",
    response_model=MapDetailOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def set_map_category(
    map_id: int,
    payload: MapCategoryIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    """체계 카테고리 연결/해제 — 맵 슬롯은 L5 전용(2026-08-30 확정), null=해제. owner/sysadmin 전용."""
    found_map = await session.get(
        ProcessMap,
        map_id,
        options=[selectinload(ProcessMap.versions).selectinload(MapVersion.events)],
    )
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.category_id is not None:
        category = await session.get(ProcessCategory, payload.category_id)
        if category is None:
            raise HTTPException(
                status_code=404, detail=f"category {payload.category_id} not found"
            )
        # 맵 슬롯은 L5 전용 — 상위 레벨엔 업무 맵이 들어가지 않는다 (사용자 확정 2026-08-30)
        if category.level != 5:
            raise HTTPException(
                status_code=422,
                detail="maps can only be attached to a level-5 category",
            )
    found_map.category_id = payload.category_id
    await session.commit()
    await session.refresh(found_map, attribute_names=["versions"])
    for version in found_map.versions:
        await session.refresh(version, attribute_names=["events"])
    found_map.my_role = await get_effective_role(session, user, map_id)
    if found_map.category_id is not None:
        category_paths = build_category_paths(
            (
                await session.execute(
                    select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
                )
            ).all()
        )
        found_map.category_path = category_paths.get(found_map.category_id)
    return found_map


@router.post(
    "/{map_id}/framework-transfer",
    dependencies=[Depends(require_map_role("owner"))],
)
async def transfer_framework_slot(
    map_id: int,
    payload: FrameworkTransferIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> dict[str, int]:
    """체계 슬롯(category_id+consultant_code)을 source→target으로 이전, source는 해제한다.

    가드: sysadmin이거나 두 맵 모두의 owner (design 2026-08-08). 알림 없음 — 최소 스코프.
    """
    source = await session.get(ProcessMap, map_id)
    if source is None or source.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    target = await session.get(ProcessMap, payload.to_map_id)
    if target is None or target.deleted_at is not None:
        raise HTTPException(
            status_code=404, detail=f"map {payload.to_map_id} not found"
        )
    # source의 owner 여부는 경로 의존성(require_map_role)이 이미 검증 — target은 별도 검증
    await assert_map_role(session, user, payload.to_map_id, "owner")
    if source.category_id is None:
        raise HTTPException(status_code=409, detail="source map has no framework slot")
    if target.category_id is not None or target.consultant_code is not None:
        raise HTTPException(
            status_code=409, detail="target map already has a framework slot"
        )
    # 슬롯 이양 보완 — L5 전용 확정에 따라 비-L5(레거시) 슬롯은 이양 대신 정리 대상 (2026-08-30)
    slot_category = await session.get(ProcessCategory, source.category_id)
    if slot_category is None or slot_category.level != 5:
        raise HTTPException(
            status_code=409,
            detail="framework slot must point to a level-5 category — reassign before transfer",
        )
    target.category_id = source.category_id
    target.consultant_code = source.consultant_code
    source.category_id = None
    source.consultant_code = None
    await session.commit()
    return {"from_map_id": map_id, "to_map_id": payload.to_map_id}


def _canvas_content_signature(nodes: list[Node], edges: list[Edge]) -> tuple:
    """레이아웃 무시 콘텐츠 시그니처 — 확정 게이트용 (2026-08-28 개선).

    노드는 계보 키(source_node_id∥id)로 정렬해 FE computeVersionDiff(FIELD_KEYS)와 같은
    콘텐츠 필드 + 링크 정체성만 비교한다. 좌표·sort_order·엣지 시각 필드(side/line_style)·
    그룹 멤버십은 배치 취급이라 제외 — FE 게이트와 판정 기준을 맞춘다(lib/diff.ts).
    """
    lineage = {n.id: (n.source_node_id or n.id) for n in nodes}
    node_sig = sorted(
        (
            n.source_node_id or n.id, n.title, n.description, n.node_type, n.color,
            n.assignee, n.department, n.system, n.duration, n.touch_time,
            n.cost_krw, n.cost_usd, n.headcount, n.annual_count, n.fte,
            n.input, n.output, n.input_forms, n.output_forms, n.data_form, n.gmp,
            n.start_condition, n.end_condition,
            n.linked_map_id, n.follow_latest, n.is_primary_end,
            n.placeholder_category_id,  # 플레이스홀더 출처도 링크 정체성 (design §10.1)
        )
        for n in nodes
    )
    edge_sig = sorted(
        (
            lineage.get(e.source_node_id, e.source_node_id),
            lineage.get(e.target_node_id, e.target_node_id),
            e.label, e.source_handle or "", e.target_handle or "",
        )
        for e in edges
    )
    return (tuple(node_sig), tuple(edge_sig))


# 스냅샷 영구삭제 스윕 대상 — sqlite는 FK CASCADE 미강제라 명시 벌크 삭제(delete_category 선례)
_VERSION_CHILD_MODELS = (Node, Edge, Group, Comment, VersionApproval, VersionEvent, CheckoutRequest)


@router.post("/{map_id}/framework-confirm", response_model=FrameworkConfirmOut)
async def confirm_framework_version(
    map_id: int,
    payload: FrameworkConfirmIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> FrameworkConfirmOut:
    """라이브 draft를 스냅샷(confirmed)으로 확정 — 권한자/sysadmin 본인 확정, 상위 승인 없음.

    마이너 확정은 직전 스냅샷 대비 레이아웃 외 변경이 있을 때만(없으면 409 — 손쉬운 버전
    남발 방지). 메이저 승급은 의도된 의식이라 게이트를 우회하되, 직전 메이저 라인의 중간
    마이너를 영구삭제한다(X.0·X.최종만 유지, 삭제 라벨은 응답 동봉) (2026-08-28 개선).
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.mode != "framework":
        raise HTTPException(status_code=422, detail="not a framework linkage canvas")
    if not logic.is_sysadmin(user):
        category_id = await get_framework_category_id(session, map_id)
        if category_id is None or not await is_category_admin(session, user, category_id):
            raise HTTPException(status_code=403, detail="category admin only")

    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == map_id, MapVersion.status == "draft")
        .order_by(MapVersion.id.desc())
        .options(
            selectinload(MapVersion.nodes),
            selectinload(MapVersion.edges),
            selectinload(MapVersion.groups),
        )
    )
    if draft is None:
        raise HTTPException(status_code=409, detail="canvas has no draft version")

    # fw 채번 — (major,minor) 최댓값 기준. 최초 1.0
    fw_rows = (
        await session.execute(
            select(MapVersion.fw_major, MapVersion.fw_minor).where(
                MapVersion.map_id == map_id, MapVersion.fw_major.is_not(None)
            )
        )
    ).all()
    if not fw_rows:
        major, minor = 1, 0
    else:
        cur_major, cur_minor = max(fw_rows)
        if not payload.major:
            # 무변경 게이트 — 최신 스냅샷과 콘텐츠 동일하면 409 (좌표만 이동은 변경 아님)
            latest = await session.scalar(
                select(MapVersion)
                .where(
                    MapVersion.map_id == map_id,
                    MapVersion.fw_major == cur_major,
                    MapVersion.fw_minor == cur_minor,
                )
                .options(selectinload(MapVersion.nodes), selectinload(MapVersion.edges))
            )
            if latest is not None and _canvas_content_signature(
                draft.nodes, draft.edges
            ) == _canvas_content_signature(latest.nodes, latest.edges):
                raise HTTPException(
                    status_code=409,
                    detail=f"no content changes since v{cur_major}.{cur_minor}",
                )
        major, minor = (cur_major + 1, 0) if payload.major else (cur_major, cur_minor + 1)

    pruned_labels: list[str] = []
    if payload.major and fw_rows:
        # 직전 메이저 라인 정리 — X.0과 X.최종만 유지, 중간 마이너 영구삭제 (사용자 결정 2026-08-28)
        prev_major, prev_max_minor = cur_major, cur_minor
        prune_rows = (
            await session.execute(
                select(MapVersion.id, MapVersion.label)
                .where(
                    MapVersion.map_id == map_id,
                    MapVersion.fw_major == prev_major,
                    MapVersion.fw_minor > 0,
                    MapVersion.fw_minor < prev_max_minor,
                )
                .order_by(MapVersion.fw_minor)
            )
        ).all()
        for vid, label in prune_rows:
            for child in _VERSION_CHILD_MODELS:
                await session.execute(sa_delete(child).where(child.version_id == vid))
            await session.execute(sa_delete(MapVersion).where(MapVersion.id == vid))
            pruned_labels.append(label)

    snapshot = MapVersion(
        map_id=map_id, label=f"v{major}.{minor}", status=workflow.CONFIRMED,
        fw_major=major, fw_minor=minor, submitted_by=user,
    )
    session.add(snapshot)
    await session.flush()
    await clone_graph(session, draft, snapshot.id)
    record_version_event(session, snapshot.id, workflow.CONFIRMED, user)
    await session.commit()
    await session.refresh(snapshot)
    return FrameworkConfirmOut(
        version=VersionOut.model_validate(snapshot), pruned_labels=pruned_labels
    )


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
    if found_map.mode == "framework":
        # 캔버스를 다른 맵의 링크노드로 삼는 것 차단 (design 2026-08-28 §9)
        raise HTTPException(
            status_code=422, detail="framework linkage canvas cannot be designated"
        )
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
    found_map.sp_touch_time = payload.touch_time or None
    found_map.sp_url = payload.url
    found_map.sp_url_label = payload.url_label
    # 지정 설명은 맵 설명 그 자체 — 여기서 고치면 맵 설명이 함께 바뀐다 (사용자 결정 2026-08-31)
    found_map.description = payload.description or ""
    found_map.sp_input = payload.input or None
    found_map.sp_output = payload.output or None
    found_map.sp_input_forms = payload.input_forms or None
    found_map.sp_output_forms = payload.output_forms or None
    found_map.sp_input_ids = payload.input_ids or None
    found_map.sp_output_ids = payload.output_ids or None
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
                payload={"map_name": found_map.name},
            )
        # pending SP 등록 요청은 지정 저장으로 수락 완결 — Inbox 수락 체인·직접 지정 모두 이 경로 (spec 2026-07-19)
        await _apply_pending_sp_designation(
            session, map_id, actor=user, map_name=found_map.name
        )
    await session.commit()
    await session.refresh(found_map)
    return found_map


async def _apply_pending_sp_designation(
    session: AsyncSession, map_id: int, *, actor: str, map_name: str
) -> None:
    """지정 완료 시 pending sp_designation 요청 자동 applied + 요청자 알림 (spec 2026-07-19)."""
    req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "sp_designation",
            ApprovalRequest.status == "pending",
        )
    )
    if req is None:
        return
    req.status = "applied"
    req.decided_by = actor
    req.decided_at = _now()
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type="sp_designation_approved",
        map_id=map_id,
        message=f"Your subprocess registration request for '{map_name}' was approved",
        payload={"map_name": map_name, "outcome": "approved"},
    )


@router.patch(
    "/{map_id}/process-fields",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def update_process_fields(
    map_id: int,
    payload: ProcessFieldsIn,
    session: AsyncSession = Depends(get_session),
) -> ProcessMap:
    """인터뷰 승격 필드(대표+폴백) 부분 갱신 — SP 지정 여부와 무관, 검토 편집 경로 (design 2026-08-19 §5).

    필드명이 sp_ 컬럼과 1:1이라 접두만 붙여 매핑한다. 빈 문자열은 NULL 소거.
    """
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(found_map, f"sp_{field}", value or None)
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
    # KB 청크 즉시 제거 — get_effective_role이 삭제 맵을 구분하지 않아 검색 필터만으론
    # 계속 주입된다. 복구 시 재게시 훅이 재인덱싱 (hardening T16)
    await _delete_map_kb_chunks(session, [map_id])
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
    # 소프트삭제 때 제거한 KB 청크 재인덱싱 — 게시본이 있으면 백그라운드 복원 (hardening T16)
    from app.kb import embed_client, indexing

    if embed_client.is_embed_enabled():
        published_ids = (
            await session.scalars(
                select(MapVersion.id).where(
                    MapVersion.map_id == map_id, MapVersion.status == workflow.PUBLISHED
                )
            )
        ).all()
        for version_id in published_ids:
            indexing.spawn(indexing.index_map_version(version_id))
    return found_map


@router.delete("/{map_id}/permanent", status_code=204)
async def purge_map(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> None:
    """휴지통 맵 즉시 영구삭제 — sysadmin 전용. 7일 보존을 기다리지 않고 바로 제거."""
    if not logic.is_sysadmin(user):
        raise HTTPException(status_code=403, detail="sysadmin required")
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.deleted_at is None:
        # 활성 맵 오삭제 방지 — 소프트삭제(휴지통) 상태만 영구삭제 허용
        raise HTTPException(status_code=409, detail="map is not in trash")
    await _delete_map_kb_chunks(session, [map_id])
    await session.delete(found_map)
    await session.commit()
