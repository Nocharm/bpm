"""AI 프롬프트 관리 — 레지스트리·오버라이드 API·빌더 반영 테스트."""

from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults


def test_prompt_defaults_cover_all_keys() -> None:
    defaults = get_prompt_defaults()
    assert set(defaults) == set(PROMPT_KEYS)
    assert len(PROMPT_KEYS) == 7
    # 전 항목이 비어있지 않은 실제 프롬프트 문자열
    assert all(isinstance(value, str) and value.strip() for value in defaults.values())
