"""FastAPI 권한 게이트 의존성 — 경로 파라미터로 map_id를 해석해 역할을 강제한다.

map_id 를 직접 받는 엔드포인트, version_id→map_id, comment_id→version→map_id 세 진입점.
sysadmin(auth OFF 전원)은 effective_role 단계에서 owner로 해석되어 모든 게이트를 통과한다.
"""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Comment, MapApprover, MapVersion, UserGroupManager
from app.permissions import logic
from app.permissions.access import assert_map_role

Dep = Callable[..., Coroutine[Any, Any, None]]


async def is_group_manager(
    session: AsyncSession, group_id: int, login_id: str
) -> bool:
    """login_id 가 그룹의 관리자(user_group_managers)인지 (Layer 4 Task 3b)."""
    return (
        await session.scalar(
            select(UserGroupManager.id).where(
                UserGroupManager.group_id == group_id,
                UserGroupManager.user_id == login_id,
            )
        )
    ) is not None


async def assert_group_manager_or_sysadmin(
    session: AsyncSession, login_id: str, group_id: int
) -> None:
    """그룹 관리자 또는 sysadmin 이 아니면 403 (멤버 add/remove·관리자 set 게이트)."""
    if logic.is_sysadmin(login_id):
        return
    if await is_group_manager(session, group_id, login_id):
        return
    raise HTTPException(status_code=403, detail="group manager or sysadmin only")


async def is_map_approver(session: AsyncSession, login_id: str, map_id: int) -> bool:
    """login_id 가 map_id 의 지정 승인자인지."""
    return (
        await session.scalar(
            select(MapApprover.user_id).where(
                MapApprover.map_id == map_id, MapApprover.user_id == login_id
            )
        )
    ) is not None


async def assert_approver_or_sysadmin(
    session: AsyncSession, login_id: str, map_id: int
) -> None:
    """맵의 지정 승인자 또는 sysadmin 이 아니면 403 (승인 요청 조회/결정 게이트, brief §D)."""
    if logic.is_sysadmin(login_id):
        return
    if await is_map_approver(session, login_id, map_id):
        return
    raise HTTPException(status_code=403, detail="approver or sysadmin only")


def require_map_role(min_role: str) -> Dep:
    """경로의 map_id 에 대해 min_role 이상을 요구한다."""

    async def dep(
        map_id: int,
        user: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> None:
        await assert_map_role(session, user, map_id, min_role)

    return dep


def require_version_map_role(min_role: str) -> Dep:
    """경로의 version_id 가 속한 맵에 대해 min_role 이상을 요구한다."""

    async def dep(
        version_id: int,
        user: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> None:
        version = await session.get(MapVersion, version_id)
        if version is None:
            raise HTTPException(status_code=404, detail=f"version {version_id} not found")
        await assert_map_role(session, user, version.map_id, min_role)

    return dep


def require_comment_map_role(min_role: str) -> Dep:
    """경로의 comment_id → version → 맵에 대해 min_role 이상을 요구한다."""

    async def dep(
        comment_id: int,
        user: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> None:
        comment = await session.get(Comment, comment_id)
        if comment is None:
            raise HTTPException(status_code=404, detail=f"comment {comment_id} not found")
        version = await session.get(MapVersion, comment.version_id)
        if version is None:
            raise HTTPException(status_code=404, detail="comment's version not found")
        await assert_map_role(session, user, version.map_id, min_role)

    return dep


def require_approver_or_sysadmin() -> Dep:
    """경로의 map_id 에 대해 지정 승인자 또는 sysadmin 을 요구한다 (승인 요청 조회)."""

    async def dep(
        map_id: int,
        user: str = Depends(get_current_user),
        session: AsyncSession = Depends(get_session),
    ) -> None:
        await assert_approver_or_sysadmin(session, user, map_id)

    return dep
