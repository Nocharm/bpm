"""active=false 행의 소비처 노출 테스트 — 디렉터리·eligible 제외, admin 포함 (설계 §7)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import MapPermission
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


def test_editors_picker_excludes_inactive_editor(client: TestClient) -> None:
    # 점유권 이전 피커 — 비활성 편집자는 후보 자체에서 제외 (F4, design §7)
    _seed_employee("hr.active.editor", source="hr", active=True, name="Active Editor",
                   org_l1="Filter Div", department="Filter Div")
    _seed_employee("hr.gone.editor", source="hr", active=False, name="Gone Editor",
                   org_l1="Filter Div", department="Filter Div")

    created = client.post(
        "/api/maps",
        json={"name": "HR Editors Filter Map", "owning_department": "Owning Anchor Division"},
    )
    assert created.status_code in (200, 201)
    map_id = created.json()["id"]

    async def _seed_perms() -> None:
        async with SessionLocal() as session:
            session.add(MapPermission(
                map_id=map_id, principal_type="user", principal_id="hr.active.editor",
                role="editor", granted_by="seed",
            ))
            session.add(MapPermission(
                map_id=map_id, principal_type="user", principal_id="hr.gone.editor",
                role="editor", granted_by="seed",
            ))
            await session.commit()

    asyncio.run(_seed_perms())

    res = client.get(f"/api/maps/{map_id}/editors")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()}
    assert "hr.active.editor" in ids
    assert "hr.gone.editor" not in ids
