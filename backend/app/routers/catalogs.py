"""관리 목록(카탈로그) 읽기 API — 에디터 자동완성(역할·시스템) 소스. 로그인 유저 전원."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems
from app.auth import get_current_user
from app.db import get_session
from app.schemas import CatalogsOut

router = APIRouter(prefix="/api", tags=["catalogs"], dependencies=[Depends(get_current_user)])


@router.get("/catalogs", response_model=CatalogsOut)
async def get_catalogs(session: AsyncSession = Depends(get_session)) -> CatalogsOut:
    return CatalogsOut(
        assignee_roles=await get_assignee_roles(session),
        systems=await get_systems(session),
    )
