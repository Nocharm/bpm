"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import AiChatMessage, AiChatSession


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]


async def prune_chat_session_messages(
    session: AsyncSession, session_id: int, max_messages: int
) -> None:
    """세션 내 메시지 상한 초과분을 오래된 순(id asc)으로 삭제 — 호출자가 commit."""
    count = (
        await session.execute(
            select(func.count())
            .select_from(AiChatMessage)
            .where(AiChatMessage.session_id == session_id)
        )
    ).scalar_one()
    overflow = count - max_messages
    if overflow <= 0:
        return
    old_ids = (
        await session.scalars(
            select(AiChatMessage.id)
            .where(AiChatMessage.session_id == session_id)
            .order_by(AiChatMessage.id)
            .limit(overflow)
        )
    ).all()
    await session.execute(delete(AiChatMessage).where(AiChatMessage.id.in_(old_ids)))


async def prune_map_chat_sessions(
    session: AsyncSession, login_id: str, map_id: int, max_sessions: int
) -> None:
    """사용자×맵 세션 상한 초과분을 활동 오래된 순으로 삭제 — ORM delete로 메시지 cascade."""
    rows = (
        await session.scalars(
            select(AiChatSession)
            .where(AiChatSession.login_id == login_id, AiChatSession.map_id == map_id)
            .order_by(AiChatSession.updated_at.desc(), AiChatSession.id.desc())
        )
    ).all()
    for stale in rows[max_sessions:]:
        await session.delete(stale)


async def prune_expired_chat_sessions(
    session: AsyncSession, login_id: str, retention_days: int
) -> None:
    """마지막 활동 후 retention_days 경과한 내 세션 삭제 — 목록 조회 시 기회적 실행."""
    cutoff = now_kst() - timedelta(days=retention_days)
    rows = (
        await session.scalars(
            select(AiChatSession).where(
                AiChatSession.login_id == login_id, AiChatSession.updated_at < cutoff
            )
        )
    ).all()
    for stale in rows:
        await session.delete(stale)
