"""앱 런타임 설정(app-settings) 팁·대화 보존 상한 테스트."""

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

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


def test_app_settings_defaults(client: TestClient) -> None:
    resp = client.get("/api/admin/app-settings")
    assert resp.status_code == 200
    body = resp.json()
    assert "ai_chat_log_enabled" not in body  # 토글 제거(서버 저장이 원장)
    assert body["ai_chat_max_sessions_per_map"] == 20


def test_app_settings_put_roundtrip(client: TestClient) -> None:
    body = client.put("/api/admin/app-settings", json={"ai_chat_retention_days": 90}).json()
    assert body["ai_chat_retention_days"] == 90
    assert body["updated_by"]  # 저장자 기록
    assert body["updated_at"]
    client.put("/api/admin/app-settings", json={"ai_chat_retention_days": 180})  # 복원


def test_app_settings_requires_sysadmin(
    client: TestClient, sysadmin_enforced: None
) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    assert client.get("/api/admin/app-settings", headers=headers).status_code == 403
    assert (
        client.put(
            "/api/admin/app-settings", json={"ai_chat_retention_days": 30}, headers=headers
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

    # 빈 목록 → 기본 팁 복원
    resp = client.put("/api/admin/app-settings", json={"ai_chat_tips": []})
    assert resp.json()["ai_chat_tips"] == DEFAULT_AI_CHAT_TIPS
    assert client.get("/api/ai/tips").json()["tips"] == DEFAULT_AI_CHAT_TIPS


def test_app_settings_partial_update_keeps_tips(client: TestClient) -> None:
    client.put("/api/admin/app-settings", json={"ai_chat_tips": ["유지될 팁"]})
    body = client.put("/api/admin/app-settings", json={"ai_chat_retention_days": 60}).json()
    assert body["ai_chat_tips"] == ["유지될 팁"]
    # 복원 — 세션 공유 DB 오염 방지
    client.put(
        "/api/admin/app-settings", json={"ai_chat_retention_days": 180, "ai_chat_tips": []}
    )


def test_app_settings_retention_defaults_and_roundtrip(client: TestClient) -> None:
    body = client.get("/api/admin/app-settings").json()
    assert body["ai_chat_max_sessions_per_map"] == 20
    assert body["ai_chat_max_messages_per_session"] == 200
    assert body["ai_chat_retention_days"] == 180

    body = client.put(
        "/api/admin/app-settings",
        json={"ai_chat_max_sessions_per_map": 5, "ai_chat_retention_days": 30},
    ).json()
    assert body["ai_chat_max_sessions_per_map"] == 5
    assert body["ai_chat_max_messages_per_session"] == 200  # 부분 갱신 — 미전송 유지
    assert body["ai_chat_retention_days"] == 30
    # 범위 밖은 422 (pydantic Field 검증)
    assert (
        client.put("/api/admin/app-settings", json={"ai_chat_max_sessions_per_map": 0}).status_code
        == 422
    )
    # 복원 — 공유 DB 오염 방지
    client.put(
        "/api/admin/app-settings",
        json={
            "ai_chat_max_sessions_per_map": 20,
            "ai_chat_max_messages_per_session": 200,
            "ai_chat_retention_days": 180,
        },
    )
