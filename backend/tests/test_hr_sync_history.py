"""HR 동기화 회차 이력·상태 판정 (리뷰 2026-10-19 H-3) — 대량 퇴직은 멈추지 않고 기록한다."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select

from app.db import SessionLocal
from app.hr import history
from app.main import app
from app.models import HrSyncRun
from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _seed_employee

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


def _clear_history() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(HrSyncRun))
            await session.commit()

    asyncio.run(_run())


def _get_history() -> list[HrSyncRun]:
    async def _run() -> list[HrSyncRun]:
        async with SessionLocal() as session:
            return list((await session.scalars(select(HrSyncRun).order_by(HrSyncRun.id))).all())

    return asyncio.run(_run())


def _run_full_sync():
    from app.hr.service import run_full_sync

    async def _run():
        async with SessionLocal() as session:
            return await run_full_sync(session)

    return asyncio.run(_run())


@pytest.fixture(autouse=True)
def clean_history(client: TestClient) -> Iterator[None]:
    """세션 공유 DB — 다른 테스트의 run_full_sync 잔류 회차 격리."""
    _clear_history()
    yield
    _clear_history()


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    prev = (settings.auth_enabled, settings.dev_enforce_permissions, settings.bpm_sysadmins)
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled, settings.dev_enforce_permissions, settings.bpm_sysadmins = prev
    app.dependency_overrides.clear()


def test_status_case_does_not_deactivate(client: TestClient, monkeypatch) -> None:
    _seed_employee("case.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("case.user", status="Active")])

    summary = _run_full_sync()

    assert summary.deactivated == 0
    assert _get_employee("case.user").active is True


def test_missing_org_levels_keep_existing_org(client: TestClient, monkeypatch) -> None:
    _seed_employee(
        "org.keep", source="hr", department="Team Q", org_l1="Div", org_l2="Team Q",
    )
    _mock_hr(monkeypatch, [_hr_row("org.keep", department=None, org_levels=[])])

    _run_full_sync()

    emp = _get_employee("org.keep")
    assert (emp.org_l1, emp.org_l2, emp.department) == ("Div", "Team Q", "Team Q")


def test_duplicate_login_prefers_active_row(client: TestClient, monkeypatch) -> None:
    _seed_employee("dup.user", source="hr", active=True)
    _mock_hr(monkeypatch, [
        _hr_row("dup.user"),
        _hr_row("dup.user", status="inactive"),  # 낡은 퇴직 행이 뒤에 와도
    ])

    summary = _run_full_sync()

    assert _get_employee("dup.user").active is True
    assert summary.duplicates == 1
    run = _get_history()[-1]
    assert [p["login_id"] for p in run.changes["duplicates"]] == ["dup.user"]


def test_success_run_records_who_changed(client: TestClient, monkeypatch) -> None:
    _seed_employee("hist.leave", source="hr", active=True, korean_name="퇴직자")
    _seed_employee("hist.back", source="hr", active=False)
    _seed_employee("hist.gone", source="hr", active=True, name="Gone Kim", department="Team G")
    _mock_hr(monkeypatch, [
        _hr_row("hist.leave", status="inactive"),
        _hr_row("hist.back"),
        _hr_row("hist.new", department="Team N", org_levels=["Div", "Team N"]),
    ])

    summary = _run_full_sync()

    assert summary.aborted_reason is None
    run = _get_history()[-1]
    assert run.outcome == "success" and run.detail is None
    assert {p["login_id"] for p in run.changes["deactivated"]} == {"hist.leave"}
    assert run.changes["deactivated"][0]["name"] == "퇴직자"
    assert {p["login_id"] for p in run.changes["reactivated"]} == {"hist.back"}
    assert {p["login_id"] for p in run.changes["created"]} == {"hist.new"}
    gone = next(p for p in run.changes["deleted"] if p["login_id"] == "hist.gone")
    assert gone == {"login_id": "hist.gone", "name": "Gone Kim", "department": "Team G"}
    assert (run.deactivated, run.reactivated, run.created) == (1, 1, 1)
    assert run.deleted == len(run.changes["deleted"])


def test_mass_departure_is_recorded_not_blocked(client: TestClient, monkeypatch) -> None:
    ids = [f"mass.{i:02d}" for i in range(12)]
    for login_id in ids:
        _seed_employee(login_id, source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row(login_id, status="inactive") for login_id in ids])

    summary = _run_full_sync()

    assert summary.aborted_reason is None  # 멈추지 않는다
    assert all(_get_employee(login_id).active is False for login_id in ids)
    run = _get_history()[-1]
    assert run.mass_departure is True
    assert run.deactivated == 12


def test_aborted_run_is_recorded_as_failure(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [])  # 빈 피드 → 가드 중단

    summary = _run_full_sync()

    run = _get_history()[-1]
    assert run.outcome == "failure"
    assert run.detail == summary.aborted_reason
    assert run.changes is None


def test_mass_departure_threshold() -> None:
    assert history.is_mass_departure(10, 200) is True     # 5%·10명
    assert history.is_mass_departure(9, 100) is False     # 10명 미만
    assert history.is_mass_departure(20, 1000) is False   # 2%
    assert history.is_mass_departure(300, 6000) is True


def test_history_keeps_latest_runs(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(history, "HR_SYNC_HISTORY_KEEP", 3)

    async def _run() -> None:
        async with SessionLocal() as session:
            for index in range(5):
                await history.record_hr_sync_run(
                    session, HrSyncRun(outcome="success", scanned=index)
                )

    asyncio.run(_run())

    assert [run.scanned for run in _get_history()] == [2, 3, 4]


def test_history_endpoints_gate_and_detail(
    client: TestClient, sysadmin_enforced: None, monkeypatch
) -> None:
    _seed_employee("api.leave", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("api.leave", status="inactive")])
    _run_full_sync()

    assert client.get("/api/admin/hr-sync-runs", headers={"X-Dev-User": NON_SYSADMIN}).status_code == 403
    listed = client.get("/api/admin/hr-sync-runs", headers={"X-Dev-User": SYSADMIN})
    assert listed.status_code == 200
    summary = listed.json()[0]
    assert summary["outcome"] == "success" and summary["deactivated"] == 1
    assert "changes" not in summary

    detail = client.get(f"/api/admin/hr-sync-runs/{summary['id']}", headers={"X-Dev-User": SYSADMIN})
    assert detail.status_code == 200
    assert [p["login_id"] for p in detail.json()["changes"]["deactivated"]] == ["api.leave"]
    assert client.get(
        f"/api/admin/hr-sync-runs/{summary['id']}", headers={"X-Dev-User": NON_SYSADMIN}
    ).status_code == 403
    assert client.get("/api/admin/hr-sync-runs/999999", headers={"X-Dev-User": SYSADMIN}).status_code == 404


def test_failure_detail_has_empty_changes(client: TestClient, sysadmin_enforced: None, monkeypatch) -> None:
    _mock_hr(monkeypatch, [])
    _run_full_sync()
    run_id = _get_history()[-1].id

    detail = client.get(f"/api/admin/hr-sync-runs/{run_id}", headers={"X-Dev-User": SYSADMIN})

    assert detail.status_code == 200
    assert detail.json()["changes"]["deactivated"] == []


def test_history_count_stays_one_per_run(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("once.user")])
    _run_full_sync()

    async def _count() -> int:
        async with SessionLocal() as session:
            return await session.scalar(select(func.count()).select_from(HrSyncRun))

    assert asyncio.run(_count()) == 1
