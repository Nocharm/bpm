"""지식기반 인덱싱 — 소스별 청킹→임베딩→kb_chunks 교체, 동시 1개 직렬 워커 (design 2026-07-23 §7).

요청 경로에서는 spawn()으로 fire-and-forget — 임베딩 지연이 응답을 막지 않는다.
모든 인덱서는 자체 세션을 열고 실패를 내부에서 로깅으로 종결한다(그레이스풀).
"""

import asyncio
import logging

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.kb import chunking, embed_client, retrieval
from app.models import Edge, InterviewAttachment, KbChunk, KbDocument, MapVersion, Node, ProcessMap

logger = logging.getLogger(__name__)

# 직렬 워커 — 인덱싱이 몰려도 임베딩 서버·DB 쓰기는 한 번에 하나 (design §7 백그라운드 직렬화).
# 세마포어는 첫 경합 루프에 바인딩되므로 루프별 캐시(ai_client 패턴).
_semaphores: dict[asyncio.AbstractEventLoop, asyncio.Semaphore] = {}


def _get_semaphore() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    semaphore = _semaphores.get(loop)
    if semaphore is None:
        for stale in [known for known in _semaphores if known.is_closed()]:
            del _semaphores[stale]
        semaphore = asyncio.Semaphore(1)
        _semaphores[loop] = semaphore
    return semaphore


# 실행 중 태스크 강참조 — asyncio는 태스크를 약참조만 해 GC로 조용히 사라질 수 있다 (hardening T17)
_tasks: set[asyncio.Task] = set()


def spawn(coro) -> None:
    """fire-and-forget 실행 — 강참조 보관 + 예외 소비(로깅은 인덱서 내부에서 이미 완료)."""
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _tasks.discard(t)
        _ = t.cancelled() or t.exception()

    task.add_done_callback(_done)


async def _replace_chunks(
    session, source_type: str, source_id: int, texts: list[str], meta: dict
) -> None:
    """소스의 기존 청크 전체 교체 — 재인덱싱 멱등. 커밋 후 검색 캐시 무효화."""
    vectors = await embed_client.embed_texts(texts)
    await session.execute(
        delete(KbChunk).where(
            KbChunk.source_type == source_type, KbChunk.source_id == source_id
        )
    )
    for i, (text, vector) in enumerate(zip(texts, vectors)):
        session.add(KbChunk(
            source_type=source_type, source_id=source_id, chunk_index=i,
            chunk_text=text, embedding=retrieval.pack_embedding(vector), meta=meta,
        ))
    await session.commit()
    retrieval.invalidate_cache()


async def index_library_doc(doc_id: int) -> None:
    """sysadmin 라이브러리 문서 인덱싱 — parsed 상태만."""
    if not embed_client.is_embed_enabled():
        return
    async with _get_semaphore():
        try:
            async with SessionLocal() as session:
                doc = await session.get(KbDocument, doc_id)
                if doc is None or doc.status != "parsed" or not doc.parsed_text.strip():
                    return
                texts = chunking.chunk_text(doc.parsed_text)
                await _replace_chunks(session, "library", doc_id, texts, {"title": doc.title})
        except embed_client.EmbedError as exc:
            logger.warning("kb index library %d skipped: %s", doc_id, exc)
        except Exception:  # noqa: BLE001 -- 백그라운드 실패는 서비스에 무해해야 한다
            logger.exception("kb index library %d failed", doc_id)


def serialize_map_text(map_name: str, description: str, nodes: list, edges: list) -> str:
    """게시본 → 검색용 텍스트 — 이름·설명·노드 라벨/설명·흐름 요약 (design §7 맵 코퍼스)."""
    titles = {n.id: n.title for n in nodes}
    lines = [f"프로세스 맵: {map_name}"]
    if description.strip():
        lines.append(description.strip())
    node_lines = [
        f"- {n.node_type}: {n.title}" + (f" - {n.description.strip()}" if n.description.strip() else "")
        for n in nodes
        if n.node_type != "note" and n.title
    ]
    flow_lines = [
        f"{titles.get(e.source_node_id, '?')} → {titles.get(e.target_node_id, '?')}"
        + (f" ({e.label})" if e.label else "")
        for e in edges
    ]
    parts = ["\n".join(lines)]
    if node_lines:
        parts.append("활동:\n" + "\n".join(node_lines))
    if flow_lines:
        parts.append("흐름:\n" + "\n".join(flow_lines))
    return "\n\n".join(parts)


async def index_map_version(version_id: int) -> None:
    """게시본 인덱싱 — 맵 단위 교체(source_id=map_id, 재게시 시 이전 게시본 청크 대체)."""
    if not embed_client.is_embed_enabled():
        return
    async with _get_semaphore():
        try:
            async with SessionLocal() as session:
                version = await session.get(MapVersion, version_id)
                if version is None:
                    return
                found_map = await session.get(ProcessMap, version.map_id)
                if found_map is None or found_map.deleted_at is not None:
                    return
                nodes = list(await session.scalars(
                    select(Node).where(Node.version_id == version_id).order_by(Node.sort_order)
                ))
                edges = list(await session.scalars(
                    select(Edge).where(Edge.version_id == version_id)
                ))
                text = serialize_map_text(found_map.name, found_map.description or "", nodes, edges)
                texts = chunking.chunk_text(text)
                meta = {"map_id": found_map.id, "map_name": found_map.name, "version_id": version_id}
                await _replace_chunks(session, "map", found_map.id, texts, meta)
        except embed_client.EmbedError as exc:
            logger.warning("kb index map version %d skipped: %s", version_id, exc)
        except Exception:  # noqa: BLE001
            logger.exception("kb index map version %d failed", version_id)


async def index_attachment(attachment_id: int) -> None:
    """세션 첨부 인덱싱 — 해당 인터뷰 세션 검색에만 쓰이도록 meta.session_id 스코프."""
    if not embed_client.is_embed_enabled():
        return
    async with _get_semaphore():
        try:
            async with SessionLocal() as session:
                row = await session.get(InterviewAttachment, attachment_id)
                if row is None or row.status != "parsed" or not row.parsed_text.strip():
                    return
                texts = chunking.chunk_text(row.parsed_text)
                meta = {"session_id": row.session_id, "filename": row.filename}
                await _replace_chunks(session, "attachment", attachment_id, texts, meta)
        except embed_client.EmbedError as exc:
            logger.warning("kb index attachment %d skipped: %s", attachment_id, exc)
        except Exception:  # noqa: BLE001
            logger.exception("kb index attachment %d failed", attachment_id)
