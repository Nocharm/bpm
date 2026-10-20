"""내장 HR 스케줄러 테스트 — 루프가 run_full_sync를 호출하고 예외에 견디는지, 첫 회차를 마지막 기록에서 잇는지."""

import asyncio
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from app.clock import KST

from app.settings import settings


def test_sync_loop_calls_full_sync_and_survives_errors(client: TestClient, monkeypatch) -> None:
    from app import main as main_mod
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.local/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    monkeypatch.setattr(settings, "hr_sync_interval_hours", 1)
    calls = {"n": 0}

    async def fake_full_sync(session):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("boom")  # 1회차 실패 — 루프 생존 확인
        raise asyncio.CancelledError    # 2회차에서 루프 탈출

    monkeypatch.setattr(hr_service, "run_full_sync", fake_full_sync)

    async def fast_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(main_mod.asyncio, "sleep", fast_sleep)

    async def _run() -> None:
        try:
            await main_mod._run_hr_sync_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_run())
    assert calls["n"] == 2


def test_first_run_continues_from_the_last_recorded_run() -> None:
    """기동마다 한 주기를 새로 기다려 배포가 잦으면 자동 동기화가 돌지 않았다 (리뷰 2026-10-19)."""
    from app.main import HR_SYNC_STARTUP_GRACE_SECONDS, get_first_hr_sync_delay

    now = datetime(2026, 10, 20, 9, 0, tzinfo=KST)
    day = 24 * 3600
    assert get_first_hr_sync_delay(None, now, day) == day  # 첫 설치 — 수동 절차 뒤 한 주기
    assert get_first_hr_sync_delay(now - timedelta(hours=20), now, day) == 4 * 3600
    assert get_first_hr_sync_delay(now - timedelta(days=3), now, day) == HR_SYNC_STARTUP_GRACE_SECONDS
    # sqlite는 시간대 없는 KST 벽시계로 돌려준다
    assert get_first_hr_sync_delay(datetime(2026, 10, 19, 21, 0), now, day) == 12 * 3600
