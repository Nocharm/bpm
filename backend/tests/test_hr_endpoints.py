"""HR 엔드포인트 테스트 — sync 503/429/요약, 프리뷰(무변경·diff), /api/me 1인 동기화 스로틀."""

from fastapi.testclient import TestClient

from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _seed_employee


def test_sync_503_without_hr_config(client: TestClient) -> None:
    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 503


def test_sync_endpoint_returns_new_summary_and_guard(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("ep.user"), None])
    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["upserted"] == 1 and body["skipped"] == 1
    assert "dept_info_orphans" in body and body["aborted_reason"] is None
    assert client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"}).status_code == 429


def test_sync_preview_reports_without_writes(client: TestClient, monkeypatch) -> None:
    _seed_employee("pv.gone", source="hr")
    _seed_employee("PV.case", source="hr")
    _mock_hr(monkeypatch, [_hr_row("pv.new"), _hr_row("pv.case")])
    res = client.post("/api/employees/sync-preview", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert "pv.new" in body["new_login_ids"]
    assert "pv.gone" in body["delete_login_ids"]
    assert any("pv.case" in m for m in body["case_mismatches"])  # 표기 불일치 감지 (§9)
    assert _get_employee("pv.new") is None            # 무변경
    assert _get_employee("pv.gone") is not None


def test_me_syncs_once_per_day(client: TestClient, monkeypatch) -> None:
    from app.hr import client as hr_client
    from app.hr import service as hr_service

    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "n8n_hr_url", "http://hr.local/webhook")
    monkeypatch.setattr(settings, "n8n_hr_token", "tok")
    hr_service._one_sync_done.clear()
    calls = {"n": 0}

    async def fake_one(login_id: str):
        calls["n"] += 1
        return _hr_row(login_id, name="Fresh Name")

    monkeypatch.setattr(hr_client, "fetch_employee", fake_one)
    # auth ON이므로 JWT 검증을 우회해 사용자 주입
    from app import auth as auth_mod
    from app.main import app

    app.dependency_overrides[auth_mod.get_current_user] = lambda: "me.user"
    try:
        assert client.get("/api/me").status_code == 200
        assert client.get("/api/me").status_code == 200
    finally:
        app.dependency_overrides.pop(auth_mod.get_current_user, None)
    assert calls["n"] == 1                       # 하루 1회 스로틀 (§6)
    assert _get_employee("me.user").name == "Fresh Name"
