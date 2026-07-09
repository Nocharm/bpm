"""임베드 체크 API — 헤더 판정·스킴 가드·도달 실패 처리. 아웃바운드 HTTP는 monkeypatch (embed-check design 2026-07-08)."""

import pytest
from fastapi.testclient import TestClient

from app import embed_probe
from app.embed_probe import parse_embeddable


def test_parse_blocks_any_x_frame_options() -> None:
    assert parse_embeddable("DENY", None) is False
    assert parse_embeddable("sameorigin", None) is False


def test_parse_blocks_frame_ancestors_without_wildcard() -> None:
    assert parse_embeddable(None, "frame-ancestors 'none'") is False
    assert parse_embeddable(None, "default-src 'self'; frame-ancestors 'self'") is False


def test_parse_allows_wildcard_and_absent_headers() -> None:
    assert parse_embeddable(None, None) is True
    assert parse_embeddable(None, "default-src 'self'") is True
    assert parse_embeddable(None, "frame-ancestors *") is True


def test_endpoint_returns_probe_verdict(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_blocked(url: str) -> bool | None:
        return False

    monkeypatch.setattr(embed_probe, "probe_embeddable", _fake_blocked)
    res = client.get("/api/embed-check", params={"url": "https://blocked.example.com"})
    assert res.status_code == 200
    assert res.json() == {"embeddable": False}


def test_endpoint_unknown_on_unreachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_unreachable(url: str) -> bool | None:
        return None

    monkeypatch.setattr(embed_probe, "probe_embeddable", _fake_unreachable)
    res = client.get("/api/embed-check", params={"url": "https://down.example.com"})
    assert res.status_code == 200
    assert res.json() == {"embeddable": None}


def test_endpoint_rejects_non_http_scheme(client: TestClient) -> None:
    res = client.get("/api/embed-check", params={"url": "javascript:alert(1)"})
    assert res.status_code == 422


def test_probe_refuses_loopback_and_link_local_allows_private() -> None:
    # SSRF 축소 가드 — 메타데이터/로컬 포트 프로빙 차단, 사내(RFC1918)는 기능 목적상 허용
    from app.embed_probe import _is_probe_refused_host

    assert _is_probe_refused_host("127.0.0.1") is True
    assert _is_probe_refused_host("::1") is True
    assert _is_probe_refused_host("169.254.169.254") is True
    assert _is_probe_refused_host("192.168.0.10") is False
    assert _is_probe_refused_host("10.1.2.3") is False


def test_probe_follows_redirects_but_reapplies_ssrf_guard() -> None:
    # 리다이렉트 경유 SSRF — 외부 서버가 302로 메타데이터 IP를 가리켜도 홉 가드에 걸려 None
    import asyncio

    class _Resp:
        def __init__(self, status: int, headers: dict) -> None:
            self.status_code = status
            self.headers = headers

    class _RedirClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.calls: list[str] = []

        async def __aenter__(self) -> "_RedirClient":
            return self

        async def __aexit__(self, *args: object) -> bool:
            return False

        async def get(self, url: str, headers: dict | None = None) -> _Resp:
            self.calls.append(url)
            # 첫 홉(외부)은 302로 클라우드 메타데이터로 유도
            return _Resp(302, {"location": "http://169.254.169.254/latest/meta-data"})

    client = _RedirClient()
    import app.embed_probe as ep

    orig = ep.httpx2.AsyncClient
    ep.httpx2.AsyncClient = lambda *a, **k: client  # type: ignore[assignment]
    try:
        verdict = asyncio.run(ep.probe_embeddable("https://evil.example.com/start"))
    finally:
        ep.httpx2.AsyncClient = orig
    assert verdict is None  # 메타데이터 홉에서 거부 → 판정 불가
    # 최초 외부 홉은 요청했지만 메타데이터 URL은 GET하지 않았다(가드가 홉 진입 전에 차단)
    assert client.calls == ["https://evil.example.com/start"]


def test_probe_returns_verdict_after_safe_redirect() -> None:
    # 안전한 외부 호스트로의 리다이렉트는 정상 추종해 최종 헤더로 판정
    import asyncio

    class _Resp:
        def __init__(self, status: int, headers: dict) -> None:
            self.status_code = status
            self.headers = headers

    class _Client:
        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *args: object) -> bool:
            return False

        async def get(self, url: str, headers: dict | None = None) -> _Resp:
            if url.endswith("/start"):
                return _Resp(302, {"location": "https://example.org/final"})
            return _Resp(200, {"x-frame-options": "DENY"})

    import app.embed_probe as ep

    orig = ep.httpx2.AsyncClient
    ep.httpx2.AsyncClient = lambda *a, **k: _Client()  # type: ignore[assignment]
    try:
        verdict = asyncio.run(ep.probe_embeddable("https://example.com/start"))
    finally:
        ep.httpx2.AsyncClient = orig
    assert verdict is False  # 최종 응답의 XFO:DENY → 임베드 불가
