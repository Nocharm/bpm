"""ldap 모드 세션 토큰 — 앱이 직접 서명하는 HS256 JWT (설계 §4).

Keycloak 모드는 realm이 발급한 RS256을 검증만 하지만, ldap 모드는 발급자가 없어
앱이 직접 서명한다. 무상태라 만료 전 강제 로그아웃은 불가능하다(설계 §4 한계).
"""

from datetime import datetime, timedelta

import jwt

from app.clock import now as now_kst
from app.settings import settings

_ALGORITHM = "HS256"


def create_access_token(login_id: str) -> tuple[str, datetime]:
    """(토큰, 만료시각). 시크릿이 비면 위조가 자유로워지므로 서명 자체를 거부한다."""
    if not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_JWT_SECRET is empty - refusing to sign a forgeable token")
    expires_at = now_kst() + timedelta(hours=settings.auth_jwt_ttl_hours)
    token = jwt.encode(
        {"sub": login_id, "exp": expires_at}, settings.auth_jwt_secret, algorithm=_ALGORITHM
    )
    return token, expires_at


def decode_access_token(token: str) -> str:
    """loginId 반환. 서명 불일치·만료·subject 부재는 모두 ValueError."""
    if not settings.auth_jwt_secret:
        raise RuntimeError("AUTH_JWT_SECRET is empty - cannot verify tokens")
    try:
        claims = jwt.decode(token, settings.auth_jwt_secret, algorithms=[_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise ValueError("token expired") from exc
    except jwt.PyJWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc
    login_id = claims.get("sub")
    if not login_id:
        raise ValueError("token has no subject")
    return login_id
