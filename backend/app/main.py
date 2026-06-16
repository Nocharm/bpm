"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session, init_models
from app.models import Employee
from app.routers import ai, approvers, comments, employees, graph, maps, notifications, versions
from app.schemas import MeOut
from app.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_models()
    # 로컬(인증 OFF)은 임시 유저 5명 시드 — role별 테스트용
    if not settings.auth_enabled:
        from app.ad.service import seed_local_employees
        from app.db import SessionLocal

        async with SessionLocal() as session:
            await seed_local_employees(session)
    yield


app = FastAPI(title="BPM API", lifespan=lifespan)
app.include_router(ai.router)
app.include_router(maps.router)
app.include_router(versions.router)
app.include_router(graph.router)
app.include_router(comments.router)
app.include_router(employees.router)
app.include_router(approvers.router)
app.include_router(notifications.router)


@app.get("/api/health")
async def check_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me", response_model=MeOut)
async def get_me(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MeOut:
    # 인증 ON + LDAP 설정 시 로그인 시점 1인 동기화 (로컬은 skip)
    if settings.auth_enabled and settings.ldap_enabled:
        from app.ad.service import sync_one

        await sync_one(session, login_id)
    emp = await session.get(Employee, login_id)
    return MeOut(
        username=login_id,
        ai_enabled=settings.ai_enabled,
        name=emp.name if emp else login_id,
        role=emp.role if emp else "user",
        department=emp.department if emp else "",
    )
