"""앱 런타임 설정 API — sysadmin이 재배포 없이 켜고 끄는 플래그·AI 챗 팁 GET/PUT."""

import json

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import (
    AI_CHAT_MAX_MESSAGES_KEY,
    AI_CHAT_MAX_SESSIONS_KEY,
    AI_CHAT_RETENTION_DAYS_KEY,
    AI_CHAT_TIPS_KEY,
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_retention_days,
    get_ai_chat_tips,
    set_app_setting,
)
from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import AppSetting
from app.schemas import AppSettingsOut, AppSettingsUpdate

router = APIRouter(
    prefix="/api",
    tags=["app-settings"],
    dependencies=[Depends(get_current_user), Depends(require_sysadmin)],
)


async def _to_out(session: AsyncSession) -> AppSettingsOut:
    managed = [
        AI_CHAT_TIPS_KEY,
        AI_CHAT_MAX_SESSIONS_KEY,
        AI_CHAT_MAX_MESSAGES_KEY,
        AI_CHAT_RETENTION_DAYS_KEY,
    ]
    rows = (
        await session.scalars(select(AppSetting).where(AppSetting.key.in_(managed)))
    ).all()
    latest = max(rows, key=lambda r: r.updated_at, default=None)
    return AppSettingsOut(
        ai_chat_tips=await get_ai_chat_tips(session),
        ai_chat_max_sessions_per_map=await get_ai_chat_max_sessions(session),
        ai_chat_max_messages_per_session=await get_ai_chat_max_messages(session),
        ai_chat_retention_days=await get_ai_chat_retention_days(session),
        updated_by=latest.updated_by if latest else None,
        updated_at=latest.updated_at if latest else None,
    )


@router.get("/admin/app-settings", response_model=AppSettingsOut)
async def get_app_settings(session: AsyncSession = Depends(get_session)) -> AppSettingsOut:
    return await _to_out(session)


@router.put("/admin/app-settings", response_model=AppSettingsOut)
async def put_app_settings(
    payload: AppSettingsUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AppSettingsOut:
    """부분 upsert — 보존 상한·기능 팁(빈 목록이면 기본 복원)."""
    if payload.ai_chat_tips is not None:
        # 공백 팁 제거 + 200자 컷 — 빈 목록이 되면 get_ai_chat_tips가 기본 팁으로 폴백
        tips = [tip.strip()[:200] for tip in payload.ai_chat_tips if tip.strip()]
        await set_app_setting(session, AI_CHAT_TIPS_KEY, json.dumps(tips), user)
    for key, value in (
        (AI_CHAT_MAX_SESSIONS_KEY, payload.ai_chat_max_sessions_per_map),
        (AI_CHAT_MAX_MESSAGES_KEY, payload.ai_chat_max_messages_per_session),
        (AI_CHAT_RETENTION_DAYS_KEY, payload.ai_chat_retention_days),
    ):
        if value is not None:
            await set_app_setting(session, key, str(value), user)
    await session.commit()
    return await _to_out(session)
