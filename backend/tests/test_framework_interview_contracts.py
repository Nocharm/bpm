"""캠페인 프롬프트 빌더·응답 모델 — 카탈로그 블록 삽입·오버라이드 적용·스키마 검증."""

import pytest
from pydantic import ValidationError

from app.framework_interview import contracts as c

EXISTING_ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action", "name": "요청서 내용 확인", "rule": "양식 A",
         "input": ["요청서", "첨부"], "output": ["접수증"], "system": "ERP"},
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
    # input/output은 list[str](0.5 배열 계약) — join된 텍스트만 있고 파이썬 리스트 표기(대괄호·따옴표)가 새면 안 된다
    assert "1. 요청 확인 (action) · 요청서 내용 확인 · 규칙: 양식 A · 입력: 요청서, 첨부 · 출력: 접수증 · 시스템: ERP" in text
    assert "[" not in text and "'" not in text
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


def test_question_section_defaults_and_prompt_mentions_kind_rules() -> None:
    q = c.Question(id="q1", kind="text", maps_to="conditions", text="t", suggested="s")
    assert q.section == "basic"
    assert "single" in c.L6_QUESTIONNAIRE_CONTRACT and "section" in c.L6_QUESTIONNAIRE_CONTRACT


def test_feedback_builders_carry_the_user_message_and_honour_overrides() -> None:
    """두 피드백 프롬프트 모두 현재 상태 + [사용자 피드백] 블록을 싣는다 — 모델이 무엇을 고칠지 알 수 있게."""
    canvas = {"nodes": [{"id": "x-01", "node_type": "subprocess", "title": "접수", "task_id": "x-01"}], "edges": []}
    canvas_msgs = c.build_canvas_feedback_messages(
        lang="ko", canvas=canvas, tasks=[("x-01", "접수")], message="B를 먼저",
        overrides={"l5_canvas_feedback_contract": "OVERRIDE"},
    )
    assert canvas_msgs[0]["content"].startswith("OVERRIDE")
    assert "[L6 카드]\n- x-01: 접수" in canvas_msgs[-1]["content"]
    assert '"task_id": "x-01"' in canvas_msgs[-1]["content"]
    assert canvas_msgs[-1]["content"].endswith("[사용자 피드백]\nB를 먼저")

    row_msgs = c.build_row_feedback_messages(
        lang="ko", row=EXISTING_ROW, message="이름 고쳐",
        overrides={"l6_row_feedback_contract": "OVERRIDE"},
    )
    assert row_msgs[0]["content"].startswith("OVERRIDE")
    assert "[현재 행]" in row_msgs[-1]["content"] and "요청 확인" in row_msgs[-1]["content"]
    assert row_msgs[-1]["content"].endswith("[사용자 피드백]\n이름 고쳐")


def test_registry_exposes_the_feedback_contracts() -> None:
    """관리자 오버라이드 화면이 두 계약을 편집할 수 있어야 한다."""
    from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults

    defaults = get_prompt_defaults()
    for key in ("l5_canvas_feedback_contract", "l6_row_feedback_contract"):
        assert key in PROMPT_KEYS
        assert defaults[key]


def test_questionnaire_contract_targets_ambiguity_and_asks_for_why() -> None:
    # 설문의 초점은 값 채우기가 아니라 절차의 애매한 지점 확정(사용자 결정 2026-09-24) — 문항마다 why 근거
    text = c.L6_QUESTIONNAIRE_CONTRACT
    assert "애매한 지점" in text and "why" in text
    assert "exceptions 3~5" in text
    assert "—" not in text  # AI 프롬프트에 긴 대시 금지
    assert c.Question(id="q1", kind="text", maps_to="conditions", text="t", suggested="s").why == ""
