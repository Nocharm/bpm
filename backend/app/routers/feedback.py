"""사용자 피드백 — 등록 / 목록(집계) / 부분수정(권한별) / 삭제 (design 2026-07-05).

권한 규칙:
- status 변경: sysadmin (→done 시 done_at 스탬프, done 이탈 시 해제)
- reply 작성/수정: sysadmin, 단 status가 done이면 잠금
- body 수정: 작성자 본인, 단 status가 draft일 때만
- 삭제: 작성자 본인, 단 status가 draft일 때만
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now
from app.db import get_session
from app.models import Feedback
from app.permissions.logic import is_sysadmin
from app.schemas import (
    FeedbackCounts,
    FeedbackCreate,
    FeedbackListOut,
    FeedbackOut,
    FeedbackUpdate,
)

router = APIRouter(
    prefix="/api/feedback",
    tags=["feedback"],
    dependencies=[Depends(get_current_user)],
)


@router.post("", response_model=FeedbackOut, status_code=201)
async def create_feedback(
    payload: FeedbackCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Feedback:
    feedback = Feedback(
        kind=payload.kind,
        body=payload.body,
        author=user,
        context=payload.context,
    )
    session.add(feedback)
    await session.commit()
    await session.refresh(feedback)
    return feedback


@router.get("", response_model=FeedbackListOut)
async def list_feedback(
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackListOut:
    rows = await session.scalars(
        select(Feedback).order_by(Feedback.created_at.desc(), Feedback.id.desc())
    )
    records = list(rows.all())
    counts = FeedbackCounts(
        total=len(records),
        mine=sum(1 for f in records if f.author == user),
        in_progress=sum(1 for f in records if f.status == "in_progress"),
        done=sum(1 for f in records if f.status == "done"),
    )
    return FeedbackListOut(
        items=[FeedbackOut.model_validate(f) for f in records],
        counts=counts,
    )


@router.patch("/{feedback_id}", response_model=FeedbackOut)
async def update_feedback(
    feedback_id: int,
    payload: FeedbackUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Feedback:
    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(
            status_code=404, detail=f"feedback {feedback_id} not found"
        )

    if payload.status is not None:
        if not is_sysadmin(user):
            raise HTTPException(status_code=403, detail="system admin only")
        if payload.status == "done" and feedback.status != "done":
            feedback.done_at = now()
        elif payload.status != "done":
            feedback.done_at = None
        feedback.status = payload.status

    if payload.reply is not None:
        if not is_sysadmin(user):
            raise HTTPException(status_code=403, detail="system admin only")
        if feedback.status == "done":
            raise HTTPException(status_code=400, detail="feedback is done (locked)")
        feedback.reply = payload.reply
        feedback.reply_at = now()

    if payload.body is not None:
        if feedback.author != user:
            raise HTTPException(status_code=403, detail="author only")
        if feedback.status != "draft":
            raise HTTPException(status_code=400, detail="body editable only in draft")
        feedback.body = payload.body
        feedback.body_edited_at = now()

    await session.commit()
    await session.refresh(feedback)
    return feedback


@router.delete("/{feedback_id}", status_code=204)
async def delete_feedback(
    feedback_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(
            status_code=404, detail=f"feedback {feedback_id} not found"
        )
    if feedback.author != user or feedback.status != "draft":
        raise HTTPException(
            status_code=403, detail="only the author can delete a draft"
        )
    await session.delete(feedback)
    await session.commit()
