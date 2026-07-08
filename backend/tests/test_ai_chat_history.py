"""AI 챗 서버 저장 히스토리 — 세션/메시지 write-through·조회·정리 (design 2026-07-08)."""

from fastapi.testclient import TestClient


def _read_table(client: TestClient, name: str) -> list[dict]:
    resp = client.get(f"/api/admin/tables/{name}", params={"size": 500})
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
