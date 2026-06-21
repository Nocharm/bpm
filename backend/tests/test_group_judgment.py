"""user-group 판정 활성 테스트 (Layer 4 §3a).

ACTIVE user_group + user/department 멤버 + principal_type='group' grant를 직접 시드해
get_effective_role(DB 래퍼)가 그룹 멤버에게 역할을 부여하는지 검증한다.
group API(Task 3b) 없이 ORM으로 직접 insert 한다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import (
    Employee,
    MapPermission,
    MapVersion,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.permissions.access import get_effective_role
from app.settings import settings

DIV = "Management Support Division"
PROC = f"{DIV}/Procurement Office"
SYSADMIN = "admin.sys"


@pytest.fixture(autouse=True)
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON: auth_enabled=True + sysadmin 지정 → 일반 유저는 owner 자동부여 안 됨.

    auth OFF + dev_enforce OFF 기본 스위트에서는 is_sysadmin이 전원 True라 group 판정이
    드러나지 않는다. 이 픽스처로 호출자 역할을 차별화한다(test_permission_gates 동일 패턴).
    """
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys


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


def seed_group_map(
    group_status: str = "active",
    user_members: list[str] | None = None,
    dept_members: list[str] | None = None,
    extra_grants: list[tuple[str, str, str]] | None = None,
) -> tuple[int, int]:
    """그룹 + 멤버 + 맵(group editor grant) 시드. (group_id, map_id) 반환.

    extra_grants 로 동일 맵에 user/department grant를 추가해 우선순위(highest-wins) 검증.
    """

    async def _make(session) -> tuple[int, int]:
        grp = UserGroup(name="proc-group", status=group_status, created_by="seed")
        session.add(grp)
        await session.flush()
        for uid in user_members or []:
            session.add(
                UserGroupMember(group_id=grp.id, member_type="user", member_id=uid)
            )
        for dept in dept_members or []:
            session.add(
                UserGroupMember(
                    group_id=grp.id, member_type="department", member_id=dept
                )
            )

        m = ProcessMap(name="group map", visibility="private", owner_id=None)
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        # group grant — principal_id 는 그룹 id를 문자열로 저장 (Layer-1 규약)
        session.add(
            MapPermission(
                map_id=m.id,
                principal_type="group",
                principal_id=str(grp.id),
                role="editor",
                granted_by="seed",
            )
        )
        for ptype, pid, role in extra_grants or []:
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type=ptype,
                    principal_id=pid,
                    role=role,
                    granted_by="seed",
                )
            )
        return grp.id, m.id

    return _seed(_make)  # type: ignore[return-value]


def role_of(map_id: int, login_id: str) -> str | None:
    async def _get(session) -> str | None:
        return await get_effective_role(session, login_id, map_id)

    return _seed(_get)  # type: ignore[return-value]


# ── 직접 user-멤버 → group grant 적용 ─────────────────────────


def test_user_member_gets_group_role() -> None:
    seed_employee("u.member", (DIV, "Procurement Office", "Sourcing Team 1"))
    _, map_id = seed_group_map(user_members=["u.member"])
    assert role_of(map_id, "u.member") == "editor"


# ── department-멤버(org prefix) → group grant 적용 ────────────


def test_department_member_gets_group_role() -> None:
    # 그룹의 dept 멤버 = Procurement Office; emp는 그 하위 팀 → belongs_to_department True
    seed_employee("u.dept", (DIV, "Procurement Office", "Sourcing Team 1"))
    _, map_id = seed_group_map(dept_members=[PROC])
    assert role_of(map_id, "u.dept") == "editor"


# ── 비멤버 → group grant 미적용 ───────────────────────────────


def test_non_member_no_group_role() -> None:
    seed_employee("u.other", (DIV, "Process Innovation Office", "Process Innovation Team"))
    _, map_id = seed_group_map(user_members=["someone.else"], dept_members=[PROC])
    assert role_of(map_id, "u.other") is None


# ── status='pending' 그룹 → 적용 안 됨 ─────────────────────────


def test_pending_group_grant_not_applied() -> None:
    seed_employee("u.pending", (DIV, "Procurement Office", "Sourcing Team 1"))
    _, map_id = seed_group_map(group_status="pending", user_members=["u.pending"])
    assert role_of(map_id, "u.pending") is None


# ── 우선순위 — group editor vs user viewer → editor (highest-wins) ──


def test_group_grant_competes_highest_wins() -> None:
    seed_employee("u.compete", (DIV, "Procurement Office", "Sourcing Team 1"))
    _, map_id = seed_group_map(
        user_members=["u.compete"],
        extra_grants=[("user", "u.compete", "viewer")],
    )
    # user grant viewer + group grant editor → editor
    assert role_of(map_id, "u.compete") == "editor"


# ── group grant 자체는 저장되지만 멤버십 없는 사용자엔 무역할 (sanity) ──


def test_group_member_row_present() -> None:
    grp_id, _ = seed_group_map(user_members=["u.row"])

    async def _count(session) -> int:
        rows = (
            await session.execute(
                select(UserGroupMember.id).where(UserGroupMember.group_id == grp_id)
            )
        ).all()
        return len(rows)

    assert _seed(_count) == 1
