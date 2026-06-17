"""인라인 펼침 확인용 더미 1개 — Start/End 포함 3단계 중첩 하위 프로세스.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_inline_demo --reset
    PowerShell: .venv\\Scripts\\python -m scripts.seed_inline_demo --reset

--reset 은 DB의 모든 맵을 삭제 후 이 데모 맵 1개를 생성한다(db 초기화).
DB는 settings.database_url(로컬 기본 sqlite ./dev.db)을 그대로 쓴다.
"""

import argparse
import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_models
from app.models import Edge, MapVersion, Node, ProcessMap

# 색 프리셋(frontend COLOR_PRESETS와 동일 계열) — 데이터/출력이라 헥스 직접 사용 허용
GRAY = "#9a9aa6"
BLUE = "#3d7eff"
PURPLE = "#6a41ff"
GREEN = "#2bc56f"
TEAL = "#14b8a6"
ORANGE = "#ff8a33"

X_START = 80.0
X_STEP = 240.0
Y_BASE = 220.0

# (id, title, node_type, color, parent) — parent=None 은 루트 스코프
NODES: list[tuple[str, str, str, str, str | None]] = [
    # 루트 흐름: 시작 → 접수 → [심사(하위)] → 통보 → 종료
    ("r-start", "시작", "start", GRAY, None),
    ("r-intake", "신청 접수", "process", BLUE, None),
    ("r-review", "심사", "process", PURPLE, None),
    ("r-notify", "결과 통보", "process", TEAL, None),
    ("r-end", "종료", "end", GRAY, None),
    # 심사(r-review)의 하위: 시작 → 서류 검토 → [승인(중첩 하위)] → 종료
    ("s-start", "심사 시작", "start", GRAY, "r-review"),
    ("s-doc", "서류 검토", "process", BLUE, "r-review"),
    ("s-approve", "승인", "process", ORANGE, "r-review"),
    ("s-end", "심사 종료", "end", GRAY, "r-review"),
    # 승인(s-approve)의 중첩 하위: 시작 → 1차 승인 → 2차 승인 → 종료
    ("a-start", "승인 시작", "start", GRAY, "s-approve"),
    ("a-first", "1차 승인", "process", GREEN, "s-approve"),
    ("a-second", "2차 승인", "process", PURPLE, "s-approve"),
    ("a-end", "승인 종료", "end", GRAY, "s-approve"),
]

# 스코프별 직렬 엣지(같은 parent 안에서 순서대로 연결)
EDGES: list[tuple[str, str]] = [
    ("r-start", "r-intake"),
    ("r-intake", "r-review"),
    ("r-review", "r-notify"),
    ("r-notify", "r-end"),
    ("s-start", "s-doc"),
    ("s-doc", "s-approve"),
    ("s-approve", "s-end"),
    ("a-start", "a-first"),
    ("a-first", "a-second"),
    ("a-second", "a-end"),
]


async def main(reset: bool) -> None:
    await init_models()
    async with SessionLocal() as session:
        existing = list((await session.scalars(select(ProcessMap))).all())
        if existing:
            if not reset:
                print(f"abort  기존 맵 {len(existing)}개 존재. --reset 으로 전체 삭제 후 재생성하세요.")
                return
            for process_map in existing:
                await session.delete(process_map)  # cascade로 버전/노드/엣지 정리
            await session.flush()
            print(f"reset  기존 맵 {len(existing)}개 삭제")

        process_map = ProcessMap(
            name="인라인 펼침 데모",
            description="Start/End 포함 3단계 중첩 하위 프로세스 — 인라인 펼치기/접기 확인용 더미.",
            created_by="seed",
        )
        session.add(process_map)
        await session.flush()
        version = MapVersion(map_id=process_map.id, label="v1")
        session.add(version)
        await session.flush()

        # 스코프별 좌→우 배치(인라인 펼침은 자식 좌표를 dagre로 재배치하므로 대략적이어도 무방)
        scope_x: dict[str | None, float] = {}
        for order, (nid, title, ntype, color, parent) in enumerate(NODES):
            x = scope_x.get(parent, X_START)
            session.add(
                Node(
                    id=nid,
                    version_id=version.id,
                    parent_node_id=parent,
                    title=title,
                    description="",
                    node_type=ntype,
                    color=color,
                    assignee="",
                    department="",
                    system="",
                    duration="",
                    source_node_id=None,
                    pos_x=x,
                    pos_y=Y_BASE,
                    sort_order=order,
                )
            )
            scope_x[parent] = x + X_STEP

        for index, (src, dst) in enumerate(EDGES):
            session.add(
                Edge(
                    id=f"e{index + 1}",
                    version_id=version.id,
                    source_node_id=src,
                    target_node_id=dst,
                    label="",
                )
            )
        await session.commit()
        print(
            f"create '인라인 펼침 데모' — map {process_map.id}, 1 version, "
            f"{len(NODES)} nodes, {len(EDGES)} edges"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="인라인 펼침 확인용 더미 1개 시드")
    parser.add_argument("--reset", action="store_true", help="DB의 모든 맵 삭제 후 데모 1개 생성")
    args = parser.parse_args()
    asyncio.run(main(args.reset))
