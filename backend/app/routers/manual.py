"""사용 매뉴얼 API — 다중 문서 CRUD(F10) + 레거시 단일 게시본 GET/PUT(S8, manual.md fallback)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.manual import extract_title, get_manual
from app.models import ManualDoc
from app.schemas import (
    ManualDocCreate,
    ManualDocDetailOut,
    ManualDocListOut,
    ManualDocPatch,
    ManualOut,
    ManualUpdate,
)

router = APIRouter(prefix="/api", tags=["manual"], dependencies=[Depends(get_current_user)])

# 레거시 단일 게시본 — id=1 upsert (다중 문서 도입 후에도 기존 API 유지)
_DOC_ID = 1


def _with_title(doc: ManualDoc) -> ManualDoc:
    """레거시 행(title 미추출) 대비 — 비어 있으면 읽기 시점에 본문에서 추출(영속 안 함)."""
    if not doc.title:
        doc.title = extract_title(doc.format, doc.content)
    return doc


@router.get("/manual/docs", response_model=list[ManualDocListOut])
async def list_manual_docs(
    language: str | None = Query(None, pattern="^(ko|en)$"),
    session: AsyncSession = Depends(get_session),
) -> list[ManualDoc]:
    """문서 목록(내용 제외) — 업로드 순(sort_order, id). language 지정 시 해당 언어만 (F10)."""
    query = select(ManualDoc).order_by(ManualDoc.sort_order, ManualDoc.id)
    if language is not None:
        query = query.where(ManualDoc.language == language)
    rows = (await session.scalars(query)).all()
    return [_with_title(row) for row in rows]


@router.get("/manual/docs/{doc_id}", response_model=ManualDocDetailOut)
async def get_manual_doc_detail(
    doc_id: int, session: AsyncSession = Depends(get_session)
) -> ManualDoc:
    doc = await session.get(ManualDoc, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"manual doc {doc_id} not found")
    return _with_title(doc)


@router.post(
    "/manual/docs",
    response_model=ManualDocDetailOut,
    dependencies=[Depends(require_sysadmin)],
)
async def create_manual_doc(
    payload: ManualDocCreate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManualDoc:
    """문서 추가(sysadmin) — 제목은 본문에서 자동 추출, 정렬은 업로드 순번 (F10)."""
    next_order = (await session.scalar(select(func.max(ManualDoc.sort_order)))) or 0
    doc = ManualDoc(
        title=extract_title(payload.format, payload.content),
        language=payload.language,
        format=payload.format,
        content=payload.content,
        sort_order=next_order + 1,
        updated_by=user,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


@router.put(
    "/manual/docs/{doc_id}",
    response_model=ManualDocDetailOut,
    dependencies=[Depends(require_sysadmin)],
)
async def update_manual_doc(
    doc_id: int,
    payload: ManualDocPatch,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> ManualDoc:
    """문서 수정(sysadmin) — 보낸 필드만 반영, 내용/포맷 변경 시 제목 재추출 (F10)."""
    doc = await session.get(ManualDoc, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"manual doc {doc_id} not found")
    if payload.language is not None:
        doc.language = payload.language
    if payload.format is not None:
        doc.format = payload.format
    if payload.content is not None:
        doc.content = payload.content
    if payload.content is not None or payload.format is not None:
        doc.title = extract_title(doc.format, doc.content)
    doc.updated_by = user
    await session.commit()
    await session.refresh(doc)
    return doc


@router.delete(
    "/manual/docs/{doc_id}", status_code=204, dependencies=[Depends(require_sysadmin)]
)
async def delete_manual_doc(
    doc_id: int, session: AsyncSession = Depends(get_session)
) -> None:
    doc = await session.get(ManualDoc, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"manual doc {doc_id} not found")
    await session.delete(doc)
    await session.commit()


@router.get("/manual", response_model=ManualOut)
async def get_manual_doc(
    bundled: bool = Query(False),
    session: AsyncSession = Depends(get_session),
) -> ManualOut | dict:
    """게시본 조회 — DB 행이 있으면 그대로, 없으면 manual.md 파일 fallback(updated_at=None).

    bundled=true면 DB 게시본을 무시하고 배포 포함 manual.md 원문을 반환한다
    (편집기의 '배포본 불러오기' — 게시본을 배포 기본값으로 되돌릴 때).
    """
    if not bundled:
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
