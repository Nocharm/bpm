"""Version comparison demo seed — As-Is/To-Be with added/removed/changed for the compare screen.

reset_db가 호출하는 ADDITIVE 시드. 한 맵에 As-Is·To-Be 두 버전을 만들고, To-Be 노드의
source_node_id를 As-Is 노드 id로 이어(diff 계보) 비교 화면(/maps/{id}/compare)에서
추가(초록)/삭제(빨강)/변경(노랑)이 실제로 표시되도록 한다.

diff 매칭 규칙은 프론트 `lib/diff.ts` = `source_node_id ?? id` (버전 클론 라우터
`app/routers/versions._clone_graph`와 동일). 평면 노드라 부모 계보("location") 변화는 없고,
title/node_type/assignee/department 등 필드 차이만 'changed'로 잡힌다.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import Edge, MapPermission, MapVersion, Node, ProcessMap

X0 = 80.0
STEP = 220.0
Y = 200.0


def _node(
    nid: str,
    version_id: int,
    title: str,
    node_type: str,
    order: int,
    *,
    x: float,
    source_node_id: str | None = None,
    assignee: str = "",
    department: str = "",
    is_primary_end: bool = False,
) -> Node:
    return Node(
        id=nid,
        version_id=version_id,
        title=title,
        node_type=node_type,
        pos_x=x,
        pos_y=Y,
        sort_order=order,
        assignee=assignee,
        department=department,
        source_node_id=source_node_id,
        is_primary_end=is_primary_end,
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


async def seed_compare_demo(session: AsyncSession) -> dict[str, int]:
    """버전 비교 데모 맵(As-Is/To-Be) 생성. 요약 dict 반환."""
    pm = ProcessMap(
        name="Version Comparison Demo (As-Is / To-Be)",
        description="버전 비교 화면 데모 — As-Is→To-Be 사이 추가/삭제/변경이 하이라이트된다.",
        created_by="user.lee",
        owner_id="user.lee",
        visibility="public",  # public이라 enforcement 모드에서도 누구나 viewer로 비교 열람
    )
    session.add(pm)
    await session.flush()
    session.add(
        MapPermission(
            map_id=pm.id,
            principal_type="user",
            principal_id="user.lee",
            role="owner",
            granted_by="user.lee",
        )
    )

    # As-Is (published) — 먼저 생성(낮은 id) → 비교 화면 좌측(left).
    asis = MapVersion(
        map_id=pm.id, label="As-Is", status=workflow.PUBLISHED, submitted_by="user.lee"
    )
    session.add(asis)
    await session.flush()
    a = asis.id
    session.add_all([
        _node("cmpA-start", a, "시작", "start", 0, x=X0),
        _node("cmpA-accept", a, "주문 접수", "process", 1, x=X0 + STEP,
              assignee="김영업", department="영업팀"),
        _node("cmpA-manual", a, "수기 승인", "process", 2, x=X0 + STEP * 2,
              assignee="정관리", department="관리팀"),
        _node("cmpA-review", a, "신용 검토", "process", 3, x=X0 + STEP * 3,
              assignee="이심사", department="심사팀"),
        _node("cmpA-ship", a, "출고", "process", 4, x=X0 + STEP * 4,
              assignee="박물류", department="물류팀"),
        _node("cmpA-end", a, "종료", "end", 5, x=X0 + STEP * 5, is_primary_end=True),
    ])
    session.add_all([
        _edge("cmpA-e1", a, "cmpA-start", "cmpA-accept"),
        _edge("cmpA-e2", a, "cmpA-accept", "cmpA-manual"),
        _edge("cmpA-e3", a, "cmpA-manual", "cmpA-review"),
        _edge("cmpA-e4", a, "cmpA-review", "cmpA-ship"),
        _edge("cmpA-e5", a, "cmpA-ship", "cmpA-end"),
    ])

    # To-Be (draft) — source_node_id로 As-Is 계보 연결.
    #   removed : 수기 승인(자동화로 제거 — To-Be에 source=cmpA-manual 없음)
    #   added   : 품질 점검(source 없음 → 신규)
    #   changed : 신용 검토(담당자 이심사→최심사), 출고→출고/배송(이름+부서 물류팀→배송팀)
    tobe = MapVersion(
        map_id=pm.id, label="To-Be", status=workflow.DRAFT, submitted_by="user.lee"
    )
    session.add(tobe)
    await session.flush()
    b = tobe.id
    session.add_all([
        _node("cmpB-start", b, "시작", "start", 0, x=X0, source_node_id="cmpA-start"),
        _node("cmpB-accept", b, "주문 접수", "process", 1, x=X0 + STEP,
              assignee="김영업", department="영업팀", source_node_id="cmpA-accept"),
        _node("cmpB-review", b, "신용 검토", "process", 2, x=X0 + STEP * 2,
              assignee="최심사", department="심사팀", source_node_id="cmpA-review"),
        _node("cmpB-quality", b, "품질 점검", "process", 3, x=X0 + STEP * 3,
              assignee="한품질", department="품질팀"),
        _node("cmpB-ship", b, "출고/배송", "process", 4, x=X0 + STEP * 4,
              assignee="박물류", department="배송팀", source_node_id="cmpA-ship"),
        _node("cmpB-end", b, "종료", "end", 5, x=X0 + STEP * 5, is_primary_end=True,
              source_node_id="cmpA-end"),
    ])
    session.add_all([
        _edge("cmpB-e1", b, "cmpB-start", "cmpB-accept"),
        _edge("cmpB-e2", b, "cmpB-accept", "cmpB-review"),
        _edge("cmpB-e3", b, "cmpB-review", "cmpB-quality"),
        _edge("cmpB-e4", b, "cmpB-quality", "cmpB-ship"),
        _edge("cmpB-e5", b, "cmpB-ship", "cmpB-end"),
    ])
    await session.commit()
    return {"map": pm.id, "asis": a, "tobe": b}
