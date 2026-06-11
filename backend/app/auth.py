"""Keycloak OIDC 인증 — Bearer JWT 검증 (docs/spec.md §4).

settings.auth_enabled=False(로컬)면 검증을 건너뛰고 dev 사용자를 반환한다.
True(서버)면 realm JWKS로 RS256 서명을 검증한다.
"""

from functools import lru_cache

import jwt
from fastapi import Header, HTTPException

from app.settings import settings


@lru_cache(maxsize=1)
def _jwk_client() -> jwt.PyJWKClient:
    # realm 공개키 — Keycloak certs 엔드포인트. lru_cache로 키 세트를 재사용.
    return jwt.PyJWKClient(f"{settings.keycloak_issuer}/protocol/openid-connect/certs")


def get_current_user(authorization: str | None = Header(default=None)) -> str:
    """요청 사용자명을 반환. 동기 의존성 → FastAPI가 스레드풀에서 실행(JWKS fetch 블로킹 허용)."""
    if not settings.auth_enabled:
        return settings.dev_user

    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization.removeprefix("Bearer ")
    try:
        signing_key = _jwk_client().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.keycloak_issuer,
            audience=settings.keycloak_audience,
            options={"verify_aud": settings.keycloak_audience is not None},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid token: {exc}") from exc

    username = claims.get("preferred_username") or claims.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="token has no subject")
    return username
