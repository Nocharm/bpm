"""내장 HR 스케줄러 테스트 — sleep-first 루프가 run_full_sync를 호출하고 예외에 견디는지."""

import asyncio

from fastapi.testclient import TestClient

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
