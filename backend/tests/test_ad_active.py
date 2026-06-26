"""Task 2 tests — AD active/email derivation + inactive-approver judgment + admin active field + seed active + directory minimal.

Covers:
- is_active(uac) bit logic (pure, no DB)
- seed_local_employees sets active=True (via /api/admin/users)
- inactive approver does NOT count → submit with only inactive approver → 409
- GET /api/admin/users returns active field
- GET /api/directory response has ONLY {id,name,department} — no email/active
"""

import asyncio

from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import Employee
from app.settings import settings


# ── pure helper ─────────────────────────────────────────────────────────────

def test_is_active_uac_none_defaults_to_active() -> None:
    """Missing uac → conservative: account is active."""
    from app.ad.org import is_active
    assert is_active(None) is True


def test_is_active_disabled_bit_set() -> None:
    """ACCOUNTDISABLE bit 0x2 set → inactive."""
    from app.ad.org import is_active
    # 0x2 alone
    assert is_active(0x2) is False
    # typical disabled flags (NORMAL_ACCOUNT | ACCOUNTDISABLE = 0x202)
    assert is_active(0x202) is False


def test_is_active_enabled_account() -> None:
    """Normal (non-disabled) account → active."""
    from app.ad.org import is_active
    # 0x200 = NORMAL_ACCOUNT (bit 0x2 clear)
    assert is_active(0x200) is True
    # zero flags
    assert is_active(0) is True


# ── DB helpers ───────────────────────────────────────────────────────────────

def _run(coro_factory) -> object:
    async def _go() -> object:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result
    return asyncio.run(_go())


def _seed_employee(login_id: str, *, active: bool) -> None:
    """Insert/upsert an Employee row for testing inactive-approver scenario."""
    async def _do(session) -> None:
        emp = await session.get(Employee, login_id)
        if emp is None:
            emp = Employee(login_id=login_id, source="local")
            session.add(emp)
        emp.name = login_id
        emp.active = active
        emp.email = f"{login_id}@corp" if active else ""
        emp.department = "Test"
    _run(_do)


# ── seed active=True ─────────────────────────────────────────────────────────

def test_seed_local_employees_active_true(client: TestClient) -> None:
    """seed_local_employees 5 dev users are seeded with active=True.

    Verified via GET /api/admin/users (requires sysadmin; we force auth=True + override).
    """
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = "admin.kim"
    app.dependency_overrides[auth_mod.get_current_user] = lambda: "admin.kim"
    try:
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200, resp.text
        users = resp.json()["users"]
        local_ids = {"admin.kim", "user.lee", "user.park", "user.choi", "user.jung"}
        local_users = [u for u in users if u["login_id"] in local_ids]
        assert len(local_users) == 5, f"Expected 5 local users, got {[u['login_id'] for u in local_users]}"
        for u in local_users:
            assert u["active"] is True, f"{u['login_id']} should be active=True"
    finally:
        settings.auth_enabled = prev_auth
        settings.bpm_sysadmins = prev_sys
        app.dependency_overrides.pop(auth_mod.get_current_user, None)


# ── admin users active field ─────────────────────────────────────────────────

def test_admin_users_response_has_active_field(client: TestClient) -> None:
    """GET /api/admin/users response includes active field per user."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = "admin.kim"
    app.dependency_overrides[auth_mod.get_current_user] = lambda: "admin.kim"
    try:
        resp = client.get("/api/admin/users")
        assert resp.status_code == 200, resp.text
        users = resp.json()["users"]
        assert len(users) > 0
        # Every user row must have an active boolean field
        for u in users:
            assert "active" in u, f"Missing 'active' in user row {u.get('login_id')}"
            assert isinstance(u["active"], bool), f"'active' must be bool for {u.get('login_id')}"
    finally:
        settings.auth_enabled = prev_auth
        settings.bpm_sysadmins = prev_sys
        app.dependency_overrides.pop(auth_mod.get_current_user, None)


# ── inactive approver judgment ───────────────────────────────────────────────

_aa_seq = 0


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _aa_seq
    _aa_seq += 1
    created = client.post("/api/maps", json={"name": f"active-approver test map {_aa_seq}"}).json()
    return created["id"], created["versions"][0]["id"]


def test_inactive_approver_does_not_count_toward_submit(
    client: TestClient,
) -> None:
    """An approver with employees.active=False does NOT satisfy the submit-gate.

    Set inactive_approver as the only approver, verify submit → 409.
    Then set their employee row to active=True, verify submit succeeds.
    """
    map_id, version_id = _create_map_with_version(client)
    inactive_id = "inactive.approver"

    # Seed inactive employee row
    _seed_employee(inactive_id, active=False)

    # Set as only approver for the map
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [inactive_id]})

    # Checkout to allow submit
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # Submit should fail: no ACTIVE approvers
    resp = client.post(f"/api/versions/{version_id}/submit")
    assert resp.status_code == 409, (
        f"Expected 409 (no active approvers), got {resp.status_code}: {resp.text}"
    )

    # Now activate the employee — submit should succeed
    _seed_employee(inactive_id, active=True)
    resp2 = client.post(f"/api/versions/{version_id}/submit")
    assert resp2.status_code == 200, (
        f"Expected 200 after activating approver, got {resp2.status_code}: {resp2.text}"
    )
    assert resp2.json()["status"] == "pending"


# ── directory stays minimal ──────────────────────────────────────────────────

def test_directory_response_excludes_sensitive_fields(client: TestClient) -> None:
    """GET /api/directory users carry only display fields (id/name/department/title/org_path)
    for the member 2nd line (H2) — never email/active."""
    resp = client.get("/api/directory")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    users = data.get("users", [])
    # Confirm at least one user is present (local dev users are seeded)
    assert len(users) > 0, "Expected at least 1 user in /api/directory"
    allowed_keys = {"id", "name", "department", "title", "org_path"}
    for user in users:
        extra = set(user.keys()) - allowed_keys
        assert not extra, (
            f"/api/directory user has unexpected fields {extra} — must stay minimal (no email/active)"
        )
