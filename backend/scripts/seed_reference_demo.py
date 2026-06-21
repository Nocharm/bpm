"""하위프로세스 참조 모델(Call Activity) 데모 시드 — 평면 노드 + 다른 맵 링크.

스펙 2026-06-20-subprocess-reference-model-design §3·§5·§9. 인라인 계층(parent_node_id)을
폐기한 평면 모델의 **데모 겸 검증 픽스처**다. 스펙의 신기능을 한 흐름에서 모두 보여준다 —
임베드·읽기전용 드릴인·다중 출구(대표/분기 끝)·고정 참조·자동추종(follow_latest)·버전 업데이트 배지.

구성:
  A) 주문 처리 (published v1) — 접수→검토→[완료(대표끝)/취소(분기끝)]. 다중 출구 링크 대상.
  B) 배송      (published v1, v2) — v1: 출고→배송중→배송완료(대표끝).
                v2(최신): 출고→배송중→배송 추적→배송완료(대표끝). **끝 동일(안전 업데이트)**.
  D) 결제      (published v1) — 결제 요청→승인→[승인완료(대표끝)/거절(분기끝)]. 자동추종 대상.
  C) 주문 이행 (draft, 편집) — 주문 접수
        → 결제(C-pay, **follow_latest** → D 최신 발행본 자동추종)
        → 주문 처리(C-order, **고정 v1** → A, 대표끝 주 흐름 + '취소' 분기끝 → 주문 취소됨)
        → 배송(C-deliver, **고정 v1** → B; B에 더 최신 v2 발행본 존재 → **'업데이트?' 배지**)
        → 이행 완료(대표끝).

실행 (backend/ 에서, dev.db 파일을 먼저 지운 뒤 — create_all은 컬럼을 ALTER하지 않음):
    bash:       rm -f dev.db && .venv/bin/python -m scripts.seed_reference_demo
    PowerShell: Remove-Item dev.db; .venv\\Scripts\\python -m scripts.seed_reference_demo
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_models
from app.models import Edge, MapVersion, Node, ProcessMap

# 데이터/출력이라 헥스 직접 사용 허용 (frontend COLOR_PRESETS 톤)
GRAY = "#9a9aa6"
BLUE = "#3d7eff"
TEAL = "#14b8a6"
GREEN = "#2bc56f"
ORANGE = "#ff8a33"
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
    y: float = Y,
    is_primary_end: bool = False,
    linked_map_id: int | None = None,
    linked_version_id: int | None = None,
    follow_latest: bool = False,
) -> Node:
    return Node(
        id=nid,
        version_id=version_id,
        title=title,
        node_type=node_type,
        color=color,
        pos_x=x,
        pos_y=y,
        sort_order=order,
        is_primary_end=is_primary_end,
        linked_map_id=linked_map_id,
        linked_version_id=linked_version_id,
        follow_latest=follow_latest,
    )


def _edge(
    eid: str,
    version_id: int,
    src: str,
    dst: str,
    *,
    label: str = "",
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> Edge:
    return Edge(
        id=eid,
        version_id=version_id,
        source_node_id=src,
        target_node_id=dst,
        label=label,
        source_side="right",
        target_side="left",
        source_handle=source_handle,
        target_handle=target_handle,
    )


async def _make_map(
    session, name: str, description: str, label: str, status: str
) -> tuple[int, int]:
    """맵 + 단일 버전 생성. (map_id, version_id) 반환."""
    pm = ProcessMap(name=name, description=description, created_by="seed")
    session.add(pm)
    await session.flush()
    ver = MapVersion(map_id=pm.id, label=label, status=status)
    session.add(ver)
    await session.flush()
    return pm.id, ver.id


async def _add_version(session, map_id: int, label: str, status: str) -> int:
    """기존 맵에 버전 추가 — version_id 반환 (배송 v2 = 더 최신 발행본 시연용)."""
    ver = MapVersion(map_id=map_id, label=label, status=status)
    session.add(ver)
    await session.flush()
    return ver.id


async def main() -> None:
    await init_models()
    async with SessionLocal() as session:
        existing = list((await session.scalars(select(ProcessMap))).all())
        for pm in existing:
            await session.delete(pm)  # cascade로 버전/노드/엣지 정리
        if existing:
            await session.flush()
            print(f"reset  기존 맵 {len(existing)}개 삭제")

        # A) 주문 처리 — published. 대표끝(완료) + 분기끝(취소).
        a_map, a_ver = await _make_map(
            session, "주문 처리", "주문 접수·검토 후 완료/취소로 분기.", "v1", "published"
        )
        session.add_all([
            _node("a-start", a_ver, "접수", "start", X0, 0, color=GRAY),
            _node("a-review", a_ver, "검토", "process", X0 + STEP, 1, color=BLUE),
            _node("a-done", a_ver, "완료", "end", X0 + STEP * 2, 2, color=GREEN, is_primary_end=True),
            _node("a-cancel", a_ver, "취소", "end", X0 + STEP * 2, 3, color=ORANGE, y=Y + 180),
        ])
        session.add_all([
            _edge("a-e1", a_ver, "a-start", "a-review"),
            _edge("a-e2", a_ver, "a-review", "a-done"),
            _edge("a-e3", a_ver, "a-review", "a-cancel", label="반려"),
        ])

        # B) 배송 — published v1, 그리고 더 최신 published v2(안전 업데이트: 끝 동일, 단계만 추가).
        b_map, b_ver1 = await _make_map(
            session, "배송", "출고 후 배송 완료까지.", "v1", "published"
        )
        session.add_all([
            _node("b1-start", b_ver1, "출고", "start", X0, 0, color=GRAY),
            _node("b1-ship", b_ver1, "배송중", "process", X0 + STEP, 1, color=TEAL),
            _node("b1-done", b_ver1, "배송완료", "end", X0 + STEP * 2, 2, color=GREEN, is_primary_end=True),
        ])
        session.add_all([
            _edge("b1-e1", b_ver1, "b1-start", "b1-ship"),
            _edge("b1-e2", b_ver1, "b1-ship", "b1-done"),
        ])
        b_ver2 = await _add_version(session, b_map, "v2", "published")
        session.add_all([
            _node("b2-start", b_ver2, "출고", "start", X0, 0, color=GRAY),
            _node("b2-ship", b_ver2, "배송중", "process", X0 + STEP, 1, color=TEAL),
            _node("b2-track", b_ver2, "배송 추적", "process", X0 + STEP * 2, 2, color=TEAL),
            _node("b2-done", b_ver2, "배송완료", "end", X0 + STEP * 3, 3, color=GREEN, is_primary_end=True),
        ])
        session.add_all([
            _edge("b2-e1", b_ver2, "b2-start", "b2-ship"),
            _edge("b2-e2", b_ver2, "b2-ship", "b2-track"),
            _edge("b2-e3", b_ver2, "b2-track", "b2-done"),
        ])

        # D) 결제 — published. 자동추종(follow_latest) 대상. 대표끝(승인완료) + 분기끝(거절).
        d_map, d_ver = await _make_map(
            session, "결제", "결제 요청·승인 후 승인완료/거절로 분기.", "v1", "published"
        )
        session.add_all([
            _node("d-start", d_ver, "결제 요청", "start", X0, 0, color=GRAY),
            _node("d-approve", d_ver, "승인", "process", X0 + STEP, 1, color=BLUE),
            _node("d-ok", d_ver, "승인완료", "end", X0 + STEP * 2, 2, color=GREEN, is_primary_end=True),
            _node("d-reject", d_ver, "거절", "end", X0 + STEP * 2, 3, color=ORANGE, y=Y + 180),
        ])
        session.add_all([
            _edge("d-e1", d_ver, "d-start", "d-approve"),
            _edge("d-e2", d_ver, "d-approve", "d-ok"),
            _edge("d-e3", d_ver, "d-approve", "d-reject", label="반려"),
        ])

        # C) 주문 이행 — draft(편집 가능). 결제(자동추종)·주문 처리(고정)·배송(고정, 업데이트 배지)을 링크.
        c_map, c_ver = await _make_map(
            session, "주문 이행", "결제·주문 처리·배송을 하위프로세스로 묶은 상위 흐름.", "v1", "draft"
        )
        session.add_all([
            _node("c-start", c_ver, "주문 접수", "start", X0, 0, color=GRAY),
            # 자동추종 — 항상 결제(D)의 최신 발행본 해석
            _node("c-pay", c_ver, "결제", "subprocess", X0 + STEP, 1, color=VIOLET,
                  linked_map_id=d_map, follow_latest=True),
            # 고정 — 주문 처리(A) v1. 대표끝 + 분기끝('취소')
            _node("c-order", c_ver, "주문 처리", "subprocess", X0 + STEP * 2, 2, color=VIOLET,
                  linked_map_id=a_map, linked_version_id=a_ver),
            # 고정 — 배송(B) v1. B에 더 최신 v2 발행본이 있어 '업데이트?' 배지가 뜬다.
            _node("c-deliver", c_ver, "배송", "subprocess", X0 + STEP * 3, 3, color=VIOLET,
                  linked_map_id=b_map, linked_version_id=b_ver1),
            _node("c-done", c_ver, "이행 완료", "end", X0 + STEP * 4, 4, color=GREEN, is_primary_end=True),
            _node("c-cancelled", c_ver, "주문 취소됨", "end", X0 + STEP * 2, 5, color=ORANGE, y=Y + 180),
        ])
        session.add_all([
            # 대표끝(__primary__) 주 흐름 — 각 하위프로세스의 대표끝 → 다음 노드 입력 핸들("in")
            _edge("c-e1", c_ver, "c-start", "c-pay", target_handle="in"),
            _edge("c-e2", c_ver, "c-pay", "c-order", source_handle="__primary__", target_handle="in"),
            _edge("c-e3", c_ver, "c-order", "c-deliver", source_handle="__primary__", target_handle="in"),
            _edge("c-e4", c_ver, "c-deliver", "c-done", source_handle="__primary__"),
            # 분기끝('취소') best-effort 연결 — 주문 처리의 '취소' 끝 → 주문 취소됨
            _edge("c-e5", c_ver, "c-order", "c-cancelled", source_handle="취소", label="취소"),
        ])

        await session.commit()
        print(f"create 주문 처리 — map {a_map}, ver {a_ver} (published)")
        print(f"create 배송 — map {b_map}, ver {b_ver1} (published v1) + ver {b_ver2} (published v2, 최신)")
        print(f"create 결제 — map {d_map}, ver {d_ver} (published, follow_latest 대상)")
        print(f"create 주문 이행 — map {c_map}, ver {c_ver} (draft) — 결제(추종)·주문 처리(고정)·배송(고정+업데이트배지)")


if __name__ == "__main__":
    asyncio.run(main())
