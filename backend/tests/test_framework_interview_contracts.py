"""캠페인 프롬프트 빌더·응답 모델 — 카탈로그 블록 삽입·오버라이드 적용·스키마 검증."""

import pytest
from pydantic import ValidationError

from app.framework_interview import contracts as c


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
