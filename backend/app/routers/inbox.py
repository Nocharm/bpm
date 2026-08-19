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
                "version_label": ver.label,
                "version_number": ver.version_number,
                "updated_at": ver.updated_at,
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
                "version_label": ver.label,
                "version_number": ver.version_number,
                "updated_at": ver.updated_at,
                "holder": ver.checked_out_by,  # 현재 점유자(요청 승인 시 requester로 이전)
            }
        )

    # 3) 권한/가시성 변경 승인 요청 — 내가 지정 승인자인 맵, 또는 sysadmin
    ar_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            # map_rename·sp_designation은 오너 게이트 — 4·5번 블록에서 처리
            ApprovalRequest.kind.not_in(["map_rename", "sp_designation"]),
            ProcessMap.deleted_at.is_(None),
        )
    )
    if not sysadmin:
        my_maps = select(MapApprover.map_id).where(MapApprover.user_id == user)
        ar_q = ar_q.where(ApprovalRequest.map_id.in_(my_maps))
    for req, pm in (await session.execute(ar_q)).all():
        if req.kind == "visibility_change" and req.payload.get("version_id") is not None:
            continue  # 동봉 행 — 버전 항목(block 1)이 결정 표면 (governance A)
        # 변경 전/후 값 — 가시성은 현재 맵 값, 권한 하향은 대상 MapPermission 현재 역할
        before = after = principal = None
        if req.kind == "visibility_change":
            before = pm.visibility
            after = req.payload.get("to_visibility")
        elif req.kind == "permission_downgrade":
            after = req.payload.get("to_role")
            perm = await session.get(MapPermission, req.payload.get("permission_id"))
            if perm is not None:
                before = perm.role
                principal = perm.principal_id
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
                "updated_at": pm.updated_at,
                "before": before,
                "after": after,
                "principal": principal,
            }
        )

    # 4) 이름 변경 승인 요청 — 내가 오너인 맵, 또는 sysadmin (결정권자 관점)
    rn_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            ApprovalRequest.kind == "map_rename",
            ProcessMap.deleted_at.is_(None),
        )
    )
    if not sysadmin:
        rename_owner_map_ids = select(MapPermission.map_id).where(
            MapPermission.principal_type == "user",
            MapPermission.principal_id == user,
            MapPermission.role == "owner",
        )
        rn_q = rn_q.where(ApprovalRequest.map_id.in_(rename_owner_map_ids))
    for req, pm in (await session.execute(rn_q)).all():
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
                "detail": None,
                "version_label": None,
                "version_number": None,
                "updated_at": None,
                "holder": None,
                "before": pm.name,
                "after": req.payload.get("to_name"),
                "principal": None,
            }
        )

    # 5) SP 등록(지정) 승인 요청 — 내가 오너인 맵, 또는 sysadmin (결정권자 관점, 4번 블록 미러)
    sp_q = (
        select(ApprovalRequest, ProcessMap)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            ApprovalRequest.kind == "sp_designation",
            ProcessMap.deleted_at.is_(None),
        )
    )
    if not sysadmin:
        sp_owner_map_ids = select(MapPermission.map_id).where(
            MapPermission.principal_type == "user",
            MapPermission.principal_id == user,
            MapPermission.role == "owner",
        )
        sp_q = sp_q.where(ApprovalRequest.map_id.in_(sp_owner_map_ids))
    for req, pm in (await session.execute(sp_q)).all():
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
                "detail": req.payload,  # from_map_name — 카드 컨텍스트 표시
                "version_label": None,
                "version_number": None,
                "updated_at": None,
                "holder": None,
                "before": None,
                "after": None,
                "principal": None,
            }
        )

    await _attach_deciders(session, items, user, sysadmin)
    items.sort(key=lambda x: x["created_at"], reverse=True)
    return items


# kind별 결재 주체 — 버전/가시성·권한은 지정 승인자, 이름변경·SP지정은 오너, 점유권은 점유자+오너
_OWNER_GATED_TITLES = {"map_rename", "sp_designation"}


async def _attach_deciders(
    session: AsyncSession, items: list[dict], user: str, sysadmin: bool
) -> None:
    """각 항목에 실제 결재자(deciders)·미결자(pending_on)·열람 근거(via_sysadmin)를 채운다.

    sysadmin은 모든 건을 볼 수 있어 "관리자라서 보이는 것"과 "내가 결재자인 것"이 섞인다 —
    수신자가 구분할 수 있도록 결재 주체를 함께 내려준다 (2026-08-19).
    """
    if not items:
        return
    map_ids = {item["map_id"] for item in items}
    approvers: dict[int, list[str]] = {}
    for map_id, login in await session.execute(
        select(MapApprover.map_id, MapApprover.user_id).where(MapApprover.map_id.in_(map_ids))
    ):
        approvers.setdefault(map_id, []).append(login)
    owners: dict[int, list[str]] = {}
    for map_id, login in await session.execute(
        select(MapPermission.map_id, MapPermission.principal_id).where(
            MapPermission.map_id.in_(map_ids),
            MapPermission.principal_type == "user",
            MapPermission.role == "owner",
        )
    ):
        owners.setdefault(map_id, []).append(login)

    version_ids = {
        item["version_id"]
        for item in items
        if item["kind"] == "version_approval" and item["version_id"] is not None
    }
    approved: dict[int, list[str]] = {}
    if version_ids:
        for version_id, approver in await session.execute(
            select(VersionApproval.version_id, VersionApproval.approver).where(
                VersionApproval.version_id.in_(version_ids)
            )
        ):
            approved.setdefault(version_id, []).append(approver)

    for item in items:
        map_id = item["map_id"]
        if item["kind"] == "version_approval":
            deciders = approvers.get(map_id, [])
            done = approved.get(item["version_id"], [])
            item["approved_by"] = [x for x in deciders if x in done]
            item["pending_on"] = [x for x in deciders if x not in done]
        elif item["kind"] == "checkout_transfer":
            # 점유권은 현 점유자 또는 오너가 넘겨줄 수 있다
            holder = item.get("holder")
            deciders = ([holder] if holder else []) + [
                x for x in owners.get(map_id, []) if x != holder
            ]
            item["pending_on"] = deciders
        else:
            owner_gated = item["title"] in _OWNER_GATED_TITLES
            deciders = owners.get(map_id, []) if owner_gated else approvers.get(map_id, [])
            item["pending_on"] = deciders
        item["deciders"] = deciders
        # 결재자 목록에 없는데 보인다 = sysadmin 포괄 권한으로 열람 중
        item["via_sysadmin"] = sysadmin and user not in deciders
