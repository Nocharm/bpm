"""고아 참조 미리보기·적용 — 적용 시점 재판정과 결과별 쓰기(바로·점유·새 Draft·승인 요청·알림), 설계 2026-10-23 §5~§8."""

import asyncio
import uuid
from collections.abc import Awaitable, Callable, Iterator
from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import KST
from app.db import SessionLocal
from app.models import (
    ApprovalRequest,
    CategoryPermission,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    Notification,
    ProcessCategory,
    ProcessMap,
    UserGroup,
    UserGroupMember,
    VersionEvent,
)
from app.ref_audit_apply import write_node_values
from app.settings import settings

SYSADMIN = "apply.admin"
# 시드 버전의 updated_at — 적용이 시각을 올렸는지 보려고 과거로 둔다
SEEDED_AT = datetime(2020, 1, 1, tzinfo=KST)


@pytest.fixture
def enforced() -> Iterator[None]:
    prev_enforce, prev_sys = settings.dev_enforce_permissions, settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.dev_enforce_permissions, settings.bpm_sysadmins = prev_enforce, prev_sys


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _as(login: str) -> dict[str, str]:
    return {"X-Dev-User": login}


def _person(login: str, *, name: str | None = None, active: bool = True,
            org: tuple[str, ...] = ()) -> Employee:
    """직원 — 조직 경로가 빈 사용자는 다른 테스트가 남긴 빈 principal 부서 권한에 걸려 범위가 새므로 로그인별 고유 경로."""
    levels = org or (f"Apply Org {login}",)
    return Employee(login_id=login, name=name or login, source="local", active=active,
                    **{f"org_l{i}": level for i, level in enumerate(levels, start=1)})


class _World:
    """테스트 하나의 이름들 — 사라진·살아 있는 부서와 사람(태그로 다른 테스트와 겹치지 않는다)."""

    def __init__(self) -> None:
        tag = _uid()
        self.tag = tag
        self.stale_leaf = f"Gone Team {tag}"
        self.stale_path = f"Gone Div {tag}/Gone Office {tag}/{self.stale_leaf}"
        self.live_levels = (f"Live Div {tag}", f"Live Office {tag}", f"Live Team {tag}")
        self.live_path = "/".join(self.live_levels)
        self.live_leaf = self.live_levels[-1]
        self.actor, self.owner, self.holder = f"act.{tag}", f"own.{tag}", f"hold.{tag}"
        self.member = f"mem.{tag}"
        self.gone, self.new = f"gone.{tag}", f"new.{tag}"
        self.gone_name, self.new_name = f"Gone Person {tag}", f"New Person {tag}"

    def people(self) -> list[Employee]:
        return [
            _person(self.actor), _person(self.owner), _person(self.holder),
            _person(self.new, name=self.new_name), _person(self.member, org=self.live_levels),
            _person(self.gone, name=self.gone_name, active=False),
        ]


async def _new_map(session: AsyncSession, w: _World, name: str, *, owner: str | None = None,
                   **kw: Any) -> ProcessMap:
    """오너 grant까지 갖춘 맵(기본 비공개)."""
    owner = owner or w.owner
    kw.setdefault("visibility", "private")
    m = ProcessMap(name=f"{name} {w.tag}", created_by=owner, owner_id=owner, **kw)
    session.add(m)
    await session.flush()
    session.add(_grant(m, owner, "owner"))
    return m


def _grant(m: ProcessMap, principal: str, role: str, *, kind: str = "user") -> MapPermission:
    return MapPermission(map_id=m.id, principal_type=kind, principal_id=principal, role=role, granted_by="seed")


async def _version(session: AsyncSession, map_id: int, status: str, *, departments: list[str] | None = None,
                   assignees: list[str] | None = None, holder: str | None = None) -> MapVersion:
    version = MapVersion(map_id=map_id, label=f"{status} {_uid()}", status=status, checked_out_by=holder,
                         updated_at=SEEDED_AT)
    session.add(version)
    await session.flush()
    session.add_all(
        Node(id=f"ap-{_uid()}", version_id=version.id, title=f"d{i}", department=department)
        for i, department in enumerate(departments or [])
    )
    session.add_all(
        Node(id=f"ap-{_uid()}", version_id=version.id, title=f"a{i}", assignee=assignee)
        for i, assignee in enumerate(assignees or [])
    )
    return version


def _seed(arrange: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async def _run() -> Any:
        async with SessionLocal() as session:
            out = await arrange(session)
            await session.commit()
            return out

    return asyncio.run(_run())


def _db(read: Callable[..., Awaitable[Any]], *args: Any) -> Any:
    async def _run() -> Any:
        async with SessionLocal() as session:
            return await read(session, *args)

    return asyncio.run(_run())


async def _departments(session: AsyncSession, version_id: int) -> list[str]:
    return list((await session.scalars(
        select(Node.department).where(Node.version_id == version_id, Node.title.like("d%")).order_by(Node.title)
    )).all())


async def _assignees(session: AsyncSession, version_id: int) -> list[str]:
    return list((await session.scalars(
        select(Node.assignee).where(Node.version_id == version_id, Node.title.like("a%")).order_by(Node.title)
    )).all())


async def _version_row(session: AsyncSession, version_id: int) -> MapVersion:
    return await session.get(MapVersion, version_id)


async def _map_row(session: AsyncSession, map_id: int) -> ProcessMap:
    return await session.get(ProcessMap, map_id)


async def _grants(session: AsyncSession, map_id: int) -> list[tuple[str, str, str]]:
    rows = (await session.execute(
        select(MapPermission.principal_type, MapPermission.principal_id, MapPermission.role)
        .where(MapPermission.map_id == map_id)
    )).all()
    return sorted(tuple(row) for row in rows)


async def _requests(session: AsyncSession, map_id: int) -> list[ApprovalRequest]:
    return list((await session.scalars(
        select(ApprovalRequest).where(ApprovalRequest.map_id == map_id).order_by(ApprovalRequest.id)
    )).all())


async def _notifications(session: AsyncSession, recipient: str, kind: str) -> list[Notification]:
    return list((await session.scalars(
        select(Notification).where(Notification.recipient == recipient, Notification.type == kind)
    )).all())


async def _events(session: AsyncSession, version_id: int) -> list[tuple[str, str]]:
    rows = (await session.execute(
        select(VersionEvent.event_type, VersionEvent.actor).where(VersionEvent.version_id == version_id)
    )).all()
    return [tuple(row) for row in rows]


def _body(kind: str, targets: list[tuple[str, str]], *, to_value: str = "", mode: str = "replace") -> dict:
    return {"kind": kind, "mode": mode, "to_value": to_value,
            "targets": [{"target_id": target_id, "from_value": value} for target_id, value in targets]}


def _apply(client: TestClient, login: str, body: dict) -> dict:
    res = client.post("/api/ref-audit/apply", headers=_as(login), json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _preview(client: TestClient, login: str, body: dict) -> list[dict]:
    res = client.post("/api/ref-audit/preview", headers=_as(login), json=body)
    assert res.status_code == 200, res.text
    return res.json()["lines"]


# ── 노드 줄 — 어느 버전에 쓰나(§6) ─────────────────────────────────────────


def test_apply_node_direct_on_my_checkout(client: TestClient, enforced: None) -> None:
    """내가 점유한 Draft에 바로 쓴다 — 게시본은 그대로, 쓴 버전의 updated_at이 오른다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "direct")
        session.add(_grant(m, w.actor, "editor"))
        pub = await _version(session, m.id, "published", departments=[w.stale_leaf])
        draft = await _version(session, m.id, "draft", departments=[w.stale_leaf, w.stale_leaf, w.live_leaf],
                               holder=w.actor)
        return m.id, pub.id, draft.id

    map_id, pub_id, draft_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [(f"node_dept:{map_id}", w.stale_leaf)], to_value=w.live_path))

    assert body == {"places": {"direct": 2}, "drafts": [], "approval_requests": 0, "notified": 0, "skipped": []}
    assert _db(_departments, draft_id) == [w.live_leaf] * 3
    assert _db(_departments, pub_id) == [w.stale_leaf]
    assert _db(_version_row, draft_id).updated_at.year > SEEDED_AT.year


def test_apply_node_takes_unheld_checkout(client: TestClient, enforced: None) -> None:
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "unheld")
        session.add(_grant(m, w.actor, "editor"))
        draft = await _version(session, m.id, "rejected", departments=[w.stale_leaf])
        return m.id, draft.id

    map_id, draft_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [(f"node_dept:{map_id}", w.stale_leaf)], to_value=w.live_path))

    assert body["places"] == {"checkout": 1}
    version = _db(_version_row, draft_id)
    assert version.checked_out_by == w.actor and version.checked_out_at is not None
    assert _db(_departments, draft_id) == [w.live_leaf]


def test_apply_node_creates_reference_cleanup_draft(client: TestClient, enforced: None) -> None:
    """게시본만 있으면 게시본을 복제한 새 Draft(점유=actor, created 이벤트)에 고치고 게시본은 건드리지 않는다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "fresh")
        session.add(_grant(m, w.actor, "editor"))
        pub = await _version(session, m.id, "published", departments=[w.stale_leaf, w.live_leaf])
        return m.id, pub.id

    map_id, pub_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [(f"node_dept:{map_id}", w.stale_leaf)], to_value=w.live_path))

    assert body["places"] == {"new_draft": 1}
    assert len(body["drafts"]) == 1 and body["drafts"][0]["map_id"] == map_id
    draft_id = body["drafts"][0]["version_id"]
    draft = _db(_version_row, draft_id)
    assert (draft.label, draft.status, draft.checked_out_by) == ("Reference cleanup", "draft", w.actor)
    assert _db(_departments, draft_id) == [w.live_leaf, w.live_leaf]
    assert _db(_departments, pub_id) == [w.stale_leaf, w.live_leaf]
    assert _db(_events, draft_id) == [("created", w.actor)]


def test_apply_two_node_lines_share_one_new_draft(client: TestClient, enforced: None) -> None:
    """같은 맵의 노드 줄 둘(한 사람의 두 이름)이 한 요청에 오면 첫 줄이 만든 Draft를 둘째 줄이 다시 쓴다."""
    w = _World()
    other_name = f"탈퇴 {w.tag}"

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "two names")
        session.add(_grant(m, w.actor, "editor"))
        await _version(session, m.id, "published", assignees=[w.gone_name, other_name])
        return m.id

    map_id = _seed(_arrange)
    target = f"node_assignee:{map_id}"

    body = _apply(client, w.actor, _body("user", [(target, w.gone_name), (target, other_name)], to_value=w.new))

    assert body["places"] == {"new_draft": 2} and len(body["drafts"]) == 1
    assert _db(_assignees, body["drafts"][0]["version_id"]) == [w.new_name, w.new_name]


def test_apply_node_held_by_other_sends_holder_notification(client: TestClient, enforced: None) -> None:
    """남이 점유한 Draft는 고치지 않고 점유자에게 알린다(payload as=holder) — 점유를 빼앗지 않는다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "held")
        session.add(_grant(m, w.actor, "editor"))
        draft = await _version(session, m.id, "draft", departments=[w.stale_leaf, w.stale_leaf], holder=w.holder)
        return m.id, draft.id

    map_id, draft_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [(f"node_dept:{map_id}", w.stale_leaf)], to_value=w.live_path))

    assert body["notified"] == 1 and body["places"] == {"notify": 2}
    notes = _db(_notifications, w.holder, "ref_fix_requested")
    assert len(notes) == 1 and notes[0].map_id is None
    payload = notes[0].payload
    assert (payload["actor"], payload["count"], payload["as"]) == (w.actor, 1, "holder")
    entry = payload["maps"][0]
    assert entry["id"] == map_id and entry["name"] == f"held {w.tag}"
    assert (entry["node_dept"], entry["node_assignee"], entry["sp_dept"], entry["owning_dept"]) == (2, 0, 0, 0)
    assert _db(_departments, draft_id) == [w.stale_leaf, w.stale_leaf]
    assert _db(_version_row, draft_id).checked_out_by == w.holder
    assert _db(_notifications, w.actor, "ref_fix_requested") == []


def test_apply_redecides_when_checkout_taken_meanwhile(client: TestClient, enforced: None) -> None:
    """미리보기는 '점유하고 반영'이었어도 그 사이 남이 점유하면 적용 시점 판정(알림)이 이긴다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "race")
        session.add(_grant(m, w.actor, "editor"))
        draft = await _version(session, m.id, "draft", departments=[w.stale_leaf])
        return m.id, draft.id

    map_id, draft_id = _seed(_arrange)
    request = _body("dept", [(f"node_dept:{map_id}", w.stale_leaf)], to_value=w.live_path)
    assert [ln["outcome"] for ln in _preview(client, w.actor, request)] == ["checkout"]

    async def _take(session: AsyncSession) -> None:
        (await session.get(MapVersion, draft_id)).checked_out_by = w.holder

    _seed(_take)
    body = _apply(client, w.actor, request)

    assert body["places"] == {"notify": 1} and body["notified"] == 1
    assert _db(_version_row, draft_id).checked_out_by == w.holder
    assert _db(_departments, draft_id) == [w.stale_leaf]


def test_apply_skips_already_fixed_line(client: TestClient, enforced: None) -> None:
    """이미 고쳐진 줄·값이 다른 줄은 already_changed로 건너뛴다 — 422가 아니다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "fixed")
        session.add(_grant(m, w.actor, "editor"))
        await _version(session, m.id, "published", departments=[])
        await _version(session, m.id, "draft", departments=[w.stale_leaf], holder=w.actor)
        return m.id

    map_id = _seed(_arrange)
    target = f"node_dept:{map_id}"
    request = _body("dept", [(target, w.stale_leaf)], to_value=w.live_path)
    assert _apply(client, w.actor, request)["places"] == {"direct": 1}

    again = _apply(client, w.actor, request)
    other = _apply(client, w.actor, _body("dept", [(target, f"Other Team {w.tag}")], to_value=w.live_path))

    assert again["places"] == {} and again["skipped"] == [{"target_id": target, "reason": "already_changed"}]
    assert other["skipped"] == [{"target_id": target, "reason": "already_changed"}]


def test_apply_skips_target_outside_actor_scope(client: TestClient, enforced: None) -> None:
    """평소 고칠 수 없는 맵의 줄은 out_of_scope로 건너뛰고 아무것도 쓰지 않는다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "not mine", sp_department=w.stale_leaf)
        draft = await _version(session, m.id, "draft", departments=[w.stale_leaf])
        owner_grant = await session.scalar(select(MapPermission.id).where(MapPermission.map_id == m.id))
        return m.id, draft.id, owner_grant

    map_id, draft_id, owner_grant_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [
        (f"sp_dept:{map_id}", w.stale_leaf), (f"node_dept:{map_id}", w.stale_leaf),
        (f"map_grant:{owner_grant_id}", w.stale_path),
    ], to_value=w.live_path))

    assert body["places"] == {}
    assert sorted(s["reason"] for s in body["skipped"]) == ["out_of_scope"] * 3
    assert _db(_map_row, map_id).sp_department == w.stale_leaf
    assert _db(_departments, draft_id) == [w.stale_leaf]


# ── 설정류 줄 ─────────────────────────────────────────────────────────────


def _seed_collab(w: _World, *, pending_request: bool = False) -> tuple[int, int]:
    """퇴직자 editor grant + 재직 승인자가 있는 맵 → (map_id, 퇴직자 grant id)."""

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "collab")
        gone_grant = _grant(m, w.gone, "editor")
        session.add_all([_grant(m, w.actor, "editor"), gone_grant, MapApprover(map_id=m.id, user_id=w.holder)])
        await session.flush()
        if pending_request:
            session.add(ApprovalRequest(map_id=m.id, kind="permission_downgrade", requested_by=w.actor,
                                        status="pending", payload={
                                            "permission_id": gone_grant.id, "principal_type": "user",
                                            "principal_id": w.gone, "from_role": "editor", "to_role": None}))
        return m.id, gone_grant.id

    return _seed(_arrange)


def test_apply_collab_editor_by_editor_creates_approval_request(client: TestClient, enforced: None) -> None:
    """Editor가 퇴직자 editor grant를 대체하면 새 grant는 바로 생기고 옛 grant 제거는 승인 요청으로 올라간다."""
    w = _World()
    map_id, grant_id = _seed_collab(w)

    body = _apply(client, w.actor, _body("user", [(f"map_collab:{grant_id}", w.gone)], to_value=w.new))

    assert body["approval_requests"] == 1 and body["places"] == {"approval": 1}
    grants = _db(_grants, map_id)
    assert ("user", w.new, "editor") in grants and ("user", w.gone, "editor") in grants
    requests = _db(_requests, map_id)
    assert len(requests) == 1
    req = requests[0]
    assert (req.kind, req.status, req.requested_by) == ("permission_downgrade", "pending", w.actor)
    assert req.payload["permission_id"] == grant_id and req.payload["to_role"] is None
    assert len(_db(_notifications, w.holder, "permission_requested")) == 1


def test_apply_collab_editor_by_owner_direct(client: TestClient, enforced: None) -> None:
    """오너는 바로 대체한다 — 같은 grant에 걸린 대기 다운그레이드 요청은 평소 라우터처럼 superseded."""
    w = _World()
    map_id, grant_id = _seed_collab(w, pending_request=True)

    body = _apply(client, w.owner, _body("user", [(f"map_collab:{grant_id}", w.gone)], to_value=w.new))

    assert body["places"] == {"direct": 1} and body["approval_requests"] == 0
    grants = _db(_grants, map_id)
    assert ("user", w.new, "editor") in grants and all(g[1] != w.gone for g in grants)
    assert [r.status for r in _db(_requests, map_id)] == ["superseded"]
    assert len(_db(_notifications, w.actor, "permission_superseded")) == 1


def test_apply_approver_in_approval_skipped_for_sysadmin(client: TestClient, enforced: None) -> None:
    """결재 중 승인자 변경은 sysadmin에게도 잠김 — 건너뛰고 승인자는 그대로."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "in approval")
        session.add(MapApprover(map_id=m.id, user_id=w.gone))
        await _version(session, m.id, "published")
        await _version(session, m.id, "pending")
        return m.id

    map_id = _seed(_arrange)

    body = _apply(client, SYSADMIN, _body("user", [(f"map_approver:{map_id}", w.gone)], to_value=w.new))

    assert body["places"] == {}
    assert body["skipped"] == [{"target_id": f"map_approver:{map_id}", "reason": "in_approval"}]

    async def _approvers(session: AsyncSession) -> list[str]:
        return list((await session.scalars(select(MapApprover.user_id).where(MapApprover.map_id == map_id))).all())

    assert _db(_approvers) == [w.gone]


def test_apply_merges_duplicate_grant_keeping_higher_role(client: TestClient, enforced: None) -> None:
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "merge")
        gone = _grant(m, w.stale_path, "editor", kind="department")
        session.add_all([gone, _grant(m, w.live_path, "viewer", kind="department")])
        await session.flush()
        return m.id, gone.id

    map_id, gone_id = _seed(_arrange)

    body = _apply(client, w.owner, _body("dept", [(f"map_grant:{gone_id}", w.stale_path)], to_value=w.live_path))

    assert body["places"] == {"direct": 1}
    assert [g for g in _db(_grants, map_id) if g[0] == "department"] == [("department", w.live_path, "editor")]


def test_apply_grant_replace_skips_grant_the_router_would_refuse(client: TestClient, enforced: None) -> None:
    """공개 맵 viewer·오우닝 부서 대상은 평소에도 grant로 줄 수 없다 — 옛 grant 제거만 일어난다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> dict[str, int]:
        session.add_all(w.people())
        public = await _new_map(session, w, "public", visibility="public")
        owning = await _new_map(session, w, "owning", owning_department=w.live_path)
        viewer = _grant(public, w.gone, "viewer")
        dept = _grant(owning, w.stale_path, "editor", kind="department")
        session.add_all([viewer, dept])
        await session.flush()
        return {"public": public.id, "owning": owning.id, "viewer": viewer.id, "dept": dept.id}

    ids = _seed(_arrange)

    user = _apply(client, w.owner, _body("user", [(f"map_collab:{ids['viewer']}", w.gone)], to_value=w.new))
    dept = _apply(client, w.owner, _body("dept", [(f"map_grant:{ids['dept']}", w.stale_path)], to_value=w.live_path))

    assert user["places"] == {"direct": 1} and dept["places"] == {"direct": 1}
    assert _db(_grants, ids["public"]) == [("user", w.owner, "owner")]
    assert _db(_grants, ids["owning"]) == [("user", w.owner, "owner")]


def test_apply_settings_lines_by_editor_notify_owner_once(client: TestClient, enforced: None) -> None:
    """Editor는 오너 몫(주관 부서·SP 부서)을 고치지 않고 오너에게 한 건으로 알린다(as=owner, 소스별 곳 수)."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "owner fixes", owning_department=w.stale_path, sp_department=w.stale_leaf)
        session.add(_grant(m, w.actor, "editor"))
        return m.id

    map_id = _seed(_arrange)

    body = _apply(client, w.actor, _body("dept", [
        (f"owning_dept:{map_id}", w.stale_path), (f"sp_dept:{map_id}", w.stale_leaf),
    ], to_value=w.live_path))

    assert body["places"] == {"notify": 2} and body["notified"] == 1
    notes = _db(_notifications, w.owner, "ref_fix_requested")
    assert len(notes) == 1 and notes[0].payload["as"] == "owner"
    entry = notes[0].payload["maps"][0]
    assert (entry["id"], entry["owning_dept"], entry["sp_dept"]) == (map_id, 1, 1)
    m = _db(_map_row, map_id)
    assert (m.owning_department, m.sp_department) == (w.stale_path, w.stale_leaf)


def test_apply_sp_dept_writes_leaf_and_stamps(client: TestClient, enforced: None) -> None:
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        return (await _new_map(session, w, "sp dept", sp_department=w.stale_leaf)).id

    map_id = _seed(_arrange)

    body = _apply(client, SYSADMIN, _body("dept", [(f"sp_dept:{map_id}", w.stale_leaf)], to_value=w.live_path))

    assert body["places"] == {"direct": 1}
    m = _db(_map_row, map_id)
    assert (m.sp_department, m.sp_changed_by) == (w.live_leaf, SYSADMIN)


def test_apply_owner_replace_deletes_departed_grant(client: TestClient, enforced: None) -> None:
    """퇴직 오너 → 새 오너: 옛 오너 grant는 지우고 새 오너 grant는 owner, 그 grant의 대기 요청은 superseded."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "departed owner", owner=w.gone)
        new_grant = _grant(m, w.new, "editor")
        session.add(new_grant)
        await session.flush()
        session.add(ApprovalRequest(map_id=m.id, kind="permission_downgrade", requested_by=w.actor,
                                    status="pending", payload={
                                        "permission_id": new_grant.id, "principal_type": "user",
                                        "principal_id": w.new, "from_role": "editor", "to_role": None}))
        return m.id

    map_id = _seed(_arrange)

    body = _apply(client, SYSADMIN, _body("user", [(f"map_owner:{map_id}", w.gone)], to_value=w.new))

    assert body["places"] == {"direct": 1}
    assert _db(_map_row, map_id).owner_id == w.new
    assert _db(_grants, map_id) == [("user", w.new, "owner")]
    assert [r.status for r in _db(_requests, map_id)] == ["superseded"]
    notes = [n for n in _db(_notifications, w.new, "owner_assigned") if n.map_id == map_id]
    assert len(notes) == 1 and notes[0].payload["from_name"] == w.gone_name


def test_apply_user_settings_lines_direct_for_sysadmin(client: TestClient, enforced: None) -> None:
    """승인자·그룹 멤버·카테고리 권한자·SP 담당자 — sysadmin은 한 요청으로 바로 대체한다(SP 담당자는 직원 이름으로)."""
    w = _World()

    async def _arrange(session: AsyncSession) -> dict[str, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "settings", sp_assignee=f"Ann {w.tag}, {w.gone_name}")
        group = UserGroup(name=f"apply group {w.tag}", status="active", created_by=w.owner)
        category = ProcessCategory(code=f"AP-{w.tag}", name=f"Apply Cat {w.tag}", level=1)
        session.add_all([group, category, MapApprover(map_id=m.id, user_id=w.gone)])
        await session.flush()
        member = UserGroupMember(group_id=group.id, member_type="user", member_id=w.gone)
        perm = CategoryPermission(category_id=category.id, principal_type="user", principal_id=w.gone,
                                  granted_by="seed")
        session.add_all([member, perm])
        await session.flush()
        return {"map": m.id, "group": group.id, "member": member.id, "category": category.id, "perm": perm.id}

    ids = _seed(_arrange)

    body = _apply(client, SYSADMIN, _body("user", [
        (f"map_approver:{ids['map']}", w.gone), (f"group_user:{ids['member']}", w.gone),
        (f"category_perm:{ids['perm']}", w.gone), (f"sp_assignee:{ids['map']}", w.gone_name),
    ], to_value=w.new))

    assert body["places"] == {"direct": 4} and body["skipped"] == []

    async def _state(session: AsyncSession) -> tuple[list[str], list[str], list[str]]:
        approvers = (await session.scalars(select(MapApprover.user_id).where(MapApprover.map_id == ids["map"]))).all()
        members = (await session.scalars(
            select(UserGroupMember.member_id).where(UserGroupMember.group_id == ids["group"]))).all()
        perms = (await session.scalars(
            select(CategoryPermission.principal_id).where(CategoryPermission.category_id == ids["category"]))).all()
        return list(approvers), list(members), list(perms)

    assert _db(_state) == ([w.new], [w.new], [w.new])
    assert _db(_map_row, ids["map"]).sp_assignee == f"Ann {w.tag}, {w.new_name}"


# ── 검증 — 쓰기 전에 요청 전체를 거부 ────────────────────────────────────


def test_apply_remove_blocked_source_422(client: TestClient, enforced: None) -> None:
    """오너·주관 부서·SP 부서는 제거할 수 없다 — 미리보기도 같은 검증."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "blocked", owner=w.gone, owning_department=w.stale_path,
                           sp_department=w.stale_leaf)
        return m.id

    map_id = _seed(_arrange)
    bodies = [
        _body("user", [(f"map_owner:{map_id}", w.gone)], mode="remove"),
        _body("dept", [(f"owning_dept:{map_id}", w.stale_path)], mode="remove"),
        _body("dept", [(f"sp_dept:{map_id}", w.stale_leaf)], mode="remove"),
    ]

    for request in bodies:
        assert client.post("/api/ref-audit/apply", headers=_as(SYSADMIN), json=request).status_code == 422
        assert client.post("/api/ref-audit/preview", headers=_as(SYSADMIN), json=request).status_code == 422
    m = _db(_map_row, map_id)
    assert (m.owner_id, m.owning_department, m.sp_department) == (w.gone, w.stale_path, w.stale_leaf)


def test_apply_invalid_to_value_422_no_partial(client: TestClient, enforced: None) -> None:
    """대체 값이 현재 부서가 아니거나 다른 종류의 줄이 섞이면 요청 전체 422 — 유효한 줄도 쓰지 않는다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "invalid", owning_department=w.stale_path, sp_department=w.stale_leaf)
        collab = _grant(m, w.gone, "viewer")
        session.add(collab)
        await session.flush()
        return m.id, collab.id

    map_id, collab_id = _seed(_arrange)
    valid_targets = [(f"sp_dept:{map_id}", w.stale_leaf), (f"owning_dept:{map_id}", w.stale_path)]

    bad_value = _body("dept", valid_targets, to_value=f"Nowhere {w.tag}/Nope")
    mixed_kind = _body("dept", [*valid_targets, (f"map_collab:{collab_id}", w.gone)], to_value=w.live_path)
    empty_value = _body("dept", valid_targets)

    for request in (bad_value, mixed_kind, empty_value):
        res = client.post("/api/ref-audit/apply", headers=_as(w.owner), json=request)
        assert res.status_code == 422, res.text
    m = _db(_map_row, map_id)
    assert (m.owning_department, m.sp_department) == (w.stale_path, w.stale_leaf)


# ── 노드 값 쓰기 ──────────────────────────────────────────────────────────


def _seed_assignee_version(w: _World, assignees: list[str]) -> int:
    async def _arrange(session: AsyncSession) -> int:
        m = await _new_map(session, w, "assignees")
        return (await _version(session, m.id, "draft", assignees=assignees)).id

    return _seed(_arrange)


def _write(version_id: int, from_value: str, to_name: str, mode: str) -> int:
    async def _run(session: AsyncSession) -> int:
        changed = await write_node_values(session, version_id, "node_assignee", from_value, to_name, mode)
        await session.commit()
        return changed

    return _db(_run)


def test_node_assignee_replace_dedupes(client: TestClient) -> None:
    """바꾼 이름이 이미 목록에 있으면 하나로 합치고 순서는 지킨다."""
    w = _World()
    ann = f"Ann {w.tag}"
    version_id = _seed_assignee_version(w, [
        f"{w.gone_name}, {w.new_name}", f"{ann}, {w.gone_name}, {w.new_name}, {w.gone_name}",
    ])

    assert _write(version_id, w.gone_name, w.new_name, "replace") == 2
    assert _db(_assignees, version_id) == [w.new_name, f"{ann}, {w.new_name}"]


def test_node_assignee_replace_touches_only_from_value(client: TestClient) -> None:
    """from 이름만 바꾸거나 뺀다 — 다른 낡은 이름과 from이 없는 노드는 원문 그대로."""
    w = _World()
    other = f"Other Gone {w.tag}"
    untouched = f"{other},{w.new_name}"
    version_id = _seed_assignee_version(w, [f"{w.gone_name}, {other}", untouched, ""])

    assert _write(version_id, w.gone_name, w.new_name, "replace") == 1
    assert _db(_assignees, version_id) == [f"{w.new_name}, {other}", untouched, ""]

    assert _write(version_id, other, "", "remove") == 2
    assert _db(_assignees, version_id) == [w.new_name, w.new_name, ""]


# ── 미리보기 ──────────────────────────────────────────────────────────────


def test_preview_reports_not_eligible_owner_target(client: TestClient, enforced: None) -> None:
    """새 오너는 오너 이전 후보(editor 이상 ∪ 주관 부서 소속)여야 한다 — 아니면 그 줄만 not_eligible. 쓰기 없음."""
    w = _World()

    async def _arrange(session: AsyncSession) -> int:
        session.add_all(w.people())
        m = await _new_map(session, w, "owner pick", owner=w.gone, owning_department=w.live_path)
        session.add(_grant(m, w.new, "editor"))
        return m.id

    map_id = _seed(_arrange)
    target = [(f"map_owner:{map_id}", w.gone)]

    outsider = _preview(client, SYSADMIN, _body("user", target, to_value=w.holder))
    editor = _preview(client, SYSADMIN, _body("user", target, to_value=w.new))
    dept_member = _preview(client, SYSADMIN, _body("user", target, to_value=w.member))

    assert outsider == [{"target_id": f"map_owner:{map_id}", "outcome": "locked", "reason": "not_eligible",
                         "notify_to": None, "warning": None}]
    assert editor[0]["outcome"] == "direct" and dept_member[0]["outcome"] == "direct"
    assert _db(_map_row, map_id).owner_id == w.gone


def test_preview_reports_no_access_warning(client: TestClient, enforced: None) -> None:
    """노드 담당자 대체 값이 그 맵을 못 보는 사람이면 판정은 그대로 두고 no_access 경고를 싣는다."""
    w = _World()

    async def _arrange(session: AsyncSession) -> tuple[int, int]:
        session.add_all(w.people())
        m = await _new_map(session, w, "no access")
        session.add(_grant(m, w.actor, "editor"))
        draft = await _version(session, m.id, "draft", assignees=[w.gone_name], holder=w.actor)
        return m.id, draft.id

    map_id, draft_id = _seed(_arrange)
    target = [(f"node_assignee:{map_id}", w.gone_name)]

    blind = _preview(client, w.actor, _body("user", target, to_value=w.holder))
    seeing = _preview(client, w.actor, _body("user", target, to_value=w.owner))

    assert blind == [{"target_id": f"node_assignee:{map_id}", "outcome": "direct", "reason": None,
                      "notify_to": None, "warning": "no_access"}]
    assert seeing[0]["warning"] is None
    assert _db(_assignees, draft_id) == [w.gone_name]
