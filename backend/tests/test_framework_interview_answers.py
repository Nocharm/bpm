"""fill_answers — 전 문항 필수, 빈 주관식은 제안값 자동 적용 (spec 2026-09-21 §4)."""

from app.framework_interview.answers import fill_answers

Q = {
    "questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동",
         "options": [{"id": "a", "label": "접수"}, {"id": "b", "label": "검토"}], "suggested": ["a", "b"]},
        {"id": "q2", "kind": "single", "maps_to": "roles", "text": "역할",
         "options": [{"id": "r1", "label": "담당자"}, {"id": "r2", "label": "관리자"}], "suggested": ["r1"]},
        {"id": "q3", "kind": "text", "maps_to": "conditions", "text": "시작 조건", "options": [],
         "suggested": "요청서 접수"},
    ]
}


def test_blank_text_is_filled_from_suggested_and_marked_auto() -> None:
    filled, missing = fill_answers(Q, {"q1": ["b", "a"], "q2": "r2", "q3": ""})
    assert missing == []
    assert filled["q3"] == {"value": "요청서 접수", "auto": True}
    assert filled["q1"] == {"value": ["b", "a"], "auto": False}


def test_missing_choice_is_reported() -> None:
    filled, missing = fill_answers(Q, {"q1": ["a", "b"], "q3": "x"})
    assert missing == ["q2"]


def test_unknown_option_counts_as_missing() -> None:
    _, missing = fill_answers(Q, {"q1": ["zzz"], "q2": "r1", "q3": "x"})
    assert missing == ["q1"]


def test_single_rejects_list_value() -> None:
    _, missing = fill_answers(Q, {"q1": ["a"], "q2": ["r1"], "q3": "x"})
    assert missing == ["q2"]
