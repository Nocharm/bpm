"""ldap3 기반 AD 조회 — 블로킹. async 호출부는 asyncio.to_thread로 감싼다 (design 2026-06-16 §5.1)."""

from dataclasses import dataclass

from ldap3 import SUBTREE, Connection, Server, Tls

from app.settings import settings

_DEFAULT_FILTER = "(&(objectCategory=person)(objectClass=user)(sAMAccountName=*))"
_ATTRS = ["sAMAccountName", "displayName", "title", "distinguishedName"]


@dataclass(frozen=True)
class RawUser:
    sam_account_name: str
    display_name: str
    title: str
    distinguished_name: str


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

    return RawUser(
        sam_account_name=val("sAMAccountName"),
        display_name=val("displayName"),
        title=val("title"),
        distinguished_name=val("distinguishedName"),
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
        return [
            RawUser(
                sam_account_name=str(e["attributes"].get("sAMAccountName", "")),
                display_name=str(e["attributes"].get("displayName", "")),
                title=str(e["attributes"].get("title", "")),
                distinguished_name=str(e["attributes"].get("distinguishedName", "")),
            )
            for e in entries
            if e.get("type") == "searchResEntry"
        ]
    finally:
        conn.unbind()
