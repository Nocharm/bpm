"""AUTH_MODE 해석과 모드 공개 엔드포인트."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


@pytest.fixture
def restore_auth_settings():
    """settings를 런타임에 바꾸는 테스트용 — 원복 보장."""
    saved = (settings.auth_mode, settings.auth_enabled)
    yield
    settings.auth_mode, settings.auth_enabled = saved


def test_resolved_mode_falls_back_to_auth_enabled_true(restore_auth_settings):
    settings.auth_mode = ""
    settings.auth_enabled = True
    assert settings.resolved_auth_mode() == "keycloak"


def test_resolved_mode_falls_back_to_auth_enabled_false(restore_auth_settings):
    settings.auth_mode = ""
    settings.auth_enabled = False
    assert settings.resolved_auth_mode() == "dev"


def test_explicit_mode_wins_over_auth_enabled(restore_auth_settings):
    settings.auth_mode = "ldap"
    settings.auth_enabled = False
    assert settings.resolved_auth_mode() == "ldap"


def test_unknown_mode_is_rejected(restore_auth_settings):
    settings.auth_mode = "bogus"
    with pytest.raises(ValueError, match="unknown AUTH_MODE"):
        settings.resolved_auth_mode()


def test_mode_endpoint_needs_no_auth(client: TestClient, restore_auth_settings):
    settings.auth_mode = "ldap"
    res = client.get("/api/auth/mode")
    assert res.status_code == 200
    body = res.json()
    assert body["mode"] == "ldap"
    assert "keycloakIssuer" in body and "keycloakClientId" in body
