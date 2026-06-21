"""ldap3 기반 AD 조회 — 블로킹. async 호출부는 asyncio.to_thread로 감싼다 (design 2026-06-16 §5.1)."""

from dataclasses import dataclass

from ldap3 import SUBTREE, Connection, Server, Tls

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


def _connect() -> Connection:
    use_ssl = settings.ldap_url.lower().startswith("ldaps://")
    server = Server(settings.ldap_url, use_ssl=use_ssl, tls=Tls() if use_ssl else None)
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
    )


def fetch_user(login_id: str) -> RawUser | None:
    safe = login_id.replace("(", "").replace(")", "").replace("*", "")  # filter 인젝션 방지
    conn = _connect()
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
    conn = _connect()
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
            )
            for e in entries
            if e.get("type") == "searchResEntry"
        ]
    finally:
        conn.unbind()
