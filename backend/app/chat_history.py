"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""

import json
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import AiChatMessage, AiChatSession
from app.schemas import AiProposal


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]


# kind → 저장 서브셋 필드 — 프론트 toPayload(chat-sessions.ts)와 같은 규칙 유지
_PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "analysis": ("findings",),
    "walkthrough": ("steps",),
    "graph": ("nodes", "edges", "groups"),
    "ops": ("ops",),
}


def serialize_proposal_payload(proposal: AiProposal) -> str | None:
    """카드 재현용 kind별 서브셋 직렬화 — answer/빈 제안은 None."""
    fields = _PAYLOAD_FIELDS.get(proposal.kind)
    if fields is None:
        return None
    data = {
        field: [item.model_dump(mode="json") for item in getattr(proposal, field)]
        for field in fields
    }
    if not any(data.values()):
        return None
    return json.dumps(data, ensure_ascii=False)


def parse_proposal_payload(raw: str | None) -> dict | None:
    """저장 payload 디코드 — 오염 행은 None 강등(대화 조회가 죽지 않게)."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


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
