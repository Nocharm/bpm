"""batch_job_runs — 잡·결과별 최신 1행 upsert·HR sync 기록 연동·admin API 게이트."""

import asyncio
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app.batch_runs import JOB_HR_SYNC, record_batch_run
from app.db import SessionLocal
from app.main import app
from app.models import BatchJobRun
from app.settings import settings
from tests.hr_sync_helpers import _hr_row, _mock_hr

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


def _clear_runs() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(BatchJobRun))
            await session.commit()

    asyncio.run(_run())


def _get_runs() -> list[BatchJobRun]:
    async def _run() -> list[BatchJobRun]:
        async with SessionLocal() as session:
            return list((await session.execute(select(BatchJobRun))).scalars().all())

    return asyncio.run(_run())


def _record(job: str, outcome: str, detail: str | None) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await record_batch_run(session, job, outcome, detail)

    asyncio.run(_run())


def _run_full_sync():
    from app.hr.service import run_full_sync

    async def _run():
        async with SessionLocal() as session:
            return await run_full_sync(session)

    return asyncio.run(_run())


@pytest.fixture(autouse=True)
def clean_runs(client: TestClient) -> Iterator[None]:
    """세션 공유 DB — 다른 테스트(run_full_sync 경유)의 잔류 행 격리."""
    _clear_runs()
    yield
    _clear_runs()


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


def test_record_upserts_single_row_per_outcome(client: TestClient) -> None:
    _record("db_backup", "success", "first")
    _record("db_backup", "success", "second")
    _record("db_backup", "failure", "boom")
    rows = {(r.job, r.outcome): r for r in _get_runs()}
    assert len(rows) == 2  # 결과별 최신 1행만 보전
    assert rows[("db_backup", "success")].detail == "second"
    assert rows[("db_backup", "failure")].detail == "boom"


def test_full_sync_success_records(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("rec.a"), _hr_row("rec.b")])
    summary = _run_full_sync()
    assert summary.aborted_reason is None
    rows = {(r.job, r.outcome): r for r in _get_runs()}
    assert ("hr_sync", "failure") not in rows
    assert "scanned" in (rows[(JOB_HR_SYNC, "success")].detail or "")


def test_full_sync_abort_records_failure(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [])  # 빈 피드 → abort (가드)
    summary = _run_full_sync()
    assert summary.aborted_reason is not None
    rows = {(r.job, r.outcome): r for r in _get_runs()}
    assert (JOB_HR_SYNC, "success") not in rows
    assert rows[(JOB_HR_SYNC, "failure")].detail == summary.aborted_reason


def test_full_sync_exception_records_failure(client: TestClient, monkeypatch) -> None:
    from app.hr import service as hr_service

    monkeypatch.setattr(hr_service, "_last_full_sync_at", None)

    async def boom(session):
        raise RuntimeError("webhook down")

    monkeypatch.setattr(hr_service, "sync_all", boom)
    with pytest.raises(RuntimeError):
        _run_full_sync()
    rows = {(r.job, r.outcome): r for r in _get_runs()}
    assert rows[(JOB_HR_SYNC, "failure")].detail == "webhook down"


def test_batch_runs_endpoint_gate_and_shape(
    client: TestClient, sysadmin_enforced: None
) -> None:
    _record("db_backup", "success", "bpm-20260827-040000.dump (1.2M)")
    res = client.get("/api/admin/batch-runs", headers={"X-Dev-User": NON_SYSADMIN})
    assert res.status_code == 403
    res = client.get("/api/admin/batch-runs", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["job"] == "db_backup"
    assert body[0]["outcome"] == "success"
    assert body[0]["detail"].startswith("bpm-")
    assert body[0]["ran_at"]  # ISO 문자열
