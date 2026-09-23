"""AI 응답 정규화·재시도 되먹임 — 실모델 편차(kind 표기·라벨 suggested·문자열 actions)가 스키마를 통과한다."""

import asyncio

from app import ai_client
from app.framework_interview.ai import ask_schema
from app.framework_interview.contracts import PlanOut, QuestionnaireOut, RelationsOut, RowOut
from app.framework_interview.normalize import (
    normalize_plan, normalize_questionnaire, normalize_relations, normalize_row,
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
