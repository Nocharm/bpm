"""인증 모드 공개 · LDAP 모드 로그인 (설계: 2026-08-19-auth-fallback-ldap-design.md)."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.settings import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


class AuthModeOut(BaseModel):
    mode: str
    keycloak_issuer: str
    keycloak_client_id: str

    model_config = {"populate_by_name": True, "alias_generator": None}


@router.get("/mode")
async def get_auth_mode() -> dict[str, str]:
    """프론트 부팅용 — 인증 불필요. 시크릿은 절대 넣지 않는다.

    issuer/client_id는 비밀이 아니다(브라우저가 리다이렉트 URL로 이미 노출한다).
    """
    return {
        "mode": settings.resolved_auth_mode(),
        "keycloakIssuer": settings.keycloak_issuer,
        "keycloakClientId": settings.keycloak_client_id,
    }
