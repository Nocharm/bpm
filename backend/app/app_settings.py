"""앱 런타임 설정 헬퍼 — DB key-value(app_settings) 조회/저장. 재배포 없이 설정 화면에서 변경."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AppSetting

AI_CHAT_LOG_KEY = "ai_chat_log_enabled"


async def is_ai_chat_log_enabled(session: AsyncSession) -> bool:
    """AI 챗 질문/답변 DB 적재 여부 — 행이 없으면 기본 off."""
    row = await session.get(AppSetting, AI_CHAT_LOG_KEY)
    return row is not None and row.value == "true"


async def set_app_setting(session: AsyncSession, key: str, value: str, user: str) -> AppSetting:
    """설정 upsert — 호출자가 commit한다."""
    row = await session.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=value, updated_by=user)
        session.add(row)
    else:
        row.value = value
        row.updated_by = user
    return row
