"""승인 워크플로우 — 상태 상수, 편집가능 판정, 알림 생성 헬퍼 (design 2026-06-14)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, Notification

DRAFT = "draft"
PENDING = "pending"
APPROVED = "approved"
PUBLISHED = "published"
REJECTED = "rejected"
EXPIRED = "expired"  # terminal — 후속 게시로 대체된 published 버전

# 편집·체크아웃 가능한 상태 — 검토중/확정 버전은 읽기 전용
EDITABLE_STATUSES = frozenset({DRAFT, REJECTED})


def is_editable_status(status: str) -> bool:
    """이 상태의 버전을 편집/체크아웃할 수 있는지."""
    return status in EDITABLE_STATUSES


async def get_display_name(session: AsyncSession, login_id: str) -> str:
    """login_id → 표시 이름(Employee.name). 미등록·빈 이름이면 login_id 그대로.

    알림 메시지 등에 아이디 대신 사람 이름을 노출하기 위한 조회.
    """
    emp = await session.get(Employee, login_id)
    return emp.name if emp is not None and emp.name else login_id


def create_notifications(
    session: AsyncSession,
    recipients: list[str],
    *,
    type: str,
    map_id: int | None = None,
    version_id: int | None = None,
    message: str,
) -> None:
    """수신자별 알림 행을 세션에 추가한다 — commit은 호출자 책임.

    map_id/version_id는 선택 — 맵/버전과 무관한 알림(공지 등)은 생략.
    """
    for recipient in recipients:
        session.add(
            Notification(
                recipient=recipient,
                type=type,
                map_id=map_id,
                version_id=version_id,
                message=message,
            )
        )
