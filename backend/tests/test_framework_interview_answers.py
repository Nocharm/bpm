"""fill_answers — 객관식 필수(single도 복수 허용), 빈 주관식은 미답변, 코멘트·제출 코멘트 저장 (spec 2026-09-21 §4, 2026-09-28 개정)."""

from app.framework_interview.answers import NOTE_KEY, fill_answers

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


def test_blank_text_stays_unanswered() -> None:
    """빈 주관식은 제안값을 적용하지 않고 빈 값으로 남는다 — 안 적은 건 안 적은 것(사용자 결정 2026-09-28)."""
    filled, missing = fill_answers(Q, {"q1": ["b", "a"], "q2": "r2", "q3": ""})
    assert missing == []
    assert filled["q3"] == {"value": "", "auto": False}
    assert filled["q1"] == {"value": ["b", "a"], "auto": False}
    assert NOTE_KEY not in filled


def test_comments_and_note_are_kept() -> None:
    filled, missing = fill_answers(
        Q, {"q1": ["a", "b"], "q2": "r1", "q3": " x "},
        comments={"q2": " 대부분은 담당자, 긴급 건은 관리자 ", "q9": "ghost", "q3": "   "}, note=" 야간엔 당직자가 처리 ",
    )
    assert missing == []
    assert filled["q2"] == {"value": "r1", "auto": False, "comment": "대부분은 담당자, 긴급 건은 관리자"}
    assert "comment" not in filled["q3"] and filled["q3"]["value"] == "x"
    assert filled[NOTE_KEY] == {"value": "야간엔 당직자가 처리"}


def test_missing_choice_is_reported() -> None:
    filled, missing = fill_answers(Q, {"q1": ["a", "b"], "q3": "x"})
    assert missing == ["q2"]


def test_unknown_option_counts_as_missing() -> None:
    _, missing = fill_answers(Q, {"q1": ["zzz"], "q2": "r1", "q3": "x"})
    assert missing == ["q1"]


def test_single_accepts_a_non_empty_list_of_options() -> None:
    """single 문항도 복수 답을 받는다(둘 다 해당) — 빈 배열·모르는 id는 누락."""
    filled, missing = fill_answers(Q, {"q1": ["a"], "q2": ["r1", "r2"], "q3": "x"})
    assert missing == []
    assert filled["q2"] == {"value": ["r1", "r2"], "auto": False}
    _, missing = fill_answers(Q, {"q1": ["a"], "q2": [], "q3": "x"})
    assert missing == ["q2"]
    _, missing = fill_answers(Q, {"q1": ["a"], "q2": ["zzz"], "q3": "x"})
    assert missing == ["q2"]
