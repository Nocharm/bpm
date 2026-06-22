"""3중첩 데모 시드 — Call Activity A→B→C 체인(링크맵에 실제 내부 노드 보유).

reset_db 가 호출하는 ADDITIVE 시드. 기존 데모 맵 / seed_local_employees /
seed_reference_demo 를 건드리지 않고, 깊이-3 드릴인 + 미래 마스킹 비대칭 테스트를 위한
3단 중첩 픽스처만 추가한다.

기존 참조 데모의 링크맵에는 중첩 subprocess가 없어 깊이-3 드릴인이 불가했다 —
여기서는 L2 자체가 L3를 링크하는 subprocess를 가져 진짜 A→B→C 체인이 된다.

구성 (영문 자기서술 이름):
  - "Nesting L3 — Leaf"      (owner user.choi): published, start→process→end.
  - "Nesting L2 — embeds L3" (owner user.lee):  published, start→[subprocess→L3]→end.
  - "Nesting L1 — embeds L2" (owner user.lee):  draft,     start→[subprocess→L2]→end.

L3 소유자를 user.lee 가 아닌 user.choi 로 두는 것은 다음 마스킹 작업이 쓸
비대칭(user.lee 는 L1/L2 소유, L3 비소유)을 미리 마련하기 위함 — 지금은 권한 코드 없음.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import Edge, MapPermission, MapVersion, Node, ProcessMap

# 데이터/출력이라 헥스 직접 사용 허용 (frontend COLOR_PRESETS 톤)
GRAY = "#9a9aa6"
BLUE = "#3d7eff"
GREEN = "#2bc56f"
VIOLET = "#6a41ff"

X0 = 80.0
STEP = 240.0
Y = 220.0


def _node(
    nid: str,
    version_id: int,
    title: str,
    node_type: str,
    x: float,
    order: int,
    *,
    color: str = "",
    is_primary_end: bool = False,
    linked_map_id: int | None = None,
) -> Node:
    return Node(
        id=nid,
        version_id=version_id,
        title=title,
        node_type=node_type,
        color=color,
        pos_x=x,
        pos_y=Y,
        sort_order=order,
        is_primary_end=is_primary_end,
        linked_map_id=linked_map_id,
        follow_latest=linked_map_id is not None,  # 최신 발행본 자동추종(L1/L2 의 subprocess)
    )


def _edge(eid: str, version_id: int, src: str, dst: str) -> Edge:
    return Edge(
        id=eid,
        version_id=version_id,
        source_node_id=src,
        target_node_id=dst,
        source_side="right",
        target_side="left",
    )


async def _create_map(
    session: AsyncSession, *, name: str, description: str, owner: str
) -> ProcessMap:
    """ProcessMap(owner) + owner MapPermission. 가시성은 private(데모 기본)."""
    pm = ProcessMap(
        name=name,
        description=description,
        created_by=owner,
        owner_id=owner,
        visibility="private",
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
    return pm


async def _add_version(session: AsyncSession, map_id: int, status: str) -> int:
    ver = MapVersion(map_id=map_id, label="v1", status=status, submitted_by="user.lee")
    session.add(ver)
    await session.flush()
    return ver.id


async def seed_nesting_demo(session: AsyncSession) -> dict[str, int]:
    """3중첩 A→B→C 픽스처 삽입. 요약 dict 반환.

    reset_db 가 seed_permission_demo 뒤에 호출(additive). 링크맵(L2/L3)은 published 라
    resolve_linked_version 이 최신 발행본을 해석한다. L2 가 L3 를 링크하는 subprocess 를
    가져 깊이-3 드릴인이 실제로 가능하다.
    """
    # L3 — Leaf (owner user.choi). published, 실제 내부 노드.
    l3 = await _create_map(
        session,
        name="Nesting L3 — Leaf",
        description="Deepest linked map. Real nodes: start → process → end.",
        owner="user.choi",
    )
    l3_ver = await _add_version(session, l3.id, workflow.PUBLISHED)
    session.add_all([
        _node("n3-start", l3_ver, "Receive", "start", X0, 0, color=GRAY),
        _node("n3-proc", l3_ver, "Handle", "process", X0 + STEP, 1, color=BLUE),
        _node("n3-end", l3_ver, "Done", "end", X0 + STEP * 2, 2, color=GREEN,
              is_primary_end=True),
    ])
    session.add_all([
        _edge("n3-e1", l3_ver, "n3-start", "n3-proc"),
        _edge("n3-e2", l3_ver, "n3-proc", "n3-end"),
    ])

    # L2 — embeds L3 (owner user.lee). published, 중간에 L3 링크 subprocess.
    l2 = await _create_map(
        session,
        name="Nesting L2 — embeds L3",
        description="Embeds L3 as a subprocess so depth-3 drill-in is reachable.",
        owner="user.lee",
    )
    l2_ver = await _add_version(session, l2.id, workflow.PUBLISHED)
    session.add_all([
        _node("n2-start", l2_ver, "Start L2", "start", X0, 0, color=GRAY),
        _node("n2-sub", l2_ver, "Open L3", "subprocess", X0 + STEP, 1, color=VIOLET,
              linked_map_id=l3.id),
        _node("n2-end", l2_ver, "End L2", "end", X0 + STEP * 2, 2, color=GREEN,
              is_primary_end=True),
    ])
    session.add_all([
        _edge("n2-e1", l2_ver, "n2-start", "n2-sub"),
        _edge("n2-e2", l2_ver, "n2-sub", "n2-end"),
    ])

    # L1 — embeds L2 (owner user.lee). draft(편집 가능, 여는 맵). L2 링크 subprocess.
    l1 = await _create_map(
        session,
        name="Nesting L1 — embeds L2",
        description="Top map you open. Drill its subprocess → L2 → L3 (A→B→C chain).",
        owner="user.lee",
    )
    l1_ver = await _add_version(session, l1.id, workflow.DRAFT)
    session.add_all([
        _node("n1-start", l1_ver, "Start L1", "start", X0, 0, color=GRAY),
        _node("n1-sub", l1_ver, "Open L2", "subprocess", X0 + STEP, 1, color=VIOLET,
              linked_map_id=l2.id),
        _node("n1-end", l1_ver, "End L1", "end", X0 + STEP * 2, 2, color=GREEN,
              is_primary_end=True),
    ])
    session.add_all([
        _edge("n1-e1", l1_ver, "n1-start", "n1-sub"),
        _edge("n1-e2", l1_ver, "n1-sub", "n1-end"),
    ])

    await session.commit()
    return {
        "l1_map": l1.id,
        "l2_map": l2.id,
        "l3_map": l3.id,
    }
