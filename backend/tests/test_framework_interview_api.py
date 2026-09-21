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
from app.models import FrameworkInterviewSession
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
