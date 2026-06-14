"""온프레미스 AI(OpenAI 호환) 호출 어댑터 — 교체 가능 경계. 비OpenAI 서버면 이 파일만 수정 (design 2026-06-15)."""

import httpx2

from app.settings import settings


def _headers() -> dict:
    return {"Authorization": f"Bearer {settings.ai_api_token}"}


async def call_ai(messages: list[dict], model: str | None = None) -> str:
    """OpenAI 호환 /chat/completions 호출 → 첫 choice의 message.content 반환.

    model이 주어지면 그 모델로, 아니면 settings.ai_model 기본값으로 호출.
    네트워크/HTTP 오류는 예외로 전파(라우터가 502로 변환). 토큰은 로그에 남기지 않는다.
    """
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model or settings.ai_model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.post(url, json=payload, headers=_headers())
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"]


async def list_models() -> list[str]:
    """OpenAI 호환 /models 조회 → 서빙 중인 모델 id 목록. 실패 시 예외 전파."""
    url = f"{settings.ai_base_url.rstrip('/')}/models"
    async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.get(url, headers=_headers())
        response.raise_for_status()
        data = response.json()
    return [model["id"] for model in data.get("data", [])]
