"""임베드 가능성 프로브 — 대상 URL의 X-Frame-Options/CSP frame-ancestors 판독 (embed-check design 2026-07-08)."""

import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx2

# 프로브 타임아웃(초) — 패널의 6s 로드 폴백보다 짧아야 차단 판정이 화면에 먼저 닿는다
PROBE_TIMEOUT_SECONDS = 4.0


def parse_embeddable(
    x_frame_options: str | None, content_security_policy: str | None
) -> bool:
    """임베드 차단 헤더 판정 — 제3자 오리진(우리 앱) 기준.

    XFO는 값과 무관하게 차단(DENY/SAMEORIGIN 모두 타 오리진 임베드 거부, ALLOW-FROM은 폐기).
    frame-ancestors는 '*' 포함일 때만 허용 — 앱 오리진이 배포마다 달라 목록 매칭은 하지 않는다(보수적).
    """
    if x_frame_options and x_frame_options.strip():
        return False
    if content_security_policy:
        for directive in content_security_policy.split(";"):
            name, _, value = directive.strip().partition(" ")
            if name.lower() == "frame-ancestors":
                return "*" in value
    return True


def _is_probe_refused_host(host: str) -> bool:
    """SSRF 축소 — 루프백·링크로컬(클라우드 메타데이터)·비유니캐스트는 프로브 거부.

    사설 대역(RFC1918)은 사내 시스템 판정이 이 기능의 목적이라 의도적으로 허용(스펙 문서화).
    DNS 재바인딩까지 막지는 않는다 — 사설 대역을 허용하는 이상 완전 차단은 불가, best-effort 가드.
    """
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # 해석 실패는 이후 httpx도 실패 → None(판정 불가) 경로로 수렴
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return True
    return False


_MAX_REDIRECTS = 5  # 수동 추종 상한 — 홉마다 SSRF 가드 재적용(자동 추종은 가드 우회라 금지)
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


async def probe_embeddable(url: str) -> bool | None:
    """대상 URL을 GET해 최종 응답 헤더로 판정. 도달 실패/프로브 거부는 None(판정 불가).

    리다이렉트는 자동 추종하지 않고 **홉마다 스킴·호스트 가드를 재적용하며 수동 추종** —
    외부 서버가 302로 루프백/메타데이터를 가리키게 해 최초-URL 검사만 통과하는 SSRF 우회 차단.
    """
    try:
        async with httpx2.AsyncClient(
            timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            current = url
            for _ in range(_MAX_REDIRECTS + 1):
                parsed = urlparse(current)
                if parsed.scheme not in ("http", "https") or parsed.hostname is None:
                    return None  # 리다이렉트로 스킴이 바뀌는 우회(file:// 등)도 여기서 거부
                # getaddrinfo는 블로킹(DNS) — 이벤트 루프 밖에서 (rules/languages/python.md Async)
                if await asyncio.to_thread(_is_probe_refused_host, parsed.hostname):
                    return None
                response = await client.get(current, headers={"User-Agent": "bpm-embed-check"})
                location = response.headers.get("location")
                if response.status_code in _REDIRECT_STATUSES and location:
                    current = urljoin(current, location)
                    continue
                return parse_embeddable(
                    response.headers.get("x-frame-options"),
                    response.headers.get("content-security-policy"),
                )
            return None  # 리다이렉트 과다 — 판정 불가
    except Exception:
        # 네트워크/DNS/타임아웃 — 판정 불가로 반환해 프론트가 기존 동작(onLoad+타임아웃)을 유지
        return None
