"""KB 파이프라인 — 소스별 인덱싱·라이브러리 API(sysadmin)·publish 훅·인터뷰 검색 주입 (design 2026-07-23 §7 P2)."""

import asyncio
import json
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from app.db import SessionLocal
from app.kb import embed_client, indexing, retrieval
from app.main import app
from app.models import (
    InterviewAttachment,
    InterviewSession,
    KbChunk,
    KbDocument,
    MapVersion,
)
from app.settings import settings

DIM = 1024


def _enable_kb(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")

    async def fake_embed(texts: list[str], timeout: float | None = None) -> list[list[float]]:
        return [[1.0] + [0.0] * (DIM - 1) for _ in texts]

    monkeypatch.setattr(embed_client, "embed_texts", fake_embed)


def _chunks(source_type: str, source_id: int) -> list[KbChunk]:
    from sqlalchemy import select

    async def _run() -> list[KbChunk]:
        async with SessionLocal() as session:
            rows = await session.scalars(
                select(KbChunk).where(
                    KbChunk.source_type == source_type, KbChunk.source_id == source_id
                ).order_by(KbChunk.chunk_index)
            )
            return list(rows)

    return asyncio.run(_run())


_seq = 0


def _make_map(client: TestClient) -> dict:
    global _seq
    _seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"kb map {_seq}"},
    ).json()


# ---------- 인덱싱 ----------


def test_index_library_doc_creates_and_replaces_chunks(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)

    async def _insert() -> int:
        async with SessionLocal() as session:
            doc = KbDocument(title="구매 SOP", filename="sop.txt", uploaded_by="admin",
                             parsed_text="구매 절차 문단.\n\n두 번째 문단.", status="parsed")
            session.add(doc)
            await session.commit()
            return doc.id

    doc_id = asyncio.run(_insert())
    asyncio.run(indexing.index_library_doc(doc_id))
    chunks = _chunks("library", doc_id)
    assert len(chunks) == 1  # 두 문단이 500자 안이라 1청크
    assert chunks[0].meta == {"title": "구매 SOP"}
    assert "구매 절차" in chunks[0].chunk_text
    # 재인덱싱은 교체 — 중복 누적 금지
    asyncio.run(indexing.index_library_doc(doc_id))
    assert len(_chunks("library", doc_id)) == 1


def test_index_map_version_serializes_published_content(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    created = _make_map(client)
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    # 노드/엣지 id는 전역 PK — 다른 테스트와 충돌하지 않게 kb 접두
    graph = {
        "nodes": [
            {"id": "kbm-s", "title": "Start", "node_type": "start"},
            {"id": "kbm-1", "title": "입고 검수", "node_type": "process", "description": "물품 확인"},
            {"id": "kbm-e", "title": "End", "node_type": "end"},
        ],
        "edges": [
            {"id": "kbm-e1", "source_node_id": "kbm-s", "target_node_id": "kbm-1"},
            {"id": "kbm-e2", "source_node_id": "kbm-1", "target_node_id": "kbm-e"},
        ],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    asyncio.run(indexing.index_map_version(version_id))
    chunks = _chunks("map", created["id"])
    assert chunks and chunks[0].meta["map_name"] == created["name"]
    joined = "\n".join(c.chunk_text for c in chunks)
    assert "입고 검수" in joined and "물품 확인" in joined
    assert "Start → 입고 검수" in joined  # 흐름 요약


def test_index_attachment_scopes_to_session(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    created = _make_map(client)

    async def _insert() -> int:
        async with SessionLocal() as session:
            iv = InterviewSession(map_id=created["id"], version_id=created["versions"][0]["id"],
                                  login_id="local-dev", facts={})
            session.add(iv)
            await session.flush()
            att = InterviewAttachment(session_id=iv.id, filename="ref.txt",
                                      parsed_text="세션 참고 자료", status="parsed")
            session.add(att)
            await session.commit()
            return att.id

    att_id = asyncio.run(_insert())
    asyncio.run(indexing.index_attachment(att_id))
    chunks = _chunks("attachment", att_id)
    assert chunks and chunks[0].meta["filename"] == "ref.txt"
    assert isinstance(chunks[0].meta["session_id"], int)


def test_indexing_disabled_is_noop(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", False)

    async def _insert() -> int:
        async with SessionLocal() as session:
            doc = KbDocument(title="off", filename="off.txt", uploaded_by="admin",
                             parsed_text="내용", status="parsed")
            session.add(doc)
            await session.commit()
            return doc.id

    doc_id = asyncio.run(_insert())
    # 다른 테스트가 같은 source_id로 심었을 수 있는 잔여 청크와 무관하게 '변화 없음'을 단언
    before = len(_chunks("library", doc_id))
    asyncio.run(indexing.index_library_doc(doc_id))
    assert len(_chunks("library", doc_id)) == before


# ---------- 라이브러리 API ----------

SYSADMIN = "admin.kim"


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.clear()


def test_kb_documents_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    resp = client.get("/api/kb/documents", headers={"X-Dev-User": "user.lee"})
    assert resp.status_code == 403


def test_kb_document_upload_list_delete(client: TestClient, sysadmin_enforced: None, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    spawned: list[str] = []

    def fake_spawn(coro) -> None:
        spawned.append(coro.__name__)
        coro.close()

    monkeypatch.setattr(indexing, "spawn", fake_spawn)
    headers = {"X-Dev-User": SYSADMIN}
    resp = client.post(
        "/api/kb/documents",
        files={"file": ("guide.txt", b"process guide body", "text/plain")},
        headers=headers,
    )
    assert resp.status_code == 201
    doc = resp.json()
    assert doc["status"] == "parsed" and doc["title"] == "guide"
    assert spawned == ["index_library_doc"]

    listed = client.get("/api/kb/documents", headers=headers).json()
    assert any(d["id"] == doc["id"] for d in listed)

    assert client.post(
        "/api/kb/documents",
        files={"file": ("bad.zip", b"zip", "application/zip")},
        headers=headers,
    ).status_code == 422

    assert client.delete(f"/api/kb/documents/{doc['id']}", headers=headers).status_code == 204
    assert _chunks("library", doc["id"]) == []
    assert all(d["id"] != doc["id"] for d in client.get("/api/kb/documents", headers=headers).json())


# ---------- publish 훅 ----------


def test_publish_spawns_map_indexing(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    created = _make_map(client)
    version_id = created["versions"][0]["id"]

    async def _approve() -> None:
        async with SessionLocal() as session:
            version = await session.get(MapVersion, version_id)
            version.status = "approved"
            version.submitted_by = "local-dev"
            await session.commit()

    asyncio.run(_approve())
    spawned: list[str] = []

    def fake_spawn(coro) -> None:
        spawned.append(coro.__name__)
        coro.close()

    monkeypatch.setattr(indexing, "spawn", fake_spawn)
    resp = client.post(f"/api/versions/{version_id}/publish")
    assert resp.status_code == 200
    assert spawned == ["index_map_version"]


# ---------- 인터뷰 검색 주입 ----------

_Q = json.dumps({"message": "다음 질문입니다.", "facts_patch": {}})


def _start_interview(client: TestClient, monkeypatch) -> dict:
    monkeypatch.setattr(settings, "ai_enabled", True)
    created = _make_map(client)
    return client.post(
        f"/api/maps/{created['id']}/interviews",
        json={"version_id": created["versions"][0]["id"]},
    ).json()


def test_turn_injects_kb_references_into_prompt(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    state = _start_interview(client, monkeypatch)
    captured: list[list[dict]] = []

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured.append(messages)
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def fake_search(session, query, top_k=5, session_id=None):
        return [retrieval.KbHit(source_type="library", source_id=1,
                                chunk_text="표준 구매 절차는 3단계다", score=0.9,
                                meta={"title": "구매 SOP"})]

    monkeypatch.setattr(retrieval, "search", fake_search)
    resp = client.post(f"/api/interviews/{state['id']}/turns",
                       json={"type": "answer", "content": "구매 프로세스야"})
    assert resp.status_code == 200
    system = captured[0][0]["content"]
    assert "[지식기반 참조" in system
    assert "(구매 SOP) 표준 구매 절차는 3단계다" in system
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_kb_failure_appends_degrade_notice_once(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    state = _start_interview(client, monkeypatch)

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def broken_search(session, query, top_k=5, session_id=None):
        raise embed_client.EmbedError("down")

    monkeypatch.setattr(retrieval, "search", broken_search)
    first = client.post(f"/api/interviews/{state['id']}/turns",
                        json={"type": "answer", "content": "안녕"}).json()
    notices = [m for m in first["messages"] if m["kind"] == "notice"]
    assert len(notices) == 1 and "지식기반" in notices[0]["content"]
    second = client.post(f"/api/interviews/{state['id']}/turns",
                         json={"type": "answer", "content": "계속"}).json()
    notices = [m for m in second["messages"] if m["kind"] == "notice"]
    assert len(notices) == 1  # 세션당 1회만
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_skips_search_when_disabled(client: TestClient, monkeypatch) -> None:
    state = _start_interview(client, monkeypatch)  # ai_enabled=True, embed_url은 기본 ""

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def must_not_call(session, query, top_k=5, session_id=None):
        raise AssertionError("search must not be called when embedding is disabled")

    monkeypatch.setattr(retrieval, "search", must_not_call)
    resp = client.post(f"/api/interviews/{state['id']}/turns",
                       json={"type": "answer", "content": "안녕"})
    assert resp.status_code == 200
    client.delete(f"/api/interviews/{state['id']}")


# ---------- 유사 SP 제안 (Task 7) ----------


def _chain_graph() -> dict:
    keys = ["c-s", "c-1", "c-2", "c-3", "c-e"]
    types = {"c-s": "start", "c-e": "end"}
    return {
        "nodes": [
            {"key": k, "title": f"활동 {k}", "node_type": types.get(k, "process"),
             "description": "", "attributes": None, "group_key": None}
            for k in keys
        ],
        "edges": [{"source": keys[i], "target": keys[i + 1], "label": ""} for i in range(len(keys) - 1)],
        "groups": [],
    }


def test_find_process_chains_linear_and_branch() -> None:
    from app.kb import sp_suggest

    chains = sp_suggest.find_process_chains(_chain_graph())
    assert [[n["key"] for n in c] for c in chains] == [["c-1", "c-2", "c-3"]]
    # 분기(디시전) 개입 시 체인이 끊긴다
    branched = _chain_graph()
    branched["nodes"][2]["node_type"] = "decision"  # c-2
    assert sp_suggest.find_process_chains(branched) == []


def test_sanitize_subprocess_keeps_real_link_and_demotes_hallucination() -> None:
    from app.interview import orchestrator

    prev = {"nodes": [{"key": "sp-9", "title": "발주 처리", "node_type": "subprocess",
                       "linked_map_id": 9}], "edges": [], "groups": []}
    echoed = {
        "nodes": [
            {"key": "x1", "title": "발주 처리", "node_type": "subprocess", "linked_map_id": None},
            {"key": "x2", "title": "없는 링크", "node_type": "subprocess"},
        ],
        "edges": [], "groups": [],
    }
    cleaned = orchestrator._sanitize_subprocess(echoed, prev)
    by_key = {n["key"]: n for n in cleaned["nodes"]}
    assert by_key["x1"]["node_type"] == "subprocess" and by_key["x1"]["linked_map_id"] == 9
    assert by_key["x2"]["node_type"] == "process" and "linked_map_id" not in by_key["x2"]


def _set_interview_state(
    interview_id: int, stage: str, graph: dict | None, pending: dict | None = None
) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            row = await session.get(InterviewSession, interview_id)
            row.current_stage = stage
            row.working_graph = graph
            row.pending_choices = pending
            await session.commit()

    asyncio.run(_run())


def _chain_option() -> dict:
    return {"id": "opt-1", "title": "표준안", "summary": "", "graph": _chain_graph()}


def test_choice_turn_appends_sp_suggestion_once(client: TestClient, monkeypatch) -> None:
    """SP 제안은 작업본이 갱신되는 수락(choice) 턴에서만 — 일반 턴은 무제안 (speed redesign)."""
    _enable_kb(monkeypatch)
    target = _make_map(client)  # 제안 대상 맵(실존 — 권한 가드 통과)
    state = _start_interview(client, monkeypatch)
    _set_interview_state(state["id"], "activities", None,
                         pending={"options": [_chain_option()]})

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def fake_search(session, query, top_k=5, session_id=None):
        return [retrieval.KbHit(source_type="map", source_id=target["id"],
                                chunk_text="유사 맵", score=0.8,
                                meta={"map_id": target["id"], "map_name": target["name"]})]

    monkeypatch.setattr(retrieval, "search", fake_search)
    first = client.post(f"/api/interviews/{state['id']}/turns",
                        json={"type": "choice", "choice_id": "opt-1"}).json()
    suggestions = [m for m in first["messages"] if m["kind"] == "sp_suggestion"]
    assert len(suggestions) == 1
    assert suggestions[0]["payload"]["map_id"] == target["id"]
    assert suggestions[0]["payload"]["node_keys"] == ["c-1", "c-2", "c-3"]
    # 일반(answer) 턴은 제안하지 않고, 같은 맵 재제안도 없다
    second = client.post(f"/api/interviews/{state['id']}/turns",
                         json={"type": "answer", "content": "응"}).json()
    assert len([m for m in second["messages"] if m["kind"] == "sp_suggestion"]) == 1
    client.delete(f"/api/interviews/{state['id']}")


def test_sp_accept_replaces_segment_with_link_node(client: TestClient, monkeypatch) -> None:
    _enable_kb(monkeypatch)
    target = _make_map(client)
    state = _start_interview(client, monkeypatch)
    _set_interview_state(state["id"], "activities", None,
                         pending={"options": [_chain_option()]})

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def fake_search(session, query, top_k=5, session_id=None):
        return [retrieval.KbHit(source_type="map", source_id=target["id"],
                                chunk_text="유사 맵", score=0.8,
                                meta={"map_id": target["id"], "map_name": target["name"]})]

    monkeypatch.setattr(retrieval, "search", fake_search)
    turned = client.post(f"/api/interviews/{state['id']}/turns",
                         json={"type": "choice", "choice_id": "opt-1"}).json()
    suggestion = next(m for m in turned["messages"] if m["kind"] == "sp_suggestion")

    accepted = client.post(f"/api/interviews/{state['id']}/sp-accept",
                           json={"message_id": suggestion["id"]})
    assert accepted.status_code == 200
    body = accepted.json()
    nodes = {n["key"]: n for n in body["working_graph"]["nodes"]}
    assert f"sp-{target['id']}" in nodes
    sp = nodes[f"sp-{target['id']}"]
    assert sp["node_type"] == "subprocess" and sp["linked_map_id"] == target["id"]
    assert not {"c-1", "c-2", "c-3"} & set(nodes)  # 구간 제거
    edge_pairs = {(e["source"], e["target"]) for e in body["working_graph"]["edges"]}
    assert ("c-s", f"sp-{target['id']}") in edge_pairs
    assert (f"sp-{target['id']}", "c-e") in edge_pairs
    # 제안 메시지는 superseded, 수락 노티스 추가
    live = [m for m in body["messages"] if not m["superseded"]]
    assert all(m["kind"] != "sp_suggestion" for m in live)
    assert any(m["kind"] == "notice" and "대체" in m["content"] for m in live)
    # 재수락은 404 (superseded)
    assert client.post(f"/api/interviews/{state['id']}/sp-accept",
                       json={"message_id": suggestion["id"]}).status_code == 404
    client.delete(f"/api/interviews/{state['id']}")


def test_turn_kb_filters_invisible_map_hits(
    client: TestClient, sysadmin_enforced: None, monkeypatch
) -> None:
    """map 출처 히트는 viewer 가시성 재검증 — 비공개 맵 내용이 타 사용자 프롬프트로
    유출되지 않는다 (hardening T1). 본인 맵·library 출처는 통과."""
    _enable_kb(monkeypatch)
    monkeypatch.setattr(settings, "ai_enabled", True)
    secret = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": "kb secret map"},
        headers={"X-Dev-User": "a"},
    ).json()  # 기본 visibility=private — b는 무권한
    mine = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": "kb my map"},
        headers={"X-Dev-User": "b"},
    ).json()
    state = client.post(
        f"/api/maps/{mine['id']}/interviews",
        json={"version_id": mine["versions"][0]["id"]},
        headers={"X-Dev-User": "b"},
    ).json()
    captured: list[list[dict]] = []

    async def fake_ai(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        captured.append(messages)
        return ai_client.AiReply(content=_Q)

    monkeypatch.setattr(ai_client, "call_ai", fake_ai)

    async def fake_search(session, query, top_k=5, session_id=None):
        return [
            retrieval.KbHit(source_type="map", source_id=secret["id"],
                            chunk_text="비공개 맵의 활동 흐름", score=0.95,
                            meta={"map_id": secret["id"], "map_name": "kb secret map"}),
            retrieval.KbHit(source_type="map", source_id=mine["id"],
                            chunk_text="내 맵의 활동 흐름", score=0.9,
                            meta={"map_id": mine["id"], "map_name": "kb my map"}),
            retrieval.KbHit(source_type="library", source_id=1,
                            chunk_text="전사 표준 절차", score=0.8, meta={"title": "SOP"}),
        ]

    monkeypatch.setattr(retrieval, "search", fake_search)
    resp = client.post(
        f"/api/interviews/{state['id']}/turns",
        json={"type": "answer", "content": "비슷한 프로세스 있어?"},
        headers={"X-Dev-User": "b"},
    )
    assert resp.status_code == 200
    system = captured[0][0]["content"]
    assert "비공개 맵의 활동 흐름" not in system
    assert "kb secret map" not in system
    assert "내 맵의 활동 흐름" in system
    assert "전사 표준 절차" in system
    client.delete(f"/api/interviews/{state['id']}", headers={"X-Dev-User": "b"})


def test_map_soft_delete_removes_kb_chunks(client: TestClient, monkeypatch) -> None:
    """맵 소프트삭제 시 KB 청크 즉시 제거 — 삭제 맵이 무기한 검색·주입되지 않는다 (hardening T16)."""
    _enable_kb(monkeypatch)
    created = _make_map(client)

    async def _seed_chunk() -> None:
        async with SessionLocal() as session:
            session.add(KbChunk(
                source_type="map", source_id=created["id"], chunk_index=0,
                chunk_text="삭제될 맵", embedding=b"\x00\x00\x80\x3f",
                meta={"map_id": created["id"], "map_name": created["name"]},
            ))
            await session.commit()

    asyncio.run(_seed_chunk())
    assert client.delete(f"/api/maps/{created['id']}").status_code == 204
    assert _chunks("map", created["id"]) == []


def test_bootstrap_sweeps_orphan_map_chunks(client: TestClient) -> None:
    """부트스트랩 스윕 — 존재하지 않는(또는 삭제된) 맵의 청크 잔재를 소급 정리 (hardening T16)."""
    from app.db import init_models

    ghost_map_id = 987654

    async def _seed_orphan() -> None:
        async with SessionLocal() as session:
            session.add(KbChunk(
                source_type="map", source_id=ghost_map_id, chunk_index=0,
                chunk_text="고아 청크", embedding=b"\x00\x00\x80\x3f", meta={},
            ))
            await session.commit()

    asyncio.run(_seed_orphan())
    asyncio.run(init_models())
    assert _chunks("map", ghost_map_id) == []
