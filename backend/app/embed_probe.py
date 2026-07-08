"""임베드 가능성 프로브 — 대상 URL의 X-Frame-Options/CSP frame-ancestors 판독 (embed-check design 2026-07-08)."""

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


async def probe_embeddable(url: str) -> bool | None:
    """대상 URL을 GET(리다이렉트 추종)해 최종 응답 헤더로 판정. 도달 실패는 None(판정 불가)."""
    try:
        async with httpx2.AsyncClient(
            timeout=PROBE_TIMEOUT_SECONDS, follow_redirects=True
        ) as client:
            response = await client.get(url, headers={"User-Agent": "bpm-embed-check"})
    except Exception:
        # 네트워크/DNS/타임아웃 — 판정 불가로 반환해 프론트가 기존 동작(onLoad+타임아웃)을 유지
        return None
    return parse_embeddable(
        response.headers.get("x-frame-options"),
        response.headers.get("content-security-policy"),
    )
