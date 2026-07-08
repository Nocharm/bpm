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
