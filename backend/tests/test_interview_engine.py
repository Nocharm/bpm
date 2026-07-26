"""스테이지 엔진 — 전이·완료 판정·적응 스킵의 순수 로직."""

import pytest

from app.interview import engine


def test_stage_order_fixed() -> None:
    assert [s.key for s in engine.STAGES] == [
        "scope", "io", "activities", "branches", "roles", "params", "review",
    ]


def test_next_stage_key() -> None:
    assert engine.next_stage_key("scope") == "io"
    assert engine.next_stage_key("review") is None


def test_get_stage_unknown_raises() -> None:
    with pytest.raises(ValueError):
        engine.get_stage("banana")


def test_is_stage_complete_requires_all_facts() -> None:
    facts = {"scope": {"process_name": "구매 요청", "purpose": "표준화", "boundaries": ""}}
    assert engine.is_stage_complete("scope", facts) is False
    facts["scope"]["boundaries"] = "요청 접수부터 발주까지"
    assert engine.is_stage_complete("scope", facts) is True


def test_first_incomplete_stage_skips_prefilled() -> None:
    facts = {
        "scope": {"process_name": "구매", "purpose": "p", "boundaries": "b"},
        "io": {"trigger": "t", "inputs": "i", "outputs": "o"},
    }
    assert engine.first_incomplete_stage(facts) == "activities"
    assert engine.first_incomplete_stage({}) == "scope"


def test_choice_stages() -> None:
    assert engine.get_stage("activities").choice_stage is True
    assert engine.get_stage("branches").choice_stage is True
    assert engine.get_stage("scope").choice_stage is False
