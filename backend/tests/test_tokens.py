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
    # TTL이 실제로 auth_jwt_ttl_hours만큼인지 — 5초 슬랙은 테스트 실행 시간 흡수용
    expected_expiry = now_kst() + timedelta(hours=settings.auth_jwt_ttl_hours)
    assert abs((expires_at - expected_expiry).total_seconds()) < 5


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


def test_keycloak_mode_rejects_self_issued_token(client, signing_secret, monkeypatch):
    """RS256 알고리즘 고정 — HS256 토큰은 서명·issuer가 실제값과 일치해도 alg가
    허용목록에 없어 거부된다 (총 우회 방지).

    keycloak_issuer가 비어 있으면 JWKS URL 자체가 무효라 _jwk_client()가 먼저 죽는데,
    그건 "URL 미설정"을 검증하는 것이지 알고리즘 고정을 검증하는 게 아니다(어떤 입력을
    넣어도 통과하는 가짜-그린). _jwk_client를 스텁으로 교체해 jwt.decode(...,
    algorithms=["RS256"])까지 실제로 도달시킨다. 서명키·issuer를 실제값과 동일하게
    맞춰 "alg만 다른" 최악의 위조 토큰을 만든다 — 그렇지 않으면 서명·issuer 검증이
    먼저 걸려 alg 검증을 실제로 통과했는지 알 수 없다.
    """
    from app import auth
    from app.settings import settings as s

    class _StubSigningKey:
        # 실제 서명키와 동일하게 둔다 — 그래야 "alg 허용목록만이 방어선"이라는 걸 증명할 수
        # 있다. 다른 값이면 서명 불일치로 우연히 401이 나 가짜-그린이 된다.
        key = s.auth_jwt_secret

    class _StubJwkClient:
        def get_signing_key_from_jwt(self, token: str) -> _StubSigningKey:
            return _StubSigningKey()

    # lru_cache가 감싼 실제 _jwk_client 대신 이름 자체를 교체 — 캐시를 건드리지 않으므로
    # 나머지 ~1090개 테스트에 오염이 남지 않는다(monkeypatch가 테스트 종료 시 자동 원복).
    monkeypatch.setattr(auth, "_jwk_client", lambda: _StubJwkClient())

    saved_mode = s.auth_mode
    s.auth_mode = "keycloak"
    try:
        # issuer까지 실제값과 맞춰 서명·issuer 검증은 모두 통과시키고 alg만 다르게 만든다.
        forged = jwt.encode(
            {"sub": "consultant.a", "iss": s.keycloak_issuer, "exp": now_kst() + timedelta(hours=1)},
            s.auth_jwt_secret,
            algorithm="HS256",
        )
        res = client.get("/api/me", headers={"Authorization": f"Bearer {forged}"})
        assert res.status_code == 401
        assert "invalid token" in res.json()["detail"]
    finally:
        s.auth_mode = saved_mode


def test_x_dev_user_ignored_outside_dev_mode(client):
    """X-Dev-User는 dev 모드 전용 — ldap·keycloak은 헤더 파라미터가 선언돼 있어도 무시하고 401."""
    from app.settings import settings as s

    saved_mode = s.auth_mode
    try:
        for mode in ("ldap", "keycloak"):
            s.auth_mode = mode
            res = client.get("/api/me", headers={"X-Dev-User": "admin.kim"})
            assert res.status_code == 401, f"mode={mode}"
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
