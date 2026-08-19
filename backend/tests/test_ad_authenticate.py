"""AD 사용자 bind — 실제 LDAP 서버 없이 ldap3 연결을 대체해 검증."""

import pytest
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

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


def test_returns_false_when_service_connection_fails(ldap_configured, monkeypatch):
    """AD 다운·잘못된 호스트·TLS 실패 등 서비스 계정 bind 자체가 못 열릴 때도 False로 수렴한다."""

    def _raise_connection_error() -> None:
        raise LDAPException("connection refused")

    monkeypatch.setattr(client, "_open_service_connection", _raise_connection_error)
    assert client.authenticate_user("consultant.a", "pw") is False


class _FakeConn:
    """search()에 전달된 인자만 기록하는 최소 스텁 — 실제 필터 문자열을 검증하기 위함."""

    def __init__(self) -> None:
        self.search_kwargs: dict | None = None
        self.entries: list = []

    def search(self, **kwargs):
        self.search_kwargs = kwargs

    def unbind(self) -> None:
        pass


def test_find_user_dn_escapes_ldap_filter_metacharacters(ldap_configured, monkeypatch):
    """검색 필터에 실제로 escape_filter_chars가 적용됐는지 — 미래 리팩터가 f-string으로 되돌려도 잡히게."""

    fake_conn = _FakeConn()
    monkeypatch.setattr(client, "_open_service_connection", lambda: fake_conn)

    malicious_login_id = "a*)(uid=*))(|(uid=*\\"
    client._find_user_dn(malicious_login_id)

    expected_filter = f"(sAMAccountName={escape_filter_chars(malicious_login_id)})"
    assert fake_conn.search_kwargs is not None
    assert fake_conn.search_kwargs["search_filter"] == expected_filter
    # 원본 메타문자가 그대로 필터에 섞여 들어가지 않았는지도 확인
    assert "*)(uid=*))(|(uid=*" not in fake_conn.search_kwargs["search_filter"]
