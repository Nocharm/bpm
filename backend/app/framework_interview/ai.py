"""캠페인 AI 호출 — 추출·정규화·검증을 최대 3회 돌리며 검증 오류를 모델에 되먹인다.

orchestrator._ask_json은 "JSON만 다시" 한 줄로 1회 재시도라 스키마 편차(kind 표기·필드 누락)를
못 고쳤다. 여기서는 pydantic 오류 요약을 사용자 메시지로 붙여 모델이 무엇을 고칠지 알게 한다.
"""

import json
import logging
from collections.abc import Callable
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app import ai_client
from app.interview.agents import extract_json
from app.interview.orchestrator import TurnError, usage_log

logger = logging.getLogger(__name__)

_SchemaT = TypeVar("_SchemaT", bound=BaseModel)
MAX_ATTEMPTS = 3
_ERROR_LINES = 8


def summarize_validation_error(exc: Exception) -> str:
    """pydantic/JSON 오류를 모델이 고칠 수 있는 짧은 목록으로."""
    if isinstance(exc, ValidationError):
        lines = []
        for err in exc.errors()[:_ERROR_LINES]:
            loc = ".".join(str(p) for p in err.get("loc", ()))
            lines.append(f"- {loc or '$'}: {err.get('msg', '')}")
        return "\n".join(lines)
    return f"- $: {exc}"


def parse_json_object(text: str) -> Any:
    """펜스·설명을 벗기고 JSON을 파싱. 실패는 ValueError."""
    body = extract_json(text)
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON: {exc.msg} (line {exc.lineno})") from exc


async def ask_schema(
    messages: list[dict],
    schema_cls: type[_SchemaT],
    *,
    normalizer: Callable[[Any], Any] | None = None,
    reasoning: ai_client.AiReasoning | None = None,
    attempts: int = MAX_ATTEMPTS,
) -> _SchemaT:
    """call_ai → JSON 추출 → normalizer → schema 검증. 실패 시 오류 요약을 붙여 재시도, 끝내 실패면 TurnError."""
    last_error = ""
    for attempt in range(attempts):
        try:
            reply = await ai_client.call_ai(messages, None, reasoning=reasoning)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 오류는 TurnError로 정규화
            logger.warning("framework interview AI call failed: %s", exc)
            raise TurnError("AI server error") from exc
        log = usage_log.get()
        if log is not None:
            log.append((reply.prompt_tokens, reply.completion_tokens))
        try:
            raw = parse_json_object(reply.content)
            if normalizer is not None:
                raw = normalizer(raw)
            return schema_cls.model_validate(raw)
        except (ValueError, ValidationError) as exc:
            last_error = summarize_validation_error(exc)
            logger.warning(
                "framework interview AI invalid (attempt %d/%d, %s): %s | raw=%.500s",
                attempt + 1, attempts, schema_cls.__name__, last_error.replace("\n", " "), reply.content,
            )
            if attempt < attempts - 1:
                messages = [
                    *messages,
                    {"role": "assistant", "content": reply.content[:4000]},
                    {"role": "user", "content": (
                        "위 응답은 형식 오류가 있습니다. 아래 항목을 고쳐 다른 설명 없이 JSON 객체 하나만 다시 출력하세요.\n"
                        f"{last_error}"
                    )},
                ]
    raise TurnError(f"AI returned invalid response: {last_error.splitlines()[0] if last_error else 'unknown'}")
