"""앱 공통 시계 — 시간대 없는 DB 시각과 다른 시간대의 시각을 KST로 맞추는 헬퍼."""

from datetime import datetime, timedelta, timezone

from app.clock import KST, convert_to_kst


def test_convert_to_kst_treats_naive_time_as_kst_wall_clock() -> None:
    naive = datetime(2026, 11, 4, 9, 30)  # sqlite가 시간대를 떼고 돌려준 KST 벽시계

    assert convert_to_kst(naive) == datetime(2026, 11, 4, 9, 30, tzinfo=KST)


def test_convert_to_kst_converts_aware_time_to_the_same_instant() -> None:
    utc = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)  # postgres가 접속 시간대로 돌려준 시각

    converted = convert_to_kst(utc)

    assert converted == utc and converted.utcoffset() == timedelta(hours=9)
    assert converted.hour == 2 and converted.day == 4
