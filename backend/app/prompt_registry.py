"""AI 프롬프트 레지스트리 — 코드 기본값 단일 소스 + sysadmin DB 오버라이드 조회 (설계: docs/design/2026-08-04-ai-prompts-admin-design.md)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiPrompt

# 편집 가능한 프롬프트 key — API·UI 노출 순서 그대로
PROMPT_KEYS: tuple[str, ...] = (
    "ai_chat_instructions",
    "interviewer_contract",
    "drafter_contract",
    "interviewer_word_addendum",
    "drafter_word_addendum",
    "extract_contract",
    "anti_repeat_nudge",
)


def get_prompt_defaults() -> dict[str, str]:
    """key → 코드 기본 프롬프트. 지연 import — orchestrator가 이 모듈을 import해도 순환 없음."""
    from app import ai_prompt
    from app.interview import agents, orchestrator

    return {
        "ai_chat_instructions": ai_prompt._INSTRUCTIONS,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "interviewer_contract": agents._INTERVIEWER_CONTRACT,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "drafter_contract": agents._DRAFTER_CONTRACT,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "interviewer_word_addendum": agents._INTERVIEWER_WORD_ADDENDUM,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "drafter_word_addendum": agents._DRAFTER_WORD_ADDENDUM,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "extract_contract": orchestrator._EXTRACT_CONTRACT,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
        "anti_repeat_nudge": orchestrator._ANTI_REPEAT_NUDGE,  # noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지
    }


async def get_prompt_overrides(session: AsyncSession) -> dict[str, str]:
    """DB 오버라이드 전체(≤7행) — 요청/턴당 1회 조회해 빌더에 전달."""
    rows = (await session.scalars(select(AiPrompt))).all()
    return {row.key: row.content for row in rows if row.key in PROMPT_KEYS}
