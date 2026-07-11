"""대시보드 열람 권한 — 순수 판정 함수 (design 2026-07-11)."""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import DashboardPermission, Employee
from app.permissions.logic import can_view_dashboard
from app.settings import settings


def test_sysadmin_always_views() -> None:
    """sysadmin은 권한 행이 없어도 통과."""
    assert can_view_dashboard(True, "admin", "", set(), []) is True


def test_no_principal_row_denied() -> None:
    """권한 행이 없으면 비-sysadmin은 거부 — 기본값은 '거부'다."""
    assert can_view_dashboard(False, "u1", "Div/Office", set(), []) is False


def test_user_principal() -> None:
    """user principal은 login_id 일치만 인정."""
    perms = [("user", "u1")]
    assert can_view_dashboard(False, "u1", "", set(), perms) is True
    assert can_view_dashboard(False, "u2", "", set(), perms) is False


def test_department_principal_includes_subpath() -> None:
    """department principal은 org_path 하위 포함 — belongs_to_department 정책."""
    perms = [("department", "Div/Office")]
    assert can_view_dashboard(False, "u1", "Div/Office", set(), perms) is True
    assert can_view_dashboard(False, "u1", "Div/Office/Team1", set(), perms) is True
    # 경계 없는 부분 일치는 거부 — "Div/OfficeX"는 하위가 아니다
    assert can_view_dashboard(False, "u1", "Div/OfficeX", set(), perms) is False


def test_group_principal_requires_membership() -> None:
    """그룹 권한은 caller가 속한 ACTIVE 그룹일 때만 (user_group_ids는 caller가 주입)."""
    perms = [("group", "7")]
    assert can_view_dashboard(False, "u1", "", {"7"}, perms) is True
    assert can_view_dashboard(False, "u1", "", {"8"}, perms) is False
    assert can_view_dashboard(False, "u1", "", set(), perms) is False


def _seed(rows: list) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for row in rows:
                session.add(row)
            await session.commit()

    asyncio.run(_run())


def test_non_sysadmin_without_grant_is_403(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 행이 없는 비-sysadmin은 지표 API 403."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    response = client.get("/api/dashboard", headers={"X-Dev-User": "dash.nobody"})
    assert response.status_code == 403


def test_granted_user_can_view(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """user principal 행이 있으면 비-sysadmin도 200."""
    _seed([
        Employee(login_id="dash.viewer", name="Dash Viewer", source="local", active=True),
        DashboardPermission(
            principal_type="user", principal_id="dash.viewer", granted_by="admin.sys"
        ),
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    response = client.get("/api/dashboard", headers={"X-Dev-User": "dash.viewer"})
    assert response.status_code == 200


def test_me_exposes_can_view_dashboard(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """/api/me가 탭 게이팅용 플래그를 싣는다."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    granted = client.get("/api/me", headers={"X-Dev-User": "dash.viewer"}).json()
    denied = client.get("/api/me", headers={"X-Dev-User": "dash.nobody"}).json()
    assert granted["can_view_dashboard"] is True
    assert denied["can_view_dashboard"] is False
