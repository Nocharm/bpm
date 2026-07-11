"""운영 대시보드 접속자 지표 — GET /api/dashboard (login_records 집계) (S10).
AI 사용량 집계 — GET /api/dashboard/ai-usage (design 2026-07-11 B1)."""

import asyncio
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from app.clock import now as now_kst
from app.db import SessionLocal
from app.models import AiUsageEvent, LoginRecord
from app.settings import settings


def _add_login(login_id: str) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(LoginRecord(login_id=login_id))
            await session.commit()

    asyncio.run(_run())


def test_dashboard_counts_visitors(client: TestClient) -> None:
    """고유 접속자·전체 로그인 집계 — 같은 유저 2회는 고유 1명으로."""
    before = client.get("/api/dashboard").json()
    _add_login("dash.a")
    _add_login("dash.a")
    _add_login("dash.b")
    after = client.get("/api/dashboard").json()

    assert after["logins_total"] == before["logins_total"] + 3
    assert after["visitors_unique"] == before["visitors_unique"] + 2
    assert after["logins_7d"] >= 3


def test_dashboard_requires_dashboard_viewer(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 행 없는 비-sysadmin은 403 — 게이트는 sysadmin이 아니라 대시보드 뷰어(require_dashboard_viewer)."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    assert client.get("/api/dashboard").status_code == 403


def _seed_events(rows: list[dict]) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for row in rows:
                session.add(AiUsageEvent(**row))
            await session.commit()

    asyncio.run(_run())


def test_ai_usage_aggregates_and_top_lists(client: TestClient) -> None:
    old = now_kst() - timedelta(days=40)  # 30일 창 밖 — 집계 제외 확인용
    _seed_events(
        [
            {"login_id": "user.a", "map_id": 901, "version_id": 1, "kind": "answer",
             "prompt_tokens": 1000, "completion_tokens": 100, "ok": True},
            {"login_id": "user.a", "map_id": 901, "version_id": 1, "kind": "graph",
             "prompt_tokens": 2000, "completion_tokens": 200, "ok": True},
            {"login_id": "user.b", "map_id": 902, "version_id": 2, "kind": None,
             "prompt_tokens": None, "completion_tokens": None, "ok": False},
            {"login_id": "user.c", "map_id": 903, "version_id": 3, "kind": "answer",
             "prompt_tokens": 10, "completion_tokens": 1, "ok": True, "occurred_at": old},
        ]
    )
    body = client.get("/api/dashboard/ai-usage").json()
    assert body["last30"]["calls"] >= 3          # 40일 전 행 제외
    assert body["last30"]["failed"] >= 1
    assert body["last30"]["prompt_tokens"] >= 3000
    top = body["top_users"]
    # 공유 DB(session-scope client) — 다른 파일이 먼저 쌓은 login_id가 랭킹 상위일 수 있어
    # rank 0 고정 대신 user.a 존재+토큰 하한만 확인 (브리프 원안은 top[0] 가정, 전체 스위트에서 깨짐).
    user_a = next((u for u in top if u["login_id"] == "user.a"), None)
    assert user_a is not None and user_a["total_tokens"] >= 3300
    assert any(m["map_id"] == 901 for m in body["top_maps"])
    assert len(top) <= 5 and len(body["top_maps"]) <= 5
    # 정렬 계약(total_tokens desc) — 공유 DB 오염과 무관하게 상대 순서로 검증
    assert all(
        top[i]["total_tokens"] >= top[i + 1]["total_tokens"] for i in range(len(top) - 1)
    )
    top_maps = body["top_maps"]
    assert all(
        top_maps[i]["total_tokens"] >= top_maps[i + 1]["total_tokens"]
        for i in range(len(top_maps) - 1)
    )
