"""권한 게이트 강제 테스트 (Task 3, brief §E).

기본 테스트 스위트는 auth OFF로 돌아 is_sysadmin이 전원 True → 모든 게이트가 열린다.
여기서는 settings.auth_enabled=True + bpm_sysadmins 지정 + get_current_user 오버라이드로
is_sysadmin을 '차별적'으로 만들어 실제 403/200을 검증한다(실 JWT 불필요).

직접 DB 시드(SessionLocal)로 맵/권한/직원 행을 깔고, act_as(user)로 호출 사용자를 바꾼다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import (
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessMap,
)
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
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


# ── 직접 DB 시드 헬퍼 ─────────────────────────────────────────


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
) -> int:
    """맵 + As-Is 버전 + 선택적 권한/승인자 시드. map_id 반환."""

    async def _make(session) -> int:
        m = ProcessMap(name="gate map", visibility=visibility, owner_id=None)
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


def version_of(map_id: int) -> int:
    from sqlalchemy import select

    async def _get(session) -> int:
        return await session.scalar(
            select(MapVersion.id).where(MapVersion.map_id == map_id)
        )

    return _seed(_get)  # type: ignore[return-value]


def seed_employee(login_id: str, org_levels: tuple[str | None, ...]) -> None:
    l1, l2, l3 = (org_levels + (None, None, None))[:3]

    async def _make(session) -> None:
        emp = await session.get(Employee, login_id)
        if emp is None:
            emp = Employee(login_id=login_id, name=login_id, source="ad", role="user")
            session.add(emp)
        emp.org_l1, emp.org_l2, emp.org_l3 = l1, l2, l3
        emp.department = l3 or l2 or l1 or ""

    _seed(_make)


# ── GET /maps 가시성 필터 ─────────────────────────────────────


def test_private_map_no_grant_omitted_and_get_403(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(visibility="private")
    act_as("stranger")

    listed = client.get("/api/maps").json()
    assert all(m["id"] != map_id for m in listed)
    assert client.get(f"/api/maps/{map_id}").status_code == 403


def test_public_map_any_user_viewer_200(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="public")
    act_as("anyone")

    listed = client.get("/api/maps").json()
    assert any(m["id"] == map_id for m in listed)
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_explicit_user_grant_visible(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="private", grants=[("user", "viewer.u", "viewer")])
    act_as("viewer.u")

    assert any(m["id"] == map_id for m in client.get("/api/maps").json())
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_list_maps_sysadmin_sees_ungranted_private(
    client: TestClient, enforce: None
) -> None:
    """sysadmin은 grant 없는 private 맵도 목록에서 보고 my_role=owner (전 맵 열람)."""
    map_id = seed_map(visibility="private")  # no grants
    act_as(SYSADMIN)

    listed = client.get("/api/maps").json()
    match = next((m for m in listed if m["id"] == map_id), None)
    assert match is not None, "sysadmin should see ungranted private maps"
    assert match["my_role"] == "owner"


# ── DELETE — owner only ───────────────────────────────────────


def test_delete_owner_204(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    assert client.delete(f"/api/maps/{map_id}").status_code == 204


def test_delete_sysadmin_204(client: TestClient, enforce: None) -> None:
    map_id = seed_map()  # no grants
    act_as(SYSADMIN)
    assert client.delete(f"/api/maps/{map_id}").status_code == 204


def test_delete_editor_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "editor.u", "editor")])
    act_as("editor.u")
    assert client.delete(f"/api/maps/{map_id}").status_code == 403


def test_delete_viewer_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "viewer.u", "viewer")])
    act_as("viewer.u")
    assert client.delete(f"/api/maps/{map_id}").status_code == 403


def test_delete_missing_map_404(client: TestClient, enforce: None) -> None:
    act_as(SYSADMIN)
    assert client.delete("/api/maps/999999").status_code == 404


# ── PATCH — editor+ ───────────────────────────────────────────


def test_patch_editor_200(client: TestClient, enforce: None) -> None:
    # name은 오너 전용(spec 2026-07-18) — 역할 게이트 자체는 description으로 검증
    map_id = seed_map(grants=[("user", "editor.u", "editor")])
    act_as("editor.u")
    r = client.patch(f"/api/maps/{map_id}", json={"description": "renamed"})
    assert r.status_code == 200
    assert r.json()["description"] == "renamed"


def test_patch_viewer_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "viewer.u", "viewer")])
    act_as("viewer.u")
    assert client.patch(f"/api/maps/{map_id}", json={"description": "x"}).status_code == 403


# ── PUT /graph — editor + checkout holder ─────────────────────


def _empty_graph() -> dict:
    return {"nodes": [], "edges": []}


def test_graph_editor_with_checkout_200(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "editor.u", "editor")])
    vid = version_of(map_id)
    act_as("editor.u")
    assert client.post(f"/api/versions/{vid}/checkout", json={}).json()["mine"] is True
    assert client.put(f"/api/versions/{vid}/graph", json=_empty_graph()).status_code == 200


def test_graph_editor_without_checkout_rejected(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(grants=[("user", "editor.u", "editor")])
    vid = version_of(map_id)
    act_as("editor.u")
    # 체크아웃 미보유 → 권한은 있어도 409 "must hold checkout"
    r = client.put(f"/api/versions/{vid}/graph", json=_empty_graph())
    assert r.status_code == 409
    assert "checkout" in r.json()["detail"].lower()


def test_graph_viewer_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(grants=[("user", "viewer.u", "viewer")])
    vid = version_of(map_id)
    act_as("viewer.u")
    assert client.put(f"/api/versions/{vid}/graph", json=_empty_graph()).status_code == 403


def test_graph_sysadmin_still_needs_checkout(
    client: TestClient, enforce: None
) -> None:
    """sysadmin은 권한 게이트는 통과하지만 체크아웃 규칙은 우회 못 한다."""
    map_id = seed_map()
    vid = version_of(map_id)
    act_as(SYSADMIN)
    assert client.put(f"/api/versions/{vid}/graph", json=_empty_graph()).status_code == 409
    client.post(f"/api/versions/{vid}/checkout", json={})
    assert client.put(f"/api/versions/{vid}/graph", json=_empty_graph()).status_code == 200


# ── 부서 권한 (department grant) ──────────────────────────────


def test_department_grant_editor(client: TestClient, enforce: None) -> None:
    """Procurement Office editor 부여 → lee/park/choi/jung은 PATCH 가능, kim은 403.

    name은 오너 전용(spec 2026-07-18)이라 description으로 editor 티어를 검증한다.
    """
    div = "Management Support Division"
    proc = f"{div}/Procurement Office"
    map_id = seed_map(grants=[("department", proc, "editor")])
    seed_employee("lee", (div, "Procurement Office", "Sourcing Team 1"))
    seed_employee("park", (div, "Procurement Office", "Sourcing Team 1"))
    seed_employee("choi", (div, "Procurement Office", "Sourcing Team 2"))
    seed_employee("jung", (div, "Procurement Office", None))  # exact match
    seed_employee("kim", (div, "Process Innovation Office", "Process Innovation Team"))

    for u in ("lee", "park", "choi", "jung"):
        act_as(u)
        assert (
            client.patch(f"/api/maps/{map_id}", json={"description": f"by-{u}"}).status_code
            == 200
        ), f"{u} should be editor"

    act_as("kim")
    assert client.patch(f"/api/maps/{map_id}", json={"description": "kim"}).status_code == 403


# ── 댓글 create/resolve — viewer+ ─────────────────────────────


def test_comment_create_viewer_allowed_norole_403(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(grants=[("user", "viewer.u", "viewer")])
    vid = version_of(map_id)

    async def _seed_node(session) -> None:
        from app.models import Node

        session.add(Node(id="cn1", version_id=vid, title="t", node_type="process"))

    _seed(_seed_node)

    act_as("viewer.u")
    ok = client.post(
        f"/api/versions/{vid}/comments", json={"node_id": "cn1", "body": "hi"}
    )
    assert ok.status_code == 201

    act_as("stranger")
    blocked = client.post(
        f"/api/versions/{vid}/comments", json={"node_id": "cn1", "body": "no"}
    )
    assert blocked.status_code == 403


def test_comment_resolve_viewer_allowed_norole_403(
    client: TestClient, enforce: None
) -> None:
    map_id = seed_map(grants=[("user", "viewer.u", "viewer")])
    vid = version_of(map_id)

    async def _seed_comment(session) -> int:
        from app.models import Comment, Node

        session.add(Node(id="cn2", version_id=vid, title="t", node_type="process"))
        c = Comment(version_id=vid, node_id="cn2", author="viewer.u", body="b")
        session.add(c)
        await session.flush()
        return c.id

    comment_id = _seed(_seed_comment)

    act_as("viewer.u")
    assert (
        client.patch(f"/api/comments/{comment_id}", json={"resolved": True}).status_code
        == 200
    )

    act_as("stranger")
    assert (
        client.patch(f"/api/comments/{comment_id}", json={"resolved": False}).status_code
        == 403
    )


# ── POST /maps owner 행 부여 (creator lock-in 방지) ───────────


def test_create_grants_owner_to_creator(client: TestClient, enforce: None) -> None:
    """enforcement ON에서 맵을 만든 비-sysadmin이 owner 권한을 가져야 한다.

    POST /maps가 owner MapPermission 행 + owner_id + visibility=private을 세팅하는지를
    creator가 자기 맵을 DELETE(owner only)할 수 있는지로 검증한다.
    """
    from sqlalchemy import select

    act_as("maker.u")
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "mine"}).json()
    map_id = created["id"]

    async def _check(session) -> tuple[str, str, list[tuple[str, str]]]:
        m = await session.get(ProcessMap, map_id)
        rows = (
            await session.execute(
                select(MapPermission.principal_id, MapPermission.role).where(
                    MapPermission.map_id == map_id
                )
            )
        ).all()
        return m.visibility, m.owner_id, [(pid, role) for pid, role in rows]

    visibility, owner_id, perms = _seed(_check)  # type: ignore[misc]
    assert visibility == "private"
    assert owner_id == "maker.u"
    assert ("maker.u", "owner") in perms

    # creator는 owner → 본인 맵 삭제 가능 (게이트 통과)
    assert client.delete(f"/api/maps/{map_id}").status_code == 204


# ── DEV_ENFORCE_PERMISSIONS 시뮬레이션 (auth OFF + 플래그 ON) ─


@pytest.fixture
def dev_enforce(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin 1명 지정. 정리 시 복원."""
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def test_dev_enforce_non_sysadmin_no_grant_403(
    client: TestClient, dev_enforce: None
) -> None:
    """auth OFF + 플래그 ON: 권한 없는 비-sysadmin X-Dev-User → private 맵 403."""
    map_id = seed_map(visibility="private")
    act_as("user.lee")
    assert client.get(f"/api/maps/{map_id}").status_code == 403


def test_dev_enforce_non_sysadmin_with_owner_grant_200(
    client: TestClient, dev_enforce: None
) -> None:
    """auth OFF + 플래그 ON: owner grant 있는 비-sysadmin X-Dev-User → 200."""
    map_id = seed_map(visibility="private", grants=[("user", "user.lee", "owner")])
    act_as("user.lee")
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_dev_enforce_sysadmin_member_200(
    client: TestClient, dev_enforce: None
) -> None:
    """auth OFF + 플래그 ON: BPM_SYSADMINS 멤버 → 권한 없어도 owner 취급 → 200."""
    map_id = seed_map(visibility="private")
    act_as(SYSADMIN)
    assert client.get(f"/api/maps/{map_id}").status_code == 200


def test_dev_enforce_flag_off_no_lock(client: TestClient) -> None:
    """플래그 OFF(기본): auth OFF에선 전원 sysadmin → private 맵도 200 (회귀 없음)."""
    # dev_enforce_permissions=False가 기본값 — enforce fixture 없이 호출
    map_id = seed_map(visibility="private")
    act_as("user.lee")
    try:
        assert client.get(f"/api/maps/{map_id}").status_code == 200
    finally:
        app.dependency_overrides.pop(auth_mod.get_current_user, None)


# ── AUTH-OFF 비회귀 (everyone sysadmin → 게이트 전부 열림) ────


def test_auth_off_gates_open(client: TestClient) -> None:
    """기본(auth OFF) 경로: 전원 sysadmin → 게이트 통과(회귀 없음)."""
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "off map"}).json()
    map_id = created["id"]
    vid = created["versions"][0]["id"]

    assert client.get(f"/api/maps/{map_id}").status_code == 200
    assert client.patch(f"/api/maps/{map_id}", json={"name": "edited"}).status_code == 200
    client.post(f"/api/versions/{vid}/checkout", json={})
    assert (
        client.put(f"/api/versions/{vid}/graph", json={"nodes": [], "edges": []}).status_code
        == 200
    )
    assert client.delete(f"/api/maps/{map_id}").status_code == 204


# ── AI 챗·그래프 조회 viewer 게이트 (design 2026-07-10) ─────────────


def test_ai_chat_private_map_stranger_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="private")
    version_id = version_of(map_id)
    act_as("stranger")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 403


def test_ai_chat_viewer_grant_passes_gate(client: TestClient, enforce: None) -> None:
    # 게이트 통과 증명 — AI 비활성(테스트 기본)이라 핸들러의 503에 도달하면 게이트는 열린 것.
    # 403(게이트 거부)과 503(핸들러 도달)을 구분하므로 AI 목킹이 필요 없다.
    map_id = seed_map(visibility="private", grants=[("user", "viewer.user", "viewer")])
    version_id = version_of(map_id)
    act_as("viewer.user")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 503


def test_ai_chat_public_map_passes_gate(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="public")
    version_id = version_of(map_id)
    act_as("anyone")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 503  # 게이트 통과 → AI 비활성 503


def test_graph_get_private_map_stranger_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="private")
    version_id = version_of(map_id)
    act_as("stranger")
    assert client.get(f"/api/versions/{version_id}/graph").status_code == 403
    assert client.get(f"/api/versions/{version_id}/graph/all").status_code == 403


def test_graph_get_public_or_granted_200(client: TestClient, enforce: None) -> None:
    public_id = seed_map(visibility="public")
    act_as("anyone")
    assert client.get(f"/api/versions/{version_of(public_id)}/graph").status_code == 200
    assert client.get(f"/api/versions/{version_of(public_id)}/graph/all").status_code == 200
    granted_id = seed_map(visibility="private", grants=[("user", "viewer.user", "viewer")])
    act_as("viewer.user")
    assert client.get(f"/api/versions/{version_of(granted_id)}/graph").status_code == 200
    assert client.get(f"/api/versions/{version_of(granted_id)}/graph/all").status_code == 200


def test_graph_get_missing_version_404(client: TestClient, enforce: None) -> None:
    act_as(SYSADMIN)
    assert client.get("/api/versions/999999/graph").status_code == 404
