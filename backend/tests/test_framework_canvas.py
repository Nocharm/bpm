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


def _seed_l6_map(client: TestClient, category_id: int, name: str, code: str) -> int:
    """카테고리에 연결된 게시본 있는 L6 맵 멱등 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, visibility="public",
                                 category_id=category_id, consultant_code=code)
                row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_linkage_map_open_create_seed_and_reconcile(client: TestClient, enforce: None) -> None:
    l1 = _seed_category(client, "FWC-O1", "열기L1")
    l5 = _seed_category(client, "FWC-O5", "열기L5", level=5, parent_id=l1)
    m1 = _seed_l6_map(client, l5, "열기업무1", "FWC-OM1")
    m2 = _seed_l6_map(client, l5, "열기업무2", "FWC-OM2")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.opener"}]})

    # level!=5 → 422
    assert client.post(f"/api/categories/{l1}/linkage-map").status_code == 422
    # 캔버스 없음 + 비권한자 → 404
    act_as("fwc.pleb")
    assert client.post(f"/api/categories/{l5}/linkage-map").status_code == 404
    # 권한자 생성 — 소속 L6 2개가 subprocess 노드로 시드
    act_as("fwc.opener")
    created = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert created["added_count"] == 2 and created["missing_count"] == 0
    map_id = created["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["mode"] == "framework"
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    linked = {n["linked_map_id"] for n in graph["nodes"]}
    assert linked == {m1, m2}
    assert all(n["node_type"] == "subprocess" for n in graph["nodes"])
    # 멱등 재호출 — 추가 없음
    again = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert again["map_id"] == map_id and again["added_count"] == 0
    # 새 L6 유입 후 재열기 → 자동 보강 append
    _seed_l6_map(client, l5, "열기업무3", "FWC-OM3")
    assert client.post(f"/api/categories/{l5}/linkage-map").json()["added_count"] == 1
    # 뷰어 열람 — 보강 없이 missing_count만
    _seed_l6_map(client, l5, "열기업무4", "FWC-OM4")
    act_as("fwc.pleb")
    viewed = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert viewed["added_count"] == 0 and viewed["missing_count"] == 1


def _checkout(client: TestClient, version_id: int) -> None:
    res = client.post(f"/api/versions/{version_id}/checkout", json={})
    assert res.status_code in (200, 201), res.text


def test_framework_graph_validation(client: TestClient, enforce: None) -> None:
    """캔버스 저장: subprocess-only 허용(start 없음 OK), 타 타입 유입은 422. 일반 맵은 start 강제 유지."""
    l5 = _seed_category(client, "FWC-V5", "검증L5", level=5)
    _seed_l6_map(client, l5, "검증업무1", "FWC-VM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.editor"}]})
    act_as("fwc.editor")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    node = graph["nodes"][0]
    # start 없이 subprocess 노드만 + 엣지 없이 저장 — 통과해야 한다
    payload = {"nodes": [node], "edges": [], "groups": []}
    assert client.put(f"/api/versions/{draft['id']}/graph", json=payload).status_code == 200, (
        client.put(f"/api/versions/{draft['id']}/graph", json=payload).text
    )
    # process 노드 유입 → 422
    bad = dict(node, id="fwcbadnode000000000000000000000001", node_type="process", linked_map_id=None)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, bad], "edges": [], "groups": []})
    assert res.status_code == 422
    assert "framework" in res.json()["detail"]


def test_framework_confirm_versioning(client: TestClient, enforce: None) -> None:
    l5 = _seed_category(client, "FWC-C5", "확정L5", level=5)
    _seed_l6_map(client, l5, "확정업무1", "FWC-CM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.confirmer"}]})
    act_as("fwc.confirmer")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]

    act_as("fwc.pleb")
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).status_code == 403
    act_as("fwc.confirmer")
    v1 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert (v1["label"], v1["status"]) == ("v1.0", "published")
    v2 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert v2["label"] == "v1.1"
    v3 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": True}).json()
    assert v3["label"] == "v2.0"
    detail = client.get(f"/api/maps/{map_id}").json()
    statuses = [v["status"] for v in detail["versions"]]
    assert statuses.count("published") == 3  # 이전 스냅샷 expired 전환 없음
    assert statuses.count("draft") == 1      # 라이브는 계속 draft
    # 일반 맵에는 422
    act_as(SYSADMIN)
    normal = client.post("/api/maps", json={"name": "확정검증 일반맵",
                                            "owning_department": "Owning Anchor Division"}).json()
    assert client.post(f"/api/maps/{normal['id']}/framework-confirm",
                       json={"major": False}).status_code == 422
