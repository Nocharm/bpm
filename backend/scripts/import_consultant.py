"""컨설턴트 canonical 전달물 임포트 — 멱등 업서트·버전 적재/게시·SP 지정 (dry-run/apply).

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §5·§8. 승인 워크플로·알림은
부트스트랩 경로로 의도적으로 우회한다(오너 이양 전 대량 알림 방지).

실행 (backend/ 에서, 기본 dry-run):
    bash:       .venv/bin/python -m scripts.import_consultant <delivery_dir> [--apply]
    PowerShell: .venv\\Scripts\\python -m scripts.import_consultant <delivery_dir> [--apply]
"""

import hashlib

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Edge, Employee, Node, ProcessCategory
from scripts.consultant_canonical import CanonicalCategory, CanonicalMap, CanonicalParams

_X_STEP = 240  # rank 간 가로 간격(px) — create_map Start/End 시드(120→480)와 동일 리듬
_Y_STEP = 120  # rank 내 세로 간격(px)


def make_node_id(map_code: str, node_code: str) -> str:
    # 컨설턴트 코드에서 파생한 결정적 id — 재임포트에도 불변이라 버전 비교 diff가 노드를 매칭한다
    return "c" + hashlib.sha1(f"{map_code}|{node_code}".encode()).hexdigest()[:24]


def make_edge_id(map_code: str, src_code: str, dst_code: str) -> str:
    return "e" + hashlib.sha1(f"{map_code}|{src_code}|{dst_code}".encode()).hexdigest()[:24]


def _compute_ranks(codes: list[str], pairs: list[tuple[str, str]]) -> dict[str, int]:
    """Kahn 토폴로지 순서로 rank(=max(선행)+1). 사이클 잔여 노드는 뒤 rank로 순차 배정(전량 배치)."""
    indeg = {c: 0 for c in codes}
    out: dict[str, list[str]] = {c: [] for c in codes}
    for src, dst in pairs:
        out[src].append(dst)
        indeg[dst] += 1
    rank = {c: 0 for c in codes}
    queue = [c for c in codes if indeg[c] == 0]
    seen: list[str] = []
    while queue:
        cur = queue.pop(0)
        seen.append(cur)
        for nxt in out[cur]:
            rank[nxt] = max(rank[nxt], rank[cur] + 1)
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    leftover = [c for c in codes if c not in seen]
    base = (max(rank[c] for c in seen) + 1) if seen and leftover else 0
    for i, code in enumerate(leftover):
        rank[code] = base + i
    return rank


def build_graph_rows(
    cmap: CanonicalMap,
    link_targets: dict[str, tuple[int, CanonicalParams]],
) -> tuple[list[Node], list[Edge], list[str]]:
    """canonical 맵 1건 → Node/Edge ORM 행(version_id는 호출자가 채움) + 경고."""
    warnings: list[str] = []
    ordered = sorted(cmap.nodes, key=lambda n: (n.seq, n.code))
    l7_codes = [n.code for n in ordered]

    # 흐름 엣지 — 명시 엣지 없으면 seq 체인, 있으면 그대로 + Start/End 보강
    flow: list[tuple[str, str, str]] = (
        [(e.source, e.target, e.label) for e in cmap.edges]
        if cmap.edges
        else [(a, b, "") for a, b in zip(l7_codes, l7_codes[1:])]
    )
    has_in = {dst for _, dst, _ in flow}
    has_out = {src for src, _, _ in flow}
    start, end = "__start__", "__end__"
    for code in l7_codes:
        if code not in has_in:
            flow.append((start, code, ""))
        if code not in has_out:
            flow.append((code, end, ""))

    # 연계 노드 — after_node 뒤(생략 시 최대 seq 노드 뒤) 병렬 분기, End 배선 불변 (design §4)
    link_rows: list[tuple[str, str, int, CanonicalParams]] = []  # (가상코드, 부착원점, map_id, params)
    for link in cmap.links:
        target = link_targets.get(link.to_map)
        if target is None:
            warnings.append(f"{cmap.code}: link target not in delivery/DB: {link.to_map}")
            continue
        attach = link.after_node or (l7_codes[-1] if l7_codes else start)
        link_rows.append((f"__link__{link.to_map}", attach, target[0], target[1]))
    for virtual, attach, _, _ in link_rows:
        flow.append((attach, virtual, ""))

    all_codes = [start, *l7_codes, *[v for v, *_ in link_rows], end]
    ranks = _compute_ranks(all_codes, [(s, d) for s, d, _ in flow])
    row_in_rank: dict[int, int] = {}

    def place(code: str) -> tuple[float, float]:
        r = ranks[code]
        row = row_in_rank.get(r, 0)
        row_in_rank[r] = row + 1
        return 120 + r * _X_STEP, 200 + row * _Y_STEP

    nodes: list[Node] = []
    sx, sy = place(start)
    nodes.append(Node(id=make_node_id(cmap.code, start), title="Start", node_type="start", pos_x=sx, pos_y=sy, sort_order=0))
    for i, cn in enumerate(ordered, start=1):
        x, y = place(cn.code)
        nodes.append(Node(
            id=make_node_id(cmap.code, cn.code), title=cn.name, node_type=cn.type,
            department=cn.department, assignee=cn.assignee, system=cn.system,
            pos_x=x, pos_y=y, sort_order=i,
        ))
    for j, (virtual, _, map_id, params) in enumerate(link_rows):
        x, y = place(virtual)
        nodes.append(Node(
            id=make_node_id(cmap.code, virtual), title=virtual.removeprefix("__link__"),
            node_type="subprocess", linked_map_id=map_id, follow_latest=True,
            annual_count=params.annual_count, fte=params.fte,
            pos_x=x, pos_y=y, sort_order=len(ordered) + 1 + j,
        ))
    ex, ey = place(end)
    nodes.append(Node(
        id=make_node_id(cmap.code, end), title="End", node_type="end",
        is_primary_end=True, pos_x=ex, pos_y=ey, sort_order=len(nodes),
    ))

    edges = [
        Edge(
            id=make_edge_id(cmap.code, src, dst),
            source_node_id=make_node_id(cmap.code, src),
            target_node_id=make_node_id(cmap.code, dst),
            label=label,
        )
        for src, dst, label in flow
    ]
    return nodes, edges, warnings


async def upsert_categories(
    session: AsyncSession, cats: list[CanonicalCategory]
) -> dict[str, int]:
    """code 기준 멱등 업서트 — 개명 안전. 반환: code→id (parent 해석용)."""
    existing = {
        c.code: c for c in (await session.scalars(select(ProcessCategory))).all()
    }
    ids: dict[str, int] = {}
    for order, cat in enumerate(sorted(cats, key=lambda c: c.level)):
        row = existing.get(cat.code)
        parent_id = ids.get(cat.parent) if cat.parent else None
        if row is None:
            row = ProcessCategory(code=cat.code, name=cat.name, level=cat.level,
                                  parent_id=parent_id, sort_order=order)
            session.add(row)
            await session.flush()
            existing[cat.code] = row
        else:
            row.name, row.level, row.parent_id, row.sort_order = cat.name, cat.level, parent_id, order
        ids[cat.code] = row.id
    return ids


async def build_known_departments(session: AsyncSession) -> set[str]:
    # routers/maps._assert_known_department와 동일 규약 — 직원 org 전 prefix의 "/" 조인
    rows = (
        await session.execute(
            select(Employee.org_l1, Employee.org_l2, Employee.org_l3,
                   Employee.org_l4, Employee.org_l5)
        )
    ).all()
    known: set[str] = set()
    for levels in rows:
        parts = [lv for lv in levels if lv]
        for i in range(1, len(parts) + 1):
            known.add("/".join(parts[:i]))
    return known


async def resolve_owning_department(
    session: AsyncSession, known: set[str], dept: str, owner: str
) -> tuple[str | None, str | None]:
    """canonical department → 오너 org 폴백 → (None, 경고) (design §5.3)."""
    dept = dept.strip()
    if dept and dept in known:
        return dept, None
    employee = await session.get(Employee, owner)
    parts = (
        [lv for lv in (employee.org_l1, employee.org_l2, employee.org_l3,
                       employee.org_l4, employee.org_l5) if lv]
        if employee else []
    )
    if parts:
        path = "/".join(parts)
        note = f"department {dept!r} unknown — fallback to owner org {path!r}" if dept else None
        if not dept:
            note = f"department empty — fallback to owner org {path!r}"
        return path, note
    return None, f"department {dept!r} unknown and owner {owner!r} has no org — left NULL"
