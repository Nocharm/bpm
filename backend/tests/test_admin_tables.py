"""GET /api/admin/tables[/{name}] — sysadmin-gated read-only table viewer."""

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim. Restore after."""
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.clear()


def test_list_tables_sysadmin_200(client: TestClient, sysadmin_enforced: None) -> None:
    """sysadmin → 200 with the app's table names."""
    res = client.get("/api/admin/tables", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200
    names = res.json()
    for expected in ("employees", "process_maps", "nodes", "map_versions"):
        assert expected in names


def test_list_tables_non_sysadmin_403(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get("/api/admin/tables", headers={"X-Dev-User": NON_SYSADMIN})
    assert res.status_code == 403


def test_read_table_pagination(client: TestClient, sysadmin_enforced: None) -> None:
    """size caps the page; total/page/size echoed; columns reported."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"size": 2, "page": 1},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    body = res.json()
    assert "login_id" in body["columns"]
    assert body["page"] == 1 and body["size"] == 2
    assert len(body["rows"]) <= 2
    assert body["total"] >= 5  # 5 seeded LOCAL_USERS


def test_read_table_sort_desc(client: TestClient, sysadmin_enforced: None) -> None:
    """sort+order applies server-side."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"sort": "login_id", "order": "desc", "size": 100},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    ids = [r["login_id"] for r in res.json()["rows"]]
    assert ids == sorted(ids, reverse=True)


def test_read_table_filter(client: TestClient, sysadmin_enforced: None) -> None:
    """q filters across text columns (bound param)."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"q": "admin.kim"},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert any(r["login_id"] == "admin.kim" for r in body["rows"])


def test_read_table_unknown_404(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/no_such_table", headers={"X-Dev-User": SYSADMIN}
    )
    assert res.status_code == 404


def test_read_table_non_sysadmin_403(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/employees", headers={"X-Dev-User": NON_SYSADMIN}
    )
    assert res.status_code == 403
