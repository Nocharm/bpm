"""bge-m3 임베딩 클라이언트 — OpenAI 호환 /embeddings 호출(인증 없음), 배치 분할 (design 2026-07-23 §7)."""

import logging

import httpx2

from app.settings import settings

logger = logging.getLogger(__name__)

# 요청당 텍스트 상한 — 대형 문서도 임베딩 서버를 한 번에 누르지 않는다 (design §7 배치 호출)
EMBED_BATCH_SIZE = 32


class EmbedError(Exception):
    """임베딩 서버 호출/응답 실패 — 호출측은 검색 스킵 등 그레이스풀 디그레이드."""


def is_embed_enabled() -> bool:
    """KB 활성 판정 — AI 자체가 켜져 있고 임베딩 서버 주소가 있을 때만."""
    return settings.ai_enabled and bool(settings.embed_url)


def _embeddings_url() -> str:
    """EMBED_URL이 /v1 루트든 /embeddings 전체 경로든 수용 — 사내 타 서비스 값 그대로 복사 가능."""
    base = settings.embed_url.rstrip("/")
    return base if base.endswith("/embeddings") else base + "/embeddings"


async def embed_texts(texts: list[str], timeout: float | None = None) -> list[list[float]]:
    """텍스트 목록 → EMBED_DIM 차원 float 벡터 목록(입력 순서 보존). 비활성/실패는 EmbedError.

    timeout 미지정 시 인덱싱용 EMBED_TIMEOUT — 쿼리 경로는 짧은 상한을 넘겨 턴 블로킹을 막는다 (T17).
    """
    if not texts:
        return []
    if not is_embed_enabled():
        raise EmbedError("embedding is disabled")
    vectors: list[list[float]] = []
    for start in range(0, len(texts), EMBED_BATCH_SIZE):
        vectors.extend(await _embed_batch(texts[start : start + EMBED_BATCH_SIZE], timeout))
    return vectors


async def _embed_batch(batch: list[str], timeout: float | None = None) -> list[list[float]]:
    payload = {"model": settings.embed_model, "input": batch}
    last_error: Exception | None = None
    for attempt in range(2):  # 일시 오류 1회 재시도 후 포기
        try:
            async with httpx2.AsyncClient(
                timeout=timeout if timeout is not None else settings.embed_timeout_seconds
            ) as client:
                response = await client.post(_embeddings_url(), json=payload)
            response.raise_for_status()
            data = response.json().get("data", [])
            if len(data) != len(batch):
                raise EmbedError(f"embedding count mismatch: sent {len(batch)}, got {len(data)}")
            # index 기준 정렬 — 서버가 순서를 보장하지 않아도 입력 순서와 일치시킨다
            ordered = sorted(data, key=lambda item: item.get("index", 0))
            return [item["embedding"] for item in ordered]
        except EmbedError:
            raise
        except Exception as exc:  # noqa: BLE001 -- 외부 서버 오류는 EmbedError로 정규화
            last_error = exc
            logger.warning("embed call failed (attempt %d): %s", attempt, exc)
    raise EmbedError(f"embedding server error: {last_error}")
