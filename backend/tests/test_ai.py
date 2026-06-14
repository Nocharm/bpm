"""On-prem AI chat tests — AI server mocked via monkeypatch (design 2026-06-15)."""

from app.settings import settings


def test_ai_settings_default_disabled() -> None:
    assert settings.ai_enabled is False
    assert settings.ai_timeout_seconds == 60
