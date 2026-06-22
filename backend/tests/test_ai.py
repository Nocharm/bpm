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


# === Phase 2: 계약 5종 확장 ===


def test_proposal_graph_carries_attributes_and_group() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "graph",
            "message": "ok",
            "groups": [{"key": "g1", "label": "구매팀"}],
            "nodes": [
                {
                    "key": "a",
                    "title": "발주",
                    "node_type": "process",
                    "attributes": {"assignee": "김철수", "department": "구매팀"},
                    "group_key": "g1",
                }
            ],
            "edges": [],
        }
    )
    assert proposal.nodes[0].attributes is not None
    assert proposal.nodes[0].attributes.assignee == "김철수"
    assert proposal.nodes[0].group_key == "g1"
    assert proposal.groups[0].label == "구매팀"


def test_proposal_rejects_unknown_group_key() -> None:
    from pydantic import ValidationError

    from app.schemas import AiProposal

    with pytest.raises(ValidationError):
        AiProposal.model_validate(
            {
                "kind": "graph",
                "message": "x",
                "nodes": [
                    {"key": "a", "title": "A", "node_type": "process", "group_key": "ghost"}
                ],
                "edges": [],
            }
        )


def test_proposal_walkthrough_parses() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "walkthrough",
            "message": "투어",
            "steps": [{"order": 1, "node_id": "n1", "narration": "여기서 시작"}],
        }
    )
    assert proposal.kind == "walkthrough"
    assert proposal.steps[0].node_id == "n1"


def test_proposal_analysis_parses() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "analysis",
            "message": "분석",
            "findings": [
                {
                    "severity": "high",
                    "category": "cycle",
                    "node_ids": ["n1", "n2"],
                    "message": "순환",
                    "suggestion": "끊으세요",
                }
            ],
        }
    )
    assert proposal.findings[0].severity == "high"
    assert proposal.findings[0].node_ids == ["n1", "n2"]


def test_proposal_ops_parses() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "ops",
            "message": "수정",
            "ops": [
                {"action": "relabel", "node_id": "n1", "title": "새 제목"},
                {"action": "connect", "source": "n1", "target": "n2", "label": "예"},
            ],
        }
    )
    assert proposal.kind == "ops"
    assert proposal.ops[0].action == "relabel"


def test_serialize_graph_exposes_node_id_attributes_and_groups() -> None:
    # 계약 규칙 ②: 직렬화가 캐노니컬 node_id를 노출(ops/편집 생명선) + 어트리뷰트·그룹 포함
    from app.ai_prompt import build_messages
    from app.schemas import GraphOut, GroupIn, NodeOut

    graph = GraphOut(
        nodes=[
            NodeOut(
                id="N_real_1",
                title="발주 승인",
                node_type="process",
                assignee="김철수",
                department="구매팀",
                group_ids=["G1"],
            )
        ],
        edges=[],
        groups=[GroupIn(id="G1", label="구매")],
    )
    system = build_messages("M", graph, True, "?", [])[0]["content"]
    assert "N_real_1" in system  # 캐노니컬 id 노출 (규칙 ②)
    assert "담당=김철수" in system
    assert "그룹=G1" in system
    assert "구매" in system  # groups 섹션 라벨


def test_ai_graph_proposal_preserves_attributes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    content = json.dumps(
        {
            "kind": "graph",
            "message": "ok",
            "groups": [{"key": "g1", "label": "구매팀"}],
            "nodes": [
                {
                    "key": "a",
                    "title": "발주",
                    "node_type": "process",
                    "attributes": {"assignee": "김철수"},
                    "group_key": "g1",
                }
            ],
            "edges": [],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"}
    )

    body = resp.json()
    assert resp.status_code == 200
    assert body["nodes"][0]["attributes"]["assignee"] == "김철수"
    assert body["nodes"][0]["group_key"] == "g1"
    assert body["groups"][0]["label"] == "구매팀"


def test_ai_ops_downgraded_when_not_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]  # 체크아웃 안 함 → can_edit False
    content = json.dumps(
        {"kind": "ops", "message": "x", "ops": [{"action": "remove", "node_id": "n1"}]}
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "지워"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "answer"  # 편집계열(ops) 다운그레이드


def test_ai_analysis_surfaces_unknown_node(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)  # 빈 그래프
    content = json.dumps(
        {
            "kind": "analysis",
            "message": "분석 결과",
            "findings": [
                {
                    "severity": "low",
                    "category": "orphan",
                    "node_ids": ["ghost"],
                    "message": "고아",
                }
            ],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "분석해"}
    )

    body = resp.json()
    assert resp.status_code == 200
    assert body["kind"] == "analysis"  # read-only — 다운그레이드 안 됨
    assert "ghost" in body["message"]  # 누락 참조 표면화 (규칙 ④)


# === Phase 3: 생성(그룹/어트리뷰트) + 편집 ops ===


def test_build_system_prompt_includes_directory() -> None:
    # D2: 담당자/부서 매칭용 조직 디렉터리가 시스템 프롬프트에 주입
    from app.ai_prompt import build_messages
    from app.schemas import GraphOut

    graph = GraphOut(nodes=[], edges=[], groups=[])
    system = build_messages(
        "M", graph, True, "?", [], ["김철수 | 구매팀", "이영희 | 영업팀"]
    )[0]["content"]
    assert "조직 디렉터리" in system
    assert "김철수 | 구매팀" in system


def test_ai_ops_passes_through_when_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)  # can_edit True
    content = json.dumps(
        {
            "kind": "ops",
            "message": "추가했어요",
            "ops": [
                {
                    "action": "add",
                    "node": {
                        "key": "n1",
                        "title": "승인",
                        "node_type": "process",
                        "attributes": None,
                        "group_key": None,
                    },
                }
            ],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "승인 추가해"}
    )

    body = resp.json()
    assert resp.status_code == 200
    assert body["kind"] == "ops"  # 편집 가능 → ops 통과(다운그레이드 안 됨)
    assert body["ops"][0]["action"] == "add"


# === Phase 4: 분석(analysis, read-only) ===


def test_structure_hints_detects_orphan_and_cycle() -> None:
    from app.ai_prompt import _structure_hints
    from app.schemas import EdgeIn, GraphOut, NodeOut

    graph = GraphOut(
        nodes=[
            NodeOut(id="a", title="A"),
            NodeOut(id="b", title="B"),
            NodeOut(id="c", title="C"),  # 고아(연결 없음)
        ],
        edges=[
            EdgeIn(id="e1", source_node_id="a", target_node_id="b"),
            EdgeIn(id="e2", source_node_id="b", target_node_id="a"),  # a↔b 순환
        ],
        groups=[],
    )
    hints = _structure_hints(graph)
    assert any("고아" in hint and "c" in hint for hint in hints)
    assert any("순환" in hint for hint in hints)


def test_ai_analysis_allowed_when_not_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]  # 체크아웃 안 함 → 비편집
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(json.dumps({"kind": "analysis", "message": "분석", "findings": []})),
    )

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "분석해"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "analysis"  # read-only — 비편집에도 통과


# === Phase 5: 워크스루(walkthrough, read-only) ===


def test_ai_walkthrough_allowed_when_not_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]  # 체크아웃 안 함 → 비편집
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(
            json.dumps(
                {
                    "kind": "walkthrough",
                    "message": "투어",
                    "steps": [{"order": 1, "node_id": "n1", "narration": "시작"}],
                }
            )
        ),
    )

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "설명해줘"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "walkthrough"  # read-only — 비편집에도 통과


# === Phase 6: 매뉴얼 안내 ===


def test_manual_covers_ai_features() -> None:
    from app.manual import get_manual

    manual = get_manual()
    for topic in ["분석", "워크스루", "하위 프로세스 참조", "승인"]:
        assert topic in manual


def test_answer_grounding_instruction_in_prompt() -> None:
    from app.ai_prompt import build_messages
    from app.schemas import GraphOut

    system = build_messages(
        "MANUAL_BODY", GraphOut(nodes=[], edges=[], groups=[]), True, "?", []
    )[0]["content"]
    assert "MANUAL_BODY" in system  # 매뉴얼 주입
    assert "모른다" in system  # answer 근거/범위 밖 규칙
