"""앱 런타임 설정(app-settings) 토글 + AI 챗 Q&A DB 적재 테스트."""

import json
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from app.main import app
from app.settings import settings
from tests.test_ai import _draft_version_checked_out, _enable_ai, _fake_ai

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


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


def _set_chat_log(client: TestClient, enabled: bool) -> dict:
    resp = client.put("/api/admin/app-settings", json={"ai_chat_log_enabled": enabled})
    assert resp.status_code == 200
    return resp.json()


def _read_logs(client: TestClient) -> list[dict]:
    resp = client.get("/api/admin/tables/ai_chat_logs", params={"size": 200})
    assert resp.status_code == 200
    return resp.json()["rows"]


def test_app_settings_default_off(client: TestClient) -> None:
    resp = client.get("/api/admin/app-settings")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ai_chat_log_enabled"] is False
    assert body["updated_by"] is None


def test_app_settings_put_roundtrip(client: TestClient) -> None:
    body = _set_chat_log(client, True)
    assert body["ai_chat_log_enabled"] is True
    assert body["updated_by"]  # 저장자 기록
    assert body["updated_at"]
    assert client.get("/api/admin/app-settings").json()["ai_chat_log_enabled"] is True
    # 복원 — 세션 공유 DB라 다른 테스트 오염 방지
    assert _set_chat_log(client, False)["ai_chat_log_enabled"] is False


def test_app_settings_requires_sysadmin(
    client: TestClient, sysadmin_enforced: None
) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    assert client.get("/api/admin/app-settings", headers=headers).status_code == 403
    assert (
        client.put(
            "/api/admin/app-settings", json={"ai_chat_log_enabled": True}, headers=headers
        ).status_code
        == 403
    )
    ok = {"X-Dev-User": SYSADMIN}
    assert client.get("/api/admin/app-settings", headers=ok).status_code == 200


def test_app_settings_default_tips(client: TestClient) -> None:
    from app.app_settings import DEFAULT_AI_CHAT_TIPS

    body = client.get("/api/admin/app-settings").json()
    assert body["ai_chat_tips"] == DEFAULT_AI_CHAT_TIPS
    assert len(DEFAULT_AI_CHAT_TIPS) == 20


def test_ai_tips_endpoint_and_custom_roundtrip(client: TestClient) -> None:
    from app.app_settings import DEFAULT_AI_CHAT_TIPS

    # 커스텀 팁 저장 — 공백 팁은 제거되고, /ai/tips(전 사용자)에도 반영
    resp = client.put(
        "/api/admin/app-settings",
        json={"ai_chat_tips": ["커스텀 팁 하나", "  ", "커스텀 팁 둘  "]},
    )
    assert resp.status_code == 200
    assert resp.json()["ai_chat_tips"] == ["커스텀 팁 하나", "커스텀 팁 둘"]
    assert client.get("/api/ai/tips").json()["tips"] == ["커스텀 팁 하나", "커스텀 팁 둘"]

    # 팁만 갱신해도 로그 토글은 유지
    assert resp.json()["ai_chat_log_enabled"] is False

    # 빈 목록 → 기본 팁 복원
    resp = client.put("/api/admin/app-settings", json={"ai_chat_tips": []})
    assert resp.json()["ai_chat_tips"] == DEFAULT_AI_CHAT_TIPS
    assert client.get("/api/ai/tips").json()["tips"] == DEFAULT_AI_CHAT_TIPS


def test_app_settings_partial_update_keeps_tips(client: TestClient) -> None:
    client.put("/api/admin/app-settings", json={"ai_chat_tips": ["유지될 팁"]})
    body = client.put("/api/admin/app-settings", json={"ai_chat_log_enabled": True}).json()
    assert body["ai_chat_tips"] == ["유지될 팁"]
    # 복원 — 세션 공유 DB 오염 방지
    client.put(
        "/api/admin/app-settings", json={"ai_chat_log_enabled": False, "ai_chat_tips": []}
    )


def test_ai_chat_logged_when_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "logged answer"}))
    )
    _set_chat_log(client, True)
    version_id = _draft_version_checked_out(client)

    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "log me"})
    assert resp.status_code == 200

    rows = _read_logs(client)
    row = next(r for r in rows if r["instruction"] == "log me")
    assert row["answer"] == "logged answer"
    assert row["kind"] == "answer"
    assert row["version_id"] == version_id
    assert row["login_id"]
    assert row["created_at"]  # 시간 포함 저장
    _set_chat_log(client, False)


def test_ai_chat_not_logged_when_disabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "quiet"}))
    )
    _set_chat_log(client, False)
    version_id = _draft_version_checked_out(client)
    before = len(_read_logs(client))

    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "no log"})
    assert resp.status_code == 200
    assert len(_read_logs(client)) == before
