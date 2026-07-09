"""소멸 부서(조직개편) 일괄 재지정 — GET 목록·POST 재지정·중복 병합 (2026-07-09)."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import MapPermission, ProcessMap, UserGroup, UserGroupMember
from app.settings import settings

SYS = {"X-Dev-User": "admin.kim"}
GONE = "Old Division/Old Office/Old Team"          # 현 조직에 없는 경로
LIVE = "Management Support Division/Procurement Office/Sourcing Team 1"  # 시드 실존 경로


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


async def _seed_refs(*, dup_role_on_live: str | None = None) -> tuple[int, int]:
    """소멸 경로를 참조하는 맵 권한 + 그룹 멤버 시드. dup가 있으면 같은 맵에 LIVE grant도 추가."""
    async with SessionLocal() as session:
        m = ProcessMap(name=f"remap target {id(object())}", visibility="private",
                       created_by="owner.u", owner_id="owner.u")
        session.add(m)
        g = UserGroup(name=f"remap group {id(object())}", status="active", created_by="owner.u")
        session.add(g)
        await session.flush()
        session.add(MapPermission(map_id=m.id, principal_type="department",
                                  principal_id=GONE, role="editor", granted_by="owner.u"))
        if dup_role_on_live:
            session.add(MapPermission(map_id=m.id, principal_type="department",
                                      principal_id=LIVE, role=dup_role_on_live, granted_by="owner.u"))
        session.add(UserGroupMember(group_id=g.id, member_type="department", member_id=GONE))
        await session.commit()
        return m.id, g.id


def test_remap_list_reports_missing_paths(client: TestClient) -> None:
    asyncio.run(_seed_refs())
    res = client.get("/api/admin/dept-remap", headers=SYS)
    assert res.status_code == 200
    row = next((r for r in res.json() if r["path"] == GONE), None)
    assert row is not None
    assert row["map_grants"] >= 1
    assert row["group_members"] >= 1
    # 실존 경로는 목록에 없어야 함
    assert all(r["path"] != LIVE for r in res.json())


def test_remap_moves_grants_and_group_members(client: TestClient) -> None:
    map_id, group_id = asyncio.run(_seed_refs())
    res = client.post(
        "/api/admin/dept-remap", headers=SYS, json={"from_path": GONE, "to_path": LIVE}
    )
    assert res.status_code == 200

    async def _check() -> tuple[list[tuple[str, str]], list[str]]:
        async with SessionLocal() as session:
            grants = [
                (p.principal_id, p.role)
                for p in (await session.scalars(
                    select(MapPermission).where(
                        MapPermission.map_id == map_id,
                        MapPermission.principal_type == "department",
                    )
                )).all()
            ]
            members = [
                gm.member_id
                for gm in (await session.scalars(
                    select(UserGroupMember).where(UserGroupMember.group_id == group_id)
                )).all()
            ]
            return grants, members

    grants, members = asyncio.run(_check())
    assert grants == [(LIVE, "editor")]
    assert members == [LIVE]


def test_remap_merges_duplicate_grant_keeping_higher_role(client: TestClient) -> None:
    # 같은 맵에 LIVE viewer가 이미 있고 GONE editor를 LIVE로 재지정 → 1행, 높은 역할(editor) 유지
    map_id, _ = asyncio.run(_seed_refs(dup_role_on_live="viewer"))
    res = client.post(
        "/api/admin/dept-remap", headers=SYS, json={"from_path": GONE, "to_path": LIVE}
    )
    assert res.status_code == 200

    async def _grants() -> list[tuple[str, str]]:
        async with SessionLocal() as session:
            return [
                (p.principal_id, p.role)
                for p in (await session.scalars(
                    select(MapPermission).where(
                        MapPermission.map_id == map_id,
                        MapPermission.principal_type == "department",
                    )
                )).all()
            ]

    assert asyncio.run(_grants()) == [(LIVE, "editor")]


def test_remap_rejects_unknown_target_and_requires_sysadmin(
    client: TestClient, sysadmin_enforced: None
) -> None:
    res = client.post(
        "/api/admin/dept-remap", headers=SYS,
        json={"from_path": GONE, "to_path": "Nope/Nowhere"},
    )
    assert res.status_code == 422
    res2 = client.post(
        "/api/admin/dept-remap", headers={"X-Dev-User": "user.lee"},
        json={"from_path": GONE, "to_path": LIVE},
    )
    assert res2.status_code == 403
