"""앱 공통 시계 — 모든 타임스탬프 기준시는 KST(UTC+9). DB 컬럼 기본값·라우터 공용."""

from datetime import datetime, timedelta, timezone

# 한국 표준시 — 타임스탬프 기준시(요청: KST 고정). tz-aware로 저장해 비교는 절대시각 기준 정확.
KST = timezone(timedelta(hours=9))


def now() -> datetime:
    """현재 시각(KST, tz-aware)."""
    return datetime.now(KST)


def convert_to_kst(stamp: datetime) -> datetime:
    """시각을 KST로 맞춘다 — sqlite는 시간대 없이 KST 벽시계로, postgres는 접속 시간대로 돌려주므로 날짜 계산 전에 쓴다."""
    return stamp.astimezone(KST) if stamp.tzinfo else stamp.replace(tzinfo=KST)
