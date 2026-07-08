"""임베드 체크 — 미리보기 iframe이 열 수 있는 URL인지 서버가 헤더로 판정 (embed-check design 2026-07-08).

SSRF 노트: 인증 사용자 전용 + http(s) 스킴만 + 응답은 embeddable 불리언만 노출(본문·헤더 미반환).
사내 시스템 URL 판정이 이 기능의 목적이라 사설 대역 차단은 하지 않는다(내부 도구 전제).
"""

from fastapi import APIRouter, Depends, HTTPException, Query

from app import embed_probe
from app.auth import get_current_user
from app.schemas import EmbedCheckOut

router = APIRouter(
    prefix="/api", tags=["embed"], dependencies=[Depends(get_current_user)]
)


@router.get("/embed-check", response_model=EmbedCheckOut)
async def check_embeddable(
    url: str = Query(min_length=1, max_length=500),
) -> EmbedCheckOut:
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(
            status_code=422, detail="url must start with http:// or https://"
        )
    return EmbedCheckOut(embeddable=await embed_probe.probe_embeddable(url))
