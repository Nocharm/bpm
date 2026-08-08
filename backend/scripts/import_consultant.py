"""컨설턴트 canonical 전달물 임포트 — 멱등 업서트·버전 적재/게시·SP 지정 (dry-run/apply).

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §5·§8. 승인 워크플로·알림은
부트스트랩 경로로 의도적으로 우회한다(오너 이양 전 대량 알림 방지).

실행 (backend/ 에서, 기본 dry-run):
    bash:       .venv/bin/python -m scripts.import_consultant <delivery_dir> [--apply]
    PowerShell: .venv\\Scripts\\python -m scripts.import_consultant <delivery_dir> [--apply]
"""

import hashlib
import uuid
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.duration import normalize_duration
from app.models import (
    Edge,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.schemas import NUMERIC_RE
from app.version_events import record_version_event
from scripts.consultant_canonical import CanonicalCategory, CanonicalMap, CanonicalParams

_X_STEP = 240  # rank 간 가로 간격(px) — create_map Start/End 시드(120→480)와 동일 리듬
_Y_STEP = 120  # rank 내 세로 간격(px)


def make_node_id(map_code: str, node_code: str) -> str:
    # 컨설턴트 코드에서 파생한 결정적 값 — Node.id(테이블 전역 PK)로는 못 쓴다(재게시마다 충돌).
    # source_node_id 계보 루트로만 쓴다 — clone_graph와 같은 계보 규약(diff.ts getLineageKey)이라
    # 재임포트해도 버전 비교 diff가 노드를 매칭한다. 실제 Node.id는 빌드마다 uuid4로 새로 발급.
    return "c" + hashlib.sha1(f"{map_code}|{node_code}".encode()).hexdigest()[:24]


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

    # code(가상/L7) → 이번 빌드에서 발급한 Node.id — 엣지 배선은 이 id로, 계보는 source_node_id로 별도 기록
    code_to_id: dict[str, str] = {}

    nodes: list[Node] = []
    sx, sy = place(start)
    code_to_id[start] = uuid.uuid4().hex
    nodes.append(Node(
        id=code_to_id[start], source_node_id=make_node_id(cmap.code, start),
        title="Start", node_type="start", pos_x=sx, pos_y=sy, sort_order=0,
    ))
    for i, cn in enumerate(ordered, start=1):
        x, y = place(cn.code)
        code_to_id[cn.code] = uuid.uuid4().hex
        nodes.append(Node(
            id=code_to_id[cn.code], source_node_id=make_node_id(cmap.code, cn.code),
            title=cn.name, node_type=cn.type,
            department=cn.department, assignee=cn.assignee, system=cn.system,
            pos_x=x, pos_y=y, sort_order=i,
        ))
    for j, (virtual, _, map_id, params) in enumerate(link_rows):
        x, y = place(virtual)
        code_to_id[virtual] = uuid.uuid4().hex
        nodes.append(Node(
            id=code_to_id[virtual], source_node_id=make_node_id(cmap.code, virtual),
            title=virtual.removeprefix("__link__"),
            node_type="subprocess", linked_map_id=map_id, follow_latest=True,
            annual_count=params.annual_count, fte=params.fte,
            pos_x=x, pos_y=y, sort_order=len(ordered) + 1 + j,
        ))
    ex, ey = place(end)
    code_to_id[end] = uuid.uuid4().hex
    nodes.append(Node(
        id=code_to_id[end], source_node_id=make_node_id(cmap.code, end),
        title="End", node_type="end",
        is_primary_end=True, pos_x=ex, pos_y=ey, sort_order=len(nodes),
    ))

    edges = [
        Edge(
            id=uuid.uuid4().hex,
            source_node_id=code_to_id[src],
            target_node_id=code_to_id[dst],
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


@dataclass
class ImportReport:
    """전달분 1건의 임포트 결과 — 맵별 행(action∈created/updated/unchanged/error/warning)."""

    rows: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, map_code: str, action: str, detail: str = "") -> None:
        self.rows.append((map_code, action, detail))

    def counts(self) -> dict[str, int]:
        # warning은 부가 정보라 맵 단위 집계(created/updated/unchanged/error)에서 제외
        out: dict[str, int] = {}
        for _, action, _ in self.rows:
            if action != "warning":
                out[action] = out.get(action, 0) + 1
        return out


def _normalize_params(cmap: CanonicalMap, report: ImportReport) -> CanonicalParams:
    """duration/cost/headcount 정규화 — 무효값은 경고 후 "" 소거(422 아님, §7 무효값 계약과 동형)."""
    p = cmap.params.model_copy()
    if p.duration:
        normalized = normalize_duration(p.duration)
        if normalized is None:
            report.add(cmap.code, "warning", f"invalid duration {p.duration!r} dropped")
            p.duration = ""
        else:
            p.duration = normalized
    if p.cost_krw.strip() and p.cost_usd.strip():
        report.add(cmap.code, "warning", "both cost_krw and cost_usd set — cost_usd dropped")
        p.cost_usd = ""
    for name in ("cost_krw", "cost_usd", "headcount", "annual_count", "fte"):
        value = getattr(p, name).strip()
        if value and not NUMERIC_RE.fullmatch(value):
            report.add(cmap.code, "warning", f"invalid {name} {value!r} dropped")
            value = ""
        setattr(p, name, value)
    return p


def _graph_signature(nodes: list[Node], edges: list[Edge]) -> tuple:
    # pos_x/pos_y 제외 — 레이아웃은 콘텐츠 diff 대상이 아님(엔진 규칙 5).
    # 식별은 Node.id(빌드마다 새 uuid)가 아닌 source_node_id 계보 루트로 — diff.ts getLineageKey와
    # 동일 규약(node.source_node_id ?? node.id). 엣지도 끝점을 id→계보 루트로 매핑해 비교한다.
    # `or ""` — build_graph_rows가 만든 미영속 행은 컬럼 default가 아직 적용되지 않아 미설정
    # 문자열 필드가 None인 반면 DB에서 읽은 기존 행은 이미 ""로 굳어 있다 — 안 맞추면 항상 "변경"으로 오판.
    id_to_root = {n.id: (n.source_node_id or n.id) for n in nodes}
    return (
        sorted(
            (n.source_node_id or n.id, n.title, n.node_type, n.department or "", n.assignee or "",
             n.system or "", n.linked_map_id, n.annual_count or "", n.fte or "", bool(n.is_primary_end))
            for n in nodes
        ),
        sorted(
            (id_to_root[e.source_node_id], id_to_root[e.target_node_id], e.label or "")
            for e in edges
        ),
    )


async def _latest_published(session: AsyncSession, map_id: int) -> MapVersion | None:
    return await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == map_id, MapVersion.status == "published")
        .order_by(MapVersion.version_number.desc())
        .limit(1)
    )


async def _publish(session: AsyncSession, map_id: int, version: MapVersion, actor: str) -> None:
    """routers/versions.publish_version과 동일 규칙(채번·기존 게시본 expired) — 승인·알림은 우회."""
    max_num = await session.scalar(
        select(func.max(MapVersion.version_number)).where(MapVersion.map_id == map_id)
    )
    version.version_number = (max_num or 0) + 1
    prior = await session.scalars(
        select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.status == "published")
    )
    for p in prior:
        p.status = "expired"
        record_version_event(session, p.id, "expired", actor)
    version.status = "published"
    record_version_event(session, version.id, "published", actor)


async def import_delivery(
    session: AsyncSession,
    *,
    categories: list[CanonicalCategory],
    maps: list[CanonicalMap],
    actor: str,
    label: str,
) -> ImportReport:
    """전달분 1건 임포트(2-pass) — commit은 호출자 책임(dry-run=rollback, apply=commit)."""
    report = ImportReport()
    category_ids = await upsert_categories(session, categories)
    known = await build_known_departments(session)

    existing = {
        m.consultant_code: m
        for m in (
            await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code.is_not(None)))
        ).all()
    }
    # pass 1 — 맵 껍데기 확보(신규 생성 포함) → link_targets 완성. 거버넌스 필드는 신규 생성 시에만 설정.
    created: set[str] = set()
    for cmap in maps:
        if cmap.category not in category_ids:
            report.add(cmap.code, "error", f"unknown category {cmap.category}")
            continue
        if cmap.code in existing:
            continue
        owning, note = await resolve_owning_department(session, known, cmap.department, cmap.owner)
        if note:
            report.add(cmap.code, "warning", note)
        new_map = ProcessMap(
            name=cmap.name, created_by=actor, owner_id=cmap.owner,
            visibility=cmap.visibility, owning_department=owning,
            category_id=category_ids[cmap.category], consultant_code=cmap.code,
        )
        session.add(new_map)
        await session.flush()
        session.add(MapPermission(
            map_id=new_map.id, principal_type="user",
            principal_id=cmap.owner, role="owner", granted_by=actor,
        ))
        for approver in dict.fromkeys(cmap.approvers):
            session.add(MapApprover(map_id=new_map.id, user_id=approver, assigned_by=actor))
        existing[cmap.code] = new_map
        created.add(cmap.code)

    # 연계 대상 = 이번 전달분 + 이전 전달분에만 있는 기존 맵(증분 전달 케이스).
    # DB-only 대상은 canonical params가 없어 annual/fte 시드는 공백(경고 불요 — 후속 편집 몫).
    link_targets: dict[str, tuple[int, CanonicalParams]] = {
        code: (m.id, CanonicalParams()) for code, m in existing.items()
    }
    for cmap in maps:
        if cmap.code in existing:
            link_targets[cmap.code] = (existing[cmap.code].id, cmap.params)

    # pass 2 — 그래프·버전·SP 지정. 콘텐츠 필드만 갱신(거버넌스는 위 신규 생성 분기에서만 설정).
    errored = {r[0] for r in report.rows if r[1] == "error"}
    for cmap in maps:
        if cmap.code in errored:
            continue
        found_map = existing[cmap.code]
        params = _normalize_params(cmap, report)
        nodes, edges, warnings = build_graph_rows(cmap, link_targets)
        for w in warnings:
            report.add(cmap.code, "warning", w)
        # 연계 노드 title을 대상 맵 이름으로 교체(빌더는 code 폴백) — DB-only 대상 포함, 이번 전달분 우선
        names = {code: m.name for code, m in existing.items()}
        names.update({m.code: m.name for m in maps})
        for n in nodes:
            if n.node_type == "subprocess" and n.title in names:
                n.title = names[n.title]

        latest = await _latest_published(session, found_map.id)
        old_nodes: list[Node] = []
        old_edges: list[Edge] = []
        graph_changed = True
        if latest is not None:
            old_nodes = list((await session.scalars(select(Node).where(Node.version_id == latest.id))).all())
            old_edges = list((await session.scalars(select(Edge).where(Edge.version_id == latest.id))).all())
            graph_changed = _graph_signature(old_nodes, old_edges) != _graph_signature(nodes, edges)

        sp_department = cmap.department.strip() or found_map.owning_department or ""
        if not sp_department:
            report.add(cmap.code, "warning", "sp_department empty")
        fields_changed = (
            found_map.name != cmap.name
            or found_map.category_id != category_ids[cmap.category]
            or (found_map.sp_department or "") != sp_department
            or (found_map.sp_input or "") != params.input
            or (found_map.sp_output or "") != params.output
            or (found_map.sp_duration or "") != params.duration
            or (found_map.sp_cost_krw or "") != params.cost_krw
            or (found_map.sp_cost_usd or "") != params.cost_usd
            or (found_map.sp_headcount or "") != params.headcount
        )
        # 콘텐츠 필드 갱신 — 거버넌스 필드(owner·visibility·owning_department·approvers)는 불변
        found_map.name = cmap.name
        found_map.category_id = category_ids[cmap.category]
        if found_map.sp_designated_at is None:
            found_map.sp_designated_at = now_kst()
        found_map.sp_department = sp_department
        found_map.sp_duration = params.duration
        found_map.sp_cost_krw = params.cost_krw
        found_map.sp_cost_usd = params.cost_usd
        found_map.sp_headcount = params.headcount
        found_map.sp_input = params.input
        found_map.sp_output = params.output
        found_map.sp_changed_by = actor
        found_map.sp_changed_at = now_kst()

        if graph_changed:
            # 만료되는 이전 버전의 그래프 행은 지우지 않는다 — 새 버전은 build_graph_rows가 매번
            # 새로 발급한 uuid Node/Edge.id를 쓰므로(계보는 source_node_id) PK 충돌이 없고,
            # 버전 비교 화면이 만료본 그래프를 그대로 조회할 수 있어야 한다(append-only 이력).
            version = MapVersion(map_id=found_map.id, label=label, status="draft")
            session.add(version)
            await session.flush()
            record_version_event(session, version.id, "created", actor)
            for row in (*nodes, *edges):
                row.version_id = version.id
                session.add(row)
            await _publish(session, found_map.id, version, actor)

        if cmap.code in created:
            report.add(cmap.code, "created", f"published v{version.version_number}" if graph_changed else "")
        elif graph_changed or fields_changed:
            report.add(cmap.code, "updated", "graph" if graph_changed else "map fields only")
        else:
            report.add(cmap.code, "unchanged", "")
    return report
