"""ldap 모드 로그인 — 로컬 계정 우선, AD 폴백, 시도 제한."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app import login_throttle
from app.ad import client as ad_client
from app.db import SessionLocal
from app.models import Employee, LocalCredential
from app.passwords import hash_password
from app.settings import settings


async def _clear_local_credentials() -> None:
    """local_credentials 정리 — session-scope DB를 공유하는 test_passwords.py의
    '테이블이 비어 있다' 단언(테이블 생성 여부 확인용)을 이 파일이 깨지 않도록."""
    async with SessionLocal() as session:
        await session.execute(delete(LocalCredential))
        await session.commit()


@pytest.fixture
def ldap_mode():
    saved = (settings.auth_mode, settings.auth_jwt_secret)
    settings.auth_mode = "ldap"
    settings.auth_jwt_secret = "test-secret-please-ignore"
    login_throttle.clear_all()
    yield
    settings.auth_mode, settings.auth_jwt_secret = saved
    login_throttle.clear_all()
    asyncio.run(_clear_local_credentials())


def _seed_local_account(login_id: str, password: str, active: bool = True) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, login_id) is None:
                session.add(
                    Employee(login_id=login_id, name=login_id, source="local", active=active)
                )
            if await session.get(LocalCredential, login_id) is None:
                session.add(
                    LocalCredential(
                        login_id=login_id,
                        password_hash=hash_password(password),
                        created_by="admin.sys",
                    )
                )
            await session.commit()

    asyncio.run(_run())


def test_local_account_logs_in(client: TestClient, ldap_mode):
    _seed_local_account("consultant.a", "pw-correct")
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.a", "password": "pw-correct"}
    )
    assert res.status_code == 200
    assert res.json()["token"]

    me = client.get("/api/me", headers={"Authorization": f"Bearer {res.json()['token']}"})
    assert me.status_code == 200
    assert me.json()["username"] == "consultant.a"


def test_wrong_password_is_401(client: TestClient, ldap_mode):
    _seed_local_account("consultant.b", "pw-correct")
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.b", "password": "pw-wrong"}
    )
    assert res.status_code == 401


def test_local_account_never_reaches_ad(client: TestClient, ldap_mode, monkeypatch):
    """컨설턴트 비밀번호를 사내 AD로 보내지 않는다 (설계 §4)."""
    _seed_local_account("consultant.c", "pw-correct")

    def _explode(*args, **kwargs):
        raise AssertionError("local account must not be sent to AD")

    monkeypatch.setattr(ad_client, "authenticate_user", _explode)
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.c", "password": "pw-correct"}
    )
    assert res.status_code == 200


def test_unknown_login_id_falls_back_to_ad(client: TestClient, ldap_mode, monkeypatch):
    async def _seed_employee() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, "ad.user") is None:
                session.add(
                    Employee(login_id="ad.user", name="AD User", source="ad", active=True)
                )
                await session.commit()

    asyncio.run(_seed_employee())
    monkeypatch.setattr(ad_client, "authenticate_user", lambda login_id, password: True)
    res = client.post("/api/auth/login", json={"loginId": "ad.user", "password": "pw"})
    assert res.status_code == 200


def test_inactive_employee_is_rejected(client: TestClient, ldap_mode):
    _seed_local_account("consultant.gone", "pw-correct", active=False)
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.gone", "password": "pw-correct"}
    )
    assert res.status_code == 401


def test_empty_password_is_rejected(client: TestClient, ldap_mode):
    _seed_local_account("consultant.d", "pw-correct")
    res = client.post("/api/auth/login", json={"loginId": "consultant.d", "password": ""})
    assert res.status_code == 401


def test_repeated_failures_are_throttled(client: TestClient, ldap_mode):
    _seed_local_account("consultant.e", "pw-correct")
    for _ in range(login_throttle.MAX_ATTEMPTS):
        client.post(
            "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-wrong"}
        )
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-correct"}
    )
    assert res.status_code == 429


def test_login_is_404_outside_ldap_mode(client: TestClient):
    res = client.post("/api/auth/login", json={"loginId": "x", "password": "y"})
    assert res.status_code == 404
