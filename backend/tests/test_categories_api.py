"""카테고리 트리 조회 API — lazy 자식·서브트리 카운트·카테고리별 맵 페이지네이션/가시성 마스킹."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

STRANGER_SYSADMIN = "cat.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON: auth_enabled=True + sysadmin 1명 지정. 정리 시 복원 (test_permission_gates.py 패턴).

    기본 스위트는 auth OFF라 is_sysadmin이 전원 True → private 마스킹이 트리거되지 않는다
    (brief §Step1 주의사항). 마스킹을 검증하는 테스트만 이 픽스처로 감싼다.
    """
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _seed_tree(client: TestClient) -> dict[str, int]:
    """A(L1) > A1(L2) 트리 + A1에 public 맵 1·private 맵 1 연결. 반환: code→category id.

    client가 세션 스코프라 테스트 간 DB를 공유한다 — code/consultant_code unique 제약과
    map_count 이중집계를 피하기 위해 기존 행이 있으면 재사용하는 멱등 시드로 만든다.
    """
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessCategory, ProcessMap

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            a = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == "CAT-A")
            )
            if a is None:
                a = ProcessCategory(code="CAT-A", name="구매", level=1, sort_order=0)
                session.add(a)
                await session.flush()
            a1 = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == "CAT-A1")
            )
            if a1 is None:
                a1 = ProcessCategory(
                    code="CAT-A1", name="직접구매", level=2, parent_id=a.id, sort_order=0
                )
                session.add(a1)
                await session.flush()
            pub = await session.scalar(
                select(ProcessMap).where(ProcessMap.consultant_code == "CAT-M1")
            )
            if pub is None:
                pub = ProcessMap(
                    name="framework pub map", visibility="public",
                    owner_id="cat.owner", created_by="cat.owner",
                    category_id=a1.id, consultant_code="CAT-M1",
                )
                session.add(pub)
                await session.flush()
                session.add(
                    MapVersion(
                        map_id=pub.id, label="As-Is", status="published", version_number=1
                    )
                )
            prv = await session.scalar(
                select(ProcessMap).where(ProcessMap.consultant_code == "CAT-M2")
            )
            if prv is None:
                prv = ProcessMap(
                    name="framework private map", visibility="private",
                    owner_id="cat.owner", created_by="cat.owner",
                    category_id=a1.id, consultant_code="CAT-M2",
                )
                session.add(prv)
                await session.flush()
            await session.commit()
            return {"A": a.id, "A1": a1.id, "pub": pub.id}

    return asyncio.run(_seed())


def test_nodes_roots_and_children_with_counts(client: TestClient) -> None:
    ids = _seed_tree(client)
    roots = client.get("/api/categories/nodes").json()
    root = next(r for r in roots if r["code"] == "CAT-A")
    assert root["level"] == 1 and root["child_count"] == 1 and root["map_count"] == 2
    children = client.get(f"/api/categories/nodes?parent_id={ids['A']}").json()
    assert [c["code"] for c in children] == ["CAT-A1"]
    assert children[0]["child_count"] == 0 and children[0]["map_count"] == 2


def test_category_maps_visibility_masking(
    client: TestClient, enforce: None
) -> None:
    ids = _seed_tree(client)
    act_as("cat.stranger")  # sysadmin 아님 + 권한 행 없음 → private 맵은 hidden으로 마스킹
    body = client.get(f"/api/categories/{ids['A1']}/maps").json()
    names = [m["name"] for m in body["maps"]]
    assert "framework pub map" in names
    assert body["total"] == 2 and body["hidden"] >= 1
    assert all(m["name"] != "framework private map" for m in body["maps"])
    # M-2: 이 엔드포인트도 다른 맵 응답과 동일하게 category_path를 주입해야 한다 (maps.py 패턴 대칭).
    assert body["maps"][0]["category_path"] == "구매/직접구매"


def test_map_out_exposes_category_fields(client: TestClient) -> None:
    ids = _seed_tree(client)
    detail = client.get(f"/api/maps/{ids['pub']}").json()
    assert detail["category_id"] is not None
    assert detail["category_path"] == "구매/직접구매"
    assert detail["consultant_code"] == "CAT-M1"
    assert "sp_input" in detail and "sp_output" in detail


def _seed_paging_category(client: TestClient) -> int:
    """L1 카테고리 1개 + private 맵 2·public 맵 1 직접 연결. 반환: category id.

    가시성 필터가 offset/limit보다 먼저 전체 집합에 적용되는지 검증하기 위한 시드 —
    비가시 맵이 페이지 창을 소모하면 안 된다(fix round 1, Important #1).
    """
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory, ProcessMap

    async def _seed() -> int:
        async with SessionLocal() as session:
            cat = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == "CAT-PG")
            )
            if cat is None:
                cat = ProcessCategory(code="CAT-PG", name="페이징", level=1, sort_order=0)
                session.add(cat)
                await session.flush()
            for code, name, visibility in (
                ("CAT-PG1", "paging private 1", "private"),
                ("CAT-PG2", "paging private 2", "private"),
                ("CAT-PG3", "paging public", "public"),
            ):
                existing = await session.scalar(
                    select(ProcessMap).where(ProcessMap.consultant_code == code)
                )
                if existing is None:
                    session.add(
                        ProcessMap(
                            name=name, visibility=visibility,
                            owner_id="cat.owner", created_by="cat.owner",
                            category_id=cat.id, consultant_code=code,
                        )
                    )
            await session.commit()
            return cat.id

    return asyncio.run(_seed())


def test_category_maps_visibility_filtered_before_pagination(
    client: TestClient, enforce: None
) -> None:
    category_id = _seed_paging_category(client)
    act_as("cat.stranger")  # sysadmin 아님 + 권한 행 없음 → private 2건은 hidden
    body = client.get(f"/api/categories/{category_id}/maps?limit=1").json()
    # limit=1이 비가시 맵에 먼저 소모되면 maps=[]가 된다 — 전체 집합에 필터 후 슬라이스해야
    # total은 전체(3), hidden은 페이지 무관 전체 비가시 수(2), maps는 가시 맵만 담는다.
    assert body["total"] == 3
    assert body["hidden"] == 2
    assert [m["name"] for m in body["maps"]] == ["paging public"]


def test_category_maps_missing_category_404(client: TestClient) -> None:
    assert client.get("/api/categories/999999/maps").status_code == 404


def test_category_chain_returns_root_to_self(client: TestClient) -> None:
    ids = _seed_tree(client)
    chain = client.get(f"/api/categories/{ids['A1']}/chain").json()
    assert [c["code"] for c in chain] == ["CAT-A", "CAT-A1"]


def test_category_chain_missing_category_404(client: TestClient) -> None:
    assert client.get("/api/categories/999999/chain").status_code == 404


def test_designation_saves_input_output(client: TestClient) -> None:
    ids = _seed_tree(client)
    resp = client.put(
        f"/api/maps/{ids['pub']}/subprocess-designation",
        json={"department": "Owning Anchor Division", "input": "PR 문서", "output": "PO 문서"},
    )
    assert resp.status_code == 200
    body = client.get(f"/api/maps/{ids['pub']}").json()
    assert body["sp_input"] == "PR 문서" and body["sp_output"] == "PO 문서"


def _seed_l5_slot(client: TestClient, ids: dict[str, int]) -> int:
    """A1 아래 L5 슬롯 카테고리 — 맵 슬롯 L5 전용 확정(2026-08-30)에 맞춘 배정 대상."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _seed() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == "CAT-A5")
            )
            if row is None:
                row = ProcessCategory(
                    code="CAT-A5", name="슬롯말단", level=5, parent_id=ids["A1"], sort_order=0
                )
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_seed())


def test_category_assign_and_unassign(client: TestClient) -> None:
    ids = _seed_tree(client)
    l5 = _seed_l5_slot(client, ids)
    created = client.post("/api/maps", json={
        "name": "framework assign target", "description": "",
        "owning_department": "Owning Anchor Division", "visibility": "public",
    }).json()
    mid = created["id"]
    # 비-L5 배정 차단 (2026-08-30 확정) — 상위 레벨엔 맵 슬롯이 없다
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": ids["A1"]}).status_code == 422
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": l5}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_path"] == "구매/직접구매/슬롯말단"
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": None}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_id"] is None
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": 999999}).status_code == 404


def test_framework_transfer_moves_slot(client: TestClient) -> None:
    ids = _seed_tree(client)
    l5 = _seed_l5_slot(client, ids)
    created = client.post("/api/maps", json={
        "name": "framework transfer target", "description": "",
        "owning_department": "Owning Anchor Division", "visibility": "public",
    }).json()
    target = created["id"]
    # 레거시 비-L5 슬롯(pub은 시드에서 A1/L2에 직결) — 이양 대신 정리 유도 409 (2026-08-30 보완)
    legacy = client.post(f"/api/maps/{ids['pub']}/framework-transfer", json={"to_map_id": target})
    assert legacy.status_code == 409
    assert "level-5" in legacy.json()["detail"]
    # L5로 재배정 후 이양 → 성공
    assert client.put(f"/api/maps/{ids['pub']}/category", json={"category_id": l5}).status_code == 200
    resp = client.post(f"/api/maps/{ids['pub']}/framework-transfer", json={"to_map_id": target})
    assert resp.status_code == 200
    src = client.get(f"/api/maps/{ids['pub']}").json()
    dst = client.get(f"/api/maps/{target}").json()
    assert src["category_id"] is None and src["consultant_code"] is None
    assert dst["category_path"] == "구매/직접구매/슬롯말단" and dst["consultant_code"] == "CAT-M1"
    # 재이양 시 source에 슬롯 없음 → 409
    assert client.post(f"/api/maps/{ids['pub']}/framework-transfer", json={"to_map_id": target}).status_code == 409


def test_category_put_non_owner_403(client: TestClient, enforce: None) -> None:
    """PUT /maps/{id}/category — public 맵은 비-owner라도 viewer 바닥값을 받지만 owner는 아니라 403."""
    ids = _seed_tree(client)
    act_as("cat.viewer_stranger")  # framework pub map: public visibility → viewer, grants 없음
    resp = client.put(f"/api/maps/{ids['pub']}/category", json={"category_id": ids["A1"]})
    assert resp.status_code == 403


def test_framework_transfer_target_not_owned_403(client: TestClient, enforce: None) -> None:
    """source는 owner(경로 의존성 통과)지만 target은 아닌 caller — inline assert_map_role(target) 배선 검증."""
    ids = _seed_tree(client)
    act_as("cat.src_owner")
    source = client.post("/api/maps", json={
        "name": "framework transfer src-only-owner",
        "owning_department": "Owning Anchor Division",
    }).json()
    sid = source["id"]
    assert client.put(f"/api/maps/{sid}/category", json={"category_id": _seed_l5_slot(client, ids)}).status_code == 200

    act_as("cat.tgt_owner")
    target = client.post("/api/maps", json={
        "name": "framework transfer tgt-only-owner",
        "owning_department": "Owning Anchor Division",
    }).json()
    tid = target["id"]

    act_as("cat.src_owner")  # source owner(경로 의존성 통과) — target은 owner도 grant도 없음
    resp = client.post(f"/api/maps/{sid}/framework-transfer", json={"to_map_id": tid})
    assert resp.status_code == 403
