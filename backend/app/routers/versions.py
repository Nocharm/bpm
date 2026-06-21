"""Version management — create (optionally cloning), rename, delete, checkout (docs/spec.md §3.4, §7)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.auth import get_current_user
from app.checkout import is_checkout_active, is_locked_by_other
from app.db import get_session
from app.permissions.deps import require_version_map_role
from app.models import (
    Edge,
    Employee,
    Group,
    MapApprover,
    MapVersion,
    Node,
    ProcessMap,
    VersionApproval,
)
from app.schemas import (
    CheckoutIn,
    CheckoutOut,
    RejectIn,
    VersionCreate,
    VersionOut,
    VersionUpdate,
    WorkflowStateOut,
)

router = APIRouter(
    prefix="/api", tags=["versions"], dependencies=[Depends(get_current_user)]
)


async def _clone_graph(
    session: AsyncSession, source: MapVersion, target_version_id: int
) -> None:
    """source 버전의 노드/엣지를 새 ID로 깊은 복사. 엣지/그룹 참조를 재매핑한다."""
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
            )
        )


@router.post("/maps/{map_id}/versions", response_model=VersionOut, status_code=201)
async def create_version(
    map_id: int,
    payload: VersionCreate,
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")

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
        await _clone_graph(session, source, new_version.id)

    await session.commit()
    await session.refresh(new_version)
    return new_version


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


@router.post("/versions/{version_id}/checkout", response_model=CheckoutOut)
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

    now = datetime.now(timezone.utc)
    if is_locked_by_other(version, user, now) and not payload.force:
        return CheckoutOut(
            checked_out_by=version.checked_out_by,
            checked_out_at=version.checked_out_at,
            mine=False,
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

    # 다른 사용자가 편집 중인 버전은 삭제 불가 (spec §7 Phase C)
    if is_locked_by_other(version, user, datetime.now(timezone.utc)):
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

    await session.delete(version)
    await session.commit()


async def _load_approvers(session: AsyncSession, map_id: int) -> list[str]:
    """Return ACTIVE approvers for a map (LEFT JOIN employees.active).

    Approvers without an employee row (e.g. set before AD sync) are treated as active —
    consistent with the missing-uac conservative rule. Only approvers with an explicit
    employees.active=False are excluded.
    The submit-gate 'no approvers → 409' now means 'no ACTIVE approvers'.
    """
    rows = await session.scalars(
        select(MapApprover.user_id)
        .outerjoin(Employee, Employee.login_id == MapApprover.user_id)
        .where(
            MapApprover.map_id == map_id,
            # NULL (no employee row) → treated as active; False → excluded
            (Employee.active.is_(None)) | (Employee.active.is_(True)),
        )
        .order_by(MapApprover.user_id)
    )
    return list(rows.all())


@router.get("/versions/{version_id}/workflow", response_model=WorkflowStateOut)
async def get_workflow_state(
    version_id: int, session: AsyncSession = Depends(get_session)
) -> WorkflowStateOut:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    approvers = await _load_approvers(session, version.map_id)
    approvals = list(
        (
            await session.scalars(
                select(VersionApproval.approver).where(
                    VersionApproval.version_id == version_id
                )
            )
        ).all()
    )
    return WorkflowStateOut(
        version_id=version_id,
        status=version.status,
        submitted_by=version.submitted_by,
        reject_reason=version.reject_reason,
        approvers=approvers,
        approvals=approvals,
    )


@router.post("/versions/{version_id}/submit", response_model=VersionOut)
async def submit_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Draft/Rejected → Pending. 체크아웃 보유자만. 승인 tally 리셋 + 승인자 전원 알림."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(
            status_code=409, detail=f"cannot submit from status {version.status}"
        )
    now = datetime.now(timezone.utc)
    if not (is_checkout_active(version, now) and version.checked_out_by == user):
        raise HTTPException(status_code=403, detail="only the checkout holder can submit")

    approvers = await _load_approvers(session, version.map_id)
    if not approvers:
        raise HTTPException(
            status_code=409, detail="map has no approvers — assign approvers first"
        )

    await session.execute(
        delete(VersionApproval).where(VersionApproval.version_id == version_id)
    )
    version.status = workflow.PENDING
    version.submitted_by = user
    version.reject_reason = None
    version.checked_out_by = None
    version.checked_out_at = None
    workflow.create_notifications(
        session,
        approvers,
        type="review_requested",
        map_id=version.map_id,
        version_id=version_id,
        message=f"{user} requested approval for '{version.label}'",
    )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/approve", response_model=VersionOut)
async def approve_version(
    version_id: int,
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
    approvers = await _load_approvers(session, version.map_id)
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
    if existing is None:
        session.add(VersionApproval(version_id=version_id, approver=user))
        await session.flush()

    approved_count = await session.scalar(
        select(func.count())
        .select_from(VersionApproval)
        .where(VersionApproval.version_id == version_id)
    )
    # 승인자 목록은 현재 시점 기준 — 제출 후 승인자가 추가되면 재승인이 필요해 Approved로 안 넘어감
    if approved_count is not None and approved_count >= len(approvers):
        version.status = workflow.APPROVED
        if version.submitted_by:
            workflow.create_notifications(
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
    approvers = await _load_approvers(session, version.map_id)
    if user not in approvers:
        raise HTTPException(
            status_code=403, detail="only a designated approver can reject"
        )

    version.status = workflow.REJECTED
    version.reject_reason = payload.reason
    if version.submitted_by:
        workflow.create_notifications(
            session,
            [version.submitted_by],
            type="rejected",
            map_id=version.map_id,
            version_id=version_id,
            message=f"'{version.label}' was rejected: {payload.reason}",
        )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/publish", response_model=VersionOut)
async def publish_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Approved → Published. submitter만. 같은 맵의 기존 Published는 Approved로 강등."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status != workflow.APPROVED:
        raise HTTPException(
            status_code=409, detail=f"cannot publish from status {version.status}"
        )
    if version.submitted_by != user:
        raise HTTPException(status_code=403, detail="only the submitter can publish")

    approvers = await _load_approvers(session, version.map_id)
    prior_published = await session.scalars(
        select(MapVersion).where(
            MapVersion.map_id == version.map_id,
            MapVersion.status == workflow.PUBLISHED,
        )
    )
    for prior in prior_published:
        prior.status = workflow.APPROVED

    version.status = workflow.PUBLISHED
    workflow.create_notifications(
        session,
        approvers,
        type="published",
        map_id=version.map_id,
        version_id=version_id,
        message=f"'{version.label}' was published",
    )
    await session.commit()
    await session.refresh(version)
    return version


@router.post("/versions/{version_id}/withdraw", response_model=VersionOut)
async def withdraw_version(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
    """Pending/Approved/Rejected → Draft. submitter만. 회수자에게 체크아웃 재부여."""
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    if version.status not in (workflow.PENDING, workflow.APPROVED, workflow.REJECTED):
        raise HTTPException(
            status_code=409, detail=f"cannot withdraw from status {version.status}"
        )
    if version.submitted_by != user:
        raise HTTPException(status_code=403, detail="only the submitter can withdraw")

    version.status = workflow.DRAFT
    version.checked_out_by = user
    version.checked_out_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(version)
    return version
