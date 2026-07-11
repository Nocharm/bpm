"""온프레미스 AI(OpenAI 호환) 호출 어댑터 — 교체 가능 경계. 비OpenAI 서버면 이 파일만 수정 (design 2026-06-15)."""

import json
import logging
from dataclasses import dataclass, field

import httpx2

from app.settings import settings

logger = logging.getLogger(__name__)

MODEL_SEP = "::"  # 다중 엔드포인트 모델 id 구분자 — "<엔드포인트명>::<모델id>"


@dataclass(frozen=True)
class AiReply:
    """chat/completions 1회 응답 — 본문 + usage(비표준 서버는 None)."""

    content: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


@dataclass(frozen=True)
class AiEndpoint:
    """OpenAI 호환 엔드포인트 1개 — models가 있으면 그 목록만 노출(/models 조회 생략)."""

    name: str
    base_url: str
    token: str = ""
    model: str = ""  # 기본 모델 — 선택자가 모델을 안 주면 사용
    models: tuple[str, ...] = field(default_factory=tuple)  # 노출 목록(비면 /models 자동 조회)


def get_ai_endpoints() -> list[AiEndpoint]:
    """AI_ENDPOINTS(JSON 배열) 파싱 — 비우면 기존 단일 설정(AI_BASE_URL 등)으로 폴백.

    잘못된 JSON/빈 배열은 ValueError — 설정 오류는 조용히 넘기지 않는다(라우터가 502 변환).
    """
    raw = settings.ai_endpoints.strip()
    if not raw:
        return [
            AiEndpoint(
                name="default",
                base_url=settings.ai_base_url,
                token=settings.ai_api_token,
                model=settings.ai_model,
            )
        ]
    try:
        items = json.loads(raw)
    except ValueError as exc:
        raise ValueError(f"AI_ENDPOINTS invalid JSON: {exc}") from exc
    if not isinstance(items, list) or not items:
        raise ValueError("AI_ENDPOINTS must be a non-empty JSON array")
    endpoints: list[AiEndpoint] = []
    for item in items:
        if not item.get("name") or not item.get("base_url"):
            raise ValueError("AI_ENDPOINTS entries require name and base_url")
        endpoints.append(
            AiEndpoint(
                name=str(item["name"]),
                base_url=str(item["base_url"]),
                token=str(item.get("token", "")),
                model=str(item.get("model", "")),
                models=tuple(str(m) for m in item.get("models", []) if str(m).strip()),
            )
        )
    return endpoints


def resolve_endpoint(model: str | None) -> tuple[AiEndpoint, str]:
    """모델 선택자("이름::모델" 또는 단일 모델명)를 (엔드포인트, 모델)로 해석.

    접두어가 없거나 이름이 안 맞으면 첫 엔드포인트 — 구형 프론트/저장값 하위호환.
    """
    endpoints = get_ai_endpoints()
    if model and MODEL_SEP in model:
        name, _, model_id = model.partition(MODEL_SEP)
        for endpoint in endpoints:
            if endpoint.name == name:
                return endpoint, model_id or endpoint.model
    first = endpoints[0]
    return first, (model or first.model)


def _headers(endpoint: AiEndpoint) -> dict:
    return {"Authorization": f"Bearer {endpoint.token}"}


async def call_ai(messages: list[dict], model: str | None = None) -> AiReply:
    """OpenAI 호환 /chat/completions 호출 → 첫 choice의 message.content + usage 반환.

    model 선택자로 엔드포인트 라우팅("이름::모델"), 없으면 첫 엔드포인트의 기본 모델.
    네트워크/HTTP 오류는 예외로 전파(라우터가 502로 변환). 토큰은 로그에 남기지 않는다.
    """
    endpoint, model_id = resolve_endpoint(model)
    url = f"{endpoint.base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": model_id,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.post(url, json=payload, headers=_headers(endpoint))
        response.raise_for_status()
        data = response.json()
    usage = data.get("usage") or {}
    return AiReply(
        content=data["choices"][0]["message"]["content"],
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )


async def _discover_models(endpoint: AiEndpoint) -> list[str]:
    """엔드포인트의 /models 조회 — 실패 시 기본 모델로 폴백(개별 실패가 전체를 막지 않게)."""
    try:
        url = f"{endpoint.base_url.rstrip('/')}/models"
        async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.get(url, headers=_headers(endpoint))
            response.raise_for_status()
            data = response.json()
        return [model["id"] for model in data.get("data", [])]
    except Exception as exc:  # noqa: BLE001 -- 개별 엔드포인트 조회 실패는 기본 모델 폴백
        logger.warning("AI models list failed for endpoint %s: %s", endpoint.name, exc)
        return [endpoint.model] if endpoint.model else []


async def list_models() -> list[str]:
    """전 엔드포인트 모델 합산 — .env의 models 목록 우선, 없으면 /models 자동 조회.

    다중 엔드포인트면 "이름::모델" id(프론트는 " / "로 표시), 단일이면 종전대로 모델명 그대로.
    """
    endpoints = get_ai_endpoints()
    multi = len(endpoints) > 1
    result: list[str] = []
    for endpoint in endpoints:
        models = list(endpoint.models) or await _discover_models(endpoint)
        if multi:
            result += [f"{endpoint.name}{MODEL_SEP}{model}" for model in models]
        else:
            result += models
    return result
