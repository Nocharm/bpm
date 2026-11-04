"""실행 체크(Run) 테이블·정리 설정 테스트 — 설정 7종 기본값·PUT/GET 왕복, 테이블 6종 등록."""

import asyncio
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.app_settings import RunLimits, get_run_limits
from app.db import SessionLocal
from app.main import app
from app.models import Base
from app.settings import settings

SYSADMIN = "admin.kim"


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


def _load_run_limits() -> RunLimits:
    async def _run() -> RunLimits:
        async with SessionLocal() as session:
            return await get_run_limits(session)

    return asyncio.run(_run())


def test_run_limits_defaults(client: TestClient) -> None:
    """설정 행이 없으면 기본값 — 정리 잡·상한 검사가 같은 숫자를 읽는다."""
    assert _load_run_limits() == RunLimits(30, 40, 30, 10, 30, 50, 10)


def test_run_limits_put_and_get(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": SYSADMIN}
    res = client.put("/api/admin/app-settings", json={"run_idle_stop_days": 60}, headers=headers)
    assert res.status_code == 200
    assert res.json()["run_idle_stop_days"] == 60
    try:
        body = client.get("/api/admin/app-settings", headers=headers).json()
        assert body["run_idle_stop_days"] == 60
        assert body["run_idle_warn_days"] == 30  # 다른 키는 기본값 유지
        assert _load_run_limits().idle_stop_days == 60
    finally:
        client.put("/api/admin/app-settings", json={"run_idle_stop_days": 40}, headers=headers)


def test_run_limits_rejects_out_of_range(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": SYSADMIN}
    for payload in ({"run_idle_warn_days": 0}, {"run_open_solo_cap": 1001}, {"run_summary_days": 3651}):
        res = client.put("/api/admin/app-settings", json=payload, headers=headers)
        assert res.status_code == 422, payload


def test_run_tables_exist() -> None:
    expected = {"runs", "run_participants", "run_node_states", "run_scopes", "run_comments", "run_events"}
    assert expected <= set(Base.metadata.tables)
