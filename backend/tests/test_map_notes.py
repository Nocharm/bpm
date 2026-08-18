"""map_notes — 인터뷰 노트 적재(멱등)·조회 API·가시성 게이트.

설계: docs/design/2026-08-18-interview-import-design.md §5.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

STRANGER_SYSADMIN = "note.sysadmin"


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _seed_consultant_map(code: str, name: str) -> int:
    from app.db import SessionLocal
    from app.models import ProcessMap

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, consultant_code=code, visibility="private")
            session.add(m)
            await session.commit()
            return m.id

    return _run(_seed())


def _fetch_notes(label: str):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapNote

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(
                select(MapNote).where(MapNote.delivery_label == label).order_by(MapNote.id)
            )).all()

    return _run(_load())


def _apply(notes, label: str) -> int:
    from app.db import SessionLocal
    from scripts.import_consultant import apply_interview_notes

    async def _do() -> int:
        async with SessionLocal() as session:
            inserted = await apply_interview_notes(session, notes, label=label)
            await session.commit()
            return inserted

    return _run(_do())


def test_apply_interview_notes_inserts_and_scopes(client: TestClient) -> None:
    from scripts.consultant_interview import InterviewNote

    map_id = _seed_consultant_map("NOTE-T1", "노트 스코프 대상")
    notes = [
        InterviewNote(kind="exception", text="급할 때 수기로 적는다", title="현장 수기", map_code="NOTE-T1"),
        InterviewNote(kind="voc", text="이중 소통 채널 부담", category_code="19-01-06-01-02"),
        InterviewNote(kind="rule_basis", text="유실 대상", map_code="GHOST-NO-MAP"),
    ]
    assert _apply(notes, "IV scope") == 2  # 미존재 맵 코드는 스킵

    rows = _fetch_notes("IV scope")
    assert [(r.kind, r.map_id, r.category_code) for r in rows] == [
        ("exception", map_id, None),
        ("voc", None, "19-01-06-01-02"),
    ]
    assert rows[0].title == "현장 수기" and rows[0].source == "consultant-import"


def test_apply_interview_notes_is_idempotent(client: TestClient) -> None:
    from scripts.consultant_interview import InterviewNote

    _seed_consultant_map("NOTE-T2", "노트 멱등 대상")
    notes = [
        InterviewNote(kind="exception", text="예외 1", map_code="NOTE-T2"),
        InterviewNote(kind="voc", text="전역 VOC", category_code="88-88-88-88-88"),
    ]
    assert _apply(notes, "IV idem") == 2
    assert _apply(notes, "IV idem") == 2  # 재적재 = replace — 행 수 불변
    assert len(_fetch_notes("IV idem")) == 2


def test_get_map_notes_lists_in_order(client: TestClient) -> None:
    from app.db import SessionLocal
    from app.models import MapNote

    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": "노트 조회 맵"}
    ).json()
    map_id = created["id"]

    async def _insert() -> None:
        async with SessionLocal() as session:
            session.add(MapNote(map_id=map_id, kind="exception", title="수기", text="급할 때"))
            session.add(MapNote(map_id=map_id, kind="voc", title=None, text="의견"))
            await session.commit()

    _run(_insert())
    resp = client.get(f"/api/maps/{map_id}/notes")
    assert resp.status_code == 200
    body = resp.json()
    assert [(n["kind"], n["title"], n["text"]) for n in body] == [
        ("exception", "수기", "급할 때"), ("voc", None, "의견"),
    ]
    assert body[0]["source"] == "consultant-import" and body[0]["node_id"] is None
    assert body[0]["created_at"]


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — test_categories_import_api.py의 동일 픽스처를 미러."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def test_map_notes_respects_visibility(client: TestClient, enforce: None) -> None:
    act_as("note.owner")
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": "노트 가시성 맵"}
    ).json()
    map_id = created["id"]

    act_as("note.stranger")  # private 맵, 권한 행 없음 → viewer 게이트 403
    assert client.get(f"/api/maps/{map_id}/notes").status_code == 403

    act_as("note.owner")
    assert client.get(f"/api/maps/{map_id}/notes").status_code == 200
