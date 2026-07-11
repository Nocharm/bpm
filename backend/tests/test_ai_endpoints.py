"""다중 AI 엔드포인트(.env AI_ENDPOINTS) — 파싱·라우팅·모델 합산 테스트."""

import asyncio
import json

import pytest

from app import ai_client
from app.settings import settings

_TWO_ENDPOINTS = json.dumps(
    [
        {
            "name": "GPU",
            "base_url": "http://gpu:8000/v1",
            "token": "tok-gpu",
            "model": "qwen-72b",
            "models": ["qwen-72b", "qwen-14b"],
        },
        {"name": "OpenAI", "base_url": "https://api.openai.com/v1", "token": "tok-oai", "model": "gpt-4o-mini"},
    ]
)


class _FakeResponse:
    def __init__(self, data: dict) -> None:
        self._data = data

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return self._data


class _FakeClient:
    """httpx2.AsyncClient 대역 — 호출 url/헤더/페이로드를 기록."""

    calls: list[dict] = []

    def __init__(self, timeout: int | None = None) -> None:
        pass

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def post(self, url: str, json: dict | None = None, headers: dict | None = None) -> _FakeResponse:
        _FakeClient.calls.append({"method": "POST", "url": url, "payload": json, "headers": headers})
        return _FakeResponse({"choices": [{"message": {"content": "ok"}}]})

    async def get(self, url: str, headers: dict | None = None) -> _FakeResponse:
        _FakeClient.calls.append({"method": "GET", "url": url, "headers": headers})
        return _FakeResponse({"data": [{"id": "remote-a"}, {"id": "remote-b"}]})


@pytest.fixture
def fake_http(monkeypatch: pytest.MonkeyPatch) -> type[_FakeClient]:
    _FakeClient.calls = []
    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", _FakeClient)
    return _FakeClient


def test_endpoints_fallback_to_legacy_single(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", "")
    monkeypatch.setattr(settings, "ai_base_url", "http://legacy:8000/v1")
    monkeypatch.setattr(settings, "ai_api_token", "tok-legacy")
    monkeypatch.setattr(settings, "ai_model", "legacy-model")
    endpoints = ai_client.get_ai_endpoints()
    assert len(endpoints) == 1
    assert endpoints[0].name == "default"
    assert endpoints[0].base_url == "http://legacy:8000/v1"
    assert endpoints[0].model == "legacy-model"


def test_endpoints_parse_and_validation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", _TWO_ENDPOINTS)
    endpoints = ai_client.get_ai_endpoints()
    assert [e.name for e in endpoints] == ["GPU", "OpenAI"]
    assert endpoints[0].models == ("qwen-72b", "qwen-14b")
    assert endpoints[1].models == ()  # 목록 미지정 → /models 자동 조회 대상

    monkeypatch.setattr(settings, "ai_endpoints", "not-json")
    with pytest.raises(ValueError, match="invalid JSON"):
        ai_client.get_ai_endpoints()
    monkeypatch.setattr(settings, "ai_endpoints", "[]")
    with pytest.raises(ValueError, match="non-empty"):
        ai_client.get_ai_endpoints()
    monkeypatch.setattr(settings, "ai_endpoints", json.dumps([{"name": "x"}]))
    with pytest.raises(ValueError, match="base_url"):
        ai_client.get_ai_endpoints()


def test_resolve_routes_by_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", _TWO_ENDPOINTS)
    endpoint, model = ai_client.resolve_endpoint("OpenAI::gpt-4o")
    assert endpoint.name == "OpenAI"
    assert model == "gpt-4o"
    # 접두어 없는 구형 선택자 → 첫 엔드포인트 + 그 모델명
    endpoint, model = ai_client.resolve_endpoint("qwen-14b")
    assert endpoint.name == "GPU"
    assert model == "qwen-14b"
    # 미선택 → 첫 엔드포인트 기본 모델
    endpoint, model = ai_client.resolve_endpoint(None)
    assert endpoint.name == "GPU"
    assert model == "qwen-72b"
    # 모델 생략된 접두어("이름::") → 해당 엔드포인트 기본 모델
    endpoint, model = ai_client.resolve_endpoint("OpenAI::")
    assert endpoint.name == "OpenAI"
    assert model == "gpt-4o-mini"


def test_call_ai_hits_selected_endpoint(
    monkeypatch: pytest.MonkeyPatch, fake_http: type[_FakeClient]
) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", _TWO_ENDPOINTS)
    result = asyncio.run(ai_client.call_ai([{"role": "user", "content": "hi"}], "OpenAI::gpt-4o"))
    assert result.content == "ok"
    call = fake_http.calls[0]
    assert call["url"] == "https://api.openai.com/v1/chat/completions"
    assert call["headers"] == {"Authorization": "Bearer tok-oai"}
    assert call["payload"]["model"] == "gpt-4o"


def test_list_models_combines_env_list_and_discovery(
    monkeypatch: pytest.MonkeyPatch, fake_http: type[_FakeClient]
) -> None:
    monkeypatch.setattr(settings, "ai_endpoints", _TWO_ENDPOINTS)
    models = asyncio.run(ai_client.list_models())
    # GPU는 .env 목록 그대로(조회 생략), OpenAI는 /models 자동 조회 — 다중이라 "이름::모델" id
    assert models == ["GPU::qwen-72b", "GPU::qwen-14b", "OpenAI::remote-a", "OpenAI::remote-b"]
    urls = [c["url"] for c in fake_http.calls]
    assert urls == ["https://api.openai.com/v1/models"]  # GPU는 네트워크 호출 없음


def test_list_models_single_endpoint_keeps_bare_ids(
    monkeypatch: pytest.MonkeyPatch, fake_http: type[_FakeClient]
) -> None:
    monkeypatch.setattr(
        settings,
        "ai_endpoints",
        json.dumps([{"name": "GPU", "base_url": "http://gpu:8000/v1", "models": ["m1"]}]),
    )
    assert asyncio.run(ai_client.list_models()) == ["m1"]  # 단일 엔드포인트는 종전 형식 유지


def test_discovery_failure_falls_back_to_default_model(monkeypatch: pytest.MonkeyPatch) -> None:
    class _BoomClient(_FakeClient):
        async def get(self, url: str, headers: dict | None = None) -> _FakeResponse:
            raise RuntimeError("down")

    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", _BoomClient)
    monkeypatch.setattr(settings, "ai_endpoints", _TWO_ENDPOINTS)
    models = asyncio.run(ai_client.list_models())
    # OpenAI 조회 실패 → 기본 모델로 폴백, GPU는 .env 목록이라 영향 없음
    assert models == ["GPU::qwen-72b", "GPU::qwen-14b", "OpenAI::gpt-4o-mini"]
