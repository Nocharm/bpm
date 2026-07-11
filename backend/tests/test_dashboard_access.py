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
    """/api/me가 탭 게이팅용 플래그를 싣는다 — 자체 시드로 독립 실행 가능해야 함."""
    _seed([
        Employee(login_id="dash.meflag", name="Dash Me Flag", source="local", active=True),
        DashboardPermission(
            principal_type="user", principal_id="dash.meflag", granted_by="admin.sys"
        ),
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    granted = client.get("/api/me", headers={"X-Dev-User": "dash.meflag"}).json()
    denied = client.get("/api/me", headers={"X-Dev-User": "dash.nobody"}).json()
    assert granted["can_view_dashboard"] is True
    assert denied["can_view_dashboard"] is False


def test_granted_user_denied_ai_usage(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 받은 비-sysadmin도 /api/dashboard/ai-usage는 403 — 게이트 분리 검증."""
    _seed([
        Employee(login_id="dash.aiviewer", name="Dash AI Viewer", source="local", active=True),
        DashboardPermission(
            principal_type="user", principal_id="dash.aiviewer", granted_by="admin.sys"
        ),
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    dashboard_response = client.get(
        "/api/dashboard", headers={"X-Dev-User": "dash.aiviewer"}
    )
    ai_usage_response = client.get(
        "/api/dashboard/ai-usage", headers={"X-Dev-User": "dash.aiviewer"}
    )
    assert dashboard_response.status_code == 200
    assert ai_usage_response.status_code == 403


def test_permission_crud_roundtrip(client: TestClient) -> None:
    """권한 행 추가 → 목록 노출 → 중복 409 → 삭제."""
    body = {"principal_type": "user", "principal_id": "dash.crud"}
    created = client.post("/api/dashboard/permissions", json=body)
    assert created.status_code == 201
    row_id = created.json()["id"]

    listed = client.get("/api/dashboard/permissions").json()
    assert any(r["id"] == row_id for r in listed)

    assert client.post("/api/dashboard/permissions", json=body).status_code == 409

    assert client.delete(f"/api/dashboard/permissions/{row_id}").status_code == 204
    after = client.get("/api/dashboard/permissions").json()
    assert all(r["id"] != row_id for r in after)


def test_permission_settings_require_sysadmin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """권한 행이 있어 열람은 되더라도, 설정 API는 sysadmin만."""
    _seed([
        DashboardPermission(
            principal_type="user", principal_id="dash.viewer2", granted_by="admin.sys"
        )
    ])
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    headers = {"X-Dev-User": "dash.viewer2"}
    assert client.get("/api/dashboard/permissions", headers=headers).status_code == 403
    assert client.put(
        "/api/dashboard/coverage-depts", json={"org_paths": []}, headers=headers
    ).status_code == 403


def test_coverage_depts_put_replaces(client: TestClient) -> None:
    """PUT은 목록 통째 교체(멱등) — 같은 목록을 두 번 보내도 결과 동일."""
    paths = ["Div A/Office 1", "Div B"]
    first = client.put("/api/dashboard/coverage-depts", json={"org_paths": paths})
    assert first.status_code == 200
    assert sorted(first.json()["org_paths"]) == sorted(paths)

    again = client.put("/api/dashboard/coverage-depts", json={"org_paths": paths})
    assert sorted(again.json()["org_paths"]) == sorted(paths)

    replaced = client.put("/api/dashboard/coverage-depts", json={"org_paths": ["Div C"]})
    assert replaced.json()["org_paths"] == ["Div C"]
    assert client.get("/api/dashboard/coverage-depts").json()["org_paths"] == ["Div C"]
