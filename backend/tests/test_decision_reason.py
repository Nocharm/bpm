"""ApprovalRequest 거절 사유 저장 + 알림 동봉 (spec 2026-08-14 §3.2)."""

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Notification

_seq = 0


def _create_map(client: TestClient) -> int:
    global _seq
    _seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"dr map {_seq}"},
    ).json()["id"]


def _create_rename_request(client: TestClient, map_id: int) -> int:
    res = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": f"renamed {_seq}"})
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _fetch_notifications(map_id: int, type_: str) -> list[Notification]:
    async def _q() -> list[Notification]:
        async with SessionLocal() as session:
            rows = await session.scalars(
                select(Notification).where(
                    Notification.map_id == map_id, Notification.type == type_
                )
            )
            return list(rows)

    return asyncio.run(_q())


def test_reject_stores_reason_and_appends_to_notification(client: TestClient) -> None:
    map_id = _create_map(client)
    req_id = _create_rename_request(client, map_id)

    res = client.post(
        f"/api/approval-requests/{req_id}/decide",
        json={"decision": "reject", "reason": "duplicate name policy"},
    )

    assert res.status_code == 200
    assert res.json()["decision_reason"] == "duplicate name policy"
    notes = _fetch_notifications(map_id, "rename_rejected")
    assert notes and notes[-1].message.endswith(": duplicate name policy")


def test_reject_without_reason_backward_compatible(client: TestClient) -> None:
    map_id = _create_map(client)
    req_id = _create_rename_request(client, map_id)

    res = client.post(f"/api/approval-requests/{req_id}/decide", json={"decision": "reject"})

    assert res.status_code == 200
    assert res.json()["decision_reason"] is None
    notes = _fetch_notifications(map_id, "rename_rejected")
    assert notes and notes[-1].message.endswith("was rejected")
