"""ldap3 기반 AD 조회 — 블로킹. async 호출부는 asyncio.to_thread로 감싼다 (design 2026-06-16 §5.1)."""

from dataclasses import dataclass

from ldap3 import SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException
from ldap3.utils.conv import escape_filter_chars

from app.settings import settings

_DEFAULT_FILTER = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=*))"
# Standard AD attributes — userAccountControl bit 0x2 = ACCOUNTDISABLE (disabled account).
# mail → email; memberOf → AD group DNs (reference only, NOT mirrored into user_groups).
# Runtime behavior against a real AD is 불명 (no live LDAP to verify here).
_ATTRS = [
    "sAMAccountName",
    "displayName",
    "title",
    "distinguishedName",
    "userAccountControl",
    "mail",
    "memberOf",
    "employeeNumber",  # EDW 부서장 목록(empId) 매핑 키 (설계 2026-08-11 §4)
]


@dataclass(frozen=True)
class RawUser:
    sam_account_name: str
    display_name: str
    title: str
    distinguished_name: str
    # None if AD omits the attribute (missing uac → treated as active, conservative)
    user_account_control: int | None
    mail: str | None
    # AD group DNs — reference only; NOT mirrored into user_groups (Task 3 handles app groups)
    member_of: list[str]
    # 사번(EDW empId 매핑 키) — AD 미설정이면 None (설계 2026-08-11 §4)
    employee_number: str | None = None


def _build_server() -> Server:
    """LDAP 서버 객체 생성 — 서비스 조회·사용자 인증 bind가 공유한다(TLS 설정 drift 방지)."""
    use_ssl = settings.ldap_url.lower().startswith("ldaps://")
    return Server(settings.ldap_url, use_ssl=use_ssl, tls=Tls() if use_ssl else None)


def _open_service_connection() -> Connection:
    """서비스 계정으로 bind한 연결 — 디렉터리 동기화·사용자 DN 조회에 사용."""
    server = _build_server()
    conn = Connection(
        server,
        user=settings.ldap_bind_dn,
        password=settings.ldap_bind_credentials,
        auto_bind=False,
    )
    if settings.ldap_start_tls:
        conn.start_tls()
    conn.bind()
    return conn


def _to_raw(entry: object) -> RawUser:
    def val(attr: str) -> str:
        v = getattr(entry, attr, None)
        return str(v.value) if v is not None and v.value is not None else ""

    def int_val(attr: str) -> int | None:
        """Return integer value or None if attribute absent/None."""
        v = getattr(entry, attr, None)
        if v is None or v.value is None:
            return None
        try:
            return int(v.value)
        except (TypeError, ValueError):
            return None

    def str_val(attr: str) -> str | None:
        """Return string value or None if attribute absent/empty."""
        v = getattr(entry, attr, None)
        if v is None or v.value is None:
            return None
        s = str(v.value).strip()
        return s if s else None

    def list_val(attr: str) -> list[str]:
        """Return list of strings for multi-value attributes (e.g. memberOf)."""
        v = getattr(entry, attr, None)
        if v is None or v.value is None:
            return []
        raw = v.value
        if isinstance(raw, list):
            return [str(x) for x in raw]
        return [str(raw)]

    return RawUser(
        sam_account_name=val("sAMAccountName"),
        display_name=val("displayName"),
        title=val("title"),
        distinguished_name=val("distinguishedName"),
        user_account_control=int_val("userAccountControl"),
        mail=str_val("mail"),
        member_of=list_val("memberOf"),
        employee_number=str_val("employeeNumber"),
    )


def fetch_user(login_id: str) -> RawUser | None:
    safe = login_id.replace("(", "").replace(")", "").replace("*", "")  # filter 인젝션 방지
    conn = _open_service_connection()
    try:
        conn.search(
            settings.ldap_user_search_base,
            f"(&(objectCategory=person)(objectClass=user)(sAMAccountName={safe}))",
            search_scope=SUBTREE,
            attributes=_ATTRS,
        )
        if not conn.entries:
            return None
        return _to_raw(conn.entries[0])
    finally:
        conn.unbind()


def fetch_all_users() -> list[RawUser]:
    conn = _open_service_connection()
    try:
        entries = conn.extend.standard.paged_search(
            settings.ldap_user_search_base,
            settings.ldap_user_filter or _DEFAULT_FILTER,
            search_scope=SUBTREE,
            attributes=_ATTRS,
            paged_size=500,
            generator=False,
        )
        def _int_attr(attrs: dict, key: str) -> int | None:
            v = attrs.get(key)
            if v is None:
                return None
            try:
                return int(v)
            except (TypeError, ValueError):
                return None

        def _str_attr(attrs: dict, key: str) -> str | None:
            v = attrs.get(key)
            if v is None:
                return None
            s = str(v).strip()
            return s if s else None

        def _list_attr(attrs: dict, key: str) -> list[str]:
            v = attrs.get(key)
            if v is None:
                return []
            return [str(x) for x in v] if isinstance(v, list) else [str(v)]

        return [
            RawUser(
                sam_account_name=str(e["attributes"].get("sAMAccountName", "")),
                display_name=str(e["attributes"].get("displayName", "")),
                title=str(e["attributes"].get("title", "")),
                distinguished_name=str(e["attributes"].get("distinguishedName", "")),
                user_account_control=_int_attr(e["attributes"], "userAccountControl"),
                mail=_str_attr(e["attributes"], "mail"),
                member_of=_list_attr(e["attributes"], "memberOf"),
                employee_number=_str_attr(e["attributes"], "employeeNumber"),
            )
            for e in entries
            if e.get("type") == "searchResEntry"
        ]
    finally:
        conn.unbind()


def _find_user_dn(login_id: str) -> str | None:
    """서비스 계정으로 sAMAccountName을 검색해 DN을 얻는다.

    없으면 None — 서버 연결·bind 실패(AD 다운, 잘못된 호스트, TLS 실패)도 None으로
    수렴시켜 authenticate_user가 예외를 던지지 않고 항상 False로 돌아가게 한다.
    """
    try:
        conn = _open_service_connection()
    except LDAPException:
        return None
    try:
        conn.search(
            search_base=settings.ldap_user_search_base,
            search_filter=f"(sAMAccountName={escape_filter_chars(login_id)})",
            attributes=["distinguishedName"],
            size_limit=1,
        )
        if not conn.entries:
            return None
        return str(conn.entries[0].entry_dn)
    except LDAPException:
        return None
    finally:
        try:
            conn.unbind()
        except LDAPException:
            pass  # 이미 끊긴 연결 — 정리 실패는 인증 결과에 영향 없음


def _try_bind(user_dn: str, password: str) -> bool:
    """사용자 DN으로 bind 시도. 자격증명이 틀리면 ldap3가 실패를 반환한다."""
    server = _build_server()
    conn = Connection(server, user=user_dn, password=password, auto_bind=False)
    try:
        return bool(conn.bind())
    except LDAPException:
        return False
    finally:
        try:
            conn.unbind()
        except LDAPException:
            pass  # 이미 끊긴 연결 — 정리 실패는 인증 결과에 영향 없음


def authenticate_user(login_id: str, password: str) -> bool:
    """사용자 자격증명 검증. 실패 사유는 구분하지 않는다(계정 존재 노출 금지).

    빈 비밀번호는 LDAP unauthenticated bind로 '성공'이 되므로 서버에 닿기 전에 막는다.
    """
    if not password:
        return False
    if not settings.ldap_enabled:
        return False
    user_dn = _find_user_dn(login_id)
    if user_dn is None:
        return False
    return _try_bind(user_dn, password)
