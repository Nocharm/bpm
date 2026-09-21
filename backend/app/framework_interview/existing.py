"""기존 L6 맵 학습 — 맵 → 인터뷰 행 역변환, 세션 시작 스냅샷, 계획 카드 병합 (spec 2026-09-22 §2)."""

from collections import Counter

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import OTHER_SYSTEM
from app.models import Edge, MapVersion, Node, ProcessMap

# (source_node_id, target_node_id, label, gateway) — 합성 노드를 접어 넣기 전/후 공용 흐름 표현
FlowEdge = tuple[str, str, str, str | None]

SUMMARY_MAX = 300
ACTIVITY_TYPES = {"process", "decision"}
# 어댑터 format_node_description의 KV 접두 — 역변환 시 같은 표를 쓴다(consultant_interview._ACTION_FIELD_LABELS)
_KV_KEYS = {"Rule": "rule", "Screen": "screen", "Quote": "quote"}
_KV_LABELS = {*_KV_KEYS, "Variant", "Kind"}


def _split_description(text: str) -> tuple[str, dict[str, str]]:
    """설명 = name 줄들 + 빈 줄 + 'Label: value' 줄들 (adapter format_node_description).

    name이 없으면 어댑터가 빈 줄을 생략하므로 KV 줄이 첫 줄로 온다 — 빈 줄뿐 아니라
    알려진 라벨 접두로도 KV 구간 시작을 판정해야 'Kind: handoff'가 이름으로 새지 않는다.
    """
    name_lines: list[str] = []
    kv: dict[str, str] = {}
    in_kv = False
    for line in (text or "").splitlines():
        label, sep, value = line.partition(": ")
        if not in_kv and (line.strip() == "" or (sep and label in _KV_LABELS)):
            in_kv = True
            if line.strip() == "":
                continue
        if in_kv:
            if sep and label in _KV_LABELS:
                kv[label] = value.strip()
            # kv 구간의 알 수 없는 줄은 버린다(사람이 에디터에서 덧붙인 메모) — 정정 설문이 다시 묻는다
        else:
            name_lines.append(line)
    return "\n".join(name_lines).strip(), kv


def _resolve_system(node: Node) -> str:
    """노드 시스템 표시값 — 카탈로그 미등록은 Other로 저장되므로 원문 메모(system_fallback)를 돌려준다.
    정정 설문이 'Other'를 되묻지 않도록 인터뷰어가 실제로 말한 이름을 되살린다."""
    system = (node.system or "").strip()
    fallback = (node.system_fallback or "").strip()
    if system == OTHER_SYSTEM and fallback:
        return fallback
    return system


def _route_through_synthetic(flow: list[FlowEdge], synthetic_ids: set[str]) -> list[FlowEdge]:
    """A→◇→B를 A→B(나가는 엣지의 라벨)로 접는다 — ◇는 어댑터가 self edge를 그리려고 세운 노드라
    행으로 되돌리면 안 된다. A→◇→A는 A→A로 접혀 원래의 self edge가 복원된다."""
    routed = [f for f in flow if f[0] not in synthetic_ids and f[1] not in synthetic_ids]
    for sid in synthetic_ids:
        sources = [f[0] for f in flow if f[1] == sid and f[0] not in synthetic_ids]
        outgoing = [f for f in flow if f[0] == sid and f[1] not in synthetic_ids]
        for source in sources:
            for _, target, label, gateway in outgoing:
                routed.append((source, target, label, gateway))
    return routed


def map_to_row(map_name: str, owning_department: str | None, nodes: list[Node], edges: list[Edge]) -> dict:
    """맵 그래프 → 인터뷰 JSON 0.5 rows[] 1건. 순수 함수 — DB도, 게시본 선택도 보지 않는다."""
    # 지연 import — 스크립트 패키지
    from scripts.consultant_interview import EXCEPTION_VARIANT_COLOR, LOOP_BRANCH_NODE_NAME

    synthetic = {
        n.id for n in nodes
        if n.node_type == "decision" and (n.title or "").strip() == LOOP_BRANCH_NODE_NAME
    }
    activity = sorted(
        (n for n in nodes if n.node_type in ACTIVITY_TYPES and n.id not in synthetic),
        key=lambda n: (n.sort_order, n.id),
    )
    seq_of = {n.id: i for i, n in enumerate(activity, start=1)}
    actions: list[dict] = []
    for n in activity:
        name, kv = _split_description(n.description)
        action: dict = {"seq": seq_of[n.id], "label": n.title or f"step {seq_of[n.id]}"}
        if n.node_type == "decision":
            action["kind"] = "decision"
        elif kv.get("Kind") == "handoff":
            action["kind"] = "handoff"
        else:
            action["kind"] = "action"
        if name:
            action["name"] = name
        for label, key in _KV_KEYS.items():
            if kv.get(label):
                action[key] = kv[label]
        if kv.get("Variant") == "exception" or (n.color or "").lower() == EXCEPTION_VARIANT_COLOR:
            action["variant"] = "exception"
        for key in ("input", "output"):
            value = (getattr(n, key) or "").strip()
            if value:
                action[key] = value
        system = _resolve_system(n)
        if system:
            action["system"] = system
        actions.append(action)

    roles = Counter(n.assignee_role for n in activity if (n.assignee_role or "").strip())
    fields: dict = {}
    if activity and (activity[0].start_condition or "").strip():
        fields["start_condition"] = activity[0].start_condition.strip()
    if activity and (activity[-1].end_condition or "").strip():
        fields["done_criteria"] = activity[-1].end_condition.strip()

    flow: list[FlowEdge] = [
        (e.source_node_id, e.target_node_id, (e.label or "").strip(), e.gateway) for e in edges
    ]
    if synthetic:
        flow = _route_through_synthetic(flow, synthetic)

    rel_edges: list[dict] = []
    by_id = {n.id: n for n in activity}
    for source, target, label, gateway in sorted(
        flow, key=lambda f: (seq_of.get(f[0], 0), seq_of.get(f[1], 0))
    ):
        if source not in seq_of or target not in seq_of:
            continue
        src, dst = seq_of[source], seq_of[target]
        # 엣지 kind는 저장되지 않는다(임포터가 라벨만 남긴다) — 되돌아가거나 제자리면 loop,
        # 판단 노드에서 갈라지면 branch, 나머지는 seq로 구조에서 복원한다
        if dst <= src:
            item = {"src": src, "dst": dst, "kind": "loop"}
            if label:
                item["condition"] = label
        elif by_id[source].node_type == "decision":
            item = {"src": src, "dst": dst, "kind": "branch", "gateway": gateway or "exclusive"}
            if label:
                item["condition"] = label
        else:
            item = {"src": src, "dst": dst, "kind": "seq"}
            if label:
                item["label"] = label
        rel_edges.append(item)

    row: dict = {
        "l6": map_name,
        "ownerRole": roles.most_common(1)[0][0] if roles else "",
        "department": owning_department or "",
        "fields": fields,
        "actions": actions,
    }
    if rel_edges:
        row["relations"] = {"edges": rel_edges}
    return row


def _apply_map_scope_fields(row: dict, process_map: ProcessMap) -> None:
    """행 스코프 값 되살리기 — 임포터는 ownerRole·시작/완료 조건을 노드가 아니라 맵 컬럼에 적는다."""
    role = (process_map.sp_assignee_role or "").strip()
    if role:
        row["ownerRole"] = role
    start = (process_map.sp_start_condition or "").strip()
    if start:
        row["fields"]["start_condition"] = start
    end = (process_map.sp_end_condition or "").strip()
    if end:
        row["fields"]["done_criteria"] = end


async def _pick_version(db: AsyncSession, map_id: int) -> MapVersion | None:
    for status in (workflow.PUBLISHED, workflow.DRAFT):
        row = (await db.scalars(
            select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.status == status)
            .order_by(MapVersion.id.desc())
        )).first()
        if row is not None:
            return row
    return None


async def load_existing_l6(db: AsyncSession, category_id: int) -> list[dict]:
    """L5 아래 이미 등록된 L6 맵 스냅샷 — 휴지통·코드 없는 맵 제외, 게시본 우선."""
    maps = (await db.scalars(
        select(ProcessMap).where(
            ProcessMap.category_id == category_id,
            ProcessMap.deleted_at.is_(None),
            ProcessMap.consultant_code.is_not(None),
        ).order_by(ProcessMap.consultant_code)
    )).all()
    out: list[dict] = []
    for m in maps:
        version = await _pick_version(db, m.id)
        if version is None:
            continue
        nodes = list((await db.scalars(select(Node).where(Node.version_id == version.id))).all())
        edges = list((await db.scalars(select(Edge).where(Edge.version_id == version.id))).all())
        row = map_to_row(m.name, m.owning_department, nodes, edges)
        _apply_map_scope_fields(row, m)
        out.append({
            "map_id": m.id, "code": m.consultant_code, "name": m.name,
            "summary": (m.description or "").strip()[:SUMMARY_MAX],
            "activities": [a["label"] for a in row["actions"]],
            "row": row,
        })
    return out


def existing_row_of(existing: list[dict] | None, code: str) -> dict | None:
    for item in existing or []:
        if item.get("code") == code:
            return item.get("row")
    return None


def merge_existing_cards(cards: list[dict], existing: list[dict]) -> list[dict]:
    """기존 맵마다 카드 정확히 1개 — 코드·이름 일치 카드에 existing_code/mode를 찍고, 없으면 앞에 만든다."""
    by_code = {e["code"]: e for e in existing}
    by_name = {e["name"].strip(): e for e in existing}
    merged: list[dict] = []
    seen: set[str] = set()
    for raw in cards:
        card = dict(raw)
        code = card.get("existing_code")
        match = by_code.get(code) if code else None
        if match is None:
            match = by_name.get((card.get("name") or "").strip())
        if match is None or match["code"] in seen:
            card["existing_code"] = None
            card["mode"] = "new"
        else:
            seen.add(match["code"])
            card["existing_code"] = match["code"]
            card["mode"] = "revise" if card.get("mode") == "revise" else "keep"
        merged.append(card)
    missing = [
        {"name": e["name"], "summary": e["summary"], "owner_role": e["row"].get("ownerRole", ""),
         "department": e["row"].get("department", ""), "depends_on": [], "existing_code": e["code"], "mode": "keep"}
        for e in existing if e["code"] not in seen
    ]
    return missing + merged
