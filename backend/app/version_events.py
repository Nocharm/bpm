"""버전 생애주기 이벤트 적재 — git-log 타임라인의 단일 기록 진입점."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import VersionEvent


def record_version_event(
    session: AsyncSession,
    version_id: int,
    event_type: str,
    actor: str,
    note: str | None = None,
) -> None:
    """버전 이벤트 1건을 세션에 추가한다 (commit은 호출자 책임)."""
    session.add(
        VersionEvent(
            version_id=version_id,
            event_type=event_type,
            actor=actor,
            note=note,
        )
    )
