"""배포 문서 파일 — 매뉴얼 자동 동기화(docs/manual)·파일 문서 편집 잠금·공지 초안 불러오기(docs/notices) (사용자 결정 2026-11-05)."""

import asyncio
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app import doc_files
from app.db import SessionLocal
from app.models import ManualDoc
from app.settings import settings


def _sync(directory: Path) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await doc_files.sync_manual_files(session, directory)
            await session.commit()

    asyncio.run(_run())


def _synced_rows() -> list[ManualDoc]:
    async def _run() -> list[ManualDoc]:
        async with SessionLocal() as session:
            rows = await session.scalars(
                select(ManualDoc).where(ManualDoc.source_file.is_not(None)).order_by(ManualDoc.sort_order, ManualDoc.language)
            )
            return list(rows.all())

    return asyncio.run(_run())


@pytest.fixture
def manual_dir(tmp_path: Path) -> Iterator[Path]:
    """임시 매뉴얼 폴더 — 끝나면 이 테스트가 만든 파일 문서를 지운다(다른 매뉴얼 테스트의 목록을 오염시키지 않게)."""
    directory = tmp_path / "manual"
    directory.mkdir()
    yield directory

    async def _cleanup() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(ManualDoc).where(ManualDoc.source_file.is_not(None)))
            await session.commit()

    asyncio.run(_cleanup())


def _write(directory: Path, name: str, body: str) -> None:
    (directory / name).write_text(body, encoding="utf-8")


def test_sync_creates_docs_in_pair_order(client: TestClient, manual_dir: Path) -> None:
    _write(manual_dir, "admin-manual-ko.md", "# 관리자 매뉴얼\n본문")
    _write(manual_dir, "user-manual-general-en.md", "# Getting Around\nbody")
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n본문")
    _write(manual_dir, "notes.md", "# 언어 꼬리 없음\n")  # 이름 규칙 밖 — 건너뛴다

    _sync(manual_dir)

    rows = _synced_rows()
    assert [(r.source_file, r.language, r.title, r.sort_order) for r in rows] == [
        ("user-manual-general-en.md", "en", "Getting Around", 0),
        ("user-manual-general-ko.md", "ko", "사용 안내", 0),
        ("admin-manual-ko.md", "ko", "관리자 매뉴얼", 2),
    ]
    assert all(r.updated_by == doc_files.SYNC_ACTOR and r.format == "markdown" for r in rows)


def test_sync_updates_changed_files_only_and_removes_deleted_ones(client: TestClient, manual_dir: Path) -> None:
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n첫 판")
    _write(manual_dir, "user-manual-editing-ko.md", "# 맵 편집\n첫 판")
    _sync(manual_dir)
    before = {r.source_file: r.updated_at for r in _synced_rows()}

    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n둘째 판")
    (manual_dir / "user-manual-editing-ko.md").unlink()
    _write(manual_dir, "admin-manual-ko.md", "# 관리자 매뉴얼\n새 문서")
    _sync(manual_dir)

    rows = {r.source_file: r for r in _synced_rows()}
    assert set(rows) == {"user-manual-general-ko.md", "admin-manual-ko.md"}
    assert rows["user-manual-general-ko.md"].content == "# 사용 안내\n둘째 판"
    assert rows["user-manual-general-ko.md"].updated_at != before["user-manual-general-ko.md"]


def test_sync_leaves_unchanged_docs_untouched(client: TestClient, manual_dir: Path) -> None:
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n그대로")
    _sync(manual_dir)
    first = _synced_rows()[0].updated_at

    _sync(manual_dir)

    assert _synced_rows()[0].updated_at == first


def test_sync_adopts_a_hand_uploaded_doc_with_the_same_title(client: TestClient, manual_dir: Path) -> None:
    uploaded = client.post(
        "/api/manual/docs", json={"language": "ko", "format": "markdown", "content": "# 맵 편집 가이드\n손으로 올린 판"}
    ).json()
    _write(manual_dir, "user-manual-editing-ko.md", "# 맵 편집 가이드\n파일 판")

    _sync(manual_dir)

    rows = _synced_rows()
    assert [(r.id, r.source_file, r.content) for r in rows] == [
        (uploaded["id"], "user-manual-editing-ko.md", "# 맵 편집 가이드\n파일 판")
    ]


def test_sync_without_files_changes_nothing(client: TestClient, manual_dir: Path) -> None:
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n본문")
    _sync(manual_dir)

    _sync(manual_dir.parent / "missing")  # 마운트가 빠진 기동

    assert [r.source_file for r in _synced_rows()] == ["user-manual-general-ko.md"]


def test_file_synced_doc_is_locked_but_listed(client: TestClient, manual_dir: Path) -> None:
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n본문")
    _sync(manual_dir)
    doc_id = _synced_rows()[0].id

    listed = client.get("/api/manual/docs?language=ko").json()
    put = client.put(f"/api/manual/docs/{doc_id}", json={"content": "# 덮어쓰기\n"})
    removed = client.delete(f"/api/manual/docs/{doc_id}")

    assert next(r for r in listed if r["id"] == doc_id)["source_file"] == "user-manual-general-ko.md"
    assert (put.status_code, put.json()["detail"]) == (409, "this document is synced from a deployed file - edit the file and redeploy")
    assert removed.status_code == 409


# ── 공지 초안 ──


@pytest.fixture
def notice_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(doc_files, "DOCS_DIR", tmp_path)
    directory = tmp_path / doc_files.NOTICE_DIR_NAME
    directory.mkdir()
    _write(directory, "2026-10-21-release.md", "# 업데이트 안내: v1.1.1\n\n<!-- 게시 메모: 배포와 함께 -->\n\n본문 첫 줄\n\n## 홈\n- 항목")
    _write(directory, "2026-11-05-release.md", "<!-- 메모 -->\n# 업데이트 안내: v1.5.0\n본문")
    _write(directory, "2026-09-28-meeting.md", "회의 준비 메모만 있고 제목이 없다")
    return directory


def test_notice_drafts_list_newest_first(client: TestClient, notice_dir: Path) -> None:
    res = client.get("/api/notices/drafts")

    assert res.status_code == 200
    assert res.json() == [
        {"file": "2026-11-05-release.md", "title": "업데이트 안내: v1.5.0", "body": ""},
        {"file": "2026-10-21-release.md", "title": "업데이트 안내: v1.1.1", "body": ""},
        {"file": "2026-09-28-meeting.md", "title": "2026-09-28-meeting", "body": ""},
    ]


def test_notice_draft_drops_heading_and_publisher_comments(client: TestClient, notice_dir: Path) -> None:
    res = client.get("/api/notices/drafts/2026-10-21-release.md")

    assert res.status_code == 200
    assert res.json() == {"file": "2026-10-21-release.md", "title": "업데이트 안내: v1.1.1", "body": "본문 첫 줄\n\n## 홈\n- 항목"}


def test_notice_draft_rejects_unknown_or_outside_files(client: TestClient, notice_dir: Path) -> None:
    (notice_dir.parent / "secret.md").write_text("# no", encoding="utf-8")

    assert client.get("/api/notices/drafts/nope.md").status_code == 404
    assert client.get("/api/notices/drafts/..%2Fsecret.md").status_code == 404


def test_notice_drafts_need_sysadmin(client: TestClient, notice_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")

    assert client.get("/api/notices/drafts", headers={"X-Dev-User": "plain.user"}).status_code == 403
    assert client.get("/api/notices/drafts/2026-10-21-release.md", headers={"X-Dev-User": "plain.user"}).status_code == 403


def test_manual_list_resyncs_when_files_change(
    client: TestClient, manual_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docs만 바뀐 배포(backend 재기동 없음)도 매뉴얼 목록을 열면 파일 내용으로 맞춘다."""
    monkeypatch.setattr(doc_files, "DOCS_DIR", manual_dir.parent)
    monkeypatch.setattr(doc_files, "_synced_signature", None)
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내\n첫 판")
    first = client.get("/api/manual/docs?language=ko").json()
    _write(manual_dir, "user-manual-general-ko.md", "# 사용 안내 (개정)\n둘째 판입니다")

    second = client.get("/api/manual/docs?language=ko").json()

    assert [r["title"] for r in first if r["source_file"]] == ["사용 안내"]
    assert [r["title"] for r in second if r["source_file"]] == ["사용 안내 (개정)"]
