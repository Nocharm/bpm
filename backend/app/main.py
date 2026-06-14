"""FastAPI app entrypoint — routes are mounted under /api (nginx pass-through)."""

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.auth import get_current_user
from app.db import init_models
from app.routers import approvers, comments, graph, maps, notifications, versions
from app.schemas import MeOut


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await init_models()
    yield


app = FastAPI(title="BPM API", lifespan=lifespan)
app.include_router(maps.router)
app.include_router(versions.router)
app.include_router(graph.router)
app.include_router(comments.router)
app.include_router(approvers.router)
app.include_router(notifications.router)


@app.get("/api/health")
async def check_health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/me", response_model=MeOut)
async def get_me(user: str = Depends(get_current_user)) -> MeOut:
    return MeOut(username=user)
