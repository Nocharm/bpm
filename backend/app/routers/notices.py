"""공지사항 — 게시기간 유효분 열람 / 관리(sysadmin) CRUD + 전체 알림 (design 2026-07-05).

읽음 상태는 서버에 저장하지 않는다(클라이언트 localStorage 캐시).
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.clock import now
from app.db import get_session
from app.models import Employee, Notice
from app.schemas import NoticeCreate, NoticeOut, NoticeUpdate
from app.workflow import create_notifications

router = APIRouter(
    prefix="/api/notices",
    tags=["notices"],
    dependencies=[Depends(get_current_user)],
)


@router.get("", response_model=list[NoticeOut])
async def list_notices(
    session: AsyncSession = Depends(get_session),
) -> list[Notice]:
    current = now()
    rows = await session.scalars(
        select(Notice)
        .where(
            Notice.starts_at <= current,
            or_(Notice.ends_at.is_(None), Notice.ends_at >= current),
        )
        .order_by(Notice.starts_at.desc(), Notice.id.desc())
    )
    return list(rows.all())


@router.get(
    "/manage",
    response_model=list[NoticeOut],
    dependencies=[Depends(require_sysadmin)],
)
async def list_notices_manage(
    session: AsyncSession = Depends(get_session),
) -> list[Notice]:
    rows = await session.scalars(
        select(Notice).order_by(Notice.starts_at.desc(), Notice.id.desc())
    )
    return list(rows.all())


@router.get("/{notice_id}", response_model=NoticeOut)
async def get_notice(
    notice_id: int,
    session: AsyncSession = Depends(get_session),
) -> Notice:
    notice = await session.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail=f"notice {notice_id} not found")
    return notice


@router.post("", response_model=NoticeOut, status_code=201)
async def create_notice(
    payload: NoticeCreate,
    user: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> Notice:
    notice = Notice(
        title=payload.title,
        body_md=payload.body_md,
        importance=payload.importance,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        created_by=user,
    )
    session.add(notice)
    if payload.notify_all:
        recipients = list(
            await session.scalars(select(Employee.login_id).where(Employee.active))
        )
        create_notifications(session, recipients, type="notice", message=payload.title)
    await session.commit()
    await session.refresh(notice)
    return notice


@router.patch(
    "/{notice_id}",
    response_model=NoticeOut,
    dependencies=[Depends(require_sysadmin)],
)
async def update_notice(
    notice_id: int,
    payload: NoticeUpdate,
    session: AsyncSession = Depends(get_session),
) -> Notice:
    notice = await session.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail=f"notice {notice_id} not found")
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(notice, key, value)
    await session.commit()
    await session.refresh(notice)
    return notice


@router.delete(
    "/{notice_id}",
    status_code=204,
    dependencies=[Depends(require_sysadmin)],
)
async def delete_notice(
    notice_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    notice = await session.get(Notice, notice_id)
    if notice is None:
        raise HTTPException(status_code=404, detail=f"notice {notice_id} not found")
    await session.delete(notice)
    await session.commit()
