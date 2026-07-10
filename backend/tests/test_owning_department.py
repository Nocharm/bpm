"""오우닝 부서 — 생성 필수·known-path 검증·copy 상속 (spec 2026-07-10)."""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapVersion, ProcessMap
from app.permissions import logic
from app.settings import settings

# LOCAL_USERS(app/ad/service.py) org 경로 — 테스트 DB lifespan에 항상 시드됨
MSD = "Management Support Division"
PROC_OFFICE = f"{MSD}/Procurement Office"
SOURCING_1 = f"{PROC_OFFICE}/Sourcing Team 1"
# conftest 앵커 부서와 동기 — 어떤 테스트 액터도 소속되지 않음
ANCHOR = "Owning Anchor Division"


def _name() -> str:
    return f"owning-{uuid4().hex[:8]}"


def test_create_requires_owning_department(client: TestClient) -> None:
    res = client.post("/api/maps", json={"name": _name()})
    assert res.status_code == 422


def test_create_rejects_unknown_department(client: TestClient) -> None:
    res = client.post(
        "/api/maps", json={"owning_department": "No Such Division", "name": _name()}
    )
    assert res.status_code == 422
    assert "unknown department" in res.json()["detail"]


def test_create_persists_owning_department(client: TestClient) -> None:
    name = _name()
    res = client.post(
        "/api/maps", json={"owning_department": PROC_OFFICE, "name": name}
    )
    assert res.status_code == 201
    body = res.json()
    assert body["owning_department"] == PROC_OFFICE
    # 목록에도 노출
    listed = client.get("/api/maps").json()
    mine = next(m for m in listed if m["name"] == name)
    assert mine["owning_department"] == PROC_OFFICE


def test_legacy_map_null_owning_department_ok(client: TestClient) -> None:
    """레거시(직접 DB 삽입, NULL) 맵도 목록·상세가 정상 — 누락 상태 표현."""
    from app.models import MapVersion, ProcessMap

    name = _name()

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, visibility="public")
            m.versions.append(MapVersion(label="As-Is"))
            session.add(m)
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    detail = client.get(f"/api/maps/{map_id}")
    assert detail.status_code == 200
    assert detail.json()["owning_department"] is None


def test_copy_inherits_owning_department(client: TestClient) -> None:
    """copy는 설명처럼 오우닝 부서도 원본에서 상속한다."""
    from app.models import MapVersion, ProcessMap

    name = _name()

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name, visibility="public", owning_department=SOURCING_1
            )
            m.versions.append(MapVersion(label="As-Is", status="approved"))
            session.add(m)
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(f"/api/maps/{map_id}/copy", json={})
    assert res.status_code == 201
    assert res.json()["owning_department"] == SOURCING_1


PIT = f"{MSD}/Process Innovation Office/Process Innovation Team"  # admin.kim 소속


def test_logic_owning_member_gets_editor_floor() -> None:
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", [], False, set(),
        owning_department=PROC_OFFICE,  # 상위 부서 지정 → 하위 팀원 포함
    )
    assert role == "editor"


def test_logic_owning_floor_upgrades_viewer_grant() -> None:
    perms: list[logic.Permission] = [("user", "user.lee", "viewer")]
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", perms, False, set(),
        owning_department=SOURCING_1,
    )
    assert role == "editor"


def test_logic_owner_grant_beats_owning_floor() -> None:
    perms: list[logic.Permission] = [("user", "user.lee", "owner")]
    role = logic.effective_role(
        "user.lee", False, SOURCING_1, "private", perms, False, set(),
        owning_department=SOURCING_1,
    )
    assert role == "owner"


def test_logic_non_member_stays_none() -> None:
    role = logic.effective_role(
        "admin.kim", False, PIT, "private", [], False, set(),
        owning_department=PROC_OFFICE,
    )
    assert role is None


SYSADMIN = "admin.sys"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — test_permission_gates.py와 동일 패턴."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def seed_owning_map(owning: str | None, visibility: str = "private") -> int:
    """직접 DB 시드 — API 경유 없이 오우닝 부서만 통제."""

    async def _make() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=_name(), visibility=visibility, owning_department=owning
            )
            m.versions.append(MapVersion(label="As-Is"))
            session.add(m)
            await session.commit()
            return m.id

    return asyncio.run(_make())


def test_owning_member_sees_private_map_as_editor(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as("user.lee")  # Sourcing Team 1 ⊂ Procurement Office
    listed = client.get("/api/maps").json()
    mine = next(m for m in listed if m["id"] == map_id)
    assert mine["my_role"] == "editor"
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_non_member_gets_403_on_private_owned_map(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(PROC_OFFICE)
    act_as("admin.kim")  # Process Innovation — 비소속
    assert all(m["id"] != map_id for m in client.get("/api/maps").json())
    assert client.get(f"/api/maps/{map_id}").status_code == 403


def test_owning_member_in_eligible_approvers(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_owning_map(SOURCING_1)
    act_as(SYSADMIN)
    ids = {u["id"] for u in client.get(f"/api/maps/{map_id}/eligible-approvers").json()}
    assert "user.lee" in ids       # 파생 editor → viewer+ 후보
    assert "admin.kim" not in ids  # 비소속·무권한
