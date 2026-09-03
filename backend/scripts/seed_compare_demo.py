"""비교 화면 개발용 데모 맵 — 계보(source_node_id)를 공유하는 2버전.

목업(compare-screen.mockup.html) 스타일의 diff: 추가/삭제/변경/무변경 노드 + 삽입-사이(passthrough)
삭제 엣지(우회 아크). v1=게시본(As-Is), v2=초안(To-Be, v1에서 분기해 편집한 것처럼 계보 공유).
seed_org_demo의 버전별 독립 그래프(계보 없음)와 달리, v2의 유지 노드는 v1 노드를 source_node_id로 가리킨다.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_compare_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_compare_demo

멱등: 같은 이름 맵이 있으면 지우고 다시 만든다.
"""

import asyncio

from sqlalchemy import delete, select

from app.clock import now as now_kst
from app.db import SessionLocal
from app.models import Edge, MapPermission, MapVersion, Node, ProcessMap, VersionEvent

MAP_NAME = "주문 처리 프로세스 (비교 데모)"
OWNER = "admin.sys"

# (key, title, node_type, kind, fields_v1, fields_v2)
#   kind: unchanged | changed | added(v2 only) | removed(v1 only)
#   fields: Node 컬럼 임의 덮어쓰기(title 포함) — 없으면 기본 ""
# 워스트케이스 커버(2026-08-24): 전 필드 동시 변경(통화 전환·GMP·IO/양식/조건), 터미널 커스텀
# 라벨+설명, 동일 이웃 삭제 노드 2개(포개짐 오프셋), 엣지 라벨 변경·선 모양 3종.
NODES = [
    (
        "start",
        "시작",
        "start",
        "changed",
        {},
        # 터미널 커스텀 라벨 — 캔버스 타입 필+제목 분리 렌더 확인용. 설명은 인스펙터/모달 전용.
        {"title": "고객 주문 발생", "description": "온라인 몰 또는 전화 주문이 접수되면 시작"},
    ),
    ("intake", "주문 접수", "process", "unchanged", {}, {}),
    ("stockchk", "재고 확인?", "decision", "unchanged", {}, {}),
    (
        "payment",
        "결제 처리",
        "process",
        "changed",
        # 워스트케이스 다필드 — 담당/부서/시스템/기간/터치타임/통화(₩)/인원/건수/FTE/GMP/IO/양식/자료형태/조건
        {
            "assignee": "김결제", "department": "재무팀", "system": "PG",
            "duration": "1.30", "touch_time": "0.45", "cost_krw": "50000",
            "headcount": "2", "annual_count": "2400", "fte": "0.8", "gmp": "non_gmp",
            "input": "주문서\n결제 요청 정보",
            "output": "결제 승인 내역",
            "input_forms": "System\nSystem",
            "output_forms": "System",
            "start_condition": "재고 확보 확인 후",
            "end_condition": "PG 승인 코드 수신",
        },
        # 통화 전환(₩→$) 포함 전 필드 갱신 — 비용 배타 계약(cost_krw/cost_usd 동시 금지) 준수
        {
            "assignee": "박결제", "department": "재무혁신팀", "system": "PG v2",
            "duration": "0.50", "touch_time": "0.20", "cost_usd": "35",
            "headcount": "1", "annual_count": "4800", "fte": "0.4", "gmp": "direct",
            "input": "주문서\n결제 요청 정보\n간편결제 토큰\n부정거래 스코어",
            "output": "결제 승인 내역\n전자 영수증",
            "input_forms": "System\nSystem\nSystem\nSystem",
            "output_forms": "System\nPDF",
            "start_condition": "재고 예약 완료 즉시 (야간 배치 제외)",
            "end_condition": "PG 승인 코드 수신 + 부정거래 점수 통과",
        },
    ),
    ("paychk", "결제 승인?", "decision", "unchanged", {}, {}),
    ("apprchk", "승인 필요?", "decision", "unchanged", {}, {}),
    ("mgrappr", "관리자 승인", "process", "changed", {}, {"assignee": "박승인", "department": "물류팀"}),
    ("ship", "배송", "process", "unchanged", {}, {}),
    (
        "delivered",
        "배송 완료",
        "process",
        "changed",
        # duration은 H.MM 숫자 표기 — 자유텍스트는 NodeIn 경계에서 "" 소거되어 diff 시연이 사라짐 (design 2026-07-11)
        {"duration": "3", "assignee": "정하늘", "output": "배송 완료 보고", "output_forms": "Email"},
        {
            "duration": "1", "assignee": "김민수", "description": "고객에게 당일 배송 완료 안내",
            "output": "배송 완료 보고\n고객 만족도 설문", "output_forms": "Email\nSystem",
        },
    ),
    ("notify", "고객 알림", "process", "unchanged", {}, {}),
    (
        "complete",
        "완료",
        "end",
        "changed",
        {},
        {"title": "주문 완료 통보", "description": "고객 알림 발송이 확인되면 종료"},
    ),
    # 삭제(v1에만) — reject/backorder는 이웃(stockchk→·→payment)이 같아 배치 평균이 동일:
    # 비교 캔버스의 삭제 노드 포개짐 오프셋(순차 밀어내기) 검증용.
    ("reject", "재고 부족 알림", "process", "removed", {"assignee": "한재고", "duration": "0.30"}, {}),
    (
        "backorder",
        "이월 주문 처리",
        "process",
        "removed",
        {"assignee": "한이월", "duration": "2.00", "input": "이월 주문 목록", "input_forms": "Excel"},
        {},
    ),
    # 추가(v2에만) — restock는 reject 대체, shipappr/prepship/qa/track은 삽입-사이
    (
        "restock",
        "재고 예약",
        "process",
        "added",
        {},
        {"system": "WMS", "duration": "0.10", "input": "부족 품목 리스트", "input_forms": "System"},
    ),
    ("prepship", "배송 준비", "subprocess", "added", {}, {}),
    ("qa", "품질 검사", "subprocess", "added", {}, {}),
    ("shipappr", "배송 승인", "process", "added", {}, {}),
    ("track", "배송 추적", "process", "added", {}, {"system": "TMS", "output": "배송 위치 로그"}),
]

# (source_key, target_key, label[, line_style]) — line_style 생략 시 ""(레거시=꺾은선 렌더)
V1_EDGES = [
    ("start", "intake", ""),
    ("intake", "stockchk", ""),
    ("stockchk", "payment", "있음"),
    ("stockchk", "reject", "부족"),
    ("reject", "payment", ""),
    ("stockchk", "backorder", "장기 부족"),
    ("backorder", "payment", ""),
    ("payment", "paychk", ""),
    ("paychk", "apprchk", "승인"),
    ("paychk", "payment", "재시도"),
    ("apprchk", "mgrappr", "필요"),
    ("apprchk", "ship", "불필요"),  # → v2에서 shipappr 삽입으로 삭제(passthrough)
    ("mgrappr", "ship", ""),
    ("ship", "delivered", ""),  # → v2에서 prepship/qa 삽입으로 삭제(passthrough)
    ("delivered", "notify", ""),  # → v2에서 track 삽입으로 삭제(passthrough)
    ("notify", "complete", ""),
]

V2_EDGES = [
    ("start", "intake", "", "straight"),  # 선 모양 변경(직선) — 저장 line_style 렌더 확인
    ("intake", "stockchk", ""),
    ("stockchk", "payment", "재고 확보"),  # 라벨 변경("있음"→) — 유지 엣지 changed 검증
    ("stockchk", "restock", "부족"),
    ("restock", "payment", ""),
    ("payment", "paychk", ""),
    ("paychk", "apprchk", "승인"),
    ("paychk", "payment", "재시도", "default"),  # 선 모양 변경(곡선)
    ("apprchk", "mgrappr", "필요"),
    ("apprchk", "shipappr", "불필요"),
    ("shipappr", "ship", ""),
    ("mgrappr", "ship", ""),
    ("ship", "prepship", ""),
    ("prepship", "qa", ""),
    ("qa", "delivered", ""),
    ("delivered", "track", ""),
    ("track", "notify", ""),
    ("notify", "complete", ""),
]


def _node(node_id: str, title: str, node_type: str, fields: dict, version_id: int,
          source_node_id: str | None, order: int) -> Node:
    kwargs: dict = dict(
        id=node_id, version_id=version_id, title=title, node_type=node_type,
        source_node_id=source_node_id, pos_x=0.0, pos_y=0.0, sort_order=order,
        is_primary_end=(node_type == "end"),
    )
    kwargs.update(fields)
    return Node(**kwargs)


async def _purge(session) -> None:
    existing = (
        await session.scalars(select(ProcessMap).where(ProcessMap.name == MAP_NAME))
    ).all()
    for m in existing:
        vids = [
            v for v in (
                await session.scalars(select(MapVersion.id).where(MapVersion.map_id == m.id))
            ).all()
        ]
        for vid in vids:
            await session.execute(delete(Edge).where(Edge.version_id == vid))
            await session.execute(delete(Node).where(Node.version_id == vid))
            await session.execute(delete(VersionEvent).where(VersionEvent.version_id == vid))
        await session.execute(delete(MapVersion).where(MapVersion.map_id == m.id))
        await session.execute(delete(MapPermission).where(MapPermission.map_id == m.id))
        await session.delete(m)
    await session.commit()


async def main() -> None:
    async with SessionLocal() as session:
        await _purge(session)
        now = now_kst()

        m = ProcessMap(
            name=MAP_NAME, description="비교 화면 개발용 - 계보 공유 2버전(게시본/초안)",
            created_by=OWNER, owner_id=OWNER, visibility="public",
        )
        session.add(m)
        await session.flush()
        session.add(MapPermission(
            map_id=m.id, principal_type="user", principal_id=OWNER, role="owner", granted_by=OWNER,
        ))

        v1 = MapVersion(
            map_id=m.id, label="v1 · 게시본", status="published", version_number=1,
            submitted_by=OWNER, created_at=now,
        )
        v2 = MapVersion(
            map_id=m.id, label="To-Be · 초안", status="draft", version_number=None,
            submitted_by=OWNER, created_at=now,
        )
        session.add_all([v1, v2])
        await session.flush()

        for order, (key, title, ntype, kind, f1, f2) in enumerate(NODES):
            if kind in ("unchanged", "changed", "removed"):
                session.add(_node(f"cmp1-{key}", title, ntype, f1, v1.id, None, order))
            if kind in ("unchanged", "changed", "added"):
                # 유지/변경 노드는 v1 노드를 계보 루트로 가리켜 diff가 매칭하게. 추가 노드는 계보 없음.
                src = f"cmp1-{key}" if kind in ("unchanged", "changed") else None
                session.add(_node(f"cmp2-{key}", title, ntype, f2, v2.id, src, order))

        for i, (s, t, label, *style) in enumerate(V1_EDGES):
            session.add(Edge(
                id=f"cmp1-e{i}", version_id=v1.id, source_node_id=f"cmp1-{s}",
                target_node_id=f"cmp1-{t}", label=label, source_side="right", target_side="left",
                line_style=style[0] if style else "",
            ))
        for i, (s, t, label, *style) in enumerate(V2_EDGES):
            session.add(Edge(
                id=f"cmp2-e{i}", version_id=v2.id, source_node_id=f"cmp2-{s}",
                target_node_id=f"cmp2-{t}", label=label, source_side="right", target_side="left",
                line_style=style[0] if style else "",
            ))

        session.add_all([
            VersionEvent(version_id=v1.id, event_type="created", actor=OWNER, created_at=now),
            VersionEvent(version_id=v1.id, event_type="published", actor=OWNER, created_at=now),
            VersionEvent(version_id=v2.id, event_type="created", actor=OWNER, created_at=now),
        ])
        await session.commit()
        print(
            f"created map {m.id} '{MAP_NAME}' - v1(published)={v1.id}, v2(draft)={v2.id}; "
            f"nodes v1/v2, edges v1={len(V1_EDGES)} v2={len(V2_EDGES)}"
        )


if __name__ == "__main__":
    asyncio.run(main())
