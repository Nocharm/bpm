"""사용 매뉴얼 게시본 API — GET(DB 우선·manual.md fallback) / PUT(sysadmin upsert) (S8)."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.manual import get_manual
from app.models import ManualDoc
from app.schemas import ManualOut, ManualUpdate

router = APIRouter(prefix="/api", tags=["manual"], dependencies=[Depends(get_current_user)])

# 매뉴얼은 단일 게시본 — id=1 upsert
_DOC_ID = 1


@router.get("/manual", response_model=ManualOut)
async def get_manual_doc(session: AsyncSession = Depends(get_session)) -> ManualOut | dict:
    """게시본 조회 — DB 행이 있으면 그대로, 없으면 manual.md 파일 fallback(updated_at=None)."""
    doc = await session.get(ManualDoc, _DOC_ID)
    if doc is not None:
        return doc
    return {"format": "markdown", "content": get_manual(), "updated_at": None, "updated_by": None}


@router.put("/manual", response_model=ManualOut, dependencies=[Depends(require_sysadmin)])
async def put_manual_doc(
    payload: ManualUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManualDoc:
    """게시본 저장(sysadmin) — 단일 행 upsert."""
    doc = await session.get(ManualDoc, _DOC_ID)
    if doc is None:
        doc = ManualDoc(
            id=_DOC_ID, format=payload.format, content=payload.content, updated_by=user
        )
        session.add(doc)
    else:
        doc.format = payload.format
        doc.content = payload.content
        doc.updated_by = user
    await session.commit()
    await session.refresh(doc)
    return doc
