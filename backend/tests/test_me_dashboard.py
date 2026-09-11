"""GET /api/me/dashboard — 홈 개인 대시보드 집계(활동 카운터·점유·요청·최근 이벤트·체계 요약).

auth OFF(기본)에서는 X-Dev-User 헤더로 사용자를 바꾼다. 접근 필터가 필요한 시나리오는
test_framework_canvas의 enforce/act_as 관례(auth ON + sysadmin 1명)를 재사용한다.
"""

import asyncio
from collections.abc import Iterator
from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.clock import now as now_kst
from app.db import SessionLocal
from app.main import app
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    Feedback,
    LoginRecord,
    MapVersion,
    Notification,
    ProcessMap,
    VersionEvent,
)
from app.settings import settings
from tests.test_framework_canvas import SYSADMIN, _seed_category, _seed_l6_map, act_as


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def _get(client: TestClient, user: str) -> dict:
    res = client.get("/api/me/dashboard", headers={"X-Dev-User": user})
    assert res.status_code == 200, res.text
    return res.json()


def _create_map(client: TestClient, user: str, name: str) -> tuple[int, int]:
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": name},
        headers={"X-Dev-User": user},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    return body["id"], body["versions"][0]["id"]


def _run(coro) -> object:
    return asyncio.run(coro)


def test_empty_user_returns_zeros_and_empty_lists(client: TestClient, enforce: None) -> None:
    # auth OFF면 전원 sysadmin이라 공유 DB의 남의 맵/큐가 섞인다 — 권한 ON에서 무권한 신규 사용자로 본다
    act_as(f"md.empty.{uuid4().hex[:6]}")
    res = client.get("/api/me/dashboard")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["activity"] == {
        "approvals_pending": 0,
        "requests_pending": 0,
        "checkouts_held": 0,
        "unread_notifications": 0,
        "feedback_mine": 0,
        "feedback_mine_open": 0,
        "last_login_at": None,
    }
    assert body["checkouts"] == []
    assert body["requests"] == []
    assert body["recent_events"] == []
    assert body["framework"] == []


def test_activity_counts_after_seeding(client: TestClient) -> None:
    user = f"md.counts.{uuid4().hex[:6]}"
    other = f"md.other.{uuid4().hex[:6]}"
    map_id, version_id = _create_map(client, user, f"md-counts-{uuid4().hex[:6]}")
    _deleted_map_id, deleted_version_id = _create_map(client, user, f"md-deleted-{uuid4().hex[:6]}")
    other_map_id, _other_version_id = _create_map(client, other, f"md-other-{uuid4().hex[:6]}")
    today_start = now_kst().replace(hour=0, minute=0, second=0, microsecond=0)
    yesterday = today_start - timedelta(hours=5)

    async def _seed() -> None:
        async with SessionLocal() as session:
            ver = await session.get(MapVersion, version_id)
            ver.checked_out_by = user
            ver.checked_out_at = now_kst()
            # 소프트삭제 맵의 점유는 세지 않는다
            dead = await session.get(MapVersion, deleted_version_id)
            dead.checked_out_by = user
            dead_map = await session.get(ProcessMap, dead.map_id)
            dead_map.deleted_at = now_kst()
            # 내 점유 버전을 향한 이전 요청 2건(pending 1, decided 1) → waiting_requests=1
            session.add(CheckoutRequest(version_id=version_id, requested_by=other, status="pending"))
            session.add(CheckoutRequest(version_id=version_id, requested_by=other, status="approved"))
            # 내가 올린 pending 요청 — 승인 요청 1 + 점유권 이전 1, decided 요청은 제외
            session.add(ApprovalRequest(
                map_id=other_map_id, kind="visibility_change", payload={"to_visibility": "public"},
                requested_by=user, status="pending",
            ))
            session.add(ApprovalRequest(
                map_id=other_map_id, kind="map_rename", payload={"to_name": "x"},
                requested_by=user, status="approved",
            ))
            session.add(CheckoutRequest(version_id=_other_version_id, requested_by=user, status="pending"))
            session.add(Notification(recipient=user, type="test", read=False))
            session.add(Notification(recipient=user, type="test", read=False))
            session.add(Notification(recipient=user, type="test", read=True))
            session.add(Feedback(kind="bug", body="a", author=user, status="draft"))
            session.add(Feedback(kind="bug", body="b", author=user, status="done"))
            session.add(Feedback(kind="bug", body="c", author=other, status="draft"))
            session.add(LoginRecord(login_id=user, occurred_at=yesterday))
            session.add(LoginRecord(login_id=user, occurred_at=yesterday - timedelta(days=3)))
            session.add(LoginRecord(login_id=user, occurred_at=now_kst()))
            await session.commit()

    _run(_seed())

    body = _get(client, user)
    activity = body["activity"]
    assert activity["checkouts_held"] == 1
    assert activity["unread_notifications"] == 2
    assert activity["requests_pending"] == 2
    assert activity["feedback_mine"] == 2
    assert activity["feedback_mine_open"] == 1
    # sqlite는 tz를 버리고 KST 벽시계로 돌려준다 — 양쪽 tz를 떼고 비교
    got = datetime.fromisoformat(activity["last_login_at"]).replace(tzinfo=None)
    assert got == yesterday.replace(tzinfo=None)

    assert [c["version_id"] for c in body["checkouts"]] == [version_id]
    checkout = body["checkouts"][0]
    assert checkout["map_id"] == map_id
    assert checkout["waiting_requests"] == 1

    kinds = sorted(r["kind"] for r in body["requests"])
    assert kinds == ["checkout_transfer", "visibility_change"]
    assert all(r["map_id"] == other_map_id and r["status"] == "pending" for r in body["requests"])


def test_recent_events_limited_to_maps_i_own_or_edit(client: TestClient, enforce: None) -> None:
    me = f"md.me.{uuid4().hex[:6]}"
    stranger = f"md.stranger.{uuid4().hex[:6]}"
    act_as(me)
    my_map_id, my_version_id = _create_map(client, me, f"md-mine-{uuid4().hex[:6]}")
    act_as(stranger)
    _their_map_id, their_version_id = _create_map(client, stranger, f"md-theirs-{uuid4().hex[:6]}")

    async def _seed() -> None:
        async with SessionLocal() as session:
            # 내 맵: 타인 이벤트(노출) + 내 published(노출) + 내 created(숨김)
            session.add(VersionEvent(version_id=my_version_id, event_type="submitted", actor=stranger, note="hi"))
            session.add(VersionEvent(version_id=my_version_id, event_type="published", actor=me))
            # 접근 불가한 남의 private 맵 이벤트는 절대 나오지 않는다
            session.add(VersionEvent(version_id=their_version_id, event_type="submitted", actor=stranger))
            await session.commit()

    _run(_seed())

    act_as(me)
    res = client.get("/api/me/dashboard")
    assert res.status_code == 200, res.text
    events = res.json()["recent_events"]
    assert {e["map_id"] for e in events} == {my_map_id}
    assert sorted(e["event_type"] for e in events) == ["published", "submitted"]
    submitted = next(e for e in events if e["event_type"] == "submitted")
    assert submitted["actor"] == stranger
    assert submitted["note"] == "hi"
    assert submitted["version_id"] == my_version_id
    # create_map이 기록한 내 "created" 이벤트는 드래프트 잡음이라 제외
    assert "created" not in {e["event_type"] for e in events}


def test_framework_block_for_category_admin(client: TestClient, enforce: None) -> None:
    admin = f"md.catadmin.{uuid4().hex[:6]}"
    tag = uuid4().hex[:6]
    root = _seed_category(client, f"MD-ROOT-{tag}", "대시보드루트", level=4)
    l5_canvas = _seed_category(client, f"MD-L5A-{tag}", "캔버스있음", level=5, parent_id=root)
    _seed_category(client, f"MD-L5B-{tag}", "캔버스없음", level=5, parent_id=root)  # 캔버스 없는 L5
    l6_map_id = _seed_l6_map(client, l5_canvas, "대시보드업무1", f"MD-L5A-{tag}M1")
    act_as(SYSADMIN)
    res = client.put(
        f"/api/categories/{root}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": admin}]},
    )
    assert res.status_code == 200, res.text
    act_as(admin)
    canvas = client.post(f"/api/categories/{l5_canvas}/linkage-map")
    assert canvas.status_code == 200, canvas.text

    async def _seed_slot_request() -> None:
        async with SessionLocal() as session:
            session.add(ApprovalRequest(
                map_id=l6_map_id, kind="fw_slot",
                payload={"action": "unassign", "from_category_id": l5_canvas},
                requested_by=SYSADMIN, status="pending",
            ))
            await session.commit()

    _run(_seed_slot_request())

    act_as(admin)
    res = client.get("/api/me/dashboard")
    assert res.status_code == 200, res.text
    framework = res.json()["framework"]
    assert [f["category_id"] for f in framework] == [root]
    block = framework[0]
    assert block["name"] == "대시보드루트"
    assert block["level"] == 4
    assert block["linkage_map_id"] is None
    assert block["l5_count"] == 2
    # 캔버스는 열렸지만 confirmed 스냅샷이 없는 L5 1개 — 캔버스 없는 L5는 세지 않는다
    assert block["unconfirmed_count"] == 1
    assert block["slot_pending_count"] == 1
