"""사용자 그룹 관리 API — list/create-request/members/managers/sysadmin-approve (Layer 4 Task 3b).

그룹은 map_permissions의 principal_type='group' 대상(§3a). 생성은 pending 요청이고
sysadmin이 decide로 approve해야 active가 되어 권한 판정에 적용된다. 멤버십 변경은
그룹 관리자 또는 sysadmin만, ACTIVE 그룹에 한해 허용한다.
"""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import (
    Employee,
    MapPermission,
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
    GroupRenameIn,
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
        deleted_at=group.deleted_at,
        name_changed_at=group.name_changed_at,
        members=[MemberOut.model_validate(m) for m in members],
        managers=managers,
    )


async def _get_group_or_404(session: AsyncSession, group_id: int) -> UserGroup:
    group = await session.get(UserGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail=f"group {group_id} not found")
    return group


GROUP_RETENTION = timedelta(days=7)  # 소프트삭제/거절 후 영구삭제까지 (맵 휴지통과 동일)
GROUP_RENAME_INTERVAL = timedelta(days=7)  # active 그룹 이름변경 최소 간격 (주 1회)


async def _purge_expired_groups(session: AsyncSession) -> None:
    """보존(7일) 경과한 소프트삭제/거절 그룹을 영구 삭제 (조회 시 lazy 정리)."""
    cutoff = _now() - GROUP_RETENTION
    expired = (
        await session.scalars(
            select(UserGroup).where(
                UserGroup.deleted_at.is_not(None), UserGroup.deleted_at < cutoff
            )
        )
    ).all()
    if expired:
        for stale in expired:
            await session.delete(stale)
        await session.commit()


async def _assert_can_manage(session: AsyncSession, user: str, group: UserGroup) -> None:
    """그룹 삭제/재신청 권한 — sysadmin · 생성자 · 관리자."""
    if logic.is_sysadmin(user) or group.created_by == user:
        return
    managers = await _get_manager_ids(session, group.id)
    if user in managers:
        return
    raise HTTPException(status_code=403, detail="group manager or sysadmin only")


async def _emp_org_path(session: AsyncSession, user: str) -> str:
    """사용자 org_path — 부서 멤버십 판정용(직원 미존재 시 '')."""
    emp = await session.get(Employee, user)
    if emp is None:
        return ""
    return logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)


def _belongs(group: GroupOut, user: str, emp_org_path: str) -> bool:
    """사용자가 그룹에 '해당'하는가 — 생성자/관리자/직접 user 멤버/부서 멤버 (상태 무관).

    일반 유저 가시성: sysadmin은 전체, 그 외는 자신이 해당하는 그룹만 본다.
    """
    if group.created_by == user or user in group.managers:
        return True
    for m in group.members:
        if m.member_type == "user" and m.member_id == user:
            return True
        if m.member_type == "department" and logic.belongs_to_department(emp_org_path, m.member_id):
            return True
    return False


# ── list / create ─────────────────────────────────────────────


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GroupOut]:
    """그룹 목록 — sysadmin은 전체, 그 외는 '자신이 해당하는' 그룹(생성자/관리자/user 멤버/부서 멤버)만."""
    await _purge_expired_groups(session)
    is_admin = logic.is_sysadmin(user)
    emp_org_path = "" if is_admin else await _emp_org_path(session, user)
    rows = await session.scalars(select(UserGroup).order_by(UserGroup.id))
    out: list[GroupOut] = []
    for g in rows.all():
        # 소프트삭제(비활성) 그룹 숨김 — rejected(유예 중)는 노출(삭제/재신청 가능) / hide soft-deleted except rejected.
        if g.deleted_at is not None and g.status != "rejected":
            continue
        serialized = await _serialize_group(session, g)
        if is_admin or _belongs(serialized, user, emp_org_path):
            out.append(serialized)
    return out


@router.get("/groups/pending", response_model=list[GroupOut])
async def list_pending_groups(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GroupOut]:
    """sysadmin 승인 대기열 — pending 그룹만. sysadmin 외 403."""
    if not logic.is_sysadmin(user):
        raise HTTPException(status_code=403, detail="sysadmin only")
    rows = await session.scalars(
        select(UserGroup)
        .where(UserGroup.status == "pending", UserGroup.deleted_at.is_(None))
        .order_by(UserGroup.id)
    )
    return [await _serialize_group(session, g) for g in rows.all()]


@router.post("/groups", response_model=GroupOut, status_code=201)
async def create_group(
    payload: GroupCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 생성 요청 — status='pending', 생성자는 자동 관리자. 멤버 ≥2 필수, 이름 전역 중복 금지."""
    name = payload.name.strip()
    existing_name = await session.scalar(
        select(UserGroup.id).where(UserGroup.name == name, UserGroup.deleted_at.is_(None))
    )
    if existing_name is not None:
        raise HTTPException(status_code=409, detail="group name already in use")
    if len(payload.members) < 2:
        raise HTTPException(
            status_code=422, detail="a group requires at least 2 members"
        )
    # 매니저는 그룹 멤버(user) 중에서만 지정 — 명시된 관리자 검증 (생성자 자동 관리자는 예외) /
    # Managers must be member users; the auto-added creator is exempt.
    member_user_ids = {m.member_id for m in payload.members if m.member_type == "user"}
    invalid_managers = [mgr for mgr in payload.managers if mgr not in member_user_ids]
    if invalid_managers:
        raise HTTPException(
            status_code=422,
            detail="managers must be chosen from the group's user members",
        )
    group = UserGroup(
        name=name,
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


@router.get("/groups/name-available", dependencies=[Depends(get_current_user)])
async def group_name_available(
    name: str,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """그룹 이름 사용 가능 여부 — 전역 중복 금지(삭제분 제외). 모든 그룹이 안 보여도 서버가 판정."""
    existing = await session.scalar(
        select(UserGroup.id).where(UserGroup.name == name.strip(), UserGroup.deleted_at.is_(None))
    )
    return {"available": existing is None}


@router.get("/groups/deleted", response_model=list[GroupOut])
async def list_deleted_groups(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[GroupOut]:
    """스케줄드 딜리션(휴지통) — 소프트삭제된 그룹(deleted_at·status!=rejected). sysadmin 전체·그 외 관리 가능분만."""
    await _purge_expired_groups(session)
    is_admin = logic.is_sysadmin(user)
    rows = await session.scalars(
        select(UserGroup)
        .where(UserGroup.deleted_at.is_not(None), UserGroup.status != "rejected")
        .order_by(UserGroup.deleted_at)
    )
    out: list[GroupOut] = []
    for g in rows.all():
        if (
            is_admin
            or g.created_by == user
            or user in await _get_manager_ids(session, g.id)
        ):
            out.append(await _serialize_group(session, g))
    return out


@router.get("/groups/{group_id}", response_model=GroupOut)
async def get_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 상세 — 가시성 규칙에 따라 보이지 않으면 404(존재 은닉)."""
    group = await _get_group_or_404(session, group_id)
    if group.deleted_at is not None and group.status != "rejected":
        raise HTTPException(status_code=404, detail=f"group {group_id} not found")
    serialized = await _serialize_group(session, group)
    if not logic.is_sysadmin(user):
        emp_org_path = await _emp_org_path(session, user)
        if not _belongs(serialized, user, emp_org_path):
            raise HTTPException(status_code=404, detail=f"group {group_id} not found")
    return serialized


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
        group.deleted_at = _now()  # 거절 → 7일 후 자동 영구삭제
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.delete("/groups/{group_id}", response_model=GroupOut)
async def delete_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 삭제 — 관리자/생성자/sysadmin. active는 먼저 비활성(409)·pending은 철회(409)·rejected는 즉시 영구삭제·inactive는 소프트삭제(7일 후 퍼지)."""
    group = await _get_group_or_404(session, group_id)
    await _assert_can_manage(session, user, group)
    if group.status == "active":
        raise HTTPException(status_code=409, detail="deactivate the group before deleting")
    if group.status == "pending":
        raise HTTPException(status_code=409, detail="withdraw the pending request instead")
    if group.status == "rejected":
        # 이미 실패한 요청 — 즉시 제거 / hard-delete a rejected request now.
        serialized = await _serialize_group(session, group)
        await session.delete(group)
        await session.commit()
        return serialized
    group.deleted_at = _now()  # inactive 소프트삭제 — 7일 후 _purge_expired_groups가 영구삭제
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.post("/groups/{group_id}/resubmit", response_model=GroupOut)
async def resubmit_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """거절된 그룹 재신청 — 관리자/생성자/sysadmin. status=pending 으로 되돌리고 deleted_at 해제."""
    group = await _get_group_or_404(session, group_id)
    if group.status != "rejected":
        raise HTTPException(status_code=409, detail=f"group is {group.status}, not rejected")
    await _assert_can_manage(session, user, group)
    group.status = "pending"
    group.deleted_at = None
    group.approved_by = None
    group.approved_at = None
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.post("/groups/{group_id}/withdraw")
async def withdraw_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    """대기 중 신청 철회 — 생성자/관리자/sysadmin. pending만, 승인 전이라 즉시 제거."""
    group = await _get_group_or_404(session, group_id)
    if group.status != "pending":
        raise HTTPException(status_code=409, detail=f"group is {group.status}, not pending")
    await _assert_can_manage(session, user, group)
    await session.delete(group)
    await session.commit()
    return {"withdrawn": True}


@router.post("/groups/{group_id}/deactivate", response_model=GroupOut)
async def deactivate_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 비활성 — 관리자/생성자/sysadmin. active→inactive. 이 그룹에 부여된 맵 권한 행은 함께 삭제(재활성해도 복구 X)."""
    group = await _get_group_or_404(session, group_id)
    if group.status != "active":
        raise HTTPException(status_code=409, detail=f"group is {group.status}, not active")
    await _assert_can_manage(session, user, group)
    group.status = "inactive"
    # 비활성 그룹은 판정에서 제외될 뿐 아니라, 부여돼 있던 맵 권한 행 자체를 제거한다(잔존 방지).
    await session.execute(
        delete(MapPermission).where(
            MapPermission.principal_type == "group",
            MapPermission.principal_id == str(group_id),
        )
    )
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.post("/groups/{group_id}/reactivate", response_model=GroupOut)
async def reactivate_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """비활성 그룹 재활성 — 관리자/생성자/sysadmin. inactive→active."""
    group = await _get_group_or_404(session, group_id)
    if group.status != "inactive":
        raise HTTPException(status_code=409, detail=f"group is {group.status}, not inactive")
    await _assert_can_manage(session, user, group)
    group.status = "active"
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.patch("/groups/{group_id}/name", response_model=GroupOut)
async def rename_group(
    group_id: int,
    payload: GroupRenameIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """그룹 이름 변경 — 관리자/생성자/sysadmin. active에서만, 주 1회 제한, 전역 중복 금지."""
    group = await _get_group_or_404(session, group_id)
    await _assert_can_manage(session, user, group)
    if group.status != "active":
        raise HTTPException(status_code=409, detail="rename is only allowed while active")
    new_name = payload.name.strip()
    if not new_name:
        raise HTTPException(status_code=422, detail="name is required")
    # 주 1회 제한 — DB측 비교(sqlite naive / pg aware tz 차이 회피, _purge_expired_groups와 동일 패턴).
    if group.name_changed_at is not None:
        recent_rename = await session.scalar(
            select(UserGroup.id).where(
                UserGroup.id == group_id,
                UserGroup.name_changed_at > _now() - GROUP_RENAME_INTERVAL,
            )
        )
        if recent_rename is not None:
            raise HTTPException(
                status_code=409, detail="name can be changed only once per week"
            )
    dup = await session.scalar(
        select(UserGroup.id).where(
            UserGroup.name == new_name,
            UserGroup.deleted_at.is_(None),
            UserGroup.id != group_id,
        )
    )
    if dup is not None:
        raise HTTPException(status_code=409, detail="group name already in use")
    group.name = new_name
    group.name_changed_at = _now()
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)


@router.post("/groups/{group_id}/restore", response_model=GroupOut)
async def restore_group(
    group_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> GroupOut:
    """스케줄드 딜리션에서 복구 — 소프트삭제(inactive) 그룹의 deleted_at 해제. 관리자/생성자/sysadmin."""
    group = await _get_group_or_404(session, group_id)
    await _assert_can_manage(session, user, group)
    if group.deleted_at is None or group.status == "rejected":
        raise HTTPException(status_code=409, detail="group is not in scheduled deletion")
    group.deleted_at = None  # inactive 상태로 되돌아와 다시 목록 노출(재활성 가능)
    await session.commit()
    await session.refresh(group)
    return await _serialize_group(session, group)
