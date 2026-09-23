"""AI 응답 정규화 — 스키마 검증 전에 흔한 편차를 흡수한다 (실모델 "invalid response" 대응 2026-09-21).

모델은 키 이름·kind 표기·옵션 형식·suggested 타입을 자주 바꾼다. 여기서 관대하게 받아
contracts.py 스키마가 요구하는 모양으로 맞춘 뒤 검증한다. 의미를 바꾸지는 않는다(추측 금지):
알 수 없는 값은 안전한 기본값으로, 해석 불가 항목은 버린다.
"""

from typing import Any

QUESTION_KINDS = {"single", "multi", "text", "ordered"}
KIND_SYNONYMS = {
    "radio": "single", "choice": "single", "select": "single", "single_choice": "single", "one": "single",
    "checkbox": "multi", "multiple": "multi", "multi_choice": "multi", "multiselect": "multi", "many": "multi",
    "order": "ordered", "sequence": "ordered", "ranking": "ordered", "rank": "ordered", "sort": "ordered",
    "free": "text", "open": "text", "textarea": "text", "string": "text", "input": "text", "essay": "text",
}
MAPS_TO = {"activities", "branches", "roles", "systems", "io", "conditions", "params"}
SECTIONS = {"basic", "activities", "exceptions", "io"}
SECTION_BY_MAPS_TO = {"activities": "activities", "branches": "exceptions", "io": "io"}
MAPS_TO_SYNONYMS = {
    "activity": "activities", "steps": "activities", "tasks": "activities", "actions": "activities",
    "branch": "branches", "exceptions": "branches", "decision": "branches", "decisions": "branches",
    "role": "roles", "owner": "roles", "people": "roles",
    "system": "systems", "tools": "systems",
    "input": "io", "output": "io", "inputs": "io", "outputs": "io", "input_output": "io",
    "condition": "conditions", "start": "conditions", "end": "conditions", "trigger": "conditions",
    "param": "params", "parameters": "params", "metrics": "params", "time": "params",
}
ACTION_KINDS = {"action", "handoff", "decision"}
ACTION_KIND_SYNONYMS = {"task": "action", "step": "action", "branch": "decision", "judge": "decision",
                        "check": "decision", "transfer": "handoff", "hand_off": "handoff", "handover": "handoff"}
EDGE_KINDS = {"seq", "branch", "loop", "bypass"}
EDGE_KIND_SYNONYMS = {"sequence": "seq", "next": "seq", "default": "seq", "conditional": "branch",
                      "back": "loop", "return": "loop", "repeat": "loop", "skip": "bypass"}
GATEWAYS = {"exclusive", "parallel"}
TRIGGERS = {"message", "timer", "condition", "manual"}
ROW_FIELD_KEYS = {
    "start_condition", "input_data", "output_data", "done_criteria", "systems", "total_time",
    "touch_time", "frequency", "annual_count", "headcount", "fte", "gmp", "artifact_role",
}
ROW_FIELD_SYNONYMS = {"start": "start_condition", "trigger": "start_condition", "input": "input_data",
                      "inputs": "input_data", "output": "output_data", "outputs": "output_data",
                      "done": "done_criteria", "end_condition": "done_criteria", "system": "systems",
                      "duration": "total_time", "time": "total_time"}


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(_text(v) for v in value if _text(v))
    if isinstance(value, dict):
        return _text(value.get("label") or value.get("text") or value.get("name") or "")
    return str(value).strip()


def _lower(value: Any) -> str:
    return _text(value).lower().replace("-", "_").replace(" ", "_")


def _first_dict(raw: Any, list_key: str) -> dict:
    """{key:[...]} · [...] · {"data": {...}} 같은 포장을 벗겨 본체 dict를 돌려준다."""
    if isinstance(raw, list):
        return {list_key: raw}
    if not isinstance(raw, dict):
        return {}
    for wrapper in ("data", "result", "response", "output"):
        inner = raw.get(wrapper)
        if isinstance(inner, dict) and list_key in inner:
            return inner
    return raw


def _unique_id(base: str, seen: set[str]) -> str:
    candidate = base
    n = 2
    while candidate in seen:
        candidate = f"{base}_{n}"
        n += 1
    seen.add(candidate)
    return candidate


def normalize_questionnaire(raw: Any) -> dict:
    body = _first_dict(raw, "questions")
    items = body.get("questions") or body.get("items") or []
    if not isinstance(items, list):
        items = []
    out: list[dict] = []
    seen_q: set[str] = set()
    for idx, item in enumerate(items, start=1):
        if not isinstance(item, dict):
            continue
        kind = _lower(item.get("kind") or item.get("type"))
        kind = KIND_SYNONYMS.get(kind, kind)
        options_raw = item.get("options") or item.get("choices") or []
        options: list[dict] = []
        seen_o: set[str] = set()
        for oi, opt in enumerate(options_raw if isinstance(options_raw, list) else [], start=1):
            if isinstance(opt, dict):
                label = _text(opt.get("label") or opt.get("text") or opt.get("name") or opt.get("value"))
                oid = _text(opt.get("id") or opt.get("value") or f"o{oi}")
            else:
                label, oid = _text(opt), f"o{oi}"
            if not label:
                continue
            options.append({"id": _unique_id(oid[:40] or f"o{oi}", seen_o), "label": label[:200]})
        if kind not in QUESTION_KINDS:
            kind = "single" if len(options) >= 2 else "text"
        if kind != "text" and len(options) < 2:
            kind = "text"  # 보기가 없으면 객관식이 될 수 없다
        maps_to = _lower(item.get("maps_to") or item.get("category") or item.get("topic"))
        maps_to = MAPS_TO_SYNONYMS.get(maps_to, maps_to)
        if maps_to not in MAPS_TO:
            maps_to = "conditions"
        suggested_raw = item.get("suggested", item.get("default", item.get("answer")))
        if kind == "text":
            suggested: Any = _text(suggested_raw)
            options = []
        else:
            by_label = {o["label"].lower(): o["id"] for o in options}
            ids = {o["id"] for o in options}
            picks = suggested_raw if isinstance(suggested_raw, list) else ([suggested_raw] if suggested_raw not in (None, "") else [])
            resolved: list[str] = []
            for pick in picks:
                key = _text(pick)
                if key in ids:
                    resolved.append(key)
                elif key.lower() in by_label:
                    resolved.append(by_label[key.lower()])
            if kind == "ordered" and not resolved:
                resolved = [o["id"] for o in options]  # 순서 문항은 제안 순서가 곧 답의 뼈대
            if kind == "single" and len(resolved) > 1:
                resolved = resolved[:1]
            suggested = list(dict.fromkeys(resolved))
        text = _text(item.get("text") or item.get("question") or item.get("title") or item.get("prompt"))
        if not text:
            continue
        qid = _unique_id(_text(item.get("id")) or f"q{idx}", seen_q)
        section = _lower(item.get("section"))
        section = section if section in SECTIONS else SECTION_BY_MAPS_TO.get(maps_to, "basic")
        out.append({"id": qid, "kind": kind, "maps_to": maps_to, "section": section, "text": text[:600], "options": options, "suggested": suggested})
    # activities 순서 문항이 없으면 activities로 표시된 객관식을 ordered로 승격(없으면 검증이 잡는다)
    if not any(q["kind"] == "ordered" and q["maps_to"] == "activities" for q in out):
        for q in out:
            if q["maps_to"] == "activities" and q["kind"] in ("multi", "single") and len(q["options"]) >= 2:
                q["kind"] = "ordered"
                q["suggested"] = q["suggested"] or [o["id"] for o in q["options"]]
                break
    return {"questions": out[:15]}


def normalize_plan(raw: Any) -> dict:
    body = _first_dict(raw, "cards")
    items = body.get("cards") or body.get("items") or body.get("l6") or []
    cards: list[dict] = []
    seen: set[str] = set()
    for item in items if isinstance(items, list) else []:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict):
            continue
        name = _text(item.get("name") or item.get("title") or item.get("l6"))[:200]
        if not name or name in seen:
            continue
        seen.add(name)
        depends = item.get("depends_on") or item.get("dependsOn") or item.get("after") or []
        cards.append({
            "name": name,
            "summary": _text(item.get("summary") or item.get("description")),
            "owner_role": _text(item.get("owner_role") or item.get("ownerRole") or item.get("role"))[:100],
            "department": _text(item.get("department") or item.get("dept"))[:100],
            "depends_on": [_text(d) for d in (depends if isinstance(depends, list) else [depends]) if _text(d)],
        })
    return {"cards": cards[:40]}


def normalize_row(raw: Any) -> dict:
    body = _first_dict(raw, "actions")
    rows = body.get("rows")
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        body = rows[0]
    fields_raw: dict = body.get("fields") if isinstance(body.get("fields"), dict) else {}
    fields: dict[str, Any] = {}
    for key, value in fields_raw.items():
        name = ROW_FIELD_SYNONYMS.get(_lower(key), _lower(key))
        if name in ROW_FIELD_KEYS and _text(value):
            fields[name] = _text(value)
    actions: list[dict] = []
    label_to_seq: dict[str, int] = {}
    actions_raw = body.get("actions") or body.get("steps") or []
    for idx, item in enumerate(actions_raw if isinstance(actions_raw, list) else [], start=1):
        if isinstance(item, str):
            item = {"label": item}
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label") or item.get("name") or item.get("title"))[:200]
        if not label:
            continue
        try:
            seq = int(item.get("seq", idx))
        except (TypeError, ValueError):
            seq = idx
        kind = _lower(item.get("kind") or item.get("type"))
        kind = ACTION_KIND_SYNONYMS.get(kind, kind)
        if kind not in ACTION_KINDS:
            kind = "action"
        action: dict[str, Any] = {"seq": seq, "label": label, "kind": kind}
        for key in ("name", "rule", "input", "output", "system"):
            value = _text(item.get(key))
            if value:
                action[key] = value
        variant = _lower(item.get("variant"))
        if variant in ("normal", "exception"):
            action["variant"] = variant
        actions.append(action)
        label_to_seq.setdefault(label.lower(), seq)
    # seq 중복은 등장 순서로 다시 매긴다(모델이 1,1,2처럼 내는 경우)
    seen_seq: set[int] = set()
    for idx, action in enumerate(actions, start=1):
        if action["seq"] in seen_seq:
            action["seq"] = max(seen_seq) + 1
        seen_seq.add(action["seq"])
    known_seq = {a["seq"] for a in actions}

    def _endpoint(value: Any) -> int | None:
        if isinstance(value, bool):
            return None
        if isinstance(value, int):
            return value if value in known_seq else None
        text = _text(value)
        if text.isdigit() and int(text) in known_seq:
            return int(text)
        return label_to_seq.get(text.lower())

    relations_raw = body.get("relations")
    edges_raw = relations_raw.get("edges") if isinstance(relations_raw, dict) else relations_raw
    edges: list[dict] = []
    for item in edges_raw if isinstance(edges_raw, list) else []:
        if not isinstance(item, dict):
            continue
        src, dst = _endpoint(item.get("src", item.get("from"))), _endpoint(item.get("dst", item.get("to")))
        if src is None or dst is None:
            continue
        kind = EDGE_KIND_SYNONYMS.get(_lower(item.get("kind") or item.get("type")), _lower(item.get("kind") or item.get("type")))
        edge: dict[str, Any] = {"src": src, "dst": dst, "kind": kind if kind in EDGE_KINDS else "seq"}
        gateway = _lower(item.get("gateway"))
        if gateway in GATEWAYS:
            edge["gateway"] = gateway
        for key in ("condition", "label"):
            value = _text(item.get(key))
            if value:
                edge[key] = value
        edges.append(edge)
    out: dict[str, Any] = {
        "l6": _text(body.get("l6") or body.get("name") or body.get("title"))[:200],
        "ownerRole": _text(body.get("ownerRole") or body.get("owner_role") or body.get("role"))[:100],
        "department": _text(body.get("department"))[:100],
        "fields": fields,
        "actions": actions,
    }
    if edges:
        out["relations"] = {"edges": edges}
    return out


def normalize_relations(raw: Any, known: dict[str, str]) -> dict:
    """known = {taskId: 이름}. 끝점은 taskId 우선, 이름으로도 해석하며 미해석 엣지는 버린다."""
    body = _first_dict(raw, "edges")
    by_name = {name.lower(): tid for tid, name in known.items()}

    def _tid(value: Any) -> str | None:
        text = _text(value)
        if text in known:
            return text
        return by_name.get(text.lower())

    entry_raw = body.get("entry")
    entry_id = _tid(entry_raw.get("taskId") or entry_raw.get("task_id") or entry_raw.get("name")) if isinstance(entry_raw, dict) else _tid(entry_raw)
    trigger = _lower(entry_raw.get("triggerType") or entry_raw.get("trigger_type") or entry_raw.get("trigger")) if isinstance(entry_raw, dict) else ""
    entry = {
        "taskId": entry_id or next(iter(known), ""),
        "triggerType": trigger if trigger in TRIGGERS else "manual",
        "label": _text(entry_raw.get("label")) if isinstance(entry_raw, dict) else "",
    }
    edges: list[dict] = []
    for item in body.get("edges") if isinstance(body.get("edges"), list) else []:
        if not isinstance(item, dict):
            continue
        src, dst = _tid(item.get("src", item.get("from"))), _tid(item.get("dst", item.get("to")))
        if src is None or dst is None:
            continue
        kind = EDGE_KIND_SYNONYMS.get(_lower(item.get("kind") or item.get("type")), _lower(item.get("kind") or item.get("type")))
        edge: dict[str, Any] = {"src": src, "dst": dst, "kind": kind if kind in EDGE_KINDS else "seq"}
        gateway = _lower(item.get("gateway"))
        if gateway in GATEWAYS:
            edge["gateway"] = gateway
        for key in ("condition", "label"):
            value = _text(item.get(key))
            if value:
                edge[key] = value
        edges.append(edge)
    return {"entry": entry, "edges": edges}
