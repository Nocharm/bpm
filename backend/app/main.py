"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session, init_models
from app.models import DeptInfo, Employee, LoginRecord
from app.permissions.access import can_view_dashboard_db
from app.permissions.logic import is_sysadmin, org_path
from app.routers import (
    admin,
    ai,
    ai_sessions,
    app_settings,
    embed,
    approvers,
    checkout,
    comments,
    dashboard,
    directory,
    employees,
    feedback,
    graph,
    groups,
    inbox,
    interviews,
    library,
    manual,
    maps,
    notices,
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
app.include_router(ai_sessions.router)
app.include_router(app_settings.router)
app.include_router(embed.router)
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
app.include_router(notices.router)
app.include_router(inbox.router)
app.include_router(interviews.router)
app.include_router(manual.router)
app.include_router(dashboard.router)
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
    # 내 상위 부서장 체인 — org 레벨(리프→루트) 순으로 dept_info.manager 수집, 본인·빈값 제외
    manager_ids: list[str] = []
    if emp:
        level_names = [
            lv for lv in (emp.org_l5, emp.org_l4, emp.org_l3, emp.org_l2, emp.org_l1) if lv
        ]
        if level_names:
            infos = {
                d.department: d.manager
                for d in (
                    await session.scalars(
                        select(DeptInfo).where(DeptInfo.department.in_(level_names))
                    )
                ).all()
            }
            for name in level_names:
                manager = infos.get(name, "")
                if manager and manager != login_id and manager not in manager_ids:
                    manager_ids.append(manager)
    return MeOut(
        username=login_id,
        ai_enabled=settings.ai_enabled,
        manual_url=settings.manual_url,
        csv_manual_url=settings.csv_manual_url,
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
        can_view_dashboard=await can_view_dashboard_db(session, login_id),
        manager_ids=manager_ids,
    )
