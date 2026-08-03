"""텍스트 청킹 — ~500자, 오버랩 80자, 문단 경계 우선 (design 2026-07-23 §7)."""

CHUNK_SIZE = 500  # 자 단위 — bge-m3 입력 예산과 검색 정밀도의 절충
CHUNK_OVERLAP = 80  # 장문단 슬라이딩 분할 시 인접 청크 겹침


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """문단(빈 줄) 단위로 그리디 패킹, size 초과 문단만 오버랩 슬라이딩 분할."""
    paragraphs = [p.strip() for p in (text or "").split("\n\n") if p.strip()]
    chunks: list[str] = []
    buffer = ""
    for para in paragraphs:
        candidate = f"{buffer}\n\n{para}" if buffer else para
        if len(candidate) <= size:
            buffer = candidate
            continue
        if buffer:
            chunks.append(buffer)
            buffer = ""
        if len(para) <= size:
            buffer = para
            continue
        step = max(1, size - overlap)
        for start in range(0, len(para), step):
            piece = para[start : start + size]
            if piece.strip():
                chunks.append(piece)
            if start + size >= len(para):
                break
    if buffer:
        chunks.append(buffer)
    return chunks
