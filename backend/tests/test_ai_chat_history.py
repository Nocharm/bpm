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


def _make_session_with_messages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, turns: int
) -> tuple[int, int]:
    """버전 하나 만들고 /ai/chat을 turns회 호출 — (version_id, session_id) 반환."""
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "ok"}))
    )
    version_id = _draft_version_checked_out(client)
    session_id = None
    for i in range(turns):
        body = {"instruction": f"질문 {i + 1}"}
        if session_id is not None:
            body["session_id"] = session_id
        session_id = client.post(
            f"/api/versions/{version_id}/ai/chat", json=body
        ).json()["session_id"]
    assert session_id is not None
    return version_id, session_id


def test_list_sessions_scoped_and_with_map_info(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid_a = _make_session_with_messages(client, monkeypatch, turns=1)
    _, sid_b = _make_session_with_messages(client, monkeypatch, turns=1)  # 다른 맵

    body = client.get("/api/ai/chat-sessions").json()
    ids = [s["id"] for s in body["sessions"]]
    assert sid_a in ids and sid_b in ids
    row = next(s for s in body["sessions"] if s["id"] == sid_a)
    assert row["map_name"].startswith("ai map")
    assert row["message_count"] == 2
    assert row["title"] == "질문 1"

    # map_id 필터 — 해당 맵 것만
    map_id = row["map_id"]
    filtered = client.get("/api/ai/chat-sessions", params={"map_id": map_id}).json()
    assert all(s["map_id"] == map_id for s in filtered["sessions"])
    assert sid_a in [s["id"] for s in filtered["sessions"]]
    assert sid_b not in [s["id"] for s in filtered["sessions"]]

    # 타 사용자 목록엔 안 보인다
    other = client.get("/api/ai/chat-sessions", headers=OTHER_USER).json()
    assert sid_a not in [s["id"] for s in other["sessions"]]


def test_list_sessions_excludes_soft_deleted_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    map_id = next(
        s["map_id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"] if s["id"] == sid
    )
    assert client.delete(f"/api/maps/{map_id}").status_code in (200, 204)  # 소프트 삭제
    assert sid not in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    client.post(f"/api/maps/{map_id}/restore")  # 공유 DB 원복


def test_messages_paging_with_before_cursor(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=4)  # 메시지 8개

    first = client.get(f"/api/ai/chat-sessions/{sid}/messages", params={"limit": 3}).json()
    assert len(first["messages"]) == 3 and first["has_more"] is True
    # 시간 오름차순 — 페이지의 마지막이 가장 최근(assistant "ok")
    assert first["messages"][-1]["role"] == "assistant"
    ids = [m["id"] for m in first["messages"]]
    assert ids == sorted(ids)

    second = client.get(
        f"/api/ai/chat-sessions/{sid}/messages",
        params={"limit": 3, "before": first["messages"][0]["id"]},
    ).json()
    assert len(second["messages"]) == 3 and second["has_more"] is True
    assert max(m["id"] for m in second["messages"]) < min(ids)

    third = client.get(
        f"/api/ai/chat-sessions/{sid}/messages",
        params={"limit": 3, "before": second["messages"][0]["id"]},
    ).json()
    assert len(third["messages"]) == 2 and third["has_more"] is False


def test_messages_and_delete_are_owner_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    assert (
        client.get(f"/api/ai/chat-sessions/{sid}/messages", headers=OTHER_USER).status_code == 404
    )
    assert client.delete(f"/api/ai/chat-sessions/{sid}", headers=OTHER_USER).status_code == 404
    assert client.get("/api/ai/chat-sessions/999999/messages").status_code == 404


def test_delete_session_cascades_messages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=2)
    assert client.delete(f"/api/ai/chat-sessions/{sid}").status_code == 204
    assert sid not in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert _session_messages(client, sid) == []


def _put_limits(client: TestClient, **limits: int) -> None:
    assert client.put("/api/admin/app-settings", json=limits).status_code == 200


def test_prune_messages_over_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _put_limits(client, ai_chat_max_messages_per_session=10)
    try:
        _, sid = _make_session_with_messages(client, monkeypatch, turns=7)  # 14개 적재 시도
        msgs = _session_messages(client, sid)
        assert len(msgs) == 10  # 오래된 4개 삭제
        assert msgs[0]["content"] == "질문 3"  # 앞쪽(1~2턴)이 잘려나감
    finally:
        _put_limits(client, ai_chat_max_messages_per_session=200)


def test_prune_sessions_over_cap_same_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _put_limits(client, ai_chat_max_sessions_per_map=2)
    try:
        version_id, sid1 = _make_session_with_messages(client, monkeypatch, turns=1)
        sid2 = client.post(
            f"/api/versions/{version_id}/ai/chat", json={"instruction": "세션2"}
        ).json()["session_id"]
        sid3 = client.post(
            f"/api/versions/{version_id}/ai/chat", json={"instruction": "세션3"}
        ).json()["session_id"]
        ids = [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
        assert sid1 not in ids  # 최오래(활동 기준) 퇴출
        assert sid2 in ids and sid3 in ids
        assert _session_messages(client, sid1) == []  # cascade
    finally:
        _put_limits(client, ai_chat_max_sessions_per_map=20)


def test_retention_prunes_stale_sessions_on_list(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from app import clock

    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    real_now = clock.now
    # 목록 조회 시점의 '지금'을 200일 뒤로 — retention 180일 초과
    monkeypatch.setattr(
        "app.chat_history.now_kst", lambda: real_now() + timedelta(days=200)
    )
    ids = [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert sid not in ids


# ── 제안 페이로드 저장 — 카드 히스토리 재현 (design 2026-07-10) ─────────────


def test_parse_proposal_payload_degrades_corrupt_to_none() -> None:
    from app.chat_history import parse_proposal_payload

    assert parse_proposal_payload(None) is None
    assert parse_proposal_payload("") is None
    assert parse_proposal_payload("not json{") is None
    assert parse_proposal_payload("[1, 2]") is None  # dict 아님 — 강등
    assert parse_proposal_payload('{"findings": []}') == {"findings": []}


def test_chat_stores_payload_for_analysis(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    finding = {
        "severity": "high",
        "category": "orphan",
        "node_ids": [],
        "message": "고아 노드",
        "suggestion": "연결하세요",
    }
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(json.dumps({"kind": "analysis", "message": "분석", "findings": [finding]})),
    )
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "분석해줘"})
    assert resp.status_code == 200
    session_id = resp.json()["session_id"]

    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    assert msgs[0]["payload"] is None  # user 메시지는 항상 NULL
    assistant = msgs[1]
    assert assistant["kind"] == "analysis"
    assert assistant["payload"]["findings"][0]["category"] == "orphan"
    assert assistant["payload"]["findings"][0]["severity"] == "high"


def test_chat_answer_payload_is_null(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "도움말"}))
    )
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "어떻게 써?"})
    session_id = resp.json()["session_id"]
    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    assert all(m["payload"] is None for m in msgs)


def test_chat_stores_payload_for_graph(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    content = json.dumps(
        {
            "kind": "graph",
            "message": "그렸어요",
            "nodes": [
                {"key": "a", "title": "시작", "node_type": "start"},
                {"key": "b", "title": "처리", "node_type": "process"},
            ],
            "edges": [{"source": "a", "target": "b"}],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"})
    session_id = resp.json()["session_id"]
    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    payload = msgs[1]["payload"]
    assert [n["key"] for n in payload["nodes"]] == ["a", "b"]
    assert payload["edges"][0]["source"] == "a"
    assert payload["groups"] == []


# ── AI 사용량 이벤트 (design 2026-07-11 B1) ─────────────


def test_ai_usage_event_recorded_on_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(json.dumps({"kind": "answer", "message": "hi"}), prompt_tokens=1234, completion_tokens=56),
    )
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_usage_events"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "질문"})
    assert resp.status_code == 200
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    event = events[-1]
    assert event["ok"] in (True, 1)  # sqlite bool 표현 관용
    assert event["kind"] == "answer"
    assert event["prompt_tokens"] == 1234
    assert event["completion_tokens"] == 56
    assert event["version_id"] == version_id
    assert event["login_id"]  # 호출 사용자 기록


def test_ai_usage_event_recorded_on_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)

    async def _boom(messages: list[dict], model: str | None = None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_usage_events"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "유령?"})
    assert resp.status_code == 502
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    event = events[-1]
    assert event["ok"] in (False, 0)
    assert event["kind"] is None
    assert event["prompt_tokens"] is None
    # 실패 시에도 대화 메시지는 저장되지 않는다(기존 계약 유지)
    # — test_chat_no_rows_when_ai_fails가 이미 보증하므로 여기선 이벤트만 단언
