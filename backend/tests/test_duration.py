"""duration H.MM 정규화 — 프론트 lib/duration.ts와 케이스 동치."""
import pytest

from app.duration import normalize_duration


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("", ""), (" 2 ", "2"), ("2", "2"), ("1.15", "1.15"),
        ("0.3", "0.30"), ("0.03", "0.03"), ("0.60", "1"), ("0.75", "1.15"),
        ("2.99", "3.39"), ("2.00", "2"),
    ],
)
def test_normalize_valid(raw: str, expected: str) -> None:
    assert normalize_duration(raw) == expected


@pytest.mark.parametrize("raw", ["2일", "-1", "1.234", ".", "1.2.3"])
def test_normalize_invalid(raw: str) -> None:
    assert normalize_duration(raw) is None
