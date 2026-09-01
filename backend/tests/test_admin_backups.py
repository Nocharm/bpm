"""백업 관리 API — sysadmin 게이트·온디맨드 sqlite 백업·목록·다운로드·postgres 트리거."""

import asyncio
from typing import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import BatchJobRun
from app.routers.admin import BACKUP_TRIGGER_FILENAME
from app.settings import settings

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


def _clear_runs() -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(BatchJobRun))
            await session.commit()

    asyncio.run(_run())


@pytest.fixture
def backup_dir(tmp_path, client: TestClient) -> Iterator[str]:
    """임시 백업 디렉터리로 settings 교체 + batch_job_runs 격리."""
    prev = settings.backup_dir
    settings.backup_dir = str(tmp_path)
    _clear_runs()
    yield str(tmp_path)
    settings.backup_dir = prev
    _clear_runs()


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_non_sysadmin_forbidden(client: TestClient, backup_dir, sysadmin_enforced) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    assert client.get("/api/admin/backups", headers=headers).status_code == 403
    assert client.post("/api/admin/backups/run", headers=headers).status_code == 403
    assert (
        client.get("/api/admin/backups/bpm-20260101-000000.dump", headers=headers).status_code
        == 403
    )


def test_list_empty_when_dir_missing(client: TestClient, backup_dir) -> None:
    settings.backup_dir = backup_dir + "/does-not-exist"
    res = client.get("/api/admin/backups", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200
    assert res.json() == []


def test_run_sqlite_creates_listable_downloadable_file(client: TestClient, backup_dir) -> None:
    headers = {"X-Dev-User": SYSADMIN}
    res = client.post("/api/admin/backups/run", headers=headers)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "completed"
    filename = body["filename"]
    assert filename.startswith("bpm-") and filename.endswith(".sqlite")

    listed = client.get("/api/admin/backups", headers=headers).json()
    assert [f["filename"] for f in listed] == [filename]
    assert listed[0]["size"] > 0

    download = client.get(f"/api/admin/backups/{filename}", headers=headers)
    assert download.status_code == 200
    # sqlite 파일 매직 헤더 — 유효한 DB 사본인지 원바이트 검증
    assert download.content.startswith(b"SQLite format 3")

    # 성공 기록이 Batch jobs 탭 소스(batch_job_runs)에 남는다
    runs = client.get("/api/admin/batch-runs", headers=headers).json()
    assert any(r["job"] == "db_backup" and r["outcome"] == "success" for r in runs)


def test_run_postgres_writes_trigger_file(client: TestClient, backup_dir, monkeypatch) -> None:
    monkeypatch.setattr(
        settings, "database_url", "postgresql+asyncpg://u:p@db:5432/processmap"
    )
    res = client.post("/api/admin/backups/run", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200
    assert res.json() == {"status": "requested", "filename": None}
    trigger = f"{backup_dir}/{BACKUP_TRIGGER_FILENAME}"
    with open(trigger, encoding="utf-8") as fh:
        assert SYSADMIN in fh.read()


def test_download_rejects_non_whitelisted_names(client: TestClient, backup_dir) -> None:
    headers = {"X-Dev-User": SYSADMIN}
    for name in ["..%2F..%2Fetc%2Fpasswd", "evil.dump", "bpm-1.dump", "backup.request"]:
        assert client.get(f"/api/admin/backups/{name}", headers=headers).status_code == 404
