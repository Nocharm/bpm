"""점유권 요청·결정 API — request/decide 플로우 (Task 3, docs/spec.md §5)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.models import CheckoutRequest, MapPermission, MapVersion, ProcessMap
from app.permissions.access import get_effective_role
from app.permissions.logic import is_sysadmin
from app.schemas import CheckoutDecideIn, CheckoutRequestOut, CheckoutRequestQueueOut

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
    # 점유 요청은 draft 전용 — 반려본은 제출자 회수(withdraw)로 draft 복귀 후 요청/이전.
    # rejected에서 요청·승인 허용하면 점유가 제출자와 어긋난 채로 남아 회수 로직과 충돌.
    if version.status != workflow.DRAFT:
        raise HTTPException(
            status_code=409,
            detail="checkout can only be requested on a draft version",
        )

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

    # 요청자당 미결 요청 1건 — 여러 편집자가 동시에 요청 가능(승인 시 나머지는 자동 거절)
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
            detail="you already have a pending checkout request",
        )

    req = CheckoutRequest(version_id=version_id, requested_by=user, status="pending")
    session.add(req)

    # 벨 알림 — 처리 가능자(현 점유자+오너)에게 요청 발생 통지, 요청자 제외 (design 2026-07-16)
    requester_name = await workflow.get_display_name(session, user)
    owner_ids = (
        await session.scalars(
            select(MapPermission.principal_id).where(
                MapPermission.map_id == version.map_id,
                MapPermission.principal_type == "user",
                MapPermission.role == "owner",
            )
        )
    ).all()
    holder = [version.checked_out_by] if version.checked_out_by else []
    recipients = [r for r in dict.fromkeys(holder + list(owner_ids)) if r != user]
    await workflow.create_notifications(
        session,
        recipients,
        type="checkout_requested",
        map_id=version.map_id,
        version_id=version_id,
        message=f"{requester_name} requested checkout of '{version.label}'",
    )

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

    # 점유 이동은 draft 전용 — draft에서 만든 요청이 submit/reject로 넘어가도 draft 밖에선 결정 불가.
    if version.status != workflow.DRAFT:
        raise HTTPException(
            status_code=409,
            detail="checkout requests can only be decided on a draft version",
        )

    actor_role = await get_effective_role(session, user, version.map_id)
    is_holder = version.checked_out_by == user
    is_owner = actor_role == "owner"
    if not (is_holder or is_owner or is_sysadmin(user)):
        raise HTTPException(
            status_code=403,
            detail="only the checkout holder, map owner, or sysadmin can decide",
        )

    auto_rejected: list[str] = []
    if payload.approve:
        # 벌크 update 전에 캡처 — update 후엔 status가 pending이 아니라 select에 안 잡힘
        auto_rejected = list(
            (
                await session.scalars(
                    select(CheckoutRequest.requested_by).where(
                        CheckoutRequest.version_id == req.version_id,
                        CheckoutRequest.status == "pending",
                        CheckoutRequest.id != req.id,
                    )
                )
            ).all()
        )
        now = now_kst()
        version.checked_out_from = version.checked_out_by  # 출처(누구에게서)
        version.checked_out_by = req.requested_by
        version.checked_out_at = now
        req.status = "approved"
        # 한 명 승인 시 같은 버전의 다른 미결 요청은 자동 거절
        await session.execute(
            update(CheckoutRequest)
            .where(
                CheckoutRequest.version_id == req.version_id,
                CheckoutRequest.status == "pending",
                CheckoutRequest.id != req.id,
            )
            .values(status="rejected")
        )
    else:
        req.status = "rejected"

    # 벨 알림 — 결과를 요청자에게, 자동 거절된 다른 요청자에게도 (design 2026-07-16)
    outcome = "approved" if payload.approve else "rejected"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type=f"checkout_{outcome}",
        map_id=version.map_id,
        version_id=version.id,
        message=f"Your checkout request for '{version.label}' was {outcome}",
    )
    if auto_rejected:
        await workflow.create_notifications(
            session,
            list(dict.fromkeys(auto_rejected)),
            type="checkout_rejected",
            map_id=version.map_id,
            version_id=version.id,
            message=f"Your checkout request for '{version.label}' was rejected",
        )

    await session.commit()
    await session.refresh(req)
    return req


@router.post(
    "/checkout-requests/{request_id}/withdraw", response_model=CheckoutRequestOut
)
async def withdraw_checkout_request(
    request_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CheckoutRequest:
    """요청 철회 — 요청자 본인이 자신의 미결 요청을 거둔다.

    403: 요청자 본인 아님.
    404: 요청 없음.
    409: 이미 결정된 요청.
    """
    req = await session.get(CheckoutRequest, request_id)
    if req is None:
        raise HTTPException(
            status_code=404, detail=f"checkout request {request_id} not found"
        )
    if req.requested_by != user:
        raise HTTPException(status_code=403, detail="only the requester can withdraw")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"request already {req.status}")
    req.status = "withdrawn"
    await session.commit()
    await session.refresh(req)
    return req


@router.get("/checkout-requests/pending", response_model=list[CheckoutRequestQueueOut])
async def list_pending_checkout_requests(
    map_id: int | None = Query(None),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    """내가 결정할 수 있는 미결 점유 요청 목록 — 점유자·오너·sysadmin 대상 승인 큐.

    sysadmin: 전체.
    그 외: 내가 현재 점유자인 버전, 또는 내가 오너인 맵의 버전에 걸린 요청만.
    map_id: 특정 맵의 요청만 필터링 (per-map 설정 패널용, 생략 시 전체).
    """
    base_q = (
        select(CheckoutRequest, MapVersion, ProcessMap)
        .join(MapVersion, CheckoutRequest.version_id == MapVersion.id)
        .join(ProcessMap, MapVersion.map_id == ProcessMap.id)
        .where(CheckoutRequest.status == "pending")
    )

    if map_id is not None:
        base_q = base_q.where(MapVersion.map_id == map_id)

    if not is_sysadmin(user):
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
        base_q = base_q.where(
            or_(
                CheckoutRequest.version_id.in_(holder_version_ids),
                CheckoutRequest.version_id.in_(owner_version_ids),
            )
        )

    rows = await session.execute(base_q.order_by(CheckoutRequest.created_at.desc()))
    return [
        {
            "id": req.id,
            "version_id": req.version_id,
            "requested_by": req.requested_by,
            "status": req.status,
            "created_at": req.created_at,
            "map_id": ver.map_id,
            "map_name": pm.name,
            "version_label": ver.label,
        }
        for req, ver, pm in rows.all()
    ]
