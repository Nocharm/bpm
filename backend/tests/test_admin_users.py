"""GET /api/admin/users — sysadmin-gated admin console directory (Layer 4 Task 0b)."""

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


def test_admin_users_sysadmin_200(
    client: TestClient, sysadmin_enforced: None
) -> None:
    """sysadmin → 200, English users, no Korean, is_sysadmin true for the sysadmin member."""
    res = client.get("/api/admin/users", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200

    body = res.json()
    assert "users" in body
    assert "departments" in body

    # At least 5 seeded employees.
    assert len(body["users"]) >= 5

    # No Korean characters in any name.
    for u in body["users"]:
        assert not any("가" <= ch <= "힣" for ch in u["name"]), (
            f"Korean name in admin users: {u['name']}"
        )

    # admin.kim is_sysadmin=True; user.lee is_sysadmin=False.
    by_id = {u["login_id"]: u for u in body["users"]}
    assert by_id[SYSADMIN]["is_sysadmin"] is True
    assert by_id[NON_SYSADMIN]["is_sysadmin"] is False

    # org_levels is a list (may be empty for employees with no org data).
    for u in body["users"]:
        assert isinstance(u["org_levels"], list)

    # Departments derived from employees — at least one expected.
    assert len(body["departments"]) >= 1
    for d in body["departments"]:
        assert isinstance(d["org_levels"], list)
        assert len(d["org_levels"]) >= 1


def test_admin_users_non_sysadmin_403(
    client: TestClient, sysadmin_enforced: None
) -> None:
    """non-sysadmin → 403."""
    res = client.get("/api/admin/users", headers={"X-Dev-User": NON_SYSADMIN})
    assert res.status_code == 403
