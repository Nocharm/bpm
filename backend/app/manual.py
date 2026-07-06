"""사용법 매뉴얼 로더 — app/manual.md를 1회 읽어 캐시 (design 2026-06-15)."""

import re
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


def extract_title(fmt: str, content: str) -> str:
    """본문에서 목록 제목 자동 추출 — md 첫 헤딩(#) / html 첫 h태그, 없으면 첫 비어있지 않은 줄 (F10)."""
    if fmt == "html":
        heading = re.search(r"<h[1-6][^>]*>(.*?)</h[1-6]>", content, re.I | re.S)
        if heading:
            text = re.sub(r"<[^>]+>", "", heading.group(1)).strip()
            if text:
                return text[:200]
    else:
        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                text = stripped.lstrip("#").strip()
                if text:
                    return text[:200]
    for line in content.splitlines():
        stripped = line.strip()
        if stripped:
            return re.sub(r"<[^>]+>", "", stripped).strip()[:200] or "Untitled"
    return "Untitled"
