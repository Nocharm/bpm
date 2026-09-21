"""캠페인 프롬프트 빌더·응답 모델 — 카탈로그 블록 삽입·오버라이드 적용·스키마 검증."""

import pytest
from pydantic import ValidationError

from app.framework_interview import contracts as c

EXISTING_ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action", "name": "요청서 내용 확인", "rule": "양식 A",
         "input": "요청서", "output": "접수증", "system": "ERP"},
        {"seq": 2, "label": "완결성 판정", "kind": "decision", "variant": "exception"},
    ],
    "relations": {"edges": [{"src": 1, "dst": 2, "kind": "branch", "condition": "완결"}]},
}


def test_plan_messages_include_catalogs_and_override() -> None:
    msgs = c.build_plan_messages(
        lang="ko", category_path="EPCV > Facility > 유틸리티 > 정제수 > 정제수 일상 점검",
        brief="매일 정제수 라운드", existing_names=["기존 L6"],
        role_catalog="- 운전원", dept_catalog="- 유틸리티팀",
        overrides={"l5_plan_contract": "OVERRIDE"},
    )
    system = msgs[0]["content"]
    assert system.startswith("OVERRIDE")
    assert "- 운전원" in system and "- 유틸리티팀" in system
    assert "기존 L6" in msgs[-1]["content"]


def test_plan_messages_list_existing_maps() -> None:
    """기존 L6 맵 블록 — 계획 AI가 유지 카드를 코드째로 되돌려주게 하는 재료 (spec 2026-09-22 §2.3)."""
    msgs = c.build_plan_messages(
        lang="ko", category_path="L5", brief="", existing_names=[],
        existing_maps=[{"code": "x-01", "name": "접수", "summary": "s", "activities": ["a", "b"]}],
    )
    user = msgs[-1]["content"]
    assert "[이미 있는 L6 맵]" in user
    assert "- x-01 · 접수: s (활동: a → b)" in user
    assert "existing_code" in msgs[0]["content"]

    empty = c.build_plan_messages(lang="ko", category_path="L5", brief="", existing_names=[], existing_maps=[])
    assert "[이미 있는 L6 맵]\n- (없음)" in empty[-1]["content"]


def test_existing_row_block_feeds_questionnaire_and_row_messages() -> None:
    """정정 태스크의 프롬프트에는 현재 등록된 내용이 붙는다 (spec 2026-09-22 §2.5)."""
    q = c.build_questionnaire_messages(
        lang="ko", category_path="L5", brief="", card={"name": "요청 접수"}, neighbors=[],
        existing_row=EXISTING_ROW,
    )
    assert "[현재 등록된 내용]" in q[-1]["content"]
    assert "1. 요청 확인 (action)" in q[-1]["content"]
    assert "[현재 등록된 내용]" in q[0]["content"]  # 계약 문구도 이 블록을 안다

    row = c.build_row_messages(
        lang="ko", card={"name": "요청 접수"}, questionnaire={"questions": []}, answers={},
        existing_row=EXISTING_ROW,
    )
    assert "[현재 등록된 내용]" in row[-1]["content"]
    assert "1. 요청 확인 (action)" in row[-1]["content"]
    assert "[현재 등록된 내용]" in row[0]["content"]

    plain_q = c.build_questionnaire_messages(
        lang="ko", category_path="L5", brief="", card={"name": "요청 접수"}, neighbors=[],
    )
    plain_row = c.build_row_messages(
        lang="ko", card={"name": "요청 접수"}, questionnaire={"questions": []}, answers={},
    )
    assert "[현재 등록된 내용]" not in plain_q[-1]["content"]
    assert "[현재 등록된 내용]" not in plain_row[-1]["content"]


def test_render_existing_row_lists_actions_fields_and_edges() -> None:
    text = c.render_existing_row(EXISTING_ROW)
    # 입출력·시스템·예외 표시가 빠지면 정정 설문이 이미 답한 것을 되묻는다
    assert "1. 요청 확인 (action) · 요청서 내용 확인 · 규칙: 양식 A · 입력: 요청서 · 출력: 접수증 · 시스템: ERP" in text
    assert "2. 완결성 판정 (decision) · 예외" in text
    assert "- start_condition: 요청서 도착" in text
    assert "- 1→2 branch 완결" in text


def test_questionnaire_out_requires_activities_ordered() -> None:
    with pytest.raises(ValidationError):
        c.QuestionnaireOut.model_validate({"questions": [
            {"id": "q1", "kind": "single", "maps_to": "roles", "text": "?",
             "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "suggested": ["a"]},
        ] * 6})
    ok = c.QuestionnaireOut.model_validate({"questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동",
         "options": [{"id": "a", "label": "접수"}, {"id": "b", "label": "검토"}], "suggested": ["a", "b"]},
    ] + [
        {"id": f"q{i}", "kind": "text", "maps_to": "conditions", "text": "?", "options": [], "suggested": "x"}
        for i in range(2, 7)
    ]})
    assert len(ok.questions) == 6


def test_question_suggested_must_reference_options() -> None:
    with pytest.raises(ValidationError):
        c.Question.model_validate({"id": "q", "kind": "multi", "maps_to": "systems", "text": "?",
                                   "options": [{"id": "a", "label": "A"}], "suggested": ["zzz"]})


def test_row_out_dump_matches_interview_row_keys() -> None:
    row = c.RowOut.model_validate({
        "l6": "접수", "ownerRole": "담당자", "department": "",
        "fields": {"start_condition": "요청 접수"},
        "actions": [{"seq": 1, "label": "접수"}, {"seq": 2, "label": "검토", "kind": "decision"}],
        "relations": {"edges": [{"src": 1, "dst": 2, "kind": "seq"}]},
    })
    dumped = row.model_dump(by_alias=True, exclude_none=True)
    assert set(dumped) <= {"l6", "owner", "ownerRole", "department", "fields", "actions", "relations"}
    assert dumped["actions"][1]["kind"] == "decision"
