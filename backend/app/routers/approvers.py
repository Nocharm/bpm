"""맵별 지정 승인자 관리 — 조회는 맵 viewer 이상, 변경은 현재 오너·sysadmin만 (design 2026-06-14)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import MapApprover, ProcessMap
from app.permissions import governance
from app.permissions.access import get_effective_role
from app.permissions.deps import require_map_role
from app.schemas import ApproversUpdate

router = APIRouter(
    prefix="/api/maps", tags=["approvers"], dependencies=[Depends(get_current_user)]
)


@router.get(
    "/{map_id}/approvers",
    response_model=list[str],
    # 비공개 맵의 승인자 명단 — 맵 열람권과 같은 viewer 게이트 (리뷰 2026-10-19 C-4)
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_approvers(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    rows = await session.scalars(
        select(MapApprover.user_id)
        .where(MapApprover.map_id == map_id)
        .order_by(MapApprover.user_id)
    )
    return list(rows.all())


@router.put("/{map_id}/approvers", response_model=list[str])
async def set_approvers(
    map_id: int,
    payload: ApproversUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[str]:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if found_map.mode == "framework":
        # created_by 기준 게이트는 캔버스를 만든 카테고리 권한자를 통과시켜 옆문이 된다 —
        # framework 캔버스는 확정(framework-confirm) 전용, 승인자 개념 자체가 없음 (spec 2026-09-02 §6)
        raise HTTPException(
            status_code=422, detail="framework maps use the confirm workflow"
        )
    # 현재 유효 역할 owner만(sysadmin은 effective_role에서 owner). created_by 기준이면 소유자 미상
    # 맵은 누구나 자기를 승인자로 넣어 열람권을 얻고, 오너 이전 뒤엔 원작성자만 바꿀 수 있었다
    # (리뷰 2026-10-19 C-3).
    if await get_effective_role(session, user, map_id) != "owner":
        raise HTTPException(
            status_code=403, detail="only the map owner or sysadmin can set approvers"
        )

    # 승인 진행 중(pending/approved 버전 존재)엔 승인자 변경 금지 — 진행 중 변경은 승인 tally를
    # 깨뜨려 오류를 유발. 승인자 편집은 워크플로 시작 전(draft/rejected 등)에만 허용.
    if await governance.has_version_in_approval(session, map_id):
        raise HTTPException(
            status_code=409,
            detail="cannot change approvers while a version is under approval",
        )

    await session.execute(delete(MapApprover).where(MapApprover.map_id == map_id))
    unique_ids = sorted({uid for uid in payload.user_ids if uid})
    for uid in unique_ids:
        # assigned_by — 감사 추적용(§9-3). 게이트 모델 재정비는 Task 4 이후로 보류
        session.add(MapApprover(map_id=map_id, user_id=uid, assigned_by=user))
    await session.commit()
    return unique_ids
