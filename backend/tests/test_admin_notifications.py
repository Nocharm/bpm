"""/api/admin/notifications/purge-preview + purge — sysadmin 기간 퍼지 (design 2026-07-16)."""

import asyncio
from collections.abc import Iterator
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.clock import KST
from app.db import SessionLocal
from app.models import Notification
from app.settings import settings

SYSADMIN = "admin.purge"


@pytest.fixture()
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    prev_user = settings.dev_user
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    settings.dev_user = SYSADMIN
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    settings.dev_user = prev_user


def _seed(recipient: str, type_: str, message: str, day: int) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(
                Notification(
                    recipient=recipient,
                    type=type_,
                    message=message,
                    created_at=datetime(2026, 6, day, 12, 0, tzinfo=KST),
                )
            )
            await session.commit()

    asyncio.run(_run())


def test_purge_preview_groups_by_type_message(
    client: TestClient, sysadmin_enforced: None
) -> None:
    _seed("pg-u1", "notice", "june notice", 5)
    _seed("pg-u2", "notice", "june notice", 6)
    _seed("pg-u3", "published", "pv published", 6)
    _seed("pg-u4", "notice", "outside", 20)  # 범위 밖

    res = client.get("/api/admin/notifications/purge-preview?from=2026-06-01&to=2026-06-10")
    assert res.status_code == 200
    groups = {(g["type"], g["message"]): g["count"] for g in res.json()}
    assert groups[("notice", "june notice")] == 2  # 수신자 2명 → 1묶음 count 2
    assert groups[("published", "pv published")] == 1
    assert ("notice", "outside") not in groups


def test_purge_deletes_only_confirmed_groups_in_range(
    client: TestClient, sysadmin_enforced: None
) -> None:
    _seed("pp-u1", "notice", "kill me", 5)
    _seed("pp-u2", "notice", "kill me", 6)
    _seed("pp-u3", "notice", "keep me", 6)
    _seed("pp-u4", "notice", "kill me", 20)  # 범위 밖 — 생존해야 함

    res = client.post(
        "/api/admin/notifications/purge",
        json={
            "from": "2026-06-01",
            "to": "2026-06-10",
            "groups": [{"type": "notice", "message": "kill me"}],
        },
    )
    assert res.status_code == 200 and res.json()["deleted"] == 2

    settings.dev_user = "pp-u3"
    assert [n["message"] for n in client.get("/api/notifications").json()] == ["keep me"]
    settings.dev_user = "pp-u4"
    assert len(client.get("/api/notifications").json()) == 1


def test_purge_non_sysadmin_403_and_empty_groups_422(
    client: TestClient, sysadmin_enforced: None
) -> None:
    settings.dev_user = "pg-nobody"
    assert client.get(
        "/api/admin/notifications/purge-preview?from=2026-06-01&to=2026-06-10"
    ).status_code == 403
    settings.dev_user = SYSADMIN
    assert client.post(
        "/api/admin/notifications/purge",
        json={"from": "2026-06-01", "to": "2026-06-10", "groups": []},
    ).status_code == 422
