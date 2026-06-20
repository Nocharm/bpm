"""복잡한 다단계 데모 1개 — 깊이 4 + 루트에 하위프로세스 노드 여러 개 + 그룹·속성·분기.

내용:
- 깊이 사슬: 개발 → 구현(1) → 백엔드(2) → DB 설계(3) → 그 하위(4).
- 루트에 하위프로세스 보유 노드 3개(기획·개발·검증).
- 전 노드 description + 속성(담당자/부서/시스템/소요시간).
- 그룹 2개: 루트 "핵심 개발"(기획·개발), 개발 스코프 "엔지니어링"(설계·구현).
- 검증 스코프에 decision 분기(품질 판정) + 엣지 라벨(통과/결함/재검증) + 핸들 변(side) + 결함 수정 루프백.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_complex_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_complex_demo

기존 맵은 건드리지 않고 이 맵("제품 개발 프로세스")만 추가한다. 같은 이름이 이미 있으면 지우고 다시 만든다(멱등).
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_models
from app.models import Edge, Group, MapVersion, Node, ProcessMap

# 색 프리셋 — 데이터/출력이라 헥스 직접 사용 허용
GRAY = "#9a9aa6"
BLUE = "#3d7eff"
PURPLE = "#6a41ff"
GREEN = "#2bc56f"
TEAL = "#14b8a6"
ORANGE = "#ff8a33"
ROSE = "#f43f5e"

MAP_NAME = "제품 개발 프로세스"

# 노드: id, title, type, color, parent, x, y, 담당자, 부서, 시스템, 소요, 설명, [그룹id...]
N = tuple  # 가독성용 별칭
NODES: list[tuple] = [
    # ── 루트(깊이0): 시작 → 기획 → 개발 → 검증 → 출시 → 종료
    ("d-start", "시작", "start", GRAY, None, 80, 220, "", "", "", "", "제품 개발 프로세스 착수", []),
    ("d-plan", "기획", "process", BLUE, None, 320, 220, "김기획", "기획팀", "Jira", "2주", "제품 요구사항·시장성 검토", ["g-core"]),
    ("d-dev", "개발", "process", PURPLE, None, 560, 220, "이개발", "개발팀", "GitHub", "8주", "설계·구현·통합", ["g-core"]),
    ("d-qa", "검증", "process", TEAL, None, 800, 220, "박검증", "QA팀", "TestRail", "3주", "품질 검증·테스트", []),
    ("d-launch", "출시", "process", ORANGE, None, 1040, 220, "최운영", "운영팀", "AWS", "1주", "프로덕션 배포·릴리스 공지", []),
    ("d-end", "종료", "end", GRAY, None, 1280, 220, "", "", "", "", "프로세스 완료", []),
    # ── 기획(깊이1): 시작 → 시장 조사 → 요구사항 정의 → 종료
    ("p-start", "기획 시작", "start", GRAY, "d-plan", 80, 220, "", "", "", "", "", []),
    ("p-research", "시장 조사", "process", BLUE, "d-plan", 320, 220, "김기획", "기획팀", "Notion", "5일", "경쟁사·시장 규모·고객 니즈 분석", []),
    ("p-spec", "요구사항 정의", "process", GREEN, "d-plan", 560, 220, "김기획", "기획팀", "Confluence", "5일", "기능 명세서·우선순위 확정", []),
    ("p-end", "기획 종료", "end", GRAY, "d-plan", 800, 220, "", "", "", "", "", []),
    # ── 개발(깊이1): 시작 → 아키텍처 설계 → 구현 → 통합 → 종료
    ("dv-start", "개발 시작", "start", GRAY, "d-dev", 80, 220, "", "", "", "", "", []),
    ("dv-design", "아키텍처 설계", "process", TEAL, "d-dev", 320, 220, "이개발", "개발팀", "Figma", "1주", "시스템 구조·기술 스택·API 계약 결정", ["g-eng"]),
    ("dv-impl", "구현", "process", ORANGE, "d-dev", 560, 220, "이개발", "개발팀", "GitHub", "5주", "프론트엔드·백엔드 구현", ["g-eng"]),
    ("dv-integ", "통합", "process", BLUE, "d-dev", 800, 220, "정통합", "개발팀", "Jenkins", "1주", "모듈 통합·CI 파이프라인", []),
    ("dv-end", "개발 종료", "end", GRAY, "d-dev", 1040, 220, "", "", "", "", "", []),
    # ── 구현(깊이2): 시작 → 프론트엔드 → 백엔드 → 종료
    ("im-start", "구현 시작", "start", GRAY, "dv-impl", 80, 220, "", "", "", "", "", []),
    ("im-fe", "프론트엔드", "process", BLUE, "dv-impl", 320, 220, "한프론트", "개발팀", "React", "3주", "UI 컴포넌트·상태관리·라우팅", []),
    ("im-be", "백엔드", "process", PURPLE, "dv-impl", 560, 220, "서백엔드", "개발팀", "FastAPI", "3주", "API·도메인 로직·영속화", []),
    ("im-end", "구현 종료", "end", GRAY, "dv-impl", 800, 220, "", "", "", "", "", []),
    # ── 백엔드(깊이3): 시작 → API 개발 → DB 설계 → 종료
    ("be-start", "백엔드 시작", "start", GRAY, "im-be", 80, 220, "", "", "", "", "", []),
    ("be-api", "API 개발", "process", GREEN, "im-be", 320, 220, "서백엔드", "개발팀", "FastAPI", "2주", "REST 엔드포인트·요청 검증", []),
    ("be-db", "DB 설계", "process", TEAL, "im-be", 560, 220, "서백엔드", "개발팀", "PostgreSQL", "1주", "스키마·마이그레이션", []),
    ("be-end", "백엔드 종료", "end", GRAY, "im-be", 800, 220, "", "", "", "", "", []),
    # ── DB 설계(깊이4): 시작 → 스키마 정의 → 인덱스 설계 → 종료
    ("db-start", "DB 시작", "start", GRAY, "be-db", 80, 220, "", "", "", "", "", []),
    ("db-schema", "스키마 정의", "process", BLUE, "be-db", 320, 220, "서백엔드", "개발팀", "PostgreSQL", "3일", "테이블·관계 모델링", []),
    ("db-index", "인덱스 설계", "process", PURPLE, "be-db", 560, 220, "서백엔드", "개발팀", "PostgreSQL", "2일", "쿼리 패턴 기반 인덱스 최적화", []),
    ("db-end", "DB 종료", "end", GRAY, "be-db", 800, 220, "", "", "", "", "", []),
    # ── 검증(깊이1): 시작 → 단위 → 통합 → [품질 판정] → 종료, 결함 시 수정 루프백
    ("qa-start", "검증 시작", "start", GRAY, "d-qa", 80, 220, "", "", "", "", "", []),
    ("qa-unit", "단위 테스트", "process", GREEN, "d-qa", 320, 220, "박검증", "QA팀", "pytest", "3일", "함수·모듈 단위 테스트", []),
    ("qa-integ", "통합 테스트", "process", TEAL, "d-qa", 560, 220, "박검증", "QA팀", "Playwright", "4일", "E2E·통합 시나리오 검증", []),
    ("qa-judge", "품질 판정", "decision", ORANGE, "d-qa", 820, 220, "박검증", "QA팀", "", "1일", "출시 기준(커버리지·결함 수) 충족 여부", []),
    ("qa-end", "검증 종료", "end", GRAY, "d-qa", 1080, 220, "", "", "", "", "", []),
    ("qa-rework", "결함 수정", "process", ROSE, "d-qa", 560, 420, "이개발", "개발팀", "GitHub", "2일", "발견된 결함 수정 후 재검증", []),
]

# 그룹: id, parent(스코프), label, color
GROUPS: list[tuple] = [
    ("g-core", None, "핵심 개발", PURPLE),  # 루트: 기획·개발
    ("g-eng", "d-dev", "엔지니어링", TEAL),  # 개발 스코프: 설계·구현
]

# 엣지: source, target, label, source_side, target_side
EDGES: list[tuple] = [
    # 루트
    ("d-start", "d-plan", "", "right", "left"),
    ("d-plan", "d-dev", "", "right", "left"),
    ("d-dev", "d-qa", "", "right", "left"),
    ("d-qa", "d-launch", "", "right", "left"),
    ("d-launch", "d-end", "", "right", "left"),
    # 기획
    ("p-start", "p-research", "", "right", "left"),
    ("p-research", "p-spec", "", "right", "left"),
    ("p-spec", "p-end", "", "right", "left"),
    # 개발
    ("dv-start", "dv-design", "", "right", "left"),
    ("dv-design", "dv-impl", "", "right", "left"),
    ("dv-impl", "dv-integ", "", "right", "left"),
    ("dv-integ", "dv-end", "", "right", "left"),
    # 구현
    ("im-start", "im-fe", "", "right", "left"),
    ("im-fe", "im-be", "", "right", "left"),
    ("im-be", "im-end", "", "right", "left"),
    # 백엔드
    ("be-start", "be-api", "", "right", "left"),
    ("be-api", "be-db", "", "right", "left"),
    ("be-db", "be-end", "", "right", "left"),
    # DB 설계(깊이4)
    ("db-start", "db-schema", "", "right", "left"),
    ("db-schema", "db-index", "", "right", "left"),
    ("db-index", "db-end", "", "right", "left"),
    # 검증 + 분기 루프
    ("qa-start", "qa-unit", "", "right", "left"),
    ("qa-unit", "qa-integ", "", "right", "left"),
    ("qa-integ", "qa-judge", "", "right", "left"),
    ("qa-judge", "qa-end", "통과", "right", "left"),  # 마름모 source 유지
    ("qa-judge", "qa-rework", "결함", "bottom", "right"),
    ("qa-rework", "qa-unit", "재검증", "left", "bottom"),
]


async def main() -> None:
    await init_models()
    async with SessionLocal() as session:
        # 같은 이름 맵이 있으면 지우고 재생성(멱등) — 다른 맵은 보존
        dupes = list(
            (await session.scalars(select(ProcessMap).where(ProcessMap.name == MAP_NAME))).all()
        )
        for dupe in dupes:
            await session.delete(dupe)  # cascade로 버전/노드/엣지/그룹 정리
        if dupes:
            await session.flush()
            print(f"reset  기존 '{MAP_NAME}' {len(dupes)}개 삭제")

        process_map = ProcessMap(
            name=MAP_NAME,
            description="깊이 4 중첩 + 루트 다중 하위프로세스 + 그룹·속성·분기. 깊은 포커스/펼침·그룹·속성 테스트용.",
            created_by="seed",
        )
        session.add(process_map)
        await session.flush()
        version = MapVersion(map_id=process_map.id, label="v1")
        session.add(version)
        await session.flush()

        for gid, parent, label, color in GROUPS:
            session.add(
                Group(id=gid, version_id=version.id, parent_node_id=parent, label=label, color=color)
            )

        for order, (nid, title, ntype, color, parent, x, y, who, dept, sysn, dur, desc, groups) in enumerate(NODES):
            session.add(
                Node(
                    id=nid,
                    version_id=version.id,
                    parent_node_id=parent,
                    title=title,
                    description=desc,
                    node_type=ntype,
                    color=color,
                    assignee=who,
                    department=dept,
                    system=sysn,
                    duration=dur,
                    source_node_id=None,
                    pos_x=float(x),
                    pos_y=float(y),
                    sort_order=order,
                    group_ids=list(groups),
                )
            )

        for index, (src, dst, label, sside, tside) in enumerate(EDGES):
            session.add(
                Edge(
                    id=f"c{index + 1}",
                    version_id=version.id,
                    source_node_id=src,
                    target_node_id=dst,
                    label=label,
                    source_side=sside,
                    target_side=tside,
                )
            )
        await session.commit()
        print(
            f"create '{MAP_NAME}' — map {process_map.id}, 1 version, "
            f"{len(NODES)} nodes, {len(EDGES)} edges, {len(GROUPS)} groups (깊이 4 + 속성·그룹·분기)"
        )


if __name__ == "__main__":
    asyncio.run(main())
