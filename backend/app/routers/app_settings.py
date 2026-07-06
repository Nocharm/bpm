"""앱 런타임 설정 API — sysadmin이 재배포 없이 켜고 끄는 플래그 GET/PUT."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import AI_CHAT_LOG_KEY, set_app_setting
from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import AppSetting
from app.schemas import AppSettingsOut, AppSettingsUpdate

router = APIRouter(
    prefix="/api",
    tags=["app-settings"],
    dependencies=[Depends(get_current_user), Depends(require_sysadmin)],
)


def _to_out(row: AppSetting | None) -> AppSettingsOut:
    return AppSettingsOut(
        ai_chat_log_enabled=row is not None and row.value == "true",
        updated_by=row.updated_by if row else None,
        updated_at=row.updated_at if row else None,
    )


@router.get("/admin/app-settings", response_model=AppSettingsOut)
async def get_app_settings(session: AsyncSession = Depends(get_session)) -> AppSettingsOut:
    return _to_out(await session.get(AppSetting, AI_CHAT_LOG_KEY))


@router.put("/admin/app-settings", response_model=AppSettingsOut)
async def put_app_settings(
    payload: AppSettingsUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AppSettingsOut:
    """AI 챗 Q&A DB 적재 토글 upsert — 테스트 기간 중 ON 예정."""
    value = "true" if payload.ai_chat_log_enabled else "false"
    row = await set_app_setting(session, AI_CHAT_LOG_KEY, value, user)
    await session.commit()
    await session.refresh(row)
    return _to_out(row)
