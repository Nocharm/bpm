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
from app.models import MapApprover, MapPermission, MapVersion, ProcessMap
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
    map_id = seed_map(visibility="private", grants=[("user", "owner.u", "owner")])
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
    created = client.post("/api/maps", json={"name": "off perm map"}).json()
    map_id = created["id"]

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
