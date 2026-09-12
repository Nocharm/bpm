"""앱 런타임 설정(app-settings) 팁·대화 보존 상한 테스트."""

import uuid
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


def test_ai_access_toggle_blocks_all_ai_surfaces(client, monkeypatch) -> None:
    """관리자 런타임 AI 차단 — me.ai_enabled·인터뷰·AI 챗 모델 목록이 일괄 차단/복구 (2026-07-30)."""
    from uuid import uuid4

    from app.settings import settings

    monkeypatch.setattr(settings, "ai_enabled", True)
    # 차단
    out = client.put("/api/admin/app-settings", json={"ai_access_disabled": True}).json()
    assert out["ai_access_disabled"] is True
    assert client.get("/api/me").json()["ai_enabled"] is False
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"ai-off-{uuid4().hex[:8]}"},
    ).json()
    resp = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": created["versions"][0]["id"]}
    )
    assert resp.status_code == 503
    assert client.get("/api/ai/models").status_code == 503
    # 복구
    out = client.put("/api/admin/app-settings", json={"ai_access_disabled": False}).json()
    assert out["ai_access_disabled"] is False
    assert client.get("/api/me").json()["ai_enabled"] is True
    resp = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": created["versions"][0]["id"]}
    )
    assert resp.status_code == 200
    client.delete(f"/api/interviews/{resp.json()['id']}")


def test_catalogs_default_has_other_only(client: TestClient) -> None:
    # 관리 목록 미설정 상태 — 역할은 빈 목록, 시스템은 예약 항목 Other만
    body = client.get("/api/catalogs").json()
    assert body["assignee_roles"] == []
    assert body["systems"] == [{"value": "Other", "aliases": []}]


def test_app_settings_managed_lists_roundtrip(client: TestClient) -> None:
    body = client.put(
        "/api/admin/app-settings",
        json={
            # 문자열(구 클라이언트)과 엔트리가 섞여도 전부 엔트리로 승격된다
            "assignee_roles": [" 실험자 ", {"value": "검토자", "aliases": [" 리뷰어 ", "review", "리뷰어", "검토자"]}, "실험자", ""],
            "systems": ["lims", {"value": "LIMS", "aliases": ["랩정보"]}, "SAP", {"value": "other", "aliases": ["기타"]}],
        },
    ).json()
    # 값: trim·casefold 중복 제거(첫 표기). 별칭: trim·중복 제거·자기 값과 같은 별칭 제거
    assert body["assignee_roles"] == [
        {"value": "실험자", "aliases": []},
        {"value": "검토자", "aliases": ["리뷰어", "review"]},
    ]
    # Other는 맨 앞·별칭 보존. 뒤에 온 LIMS 엔트리는 값 중복이라 통째로 버려진다(별칭도 승계 안 함)
    assert body["systems"] == [
        {"value": "Other", "aliases": ["기타"]},
        {"value": "lims", "aliases": []},
        {"value": "SAP", "aliases": []},
    ]
    catalogs = client.get("/api/catalogs").json()
    assert catalogs["assignee_roles"] == body["assignee_roles"]
    assert catalogs["systems"] == body["systems"]
    body = client.put("/api/admin/app-settings", json={"assignee_roles": [], "systems": []}).json()
    assert body["assignee_roles"] == [] and body["systems"] == [{"value": "Other", "aliases": []}]


def test_app_settings_alias_conflicts_prefer_values(client: TestClient) -> None:
    """별칭 하나 → 정식 표기 하나: 다른 항목의 값·앞선 별칭과 겹치는 별칭은 버린다 (design 2026-09-12 §1)."""
    body = client.put(
        "/api/admin/app-settings",
        json={
            "assignee_roles": [
                {"value": "Reviewer", "aliases": ["검토자", "approver"]},
                {"value": "Approver", "aliases": ["승인자", "검토자"]},
            ],
        },
    ).json()
    assert body["assignee_roles"] == [
        {"value": "Reviewer", "aliases": ["검토자"]},
        {"value": "Approver", "aliases": ["승인자"]},
    ]
    client.put("/api/admin/app-settings", json={"assignee_roles": []})


def test_app_settings_alias_cap_and_legacy_string_storage(client: TestClient) -> None:
    """별칭 20개 상한 + 저장된 레거시 문자열 배열은 읽기 시 승격."""
    import asyncio

    from app.app_settings import ASSIGNEE_ROLES_KEY, set_app_setting
    from app.db import SessionLocal

    too_many = {"value": "Operator", "aliases": [f"a{i}" for i in range(25)]}
    body = client.put("/api/admin/app-settings", json={"assignee_roles": [too_many]}).json()
    assert len(body["assignee_roles"][0]["aliases"]) == 20

    async def _seed_legacy() -> None:
        async with SessionLocal() as session:
            await set_app_setting(session, ASSIGNEE_ROLES_KEY, '["Legacy One", "Legacy Two"]', "test")
            await session.commit()

    asyncio.run(_seed_legacy())
    assert client.get("/api/catalogs").json()["assignee_roles"] == [
        {"value": "Legacy One", "aliases": []},
        {"value": "Legacy Two", "aliases": []},
    ]
    client.put("/api/admin/app-settings", json={"assignee_roles": []})


def test_app_settings_available_systems_lists_values_in_use(client: TestClient) -> None:
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"catalog probe {uuid.uuid4().hex[:6]}"}
    ).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    probe = f"Probe-{uuid.uuid4().hex[:6]}"
    client.put(
        f"/api/versions/{version_id}/graph",
        json={
            "nodes": [
                {"id": f"cat-s-{probe}", "title": "시작", "node_type": "start"},
                {"id": f"cat-p-{probe}", "title": "작업", "system": probe},
            ],
            "edges": [],
        },
    )
    body = client.get("/api/admin/app-settings").json()
    assert probe in body["available_systems"]


def test_catalogs_readable_by_non_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    assert client.get("/api/catalogs", headers=headers).status_code == 200
    assert client.get("/api/admin/app-settings", headers=headers).status_code == 403


# ── 커밋 규칙 이중 구현 — FE lib/catalogs.ts commitRole/commitSystem과 동치 (design 2026-09-12) ──

_SYSTEMS = [
    {"value": "Other", "aliases": []},
    {"value": "SAP ERP", "aliases": ["sap", "ERP"]},
]
_ROLES = [{"value": "Buyer", "aliases": ["구매 담당자"]}]


def test_commit_role_maps_alias_to_canonical_and_keeps_free_text() -> None:
    from app.app_settings import commit_role

    assert commit_role(" 구매 담당자 ", _ROLES) == "Buyer"
    assert commit_role("buyer", _ROLES) == "Buyer"
    assert commit_role("  QA reviewer ", _ROLES) == "QA reviewer"
    assert commit_role("", _ROLES) == ""


def test_commit_system_mirrors_frontend_rule() -> None:
    from app.app_settings import commit_system

    assert commit_system("", _SYSTEMS, "note") == ("", "note")
    assert commit_system("erp", _SYSTEMS, "note") == ("SAP ERP", "note")
    assert commit_system("Legacy ledger", _SYSTEMS, "") == ("Other", "Legacy ledger")
    assert commit_system("Legacy ledger", _SYSTEMS, "Legacy ledger") == ("Other", "Legacy ledger")
    # 기존 메모가 다른 내용이면 메모는 지키고 Other만 기록
    assert commit_system("Legacy ledger", _SYSTEMS, "old note") == ("Other", "old note")
