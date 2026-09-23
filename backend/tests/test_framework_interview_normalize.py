"""AI 응답 정규화·재시도 되먹임 — 실모델 편차(kind 표기·라벨 suggested·문자열 actions)가 스키마를 통과한다."""

import asyncio

from app import ai_client
from app.framework_interview.ai import ask_schema
from app.framework_interview.contracts import PlanOut, QuestionnaireOut, RelationsOut, RowOut
from app.framework_interview.assemble import finalize_row_output
from app.framework_interview.normalize import (
    normalize_canvas, normalize_plan, normalize_questionnaire, normalize_relations, normalize_row,
)
from app.interview.orchestrator import TurnError


def test_questionnaire_synonyms_labels_and_missing_ids() -> None:
    raw = {"questions": [
        {"type": "checkbox", "category": "steps", "question": "활동을 고르세요",
         "choices": ["요청 확인", "완결성 판정", {"value": "reg", "text": "접수 등록"}],
         "default": ["요청 확인", "reg"]},
        {"kind": "radio", "maps_to": "role", "text": "역할", "options": [{"label": "담당자"}, {"label": "관리자"}], "suggested": "담당자"},
        {"kind": "free", "maps_to": "trigger", "text": "시작 조건", "suggested": ["요청서", "도착"]},
        {"kind": "single", "maps_to": "systems", "text": "보기 하나뿐", "options": ["ERP"], "suggested": "ERP"},
    ]}
    out = normalize_questionnaire(raw)
    q1, q2, q3, q4 = out["questions"]
    # 4문항이라 min 3 완화 스키마를 통과해야 한다
    QuestionnaireOut.model_validate(out)
    assert q1["kind"] == "ordered" and q1["maps_to"] == "activities"  # activities 객관식은 ordered로 승격
    assert [o["id"] for o in q1["options"]] == ["o1", "o2", "reg"]
    assert q1["suggested"] == ["o1", "reg"]
    assert q2["kind"] == "single" and q2["suggested"] == ["o1"]
    assert q3["kind"] == "text" and q3["suggested"] == "요청서, 도착" and q3["maps_to"] == "conditions"
    assert q4["kind"] == "text"  # 보기 1개는 객관식이 될 수 없다
    assert [q["id"] for q in out["questions"]] == ["q1", "q2", "q3", "q4"]


def test_row_string_actions_and_label_edges() -> None:
    raw = {"name": "요청 접수", "role": "담당자", "fields": {"start": "요청서 도착", "inputs": ["요청서"], "unknown": "x"},
           "steps": ["요청 확인", {"label": "완결성 판정", "type": "branch"}, {"name": "접수 등록", "seq": "3"}],
           "relations": [{"from": "요청 확인", "to": "완결성 판정"}, {"src": 2, "dst": 3, "kind": "conditional", "gateway": "Exclusive", "condition": "완결"},
                         {"src": 2, "dst": "없는 활동", "kind": "loop"}]}
    row = normalize_row(raw)
    RowOut.model_validate(row)
    assert row["l6"] == "요청 접수" and row["ownerRole"] == "담당자"
    assert row["fields"] == {"start_condition": "요청서 도착", "input_data": "요청서"}
    assert [(a["seq"], a["kind"]) for a in row["actions"]] == [(1, "action"), (2, "decision"), (3, "action")]
    assert row["relations"]["edges"] == [
        {"src": 1, "dst": 2, "kind": "seq"},
        {"src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "완결"},
    ]


def test_relations_resolve_names_and_drop_unknown() -> None:
    known = {"c-01": "요청 접수", "c-02": "검토 승인"}
    out = normalize_relations({"entry": "요청 접수", "edges": [
        {"from": "요청 접수", "to": "c-02", "type": "sequence"}, {"src": "c-02", "dst": "c-99"},
    ]}, known)
    RelationsOut.model_validate(out)
    assert out["entry"]["taskId"] == "c-01" and out["entry"]["triggerType"] == "manual"
    assert out["edges"] == [{"src": "c-01", "dst": "c-02", "kind": "seq"}]
    fallback = normalize_relations({"edges": []}, known)
    assert fallback["entry"]["taskId"] == "c-01"


def test_plan_accepts_titles_and_dedupes() -> None:
    out = normalize_plan({"items": [{"title": "요청 접수", "role": "담당자"}, "검토 승인", {"name": "요청 접수"}]})
    PlanOut.model_validate(out)
    assert [c["name"] for c in out["cards"]] == ["요청 접수", "검토 승인"]
    assert out["cards"][0]["owner_role"] == "담당자"


def test_ask_schema_feeds_back_validation_errors(monkeypatch) -> None:
    replies = ['```json\n{"cards": []}\n```', '{"cards": [{"name": "A"}]}']
    seen: list[list[dict]] = []

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        seen.append(messages)
        return ai_client.AiReply(content=replies.pop(0), prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    out = asyncio.run(ask_schema([{"role": "user", "content": "go"}], PlanOut, normalizer=normalize_plan))
    assert [c.name for c in out.cards] == ["A"]
    assert len(seen) == 2
    feedback = seen[1][-1]["content"]
    assert "cards" in feedback and "형식 오류" in feedback


def test_ask_schema_gives_up_with_reason(monkeypatch) -> None:
    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        return ai_client.AiReply(content="not json at all", prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    try:
        asyncio.run(ask_schema([{"role": "user", "content": "go"}], PlanOut, normalizer=normalize_plan, attempts=2))
    except TurnError as exc:
        assert "invalid response" in str(exc) and "invalid JSON" in str(exc)
    else:
        raise AssertionError("expected TurnError")


def test_normalize_questionnaire_fills_section_from_maps_to() -> None:
    raw = {"questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동", "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "suggested": ["a"]},
        {"id": "q2", "kind": "single", "maps_to": "roles", "text": "역할", "options": [{"id": "r", "label": "R"}, {"id": "s", "label": "S"}], "suggested": ["r"], "section": "weird"},
        {"id": "q3", "kind": "text", "maps_to": "io", "text": "입력", "options": [], "suggested": "x", "section": "exceptions"},
    ]}
    out = normalize_questionnaire(raw)
    sections = {q["id"]: q["section"] for q in out["questions"]}
    assert sections == {"q1": "activities", "q2": "basic", "q3": "exceptions"}  # 명시 값은 존중, 미지 값은 basic, 누락은 maps_to로


def test_normalize_row_splits_io_into_lists() -> None:
    raw = {"l6": "x", "actions": [
        {"seq": 1, "label": "A", "input": "요청서, 첨부 / 요청서", "output": ["확인 메모", " "]},
        {"seq": 2, "label": "B", "input": ["확인 메모"], "output": ""},
    ]}
    out = normalize_row(raw)
    assert out["actions"][0]["input"] == ["요청서", "첨부"]
    assert out["actions"][0]["output"] == ["확인 메모"]
    assert out["actions"][1]["input"] == ["확인 메모"]
    assert "output" not in out["actions"][1]


# ── normalize_canvas (AI 피드백이 고친 캔버스) ──

BASE_CANVAS = {
    "nodes": [
        {"id": "__start__", "node_type": "start", "title": "Start", "task_id": None, "pos_x": 120.0, "pos_y": 200.0},
        {"id": "t1", "node_type": "subprocess", "title": "접수", "task_id": "t1", "pos_x": 360.0, "pos_y": 200.0},
        {"id": "t2", "node_type": "subprocess", "title": "검토", "task_id": "t2", "pos_x": 600.0, "pos_y": 200.0},
        {"id": "__end__", "node_type": "end", "title": "End", "task_id": None, "pos_x": 840.0, "pos_y": 200.0},
    ],
    "edges": [
        {"id": "__start__>t1", "source_node_id": "__start__", "target_node_id": "t1", "label": ""},
        {"id": "t1>t2", "source_node_id": "t1", "target_node_id": "t2", "label": "", "gateway": "parallel"},
        {"id": "t2>__end__", "source_node_id": "t2", "target_node_id": "__end__", "label": ""},
    ],
}
BASE_KNOWN = {"t1", "t2"}


def test_normalize_canvas_refills_dropped_nodes_and_keeps_base_coordinates() -> None:
    """모델이 t2·__end__를 빠뜨려도 base에서 되살린다 — 카드가 캔버스에서 증발하면 안 된다."""
    raw = {"nodes": [
        {"id": "__start__", "node_type": "start", "title": "Start", "task_id": None},
        {"id": "t1", "node_type": "decision", "title": "접수", "task_id": "zzz"},  # 종류·task_id 변경 시도
    ], "edges": [{"source_node_id": "__start__", "target_node_id": "t1", "label": ""}]}
    out = normalize_canvas(raw, BASE_CANVAS, BASE_KNOWN)
    by_id = {n["id"]: n for n in out["nodes"]}
    assert set(by_id) == {"__start__", "t1", "t2", "__end__"}
    assert by_id["t1"]["node_type"] == "subprocess" and by_id["t1"]["task_id"] == "t1"
    assert (by_id["t2"]["pos_x"], by_id["t2"]["pos_y"]) == (600.0, 200.0)  # 좌표는 base 값


def test_normalize_canvas_synthesizes_start_and_end_when_base_had_none() -> None:
    base = {"nodes": [BASE_CANVAS["nodes"][1]], "edges": []}
    out = normalize_canvas({"nodes": [], "edges": []}, base, BASE_KNOWN)
    assert {n["id"]: n["node_type"] for n in out["nodes"]} == {
        "t1": "subprocess", "__start__": "start", "__end__": "end"}


def test_normalize_canvas_rejects_new_nodes_that_are_not_branches() -> None:
    """새 노드는 `__branch__` 분기만 — 새 L6는 계획 단계에서만 태어난다."""
    raw = {"nodes": [
        *BASE_CANVAS["nodes"],
        {"id": "t9", "node_type": "subprocess", "title": "지어낸 업무", "task_id": "t9"},
        {"id": "__branch__t1", "node_type": "decision", "title": "접수 결과", "task_id": None},
    ], "edges": [
        {"source_node_id": "t1", "target_node_id": "__branch__t1", "label": ""},
        {"source_node_id": "__branch__t1", "target_node_id": "t9", "label": "신규"},
    ]}
    out = normalize_canvas(raw, BASE_CANVAS, BASE_KNOWN)
    ids = {n["id"] for n in out["nodes"]}
    assert "t9" not in ids and "__branch__t1" in ids
    # 버려진 노드를 가리키는 엣지도 같이 버린다
    assert {(e["source_node_id"], e["target_node_id"]) for e in out["edges"]} == {("t1", "__branch__t1")}


def test_normalize_canvas_drops_subprocess_with_unknown_task_id() -> None:
    """세션에 없는 task_id를 든 노드는 버린다 — 낡은 캔버스가 계속 422를 내지 않게."""
    out = normalize_canvas(BASE_CANVAS, BASE_CANVAS, {"t1"})
    assert {n["id"] for n in out["nodes"]} == {"__start__", "t1", "__end__"}
    assert {(e["source_node_id"], e["target_node_id"]) for e in out["edges"]} == {("__start__", "t1")}


def test_normalize_canvas_carries_base_gateway_when_the_model_omits_it() -> None:
    """라벨만 고치는 피드백이 전부 parallel인 팬아웃을 seq로 떨어뜨리면 안 된다."""
    raw = {"canvas": {"nodes": BASE_CANVAS["nodes"], "edges": [
        {"source_node_id": "t1", "target_node_id": "t2", "label": "동시 진행"},   # gateway 누락
        {"source_node_id": "t2", "target_node_id": "__end__", "label": "", "gateway": "weird"},
    ]}}
    out = normalize_canvas(raw, BASE_CANVAS, BASE_KNOWN)
    by_pair = {(e["source_node_id"], e["target_node_id"]): e for e in out["edges"]}
    assert by_pair[("t1", "t2")]["gateway"] == "parallel" and by_pair[("t1", "t2")]["label"] == "동시 진행"
    assert "gateway" not in by_pair[("t2", "__end__")]  # base에도 없고 모델 값도 미지 → 표시 없음


def test_finalize_row_output_drops_owner_and_fills_department_from_the_card() -> None:
    """드로잉·피드백 공통 마감 — 빈 부서는 카드 값으로 메운다(한쪽만 하면 피드백이 부서를 지운다)."""
    out = RowOut.model_validate({
        "l6": "접수", "owner": "홍길동", "ownerRole": "담당자", "department": "",
        "actions": [{"seq": 1, "label": "A"}, {"seq": 2, "label": "B"}],
    })
    row = finalize_row_output(out, {"department": "품질팀"})
    assert "owner" not in row and row["department"] == "품질팀"
    assert finalize_row_output(out, {})["department"] == ""
