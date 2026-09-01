"""인터뷰 결과 JSON(0.4-bpm-interface-draft) → canonical 변환 어댑터 — DB 무관 순수 함수.

설계: docs/design/2026-09-01-interview-import-v04-design.md(0.4 흐름 그래프) +
docs/design/2026-08-18-interview-import-design.md §2·§3(원설계). 한 파일 = L5 1건.
구조 치명 오류는 error issue + 빈 maps로 반환하고 예외를 던지지 않는다 — 파일별 독립
처리(다중 파일 일괄 임포트에서 한 파일의 오류가 다른 파일을 죽이지 않는다).
error가 1건이라도 있으면 그 파일 전체를 임포트에서 제외한다(부분 임포트 없음 —
dry-run으로 고친 뒤 재실행하는 워크플로 전제). 미지 키는 warning으로만 표면화해
실전달물과 손타이핑 스키마의 차이를 dry-run 리포트가 흡수한다.
"""

from dataclasses import dataclass, field

from pydantic import ValidationError

from scripts.consultant_canonical import (
    CanonicalCategory,
    CanonicalEdge,
    CanonicalError,
    CanonicalMap,
    CanonicalNode,
    parse_categories,
)

_TOP_KEYS = {
    "_readme", "schema_version", "labelSource", "framework", "l5",
    "relations", "rows", "tasks", "summary", "openItems", "sideNotes",
}
_ROW_KEYS = {
    "taskId", "unitId", "l6", "owner", "ownerRole", "approvers",
    "department", "fields", "actions", "relations",
}
# done_criteria/done_criterial 이중 수용 — 손타이핑 전달 스펙의 표기 모호(실파일 대조 전)
_FIELD_KEYS = {
    "start_condition", "input_data", "output_data", "done_criteria", "done_criterial",
    "systems", "total_time", "total_time_min", "touch_time", "touch_time_min",
    "frequency", "annual_count", "headcount", "fte", "gmp", "artifact_role",
}
_ACTION_KEYS = {
    "seq", "label", "name", "kind", "variant", "rule", "input", "output",
    "system", "screen", "dataForm", "quote",
}
# l5·tasks·exceptions 미지 키도 dry-run이 표면화 — 실파일 대조 완전성 (점검 2026-08-24)
_L5_KEYS = {"label", "nodeCode"}
_TASK_KEYS = {
    "id", "doc", "seq", "name", "note", "state", "evidence", "revision",
    "ownerRole", "exceptions", "startCondition", "endCondition",
}
_EXCEPTION_KEYS = {"name", "rule", "evidence"}
_KNOWN_KINDS = {"action", "handoff", "decision"}
# 0.4 흐름 그래프 — L5(rows 사이)와 L6(actions 사이)가 같은 엣지 스키마를 쓴다
_RELATIONS_KEYS = {"entry", "edges"}
_ENTRY_KEYS = {"taskId", "triggerType", "label", "quote"}
_EDGE_KEYS = {"src", "dst", "kind", "gateway", "condition", "label", "quote"}
_KNOWN_EDGE_KINDS = {"seq", "branch", "loop", "bypass"}
_KNOWN_GATEWAYS = {"exclusive", "parallel"}
_KNOWN_TRIGGERS = {"message", "timer", "condition", "manual"}

# 예외 variant 노드 stroke — 에디터 COLOR_PRESETS의 rose와 수동 동기
# (frontend/src/app/maps/[mapId]/page.tsx COLOR_PRESETS — 색은 chrome이 아니라 노드 데이터)
EXCEPTION_VARIANT_COLOR = "#c2849a"

# 노드 설명 KV — 승격된 키(input/output/system/dataForm)는 고유 필드로 이동해 여기서 제외,
# 기록성 필드만 텍스트 잔류 (design 2026-08-19 §4.1)
_ACTION_FIELD_LABELS: list[tuple[str, str]] = [
    ("rule", "Rule"),
    ("screen", "Screen"),
    ("quote", "Quote"),
]


@dataclass
class AdapterIssue:
    severity: str  # "error" | "warning"
    path: str      # 예: "rows[2].actions[3]"
    message: str


@dataclass
class InterviewNote:
    """map_notes 적재 원료 — map_code(taskId) 또는 category_code(L5) 스코프 중 하나."""

    kind: str
    text: str
    title: str | None = None
    map_code: str | None = None
    category_code: str | None = None


@dataclass
class InterviewLinkageEdge:
    """L5 연계 캔버스 엣지 원료 — 끝점은 rows[].taskId(=맵 consultant_code).

    kind는 저장되지 않지만 배치에 필요하다 — loop을 선행으로 세면 사이클이라 랭크가 무너진다.
    """

    source: str
    target: str
    label: str = ""
    kind: str = "seq"
    gateway: str = ""


@dataclass
class InterviewLinkage:
    """L6 사이 흐름 — L5 연계 캔버스 시드/보강 원료 (design 2026-09-01 §3).

    map_codes는 캔버스 배치 순서(진입 L6가 맨 앞). params는 code → (annual_count, fte) —
    연계 캔버스 SP 노드가 이 두 값의 유일한 착지면이다.
    """

    category_code: str
    map_codes: list[str] = field(default_factory=list)
    edges: list[InterviewLinkageEdge] = field(default_factory=list)
    params: dict[str, tuple[str, str]] = field(default_factory=dict)


@dataclass
class AdapterResult:
    categories: list[CanonicalCategory] = field(default_factory=list)
    maps: list[CanonicalMap] = field(default_factory=list)
    notes: list[InterviewNote] = field(default_factory=list)
    issues: list[AdapterIssue] = field(default_factory=list)
    linkage: InterviewLinkage | None = None

    def has_error(self) -> bool:
        return any(i.severity == "error" for i in self.issues)


def _clean(value: object) -> str:
    """None→"" — 그 외는 문자열화 후 strip (프리텍스트 원문 보존이 목적, 변형 최소)."""
    if value is None:
        return ""
    return str(value).strip()


def _parse_minutes(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if value >= 0 and value == int(value) else None
    text = str(value).strip()
    return int(text) if text.isdigit() else None


def format_minutes_hmm(minutes: int) -> str:
    """분 → duration H.MM 계약(소수부=분, ≥60 이월) — 90 → "1.30"."""
    return f"{minutes // 60}.{minutes % 60:02d}"


def _warn_unknown_keys(obj: dict, allowed: set[str], path: str, issues: list[AdapterIssue]) -> None:
    for key in obj:
        if key not in allowed:
            issues.append(AdapterIssue("warning", path, f"unknown key {key!r}"))


def _join_multi(value: object) -> str:
    """str 또는 list → 개행 join — IO 복수 시맨틱(현 전달은 str, list는 확장 대비)."""
    if isinstance(value, list):
        return "\n".join(v for v in (_clean(item) for item in value) if v)
    return _clean(value)


def format_node_description(action: dict) -> str:
    """노드 설명 = action.name + KV 줄 직렬화(빈 값 줄 생략) — spec §3."""
    lines: list[str] = []
    name = _clean(action.get("name"))
    if name:
        lines.append(name)
    kv: list[str] = []
    for key, label in _ACTION_FIELD_LABELS:
        value = _clean(action.get(key))
        if value:
            kv.append(f"{label}: {value}")
    variant = _clean(action.get("variant"))
    if variant and variant != "normal":
        kv.append(f"Variant: {variant}")  # 예외 표식 등 — normal(기본)은 노이즈라 생략 (2026-08-19)
    if _clean(action.get("kind")) == "handoff":
        kv.append("Kind: handoff")  # 노드 타입은 process — 원 kind는 텍스트로 보존
    if kv and lines:
        lines.append("")
    lines.extend(kv)
    return "\n".join(lines)


def format_map_description(owner_role: object, artifact_role: object = None) -> str:
    """맵 설명 [Interview] 섹션 — 승격 후 기록성 키(Owner role·Artifact role)만 잔류.

    나머지 fields 키는 전부 고유/폴백 컬럼으로 이동해 직렬화에서 제거(드리프트 방지,
    design 2026-08-19 §4.1). artifact_role은 전용/폴백 컬럼이 없는 기록성 값 —
    승격 리팩터에서 조용히 유실되던 회귀를 원설계의 KV 잔류 방식으로 복원 (점검 2026-08-24).
    """
    lines: list[str] = []
    role = _clean(owner_role)
    if role:
        lines.append(f"Owner role: {role}")
    artifact = _clean(artifact_role)
    if artifact:
        lines.append(f"Artifact role: {artifact}")
    return "[Interview]\n" + "\n".join(lines) if lines else ""


def _truncate(value: str, limit: int, path: str, label: str, issues: list[AdapterIssue]) -> str:
    if len(value) > limit:
        issues.append(AdapterIssue("warning", path, f"{label} truncated to {limit} chars"))
        return value[:limit]
    return value


def _param_text(value: object) -> str:
    r"""JSON 숫자/문자 → 파라미터 문자열.

    float를 str()로 굳히면 지수표기("1e-05")가 나와 엔진 NUMERIC_RE(^\d+(\.\d+)?$)에 걸려
    조용히 소거된다 — 0.4에서 처음 숫자로 채워지는 필드라 고정소수로 굳힌다.
    """
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return f"{value:.6f}".rstrip("0").rstrip(".") or "0"
    return _clean(value)


def normalize_dept_path(value: object) -> str:
    """조직 경로 세그먼트 공백 정리 — "A/ B/C" → "A/B/C".

    전달물 부서 경로에 "/" 뒤 공백이 섞이면 known 조직경로 집합과 안 맞아 엔진이 오너 org로
    조용히 폴백한다(값이 바뀐 줄 모른 채 임포트됨) — 경계에서 미리 맞춘다.
    """
    text = _clean(value)
    if not text:
        return ""
    return "/".join(seg for seg in (part.strip() for part in text.split("/")) if seg)


def _edge_label(label: object, condition: object) -> str:
    """엣지 라벨 = label + 줄바꿈 + condition — 엣지 라벨은 다중행 지원(Alt/Shift+Enter)."""
    return "\n".join(part for part in (_clean(label), _clean(condition)) if part)


def _flow_note_text(kind: str, gateway: str, condition: str, quote: str) -> str:
    """흐름 노트 본문 = 근거 발화 + 엣지 메타 한 줄(Edge 테이블엔 label밖에 없어 여기 보존)."""
    meta = f"{kind}/{gateway}" if gateway else kind
    if condition:
        meta = f"{meta} · {condition}"
    return f"{quote}\n({meta})"


def _build_nodes(
    actions: list, path: str, issues: list[AdapterIssue]
) -> tuple[list[CanonicalNode], dict[int, CanonicalNode]]:
    """actions[] → 노드 + seq 색인. 0.4에서 seq는 relations 참조키라 중복이면 파일 error."""
    nodes: list[CanonicalNode] = []
    by_seq: dict[int, CanonicalNode] = {}
    for j, action in enumerate(actions):
        apath = f"{path}.actions[{j}]"
        if not isinstance(action, dict):
            issues.append(AdapterIssue("error", apath, "action is not an object"))
            continue
        _warn_unknown_keys(action, _ACTION_KEYS, apath, issues)
        seq_raw = action.get("seq")
        seq = seq_raw if isinstance(seq_raw, int) and not isinstance(seq_raw, bool) else None
        if seq is None:
            parsed = _parse_minutes(seq_raw)  # 숫자 문자열 수용(음수 제외) — 별도 파서 불필요
            seq = parsed if parsed is not None else j + 1
            issues.append(AdapterIssue("warning", apath, f"seq invalid {seq_raw!r} — fallback {seq}"))
        if seq in by_seq:
            issues.append(AdapterIssue(
                "error", apath,
                f"duplicate seq {seq} — seq is the relations reference key in 0.4",
            ))
            continue
        label = _clean(action.get("label"))
        if not label:
            label = f"Step {seq}"
            issues.append(AdapterIssue("warning", apath, f"label missing — fallback {label!r}"))
        label = _truncate(label, 200, apath, "label", issues)
        kind = _clean(action.get("kind"))
        if kind and kind not in _KNOWN_KINDS:
            issues.append(AdapterIssue("warning", apath, f"unknown kind {kind!r} — treated as action"))
        # 예외 variant는 흐름 분기 대신 색으로만 분리 — 분기 자체는 relations 엣지가 그린다
        variant = _clean(action.get("variant"))
        node = CanonicalNode(
            code=f"a{seq:02d}",
            name=label,
            type="decision" if kind == "decision" else "process",
            system=_truncate(_clean(action.get("system")), 100, apath, "system", issues),
            seq=seq,
            # input/output/dataForm은 고유 필드로 승격, system 원문은 폴백에 이중 기록
            # (라이브러리화 전 표시 무회귀 — design 2026-08-19 §4.1). str 외에 list가 오면
            # 개행 join — IO 복수 시맨틱과 일치.
            input=_join_multi(action.get("input")),
            output=_join_multi(action.get("output")),
            data_form=_truncate(_clean(action.get("dataForm")), 50, apath, "dataForm", issues),
            # 폴백은 100자 컷 전 원문 기준 — 대표(system)와 상한이 달라 별도 절단
            system_fallback=_truncate(
                _clean(action.get("system")), 200, apath, "system_fallback", issues
            ),
            description=format_node_description(action),
            color=EXCEPTION_VARIANT_COLOR if variant == "exception" else "",
        )
        by_seq[seq] = node
        nodes.append(node)
    nodes.sort(key=lambda n: n.seq)
    return nodes, by_seq


def _seq_chain(by_seq: dict[int, CanonicalNode]) -> list[CanonicalEdge]:
    """relations 부재 시 폴백 — seq 오름차순 순차 체인."""
    ordered = sorted(by_seq)
    return [
        CanonicalEdge.model_validate(
            {"from": by_seq[a].code, "to": by_seq[b].code, "label": "", "kind": "seq"}
        )
        for a, b in zip(ordered, ordered[1:])
    ]


def _build_flow_edges(
    relations: object, by_seq: dict[int, CanonicalNode], path: str, issues: list[AdapterIssue]
) -> tuple[list[CanonicalEdge], list[InterviewNote]]:
    """rows[].relations.edges → 엣지 + quote 노트 (design 2026-09-01 §2).

    src/dst는 actions[].seq를 가리킨다. branch 엣지는 src 노드를 decision으로 승격한다 —
    actions[].kind(action/handoff/decision)는 분기 노드를 신뢰할 수 없고 엣지가 진실이다.
    """
    if relations is None:
        issues.append(AdapterIssue("warning", path, "relations missing — seq chain fallback"))
        return _seq_chain(by_seq), []
    if not isinstance(relations, dict):
        issues.append(AdapterIssue(
            "warning", f"{path}.relations", "relations is not an object — seq chain fallback"))
        return _seq_chain(by_seq), []
    _warn_unknown_keys(relations, _RELATIONS_KEYS, f"{path}.relations", issues)
    raw_edges = relations.get("edges")
    if not isinstance(raw_edges, list):
        issues.append(AdapterIssue(
            "warning", f"{path}.relations.edges",
            "edges missing or not a list — seq chain fallback"))
        return _seq_chain(by_seq), []

    edges: list[CanonicalEdge] = []
    notes: list[InterviewNote] = []
    seen: set[tuple[str, str]] = set()
    for k, raw in enumerate(raw_edges):
        epath = f"{path}.relations.edges[{k}]"
        if not isinstance(raw, dict):
            issues.append(AdapterIssue("warning", epath, "edge is not an object — skipped"))
            continue
        _warn_unknown_keys(raw, _EDGE_KEYS, epath, issues)
        src, dst = raw.get("src"), raw.get("dst")
        src_node = by_seq.get(src) if isinstance(src, int) and not isinstance(src, bool) else None
        dst_node = by_seq.get(dst) if isinstance(dst, int) and not isinstance(dst, bool) else None
        if src_node is None or dst_node is None:
            issues.append(AdapterIssue(
                "warning", epath, f"edge references unknown seq {src!r}→{dst!r} — dropped"))
            continue
        if src_node is dst_node:
            issues.append(AdapterIssue("warning", epath, f"self edge on seq {src!r} — dropped"))
            continue
        pair = (src_node.code, dst_node.code)
        if pair in seen:
            issues.append(AdapterIssue(
                "warning", epath, f"duplicate edge {pair[0]}→{pair[1]} — dropped"))
            continue
        seen.add(pair)
        kind = _clean(raw.get("kind")) or "seq"
        if kind not in _KNOWN_EDGE_KINDS:
            issues.append(AdapterIssue("warning", epath, f"unknown edge kind {kind!r} — treated as seq"))
            kind = "seq"
        gateway = _clean(raw.get("gateway"))
        if gateway and gateway not in _KNOWN_GATEWAYS:
            issues.append(AdapterIssue("warning", epath, f"unknown gateway {gateway!r} — text only"))
        condition = _clean(raw.get("condition"))
        edges.append(CanonicalEdge.model_validate({
            "from": src_node.code,
            "to": dst_node.code,
            "label": _truncate(_edge_label(raw.get("label"), condition), 200, epath, "label", issues),
            "kind": kind,
        }))
        # 택일 분기만 decision(마름모)으로 승격 — parallel은 병행 팬아웃이라 다중 out-edge로
        # 이미 표현되고, 마름모로 그리면 택일로 오독된다 (design 2026-09-01 §2)
        if kind == "branch" and gateway != "parallel" and src_node.type != "decision":
            src_node.type = "decision"
            issues.append(AdapterIssue(
                "warning", epath, f"{src_node.code} promoted to decision (exclusive branch edge)"))
        quote = _clean(raw.get("quote"))
        if quote:
            notes.append(InterviewNote(
                kind="flow",
                title=f"{src_node.name} → {dst_node.name}"[:300],
                text=_flow_note_text(kind, gateway, condition, quote),
            ))
    if not edges and by_seq:
        issues.append(AdapterIssue(
            "warning", f"{path}.relations.edges", "no usable edges — seq chain fallback"))
        return _seq_chain(by_seq), notes
    return edges, notes


def _build_linkage(
    relations: object, l5_code: str, row_names: dict[str, str], issues: list[AdapterIssue]
) -> tuple[InterviewLinkage, list[InterviewNote]]:
    """최상위 relations → L5 연계 캔버스 원료 + entry 노트 (design 2026-09-01 §3).

    entry는 Start 노드가 될 수 없다 — validate_framework_canvas가 연계 캔버스에
    subprocess/decision/end만 허용한다. 대신 진입 L6를 배치 첫 자리로 올리고 L5 노트로 남긴다.
    L6 레벨 branch는 노드 타입을 못 바꾼다(src가 subprocess) — 다중 out-edge + 라벨로만 표현된다.
    """
    linkage = InterviewLinkage(category_code=l5_code, map_codes=list(row_names))
    notes: list[InterviewNote] = []
    if relations is None:
        issues.append(AdapterIssue("warning", "relations", "relations missing — no L6 flow to seed"))
        return linkage, notes
    if not isinstance(relations, dict):
        issues.append(AdapterIssue("warning", "relations", "relations is not an object — ignored"))
        return linkage, notes
    _warn_unknown_keys(relations, _RELATIONS_KEYS, "relations", issues)

    entry = relations.get("entry")
    if entry is not None and not isinstance(entry, dict):
        issues.append(AdapterIssue("warning", "relations.entry", "entry is not an object — ignored"))
        entry = None
    if isinstance(entry, dict):
        _warn_unknown_keys(entry, _ENTRY_KEYS, "relations.entry", issues)
        trigger = _clean(entry.get("triggerType"))
        if trigger and trigger not in _KNOWN_TRIGGERS:
            issues.append(AdapterIssue("warning", "relations.entry", f"unknown triggerType {trigger!r}"))
        entry_code = _clean(entry.get("taskId"))
        if entry_code and entry_code not in row_names:
            issues.append(AdapterIssue(
                "warning", "relations.entry", f"taskId {entry_code!r} not in rows — ignored"))
            entry_code = ""
        if entry_code:
            linkage.map_codes = [entry_code] + [c for c in row_names if c != entry_code]
        text = "\n".join(p for p in (_clean(entry.get("label")), _clean(entry.get("quote"))) if p)
        if text:
            notes.append(InterviewNote(
                kind="entry",
                title=f"Entry ({trigger})" if trigger else "Entry",
                text=text,
                category_code=l5_code,
            ))

    raw_edges = relations.get("edges")
    if raw_edges is not None and not isinstance(raw_edges, list):
        issues.append(AdapterIssue("warning", "relations.edges", "edges is not a list — ignored"))
        raw_edges = None
    seen: set[tuple[str, str]] = set()
    for k, raw in enumerate(raw_edges or []):
        epath = f"relations.edges[{k}]"
        if not isinstance(raw, dict):
            issues.append(AdapterIssue("warning", epath, "edge is not an object — skipped"))
            continue
        _warn_unknown_keys(raw, _EDGE_KEYS, epath, issues)
        src, dst = _clean(raw.get("src")), _clean(raw.get("dst"))
        if src not in row_names or dst not in row_names:
            issues.append(AdapterIssue(
                "warning", epath, f"edge references unknown taskId {src!r}→{dst!r} — dropped"))
            continue
        if src == dst:
            issues.append(AdapterIssue("warning", epath, f"self edge on {src!r} — dropped"))
            continue
        if (src, dst) in seen:
            issues.append(AdapterIssue("warning", epath, f"duplicate edge {src}→{dst} — dropped"))
            continue
        seen.add((src, dst))
        kind = _clean(raw.get("kind")) or "seq"
        if kind not in _KNOWN_EDGE_KINDS:
            issues.append(AdapterIssue("warning", epath, f"unknown edge kind {kind!r} — treated as seq"))
            kind = "seq"
        gateway = _clean(raw.get("gateway"))
        if gateway and gateway not in _KNOWN_GATEWAYS:
            issues.append(AdapterIssue("warning", epath, f"unknown gateway {gateway!r} — text only"))
        condition = _clean(raw.get("condition"))
        linkage.edges.append(InterviewLinkageEdge(
            source=src,
            target=dst,
            label=_truncate(_edge_label(raw.get("label"), condition), 200, epath, "label", issues),
            kind=kind,
            gateway=gateway,
        ))
        quote = _clean(raw.get("quote"))
        if quote:
            notes.append(InterviewNote(
                kind="flow",
                title=f"{row_names[src]} → {row_names[dst]}"[:300],
                text=_flow_note_text(kind, gateway, condition, quote),
                category_code=l5_code,
            ))
    return linkage, notes


def convert_interview(raw: object) -> AdapterResult:
    """인터뷰 파일 1건 → canonical 변환. 예외를 던지지 않는다 — 문제는 전부 issues로."""
    result = AdapterResult()
    issues = result.issues
    if not isinstance(raw, dict):
        issues.append(AdapterIssue("error", "$", "file is not a JSON object"))
        return result
    _warn_unknown_keys(raw, _TOP_KEYS, "$", issues)

    # 0.4 전용 — 0.3은 흐름 그래프(relations)가 없어 수용하면 조용히 일직선 맵이 되고 그 사실이
    # 경고 한 줄에 묻힌다. 하위호환 대신 명시적 거부 (design 2026-09-01 §1).
    version = _clean(raw.get("schema_version"))
    if not version.startswith("0.4"):
        issues.append(AdapterIssue(
            "error", "schema_version",
            f"unsupported schema_version {version!r} — re-deliver as 0.4-bpm-interface-draft",
        ))
        return result

    framework = raw.get("framework")
    if not isinstance(framework, dict) or not isinstance(framework.get("categories"), list):
        issues.append(AdapterIssue("error", "framework", "framework.categories missing"))
        return result
    try:
        result.categories = parse_categories({"categories": framework["categories"]})
    except CanonicalError as exc:
        issues.append(AdapterIssue("error", "framework.categories", str(exc)))
        return result

    l5 = raw.get("l5")
    if isinstance(l5, dict):
        _warn_unknown_keys(l5, _L5_KEYS, "l5", issues)
    l5_code = _clean(l5.get("nodeCode")) if isinstance(l5, dict) else ""
    codes = {c.code: c for c in result.categories}
    if not l5_code or l5_code not in codes:
        issues.append(AdapterIssue("error", "l5.nodeCode",
                                   f"nodeCode {l5_code!r} not found in framework.categories"))
        return result
    if codes[l5_code].level != 5:
        issues.append(AdapterIssue("warning", "l5.nodeCode",
                                   f"nodeCode {l5_code!r} is level {codes[l5_code].level}, expected 5"))

    rows = raw.get("rows")
    if not isinstance(rows, list):
        issues.append(AdapterIssue("error", "rows", "rows missing or not a list"))
        return result
    if not rows:
        issues.append(AdapterIssue("warning", "rows", "rows empty — nothing to import"))

    tasks_raw = raw.get("tasks")
    tasks_by_id: dict[str, dict] = {}
    if isinstance(tasks_raw, list):
        for t_idx, task in enumerate(tasks_raw):
            if isinstance(task, dict):
                _warn_unknown_keys(task, _TASK_KEYS, f"tasks[{t_idx}]", issues)
                if _clean(task.get("id")):
                    tasks_by_id[_clean(task.get("id"))] = task

    unit_to_task: dict[str, str] = {}
    seen_task_ids: set[str] = set()
    row_names: dict[str, str] = {}  # 성립한 맵만 — 삽입 순서가 연계 캔버스 배치 순서가 된다
    for i, row in enumerate(rows):
        path = f"rows[{i}]"
        if not isinstance(row, dict):
            issues.append(AdapterIssue("error", path, "row is not an object"))
            continue
        _warn_unknown_keys(row, _ROW_KEYS, path, issues)
        task_id = _clean(row.get("taskId"))
        if not task_id:
            issues.append(AdapterIssue("error", path, "taskId missing — row skipped"))
            continue
        if task_id in seen_task_ids:
            issues.append(AdapterIssue("error", path, f"duplicate taskId {task_id!r}"))
            continue
        seen_task_ids.add(task_id)
        unit_id = _clean(row.get("unitId"))
        if unit_id:
            unit_to_task[unit_id] = task_id

        name = _clean(row.get("l6")) or _clean(tasks_by_id.get(task_id, {}).get("name"))
        if not name:
            issues.append(AdapterIssue("error", path, "l6 (map name) missing — row skipped"))
            continue
        name = _truncate(name, 200, path, "l6", issues)

        fields = row.get("fields")
        if fields is None:
            fields = {}
        elif not isinstance(fields, dict):
            issues.append(AdapterIssue("warning", path, "fields is not an object — ignored"))
            fields = {}
        _warn_unknown_keys(fields, _FIELD_KEYS, f"{path}.fields", issues)

        actions = row.get("actions")
        if actions is None:
            actions = []
        elif not isinstance(actions, list):
            issues.append(AdapterIssue("warning", path, "actions is not a list — ignored"))
            actions = []
        if not actions:
            issues.append(AdapterIssue("warning", path, "no actions — map will only have Start/End"))
        nodes, by_seq = _build_nodes(actions, path, issues)
        edges, flow_notes = _build_flow_edges(row.get("relations"), by_seq, path, issues)

        params: dict[str, str] = {
            "input": _join_multi(fields.get("input_data")),
            "output": _join_multi(fields.get("output_data")),
        }
        # *_min(int, 분)이 대표 — 원문 프리텍스트는 아래 폴백 컬럼에 이중 보존 (design 2026-08-19 §1.2)
        for min_key, param_key in (("total_time_min", "duration"), ("touch_time_min", "touch_time")):
            minutes = _parse_minutes(fields.get(min_key))
            if fields.get(min_key) not in (None, "") and minutes is None:
                issues.append(AdapterIssue("warning", f"{path}.fields",
                                           f"{min_key} not a number: {fields.get(min_key)!r}"))
            if minutes is not None:
                params[param_key] = format_minutes_hmm(minutes)
        for key in ("annual_count", "headcount", "fte"):
            # 0.4는 JSON 숫자로 보낸다 — str()이면 지수표기가 섞여 엔진이 소거한다 (design §4)
            value = _param_text(fields.get(key))
            if value:
                # 숫자 검증은 엔진(_normalize_params) 담당 — 여기선 컬럼폭(50)만 방어
                params[key] = _truncate(value, 50, f"{path}.fields", key, issues)

        approvers_raw = row.get("approvers")
        approvers = [
            _clean(a) for a in approvers_raw if _clean(a)
        ] if isinstance(approvers_raw, list) else []

        fpath = f"{path}.fields"
        try:
            result.maps.append(CanonicalMap(
                code=task_id,
                name=name,
                category=l5_code,
                owner=_clean(row.get("owner")) or None,
                approvers=approvers,
                department=_truncate(
                    normalize_dept_path(row.get("department")), 100, path, "department", issues),
                description=format_map_description(row.get("ownerRole"), fields.get("artifact_role")),
                # 승격 대표 필드 — systems는 sp_system 원문+폴백 이중 기록 (design 2026-08-19 §4.1)
                system=_truncate(_clean(fields.get("systems")), 100, fpath, "systems", issues),
                start_condition=_clean(fields.get("start_condition")),
                # done_criteria/done_criterial 이중 수용 — 표기 모호(실파일 대조 전)
                end_condition=_clean(fields.get("done_criteria")) or _clean(fields.get("done_criterial")),
                # 폴백 원문 — 대표는 각각 sp_gmp(검토 선정)·SP노드 annual_count·sp_duration·sp_touch_time
                gmp_fallback=_clean(fields.get("gmp")),
                frequency_fallback=_truncate(
                    _clean(fields.get("frequency")), 200, fpath, "frequency", issues),
                total_time_fallback=_truncate(
                    _clean(fields.get("total_time")), 200, fpath, "total_time", issues),
                touch_time_fallback=_truncate(
                    _clean(fields.get("touch_time")), 200, fpath, "touch_time", issues),
                system_fallback=_truncate(
                    _clean(fields.get("systems")), 200, fpath, "systems", issues),
                params=params,
                nodes=nodes,
                edges=edges,
            ))
        except (ValidationError, ValueError) as exc:
            issues.append(AdapterIssue("error", path, f"canonical validation failed: {exc}"))
            continue
        row_names[task_id] = name
        for note in flow_notes:  # 엣지 근거 발화 — 맵 스코프로 확정 (design 2026-09-01 §2)
            note.map_code = task_id
        result.notes.extend(flow_notes)

        task = tasks_by_id.get(task_id)
        exceptions = task.get("exceptions") if isinstance(task, dict) else None
        if isinstance(exceptions, list):
            for k, exc_item in enumerate(exceptions):
                epath = f"{path}.exceptions[{k}]"
                if not isinstance(exc_item, dict):
                    issues.append(AdapterIssue("warning", epath, "exception is not an object — skipped"))
                    continue
                _warn_unknown_keys(exc_item, _EXCEPTION_KEYS, epath, issues)
                title = _clean(exc_item.get("name")) or None
                text = _clean(exc_item.get("rule")) or (title or "")
                if not text:
                    issues.append(AdapterIssue("warning", epath, "exception has no name/rule — skipped"))
                    continue
                result.notes.append(InterviewNote(
                    kind="exception", text=text, title=title, map_code=task_id,
                ))
        # tasks[].note — 종전엔 조용히 유실되던 키 (design 2026-08-19 §4.1 동봉)
        task_note = _clean(task.get("note")) if isinstance(task, dict) else ""
        if task_note:
            result.notes.append(InterviewNote(kind="task_note", text=task_note, map_code=task_id))

    # L6 사이 흐름 → L5 연계 캔버스 원료. annual_count/fte는 여기서만 착지한다 (design §3)
    linkage, entry_notes = _build_linkage(raw.get("relations"), l5_code, row_names, issues)
    linkage.params = {
        m.code: (m.params.annual_count, m.params.fte)
        for m in result.maps
        if m.params.annual_count or m.params.fte
    }
    result.linkage = linkage
    result.notes.extend(entry_notes)

    side_notes = raw.get("sideNotes")
    if side_notes is not None and not isinstance(side_notes, list):
        issues.append(AdapterIssue("warning", "sideNotes", "sideNotes is not a list — ignored"))
        side_notes = None
    for k, note in enumerate(side_notes or []):
        npath = f"sideNotes[{k}]"
        if not isinstance(note, dict):
            issues.append(AdapterIssue("warning", npath, "side note is not an object — skipped"))
            continue
        text = _clean(note.get("text"))
        if not text:
            issues.append(AdapterIssue("warning", npath, "text missing — skipped"))
            continue
        kind = (_clean(note.get("kind")) or "note")[:50]
        unit_id = _clean(note.get("unitId"))
        map_code = unit_to_task.get(unit_id) if unit_id else None
        if unit_id and map_code is None:
            issues.append(AdapterIssue("warning", npath,
                                       f"unitId {unit_id!r} not matched — kept at L5 scope"))
        result.notes.append(InterviewNote(
            kind=kind, text=text,
            map_code=map_code, category_code=None if map_code else l5_code,
        ))

    # openItems — 종전엔 허용만 되고 미처리(조용히 유실)라 L5 스코프 노트로 보존 (design 2026-08-19 §4.1)
    open_items = raw.get("openItems")
    if open_items is not None and not isinstance(open_items, list):
        issues.append(AdapterIssue("warning", "openItems", "openItems is not a list — ignored"))
        open_items = None
    for k, item in enumerate(open_items or []):
        ipath = f"openItems[{k}]"
        if isinstance(item, str):
            text = _clean(item)
        elif isinstance(item, dict):
            text = _clean(item.get("text")) or _clean(item.get("name"))
        else:
            issues.append(AdapterIssue("warning", ipath, "open item is not an object — skipped"))
            continue
        if not text:
            issues.append(AdapterIssue("warning", ipath, "text missing — skipped"))
            continue
        result.notes.append(InterviewNote(kind="open_item", text=text, category_code=l5_code))
    return result
