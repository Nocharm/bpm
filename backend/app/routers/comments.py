"""노드 코멘트 — 작성/조회/해결 토글/삭제 (spec §7 Phase C).

코멘트는 체크아웃과 무관하게 누구나 작성 가능 (읽기 전용 사용자의 피드백 통로).
삭제는 작성자 본인만.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import Comment, MapVersion, Node
from app.schemas import CommentCreate, CommentOut, CommentUpdate

router = APIRouter(
    prefix="/api", tags=["comments"], dependencies=[Depends(get_current_user)]
)


async def _get_version_or_404(session: AsyncSession, version_id: int) -> MapVersion:
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")
    return version


async def _get_comment_or_404(session: AsyncSession, comment_id: int) -> Comment:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail=f"comment {comment_id} not found")
    return comment


@router.get("/versions/{version_id}/comments", response_model=list[CommentOut])
async def list_comments(
    version_id: int,
    session: AsyncSession = Depends(get_session),
) -> list[Comment]:
    await _get_version_or_404(session, version_id)
    rows = await session.scalars(
        select(Comment)
        .where(Comment.version_id == version_id)
        .order_by(Comment.created_at, Comment.id)
    )
    return list(rows.all())


@router.post(
    "/versions/{version_id}/comments", response_model=CommentOut, status_code=201
)
async def create_comment(
    version_id: int,
    payload: CommentCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Comment:
    await _get_version_or_404(session, version_id)
    node = await session.get(Node, payload.node_id)
    if node is None or node.version_id != version_id:
        raise HTTPException(
            status_code=404, detail=f"node {payload.node_id} not in version"
        )
    comment = Comment(
        version_id=version_id, node_id=payload.node_id, author=user, body=payload.body
    )
    session.add(comment)
    await session.commit()
    await session.refresh(comment)
    return comment


@router.patch("/comments/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: int,
    payload: CommentUpdate,
    session: AsyncSession = Depends(get_session),
) -> Comment:
    comment = await _get_comment_or_404(session, comment_id)
    comment.resolved = payload.resolved
    await session.commit()
    await session.refresh(comment)
    return comment


@router.delete("/comments/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    comment = await _get_comment_or_404(session, comment_id)
    if comment.author != user:
        raise HTTPException(status_code=403, detail="only the author can delete")
    await session.delete(comment)
    await session.commit()
