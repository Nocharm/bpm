"""L6 슬롯 변경 엔드포인트 — dry_run 미리보기 · 관리자 즉시 적용 · (트랙 C) 승인 요청 생성.

경로는 maps 라우터와 같은 prefix(/api/maps/{map_id}/slot-changes)지만 파일을 분리해 maps.py 비대화를 막는다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.framework_slots import SlotChange, apply_slot_change, build_preview, validate_slot_change
from app.permissions.access import assert_map_role
from app.permissions.deps import require_map_role
from app.schemas import SlotChangeIn, SlotChangeOut

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
    그 외는 승인 요청(트랙 C) — 이 트랙에선 409.
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
    if not plan.self_apply:
        raise HTTPException(status_code=409, detail="slot changes require L5 admin approval")
    await apply_slot_change(session, plan, user)
    await session.commit()
    return SlotChangeOut(mode="applied", request_id=None, **preview)
