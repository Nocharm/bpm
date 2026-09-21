"""러너 — 제출 카드 드로잉 우선, 설문 prefetch 2장, 일시정지, 재기동 복구 (spec §6)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app import ai_client
from app.db import SessionLocal
from app.framework_interview import runner
from app.models import FrameworkInterviewSession
from app.settings import settings

SYSADMIN = "fw.admin"
HEADERS = {"X-Dev-User": SYSADMIN}

Q_JSON = ('{"questions":['
          '{"id":"q1","kind":"ordered","maps_to":"activities","text":"활동","options":[{"id":"a1","label":"요청 확인"},'
          '{"id":"a2","label":"완결성 판정"},{"id":"a3","label":"접수 등록"}],"suggested":["a1","a2","a3"]},'
          '{"id":"q2","kind":"single","maps_to":"roles","text":"역할","options":[{"id":"r1","label":"담당자"},{"id":"r2","label":"관리자"}],"suggested":["r1"]},'
          '{"id":"q3","kind":"multi","maps_to":"systems","text":"시스템","options":[{"id":"s1","label":"ERP"},{"id":"s2","label":"메일"}],"suggested":["s1"]},'
          '{"id":"q4","kind":"text","maps_to":"conditions","text":"시작 조건","options":[],"suggested":"요청서 도착"},'
          '{"id":"q5","kind":"text","maps_to":"io","text":"입력물","options":[],"suggested":"요청서"},'
          '{"id":"q6","kind":"text","maps_to":"io","text":"산출물","options":[],"suggested":"접수증"}]}')

ROW_JSON = ('{"l6":"요청 접수","ownerRole":"담당자","department":"","fields":{"start_condition":"요청서 도착"},'
            '"actions":[{"seq":1,"label":"요청 확인","kind":"action"},{"seq":2,"label":"완결성 판정","kind":"decision"},'
            '{"seq":3,"label":"접수 등록","kind":"action"}],'
            '"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"},{"src":2,"dst":3,"kind":"branch","gateway":"exclusive","condition":"완결"}]}}')


def _enable(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)


def _fake_ai_queue(monkeypatch, contents: list[str]) -> list[str]:
    queue = list(contents)

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        return ai_client.AiReply(content=queue.pop(0), prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    return queue


def _make_locked_session(client: TestClient, names: list[str]) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"rn-{uuid4().hex[:4]}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    sid = client.post("/api/framework-interviews", json={"category_id": node["id"]}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in names]
    r = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    return sid


def _statuses(sid: int) -> list[str]:
    async def _load() -> list[str]:
        async with SessionLocal() as db:
            s = await db.get(FrameworkInterviewSession, sid)
            await db.refresh(s, ["tasks"])
            return [t.status for t in sorted(s.tasks, key=lambda t: t.seq)]

    return asyncio.run(_load())


def _step(sid: int) -> bool:
    async def _run() -> bool:
        async with SessionLocal() as db:
            return await runner.run_one_step(db, sid)

    return asyncio.run(_run())


def test_prefetch_two_questionnaires_then_idle(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B", "C"])
    queue = _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON])
    assert _step(sid) is True
    assert _statuses(sid) == ["ready", "pending", "pending"]
    assert _step(sid) is True
    assert _statuses(sid) == ["ready", "ready", "pending"]
    assert _step(sid) is False  # prefetch cap reached, nothing submitted
    assert queue == []


def test_submitted_task_is_drawn_before_prefetch(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B", "C"])
    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON])
    _step(sid)
    _step(sid)
    first = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    answers = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "", "q6": ""}
    r = client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/answers", json={"answers": answers}, headers=HEADERS)
    assert r.status_code == 200, r.text
    assert _statuses(sid)[0] == "submitted"
    assert _step(sid) is True
    assert _statuses(sid) == ["drawn", "ready", "pending"]
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{first['id']}", headers=HEADERS).json()
    assert detail["row"]["actions"][0]["label"] == "요청 확인"
    assert detail["answers"]["q4"] == {"value": "요청서 도착", "auto": True}
    assert all(i["severity"] != "error" for i in detail["issues"])


def test_invalid_row_marks_failed_and_retry_requeues(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A"])
    _fake_ai_queue(monkeypatch, [Q_JSON, "not json", "still not json"])
    _step(sid)
    first = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/answers",
                json={"answers": {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "", "q6": ""}},
                headers=HEADERS)
    assert _step(sid) is True
    assert _statuses(sid) == ["failed"]
    r = client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/retry", headers=HEADERS)
    assert r.status_code == 200
    assert _statuses(sid) == ["submitted"]


def test_pause_stops_steps_and_recovery_resets_stale(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B"])
    client.post(f"/api/framework-interviews/{sid}/pause", headers=HEADERS)
    assert _step(sid) is False

    async def _stale() -> None:
        async with SessionLocal() as db:
            s = await db.get(FrameworkInterviewSession, sid)
            await db.refresh(s, ["tasks"])
            s.tasks[0].status = "generating"
            s.tasks[1].status = "drawing"
            await db.commit()
            assert await runner.recover_stale_tasks(db, session_id=sid) == 2
            await db.commit()

    asyncio.run(_stale())
    assert _statuses(sid) == ["pending", "submitted"]


def test_kick_while_active_sets_wake_flag() -> None:
    """이미 활성인 세션에 kick이 도착하면 새 루프를 스폰하지 않고 wake만 세운다."""
    sid = 424242
    runner._active.add(sid)
    try:
        runner.kick(sid)
        assert sid in runner._wake
    finally:
        runner._active.discard(sid)
        runner._wake.discard(sid)


def test_kick_during_step_keeps_loop_running(monkeypatch) -> None:
    """스텝 실행 중 도착한 kick은 lost-kick 없이 루프를 한 바퀴 더 돌린다."""
    sid = 424243
    calls = 0

    async def _fake_step(db, session_id):
        nonlocal calls
        calls += 1
        if calls == 1:
            runner.kick(session_id)  # 스텝 진행 중 도착한 kick — _active라 wake만 세운다
        return False

    monkeypatch.setattr(runner, "run_one_step", _fake_step)
    runner._active.discard(sid)
    runner._wake.discard(sid)
    asyncio.run(runner.process_session(sid))
    assert calls == 2
    assert sid not in runner._active
    assert sid not in runner._wake


def test_process_session_recovers_wedged_task_on_unexpected_error(client: TestClient, monkeypatch) -> None:
    """드로잉 커밋 직후(비 TurnError) 예외가 새면 drawing이 아니라 submitted로 되돌아가야 한다."""
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A"])
    _fake_ai_queue(monkeypatch, [Q_JSON])
    _step(sid)
    first = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    answers = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "", "q6": ""}
    client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/answers", json={"answers": answers}, headers=HEADERS)
    assert _statuses(sid) == ["submitted"]

    async def _boom(db, session, task):
        task.status = "drawing"
        await db.commit()
        raise RuntimeError("boom")

    monkeypatch.setattr(runner, "_draw_row", _boom)
    runner._active.discard(sid)
    runner._wake.discard(sid)
    asyncio.run(runner.process_session(sid))
    assert _statuses(sid) == ["submitted"]
    assert sid not in runner._active


def test_questionnaire_turn_error_resets_to_pending(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A"])
    queue = _fake_ai_queue(monkeypatch, ["not json", "still not json"])
    assert _step(sid) is True
    assert _statuses(sid) == ["pending"]
    detail = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    assert detail["error"]
    assert queue == []
