"""Framework interview session API — sysadmin AI campaign over one L5 (spec 2026-09-21)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai_client
from app import auth as auth_mod
from app.db import SessionLocal
from app.framework_interview import runner
from app.main import app
from app.models import AiUsageEvent, FrameworkInterviewSession
from app.settings import settings

SYSADMIN = "fw.admin"
HEADERS = {"X-Dev-User": SYSADMIN}


def _enable(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)


def test_tables_exist(client: TestClient) -> None:
    async def _count() -> int:
        async with SessionLocal() as db:
            rows = (await db.scalars(select(FrameworkInterviewSession))).all()
            return len(rows)

    assert asyncio.run(_count()) == 0


def _make_l5(client: TestClient, tag: str) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    return node["id"]


def _fake_ai_queue(monkeypatch, contents: list[str]) -> None:
    queue = list(contents)

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        return ai_client.AiReply(content=queue.pop(0), prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(ai_client, "call_ai", _call)


PLAN_JSON = '{"cards":[{"name":"요청 접수","summary":"요청을 받는다","owner_role":"담당자","department":"","depends_on":[]},' \
            '{"name":"검토 승인","summary":"검토한다","owner_role":"관리자","department":"","depends_on":["요청 접수"]}]}'


def test_create_requires_sysadmin_and_ai(client: TestClient, monkeypatch) -> None:
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)
    r = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS)
    assert r.status_code == 503  # AI disabled
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "auth_enabled", True)
    # auth_enabled=True flips resolved_auth_mode() away from dev's "everyone is sysadmin"
    # bypass, so get_current_user now demands a bearer token — override it like
    # test_interview_import_api.py's `enforce` fixture does, to reach is_sysadmin's 403.
    monkeypatch.setitem(app.dependency_overrides, auth_mod.get_current_user, lambda: "someone")
    r = client.post("/api/framework-interviews", json={"category_id": l5}, headers={"X-Dev-User": "someone"})
    assert r.status_code == 403


def test_create_plan_lock_flow(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    created = client.post("/api/framework-interviews", json={"category_id": l5, "brief": "매일 라운드"},
                          headers=HEADERS)
    assert created.status_code == 200, created.text
    body = created.json()
    sid = body["id"]
    assert body["status"] == "planning" and body["tasks"] == []
    assert body["category_code"] and body["progress"]["total"] == 0

    dup = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS)
    assert dup.status_code == 409

    listed = client.get("/api/framework-interviews?active=1", headers=HEADERS).json()
    assert any(s["id"] == sid for s in listed)

    _fake_ai_queue(monkeypatch, [PLAN_JSON])
    planned = client.post(f"/api/framework-interviews/{sid}/plan", headers=HEADERS).json()
    assert [c["name"] for c in planned["plan"]] == ["요청 접수", "검토 승인"]

    edited = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS, json={
        "cards": [{"name": "요청 접수", "summary": "", "owner_role": "담당자", "department": "", "depends_on": []},
                  {"name": "검토 승인", "summary": "", "owner_role": "관리자", "department": "", "depends_on": ["요청 접수"]},
                  {"name": "통보", "summary": "", "owner_role": "", "department": "", "depends_on": ["검토 승인"]}],
        "lock": True,
    })
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["status"] == "plan_locked"
    assert [t["seq"] for t in body["tasks"]] == [1, 2, 3]
    assert body["tasks"][0]["task_id"].endswith("-01") and body["tasks"][0]["status"] == "pending"
    assert body["plan"][0]["task_id"] == body["tasks"][0]["task_id"]

    locked_again = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
                              json={"cards": [], "lock": True})
    assert locked_again.status_code == 409

    gone = client.delete(f"/api/framework-interviews/{sid}", headers=HEADERS)
    assert gone.status_code == 204
    assert client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["status"] == "abandoned"


def test_attachment_merges_into_brief(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5, "brief": "기본"}, headers=HEADERS).json()["id"]
    r = client.post(f"/api/framework-interviews/{sid}/attachments", headers=HEADERS,
                    files={"file": ("memo.txt", b"purified water round", "text/plain")})
    assert r.status_code == 200, r.text
    assert "purified water round" in r.json()["brief"]
    bad = client.post(f"/api/framework-interviews/{sid}/attachments", headers=HEADERS,
                      files={"file": ("x.exe", b"00", "application/octet-stream")})
    assert bad.status_code == 422


def test_save_plan_stores_brief(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    r = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
                   json={"cards": [], "lock": False, "brief": "매일 라운드"})
    assert r.status_code == 200, r.text
    assert client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["brief"] == "매일 라운드"


def test_create_rejects_non_level5_category(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    parent = None
    node: dict = {}
    tag = f"fw-{uuid4().hex[:6]}"
    for level in range(1, 5):  # L4까지만 — 마지막(node)은 레벨 4
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    r = client.post("/api/framework-interviews", json={"category_id": node["id"]}, headers=HEADERS)
    assert r.status_code == 422


def test_plan_generation_failure_records_single_usage_event(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]

    async def _boom(messages, model=None, *, reasoning=None, max_tokens=None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    r = client.post(f"/api/framework-interviews/{sid}/plan", headers=HEADERS)
    assert r.status_code == 502

    async def _events() -> list[AiUsageEvent]:
        async with SessionLocal() as db:
            return list((await db.scalars(select(AiUsageEvent).where(
                AiUsageEvent.login_id == SYSADMIN, AiUsageEvent.ok.is_(False),
            ))).all())

    events = asyncio.run(_events())
    assert len(events) == 1
    assert events[0].kind is None
    assert events[0].ok is False
    assert events[0].map_id == 0


from tests.test_framework_interview_runner import Q_JSON, ROW_JSON, _step  # noqa: E402

RELATIONS_TMPL = '{"entry":{"taskId":"%s","triggerType":"manual","label":"시작"},"edges":[{"src":"%s","dst":"%s","kind":"seq"}]}'


def test_answers_validation_and_full_flow_to_document(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in ["A", "B"]]
    body = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS).json()
    t1, t2 = body["tasks"]

    early = client.post(f"/api/framework-interviews/{sid}/tasks/{t1['id']}/answers", json={"answers": {}}, headers=HEADERS)
    assert early.status_code == 409  # questionnaire not ready yet

    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON, ROW_JSON,
                                 RELATIONS_TMPL % (t1["task_id"], t1["task_id"], t2["task_id"])])
    _step(sid)
    _step(sid)
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{t1['id']}", headers=HEADERS).json()
    assert detail["status"] == "ready" and len(detail["questionnaire"]["questions"]) == 6

    missing = client.post(f"/api/framework-interviews/{sid}/tasks/{t1['id']}/answers",
                          json={"answers": {"q1": ["a1"], "q3": ["s1"]}}, headers=HEADERS)
    assert missing.status_code == 422 and missing.json()["detail"]["missing"] == ["q2"]

    full = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "요청서", "q6": ""}
    for tid in (t1["id"], t2["id"]):
        r = client.post(f"/api/framework-interviews/{sid}/tasks/{tid}/answers", json={"answers": full}, headers=HEADERS)
        assert r.status_code == 200, r.text
    too_early = client.post(f"/api/framework-interviews/{sid}/relations", headers=HEADERS)
    assert too_early.status_code == 409
    _step(sid)
    _step(sid)
    state = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()
    assert state["progress"] == {"total": 2, "drawn": 2, "failed": 0, "working": False}

    linked = client.post(f"/api/framework-interviews/{sid}/relations", headers=HEADERS).json()
    assert linked["status"] == "linking" and linked["relations"]["entry"]["taskId"] == t1["task_id"]

    confirmed = client.put(f"/api/framework-interviews/{sid}/relations", headers=HEADERS,
                           json={"relations": linked["relations"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "ready"

    doc = client.get(f"/api/framework-interviews/{sid}/document", headers=HEADERS).json()
    assert doc["schema_version"] == "0.5-bpm-interface-draft"
    assert [r["taskId"] for r in doc["rows"]] == [t1["task_id"], t2["task_id"]]
    assert doc["l5"]["nodeCode"] == state["category_code"]

    dry = client.post("/api/categories/import-interview", headers=HEADERS,
                      json={"files": [{"name": "ai.json", "content": doc}], "apply": False})
    assert dry.status_code == 200, dry.text
    assert dry.json()["files"][0]["ok"] is True

    applied = client.post(f"/api/framework-interviews/{sid}/mark-applied", headers=HEADERS)
    assert applied.json()["status"] == "applied"


def test_pause_resume_roundtrip(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    kicked: list[int] = []
    monkeypatch.setattr(runner, "kick", lambda session_id: kicked.append(session_id))
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
               json={"cards": [{"name": "A", "summary": "", "owner_role": "", "department": "", "depends_on": []}], "lock": True})
    assert kicked == [sid]
    assert client.post(f"/api/framework-interviews/{sid}/pause", headers=HEADERS).json()["paused"] is True
    assert client.post(f"/api/framework-interviews/{sid}/resume", headers=HEADERS).json()["paused"] is False
    assert kicked == [sid, sid]
