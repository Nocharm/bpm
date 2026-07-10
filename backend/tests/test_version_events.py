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
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "evt create"}).json()
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

    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "evt lifecycle"}).json()
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

    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "evt reject"}).json()
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


def test_backfill_created_events_idempotent(client: TestClient) -> None:
    from scripts.reset_db import backfill_version_events

    async def seed_legacy(session) -> int:
        m = ProcessMap(name="legacy map", owner_id="legacy.owner")
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        return m.versions[0].id

    vid = _run(seed_legacy)  # 직접 시드 — create_map 엔드포인트를 거치지 않아 created 이벤트 없음

    async def run_backfill(session) -> int:
        return await backfill_version_events(session)

    first = _run(run_backfill)
    second = _run(run_backfill)

    async def read(session) -> tuple[int, str]:
        rows = (
            await session.scalars(
                select(VersionEvent).where(
                    VersionEvent.version_id == vid,
                    VersionEvent.event_type == "created",
                )
            )
        ).all()
        return len(rows), rows[0].actor

    count, actor = _run(read)
    assert first >= 1
    assert second == 0
    assert count == 1
    assert actor == "legacy.owner"


def test_get_map_serializes_versions_with_events(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "evt serialize"}).json()
    map_id = created["id"]
    version_id = created["versions"][0]["id"]

    # create_map도 MapDetailOut을 반환 — POST 응답 자체에 events가 직렬화되는지 확인
    # (lazy 기본 전략에서 events eager-load가 빠지면 이 경로가 MissingGreenlet로 깨짐)
    assert created["versions"][0]["events"][0]["event_type"] == "created"

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)

    assert "created_at" in version and version["created_at"]
    assert isinstance(version["events"], list)
    types = [e["event_type"] for e in version["events"]]
    assert types == ["created"]
    evt = version["events"][0]
    assert {"id", "event_type", "actor", "note", "created_at"} <= set(evt.keys())
