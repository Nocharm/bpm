"""에이전트 출력 계약 파싱 + 프롬프트 빌더의 구조 검증(AI 호출 없음)."""

import json

from app.interview.agents import (
    CHOICE_VARIANT_HINTS,
    InterviewerOut,
    ToneReviewOut,
    build_drafter_messages,
    build_interviewer_messages,
    build_tone_messages,
    extract_json,
)


def test_extract_json_strips_fences() -> None:
    raw = '설명입니다\n```json\n{"message": "안녕"}\n```'
    assert json.loads(extract_json(raw)) == {"message": "안녕"}


def test_interviewer_out_defaults() -> None:
    out = InterviewerOut.model_validate_json('{"message": "이름이 뭔가요?"}')
    assert out.facts_patch == {}
    assert out.stage_complete is False
    assert out.needs_choices is False


def test_tone_review_out_parses_renames() -> None:
    out = ToneReviewOut.model_validate_json(
        '{"message": "정리", "renames": [{"key": "n1", "title": "요청 접수"}]}'
    )
    assert out.renames[0].key == "n1"


def test_interviewer_messages_structure() -> None:
    messages = build_interviewer_messages(
        stage_key="scope", lang="ko", facts={}, graph_summary="(빈 캔버스)",
        context_text="[sop.docx]\n구매 절차…", history=[{"role": "user", "content": "안녕"}],
        user_input="구매 프로세스요",
    )
    assert messages[0]["role"] == "system"
    assert "scope" in messages[0]["content"] or "범위" in messages[0]["content"]
    assert "[sop.docx]" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "구매 프로세스요"}


def test_interviewer_messages_english_when_en() -> None:
    messages = build_interviewer_messages(
        stage_key="scope", lang="en", facts={}, graph_summary="", context_text="",
        history=[], user_input="hi",
    )
    assert "English" in messages[0]["content"]


def test_drafter_messages_contain_variant_hint() -> None:
    messages = build_drafter_messages(
        stage_key="activities", lang="ko", facts={"scope": {"process_name": "구매"}},
        working_graph=None, context_text="", variant_hint=CHOICE_VARIANT_HINTS["activities"][0],
    )
    assert CHOICE_VARIANT_HINTS["activities"][0] in messages[0]["content"]
    # 드래프터는 AiProposal graph JSON을 요구
    assert '"kind"' in messages[0]["content"]


def test_tone_messages_embed_graph() -> None:
    graph = {"nodes": [{"key": "a", "title": "start", "node_type": "start"}], "edges": [], "groups": []}
    messages = build_tone_messages("ko", graph)
    assert "start" in messages[0]["content"]


def test_choice_variant_hints_cover_choice_stages() -> None:
    assert set(CHOICE_VARIANT_HINTS) == {"activities", "branches"}
    assert all(len(v) >= 3 for v in CHOICE_VARIANT_HINTS.values())
