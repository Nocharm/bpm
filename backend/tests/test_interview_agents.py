"""에이전트 출력 계약 파싱 + 프롬프트 빌더의 구조 검증(AI 호출 없음)."""

import json

from app.interview.agents import (
    CHOICE_VARIANT_HINTS,
    InterviewerOut,
    build_drafter_messages,
    build_interviewer_messages,
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


def test_drafter_contract_owns_naming_standard() -> None:
    """톤 검수 폐지 — 명명 표준이 드래프터 계약에 통합돼 있다 (speed redesign §3)."""
    messages = build_drafter_messages(
        stage_key="activities", lang="ko", facts={}, working_graph=None,
        context_text="", variant_hint="표준",
    )
    assert "명사+동사" in messages[0]["content"]
    assert "'~하기' 동명사형" in messages[0]["content"]


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


def test_choice_variant_hints_cover_choice_stages() -> None:
    # draft는 word 모드 구조 스테이지 — draw(multi)가 word에서도 동작 (speed redesign)
    assert set(CHOICE_VARIANT_HINTS) == {"activities", "branches", "draft"}
    assert all(len(v) >= 2 for v in CHOICE_VARIANT_HINTS.values())


def test_format_section_catalog_filters_language() -> None:
    from app.interview.agents import format_section_catalog

    sections = [
        {"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1, "language": "ko"},
        {"anchor": "_Toc9", "title": "Inventory", "number": "1", "level": 1, "language": "en"},
    ]
    ko = format_section_catalog(sections, "ko")
    assert "_Toc1" in ko and "_Toc9" not in ko
    # 언어 미확정이면 전체 노출
    both = format_section_catalog(sections, None)
    assert "_Toc1" in both and "_Toc9" in both


def test_word_mode_prompts_carry_catalog_and_contract() -> None:
    from app.interview.agents import build_drafter_messages, build_interviewer_messages

    catalog = "- _Toc1 | 1 재고 (level 1)"
    iv = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "안녕", mode="word", section_catalog=catalog,
    )
    assert "_Toc1" in iv[0]["content"]
    assert "변환" in iv[0]["content"]  # word 인터뷰어 애든덤

    dr = build_drafter_messages("draft", "ko", {}, None, "", "힌트", mode="word", section_catalog=catalog)
    assert "_Toc1" in dr[0]["content"]
    assert "section_anchor" in dr[0]["content"]  # word 드래프터 계약


def test_normal_mode_prompts_unchanged() -> None:
    from app.interview.agents import build_drafter_messages, build_interviewer_messages

    dr = build_drafter_messages("activities", "ko", {}, None, "", "힌트")
    assert "section_anchor" not in dr[0]["content"]
    # 카탈로그 삽입이 일반 모드의 블록 사이 개행을 갉아먹지 않는지 고정
    assert "[참고 문서]\n(없음)\n\n[확정 facts]" in dr[0]["content"]

    iv = build_interviewer_messages(
        stage_key="scope", lang="ko", facts={}, graph_summary="", context_text="",
        history=[], user_input="안녕",
    )
    assert "[참고 문서]\n(없음)\n\n[현재 스테이지]" in iv[0]["content"]


def test_ai_node_attributes_accepts_section_anchor() -> None:
    from app.schemas import AiNodeAttributes

    attr = AiNodeAttributes(section_anchor="_Toc1")
    assert attr.section_anchor == "_Toc1"


def test_ai_proposal_accepts_section_node_type() -> None:
    """word 드래프터의 section 노드가 파싱을 통과한다 — AI_NODE_TYPES 게이트 (design 2026-07-26 §4)."""
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate({
        "kind": "graph",
        "message": "",
        "nodes": [
            {"key": "s", "title": "시작", "node_type": "start"},
            {"key": "a", "title": "1 재고", "node_type": "section",
             "attributes": {"section_anchor": "_Toc1"}},
            {"key": "e", "title": "끝", "node_type": "end"},
        ],
        "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "e"}],
        "groups": [],
    })
    assert proposal.nodes[1].node_type == "section"
