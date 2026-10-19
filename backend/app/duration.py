"""duration H.MM 표기 정규화 — 프론트 lib/duration.ts와 동치 (설계 2026-07-11 §2.2)."""
import re
import unicodedata

# 숫자는 ASCII만 — 파이썬 \d는 유니코드 숫자(전각·아랍 숫자)까지 받아 프론트(JS \d=ASCII)와 판정이 갈렸다 (리뷰 F-9)
DURATION_RE = re.compile(r"^[0-9]+(\.[0-9]{1,2})?$")
NUMERIC_RE = re.compile(r"^[0-9]+(\.[0-9]+)?$")
# JS String.prototype.trim이 지우는 문자 — 파이썬 strip()은 BOM은 남기고 \x1c~\x1f는 지워 양쪽이 달랐다
_JS_TRIM_CHARS = (
    "\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


def _clean_number_text(raw: str) -> str:
    """NFKC(전각 숫자·마침표 → ASCII) 후 JS trim과 같은 문자만 다듬는다 — 프론트 cleanNumberText와 동치."""
    return unicodedata.normalize("NFKC", raw).strip(_JS_TRIM_CHARS)


def normalize_numeric_param(raw: str) -> str:
    """일반 십진 파라미터(cost·headcount·annual_count·fte) — 유효하면 다듬은 값, 무효면 "" (프론트 normalizeNumericParam)."""
    text = _clean_number_text(raw)
    return text if text == "" or NUMERIC_RE.fullmatch(text) else ""


def normalize_duration(raw: str) -> str | None:
    """유효하면 정규형("2"·"1.15"), 무효면 None. 빈 문자열은 ""."""
    text = _clean_number_text(raw)
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
