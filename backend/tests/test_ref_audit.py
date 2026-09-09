"""고아 참조 감사 — 스캔(부서 5곳·사용자 7곳)·remap·notify·stale_ref_count (design 2026-09-09)."""

import asyncio
import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

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


async def _seed_user_refs() -> dict[str, int]:
    """퇴직자(gone.user, active=False)·미등록(nobody) 참조 + 이름 기반(SP 담당자·노드 담당자)."""
    from app.models import CategoryPermission, MapApprover, ProcessCategory

    async with SessionLocal() as session:
        if await session.get(Employee, "gone.user") is None:
            session.add(Employee(login_id="gone.user", name="Gone Person", source="local", active=False,
                                 org_l1="Management Support Division", department="Procurement Office"))
        m = await _new_map(session, "user refs", owning_department=LIVE,
                           sp_department=LIVE_LEAF, sp_assignee="Minjae Lee, Gone Person")
        m.owner_id = "gone.user"
        g = UserGroup(name=f"user group {id(object())}", status="active", created_by="user.lee")
        # code는 unique 컬럼 — id(object())는 CPython이 즉시 재활용해 두 번째 호출과 충돌 가능(전체 스위트에서 실측)
        cat = ProcessCategory(code=f"REF-{uuid.uuid4().hex}", name="Ref Cat", level=1)
        session.add_all([g, cat])
        await session.flush()
        session.add_all([
            MapPermission(map_id=m.id, principal_type="user", principal_id="gone.user", role="owner", granted_by="user.lee"),
            MapPermission(map_id=m.id, principal_type="user", principal_id="nobody", role="viewer", granted_by="user.lee"),
            MapApprover(map_id=m.id, user_id="gone.user"),
            UserGroupMember(group_id=g.id, member_type="user", member_id="gone.user"),
            CategoryPermission(category_id=cat.id, principal_type="user", principal_id="gone.user", granted_by="user.lee"),
        ])
        pub = MapVersion(map_id=m.id, label="pub", status="published")
        session.add(pub)
        await session.flush()
        session.add_all([
            Node(id=f"a1-{pub.id}", version_id=pub.id, title="a1", assignee="Gone Person, Minjae Lee"),
            Node(id=f"a2-{pub.id}", version_id=pub.id, title="a2", assignee="Gone Person"),
        ])
        await session.commit()
        return {"map": m.id, "group": g.id, "cat": cat.id, "pub": pub.id}


def test_scan_user_refs_reports_logins_and_names(client: TestClient) -> None:
    ids = asyncio.run(_seed_user_refs())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_user_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    gone = [ln for ln in _lines(groups, "gone.user")
            if ln.map_id == ids["map"] or ln.group_id == ids["group"] or ln.category_id == ids["cat"]]
    assert sorted(ln.source for ln in gone) == [
        "category_perm", "group_user", "map_approver", "map_collab", "map_owner",
    ]
    owner = next(ln for ln in gone if ln.source == "map_owner")
    assert owner.target_id == f"map_owner:{ids['map']}" and owner.owner_id == "gone.user"
    assert next(ln for ln in gone if ln.source == "category_perm").category_name == "Ref Cat"
    assert next(g for g in groups if g.value == "gone.user").value_kind == "login"
    # 행 없는 login도 고아
    nobody = [ln for ln in _lines(groups, "nobody") if ln.map_id == ids["map"]]
    assert [ln.source for ln in nobody] == ["map_collab"]
    # 이름 기반 — SP 담당자 1 + 노드 담당자(게시본 2노드)
    names = [ln for ln in _lines(groups, "Gone Person") if ln.map_id == ids["map"]]
    by_source = {ln.source: ln for ln in names}
    assert by_source["sp_assignee"].fixable and by_source["sp_assignee"].target_id == f"sp_assignee:{ids['map']}"
    assert by_source["node_assignee"].count == 2 and not by_source["node_assignee"].fixable
    assert next(g for g in groups if g.value == "Gone Person").value_kind == "name"
    assert all(g.value != "Minjae Lee" for g in groups)


def test_scan_refs_returns_both_sections(client: TestClient) -> None:
    asyncio.run(_seed_dept_refs())
    asyncio.run(_seed_user_refs())

    async def _run() -> tuple[list[ref_audit.RefGroup], list[ref_audit.RefGroup]]:
        async with SessionLocal() as session:
            return await ref_audit.scan_refs(session)

    depts, users = asyncio.run(_run())
    assert any(g.value == GONE for g in depts) and all(g.kind == "dept" for g in depts)
    assert any(g.value == "gone.user" for g in users) and all(g.kind == "user" for g in users)


def test_count_stale_refs_by_map(client: TestClient) -> None:
    dept_ids = asyncio.run(_seed_dept_refs())
    user_ids = asyncio.run(_seed_user_refs())

    async def _run() -> dict[int, int]:
        async with SessionLocal() as session:
            maps = [await session.get(ProcessMap, dept_ids["map"]), await session.get(ProcessMap, user_ids["map"])]
            return await ref_audit.count_stale_refs_by_map(
                session, maps,
                {dept_ids["map"]: [dept_ids["pub"], dept_ids["draft"]], user_ids["map"]: [user_ids["pub"]]},
            )

    counts = asyncio.run(_run())
    # dept map: 노드 부서 2(pub)+1(draft) + SP 부서 1 = 4
    assert counts[dept_ids["map"]] == 4
    # user map: 노드 담당자 2 + SP 담당자 1 = 3 (오너·협업자는 오너 액션 대상 아님)
    assert counts[user_ids["map"]] == 3


def test_get_ref_audit_requires_sysadmin_and_returns_sections(
    client: TestClient, sysadmin_enforced: None
) -> None:
    ids = asyncio.run(_seed_dept_refs())
    res = client.get("/api/admin/ref-audit", headers=SYS)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"departments", "users", "generated_at"}
    group = next(g for g in body["departments"] if g["value"] == GONE)
    assert group["kind"] == "dept" and group["value_kind"] == "path"
    line = next(ln for ln in group["lines"] if ln["map_id"] == ids["map"] and ln["source"] == "map_grant")
    assert line["fixable"] is True and line["target_id"].startswith("map_grant:")
    assert client.get("/api/admin/ref-audit", headers={"X-Dev-User": "user.lee"}).status_code == 403
    assert client.get("/api/admin/dept-remap", headers=SYS).status_code in (404, 405)


def test_scan_user_refs_skips_blank_logins(client: TestClient) -> None:
    """빈 로그인 값은 고아가 아니다 — 5개 login 소스 전부에 빈 principal_id/user_id/member_id가 있어도 미노출."""
    from app.models import CategoryPermission, MapApprover, ProcessCategory

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            m = await _new_map(session, "blank logins")
            m.owner_id = ""
            g = UserGroup(name=f"blank user group {id(object())}", status="active", created_by="user.lee")
            cat = ProcessCategory(code=f"REF-{uuid.uuid4().hex}", name="Blank Cat", level=1)
            session.add_all([g, cat])
            await session.flush()
            session.add_all([
                MapPermission(map_id=m.id, principal_type="user", principal_id="", role="viewer", granted_by="user.lee"),
                MapApprover(map_id=m.id, user_id=""),
                UserGroupMember(group_id=g.id, member_type="user", member_id=""),
                CategoryPermission(category_id=cat.id, principal_type="user", principal_id="", granted_by="user.lee"),
            ])
            await session.commit()
            return {"map": m.id, "group": g.id, "cat": cat.id}

    ids = asyncio.run(_seed())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_user_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    assert all(g.value != "" for g in groups)
    assert all(
        ln.map_id != ids["map"] and ln.group_id != ids["group"] and ln.category_id != ids["cat"]
        for g in groups for ln in g.lines
    )


def _remap(client: TestClient, **body) -> object:
    return client.post("/api/admin/ref-audit/remap", headers=SYS, json=body)


def test_remap_dept_replace_moves_checked_lines_only(client: TestClient) -> None:
    ids = asyncio.run(_seed_dept_refs())

    async def _grant_id() -> int:
        async with SessionLocal() as session:
            return (await session.scalar(select(MapPermission.id).where(
                MapPermission.map_id == ids["map"], MapPermission.principal_id == GONE)))

    grant_id = asyncio.run(_grant_id())
    res = _remap(client, kind="dept", from_value=GONE, mode="replace", to_value=LIVE,
                 target_ids=[f"map_grant:{grant_id}", f"owning_dept:{ids['map']}"])
    assert res.status_code == 200, res.text
    assert res.json() == {"applied": {"map_grant": 1, "owning_dept": 1}, "skipped": []}

    async def _check() -> tuple[str | None, list[str], list[str]]:
        async with SessionLocal() as session:
            m = await session.get(ProcessMap, ids["map"])
            grants = list((await session.scalars(select(MapPermission.principal_id).where(
                MapPermission.map_id == ids["map"], MapPermission.principal_type == "department"))).all())
            members = list((await session.scalars(select(UserGroupMember.member_id).where(
                UserGroupMember.group_id == ids["group"]))).all())
            return m.owning_department, grants, members

    owning, grants, members = asyncio.run(_check())
    assert owning == LIVE and grants == [LIVE]
    assert members == [GONE]  # 체크 안 한 그룹 멤버는 그대로


def test_remap_merges_duplicate_grant_keeping_higher_role(client: TestClient) -> None:
    async def _seed() -> tuple[int, int]:
        async with SessionLocal() as session:
            m = await _new_map(session, "merge", owning_department=LIVE)
            gone = MapPermission(map_id=m.id, principal_type="department", principal_id=GONE,
                                 role="editor", granted_by="user.lee")
            session.add_all([gone, MapPermission(map_id=m.id, principal_type="department",
                                                 principal_id=LIVE, role="viewer", granted_by="user.lee")])
            await session.commit()
            return m.id, gone.id

    map_id, gone_id = asyncio.run(_seed())
    res = _remap(client, kind="dept", from_value=GONE, to_value=LIVE, target_ids=[f"map_grant:{gone_id}"])
    assert res.status_code == 200

    async def _grants() -> list[tuple[str, str]]:
        async with SessionLocal() as session:
            return [(p.principal_id, p.role) for p in (await session.scalars(select(MapPermission).where(
                MapPermission.map_id == map_id, MapPermission.principal_type == "department"))).all()]

    assert asyncio.run(_grants()) == [(LIVE, "editor")]


def test_remap_sp_dept_writes_leaf_and_stamps(client: TestClient) -> None:
    ids = asyncio.run(_seed_dept_refs())
    res = _remap(client, kind="dept", from_value=GONE_LEAF, to_value=LIVE, target_ids=[f"sp_dept:{ids['map']}"])
    assert res.status_code == 200 and res.json()["applied"] == {"sp_dept": 1}

    async def _check() -> tuple[str | None, str | None]:
        async with SessionLocal() as session:
            m = await session.get(ProcessMap, ids["map"])
            return m.sp_department, m.sp_changed_by

    assert asyncio.run(_check()) == (LIVE_LEAF, "admin.kim")


def test_remap_rejections(client: TestClient, sysadmin_enforced: None) -> None:
    ids = asyncio.run(_seed_dept_refs())
    # 노드 소스는 불가
    assert _remap(client, kind="dept", from_value=GONE_LEAF, to_value=LIVE,
                  target_ids=[f"node_dept:{ids['pub']}"]).status_code == 422
    # 미존재 대상 경로
    assert _remap(client, kind="dept", from_value=GONE, to_value="Nope/Nowhere",
                  target_ids=[f"owning_dept:{ids['map']}"]).status_code == 422
    # 오우닝·SP 부서는 remove 불가
    assert _remap(client, kind="dept", from_value=GONE, mode="remove",
                  target_ids=[f"owning_dept:{ids['map']}"]).status_code == 422
    assert _remap(client, kind="dept", from_value=GONE_LEAF, mode="remove",
                  target_ids=[f"sp_dept:{ids['map']}"]).status_code == 422
    # 비 sysadmin
    assert client.post("/api/admin/ref-audit/remap", headers={"X-Dev-User": "user.lee"},
                       json={"kind": "dept", "from_value": GONE, "to_value": LIVE,
                             "target_ids": [f"owning_dept:{ids['map']}"]}).status_code == 403
    # 값이 이미 바뀐 라인은 skipped
    res = _remap(client, kind="dept", from_value="Some/Other", to_value=LIVE,
                 target_ids=[f"owning_dept:{ids['map']}"])
    assert res.status_code == 200 and res.json() == {"applied": {}, "skipped": [f"owning_dept:{ids['map']}"]}


def test_remap_user_replace_owner_and_others(client: TestClient) -> None:
    ids = asyncio.run(_seed_user_refs())

    async def _targets() -> list[str]:
        async with SessionLocal() as session:
            collab = await session.scalar(select(MapPermission.id).where(
                MapPermission.map_id == ids["map"], MapPermission.principal_id == "gone.user"))
            member = await session.scalar(select(UserGroupMember.id).where(
                UserGroupMember.group_id == ids["group"], UserGroupMember.member_id == "gone.user"))
            from app.models import CategoryPermission
            perm = await session.scalar(select(CategoryPermission.id).where(
                CategoryPermission.category_id == ids["cat"], CategoryPermission.principal_id == "gone.user"))
            return [f"map_owner:{ids['map']}", f"map_collab:{collab}", f"map_approver:{ids['map']}",
                    f"group_user:{member}", f"category_perm:{perm}", f"sp_assignee:{ids['map']}"]

    targets = asyncio.run(_targets())
    # sp_assignee는 이름 그룹("Gone Person")이라 별도 요청 — login 그룹 요청에 섞이면 skipped
    res = _remap(client, kind="user", from_value="gone.user", to_value="user.park", target_ids=targets)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] == {"map_owner": 1, "map_approver": 1, "group_user": 1, "category_perm": 1}
    # 오너 grant는 map_owner 절차가 처리 → map_collab 라인은 skipped, sp_assignee는 값 불일치로 skipped
    assert sorted(body["skipped"]) == sorted([targets[1], targets[5]])

    async def _check() -> dict:
        from app.models import CategoryPermission, MapApprover, Notification
        async with SessionLocal() as session:
            m = await session.get(ProcessMap, ids["map"])
            grants = [(p.principal_id, p.role) for p in (await session.scalars(select(MapPermission).where(
                MapPermission.map_id == ids["map"], MapPermission.principal_type == "user"))).all()]
            approvers = list((await session.scalars(select(MapApprover.user_id).where(
                MapApprover.map_id == ids["map"]))).all())
            members = list((await session.scalars(select(UserGroupMember.member_id).where(
                UserGroupMember.group_id == ids["group"]))).all())
            perms = list((await session.scalars(select(CategoryPermission.principal_id).where(
                CategoryPermission.category_id == ids["cat"]))).all())
            notif = (await session.scalars(select(Notification).where(
                Notification.recipient == "user.park", Notification.type == "owner_assigned",
                Notification.map_id == ids["map"]))).first()
            return {"owner": m.owner_id, "pending": m.consultant_owner_pending, "grants": sorted(grants),
                    "approvers": approvers, "members": members, "perms": perms,
                    "notif": notif.payload if notif else None}

    got = asyncio.run(_check())
    assert got["owner"] == "user.park" and got["pending"] is False
    assert got["grants"] == [("nobody", "viewer"), ("user.park", "owner")]
    assert got["approvers"] == ["user.park"] and got["members"] == ["user.park"] and got["perms"] == ["user.park"]
    assert got["notif"]["map_name"] and got["notif"]["actor"] == "admin.kim"
    assert got["notif"]["from_name"] == "Gone Person"

    # 이름 그룹: SP 담당자 치환 — to_value는 login, 저장은 그 직원의 name
    res = _remap(client, kind="user", from_value="Gone Person", to_value="user.park",
                 target_ids=[f"sp_assignee:{ids['map']}"])
    assert res.status_code == 200 and res.json()["applied"] == {"sp_assignee": 1}

    async def _sp() -> str | None:
        async with SessionLocal() as session:
            return (await session.get(ProcessMap, ids["map"])).sp_assignee

    assert asyncio.run(_sp()) == "Minjae Lee, Soyeon Park"


def test_remap_user_remove_and_owner_guard(client: TestClient) -> None:
    ids = asyncio.run(_seed_user_refs())

    async def _collab_id() -> int:
        async with SessionLocal() as session:
            return await session.scalar(select(MapPermission.id).where(
                MapPermission.map_id == ids["map"], MapPermission.principal_id == "nobody"))

    collab = asyncio.run(_collab_id())
    assert _remap(client, kind="user", from_value="gone.user", mode="remove",
                  target_ids=[f"map_owner:{ids['map']}"]).status_code == 422
    assert _remap(client, kind="user", from_value="gone.user", to_value="ghost.person",
                  target_ids=[f"map_approver:{ids['map']}"]).status_code == 422  # active 아닌 대상
    res = _remap(client, kind="user", from_value="nobody", mode="remove",
                 target_ids=[f"map_collab:{collab}", f"map_approver:{ids['map']}"])
    assert res.status_code == 200
    assert res.json() == {"applied": {"map_collab": 1}, "skipped": [f"map_approver:{ids['map']}"]}
    res = _remap(client, kind="user", from_value="Gone Person", mode="remove",
                 target_ids=[f"sp_assignee:{ids['map']}"])
    assert res.status_code == 200 and res.json()["applied"] == {"sp_assignee": 1}

    async def _sp() -> str | None:
        async with SessionLocal() as session:
            return (await session.get(ProcessMap, ids["map"])).sp_assignee

    assert asyncio.run(_sp()) == "Minjae Lee"


def test_notify_bundles_per_owner_and_skips_departed_owner(client: TestClient) -> None:
    dept_ids = asyncio.run(_seed_dept_refs())   # 오너 user.lee — 노드 부서 pub 2 + draft 1, SP 부서 1
    user_ids = asyncio.run(_seed_user_refs())   # 오너 gone.user(퇴직) — 노드 담당자 2
    res = client.post("/api/admin/ref-audit/notify", headers=SYS, json={"target_ids": [
        f"node_dept:{dept_ids['pub']}", f"node_dept:{dept_ids['draft']}", f"sp_dept:{dept_ids['map']}",
        f"node_assignee:{user_ids['pub']}",
    ]})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recipients"] == 1 and body["maps"] == 1
    assert body["skipped_maps"] == [{"id": user_ids["map"], "name": body["skipped_maps"][0]["name"], "reason": "owner_missing"}]

    async def _notif() -> dict | None:
        from app.models import Notification

        async with SessionLocal() as session:
            rows = (await session.scalars(select(Notification).where(
                Notification.recipient == "user.lee", Notification.type == "ref_fix_requested"
            ).order_by(Notification.id.desc()))).all()
            return rows[0].payload if rows else None

    payload = asyncio.run(_notif())
    assert payload is not None and payload["actor"] == "admin.kim" and payload["count"] == 1
    entry = next(e for e in payload["maps"] if e["id"] == dept_ids["map"])
    assert entry == {"id": dept_ids["map"], "name": entry["name"], "node_dept": 3, "node_assignee": 0,
                     "sp_dept": 1, "sp_assignee": 0}
    # 오너 액션 대상이 아닌 소스는 422
    assert client.post("/api/admin/ref-audit/notify", headers=SYS,
                       json={"target_ids": [f"owning_dept:{dept_ids['map']}"]}).status_code == 422
