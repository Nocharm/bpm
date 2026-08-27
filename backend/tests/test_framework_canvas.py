"""Framework L5 연계 캔버스 — 모델·권한·linkage-map·검증·확정·가드 (design 2026-08-28)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

SYSADMIN = "fwc.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이라 권한 분기가 안 걸린다."""
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


def test_models_roundtrip(client: TestClient) -> None:
    """신설 테이블/컬럼이 create_all·자동 ALTER로 존재하고 ORM 왕복이 된다."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import CategoryPermission, MapVersion, ProcessCategory

    async def _run() -> None:
        async with SessionLocal() as session:
            cat = ProcessCategory(code="FWC-M1", name="모델검증", level=1, sort_order=0)
            session.add(cat)
            await session.flush()
            session.add(
                CategoryPermission(
                    category_id=cat.id, principal_type="user",
                    principal_id="fwc.admin1", granted_by=SYSADMIN,
                )
            )
            cat.linkage_map_id = None  # 컬럼 존재 확인
            await session.commit()
            row = await session.scalar(
                select(CategoryPermission).where(CategoryPermission.category_id == cat.id)
            )
            assert row is not None and row.principal_id == "fwc.admin1"
            # MapVersion fw 컬럼 존재 — 인스턴스 생성으로 확인
            assert MapVersion(map_id=1, label="x", fw_major=1, fw_minor=0).fw_major == 1

    asyncio.run(_run())


def _seed_category(client: TestClient, code: str, name: str, level: int = 1,
                   parent_id: int | None = None) -> int:
    """멱등 카테고리 시드 — 세션 스코프 공유 DB라 code 재사용."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
            if row is None:
                row = ProcessCategory(code=code, name=name, level=level,
                                      parent_id=parent_id, sort_order=0)
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_category_permissions_put_replaces_and_gates(client: TestClient, enforce: None) -> None:
    cid = _seed_category(client, "FWC-P1", "권한검증")
    body = {"permissions": [{"principal_type": "user", "principal_id": "fwc.admin1"}]}
    act_as("fwc.pleb")
    assert client.put(f"/api/categories/{cid}/permissions", json=body).status_code == 403
    act_as(SYSADMIN)
    res = client.put(f"/api/categories/{cid}/permissions", json=body)
    assert res.status_code == 200
    assert res.json()["permissions"] == body["permissions"]
    # replace 멱등 — 다른 목록으로 갈아끼우면 이전 행은 사라진다
    body2 = {"permissions": [{"principal_type": "group", "principal_id": "7"}]}
    assert client.put(f"/api/categories/{cid}/permissions", json=body2).status_code == 200
    got = client.get(f"/api/categories/{cid}/permissions").json()["permissions"]
    assert got == body2["permissions"]
    assert client.get("/api/categories/999999/permissions").status_code == 404


def _seed_canvas_map(client: TestClient, category_id: int, name: str) -> int:
    """mode=framework 캔버스 맵 + draft 버전 1개 + linkage 결착 — 권한/검증 테스트용 최소 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessCategory, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.name == name))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, owner_id=SYSADMIN,
                                 visibility="public", mode="framework")
                row.versions.append(MapVersion(label="Linkage"))
                session.add(row)
                await session.flush()
                cat = await session.get(ProcessCategory, category_id)
                cat.linkage_map_id = row.id
                await session.commit()
            return row.id

    return asyncio.run(_run())


def test_framework_role_derivation(client: TestClient, enforce: None) -> None:
    """권한자(자기/조상 체인)=editor, 비권한자=viewer, sysadmin=owner — map_permissions 무시."""
    import asyncio

    from app.db import SessionLocal
    from app.permissions.access import get_effective_role

    l1 = _seed_category(client, "FWC-R1", "역할L1")
    l5 = _seed_category(client, "FWC-R5", "역할L5", level=5, parent_id=l1)
    canvas_id = _seed_canvas_map(client, l5, "역할검증 연계")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.ancestor"}]})
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.direct"}]})

    async def _roles() -> tuple[str | None, str | None, str | None, str | None]:
        async with SessionLocal() as session:
            return (
                await get_effective_role(session, "fwc.direct", canvas_id),
                await get_effective_role(session, "fwc.ancestor", canvas_id),  # L1 권한자 → 상속
                await get_effective_role(session, "fwc.pleb", canvas_id),
                await get_effective_role(session, SYSADMIN, canvas_id),
            )

    direct, ancestor, pleb, sysadmin = asyncio.run(_roles())
    assert direct == "editor"
    assert ancestor == "editor"
    assert pleb == "viewer"
    assert sysadmin == "owner"
