"""컨설턴트 체계 임포트 엔진 — 멱등 업서트·버전 적재/게시·SP 지정·노트 적재 (dry-run/apply).

설계: docs/design/2026-08-08-consultant-hierarchy-design.md §5·§8 +
docs/design/2026-08-18-interview-import-design.md. 승인 워크플로·알림은 부트스트랩 경로로
의도적으로 우회한다(오너 이양 전 대량 알림 방지). 진입점은 인터뷰 웹 임포트
(routers/categories.import_interview_delivery)뿐 — canonical 파일 CLI는 실전달물이
인터뷰 결과 JSON으로 확정되며 제거됨(2026-08-18).

`_publish`는 routers/versions.publish_version과 달리 KB 인덱싱을 스킵한다 — 전달 스케일
(최대 2만 맵)의 대량 임베딩은 부적절하며, 필요하면 별도 백필 스크립트로 다룬다.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from scripts.consultant_interview import InterviewNote

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.duration import normalize_duration
from app.models import (
    Edge,
    Employee,
    MapApprover,
    MapNote,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.orgchart import DeptIndex, load_dept_index, load_valid_org_prefixes, resolve_org_path
from app.schemas import NUMERIC_RE
from app.version_events import record_version_event
from scripts.consultant_canonical import (
    CanonicalCategory,
    CanonicalMap,
    CanonicalParams,
)

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
            title=cn.name, node_type=cn.type, description=cn.description, color=cn.color,
            department=cn.department, assignee=cn.assignee, system=cn.system,
            input=cn.input, output=cn.output, data_form=cn.data_form,
            system_fallback=cn.system_fallback,
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

    # 위 루프는 전달분 code만 건드린다 — UI 생성 카테고리(`ui-*`, POST /api/categories)는
    # 조상 depth가 바뀌어도 안 건드려져 level이 낡은 채 남는다. 모든 소비처(list_category_nodes/
    # _category_metrics 롤업, create/move의 parent.level+1 depth 가드)가 level==depth를 전제하므로
    # 테이블 전체를 루트부터 BFS 재계산해 어긋난 행만 고친다. `existing`은 위 루프가 이미 전체
    # process_categories를 담고 있으니(신규분 포함) 추가 조회 불필요.
    by_id = {row.id: row for row in existing.values()}
    children_by_parent: dict[int | None, list[int]] = {}
    for row in by_id.values():
        children_by_parent.setdefault(row.parent_id, []).append(row.id)
    visited: set[int] = set()
    frontier = [(rid, 1) for rid in children_by_parent.get(None, [])]
    while frontier:
        next_frontier: list[tuple[int, int]] = []
        for rid, level in frontier:
            if rid in visited:
                continue  # cycle guard — a corrupt parent chain can't hang the import
            visited.add(rid)
            row = by_id[rid]
            if row.level != level:
                row.level = level
            next_frontier.extend((cid, level + 1) for cid in children_by_parent.get(rid, []))
        frontier = next_frontier
    return ids


async def resolve_owning_department(
    session: AsyncSession, known: set[str], index: DeptIndex, dept: str, owner: str
) -> tuple[str | None, str | None]:
    """canonical department → 오너 org 폴백 → (None, 경고) (design §5.3).

    known·폴백 모두 orgchart resolver 소스(체인 해석+새니타이즈+상위 트림) — 피커·
    maps._assert_known_department와 같은 집합이어야 임포트가 박은 owning이 앱 검증·홈
    트리와 어긋나지 않는다(org 컬럼 인라인 조합 금지, 2026-08 조직 기준 전환 정합).
    """
    dept = dept.strip()
    if dept and dept in known:
        return dept, None
    employee = await session.get(Employee, owner)
    path = resolve_org_path(employee, index) if employee else ""
    if path:
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
    for name in ("duration", "touch_time"):  # touch_time은 duration과 동일 H.MM 계약 (2026-08-19)
        raw = getattr(p, name)
        if not raw:
            continue
        normalized = normalize_duration(raw)
        if normalized is None:
            report.add(cmap.code, "warning", f"invalid {name} {raw!r} dropped")
            setattr(p, name, "")
        else:
            setattr(p, name, normalized)
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
            (n.source_node_id or n.id, n.title, n.node_type, n.description or "", n.color or "",
             n.department or "", n.assignee or "", n.system or "", n.linked_map_id,
             n.annual_count or "", n.fte or "", bool(n.is_primary_end),
             # 승격 필드 — 전달분이 진실이라 변경=새 버전(사용자 수기 편집도 재임포트가 덮음,
             # 기존 description과 동일 계약) (design 2026-08-19 §4.1)
             n.touch_time or "", n.input or "", n.output or "",
             n.start_condition or "", n.end_condition or "",
             n.data_form or "", n.system_fallback or "")
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
    commit_every: int | None = None,
) -> ImportReport:
    """전달분 1건 임포트(2-pass) — commit은 호출자 책임(dry-run=rollback, apply=commit)."""
    report = ImportReport()

    # 전달분 내 중복 code는 첫 항목만 처리 — 이후 중복은 에러 행만 남기고 제외(뒤 항목이 앞을
    # 조용히 덮어써 일관성 없는 리포트가 나오는 걸 방지).
    seen_codes: set[str] = set()
    deduped: list[CanonicalMap] = []
    for cmap in maps:
        if cmap.code in seen_codes:
            report.add(cmap.code, "error", "duplicate map code in delivery — skipped")
            continue
        seen_codes.add(cmap.code)
        deduped.append(cmap)
    maps = deduped
    delivery_codes = {m.code for m in maps}

    category_ids = await upsert_categories(session, categories)
    known = await load_valid_org_prefixes(session)  # 피커·오우닝 검증과 동일 소스
    dept_index = await load_dept_index(session)

    # consultant_code is_not(None)로 이미 필터했지만 컬럼 타입은 str | None이라 아래서 str 키로
    # 쓰려면 명시 가드가 필요(Pyright dict[str, ...] 추론).
    existing: dict[str, ProcessMap] = {
        m.consultant_code: m
        for m in (
            await session.scalars(select(ProcessMap).where(ProcessMap.consultant_code.is_not(None)))
        ).all()
        if m.consultant_code is not None
    }

    # 휴지통(소프트삭제) 맵은 되살리지 않는다 — 재전달로 새 버전을 얹으면 _purge_expired가 7일
    # 내 그 버전째 영구삭제한다. pass 1/2 양쪽에서 건너뛰고 link_targets에서도 제외한다.
    trashed_in_delivery: set[str] = {
        cmap.code for cmap in maps
        if cmap.code in existing and existing[cmap.code].deleted_at is not None
    }
    for code in trashed_in_delivery:
        report.add(code, "error", "map is in trash — restore or purge before re-import")

    # params 정규화는 여기 1회만 — link_targets 시딩과 pass 2 SP 지정이 같은 값을 공유한다.
    # (예전엔 link_targets가 raw params를 써서 대상 맵의 무효값이 정규화 없이 연계 노드에 그대로 박혔다.)
    normalized: dict[str, CanonicalParams] = {m.code: _normalize_params(m, report) for m in maps}

    # annual_count/fte가 있는데 이번 전달분에 인바운드 연계가 없으면 그 값은 갈 곳이 없다 — 경고만
    # (design §4 "아무것도 안 잃는다"의 반례를 리포트로 표면화). NORMALIZED 값 기준(무효값 소거 후).
    inbound_linked = {link.to_map for m in maps for link in m.links}
    for cmap in maps:
        p = normalized[cmap.code]
        if (p.annual_count or p.fte) and cmap.code not in inbound_linked:
            report.add(cmap.code, "warning",
                       "annual_count/fte have no landing site — no inbound link in this delivery")

    # 맵 이름 중복은 차단·강제개명 대상이 아니다(컨트롤러 결정) — 컨설턴트 식별은 consultant_code,
    # 표시 구분은 카테고리 경로가 맡는다. 경고만 남기고 양쪽 다 정상 진행.
    name_counts: dict[str, list[str]] = {}
    for m in maps:
        name_counts.setdefault(m.name, []).append(m.code)
    delivery_dupe_names = {name for name, codes in name_counts.items() if len(codes) > 1}
    existing_names: dict[str, set[str | None]] = {}
    for name, code in (
        await session.execute(
            select(ProcessMap.name, ProcessMap.consultant_code).where(ProcessMap.deleted_at.is_(None))
        )
    ).all():
        existing_names.setdefault(name, set()).add(code)
    for m in maps:
        if m.name in delivery_dupe_names:
            report.add(m.code, "warning",
                       f"duplicate map name {m.name!r} also used by another map in this delivery")
        if existing_names.get(m.name, set()) - {m.code}:
            report.add(m.code, "warning", f"duplicate map name {m.name!r} already used by an existing map")

    # owner/approver 유령(직원 미등재) 감지 — 승인 정족수는 안 막힌다(load_active_approvers가
    # 미등재를 이미 걸러냄) — 관측용 경고. 조회는 한 번만.
    known_logins: set[str] = set((await session.scalars(select(Employee.login_id))).all())

    # pass 1 — 맵 껍데기 확보(신규 생성 포함) → link_targets 완성. 거버넌스 필드는 신규 생성 시에만 설정.
    created: set[str] = set()
    # report.rows에서 "error" action을 다시 스캔하지 않는다 — 중복 code 에러 행이 살아남은 첫
    # 항목과 같은 code를 써서 그 항목까지 pass 2에서 스킵되는 오염을 막기 위해 카테고리 에러만 별도 추적.
    category_errored: set[str] = set()
    created_count = 0  # 신규 생성분만 세어 청크 커밋(기존 맵은 쓰기가 없어 카운트에서 제외)
    for cmap in maps:
        if cmap.code in trashed_in_delivery:
            continue
        if cmap.category not in category_ids:
            report.add(cmap.code, "error", f"unknown category {cmap.category}")
            category_errored.add(cmap.code)
            continue
        if cmap.code in existing:
            # 거버넌스 불변 원칙의 명시적 예외 — 오너 미확정(pending)으로 만들어진 맵만, 재전달에
            # 실오너가 오면 오너·권한행·승인자·오우닝을 갱신하고 플래그를 내린다 (design 2026-08-18 §4).
            found = existing[cmap.code]
            assigned_owner = cmap.owner
            if found.consultant_owner_pending and assigned_owner is not None:
                owning, note = await resolve_owning_department(
                    session, known, dept_index, cmap.department, assigned_owner
                )
                if note:
                    report.add(cmap.code, "warning", note)
                if assigned_owner not in known_logins:
                    report.add(cmap.code, "warning", f"owner {assigned_owner!r} not found in employees")
                found.owner_id = assigned_owner
                found.owning_department = owning
                found.consultant_owner_pending = False
                for perm in await session.scalars(select(MapPermission).where(
                        MapPermission.map_id == found.id, MapPermission.role == "owner")):
                    perm.principal_id = assigned_owner
                    perm.granted_by = actor
                await session.execute(delete(MapApprover).where(MapApprover.map_id == found.id))
                for approver in dict.fromkeys(cmap.approvers):
                    if approver not in known_logins:
                        report.add(cmap.code, "warning", f"approver {approver!r} not found in employees")
                    session.add(MapApprover(map_id=found.id, user_id=approver, assigned_by=actor))
                report.add(cmap.code, "governance", f"owner {assigned_owner} assigned")
            continue
        owner_login = cmap.owner
        pending = owner_login is None
        owning: str | None
        note: str | None
        if owner_login is None:
            # 오너 미확정 — actor(실행 sysadmin) 폴백. 오우닝은 actor 조직으로 오염시키지 않고
            # NULL로 남긴다(홈 부서 뷰 오염 방지) — 실오너 배정 시 위 예외 분기가 재해석한다.
            owner_login = actor
            owning = None
            note = None
            report.add(cmap.code, "warning", "owner missing — fallback to importer (pending)")
        else:
            owning, note = await resolve_owning_department(
                session, known, dept_index, cmap.department, owner_login
            )
        if note:
            report.add(cmap.code, "warning", note)
        if not pending and owner_login not in known_logins:
            report.add(cmap.code, "warning", f"owner {owner_login!r} not found in employees")
        for approver in dict.fromkeys(cmap.approvers):
            if approver not in known_logins:
                report.add(cmap.code, "warning", f"approver {approver!r} not found in employees")
        new_map = ProcessMap(
            name=cmap.name, created_by=actor, owner_id=owner_login,
            visibility=cmap.visibility, owning_department=owning,
            description=cmap.description, consultant_owner_pending=pending,
            category_id=category_ids[cmap.category], consultant_code=cmap.code,
        )
        session.add(new_map)
        await session.flush()
        session.add(MapPermission(
            map_id=new_map.id, principal_type="user",
            principal_id=owner_login, role="owner", granted_by=actor,
        ))
        for approver in dict.fromkeys(cmap.approvers):
            session.add(MapApprover(map_id=new_map.id, user_id=approver, assigned_by=actor))
        existing[cmap.code] = new_map
        created.add(cmap.code)
        created_count += 1
        # pass 2와 동일 청크 크기 — 안 걸면 pass 1 전체(최대 20k 맵 껍데기)가 첫 pass-2 커밋에
        # 한꺼번에 실려 크래시 시 미완성 껍데기가 대량으로 남는다(design §8).
        if commit_every is not None and created_count % commit_every == 0:
            await session.commit()
            print(f"pass1 committed {created_count} created")

    # 연계 대상 = 이번 전달분 + 이전 전달분에만 있는 기존 맵(증분 전달 케이스). DB-only 대상(이번
    # 전달분에 없음)은 canonical params가 없어 annual/fte가 빈 값으로 폴백한다 — 아래 pass 2가
    # 그 경우 직전 게시본의 연계 노드 값을 이어받아 채운다(§5.2 "아무것도 안 잃는다").
    link_targets: dict[str, tuple[int, CanonicalParams]] = {
        code: (m.id, CanonicalParams()) for code, m in existing.items() if m.deleted_at is None
    }
    for cmap in maps:
        if cmap.code in existing and existing[cmap.code].deleted_at is None:
            link_targets[cmap.code] = (existing[cmap.code].id, normalized[cmap.code])

    # 연계 노드 title을 대상 맵 이름으로 교체(빌더는 code 폴백) — DB-only 대상 포함, 이번 전달분
    # 우선. existing/maps는 pass 2 진입 전 이미 확정이라 루프 밖에서 1회만 구성(20k맵 스케일에서
    # 맵마다 다시 만들면 O(n²)).
    names: dict[str, str] = {code: m.name for code, m in existing.items()}
    names.update({m.code: m.name for m in maps})

    # pass 2 — 그래프·버전·SP 지정. 콘텐츠 필드만 갱신(거버넌스는 위 신규 생성 분기에서만 설정).
    for index, cmap in enumerate(maps):
        if cmap.code in category_errored or cmap.code in trashed_in_delivery:
            continue
        found_map = existing[cmap.code]
        params = normalized[cmap.code]
        nodes, edges, warnings = build_graph_rows(cmap, link_targets)
        for w in warnings:
            report.add(cmap.code, "warning", w)
        for n in nodes:
            if n.node_type == "subprocess" and n.title in names:
                n.title = names[n.title]

        latest = await _latest_published(session, found_map.id)
        old_nodes: list[Node] = []
        old_edges: list[Edge] = []
        if latest is not None:
            old_nodes = list((await session.scalars(select(Node).where(Node.version_id == latest.id))).all())
            old_edges = list((await session.scalars(select(Edge).where(Edge.version_id == latest.id))).all())

        # DB-only 연계 대상(이번 전달분에 없어 canonical params가 빈 값으로 폴백)의 annual_count/fte를
        # 직전 게시본의 같은 연계 노드에서 이어받는다 — 안 그러면 부분 재전달마다 값이 초기화되고
        # (내용은 그대로인데) 시그니처가 달라져 불필요한 새 버전이 찍힌다.
        if old_nodes:
            old_by_root = {(n.source_node_id or n.id): n for n in old_nodes}
            for link in cmap.links:
                if link.to_map in delivery_codes:
                    continue  # 이번 전달분에 canonical params 존재 — 새로 시드한 값 유지
                node_root = make_node_id(cmap.code, f"__link__{link.to_map}")
                old_link_node = old_by_root.get(node_root)
                if old_link_node is None:
                    continue
                new_link_node = next(
                    (n for n in nodes if (n.source_node_id or n.id) == node_root), None
                )
                if new_link_node is not None:
                    new_link_node.annual_count = old_link_node.annual_count
                    new_link_node.fte = old_link_node.fte
            # 활동별 GMP 이어받기 — 전달물에 없는 검토 선정값이라 재빌드 노드가 늘 비어 있다.
            # 직전 게시본의 같은 계보 노드에서 승계해 재전달이 검토값을 덮지 않게 한다
            # (맵 sp_gmp를 엔진이 안 건드리는 것과 동일 계약 — 시그니처에도 미포함, design 2026-08-20)
            for n in nodes:
                old_node = old_by_root.get(n.source_node_id or n.id)
                if old_node is not None and old_node.gmp:
                    n.gmp = old_node.gmp

        graph_changed = True
        if latest is not None:
            graph_changed = _graph_signature(old_nodes, old_edges) != _graph_signature(nodes, edges)

        sp_department = cmap.department.strip() or found_map.owning_department or ""
        if not sp_department:
            report.add(cmap.code, "warning", "sp_department empty")
        old_name = found_map.name
        fields_changed = (
            found_map.name != cmap.name
            or found_map.category_id != category_ids[cmap.category]
            or (found_map.description or "") != cmap.description
            or (found_map.sp_department or "") != sp_department
            or (found_map.sp_input or "") != params.input
            or (found_map.sp_output or "") != params.output
            or (found_map.sp_duration or "") != params.duration
            or (found_map.sp_cost_krw or "") != params.cost_krw
            or (found_map.sp_cost_usd or "") != params.cost_usd
            or (found_map.sp_headcount or "") != params.headcount
            # 승격 필드 — sp_gmp(검토 선정값)는 전달분에 없어 비교·갱신 모두 제외 (design 2026-08-19 §4.1)
            or (found_map.sp_touch_time or "") != params.touch_time
            or (found_map.sp_system or "") != cmap.system
            or (found_map.sp_start_condition or "") != cmap.start_condition
            or (found_map.sp_end_condition or "") != cmap.end_condition
            or (found_map.sp_gmp_fallback or "") != cmap.gmp_fallback
            or (found_map.sp_frequency_fallback or "") != cmap.frequency_fallback
            or (found_map.sp_total_time_fallback or "") != cmap.total_time_fallback
            or (found_map.sp_touch_time_fallback or "") != cmap.touch_time_fallback
            or (found_map.sp_system_fallback or "") != cmap.system_fallback
        )
        is_new = cmap.code in created
        # 내용이 그대로면 아무것도 쓰지 않는다 — 안 그러면 재전달마다 updated_at이 갱신돼 홈
        # 목록(updated_at desc)이 무변경 맵으로 도배되고 sp_changed_at 이력도 오염된다.
        # sp_designated_at는 예외 — 최초 지정 시점은 내용 변경 여부와 무관하게 채워야 한다.
        if is_new or graph_changed or fields_changed or found_map.sp_designated_at is None:
            # 콘텐츠 필드 갱신 — 거버넌스 필드(owner·visibility·owning_department·approvers)는 불변
            found_map.name = cmap.name
            found_map.description = cmap.description
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
            found_map.sp_touch_time = params.touch_time
            found_map.sp_system = cmap.system
            found_map.sp_start_condition = cmap.start_condition
            found_map.sp_end_condition = cmap.end_condition
            found_map.sp_gmp_fallback = cmap.gmp_fallback
            found_map.sp_frequency_fallback = cmap.frequency_fallback
            found_map.sp_total_time_fallback = cmap.total_time_fallback
            found_map.sp_touch_time_fallback = cmap.touch_time_fallback
            found_map.sp_system_fallback = cmap.system_fallback
            found_map.sp_changed_by = actor
            found_map.sp_changed_at = now_kst()

        version: MapVersion | None = None
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

        if is_new:
            report.add(
                cmap.code, "created",
                f"published v{version.version_number}" if version is not None else "",
            )
        elif graph_changed or fields_changed:
            detail = "graph" if graph_changed else "map fields only"
            if old_name != cmap.name:
                detail = f"name '{old_name}' -> '{cmap.name}'; {detail}"
            report.add(cmap.code, "updated", detail)
        else:
            report.add(cmap.code, "unchanged", "")

        if commit_every is not None and (index + 1) % commit_every == 0:
            await session.commit()  # 스케일 대응 — 20k 맵 단일 트랜잭션 방지 (design §8)
            print(f"pass2 {index + 1}/{len(maps)} maps")
    return report


async def apply_interview_notes(
    session: AsyncSession,
    notes: list["InterviewNote"],
    *,
    label: str,
) -> int:
    """인터뷰 노트 적재 — 관련 맵/L5 스코프의 consultant-import 행을 지우고 재삽입(멱등).

    import_delivery와 같은 세션에서 호출한다 — dry-run rollback이 노트까지 함께 원복된다.
    map_code가 DB에 없는 노트는 스킵(맵 생성 자체가 스킵된 경우 — 엔진 리포트가 사유를 이미
    남겼다). 반환값은 삽입 행 수 (design 2026-08-18 §5).
    """
    map_codes = {n.map_code for n in notes if n.map_code}
    cat_codes = {n.category_code for n in notes if n.map_code is None and n.category_code}
    code_to_id: dict[str, int] = {}
    if map_codes:
        rows = (await session.scalars(
            select(ProcessMap).where(ProcessMap.consultant_code.in_(map_codes))
        )).all()
        code_to_id = {m.consultant_code: m.id for m in rows if m.consultant_code is not None}
    if code_to_id:
        await session.execute(delete(MapNote).where(
            MapNote.source == "consultant-import", MapNote.map_id.in_(set(code_to_id.values()))
        ))
    if cat_codes:
        await session.execute(delete(MapNote).where(
            MapNote.source == "consultant-import", MapNote.map_id.is_(None),
            MapNote.category_code.in_(cat_codes),
        ))
    inserted = 0
    for n in notes:
        map_id = code_to_id.get(n.map_code) if n.map_code else None
        if n.map_code and map_id is None:
            continue
        session.add(MapNote(
            map_id=map_id, category_code=None if map_id else n.category_code,
            kind=n.kind[:50], title=(n.title[:300] if n.title else None), text=n.text,
            source="consultant-import", delivery_label=label,
        ))
        inserted += 1
    return inserted


