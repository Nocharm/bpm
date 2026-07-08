"""AI 챗 세션 조회/삭제 API — 전부 본인 소유만(타인 404, 존재 노출 안 함) (design 2026-07-08)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import AiChatMessage, AiChatSession, ProcessMap
from app.schemas import AiChatMessageOut, AiChatMessagesOut, AiChatSessionOut, AiChatSessionsOut

router = APIRouter(prefix="/api", tags=["ai-chat-sessions"], dependencies=[Depends(get_current_user)])


async def _get_owned_session(
    session: AsyncSession, session_id: int, user: str
) -> AiChatSession:
    """본인 세션만 — 없거나 타인 것이면 404."""
    row = await session.get(AiChatSession, session_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail=f"chat session {session_id} not found")
    return row


@router.get("/ai/chat-sessions", response_model=AiChatSessionsOut)
async def list_chat_sessions(
    map_id: int | None = Query(default=None),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChatSessionsOut:
    """내 세션 목록(최근 활동순) + 맵 이름·메시지 수 — 소프트삭제된 맵 제외."""
    counts = (
        select(AiChatMessage.session_id, func.count().label("n"))
        .group_by(AiChatMessage.session_id)
        .subquery()
    )
    stmt = (
        select(AiChatSession, ProcessMap.name, func.coalesce(counts.c.n, 0))
        .join(ProcessMap, ProcessMap.id == AiChatSession.map_id)
        .outerjoin(counts, counts.c.session_id == AiChatSession.id)
        .where(AiChatSession.login_id == user, ProcessMap.deleted_at.is_(None))
        .order_by(AiChatSession.updated_at.desc(), AiChatSession.id.desc())
    )
    if map_id is not None:
        stmt = stmt.where(AiChatSession.map_id == map_id)
    rows = (await session.execute(stmt)).all()
    return AiChatSessionsOut(
        sessions=[
            AiChatSessionOut(
                id=row.id,
                map_id=row.map_id,
                map_name=name,
                title=row.title,
                message_count=count,
                updated_at=row.updated_at,
            )
            for row, name, count in rows
        ]
    )


@router.get("/ai/chat-sessions/{session_id}/messages", response_model=AiChatMessagesOut)
async def list_chat_messages(
    session_id: int,
    before: int | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChatMessagesOut:
    """최근부터 역방향 커서 페이징 — before=<message_id>보다 오래된 limit개를 오름차순으로."""
    await _get_owned_session(session, session_id, user)
    stmt = select(AiChatMessage).where(AiChatMessage.session_id == session_id)
    if before is not None:
        stmt = stmt.where(AiChatMessage.id < before)
    # limit+1개를 최신순으로 떠서 has_more 판정 후 페이지만 오름차순으로 뒤집는다
    rows = (await session.scalars(stmt.order_by(AiChatMessage.id.desc()).limit(limit + 1))).all()
    has_more = len(rows) > limit
    page = list(reversed(rows[:limit]))
    return AiChatMessagesOut(
        messages=[
            AiChatMessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                kind=m.kind,
                version_id=m.version_id,
                created_at=m.created_at,
            )
            for m in page
        ],
        has_more=has_more,
    )


@router.delete("/ai/chat-sessions/{session_id}", status_code=204)
async def delete_chat_session(
    session_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 세션 삭제 — 메시지는 ORM cascade로 동반 삭제."""
    row = await _get_owned_session(session, session_id, user)
    await session.delete(row)
    await session.commit()
