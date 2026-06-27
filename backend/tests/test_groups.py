"""사용자 그룹 관리 API 테스트 (Layer 4 Task 3b, brief).

test_permission_endpoints.py 의 enforce/act_as/_seed 패턴을 따른다 — auth_enabled=True 로
is_sysadmin 을 차별화해 실제 403/422/409 와 sysadmin 게이트를 검증한다. 마지막 테스트는
승인된 그룹 grant 가 멤버에게 역할을 부여하고 pending 그룹은 부여하지 않음을 end-to-end 로 묶는다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import Employee, MapVersion, ProcessMap
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


def seed_map(visibility: str = "private") -> int:
    async def _make(session) -> int:
        m = ProcessMap(name="group api map", visibility=visibility, owner_id=None)
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        return m.id

    return _seed(_make)  # type: ignore[return-value]


def effective_role_of(map_id: int, user: str) -> str | None:
    async def _get(session) -> str | None:
        return await get_effective_role(session, user, map_id)

    return _seed(_get)  # type: ignore[return-value]


def _create_group(
    client: TestClient,
    members: list[dict],
    name: str = "g",
    managers: list[str] | None = None,
) -> "dict | int":
    body = {"name": name, "description": "", "members": members}
    if managers is not None:
        body["managers"] = managers
    r = client.post("/api/groups", json=body)
    return r


# ── create — ≥2 member validation + creator auto-manager ──────


def test_create_group_two_members_pending_creator_manager(
    client: TestClient, enforce: None
) -> None:
    act_as("u.creator")
    r = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert body["created_by"] == "u.creator"
    assert "u.creator" in body["managers"]  # 생성자 자동 관리자
    assert len(body["members"]) == 2


def test_create_group_one_member_422(client: TestClient, enforce: None) -> None:
    act_as("u.creator")
    r = _create_group(client, members=[{"member_type": "user", "member_id": "u.a"}])
    assert r.status_code == 422


def test_create_group_extra_managers_included(
    client: TestClient, enforce: None
) -> None:
    act_as("u.creator")
    r = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.helper"},  # 매니저는 멤버(user) 중에서
        ],
        managers=["u.helper"],
    )
    assert r.status_code == 201
    managers = r.json()["managers"]
    assert "u.creator" in managers and "u.helper" in managers


def test_create_group_manager_not_member_422(
    client: TestClient, enforce: None
) -> None:
    """매니저는 그룹 멤버(user) 중에서만 — 비-멤버 매니저 지정은 422."""
    act_as("u.creator")
    r = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
        managers=["u.outsider"],
    )
    assert r.status_code == 422


# ── list visibility ───────────────────────────────────────────


def test_list_visibility_sysadmin_all_others_active_plus_own(
    client: TestClient, enforce: None
) -> None:
    # creator1 의 pending 그룹
    act_as("creator1")
    g1 = _create_group(
        client,
        name="grp1",
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    # creator2 의 pending 그룹 → sysadmin approve → active
    act_as("creator2")
    g2 = _create_group(
        client,
        name="grp2",
        members=[
            {"member_type": "user", "member_id": "u.c"},
            {"member_type": "user", "member_id": "u.d"},
        ],
    ).json()
    act_as(SYSADMIN)
    client.post(f"/api/groups/{g2['id']}/decide", json={"decision": "approve"})

    # sysadmin → 둘 다 보임(pending 포함)
    ids = {g["id"] for g in client.get("/api/groups").json()}
    assert g1["id"] in ids and g2["id"] in ids

    # creator1 → 자기 pending(g1) + active(g2) 보임
    act_as("creator1")
    ids = {g["id"] for g in client.get("/api/groups").json()}
    assert g1["id"] in ids and g2["id"] in ids

    # stranger → active(g2)만, 남의 pending(g1)은 안 보임
    act_as("stranger")
    ids = {g["id"] for g in client.get("/api/groups").json()}
    assert g2["id"] in ids and g1["id"] not in ids


def test_detail_others_pending_404(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g1 = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as("stranger")
    assert client.get(f"/api/groups/{g1['id']}").status_code == 404
    act_as("creator1")
    assert client.get(f"/api/groups/{g1['id']}").status_code == 200


# ── pending queue — sysadmin only ─────────────────────────────


def test_pending_queue_sysadmin_only(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    )
    act_as("stranger")
    assert client.get("/api/groups/pending").status_code == 403
    act_as(SYSADMIN)
    r = client.get("/api/groups/pending")
    assert r.status_code == 200
    assert all(g["status"] == "pending" for g in r.json())


# ── decide — approve/reject/double/non-sysadmin ───────────────


def test_decide_approve_activates(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as(SYSADMIN)
    r = client.post(f"/api/groups/{g['id']}/decide", json={"decision": "approve"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "active"
    assert body["approved_by"] == SYSADMIN
    assert body["approved_at"] is not None


def test_decide_reject(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as(SYSADMIN)
    r = client.post(f"/api/groups/{g['id']}/decide", json={"decision": "reject"})
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"


def test_decide_non_sysadmin_403(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as("creator1")
    assert (
        client.post(
            f"/api/groups/{g['id']}/decide", json={"decision": "approve"}
        ).status_code
        == 403
    )


def test_decide_double_409(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as(SYSADMIN)
    client.post(f"/api/groups/{g['id']}/decide", json={"decision": "approve"})
    r = client.post(f"/api/groups/{g['id']}/decide", json={"decision": "reject"})
    assert r.status_code == 409


# ── members — manager/sysadmin gate, active-only ──────────────


def _create_and_activate(client: TestClient, creator: str = "creator1") -> dict:
    act_as(creator)
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as(SYSADMIN)
    client.post(f"/api/groups/{g['id']}/decide", json={"decision": "approve"})
    return g


def test_add_member_by_manager_200(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("creator1")  # creator is auto-manager
    r = client.post(
        f"/api/groups/{g['id']}/members",
        json={"member_type": "user", "member_id": "u.new"},
    )
    assert r.status_code == 201
    assert any(m["member_id"] == "u.new" for m in r.json()["members"])


def test_add_member_non_manager_403(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("stranger")
    r = client.post(
        f"/api/groups/{g['id']}/members",
        json={"member_type": "user", "member_id": "u.new"},
    )
    assert r.status_code == 403


def test_add_member_pending_group_409(client: TestClient, enforce: None) -> None:
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.a"},
            {"member_type": "user", "member_id": "u.b"},
        ],
    ).json()
    act_as("creator1")  # manager, but group still pending
    r = client.post(
        f"/api/groups/{g['id']}/members",
        json={"member_type": "user", "member_id": "u.new"},
    )
    assert r.status_code == 409


def test_add_member_duplicate_409(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("creator1")
    r = client.post(
        f"/api/groups/{g['id']}/members",
        json={"member_type": "user", "member_id": "u.a"},
    )
    assert r.status_code == 409


def test_remove_member_by_manager(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("creator1")
    detail = client.get(f"/api/groups/{g['id']}").json()
    member_pk = detail["members"][0]["id"]
    r = client.delete(f"/api/groups/{g['id']}/members/{member_pk}")
    assert r.status_code == 200
    assert all(m["id"] != member_pk for m in r.json()["members"])


# ── managers — set replace, ≥1 ────────────────────────────────


def test_set_managers_replace(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("creator1")
    r = client.put(
        f"/api/groups/{g['id']}/managers", json={"managers": ["m1", "m2"]}
    )
    assert r.status_code == 200
    assert set(r.json()["managers"]) == {"m1", "m2"}


def test_set_managers_empty_422(client: TestClient, enforce: None) -> None:
    g = _create_and_activate(client)
    act_as("creator1")
    r = client.put(f"/api/groups/{g['id']}/managers", json={"managers": []})
    assert r.status_code == 422


# ── end-to-end judgment: approved group grant → member gets role ──


def test_end_to_end_group_grant_gives_role(
    client: TestClient, enforce: None
) -> None:
    """create(≥2 members incl user) → approve → grant group editor on a map →
    user-member gets editor; a PENDING group grant gives NO role."""
    seed_employee("u.member", ("Div", "Office", "Team"))

    # 1. 그룹 생성(2 멤버, u.member 포함) → sysadmin approve
    act_as("creator1")
    g = _create_group(
        client,
        members=[
            {"member_type": "user", "member_id": "u.member"},
            {"member_type": "user", "member_id": "u.other"},
        ],
    ).json()
    act_as(SYSADMIN)
    client.post(f"/api/groups/{g['id']}/decide", json={"decision": "approve"})

    # 2. 맵에 그 그룹 editor grant (sysadmin = owner라 게이트 통과)
    map_id = seed_map()
    r = client.post(
        f"/api/maps/{map_id}/permissions",
        json={
            "principal_type": "group",
            "principal_id": str(g["id"]),
            "role": "editor",
        },
    )
    assert r.status_code == 201

    # 3. u.member 는 active 그룹 멤버 → effective_role editor
    assert effective_role_of(map_id, "u.member") == "editor"

    # ── pending 그룹의 grant 는 역할 부여 안 함 ──
    act_as("creator2")
    gp = _create_group(
        client,
        name="pending-grp",
        members=[
            {"member_type": "user", "member_id": "u.member"},
            {"member_type": "user", "member_id": "u.other2"},
        ],
    ).json()
    # 승인하지 않음 — pending 유지
    map2 = seed_map()
    act_as(SYSADMIN)
    r = client.post(
        f"/api/maps/{map2}/permissions",
        json={
            "principal_type": "group",
            "principal_id": str(gp["id"]),
            "role": "editor",
        },
    )
    assert r.status_code == 201
    assert effective_role_of(map2, "u.member") is None  # pending → 무역할


# ── AUTH-OFF 비회귀 (everyone sysadmin) ───────────────────────


def test_auth_off_group_create_and_approve(client: TestClient) -> None:
    r = client.post(
        "/api/groups",
        json={
            "name": "off grp",
            "members": [
                {"member_type": "user", "member_id": "u.a"},
                {"member_type": "user", "member_id": "u.b"},
            ],
        },
    )
    assert r.status_code == 201
    gid = r.json()["id"]
    # AUTH OFF → 전원 sysadmin → pending queue·decide 개방
    assert client.get("/api/groups/pending").status_code == 200
    assert (
        client.post(f"/api/groups/{gid}/decide", json={"decision": "approve"}).status_code
        == 200
    )
