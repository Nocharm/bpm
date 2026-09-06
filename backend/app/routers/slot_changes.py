"""L6 슬롯 변경 엔드포인트 — dry_run 미리보기 · 관리자 즉시 적용 · (트랙 C) 승인 요청 생성.

경로는 maps 라우터와 같은 prefix(/api/maps/{map_id}/slot-changes)지만 파일을 분리해 maps.py 비대화를 막는다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.framework_slots import (
    SlotChange,
    apply_slot_change,
    assert_no_pending_slot_change,
    build_preview,
    build_request_payload,
    category_path,
    notify_slot_requested,
    remaining_sides,
    validate_slot_change,
)
from app.models import ApprovalRequest, ProcessMap
from app.permissions import logic
from app.permissions.access import (
    assert_map_role,
    get_category_admin_logins,
    get_effective_role,
    is_category_admin,
    is_direct_l5_admin,
)
from app.permissions.deps import require_map_role
from app.schemas import ApprovalRequestOut, PendingSlotChangeOut, SlotChangeIn, SlotChangeOut

router = APIRouter(
    prefix="/api/maps", tags=["slot-changes"], dependencies=[Depends(get_current_user)]
)


@router.post(
    "/{map_id}/slot-changes",
    response_model=SlotChangeOut,
    dependencies=[Depends(require_map_role("owner"))],
)
async def create_slot_change(
    map_id: int,
    payload: SlotChangeIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> SlotChangeOut:
    """슬롯 변경 — dry_run이면 미리보기, 호출자가 side 전부의 직속 L5 관리자(또는 sysadmin)면 즉시 적용.
    그 외는 fw_slot 승인 요청 생성(트랙 C).
    """
    change = SlotChange(
        action=payload.action, map_id=map_id, to_category_id=payload.to_category_id,
        to_map_id=payload.to_map_id, note=payload.note or "",
    )
    plan = await validate_slot_change(session, change, user)
    if plan.target is not None:
        # 이양 대상·후계자 맵의 owner도 겸해야 한다 (현행 framework-transfer 가드 유지)
        await assert_map_role(session, user, plan.target.id, "owner")
    preview = await build_preview(session, plan, user)
    if payload.dry_run:
        return SlotChangeOut(mode="preview", request_id=None, **preview)
    # 대기 요청 가드는 self_apply 여부와 무관하게 먼저 걸린다 — 안 그러면 self-apply 자격자가
    # 다른 사람의 대기 요청 위에 바로 적용해버려 그 요청이 조용히 stale이 된다 (리뷰 라운드1 #2a).
    await assert_no_pending_slot_change(session, map_id)
    if not plan.self_apply:
        req = ApprovalRequest(
            map_id=map_id, kind="fw_slot", payload=build_request_payload(plan, change.note, preview, user),
            requested_by=user, status="pending",
        )
        session.add(req)
        await session.flush()
        await notify_slot_requested(session, plan, req, user)
        await session.commit()
        return SlotChangeOut(mode="requested", request_id=req.id, **preview)
    await apply_slot_change(session, plan, user)
    await session.commit()
    return SlotChangeOut(mode="applied", request_id=None, **preview)


async def _load_pending(session: AsyncSession, map_id: int) -> ApprovalRequest | None:
    return await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id, ApprovalRequest.kind == "fw_slot",
            ApprovalRequest.status == "pending",
        )
    )


@router.get("/{map_id}/slot-changes/pending", response_model=PendingSlotChangeOut | None)
async def get_pending_slot_change(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> PendingSlotChangeOut | None:
    """대기 요청 — owner·지정 승인자·side 체인 관리자·sysadmin. 배정 모달 배너·승인 탭 소스.

    접근 게이트는 요청 유무와 무관하게 먼저 평가한다 — req가 없다고 전원에게 200 null을
    돌려주면 비공개 맵의 존재/무요청 상태가 무권한자에게 새어나간다 (fix round 1 #1).
    """
    found = await session.get(ProcessMap, map_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    role = await get_effective_role(session, user, map_id)
    sysadmin = logic.is_sysadmin(user)
    req = await _load_pending(session, map_id)
    if req is None:
        if role is None and not sysadmin:
            raise HTTPException(status_code=403, detail="viewer, side admin or sysadmin only")
        return None
    sides = [int(c) for c in req.payload.get("sides", [])]
    is_side_admin = False
    for cid in sides:
        if await is_category_admin(session, user, cid):
            is_side_admin = True
            break
    if role is None and not is_side_admin and not sysadmin:
        raise HTTPException(status_code=403, detail="viewer, side admin or sysadmin only")
    remaining = await remaining_sides(session, req)
    can_decide = sysadmin
    side_out = []
    for cid in sides:
        direct = await is_direct_l5_admin(session, user, cid)
        if cid in remaining and direct:
            can_decide = True
        side_out.append({
            "category_id": cid, "path": await category_path(session, cid),
            "approvers": await get_category_admin_logins(session, cid, direct_only=True),
            "satisfied_by_caller": direct or sysadmin,
        })
    return PendingSlotChangeOut(
        request=ApprovalRequestOut.model_validate(req), sides=side_out, remaining=remaining,
        can_decide=can_decide,
    )


@router.delete("/{map_id}/slot-changes/pending", status_code=204)
async def withdraw_slot_change(
    map_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> None:
    """본인 pending 요청 철회 → withdrawn(행 보존). 알림 없음 (fw_confirm 철회와 동일)."""
    req = await _load_pending(session, map_id)
    if req is None:
        raise HTTPException(status_code=404, detail="no pending slot change")
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    req.status = "withdrawn"
    await session.commit()
