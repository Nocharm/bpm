"""홈 개인 대시보드 집계 API — 호출자 기준 활동 카운터·점유·요청·최근 이벤트·체계 요약 1회 응답.

각 블록은 기존 목록 API와 같은 집합을 센다(승인 큐=inbox, 접근 맵=list_maps의 load_my_roles,
체계 seed=/me의 get_admin_scope) — 숫자가 화면마다 어긋나지 않도록 계산을 재사용한다.
"""

from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    Employee,
    Feedback,
    LoginRecord,
    MapVersion,
    Notification,
    ProcessCategory,
    ProcessMap,
    VersionEvent,
)
from app.permissions.access import get_admin_scope, load_my_roles
from app.routers.inbox import list_inbox_approvals
from app.schemas import (
    MeDashboardActivityOut,
    MeDashboardCategoryOut,
    MeDashboardCheckoutOut,
    MeDashboardEventOut,
    MeDashboardOut,
    MeDashboardRequestOut,
)

router = APIRouter(prefix="/api/me", tags=["me"], dependencies=[Depends(get_current_user)])

_CHECKOUT_LIMIT = 10
_REQUEST_LIMIT = 10
_EVENT_LIMIT = 20
# 내 드래프트 잡음(created/submitted/withdrawn)은 숨기고, 결과가 확정된 이벤트만 본인 것도 노출
_OWN_EVENTS_KEPT = ("published", "confirmed", "rejected", "approved")
_EDITING_ROLES = ("owner", "editor")


@router.get("/dashboard", response_model=MeDashboardOut)
async def get_me_dashboard(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeDashboardOut:
    checkouts = await _load_checkouts(session, user)
    requests = await _load_requests(session, user)
    activity = MeDashboardActivityOut(
        approvals_pending=len(await list_inbox_approvals(user=user, session=session)),
        requests_pending=len(requests),
        checkouts_held=await session.scalar(
            select(func.count())
            .select_from(MapVersion)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(MapVersion.checked_out_by == user, ProcessMap.deleted_at.is_(None))
        )
        or 0,
        unread_notifications=await session.scalar(
            select(func.count())
            .select_from(Notification)
            .where(Notification.recipient == user, Notification.read.is_(False))
        )
        or 0,
        feedback_mine=await session.scalar(
            select(func.count()).select_from(Feedback).where(Feedback.author == user)
        )
        or 0,
        feedback_mine_open=await session.scalar(
            select(func.count())
            .select_from(Feedback)
            .where(Feedback.author == user, Feedback.status != "done")
        )
        or 0,
        last_login_at=await _load_previous_login(session, user),
    )
    return MeDashboardOut(
        activity=activity,
        checkouts=checkouts[:_CHECKOUT_LIMIT],
        requests=requests[:_REQUEST_LIMIT],
        recent_events=await _load_recent_events(session, user),
        framework=await _load_framework(session, user),
    )


async def _load_previous_login(session: AsyncSession, user: str) -> datetime | None:
    """오늘(KST 자정) 이전의 마지막 접속 — /me가 하루 1건 기록하므로 '직전 접속일'과 같다."""
    day_start = now_kst().replace(hour=0, minute=0, second=0, microsecond=0)
    return await session.scalar(
        select(func.max(LoginRecord.occurred_at)).where(
            LoginRecord.login_id == user, LoginRecord.occurred_at < day_start
        )
    )


async def _load_checkouts(session: AsyncSession, user: str) -> list[MeDashboardCheckoutOut]:
    rows = (
        await session.execute(
            select(MapVersion, ProcessMap)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(MapVersion.checked_out_by == user, ProcessMap.deleted_at.is_(None))
            .order_by(MapVersion.checked_out_at.desc(), MapVersion.id.desc())
        )
    ).all()
    version_ids = [ver.id for ver, _ in rows]
    waiting: dict[int, int] = {}
    if version_ids:
        waiting = {
            vid: cnt
            for vid, cnt in (
                await session.execute(
                    select(CheckoutRequest.version_id, func.count())
                    .where(
                        CheckoutRequest.version_id.in_(version_ids),
                        CheckoutRequest.status == "pending",
                    )
                    .group_by(CheckoutRequest.version_id)
                )
            ).all()
        }
    return [
        MeDashboardCheckoutOut(
            map_id=pm.id,
            map_name=pm.name,
            version_id=ver.id,
            version_label=ver.label,
            version_number=ver.version_number,
            checked_out_at=ver.checked_out_at,
            waiting_requests=waiting.get(ver.id, 0),
        )
        for ver, pm in rows
    ]


async def _load_requests(session: AsyncSession, user: str) -> list[MeDashboardRequestOut]:
    """내가 올린 pending 요청 — 승인 요청(kind별) + 점유권 이전 요청, 최신순. 소프트삭제 맵은 제외."""
    items: list[MeDashboardRequestOut] = []
    ar_rows = (
        await session.execute(
            select(ApprovalRequest, ProcessMap)
            .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
            .where(
                ApprovalRequest.requested_by == user,
                ApprovalRequest.status == "pending",
                ProcessMap.deleted_at.is_(None),
            )
        )
    ).all()
    for req, pm in ar_rows:
        items.append(
            MeDashboardRequestOut(
                kind=req.kind, id=req.id, map_id=pm.id, map_name=pm.name,
                status=req.status, created_at=req.created_at,
            )
        )
    co_rows = (
        await session.execute(
            select(CheckoutRequest, ProcessMap)
            .join(MapVersion, MapVersion.id == CheckoutRequest.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(
                CheckoutRequest.requested_by == user,
                CheckoutRequest.status == "pending",
                ProcessMap.deleted_at.is_(None),
            )
        )
    ).all()
    for req, pm in co_rows:
        items.append(
            MeDashboardRequestOut(
                kind="checkout_transfer", id=req.id, map_id=pm.id, map_name=pm.name,
                status=req.status, created_at=req.created_at,
            )
        )
    items.sort(key=lambda x: x.created_at, reverse=True)
    return items


async def _load_recent_events(session: AsyncSession, user: str) -> list[MeDashboardEventOut]:
    """내가 owner/editor인 맵의 최근 버전 이벤트 — 역할 판정은 홈 목록과 같은 load_my_roles."""
    maps = list(
        (await session.scalars(select(ProcessMap).where(ProcessMap.deleted_at.is_(None)))).all()
    )
    roles = await load_my_roles(session, user, maps)
    map_ids = [mid for mid, role in roles.items() if role in _EDITING_ROLES]
    if not map_ids:
        return []
    rows = (
        await session.execute(
            select(VersionEvent, MapVersion, ProcessMap)
            .join(MapVersion, MapVersion.id == VersionEvent.version_id)
            .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
            .where(
                MapVersion.map_id.in_(map_ids),
                or_(VersionEvent.actor != user, VersionEvent.event_type.in_(_OWN_EVENTS_KEPT)),
            )
            .order_by(VersionEvent.created_at.desc(), VersionEvent.id.desc())
            .limit(_EVENT_LIMIT)
        )
    ).all()
    actor_ids = {event.actor for event, _, _ in rows}
    actor_name: dict[str, str] = {}
    if actor_ids:
        actor_name = {
            lid: nm
            for lid, nm in (
                await session.execute(
                    select(Employee.login_id, Employee.name).where(Employee.login_id.in_(actor_ids))
                )
            ).all()
        }
    return [
        MeDashboardEventOut(
            event_type=event.event_type,
            map_id=pm.id,
            map_name=pm.name,
            version_id=ver.id,
            version_label=ver.label,
            version_number=ver.version_number,
            actor=event.actor,
            actor_name=actor_name.get(event.actor),
            note=event.note,
            created_at=event.created_at,
        )
        for event, ver, pm in rows
    ]


async def _load_framework(session: AsyncSession, user: str) -> list[MeDashboardCategoryOut]:
    """seed 카테고리(=/me category_admin_root_ids)별 서브트리 L5 현황 — sysadmin은 seed가 없어 빈 목록."""
    _admin_ids, seeds = await get_admin_scope(session, user)
    if not seeds:
        return []
    cat_rows = (
        await session.execute(
            select(
                ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level,
                ProcessCategory.name, ProcessCategory.linkage_map_id,
            )
        )
    ).all()
    by_id = {cid: (pid, level, name, lmid) for cid, pid, level, name, lmid in cat_rows}
    children_by_parent: dict[int | None, list[int]] = {}
    for cid, pid, _level, _name, _lmid in cat_rows:
        children_by_parent.setdefault(pid, []).append(cid)

    # seed별 서브트리(자기 자신 포함) — 중첩 seed는 각자 따로 센다. seen 가드는 get_admin_scope와 동일(순환 방어)
    subtree_by_root: dict[int, list[int]] = {}
    for root in sorted(seeds):
        seen = {root}
        frontier = [c for c in children_by_parent.get(root, []) if c not in seen]
        while frontier:
            seen.update(frontier)
            frontier = [c for f in frontier for c in children_by_parent.get(f, []) if c not in seen]
        subtree_by_root[root] = sorted(seen)

    all_ids = {cid for ids in subtree_by_root.values() for cid in ids}
    linkage_ids = {by_id[cid][3] for cid in all_ids if by_id[cid][3] is not None}
    confirmed_map_ids: set[int] = set()
    if linkage_ids:
        confirmed_map_ids = set(
            (
                await session.scalars(
                    select(MapVersion.map_id)
                    .where(MapVersion.map_id.in_(linkage_ids), MapVersion.status == workflow.CONFIRMED)
                    .distinct()
                )
            ).all()
        )
    slot_pending_by_cat: dict[int, int] = {
        cid: cnt
        for cid, cnt in (
            await session.execute(
                select(ProcessMap.category_id, func.count())
                .select_from(ApprovalRequest)
                .join(ProcessMap, ProcessMap.id == ApprovalRequest.map_id)
                .where(
                    ApprovalRequest.kind == "fw_slot",
                    ApprovalRequest.status == "pending",
                    ProcessMap.deleted_at.is_(None),
                    ProcessMap.category_id.in_(all_ids),
                )
                .group_by(ProcessMap.category_id)
            )
        ).all()
    }

    out: list[MeDashboardCategoryOut] = []
    for root, ids in subtree_by_root.items():
        _pid, level, name, lmid = by_id[root]
        l5_ids = [cid for cid in ids if by_id[cid][1] == 5]
        unconfirmed = sum(
            1 for cid in l5_ids
            if by_id[cid][3] is not None and by_id[cid][3] not in confirmed_map_ids
        )
        out.append(
            MeDashboardCategoryOut(
                category_id=root,
                name=name,
                level=level,
                linkage_map_id=lmid,
                l5_count=len(l5_ids),
                unconfirmed_count=unconfirmed,
                slot_pending_count=sum(slot_pending_by_cat.get(cid, 0) for cid in ids),
            )
        )
    return out
