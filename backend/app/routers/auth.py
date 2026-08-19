"""인증 모드 공개 · LDAP 모드 로그인 (설계: 2026-08-19-auth-fallback-ldap-design.md)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app import login_throttle
from app.ad import client as ad_client
from app.db import get_session
from app.models import Employee, LocalCredential
from app.passwords import verify_password
from app.schemas import LoginIn, LoginOut
from app.settings import settings
from app.tokens import create_access_token

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


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


@router.post("/login", response_model=LoginOut)
async def handle_login(
    body: LoginIn,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> LoginOut:
    """ldap 모드 로그인 — 로컬 계정 우선, 없으면 AD bind (설계 §4).

    실패 사유는 구분하지 않는다 — 계정 존재 여부가 401 메시지로 새면 안 된다.
    """
    if settings.resolved_auth_mode() != "ldap":
        raise HTTPException(status_code=404, detail="not found")

    client_ip = request.client.host if request.client else "unknown"
    throttle_key = f"{body.login_id}|{client_ip}"
    if not login_throttle.check_and_count(throttle_key):
        raise HTTPException(status_code=429, detail="too many attempts, try again later")

    employee = await session.get(Employee, body.login_id)
    credential = await session.get(LocalCredential, body.login_id)

    ok = False
    if employee is not None and employee.active:
        # source가 'local'로 바뀐 이후에도 남아있는 credential은 orphan residue다
        # (app/hr/service.py가 HR 피드 등장 시 source를 'hr'로 무조건 전환) —
        # 그런 계정은 로컬 비밀번호로 검증하지 않고 AD bind로 폴백한다.
        if credential is not None and employee.source == "local":
            # 로컬 계정은 AD로 보내지 않는다 — 컨설턴트 비밀번호가 사내 AD에 흘러가지 않게.
            # scrypt는 CPU-bound라 to_thread로 감싸 이벤트 루프를 막지 않는다.
            ok = await asyncio.to_thread(verify_password, body.password, credential.password_hash)
        else:
            # ldap3 bind는 블로킹 네트워크 호출 — AD 무응답 시 프로세스 전체가 멎지 않도록
            # to_thread로 감싼다(app/ad/client.py 모듈 docstring 계약).
            ok = await asyncio.to_thread(
                ad_client.authenticate_user, body.login_id, body.password
            )

    if not ok:
        login_throttle.record_failure(throttle_key)
        # 실패는 login_records에 남기지 않는다 — 사용 현황 집계가 오염된다(설계 §4).
        logger.warning("login failed login_id=%s ip=%s", body.login_id, client_ip)
        raise HTTPException(status_code=401, detail="invalid credentials")

    login_throttle.reset(throttle_key)
    token, expires_at = create_access_token(body.login_id)
    return LoginOut(token=token, expires_at=expires_at)
