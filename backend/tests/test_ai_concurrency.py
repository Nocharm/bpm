"""전역 AI 동시성 세마포어 — call_ai가 ai_max_concurrency를 넘지 않는지."""

import asyncio

import pytest

from app import ai_client
from app.settings import settings


def test_call_ai_respects_concurrency_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_base_url", "http://fake")
    monkeypatch.setattr(settings, "ai_max_concurrency", 2)
    monkeypatch.setattr(ai_client, "_semaphores", {})  # 설정 반영 위해 재생성 유도

    active = 0
    peak = 0

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "{}"}}], "usage": {}}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return _FakeResponse()

    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", _FakeClient)

    async def _run() -> None:
        await asyncio.gather(*[ai_client.call_ai([{"role": "user", "content": "x"}]) for _ in range(6)])

    asyncio.run(_run())
    assert peak <= 2


def test_settings_have_interview_defaults() -> None:
    assert settings.ai_max_concurrency >= 1
    assert settings.interview_choice_count >= 1
    assert settings.interview_context_budget >= 1000
