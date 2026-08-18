"""인터뷰 직렬화(hardening T3) — 인터뷰 락·첨부 추출 lost-update·seq 유니크 보강."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db import SessionLocal, engine, init_models
from app.interview import orchestrator
from app.interview.locks import interview_lock
from app.models import InterviewAttachment, InterviewMessage, InterviewSession
from app.settings import settings


def _make_interview(client: TestClient) -> dict:
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"conc map {id(client)}-{_seq()}"},
    ).json()
    return client.post(
        f"/api/maps/{created['id']}/interviews",
        json={"version_id": created["versions"][0]["id"]},
    ).json()


_counter = {"n": 0}


def _seq() -> int:
    _counter["n"] += 1
    return _counter["n"]


def test_interview_lock_identity() -> None:
    """같은 루프·같은 id는 동일 락, 다른 id는 별개 — 레지스트리 계약."""

    async def _run() -> None:
        a1 = interview_lock(1)
        a2 = interview_lock(1)
        b = interview_lock(2)
        assert a1 is a2
        assert a1 is not b

    asyncio.run(_run())


def test_turn_handler_holds_interview_lock(client: TestClient, monkeypatch) -> None:
    """post_turn이 인터뷰 락을 쥔 채 실행된다 — 데코레이터·FastAPI DI 결합 검증."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    state = _make_interview(client)
    seen: dict = {}

    async def fake_run_turn(db, interview, turn, graph_summary, context_text,
                            model=None, doc_sections=None, dept_catalog="", overrides=None):
        seen["locked"] = interview_lock(interview.id).locked()
        return orchestrator.TurnResult()

    monkeypatch.setattr("app.routers.interviews.run_turn", fake_run_turn)
    resp = client.post(f"/api/interviews/{state['id']}/turns",
                       json={"type": "answer", "content": "x"})
    assert resp.status_code == 200
    assert seen["locked"] is True
    client.delete(f"/api/interviews/{state['id']}")


def test_extraction_merges_into_fresh_state(client: TestClient, monkeypatch) -> None:
    """첨부 추출은 AI 콜 후 신선 상태를 재조회해 병합 — 추출 중 커밋된 턴 facts를
    stale 스냅샷이 덮어쓰지 않는다 (lost-update 회귀 잠금)."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    state = _make_interview(client)
    interview_id = state["id"]

    async def _add_attachment() -> int:
        async with SessionLocal() as session:
            row = InterviewAttachment(
                session_id=interview_id, filename="spec.txt", mime="text/plain",
                size=10, status="parsed", parsed_text="문서 본문",
            )
            session.add(row)
            await session.commit()
            return row.id

    attachment_id = asyncio.run(_add_attachment())

    async def fake_ask(messages, model, schema_cls, reasoning=None):
        # AI 응답 대기 중 다른 턴이 facts를 커밋하는 상황 재현
        async with SessionLocal() as session:
            interview = await session.get(InterviewSession, interview_id)
            interview.facts = {**interview.facts, "scope": {"process_name": "동시 턴 확정값"}}
            await session.commit()
        return orchestrator.AttachmentFactsOut(
            message="추출", facts={"io": {"trigger": "문서 트리거"}},
        )

    monkeypatch.setattr(orchestrator, "_ask_json", fake_ask)
    asyncio.run(orchestrator.extract_attachment_facts(interview_id, attachment_id))

    latest = client.get(f"/api/interviews/{interview_id}").json()
    assert latest["facts"]["scope"]["process_name"] == "동시 턴 확정값"  # 보존
    assert latest["facts"]["io"]["trigger"] == "문서 트리거"  # 추출분 병합
    notices = [m for m in latest["messages"] if m["kind"] == "notice"]
    assert any("spec.txt" in m["content"] for m in notices)
    seqs = [m["seq"] for m in latest["messages"]]
    assert len(seqs) == len(set(seqs))  # seq 중복 없음
    client.delete(f"/api/interviews/{interview_id}")


def test_seq_unique_bootstrap_renumbers_and_enforces(client: TestClient, monkeypatch) -> None:
    """부트스트랩 스윕 — 레거시 중복 seq는 세션 max 뒤로 리넘버(비중복 행 불변),
    이후 유니크 인덱스가 중복 삽입을 거부한다."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    state = _make_interview(client)
    interview_id = state["id"]

    async def _corrupt() -> None:
        # 레거시 DB 재현: 인덱스 없애고 중복 seq 2건 주입
        async with engine.begin() as conn:
            await conn.execute(text("DROP INDEX IF EXISTS uq_interview_messages_session_seq"))
        async with SessionLocal() as session:
            for content in ("dup-a", "dup-b"):
                session.add(InterviewMessage(
                    session_id=interview_id, seq=7, role="consultant", kind="notice",
                    content=content, stage="scope",
                ))
            await session.commit()

    asyncio.run(_corrupt())
    asyncio.run(init_models())  # 스윕 + 인덱스 재생성

    latest = client.get(f"/api/interviews/{interview_id}").json()
    by_content = {m["content"]: m["seq"] for m in latest["messages"]}
    assert by_content["dup-a"] == 7  # 최저 id는 제자리
    assert by_content["dup-b"] > 7  # 중복분만 max 뒤로 이동
    seqs = [m["seq"] for m in latest["messages"]]
    assert len(seqs) == len(set(seqs))

    async def _insert_dup() -> None:
        async with SessionLocal() as session:
            session.add(InterviewMessage(
                session_id=interview_id, seq=7, role="consultant", kind="notice",
                content="dup-c", stage="scope",
            ))
            await session.commit()

    with pytest.raises(IntegrityError):
        asyncio.run(_insert_dup())
    client.delete(f"/api/interviews/{interview_id}")
