"""하위프로세스 참조 모델(Call Activity) 최소 시드 — 평면 노드 + 다른 맵 링크.

스펙 2026-06-20-subprocess-reference-model-design §3·§9. 인라인 계층(parent_node_id)을 폐기한
평면 모델의 **검증용 픽스처**다. Plan 2(프론트) Playwright 실측에 필요한 최소 구성만 만든다 —
풍부한 데모는 Plan 3에서 별도 설계.

구성:
  A) 주문 처리 (published) — start→검토→[완료(대표끝)/취소(분기끝)]. 링크 대상 + 다중 출구.
  B) 배송 (published)       — start→배송중→배송완료(대표끝). 단순 링크 대상.
  C) 주문 이행 (draft, 편집) — start→[주문 처리 링크]→[배송 링크]→이행 완료(대표끝),
                               주문 처리의 '취소' 분기끝 → 주문 취소됨. 임베드·드릴인·드래그·다중출구 검증.

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

        # B) 배송 — published. 단일 대표끝.
        b_map, b_ver = await _make_map(
            session, "배송", "출고 후 배송 완료까지.", "v1", "published"
        )
        session.add_all([
            _node("b-start", b_ver, "출고", "start", X0, 0, color=GRAY),
            _node("b-ship", b_ver, "배송중", "process", X0 + STEP, 1, color=TEAL),
            _node("b-done", b_ver, "배송완료", "end", X0 + STEP * 2, 2, color=GREEN, is_primary_end=True),
        ])
        session.add_all([
            _edge("b-e1", b_ver, "b-start", "b-ship"),
            _edge("b-e2", b_ver, "b-ship", "b-done"),
        ])

        # C) 주문 이행 — draft(편집 가능). 주문 처리·배송을 하위프로세스로 링크.
        c_map, c_ver = await _make_map(
            session, "주문 이행", "주문 처리·배송을 하위프로세스로 묶은 상위 흐름.", "v1", "draft"
        )
        session.add_all([
            _node("c-start", c_ver, "주문 접수", "start", X0, 0, color=GRAY),
            _node("c-order", c_ver, "주문 처리", "subprocess", X0 + STEP, 1, color=VIOLET,
                  linked_map_id=a_map, linked_version_id=a_ver),
            _node("c-deliver", c_ver, "배송", "subprocess", X0 + STEP * 2, 2, color=VIOLET,
                  linked_map_id=b_map, linked_version_id=b_ver),
            _node("c-done", c_ver, "이행 완료", "end", X0 + STEP * 3, 3, color=GREEN, is_primary_end=True),
            _node("c-cancelled", c_ver, "주문 취소됨", "end", X0 + STEP, 4, color=ORANGE, y=Y + 180),
        ])
        session.add_all([
            # 대표끝(__primary__) 주 흐름
            _edge("c-e1", c_ver, "c-start", "c-order", target_handle="in"),
            _edge("c-e2", c_ver, "c-order", "c-deliver", source_handle="__primary__", target_handle="in"),
            _edge("c-e3", c_ver, "c-deliver", "c-done", source_handle="__primary__"),
            # 분기끝('취소') best-effort 연결
            _edge("c-e4", c_ver, "c-order", "c-cancelled", source_handle="취소", label="취소"),
        ])

        await session.commit()
        print(f"create 주문 처리 — map {a_map}, ver {a_ver} (published)")
        print(f"create 배송 — map {b_map}, ver {b_ver} (published)")
        print(f"create 주문 이행 — map {c_map}, ver {c_ver} (draft, 2 subprocess links)")


if __name__ == "__main__":
    asyncio.run(main())
