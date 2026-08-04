"""AI 프롬프트 관리 — 레지스트리·오버라이드 API·빌더 반영 테스트."""

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults
from app.settings import settings

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


def test_prompt_defaults_cover_all_keys() -> None:
    defaults = get_prompt_defaults()
    assert set(defaults) == set(PROMPT_KEYS)
    assert len(PROMPT_KEYS) == 7
    # 전 항목이 비어있지 않은 실제 프롬프트 문자열
    assert all(isinstance(value, str) and value.strip() for value in defaults.values())


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim. Restore after."""
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


def test_list_returns_defaults(client: TestClient) -> None:
    resp = client.get("/api/admin/ai-prompts")
    assert resp.status_code == 200
    body = resp.json()
    assert [item["key"] for item in body] == list(PROMPT_KEYS)
    assert all(item["is_customized"] is False for item in body)
    assert all(item["content"].strip() for item in body)
    assert all(item["updated_by"] is None for item in body)


def test_put_then_reset_roundtrip(client: TestClient) -> None:
    key = "anti_repeat_nudge"
    put = client.put(f"/api/admin/ai-prompts/{key}", json={"content": "커스텀 넛지"})
    assert put.status_code == 200
    assert put.json()["is_customized"] is True
    assert put.json()["content"] == "커스텀 넛지"
    assert put.json()["updated_by"]
    assert put.json()["updated_at"]
    listed = {item["key"]: item for item in client.get("/api/admin/ai-prompts").json()}
    assert listed[key]["content"] == "커스텀 넛지"
    reset = client.delete(f"/api/admin/ai-prompts/{key}")
    assert reset.status_code == 200
    assert reset.json()["is_customized"] is False
    assert reset.json()["content"] == get_prompt_defaults()[key]
    # 멱등 — 이미 기본값이어도 200
    assert client.delete(f"/api/admin/ai-prompts/{key}").status_code == 200


def test_put_validation(client: TestClient) -> None:
    assert client.put("/api/admin/ai-prompts/nope", json={"content": "x"}).status_code == 404
    assert client.delete("/api/admin/ai-prompts/nope").status_code == 404
    blank = client.put("/api/admin/ai-prompts/anti_repeat_nudge", json={"content": "   "})
    assert blank.status_code == 422


def test_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    key = "anti_repeat_nudge"
    assert client.get("/api/admin/ai-prompts", headers=headers).status_code == 403
    assert (
        client.put(f"/api/admin/ai-prompts/{key}", json={"content": "x"}, headers=headers).status_code
        == 403
    )
    assert client.delete(f"/api/admin/ai-prompts/{key}", headers=headers).status_code == 403
    ok = {"X-Dev-User": SYSADMIN}
    assert client.get("/api/admin/ai-prompts", headers=ok).status_code == 200


def test_overrides_reach_prompt_builders() -> None:
    from app.ai_prompt import build_system_prompt
    from app.interview.agents import build_drafter_messages, build_interviewer_messages
    from app.schemas import GraphOut

    graph = GraphOut(nodes=[], edges=[])
    custom = build_system_prompt("", graph, True, overrides={"ai_chat_instructions": "CUSTOM-CHAT"})
    assert custom.startswith("CUSTOM-CHAT")
    assert not build_system_prompt("", graph, True).startswith("CUSTOM-CHAT")

    interviewer = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "hi", overrides={"interviewer_contract": "CUSTOM-INT"}
    )
    assert interviewer[0]["content"].startswith("CUSTOM-INT")

    word = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "hi", mode="word",
        overrides={"interviewer_word_addendum": "\nCUSTOM-ADDENDUM"},
    )
    assert "CUSTOM-ADDENDUM" in word[0]["content"]

    drafter = build_drafter_messages(
        "activities", "ko", {}, None, "", "표준", overrides={"drafter_contract": "CUSTOM-DRAFT"}
    )
    assert drafter[0]["content"].startswith("CUSTOM-DRAFT")
