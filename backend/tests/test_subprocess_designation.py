"""서브프로세스 지정 API — 가드(오너·게시버전·부서필수)·해제·변경기록. (spec 2026-07-06)"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapPermission, MapVersion, ProcessMap
from app.settings import settings

SYSADMIN = "desig.sysadmin"
OWNER = "desig.owner"
OTHER = "desig.other"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth_enabled=True + sysadmin 1명 지정 — 실 권한 판정 활성화. 테스트 후 복원."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _seed(coro_factory):
    async def _run():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_map(name: str, *, published: bool, owner: str = OWNER) -> int:
    """맵 + 버전 1개(published 여부 선택) + owner 권한행. map_id 반환."""

    async def _make(session) -> int:
        m = ProcessMap(name=name, visibility="private", owner_id=owner)
        v = MapVersion(label="As-Is", status="published" if published else "draft")
        m.versions.append(v)
        session.add(m)
        await session.flush()
        session.add(
            MapPermission(
                map_id=m.id,
                principal_type="user",
                principal_id=owner,
                role="owner",
                granted_by=SYSADMIN,
            )
        )
        return m.id

    return _seed(_make)


BODY = {"department": "Sales", "assignee": "Kim", "system": "SAP", "duration": "2d"}


def test_designate_happy_path(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-happy", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 200
    data = res.json()
    assert data["sp_designated_at"] is not None
    assert data["sp_department"] == "Sales"
    assert data["sp_changed_by"] == OWNER
    assert data["sp_changed_at"] is not None


def test_designate_requires_published_version(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-draft-only", published=False)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 409


def test_designate_requires_owner(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-not-owner", published=True)
    act_as(OTHER)  # 권한행 없는 사용자
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    assert res.status_code == 403


def test_designate_department_required(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-no-dept", published=True)
    act_as(OWNER)
    res = client.put(
        f"/api/maps/{map_id}/subprocess-designation", json={"department": "  "}
    )
    assert res.status_code == 422


def test_attr_edit_keeps_designated_at(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-edit", published=True)
    act_as(OWNER)
    first = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY).json()
    second = client.put(
        f"/api/maps/{map_id}/subprocess-designation", json={**BODY, "system": "ERP"}
    ).json()
    assert second["sp_designated_at"] == first["sp_designated_at"]  # 지정 중 수정은 유지
    assert second["sp_system"] == "ERP"


def test_undesignate_keeps_attrs_and_is_idempotent(client: TestClient, enforce) -> None:
    map_id = seed_map("desig-undo", published=True)
    act_as(OWNER)
    client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY)
    res = client.delete(f"/api/maps/{map_id}/subprocess-designation")
    assert res.status_code == 200
    data = res.json()
    assert data["sp_designated_at"] is None
    assert data["sp_department"] == "Sales"  # 어트리뷰트는 유지 → 재지정 프리필
    # 멱등 — 이미 미지정이어도 200
    assert client.delete(f"/api/maps/{map_id}/subprocess-designation").status_code == 200
