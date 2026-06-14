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
from app.models import (
    Edge,
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
    RejectIn,  # noqa: F401 — used in Task 5 (approve/reject endpoints)
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
    """source 버전의 노드/엣지를 새 ID로 깊은 복사. 계층(parent)·엣지 참조를 재매핑한다."""
    id_map = {node.id: uuid.uuid4().hex for node in source.nodes}

    # 1차: parent=None으로 먼저 삽입 (postgres 자기참조 FK 순서 문제 회피)
    cloned: dict[str, Node] = {}
    for node in source.nodes:
        clone = Node(
            id=id_map[node.id],
            version_id=target_version_id,
            parent_node_id=None,
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
        )
        session.add(clone)
        cloned[node.id] = clone
    await session.flush()

    # 2차: 계층 포인터 채우기
    for node in source.nodes:
        if node.parent_node_id is not None:
            cloned[node.id].parent_node_id = id_map[node.parent_node_id]

    # 3차: 그룹 복제(새 ID) + 노드 멤버십(group_id) 재매핑. parent_node_id는 노드 id_map으로 리맵.
    group_id_map = {group.id: uuid.uuid4().hex for group in source.groups}
    for group in source.groups:
        session.add(
            Group(
                id=group_id_map[group.id],
                version_id=target_version_id,
                parent_node_id=(
                    id_map[group.parent_node_id]
                    if group.parent_node_id is not None
                    else None
                ),
                label=group.label,
                color=group.color,
            )
        )
    for node in source.nodes:
        if node.group_id is not None:
            cloned[node.id].group_id = group_id_map[node.group_id]

    for edge in source.edges:
        session.add(
            Edge(
                id=uuid.uuid4().hex,
                version_id=target_version_id,
                source_node_id=id_map[edge.source_node_id],
                target_node_id=id_map[edge.target_node_id],
                label=edge.label,
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


@router.patch("/versions/{version_id}", response_model=VersionOut)
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
    rows = await session.scalars(
        select(MapApprover.user_id).where(MapApprover.map_id == map_id)
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
