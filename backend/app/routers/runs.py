"""실행 체크(Run) 라우터 — 만들기·읽기·목록·노드 동작·코멘트·관리. 규칙은 `run_service`·`run_manage`가 정한다 (design 2026-11-04 §4.2·§4.4)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app import run_manage, run_service
from app.auth import get_current_user
from app.db import get_session
from app.permissions.deps import require_map_role
from app.routers.graph import _load_graph
from app.schemas import (
    GraphOut,
    RunActionIn,
    RunCommentIn,
    RunCommentOut,
    RunCreateIn,
    RunDetailOut,
    RunListOut,
    RunParticipantsIn,
    RunPatchIn,
    RunShareIn,
)

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


@router.post("/runs/{run_id}/actions", response_model=RunDetailOut)
async def act_on_run(
    run_id: int,
    body: RunActionIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    """노드 동작 하나 — 실행 행을 잠가 공유 실행의 동시 변경을 한 줄로 세우고, 서버가 전이를 다시 판정한다."""
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_service.apply_run_action(session, run, user, body)
    return await run_service.build_run_detail(session, run, user)


@router.get("/runs/{run_id}/graph", response_model=GraphOut)
async def get_run_graph(
    run_id: int,
    scope: str = Query(default="", max_length=300),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> GraphOut:
    """범위의 그래프 — 하위 범위는 고정본이 있으면 그것, 없으면 지금 해석한 버전(보기만으로는 고정하지 않는다)."""
    run = await run_service.load_visible_run(session, run_id, user)
    version_id = await run_service.resolve_scope_version(session, run, scope, user)
    return await _load_graph(session, version_id, user)


@router.get("/runs/{run_id}/comments", response_model=list[RunCommentOut])
async def get_run_comments(
    run_id: int,
    scope: str | None = Query(default=None, max_length=300),
    node_id: str | None = Query(default=None, max_length=50),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[RunCommentOut]:
    """코멘트 목록(오래된 순) — scope를 주면 그 범위만(볼 수 없으면 403), 안 주면 볼 수 있는 범위 전부. 닫힌 실행도 읽는다."""
    run = await run_service.load_visible_run(session, run_id, user)
    return await run_manage.list_run_comments(session, run, user, scope_path=scope, node_id=node_id)


@router.post("/runs/{run_id}/comments", response_model=RunCommentOut, status_code=201)
async def add_run_comment(
    run_id: int,
    body: RunCommentIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunCommentOut:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    return await run_manage.create_run_comment(session, run, user, body)


@router.patch("/runs/{run_id}", response_model=RunDetailOut)
async def update_run(
    run_id: int,
    body: RunPatchIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    """이름(시작한 사람)·영구 보존(시작한 사람/공유는 맵 오너)·내 알림 끄기(참여자 본인)."""
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.update_run(session, run, user, body)
    return await run_service.build_run_detail(session, run, user)


@router.post("/runs/{run_id}/share", response_model=RunDetailOut)
async def share_run(
    run_id: int,
    body: RunShareIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.share_run(session, run, user, body)
    return await run_service.build_run_detail(session, run, user)


@router.post("/runs/{run_id}/participants", response_model=RunDetailOut)
async def update_run_participants(
    run_id: int,
    body: RunParticipantsIn,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.update_run_participants(session, run, user, body)
    return await run_service.build_run_detail(session, run, user)


@router.post("/runs/{run_id}/stop", response_model=RunDetailOut)
async def stop_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.stop_run(session, run, user)
    return await run_service.build_run_detail(session, run, user)


@router.post("/runs/{run_id}/reopen", response_model=RunDetailOut)
async def reopen_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> RunDetailOut:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.reopen_run(session, run, user)
    return await run_service.build_run_detail(session, run, user)


@router.delete("/runs/{run_id}", status_code=204)
async def delete_run(
    run_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> None:
    run = await run_service.load_visible_run(session, run_id, user, lock=True)
    await run_manage.delete_run(session, run, user)
