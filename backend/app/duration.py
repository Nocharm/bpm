"""duration H.MM 표기 정규화 — 프론트 lib/duration.ts와 동치 (설계 2026-07-11 §2.2)."""
import re

DURATION_RE = re.compile(r"^\d+(\.\d{1,2})?$")
NUMERIC_RE = re.compile(r"^\d+(\.\d+)?$")


def normalize_duration(raw: str) -> str | None:
    """유효하면 정규형("2"·"1.15"), 무효면 None. 빈 문자열은 ""."""
    text = raw.strip()
    if text == "":
        return ""
    if not DURATION_RE.fullmatch(text):
        return None
    int_part, _, frac_part = text.partition(".")
    hours = int(int_part)
    # 1자리 소수부는 10분 단위 — "0.3" = 30분
    minutes = int(frac_part.ljust(2, "0")) if frac_part else 0
    hours += minutes // 60
    minutes %= 60
    return str(hours) if minutes == 0 else f"{hours}.{minutes:02d}"
