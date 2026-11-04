"""실행 체크(Run) 라우터 — 만들기·읽기·목록. 보기 규칙은 `run_service`가 정한다 (design 2026-11-04 §4.4)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import run_service
from app.auth import get_current_user
from app.db import get_session
from app.permissions.deps import require_map_role
from app.schemas import RunCreateIn, RunDetailOut, RunListOut

router = APIRouter(prefix="/api", tags=["runs"], dependencies=[Depends(get_current_user)])


@router.post(
    "/maps/{map_id}/runs",
    response_model=RunDetailOut,
    status_code=201,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def create_map_run(
    map_id: int,
    body: RunCreateIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    """맵을 볼 수 있는 누구나 게시본 위에서 실행을 시작한다 — 상한·참여자 검증은 서비스가 한다."""
    run = await run_service.create_run(session, map_id, user, body)
    return await run_service.build_run_detail(session, run, user)


@router.get(
    "/maps/{map_id}/runs",
    response_model=RunListOut,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def list_map_runs(
    map_id: int,
    tab: run_service.RunTab = "open",
    q: str = Query(default="", max_length=200),
    mine: bool = False,
    kept: bool = False,
    page: int = Query(default=1, ge=1),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunListOut:
    await run_service.load_live_map(session, map_id)
    return await run_service.list_runs(session, map_id, user, tab=tab, q=q, mine=mine, kept=kept, page=page)


@router.get("/runs/{run_id}", response_model=RunDetailOut)
async def get_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    run = await run_service.load_visible_run(session, run_id, user)
    return await run_service.build_run_detail(session, run, user)
