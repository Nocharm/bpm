"""지식기반 검색 — 인메모리 numpy 코사인 top-k + 임계값, 삽입/삭제 시 캐시 무효화 (design 2026-07-23 §7)."""

import logging
from dataclasses import dataclass

import numpy as np
from sqlalchemy import select

from app.kb import embed_client
from app.models import KbChunk
from app.settings import settings

logger = logging.getLogger(__name__)

TOP_K = 5  # 기본 반환 수 — 프롬프트 예산과의 절충
MIN_SIMILARITY = 0.5  # 코사인 임계값 — 미달 청크는 잡음으로 간주해 제외


@dataclass(frozen=True)
class KbHit:
    """검색 결과 1건 — 출처 표기는 meta(title/map_name 등)에서."""

    source_type: str
    source_id: int
    chunk_text: str
    score: float
    meta: dict


def pack_embedding(vector: list[float]) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def unpack_embedding(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)


# 전 청크 임베딩 캐시(수천 규모 전제) — (단위정규화 행렬, 행 메타). 삽입/삭제 시 invalidate_cache().
_cache: tuple[np.ndarray, list[KbChunk]] | None = None


def invalidate_cache() -> None:
    global _cache
    _cache = None


async def _load_cache(session) -> tuple[np.ndarray, list[KbChunk]]:
    global _cache
    if _cache is not None:
        return _cache
    result = await session.execute(select(KbChunk))
    rows = list(result.scalars().all())
    if not rows:
        _cache = (np.zeros((0, settings.embed_dim), dtype=np.float32), [])
        return _cache
    matrix = np.stack([unpack_embedding(r.embedding) for r in rows]).astype(np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    matrix = matrix / np.maximum(norms, 1e-12)  # 단위정규화 — 내적 = 코사인
    _cache = (matrix, rows)
    return _cache


async def search(
    session, query: str, top_k: int = TOP_K, session_id: int | None = None
) -> list[KbHit]:
    """쿼리 임베딩 → 코사인 top-k(임계값 이상). attachment 소스는 해당 세션 것만 포함.

    임베딩 비활성이면 빈 결과, 서버 오류는 EmbedError 전파 — 호출측이 디그레이드 처리.
    """
    if not embed_client.is_embed_enabled() or not query.strip():
        return []
    matrix, rows = await _load_cache(session)
    if not rows:
        return []
    qvec = np.asarray((await embed_client.embed_texts([query]))[0], dtype=np.float32)
    qvec = qvec / max(float(np.linalg.norm(qvec)), 1e-12)
    scores = matrix @ qvec
    allowed = np.array([
        r.source_type != "attachment" or (r.meta or {}).get("session_id") == session_id
        for r in rows
    ])
    scores = np.where(allowed, scores, -1.0)
    order = [int(i) for i in np.argsort(scores)[::-1][: max(top_k, 0)]]
    return [
        KbHit(
            source_type=rows[i].source_type,
            source_id=rows[i].source_id,
            chunk_text=rows[i].chunk_text,
            score=float(scores[i]),
            meta=rows[i].meta or {},
        )
        for i in order
        if scores[i] >= MIN_SIMILARITY
    ]
