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
from app.framework_confirm import perform_framework_confirm
from app.models import ApprovalRequest, MapPermission, MapVersion, ProcessMap, _now
from app.permissions import logic
from app.permissions.access import assert_map_role, get_effective_role, is_direct_l5_admin
from app.permissions.deps import (
    assert_approver_or_sysadmin,
    is_map_approver,
    require_map_role,
)
from app.routers.maps import _assert_unique_name
from app.schemas import (
    ApprovalRequestOut,
    DecisionIn,
    OwnerTransferIn,
    PendingChangeOut,
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
    if found_map is None or found_map.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found_map


async def _assert_not_framework(session: AsyncSession, map_id: int) -> None:
    """framework 캔버스는 확정(framework-confirm) 전용 — 협업자 옆문 차단 (spec 2026-09-02 §6).

    map_permissions 자체가 framework 맵에선 무시(access.get_effective_role)되므로
    써져도 판정이 사일런트 노옵이 되던 것을 명시 422로 바꾼다. versions.py의 동명
    헬퍼와 같은 로컬 패턴 — 순환 import 방지를 위해 여기서 별도 정의한다.
    """
    mode = await session.scalar(select(ProcessMap.mode).where(ProcessMap.id == map_id))
    if mode == "framework":
        raise HTTPException(
            status_code=422, detail="framework maps use the confirm workflow"
        )


async def _assert_owner_or_approver(
    session: AsyncSession, user: str, map_id: int
) -> None:
    """오너(sysadmin 포함 — effective_role 해석) 또는 지정 승인자만 — 결재 대기 목록 게이트 (C)."""
    role = await get_effective_role(session, user, map_id)
    if role == "owner":
        return
    if await is_map_approver(session, user, map_id):
        return
    raise HTTPException(status_code=403, detail="owner, approver, or sysadmin only")


async def _assert_user_not_in_workflow(
    session: AsyncSession, map_id: int, grant: MapPermission
) -> None:
    """대상 유저가 진행 중 버전 워크플로 참여자면 권한 변경 차단 (R2 상호 배제).

    (a) 편집 가능 상태 버전의 체크아웃 보유자 (b) pending/approved 버전의 제출자.
    """
    if grant.principal_type != "user":
        return
    versions = await session.scalars(
        select(MapVersion).where(MapVersion.map_id == map_id)
    )
    blocked = any(
        (v.checked_out_by == grant.principal_id and workflow.is_editable_status(v.status))
        or (
            v.submitted_by == grant.principal_id
            and v.status in (workflow.PENDING, workflow.APPROVED)
        )
        for v in versions.all()
    )
    if blocked:
        raise HTTPException(
            status_code=409,
            detail="collaborator is in an active version workflow — resolve the checkout or approval first",
        )


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
) -> list[PermissionOut]:
    await _get_map_or_404(session, map_id)
    rows = await session.scalars(
        select(MapPermission)
        .where(MapPermission.map_id == map_id)
        .order_by(MapPermission.id)
    )
    # 맵의 pending 다운그레이드를 벌크 1쿼리로 가져와 permission_id 로 인덱스 (맵당 소량)
    pending_rows = await session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "permission_downgrade",
            ApprovalRequest.status == "pending",
        )
    )
    pending_by_permission_id = {r.payload.get("permission_id"): r for r in pending_rows.all()}
    result = []
    for grant in rows.all():
        req = pending_by_permission_id.get(grant.id)
        pending_change = (
            PendingChangeOut(
                to_role=req.payload.get("to_role"),
                requested_by=req.requested_by,
                request_id=req.id,
            )
            if req is not None
            else None
        )
        result.append(
            PermissionOut.model_validate(grant).model_copy(
                update={"pending_change": pending_change}
            )
        )
    return result


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
    await _assert_not_framework(session, map_id)
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
    await _assert_not_framework(session, map_id)
    grant = await _get_grant_or_404(session, map_id, permission_id)
    if grant.role == "owner":
        raise HTTPException(
            status_code=409, detail="owner grant changes go through owner transfer"
        )
    await _assert_user_not_in_workflow(session, map_id, grant)
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
        if await _find_pending_downgrade(session, map_id, permission_id) is not None:
            raise HTTPException(
                status_code=409, detail="a change request for this grant is already pending"
            )
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
    await _supersede_pending_downgrades(session, map_id, permission_id, actor=user)
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
    await _assert_not_framework(session, map_id)
    grant = await _get_grant_or_404(session, map_id, permission_id)
    if grant.role == "owner":
        raise HTTPException(
            status_code=409, detail="owner grant removal goes through owner transfer"
        )
    await _assert_user_not_in_workflow(session, map_id, grant)
    # 오너(=sysadmin 포함)는 editor 제거 승인 없이 즉시 삭제
    actor_role = await get_effective_role(session, user, map_id)
    if logic.requires_downgrade_approval(grant.role, None) and actor_role != "owner":
        if await _find_pending_downgrade(session, map_id, permission_id) is not None:
            raise HTTPException(
                status_code=409, detail="a change request for this grant is already pending"
            )
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
    await _supersede_pending_downgrades(session, map_id, permission_id, actor=user)
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


async def _find_pending_downgrade(
    session: AsyncSession, map_id: int, permission_id: int
) -> ApprovalRequest | None:
    """같은 grant 대상 pending 다운그레이드 요청 — payload 가 JSON 이라 파이썬에서 필터(맵당 소량)."""
    rows = await session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "permission_downgrade",
            ApprovalRequest.status == "pending",
        )
    )
    return next(
        (r for r in rows.all() if r.payload.get("permission_id") == permission_id), None
    )


async def _supersede_pending_downgrades(
    session: AsyncSession, map_id: int, permission_id: int, *, actor: str
) -> None:
    """직접 적용이 pending 다운그레이드를 무효화 — rename supersede 선례(maps._supersede_pending_rename)."""
    req = await _find_pending_downgrade(session, map_id, permission_id)
    if req is None:
        return
    req.status = "superseded"
    req.decided_by = actor
    req.decided_at = _now()
    found_map = await session.get(ProcessMap, map_id)
    map_name = found_map.name if found_map is not None else f"map {map_id}"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type="permission_superseded",
        map_id=map_id,
        message=f"Your permission change request on '{map_name}' was superseded — the owner applied a change directly",
        payload={"map_name": map_name, "reason": "direct"},
    )


# ── B. Owner transfer ─────────────────────────────────────────


@router.post(
    "/maps/{map_id}/transfer-owner",
    dependencies=[Depends(require_map_role("owner"))],
)
async def transfer_owner(
    map_id: int,
    payload: OwnerTransferIn,
    user: str = Depends(get_current_user),
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
    await _supersede_pending_downgrades(session, map_id, new_owner_grant.id, actor=user)
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
    # 무변경 요청 거부 (rename 의 'new name equals current name' 대칭)
    if payload.to_visibility == found_map.visibility:
        raise HTTPException(
            status_code=422, detail="visibility unchanged — nothing to request"
        )
    # 중복 요청 거부 — 같은 맵에 pending visibility_change 가 있으면 안 됨
    pending = await session.scalar(
        select(ApprovalRequest.id).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "visibility_change",
            ApprovalRequest.status == "pending",
        )
    )
    if pending is not None:
        raise HTTPException(
            status_code=409, detail="a visibility change request is already pending"
        )
    # 승인자 0명이면 아무도 decide 못 하는 pending 이 박제 — version submit 과 동일 가드
    approvers = await workflow.load_active_approvers(session, map_id)
    if not approvers:
        raise HTTPException(
            status_code=409, detail="map has no approvers — assign approvers first"
        )
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


@router.get(
    "/maps/{map_id}/visibility-requests/pending",
    response_model=ApprovalRequestOut | None,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_pending_visibility_request(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ApprovalRequest | None:
    """pending 가시성 요청 조회 — Settings 마운트 시 pending 마커 복원용 (없으면 null).

    동봉 행(payload.version_id 有)은 제외 — 버전 결정으로만 처리돼 단독 철회·결정이 불가하다.
    """
    await _get_map_or_404(session, map_id)
    rows = await session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "visibility_change",
            ApprovalRequest.status == "pending",
        )
    )
    return next((r for r in rows.all() if r.payload.get("version_id") is None), None)


# ── D. Approval requests — list + decide ──────────────────────


@router.get(
    "/maps/{map_id}/approval-requests",
    response_model=list[ApprovalRequestOut],
)
async def list_approval_requests(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[ApprovalRequest]:
    """맵의 승인 요청 목록 — 결재 대기 탭(4종 통합). 오너도 rename/sp 결정권자라 열람 허용 (C)."""
    await _get_map_or_404(session, map_id)
    await _assert_owner_or_approver(session, user, map_id)
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
    동봉 가시성 행은 제외 — decide 가 409라 큐에 노출하면 죽은 버튼만 남는다.
    """
    rows = await session.scalars(
        select(ApprovalRequest)
        .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
        .where(
            ApprovalRequest.status == "pending",
            ProcessMap.deleted_at.is_(None),
        )
        .order_by(ApprovalRequest.created_at.desc())
    )
    return [
        r
        for r in rows.all()
        if not (r.kind == "visibility_change" and r.payload.get("version_id") is not None)
    ]


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
    elif req.kind == "fw_confirm":
        # 확정 위임 결정권자는 직속 L5 관리자/sysadmin만 — 승인자·오너 게이트와 다름 (spec §5)
        if not logic.is_sysadmin(user):
            category_id = req.payload.get("category_id")
            if category_id is None or not await is_direct_l5_admin(
                session, user, category_id
            ):
                raise HTTPException(
                    status_code=403, detail="direct L5 admin or sysadmin only"
                )
    else:
        await assert_approver_or_sysadmin(session, user, req.map_id)
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"request already {req.status}")
    if req.kind == "visibility_change" and req.payload.get("version_id") is not None:
        raise HTTPException(
            status_code=409,
            detail="bundled with a version submission — decided by the version approval",
        )

    req.decided_by = user
    req.decided_at = _now()
    if payload.decision == "reject":
        req.status = "rejected"
        req.decision_reason = payload.reason
        await _notify_permission_decision(
            session, req, outcome="rejected", reason=payload.reason
        )
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


@router.delete("/approval-requests/{request_id}", status_code=204)
async def withdraw_approval_request(
    request_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 pending 요청 철회 → withdrawn (행 보존 — 이력). rename/sp 는 맵 스코프 경로 유지."""
    req = await session.get(ApprovalRequest, request_id)
    if req is None:
        raise HTTPException(status_code=404, detail=f"approval request {request_id} not found")
    if req.kind not in ("permission_downgrade", "visibility_change"):
        raise HTTPException(status_code=409, detail="use the kind-specific withdraw endpoint")
    if req.payload.get("version_id") is not None:
        raise HTTPException(
            status_code=409,
            detail="bundled with a version submission — withdraw the version instead",
        )
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"request already {req.status}")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()


async def _apply_request(session: AsyncSession, req: ApprovalRequest) -> None:
    """승인된 요청의 payload 를 실제 데이터에 적용 (downgrade / visibility_change)."""
    if req.kind == "permission_downgrade":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None or found_map.deleted_at is not None:
            return  # 멱등 — 삭제된 맵이면 적용 없이 applied
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
        if found_map is not None and found_map.deleted_at is None:
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
    elif req.kind == "fw_confirm":
        found_map = await session.get(ProcessMap, req.map_id)
        if found_map is None or found_map.deleted_at is not None:
            return  # 멱등 — 삭제된 맵이면 확정 없이 applied
        # 게이트 6종·체크아웃·무변경 위반은 HTTPException으로 그대로 전파 — decide가 커밋
        # 전이라 req.status는 pending 유지(map_rename의 이름 선점 경합과 동일 패턴)
        await perform_framework_confirm(session, found_map, req.decided_by, major=False)


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
        payload={"map_name": map_name, "actor": requested_by,
                 "actor_name": requester_name, "kind": kind},
    )


async def _notify_permission_decision(
    session: AsyncSession, req: ApprovalRequest, *, outcome: str, reason: str | None = None
) -> None:
    """승인/반려 결과 → 요청자에게 벨 알림 (design 2026-07-16). 거절 사유는 말미 ': {reason}' 동봉."""
    suffix = f": {reason}" if reason else ""
    if req.kind == "map_rename":
        from_name = req.payload.get("from_name", "")
        to_name = req.payload.get("to_name", "")
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=f"rename_{outcome}",
            map_id=req.map_id,
            message=f"Your request to rename '{from_name}' to '{to_name}' was {outcome}{suffix}",
            payload={"map_name": from_name, "from_name": from_name, "to_name": to_name,
                     "outcome": outcome, "reason": reason},
        )
        return
    if req.kind == "sp_designation":
        map_name = req.payload.get("map_name", "")
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=f"sp_designation_{outcome}",
            map_id=req.map_id,
            message=(
                f"Your subprocess registration request for '{map_name}' was {outcome}{suffix}"
            ),
            payload={"map_name": map_name, "outcome": outcome, "reason": reason},
        )
        return
    if req.kind == "fw_confirm":
        found_map = await session.get(ProcessMap, req.map_id)
        map_name = found_map.name if found_map is not None else f"map {req.map_id}"
        # 승인=done(스냅샷 확정 완료), 거절=rejected — 고정 알림 타입 2종 (spec §5)
        notif_type = "fw_confirm_done" if outcome == "approved" else "fw_confirm_rejected"
        result_word = "confirmed" if outcome == "approved" else "rejected"
        actor_name = (
            await workflow.get_display_name(session, req.decided_by) if req.decided_by else ""
        )
        await workflow.create_notifications(
            session,
            [req.requested_by],
            type=notif_type,
            map_id=req.map_id,
            message=f"Your confirm request for '{map_name}' was {result_word}{suffix}",
            payload={"map_name": map_name, "actor": req.decided_by, "actor_name": actor_name,
                     "outcome": outcome, "reason": reason},
        )
        return
    found_map = await session.get(ProcessMap, req.map_id)
    map_name = found_map.name if found_map is not None else f"map {req.map_id}"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type=f"permission_{outcome}",
        map_id=req.map_id,
        message=f"Your request on '{map_name}' was {outcome}{suffix}",
        payload={"map_name": map_name, "outcome": outcome, "reason": reason,
                 "kind": req.kind},
    )


def _serialize_request(req: ApprovalRequest) -> dict:
    return ApprovalRequestOut.model_validate(req).model_dump(mode="json")
