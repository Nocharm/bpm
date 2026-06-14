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
from app.routers.graph import _load_scope
from app.schemas import AiChatRequest, AiProposal
from app.settings import settings

router = APIRouter(prefix="/api", tags=["ai"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

_NOT_EDITABLE_MSG = "이 버전은 편집할 수 없어 그래프를 적용할 수 없습니다. 도움말만 가능합니다."


async def _ask_and_validate(messages: list[dict]) -> AiProposal:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502."""
    for attempt in range(2):
        try:
            content = await ai_client.call_ai(messages)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            # exc는 내부 GPU 주소를 담을 수 있어 클라이언트엔 노출 금지 — 서버 로그에만 기록
            logger.warning("AI server call failed: %s", exc)
            raise HTTPException(status_code=502, detail="AI server error") from exc
        try:
            return AiProposal.model_validate_json(content)
        except ValueError:
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
    current = await _load_scope(session, version_id, payload.parent)
    messages = build_messages(
        get_manual(), current, can_edit, payload.instruction, payload.history
    )

    proposal = await _ask_and_validate(messages)
    # 편집 불가인데 그래프를 제안하면 적용 불가 — answer로 다운그레이드 (실제 적용 가드는 saveGraph가 최종 enforce)
    if proposal.kind == "graph" and not can_edit:
        return AiProposal(kind="answer", message=_NOT_EDITABLE_MSG)
    return proposal
