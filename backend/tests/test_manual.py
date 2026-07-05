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
