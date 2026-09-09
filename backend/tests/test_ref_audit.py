"""고아 참조 감사 — 스캔(부서 5곳·사용자 7곳)·remap·notify·stale_ref_count (design 2026-09-09)."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app import ref_audit
from app.db import SessionLocal
from app.models import (
    Employee,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.settings import settings

SYS = {"X-Dev-User": "admin.kim"}
GONE = "Old Division/Old Office/Old Team"
GONE_LEAF = "Old Team"
LIVE = "Management Support Division/Procurement Office/Sourcing Team 1"
LIVE_LEAF = "Sourcing Team 1"


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


async def _new_map(session, name: str, **kw) -> ProcessMap:
    m = ProcessMap(name=f"{name} {id(object())}", visibility="private",
                   created_by="user.lee", owner_id="user.lee", **kw)
    session.add(m)
    await session.flush()
    return m


async def _seed_dept_refs() -> dict[str, int]:
    """소멸 경로 참조 3곳(권한·그룹·오우닝) + 리프 2곳(SP 부서·노드 부서: 게시본+드래프트+구 드래프트)."""
    async with SessionLocal() as session:
        m = await _new_map(session, "dept refs", owning_department=GONE, sp_department=GONE_LEAF)
        g = UserGroup(name=f"ref group {id(object())}", status="active", created_by="user.lee")
        session.add(g)
        await session.flush()
        session.add(MapPermission(map_id=m.id, principal_type="department",
                                  principal_id=GONE, role="editor", granted_by="user.lee"))
        session.add(UserGroupMember(group_id=g.id, member_type="department", member_id=GONE))
        old = MapVersion(map_id=m.id, label="old", status="draft")
        pub = MapVersion(map_id=m.id, label="pub", status="published")
        draft = MapVersion(map_id=m.id, label="draft", status="draft")
        session.add_all([old, pub, draft])
        await session.flush()
        session.add_all([
            Node(id=f"o1-{old.id}", version_id=old.id, title="old", department=GONE_LEAF),
            Node(id=f"p1-{pub.id}", version_id=pub.id, title="p1", department=GONE_LEAF),
            Node(id=f"p2-{pub.id}", version_id=pub.id, title="p2", department=GONE_LEAF),
            Node(id=f"p3-{pub.id}", version_id=pub.id, title="p3", department=LIVE_LEAF),
            Node(id=f"d1-{draft.id}", version_id=draft.id, title="d1", department=GONE_LEAF),
            Node(id=f"d2-{draft.id}", version_id=draft.id, title="d2", department=""),
        ])
        await session.commit()
        return {"map": m.id, "group": g.id, "old": old.id, "pub": pub.id, "draft": draft.id}


def _lines(groups: list[ref_audit.RefGroup], value: str) -> list[ref_audit.RefLine]:
    return next((g.lines for g in groups if g.value == value), [])


def test_valid_sets_cover_paths_leaves_users_names(client: TestClient) -> None:
    # 자체 시드 비활성 직원 사용 — conftest의 owning.anchor/"Owning Anchor Division"은
    # test_interview_api.py가 같은 부서명으로 active=True 앵커를 커밋해(세션 공유 DB) 전체
    # 스위트 실행 순서에서 오염될 수 있다.
    inactive_login = f"inactive.{id(object())}"
    inactive_dept = f"Retired Division {inactive_login}"

    async def _run() -> ref_audit.ValidSets:
        async with SessionLocal() as session:
            session.add(Employee(login_id=inactive_login, name="Retired Person", source="local",
                                  active=False, org_l1=inactive_dept, department=inactive_dept))
            await session.commit()
            return await ref_audit.load_valid_sets(session)

    valid = asyncio.run(_run())
    assert LIVE in valid.dept_paths
    assert {"Management Support Division", "Procurement Office", LIVE_LEAF} <= valid.dept_leaves
    assert "user.lee" in valid.user_ids
    assert "Minjae Lee" in valid.user_names
    # active=False 직원의 org는 유효 집합에 없다
    assert inactive_dept not in valid.dept_leaves
    assert inactive_login not in valid.user_ids


def test_split_names() -> None:
    assert ref_audit.split_names("Minjae Lee, Gone Person ,") == ["Minjae Lee", "Gone Person"]
    assert ref_audit.split_names(None) == []
    assert ref_audit.split_names("") == []


def test_scan_dept_refs_reports_paths_and_leaves_in_scope(client: TestClient) -> None:
    ids = asyncio.run(_seed_dept_refs())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_dept_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    path_lines = [ln for ln in _lines(groups, GONE) if ln.map_id == ids["map"] or ln.group_id == ids["group"]]
    sources = sorted(ln.source for ln in path_lines)
    assert sources == ["group_member", "map_grant", "owning_dept"]
    assert all(ln.fixable for ln in path_lines)
    grant = next(ln for ln in path_lines if ln.source == "map_grant")
    assert grant.target_id.startswith("map_grant:") and grant.map_name and grant.owner_id == "user.lee"
    assert grant.owner_name == "Minjae Lee"
    group_line = next(ln for ln in path_lines if ln.source == "group_member")
    assert group_line.group_id == ids["group"] and group_line.group_name

    leaf_lines = [ln for ln in _lines(groups, GONE_LEAF) if ln.map_id == ids["map"]]
    by_source = {(ln.source, ln.version_status): ln for ln in leaf_lines}
    assert ("sp_dept", None) in by_source and by_source[("sp_dept", None)].fixable
    assert by_source[("node_dept", "published")].count == 2
    assert by_source[("node_dept", "published")].version_id == ids["pub"]
    assert by_source[("node_dept", "draft")].count == 1
    assert by_source[("node_dept", "draft")].version_id == ids["draft"]
    assert not by_source[("node_dept", "draft")].fixable
    # 구 드래프트(old)는 범위 밖 — 최신 드래프트만
    assert all(ln.version_id != ids["old"] for ln in leaf_lines)
    # 실존 경로·리프는 목록에 없다
    assert all(g.value not in (LIVE, LIVE_LEAF) for g in groups)
    # value_kind
    assert next(g for g in groups if g.value == GONE).value_kind == "path"
    assert next(g for g in groups if g.value == GONE_LEAF).value_kind == "leaf"


def test_scan_dept_refs_soft_deleted_map_only_owning(client: TestClient) -> None:
    from app.clock import now as now_kst

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = await _new_map(session, "deleted map", owning_department=GONE,
                               sp_department=GONE_LEAF, deleted_at=now_kst())
            v = MapVersion(map_id=m.id, label="pub", status="published")
            session.add(v)
            await session.flush()
            session.add(Node(id=f"x-{v.id}", version_id=v.id, title="x", department=GONE_LEAF))
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_dept_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    mine = [ln for g in groups for ln in g.lines if ln.map_id == map_id]
    assert [ln.source for ln in mine] == ["owning_dept"]


def test_scan_dept_refs_skips_blank_principal(client: TestClient) -> None:
    """빈 부서 값은 고아가 아니다 — map_grant/group_member에 빈 principal_id/member_id가 있어도 value="" 그룹 미생성."""

    async def _seed() -> None:
        async with SessionLocal() as session:
            m = await _new_map(session, "blank principal")
            g = UserGroup(name=f"blank group {id(object())}", status="active", created_by="user.lee")
            session.add(g)
            await session.flush()
            session.add(MapPermission(map_id=m.id, principal_type="department",
                                      principal_id="", role="editor", granted_by="user.lee"))
            session.add(UserGroupMember(group_id=g.id, member_type="department", member_id=""))
            await session.commit()

    asyncio.run(_seed())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_dept_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    assert all(g.value != "" for g in groups)
