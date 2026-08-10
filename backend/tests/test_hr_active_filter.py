"""active=false 행의 소비처 노출 테스트 — 디렉터리·eligible 제외, admin 포함 (설계 §7)."""

from fastapi.testclient import TestClient

from tests.hr_sync_helpers import _seed_employee


def test_directory_excludes_inactive(client: TestClient) -> None:
    _seed_employee("act.on", source="hr", active=True, name="Active One",
                   org_l1="Filter Div", department="Filter Div")
    _seed_employee("act.off", source="hr", active=False, name="Gone One",
                   org_l1="Filter Div", department="Filter Div")
    body = client.get("/api/directory").json()
    ids = {u["id"] for u in body["users"]}
    assert "act.on" in ids and "act.off" not in ids


def test_admin_users_still_include_inactive(client: TestClient) -> None:
    _seed_employee("adm.off", source="hr", active=False)
    body = client.get("/api/admin/users").json()
    row = next(u for u in body["users"] if u["login_id"] == "adm.off")
    assert row["active"] is False


def test_eligible_users_exclude_inactive(client: TestClient) -> None:
    # 공개 맵 생성 → eligible-assignees 후보에 비활성 제외 확인
    created = client.post(
        "/api/maps",
        json={"name": "Active Filter Map", "owning_department": "Owning Anchor Division"},
    )
    assert created.status_code in (200, 201)
    version_id = created.json()["versions"][0]["id"]
    _seed_employee("elig.off", source="hr", active=False)
    res = client.get(f"/api/versions/{version_id}/eligible-assignees")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()["users"]}
    assert "elig.off" not in ids
