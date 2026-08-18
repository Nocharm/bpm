"""인터뷰 다중 파일 웹 임포트 — POST /api/categories/import-interview.

설계: docs/design/2026-08-18-interview-import-design.md §1·§6. 파일별 독립(에러 파일 스킵),
dry-run 기본, 노트 적재 동반.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings
from tests.test_consultant_interview import _interview

STRANGER_SYSADMIN = "iv.sysadmin"


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _post(client: TestClient, files: list[dict], apply: bool = False):
    return client.post(
        "/api/categories/import-interview",
        json={"files": files, "apply": apply, "label": "IV web"},
    )


def _map_row(code: str):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == code)
            )).first()

    return _run(_load())


def test_dry_run_reports_files_without_persisting(client: TestClient) -> None:
    resp = _post(client, [{"name": "calibration.json", "content": _interview()}])
    assert resp.status_code == 200
    body = resp.json()
    assert body["applied"] is False
    assert len(body["files"]) == 1
    f = body["files"][0]
    assert f["name"] == "calibration.json" and f["ok"] is True
    assert f["map_count"] == 1 and f["note_count"] == 3
    assert body["summary"]["created"] == 1 and body["summary"]["notes"] == 3
    assert any(r["code"] == "task-prep-0001" for r in body["rows"])
    assert _map_row("task-prep-0001") is None  # rollback — DB 무변경


def test_apply_persists_maps_and_notes(client: TestClient) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapNote

    resp = _post(client, [{"name": "calibration.json", "content": _interview()}], apply=True)
    assert resp.status_code == 200
    assert resp.json()["applied"] is True
    m = _map_row("task-prep-0001")
    assert m is not None and m.consultant_owner_pending is True
    assert m.description.startswith("[Interview]")

    async def _notes():
        async with SessionLocal() as session:
            on_map = (await session.scalars(select(MapNote).where(MapNote.map_id == m.id))).all()
            global_notes = (await session.scalars(
                select(MapNote).where(MapNote.map_id.is_(None),
                                      MapNote.category_code == "19-01-06-01-02")
            )).all()
        return on_map, global_notes

    on_map, global_notes = _run(_notes())
    assert sorted(n.kind for n in on_map) == ["exception", "rule_basis"]
    assert [n.kind for n in global_notes] == ["voc"]


def test_error_file_skipped_but_others_proceed(client: TestClient) -> None:
    bad = _interview()
    bad["l5"]["nodeCode"] = "00-00"  # framework에 없는 L5 → 파일 error
    good = _interview()
    good["rows"][0]["taskId"] = "task-good-0001"
    resp = _post(client, [
        {"name": "bad.json", "content": bad},
        {"name": "good.json", "content": good},
    ])
    body = resp.json()
    assert body["files"][0]["ok"] is False and body["files"][0]["map_count"] == 0
    assert any(i["severity"] == "error" for i in body["files"][0]["issues"])
    assert body["files"][1]["ok"] is True and body["files"][1]["map_count"] == 1
    assert body["summary"]["created"] == 1


def test_duplicate_task_id_across_files_skips_later_file(client: TestClient) -> None:
    # 앞선 apply 테스트와 독립되도록 고유 taskId 사용(세션 공유 DB — created 카운트 오염 방지)
    one = _interview()
    one["rows"][0]["taskId"] = "task-dup-0001"
    two = _interview()
    two["rows"][0]["taskId"] = "task-dup-0001"  # 같은 taskId — 같은 파일 재선택 실수
    resp = _post(client, [
        {"name": "one.json", "content": one},
        {"name": "two.json", "content": two},
    ])
    body = resp.json()
    assert body["files"][0]["ok"] is True
    assert body["files"][1]["ok"] is False
    assert any("duplicate taskId" in i["message"] for i in body["files"][1]["issues"])
    assert body["summary"]["created"] == 1


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def test_non_sysadmin_forbidden(client: TestClient, enforce: None) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: "iv.regular"
    resp = _post(client, [{"name": "calibration.json", "content": _interview()}])
    assert resp.status_code == 403
