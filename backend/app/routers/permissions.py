"""권한 관리 API — collaborators CRUD·owner 이전·가시성 변경·승인 요청 (design 2026-06-21 §5).

다운그레이드(editor→viewer/제거)와 가시성 변경은 즉시 적용하지 않고 ApprovalRequest 로
지연한다. 승인자/sysadmin 이 decide 로 approve 할 때 payload 를 적용한다.
group principal 은 저장만 되고 effective_role 은 아직 무시(Layer 4) — 부여는 허용.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import ApprovalRequest, MapPermission, ProcessMap, _now
from app.permissions import logic
from app.permissions.access import assert_map_role, get_effective_role
from app.permissions.deps import (
    assert_approver_or_sysadmin,
    require_approver_or_sysadmin,
    require_map_role,
)
from app.routers.maps import _assert_unique_name
from app.schemas import (
    ApprovalRequestOut,
    DecisionIn,
    OwnerTransferIn,
    PermissionCreate,
    PermissionOut,
    PermissionPatch,
    VisibilityRequestIn,
)

router = APIRouter(
    prefix="/api", tags=["permissions"], dependencies=[Depends(get_current_user)]
)


async def _get_map_or_404(session: AsyncSession, map_id: int) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found_map


# ── A. Collaborators ──────────────────────────────────────────


@router.get(
    "/maps/{map_id}/permissions",
    response_model=list[PermissionOut],
    # viewer+ 가 멤버 목록을 읽을 수 있게 — 홈 카드/설정에서 허용 멤버 표시 (B1).
    # 변경(add/patch/delete)은 그대로 editor/owner 게이트 유지.
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_permissions(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[MapPermission]:
    await _get_map_or_404(session, map_id)
    rows = await session.scalars(
        select(MapPermission)
        .where(MapPermission.map_id == map_id)
        .order_by(MapPermission.id)
    )
    return list(rows.all())


@router.post(
    "/maps/{map_id}/permissions",
    response_model=PermissionOut,
    status_code=201,
    dependencies=[Depends(require_map_role("editor"))],
)
async def add_permission(
    map_id: int,
    payload: PermissionCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapPermission:
    """grant 추가 — 즉시 적용. group 도 저장하나 effective_role 은 무시(Layer 4)."""
    found_map = await _get_map_or_404(session, map_id)
    # 퍼블릭 맵은 전원 열람이라 viewer 부여 불가 — editor만 (request #9)
    if payload.role == "viewer" and found_map.visibility == "public":
        raise HTTPException(
            status_code=409,
            detail="public maps grant editor only — everyone can already view",
        )
    # 오우닝 부서는 이미 파생 editor(잠금) — 동일 부서 행은 혼란만 준다 (spec 2026-07-10)
    if (
        payload.principal_type == "department"
        and payload.principal_id == found_map.owning_department
    ):
        raise HTTPException(
            status_code=409,
            detail="department already owns this map — editor role is derived",
        )
    existing = await session.scalar(
        select(MapPermission).where(
            MapPermission.map_id == map_id,
            MapPermission.principal_type == payload.principal_type,
            MapPermission.principal_id == payload.principal_id,
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409, detail="grant already exists — use PATCH to change role"
        )
    grant = MapPermission(
        map_id=map_id,
        principal_type=payload.principal_type,
        principal_id=payload.principal_id,
        role=payload.role,
        granted_by=user,
    )
    session.add(grant)
    await session.commit()
    await session.refresh(grant)
    return grant


@router.patch(
    "/maps/{map_id}/permissions/{permission_id}",
    dependencies=[Depends(require_map_role("editor"))],
)
async def update_permission(
    map_id: int,
    permission_id: int,
    payload: PermissionPatch,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """role 변경. 다운그레이드(editor→viewer)면 승인 지연, 그 외 즉시 적용.

    owner grant 는 여기서 변경 불가 → owner 이전 경로(§B)로만.
    """
    grant = await _get_grant_or_404(session, map_id, permission_id)
    if grant.role == "owner":
        raise HTTPException(
            status_code=409, detail="owner grant changes go through owner transfer"
        )
    new_role = payload.role
    if new_role == "owner":
        raise HTTPException(
            status_code=409, detail="promote to owner via owner transfer"
        )
    # 퍼블릭 맵은 전원 열람이라 viewer 변경 불가 — editor만 (request #9)
    found_map = await _get_map_or_404(session, map_id)
    if new_role == "viewer" and found_map.visibility == "public":
        raise HTTPException(
            status_code=409,
            detail="public maps grant editor only — everyone can already view",
        )
    # 오너(=sysadmin 포함, effective_role 단계에서 owner로 해석)는 다운그레이드 승인 없이 즉시 적용
    actor_role = await get_effective_role(session, user, map_id)
    if logic.requires_downgrade_approval(grant.role, new_role) and actor_role != "owner":
        req = ApprovalRequest(
            map_id=map_id,
            kind="permission_downgrade",
            payload={
                "permission_id": permission_id,
                "principal_type": grant.principal_type,
                "principal_id": grant.principal_id,
                "from_role": grant.role,
                "to_role": new_role,
            },
            requested_by=user,
            status="pending",
        )
        session.add(req)
        await _notify_permission_request(
            session,
            map_id=map_id,
            map_name=found_map.name,
            requested_by=user,
            kind="permission_downgrade",
        )
        await session.commit()
        await session.refresh(req)
        # 지연 — 아직 적용 안 됨. pending 마커로 응답
        return {"pending": True, "approval_request": _serialize_request(req)}
    grant.role = new_role
    await session.commit()
    await session.refresh(grant)
    return {"pending": False, "permission": PermissionOut.model_validate(grant).model_dump()}


@router.delete(
    "/maps/{map_id}/permissions/{permission_id}",
    dependencies=[Depends(require_map_role("editor"))],
)
async def delete_permission(
    map_id: int,
    permission_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """grant 제거. editor 제거는 승인 지연, viewer 등은 즉시. owner 는 거부(이전 경로)."""
    grant = await _get_grant_or_404(session, map_id, permission_id)
    if grant.role == "owner":
        raise HTTPException(
            status_code=409, detail="owner grant removal goes through owner transfer"
        )
    # 오너(=sysadmin 포함)는 editor 제거 승인 없이 즉시 삭제
    actor_role = await get_effective_role(session, user, map_id)
    if logic.requires_downgrade_approval(grant.role, None) and actor_role != "owner":
        found_map = await _get_map_or_404(session, map_id)
        req = ApprovalRequest(
            map_id=map_id,
            kind="permission_downgrade",
            payload={
                "permission_id": permission_id,
                "principal_type": grant.principal_type,
                "principal_id": grant.principal_id,
                "from_role": grant.role,
                "to_role": None,
            },
            requested_by=user,
            status="pending",
        )
        session.add(req)
        await _notify_permission_request(
            session,
            map_id=map_id,
            map_name=found_map.name,
            requested_by=user,
            kind="permission_downgrade",
        )
        await session.commit()
        await session.refresh(req)
        return {"pending": True, "approval_request": _serialize_request(req)}
    await session.delete(grant)
    await session.commit()
    return {"pending": False, "deleted": True}


async def _get_grant_or_404(
    session: AsyncSession, map_id: int, permission_id: int
) -> MapPermission:
    grant = await session.get(MapPermission, permission_id)
    if grant is None or grant.map_id != map_id:
        raise HTTPException(status_code=404, detail=f"permission {permission_id} not found")
    return grant


# ── B. Owner transfer ─────────────────────────────────────────


@router.post(
    "/maps/{map_id}/transfer-owner",
    dependencies=[Depends(require_map_role("owner"))],
)
async def transfer_owner(
    map_id: int,
    payload: OwnerTransferIn,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """소유권 이전 — 즉시. 기존 owner grant → editor, new_owner grant → owner, owner_id 갱신.

    new_owner 는 현재 editor+ 보유자여야 한다. 결과적으로 owner grant 는 정확히 1개 남는다.
    """
    found_map = await _get_map_or_404(session, map_id)
    new_owner = payload.new_owner

    grants = list(
        (
            await session.scalars(
                select(MapPermission).where(MapPermission.map_id == map_id)
            )
        ).all()
    )
    # new_owner 의 기존 user grant 찾기 — editor+ 여야 이전 가능
    new_owner_grant = next(
        (g for g in grants if g.principal_type == "user" and g.principal_id == new_owner),
        None,
    )
    if new_owner_grant is None or logic.role_rank(new_owner_grant.role) < logic.role_rank("editor"):
        raise HTTPException(
            status_code=409, detail="new_owner must already hold editor or higher"
        )

    # 기존 owner grant 전부 editor 로 강등 (정상 상태에선 1개, 방어적으로 전부 처리)
    for g in grants:
        if g.role == "owner":
            g.role = "editor"
    new_owner_grant.role = "owner"
    found_map.owner_id = new_owner
    await session.commit()
    return {
        "owner_id": new_owner,
        "transferred": True,
    }


# ── C. Visibility request ─────────────────────────────────────


@router.post(
    "/maps/{map_id}/visibility-request",
    response_model=ApprovalRequestOut,
    status_code=201,
    dependencies=[Depends(require_map_role("owner"))],
)
async def request_visibility_change(
    map_id: int,
    payload: VisibilityRequestIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalRequest:
    """가시성 변경 요청 — 즉시 적용하지 않고 승인 지연(§5). before→after 표기용으로 현재값도 저장."""
    found_map = await _get_map_or_404(session, map_id)
    req = ApprovalRequest(
        map_id=map_id,
        kind="visibility_change",
        payload={
            "from_visibility": found_map.visibility,
            "to_visibility": payload.to_visibility,
        },
        requested_by=user,
        status="pending",
    )
    session.add(req)
    await _notify_permission_request(
        session,
        map_id=map_id,
        map_name=found_map.name,
        requested_by=user,
        kind="visibility_change",
    )
    await session.commit()
    await session.refresh(req)
    return req


# ── D. Approval requests — list + decide ──────────────────────


@router.get(
    "/maps/{map_id}/approval-requests",
    response_model=list[ApprovalRequestOut],
    dependencies=[Depends(require_approver_or_sysadmin())],
)
async def list_approval_requests(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[ApprovalRequest]:
    await _get_map_or_404(session, map_id)
    rows = await session.scalars(
        select(ApprovalRequest)
        .where(ApprovalRequest.map_id == map_id)
        .order_by(ApprovalRequest.created_at.desc())
    )
    return list(rows.all())


@router.get(
    "/approval-requests",
    response_model=list[ApprovalRequestOut],
    dependencies=[Depends(require_sysadmin)],
)
async def list_pending_approval_requests(
    session: AsyncSession = Depends(get_session),
) -> list[ApprovalRequest]:
    """교차맵 대기 승인 요청 — sysadmin 전역 큐(권한 하향·가시성 변경). pending 만, 최신순.

    맵별 목록(/maps/{id}/approval-requests)과 달리 모든 맵을 가로질러 sysadmin 콘솔 승인 큐를 채운다.
    """
    rows = await session.scalars(
        select(ApprovalRequest)
        .where(ApprovalRequest.status == "pending")
        .order_by(ApprovalRequest.created_at.desc())
    )
    return list(rows.all())


@router.post("/approval-requests/{request_id}/decide", response_model=ApprovalRequestOut)
async def decide_approval_request(
    request_id: int,
    payload: DecisionIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ApprovalRequest:
    """승인 요청 결정 — approve 면 payload 적용 후 applied, reject 면 변경 없이 rejected.

    게이트: 해당 요청 맵의 승인자 또는 sysadmin (경로가 request_id 라 런타임 판정).
    """
    req = await session.get(ApprovalRequest, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail=f"approval request {request_id} not found")
    if req.kind in ("map_rename", "sp_designation"):
        # rename·SP 등록 결정권자는 오너/sysadmin — 승인자 게이트와 다름 (spec 2026-07-18/19)
        await assert_map_role(session, user, req.map_id, "owner")
    else:
        await assert_approver_or_sysadmin(session, user, req.map_id)
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"request already {req.status}")

    req.decided_by = user
    req.decided_at = _now()
    if payload.decision == "reject":
        req.status = "rejected"
        await _notify_permission_decision(session, req, outcome="rejected")
        await session.commit()
        await session.refresh(req)
        return req

    # approve → payload 적용
    await _apply_request(session, req)
    req.status = "applied"
    await _notify_permission_decision(session, req, outcome="approved")
    await session.commit()
    await session.refresh(req)
    return req


async def _apply_request(session: AsyncSession, req: ApprovalRequest) -> None:
    """승인된 요청의 payload 를 실제 데이터에 적용 (downgrade / visibility_change)."""
    if req.kind == "permission_downgrade":
        permission_id = req.payload.get("permission_id")
        to_role = req.payload.get("to_role")
        grant = await session.get(MapPermission, permission_id)
        if grant is None or grant.map_id != req.map_id:
            return  # 멱등 — grant 가 이미 사라졌으면 그대로 applied
        if to_role is None:
            await session.delete(grant)
        else:
            grant.role = to_role
    elif req.kind == "visibility_change":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is not None:
            to_vis = req.payload.get("to_visibility")
            found_map.visibility = to_vis
            # 퍼블릭 전환 시 잔존 viewer 그랜트 제거 — 전원 열람이라 불필요 (PV)
            if to_vis == "public":
                viewer_grants = (
                    await session.scalars(
                        select(MapPermission).where(
                            MapPermission.map_id == req.map_id,
                            MapPermission.role == "viewer",
                        )
                    )
                ).all()
                for grant in viewer_grants:
                    await session.delete(grant)
    elif req.kind == "map_rename":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None or found_map.deleted_at is not None:
            return  # 멱등 — 삭제된 맵이면 이름 변경 없이 applied
        to_name = req.payload.get("to_name") or ""
        # 요청~승인 사이 이름 선점 경합 — 409로 중단하면 decide가 커밋 전이라 pending 유지
        await _assert_unique_name(session, to_name, exclude_map_id=req.map_id)
        old_name = found_map.name
        found_map.name = to_name
        await workflow.notify_map_renamed(
            session, req.map_id, old_name=old_name, new_name=to_name, actor=req.decided_by
        )
    elif req.kind == "sp_designation":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None or found_map.deleted_at is not None:
            return  # 멱등 — 삭제된 맵이면 적용 없이 applied
        if found_map.sp_designated_at is None:
            # 정상 수락은 지정 모달 저장(PUT)이 pending을 자동 applied 처리 — 이 분기는
            # 지정 없이 approve 를 직접 호출한 경우 방어. 409 중단 → 커밋 전이라 pending 유지.
            raise HTTPException(
                status_code=409,
                detail="map is not designated yet — save the designation first",
            )
        # 이미 지정됨(요청~승인 사이 직접 지정 경합) → 적용할 것 없음, applied 마킹만


async def _notify_permission_request(
    session: AsyncSession, *, map_id: int, map_name: str, requested_by: str, kind: str
) -> None:
    """승인 지연 요청 발생 → 활성 승인자에게 벨 알림 (요청자 제외, design 2026-07-16)."""
    requester_name = await workflow.get_display_name(session, requested_by)
    what = "a visibility change" if kind == "visibility_change" else "a permission change"
    recipients = [
        a for a in await workflow.load_active_approvers(session, map_id) if a != requested_by
    ]
    await workflow.create_notifications(
        session,
        recipients,
        type="permission_requested",
        map_id=map_id,
        message=f"{requester_name} requested {what} on '{map_name}'",
    )


async def _notify_permission_decision(
    session: AsyncSession, req: ApprovalRequest, *, outcome: str
) -> None:
    """승인/반려 결과 → 요청자에게 벨 알림 (design 2026-07-16)."""
    if req.kind == "map_rename":
        from_name = req.payload.get("from_name", "")
        to_name = req.payload.get("to_name", "")
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=f"rename_{outcome}",
            map_id=req.map_id,
            message=f"Your request to rename '{from_name}' to '{to_name}' was {outcome}",
        )
        return
    if req.kind == "sp_designation":
        map_name = req.payload.get("map_name", "")
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=f"sp_designation_{outcome}",
            map_id=req.map_id,
            message=f"Your subprocess registration request for '{map_name}' was {outcome}",
        )
        return
    found_map = await session.get(ProcessMap, req.map_id)
    map_name = found_map.name if found_map is not None else f"map {req.map_id}"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type=f"permission_{outcome}",
        map_id=req.map_id,
        message=f"Your request on '{map_name}' was {outcome}",
    )


def _serialize_request(req: ApprovalRequest) -> dict:
    return ApprovalRequestOut.model_validate(req).model_dump(mode="json")
