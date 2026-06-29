"""점유권 요청·결정 API — request/decide 플로우 (Task 3, docs/spec.md §5)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.models import CheckoutRequest, MapPermission, MapVersion
from app.permissions.access import get_effective_role
from app.permissions.logic import is_sysadmin
from app.schemas import CheckoutDecideIn, CheckoutRequestOut

router = APIRouter(
    prefix="/api", tags=["checkout"], dependencies=[Depends(get_current_user)]
)


@router.post(
    "/versions/{version_id}/checkout/request",
    response_model=CheckoutRequestOut,
    status_code=201,
)
async def request_checkout(
    version_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CheckoutRequest:
    """점유 요청 — editor+이면서 현 점유자가 아닌 사용자가 점유를 요청한다.

    403: viewer 또는 권한 없음.
    409: 호출자가 이미 점유자이거나, 미결 요청이 이미 존재.
    """
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    role = await get_effective_role(session, user, version.map_id)
    if role not in ("editor", "owner"):
        raise HTTPException(
            status_code=403,
            detail="only an editor or owner can request checkout",
        )

    # 점유자가 본인에게 요청하는 건 무의미
    if version.checked_out_by == user:
        raise HTTPException(
            status_code=409,
            detail="you already hold the checkout",
        )

    # 미결 중복 요청 차단
    existing = await session.scalar(
        select(CheckoutRequest).where(
            CheckoutRequest.version_id == version_id,
            CheckoutRequest.requested_by == user,
            CheckoutRequest.status == "pending",
        )
    )
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="a pending checkout request already exists",
        )

    req = CheckoutRequest(version_id=version_id, requested_by=user, status="pending")
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return req


@router.post("/checkout-requests/{request_id}/decide", response_model=CheckoutRequestOut)
async def decide_checkout_request(
    request_id: int,
    payload: CheckoutDecideIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CheckoutRequest:
    """점유 요청 결정 — approve면 점유 이전, reject면 점유 유지.

    403: 호출자가 점유자·맵 오너·sysadmin 아님.
    404: 요청 없음.
    409: 이미 결정된 요청.
    """
    req = await session.get(CheckoutRequest, request_id)
    if req is None:
        raise HTTPException(
            status_code=404, detail=f"checkout request {request_id} not found"
        )
    if req.status != "pending":
        raise HTTPException(
            status_code=409, detail=f"request already {req.status}"
        )

    version = await session.get(MapVersion, req.version_id)
    if version is None:
        raise HTTPException(
            status_code=404, detail=f"version {req.version_id} not found"
        )

    actor_role = await get_effective_role(session, user, version.map_id)
    is_holder = version.checked_out_by == user
    is_owner = actor_role == "owner"
    if not (is_holder or is_owner or is_sysadmin(user)):
        raise HTTPException(
            status_code=403,
            detail="only the checkout holder, map owner, or sysadmin can decide",
        )

    if payload.approve:
        now = now_kst()
        version.checked_out_by = req.requested_by
        version.checked_out_at = now
        req.status = "approved"
    else:
        req.status = "rejected"

    await session.commit()
    await session.refresh(req)
    return req


@router.get("/checkout-requests/pending", response_model=list[CheckoutRequestOut])
async def list_pending_checkout_requests(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[CheckoutRequest]:
    """내가 결정할 수 있는 미결 점유 요청 목록 — 점유자·오너·sysadmin 대상 승인 큐.

    sysadmin: 전체.
    그 외: 내가 현재 점유자인 버전, 또는 내가 오너인 맵의 버전에 걸린 요청만.
    """
    if is_sysadmin(user):
        rows = await session.scalars(
            select(CheckoutRequest)
            .where(CheckoutRequest.status == "pending")
            .order_by(CheckoutRequest.created_at.desc())
        )
        return list(rows.all())

    # 내가 현재 점유자인 버전 ID 서브쿼리
    holder_version_ids = select(MapVersion.id).where(MapVersion.checked_out_by == user)
    # 내가 오너인 맵 ID 서브쿼리
    owner_map_ids = select(MapPermission.map_id).where(
        MapPermission.principal_type == "user",
        MapPermission.principal_id == user,
        MapPermission.role == "owner",
    )
    # 오너 맵에 속한 버전 ID 서브쿼리
    owner_version_ids = select(MapVersion.id).where(
        MapVersion.map_id.in_(owner_map_ids)
    )

    rows = await session.scalars(
        select(CheckoutRequest)
        .where(
            CheckoutRequest.status == "pending",
            or_(
                CheckoutRequest.version_id.in_(holder_version_ids),
                CheckoutRequest.version_id.in_(owner_version_ids),
            ),
        )
        .order_by(CheckoutRequest.created_at.desc())
    )
    return list(rows.all())
