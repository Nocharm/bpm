"""오우닝 부서 — 생성 필수·known-path 검증·copy 상속 (spec 2026-07-10)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import SessionLocal

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
