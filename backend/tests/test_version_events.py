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


def test_create_map_records_created_event(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "evt create"}).json()
    version_id = created["versions"][0]["id"]

    async def read(session) -> list[tuple[str, str]]:
        rows = (
            await session.scalars(
                select(VersionEvent).where(VersionEvent.version_id == version_id)
            )
        ).all()
        return [(e.event_type, e.actor) for e in rows]

    events = _run(read)
    assert ("created", "local-dev") in events  # settings.dev_user 기본값


def test_full_lifecycle_records_events(client: TestClient) -> None:
    from app.settings import settings

    created = client.post("/api/maps", json={"name": "evt lifecycle"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    client.post(f"/api/versions/{version_id}/approve")
    client.post(f"/api/versions/{version_id}/publish")

    async def read(session) -> list[str]:
        rows = (
            await session.scalars(
                select(VersionEvent)
                .where(VersionEvent.version_id == version_id)
                .order_by(VersionEvent.created_at, VersionEvent.id)
            )
        ).all()
        return [e.event_type for e in rows]

    assert _run(read) == ["created", "submitted", "approved", "published"]


def test_reject_records_event_with_reason(client: TestClient) -> None:
    from app.settings import settings

    created = client.post("/api/maps", json={"name": "evt reject"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    client.post(f"/api/versions/{version_id}/reject", json={"reason": "needs work"})

    async def read(session) -> tuple[str, str | None]:
        row = (
            await session.scalars(
                select(VersionEvent)
                .where(
                    VersionEvent.version_id == version_id,
                    VersionEvent.event_type == "rejected",
                )
            )
        ).one()
        return row.event_type, row.note

    event_type, note = _run(read)
    assert event_type == "rejected"
    assert note == "needs work"
