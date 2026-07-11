"""On-prem AI chat tests — AI server mocked via monkeypatch (design 2026-06-15)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from app.settings import settings

_ai_seq = 0


def _ai_map(client: TestClient) -> dict:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _ai_seq
    _ai_seq += 1
    return client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"ai map {_ai_seq}"}).json()


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


def _fake_ai(content: str, prompt_tokens: int | None = 100, completion_tokens: int | None = 50):
    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(
            content=content, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

    return _call


def _draft_version_checked_out(client: TestClient) -> int:
    created = _ai_map(client)
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
    created = _ai_map(client)
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

    async def _flaky(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        calls["n"] += 1
        return ai_client.AiReply(content="not json" if calls["n"] == 1 else valid)

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

    async def _capture(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured["model"] = model
        return ai_client.AiReply(content=json.dumps({"kind": "answer", "message": "ok"}))

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
    created = _ai_map(client)
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


def test_build_system_prompt_has_no_directory_and_explicit_only_rule() -> None:
    # 디렉터리 주입 폐기 — 담당자/부서는 사용자 지시가 명시적으로 요구할 때만 (design 2026-07-11)
    from app.ai_prompt import build_system_prompt
    from app.schemas import GraphOut

    system = build_system_prompt("M", GraphOut(nodes=[], edges=[], groups=[]), True)
    assert "조직 디렉터리" not in system
    assert "명시적으로 요구" in system  # 규칙 ② 교체 확인


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
    created = _ai_map(client)
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
    created = _ai_map(client)
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


def test_ai_grounds_on_registered_manual_docs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """매뉴얼 동기화 — 등록 문서(manual_docs)가 번들 manual.md 대신 AI 근거로 실린다."""
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    resp = client.post(
        "/api/manual/docs",
        json={
            "format": "markdown",
            "language": "ko",
            "content": "# 그라운딩 검증 문서\n등록 매뉴얼 본문 GROUNDCHECK-TOKEN",
        },
    )
    assert resp.status_code == 200
    doc_id = resp.json()["id"]

    captured: dict = {}

    async def fake_call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured["messages"] = messages
        return ai_client.AiReply(content=json.dumps({"kind": "answer", "message": "ok"}))

    monkeypatch.setattr(ai_client, "call_ai", fake_call)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "사용법?"})
    assert resp.status_code == 200
    system = captured["messages"][0]["content"]
    assert "GROUNDCHECK-TOKEN" in system  # 등록 문서 본문이 근거로 포함
    assert "그라운딩 검증 문서" in system  # 제목 헤더 포함
    # 공유 DB 정리 — 다른 매뉴얼 테스트의 목록 가정을 깨지 않게 생성 문서 삭제
    assert client.delete(f"/api/manual/docs/{doc_id}").status_code in (200, 204)


def test_structure_hints_detect_data_feedback_targets() -> None:
    """분석 고도화 — 도달성·분기·속성 누락·막다른 노드·중복 제목을 사전탐지."""
    from app.ai_prompt import _structure_hints
    from app.schemas import EdgeIn, GraphOut, NodeOut

    graph = GraphOut(
        groups=[],
        nodes=[
            NodeOut(id="s", title="시작", node_type="start"),
            NodeOut(id="d", title="판단", node_type="decision"),  # 출력 1개 + 라벨 없음 + 속성 비움
            NodeOut(id="p1", title="검토", node_type="process", assignee="김담당", department="팀", duration="1일"),
            NodeOut(id="p2", title="검토", node_type="process"),  # 중복 제목 + 막다른(끝 못 감) + 속성 비움
            NodeOut(id="x", title="외딴 처리", node_type="process"),  # 시작에서 도달 불가(끝으로는 감)
            NodeOut(id="e", title="끝", node_type="end"),
        ],
        edges=[
            EdgeIn(id="e1", source_node_id="s", target_node_id="d"),
            EdgeIn(id="e2", source_node_id="d", target_node_id="p1"),
            EdgeIn(id="e3", source_node_id="p1", target_node_id="e"),
            EdgeIn(id="e4", source_node_id="p1", target_node_id="p2"),
            EdgeIn(id="e5", source_node_id="x", target_node_id="e"),
        ],
    )
    hints = "\n".join(_structure_hints(graph))
    assert "분기 없는 판단 노드" in hints and "d" in hints
    assert "분기 라벨 없는 판단 노드" in hints
    assert "시작에서 도달 불가" in hints and "x" in hints
    assert "끝으로 도달 불가" in hints and "p2" in hints
    assert "막다른 노드" in hints
    assert "담당자 미입력" not in hints
    assert "부서 미입력" not in hints
    assert "소요시간 미입력" in hints
    assert '중복 제목 "검토"' in hints


# ── 증분 편집 확장 + URL 계약 (feat/ai-incremental-edit) ──────────────────────


def test_ops_new_actions_parse() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "ops",
            "message": "사이에 삽입",
            "ops": [
                {"action": "disconnect", "source": "a", "target": "b"},
                {"action": "set_edge_label", "source": "a", "target": "c", "label": "승인"},
                {"action": "set_desc", "node_id": "a", "description": "검수 후 승인"},
            ],
        }
    )
    assert [op.action for op in proposal.ops] == ["disconnect", "set_edge_label", "set_desc"]


def test_ops_set_attr_partial_and_url() -> None:
    # 부분 갱신 시맨틱 — 생략 필드는 None(유지), url/url_label 지원
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "ops",
            "message": "링크 설정",
            "ops": [
                {
                    "action": "set_attr",
                    "node_id": "n1",
                    "attributes": {"url": "https://example.com/spec", "url_label": "규정"},
                }
            ],
        }
    )
    attr = proposal.ops[0].attributes
    assert attr is not None
    assert attr.url == "https://example.com/spec"
    assert attr.url_label == "규정"
    assert attr.assignee is None  # 생략 = 유지
    assert attr.department is None


def test_ai_node_attributes_url_length_capped() -> None:
    from pydantic import ValidationError

    from app.schemas import AiNodeAttributes

    with pytest.raises(ValidationError):
        AiNodeAttributes.model_validate({"url": "https://" + "x" * 500})


def test_graph_node_url_roundtrip_in_proposal() -> None:
    # graph 생성 노드의 attributes.url 에코 — 프론트 aiNodeToGraphNode가 그대로 반영
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate(
        {
            "kind": "graph",
            "message": "재생성",
            "nodes": [
                {
                    "key": "a",
                    "title": "계약 체결",
                    "node_type": "process",
                    "attributes": {"url": "https://example.com/contract", "url_label": "계약서"},
                }
            ],
            "edges": [],
        }
    )
    assert proposal.nodes[0].attributes is not None
    assert proposal.nodes[0].attributes.url == "https://example.com/contract"


def test_prompt_serializes_node_url_and_documents_new_ops() -> None:
    from app.ai_prompt import build_messages
    from app.schemas import GraphOut, NodeOut

    graph = GraphOut(
        nodes=[
            NodeOut(
                id="n1",
                title="계약 체결",
                node_type="process",
                url="https://example.com/contract",
                url_label="계약서",
            )
        ],
        edges=[],
        groups=[],
    )
    system = build_messages("MANUAL", graph, True, "링크 유지하며 다시 그려줘", [])[0]["content"]
    assert '링크=https://example.com/contract "계약서"' in system  # 현재 그래프 노출
    assert "disconnect" in system and "set_edge_label" in system and "set_desc" in system
    assert "에코해 보존" in system  # 재생성 시 url 보존 규칙


def test_ai_ops_new_actions_passthrough_and_unknown_surfaced(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 새 액션이 엔드포인트를 통과하고, 미지 참조(disconnect의 유령 id)는 message로 표면화
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)  # 빈 그래프 → 모든 기존 id 참조는 미지
    content = json.dumps(
        {
            "kind": "ops",
            "message": "정리",
            "ops": [
                {"action": "disconnect", "source": "ghost-a", "target": "ghost-b"},
                {"action": "set_desc", "node_id": "ghost-c", "description": "설명"},
            ],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "정리해줘"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "ops"
    assert [op["action"] for op in body["ops"]] == ["disconnect", "set_desc"]
    for ghost in ("ghost-a", "ghost-b", "ghost-c"):
        assert ghost in body["message"]  # 계약 규칙 ④ 표면화


# ── usage 계측 — AiReply·누적 (design 2026-07-11 B1) ─────────────


def asyncio_run_reply():
    import asyncio

    from app.ai_client import call_ai

    return asyncio.run(call_ai([{"role": "user", "content": "x"}]))


def test_call_ai_returns_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenAI 호환 usage를 AiReply로 반환 — usage 없는 비표준 응답은 None 방어."""
    import httpx2

    class _Resp:
        def raise_for_status(self) -> None: ...
        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": "{}"}}],
                "usage": {"prompt_tokens": 321, "completion_tokens": 45},
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None: ...
        async def __aenter__(self) -> "_Client":
            return self
        async def __aexit__(self, *exc) -> None: ...
        async def post(self, *args, **kwargs) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx2, "AsyncClient", _Client)
    reply = asyncio_run_reply()
    assert reply.content == "{}"
    assert reply.prompt_tokens == 321
    assert reply.completion_tokens == 45


def test_call_ai_usage_absent_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx2

    class _Resp:
        def raise_for_status(self) -> None: ...
        def json(self) -> dict:
            return {"choices": [{"message": {"content": "ok"}}]}

    class _Client:
        def __init__(self, *args, **kwargs) -> None: ...
        async def __aenter__(self) -> "_Client":
            return self
        async def __aexit__(self, *exc) -> None: ...
        async def post(self, *args, **kwargs) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx2, "AsyncClient", _Client)
    reply = asyncio_run_reply()
    assert reply.content == "ok"
    assert reply.prompt_tokens is None
    assert reply.completion_tokens is None
