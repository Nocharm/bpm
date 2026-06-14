"""사용법 매뉴얼 로더 — app/manual.md를 1회 읽어 캐시 (design 2026-06-15)."""

from functools import lru_cache
from pathlib import Path

_MANUAL_PATH = Path(__file__).parent / "manual.md"


@lru_cache(maxsize=1)
def get_manual() -> str:
    """매뉴얼 마크다운 전문. 파일 없으면 빈 문자열."""
    try:
        return _MANUAL_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""
