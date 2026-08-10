"""AD title 패스 테스트 — title만 갱신, 이름·조직·active 미터치. HR sync가 title을 안 덮는 회귀 포함."""

import asyncio

from fastapi.testclient import TestClient

from app.ad.client import RawUser
from app.db import SessionLocal
from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee


def _mock_ldap_titles(monkeypatch, raws: list) -> None:
    from app.ad import client as ldap_client

    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)


def test_refresh_titles_updates_title_only(client: TestClient, monkeypatch) -> None:
    _seed_employee("title.user", source="hr", name="HR Name", title="Old", org_l1="HR Div")
    _mock_ldap_titles(
        monkeypatch,
        [RawUser("title.user", "AD Display", "Principal", "OU=Elsewhere,DC=corp", 0x200, None, []),
         RawUser("no.row", "Ghost", "Lead", "OU=X,DC=corp", 0x200, None, [])],
    )
    from app.ad.service import refresh_titles

    async def _run() -> int:
        async with SessionLocal() as session:
            return await refresh_titles(session)

    assert asyncio.run(_run()) == 1
    emp = _get_employee("title.user")
    assert emp.title == "Principal"
    assert emp.name == "HR Name" and emp.org_l1 == "HR Div"  # title 외 미터치


def test_full_sync_runs_title_pass_after_hr(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("combo.user")])
    _mock_ldap_titles(monkeypatch, [RawUser("combo.user", "X", "Senior", "OU=Y,DC=corp", 0x200, None, [])])
    summary = _run_sync()
    assert summary.title_refreshed == 1
    assert _get_employee("combo.user").title == "Senior"
