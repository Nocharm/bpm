"""Version-lifecycle demo seed — 승인탭 매트릭스·3종 승인 화면을 화면에서 바로 확인하는 픽스처.

reset_db 가 호출하는 ADDITIVE 시드. 기존 시드를 건드리지 않고
버전 라이프사이클(expired · published · draft-체크아웃 · 대기중 이전요청 · 재게시-가능)만 추가한다.

Seeds — approval-tab matrix + 3 approval screens:

Map 1 "Version Lifecycle Demo" (private, owner=user.lee)
  Roles : user.park=editor (checkout holder), user.choi=editor (non-holder requester),
          user.jung=viewer
  v1    : expired, version_number=1 — prior published, superseded by v2
  v2    : published, version_number=2 — current active published
  v3    : draft, checked_out_by=user.park — holder sees 3-button bar, others see request state
  CheckoutRequest from user.choi (pending) — "요청됨" badge + decide queue on Settings / map-settings

Map 2 "Republish Demo" (private, owner=user.lee)
  Roles : user.park=editor, user.choi=editor
  v1    : expired, version_number=1 — NO draft exists → republish button shows on expired v1

Demo user map (all from LOCAL_USERS):
  admin.kim  — sysadmin (BPM_SYSADMINS=admin.kim), also map approver
  user.lee   — map owner (Minjae Lee)
  user.park  — editor-1 / checkout holder (Soyeon Park)
  user.choi  — editor-2 / pending requester (Daehyun Choi)
  user.jung  — viewer (Hana Jung)
"""

from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import (
    CheckoutRequest,
    Edge,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
)

# Reuse LOCAL_USERS login_ids — no new Employee rows needed.
OWNER = "user.lee"       # Minjae Lee — map owner
HOLDER = "user.park"     # Soyeon Park — draft checkout holder (editor)
REQUESTER = "user.choi"  # Daehyun Choi — non-holder editor with pending request
VIEWER = "user.jung"     # Hana Jung — viewer
APPROVER = "admin.kim"   # Junho Kim — sysadmin approver (BPM_SYSADMINS=admin.kim)

_X0 = 80.0
_STEP = 220.0
_Y = 200.0


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _flow(version_id: int, prefix: str) -> list:
    """Minimal start → task → end flow for demo graph content."""
    nodes = [
        Node(
            id=f"{prefix}-start",
            version_id=version_id,
            title="Start",
            node_type="start",
            pos_x=_X0,
            pos_y=_Y,
            sort_order=0,
        ),
        Node(
            id=f"{prefix}-task",
            version_id=version_id,
            title="Process Request",
            node_type="task",
            pos_x=_X0 + _STEP,
            pos_y=_Y,
            sort_order=1,
        ),
        Node(
            id=f"{prefix}-end",
            version_id=version_id,
            title="End",
            node_type="end",
            pos_x=_X0 + _STEP * 2,
            pos_y=_Y,
            sort_order=2,
            is_primary_end=True,
        ),
    ]
    edges = [
        Edge(
            id=f"{prefix}-e1",
            version_id=version_id,
            source_node_id=f"{prefix}-start",
            target_node_id=f"{prefix}-task",
            source_side="right",
            target_side="left",
        ),
        Edge(
            id=f"{prefix}-e2",
            version_id=version_id,
            source_node_id=f"{prefix}-task",
            target_node_id=f"{prefix}-end",
            source_side="right",
            target_side="left",
        ),
    ]
    return nodes + edges


async def seed_version_lifecycle_demo(session: AsyncSession) -> dict:
    """Seed two lifecycle demo maps; return a summary dict for reset_db logging."""

    # ── Map 1: Version Lifecycle Demo ─────────────────────────────────────────
    m1 = ProcessMap(
        name="Version Lifecycle Demo",
        description=(
            "Approval-tab matrix demo: expired v1, published v2, "
            "draft v3 checked out by Park + pending checkout request from Choi."
        ),
        created_by=OWNER,
        owner_id=OWNER,
        visibility="private",
    )
    session.add(m1)
    await session.flush()

    session.add_all([
        MapPermission(
            map_id=m1.id, principal_type="user", principal_id=OWNER,
            role="owner", granted_by=OWNER,
        ),
        MapPermission(
            map_id=m1.id, principal_type="user", principal_id=HOLDER,
            role="editor", granted_by=OWNER,
        ),
        MapPermission(
            map_id=m1.id, principal_type="user", principal_id=REQUESTER,
            role="editor", granted_by=OWNER,
        ),
        MapPermission(
            map_id=m1.id, principal_type="user", principal_id=VIEWER,
            role="viewer", granted_by=OWNER,
        ),
    ])
    session.add(MapApprover(map_id=m1.id, user_id=APPROVER, assigned_by=OWNER))

    # v1 — expired (prior published, now superseded)
    v1 = MapVersion(
        map_id=m1.id,
        label="v1 — Initial Release",
        status=workflow.EXPIRED,
        version_number=1,
        submitted_by=HOLDER,
    )
    session.add(v1)
    await session.flush()
    session.add_all(_flow(v1.id, f"lc{m1.id}v1"))

    # v2 — published (current active)
    v2 = MapVersion(
        map_id=m1.id,
        label="v2 — Current",
        status=workflow.PUBLISHED,
        version_number=2,
        submitted_by=HOLDER,
    )
    session.add(v2)
    await session.flush()
    session.add_all(_flow(v2.id, f"lc{m1.id}v2"))

    # v3 — draft, checked out by HOLDER
    v3 = MapVersion(
        map_id=m1.id,
        label="v3 — In Progress",
        status=workflow.DRAFT,
        version_number=None,
        checked_out_by=HOLDER,
        checked_out_at=_now(),
    )
    session.add(v3)
    await session.flush()
    session.add_all(_flow(v3.id, f"lc{m1.id}v3"))

    # Pending checkout request from REQUESTER — drives "요청됨" badge + queue UI
    cr = CheckoutRequest(
        version_id=v3.id,
        requested_by=REQUESTER,
        status="pending",
    )
    session.add(cr)
    await session.flush()

    # ── Map 2: Republish Demo ──────────────────────────────────────────────────
    m2 = ProcessMap(
        name="Republish Demo",
        description=(
            "Republish demo: expired v1, no draft — "
            "republish button appears on the expired version."
        ),
        created_by=OWNER,
        owner_id=OWNER,
        visibility="private",
    )
    session.add(m2)
    await session.flush()

    session.add_all([
        MapPermission(
            map_id=m2.id, principal_type="user", principal_id=OWNER,
            role="owner", granted_by=OWNER,
        ),
        MapPermission(
            map_id=m2.id, principal_type="user", principal_id=HOLDER,
            role="editor", granted_by=OWNER,
        ),
        MapPermission(
            map_id=m2.id, principal_type="user", principal_id=REQUESTER,
            role="editor", granted_by=OWNER,
        ),
    ])
    session.add(MapApprover(map_id=m2.id, user_id=APPROVER, assigned_by=OWNER))

    # r1 — expired, no draft follows → republish button shows
    r1 = MapVersion(
        map_id=m2.id,
        label="v1 — Released",
        status=workflow.EXPIRED,
        version_number=1,
        submitted_by=OWNER,
    )
    session.add(r1)
    await session.flush()
    session.add_all(_flow(r1.id, f"lc{m2.id}r1"))

    await session.commit()

    return {
        "lifecycle_map": m1.id,
        "v1_expired": v1.id,
        "v2_published": v2.id,
        "v3_draft": v3.id,
        "checkout_request_id": cr.id,
        "republish_map": m2.id,
        "r1_expired": r1.id,
    }
