"""AI 채팅 — 순서도 생성/편집 제안 + 사용법 안내 (design 2026-06-15)."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import ai_client, workflow
from app.ai_prompt import build_messages
from app.auth import get_current_user
from app.checkout import is_checkout_active
from app.db import get_session
from app.manual import get_manual
from app.models import MapVersion
from app.routers.graph import _load_graph
from app.schemas import AiChatRequest, AiModelsOut, AiProposal
from app.settings import settings

router = APIRouter(prefix="/api", tags=["ai"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

_NOT_EDITABLE_MSG = "이 버전은 편집할 수 없어 그래프를 적용할 수 없습니다. 도움말만 가능합니다."


def _extract_json(text: str) -> str:
    """모델이 ```json 펜스나 앞뒤 설명을 붙여도 본문 JSON 오브젝트만 추출 — 첫 '{' ~ 마지막 '}'."""
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


async def _ask_and_validate(messages: list[dict], model: str | None) -> AiProposal:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502."""
    for attempt in range(2):
        try:
            content = await ai_client.call_ai(messages, model)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            # exc는 내부 GPU 주소를 담을 수 있어 클라이언트엔 노출 금지 — 서버 로그에만 기록
            logger.warning("AI server call failed: %s", exc)
            raise HTTPException(status_code=502, detail="AI server error") from exc
        try:
            return AiProposal.model_validate_json(_extract_json(content))
        except ValueError as exc:
            # 원본 출력(모델 텍스트, 비밀 아님)을 서버 로그에만 기록 — 502 원인 진단용. 클라이언트엔 일반 메시지만.
            logger.warning("AI response invalid (attempt %d): %s | raw=%.800s", attempt, exc, content)
            if attempt == 0:
                messages = [*messages, {"role": "user", "content": "유효한 JSON 한 개만 반환하세요."}]
                continue
            raise HTTPException(status_code=502, detail="AI returned invalid response") from None
    raise HTTPException(status_code=502, detail="AI returned invalid response")


@router.post("/versions/{version_id}/ai/chat", response_model=AiProposal)
async def ai_chat(
    version_id: int,
    payload: AiChatRequest,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiProposal:
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    now = datetime.now(timezone.utc)
    can_edit = (
        workflow.is_editable_status(version.status)
        and is_checkout_active(version, now)
        and version.checked_out_by == user
    )
    current = await _load_graph(session, version_id)
    messages = build_messages(
        get_manual(), current, can_edit, payload.instruction, payload.history
    )

    proposal = await _ask_and_validate(messages, payload.model)
    # 편집 불가인데 그래프를 제안하면 적용 불가 — answer로 다운그레이드 (실제 적용 가드는 saveGraph가 최종 enforce)
    if proposal.kind == "graph" and not can_edit:
        return AiProposal(kind="answer", message=_NOT_EDITABLE_MSG)
    return proposal


@router.get("/ai/models", response_model=AiModelsOut)
async def ai_models() -> AiModelsOut:
    """서빙 중인 모델 목록 — 프론트 모델 선택용. 조회 실패 시 기본 모델로 폴백."""
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")
    try:
        models = await ai_client.list_models()
    except Exception as exc:  # noqa: BLE001 -- 목록 조회 실패는 기본 모델로 폴백
        logger.warning("AI models list failed: %s", exc)
        models = []
    if not models and settings.ai_model:
        models = [settings.ai_model]
    return AiModelsOut(models=models)
