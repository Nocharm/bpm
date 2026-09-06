"""Framework 슬롯 변경 — 결함 회귀·코어·slot-changes 엔드포인트 (spec 2026-09-06).

client 픽스처가 세션 스코프 공유 DB라 카테고리 코드는 이 파일 전용 접두사(FWS-*)로 격리한다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapVersion, ProcessCategory, ProcessMap
from app.settings import settings

SYSADMIN = "fws.sysadmin"
DEPT = "Owning Anchor Division"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이어서 권한 분기가 안 걸린다."""
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


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _seed_category(code: str, name: str, level: int = 1, parent_id: int | None = None) -> int:
    async def _seed(session):
        row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
        if row is None:
            row = ProcessCategory(code=code, name=name, level=level, parent_id=parent_id, sort_order=0)
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _seed_l6_map(category_id: int | None, name: str, code: str | None, owner: str = SYSADMIN) -> int:
    """게시본 1개를 가진 일반 맵 — code가 있으면 consultant_code(멱등 키)로 재사용."""

    async def _seed(session):
        row = None
        if code is not None:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
        if row is None:
            row = ProcessMap(name=name, created_by=owner, owner_id=owner, visibility="public",
                             category_id=category_id, consultant_code=code)
            row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _map_row(map_id: int) -> dict:
    async def _get(session):
        m = await session.get(ProcessMap, map_id)
        return {"category_id": m.category_id, "consultant_code": m.consultant_code,
                "deleted": m.deleted_at is not None, "retired_to": m.retired_to_map_id, "mode": m.mode}

    return _run(_get)


def _draft_id(client: TestClient, map_id: int) -> int:
    detail = client.get(f"/api/maps/{map_id}").json()
    return next(v for v in detail["versions"] if v["status"] == "draft")["id"]


def _create_map(client: TestClient, name: str) -> int:
    resp = client.post("/api/maps", json={"name": name, "visibility": "public", "owning_department": DEPT})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


# ── 결함 회귀 (2026-09-03 프로브 승격) ─────────────────────────────────────────


def test_transfer_succeeds_when_target_id_is_lower(client: TestClient) -> None:
    """결함 ①: target.id < source.id 이면 UPDATE 순서(PK 오름차순) 때문에 unique(consultant_code) 충돌."""
    l5 = _seed_category("FWS-A5", "핫픽스A", level=5)
    target = _create_map(client, "fws hotfix target older")
    source = _seed_l6_map(l5, "fws hotfix source", "FWS-A-SRC")
    assert target < source
    resp = client.post(f"/api/maps/{source}/framework-transfer", json={"to_map_id": target})
    assert resp.status_code == 200, resp.text
    assert _map_row(source)["consultant_code"] is None
    assert _map_row(target) == {"category_id": l5, "consultant_code": "FWS-A-SRC", "deleted": False,
                                "retired_to": None, "mode": "normal"}


def test_slot_endpoints_reject_non_normal_maps(client: TestClient) -> None:
    """결함 ②: 연계 캔버스(mode=framework)는 슬롯 대상도 이양 대상도 될 수 없다."""
    l5 = _seed_category("FWS-B5", "핫픽스B", level=5)
    other_l5 = _seed_category("FWS-B5X", "핫픽스BX", level=5)
    canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]
    src = _seed_l6_map(l5, "fws hotfix src", "FWS-B-SRC")
    r1 = client.put(f"/api/maps/{canvas}/category", json={"category_id": l5})
    assert r1.status_code == 422 and "normal maps" in r1.json()["detail"]
    r2 = client.post(f"/api/maps/{src}/framework-transfer", json={"to_map_id": canvas})
    assert r2.status_code == 422 and "normal maps" in r2.json()["detail"]
    assert _map_row(canvas)["category_id"] is None
