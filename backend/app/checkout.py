"""버전 체크아웃 잠금 헬퍼 — TTL 기반 활성 판정 (spec §7 Phase C)."""

from datetime import datetime, timedelta, timezone

from app.models import MapVersion
from app.settings import settings


def _as_utc(value: datetime) -> datetime:
    # sqlite는 naive, postgres는 aware로 반환 — 비교 전에 UTC로 통일
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def is_checkout_active(version: MapVersion, now: datetime) -> bool:
    """체크아웃이 잡혀 있고 TTL이 지나지 않았는지."""
    if version.checked_out_by is None or version.checked_out_at is None:
        return False
    ttl = timedelta(minutes=settings.checkout_ttl_minutes)
    return now - _as_utc(version.checked_out_at) < ttl


def is_locked_by_other(version: MapVersion, user: str, now: datetime) -> bool:
    """다른 사용자가 유효한 체크아웃을 쥐고 있는지 — 저장 차단 판정."""
    return is_checkout_active(version, now) and version.checked_out_by != user
