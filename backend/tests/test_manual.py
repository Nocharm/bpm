"""사용 매뉴얼 게시본 — GET(파일 fallback/DB 우선) · PUT(sysadmin upsert) (S8).

세션 공유 DB라 정의 순서에 의존: fallback 테스트가 PUT(행 삽입)보다 먼저 실행된다.
"""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def test_manual_get_file_fallback(client: TestClient) -> None:
    """DB 미게시 → manual.md 파일 fallback(updated_at=None)."""
    res = client.get("/api/manual")
    assert res.status_code == 200
    body = res.json()
    assert body["format"] == "markdown"
    assert body["updated_at"] is None
    assert "BPM 사용 매뉴얼" in body["content"]  # manual.md 첫 줄


def test_manual_put_requires_sysadmin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """비-sysadmin PUT → 403. 권한검증 ON + sysadmin=타인이라야 경계가 유의미(baseline은 전원 sysadmin)."""
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")  # dev_user 제외
    res = client.put("/api/manual", json={"format": "markdown", "content": "x"})
    assert res.status_code == 403


def test_manual_put_and_get_roundtrip(client: TestClient) -> None:
    """sysadmin PUT → 저장 후 GET은 DB 우선(파일 fallback 아님). baseline은 전원 sysadmin."""
    put = client.put(
        "/api/manual", json={"format": "markdown", "content": "# 새 매뉴얼\n내용"}
    )
    assert put.status_code == 200
    assert put.json()["content"] == "# 새 매뉴얼\n내용"
    assert put.json()["updated_at"] is not None
    assert put.json()["updated_by"] == settings.dev_user

    got = client.get("/api/manual").json()
    assert got["content"] == "# 새 매뉴얼\n내용"
    assert got["updated_at"] is not None


def test_manual_get_bundled_ignores_db(client: TestClient) -> None:
    """bundled=true → DB 게시본 무시하고 배포 manual.md 원문 반환(편집기 '배포본 불러오기')."""
    got = client.get("/api/manual?bundled=true").json()
    assert "BPM 사용 매뉴얼" in got["content"]  # 배포 파일 첫 줄
    assert "새 매뉴얼" not in got["content"]  # 앞 roundtrip이 남긴 DB 행 무시
    assert got["updated_at"] is None


# ── 다중 문서 (F10) ─────────────────────────────────────────────


def test_manual_docs_create_extracts_title_and_orders(client: TestClient) -> None:
    """POST — 제목은 본문 첫 헤딩에서 자동 추출, sort_order는 업로드 순번."""
    a = client.post(
        "/api/manual/docs",
        json={"language": "ko", "format": "markdown", "content": "# 시작하기\n본문"},
    )
    assert a.status_code == 200
    assert a.json()["title"] == "시작하기"
    b = client.post(
        "/api/manual/docs",
        json={"language": "en", "format": "markdown", "content": "# Getting Started\nbody"},
    )
    assert b.json()["title"] == "Getting Started"
    assert b.json()["sort_order"] == a.json()["sort_order"] + 1
    # html 문서 — 첫 h태그에서 추출
    c = client.post(
        "/api/manual/docs",
        json={"language": "ko", "format": "html", "content": "<div><h1>HTML 가이드</h1></div>"},
    )
    assert c.json()["title"] == "HTML 가이드"


def test_manual_docs_list_filters_language(client: TestClient) -> None:
    """목록 — language 필터 + content 미포함 + 순서 유지. 레거시 단일 게시본 행(ko)도 함께 노출."""
    ko = client.get("/api/manual/docs?language=ko").json()
    en = client.get("/api/manual/docs?language=en").json()
    assert all(row["language"] == "ko" for row in ko)
    assert [row["title"] for row in en] == ["Getting Started"]
    assert all("content" not in row for row in ko)
    # 앞 roundtrip 테스트가 남긴 레거시 행(id=1) — language 기본 ko, 제목은 읽기 시점 추출
    assert any(row["id"] == 1 and row["title"] == "새 매뉴얼" for row in ko)


def test_manual_docs_update_reextracts_title(client: TestClient) -> None:
    created = client.post(
        "/api/manual/docs",
        json={"language": "ko", "format": "markdown", "content": "# 이전 제목\n본문"},
    ).json()
    updated = client.put(
        f"/api/manual/docs/{created['id']}", json={"content": "# 새 제목\n다른 본문"}
    ).json()
    assert updated["title"] == "새 제목"
    assert updated["language"] == "ko"  # 미지정 필드 유지
    detail = client.get(f"/api/manual/docs/{created['id']}").json()
    assert detail["content"] == "# 새 제목\n다른 본문"


def test_manual_docs_delete_and_404(client: TestClient) -> None:
    created = client.post(
        "/api/manual/docs",
        json={"language": "en", "format": "markdown", "content": "# Temp\nbody"},
    ).json()
    assert client.delete(f"/api/manual/docs/{created['id']}").status_code == 204
    assert client.get(f"/api/manual/docs/{created['id']}").status_code == 404


def test_manual_docs_write_requires_sysadmin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "other.admin")
    res = client.post(
        "/api/manual/docs",
        json={"language": "ko", "format": "markdown", "content": "# x"},
    )
    assert res.status_code == 403
