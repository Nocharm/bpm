"""고아 참조 줄별 평소 권한 판정 — actor 범위·결과 판정표(설계 2026-10-23 §4~§6)·사실 일괄 로드."""

import asyncio
import uuid
from collections.abc import Iterator
from datetime import datetime
from typing import Any

import pytest
from sqlalchemy import delete, event

from app import ref_audit_policy as policy
from app.db import SessionLocal, engine
from app.models import (
    ApprovalRequest,
    CategoryPermission,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessCategory,
    ProcessMap,
    UserGroup,
    UserGroupManager,
)
from app.ref_audit import NodeTarget, RefLine
from app.settings import settings

MAP_ID = 1
ACTOR = "actor.kim"
OWNER = "owner.park"
HOLDER = "holder.choi"
GONE = "gone.user"
GRANT_ID = 7
GROUP_ID = 5
SYSADMIN = "policy.admin"


# ── 순수 판정표 — decide는 DB 없이 줄·범위·사실만으로 판정한다 ──────────────


def _line(source: str, *, target_id: str | None = None, pending: bool = False,
          map_id: int | None = MAP_ID, group_id: int | None = None,
          category_id: int | None = None) -> RefLine:
    """테스트 줄 — RefLine 생성을 한 곳에 모은다(필드 변경 시 여기만 고친다)."""
    return RefLine(
        source=source, count=1, target_id=target_id or f"{source}:{MAP_ID}",
        map_id=map_id, group_id=group_id, category_id=category_id, pending=pending, from_value=GONE,
    )


def _grant_line(source: str = "map_collab") -> RefLine:
    return _line(source, target_id=f"{source}:{GRANT_ID}")


def _scope(role: str | None = "editor", *, sysadmin: bool = False) -> policy.ActorScope:
    if sysadmin:
        role = "owner"
    return policy.ActorScope(
        login_id=ACTOR, is_sysadmin=sysadmin, roles={MAP_ID: role} if role else {},
        managed_group_ids=set(), manageable_category_ids=set(),
    )


def _map(*, mode: str = "normal", owner_id: str | None = OWNER,
         created_by: str | None = OWNER) -> ProcessMap:
    return ProcessMap(id=MAP_ID, name="map", mode=mode, visibility="private",
                      owner_id=owner_id, created_by=created_by, owning_department="Dept A")


def _grant(*, role: str = "editor", principal_type: str = "user") -> MapPermission:
    principal = GONE if principal_type == "user" else "Old Division/Old Team"
    return MapPermission(id=GRANT_ID, map_id=MAP_ID, principal_type=principal_type,
                         principal_id=principal, role=role, granted_by=OWNER)


def _target(*, working_status: str | None = "draft", holder: str | None = None) -> NodeTarget:
    working_id = 20 if working_status else None
    return NodeTarget(map_id=MAP_ID, published_id=10, working_id=working_id,
                      working_status=working_status, checked_out_by=holder)


def _ctx(**overrides: Any) -> policy.DecisionContext:
    fields: dict[str, Any] = {
        "maps": {MAP_ID: _map()},
        "grants": {GRANT_ID: _grant()},
        "in_approval_map_ids": set(),
        "active_approvers": {MAP_ID: ["appr"]},
        "pending_downgrades": set(),
        "workflow_pairs": set(),
        "actor_pending_downgrade_map_ids": set(),
        "node_targets": {MAP_ID: _target()},
        "display_names": {OWNER: "Owner Park", HOLDER: "Holder Choi", ACTOR: "Actor Kim"},
        "active_logins": {OWNER, HOLDER, ACTOR},
        "group_statuses": {GROUP_ID: "active"},
    }
    fields.update(overrides)
    return policy.DecisionContext(**fields)


OWNER_NOTICE = policy.NotifyTo(id=OWNER, name="Owner Park", role="owner")


@pytest.mark.parametrize("source", ["map_collab", "map_grant"])
@pytest.mark.parametrize("scope", [_scope("editor"), _scope("owner"), _scope(sysadmin=True)])
def test_decide_collab_viewer_grant_direct_for_editor(source: str, scope: policy.ActorScope) -> None:
    principal_type = "user" if source == "map_collab" else "department"
    ctx = _ctx(grants={GRANT_ID: _grant(role="viewer", principal_type=principal_type)})
    assert policy.decide(_grant_line(source), scope, ctx) == policy.Decision("direct")


@pytest.mark.parametrize("source", ["map_collab", "map_grant"])
@pytest.mark.parametrize(("scope", "outcome"), [
    (_scope("editor"), "approval"),
    (_scope("owner"), "direct"),
    (_scope(sysadmin=True), "direct"),
])
def test_decide_collab_editor_grant_approval_for_editor_direct_for_owner(
    source: str, scope: policy.ActorScope, outcome: str
) -> None:
    principal_type = "user" if source == "map_collab" else "department"
    ctx = _ctx(grants={GRANT_ID: _grant(role="editor", principal_type=principal_type)})
    assert policy.decide(_grant_line(source), scope, ctx) == policy.Decision(outcome)


@pytest.mark.parametrize("grant_role", ["viewer", "editor"])
@pytest.mark.parametrize("scope", [_scope("editor"), _scope("owner"), _scope(sysadmin=True)])
def test_decide_collab_departed_in_workflow_locked(grant_role: str, scope: policy.ActorScope) -> None:
    ctx = _ctx(grants={GRANT_ID: _grant(role=grant_role)}, workflow_pairs={(MAP_ID, GONE)})
    decision = policy.decide(_grant_line(), scope, ctx)
    assert decision.outcome == "locked" and decision.reason == "in_workflow"


@pytest.mark.parametrize("source", ["map_collab", "map_grant"])
@pytest.mark.parametrize("grant_role", ["editor", "viewer"])
def test_decide_collab_request_pending_locked(source: str, grant_role: str) -> None:
    principal_type = "user" if source == "map_collab" else "department"
    ctx = _ctx(grants={GRANT_ID: _grant(role=grant_role, principal_type=principal_type)},
               pending_downgrades={(MAP_ID, GRANT_ID)})
    decision = policy.decide(_grant_line(source), _scope("editor"), ctx)
    assert decision.outcome == "locked" and decision.reason == "request_pending"


@pytest.mark.parametrize("source", ["map_collab", "map_grant"])
@pytest.mark.parametrize("scope", [_scope("owner"), _scope(sysadmin=True)])
def test_decide_collab_request_pending_owner_direct(source: str, scope: policy.ActorScope) -> None:
    # 평소 delete_permission처럼 오너의 직접 적용은 대기 요청을 대체한다(적용 단계가 supersede)
    principal_type = "user" if source == "map_collab" else "department"
    ctx = _ctx(grants={GRANT_ID: _grant(role="editor", principal_type=principal_type)},
               pending_downgrades={(MAP_ID, GRANT_ID)})
    assert policy.decide(_grant_line(source), scope, ctx) == policy.Decision("direct")


@pytest.mark.parametrize("scope", [_scope("editor"), _scope("owner"), _scope(sysadmin=True)])
def test_decide_collab_owner_grant_locked_owner_left(scope: policy.ActorScope) -> None:
    ctx = _ctx(grants={GRANT_ID: _grant(role="owner")})
    decision = policy.decide(_grant_line(), scope, ctx)
    assert decision.outcome == "locked" and decision.reason == "owner_left"


def test_decide_approval_without_active_approver_notifies_owner() -> None:
    ctx = _ctx(active_approvers={MAP_ID: []})
    decision = policy.decide(_grant_line(), _scope("editor"), ctx)
    assert decision.outcome == "notify"
    assert decision.notify_to == OWNER_NOTICE and decision.notify_to.role == "owner"


@pytest.mark.parametrize(("scope", "outcome", "reason"), [
    (_scope("editor"), "locked", "owner_left"),
    (_scope("owner"), "direct", None),
    (_scope(sysadmin=True), "direct", None),
])
def test_decide_owner_line_owner_left_for_editor(
    scope: policy.ActorScope, outcome: str, reason: str | None
) -> None:
    assert policy.decide(_line("map_owner"), scope, _ctx()) == policy.Decision(outcome, reason=reason)


@pytest.mark.parametrize(("candidates", "outcome", "reason"), [
    (set(), "locked", "not_eligible"),
    ({MAP_ID}, "direct", None),
])
def test_decide_owner_line_not_eligible_target(
    candidates: set[int], outcome: str, reason: str | None
) -> None:
    ctx = _ctx(to_value="new.owner", owner_candidate_map_ids=candidates)
    decision = policy.decide(_line("map_owner"), _scope(sysadmin=True), ctx, to_value="new.owner")
    assert decision == policy.Decision(outcome, reason=reason)
    # 값 없이(GET) 판정하면 후보 검사는 하지 않는다
    assert policy.decide(_line("map_owner"), _scope(sysadmin=True), ctx).outcome == "direct"


@pytest.mark.parametrize("scope", [_scope("editor"), _scope("owner"), _scope(sysadmin=True)])
def test_decide_approver_in_approval_locked_even_for_sysadmin(scope: policy.ActorScope) -> None:
    decision = policy.decide(_line("map_approver"), scope, _ctx(in_approval_map_ids={MAP_ID}))
    assert decision.outcome == "locked" and decision.reason == "in_approval"


@pytest.mark.parametrize(("scope", "expected"), [
    (_scope("editor"), policy.Decision("notify", notify_to=OWNER_NOTICE)),
    (_scope("owner"), policy.Decision("direct")),
])
def test_decide_approver_editor_notifies_owner(scope: policy.ActorScope, expected: policy.Decision) -> None:
    assert policy.decide(_line("map_approver"), scope, _ctx()) == expected


@pytest.mark.parametrize("source", ["owning_dept", "sp_dept", "sp_assignee"])
@pytest.mark.parametrize(("scope", "expected"), [
    (_scope("editor"), policy.Decision("notify", notify_to=OWNER_NOTICE)),
    (_scope("owner"), policy.Decision("direct")),
    (_scope(sysadmin=True), policy.Decision("direct")),
])
def test_decide_owning_dept_and_sp_editor_notify_owner_direct_owner(
    source: str, scope: policy.ActorScope, expected: policy.Decision
) -> None:
    assert policy.decide(_line(source), scope, _ctx()) == expected


NODE_SOURCES = ["node_dept", "node_assignee"]
ALL_ROLES = [_scope("editor"), _scope("owner"), _scope(sysadmin=True)]


@pytest.mark.parametrize("source", NODE_SOURCES)
@pytest.mark.parametrize("scope", ALL_ROLES)
def test_decide_node_no_working_new_draft(source: str, scope: policy.ActorScope) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(working_status=None)})
    assert policy.decide(_line(source), scope, ctx) == policy.Decision("new_draft")


@pytest.mark.parametrize("source", NODE_SOURCES)
@pytest.mark.parametrize("status", ["draft", "rejected"])
def test_decide_node_mine_direct(source: str, status: str) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(working_status=status, holder=ACTOR)})
    assert policy.decide(_line(source), _scope("editor"), ctx) == policy.Decision("direct")


@pytest.mark.parametrize("source", NODE_SOURCES)
@pytest.mark.parametrize("scope", ALL_ROLES)
def test_decide_node_unheld_checkout(source: str, scope: policy.ActorScope) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(holder=None)})
    assert policy.decide(_line(source), scope, ctx) == policy.Decision("checkout")


def test_decide_node_actor_pending_downgrade_locked() -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(holder=None)}, actor_pending_downgrade_map_ids={MAP_ID})
    decision = policy.decide(_line("node_dept"), _scope("editor"), ctx)
    assert decision.outcome == "locked" and decision.reason == "request_pending"


@pytest.mark.parametrize("source", NODE_SOURCES)
@pytest.mark.parametrize("scope", ALL_ROLES)
def test_decide_node_held_by_other_notifies_holder(source: str, scope: policy.ActorScope) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(holder=HOLDER)})
    decision = policy.decide(_line(source), scope, ctx)
    assert decision.outcome == "notify"
    assert decision.notify_to == policy.NotifyTo(id=HOLDER, name="Holder Choi", role="holder")


def test_decide_node_held_by_departed_locked_in_workflow() -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(holder=GONE)})
    decision = policy.decide(_line("node_assignee"), _scope(sysadmin=True), ctx)
    assert decision.outcome == "locked" and decision.reason == "in_workflow"


@pytest.mark.parametrize("status", ["pending", "approved"])
@pytest.mark.parametrize("holder", [None, ACTOR, HOLDER])
def test_decide_node_in_approval_locked(status: str, holder: str | None) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(working_status=status, holder=holder)})
    decision = policy.decide(_line("node_dept"), _scope(sysadmin=True), ctx)
    assert decision.outcome == "locked" and decision.reason == "in_approval"


@pytest.mark.parametrize("source", NODE_SOURCES)
@pytest.mark.parametrize("scope", ALL_ROLES)
def test_decide_node_pending_line_pending(source: str, scope: policy.ActorScope) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(working_status="pending", holder=HOLDER)})
    assert policy.decide(_line(source, pending=True), scope, ctx) == policy.Decision("pending")


@pytest.mark.parametrize("line", [
    _grant_line("map_collab"), _grant_line("map_grant"), _line("map_owner"), _line("map_approver"),
    _line("owning_dept"), _line("sp_dept"), _line("sp_assignee"), _line("node_dept"),
    _line("node_assignee"), _line("node_dept", pending=True),
])
def test_decide_framework_map_locked(line: RefLine) -> None:
    ctx = _ctx(maps={MAP_ID: _map(mode="framework")})
    decision = policy.decide(line, _scope(sysadmin=True), ctx)
    assert decision.outcome == "locked" and decision.reason == "framework"


@pytest.mark.parametrize("line", [
    _line("map_approver"), _line("owning_dept"), _line("sp_dept"), _line("sp_assignee"), _grant_line(),
])
@pytest.mark.parametrize("owner", [
    {"owner_id": "left.owner", "created_by": "left.owner"},
    {"owner_id": None, "created_by": None},
])
def test_decide_notify_without_owner_locked_owner_left(line: RefLine, owner: dict[str, None | str]) -> None:
    ctx = _ctx(maps={MAP_ID: _map(**owner)}, active_approvers={MAP_ID: []})
    decision = policy.decide(line, _scope("editor"), ctx)
    assert decision.outcome == "locked" and decision.reason == "owner_left"


def test_decide_notify_falls_back_to_creator_when_owner_unset() -> None:
    ctx = _ctx(maps={MAP_ID: _map(owner_id=None, created_by=OWNER)})
    assert policy.decide(_line("sp_dept"), _scope("editor"), ctx).notify_to == OWNER_NOTICE


@pytest.mark.parametrize(("source", "viewable", "warning"), [
    ("node_assignee", set(), "no_access"),
    ("node_assignee", {MAP_ID}, None),
    ("node_dept", set(), None),
])
def test_decide_node_assignee_no_access_warning(source: str, viewable: set[int], warning: str | None) -> None:
    ctx = _ctx(node_targets={MAP_ID: _target(holder=None)}, to_value="new.user",
               to_value_viewable_map_ids=viewable)
    decision = policy.decide(_line(source), _scope("editor"), ctx, to_value="new.user")
    assert decision == policy.Decision("checkout", warning=warning)
    # 아무것도 쓰지 않는 줄(알림·잠김·게시 대기)엔 경고를 싣지 않는다
    held = _ctx(node_targets={MAP_ID: _target(holder=HOLDER)}, to_value="new.user")
    assert policy.decide(_line(source), _scope("editor"), held, to_value="new.user").warning is None


@pytest.mark.parametrize("line", [
    _line("group_member", target_id="group_member:5", map_id=None, group_id=GROUP_ID),
    _line("group_user", target_id="group_user:6", map_id=None, group_id=GROUP_ID),
    _line("category_perm", target_id="category_perm:8", map_id=None, category_id=3),
])
def test_decide_group_and_category_lines_direct(line: RefLine) -> None:
    assert policy.decide(line, _scope(None), _ctx()) == policy.Decision("direct")


@pytest.mark.parametrize("source", ["group_member", "group_user"])
@pytest.mark.parametrize(("status", "expected"), [
    ("pending", policy.Decision("locked", reason="group_inactive")),
    ("rejected", policy.Decision("locked", reason="group_inactive")),
    ("active", policy.Decision("direct")),
])
def test_decide_group_line_inactive_group_locked(source: str, status: str, expected: policy.Decision) -> None:
    line = _line(source, target_id=f"{source}:6", map_id=None, group_id=GROUP_ID)
    ctx = _ctx(group_statuses={GROUP_ID: status})
    assert policy.decide(line, _scope(sysadmin=True), ctx) == expected


def test_decide_rejects_to_value_missing_from_context() -> None:
    with pytest.raises(ValueError, match="to_value"):
        policy.decide(_line("map_owner"), _scope("owner"), _ctx(), to_value="new.owner")


# ── DB — 범위 로드·사실 일괄 로드 ─────────────────────────────────────


@pytest.fixture
def enforced() -> Iterator[None]:
    prev_enforce, prev_sys = settings.dev_enforce_permissions, settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.dev_enforce_permissions, settings.bpm_sysadmins = prev_enforce, prev_sys


def _uid() -> str:
    return uuid.uuid4().hex[:8]


async def _new_map(session, name: str, **kw: object) -> ProcessMap:
    kw.setdefault("visibility", "private")
    kw.setdefault("owner_id", "user.lee")
    m = ProcessMap(name=f"{name} {_uid()}", created_by="user.lee", **kw)
    session.add(m)
    await session.flush()
    return m


def _grant_row(m: ProcessMap, principal: str, role: str, ptype: str = "user") -> MapPermission:
    return MapPermission(map_id=m.id, principal_type=ptype, principal_id=principal, role=role,
                         granted_by="user.lee")


def _map_line(source: str, map_id: int) -> RefLine:
    return _line(source, target_id=f"{source}:{map_id}", map_id=map_id)


async def _scope_for(login_id: str) -> policy.ActorScope:
    async with SessionLocal() as session:
        return await policy.load_actor_scope(session, login_id)


def test_scope_editor_sees_editor_maps_only(client: object, enforced: None) -> None:
    user = f"scope.{_uid()}"
    org = f"Scope Division {_uid()}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add(Employee(login_id=user, name="Scope User", source="local", active=True, org_l1=org))
            edit = await _new_map(session, "edit")
            view = await _new_map(session, "view")
            public = await _new_map(session, "public", visibility="public")
            owned = await _new_map(session, "owned")
            derived = await _new_map(session, "derived", owning_department=org)
            deleted = await _new_map(session, "deleted", deleted_at=datetime(2026, 10, 1),
                                     owning_department="Gone Division")
            session.add_all([
                _grant_row(edit, user, "editor"), _grant_row(view, user, "viewer"),
                _grant_row(owned, user, "owner"), _grant_row(deleted, user, "editor"),
            ])
            await session.commit()
            return {"edit": edit.id, "view": view.id, "public": public.id, "owned": owned.id,
                    "derived": derived.id, "deleted": deleted.id}

    ids = asyncio.run(_seed())
    scope = asyncio.run(_scope_for(user))

    assert scope.is_sysadmin is False
    assert {ids[k]: scope.roles.get(ids[k]) for k in ids} == {
        ids["edit"]: "editor", ids["view"]: None, ids["public"]: None, ids["owned"]: "owner",
        ids["derived"]: "editor", ids["deleted"]: None,
    }
    visible = {k for k in ids if policy.is_line_visible(_map_line("sp_dept", ids[k]), scope)}
    assert visible == {"edit", "owned", "derived"}
    assert not policy.is_line_visible(_map_line("owning_dept", ids["deleted"]), scope)
    assert not policy.is_line_visible(_line("group_user", map_id=None, group_id=1), scope)
    assert not policy.is_line_visible(_line("category_perm", map_id=None, category_id=1), scope)


def test_scope_group_manager_sees_group_lines(client: object, enforced: None) -> None:
    user = f"manager.{_uid()}"

    async def _seed() -> tuple[int, int]:
        async with SessionLocal() as session:
            managed = UserGroup(name=f"managed {_uid()}", status="active", created_by="user.lee")
            other = UserGroup(name=f"other {_uid()}", status="active", created_by="user.lee")
            session.add_all([managed, other])
            await session.flush()
            session.add(UserGroupManager(group_id=managed.id, user_id=user))
            await session.commit()
            return managed.id, other.id

    managed_id, other_id = asyncio.run(_seed())
    scope = asyncio.run(_scope_for(user))

    assert managed_id in scope.managed_group_ids and other_id not in scope.managed_group_ids
    for source in ("group_member", "group_user"):
        assert policy.is_line_visible(_line(source, map_id=None, group_id=managed_id), scope)
        assert not policy.is_line_visible(_line(source, map_id=None, group_id=other_id), scope)


def test_scope_category_appointment_rule(client: object, enforced: None) -> None:
    user = f"cat.{_uid()}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            tag = _uid()
            root = ProcessCategory(code=f"PC-R-{tag}", name="root", level=1)
            session.add(root)
            await session.flush()
            mid = ProcessCategory(code=f"PC-M-{tag}", name="mid", level=2, parent_id=root.id)
            session.add(mid)
            await session.flush()
            leaf = ProcessCategory(code=f"PC-L-{tag}", name="leaf", level=3, parent_id=mid.id)
            session.add(leaf)
            await session.flush()
            session.add(CategoryPermission(category_id=mid.id, principal_type="user", principal_id=user,
                                           granted_by=SYSADMIN))
            await session.commit()
            return {"root": root.id, "mid": mid.id, "leaf": leaf.id}

    ids = asyncio.run(_seed())
    scope = asyncio.run(_scope_for(user))

    # 임명 위임 규칙: 자기 서브트리 안이면서 자기 seed보다 아래 레벨만 — 자기 카테고리는 상위 관리자 몫
    visible = {k for k, cid in ids.items()
               if policy.is_line_visible(_line("category_perm", map_id=None, category_id=cid), scope)}
    assert visible == {"leaf"}


def test_scope_sysadmin_sees_everything(client: object, enforced: None) -> None:
    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            live = await _new_map(session, "sys live")
            deleted = await _new_map(session, "sys deleted", deleted_at=datetime(2026, 10, 1),
                                     owning_department="Gone Division")
            group = UserGroup(name=f"sys group {_uid()}", status="active", created_by="user.lee")
            category = ProcessCategory(code=f"PC-S-{_uid()}", name="sys", level=1)
            session.add_all([group, category])
            await session.commit()
            return {"live": live.id, "deleted": deleted.id, "group": group.id, "category": category.id}

    ids = asyncio.run(_seed())
    scope = asyncio.run(_scope_for(SYSADMIN))

    assert scope.is_sysadmin is True
    assert scope.roles[ids["live"]] == "owner" and scope.roles[ids["deleted"]] == "owner"
    assert policy.is_line_visible(_map_line("node_dept", ids["live"]), scope)
    assert policy.is_line_visible(_map_line("owning_dept", ids["deleted"]), scope)
    assert policy.is_line_visible(_line("group_member", map_id=None, group_id=ids["group"]), scope)
    assert policy.is_line_visible(_line("category_perm", map_id=None, category_id=ids["category"]), scope)


def test_load_decision_context_collects_governance_facts(client: object, enforced: None) -> None:
    actor, owner, approver = f"act.{_uid()}", f"own.{_uid()}", f"appr.{_uid()}"
    gone = f"gone.{_uid()}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add_all([
                Employee(login_id=owner, name="Owner Name", source="local", active=True),
                Employee(login_id=approver, name="Approver", source="local", active=True),
                Employee(login_id=gone, name="Gone", source="local", active=False),
            ])
            held = await _new_map(session, "held", owner_id=owner)
            review = await _new_map(session, "review", owner_id=owner)
            collab = _grant_row(held, gone, "editor")
            mine = _grant_row(held, actor, "editor")
            session.add_all([collab, mine])
            session.add_all([
                MapApprover(map_id=held.id, user_id=approver), MapApprover(map_id=held.id, user_id=gone),
            ])
            pub = MapVersion(map_id=held.id, label="pub", status="published")
            session.add(pub)
            await session.flush()
            draft = MapVersion(map_id=held.id, label="draft", status="draft", checked_out_by=gone)
            submitted = MapVersion(map_id=review.id, label="sub", status="pending", submitted_by=gone,
                                   checked_out_by=gone)
            session.add_all([draft, submitted])
            await session.flush()
            for grant in (collab, mine):
                session.add(ApprovalRequest(
                    map_id=held.id, kind="permission_downgrade", requested_by=owner, status="pending",
                    payload={"permission_id": grant.id, "principal_type": "user",
                             "principal_id": grant.principal_id, "from_role": "editor", "to_role": None},
                ))
            await session.commit()
            return {"held": held.id, "review": review.id, "collab": collab.id, "mine": mine.id,
                    "draft": draft.id}

    ids = asyncio.run(_seed())
    lines = [
        _line("map_collab", target_id=f"map_collab:{ids['collab']}", map_id=ids["held"]),
        _map_line("node_dept", ids["held"]),
        _map_line("map_approver", ids["review"]),
    ]

    async def _load() -> policy.DecisionContext:
        async with SessionLocal() as session:
            scope = await policy.load_actor_scope(session, actor)
            return await policy.load_decision_context(session, lines, scope)

    ctx = asyncio.run(_load())

    assert set(ctx.maps) == {ids["held"], ids["review"]}
    assert ctx.grants[ids["collab"]].principal_id == gone
    assert ctx.in_approval_map_ids == {ids["review"]}
    assert ctx.active_approvers[ids["held"]] == [approver]
    assert ctx.active_approvers.get(ids["review"], []) == []
    assert {(ids["held"], ids["collab"]), (ids["held"], ids["mine"])} <= ctx.pending_downgrades
    # 편집 가능 버전 점유자 + 결재 중 버전 제출자 (결재 중 버전의 점유는 참여로 치지 않는다)
    assert ctx.workflow_pairs == {(ids["held"], gone), (ids["review"], gone)}
    assert ctx.actor_pending_downgrade_map_ids == {ids["held"]}
    assert ctx.node_targets[ids["held"]].working_id == ids["draft"]
    assert ctx.display_names[owner] == "Owner Name"
    assert owner in ctx.active_logins and gone not in ctx.active_logins


def test_load_decision_context_preloads_to_value_facts(client: object, enforced: None) -> None:
    target = f"new.{_uid()}"
    org = f"Target Division {_uid()}"

    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            session.add(Employee(login_id=target, name="New Person", source="local", active=True, org_l1=org))
            editor = await _new_map(session, "cand editor")
            viewer = await _new_map(session, "cand viewer")
            member = await _new_map(session, "cand member", owning_department=org)
            stranger = await _new_map(session, "cand none")
            session.add_all([_grant_row(editor, target, "editor"), _grant_row(viewer, target, "viewer")])
            await session.commit()
            return {"editor": editor.id, "viewer": viewer.id, "member": member.id, "stranger": stranger.id}

    ids = asyncio.run(_seed())
    lines = [_map_line("map_owner", mid) for mid in ids.values()]
    lines += [_map_line("node_assignee", mid) for mid in ids.values()]

    async def _load(to_value: str | None) -> policy.DecisionContext:
        async with SessionLocal() as session:
            scope = await policy.load_actor_scope(session, SYSADMIN)
            return await policy.load_decision_context(session, lines, scope, to_value=to_value)

    ctx = asyncio.run(_load(target))
    assert ctx.to_value == target
    # 오너 이전 후보 = 명시 editor 이상 ∪ 주관 부서 소속 (transfer_owner와 같은 규칙)
    assert ctx.owner_candidate_map_ids == {ids["editor"], ids["member"]}
    assert ctx.to_value_viewable_map_ids == {ids["editor"], ids["viewer"], ids["member"]}

    empty = asyncio.run(_load(None))
    assert empty.owner_candidate_map_ids == set() and empty.to_value_viewable_map_ids == set()


def test_decide_owner_line_owning_member_with_viewer_grant_not_eligible(client: object, enforced: None) -> None:
    target = f"member.{_uid()}"
    org = f"Member Division {_uid()}"

    async def _seed() -> tuple[int, int]:
        async with SessionLocal() as session:
            session.add(Employee(login_id=target, name="Member", source="local", active=True, org_l1=org))
            with_viewer = await _new_map(session, "member viewer", owning_department=org)
            plain = await _new_map(session, "member plain", owning_department=org)
            session.add(_grant_row(with_viewer, target, "viewer"))
            await session.commit()
            return with_viewer.id, plain.id

    with_viewer, plain = asyncio.run(_seed())
    lines = [_map_line("map_owner", with_viewer), _map_line("map_owner", plain)]

    async def _decide() -> list[policy.Decision]:
        async with SessionLocal() as session:
            scope = await policy.load_actor_scope(session, SYSADMIN)
            ctx = await policy.load_decision_context(session, lines, scope, to_value=target)
            return [policy.decide(ln, scope, ctx, to_value=target) for ln in lines]

    # transfer_owner: 명시 grant가 있으면 그 역할로만 본다 — viewer grant는 주관 부서 소속이어도 탈락
    assert asyncio.run(_decide()) == [policy.Decision("locked", reason="not_eligible"), policy.Decision("direct")]


def test_vanished_targets_filtered_not_raised(client: object, enforced: None) -> None:
    async def _seed() -> dict[str, int]:
        async with SessionLocal() as session:
            gone = await _new_map(session, "vanishing")
            bare = await _new_map(session, "no versions")
            await session.commit()
            return {"gone": gone.id, "bare": bare.id}

    ids = asyncio.run(_seed())
    vanished = [
        _map_line("sp_dept", ids["gone"]), _map_line("map_owner", ids["gone"]),
        _map_line("node_assignee", ids["gone"]),
        _line("map_collab", target_id="map_collab:999999999", map_id=ids["bare"]),
        _map_line("node_dept", ids["bare"]),  # 노드 대상(게시본·작업본)이 없는 맵
        _line("group_user", target_id="group_user:1", map_id=None, group_id=999999999),
    ]
    survivor = _map_line("sp_dept", ids["bare"])

    async def _run() -> tuple[list[bool], list[policy.Decision]]:
        async with SessionLocal() as session:
            scope = await policy.load_actor_scope(session, SYSADMIN)
            await session.execute(delete(ProcessMap).where(ProcessMap.id == ids["gone"]))
            await session.commit()
            lines = [*vanished, survivor]
            ctx = await policy.load_decision_context(session, lines, scope, to_value=SYSADMIN)
            visible = [ln for ln in lines if policy.is_line_visible(ln, scope, ctx)]
            return ([policy.is_line_visible(ln, scope, ctx) for ln in lines],
                    [policy.decide(ln, scope, ctx, to_value=SYSADMIN) for ln in visible])

    flags, decisions = asyncio.run(_run())
    assert flags == [False] * len(vanished) + [True]
    assert decisions == [policy.Decision("direct")]


def test_load_decision_context_query_count_independent_of_lines(client: object, enforced: None) -> None:
    target = f"count.{_uid()}"

    async def _seed() -> list[int]:
        async with SessionLocal() as session:
            session.add(Employee(login_id=target, name="Count", source="local", active=True))
            maps = [await _new_map(session, f"count {n}") for n in range(5)]
            await session.commit()
            return [m.id for m in maps]

    map_ids = asyncio.run(_seed())

    def _lines_for(mids: list[int]) -> list[RefLine]:
        sources = ("map_owner", "node_assignee", "map_approver", "sp_dept")
        return [_map_line(source, mid) for mid in mids for source in sources]

    def _count_queries(lines: list[RefLine]) -> int:
        statements: list[str] = []

        def _record(_conn: object, _cursor: object, statement: str, *_args: object) -> None:
            statements.append(statement)

        async def _load() -> None:
            async with SessionLocal() as session:
                scope = await policy.load_actor_scope(session, SYSADMIN)
                event.listen(engine.sync_engine, "before_cursor_execute", _record)
                try:
                    await policy.load_decision_context(session, lines, scope, to_value=target)
                finally:
                    event.remove(engine.sync_engine, "before_cursor_execute", _record)

        asyncio.run(_load())
        return len(statements)

    one, many = _count_queries(_lines_for(map_ids[:1])), _count_queries(_lines_for(map_ids))
    assert one > 0 and one == many
