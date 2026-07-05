"""인앱 알림 — 본인 수신분 조회 / 읽음 처리 (design 2026-06-14)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Notification
from app.schemas import NotificationOut

router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[NotificationOut])
async def list_notifications(
    unread_only: bool = False,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[Notification]:
    query = select(Notification).where(Notification.recipient == user)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    query = query.order_by(Notification.created_at.desc(), Notification.id.desc())
    rows = await session.scalars(query)
    return list(rows.all())


@router.post("/read-all", status_code=204)
async def mark_all_read(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await session.execute(
        update(Notification)
        .where(Notification.recipient == user, Notification.read.is_(False))
        .values(read=True)
    )
    await session.commit()


@router.post("/{notification_id}/read", response_model=NotificationOut)
async def mark_read(
    notification_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Notification:
    notif = await session.get(Notification, notification_id)
    if notif is None or notif.recipient != user:
        raise HTTPException(
            status_code=404, detail=f"notification {notification_id} not found"
        )
    notif.read = True
    await session.commit()
    await session.refresh(notif)
    return notif
