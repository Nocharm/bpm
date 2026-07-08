"""AI 챗 서버 저장 히스토리 — 세션/메시지 write-through·조회·정리 (design 2026-07-08)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from tests.test_ai import _draft_version_checked_out, _enable_ai, _fake_ai

# _draft_version_checked_out의 체크아웃 보유자(dev_user 기본값)와 다른 사용자 — 타인 세션 접근 검증용
OTHER_USER = {"X-Dev-User": "other.user"}


def _read_table(client: TestClient, name: str) -> list[dict]:
    resp = client.get(f"/api/admin/tables/{name}", params={"size": 200})  # size 상한(MAX_PAGE_SIZE)
    assert resp.status_code == 200
    return resp.json()["rows"]


def test_chat_tables_registered(client: TestClient) -> None:
    # create_all이 신규 2테이블을 만들고 admin 브라우저(metadata 기반)에 노출된다
    names = [t["name"] for t in client.get("/api/admin/tables").json()]
    assert "ai_chat_sessions" in names
    assert "ai_chat_messages" in names


def test_chat_request_accepts_session_id() -> None:
    from app.schemas import AiChatRequest

    req = AiChatRequest.model_validate({"instruction": "hi", "session_id": 7})
    assert req.session_id == 7
    assert AiChatRequest.model_validate({"instruction": "hi"}).session_id is None


def _my_sessions(client: TestClient) -> list[dict]:
    return _read_table(client, "ai_chat_sessions")


def _session_messages(client: TestClient, session_id: int) -> list[dict]:
    rows = _read_table(client, "ai_chat_messages")
    return [r for r in rows if r["session_id"] == session_id]


def test_chat_write_through_creates_session_and_two_rows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "저장 답변"}))
    )
    version_id = _draft_version_checked_out(client)

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat",
        json={"instruction": "  제목   파생   테스트 질문입니다  "},
    )
    assert resp.status_code == 200
    session_id = resp.json()["session_id"]
    assert isinstance(session_id, int)

    row = next(s for s in _my_sessions(client) if s["id"] == session_id)
    assert row["title"] == "제목 파생 테스트 질문입니다"  # 공백 정리 + 40자 컷
    msgs = _session_messages(client, session_id)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "  제목   파생   테스트 질문입니다  "
    assert msgs[1]["content"] == "저장 답변"
    assert msgs[1]["kind"] == "answer"
    assert msgs[0]["version_id"] == version_id


def test_chat_write_through_reuses_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "둘째 답"}))
    )
    version_id = _draft_version_checked_out(client)
    first = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "첫 질문"}
    ).json()
    second = client.post(
        f"/api/versions/{version_id}/ai/chat",
        json={"instruction": "둘째 질문", "session_id": first["session_id"]},
    ).json()
    assert second["session_id"] == first["session_id"]
    msgs = _session_messages(client, first["session_id"])
    assert len(msgs) == 4
    # 제목은 첫 질문에서 고정 — 이어지는 질문으로 바뀌지 않는다
    row = next(s for s in _my_sessions(client) if s["id"] == first["session_id"])
    assert row["title"] == "첫 질문"


def test_chat_no_rows_when_ai_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)

    async def _boom(messages: list[dict], model: str | None = None) -> str:
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_chat_messages"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "유령?"})
    assert resp.status_code == 502
    assert len(_read_table(client, "ai_chat_messages")) == before


def test_chat_rejects_foreign_or_mismatched_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "x"}))
    )
    version_a = _draft_version_checked_out(client)
    version_b = _draft_version_checked_out(client)  # 다른 맵의 버전
    owned = client.post(
        f"/api/versions/{version_a}/ai/chat", json={"instruction": "내 세션"}
    ).json()["session_id"]

    # 타인 소유 — 404 (존재 노출 안 함)
    resp = client.post(
        f"/api/versions/{version_a}/ai/chat",
        json={"instruction": "남의 세션", "session_id": owned},
        headers=OTHER_USER,
    )
    assert resp.status_code == 404

    # 맵 불일치 — 404
    resp = client.post(
        f"/api/versions/{version_b}/ai/chat",
        json={"instruction": "다른 맵", "session_id": owned},
    )
    assert resp.status_code == 404
