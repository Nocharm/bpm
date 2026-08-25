"""인터뷰 결과 JSON(0.3-bpm-interface-draft) → canonical 변환 어댑터 — DB 무관 순수 함수.

설계: docs/design/2026-08-18-interview-import-design.md §2·§3. 한 파일 = L5 1건.
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
    "rows", "tasks", "summary", "openItems", "sideNotes",
}
_ROW_KEYS = {
    "taskId", "unitId", "l6", "owner", "ownerRole", "approvers",
    "department", "fields", "actions",
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
_KNOWN_KINDS = {"action", "handoff", "decision"}

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
class AdapterResult:
    categories: list[CanonicalCategory] = field(default_factory=list)
    maps: list[CanonicalMap] = field(default_factory=list)
    notes: list[InterviewNote] = field(default_factory=list)
    issues: list[AdapterIssue] = field(default_factory=list)

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


def format_map_description(owner_role: object) -> str:
    """맵 설명 [Interview] 섹션 — 승격 후 Owner role만 잔류(실오너 거버넌스 전까지).

    나머지 fields 키는 전부 고유/폴백 컬럼으로 이동해 직렬화에서 제거(드리프트 방지,
    design 2026-08-19 §4.1).
    """
    role = _clean(owner_role)
    return f"[Interview]\nOwner role: {role}" if role else ""


def _truncate(value: str, limit: int, path: str, label: str, issues: list[AdapterIssue]) -> str:
    if len(value) > limit:
        issues.append(AdapterIssue("warning", path, f"{label} truncated to {limit} chars"))
        return value[:limit]
    return value


def _build_nodes_and_edges(
    actions: list, path: str, issues: list[AdapterIssue]
) -> tuple[list[CanonicalNode], list[CanonicalEdge]]:
    """seq 그룹 k 전원 → k+1 전원 엣지 — 유일 seq면 순차 체인, 중복 seq면 병렬 분기/합류."""
    groups: dict[int, list[CanonicalNode]] = {}
    seen_in_group: dict[int, int] = {}
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
            if not isinstance(seq_raw, int) or isinstance(seq_raw, bool):
                issues.append(AdapterIssue("warning", apath, f"seq invalid {seq_raw!r} — fallback {seq}"))
        label = _clean(action.get("label"))
        if not label:
            label = f"Step {seq}"
            issues.append(AdapterIssue("warning", apath, f"label missing — fallback {label!r}"))
        label = _truncate(label, 200, apath, "label", issues)
        kind = _clean(action.get("kind"))
        if kind and kind not in _KNOWN_KINDS:
            issues.append(AdapterIssue("warning", apath, f"unknown kind {kind!r} — treated as action"))
        system = _truncate(_clean(action.get("system")), 100, apath, "system", issues)
        occurrence = seen_in_group.get(seq, 0) + 1
        seen_in_group[seq] = occurrence
        code = f"a{seq:02d}" if occurrence == 1 else f"a{seq:02d}-{occurrence}"
        # 예외 variant는 흐름 분기 대신 색으로만 분리 — 앵커(분기 시작/합류) 정보가 전달물에
        # 없어 진짜 분기는 그릴 수 없다(협의 확장 포인트, design 2026-08-18 §3).
        variant = _clean(action.get("variant"))
        groups.setdefault(seq, []).append(CanonicalNode(
            code=code,
            name=label,
            type="decision" if kind == "decision" else "process",
            system=system,
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
        ))

    nodes: list[CanonicalNode] = []
    edges: list[CanonicalEdge] = []
    ordered_seqs = sorted(groups)
    for seq in ordered_seqs:
        nodes.extend(groups[seq])
    for prev_seq, next_seq in zip(ordered_seqs, ordered_seqs[1:]):
        for src in groups[prev_seq]:
            for dst in groups[next_seq]:
                edges.append(CanonicalEdge.model_validate({"from": src.code, "to": dst.code}))
    return nodes, edges


def convert_interview(raw: object) -> AdapterResult:
    """인터뷰 파일 1건 → canonical 변환. 예외를 던지지 않는다 — 문제는 전부 issues로."""
    result = AdapterResult()
    issues = result.issues
    if not isinstance(raw, dict):
        issues.append(AdapterIssue("error", "$", "file is not a JSON object"))
        return result
    _warn_unknown_keys(raw, _TOP_KEYS, "$", issues)

    version = _clean(raw.get("schema_version"))
    if not version.startswith("0.3"):
        issues.append(AdapterIssue("warning", "schema_version",
                                   f"unexpected schema_version {version!r} (expected 0.3*)"))

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
        for task in tasks_raw:
            if isinstance(task, dict) and _clean(task.get("id")):
                tasks_by_id[_clean(task.get("id"))] = task

    unit_to_task: dict[str, str] = {}
    seen_task_ids: set[str] = set()
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
        nodes, edges = _build_nodes_and_edges(actions, path, issues)

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
            value = _clean(fields.get(key))
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
                department=_truncate(_clean(row.get("department")), 100, path, "department", issues),
                description=format_map_description(row.get("ownerRole")),
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

        task = tasks_by_id.get(task_id)
        exceptions = task.get("exceptions") if isinstance(task, dict) else None
        if isinstance(exceptions, list):
            for k, exc_item in enumerate(exceptions):
                epath = f"{path}.exceptions[{k}]"
                if not isinstance(exc_item, dict):
                    issues.append(AdapterIssue("warning", epath, "exception is not an object — skipped"))
                    continue
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
