"""Permission-workflow demo seed — RBAC 전 과정을 화면에서 바로 읽도록 구성한 픽스처.

reset_db 가 호출하는 ADDITIVE 시드. LOCAL_USERS / seed_reference_demo 를 건드리지 않고
권한 워크플로(가시성 대비 · 3종 principal 협업자 · 결재 대기 · 활성/비활성 승인자 ·
그룹 승인 큐 · 그룹 상속 · 버전 게시 워크플로)를 보여주는 데모 엔터티만 추가한다.

This seeds, in English so the screens read as a walkthrough:
  - 2 visibility-contrast maps (Public / Private)
  - 1 "Roles & Principals Demo" map: user/department/group grants + 2 pending
    approval_requests + active & inactive approvers
  - 2 UserGroups: one active (granted on the demo map → inheritance) + one pending
    (in the sysadmin approval queue)
  - 1 "Version Workflow Demo" map: a published version + a pending version mid-flight

The 5 LOCAL_USERS (admin.kim / user.lee|park|choi|jung) are reused; ONE demo-only
inactive employee (user.former) is inserted here, NOT in LOCAL_USERS.
"""

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import (
    ApprovalRequest,
    Edge,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroup,
    UserGroupManager,
    UserGroupMember,
)

# Department grant follows the org-path string convention (logic.belongs_to_department):
# Procurement Office matches user.choi/park/lee/jung (prefix or exact).
PROCUREMENT_OFFICE = "Management Support Division/Procurement Office"

# Demo-only inactive approver — inserted by THIS seed, not by LOCAL_USERS (additive).
INACTIVE_APPROVER = "user.former"


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _add_inactive_approver(session: AsyncSession) -> None:
    """Insert the demo-only inactive employee (active=False) for the approver example."""
    emp = await session.get(Employee, INACTIVE_APPROVER)
    if emp is None:
        emp = Employee(login_id=INACTIVE_APPROVER, source="local")
        session.add(emp)
    emp.name = "Retired Approver"
    emp.title = "Former Reviewer"
    emp.role = "user"
    emp.org_l1 = "Management Support Division"
    emp.org_l2 = "Procurement Office"
    emp.org_l3 = None
    emp.org_l4 = None
    emp.org_l5 = None
    emp.department = "Procurement Office"
    emp.active = False  # the active-judgment example: approver list shows active + inactive
    emp.email = f"{INACTIVE_APPROVER}@corp"
    await session.flush()


# Linear flow layout — top-level flat nodes (diff has no parent "location" change).
_X0 = 80.0
_STEP = 200.0
_NODE_Y = 200.0

# step = (suffix, title, node_type). Demo flows are English to match the map names.
Step = tuple[str, str, str]


def _build_flow(
    version_id: int,
    prefix: str,
    steps: list[Step],
    *,
    lineage_prefix: str | None = None,
) -> list:
    """Build a linear start→…→end flow. Node ids are f'{prefix}-{suffix}' (globally unique).

    lineage_prefix: set source_node_id = f'{lineage_prefix}-{suffix}' so a later version
    is matched to the earlier one by the compare diff (source_node_id ?? id). A suffix with
    no counterpart in the earlier version → 'added'; an earlier suffix dropped here → 'removed'.
    """
    rows: list = []
    for i, (suffix, title, ntype) in enumerate(steps):
        nid = f"{prefix}-{suffix}"
        rows.append(
            Node(
                id=nid,
                version_id=version_id,
                title=title,
                node_type=ntype,
                pos_x=_X0 + _STEP * i,
                pos_y=_NODE_Y,
                sort_order=i,
                is_primary_end=(ntype == "end"),
                source_node_id=(f"{lineage_prefix}-{suffix}" if lineage_prefix else None),
            )
        )
        if i > 0:
            prev = f"{prefix}-{steps[i - 1][0]}"
            rows.append(
                Edge(
                    id=f"{prefix}-e{i}",
                    version_id=version_id,
                    source_node_id=prev,
                    target_node_id=nid,
                    source_side="right",
                    target_side="left",
                )
            )
    return rows


async def _create_map(
    session: AsyncSession,
    *,
    name: str,
    description: str,
    owner: str,
    visibility: str,
    seed_version: bool = True,
    steps: list[Step] | None = None,
) -> ProcessMap:
    """Create a ProcessMap (owner_id/created_by set) + an owner MapPermission row.

    seed_version: append an initial "As-Is" version so the map is openable in the
    editor. Every map needs ≥1 version (the create_map router seeds one too) — without
    it the editor crashes on `versions[0].id`. The version-workflow map manages its own
    v1/v2, so it passes seed_version=False.
    steps: if given, populate the seeded version with a linear flow (so the map isn't empty).
    """
    pm = ProcessMap(
        name=name,
        description=description,
        created_by=owner,
        owner_id=owner,
        visibility=visibility,
    )
    session.add(pm)
    await session.flush()
    session.add(
        MapPermission(
            map_id=pm.id,
            principal_type="user",
            principal_id=owner,
            role="owner",
            granted_by=owner,
        )
    )
    if seed_version:
        version = MapVersion(map_id=pm.id, label="As-Is")
        session.add(version)
        await session.flush()
        if steps:
            session.add_all(_build_flow(version.id, f"m{pm.id}a", steps))
    return pm


async def _seed_groups(session: AsyncSession) -> tuple[int, int]:
    """2 UserGroups — active (granted on demo map → inheritance) + pending (sysadmin queue).

    Returns (active_group_id, pending_group_id).
    """
    # Active group — approved by sysadmin; choi (user) + Procurement Office (department).
    g_active = UserGroup(
        name="Approved Cross-Team Group",
        description="Active group granted editor on the Roles & Principals Demo map.",
        status="active",
        created_by="user.lee",
        approved_by="admin.kim",
        approved_at=_now(),
    )
    session.add(g_active)
    await session.flush()
    session.add_all([
        UserGroupMember(group_id=g_active.id, member_type="user", member_id="user.choi"),
        UserGroupMember(
            group_id=g_active.id, member_type="department", member_id=PROCUREMENT_OFFICE
        ),
        UserGroupManager(group_id=g_active.id, user_id="user.lee"),
    ])

    # Pending group — awaiting sysadmin approval (shows in /admin/permissions group queue).
    g_pending = UserGroup(
        name="Proposed Review Group",
        description="Pending group awaiting sysadmin approval in the group queue.",
        status="pending",
        created_by="user.lee",
    )
    session.add(g_pending)
    await session.flush()
    session.add_all([
        UserGroupMember(group_id=g_pending.id, member_type="user", member_id="user.park"),
        UserGroupMember(group_id=g_pending.id, member_type="user", member_id="user.jung"),
        UserGroupManager(group_id=g_pending.id, user_id="user.lee"),
    ])
    await session.flush()
    return g_active.id, g_pending.id


async def _seed_roles_map(session: AsyncSession, active_group_id: int) -> ProcessMap:
    """The showcase map — 3 principal types across roles + 2 pending requests + approvers."""
    pm = await _create_map(
        session,
        name="Roles & Principals Demo",
        description="Collaborators span user / department / group principals across roles.",
        owner="user.lee",
        visibility="private",
        steps=[
            ("start", "Start", "start"),
            ("intake", "Intake", "process"),
            ("assess", "Assess", "process"),
            ("decide", "Decision", "decision"),
            ("done", "Done", "end"),
        ],
    )
    # Collaborators: user editor/viewer + department editor + group editor (3 principal types).
    # park_grant is captured so the pending downgrade request can reference its id.
    park_grant = MapPermission(
        map_id=pm.id, principal_type="user", principal_id="user.park",
        role="editor", granted_by="user.lee",
    )
    session.add_all([
        park_grant,
        MapPermission(
            map_id=pm.id, principal_type="user", principal_id="user.choi",
            role="viewer", granted_by="user.lee",
        ),
        MapPermission(
            map_id=pm.id, principal_type="department", principal_id=PROCUREMENT_OFFICE,
            role="editor", granted_by="user.lee",
        ),
        # group principal_id is the UserGroup id as a string (models.UserGroup docstring).
        MapPermission(
            map_id=pm.id, principal_type="group", principal_id=str(active_group_id),
            role="editor", granted_by="user.lee",
        ),
    ])
    await session.flush()  # populate park_grant.id

    # Two PENDING approval requests — appear together in the "결재 대기" tab.
    # 1) permission_downgrade: user.park editor→viewer (the row still says editor; request pending).
    session.add(
        ApprovalRequest(
            map_id=pm.id,
            kind="permission_downgrade",
            payload={
                "permission_id": park_grant.id,
                "principal_type": "user",
                "principal_id": "user.park",
                "from_role": "editor",
                "to_role": "viewer",
            },
            requested_by="user.lee",
            status="pending",
        )
    )
    # 2) visibility_change: flip private → public (pending).
    session.add(
        ApprovalRequest(
            map_id=pm.id,
            kind="visibility_change",
            payload={"to_visibility": "public"},
            requested_by="user.lee",
            status="pending",
        )
    )

    # Approvers: user.jung (active) + user.former (active=False) — active judgment example.
    session.add_all([
        MapApprover(map_id=pm.id, user_id="user.jung", assigned_by="user.lee"),
        MapApprover(map_id=pm.id, user_id=INACTIVE_APPROVER, assigned_by="user.lee"),
    ])
    await session.flush()
    return pm


async def _seed_version_workflow_map(session: AsyncSession) -> ProcessMap:
    """A map with a published version + a pending version mid-flight (valid for the router)."""
    pm = await _create_map(
        session,
        name="Version Workflow Demo",
        description="Publish workflow mid-flight: a published v1 and a pending v2 awaiting approval.",
        owner="user.lee",
        visibility="private",
        seed_version=False,  # manages its own v1/v2 below
    )
    # Approver required so the pending state is valid (submit gate needs an active approver).
    session.add(MapApprover(map_id=pm.id, user_id="user.jung", assigned_by="user.lee"))

    # v1 published — the live version.
    v1 = MapVersion(map_id=pm.id, label="v1", status=workflow.PUBLISHED, submitted_by="user.lee")
    session.add(v1)
    # v2 pending — submitted by owner, awaiting the approver (no VersionApproval yet → tally 0/1).
    v2 = MapVersion(map_id=pm.id, label="v2", status=workflow.PENDING, submitted_by="user.lee")
    session.add(v2)
    await session.flush()

    # v1/v2 content with lineage so comparing them (compare screen) shows real diffs:
    #   added: Test  ·  changed: Release → Release & Notify (title).
    v1_steps: list[Step] = [
        ("start", "Start", "start"),
        ("plan", "Plan", "process"),
        ("build", "Build", "process"),
        ("release", "Release", "process"),
        ("done", "Done", "end"),
    ]
    v2_steps: list[Step] = [
        ("start", "Start", "start"),
        ("plan", "Plan", "process"),
        ("build", "Build", "process"),
        ("test", "Test", "process"),  # added in v2
        ("release", "Release & Notify", "process"),  # changed title
        ("done", "Done", "end"),
    ]
    session.add_all(_build_flow(v1.id, f"m{pm.id}v1", v1_steps))
    session.add_all(_build_flow(v2.id, f"m{pm.id}v2", v2_steps, lineage_prefix=f"m{pm.id}v1"))
    await session.flush()
    return pm


async def seed_permission_demo(session: AsyncSession) -> dict[str, int]:
    """Insert the permission-workflow demo entities. Returns a summary count dict.

    Called by reset_db AFTER seed_local_employees + seed_reference_demo (additive).
    """
    await _add_inactive_approver(session)

    # Visibility contrast — public (everyone viewer) vs private (grant required).
    public_map = await _create_map(
        session,
        name="Public Process — anyone can view",
        description="visibility=public — every authenticated user gets viewer.",
        owner="user.lee",
        visibility="public",
        steps=[
            ("start", "Start", "start"),
            ("submit", "Submit Request", "process"),
            ("review", "Public Review", "process"),
            ("done", "Done", "end"),
        ],
    )
    private_map = await _create_map(
        session,
        name="Private Process — grant required",
        description="visibility=private with no extra grants — invisible to non-grantees.",
        owner="user.lee",
        visibility="private",
        steps=[
            ("start", "Start", "start"),
            ("draft", "Draft", "process"),
            ("review", "Internal Review", "process"),
            ("approve", "Approve", "process"),
            ("done", "Done", "end"),
        ],
    )

    active_group_id, pending_group_id = await _seed_groups(session)
    roles_map = await _seed_roles_map(session, active_group_id)
    version_map = await _seed_version_workflow_map(session)

    await session.commit()
    return {
        "public_map": public_map.id,
        "private_map": private_map.id,
        "roles_map": roles_map.id,
        "version_map": version_map.id,
        "active_group": active_group_id,
        "pending_group": pending_group_id,
    }
