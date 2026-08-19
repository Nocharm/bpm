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


# 이 파일이 직접 심은 Employee login_id — teardown에서 이 목록만 지운다(다른 픽스처가
# 소유한 employee 행을 건드리지 않도록 blanket delete는 금지).
_seeded_employee_ids: list[str] = []


async def _clear_local_credentials_and_employees() -> None:
    """local_credentials 전량 + 이 파일이 심은 employees만 정리.

    session-scope DB를 공유하는 test_passwords.py의 '테이블이 비어 있다' 단언과,
    conftest.py가 경고하는 '낯선 active employee가 알림 수신자 수 단언을 오염시키는'
    회귀를 이 파일이 만들지 않도록 (conftest.py:35-38)."""
    async with SessionLocal() as session:
        await session.execute(delete(LocalCredential))
        if _seeded_employee_ids:
            await session.execute(delete(Employee).where(Employee.login_id.in_(_seeded_employee_ids)))
        await session.commit()
    _seeded_employee_ids.clear()


@pytest.fixture
def ldap_mode():
    saved = (settings.auth_mode, settings.auth_jwt_secret)
    settings.auth_mode = "ldap"
    settings.auth_jwt_secret = "test-secret-please-ignore"
    login_throttle.clear_all()
    yield
    settings.auth_mode, settings.auth_jwt_secret = saved
    login_throttle.clear_all()
    asyncio.run(_clear_local_credentials_and_employees())


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
    _seeded_employee_ids.append(login_id)


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
    _seeded_employee_ids.append("ad.user")
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
    last = None
    for _ in range(login_throttle.MAX_ATTEMPTS):
        last = client.post(
            "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-wrong"}
        )
    # 임계치(5회)째 실패는 아직 401이어야 한다 — 4회에서 잠기는 off-by-one을 함께 고정.
    assert last.status_code == 401
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.e", "password": "pw-correct"}
    )
    assert res.status_code == 429


def test_success_resets_throttle_counter(client: TestClient, ldap_mode):
    """성공하면 실패 카운트가 리셋된다 — 이전 오타 몇 번으로 정상 사용자가 잠기면 안 된다."""
    _seed_local_account("consultant.f", "pw-correct")
    for _ in range(login_throttle.MAX_ATTEMPTS - 1):
        client.post(
            "/api/auth/login", json={"loginId": "consultant.f", "password": "pw-wrong"}
        )
    ok = client.post(
        "/api/auth/login", json={"loginId": "consultant.f", "password": "pw-correct"}
    )
    assert ok.status_code == 200

    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.f", "password": "pw-wrong"}
    )
    assert res.status_code == 401


def test_source_switched_to_hr_falls_back_to_ad(client: TestClient, ldap_mode, monkeypatch):
    """local_credentials가 남아 있어도 source가 'hr'로 전환되면 orphan residue —
    AD bind로 폴백해야 한다 (app/hr/service.py:114가 충돌 loginId를 무조건 'hr'로 전환).
    """
    _seed_local_account("consultant.g", "pw-correct")

    async def _switch_to_hr() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "consultant.g")
            assert emp is not None
            emp.source = "hr"
            await session.commit()

    asyncio.run(_switch_to_hr())

    monkeypatch.setattr(ad_client, "authenticate_user", lambda login_id, password: True)
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.g", "password": "pw-correct"}
    )
    assert res.status_code == 200

    def _refuse(*args, **kwargs):
        return False

    monkeypatch.setattr(ad_client, "authenticate_user", _refuse)
    # 로컬 비밀번호가 맞아도 local-verify 경로는 더 이상 타지 않는다 — AD가 거부하면 401.
    res = client.post(
        "/api/auth/login", json={"loginId": "consultant.g", "password": "pw-correct"}
    )
    assert res.status_code == 401


def test_login_is_404_outside_ldap_mode(client: TestClient):
    res = client.post("/api/auth/login", json={"loginId": "x", "password": "y"})
    assert res.status_code == 404
