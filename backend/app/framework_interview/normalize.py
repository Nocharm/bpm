"""AI 응답 정규화 — 스키마 검증 전에 흔한 편차를 흡수한다 (실모델 "invalid response" 대응 2026-09-21).

모델은 키 이름·kind 표기·옵션 형식·suggested 타입을 자주 바꾼다. 여기서 관대하게 받아
contracts.py 스키마가 요구하는 모양으로 맞춘 뒤 검증한다. 의미를 바꾸지는 않는다(추측 금지):
알 수 없는 값은 안전한 기본값으로, 해석 불가 항목은 버린다.
"""

import re
from typing import Any

from app.framework_interview.canvas import BRANCH_PREFIX, END_ID, START_ID
from app.framework_interview.contracts import ROW_FIELD_KEYS as CONTRACT_ROW_FIELD_KEYS

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
# 프롬프트와 같은 한 벌(contracts.ROW_FIELD_KEYS, 별칭 done_criterial은 동의어로 접는다) — 빠진 키는 정정 왕복에서 조용히 버려진다
ROW_FIELD_KEYS = set(CONTRACT_ROW_FIELD_KEYS)
# 회당 시간의 대표값(분 정수) — 어댑터가 이 둘만 sp_duration·sp_touch_time으로 착지시킨다
ROW_MINUTE_KEYS = {"total_time_min", "touch_time_min"}
# 다중 항목 문자열 — 배열이면 어댑터 _join_multi처럼 개행으로 합친다(쉼표로 합치면 sp_input 여러 줄이 한 줄로 뭉개진다)
ROW_MULTILINE_KEYS = {"input_data", "output_data"}
ROW_FIELD_SYNONYMS = {"start": "start_condition", "trigger": "start_condition", "input": "input_data",
                      "inputs": "input_data", "output": "output_data", "outputs": "output_data",
                      "done": "done_criteria", "end_condition": "done_criteria", "done_criterial": "done_criteria",
                      "system": "systems", "duration": "total_time", "time": "total_time"}


def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(_text(v) for v in value if _text(v))
    if isinstance(value, dict):
        return _text(value.get("label") or value.get("text") or value.get("name") or "")
    return str(value).strip()


def _minutes(value: Any) -> int | None:
    """분 정수 — 어댑터 _parse_minutes와 같은 규칙(음수·소수·자유텍스트는 버린다)."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, float):
        return int(value) if value >= 0 and value == int(value) else None
    text = str(value).strip()
    return int(text) if text.isdigit() else None


def _lower(value: Any) -> str:
    return _text(value).lower().replace("-", "_").replace(" ", "_")


_IO_SPLIT = re.compile(r"[,\n/·]")


def _io_list(value: Any) -> list[str]:
    """str 또는 list → 항목 리스트(trim, 빈 값·중복 제거, 순서 유지). IO는 배열이 정본이다 (2026-09-23)."""
    if isinstance(value, list):
        items = value
    elif value is None:
        items = []
    else:
        items = _IO_SPLIT.split(str(value))
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        text = _text(item)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _first_dict(raw: Any, list_key: str) -> dict:
    """{key:[...]} · [...] · {"data": {...}} 같은 포장을 벗겨 본체 dict를 돌려준다."""
    if isinstance(raw, list):
        return {list_key: raw}
    if not isinstance(raw, dict):
        return {}
    for wrapper in ("data", "result", "response", "output", "canvas"):
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
        why = _text(item.get("why") or item.get("reason") or item.get("rationale"))[:300]
        out.append({"id": qid, "kind": kind, "maps_to": maps_to, "section": section, "why": why, "text": text[:600], "options": options, "suggested": suggested})
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
        owner_role = _text(item.get("owner_role") or item.get("ownerRole") or item.get("role"))[:100]
        department = _text(item.get("department") or item.get("dept"))[:100]
        if owner_role and owner_role.casefold() == department.casefold():
            owner_role = ""  # 역할은 사람의 역할이지 부서명이 아니다 — 부서를 그대로 베낀 역할은 비워 사용자가 채우게
        cards.append({
            "name": name,
            "summary": _text(item.get("summary") or item.get("description")),
            "owner_role": owner_role,
            "department": department,
            "depends_on": [_text(d) for d in (depends if isinstance(depends, list) else [depends]) if _text(d)],
            # 기존 맵 매칭의 1차 키 — 버리면 merge_existing_cards가 이름 일치로만 묶어 이름이 조금 바뀐 카드가
            # 같은 맵을 새 L6로 중복 등록한다. mode는 넣지 않는다(병합이 keep/new를 판정)
            "existing_code": _text(item.get("existing_code") or item.get("existingCode") or item.get("code"))[:40] or None,
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
        if name not in ROW_FIELD_KEYS:
            continue
        if name in ROW_MINUTE_KEYS:
            minutes = _minutes(value)
            if minutes is not None:
                fields[name] = minutes
        elif name in ROW_MULTILINE_KEYS and isinstance(value, list):
            joined = "\n".join(_text(v) for v in value if _text(v))
            if joined:
                fields[name] = joined
        elif _text(value):
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
        for key in ("name", "rule", "system"):
            value = _text(item.get(key))
            if value:
                action[key] = value
        for key in ("input", "output"):
            io_value = _io_list(item.get(key))
            if io_value:
                action[key] = io_value
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


def normalize_canvas(raw: Any, base: dict, known: set[str]) -> dict:
    """AI가 고쳐 보낸 캔버스 → 저장 가능한 형태. base(직전 캔버스)가 노드·좌표의 기준이다.

    모델은 id·task_id를 바꾸지 못한다: base에 있던 노드는 종류·task_id·좌표를 base 값으로 되돌리고,
    빠뜨린 subprocess/start/end는 base에서 보충한다. 새 노드는 `__branch__` 접두 분기 노드만 받고
    엣지는 양 끝이 남은 노드일 때만 살린다(쌍은 유일). 같은 쌍의 gateway를 모델이 빠뜨리면 base 값을 잇는다.
    """
    body = _first_dict(raw, "nodes")
    base_nodes = [n for n in (base.get("nodes") or []) if isinstance(n, dict)]
    base_by_id = {str(n.get("id")): n for n in base_nodes}

    def _from_base(origin: dict, title: str = "") -> dict | None:
        """base 노드 → 캔버스 노드. 세션에 없는 task_id를 든 subprocess는 버린다(낡은 캔버스)."""
        node_type = str(origin.get("node_type") or "subprocess")
        task_id = _text(origin.get("task_id")) or None
        if node_type == "subprocess" and task_id not in known:
            return None
        return {"id": str(origin.get("id")), "node_type": node_type,
                "title": (title or _text(origin.get("title")))[:200],
                "task_id": task_id if node_type == "subprocess" else None,
                "pos_x": float(origin.get("pos_x") or 0.0), "pos_y": float(origin.get("pos_y") or 0.0)}

    nodes: list[dict] = []
    kept: set[str] = set()
    for item in body.get("nodes") if isinstance(body.get("nodes"), list) else []:
        if not isinstance(item, dict):
            continue
        node_id = _text(item.get("id"))
        if not node_id or node_id in kept:
            continue
        origin = base_by_id.get(node_id)
        title = _text(item.get("title") or item.get("label"))
        if origin is not None:
            node = _from_base(origin, title)
        elif node_id.startswith(BRANCH_PREFIX):
            # 새 노드는 분기만 받는다 — 새 L6는 계획 단계에서만 태어난다
            node = {"id": node_id, "node_type": "decision", "title": title[:200], "task_id": None,
                    "pos_x": 0.0, "pos_y": 0.0}
        else:
            node = None
        if node is None:
            continue
        kept.add(node_id)
        nodes.append(node)
    for origin in base_nodes:  # 빠뜨린 필수 노드 보충 — 카드 하나가 캔버스에서 증발하면 안 된다
        if str(origin.get("id")) in kept or str(origin.get("node_type")) not in ("subprocess", "start", "end"):
            continue
        node = _from_base(origin)
        if node is None:
            continue
        kept.add(node["id"])
        nodes.append(node)
    for node_id, node_type, title in ((START_ID, "start", "Start"), (END_ID, "end", "End")):
        if node_id not in kept:  # base에도 없던 경우 — 캔버스는 항상 시작·끝을 갖는다
            kept.add(node_id)
            nodes.append({"id": node_id, "node_type": node_type, "title": title,
                          "task_id": None, "pos_x": 0.0, "pos_y": 0.0})

    base_edges = {
        (str(e.get("source_node_id") or ""), str(e.get("target_node_id") or "")): e
        for e in (base.get("edges") or []) if isinstance(e, dict)
    }
    edges: list[dict] = []
    seen_pairs: set[tuple[str, str]] = set()
    for item in body.get("edges") if isinstance(body.get("edges"), list) else []:
        if not isinstance(item, dict):
            continue
        source = _text(item.get("source_node_id") or item.get("source") or item.get("src"))
        target = _text(item.get("target_node_id") or item.get("target") or item.get("dst"))
        if source not in kept or target not in kept or (source, target) in seen_pairs:
            continue
        seen_pairs.add((source, target))
        edge: dict[str, Any] = {
            "id": _text(item.get("id")) or f"{source}>{target}",
            "source_node_id": source, "target_node_id": target,
            "label": _text(item.get("label") or item.get("condition")),
        }
        gateway = _lower(item.get("gateway"))
        if gateway not in GATEWAYS:
            # 모델이 안 실어 보낸 gateway는 base 값을 이어받는다 — 전부 parallel인 팬아웃은 분기 노드 없이
            # 직결로 펴지므로, 라벨만 고치는 피드백에 표시가 빠지면 확정 게이트 6(plain_fanout 예외)이 무너진다
            gateway = _lower((base_edges.get((source, target)) or {}).get("gateway"))
        if gateway in GATEWAYS:
            edge["gateway"] = gateway
        edges.append(edge)
    return {"nodes": nodes, "edges": edges}


def _plan_stages(plan: list[dict]) -> dict[str, int]:
    """taskId → 단계(선행 깊이). FE lib/plan-cards computeStages와 같은 규칙(순환은 방문 중 카드를 선행으로 치지 않는다)."""
    by_name = {}
    for card in plan:
        name = _text(card.get("name"))
        if name and name not in by_name and card.get("task_id"):
            by_name[name] = card
    stages: dict[str, int] = {}
    visiting: set[str] = set()

    def stage_of(card: dict) -> int:
        tid = str(card.get("task_id"))
        if tid in stages:
            return stages[tid]
        if tid in visiting:
            return 0
        visiting.add(tid)
        depth = 0
        for dep in card.get("depends_on") or []:
            target = by_name.get(_text(dep))
            if target is None or target is card:
                continue
            depth = max(depth, stage_of(target) + 1)
        visiting.discard(tid)
        stages[tid] = depth
        return depth

    for card in plan:
        if card.get("task_id"):
            stage_of(card)
    return stages


def align_relations_to_plan(relations: dict, plan: list[dict]) -> dict:
    """AI 흐름 제안을 계획(카드 선행)에 맞춘다 — 계획 화면에서 고친 순서가 연결 단계에 그대로 오게(사용자 지적 2026-09-28).

    - 카드가 선행으로 둔 쌍(선행 → 카드)은 반드시 엣지로 있게 보강한다(kind seq).
    - 뒤 단계 → 앞 단계 엣지는 loop가 아니면 loop로 본다(계획 순서를 거스르는 연결은 되돌아감).
    - 진입점은 첫 단계 카드 중 하나여야 한다 — 아니면 첫 단계의 첫 카드로 바꾼다.
    """
    stages = _plan_stages(plan)
    if not stages:
        return relations
    by_name = {_text(card.get("name")): str(card.get("task_id")) for card in plan if card.get("task_id")}
    edges = [dict(edge) for edge in relations.get("edges") or []]
    present = {(edge["src"], edge["dst"]) for edge in edges}
    for card in plan:
        tid = str(card.get("task_id") or "")
        if not tid:
            continue
        for dep in card.get("depends_on") or []:
            src = by_name.get(_text(dep))
            if src and src != tid and (src, tid) not in present:
                edges.append({"src": src, "dst": tid, "kind": "seq"})
                present.add((src, tid))
    for edge in edges:
        if edge.get("kind") != "loop" and stages.get(edge["dst"], 0) < stages.get(edge["src"], 0):
            edge["kind"] = "loop"
            edge.pop("gateway", None)
    # 진입점은 내부 카드(태스크) 중 가장 앞 단계 — 외부 참조(다른 L5의 L6)는 시작이 될 수 없다
    internal = [card for card in plan if card.get("task_id") and card.get("mode") != "external"]
    if internal:
        lowest = min(stages.get(str(card["task_id"]), 0) for card in internal)
        first_stage = [str(card["task_id"]) for card in internal if stages.get(str(card["task_id"]), 0) == lowest]
    else:
        first_stage = []
    entry = dict(relations.get("entry") or {})
    if first_stage and entry.get("taskId") not in first_stage:
        entry["taskId"] = first_stage[0]
    return {**relations, "entry": entry, "edges": edges}


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
