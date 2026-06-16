"""Keycloak OIDC 인증 — Bearer JWT 검증 (docs/spec.md §4).

settings.auth_enabled=False(로컬)면 검증을 건너뛰고 dev 사용자를 반환한다.
True(서버)면 realm JWKS로 RS256 서명을 검증한다.
"""

from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Employee
from app.settings import settings


@lru_cache(maxsize=1)
def _jwk_client() -> jwt.PyJWKClient:
    # realm 공개키 — Keycloak certs 엔드포인트. lru_cache로 키 세트를 재사용.
    return jwt.PyJWKClient(f"{settings.keycloak_issuer}/protocol/openid-connect/certs")


def get_current_user(
    authorization: str | None = Header(default=None),
    x_dev_user: str | None = Header(default=None),
) -> str:
    """요청 사용자 loginId. auth OFF면 X-Dev-User(없으면 dev_user), ON이면 JWT preferred_username."""
    if not settings.auth_enabled:
        return x_dev_user or settings.dev_user  # 헤더는 auth OFF에서만 신뢰

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


async def get_current_employee(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Employee:
    """현재 사용자 Employee. 행이 없으면 임시 Employee(role=user, 미영속)."""
    emp = await session.get(Employee, login_id)
    if emp is None:
        return Employee(login_id=login_id, name=login_id, source="ad", role="user", department="")
    return emp


async def require_admin(emp: Employee = Depends(get_current_employee)) -> Employee:
    """role=admin 아니면 403."""
    if emp.role != "admin":
        raise HTTPException(status_code=403, detail="admin only")
    return emp
