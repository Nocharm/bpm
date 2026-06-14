"""온프레미스 AI(OpenAI 호환) 호출 어댑터 — 교체 가능 경계. 비OpenAI 서버면 이 파일만 수정 (design 2026-06-15)."""

import httpx2

from app.settings import settings


async def call_ai(messages: list[dict]) -> str:
    """OpenAI 호환 /chat/completions 호출 → 첫 choice의 message.content 반환.

    네트워크/HTTP 오류는 예외로 전파(라우터가 502로 변환). 토큰은 로그에 남기지 않는다.
    """
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {settings.ai_api_token}"}
    async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"]
