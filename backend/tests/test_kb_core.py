"""KB 코어 — embed 클라이언트(배치·에러 정규화)·청킹·코사인 검색(스코프·캐시) (design 2026-07-23 §7)."""

import asyncio

import pytest

from app.kb import chunking, embed_client, retrieval
from app.settings import settings


# ---------- embed_client ----------


class _FakeResponse:
    def __init__(self, payload: dict, status: int = 200) -> None:
        self._payload = payload
        self.status_code = status

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return self._payload


class _FakeClient:
    """httpx2.AsyncClient 대역 — 호출 페이로드 기록 + 스크립트 응답 반환."""

    calls: list[dict] = []
    responses: list[_FakeResponse] = []

    def __init__(self, timeout=None) -> None:
        self.timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def post(self, url, json=None, headers=None) -> _FakeResponse:
        _FakeClient.calls.append({"url": url, "json": json, "headers": headers})
        return _FakeClient.responses.pop(0)


def _embed_payload(count: int) -> dict:
    # index 역순으로 반환 — 클라이언트가 index 기준 재정렬하는지 검증
    return {
        "data": [
            {"index": i, "embedding": [float(i)] * settings.embed_dim}
            for i in reversed(range(count))
        ]
    }


@pytest.fixture()
def embed_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")
    monkeypatch.setattr(embed_client.httpx2, "AsyncClient", _FakeClient)
    _FakeClient.calls = []
    _FakeClient.responses = []
    yield


def test_embed_disabled_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", False)
    with pytest.raises(embed_client.EmbedError):
        asyncio.run(embed_client.embed_texts(["x"]))
    assert asyncio.run(embed_client.embed_texts([])) == []  # 빈 입력은 비활성이어도 빈 결과


def test_embed_batches_and_orders_by_index(embed_env) -> None:
    texts = [f"t{i}" for i in range(embed_client.EMBED_BATCH_SIZE + 3)]
    _FakeClient.responses = [
        _FakeResponse(_embed_payload(embed_client.EMBED_BATCH_SIZE)),
        _FakeResponse(_embed_payload(3)),
    ]
    vectors = asyncio.run(embed_client.embed_texts(texts))
    assert len(_FakeClient.calls) == 2  # 32 + 3 분할
    assert len(_FakeClient.calls[0]["json"]["input"]) == embed_client.EMBED_BATCH_SIZE
    assert _FakeClient.calls[0]["headers"] is None  # 인증 없음 — 사내 임베딩 서버 계약
    assert _FakeClient.calls[0]["url"].endswith("/v1/embeddings")
    assert len(vectors) == len(texts)
    assert vectors[0][0] == 0.0  # index 재정렬 — 역순 응답이어도 입력 순서 보존


def test_embed_url_accepts_full_embeddings_path(embed_env, monkeypatch: pytest.MonkeyPatch) -> None:
    """EMBED_URL이 /embeddings 전체 경로여도 그대로 사용 — 타 서비스 .env 값 복사 호환."""
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1/embeddings")
    _FakeClient.responses = [_FakeResponse(_embed_payload(1))]
    asyncio.run(embed_client.embed_texts(["a"]))
    assert _FakeClient.calls[-1]["url"] == "http://embed:8000/v1/embeddings"


def test_embed_count_mismatch_raises(embed_env) -> None:
    _FakeClient.responses = [_FakeResponse(_embed_payload(1))]
    with pytest.raises(embed_client.EmbedError, match="mismatch"):
        asyncio.run(embed_client.embed_texts(["a", "b"]))


def test_embed_retries_once_then_raises(embed_env) -> None:
    _FakeClient.responses = [
        _FakeResponse({}, status=500),
        _FakeResponse({}, status=500),
    ]
    with pytest.raises(embed_client.EmbedError):
        asyncio.run(embed_client.embed_texts(["a"]))
    assert len(_FakeClient.calls) == 2  # 1회 재시도 후 포기


# ---------- chunking ----------


def test_chunk_packs_paragraphs_to_size() -> None:
    text = "\n\n".join(["가" * 200, "나" * 200, "다" * 200])
    chunks = chunking.chunk_text(text, size=500, overlap=80)
    assert len(chunks) == 2  # 200+200(+구분자)까지 1청크, 셋째는 넘쳐 새 청크
    assert chunks[0].startswith("가") and "나" in chunks[0]
    assert chunks[1] == "다" * 200


def test_chunk_long_paragraph_slides_with_overlap() -> None:
    text = "라" * 1000
    chunks = chunking.chunk_text(text, size=500, overlap=80)
    assert len(chunks) == 3  # step 420: 0-500, 420-920, 840-1000
    assert chunks[0][-80:] == chunks[1][:80]  # 오버랩 구간 일치


def test_chunk_short_and_empty() -> None:
    assert chunking.chunk_text("짧은 문서") == ["짧은 문서"]
    assert chunking.chunk_text("") == []
    assert chunking.chunk_text("\n\n  \n\n") == []


# ---------- retrieval ----------


def _unit(direction: int) -> list[float]:
    """direction번째 축의 단위벡터 — 코사인이 0/1로 딱 떨어져 순위 검증이 쉬움."""
    v = [0.0] * settings.embed_dim
    v[direction] = 1.0
    return v


def _mix(a: int, b: int, wa: float, wb: float) -> list[float]:
    v = [0.0] * settings.embed_dim
    v[a], v[b] = wa, wb
    return v


def _seed_chunks(client) -> None:
    from app.db import SessionLocal
    from app.models import KbChunk

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add_all([
                KbChunk(source_type="library", source_id=1, chunk_index=0,
                        chunk_text="구매 표준 절차", embedding=retrieval.pack_embedding(_unit(0)),
                        meta={"title": "구매 SOP"}),
                KbChunk(source_type="map", source_id=7, chunk_index=0,
                        chunk_text="발주 프로세스 맵", embedding=retrieval.pack_embedding(_mix(0, 1, 0.8, 0.6)),
                        meta={"map_name": "발주"}),
                KbChunk(source_type="attachment", source_id=11, chunk_index=0,
                        chunk_text="세션 첨부 발췌", embedding=retrieval.pack_embedding(_unit(0)),
                        meta={"session_id": 42}),
                KbChunk(source_type="library", source_id=2, chunk_index=0,
                        chunk_text="무관 문서", embedding=retrieval.pack_embedding(_unit(2)),
                        meta={"title": "무관"}),
            ])
            await session.commit()

    asyncio.run(_run())
    retrieval.invalidate_cache()


def test_search_ranks_filters_and_scopes(client, monkeypatch: pytest.MonkeyPatch) -> None:
    _seed_chunks(client)
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [_unit(0) for _ in texts]

    monkeypatch.setattr(embed_client, "embed_texts", fake_embed)
    from app.db import SessionLocal

    async def _search(session_id):
        async with SessionLocal() as session:
            return await retrieval.search(session, "구매 절차", session_id=session_id)

    hits = asyncio.run(_search(42))
    texts = [h.chunk_text for h in hits]
    assert texts[0] in {"구매 표준 절차", "세션 첨부 발췌"}  # 코사인 1.0 동점 2건
    assert "무관 문서" not in texts  # 임계값(0.5) 미달 컷
    assert "세션 첨부 발췌" in texts  # 내 세션 첨부는 포함

    other = asyncio.run(_search(99))
    assert "세션 첨부 발췌" not in [h.chunk_text for h in other]  # 다른 세션 첨부 제외
    assert all(h.score >= retrieval.MIN_SIMILARITY for h in other)


def test_search_disabled_returns_empty(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", False)
    from app.db import SessionLocal

    async def _run():
        async with SessionLocal() as session:
            return await retrieval.search(session, "아무거나")

    assert asyncio.run(_run()) == []


def test_cache_invalidation_picks_up_new_chunks(client, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [_unit(5) for _ in texts]

    monkeypatch.setattr(embed_client, "embed_texts", fake_embed)
    from app.db import SessionLocal
    from app.models import KbChunk

    async def _search():
        async with SessionLocal() as session:
            return await retrieval.search(session, "새 문서")

    before = asyncio.run(_search())
    assert all(h.chunk_text != "캐시 갱신 문서" for h in before)

    async def _insert() -> None:
        async with SessionLocal() as session:
            session.add(KbChunk(source_type="library", source_id=3, chunk_index=0,
                                chunk_text="캐시 갱신 문서",
                                embedding=retrieval.pack_embedding(_unit(5)),
                                meta={"title": "신규"}))
            await session.commit()

    asyncio.run(_insert())
    stale = asyncio.run(_search())
    assert all(h.chunk_text != "캐시 갱신 문서" for h in stale)  # 무효화 전엔 캐시가 못 본다
    retrieval.invalidate_cache()
    fresh = asyncio.run(_search())
    assert any(h.chunk_text == "캐시 갱신 문서" for h in fresh)


def test_pack_unpack_roundtrip() -> None:
    vec = [0.25] * settings.embed_dim
    blob = retrieval.pack_embedding(vec)
    assert len(blob) == settings.embed_dim * 4  # float32
    restored = retrieval.unpack_embedding(blob)
    assert restored.shape == (settings.embed_dim,)
    assert float(restored[0]) == 0.25


def test_is_embed_enabled_requires_both_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    """KB 활성 = AI 활성 AND 임베딩 주소 존재 — 한쪽만으론 no-op (P1 동작 불변 가드)."""
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "")
    assert not embed_client.is_embed_enabled()
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")
    assert embed_client.is_embed_enabled()
    monkeypatch.setattr(settings, "ai_enabled", False)
    assert not embed_client.is_embed_enabled()


def test_search_dimension_mismatch_raises_embed_error(client, monkeypatch: pytest.MonkeyPatch) -> None:
    """차원 불일치(모델 교체 후 미재색인)는 EmbedError로 정규화 — 호출측 디그레이드 계약 유지,
    턴/draw 500 방지 (hardening T2). 캐시 적재(혼합 차원)·질의 내적(쿼리 차원) 두 경로 공통."""
    from sqlalchemy import delete as sa_delete

    from app.db import SessionLocal
    from app.models import KbChunk

    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "embed_url", "http://embed:8000/v1")

    async def _seed_bad() -> None:
        async with SessionLocal() as session:
            session.add(KbChunk(
                source_type="library", source_id=901, chunk_index=0,
                chunk_text="옛 모델 청크",
                embedding=retrieval.pack_embedding([1.0] * (settings.embed_dim // 2)),
                meta={"title": "old"},
            ))
            await session.commit()

    asyncio.run(_seed_bad())
    retrieval.invalidate_cache()

    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [_unit(0) for _ in texts]

    monkeypatch.setattr(embed_client, "embed_texts", fake_embed)
    from app.db import SessionLocal as _SL

    async def _search():
        async with _SL() as session:
            return await retrieval.search(session, "구매")

    try:
        with pytest.raises(embed_client.EmbedError):
            asyncio.run(_search())
    finally:
        async def _cleanup() -> None:
            async with SessionLocal() as session:
                await session.execute(sa_delete(KbChunk).where(KbChunk.source_id == 901))
                await session.commit()

        asyncio.run(_cleanup())
        retrieval.invalidate_cache()  # 오염 청크 잔존 시 이후 전 테스트가 EmbedError로 깨진다
