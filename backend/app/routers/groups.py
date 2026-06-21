"""사용자 그룹 관리 API — list/create-request/members/managers/sysadmin-approve (Layer 4 Task 3b).

그룹은 map_permissions의 principal_type='group' 대상(§3a). 생성은 pending 요청이고
sysadmin이 decide로 approve해야 active가 되어 권한 판정에 적용된다. 멤버십 변경은
그룹 관리자 또는 sysadmin만, ACTIVE 그룹에 한해 허용한다.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import (
    UserGroup,
    UserGroupManager,
    UserGroupMember,
    _now,
)
from app.permissions import logic
from app.permissions.deps import assert_group_manager_or_sysadmin
from app.schemas import (
    GroupCreate,
    GroupDecisionIn,
    GroupOut,
    ManagersIn,
    MemberIn,
    MemberOut,
)

router = APIRouter(
    prefix="/api", tags=["groups"], dependencies=[Depends(get_current_user)]
)


async def _get_members(
    session: AsyncSession, group_id: int
) -> list[UserGroupMember]:
    rows = await session.scalars(
        select(UserGroupMember)
        .where(UserGroupMember.group_id == group_id)
        .order_by(UserGroupMember.id)
    )
    return list(rows.all())


async def _get_manager_ids(session: AsyncSession, group_id: int) -> list[str]:
    rows = await session.scalars(
        select(UserGroupManager.user_id)
        .where(UserGroupManager.group_id == group_id)
        .order_by(UserGroupManager.id)
    )
    return list(rows.all())


async def _serialize_group(session: AsyncSession, group: UserGroup) -> GroupOut:
    """그룹 + 멤버 + 관리자를 GroupOut으로 직렬화."""
    members = await _get_members(session, group.id)
    managers = await _get_manager_ids(session, group.id)
    return GroupOut(
        id=group.id,
        name=group.name,
        description=group.description,
        status=group.status,
        created_by=group.created_by,
        approved_by=group.approved_by,
        approved_at=group.approved_at,
        created_at=group.created_at,
        members=[MemberOut.model_validate(m) for m in members],
        managers=managers,
    )


async def _get_group_or_404(session: AsyncSession, group_id: int) -> UserGroup:
    group = await session.get(UserGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail=f"group {group_id} not found")
    return group


def _is_visible(group: UserGroup, user: str) -> bool:
    """list 가시성 규칙 — sysadmin은 전부, 그 외는 active + 본인 생성(자기 pending)만."""
    if logic.is_sysadmin(user):
        return True
    return group.status == "active" or group.created_by == user


# ── list / create ─────────────────────────────────────────────


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GroupOut]:
    """그룹 목록 — sysadmin은 전체(pending/rejected 포함), 그 외는 active + 본인 생성 pending."""
    rows = await session.scalars(select(UserGroup).order_by(UserGroup.id))
    return [
        await _serialize_group(session, g)
        for g in rows.all()
        if _is_visible(g, user)
    ]


@router.get("/groups/pending", response_model=list[GroupOut])
async def list_pending_groups(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GroupOut]:
    """sysadmin 승인 대기열 — pending 그룹만. sysadmin 외 403."""
    if not logic.is_sysadmin(user):
        raise HTTPException(status_code=403, detail="sysadmin only")
    rows = await session.scalars(
        select(UserGroup).where(UserGroup.status == "pending").order_by(UserGroup.id)
    )
    return [await _serialize_group(session, g) for g in rows.all()]


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(
    payload: GroupCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 생성 요청 — status='pending', 생성자는 자동 관리자. 멤버 ≥2 필수(아니면 422)."""
    if len(payload.members) < 2:
        raise HTTPException(
            status_code=422, detail="a group requires at least 2 members"
        )
    group = UserGroup(
        name=payload.name,
        description=payload.description,
        status="pending",
        created_by=user,
    )
    session.add(group)
    await session.flush()
    for member in payload.members:
        session.add(
            UserGroupMember(
                group_id=group.id,
                member_type=member.member_type,
                member_id=member.member_id,
            )
        )
    # 생성자 + 전달된 관리자(중복 제거) — 생성자는 항상 관리자
    manager_ids = {user, *payload.managers}
    for manager_id in manager_ids:
        session.add(UserGroupManager(group_id=group.id, user_id=manager_id))
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.get("/groups/{group_id}", response_model=GroupOut)
async def get_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 상세 — 가시성 규칙에 따라 보이지 않으면 404(존재 은닉)."""
    group = await _get_group_or_404(session, group_id)
    if not _is_visible(group, user):
        raise HTTPException(status_code=404, detail=f"group {group_id} not found")
    return await _serialize_group(session, group)


# ── members ───────────────────────────────────────────────────


def _ensure_active(group: UserGroup) -> None:
    """멤버십 변경은 active 그룹에만 — pending/rejected면 409."""
    if group.status != "active":
        raise HTTPException(
            status_code=409, detail=f"group is {group.status}, not active"
        )


@router.post("/groups/{group_id}/members", response_model=GroupOut, status_code=201)
async def add_member(
    group_id: int,
    payload: MemberIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """멤버 추가 — 관리자/sysadmin, active 그룹, 중복 거부(409)."""
    group = await _get_group_or_404(session, group_id)
    await assert_group_manager_or_sysadmin(session, user, group_id)
    _ensure_active(group)
    existing = await session.scalar(
        select(UserGroupMember.id).where(
            UserGroupMember.group_id == group_id,
            UserGroupMember.member_type == payload.member_type,
            UserGroupMember.member_id == payload.member_id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=409, detail="member already exists")
    session.add(
        UserGroupMember(
            group_id=group_id,
            member_type=payload.member_type,
            member_id=payload.member_id,
        )
    )
    await session.commit()
    return await _serialize_group(session, group)


@router.delete("/groups/{group_id}/members/{member_pk}", response_model=GroupOut)
async def remove_member(
    group_id: int,
    member_pk: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """멤버 제거 — 관리자/sysadmin, active 그룹. (min-2는 CREATE 규칙이라 제거엔 미적용)."""
    group = await _get_group_or_404(session, group_id)
    await assert_group_manager_or_sysadmin(session, user, group_id)
    _ensure_active(group)
    member = await session.get(UserGroupMember, member_pk)
    if member is None or member.group_id != group_id:
        raise HTTPException(status_code=404, detail=f"member {member_pk} not found")
    await session.delete(member)
    await session.commit()
    return await _serialize_group(session, group)


# ── managers ──────────────────────────────────────────────────


@router.put("/groups/{group_id}/managers", response_model=GroupOut)
async def set_managers(
    group_id: int,
    payload: ManagersIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """관리자 집합 교체 — 관리자/sysadmin. 최소 1명(빈 배열 422)."""
    group = await _get_group_or_404(session, group_id)
    await assert_group_manager_or_sysadmin(session, user, group_id)
    new_managers = list(dict.fromkeys(payload.managers))  # 순서 유지·중복 제거
    if not new_managers:
        raise HTTPException(
            status_code=422, detail="a group requires at least 1 manager"
        )
    existing = await session.scalars(
        select(UserGroupManager).where(UserGroupManager.group_id == group_id)
    )
    for row in existing.all():
        await session.delete(row)
    for manager_id in new_managers:
        session.add(UserGroupManager(group_id=group_id, user_id=manager_id))
    await session.commit()
    return await _serialize_group(session, group)


# ── decide (sysadmin only) ────────────────────────────────────


@router.post("/groups/{group_id}/decide", response_model=GroupOut)
async def decide_group(
    group_id: int,
    payload: GroupDecisionIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 생성 요청 결정 — sysadmin only. approve→active(승인자/시각 기록), reject→rejected.

    이미 결정된(active/rejected) 그룹 재결정은 409(멱등 가드).
    """
    if not logic.is_sysadmin(user):
        raise HTTPException(status_code=403, detail="sysadmin only")
    group = await _get_group_or_404(session, group_id)
    if group.status != "pending":
        raise HTTPException(status_code=409, detail=f"group already {group.status}")
    if payload.decision == "approve":
        group.status = "active"
        group.approved_by = user
        group.approved_at = _now()
    else:
        group.status = "rejected"
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)
