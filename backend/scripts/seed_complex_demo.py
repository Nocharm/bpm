"""복잡한 다단계 데모 1개 — 깊이 4까지 + 루트에 하위프로세스 노드 여러 개(기획·개발·검증).

깊이 사슬: 개발 → 구현(1) → 백엔드(2) → DB 설계(3) → 그 하위(4).
포커스/인라인 펼침의 깊은 중첩·다중 분기 테스트용.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_complex_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_complex_demo

기존 맵은 건드리지 않고 이 맵("제품 개발 프로세스")만 추가한다. 같은 이름이 이미 있으면 지우고 다시 만든다(멱등).
DB는 settings.database_url(로컬 기본 sqlite ./dev.db)을 그대로 쓴다.
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_models
from app.models import Edge, MapVersion, Node, ProcessMap

# 색 프리셋(seed_inline_demo와 동일 계열) — 데이터/출력이라 헥스 직접 사용 허용
GRAY = "#9a9aa6"
BLUE = "#3d7eff"
PURPLE = "#6a41ff"
GREEN = "#2bc56f"
TEAL = "#14b8a6"
ORANGE = "#ff8a33"

MAP_NAME = "제품 개발 프로세스"

X_START = 80.0
X_STEP = 240.0
Y_BASE = 220.0

# (id, title, node_type, color, parent) — parent=None 은 루트 스코프
NODES: list[tuple[str, str, str, str, str | None]] = [
    # 루트(깊이0): 시작 → 기획[하위] → 개발[하위·깊이4 사슬] → 검증[하위] → 출시 → 종료
    ("d-start", "시작", "start", GRAY, None),
    ("d-plan", "기획", "process", BLUE, None),
    ("d-dev", "개발", "process", PURPLE, None),
    ("d-qa", "검증", "process", TEAL, None),
    ("d-launch", "출시", "process", ORANGE, None),
    ("d-end", "종료", "end", GRAY, None),
    # 기획(깊이1): 시작 → 시장 조사 → 요구사항 정의 → 종료
    ("p-start", "기획 시작", "start", GRAY, "d-plan"),
    ("p-research", "시장 조사", "process", BLUE, "d-plan"),
    ("p-spec", "요구사항 정의", "process", GREEN, "d-plan"),
    ("p-end", "기획 종료", "end", GRAY, "d-plan"),
    # 개발(깊이1): 시작 → 아키텍처 설계 → 구현[하위] → 통합 → 종료
    ("dv-start", "개발 시작", "start", GRAY, "d-dev"),
    ("dv-design", "아키텍처 설계", "process", TEAL, "d-dev"),
    ("dv-impl", "구현", "process", ORANGE, "d-dev"),
    ("dv-integ", "통합", "process", BLUE, "d-dev"),
    ("dv-end", "개발 종료", "end", GRAY, "d-dev"),
    # 구현(깊이2): 시작 → 프론트엔드 → 백엔드[하위] → 종료
    ("im-start", "구현 시작", "start", GRAY, "dv-impl"),
    ("im-fe", "프론트엔드", "process", BLUE, "dv-impl"),
    ("im-be", "백엔드", "process", PURPLE, "dv-impl"),
    ("im-end", "구현 종료", "end", GRAY, "dv-impl"),
    # 백엔드(깊이3): 시작 → API 개발 → DB 설계[하위] → 종료
    ("be-start", "백엔드 시작", "start", GRAY, "im-be"),
    ("be-api", "API 개발", "process", GREEN, "im-be"),
    ("be-db", "DB 설계", "process", TEAL, "im-be"),
    ("be-end", "백엔드 종료", "end", GRAY, "im-be"),
    # DB 설계(깊이4): 시작 → 스키마 정의 → 인덱스 설계 → 종료
    ("db-start", "DB 시작", "start", GRAY, "be-db"),
    ("db-schema", "스키마 정의", "process", BLUE, "be-db"),
    ("db-index", "인덱스 설계", "process", PURPLE, "be-db"),
    ("db-end", "DB 종료", "end", GRAY, "be-db"),
    # 검증(깊이1): 시작 → 단위 테스트 → 통합 테스트 → 종료
    ("qa-start", "검증 시작", "start", GRAY, "d-qa"),
    ("qa-unit", "단위 테스트", "process", GREEN, "d-qa"),
    ("qa-integ", "통합 테스트", "process", TEAL, "d-qa"),
    ("qa-end", "검증 종료", "end", GRAY, "d-qa"),
]

# 스코프별 직렬 엣지(같은 parent 안에서 순서대로 연결)
EDGES: list[tuple[str, str]] = [
    ("d-start", "d-plan"),
    ("d-plan", "d-dev"),
    ("d-dev", "d-qa"),
    ("d-qa", "d-launch"),
    ("d-launch", "d-end"),
    ("p-start", "p-research"),
    ("p-research", "p-spec"),
    ("p-spec", "p-end"),
    ("dv-start", "dv-design"),
    ("dv-design", "dv-impl"),
    ("dv-impl", "dv-integ"),
    ("dv-integ", "dv-end"),
    ("im-start", "im-fe"),
    ("im-fe", "im-be"),
    ("im-be", "im-end"),
    ("be-start", "be-api"),
    ("be-api", "be-db"),
    ("be-db", "be-end"),
    ("db-start", "db-schema"),
    ("db-schema", "db-index"),
    ("db-index", "db-end"),
    ("qa-start", "qa-unit"),
    ("qa-unit", "qa-integ"),
    ("qa-integ", "qa-end"),
]


async def main() -> None:
    await init_models()
    async with SessionLocal() as session:
        # 같은 이름 맵이 있으면 지우고 재생성(멱등) — 다른 맵은 보존
        dupes = list(
            (await session.scalars(select(ProcessMap).where(ProcessMap.name == MAP_NAME))).all()
        )
        for dupe in dupes:
            await session.delete(dupe)  # cascade로 버전/노드/엣지 정리
        if dupes:
            await session.flush()
            print(f"reset  기존 '{MAP_NAME}' {len(dupes)}개 삭제")

        process_map = ProcessMap(
            name=MAP_NAME,
            description="깊이 4까지 중첩 + 루트에 하위프로세스 노드 여러 개(기획·개발·검증). 깊은 포커스/펼침 테스트용.",
            created_by="seed",
        )
        session.add(process_map)
        await session.flush()
        version = MapVersion(map_id=process_map.id, label="v1")
        session.add(version)
        await session.flush()

        # 스코프별 좌→우 배치(저장 pos 기준으로 buildScope가 배치)
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
                    id=f"c{index + 1}",
                    version_id=version.id,
                    source_node_id=src,
                    target_node_id=dst,
                    label="",
                )
            )
        await session.commit()
        print(
            f"create '{MAP_NAME}' — map {process_map.id}, 1 version, "
            f"{len(NODES)} nodes, {len(EDGES)} edges (깊이 4)"
        )


if __name__ == "__main__":
    asyncio.run(main())
