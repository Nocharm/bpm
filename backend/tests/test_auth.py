"""Auth gating tests — 토큰 검증은 auth_enabled일 때만 동작."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def test_api_open_when_auth_disabled(client: TestClient) -> None:
    # 기본(로컬) 설정 — 토큰 없이도 접근 가능
    assert client.get("/api/maps").status_code == 200


def test_api_requires_token_when_auth_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "auth_enabled", True)

    response = client.get("/api/maps")

    assert response.status_code == 401


def test_health_skips_auth(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "auth_enabled", True)

    assert client.get("/api/health").status_code == 200
