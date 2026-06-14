"""On-prem AI chat tests — AI server mocked via monkeypatch (design 2026-06-15)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from app.settings import settings


def test_ai_settings_default_disabled() -> None:
    assert settings.ai_enabled is False
    assert settings.ai_timeout_seconds == 60


def test_proposal_rejects_orphan_edge() -> None:
    from pydantic import ValidationError

    from app.schemas import AiProposal

    with pytest.raises(ValidationError):
        AiProposal.model_validate(
            {
                "kind": "graph",
                "message": "x",
                "nodes": [{"key": "a", "title": "A", "node_type": "process"}],
                "edges": [{"source": "a", "target": "ghost"}],
            }
        )


def test_proposal_rejects_bad_node_type() -> None:
    from pydantic import ValidationError

    from app.schemas import AiProposal

    with pytest.raises(ValidationError):
        AiProposal.model_validate(
            {
                "kind": "graph",
                "message": "x",
                "nodes": [{"key": "a", "title": "A", "node_type": "loop"}],
                "edges": [],
            }
        )


def test_proposal_answer_ok_without_graph() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate({"kind": "answer", "message": "hello"})
    assert proposal.kind == "answer"
    assert proposal.nodes == []


def test_manual_loads_nonempty() -> None:
    from app.manual import get_manual

    assert len(get_manual().strip()) > 0


def test_build_messages_includes_graph_manual_and_instruction() -> None:
    from app.ai_prompt import build_messages
    from app.schemas import AiChatTurn, EdgeIn, GraphOut, NodeOut

    graph = GraphOut(
        nodes=[NodeOut(id="x1", title="발주", node_type="start")],
        edges=[EdgeIn(id="e1", source_node_id="x1", target_node_id="x1")],
        groups=[],
    )
    messages = build_messages(
        manual="MANUAL_BODY",
        current_graph=graph,
        can_edit=True,
        instruction="구매 프로세스 그려줘",
        history=[AiChatTurn(role="user", content="이전")],
    )

    system = messages[0]["content"]
    assert messages[0]["role"] == "system"
    assert "발주" in system  # 현재 그래프 직렬화
    assert "MANUAL_BODY" in system  # 매뉴얼 주입
    assert messages[-1] == {"role": "user", "content": "구매 프로세스 그려줘"}
    assert any(turn["content"] == "이전" for turn in messages)  # history 포함


def _enable_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str):
    async def _call(messages: list[dict], model: str | None = None) -> str:
        return content

    return _call


def _draft_version_checked_out(client: TestClient) -> int:
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


def test_ai_disabled_returns_503(client: TestClient) -> None:
    version_id = _draft_version_checked_out(client)
    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "draw"}
    )
    assert resp.status_code == 503


def test_ai_graph_proposal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
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

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "graph"
    assert len(body["nodes"]) == 2


def test_ai_answer_proposal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "도움말"}))
    )

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "어떻게 써?"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "answer"


def test_ai_graph_downgraded_when_not_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    # 체크아웃하지 않은 버전 → can_edit False
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]
    content = json.dumps(
        {
            "kind": "graph",
            "message": "x",
            "nodes": [{"key": "a", "title": "A", "node_type": "process"}],
            "edges": [],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "answer"  # 편집 불가 → 그래프 다운그레이드


def test_ai_invalid_then_retry_succeeds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    valid = json.dumps({"kind": "answer", "message": "ok"})
    calls = {"n": 0}

    async def _flaky(messages: list[dict], model: str | None = None) -> str:
        calls["n"] += 1
        return "not json" if calls["n"] == 1 else valid

    monkeypatch.setattr(ai_client, "call_ai", _flaky)

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "?"}
    )

    assert resp.status_code == 200
    assert calls["n"] == 2  # 1회 재프롬프트


def test_ai_invalid_twice_returns_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai("still not json"))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "?"}
    )

    assert resp.status_code == 502


def test_ai_server_error_returns_502_without_leaking_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)

    async def _boom(messages: list[dict], model: str | None = None) -> str:
        raise RuntimeError("connection failed to http://internal-gpu:8000/v1")

    monkeypatch.setattr(ai_client, "call_ai", _boom)

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "?"}
    )

    assert resp.status_code == 502
    assert "internal-gpu" not in resp.text  # 내부 주소 비노출


def test_ai_chat_uses_selected_model(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    captured: dict[str, str | None] = {}

    async def _capture(messages: list[dict], model: str | None = None) -> str:
        captured["model"] = model
        return json.dumps({"kind": "answer", "message": "ok"})

    monkeypatch.setattr(ai_client, "call_ai", _capture)

    client.post(
        f"/api/versions/{version_id}/ai/chat",
        json={"instruction": "?", "model": "/gpt-oss-120b"},
    )

    assert captured["model"] == "/gpt-oss-120b"


def test_ai_models_lists(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)

    async def _models() -> list[str]:
        return ["/gpt-oss-120b", "/other-model"]

    monkeypatch.setattr(ai_client, "list_models", _models)

    resp = client.get("/api/ai/models")

    assert resp.status_code == 200
    assert resp.json()["models"] == ["/gpt-oss-120b", "/other-model"]


def test_ai_models_disabled_returns_503(client: TestClient) -> None:
    resp = client.get("/api/ai/models")
    assert resp.status_code == 503


def test_ai_models_fallback_to_default_on_error(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(settings, "ai_model", "/default-model")

    async def _boom() -> list[str]:
        raise RuntimeError("models endpoint down")

    monkeypatch.setattr(ai_client, "list_models", _boom)

    resp = client.get("/api/ai/models")

    assert resp.status_code == 200
    assert resp.json()["models"] == ["/default-model"]
