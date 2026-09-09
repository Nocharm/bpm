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
    # L5 코드는 이 테스트 전용 — 다른 테스트가 같은 코드에 임포트 노트를 남겨 두면 재적재가
    # "교체 결정" 대상이 돼 미체크로 보류된다(design 2026-09-03 followups §3)
    notes = [
        InterviewNote(kind="exception", text="급할 때 수기로 적는다", title="현장 수기", map_code="NOTE-T1"),
        InterviewNote(kind="voc", text="이중 소통 채널 부담", category_code="NOTE-T1-L5"),
        InterviewNote(kind="rule_basis", text="유실 대상", map_code="GHOST-NO-MAP"),
    ]
    assert _apply(notes, "IV scope") == 2  # 미존재 맵 코드는 스킵

    rows = _fetch_notes("IV scope")
    assert [(r.kind, r.map_id, r.category_code) for r in rows] == [
        ("exception", map_id, None),
        ("voc", None, "NOTE-T1-L5"),
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
    """enforcement ON — test_interview_import_api.py의 동일 픽스처를 미러."""
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


def _apply_with_report(notes, label: str):
    """apply_interview_notes를 리포트와 함께 — 거버넌스 notes 행 산출을 본다."""
    from app.db import SessionLocal
    from scripts.import_consultant import ImportReport, apply_interview_notes

    async def _do():
        report = ImportReport()
        async with SessionLocal() as session:
            await apply_interview_notes(session, notes, label=label, report=report)
            await session.commit()
        return report

    return _run(_do())


def test_diff_import_notes_pairs_by_kind_and_title() -> None:
    from scripts.import_consultant import diff_import_notes

    # 본문까지 같은 짝은 결과에서 빠진다 — 빈 결과가 "내용 무변경"의 신호다
    assert diff_import_notes([("voc", "t", "same")], [("voc", "t", "same")]) == []
    # 공백만 다른 본문도 무변경 취급
    assert diff_import_notes([("voc", "t", "same\n")], [("voc", "t", " same")]) == []

    changes = diff_import_notes(
        [("voc", "keep", "old"), ("exception", "gone", "사라질 본문")],
        [("voc", "keep", "new"), ("rule_basis", "fresh", "새 본문")],
    )
    assert [(c.op, c.kind, c.title) for c in changes] == [
        ("changed", "voc", "keep"),
        ("added", "rule_basis", "fresh"),
        ("removed", "exception", "gone"),
    ]
    assert changes[0].prev_text == "old" and changes[0].text == "new"
    assert changes[2].text == "사라질 본문"


def test_diff_import_notes_pairs_duplicate_keys_in_order() -> None:
    from scripts.import_consultant import diff_import_notes

    # 같은 (kind, title)이 여러 건이면 등장 순서대로 짝짓고 남는 쪽만 added/removed
    changes = diff_import_notes(
        [("voc", "dup", "a"), ("voc", "dup", "b")],
        [("voc", "dup", "a"), ("voc", "dup", "B"), ("voc", "dup", "c")],
    )
    assert [(c.op, c.text) for c in changes] == [("changed", "B"), ("added", "c")]


def test_governance_notes_row_hidden_when_content_matches(client: TestClient) -> None:
    from scripts.consultant_interview import InterviewNote

    _seed_consultant_map("NOTE-T3", "노트 내용 비교 대상")
    notes = [InterviewNote(kind="exception", text="예외 본문", title="예외", map_code="NOTE-T3")]

    # 1차 전달 — 기존 임포트 노트가 없으니 거버넌스 행 없이 그냥 삽입
    assert _apply_with_report(notes, "IV diff 1").governance == []
    # 2차 전달, 내용 동일 — 교체할 것이 없어 행을 올리지 않는다
    assert _apply_with_report(notes, "IV diff 2").governance == []

    # 3차 전달, 본문 변경 — 행이 올라오고 note_changes가 실린다
    changed = [InterviewNote(kind="exception", text="고친 본문", title="예외", map_code="NOTE-T3")]
    rows = _apply_with_report(changed, "IV diff 3").governance
    assert [(r.code, r.field) for r in rows] == [("NOTE-T3", "notes")]
    assert [(c.op, c.prev_text, c.text) for c in rows[0].note_changes] == [
        ("changed", "예외 본문", "고친 본문"),
    ]
