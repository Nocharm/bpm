"""지식기반 라이브러리 관리 — sysadmin 전용 문서 업로드/목록/삭제 (design 2026-07-23 §7 P2).

파싱은 인터뷰 첨부와 동일 계약(5종 확장자·20MB) 재사용. 인덱싱은 fire-and-forget 직렬 워커.
"""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_sysadmin
from app.db import get_session
from app.interview.parsing import (
    ALLOWED_EXTENSIONS,
    MAX_ATTACHMENT_BYTES,
    ParseError,
    parse_attachment,
)
from app.kb import embed_client, indexing, retrieval
from app.models import KbChunk, KbDocument
from app.schemas import KbDocumentOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/kb", tags=["kb"])


async def _chunk_counts(session: AsyncSession) -> dict[int, int]:
    rows = await session.execute(
        select(KbChunk.source_id, func.count())
        .where(KbChunk.source_type == "library")
        .group_by(KbChunk.source_id)
    )
    return dict(rows.all())


@router.get("/documents", response_model=list[KbDocumentOut])
async def list_documents(
    user: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> list[KbDocumentOut]:
    docs = (
        await session.scalars(select(KbDocument).order_by(KbDocument.id.desc()))
    ).all()
    counts = await _chunk_counts(session)
    return [
        KbDocumentOut.model_validate(d).model_copy(
            update={"chunk_count": counts.get(d.id, 0)}
        )
        for d in docs
    ]


@router.post("/documents", response_model=KbDocumentOut, status_code=201)
async def upload_document(
    file: UploadFile,
    user: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> KbDocumentOut:
    filename = file.filename or "document"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"unsupported file type: {ext or filename}")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="file too large (max 20MB)")

    doc = KbDocument(
        title=filename.rsplit(".", 1)[0],
        filename=filename,
        mime=file.content_type or "",
        uploaded_by=user,
    )
    try:
        doc.parsed_text = await asyncio.to_thread(parse_attachment, filename, data)
        doc.status = "parsed"
    except ParseError as exc:
        doc.status = "failed"
        logger.warning("kb document parse failed (%s): %s", filename, exc)
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    if doc.status == "parsed" and embed_client.is_embed_enabled():
        indexing.spawn(indexing.index_library_doc(doc.id))
    return KbDocumentOut.model_validate(doc)


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: int,
    user: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> None:
    doc = await session.get(KbDocument, doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"document {doc_id} not found")
    await session.delete(doc)
    await session.execute(
        sa_delete(KbChunk).where(
            KbChunk.source_type == "library", KbChunk.source_id == doc_id
        )
    )
    await session.commit()
    retrieval.invalidate_cache()
