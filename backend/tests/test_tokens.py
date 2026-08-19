"""자체 HS256 세션 토큰 발급·검증."""

from datetime import timedelta

import jwt
import pytest

from app import tokens
from app.clock import now as now_kst
from app.settings import settings


@pytest.fixture
def signing_secret():
    saved = settings.auth_jwt_secret
    settings.auth_jwt_secret = "test-secret-please-ignore"
    yield
    settings.auth_jwt_secret = saved


def test_roundtrip_returns_login_id(signing_secret):
    token, expires_at = tokens.create_access_token("consultant.a")
    assert tokens.decode_access_token(token) == "consultant.a"
    assert expires_at > now_kst()


def test_tampered_token_is_rejected(signing_secret):
    token, _ = tokens.create_access_token("consultant.a")
    forged = jwt.encode({"sub": "admin.kim"}, "wrong-secret", algorithm="HS256")
    with pytest.raises(ValueError):
        tokens.decode_access_token(forged)
    # 원본은 여전히 유효 — 위조만 걸러진다
    assert tokens.decode_access_token(token) == "consultant.a"


def test_expired_token_is_rejected(signing_secret):
    past = now_kst() - timedelta(hours=1)
    expired = jwt.encode(
        {"sub": "consultant.a", "exp": past}, settings.auth_jwt_secret, algorithm="HS256"
    )
    with pytest.raises(ValueError, match="expired"):
        tokens.decode_access_token(expired)


def test_empty_secret_refuses_to_sign():
    saved = settings.auth_jwt_secret
    settings.auth_jwt_secret = ""
    try:
        with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
            tokens.create_access_token("consultant.a")
    finally:
        settings.auth_jwt_secret = saved


def test_ldap_mode_accepts_self_issued_token(client, signing_secret):
    from app.settings import settings as s

    saved_mode = s.auth_mode
    s.auth_mode = "ldap"
    try:
        token, _ = tokens.create_access_token("local-dev")
        res = client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["username"] == "local-dev"

        res_bad = client.get("/api/me", headers={"Authorization": "Bearer nonsense"})
        assert res_bad.status_code == 401
    finally:
        s.auth_mode = saved_mode


def test_ldap_mode_without_secret_refuses_to_start():
    """기동 게이트 — lifespan이 올라가기 전에 막힌다."""
    from fastapi.testclient import TestClient

    from app.main import app
    from app.settings import settings as s

    saved = (s.auth_mode, s.auth_jwt_secret)
    s.auth_mode = "ldap"
    s.auth_jwt_secret = ""
    try:
        with pytest.raises(RuntimeError, match="AUTH_JWT_SECRET"):
            with TestClient(app):
                pass
    finally:
        s.auth_mode, s.auth_jwt_secret = saved
