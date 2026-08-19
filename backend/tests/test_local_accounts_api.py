"""로컬 계정 관리 API — sysadmin 전용, ldap 모드에서만."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app import tokens
from app.db import SessionLocal
from app.models import Employee, LocalCredential
from app.permissions import logic
from app.settings import settings

# 이 파일이 심은 Employee/LocalCredential login_id — teardown에서 이 목록만 지운다.
_seeded_ids: list[str] = []


async def _clear_seeded_rows() -> None:
    async with SessionLocal() as session:
        if _seeded_ids:
            await session.execute(delete(LocalCredential).where(LocalCredential.login_id.in_(_seeded_ids)))
            await session.execute(delete(Employee).where(Employee.login_id.in_(_seeded_ids)))
            await session.commit()
    _seeded_ids.clear()


@pytest.fixture
def ldap_admin():
    """ldap 모드 + 실제 발급 토큰으로 sysadmin 액터 구성 — 프로덕션 인증 경로 그대로.

    브리핑의 원안(X-Dev-User 헤더)은 ldap 모드에서 get_current_user가 Bearer만 신뢰해
    401이 난다(app/auth.py — dev 헤더는 dev 모드 전용). 실제 발급 토큰을 써서 그 경로를
    그대로 통과시킨다.
    """
    saved = (settings.auth_mode, settings.auth_jwt_secret, settings.bpm_sysadmins)
    settings.auth_mode = "ldap"
    settings.auth_jwt_secret = "test-secret-please-ignore"
    settings.bpm_sysadmins = "admin.sys"
    token, _ = tokens.create_access_token("admin.sys")
    yield {"Authorization": f"Bearer {token}"}
    settings.auth_mode, settings.auth_jwt_secret, settings.bpm_sysadmins = saved
    logic.grant_sysadmin_cache(set())
    asyncio.run(_clear_seeded_rows())


def test_create_then_list(client: TestClient, ldap_admin):
    res = client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.new",
            "name": "New Consultant",
            "deptCode": None,
            "role": "user",
            "password": "pw-initial",
            "isSysadmin": False,
        },
        headers=ldap_admin,
    )
    assert res.status_code == 201
    _seeded_ids.append("consultant.new")

    listed = client.get("/api/admin/local-accounts", headers=ldap_admin)
    assert listed.status_code == 200
    ids = [row["loginId"] for row in listed.json()]
    assert "consultant.new" in ids


def test_response_never_exposes_hash(client: TestClient, ldap_admin):
    create_res = client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.hash",
            "name": "H",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": False,
        },
        headers=ldap_admin,
    )
    _seeded_ids.append("consultant.hash")
    assert "password" not in create_res.text.lower()

    patch_res = client.patch(
        "/api/admin/local-accounts/consultant.hash",
        json={"name": "H2"},
        headers=ldap_admin,
    )
    assert "password" not in patch_res.text.lower()

    body = client.get("/api/admin/local-accounts", headers=ldap_admin).text
    assert "password" not in body.lower()


def test_login_id_colliding_with_ad_account_is_rejected(client: TestClient, ldap_admin):
    async def _seed_ad_user() -> None:
        async with SessionLocal() as session:
            if await session.get(Employee, "real.ad") is None:
                session.add(Employee(login_id="real.ad", name="Real", source="ad"))
                await session.commit()

    asyncio.run(_seed_ad_user())
    _seeded_ids.append("real.ad")
    res = client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "real.ad",
            "name": "Impostor",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": False,
        },
        headers=ldap_admin,
    )
    assert res.status_code == 409


def test_granting_sysadmin_updates_the_cache(client: TestClient, ldap_admin):
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.boss",
            "name": "Boss",
            "deptCode": None,
            "role": "admin",
            "password": "pw",
            "isSysadmin": True,
        },
        headers=ldap_admin,
    )
    _seeded_ids.append("consultant.boss")
    assert "consultant.boss" in logic._granted_sysadmins
    # 캐시 내부 상태뿐 아니라 공개 판정 함수로 end-to-end 확인 — BPM_SYSADMINS는
    # admin.sys만 있으므로 이 결과는 순전히 캐시(부여)에서 나온다.
    assert logic.is_sysadmin("consultant.boss") is True

    client.patch(
        "/api/admin/local-accounts/consultant.boss",
        json={"isSysadmin": False},
        headers=ldap_admin,
    )
    assert "consultant.boss" not in logic._granted_sysadmins
    assert logic.is_sysadmin("consultant.boss") is False


def test_delete_removes_from_cache(client: TestClient, ldap_admin):
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.tmp",
            "name": "Tmp",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": True,
        },
        headers=ldap_admin,
    )
    res = client.delete("/api/admin/local-accounts/consultant.tmp", headers=ldap_admin)
    assert res.status_code == 204
    assert "consultant.tmp" not in logic._granted_sysadmins

    async def _assert_gone() -> None:
        async with SessionLocal() as session:
            assert await session.get(LocalCredential, "consultant.tmp") is None
            assert await session.get(Employee, "consultant.tmp") is None

    asyncio.run(_assert_gone())


def test_load_granted_sysadmins_reads_db_rows(client: TestClient, ldap_admin):
    """Task 4의 load_granted_sysadmins가 실제 행으로 검증된 적이 없었다 — 여기서 채운다."""
    client.post(
        "/api/admin/local-accounts",
        json={
            "loginId": "consultant.reload",
            "name": "Reload",
            "deptCode": None,
            "role": "user",
            "password": "pw",
            "isSysadmin": True,
        },
        headers=ldap_admin,
    )
    _seeded_ids.append("consultant.reload")
    assert "consultant.reload" in logic._granted_sysadmins

    # 새 프로세스 기동을 흉내: 캐시를 비우고 DB에서 다시 로드
    logic.grant_sysadmin_cache(set())
    assert "consultant.reload" not in logic._granted_sysadmins

    async def _reload() -> None:
        async with SessionLocal() as session:
            await logic.load_granted_sysadmins(session)

    asyncio.run(_reload())
    assert "consultant.reload" in logic._granted_sysadmins


def test_endpoint_is_404_outside_ldap_mode(client: TestClient):
    res = client.get("/api/admin/local-accounts", headers={"X-Dev-User": "admin.sys"})
    assert res.status_code == 404
