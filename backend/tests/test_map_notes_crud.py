"""맵·L5 노트 CRUD — 맵은 오너, L5는 체인 권한자/sysadmin. 임포트 노트 수정은 edited_at만 찍힌다
(design 2026-09-03 followups §3)."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.models import CategoryPermission, MapNote, MapPermission, ProcessCategory
from tests.test_subprocess_designation import (
    OTHER,
    OWNER,
    SYSADMIN,
    _seed,
    act_as,
    enforce,  # noqa: F401 — 픽스처 재사용(usefixtures로 참조)
    seed_map,
)

EDITOR = "note.editor"
L5_ADMIN = "note.l5admin"


def _grant(map_id: int, user: str, role: str) -> None:
    async def _make(session) -> None:
        session.add(MapPermission(
            map_id=map_id, principal_type="user", principal_id=user, role=role, granted_by=SYSADMIN,
        ))

    _seed(_make)


def _seed_import_note(map_id: int) -> int:
    async def _make(session) -> int:
        note = MapNote(map_id=map_id, kind="exception", title="현장 수기", text="원문", source="consultant-import")
        session.add(note)
        await session.flush()
        return note.id

    return _seed(_make)


def _seed_l5(code: str, admin: str) -> int:
    async def _make(session) -> int:
        cat = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
        if cat is None:
            cat = ProcessCategory(code=code, name=f"L5 {code}", level=5, sort_order=0)
            session.add(cat)
            await session.flush()
            session.add(CategoryPermission(
                category_id=cat.id, principal_type="user", principal_id=admin, granted_by=SYSADMIN,
            ))
            session.add(MapNote(map_id=None, category_code=code, kind="open_item", text="열린 이슈",
                                source="consultant-import"))
        return cat.id

    return _seed(_make)


@pytest.mark.usefixtures("enforce")
def test_owner_creates_edits_and_deletes_map_note(client: TestClient) -> None:
    map_id = seed_map("note-crud", published=True)
    act_as(OWNER)
    res = client.post(f"/api/maps/{map_id}/notes", json={"kind": "voc", "title": " 현업 요청 ", "text": "빨리"})
    assert res.status_code == 201
    note = res.json()
    assert (note["kind"], note["title"], note["source"], note["edited_at"]) == ("voc", "현업 요청", "user", None)

    res = client.patch(f"/api/maps/{map_id}/notes/{note['id']}", json={"text": "더 빨리", "kind": "[custom]"})
    assert res.status_code == 200
    assert res.json()["text"] == "더 빨리" and res.json()["kind"] == "[custom]"
    assert res.json()["edited_at"] is not None

    listed = client.get(f"/api/maps/{map_id}/notes").json()
    assert [n["id"] for n in listed] == [note["id"]]
    assert client.delete(f"/api/maps/{map_id}/notes/{note['id']}").status_code == 204
    assert client.get(f"/api/maps/{map_id}/notes").json() == []


@pytest.mark.usefixtures("enforce")
def test_editor_and_viewer_cannot_write_map_notes(client: TestClient) -> None:
    map_id = seed_map("note-perm", published=True)
    _grant(map_id, EDITOR, "editor")
    note_id = _seed_import_note(map_id)
    act_as(EDITOR)
    assert client.get(f"/api/maps/{map_id}/notes").status_code == 200  # viewer 이상 열람
    assert client.post(f"/api/maps/{map_id}/notes", json={"kind": "note", "text": "x"}).status_code == 403
    assert client.patch(f"/api/maps/{map_id}/notes/{note_id}", json={"text": "y"}).status_code == 403
    assert client.delete(f"/api/maps/{map_id}/notes/{note_id}").status_code == 403
    act_as(OTHER)
    assert client.post(f"/api/maps/{map_id}/notes", json={"kind": "note", "text": "x"}).status_code in (403, 404)


@pytest.mark.usefixtures("enforce")
def test_editing_import_note_keeps_source_and_marks_edited(client: TestClient) -> None:
    map_id = seed_map("note-import-edit", published=True)
    note_id = _seed_import_note(map_id)
    act_as(OWNER)
    res = client.patch(f"/api/maps/{map_id}/notes/{note_id}", json={"text": "고친 원문"})
    assert res.status_code == 200
    assert res.json()["source"] == "consultant-import" and res.json()["edited_at"] is not None
    assert client.patch(f"/api/maps/{map_id}/notes/999999", json={"text": "x"}).status_code == 404


@pytest.mark.usefixtures("enforce")
def test_category_notes_visible_to_all_but_written_by_chain_admin(client: TestClient) -> None:
    cat_id = _seed_l5("NOTE-L5-A", L5_ADMIN)
    act_as(OTHER)
    body = client.get(f"/api/categories/{cat_id}/notes").json()
    assert body["can_edit"] is False and [n["kind"] for n in body["notes"]] == ["open_item"]
    assert client.post(f"/api/categories/{cat_id}/notes", json={"kind": "note", "text": "x"}).status_code == 403

    act_as(L5_ADMIN)
    body = client.get(f"/api/categories/{cat_id}/notes").json()
    assert body["can_edit"] is True
    created = client.post(f"/api/categories/{cat_id}/notes", json={"kind": "rule_basis", "text": "규정 근거"})
    assert created.status_code == 201 and created.json()["source"] == "user"
    nid = created.json()["id"]
    assert client.patch(f"/api/categories/{cat_id}/notes/{nid}", json={"title": "SOP-1"}).json()["title"] == "SOP-1"
    assert client.delete(f"/api/categories/{cat_id}/notes/{nid}").status_code == 204

    act_as(SYSADMIN)
    assert client.post(f"/api/categories/{cat_id}/notes", json={"kind": "note", "text": "admin"}).status_code == 201
