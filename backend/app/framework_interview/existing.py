"""기존 L6 맵 학습 — 맵 → 인터뷰 행 역변환, 세션 시작 스냅샷, 계획 카드 병합 (spec 2026-09-22 §2)."""

from collections import Counter
from collections.abc import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import OTHER_SYSTEM, commit_system, get_systems
from app.duration import DURATION_RE
from app.models import Edge, MapVersion, Node, ProcessMap

# (source_node_id, target_node_id, label, gateway) — 합성 노드를 접어 넣기 전/후 공용 흐름 표현
FlowEdge = tuple[str, str, str, str | None]
# app_settings.get_systems가 돌려주는 관리 목록 엔트리 — {"value", "aliases"}
Catalog = list[dict[str, object]]

SUMMARY_MAX = 300
ACTIVITY_TYPES = {"process", "decision"}
# 캔버스에 하위 맵 링크가 있으면 역변환이 그 노드를 떨어뜨린다 — 행을 만들지 않고 동결한다
FROZEN_NODE_TYPE = "subprocess"
# 어댑터 format_map_description이 설명에 남기는 기록성 키 — 전용 컬럼이 없어 여기서 되읽는다
_ARTIFACT_ROLE_PREFIX = "Artifact role: "
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


def _resolve_delivered_system(system: str, fallback: str, systems: Catalog | None) -> str:
    """저장된 (system, system_fallback)에서 전달 원문을 되살린다 — 임포터 정규화의 역방향.

    - Other + 메모: 카탈로그 미등록 원문이 메모에 있다(정정 설문이 'Other'를 되묻지 않게).
    - 카탈로그를 주면 별칭까지: 메모를 commit_system에 넣어 저장된 대표값이 나오면 그 메모가 전달 원문이다.
      정식 표기를 돌려주면 재전달이 폴백까지 정식 표기로 덮어 무변경 행이 그래프 변경으로 보인다
      (system_fallback은 import_consultant._graph_signature 안에 있다).
    - 그 외에는 대표값 — 사람이 나중에 고친 메모를 전달 원문으로 오인하지 않는다.
    """
    if not fallback:
        return system
    if system == OTHER_SYSTEM:
        return fallback
    if systems and commit_system(fallback, systems, fallback)[0] == system:
        return fallback
    return system


def _resolve_system(node: Node) -> str:
    """카탈로그 없는 기본 해석기 — Other 폴백만 되살린다."""
    return _resolve_delivered_system(
        (node.system or "").strip(), (node.system_fallback or "").strip(), None)


def make_system_resolver(systems: Catalog) -> Callable[[Node], str]:
    """카탈로그를 아는 노드 시스템 해석기 — map_to_row에 끼워 별칭 원문까지 되살린다."""
    def resolve(node: Node) -> str:
        return _resolve_delivered_system(
            (node.system or "").strip(), (node.system_fallback or "").strip(), systems)
    return resolve


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


def map_to_row(
    map_name: str, owning_department: str | None, nodes: list[Node], edges: list[Edge],
    *, resolve_system: Callable[[Node], str] = _resolve_system,
) -> dict:
    """맵 그래프 → 인터뷰 JSON 0.5 rows[] 1건. 순수 함수 — DB도, 게시본 선택도 보지 않는다.

    resolve_system은 카탈로그를 아는 해석기를 끼워 넣는 자리다(make_system_resolver) — 기본값은
    카탈로그 없이도 동작하는 Other 폴백 규칙.
    """
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
            items = [line.strip() for line in (getattr(n, key) or "").split("\n") if line.strip()]
            if items:
                action[key] = items
        system = resolve_system(n)
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


def _parse_hmm_minutes(raw: str) -> int | None:
    """duration H.MM(소수부=분) → 분. adapter format_minutes_hmm의 역변환 — 자유텍스트면 None."""
    text = (raw or "").strip()
    if not text or not DURATION_RE.fullmatch(text):
        return None
    int_part, _, frac_part = text.partition(".")
    return int(int_part) * 60 + (int(frac_part.ljust(2, "0")) if frac_part else 0)


def _artifact_role_of(description: str | None) -> str:
    """맵 설명 [Interview] 섹션의 'Artifact role:' 줄 — 전용 컬럼이 없어 텍스트로만 잔류한다."""
    for line in (description or "").splitlines():
        if line.startswith(_ARTIFACT_ROLE_PREFIX):
            return line[len(_ARTIFACT_ROLE_PREFIX):].strip()
    return ""


def _map_systems_value(process_map: ProcessMap, systems: Catalog | None) -> str:
    """fields.systems 원문 — 노드와 같은 규칙(_resolve_delivered_system)을 맵 지정값에 적용한다.

    폴백 없는 Other는 사람이 손으로 고른 값이라 되돌릴 원문이 없다 — 내보내면 재임포트가
    폴백을 'Other'로 채워 무변경 맵이 변경으로 보이므로 생략한다.
    """
    system = (process_map.sp_system or "").strip()
    fallback = (process_map.sp_system_fallback or "").strip()
    if not fallback and system == OTHER_SYSTEM:
        return ""
    return _resolve_delivered_system(system, fallback, systems)


def _apply_map_scope_fields(row: dict, process_map: ProcessMap, systems: Catalog | None = None) -> None:
    """행 스코프 값 되살리기 — 임포터는 fields 전부를 노드가 아니라 맵 sp_* 컬럼에 흩어 적는다.

    여기서 빠진 키는 유지 행을 그대로 재임포트할 때 빈 값으로 덮여 기존 지정값이 사라진다
    (import_consultant의 fields_changed/대입 목록과 1:1로 맞춘다).
    """
    role = (process_map.sp_assignee_role or "").strip()
    if role:
        row["ownerRole"] = role
    fields = row["fields"]
    text_pairs = (
        ("start_condition", process_map.sp_start_condition),
        ("done_criteria", process_map.sp_end_condition),
        ("input_data", process_map.sp_input),
        ("output_data", process_map.sp_output),
        ("headcount", process_map.sp_headcount),
        ("annual_count", process_map.sp_annual_count),
        ("fte", process_map.sp_fte),
        ("frequency", process_map.sp_frequency_fallback),
        ("gmp", process_map.sp_gmp_fallback),
        # *_min이 없을 때의 원문 프리텍스트 — 대표값(H.MM)과 함께 이중 보존된다
        ("total_time", process_map.sp_total_time_fallback),
        ("touch_time", process_map.sp_touch_time_fallback),
        ("artifact_role", _artifact_role_of(process_map.description)),
        ("systems", _map_systems_value(process_map, systems)),
    )
    for key, value in text_pairs:
        text = (value or "").strip()
        if text:
            fields[key] = text
    for key, column in (("total_time_min", process_map.sp_duration),
                        ("touch_time_min", process_map.sp_touch_time)):
        minutes = _parse_hmm_minutes(column or "")
        if minutes is not None:
            fields[key] = minutes


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
    """L5 아래 이미 등록된 L6 맵 스냅샷 — 휴지통·코드 없는 맵 제외, 게시본 우선.

    하위 맵 링크(subprocess 노드)가 있는 캔버스는 `frozen`으로 표시하고 행을 만들지 않는다 —
    역변환이 링크 노드를 떨어뜨리므로 그 행을 재게시하면 링크가 통째로 사라진다.
    """
    maps = (await db.scalars(
        select(ProcessMap).where(
            ProcessMap.category_id == category_id,
            ProcessMap.deleted_at.is_(None),
            ProcessMap.consultant_code.is_not(None),
        ).order_by(ProcessMap.consultant_code)
    )).all()
    systems = await get_systems(db)
    resolve_system = make_system_resolver(systems)
    out: list[dict] = []
    for m in maps:
        version = await _pick_version(db, m.id)
        if version is None:
            continue
        nodes = list((await db.scalars(select(Node).where(Node.version_id == version.id))).all())
        item = {
            "map_id": m.id, "code": m.consultant_code, "name": m.name,
            "summary": (m.description or "").strip()[:SUMMARY_MAX],
        }
        if any(n.node_type == FROZEN_NODE_TYPE for n in nodes):
            out.append({**item, "frozen": True, "activities": [], "row": None})
            continue
        edges = list((await db.scalars(select(Edge).where(Edge.version_id == version.id))).all())
        row = map_to_row(m.name, m.owning_department, nodes, edges, resolve_system=resolve_system)
        _apply_map_scope_fields(row, m, systems)
        out.append({
            **item, "frozen": False,
            "activities": [a["label"] for a in row["actions"]],
            "row": row,
        })
    return out


def existing_row_of(existing: list[dict] | None, code: str) -> dict | None:
    for item in existing or []:
        if item.get("code") == code:
            return None if item.get("frozen") else item.get("row")
    return None


def merge_existing_cards(cards: list[dict], existing: list[dict]) -> list[dict]:
    """기존 맵마다 카드 정확히 1개 — 코드·이름 일치 카드에 existing_code/mode를 찍고, 없으면 앞에 만든다.

    동결 맵(하위 맵 링크 보유)은 카드를 만들지 않고, AI가 그 코드나 이름으로 낸 카드도 버린다 —
    같은 맵을 새 카드로 다시 그려 중복 등록하는 것을 막는다.
    """
    frozen_codes = {e["code"] for e in existing if e.get("frozen")}
    frozen_names = {e["name"].strip() for e in existing if e.get("frozen")}
    live = [e for e in existing if not e.get("frozen")]
    by_code = {e["code"]: e for e in live}
    by_name = {e["name"].strip(): e for e in live}
    merged: list[dict] = []
    seen: set[str] = set()
    for raw in cards:
        card = dict(raw)
        code = card.get("existing_code")
        name = (card.get("name") or "").strip()
        if (code and code in frozen_codes) or (name and name in frozen_names):
            continue
        match = by_code.get(code) if code else None
        if match is None:
            match = by_name.get(name)
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
        for e in live if e["code"] not in seen
    ]
    return missing + merged
