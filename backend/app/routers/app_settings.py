"""앱 런타임 설정 API — sysadmin이 재배포 없이 켜고 끄는 플래그·AI 챗 팁 GET/PUT."""

import json

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import (
    AI_CHAT_LOG_KEY,
    AI_CHAT_TIPS_KEY,
    get_ai_chat_tips,
    is_ai_chat_log_enabled,
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
    row = await session.get(AppSetting, AI_CHAT_LOG_KEY)
    return AppSettingsOut(
        ai_chat_log_enabled=await is_ai_chat_log_enabled(session),
        ai_chat_tips=await get_ai_chat_tips(session),
        updated_by=row.updated_by if row else None,
        updated_at=row.updated_at if row else None,
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
    """부분 upsert — 적재 토글(테스트 기간 중 ON 예정)·기능 팁(빈 목록이면 기본 복원)."""
    if payload.ai_chat_log_enabled is not None:
        value = "true" if payload.ai_chat_log_enabled else "false"
        await set_app_setting(session, AI_CHAT_LOG_KEY, value, user)
    if payload.ai_chat_tips is not None:
        # 공백 팁 제거 + 200자 컷 — 빈 목록이 되면 get_ai_chat_tips가 기본 팁으로 폴백
        tips = [tip.strip()[:200] for tip in payload.ai_chat_tips if tip.strip()]
        await set_app_setting(session, AI_CHAT_TIPS_KEY, json.dumps(tips), user)
    await session.commit()
    return await _to_out(session)
