"""FastAPI 권한 게이트 의존성 — 경로 파라미터로 map_id를 해석해 역할을 강제한다.

map_id 를 직접 받는 엔드포인트, version_id→map_id, comment_id→version→map_id 세 진입점.
sysadmin(auth OFF 전원)은 effective_role 단계에서 owner로 해석되어 모든 게이트를 통과한다.
"""

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Comment, MapVersion
from app.permissions.access import assert_map_role

Dep = Callable[..., Coroutine[Any, Any, None]]


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
