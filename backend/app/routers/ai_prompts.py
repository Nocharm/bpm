"""AI 프롬프트 관리 API — sysadmin이 시스템 프롬프트를 열람·오버라이드·기본값 복원 (설계: 2026-08-04-ai-prompts-admin-design.md)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import AiPrompt
from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults
from app.schemas import AiPromptOut, AiPromptUpdate

router = APIRouter(
    prefix="/api",
    tags=["ai-prompts"],
    dependencies=[Depends(get_current_user), Depends(require_sysadmin)],
)


def _to_out(key: str, row: AiPrompt | None, default: str) -> AiPromptOut:
    if row is None:
        return AiPromptOut(key=key, content=default, is_customized=False)
    return AiPromptOut(
        key=key, content=row.content, is_customized=True,
        updated_by=row.updated_by, updated_at=row.updated_at,
    )


def _ensure_known_key(key: str) -> None:
    if key not in PROMPT_KEYS:
        raise HTTPException(status_code=404, detail=f"unknown prompt key: {key}")


@router.get("/admin/ai-prompts", response_model=list[AiPromptOut])
async def list_ai_prompts(session: AsyncSession = Depends(get_session)) -> list[AiPromptOut]:
    rows = {row.key: row for row in (await session.scalars(select(AiPrompt))).all()}
    defaults = get_prompt_defaults()
    return [_to_out(key, rows.get(key), defaults[key]) for key in PROMPT_KEYS]


@router.put("/admin/ai-prompts/{key}", response_model=AiPromptOut)
async def put_ai_prompt(
    key: str,
    payload: AiPromptUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiPromptOut:
    _ensure_known_key(key)
    row = await session.get(AiPrompt, key)
    if row is None:
        row = AiPrompt(key=key, content=payload.content, updated_by=user)
        session.add(row)
    else:
        row.content = payload.content
        row.updated_by = user
    await session.commit()
    await session.refresh(row)
    return _to_out(key, row, "")


@router.delete("/admin/ai-prompts/{key}", response_model=AiPromptOut)
async def reset_ai_prompt(
    key: str, session: AsyncSession = Depends(get_session)
) -> AiPromptOut:
    """오버라이드 행 삭제 = 코드 기본값 복원. 행이 없어도 200(멱등)."""
    _ensure_known_key(key)
    row = await session.get(AiPrompt, key)
    if row is not None:
        await session.delete(row)
        await session.commit()
    return _to_out(key, None, get_prompt_defaults()[key])
