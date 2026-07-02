"""버전 체크아웃 잠금 헬퍼 — 지정 인계 전용 sticky 점유 (spec §7 Phase C, 2026-07 개정).

점유는 시간 경과로 자동 해제되지 않는다(자동해제 없음). `checked_out_by` 가 곧 보유자이며,
이전(transfer)·요청 승인(decide)·sysadmin 강제 인수(force)로만 바뀐다. `now` 인자는
호출부 호환을 위해 남겨두되 더 이상 TTL 판정에 쓰지 않는다.
"""

from datetime import datetime

from app.models import MapVersion


def is_checkout_active(version: MapVersion, now: datetime | None = None) -> bool:
    """점유가 지정돼 있는지 — 보유자가 있으면 활성(시간 만료 없음)."""
    return version.checked_out_by is not None


def is_locked_by_other(
    version: MapVersion, user: str, now: datetime | None = None
) -> bool:
    """다른 사용자가 점유 중인지 — 저장/삭제 차단 판정."""
    return version.checked_out_by is not None and version.checked_out_by != user
