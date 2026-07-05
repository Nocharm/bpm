"""운영 대시보드 접속자 지표 — GET /api/dashboard (login_records 집계) (S10)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import LoginRecord
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


def test_dashboard_requires_sysadmin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """비-sysadmin은 403 — 권한검증 ON + sysadmin=타인(baseline은 전원 sysadmin)."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    assert client.get("/api/dashboard").status_code == 403
