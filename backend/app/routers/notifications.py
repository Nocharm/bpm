"""인앱 알림 — 본인 수신분 조회 / 읽음 처리 (design 2026-06-14)."""

from datetime import datetime, time

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import KST
from app.db import get_session
from app.models import Notification, ProcessMap
from app.schemas import NotificationBulkDeleteIn, NotificationBulkDeleteOut, NotificationOut

router = APIRouter(
    prefix="/api/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)


async def _flag_maps_in_trash(session: AsyncSession, rows: list[Notification]) -> None:
    """응답 표시용 `map_in_trash`(컬럼 아님)를 채운다 — 가리키는 맵이 휴지통이면 True, 복구하면 다음 조회부터 풀린다."""
    map_ids = {row.map_id for row in rows if row.map_id is not None}
    trashed: set[int] = set()
    if map_ids:
        found = await session.scalars(
            select(ProcessMap.id).where(ProcessMap.id.in_(map_ids), ProcessMap.deleted_at.is_not(None))
        )
        trashed = set(found.all())
    for row in rows:
        row.map_in_trash = row.map_id in trashed


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
    rows = list((await session.scalars(query)).all())
    await _flag_maps_in_trash(session, rows)
    return rows


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
    await _flag_maps_in_trash(session, [notif])  # 읽음 응답이 목록 줄을 갈아 끼우므로 표시도 같이 싣는다
    return notif


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """개별 삭제 — 본인 수신분만(타인 것은 존재 노출 없이 404, mark_read와 동일 패턴)."""
    notif = await session.get(Notification, notification_id)
    if notif is None or notif.recipient != user:
        raise HTTPException(
            status_code=404, detail=f"notification {notification_id} not found"
        )
    await session.delete(notif)
    await session.commit()


@router.post("/bulk-delete", response_model=NotificationBulkDeleteOut)
async def bulk_delete_notifications(
    payload: NotificationBulkDeleteIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """조건별 일괄 삭제 — 항상 본인 수신분만. ids는 본인 소유와의 교집합만 삭제."""
    stmt = delete(Notification).where(Notification.recipient == user)
    if payload.ids is not None:
        stmt = stmt.where(Notification.id.in_(payload.ids))
    elif payload.read_only:
        stmt = stmt.where(Notification.read.is_(True))
    else:  # before — 해당 날짜 00:00 KST 미만
        cutoff = datetime.combine(payload.before, time.min, tzinfo=KST)
        stmt = stmt.where(Notification.created_at < cutoff)
    result = await session.execute(stmt)
    await session.commit()
    return NotificationBulkDeleteOut(deleted=max(result.rowcount, 0))
