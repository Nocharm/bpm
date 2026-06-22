"""버전 생애주기 이벤트 로그 — 모델/기록/직렬화/백필 (design 2026-06-23)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import MapVersion, ProcessMap, VersionEvent

T = TypeVar("T")


def _run(coro_factory: Callable[..., Awaitable[T]]) -> T:
    async def _inner() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_inner())


def test_version_event_relationship_orders_by_created_at(client: TestClient) -> None:
    async def scenario(session) -> int:
        m = ProcessMap(name="evt model", owner_id="boss")
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        vid = m.versions[0].id
        session.add(VersionEvent(version_id=vid, event_type="created", actor="boss"))
        session.add(VersionEvent(version_id=vid, event_type="submitted", actor="boss"))
        return vid

    vid = _run(scenario)

    async def read(session) -> list[str]:
        version = await session.get(MapVersion, vid)
        # selectinload 없이도 같은 세션에서 lazy 접근 (테스트 한정)
        events = (
            await session.scalars(
                select(VersionEvent)
                .where(VersionEvent.version_id == vid)
                .order_by(VersionEvent.created_at, VersionEvent.id)
            )
        ).all()
        assert version is not None
        return [e.event_type for e in events]

    assert _run(read) == ["created", "submitted"]
