"""알림·승인 인박스 API — 내가 결정해야 할 승인 대기 통합 큐 (S7).

세 출처를 합친다: 버전 게시 승인(내가 지정 승인자) · 점유권 이전 요청(점유자/오너) ·
권한/가시성 변경 승인(맵 승인자). act(승인/반려)는 각 출처의 기존 엔드포인트를 재사용한다.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user
from app.db import get_session
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessMap,
    VersionApproval,
)
from app.permissions.logic import is_sysadmin
from app.schemas import InboxApprovalOut

router = APIRouter(prefix="/api", tags=["inbox"], dependencies=[Depends(get_current_user)])


@router.get("/inbox/approvals", response_model=list[InboxApprovalOut])
async def list_inbox_approvals(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """내가 결정할 수 있는 승인 대기 통합 큐 — 최신순."""
    items: list[dict] = []
    sysadmin = is_sysadmin(user)

    # 1) 버전 게시 승인 — 내가 지정 승인자이고 pending, 아직 내가 승인하지 않은 버전
    already = select(VersionApproval.version_id).where(VersionApproval.approver == user)
    ver_q = (
        select(MapVersion, ProcessMap)
        .join(MapApprover, MapApprover.map_id == MapVersion.map_id)
        .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
        .where(
            MapApprover.user_id == user,
            MapVersion.status == workflow.PENDING,
            MapVersion.id.notin_(already),
        )
    )
    for ver, pm in (await session.execute(ver_q)).all():
        items.append(
            {
                "kind": "version_approval",
                "id": ver.id,  # approve/reject 엔드포인트가 받는 version_id
                "title": ver.label,
                "map_id": pm.id,
                "map_name": pm.name,
                "requester": ver.submitted_by or "",
                "status": ver.status,
                "created_at": ver.updated_at,
                "version_id": ver.id,
                "detail": None,
            }
        )

    # 2) 점유권 이전 요청 — 내가 현 점유자·오너, 또는 sysadmin (checkout 큐와 동일 게이트)
    co_q = (
        select(CheckoutRequest, MapVersion, ProcessMap)
        .join(MapVersion, CheckoutRequest.version_id == MapVersion.id)
        .join(ProcessMap, MapVersion.map_id == ProcessMap.id)
        .where(CheckoutRequest.status == "pending")
    )
    if not sysadmin:
        holder_version_ids = select(MapVersion.id).where(MapVersion.checked_out_by == user)
        owner_map_ids = select(MapPermission.map_id).where(
            MapPermission.principal_type == "user",
            MapPermission.principal_id == user,
            MapPermission.role == "owner",
        )
        owner_version_ids = select(MapVersion.id).where(MapVersion.map_id.in_(owner_map_ids))
        co_q = co_q.where(
            or_(
                CheckoutRequest.version_id.in_(holder_version_ids),
                CheckoutRequest.version_id.in_(owner_version_ids),
            )
        )
    for req, ver, pm in (await session.execute(co_q)).all():
        items.append(
            {
                "kind": "checkout_transfer",
                "id": req.id,  # decide 엔드포인트가 받는 request id
                "title": ver.label,
                "map_id": pm.id,
                "map_name": pm.name,
                "requester": req.requested_by,
                "status": req.status,
                "created_at": req.created_at,
                "version_id": req.version_id,
                "detail": None,
            }
        )

    # 3) 권한/가시성 변경 승인 요청 — 내가 지정 승인자인 맵, 또는 sysadmin
    ar_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(ApprovalRequest.status == "pending")
    )
    if not sysadmin:
        my_maps = select(MapApprover.map_id).where(MapApprover.user_id == user)
        ar_q = ar_q.where(ApprovalRequest.map_id.in_(my_maps))
    for req, pm in (await session.execute(ar_q)).all():
        items.append(
            {
                "kind": "approval_request",
                "id": req.id,  # decide 엔드포인트가 받는 request id
                "title": req.kind,
                "map_id": pm.id,
                "map_name": pm.name,
                "requester": req.requested_by,
                "status": req.status,
                "created_at": req.created_at,
                "version_id": None,
                "detail": req.payload,
            }
        )

    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items
