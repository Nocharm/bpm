"""Version management — create (optionally cloning), rename, delete, checkout (docs/spec.md §3.4, §7)."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.clock import now as now_kst
from app.auth import get_current_user
from app.version_events import record_version_event
from app.checkout import is_checkout_active, is_locked_by_other
from app.db import get_session
from app.kb import embed_client, indexing
from app.orgchart import load_dept_index
from app.permissions.access import get_effective_role, get_eligible_users
from app.permissions.deps import require_map_role, require_version_map_role
from app.permissions.logic import is_sysadmin
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    Edge,
    Group,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    VersionApproval,
    VersionEvent,
    _now,
)
from app.schemas import (
    BundledVisibilityOut,
    CheckoutIn,
    CheckoutOut,
    CheckoutTransferIn,
    CommentIn,
    DeptInfoValueOut,
    DirectoryUserOut,
    EligibleAssigneesOut,
    PendingCheckoutRequestOut,
    RejectIn,
    SubmitIn,
    VersionCreate,
    VersionOut,
    VersionUpdate,
    WorkflowStateOut,
)

router = APIRouter(
    prefix="/api", tags=["versions"], dependencies=[Depends(get_current_user)]
)


async def clone_graph(
    session: AsyncSession, source: MapVersion, target_version_id: int
) -> None:
    """source 버전의 노드/엣지를 새 ID로 깊은 복사. 엣지/그룹 참조를 재매핑한다.

    버전 클론(create_version)과 맵 복사(maps.copy_map, F12)에서 공용.
    """
    id_map = {node.id: uuid.uuid4().hex for node in source.nodes}

    cloned: dict[str, Node] = {}
    for node in source.nodes:
        clone = Node(
            id=id_map[node.id],
            version_id=target_version_id,
            title=node.title,
            description=node.description,
            node_type=node.node_type,
            color=node.color,
            assignee=node.assignee,
            department=node.department,
            system=node.system,
            duration=node.duration,
            cost_krw=node.cost_krw,
            cost_usd=node.cost_usd,
            headcount=node.headcount,
            annual_count=node.annual_count,
            fte=node.fte,
            touch_time=node.touch_time,
            input=node.input,
            output=node.output,
            start_condition=node.start_condition,
            end_condition=node.end_condition,
            data_form=node.data_form,
            system_fallback=node.system_fallback,
            gmp=node.gmp,
            url=node.url,
            url_label=node.url_label,
            section_anchor=node.section_anchor,
            # 계보 루트 전파 — 복제의 복제도 최초 원본을 가리켜 diff 매칭 유지
            source_node_id=node.source_node_id or node.id,
            pos_x=node.pos_x,
            pos_y=node.pos_y,
            sort_order=node.sort_order,
            # 하위프로세스 참조 필드 — 복제 시 그대로 이전 (Call Activity 링크 보존)
            linked_map_id=node.linked_map_id,
            follow_latest=node.follow_latest,
            linked_version_id=node.linked_version_id,
            # 대표 끝 플래그 보존
            is_primary_end=node.is_primary_end,
        )
        session.add(clone)
        cloned[node.id] = clone
    await session.flush()

    # 그룹 복제(새 ID) + 노드 멤버십(group_id) 재매핑
    group_id_map = {group.id: uuid.uuid4().hex for group in source.groups}
    for group in source.groups:
        session.add(
            Group(
                id=group_id_map[group.id],
                version_id=target_version_id,
                # 중첩 상위 그룹도 새 ID로 리맵 (없으면 None)
                parent_group_id=(
                    group_id_map.get(group.parent_group_id)
                    if group.parent_group_id is not None
                    else None
                ),
                label=group.label,
                color=group.color,
            )
        )
    for node in source.nodes:
        # 다중 그룹(group_ids) + 레거시 단일(group_id)을 합쳐 새 그룹 id로 리맵
        src_gids = list(node.group_ids) if node.group_ids else (
            [node.group_id] if node.group_id else []
        )
        cloned[node.id].group_ids = [group_id_map[g] for g in src_gids if g in group_id_map]
        cloned[node.id].group_id = None

    for edge in source.edges:
        session.add(
            Edge(
                id=uuid.uuid4().hex,
                version_id=target_version_id,
                source_node_id=id_map[edge.source_node_id],
                target_node_id=id_map[edge.target_node_id],
                label=edge.label,
                # 시각 방향 (pre-existing gap — source_side/target_side도 함께 보존)
                source_side=edge.source_side,
                target_side=edge.target_side,
                # 다중 출구 핸들 식별자 보존 (이 브랜치 신규 필드)
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
                line_style=edge.line_style,
            )
        )


@router.post(
    "/maps/{map_id}/versions",
    response_model=VersionOut,
    status_code=201,
    dependencies=[Depends(require_map_role("editor"))],
)
async def create_version(
    map_id: int,
    payload: VersionCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")

    # 새 버전은 '현재(최신) 버전이 게시(published)된 뒤'에만 생성 (request #11 강화2).
    # draft/pending/rejected는 물론 approved(승인했지만 미게시)에서도 차단 → 반드시 게시해야 새 작업본 시작.
    # publish가 직전 published를 expired(terminal)로 전환하므로, 최신 버전이 published면 이전 이력은 무관.
    # status 컬럼만 조회 — 엔티티를 identity map에 올리면 이후 source clone의 selectinload가 무효화됨.
    latest_status = await session.scalar(
        select(MapVersion.status)
        .where(MapVersion.map_id == map_id)
        .order_by(MapVersion.id.desc())
        .limit(1)
    )
    if latest_status is not None and latest_status != workflow.PUBLISHED:
        raise HTTPException(
            status_code=409,
            detail="publish the current version before creating a new one",
        )

    new_version = MapVersion(map_id=map_id, label=payload.label)
    session.add(new_version)
    await session.flush()

    if payload.source_version_id is not None:
        source = await session.get(
            MapVersion,
            payload.source_version_id,
            options=[
                selectinload(MapVersion.nodes),
                selectinload(MapVersion.edges),
                selectinload(MapVersion.groups),
            ],
        )
        if source is None or source.map_id != map_id:
            raise HTTPException(
                status_code=404, detail="source version not found in this map"
            )
        await clone_graph(session, source, new_version.id)

    record_version_event(session, new_version.id, "created", user)
    # 생성자를 점유권자로 — 드래프트 편집권은 생성자가 보유(타인 읽기전용, 강탈은 sysadmin force만).
    new_version.checked_out_by = user
    new_version.checked_out_at = now_kst()
    await session.commit()
    await session.refresh(new_version)
    return new_version


@router.get(
    "/versions/{version_id}/eligible-assignees",
    response_model=EligibleAssigneesOut,
    dependencies=[Depends(require_version_map_role("viewer"))],
)
async def list_eligible_assignees(
    version_id: int, session: AsyncSession = Depends(get_session)
) -> EligibleAssigneesOut:
    """노드 담당자/부서 후보 — 맵 조회권한(viewer+) 보유 직원만 (F5, 자유입력 폐기).

    공개 맵은 전원 열람이라 모든 직원이 후보. 비공개는 effective_role>=viewer 인 직원만.
    effective_role 순수 함수를 직원별로 재사용(앱 권한 모델과 동일) — 데이터는 1회씩만 로드.
    """
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    eligible = await get_eligible_users(session, version.map_id)
    users = [
        DirectoryUserOut(
            id=e.login_id,
            name=e.name or e.login_id,
            department=e.department or "",
            korean_name=e.korean_name,
            korean_dept=e.korean_dept,
        )
        for e in eligible
    ]
    departments = sorted({e.department for e in eligible if e.department})
    # 부서 한글명 — 후보 부서 중 departments.name_ko 보유 행만 (셀렉트 검색·한/영 표시)
    name_ko_by_name = (await load_dept_index(session)).name_ko_by_name
    dept_infos = {
        name: DeptInfoValueOut(korean_name=name_ko_by_name[name])
        for name in departments
        if name in name_ko_by_name
    }
    return EligibleAssigneesOut(users=users, departments=departments, dept_infos=dept_infos)


@router.patch(
    "/versions/{version_id}",
    response_model=VersionOut,
    dependencies=[Depends(require_version_map_role("editor"))],
)
async def rename_version(
    version_id: int,
    payload: VersionUpdate,
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    version.label = payload.label
    await session.commit()
    await session.refresh(version)
    return version


@router.post(
    "/versions/{version_id}/checkout",
    response_model=CheckoutOut,
    dependencies=[Depends(require_version_map_role("editor"))],
)
async def acquire_checkout(
    version_id: int,
    payload: CheckoutIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CheckoutOut:
    """체크아웃 획득/연장. 같은 사용자의 재호출은 TTL 연장(heartbeat).

    다른 사용자가 유효한 잠금을 쥐고 있으면 force=False일 때 현재 상태를 그대로
    반환(mine=False) — 클라이언트는 읽기 전용으로 전환한다.
    """
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"version is {version.status} — not editable"
        )
    if await _find_own_pending_downgrade(session, version.map_id, user) is not None:
        raise HTTPException(
            status_code=409,
            detail="your permission change is pending approval — cannot take checkout",
        )

    now = now_kst()
    if is_locked_by_other(version, user, now):
        if not payload.force:
            return CheckoutOut(
                checked_out_by=version.checked_out_by,
                checked_out_at=version.checked_out_at,
                mine=False,
            )
        # 강제 점유(강탈)는 시스템 관리자만 — 에디터/오너는 활성 잠금을 가져올 수 없다.
        if not is_sysadmin(user):
            raise HTTPException(
                status_code=403,
                detail="only system admin can take over an active checkout",
            )

    version.checked_out_by = user
    version.checked_out_at = now
    await session.commit()
    return CheckoutOut(checked_out_by=user, checked_out_at=now, mine=True)


@router.delete("/versions/{version_id}/checkout", status_code=204)
async def release_checkout(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """잠금 해제 — 소유자 본인만. 타인 잠금 인수는 checkout force로 수행."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.checked_out_by == user:
        version.checked_out_by = None
        version.checked_out_at = None
        await session.commit()


@router.post("/versions/{version_id}/checkout/transfer", response_model=CheckoutOut)
async def transfer_checkout(
    version_id: int,
    payload: CheckoutTransferIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CheckoutOut:
    """점유권 이전 — 점유자·맵 오너·sysadmin이 editor+ 대상에게 이전 (Task 2).

    403: 호출자가 점유자·오너·sysadmin 아님.
    422: 대상이 해당 맵의 editor+(owner or editor) 아님.
    """
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    # 점유 이전은 draft 전용 — 반려본은 제출자 회수(withdraw)로 draft 복귀 후 이전.
    if version.status != workflow.DRAFT:
        raise HTTPException(
            status_code=409,
            detail="checkout can only be transferred on a draft version",
        )

    actor_role = await get_effective_role(session, user, version.map_id)
    is_holder = version.checked_out_by == user
    is_owner = actor_role == "owner"
    if not (is_holder or is_owner or is_sysadmin(user)):
        raise HTTPException(
            status_code=403,
            detail="only the checkout holder, map owner, or sysadmin can transfer",
        )

    # 이전할 점유가 없으면 409 (draft라도 아직 아무도 체크아웃 안 했을 수 있음)
    if version.checked_out_by is None:
        raise HTTPException(status_code=409, detail="no active checkout to transfer")

    target_role = await get_effective_role(session, payload.to, version.map_id)
    if target_role not in ("editor", "owner"):
        raise HTTPException(
            status_code=422,
            detail="transfer target must be an editor or owner on this map",
        )

    now = now_kst()
    version.checked_out_from = version.checked_out_by  # 출처(누구에게서)
    version.checked_out_by = payload.to
    version.checked_out_at = now
    await session.commit()
    return CheckoutOut(checked_out_by=payload.to, checked_out_at=now, mine=(payload.to == user))


@router.delete("/versions/{version_id}", status_code=204)
async def delete_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status in (workflow.PENDING, workflow.PUBLISHED):
        raise HTTPException(
            status_code=409, detail=f"cannot delete a {version.status} version"
        )

    # 삭제는 점유 보유자(또는 맵 오너·sysadmin)만 — draft 삭제 버튼과 동일 게이트.
    actor_role = await get_effective_role(session, user, version.map_id)
    is_holder = version.checked_out_by == user
    if not (is_holder or actor_role == "owner" or is_sysadmin(user)):
        raise HTTPException(
            status_code=403,
            detail="only the checkout holder, map owner, or sysadmin can delete this version",
        )

    # 다른 사용자가 편집 중인 버전은 삭제 불가 (spec §7 Phase C)
    if is_locked_by_other(version, user, now_kst()):
        raise HTTPException(
            status_code=423,
            detail=f"version checked out by {version.checked_out_by}",
        )

    remaining = await session.scalar(
        select(func.count())
        .select_from(MapVersion)
        .where(MapVersion.map_id == version.map_id)
    )
    if remaining is not None and remaining <= 1:
        raise HTTPException(
            status_code=409, detail="cannot delete the last version of a map"
        )

    # 동봉 가시성 요청 스윕 — 버전이 사라지면 결정할 주체가 없어 pending 이 영구 박제된다
    # (dedupe 가드가 이후 단독 요청까지 막음). 버전 withdraw 스윕과 동일하게 unstamped.
    bundled = await _find_bundled_visibility(session, version_id)
    if bundled is not None:
        bundled.status = "withdrawn"

    await session.delete(version)
    await session.commit()


@router.get("/versions/{version_id}/workflow", response_model=WorkflowStateOut)
async def get_workflow_state(
    version_id: int, session: AsyncSession = Depends(get_session)
) -> WorkflowStateOut:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    approvers = await workflow.load_active_approvers(session, version.map_id)
    approvals = list(
        (
            await session.scalars(
                select(VersionApproval.approver).where(
                    VersionApproval.version_id == version_id
                )
            )
        ).all()
    )
    now = now_kst()
    active = is_checkout_active(version, now)
    # 이 버전의 모든 미결 점유 요청(요청자 복수) — 오래된 순
    pending_reqs = list(
        (
            await session.scalars(
                select(CheckoutRequest)
                .where(
                    CheckoutRequest.version_id == version_id,
                    CheckoutRequest.status == "pending",
                )
                .order_by(CheckoutRequest.created_at)
            )
        ).all()
    )
    pending_outs = [
        PendingCheckoutRequestOut(
            id=r.id, requested_by=r.requested_by, created_at=r.created_at
        )
        for r in pending_reqs
    ]
    # 반려 상태를 만든 승인자 — 가장 최근 'rejected' 이벤트의 actor(rejected일 때만)
    rejected_by = None
    if version.status == workflow.REJECTED:
        rejected_by = await session.scalar(
            select(VersionEvent.actor)
            .where(
                VersionEvent.version_id == version_id,
                VersionEvent.event_type == "rejected",
            )
            .order_by(VersionEvent.id.desc())
            .limit(1)
        )
    bundled = await _find_bundled_visibility(session, version_id)
    bundled_visibility = (
        BundledVisibilityOut(
            from_visibility=bundled.payload.get("from_visibility"),
            to_visibility=bundled.payload.get("to_visibility"),
            requested_by=bundled.requested_by,
        )
        if bundled is not None
        else None
    )
    return WorkflowStateOut(
        version_id=version_id,
        version_number=version.version_number,
        status=version.status,
        submitted_by=version.submitted_by,
        reject_reason=version.reject_reason,
        rejected_by=rejected_by,
        approvers=approvers,
        approvals=approvals,
        checkout_holder=version.checked_out_by if active else None,
        checkout_holder_since=version.checked_out_at if active else None,
        checkout_from=version.checked_out_from if active else None,
        pending_checkout_request=pending_outs[-1] if pending_outs else None,
        pending_checkout_requests=pending_outs,
        bundled_visibility=bundled_visibility,
    )


async def _find_bundled_visibility(
    session: AsyncSession, version_id: int
) -> ApprovalRequest | None:
    """이 버전에 동봉된 pending 가시성 요청 — payload.version_id 연계 (governance A)."""
    rows = await session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.kind == "visibility_change",
            ApprovalRequest.status == "pending",
        )
    )
    return next(
        (r for r in rows.all() if r.payload.get("version_id") == version_id), None
    )


async def _find_own_pending_downgrade(
    session: AsyncSession, map_id: int, user: str
) -> ApprovalRequest | None:
    """호출자 본인 grant 에 걸린 pending 다운그레이드 — 워크플로 상호 배제 역방향 (R2).

    permissions 모듈 헬퍼를 함수-로컬 import(순환 회피, _apply_request 선례).
    """
    grant = await session.scalar(
        select(MapPermission).where(
            MapPermission.map_id == map_id,
            MapPermission.principal_type == "user",
            MapPermission.principal_id == user,
        )
    )
    if grant is None:
        return None
    from app.routers.permissions import _find_pending_downgrade

    return await _find_pending_downgrade(session, map_id, grant.id)


@router.post("/versions/{version_id}/submit", response_model=VersionOut)
async def submit_version(
    version_id: int,
    payload: SubmitIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Draft/Rejected → Pending. 체크아웃 보유자만. 승인 tally 리셋 + 승인자 전원 알림.
    선택: 가시성 변경을 버전 결정에 동봉 (approval_requests 생성)."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"cannot submit from status {version.status}"
        )
    now = now_kst()
    if not (is_checkout_active(version, now) and version.checked_out_by == user):
        raise HTTPException(status_code=403, detail="only the checkout holder can submit")
    if await _find_own_pending_downgrade(session, version.map_id, user) is not None:
        raise HTTPException(
            status_code=409,
            detail="your permission change is pending approval — cannot submit",
        )

    approvers = await workflow.load_active_approvers(session, version.map_id)
    if not approvers:
        raise HTTPException(
            status_code=409, detail="map has no approvers — assign approvers first"
        )

    # 동봉 가시성 변경 처리
    bundle_vis = payload.to_visibility if payload is not None else None
    if bundle_vis is not None:
        # 가시성 변경 권한은 오너 전용 — 단독 경로(visibility-request)와 동일 게이트여야
        # 편집자가 제출 동봉으로 우회하지 못한다.
        actor_role = await get_effective_role(session, user, version.map_id)
        if actor_role != "owner":
            raise HTTPException(
                status_code=403, detail="only the owner can bundle a visibility change"
            )
        found_map = await session.get(ProcessMap, version.map_id)
        if found_map is None or bundle_vis == found_map.visibility:
            raise HTTPException(
                status_code=422, detail="visibility unchanged — nothing to bundle"
            )
        # Standalone pending 이 있으면 동봉이 대체 — 요청자에게 supersede 알림 (P0 대칭)
        standalone = next(
            (
                r
                for r in (
                    await session.scalars(
                        select(ApprovalRequest).where(
                            ApprovalRequest.map_id == version.map_id,
                            ApprovalRequest.kind == "visibility_change",
                            ApprovalRequest.status == "pending",
                        )
                    )
                ).all()
                if r.payload.get("version_id") is None  # 동봉 행 제외 — 단독 요청만 대체
            ),
            None,
        )
        if standalone is not None:
            standalone.status = "superseded"
            standalone.decided_by = user
            standalone.decided_at = _now()
            await workflow.create_notifications(
                session,
                [standalone.requested_by],
                type="permission_superseded",
                map_id=version.map_id,
                message=f"Your visibility change request on '{found_map.name}' was superseded — it is now bundled with a version submission",
            )
        session.add(
            ApprovalRequest(
                map_id=version.map_id,
                kind="visibility_change",
                payload={
                    "from_visibility": found_map.visibility,
                    "to_visibility": bundle_vis,
                    "version_id": version_id,
                },
                requested_by=user,
                status="pending",
            )
        )

    await session.execute(
        delete(VersionApproval).where(VersionApproval.version_id == version_id)
    )
    version.status = workflow.PENDING
    version.submitted_by = user
    version.reject_reason = None
    version.checked_out_by = None
    version.checked_out_at = None
    requester_name = await workflow.get_display_name(session, user)
    await workflow.create_notifications(
        session,
        approvers,
        type="review_requested",
        map_id=version.map_id,
        version_id=version_id,
        message=f"{requester_name} requested approval for '{version.label}'",
    )
    record_version_event(
        session, version_id, "submitted", user,
        note=payload.comment if payload is not None else None,
    )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/approve", response_model=VersionOut)
async def approve_version(
    version_id: int,
    payload: CommentIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """지정 승인자의 승인 1건 기록. 전원 승인되면 Pending → Approved 자동 전이."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.PENDING:
        raise HTTPException(
            status_code=409, detail=f"cannot approve from status {version.status}"
        )
    approvers = await workflow.load_active_approvers(session, version.map_id)
    if user not in approvers:
        raise HTTPException(
            status_code=403, detail="only a designated approver can approve"
        )

    existing = await session.scalar(
        select(VersionApproval).where(
            VersionApproval.version_id == version_id,
            VersionApproval.approver == user,
        )
    )
    # 동일 승인자의 재승인은 no-op — 이번 요청의 코멘트는 의도적으로 버려진다.
    # UI는 !hasApproved로 재승인 버튼을 가리므로 이 경로는 API 직접 호출로만 도달.
    if existing is None:
        session.add(VersionApproval(version_id=version_id, approver=user))
        await session.flush()
        record_version_event(
            session, version_id, "approved", user,
            note=payload.comment if payload is not None else None,
        )

    approved_count = await session.scalar(
        select(func.count())
        .select_from(VersionApproval)
        .where(VersionApproval.version_id == version_id)
    )
    # 승인자 목록은 현재 시점 기준 — 제출 후 승인자가 추가되면 재승인이 필요해 Approved로 안 넘어감
    if approved_count is not None and approved_count >= len(approvers):
        version.status = workflow.APPROVED
        if version.submitted_by:
            await workflow.create_notifications(
                session,
                [version.submitted_by],
                type="approved",
                map_id=version.map_id,
                version_id=version_id,
                message=f"'{version.label}' is fully approved — ready to publish",
            )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/reject", response_model=VersionOut)
async def reject_version(
    version_id: int,
    payload: RejectIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """지정 승인자 1인의 반려 — 사유 필수. Pending → Rejected, submitter 알림."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.PENDING:
        raise HTTPException(
            status_code=409, detail=f"cannot reject from status {version.status}"
        )
    approvers = await workflow.load_active_approvers(session, version.map_id)
    if user not in approvers:
        raise HTTPException(
            status_code=403, detail="only a designated approver can reject"
        )

    version.status = workflow.REJECTED
    version.reject_reason = payload.reason
    # 승인했던 사람이 거절하면 그 사람의 승인은 철회 — 승인자 목록에 'Approved'로 남지 않게.
    await session.execute(
        delete(VersionApproval).where(
            VersionApproval.version_id == version_id,
            VersionApproval.approver == user,
        )
    )
    if version.submitted_by:
        await workflow.create_notifications(
            session,
            [version.submitted_by],
            type="rejected",
            map_id=version.map_id,
            version_id=version_id,
            message=f"'{version.label}' was rejected: {payload.reason}",
        )

    # 동봉 가시성 변경 거절
    bundled = await _find_bundled_visibility(session, version_id)
    if bundled is not None:
        bundled.status = "rejected"
        bundled.decided_by = user
        bundled.decided_at = _now()
        await workflow.create_notifications(
            session,
            [bundled.requested_by],
            type="permission_rejected",
            map_id=version.map_id,
            message=f"Your bundled visibility change on '{version.label}' was rejected with the version",
        )

    record_version_event(session, version_id, "rejected", user, note=payload.reason)
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/publish", response_model=VersionOut)
async def publish_version(
    version_id: int,
    payload: CommentIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Approved → Published. submitter만. 같은 맵의 기존 Published는 Expired(terminal)로 전환."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.APPROVED:
        raise HTTPException(
            status_code=409, detail=f"cannot publish from status {version.status}"
        )
    if version.submitted_by != user:
        raise HTTPException(status_code=403, detail="only the submitter can publish")

    # 채번 — 이 맵의 기존 version_number 최댓값 + 1 (없으면 1부터)
    max_num = await session.scalar(
        select(func.max(MapVersion.version_number)).where(
            MapVersion.map_id == version.map_id
        )
    )
    version.version_number = (max_num or 0) + 1

    # 기존 published 버전 → expired (terminal; 승인 흐름으로 복귀 불가)
    approvers = await workflow.load_active_approvers(session, version.map_id)
    prior_published = await session.scalars(
        select(MapVersion).where(
            MapVersion.map_id == version.map_id,
            MapVersion.status == workflow.PUBLISHED,
        )
    )
    for prior in prior_published:
        prior.status = workflow.EXPIRED
        record_version_event(session, prior.id, "expired", user)

    # 동봉 가시성 변경 적용 — 단독 승인과 동일 적용기 재사용(viewer 스윕·삭제맵 멱등 포함).
    bundled = await _find_bundled_visibility(session, version_id)
    if bundled is not None:
        # 함수-로컬 import: permissions 모듈이 versions 를 import 하지 않는지 먼저 확인 —
        # 순환이 없으면 모듈 상단 import 로 승격해도 된다(주석 유지).
        from app.routers.permissions import _apply_request

        await _apply_request(session, bundled)
        bundled.status = "applied"
        bundled.decided_by = user
        bundled.decided_at = _now()
        await workflow.create_notifications(
            session,
            [bundled.requested_by],
            type="permission_approved",
            map_id=version.map_id,
            message=f"Your bundled visibility change on '{version.label}' was applied with the publish",
        )

    version.status = workflow.PUBLISHED
    await workflow.create_notifications(
        session,
        approvers,
        type="published",
        map_id=version.map_id,
        version_id=version_id,
        message=f"'{version.label}' was published",
    )
    record_version_event(
        session, version_id, "published", user,
        note=payload.comment if payload is not None else None,
    )
    await session.commit()
    # 게시본 지식기반 인덱싱 — fire-and-forget(임베딩 지연이 게시 응답을 막지 않게) (design 2026-07-23 §7)
    if embed_client.is_embed_enabled():
        indexing.spawn(indexing.index_map_version(version_id))
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/republish", response_model=VersionOut, status_code=201)
async def republish_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Published/Expired → 그래프 복제 새 Draft + 생성자 점유. (만료본 재게시, Task 4)

    published·expired만 허용; draft·pending·approved·rejected는 409.
    맵당 draft 1개 규약 — 기존 draft 있으면 409.
    호출자는 해당 맵의 editor+ 이어야 함 — 미달 시 403.
    """
    source = await session.get(
        MapVersion,
        version_id,
        options=[
            selectinload(MapVersion.nodes),
            selectinload(MapVersion.edges),
            selectinload(MapVersion.groups),
        ],
    )
    if source is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    role = await get_effective_role(session, user, source.map_id)
    if role not in ("owner", "editor"):
        raise HTTPException(status_code=403, detail="editor or owner required to republish")

    if source.status not in (workflow.PUBLISHED, workflow.EXPIRED):
        raise HTTPException(
            status_code=409,
            detail=f"cannot republish a {source.status} version",
        )

    existing_draft = await session.scalar(
        select(MapVersion)
        .where(
            MapVersion.map_id == source.map_id,
            MapVersion.status == workflow.DRAFT,
        )
        .limit(1)
    )
    if existing_draft is not None:
        raise HTTPException(status_code=409, detail="a draft already exists for this map")

    new_version = MapVersion(
        map_id=source.map_id,
        label=source.label,
        checked_out_by=user,
        checked_out_at=now_kst(),
    )
    session.add(new_version)
    await session.flush()

    await clone_graph(session, source, new_version.id)
    record_version_event(session, new_version.id, "created", user)

    await session.commit()
    await session.refresh(new_version)
    return new_version


@router.post("/versions/{version_id}/withdraw", response_model=VersionOut)
async def withdraw_version(
    version_id: int,
    payload: CommentIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Pending/Approved/Rejected → Draft. pending/approved는 submitter만·rejected는 +오너·sysadmin. 회수자에게 체크아웃 재부여."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status not in (workflow.PENDING, workflow.APPROVED, workflow.REJECTED):
        raise HTTPException(
            status_code=409, detail=f"cannot withdraw from status {version.status}"
        )
    # 회수 권한 — 승인요청 단계(pending/approved)는 제출자만. 반려(rejected)는 제출자 부재 대비
    # 오너·sysadmin도 허용(transfer/decide와 권한 일관).
    is_withdraw_submitter = version.submitted_by == user
    if version.status == workflow.REJECTED:
        actor_role = await get_effective_role(session, user, version.map_id)
        can_withdraw = is_withdraw_submitter or actor_role == "owner" or is_sysadmin(user)
    else:
        can_withdraw = is_withdraw_submitter
    if not can_withdraw:
        raise HTTPException(
            status_code=403,
            detail="only the submitter can withdraw (owner/sysadmin only on a rejected version)",
        )

    # 회수 조건부 트랙킹 — 현재 승인요청 사이클의 승인 수로 판정(submit이 매 제출마다 리셋).
    approval_count = await session.scalar(
        select(func.count())
        .select_from(VersionApproval)
        .where(VersionApproval.version_id == version_id)
    )

    # 반려본 회수는 항상 기록(반려 이력이 의미 있음) — 상태 변경 전에 판정.
    was_rejected = version.status == workflow.REJECTED

    # 동봉 가시성 변경 회수
    bundled = await _find_bundled_visibility(session, version_id)
    if bundled is not None:
        bundled.status = "withdrawn"

    version.status = workflow.DRAFT
    version.checked_out_by = user
    version.checked_out_at = now_kst()

    if was_rejected or (approval_count and approval_count > 0):
        # 반려본 회수 또는 승인 1건 이상 후 회수 → 회수 기록을 남긴다(제출·승인·반려 이력 유지).
        record_version_event(
            session, version_id, "withdrawn", user,
            note=payload.comment if payload is not None else None,
        )
    else:
        # 승인 0건 회수 → 이번 승인요청(submitted) 흔적을 삭제, 회수 기록도 남기지 않는다.
        latest_submitted = await session.scalar(
            select(VersionEvent)
            .where(
                VersionEvent.version_id == version_id,
                VersionEvent.event_type == "submitted",
            )
            .order_by(VersionEvent.id.desc())
            .limit(1)
        )
        if latest_submitted is not None:
            await session.delete(latest_submitted)

    await session.commit()
    await session.refresh(version)
    return version
