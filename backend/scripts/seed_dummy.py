"""더미 프로세스맵 3세트 시드 — 세트별 4~6 버전, 병렬 구조·계층 깊이 편차 포함 (docs/spec.md §1·§7).

각 세트는 base 트리에 버전별 누적 델타(edit/drop/add)를 적용해 As-Is→To-Be 계보를 만든다.
계보(source_node_id)를 전파하므로 버전 비교 화면에서 added/removed/changed 가 실제로 표시된다.

세트:
  1) 구매 프로세스 — 4단계 드릴다운 + 평가 병렬, 6 버전 (복잡)
  2) 신규 입사자 온보딩 — 3단계 + 준비작업 병렬, 5 버전 (중간)
  3) 경비 정산 — 2단계, 대부분 직렬, 4 버전 (단순)

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.seed_dummy --reset
    PowerShell: .venv\\Scripts\\python -m scripts.seed_dummy --reset

--reset 은 DB의 모든 맵을 삭제 후 3세트를 새로 만든다(db 초기화). 없이 실행하면 기존 데이터가 있을 때 중단한다.
--verify 는 시드 후 세트별 인접 버전 diff(추가/삭제/변경) 개수를 출력한다.
DB는 settings.database_url(로컬 기본 sqlite ./dev.db)을 그대로 쓴다.
"""

import argparse
import asyncio
import copy

from sqlalchemy import select

from app.db import SessionLocal, init_models
from app.models import Comment, Edge, Group, MapVersion, Node, ProcessMap

# Whimsical 8톤 stroke 프리셋 (frontend COLOR_PRESETS와 동일) — 데이터/출력이라 헥스 직접 사용 허용
PURPLE = "#6a41ff"
BLUE = "#3d7eff"
TEAL = "#14b8a6"
GREEN = "#2bc56f"
YELLOW = "#e0a800"
ORANGE = "#ff8a33"
PINK = "#ff5c9a"
GRAY = "#9a9aa6"

# 그룹 박스(업무 묶음) 색 — 노드 stroke와 구분되는 옅은 톤
GROUP_COLORS = [TEAL, ORANGE, PINK, BLUE]

# 캔버스 스코프 내 배치 (px) — 한 스코프는 좌→우, 병렬 분기는 위아래 레인
X_START = 80.0
X_STEP = 240.0
Y_BASE = 220.0
LANE_GAP = 150.0


def n(
    lkey: str,
    title: str,
    node_type: str = "process",
    color: str = "",
    *,
    assignee: str = "",
    department: str = "",
    system: str = "",
    duration: str = "",
    group: str = "",
    children: list | None = None,
) -> dict:
    """노드 한 개 스펙. lkey=버전 간 안정적 계보 키. children=하위 캔버스(드릴다운)."""
    return {
        "par": False,
        "lkey": lkey,
        "title": title,
        "node_type": node_type,
        "color": color,
        "assignee": assignee,
        "department": department,
        "system": system,
        "duration": duration,
        "group": group,
        "children": children or [],
    }


def par(*branches: list) -> dict:
    """병렬 블록 — 각 branch(노드 시퀀스)가 직전 노드에서 갈라져 다음 노드로 합류한다."""
    return {"par": True, "branches": [list(b) for b in branches]}


# ──────────────────────────────────────────────────────────────────────────
# Set 1: 구매 프로세스 — 4단계 드릴다운 + 평가 병렬 (복잡, 6 버전)
# ──────────────────────────────────────────────────────────────────────────
PROCUREMENT_BASE = [
    n("a01", "구매 시작", "start", GRAY),
    n("a02", "구매 요청", "process", BLUE,
      assignee="김현업", department="생산팀", system="ERP", duration="1일"),
    n("a03", "예산 확인", "decision", YELLOW,
      assignee="이재무", department="재무팀", system="ERP", duration="0.5일"),
    n("a04", "발주", "process", PURPLE, department="구매팀", duration="3일", children=[
        n("a05", "견적 요청", "process", BLUE, system="이메일", duration="2일"),
        n("a06", "업체 선정", "process", PURPLE, department="구매팀", duration="5일", children=[
            n("a07", "후보 업체 조사", "process", TEAL, system="조달시스템", duration="2일"),
            n("a08", "업체 평가", "process", ORANGE, department="구매팀", duration="3일", children=[
                # 3개 평가를 병렬로 수행 후 종합 점수로 합류 (4단계 + 병렬)
                par(
                    [n("a09", "가격 평가", "process", GREEN, system="평가시트", duration="1일")],
                    [n("a10", "품질 평가", "process", BLUE, department="품질팀", duration="1일")],
                    [n("a11", "납기 평가", "process", TEAL, department="구매팀", duration="1일")],
                ),
                n("a12", "종합 점수 산정", "process", PURPLE, assignee="구매팀장", duration="1일"),
            ]),
            n("a13", "선정 승인", "process", GREEN, assignee="구매팀장", duration="1일"),
        ]),
        n("a14", "계약 체결", "process", PINK, department="법무팀", duration="3일"),
        n("a15", "발주서 발행", "process", BLUE, system="ERP", duration="0.5일"),
    ]),
    n("a16", "입고 검수", "process", TEAL, department="물류팀", system="WMS", duration="1일"),
    n("a17", "대금 지급", "process", GREEN, department="재무팀", system="ERP", duration="2일"),
    n("a18", "구매 종료", "end", GRAY),
]

PROCUREMENT = {
    "name": "구매 프로세스",
    "description": "구매요청부터 대금지급까지의 조달 프로세스. 평가 병렬·4단계 드릴다운, 6 버전 더미.",
    "prefix": "pm1",
    "base": PROCUREMENT_BASE,
    "versions": [
        {"label": "As-Is"},
        {"label": "To-Be 초안",
         "edit": {"a05": {"duration": "1일"}, "a14": {"department": "법무팀", "assignee": "법무담당"}}},
        {"label": "To-Be v1",
         "add": [("a04", "a15", n("a19", "전자계약 체결", "process", PURPLE,
                                  department="법무팀", system="전자계약", duration="1일"))],
         "drop": ["a14"]},
        {"label": "검토본",
         "edit": {"a02": {"duration": "0.5일", "system": "ERP/모바일"},
                  "a17": {"duration": "1일"}}},
        {"label": "승인본",
         "add": [(None, "a16", n("a20", "품질 입고 검사", "process", ORANGE,
                                 department="품질팀", system="WMS", duration="1일"))]},
        {"label": "최종본",
         "edit": {"a09": {"assignee": "구매담당"}, "a10": {"assignee": "품질담당"},
                  "a11": {"assignee": "구매담당"}}},
    ],
    # (version_index 0-based, lkey, author, body, resolved)
    "comments": [
        (5, "a08", "이재무", "평가 항목별 가중치 기준을 문서로 첨부해 주세요.", False),
        (5, "a19", "박법무", "전자계약 도입 후 종이계약 절차는 폐기 확인.", True),
        (3, "a17", "김현업", "대금 지급 SLA를 2일에서 1일로 단축한 근거 확인 필요.", False),
    ],
}


# ──────────────────────────────────────────────────────────────────────────
# Set 2: 신규 입사자 온보딩 — 3단계 + 준비작업 병렬 (중간, 5 버전)
# ──────────────────────────────────────────────────────────────────────────
ONBOARDING_BASE = [
    n("b01", "입사 확정", "start", GRAY),
    n("b02", "입사 안내", "process", BLUE,
      assignee="박인사", department="인사팀", system="HRIS", duration="1일"),
    n("b03", "온보딩 준비", "process", PURPLE, department="인사팀", duration="3일", children=[
        # IT 계정 / 좌석·장비 / 교육 준비를 병렬로 진행 후 첫 출근으로 합류
        par(
            [n("b04", "IT 계정 발급", "process", TEAL, department="IT팀", system="IAM", duration="1일",
               group="IT 준비"),
             n("b05", "보안 권한 설정", "process", TEAL, department="IT팀", system="IAM", duration="0.5일",
               group="IT 준비")],
            [n("b06", "좌석 배정", "process", ORANGE, department="총무팀", duration="0.5일", group="총무 준비"),
             n("b07", "장비 지급", "process", ORANGE, department="총무팀", system="자산관리", duration="1일",
               group="총무 준비")],
            [n("b08", "교육 일정 편성", "process", PINK, department="인사팀", system="LMS", duration="1일")],
        ),
        n("b09", "첫 출근 준비 완료", "process", GREEN, assignee="박인사", duration="0.5일"),
    ]),
    n("b10", "온보딩 교육", "process", BLUE, department="인사팀", system="LMS", duration="5일", children=[
        n("b11", "회사 소개 교육", "process", TEAL, duration="1일"),
        n("b12", "직무 교육", "process", PURPLE, assignee="팀리드", duration="3일"),
        n("b13", "보안 교육", "process", ORANGE, department="보안팀", duration="1일"),
    ]),
    n("b14", "수습 평가", "decision", YELLOW, department="인사팀", duration="2일"),
    n("b15", "온보딩 완료", "end", GRAY),
]

ONBOARDING = {
    "name": "신규 입사자 온보딩",
    "description": "입사 확정부터 수습 평가까지의 온보딩 프로세스. 준비작업 병렬·3단계, 5 버전 더미.",
    "prefix": "pm2",
    "base": ONBOARDING_BASE,
    "versions": [
        {"label": "As-Is"},
        {"label": "To-Be",
         "edit": {"b04": {"duration": "0.5일", "system": "IAM/자동프로비저닝"}},
         "add": [("b10", "b13", n("b16", "멘토 배정", "process", PINK,
                                  department="인사팀", duration="0.5일"))]},
        {"label": "검토본",
         "edit": {"b12": {"duration": "2일"}, "b14": {"duration": "1일"}}},
        {"label": "보완본",
         "add": [(None, "b14", n("b17", "온보딩 설문", "process", TEAL,
                                 department="인사팀", system="설문도구", duration="0.5일"))]},
        {"label": "확정본",
         "edit": {"b07": {"system": "자산관리/모바일"}},
         "drop": ["b13"]},
    ],
    "comments": [
        (4, "b03", "박인사", "병렬 준비작업 중 IT 계정 발급이 가장 자주 지연됩니다.", False),
        (4, "b17", "이교육", "설문 결과를 다음 분기 온보딩 개선에 반영 예정.", True),
    ],
}


# ──────────────────────────────────────────────────────────────────────────
# Set 3: 경비 정산 — 2단계, 대부분 직렬 (단순, 4 버전)
# ──────────────────────────────────────────────────────────────────────────
EXPENSE_BASE = [
    n("c01", "경비 발생", "start", GRAY),
    n("c02", "영수증 등록", "process", BLUE,
      assignee="김사원", department="영업팀", system="경비시스템", duration="0.5일"),
    n("c03", "경비 신청", "process", TEAL, assignee="김사원", system="경비시스템", duration="0.5일"),
    n("c04", "승인", "decision", PURPLE, department="재무팀", duration="1일", children=[
        n("c05", "팀장 승인", "process", BLUE, assignee="영업팀장", duration="0.5일"),
        n("c06", "재무 검토", "process", ORANGE, department="재무팀", system="ERP", duration="0.5일"),
    ]),
    n("c07", "지급 처리", "process", GREEN, department="재무팀", system="ERP", duration="1일"),
    n("c08", "정산 완료", "end", GRAY),
]

EXPENSE = {
    "name": "경비 정산 프로세스",
    "description": "경비 발생부터 지급까지의 정산 프로세스. 2단계·단순 직렬, 4 버전 더미.",
    "prefix": "pm3",
    "base": EXPENSE_BASE,
    "versions": [
        {"label": "As-Is"},
        {"label": "To-Be",
         "edit": {"c02": {"system": "경비시스템/모바일", "duration": "0.2일"}}},
        {"label": "검토본",
         "add": [(None, "c07", n("c09", "전자 결재", "process", PURPLE,
                                 department="재무팀", system="전자결재", duration="0.5일"))],
         "drop": ["c06"]},
        {"label": "최종본",
         "edit": {"c07": {"duration": "0.5일"}}},
    ],
    "comments": [
        (3, "c04", "이재무", "팀장 승인과 재무 검토를 병렬화하는 안을 다음 버전에서 검토.", False),
    ],
}

SPECS = [PROCUREMENT, ONBOARDING, EXPENSE]


# ── 트리 델타 적용 ─────────────────────────────────────────────────────────
def _walk_nodes(items: list[dict]):
    """트리(병렬 블록 포함)의 모든 노드 dict를 순회 yield."""
    for item in items:
        if item["par"]:
            for branch in item["branches"]:
                yield from _walk_nodes(branch)
        else:
            yield item
            yield from _walk_nodes(item["children"])


def _find_node(items: list[dict], lkey: str) -> dict | None:
    for node in _walk_nodes(items):
        if node["lkey"] == lkey:
            return node
    return None


def _scope_list(items: list[dict], parent_lkey: str | None) -> list[dict] | None:
    """parent_lkey 노드의 children 리스트(없으면 None은 루트 리스트)를 반환."""
    if parent_lkey is None:
        return items
    parent = _find_node(items, parent_lkey)
    return parent["children"] if parent else None


def _remove_node(items: list[dict], lkey: str) -> bool:
    """lkey 노드를 트리 어디에 있든 제거(하위 포함). 성공 여부 반환."""
    for index, item in enumerate(items):
        if item["par"]:
            for branch in item["branches"]:
                if _remove_node(branch, lkey):
                    return True
        elif item["lkey"] == lkey:
            del items[index]
            return True
        elif _remove_node(item["children"], lkey):
            return True
    return False


def _insert_after(scope: list[dict], after_lkey: str | None, node: dict) -> None:
    """scope 리스트에서 after_lkey 다음 위치에 node 삽입. None이면 맨 끝."""
    if after_lkey is None:
        scope.append(node)
        return
    for index, item in enumerate(scope):
        if not item["par"] and item["lkey"] == after_lkey:
            scope.insert(index + 1, node)
            return
    scope.append(node)  # 못 찾으면 끝에 — 델타 lkey 오타 방어


def build_version_tree(base: list[dict], deltas: list[dict]) -> list[dict]:
    """base 복제본에 v2..vN 델타를 순서대로 누적 적용한 트리를 반환."""
    tree = copy.deepcopy(base)
    for delta in deltas:
        for lkey, changes in delta.get("edit", {}).items():
            node = _find_node(tree, lkey)
            if node:
                node.update(changes)
        for lkey in delta.get("drop", []):
            _remove_node(tree, lkey)
        for parent_lkey, after_lkey, node_spec in delta.get("add", []):
            scope = _scope_list(tree, parent_lkey)
            if scope is not None:
                _insert_after(scope, after_lkey, copy.deepcopy(node_spec))
    return tree


# ── 레이아웃 + 엣지 (병렬 fan-out/fan-in) ──────────────────────────────────
def layout_tree(tree: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    """트리를 펼쳐 배치된 노드 목록과 엣지(lkey 쌍) 목록을 만든다.

    한 스코프는 좌→우 직렬 연결, par 블록은 분기들이 직전 tail에서 갈라져 다음 head로 합류한다.
    children는 별도 캔버스(드릴다운)이므로 좌표를 새로 시작한다.
    """
    placed: list[dict] = []
    edges: list[tuple[str, str]] = []

    def layout_scope(
        items: list[dict], parent_lkey: str | None, x0: float, y_center: float
    ) -> tuple[list[str], list[str], float]:
        seq_head: list[str] = []
        prev_tails: list[str] = []
        x = x0
        for item in items:
            if item["par"]:
                branch_heads: list[str] = []
                branch_tails: list[str] = []
                x_end = x
                count = len(item["branches"])
                for bi, branch in enumerate(item["branches"]):
                    lane_y = y_center + (bi - (count - 1) / 2) * LANE_GAP
                    heads, tails, xe = layout_scope(branch, parent_lkey, x, lane_y)
                    branch_heads += heads
                    branch_tails += tails
                    x_end = max(x_end, xe)
                cur_heads, cur_tails = branch_heads, branch_tails
                x = x_end
            else:
                placed.append(
                    {
                        "lkey": item["lkey"],
                        "parent_lkey": parent_lkey,
                        "title": item["title"],
                        "node_type": item["node_type"],
                        "color": item["color"],
                        "assignee": item["assignee"],
                        "department": item["department"],
                        "system": item["system"],
                        "duration": item["duration"],
                        "group": item["group"],
                        "x": x,
                        "y": y_center,
                        "sort": len(placed),
                    }
                )
                cur_heads, cur_tails = [item["lkey"]], [item["lkey"]]
                x += X_STEP
                if item["children"]:
                    layout_scope(item["children"], item["lkey"], X_START, Y_BASE)
            for tail in prev_tails:
                for head in cur_heads:
                    edges.append((tail, head))
            if not seq_head:
                seq_head = cur_heads
            prev_tails = cur_tails
        return seq_head, prev_tails, x

    layout_scope(tree, None, X_START, Y_BASE)
    return placed, edges


# ── ORM 변환 ───────────────────────────────────────────────────────────────
def emit_version(
    prefix: str,
    vnum: int,
    birth: dict[str, int],
    placed: list[dict],
    edge_pairs: list[tuple[str, str]],
    version_id: int,
) -> tuple[list[Node], list[Edge], list[Group]]:
    """배치된 노드/엣지를 버전 vnum의 ORM 객체로. 계보 루트는 birth 버전 id."""

    def node_id(lkey: str) -> str:
        return f"{prefix}-v{vnum}-{lkey}"

    def root_id(lkey: str) -> str:
        return f"{prefix}-v{birth[lkey]}-{lkey}"

    nodes: list[Node] = []
    groups: list[Group] = []
    group_ids: dict[tuple[str | None, str], str] = {}  # (scope, label) -> group id

    for p in placed:
        lkey = p["lkey"]
        parent_lkey = p["parent_lkey"]
        parent_id = node_id(parent_lkey) if parent_lkey else None

        gid = None
        if p["group"]:
            gkey = (parent_lkey, p["group"])
            if gkey not in group_ids:
                idx = len(group_ids)
                gid_new = f"{prefix}-v{vnum}-g{idx + 1}"
                group_ids[gkey] = gid_new
                groups.append(
                    Group(
                        id=gid_new,
                        version_id=version_id,
                        parent_node_id=parent_id,
                        label=p["group"],
                        color=GROUP_COLORS[idx % len(GROUP_COLORS)],
                    )
                )
            gid = group_ids[gkey]

        nodes.append(
            Node(
                id=node_id(lkey),
                version_id=version_id,
                parent_node_id=parent_id,
                title=p["title"],
                description="",
                node_type=p["node_type"],
                color=p["color"],
                assignee=p["assignee"],
                department=p["department"],
                system=p["system"],
                duration=p["duration"],
                # birth 버전은 자기 자신이 계보 루트(source=None), 이후 버전은 루트를 가리킴
                source_node_id=None if vnum == birth[lkey] else root_id(lkey),
                pos_x=p["x"],
                pos_y=p["y"],
                sort_order=p["sort"],
                group_id=gid,
            )
        )

    edges = [
        Edge(
            id=f"{prefix}-v{vnum}-e{index + 1}",
            version_id=version_id,
            source_node_id=node_id(src),
            target_node_id=node_id(dst),
            label="",
        )
        for index, (src, dst) in enumerate(edge_pairs)
    ]
    return nodes, edges, groups


async def seed_one(session, spec: dict) -> tuple[str, list]:
    """한 세트를 모든 버전과 함께 생성. (요약 문자열, 버전별 placed 메타) 반환."""
    # 1) 버전별 트리 구성 (누적 델타)
    deltas = spec["versions"]
    trees = [
        build_version_tree(spec["base"], [d for d in deltas[1 : i + 1]])
        for i in range(len(deltas))
    ]
    layouts = [layout_tree(tree) for tree in trees]  # [(placed, edges), ...]

    # 2) 계보 birth — lkey가 처음 등장한 버전 번호(1-based)
    birth: dict[str, int] = {}
    for vidx, (placed, _) in enumerate(layouts):
        vnum = vidx + 1
        for p in placed:
            birth.setdefault(p["lkey"], vnum)

    # 3) 맵·버전 행 생성
    process_map = ProcessMap(
        name=spec["name"], description=spec["description"], created_by="seed"
    )
    session.add(process_map)
    await session.flush()

    version_rows: list[MapVersion] = []
    for delta in deltas:
        version = MapVersion(map_id=process_map.id, label=delta["label"])
        session.add(version)
        version_rows.append(version)
    await session.flush()  # version id 확보

    # 4) 노드/엣지/그룹 emit
    total_nodes = 0
    placed_by_version: list[dict[str, dict]] = []
    for vidx, version in enumerate(version_rows):
        placed, edge_pairs = layouts[vidx]
        nodes, edges, groups = emit_version(
            spec["prefix"], vidx + 1, birth, placed, edge_pairs, version.id
        )
        session.add_all(nodes)
        session.add_all(edges)
        session.add_all(groups)
        total_nodes += len(nodes)
        placed_by_version.append({p["lkey"]: p for p in placed})

    # 5) 코멘트
    comment_count = 0
    for vidx, lkey, author, body, resolved in spec.get("comments", []):
        if lkey not in placed_by_version[vidx]:
            continue
        session.add(
            Comment(
                version_id=version_rows[vidx].id,
                node_id=f"{spec['prefix']}-v{vidx + 1}-{lkey}",
                author=author,
                body=body,
                resolved=resolved,
            )
        )
        comment_count += 1

    summary = (
        f"create '{spec['name']}' — map {process_map.id}, "
        f"{len(version_rows)} versions, {total_nodes} nodes, {comment_count} comments"
    )
    return summary, placed_by_version


def verify_diffs(spec: dict, placed_by_version: list[dict]) -> list[str]:
    """인접 버전 간 added/removed/changed 개수를 계산 — diff 화면이 변화를 보여줄지 검증."""
    # 비교 대상 필드 (diff.ts FIELD_KEYS와 동일, pos 제외)
    fields = ("title", "node_type", "color", "assignee", "department", "system", "duration")
    lines: list[str] = []
    labels = [d["label"] for d in spec["versions"]]
    for i in range(len(placed_by_version) - 1):
        left, right = placed_by_version[i], placed_by_version[i + 1]
        added = [k for k in right if k not in left]
        removed = [k for k in left if k not in right]
        changed = [
            k for k in left if k in right and any(left[k][f] != right[k][f] for f in fields)
        ]
        lines.append(
            f"    {labels[i]} → {labels[i + 1]}: "
            f"+{len(added)} added, -{len(removed)} removed, ~{len(changed)} changed"
        )
    return lines


async def main(reset: bool, verify: bool) -> None:
    await init_models()
    async with SessionLocal() as session:
        existing = list((await session.scalars(select(ProcessMap))).all())
        if existing:
            if not reset:
                print(
                    f"abort  기존 맵 {len(existing)}개 존재. --reset 으로 전체 삭제 후 재생성하세요."
                )
                return
            for process_map in existing:
                await session.delete(process_map)  # cascade로 버전/노드/엣지/코멘트/그룹 정리
            await session.flush()
            print(f"reset  기존 맵 {len(existing)}개 삭제")

        verify_data: list[tuple[dict, list]] = []
        for spec in SPECS:
            summary, placed_by_version = await seed_one(session, spec)
            print(summary)
            verify_data.append((spec, placed_by_version))
        await session.commit()

    if verify:
        print("\nverify  인접 버전 diff:")
        for spec, placed_by_version in verify_data:
            print(f"  {spec['name']}:")
            for line in verify_diffs(spec, placed_by_version):
                print(line)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="더미 프로세스맵 3세트 시드 (각 4~6 버전)")
    parser.add_argument("--reset", action="store_true", help="DB의 모든 맵 삭제 후 재생성")
    parser.add_argument("--verify", action="store_true", help="시드 후 인접 버전 diff 개수 출력")
    args = parser.parse_args()
    asyncio.run(main(args.reset, args.verify))
