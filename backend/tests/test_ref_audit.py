"""고아 참조 감사 스캔 — 부서 5곳·사용자 7곳·노드 줄·stale_ref_count (design 2026-09-09). 적용은 test_ref_audit_apply."""

import asyncio
import uuid

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

SYS = {"X-Dev-User": "admin.kim"}
GONE = "Old Division/Old Office/Old Team"
GONE_LEAF = "Old Team"
LIVE = "Management Support Division/Procurement Office/Sourcing Team 1"
LIVE_LEAF = "Sourcing Team 1"


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


async def _seed_node_versions(spec: list[tuple[str, list[str]]], **version_kw) -> tuple[int, list[int]]:
    """맵 하나에 (상태, 노드 부서 목록)을 순서대로 버전으로 만든다 → (map_id, version_ids)."""
    async with SessionLocal() as session:
        m = await _new_map(session, "node lines", owning_department=LIVE)
        version_ids: list[int] = []
        for status, departments in spec:
            version = MapVersion(map_id=m.id, label=status, status=status, **version_kw.get(status, {}))
            session.add(version)
            await session.flush()
            session.add_all(
                Node(id=f"nl-{version.id}-{i}", version_id=version.id, title=f"n{i}", department=department)
                for i, department in enumerate(departments)
            )
            version_ids.append(version.id)
        await session.commit()
        return m.id, version_ids


def _scan_node_dept_lines(map_id: int) -> list[ref_audit.RefLine]:
    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_dept_refs(session, valid, ctx)

    return [ln for g in asyncio.run(_run()) for ln in g.lines if ln.map_id == map_id and ln.source == "node_dept"]


def test_node_lines_one_per_map_targeting_working_version(client: TestClient) -> None:
    """게시본 2 + Draft 1에 낡은 부서가 있어도 줄은 맵당 1개 — 고칠 대상은 Draft, 곳 수도 Draft 기준."""
    map_id, (pub_id, draft_id) = asyncio.run(_seed_node_versions([
        ("published", [GONE_LEAF, GONE_LEAF, LIVE_LEAF]),
        ("draft", [GONE_LEAF, ""]),
    ]))

    lines = _scan_node_dept_lines(map_id)

    assert len(lines) == 1
    line = lines[0]
    assert line.target_id == f"node_dept:{map_id}"
    assert line.version_id == draft_id and line.version_status == "draft"
    assert line.count == 1
    assert line.pending is False and line.working_status == "draft"
    assert line.from_value == GONE_LEAF


def test_node_line_pending_when_only_published_has_value(client: TestClient) -> None:
    """Draft는 이미 고쳐져 있고 게시본에만 낡은 값이 남으면 게시 대기 — 게시본 기준 곳 수."""
    map_id, (pub_id, draft_id) = asyncio.run(_seed_node_versions([
        ("published", [GONE_LEAF, GONE_LEAF]),
        ("draft", [LIVE_LEAF]),
    ]))

    (line,) = _scan_node_dept_lines(map_id)

    assert line.pending is True
    assert line.version_id == pub_id and line.version_status == "published"
    assert line.count == 2
    assert line.target_id == f"node_dept:{map_id}"
    assert line.working_status == "draft"


def test_node_line_without_working_version_is_not_pending(client: TestClient) -> None:
    """작업본이 아예 없는 맵(최신=게시본)은 게시 대기가 아니라 게시본에 낡은 값이 있는 일반 줄이다."""
    map_id, (pub_id, expired_id) = asyncio.run(_seed_node_versions([
        ("published", [GONE_LEAF]),
        ("expired", [GONE_LEAF, GONE_LEAF]),  # 만료본은 스캔 대상이 아니다
    ]))

    (line,) = _scan_node_dept_lines(map_id)

    assert line.pending is False
    assert line.version_id == pub_id and line.count == 1
    assert line.working_status is None and line.checked_out_by is None


def test_node_line_includes_approved_working_version(client: TestClient) -> None:
    """승인 완료·게시 전(APPROVED) 작업본이 스캔에서 빠져 고아 참조가 숨던 빈틈."""
    map_id, (pub_id, approved_id) = asyncio.run(_seed_node_versions([
        ("published", [LIVE_LEAF]),
        ("approved", [GONE_LEAF]),
    ]))

    (line,) = _scan_node_dept_lines(map_id)

    assert line.version_id == approved_id
    assert line.working_status == "approved" and line.pending is False
    assert line.count == 1


def test_node_line_carries_holder_of_working_version(client: TestClient) -> None:
    map_id, (_pub_id, draft_id) = asyncio.run(_seed_node_versions(
        [("published", [LIVE_LEAF]), ("draft", [GONE_LEAF])],
        draft={"checked_out_by": "user.park"},
    ))

    (line,) = _scan_node_dept_lines(map_id)

    assert line.version_id == draft_id and line.checked_out_by == "user.park"


def test_load_target_versions_includes_approved(client: TestClient) -> None:
    map_id, (pub_id, approved_id) = asyncio.run(_seed_node_versions([
        ("published", [LIVE_LEAF]),
        ("approved", [LIVE_LEAF]),
    ]))

    async def _run() -> dict[int, list[tuple[int, str]]]:
        async with SessionLocal() as session:
            return await ref_audit.load_target_versions(session)

    assert asyncio.run(_run())[map_id] == [(pub_id, "published"), (approved_id, "draft")]


def test_load_node_targets_picks_published_and_working(client: TestClient) -> None:
    """working = 최신 버전이 진행 중 상태일 때 그 버전. 확정 스냅샷은 최신 판정에서 빠진다."""
    working_map, (pub_id, draft_id, _confirmed_id) = asyncio.run(_seed_node_versions(
        [("published", []), ("draft", []), ("confirmed", [])],
        draft={"checked_out_by": "user.park"},
    ))
    settled_map, (settled_pub_id,) = asyncio.run(_seed_node_versions([("published", [])]))
    expired_only_map, _ = asyncio.run(_seed_node_versions([("expired", [])]))

    async def _run() -> dict[int, ref_audit.NodeTarget]:
        async with SessionLocal() as session:
            return await ref_audit.load_node_targets(session)

    targets = asyncio.run(_run())
    assert targets[working_map] == ref_audit.NodeTarget(
        map_id=working_map, published_id=pub_id, working_id=draft_id,
        working_status="draft", checked_out_by="user.park",
    )
    assert targets[settled_map] == ref_audit.NodeTarget(
        map_id=settled_map, published_id=settled_pub_id, working_id=None,
        working_status=None, checked_out_by=None,
    )
    assert expired_only_map not in targets


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
    grant = next(ln for ln in path_lines if ln.source == "map_grant")
    assert grant.target_id.startswith("map_grant:") and grant.map_name and grant.owner_id == "user.lee"
    assert grant.owner_name == "Minjae Lee"
    group_line = next(ln for ln in path_lines if ln.source == "group_member")
    assert group_line.group_id == ids["group"] and group_line.group_name

    leaf_lines = [ln for ln in _lines(groups, GONE_LEAF) if ln.map_id == ids["map"]]
    by_source = {ln.source: ln for ln in leaf_lines}
    assert sorted(by_source) == ["node_dept", "sp_dept"]  # 노드 줄은 맵당 1개
    # 게시본(2)과 최신 드래프트(1)에 모두 있으면 드래프트 기준 한 줄
    node = by_source["node_dept"]
    assert node.target_id == f"node_dept:{ids['map']}"
    assert node.count == 1 and node.version_id == ids["draft"] and node.version_status == "draft"
    assert not node.pending
    # 구 드래프트(old)는 범위 밖 — 최신 드래프트만
    assert all(ln.version_id != ids["old"] for ln in leaf_lines)
    # 모든 소스의 줄이 그룹 값을 from_value로 갖는다
    assert all(ln.from_value == GONE for ln in path_lines)
    assert all(ln.from_value == GONE_LEAF for ln in leaf_lines)
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
    # 이름 기반 — SP 담당자 1 + 노드 담당자(작업본 없이 게시본 2노드 → 게시본에 한 줄)
    names = [ln for ln in _lines(groups, "Gone Person") if ln.map_id == ids["map"]]
    by_source = {ln.source: ln for ln in names}
    assert by_source["sp_assignee"].target_id == f"sp_assignee:{ids['map']}"
    node = by_source["node_assignee"]
    assert node.count == 2
    assert node.target_id == f"node_assignee:{ids['map']}"
    assert node.version_id == ids["pub"] and node.version_status == "published" and not node.pending
    assert all(ln.from_value == "Gone Person" for ln in names)
    assert all(ln.from_value == "gone.user" for ln in gone)
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


def test_list_maps_stale_ref_count_covers_published_and_working_versions(client: TestClient) -> None:
    """홈 배지(GET /api/maps)는 게시본과 작업본(승인 완료 포함)의 낡은 참조를 각각 센다.

    published v1(낡은 부서 1건) + approved v2(낡은 부서 1건). APPROVED 작업본은 스캔 대상에서
    빠져 있었다(2026-10-23) — 감사 스캔과 같은 대상 정의(`load_target_versions`)를 쓴다.
    """
    async def _seed() -> int:
        async with SessionLocal() as session:
            m = await _new_map(session, f"scope-parity-{uuid.uuid4().hex}", owning_department=LIVE)
            v1 = MapVersion(map_id=m.id, label="v1", status="published")
            v2 = MapVersion(map_id=m.id, label="v2", status="approved")
            session.add_all([v1, v2])
            await session.flush()
            session.add_all([
                Node(id=f"n1-{v1.id}", version_id=v1.id, title="old stale", department=GONE_LEAF),
                Node(id=f"n2-{v2.id}", version_id=v2.id, title="new stale", department=GONE_LEAF),
                Node(id=f"n3-{v2.id}", version_id=v2.id, title="clean", department=LIVE_LEAF),
            ])
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    rows = {m["id"]: m for m in client.get("/api/maps", headers=SYS).json()}
    assert rows[map_id]["stale_ref_count"] == 2


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


def test_scan_user_refs_ignores_assignee_role(client: TestClient) -> None:
    """역할(assignee_role)은 사람 이름이 아니다 — 감사가 고아 사용자로 잡으면 안 된다 (design 2026-09-11 §2)."""

    async def _seed() -> None:
        async with SessionLocal() as session:
            m = await _new_map(session, "role refs", owning_department=LIVE)
            pub = MapVersion(map_id=m.id, label="pub", status="published")
            session.add(pub)
            await session.flush()
            session.add(Node(id=f"role-{pub.id}", version_id=pub.id, title="r", assignee="", assignee_role="Phantom Reviewer"))
            await session.commit()

    asyncio.run(_seed())

    async def _run() -> list[ref_audit.RefGroup]:
        async with SessionLocal() as session:
            valid = await ref_audit.load_valid_sets(session)
            ctx = await ref_audit.load_scan_context(session)
            return await ref_audit.scan_user_refs(session, valid, ctx)

    groups = asyncio.run(_run())
    assert all(g.value != "Phantom Reviewer" for g in groups)
