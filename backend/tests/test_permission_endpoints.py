"""권한 관리 엔드포인트 테스트 (Task 4, brief §A–E).

test_permission_gates.py 의 enforce/act_as/_seed 패턴을 따른다 — auth_enabled=True 로
is_sysadmin 을 차별화해 실제 403/지연/적용을 검증한다. 기본(AUTH OFF) 비회귀도 포함.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import (
    ApprovalRequest,
    Department,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessMap,
    _now,
)
from app.permissions.access import get_effective_role
from app.settings import settings

SYSADMIN = "admin.sys"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON: auth_enabled=True + sysadmin 1명 지정. 정리 시 복원."""
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


def _seed(coro_factory) -> object:
    async def _run() -> object:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_map(
    visibility: str = "private",
    grants: list[tuple[str, str, str]] | None = None,
    approvers: list[str] | None = None,
    owner_id: str | None = None,
) -> int:
    async def _make(session) -> int:
        m = ProcessMap(name="perm map", visibility=visibility, owner_id=owner_id)
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        for ptype, pid, role in grants or []:
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type=ptype,
                    principal_id=pid,
                    role=role,
                    granted_by="seed",
                )
            )
        for uid in approvers or []:
            session.add(MapApprover(map_id=m.id, user_id=uid))
        return m.id

    return _seed(_make)  # type: ignore[return-value]


def grant_id(map_id: int, principal_id: str) -> int:
    async def _get(session) -> int:
        return await session.scalar(
            select(MapPermission.id).where(
                MapPermission.map_id == map_id,
                MapPermission.principal_id == principal_id,
            )
        )

    return _seed(_get)  # type: ignore[return-value]


def grant_role(map_id: int, principal_id: str) -> str | None:
    async def _get(session) -> str | None:
        return await session.scalar(
            select(MapPermission.role).where(
                MapPermission.map_id == map_id,
                MapPermission.principal_id == principal_id,
            )
        )

    return _seed(_get)  # type: ignore[return-value]


def map_owner_and_visibility(map_id: int) -> tuple[str | None, str]:
    async def _get(session) -> tuple[str | None, str]:
        m = await session.get(ProcessMap, map_id)
        return m.owner_id, m.visibility

    return _seed(_get)  # type: ignore[return-value]


def owner_grant_count(map_id: int) -> int:
    async def _count(session) -> int:
        return await session.scalar(
            select(func.count())
            .select_from(MapPermission)
            .where(MapPermission.map_id == map_id, MapPermission.role == "owner")
        )

    return _seed(_count)  # type: ignore[return-value]


def effective_role_of(map_id: int, user: str) -> str | None:
    async def _get(session) -> str | None:
        return await get_effective_role(session, user, map_id)

    return _seed(_get)  # type: ignore[return-value]


def first_version_id(map_id: int) -> int:
    async def _get(session) -> int:
        return await session.scalar(
            select(MapVersion.id).where(MapVersion.map_id == map_id).order_by(MapVersion.id)
        )

    return _seed(_get)  # type: ignore[return-value]


def pending_request_count(map_id: int, kind: str) -> int:
    async def _count(session) -> int:
        return await session.scalar(
            select(func.count())
            .select_from(ApprovalRequest)
            .where(
                ApprovalRequest.map_id == map_id,
                ApprovalRequest.kind == kind,
                ApprovalRequest.status == "pending",
            )
        )

    return _seed(_count)  # type: ignore[return-value]


def request_status(request_id: int) -> str | None:
    """승인 요청의 현재 상태 조회."""
    async def _get(session) -> str | None:
        req = await session.get(ApprovalRequest, request_id)
        return None if req is None else req.status

    return _seed(_get)  # type: ignore[return-value]


def soft_delete_map(map_id: int) -> None:
    async def _del(session) -> None:
        m = await session.get(ProcessMap, map_id)
        m.deleted_at = _now()

    _seed(_del)


# ── A. Collaborators ──────────────────────────────────────────


def test_add_collaborator_immediate_in_get(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "alice", "role": "viewer"},
    )
    assert r.status_code == 201
    listed = client.get(f"/api/maps/{map_id}/permissions").json()
    assert any(p["principal_id"] == "alice" and p["role"] == "viewer" for p in listed)


def test_add_duplicate_grant_409(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "bob", "viewer")])
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "bob", "role": "editor"},
    )
    assert r.status_code == 409


def test_add_viewer_on_public_map_409(client: TestClient, enforce: None) -> None:
    """퍼블릭 맵은 viewer 부여 불가 — editor만 (request #9)."""
    map_id = seed_map(visibility="public", grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    blocked = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "bob", "role": "viewer"},
    )
    assert blocked.status_code == 409
    # editor 부여는 허용
    allowed = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "bob", "role": "editor"},
    )
    assert allowed.status_code == 201


def test_change_to_viewer_on_public_map_409(client: TestClient, enforce: None) -> None:
    """퍼블릭 맵에서 editor→viewer 변경 불가 (request #9)."""
    map_id = seed_map(
        visibility="public",
        grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")],
    )
    gid = grant_id(map_id, "ed")
    act_as("owner.u")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 409


def test_eligible_assignees_private_filters(client: TestClient, enforce: None) -> None:
    """비공개 맵: viewer+ 직원만 담당자 후보 (F5). 권한 없는 직원은 제외."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "user.lee", "viewer")],
    )
    vid = first_version_id(map_id)
    act_as("owner.u")
    res = client.get(f"/api/versions/{vid}/eligible-assignees")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()["users"]}
    assert "user.lee" in ids  # viewer 부여 → 후보
    assert "user.park" not in ids  # 권한 없음 → 제외
    assert "user.choi" not in ids  # 권한 없음 → 제외
    assert isinstance(res.json()["departments"], list)


def test_eligible_approvers_private_filters(client: TestClient, enforce: None) -> None:
    """승인자 후보도 viewer+ 자격자만 (AP) — 담당자 후보와 동일 자격."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "user.lee", "viewer")],
    )
    act_as("owner.u")
    res = client.get(f"/api/maps/{map_id}/eligible-approvers")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()}
    assert "user.lee" in ids
    assert "user.park" not in ids


def test_eligible_assignees_includes_korean_fields(client: TestClient, enforce: None) -> None:
    """담당자 후보 응답에 korean_name/korean_dept 실값 전달 (피커 한글 검색 대상)."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "user.lee", "viewer")],
    )
    vid = first_version_id(map_id)

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_name = "이민재"
            emp.korean_dept = "소싱1팀"
            await session.commit()

    asyncio.run(_run())
    act_as("owner.u")
    res = client.get(f"/api/versions/{vid}/eligible-assignees")
    assert res.status_code == 200
    by_id = {u["id"]: u for u in res.json()["users"]}
    assert by_id["user.lee"]["korean_name"] == "이민재"
    assert by_id["user.lee"]["korean_dept"] == "소싱1팀"


def test_eligible_assignees_includes_dept_infos(client: TestClient, enforce: None) -> None:
    """담당자 응답에 dept_infos(한글 부서명) 맵 전달 — 부서 피커 검색·한/영 표시용
    (2026-08-11 dept_info→departments 전환)."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "user.lee", "viewer")],
    )
    vid = first_version_id(map_id)

    async def _run() -> str:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            dept = emp.department
            await session.merge(Department(dept_code="EAINFO-D1", name=dept, name_ko="소싱1팀"))
            await session.commit()
            return dept

    dept = asyncio.run(_run())
    act_as("owner.u")
    res = client.get(f"/api/versions/{vid}/eligible-assignees")
    assert res.status_code == 200
    body = res.json()
    assert dept in body["departments"]
    assert body["dept_infos"][dept] == {"korean_name": "소싱1팀"}


def test_eligible_approvers_includes_korean_name(client: TestClient, enforce: None) -> None:
    """승인자 후보 응답에 korean_name 실값 전달 (승인자 카드 한/영 표시)."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "user.lee", "viewer")],
    )

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_name = "이민재"
            emp.korean_dept = "소싱1팀"
            await session.commit()

    asyncio.run(_run())
    act_as("owner.u")
    res = client.get(f"/api/maps/{map_id}/eligible-approvers")
    assert res.status_code == 200
    by_id = {u["id"]: u for u in res.json()}
    assert by_id["user.lee"]["korean_name"] == "이민재"
    assert by_id["user.lee"]["korean_dept"] == "소싱1팀"


def test_eligible_assignees_public_all(client: TestClient, enforce: None) -> None:
    """공개 맵: 전원 열람 가능 → 모든 직원이 담당자 후보 (F5)."""
    map_id = seed_map(visibility="public", grants=[("user", "owner.u", "owner")])
    vid = first_version_id(map_id)
    act_as("owner.u")
    res = client.get(f"/api/versions/{vid}/eligible-assignees")
    assert res.status_code == 200
    ids = {u["id"] for u in res.json()["users"]}
    assert {"user.lee", "user.park", "user.choi"} <= ids


def test_change_role_upgrade_immediate(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "bob", "viewer")])
    gid = grant_id(map_id, "bob")
    act_as("owner.u")
    r = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "editor"}
    )
    assert r.status_code == 200
    assert r.json()["pending"] is False
    assert grant_role(map_id, "bob") == "editor"


def test_change_role_downgrade_deferred_non_owner(client: TestClient, enforce: None) -> None:
    """비-오너(editor) 행위자의 editor→viewer 는 pending approval_request 만 만들고 role 은 그대로."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200
    assert r.json()["pending"] is True
    assert grant_role(map_id, "ed") == "editor"  # 아직 적용 안 됨


def _ensure_employee(login_id: str) -> None:
    """활성 직원 행 시드 — load_active_approvers 는 employees.active 조인이라 행 필수."""

    async def _make(session) -> None:
        if await session.get(Employee, login_id) is None:
            session.add(Employee(login_id=login_id, name=login_id, source="local", active=True))

    _seed(_make)


def test_downgrade_request_notifies_approvers_not_requester(
    client: TestClient, enforce: None
) -> None:
    """다운그레이드 지연 생성 → 활성 승인자에게 permission_requested(kind·맵명 내용 단언), 요청자 미수신."""
    _ensure_employee("nappr.dg")
    map_id = seed_map(
        grants=[
            ("user", "owner.dg", "owner"),
            ("user", "actor.dg", "editor"),
            ("user", "ed.dg", "editor"),
        ],
        approvers=["nappr.dg"],
    )
    gid = grant_id(map_id, "ed.dg")
    act_as("actor.dg")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["pending"] is True

    act_as("nappr.dg")
    got = [
        n
        for n in client.get("/api/notifications?unread_only=true").json()
        if n["type"] == "permission_requested" and n["map_id"] == map_id
    ]
    assert len(got) == 1
    assert "a permission change" in got[0]["message"]  # kind 배선 (visibility 문구 아님)
    assert "'perm map'" in got[0]["message"]  # map_name 배선

    act_as("actor.dg")
    mine = [
        n
        for n in client.get("/api/notifications").json()
        if n["type"] == "permission_requested" and n["map_id"] == map_id
    ]
    assert mine == []  # 요청자 본인 제외


def test_remove_editor_deferred_grant_present_non_owner(client: TestClient, enforce: None) -> None:
    """비-오너(editor) 행위자의 editor 제거는 승인 지연 — 행 유지."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 200
    assert r.json()["pending"] is True
    assert grant_role(map_id, "ed") == "editor"  # 아직 제거 안 됨


def test_owner_downgrade_editor_immediate(client: TestClient, enforce: None) -> None:
    """오너가 editor→viewer 다운그레이드 시 승인 없이 즉시 적용 (request #10)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")])
    gid = grant_id(map_id, "ed")
    act_as("owner.u")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200
    assert r.json()["pending"] is False
    assert grant_role(map_id, "ed") == "viewer"  # 즉시 적용


def test_owner_remove_editor_immediate(client: TestClient, enforce: None) -> None:
    """오너가 editor 제거 시 승인 없이 즉시 삭제 (request #10)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")])
    gid = grant_id(map_id, "ed")
    act_as("owner.u")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 200
    assert r.json()["pending"] is False
    assert grant_role(map_id, "ed") is None  # 즉시 제거


def test_remove_viewer_immediate(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "vw", "viewer")])
    gid = grant_id(map_id, "vw")
    act_as("owner.u")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 200
    assert r.json()["pending"] is False
    assert grant_role(map_id, "vw") is None  # 즉시 제거


def test_owner_grant_change_refused_409(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner")])
    gid = grant_id(map_id, "owner.u")
    act_as("owner.u")
    assert (
        client.patch(
            f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
        ).status_code
        == 409
    )
    assert client.delete(f"/api/maps/{map_id}/permissions/{gid}").status_code == 409


def test_collaborators_viewer_can_read_not_write(client: TestClient, enforce: None) -> None:
    # viewer는 멤버 목록을 읽을 수 있으나(B1) 변경(추가)은 불가 — 게이팅 비대칭.
    map_id = seed_map(grants=[("user", "vw", "viewer")])
    act_as("vw")
    listed = client.get(f"/api/maps/{map_id}/permissions")
    assert listed.status_code == 200
    assert any(p["principal_id"] == "vw" for p in listed.json())
    assert (
        client.post(
            f"/api/maps/{map_id}/permissions",
            json={"principal_type": "user", "principal_id": "x", "role": "viewer"},
        ).status_code
        == 403
    )


def test_downgrade_duplicate_pending_409(client: TestClient, enforce: None) -> None:
    """같은 grant 대상 pending 다운그레이드가 있으면 PATCH/DELETE 재요청은 409."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    first = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert first.status_code == 200 and first.json()["pending"] is True
    dup = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert dup.status_code == 409
    dup_del = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert dup_del.status_code == 409
    assert pending_request_count(map_id, "permission_downgrade") == 1


def test_downgrade_pending_other_grant_unaffected(client: TestClient, enforce: None) -> None:
    """중복 가드는 grant 단위 — 다른 grant 의 다운그레이드는 그대로 지연 생성."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed1", "editor"),
            ("user", "ed2", "editor"),
        ]
    )
    g1, g2 = grant_id(map_id, "ed1"), grant_id(map_id, "ed2")
    act_as("actor.ed")
    assert client.patch(f"/api/maps/{map_id}/permissions/{g1}", json={"role": "viewer"}).json()["pending"] is True
    r2 = client.patch(f"/api/maps/{map_id}/permissions/{g2}", json={"role": "viewer"})
    assert r2.status_code == 200 and r2.json()["pending"] is True
    assert pending_request_count(map_id, "permission_downgrade") == 2


# ── group principal: stored but effective_role ignores ────────


def test_group_grant_stored_but_ignored(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "group", "principal_id": "g-eng", "role": "editor"},
    )
    assert r.status_code == 201
    listed = client.get(f"/api/maps/{map_id}/permissions").json()
    assert any(p["principal_type"] == "group" for p in listed)  # 저장됨
    # group 멤버라 해도(여기선 단순히 그 group_id 를 user 로 가정) effective_role 은 무시
    assert effective_role_of(map_id, "g-eng") is None


# ── B. Owner transfer ─────────────────────────────────────────


def test_owner_transfer_invariant(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")],
        owner_id="owner.u",
    )
    act_as("owner.u")
    r = client.post(f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "ed"})
    assert r.status_code == 200
    assert grant_role(map_id, "owner.u") == "editor"
    assert grant_role(map_id, "ed") == "owner"
    owner_id, _ = map_owner_and_visibility(map_id)
    assert owner_id == "ed"
    assert owner_grant_count(map_id) == 1  # 정확히 1개 owner grant


def test_owner_transfer_non_owner_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")])
    act_as("ed")
    assert (
        client.post(
            f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "ed"}
        ).status_code
        == 403
    )


def test_owner_transfer_new_owner_not_editor_409(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(
        grants=[("user", "owner.u", "owner"), ("user", "vw", "viewer")],
        owner_id="owner.u",
    )
    act_as("owner.u")
    r = client.post(f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "vw"})
    assert r.status_code == 409


# ── C/D. Visibility request + approval decide ─────────────────


def test_visibility_request_owner_creates_pending(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(
        visibility="private", grants=[("user", "owner.u", "owner")], approvers=["a"]
    )
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    # before→after 표기용으로 현재값(private)도 payload에 저장 (A13)
    assert body["payload"] == {"from_visibility": "private", "to_visibility": "public"}
    _, visibility = map_owner_and_visibility(map_id)
    assert visibility == "private"  # 아직 적용 안 됨


def test_visibility_request_non_owner_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "ed", "editor")])
    act_as("ed")
    assert (
        client.post(
            f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
        ).status_code
        == 403
    )


def test_visibility_request_duplicate_pending_409(client: TestClient, enforce: None) -> None:
    """같은 맵에 pending 가시성 요청이 있으면 재요청은 409 — 행이 쌓이지 않는다."""
    map_id = seed_map(
        visibility="private", grants=[("user", "owner.u", "owner")], approvers=["a"]
    )
    act_as("owner.u")
    first = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert first.status_code == 201
    dup = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert dup.status_code == 409
    assert pending_request_count(map_id, "visibility_change") == 1


def test_visibility_request_noop_422(client: TestClient, enforce: None) -> None:
    """현재값과 같은 가시성 요청은 422 — rename 의 'new name equals current name' 대칭."""
    map_id = seed_map(
        visibility="private", grants=[("user", "owner.u", "owner")], approvers=["a"]
    )
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "private"}
    )
    assert r.status_code == 422


def test_visibility_request_no_approvers_409(client: TestClient, enforce: None) -> None:
    """활성 승인자 0명이면 409 — 결정 불가능한 pending 데드락 방지 (version submit 대칭)."""
    map_id = seed_map(visibility="private", grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    r = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert r.status_code == 409
    assert "no approvers" in r.json()["detail"]
    assert pending_request_count(map_id, "visibility_change") == 0


def test_approval_list_owner_can_read(client: TestClient, enforce: None) -> None:
    """승인자가 아닌 오너도 결재 대기 목록 열람 — rename/sp 결정권자라 통합 탭에 필요 (C)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner")], approvers=["a"])
    act_as("owner.u")
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 200


def test_approval_list_editor_still_403(client: TestClient, enforce: None) -> None:
    """오너도 승인자도 아닌 editor 는 여전히 403."""
    map_id = seed_map(
        grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")], approvers=["a"]
    )
    act_as("ed")
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 403


def test_approval_list_visible_to_approver_403_to_others(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner")], approvers=["appr"])
    act_as("appr")
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 200
    act_as(SYSADMIN)
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 200
    act_as("stranger")
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 403


def test_decide_approve_downgrade_applies(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ],
        approvers=["appr"],
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")  # 비-오너 행위자 → 다운그레이드 승인 지연
    # editor→viewer 지연 요청 생성
    pend = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()
    req_id = pend["approval_request"]["id"]
    assert grant_role(map_id, "ed") == "editor"  # 아직 변경 전

    act_as("appr")
    r = client.post(f"/api/approval-requests/{req_id}/decide", json={"decision": "approve"})
    assert r.status_code == 200
    assert r.json()["status"] == "applied"
    assert grant_role(map_id, "ed") == "viewer"  # 적용됨


def test_decide_approve_removal_applies(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ],
        approvers=["appr"],
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")  # 비-오너 행위자 → 제거 승인 지연
    pend = client.delete(f"/api/maps/{map_id}/permissions/{gid}").json()
    req_id = pend["approval_request"]["id"]
    act_as("appr")
    r = client.post(f"/api/approval-requests/{req_id}/decide", json={"decision": "approve"})
    assert r.status_code == 200
    assert grant_role(map_id, "ed") is None  # grant 제거됨


def test_decide_approve_visibility_flips(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner")],
        approvers=["appr"],
    )
    act_as("owner.u")
    req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()
    act_as("appr")
    r = client.post(
        f"/api/approval-requests/{req['id']}/decide", json={"decision": "approve"}
    )
    assert r.status_code == 200
    _, visibility = map_owner_and_visibility(map_id)
    assert visibility == "public"  # flip 적용


def test_visibility_public_removes_viewer_grants(client: TestClient, enforce: None) -> None:
    """private→public 승인 적용 시 잔존 viewer 그랜트 제거 (PV)."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "vw", "viewer")],
        approvers=["appr"],
    )
    act_as("owner.u")
    req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()
    act_as("appr")
    client.post(f"/api/approval-requests/{req['id']}/decide", json={"decision": "approve"})
    _, visibility = map_owner_and_visibility(map_id)
    assert visibility == "public"
    assert grant_role(map_id, "vw") is None  # viewer 그랜트 제거됨


def test_decide_reject_leaves_unchanged(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ],
        approvers=["appr"],
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")  # 비-오너 행위자 → 다운그레이드 승인 지연
    pend = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()
    req_id = pend["approval_request"]["id"]
    act_as("appr")
    r = client.post(f"/api/approval-requests/{req_id}/decide", json={"decision": "reject"})
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert grant_role(map_id, "ed") == "editor"  # 변경 없음


def test_decide_non_approver_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ],
        approvers=["appr"],
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")  # 비-오너 행위자 → 다운그레이드 승인 지연
    pend = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()
    req_id = pend["approval_request"]["id"]
    act_as("stranger")
    assert (
        client.post(
            f"/api/approval-requests/{req_id}/decide", json={"decision": "approve"}
        ).status_code
        == 403
    )
    assert grant_role(map_id, "ed") == "editor"  # 게이트 막혀 미적용


# ── E. Approvers assigned_by ──────────────────────────────────


def test_approvers_assigned_by_set(client: TestClient, enforce: None) -> None:
    """PUT /approvers 가 assigned_by 를 호출자로 기록한다."""
    map_id = seed_map()  # created_by=None → 누구나 관리 허용(기존 게이트 유지)
    act_as("manager.u")
    r = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a1", "a2"]})
    assert r.status_code == 200

    async def _get(session) -> list[str | None]:
        rows = await session.scalars(
            select(MapApprover.assigned_by).where(MapApprover.map_id == map_id)
        )
        return list(rows.all())

    assigned = _seed(_get)
    assert assigned == ["manager.u", "manager.u"]


# ── AUTH-OFF 비회귀 (everyone sysadmin → 관리 엔드포인트 개방) ──


def test_auth_off_management_open(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "off perm map"}).json()
    map_id = created["id"]
    # 가시성 요청 가드: 승인자 필수 → 승인자 추가
    async def _add_approver(session) -> None:
        session.add(MapApprover(map_id=map_id, user_id="a"))
    _seed(_add_approver)

    # collaborators
    assert client.get(f"/api/maps/{map_id}/permissions").status_code == 200
    add = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "ux", "role": "editor"},
    )
    assert add.status_code == 201
    # transfer-owner (ux 는 editor → owner 이전 가능)
    assert (
        client.post(
            f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "ux"}
        ).status_code
        == 200
    )
    # visibility-request + approval-requests list
    vr = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert vr.status_code == 201
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 200
    assert (
        client.post(
            f"/api/approval-requests/{vr.json()['id']}/decide",
            json={"decision": "approve"},
        ).status_code
        == 200
    )


# ── F. 교차맵 sysadmin 승인 큐 (A3) ──────────────────────────────


def test_cross_map_pending_queue_lists_across_maps(client: TestClient, enforce: None) -> None:
    """교차맵 sysadmin 큐 — 여러 맵의 pending 다운그레이드를 맵 경계 무관하게 한 번에 반환."""
    created_map_ids = []
    for tag in ("xqa", "xqb"):
        map_id = seed_map(
            grants=[
                ("user", f"owner.{tag}", "owner"),
                ("user", f"actor.{tag}", "editor"),
                ("user", f"ed.{tag}", "editor"),
            ]
        )
        gid = grant_id(map_id, f"ed.{tag}")
        act_as(f"actor.{tag}")
        assert (
            client.patch(
                f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
            ).status_code
            == 200
        )
        created_map_ids.append(map_id)

    act_as(SYSADMIN)
    r = client.get("/api/approval-requests")
    assert r.status_code == 200
    rows = r.json()
    # 세션 공유 DB라 절대 카운트 대신 부분집합으로 — 내가 만든 두 맵 모두 포함 + 전부 pending
    assert set(created_map_ids) <= {row["map_id"] for row in rows}
    assert all(row["status"] == "pending" for row in rows)


def test_cross_map_pending_queue_sysadmin_only(client: TestClient, enforce: None) -> None:
    """교차맵 큐는 sysadmin 전용 — 비-sysadmin 은 403."""
    act_as("nobody.u")
    assert client.get("/api/approval-requests").status_code == 403


# ── G. 드래프트 점유권 인수 — 강탈(force)은 sysadmin only ───────────


def _set_version_status(version_id: int, status: str) -> None:
    async def _do(session) -> None:
        v = await session.get(MapVersion, version_id)
        v.status = status

    _seed(_do)


def checked_out_by_of(version_id: int) -> str | None:
    async def _get(session) -> str | None:
        return await session.scalar(
            select(MapVersion.checked_out_by).where(MapVersion.id == version_id)
        )

    return _seed(_get)  # type: ignore[return-value]


def test_force_checkout_is_sysadmin_only(client: TestClient, enforce: None) -> None:
    """활성 점유 강탈은 sysadmin만 — 에디터는 일반획득 시 읽기전용·force 시 403, sysadmin은 인수."""
    map_id = seed_map(grants=[("user", "creator.u", "editor"), ("user", "ed.itor", "editor")])
    vid = first_version_id(map_id)
    # 생성자가 점유 (점유는 editor+ 만 가능)
    act_as("creator.u")
    assert client.post(f"/api/versions/{vid}/checkout", json={}).json()["mine"] is True
    # 에디터: 일반 획득 = 읽기전용(강탈 아님)
    act_as("ed.itor")
    assert client.post(f"/api/versions/{vid}/checkout", json={}).json()["mine"] is False
    # 에디터: 강제 점유 = 403, 점유는 그대로 생성자
    assert (
        client.post(f"/api/versions/{vid}/checkout", json={"force": True}).status_code
        == 403
    )
    assert checked_out_by_of(vid) == "creator.u"
    # sysadmin: 강제 인수 성공
    act_as(SYSADMIN)
    r = client.post(f"/api/versions/{vid}/checkout", json={"force": True})
    assert r.status_code == 200
    assert r.json()["mine"] is True and r.json()["checked_out_by"] == SYSADMIN


def test_acquire_checkout_requires_editor(client: TestClient, enforce: None) -> None:
    """뷰어는 점유 획득 불가 — editor+ 만 (item 1)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "view.er", "viewer")])
    vid = first_version_id(map_id)
    act_as("view.er")
    assert client.post(f"/api/versions/{vid}/checkout", json={}).status_code == 403


def test_create_version_requires_editor(client: TestClient, enforce: None) -> None:
    """뷰어는 새 버전(드래프트) 생성 불가 — editor+ 만 (item 1)."""
    map_id = seed_map(grants=[("user", "owner.u", "owner"), ("user", "view.er", "viewer")])
    act_as("view.er")
    r = client.post(f"/api/maps/{map_id}/versions", json={"label": "x"})
    assert r.status_code == 403


def test_delete_version_requires_holder_or_admin(
    client: TestClient, enforce: None
) -> None:
    """드래프트 삭제는 점유 보유자(또는 오너·sysadmin)만 — 비보유 에디터는 403 (item 5)."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "ed.hold", "editor"),
            ("user", "ed.other", "editor"),
        ]
    )
    vid = first_version_id(map_id)
    act_as("ed.hold")
    client.post(f"/api/versions/{vid}/checkout", json={})  # ed.hold 점유
    act_as("ed.other")
    assert client.delete(f"/api/versions/{vid}").status_code == 403


def test_create_version_holds_checkout_for_creator(
    client: TestClient, enforce: None
) -> None:
    """새 드래프트 생성 시 생성자가 점유권자 — 타인은 읽기전용으로 진입."""
    map_id = seed_map(grants=[("user", "creator.u", "owner")])
    _set_version_status(first_version_id(map_id), "published")  # 생성 게이트 충족
    act_as("creator.u")
    r = client.post(f"/api/maps/{map_id}/versions", json={"label": "To-Be"})
    assert r.status_code == 201
    assert checked_out_by_of(r.json()["id"]) == "creator.u"


# ── Supersede pending downgrades ──────────────────────────────


def test_owner_direct_change_supersedes_pending(
    client: TestClient, enforce: None
) -> None:
    """오너가 같은 grant 를 직접 변경하면 pending 다운그레이드는 superseded + 요청자 알림."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    req_id = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()["approval_request"]["id"]

    act_as("owner.u")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["pending"] is False
    assert request_status(req_id) == "superseded"

    act_as("actor.ed")
    got = [
        n
        for n in client.get("/api/notifications").json()
        if n["type"] == "permission_superseded" and n["map_id"] == map_id
    ]
    assert len(got) == 1
    assert "'perm map'" in got[0]["message"]


def test_owner_remove_supersedes_pending(client: TestClient, enforce: None) -> None:
    """오너가 grant 를 직접 제거해도 pending 다운그레이드는 superseded."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    req_id = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()["approval_request"]["id"]
    act_as("owner.u")
    assert (
        client.delete(f"/api/maps/{map_id}/permissions/{gid}").json()["pending"]
        is False
    )
    assert request_status(req_id) == "superseded"


def test_owner_transfer_supersedes_pending_on_promoted_grant(
    client: TestClient, enforce: None
) -> None:
    """오너 이전으로 owner 로 승격된 grant 의 pending 다운그레이드는 superseded.

    방치하면 승인 시 owner grant 가 viewer 로 강등돼 오너 부재 상태가 된다.
    """
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    req_id = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()["approval_request"]["id"]

    act_as("owner.u")
    r = client.post(f"/api/maps/{map_id}/transfer-owner", json={"new_owner": "ed"})
    assert r.status_code == 200
    assert request_status(req_id) == "superseded"
    assert grant_role(map_id, "ed") == "owner"


# ── C. Visibility request ──────────────────────────────────────


def test_pending_visibility_peek_and_withdraw(client: TestClient, enforce: None) -> None:
    """peek 는 pending 반환(없으면 null), 요청자 철회 → withdrawn, 이후 재요청 가능."""
    map_id = seed_map(
        visibility="private", grants=[("user", "owner.u", "owner")], approvers=["a"]
    )
    act_as("owner.u")
    assert client.get(f"/api/maps/{map_id}/visibility-requests/pending").json() is None
    req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()
    peek = client.get(f"/api/maps/{map_id}/visibility-requests/pending").json()
    assert peek is not None and peek["id"] == req["id"]

    assert client.delete(f"/api/approval-requests/{req['id']}").status_code == 204
    assert request_status(req["id"]) == "withdrawn"
    assert client.get(f"/api/maps/{map_id}/visibility-requests/pending").json() is None
    # withdrawn 은 pending 아님 — 재요청 201
    again = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    )
    assert again.status_code == 201


def test_withdraw_guards(client: TestClient, enforce: None) -> None:
    """철회는 요청자 본인(403)·pending 상태(409)·해당 kind(409)만 허용."""
    map_id = seed_map(
        visibility="private",
        grants=[("user", "owner.u", "owner"), ("user", "actor.ed", "editor"), ("user", "ed", "editor")],
        approvers=["a"],
    )
    act_as("owner.u")
    vis_req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()
    # 비요청자 → 403
    act_as("actor.ed")
    assert client.delete(f"/api/approval-requests/{vis_req['id']}").status_code == 403
    # 결정된 요청 → 409
    act_as("a")
    client.post(f"/api/approval-requests/{vis_req['id']}/decide", json={"decision": "reject"})
    act_as("owner.u")
    assert client.delete(f"/api/approval-requests/{vis_req['id']}").status_code == 409
    # rename kind → 409 (맵 스코프 전용 경로 유지)
    act_as("actor.ed")
    rn = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "renamed x"}).json()
    assert client.delete(f"/api/approval-requests/{rn['id']}").status_code == 409


def test_withdraw_own_downgrade_request(client: TestClient, enforce: None) -> None:
    """다운그레이드 요청자도 같은 엔드포인트로 철회 — 철회 후 재요청 가능(중복 가드 해제)."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    req_id = client.patch(
        f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}
    ).json()["approval_request"]["id"]
    assert client.delete(f"/api/approval-requests/{req_id}").status_code == 204
    assert request_status(req_id) == "withdrawn"
    # 철회 후 재요청 (중복 가드 해제됨)
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["pending"] is True


# ── 소프트삭제 스윕 통일 ────────────────────────────────────────


def test_soft_deleted_map_permission_endpoints_404(client: TestClient, enforce: None) -> None:
    """소프트삭제 맵은 권한/가시성/승인목록 엔드포인트 전부 404 (rename 선례와 대칭)."""
    map_id = seed_map(
        grants=[("user", "owner.u", "owner"), ("user", "ed", "editor")], approvers=["a"]
    )
    gid = grant_id(map_id, "ed")
    soft_delete_map(map_id)
    act_as("owner.u")
    assert client.get(f"/api/maps/{map_id}/permissions").status_code == 404
    assert (
        client.post(
            f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
        ).status_code
        == 404
    )
    assert (
        client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"}).status_code
        == 404
    )
    act_as("a")
    assert client.get(f"/api/maps/{map_id}/approval-requests").status_code == 404


def test_sysadmin_queue_excludes_soft_deleted(client: TestClient, enforce: None) -> None:
    """sysadmin 전역 큐는 소프트삭제 맵의 pending 을 숨긴다."""
    map_id = seed_map(
        visibility="private", grants=[("user", "owner.u", "owner")], approvers=["a"]
    )
    act_as("owner.u")
    req = client.post(
        f"/api/maps/{map_id}/visibility-request", json={"to_visibility": "public"}
    ).json()
    soft_delete_map(map_id)
    act_as(SYSADMIN)
    ids = [r["id"] for r in client.get("/api/approval-requests").json()]
    assert req["id"] not in ids


# ── R2: pending 노출 + 워크플로 상호 배제 ──────────────────────


def test_permissions_list_exposes_pending_change(client: TestClient, enforce: None) -> None:
    """GET permissions 는 대상 행에 pending_change(to_role·requested_by) 를 노출, 나머지는 null.
    제거 요청(to_role=None)도 동일하게 반영된다."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
            ("user", "other.ed", "editor"),
        ]
    )
    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert r.status_code == 200 and r.json()["pending"] is True

    act_as("owner.u")
    listed = client.get(f"/api/maps/{map_id}/permissions").json()
    by_principal = {p["principal_id"]: p for p in listed}
    assert by_principal["ed"]["pending_change"] == {
        "to_role": "viewer",
        "requested_by": "actor.ed",
    }
    assert by_principal["other.ed"]["pending_change"] is None
    assert by_principal["owner.u"]["pending_change"] is None

    # 제거 요청 — to_role null
    gid2 = grant_id(map_id, "other.ed")
    act_as("actor.ed")
    r2 = client.delete(f"/api/maps/{map_id}/permissions/{gid2}")
    assert r2.status_code == 200 and r2.json()["pending"] is True

    act_as("owner.u")
    listed2 = client.get(f"/api/maps/{map_id}/permissions").json()
    by_principal2 = {p["principal_id"]: p for p in listed2}
    assert by_principal2["other.ed"]["pending_change"] == {
        "to_role": None,
        "requested_by": "actor.ed",
    }


def test_downgrade_blocked_for_checkout_holder(client: TestClient, enforce: None) -> None:
    """대상 유저가 draft 버전을 체크아웃 중이면 권한 변경 차단 — 지연·오너 즉시 모두 409."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    vid = first_version_id(map_id)

    async def _checkout_ed(session) -> None:
        v = await session.get(MapVersion, vid)
        v.checked_out_by = "ed"
        v.checked_out_at = _now()

    _seed(_checkout_ed)

    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    deferred = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert deferred.status_code == 409

    act_as("owner.u")
    immediate = client.patch(f"/api/maps/{map_id}/permissions/{gid}", json={"role": "viewer"})
    assert immediate.status_code == 409


def test_downgrade_blocked_for_submitter(client: TestClient, enforce: None) -> None:
    """대상 유저가 pending 버전의 제출자면 권한 제거 차단."""
    map_id = seed_map(
        grants=[
            ("user", "owner.u", "owner"),
            ("user", "actor.ed", "editor"),
            ("user", "ed", "editor"),
        ]
    )
    vid = first_version_id(map_id)

    async def _submit_by_ed(session) -> None:
        v = await session.get(MapVersion, vid)
        v.status = "pending"
        v.submitted_by = "ed"

    _seed(_submit_by_ed)

    gid = grant_id(map_id, "ed")
    act_as("actor.ed")
    r = client.delete(f"/api/maps/{map_id}/permissions/{gid}")
    assert r.status_code == 409
