"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

import asyncio
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_exposed_positions, is_ai_access_enabled
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import SessionLocal, get_session, init_models
from app.models import Employee, LoginRecord
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic
from app.permissions.access import can_view_dashboard_db
from app.permissions.logic import is_sysadmin
from app.routers import (
    admin,
    ai,
    ai_prompts,
    ai_sessions,
    app_settings,
    auth as auth_router,
    categories,
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
    kb,
    library,
    local_accounts,
    manual,
    maps,
    notices,
    notifications,
    permissions,
    versions,
)
from app.schemas import MeOut
from app.settings import settings

logger = logging.getLogger(__name__)


async def _run_hr_sync_loop() -> None:
    """내장 HR 동기화 스케줄러 — sleep-first(첫 자동 실행은 1주기 후, 배포 직후 실동기화는 수동 절차 §9)."""
    from app.hr import service as hr_service

    interval = settings.hr_sync_interval_hours * 3600
    while True:
        await asyncio.sleep(interval)
        try:
            async with SessionLocal() as session:
                summary = await hr_service.run_full_sync(session)
                logger.info("scheduled HR sync: %s", summary)
        except hr_service.SyncTooSoon:
            pass  # 수동 sync 직후 겹침 — 다음 주기로
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 -- 주기 실패가 프로세스를 죽이면 안 됨
            logger.exception("scheduled HR sync failed — retrying next interval")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # ldap 모드인데 서명키가 없으면 위조가 자유로워진다 — 조용히 뜨는 대신 기동을 막는다 (설계 §7)
    if settings.resolved_auth_mode() == "ldap" and not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_MODE=ldap requires AUTH_JWT_SECRET to be set")
    await init_models()
    # 로컬(dev 모드)은 임시 유저 5명 시드 — role별 테스트용. ldap/keycloak은 실 계정을 쓰므로 시드 금지.
    if settings.resolved_auth_mode() == "dev":
        from app.ad.service import seed_local_employees

        async with SessionLocal() as session:
            await seed_local_employees(session)
    # 설정 화면 부여 sysadmin 캐시 로드 — 기동 시 1회 (설계 §3.1)
    async with SessionLocal() as session:
        await logic.load_granted_sysadmins(session)
    hr_task: asyncio.Task | None = None
    if settings.hr_enabled and settings.hr_sync_interval_hours > 0:
        hr_task = asyncio.create_task(_run_hr_sync_loop())
    yield
    if hr_task is not None:
        hr_task.cancel()


app = FastAPI(title="BPM API", lifespan=lifespan)
app.include_router(admin.router)
app.include_router(ai.router)
app.include_router(ai_sessions.router)
app.include_router(app_settings.router)
app.include_router(ai_prompts.router)
app.include_router(auth_router.router)
app.include_router(categories.router)
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
app.include_router(kb.router)
app.include_router(manual.router)
app.include_router(dashboard.router)
app.include_router(library.router)
app.include_router(local_accounts.router)
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
    # 실 인증(keycloak/ldap) + HR 웹훅 설정 시 로그인 시점 1인 동기화 — 하루 1회 스로틀은 서비스가 담당 (design §6)
    if settings.resolved_auth_mode() != "dev" and settings.hr_enabled:
        from app.hr.service import sync_one

        await sync_one(session, login_id)
    emp = await session.get(Employee, login_id)
    # departments 체인 우선 해석 — Task 4의 manager 체인도 같은 인덱스를 재사용한다.
    dept_index = await load_dept_index(session)
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
    # 나의 관리자 — 부서 체인(리프→루트)의 노출 직책 보유자 (설계 2026-08-11 §5)
    manager_ids: list[str] = []
    if emp and emp.dept_code and emp.dept_code in dept_index.by_code:
        chain_codes: list[str] = []
        cur: str | None = emp.dept_code
        while cur is not None and cur in dept_index.by_code and cur not in chain_codes and len(chain_codes) < 15:
            chain_codes.append(cur)
            cur = dept_index.by_code[cur][1]
        exposed = set(await get_exposed_positions(session))
        if exposed:
            leader_rows = (
                await session.execute(
                    select(Employee.login_id, Employee.dept_code).where(
                        Employee.dept_code.in_(chain_codes),
                        Employee.position.in_(exposed),
                        Employee.active.is_(True),
                    )
                )
            ).all()
            leaders_by_code: dict[str, list[str]] = {}
            for lid, dcode in leader_rows:
                leaders_by_code.setdefault(dcode, []).append(lid)
            for code in chain_codes:
                for lid in sorted(leaders_by_code.get(code, [])):
                    if lid != login_id and lid not in manager_ids:
                        manager_ids.append(lid)
    return MeOut(
        username=login_id,
        ai_enabled=await is_ai_access_enabled(session),  # env AND 관리자 차단 플래그
        manual_url=settings.manual_url,
        csv_manual_url=settings.csv_manual_url,
        name=emp.name if emp else login_id,
        role=emp.role if emp else "user",
        department=emp.department if emp else "",
        # 부서 소속 판정용 org_path(루트→리프) — 프론트 멤버 하이라이트(HM-2)
        org_path=resolve_org_path(emp, dept_index) if emp else "",
        is_sysadmin=is_sysadmin(login_id),
        can_view_dashboard=await can_view_dashboard_db(session, login_id),
        manager_ids=manager_ids,
    )
