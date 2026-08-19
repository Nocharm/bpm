"""AD 사용자 bind — 실제 LDAP 서버 없이 ldap3 연결을 대체해 검증."""

import pytest

from app.ad import client
from app.settings import settings


@pytest.fixture
def ldap_configured(monkeypatch):
    monkeypatch.setattr(settings, "ldap_url", "ldap://ad.example.test")
    monkeypatch.setattr(settings, "ldap_bind_dn", "CN=svc,DC=example,DC=test")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "svc-pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "DC=example,DC=test")


def test_empty_password_is_rejected_without_touching_ldap(ldap_configured, monkeypatch):
    """LDAP unauthenticated bind는 빈 비밀번호에 성공을 돌려준다 — 서버에 닿기 전에 막는다."""

    def _explode(*args, **kwargs):
        raise AssertionError("must not reach LDAP for an empty password")

    monkeypatch.setattr(client, "_find_user_dn", _explode)
    assert client.authenticate_user("consultant.a", "") is False


def test_returns_false_when_user_dn_not_found(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: None)
    assert client.authenticate_user("ghost", "pw") is False


def test_returns_true_when_user_bind_succeeds(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: "CN=A,DC=example,DC=test")
    monkeypatch.setattr(client, "_try_bind", lambda user_dn, password: True)
    assert client.authenticate_user("consultant.a", "pw") is True


def test_returns_false_when_user_bind_fails(ldap_configured, monkeypatch):
    monkeypatch.setattr(client, "_find_user_dn", lambda login_id: "CN=A,DC=example,DC=test")
    monkeypatch.setattr(client, "_try_bind", lambda user_dn, password: False)
    assert client.authenticate_user("consultant.a", "wrong") is False


def test_returns_false_when_ldap_not_configured(monkeypatch):
    monkeypatch.setattr(settings, "ldap_url", "")
    assert client.authenticate_user("consultant.a", "pw") is False
