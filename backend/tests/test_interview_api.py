"""인터뷰 API — 스키마·세션·턴·체크포인트·권한."""

import asyncio
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from app import ai_client
from app.db import SessionLocal
from app.models import AiUsageEvent
from app.schemas import InterviewCreateIn, InterviewStateOut, InterviewTurnIn
from app.settings import settings


def test_turn_in_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        InterviewTurnIn(type="banana")


def test_turn_in_defaults() -> None:
    turn = InterviewTurnIn(type="answer", content="구매 요청 프로세스입니다")
    assert turn.choice_id is None


def test_create_in_lang_default_ko() -> None:
    assert InterviewCreateIn(version_id=1).lang == "ko"


def test_state_out_smoke() -> None:
    state = InterviewStateOut(
        id=1, map_id=1, version_id=1, status="active", current_stage="scope",
        lang="ko", working_graph=None, messages=[], checkpoints=[], attachments=[],
        version_updated_at=None, base_graph_updated_at=None,
    )
    assert state.current_stage == "scope"


def test_create_on_word_map_sets_word_mode(client: TestClient, monkeypatch) -> None:
    """word 맵에서 세션 생성 시 mode='word' + word 인사말 (design 2026-07-26 §2)."""
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    version_id = m["versions"][0]["id"]
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": version_id}
    ).json()
    assert state["mode"] == "word"
    assert state["current_stage"] == "scope"
    assert "순서도" in state["messages"][0]["content"]


def test_create_on_normal_map_keeps_normal_mode(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={"name": f"iv-n-{uuid4().hex[:8]}", "owning_department": "Owning Anchor Division"},
    ).json()
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    assert state["mode"] == "normal"


# === API Tests ===

_iv_seq = 0


def _iv_map(client: TestClient) -> dict:
    global _iv_seq
    _iv_seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"interview map {_iv_seq}"},
    ).json()


def _enable_ai(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str):
    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=content, prompt_tokens=10, completion_tokens=5)

    return _call


_Q = json.dumps({"message": "프로세스 이름이 뭔가요?", "facts_patch": {}})


def test_interview_requires_ai_enabled(client: TestClient) -> None:
    created = _iv_map(client)
    resp = client.post(
        f"/api/maps/{created['id']}/interviews",
        json={"version_id": created["versions"][0]["id"]},
    )
    assert resp.status_code == 503


def test_interview_create_and_resume(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    first = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "active" and body["current_stage"] == "scope"
    assert body["messages"][0]["role"] == "consultant"  # 고정 인사
    # 같은 맵 재호출 → 동일 세션 재개
    second = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert second.json()["id"] == body["id"]


def test_interview_turn_flow(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_Q))
    resp = client.post(
        f"/api/interviews/{session_id}/turns",
        json={"type": "answer", "content": "구매 요청 프로세스입니다"},
    )
    assert resp.status_code == 200
    kinds = [m["kind"] for m in resp.json()["messages"]]
    assert kinds[-2:] == ["answer", "question"]


def test_interview_turn_ai_failure_is_atomic(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]

    async def _boom(messages, model=None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    before = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 502
    after = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    assert after == before  # 롤백 — 사용자 메시지도 남지 않음

    # 실패도 계량 — ok=False 이벤트가 남는다 (rollback 후 만료 접근 회귀 방지)
    async def _count_failed() -> int:
        async with SessionLocal() as s:
            rows = (await s.scalars(select(AiUsageEvent).where(AiUsageEvent.ok.is_(False)))).all()
            return len(rows)

    assert asyncio.run(_count_failed()) >= 1


def test_interview_idor_other_user_404(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    resp = client.get(f"/api/interviews/{session_id}", headers={"X-Dev-User": "someone.else"})
    assert resp.status_code == 404


def test_interview_attachment_upload_and_reject(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    ok = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("memo.txt", "구매 절차 메모".encode(), "text/plain")},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "parsed"
    # 읽음 확인 노티스가 대화에 남는다 (실사용 회귀 2026-07-23)
    state = client.get(f"/api/interviews/{session_id}").json()
    notices = [m for m in state["messages"] if m["kind"] == "notice"]
    assert notices and "memo.txt" in notices[-1]["content"]
    bad = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert bad.status_code == 422


def test_interview_attachment_delete(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    uploaded = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("temp.md", "# note".encode(), "text/markdown")},
    ).json()
    gone = client.delete(f"/api/interviews/{session_id}/attachments/{uploaded['id']}")
    assert gone.status_code == 204
    state = client.get(f"/api/interviews/{session_id}").json()
    assert all(a["id"] != uploaded["id"] for a in state["attachments"])
    missing = client.delete(f"/api/interviews/{session_id}/attachments/{uploaded['id']}")
    assert missing.status_code == 404


def test_interview_revert_restores_checkpoint(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = json.dumps({
        "message": "확정. 다음 주제로.", "facts_patch": {
            "process_name": "구매", "purpose": "표준화", "boundaries": "접수~발주"},
        "stage_complete": True,
    })
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(done))
    client.post(f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "…"})
    state = client.get(f"/api/interviews/{session_id}").json()
    assert state["current_stage"] == "io"
    assert [c["stage"] for c in state["checkpoints"]] == ["scope"]
    reverted = client.post(f"/api/interviews/{session_id}/revert", json={"stage": "scope"})
    assert reverted.status_code == 200
    assert reverted.json()["current_stage"] == "scope"


def test_interview_complete_and_delete(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = client.post(f"/api/interviews/{session_id}/complete")
    assert done.status_code == 200 and done.json()["status"] == "completed"
    # 완료 후 턴은 409
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 409
    gone = client.delete(f"/api/interviews/{session_id}")
    assert gone.status_code == 204


def test_graph_put_bumps_version_updated_at_for_conflict_signal(client: TestClient, monkeypatch) -> None:
    """graph PUT이 version.updated_at을 올려야 인터뷰 충돌 경고가 실편집을 감지한다 (final review C1)."""
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    # 체크아웃 자체도 version 행을 건드려 onupdate로 updated_at을 올린다 — 그 부수효과와
    # 섞이지 않도록 체크아웃 "이후"를 기준선으로 잡아 PUT 그래프만의 효과를 격리한다.
    client.post(f"/api/versions/{version_id}/checkout", json={})
    before = client.get(f"/api/interviews/{session_id}").json()["version_updated_at"]
    graph = {
        "nodes": [
            {"id": "n-start", "title": "Start", "node_type": "start"},
            {"id": "n-conflict-1", "title": "edited", "node_type": "process"},
        ],
        "edges": [],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    after = client.get(f"/api/interviews/{session_id}").json()["version_updated_at"]
    assert after != before


def test_interview_requires_live_editor_role(client: TestClient, monkeypatch) -> None:
    """세션 소유자라도 editor 권한이 회수되면 이후 접근이 차단된다 (final review I3)."""
    _enable_ai(monkeypatch)
    global _iv_seq
    _iv_seq += 1
    actor_a, actor_b = "iv-role-a", "iv-role-b"
    headers_a = {"X-Dev-User": actor_a}
    created = client.post(
        "/api/maps",
        json={
            "owning_department": "Owning Anchor Division",
            "name": f"interview role map {_iv_seq}",
        },
        headers=headers_a,
    ).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{map_id}/interviews", json={"version_id": version_id}, headers=headers_a
    ).json()["id"]

    # A의 owner 권한을 B로 이전하고 A를 viewer로 강등 — enforcement가 켜지면
    # 세션은 여전히 A 소유(IDOR 통과)이지만 맵에 대한 editor+ 권한은 더 이상 없다.
    perms = client.get(f"/api/maps/{map_id}/permissions", headers=headers_a).json()
    a_grant_id = next(
        p["id"] for p in perms if p["principal_id"] == actor_a and p["role"] == "owner"
    )
    assert client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": actor_b, "role": "editor"},
        headers=headers_a,
    ).status_code == 201
    assert client.post(
        f"/api/maps/{map_id}/transfer-owner", json={"new_owner": actor_b}, headers=headers_a
    ).status_code == 200
    downgrade = client.patch(
        f"/api/maps/{map_id}/permissions/{a_grant_id}",
        json={"role": "viewer"},
        headers=headers_a,
    )
    assert downgrade.status_code == 200 and downgrade.json()["pending"] is False

    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    resp = client.get(f"/api/interviews/{session_id}", headers=headers_a)
    assert resp.status_code == 403


def test_create_seeds_working_graph_and_data_aware_greeting(client: TestClient, monkeypatch) -> None:
    """기존 데이터가 있는 맵은 작업본을 시드하고 파악한 내용 기반 오프닝을 낸다 (실사용 피드백 2026-07-27)."""
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    graph = {
        "nodes": [
            {"id": "n-s", "title": "Start", "node_type": "start"},
            {"id": "n-1", "title": "요청서 작성", "node_type": "process", "assignee": "김담당"},
            {"id": "n-2", "title": "승인 여부", "node_type": "decision"},
            {"id": "n-e", "title": "End", "node_type": "end"},
        ],
        "edges": [
            {"id": "e-1", "source_node_id": "n-s", "target_node_id": "n-1"},
            {"id": "e-2", "source_node_id": "n-1", "target_node_id": "n-2"},
            {"id": "e-3", "source_node_id": "n-2", "target_node_id": "n-e", "label": "승인"},
        ],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200

    state = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()
    seeded = state["working_graph"]
    assert seeded is not None
    assert {n["key"] for n in seeded["nodes"]} == {"n-s", "n-1", "n-2", "n-e"}
    by_key = {n["key"]: n for n in seeded["nodes"]}
    assert by_key["n-1"]["attributes"]["assignee"] == "김담당"
    assert {(e["source"], e["target"]) for e in seeded["edges"]} == {
        ("n-s", "n-1"), ("n-1", "n-2"), ("n-2", "n-e")
    }
    greeting = state["messages"][0]
    assert "요청서 작성" in greeting["content"]  # 파악한 활동을 오프닝에 제시
    assert "이미 작성된 내용" in greeting["content"]
    assert len(greeting["payload"]["options"]) == 3  # 보완/재정리 + 패스트트랙 quick reply
    client.delete(f"/api/interviews/{state['id']}")


def test_create_on_start_end_only_map_keeps_generic_greeting(client: TestClient, monkeypatch) -> None:
    """새 맵의 자동 Start/End만 있으면 기존 데이터로 치지 않는다 — 오프닝은 기본 인사."""
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    state = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()
    greeting = state["messages"][0]
    assert greeting["content"].startswith("안녕하세요, 프로세스 컨설턴트입니다. 지금부터")
    assert greeting["payload"] == {"options": ["문서로 바로 그리기"]}  # 패스트트랙 보기
    client.delete(f"/api/interviews/{state['id']}")


# ---------- draw 이벤트 (speed redesign §4) ----------

_DRAW_A = json.dumps({
    "kind": "graph", "message": "표준안",
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start"},
        {"key": "a", "title": "요청서 작성", "node_type": "process"},
        {"key": "e", "title": "끝", "node_type": "end"},
    ],
    "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "e"}],
    "groups": [],
})
_DRAW_B = json.dumps({
    "kind": "graph", "message": "세밀안",
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start"},
        {"key": "a", "title": "요청서 작성", "node_type": "process"},
        {"key": "b", "title": "견적 비교", "node_type": "process"},
        {"key": "e", "title": "끝", "node_type": "end"},
    ],
    "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "b"},
              {"source": "b", "target": "e"}],
    "groups": [],
})


def _iv_session(client: TestClient) -> dict:
    created = _iv_map(client)
    return client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": created["versions"][0]["id"]}
    ).json()


def _scripted(monkeypatch, replies: list[str]) -> dict:
    queue = list(replies)
    state = {"calls": 0}

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        state["calls"] += 1
        return ai_client.AiReply(content=queue.pop(0))

    monkeypatch.setattr(ai_client, "call_ai", _call)
    return state


def test_draw_multi_generates_proposals(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(settings, "interview_choice_count", 2)
    state = _iv_session(client)
    _scripted(monkeypatch, [_DRAW_A, _DRAW_B])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "multi"}).json()
    last = body["messages"][-1]
    assert last["kind"] == "choices"
    assert len(last["payload"]["options"]) == 2
    assert body["working_graph"] == state["working_graph"]  # 작업본은 수락 전까지 불변
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_single_uses_one_draft(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    calls = _scripted(monkeypatch, [_DRAW_A])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    assert calls["calls"] == 1
    options = body["messages"][-1]["payload"]["options"]
    assert len(options) == 1
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_all_filtered_appends_notice(client: TestClient, monkeypatch) -> None:
    """전 안이 현재 작업본과 동일하면 choices 대신 notice — 작업본·pending 불변."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    # 현재 작업본을 _DRAW_A 구조로 세팅
    graph = json.loads(_DRAW_A)
    graph.pop("kind", None)
    graph.pop("message", None)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = graph
            await session.commit()

    asyncio.run(_seed())
    _scripted(monkeypatch, [_DRAW_A])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    last = body["messages"][-1]
    assert last["kind"] == "notice"
    assert "같은 안" in last["content"]
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_failure_rolls_back(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    _scripted(monkeypatch, ["깨진 응답", "여전히 깨짐"])
    resp = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"})
    assert resp.status_code == 502
    after = client.get(f"/api/interviews/{state['id']}").json()
    assert after["working_graph"] == state["working_graph"]  # 실패 시 작업본 불변
    assert all(m["kind"] != "choices" for m in after["messages"])
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_signals_draw_due_on_structure_completion(client: TestClient, monkeypatch) -> None:
    """구조 스테이지 완료 턴 응답에 draw_due='multi' — 프론트 자동 draw 신호."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _to_activities() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.current_stage = "activities"
            await session.commit()

    asyncio.run(_to_activities())
    _scripted(monkeypatch, [json.dumps({
        "message": "활동 확정", "facts_patch": {"activities": "요청·비교"}, "stage_complete": True,
    })])
    body = client.post(f"/api/interviews/{state['id']}/turns",
                       json={"type": "answer", "content": "이대로"}).json()
    assert body["draw_due"] == "multi"
    assert body["current_stage"] == "branches"
    client.delete(f"/api/interviews/{state['id']}")


# ---------- params 표 반영 (speed redesign 후속) ----------


def _seed_interview_params(interview_id: int, table: dict, graph: dict | None) -> None:
    async def _run() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, interview_id)
            row.facts = {"params": {"params_table": table}}
            if graph is not None:
                row.working_graph = graph
            await session.commit()

    asyncio.run(_run())


def test_apply_params_merges_into_working_graph(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = {
        "nodes": [
            {"key": "s", "title": "시작", "node_type": "start", "attributes": None},
            {"key": "a", "title": "요청서 작성", "node_type": "process",
             "attributes": {"assignee": "김담당"}},
        ],
        "edges": [], "groups": [],
    }
    _seed_interview_params(state["id"], {
        "요청서 작성": {"duration": "0.30", "headcount": 2, "cost_krw": "미정"},
        "없는 활동": {"duration": "1.00"},
    }, graph)
    body = client.post(f"/api/interviews/{state['id']}/apply-params")
    assert body.status_code == 200
    data = body.json()
    node = next(n for n in data["working_graph"]["nodes"] if n["title"] == "요청서 작성")
    assert node["attributes"]["duration"] == "0.30"
    assert node["attributes"]["headcount"] == "2"  # 숫자 입력도 문자열로 정규화
    assert node["attributes"]["assignee"] == "김담당"  # 기존 attributes 보존
    assert "cost_krw" not in node["attributes"]  # '미정'은 스킵
    notice = [m for m in data["messages"] if m["kind"] == "notice"]
    assert any("1" in m["content"] for m in notice)  # 활동 1개 반영
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_without_table_400(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    resp = client.post(f"/api/interviews/{state['id']}/apply-params")
    assert resp.status_code == 400
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_no_match_409(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    _seed_interview_params(state["id"], {"유령 활동": {"duration": "1.00"}}, None)
    resp = client.post(f"/api/interviews/{state['id']}/apply-params")
    assert resp.status_code == 409
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_currency_exclusive(client: TestClient, monkeypatch) -> None:
    """행에 두 통화가 다 있으면 krw만 반영 — 기존 반대 통화도 제거(공존이면 이후 draw·저장이 깨진다)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = {
        "nodes": [{"key": "a", "title": "요청서 작성", "node_type": "process",
                   "attributes": {"cost_usd": "9"}}],
        "edges": [], "groups": [],
    }
    _seed_interview_params(state["id"], {
        "요청서 작성": {"cost_krw": "50000", "cost_usd": "5"},
    }, graph)
    data = client.post(f"/api/interviews/{state['id']}/apply-params").json()
    node = next(n for n in data["working_graph"]["nodes"] if n["title"] == "요청서 작성")
    assert node["attributes"]["cost_krw"] == "50000"
    assert "cost_usd" not in node["attributes"]  # 기존 usd도 제거 — 배타 유지
    client.delete(f"/api/interviews/{state['id']}")


# ---------- 첨부 시점 정보 추출 (2026-07-28) ----------


def test_attachment_upload_spawns_extraction(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    from app.kb import indexing

    spawned: list[str] = []

    def fake_spawn(coro) -> None:
        spawned.append(coro.__name__)
        coro.close()

    monkeypatch.setattr(indexing, "spawn", fake_spawn)
    state = _iv_session(client)
    ok = client.post(
        f"/api/interviews/{state['id']}/attachments",
        files={"file": ("sop.txt", "구매 절차 문서".encode(), "text/plain")},
    )
    assert ok.status_code == 200
    assert "extract_attachment_facts" in spawned  # 임베딩 OFF라 인덱싱은 없고 추출만
    client.delete(f"/api/interviews/{state['id']}")


def test_extract_attachment_facts_merges_and_notices(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    from app.interview import orchestrator
    from app.kb import indexing

    monkeypatch.setattr(indexing, "spawn", lambda coro: coro.close())  # 업로드 훅은 봉인
    state = _iv_session(client)
    uploaded = client.post(
        f"/api/interviews/{state['id']}/attachments",
        files={"file": ("sop.txt", "구매 절차: 요청서 작성 30분".encode(), "text/plain")},
    ).json()

    extract = json.dumps({
        "message": "요약",
        "facts": {
            "scope": {"process_name": "구매"},
            "activities": {"activities": ["요청서 작성"]},
            "params": {"params_table": {"요청서 작성": {"duration": "0.30"}}},
            "banana": {"ignored": "yes"},
        },
    })
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(extract))
    asyncio.run(orchestrator.extract_attachment_facts(state["id"], uploaded["id"]))

    after = client.get(f"/api/interviews/{state['id']}").json()
    assert after["facts"]["scope"]["process_name"] == "구매"
    assert after["facts"]["params"]["params_table"]["요청서 작성"]["duration"] == "0.30"
    assert "banana" not in after["facts"]  # 허용 밖 네임스페이스는 무시
    notices = [m for m in after["messages"] if m["kind"] == "notice"]
    assert any("sop.txt" in m["content"] and "추출" in m["content"] for m in notices)
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_appends_keep_current_option(client: TestClient, monkeypatch) -> None:
    """작업본에 사용자 콘텐츠가 있으면 '현재 맵 유지' 안이 항상 마지막에 추가된다 (2026-07-28)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = json.loads(_DRAW_A)
    graph.pop("kind", None)
    graph.pop("message", None)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = graph
            await session.commit()

    asyncio.run(_seed())
    _scripted(monkeypatch, [_DRAW_B])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    options = body["messages"][-1]["payload"]["options"]
    assert len(options) == 2
    assert options[0].get("same_as_current") is None  # AI 신규 안이 먼저
    current = options[-1]
    assert current["id"].endswith("-current")
    assert current["same_as_current"] is True
    assert current["graph"] == graph
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_seed_only_graph_skips_keep_current(client: TestClient, monkeypatch) -> None:
    """start/end 시드뿐인 백지 작업본엔 '현재 맵 유지' 안을 만들지 않는다."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    _scripted(monkeypatch, [_DRAW_A])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    options = body["messages"][-1]["payload"]["options"]
    assert all(not o.get("same_as_current") for o in options)
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_prompt_includes_dept_catalog(client: TestClient, monkeypatch) -> None:
    """턴의 인터뷰어 프롬프트에 eligible 부서 후보 목록이 주입된다 (실사용 피드백 2026-07-28)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    captured: dict = {}

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured["system"] = messages[0]["content"]
        return ai_client.AiReply(content=json.dumps({"message": "ok", "facts_patch": {}}))

    monkeypatch.setattr(ai_client, "call_ai", _call)
    client.post(f"/api/interviews/{state['id']}/turns",
                json={"type": "answer", "content": "담당 부서는요?"})
    assert "[부서 후보 목록" in captured["system"]
    assert "Owning Anchor Division" in captured["system"]
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_prompt_reflects_working_graph(client: TestClient, monkeypatch) -> None:
    """인터뷰어의 [현재 작업본 요약]은 수락으로 진화한 working_graph — 저장본(draft)이 아니다
    (hardening T4). 작업본이 없으면 기존처럼 저장본 요약 폴백."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = json.loads(_DRAW_B)
    graph.pop("kind", None)
    graph.pop("message", None)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = graph
            await session.commit()

    asyncio.run(_seed())
    captured: dict = {}

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured["system"] = messages[0]["content"]
        return ai_client.AiReply(content=json.dumps({"message": "ok", "facts_patch": {}}))

    monkeypatch.setattr(ai_client, "call_ai", _call)
    client.post(f"/api/interviews/{state['id']}/turns",
                json={"type": "answer", "content": "다음은?"})
    # 계약 룰 12 본문도 같은 라벨을 언급하므로 마지막(실제 블록) 세그먼트로 판정
    summary = captured["system"].split("[현재 작업본 요약]")[-1]
    assert "견적 비교" in summary  # 작업본에만 있는 노드가 보인다
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_survives_sp_suggestion_failure(client: TestClient, monkeypatch) -> None:
    """성공한 턴은 사후 부가 로직(SP 제안) 예외로 롤백되지 않는다 (hardening T8)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = json.loads(_DRAW_A)
    graph.pop("kind", None)
    graph.pop("message", None)
    option = {"id": "opt-x-1", "title": "표준안", "summary": "", "graph": graph}

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.pending_choices = {"options": [option]}
            await session.commit()

    asyncio.run(_seed())
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_Q))

    async def boom(session, interview, user):
        raise RuntimeError("kb exploded")

    monkeypatch.setattr("app.routers.interviews._maybe_sp_suggestion", boom)
    resp = client.post(f"/api/interviews/{state['id']}/turns",
                       json={"type": "choice", "choice_id": "opt-x-1"})
    assert resp.status_code == 200
    latest = client.get(f"/api/interviews/{state['id']}").json()
    assert any(m["kind"] == "choice" for m in latest["messages"])  # 턴 커밋 보존
    assert latest["working_graph"] is not None
    client.delete(f"/api/interviews/{state['id']}")


def test_attachment_long_filename_truncated(client: TestClient, monkeypatch) -> None:
    """300자 초과 파일명은 확장자 보존 절단 — Postgres VARCHAR(300) 500 방지 (hardening T9)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    long_name = "가" * 320 + ".txt"
    ok = client.post(
        f"/api/interviews/{state['id']}/attachments",
        files={"file": (long_name, b"hello", "text/plain")},
    )
    assert ok.status_code == 200
    body = ok.json()
    assert len(body["filename"]) <= 300
    assert body["filename"].endswith(".txt")
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_skips_uneditable_subprocess_fields(client: TestClient, monkeypatch) -> None:
    """subprocess 노드엔 annual_count·fte만 반영 — 비편집 4필드 기록 차단(3표면 불변식의
    4번째 표면, hardening T9)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = {
                "nodes": [{"key": "sp", "title": "정산", "node_type": "subprocess",
                           "linked_map_id": 1, "attributes": None, "description": "",
                           "group_key": None}],
                "edges": [], "groups": [],
            }
            row.facts = {"params": {"params_table": {
                "정산": {"duration": "1.00", "annual_count": "12", "fte": "0.5"},
            }}}
            await session.commit()

    asyncio.run(_seed())
    body = client.post(f"/api/interviews/{state['id']}/apply-params").json()
    node = body["working_graph"]["nodes"][0]
    assert node["attributes"] == {"annual_count": "12", "fte": "0.5"}  # duration 스킵
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_records_token_usage(client: TestClient, monkeypatch) -> None:
    """턴 usage 이벤트에 콜별 토큰 합산 기록 (hardening T10)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_Q))  # 콜당 10/5
    client.post(f"/api/interviews/{state['id']}/turns",
                json={"type": "answer", "content": "x"})

    async def _latest_ok() -> AiUsageEvent:
        async with SessionLocal() as s:
            rows = (await s.scalars(
                select(AiUsageEvent).where(AiUsageEvent.ok.is_(True))
                .order_by(AiUsageEvent.id.desc())
            )).all()
            return rows[0]

    event = asyncio.run(_latest_ok())
    assert event.prompt_tokens == 10 and event.completion_tokens == 5
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_sums_usage_across_parallel_calls(client: TestClient, monkeypatch) -> None:
    """draw(multi)는 병렬 드래프터 콜의 토큰을 합산 기록한다 (hardening T10)."""
    _enable_ai(monkeypatch)
    monkeypatch.setattr(settings, "interview_choice_count", 2)
    state = _iv_session(client)
    queue = [_DRAW_A, _DRAW_B]

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=queue.pop(0), prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "multi"})

    async def _latest_ok() -> AiUsageEvent:
        async with SessionLocal() as s:
            rows = (await s.scalars(
                select(AiUsageEvent).where(AiUsageEvent.ok.is_(True))
                .order_by(AiUsageEvent.id.desc())
            )).all()
            return rows[0]

    event = asyncio.run(_latest_ok())
    assert event.prompt_tokens == 20 and event.completion_tokens == 10
    client.delete(f"/api/interviews/{state['id']}")


def test_draw_options_include_tone_lint(client: TestClient, monkeypatch) -> None:
    """draw 안에 결정적 톤 린트 경고 동봉 — 프롬프트 룰만으론 못 막는 톤 이탈 표시 (hardening T19)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    bad = json.dumps({
        "kind": "graph", "message": "톤 이탈안",
        "nodes": [
            {"key": "s", "title": "시작", "node_type": "start"},
            {"key": "a", "title": "요청서 작성하기", "node_type": "process"},
            {"key": "e", "title": "끝", "node_type": "end"},
        ],
        "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "e"}],
        "groups": [],
    })
    _scripted(monkeypatch, [bad])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    options = body["messages"][-1]["payload"]["options"]
    assert any("작성하기" in warning for warning in options[0]["lint"])
    client.delete(f"/api/interviews/{state['id']}")


def test_greeting_offers_fast_track_option(client: TestClient, monkeypatch) -> None:
    """normal 모드 인사말에 패스트트랙 보기 — word는 제외 (design 2026-07-29 §2)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    greeting = state["messages"][0]
    assert "문서로 바로 그리기" in (greeting["payload"] or {}).get("options", [])
    client.delete(f"/api/interviews/{state['id']}")


def test_word_greeting_has_no_fast_track_option(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-ft-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    options = (state["messages"][0]["payload"] or {}).get("options", [])
    assert "문서로 바로 그리기" not in options


def test_fast_forward_jumps_to_review_and_signals_draw(client: TestClient, monkeypatch) -> None:
    """fast-forward — 남은 스테이지 '미정' 채움+체크포인트 후 review 점프, draw_due='multi' (AI 0콜)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    calls = _scripted(monkeypatch, [])  # AI 호출이 있으면 IndexError로 실패
    body = client.post(f"/api/interviews/{state['id']}/fast-forward").json()
    assert calls["calls"] == 0
    assert body["current_stage"] == "review"
    assert body["draw_due"] == "multi"
    for stage_key, names in [
        ("scope", ["process_name", "purpose", "boundaries"]),
        ("io", ["trigger", "inputs", "outputs"]),
        ("activities", ["activities"]),
        ("branches", ["branches"]),
        ("roles", ["roles"]),
    ]:
        for name in names:
            assert body["facts"][stage_key][name] == "미정"
    assert [c["stage"] for c in body["checkpoints"]] == [
        "scope", "io", "activities", "branches", "roles",
    ]
    kinds = [m["kind"] for m in body["messages"]]
    assert "fast_forward" in kinds and kinds[-1] == "notice"
    client.delete(f"/api/interviews/{state['id']}")


def test_fast_forward_preserves_collected_facts(client: TestClient, monkeypatch) -> None:
    """이미 수집된 facts(문서 추출분)는 '미정'으로 덮지 않는다."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.facts = {"scope": {"process_name": "구매 프로세스"}}
            await session.commit()

    asyncio.run(_seed())
    body = client.post(f"/api/interviews/{state['id']}/fast-forward").json()
    assert body["facts"]["scope"]["process_name"] == "구매 프로세스"
    assert body["facts"]["scope"]["purpose"] == "미정"
    client.delete(f"/api/interviews/{state['id']}")


def test_fast_forward_guards(client: TestClient, monkeypatch) -> None:
    """word 모드 400 · review에서 400."""
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-ff-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word", "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    word_state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    assert client.post(f"/api/interviews/{word_state['id']}/fast-forward").status_code == 400

    state = _iv_session(client)
    client.post(f"/api/interviews/{state['id']}/fast-forward")
    assert client.post(f"/api/interviews/{state['id']}/fast-forward").status_code == 400  # 이미 review
    client.delete(f"/api/interviews/{state['id']}")
    client.delete(f"/api/interviews/{word_state['id']}")


def test_draw_passes_description_only_changes(client: TestClient, monkeypatch) -> None:
    """구조가 같아도 설명이 바뀐 안은 전멸 필터를 통과한다 — "설명 한/영 병기" 요청이
    '같은 맵' 노티스로 거부되던 문제 (실사용 피드백 2026-07-30)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    graph = json.loads(_DRAW_A)
    graph.pop("kind", None)
    graph.pop("message", None)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = graph
            await session.commit()

    asyncio.run(_seed())
    # 동일 구조·동일 제목이지만 설명만 병기된 안
    bilingual = json.dumps({
        "kind": "graph", "message": "설명 병기안",
        "nodes": [
            {"key": "s", "title": "시작", "node_type": "start"},
            {"key": "a", "title": "요청서 작성", "node_type": "process",
             "description": "구매 요청서 작성 / Draft the purchase request"},
            {"key": "e", "title": "끝", "node_type": "end"},
        ],
        "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "e"}],
        "groups": [],
    })
    _scripted(monkeypatch, [bilingual])
    body = client.post(f"/api/interviews/{state['id']}/draw", json={"variants": "single"}).json()
    last = body["messages"][-1]
    assert last["kind"] == "choices"  # 노티스가 아니라 선택지
    options = last["payload"]["options"]
    assert any("Draft the purchase request" in str(o["graph"]) for o in options)
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_accepts_manual_edits(client: TestClient, monkeypatch) -> None:
    """Params 모달 직접 편집 — body 표를 facts에 딥머지 후 맵 반영, 무효 필드는 소거.
    수동 변경도 AI 컨텍스트(facts)와 아웃라인에 남는다 (실사용 피드백 2026-07-30)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = {
                "nodes": [{"key": "a", "title": "정산", "node_type": "process",
                           "attributes": None, "description": "", "group_key": None}],
                "edges": [], "groups": [],
            }
            row.facts = {"params": {"params_table": {"정산": {"duration": "1.00"}}}}
            await session.commit()

    asyncio.run(_seed())
    body = client.post(
        f"/api/interviews/{state['id']}/apply-params",
        json={"params_table": {"정산": {"duration": "2.30", "headcount": "3", "bogus": "x"}}},
    ).json()
    table = body["facts"]["params"]["params_table"]["정산"]
    assert table["duration"] == "2.30" and table["headcount"] == "3"
    assert "bogus" not in table
    node = body["working_graph"]["nodes"][0]
    assert node["attributes"]["duration"] == "2.30"
    assert node["attributes"]["headcount"] == "3"
    client.delete(f"/api/interviews/{state['id']}")


def test_apply_params_manual_clear_removes_map_attributes(client: TestClient, monkeypatch) -> None:
    """수동 표에서 비운 필드는 맵 속성도 제거 — 행 일괄 삭제 지원 (2026-07-30).
    AI 수집 경로(body 없음)의 빈 값은 종전대로 무시된다."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.working_graph = {
                "nodes": [{"key": "a", "title": "정산", "node_type": "process",
                           "attributes": {"duration": "1.00", "headcount": "2"},
                           "description": "", "group_key": None}],
                "edges": [], "groups": [],
            }
            row.facts = {"params": {"params_table": {"정산": {"duration": "1.00", "headcount": "2"}}}}
            await session.commit()

    asyncio.run(_seed())
    body = client.post(
        f"/api/interviews/{state['id']}/apply-params",
        json={"params_table": {"정산": {"duration": "", "headcount": "3"}}},
    ).json()
    node = body["working_graph"]["nodes"][0]
    assert "duration" not in node["attributes"]  # 명시적 클리어 → 맵에서도 제거
    assert node["attributes"]["headcount"] == "3"
    assert body["facts"]["params"]["params_table"]["정산"]["duration"] == ""
    client.delete(f"/api/interviews/{state['id']}")
