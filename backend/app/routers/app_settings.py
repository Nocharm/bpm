"""앱 런타임 설정 API — sysadmin이 재배포 없이 켜고 끄는 플래그·AI 챗 팁 GET/PUT."""

import json

from fastapi import APIRouter, Depends
from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import (
    AI_ACCESS_DISABLED_KEY,
    AI_CHAT_MAX_MESSAGES_KEY,
    AI_CHAT_MAX_SESSIONS_KEY,
    AI_CHAT_RETENTION_DAYS_KEY,
    AI_CHAT_TIPS_KEY,
    ASSIGNEE_ROLES_KEY,
    EXPOSED_POSITIONS_KEY,
    SYSTEMS_KEY,
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_retention_days,
    get_ai_chat_tips,
    get_ai_access_disabled,
    get_assignee_roles,
    get_exposed_positions,
    get_systems,
    set_app_setting,
    set_managed_entries,
)
from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import AppSetting, Employee, Node, ProcessMap
from app.schemas import AppSettingsOut, AppSettingsUpdate, CatalogEntryIn

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
        AI_ACCESS_DISABLED_KEY,
        EXPOSED_POSITIONS_KEY,
        ASSIGNEE_ROLES_KEY,
        SYSTEMS_KEY,
    ]
    rows = (
        await session.scalars(select(AppSetting).where(AppSetting.key.in_(managed)))
    ).all()
    latest = max(rows, key=lambda r: r.updated_at, default=None)
    available_positions = (
        await session.scalars(
            select(distinct(Employee.position))
            .where(Employee.position.is_not(None))
            .order_by(Employee.position)
        )
    ).all()
    # 사용 중인 시스템 값 — 노드 system ∪ SP 지정 sp_system (빈값 제외, 대소문자 무시 정렬)
    node_systems = (await session.scalars(select(distinct(Node.system)).where(Node.system != ""))).all()
    sp_systems = (
        await session.scalars(
            select(distinct(ProcessMap.sp_system)).where(
                ProcessMap.sp_system.is_not(None), ProcessMap.sp_system != ""
            )
        )
    ).all()
    available_systems = sorted({*node_systems, *sp_systems}, key=str.casefold)
    return AppSettingsOut(
        ai_chat_tips=await get_ai_chat_tips(session),
        ai_chat_max_sessions_per_map=await get_ai_chat_max_sessions(session),
        ai_chat_max_messages_per_session=await get_ai_chat_max_messages(session),
        ai_chat_retention_days=await get_ai_chat_retention_days(session),
        ai_access_disabled=await get_ai_access_disabled(session),
        exposed_positions=await get_exposed_positions(session),
        available_positions=list(available_positions),
        assignee_roles=await get_assignee_roles(session),
        systems=await get_systems(session),
        available_systems=available_systems,
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
    if payload.exposed_positions is not None:
        # 공백 제거만 — 빈 목록이 되어도 그대로 저장(get_exposed_positions가 기본값 폴백하지 않음)
        positions = [p.strip() for p in payload.exposed_positions if p.strip()]
        await set_app_setting(session, EXPOSED_POSITIONS_KEY, json.dumps(positions), user)
    if payload.assignee_roles is not None:
        await set_managed_entries(
            session, ASSIGNEE_ROLES_KEY, [_entry_payload(e) for e in payload.assignee_roles], user
        )
    if payload.systems is not None:
        # Other는 값 잠금·별칭 허용 — 저장은 그대로 두고 읽기(get_systems)가 맨 앞으로 옮긴다
        await set_managed_entries(session, SYSTEMS_KEY, [_entry_payload(e) for e in payload.systems], user)
    for key, value in (
        (AI_CHAT_MAX_SESSIONS_KEY, payload.ai_chat_max_sessions_per_map),
        (AI_CHAT_MAX_MESSAGES_KEY, payload.ai_chat_max_messages_per_session),
        (AI_CHAT_RETENTION_DAYS_KEY, payload.ai_chat_retention_days),
    ):
        if value is not None:
            await set_app_setting(session, key, str(value), user)
    if payload.ai_access_disabled is not None:
        await set_app_setting(
            session, AI_ACCESS_DISABLED_KEY,
            "true" if payload.ai_access_disabled else "false", user,
        )
    await session.commit()
    return await _to_out(session)


def _entry_payload(entry: "CatalogEntryIn | str") -> object:
    """PUT 페이로드 항목 → 정규화 입력(str 그대로 / 모델은 dict)."""
    return entry if isinstance(entry, str) else entry.model_dump()
