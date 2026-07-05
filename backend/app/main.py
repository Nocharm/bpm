"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session, init_models
from app.models import Employee, LoginRecord
from app.permissions.logic import is_sysadmin, org_path
from app.routers import (
    admin,
    ai,
    approvers,
    checkout,
    comments,
    directory,
    employees,
    feedback,
    graph,
    groups,
    library,
    maps,
    notifications,
    permissions,
    versions,
)
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
app.include_router(admin.router)
app.include_router(ai.router)
app.include_router(maps.router)
app.include_router(versions.router)
app.include_router(checkout.router)
app.include_router(graph.router)
app.include_router(comments.router)
app.include_router(directory.router)
app.include_router(employees.router)
app.include_router(approvers.router)
app.include_router(notifications.router)
app.include_router(feedback.router)
app.include_router(library.router)
app.include_router(permissions.router)
app.include_router(groups.router)


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
    # 로그인/활동 기록 — 현황조사용. /me는 앱 로드(새 탭·새로고침·토큰갱신)마다 호출되므로
    # 하루 1건으로 중복제거(KST 기준 자정 이후 기록 없을 때만 추가) = "그날 접속" 단위.
    day_start = now_kst().replace(hour=0, minute=0, second=0, microsecond=0)
    already = await session.scalar(
        select(LoginRecord.id)
        .where(LoginRecord.login_id == login_id, LoginRecord.occurred_at >= day_start)
        .limit(1)
    )
    if already is None:
        session.add(LoginRecord(login_id=login_id, name=emp.name if emp else None))
        await session.commit()
    return MeOut(
        username=login_id,
        ai_enabled=settings.ai_enabled,
        name=emp.name if emp else login_id,
        role=emp.role if emp else "user",
        department=emp.department if emp else "",
        # 부서 소속 판정용 org_path(루트→리프) — 프론트 멤버 하이라이트(HM-2)
        org_path=(
            org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
            if emp
            else ""
        ),
        is_sysadmin=is_sysadmin(login_id),
    )
