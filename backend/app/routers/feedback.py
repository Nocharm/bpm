"""사용자 피드백 — 등록 / 목록(집계) / 부분수정(권한별) / 삭제 (design 2026-07-05).

권한 규칙:
- status 변경: sysadmin (→done 시 done_at 스탬프, done 이탈 시 해제)
- reply 작성/수정: sysadmin, 단 status가 done이면 잠금
- body 수정: 작성자 본인, 단 status가 draft일 때만
- 삭제: 작성자 본인, 단 status가 draft일 때만
- 노트: 작성/열람은 전원, 수정은 작성자(직전 본문을 이력으로 보존), 삭제는 아카이브만
  (영구 삭제는 관리자 DB 테이블 퍼지 — routers/admin.py)
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now
from app.db import get_session
from app.models import Feedback, FeedbackNote, FeedbackNoteRevision
from app.permissions.logic import is_sysadmin
from app.schemas import (
    FeedbackCounts,
    FeedbackCreate,
    FeedbackListOut,
    FeedbackNoteCreate,
    FeedbackNoteOut,
    FeedbackNoteRevisionOut,
    FeedbackNoteUpdate,
    FeedbackNotifyIn,
    FeedbackOut,
    FeedbackUpdate,
)
from app.workflow import create_notifications

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
        # 알림은 자동 발송하지 않는다 — 관리자가 저장 후 "알림 보내기" 버튼으로 명시 발송 (2026-08-19)
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
    note_ids = list(
        await session.scalars(
            select(FeedbackNote.id).where(FeedbackNote.feedback_id == feedback_id)
        )
    )
    if note_ids:
        # sqlite는 FK CASCADE가 기본 비활성 — 고아 행이 남지 않게 앱 계층에서 먼저 지운다
        await session.execute(
            delete(FeedbackNoteRevision).where(FeedbackNoteRevision.note_id.in_(note_ids))
        )
        await session.execute(delete(FeedbackNote).where(FeedbackNote.id.in_(note_ids)))
    await session.delete(feedback)
    await session.commit()


async def _get_feedback(session: AsyncSession, feedback_id: int) -> Feedback:
    feedback = await session.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail=f"feedback {feedback_id} not found")
    return feedback


async def _get_note(session: AsyncSession, feedback_id: int, note_id: int) -> FeedbackNote:
    note = await session.get(FeedbackNote, note_id)
    if note is None or note.feedback_id != feedback_id:
        raise HTTPException(status_code=404, detail=f"note {note_id} not found")
    return note


@router.get("/{feedback_id}/notes", response_model=list[FeedbackNoteOut])
async def list_feedback_notes(
    feedback_id: int,
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
) -> list[FeedbackNote]:
    await _get_feedback(session, feedback_id)
    stmt = select(FeedbackNote).where(FeedbackNote.feedback_id == feedback_id)
    if not include_archived:
        stmt = stmt.where(FeedbackNote.archived_at.is_(None))
    rows = await session.scalars(stmt.order_by(FeedbackNote.created_at, FeedbackNote.id))
    return list(rows)


@router.post("/{feedback_id}/notes", response_model=FeedbackNoteOut, status_code=201)
async def create_feedback_note(
    feedback_id: int,
    payload: FeedbackNoteCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackNote:
    """노트는 누구나 자유롭게 — 상태·작성자 제한 없음(피드백 진행 메모/로그)."""
    await _get_feedback(session, feedback_id)
    note = FeedbackNote(feedback_id=feedback_id, author=user, body=payload.body)
    session.add(note)
    await session.commit()
    await session.refresh(note)
    return note


# 알림 문구용 상태 라벨 — 역할/상태 표기는 영어 고정(spec ⑨)
_STATUS_LABELS = {"draft": "Draft", "in_progress": "In progress", "done": "Done"}


@router.post("/{feedback_id}/notify", response_model=FeedbackOut)
async def notify_feedback_author(
    feedback_id: int,
    payload: FeedbackNotifyIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Feedback:
    """작성자에게 답글/상태변경 알림을 명시 발송 — 관리자 전용.

    상태변경 알림은 피드백당 1회만(재발송 차단), 답글 알림은 재발송 허용(답글을 고쳐 다시 알릴 수 있음).
    """
    if not is_sysadmin(user):
        raise HTTPException(status_code=403, detail="system admin only")
    feedback = await _get_feedback(session, feedback_id)
    if feedback.author == user:
        raise HTTPException(status_code=400, detail="cannot notify yourself")

    body_line = " ".join(feedback.body.split())
    snippet = body_line[:40] + ("…" if len(body_line) > 40 else "")
    if payload.kind == "reply":
        if not feedback.reply.strip():
            raise HTTPException(status_code=400, detail="no reply to notify about")
        message = f'Your feedback received a reply - "{snippet}"'
        notif_payload = {"snippet": snippet, "kind": payload.kind}
        feedback.reply_notified_at = now()
    else:
        if feedback.status_notified_at is not None:
            raise HTTPException(status_code=400, detail="status change already notified")
        label = _STATUS_LABELS.get(feedback.status, feedback.status)
        message = f'Your feedback status changed to {label} - "{snippet}"'
        notif_payload = {"snippet": snippet, "kind": payload.kind, "status_label": label}
        feedback.status_notified_at = now()

    await create_notifications(
        session,
        [feedback.author],
        type=f"feedback_{payload.kind}",
        message=message,
        payload=notif_payload,
    )
    await session.commit()
    await session.refresh(feedback)
    return feedback


@router.patch("/{feedback_id}/notes/{note_id}", response_model=FeedbackNoteOut)
async def update_feedback_note(
    feedback_id: int,
    note_id: int,
    payload: FeedbackNoteUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackNote:
    """노트 수정 — 작성자 본인만. 직전 본문은 이력으로 남긴다(수정해도 원문 보존)."""
    note = await _get_note(session, feedback_id, note_id)
    if note.author != user:
        raise HTTPException(status_code=403, detail="author only")
    if note.archived_at is not None:
        raise HTTPException(status_code=400, detail="note is archived")
    if payload.body != note.body:
        session.add(FeedbackNoteRevision(note_id=note.id, body=note.body))
        note.body = payload.body
        note.edited_at = now()
    await session.commit()
    await session.refresh(note)
    return note


@router.post("/{feedback_id}/notes/{note_id}/archive", response_model=FeedbackNoteOut)
async def archive_feedback_note(
    feedback_id: int,
    note_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> FeedbackNote:
    """노트 삭제 = 아카이브(영구삭제 아님) — 작성자 또는 관리자."""
    note = await _get_note(session, feedback_id, note_id)
    if note.author != user and not is_sysadmin(user):
        raise HTTPException(status_code=403, detail="author or system admin only")
    if note.archived_at is None:
        note.archived_at = now()
        await session.commit()
        await session.refresh(note)
    return note


@router.get(
    "/{feedback_id}/notes/{note_id}/revisions", response_model=list[FeedbackNoteRevisionOut]
)
async def list_feedback_note_revisions(
    feedback_id: int,
    note_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[FeedbackNoteRevision]:
    """수정 이력 — 오래된 스냅샷부터. 현재 본문은 노트 자체가 들고 있다."""
    await _get_note(session, feedback_id, note_id)
    rows = await session.scalars(
        select(FeedbackNoteRevision)
        .where(FeedbackNoteRevision.note_id == note_id)
        .order_by(FeedbackNoteRevision.created_at, FeedbackNoteRevision.id)
    )
    return list(rows)
