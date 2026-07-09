"""Employee 모델·동기화·엔드포인트 테스트."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim — sysadmin 게이트 차별화. 정리 시 복원."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_employees_table_created(client: TestClient) -> None:
    # client fixture는 직접 호출하지 않고 lifespan(create_all + 로컬 시드) 트리거 용도
    async def _count() -> int:
        async with SessionLocal() as session:
            return len(list((await session.scalars(select(Employee))).all()))

    assert asyncio.run(_count()) >= 5  # 로컬 임시 유저 5명 시드됨


def test_to_employee_fields_maps_and_filters() -> None:
    from app.ad.client import RawUser
    from app.ad.service import to_employee_fields

    raw = RawUser(
        sam_account_name="hong.gildong",
        display_name="홍길동",
        title="책임",
        distinguished_name="CN=H,OU=TeamA,OU=DeptB,OU=SAMSUNGBIOLOGICS,DC=corp",
        user_account_control=None,
        mail=None,
        member_of=[],
    )
    fields = to_employee_fields(raw)
    assert fields is not None
    assert fields.login_id == "hong.gildong"
    assert fields.department == "TeamA"  # 루트→리프 중 가장 깊은 레벨
    assert fields.role == "user"
    assert fields.active is True   # uac=None → active
    assert fields.email == ""      # mail=None → ""

    excluded = RawUser("nodot", "이름", "", "OU=TeamA,DC=corp", None, None, [])  # loginId에 '.' 없음
    assert to_employee_fields(excluded) is None


def test_get_current_user_prefers_dev_header() -> None:
    # auth_enabled=False(기본)일 때 X-Dev-User 우선, 없으면 dev_user
    from app.auth import get_current_user
    from app.settings import settings

    assert get_current_user(authorization=None, x_dev_user="admin.kim") == "admin.kim"
    assert get_current_user(authorization=None, x_dev_user=None) == settings.dev_user


def test_me_uses_dev_user_header(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "admin.kim"
    assert body["role"] == "admin"
    assert body["department"] == "Process Innovation Team"


def test_me_falls_back_for_unknown_user(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "unknown.person"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "unknown.person"
    assert body["role"] == "user"  # employees에 없으면 기본 user


def test_me_records_login_once_per_day(client: TestClient) -> None:
    """/api/me는 현황조사용 LoginRecord를 하루 1건만 기록(중복제거) — 맵 열 때마다 안 찍힘."""
    from app.models import LoginRecord

    async def _count(login_id: str) -> int:
        async with SessionLocal() as session:
            rows = (
                await session.scalars(
                    select(LoginRecord).where(LoginRecord.login_id == login_id)
                )
            ).all()
            return len(list(rows))

    # 같은 날 여러 번 호출(새 탭·새로고침 모사) → 1건만
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    assert asyncio.run(_count("record.me")) == 1


def test_employees_list_requires_admin(client: TestClient, sysadmin_enforced: None) -> None:
    # 일반 유저(비-sysadmin) → 403, sysadmin(admin.kim) → 200 (F6: admin 흡수)
    assert client.get("/api/employees", headers={"X-Dev-User": "user.lee"}).status_code == 403
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    assert len(res.json()) >= 5


def test_sync_requires_admin(client: TestClient, sysadmin_enforced: None) -> None:
    assert client.post("/api/employees/sync", headers={"X-Dev-User": "user.lee"}).status_code == 403


def test_sync_503_without_ldap(client: TestClient) -> None:
    # LDAP 미설정(테스트 기본) → 503
    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 503


def test_sync_mocked_filters_and_guards(client: TestClient, monkeypatch) -> None:
    from app.ad import client as ldap_client
    from app.ad import service
    from app.ad.client import RawUser
    from app.settings import settings

    # LDAP 설정된 것처럼 위장 (ldap_enabled 프로퍼티가 True가 되도록 4종 채움)
    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(service, "_last_full_sync_at", None)  # 가드 리셋
    raws = [
        RawUser("new.user", "신규", "사원", "OU=TeamA,DC=corp", 0x200, "new@corp", []),
        RawUser("nodot", "제외", "", "OU=TeamA,DC=corp", None, None, []),  # loginId '.' 없음 → 제외
    ]
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)

    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 2
    assert body["upserted"] == 1
    assert body["excluded"] == 1

    # 5분 가드 — 즉시 재호출 시 429
    res2 = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res2.status_code == 429


# ── 비활성 계정 제외 + 스테일 프룬 (design 2026-07-09) ──────────────────


def _seed_ad_row(login_id: str) -> None:
    """source='ad' 행 멱등 시드 — 프룬 대상/생존 검증용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="ad")
                session.add(emp)
            emp.source = "ad"
            await session.commit()

    asyncio.run(_run())


def _employee_exists(login_id: str) -> bool:
    async def _run() -> bool:
        async with SessionLocal() as session:
            return (await session.get(Employee, login_id)) is not None

    return asyncio.run(_run())


def _mock_ldap(monkeypatch, raws: list) -> None:
    """LDAP 설정 위장 + 5분 가드 리셋 + fetch_all_users mock — mocked sync 공통 준비."""
    from app.ad import client as ldap_client
    from app.ad import service

    monkeypatch.setattr(settings, "ldap_url", "ldaps://x")
    monkeypatch.setattr(settings, "ldap_bind_dn", "cn=svc")
    monkeypatch.setattr(settings, "ldap_bind_credentials", "pw")
    monkeypatch.setattr(settings, "ldap_user_search_base", "dc=corp")
    monkeypatch.setattr(service, "_last_full_sync_at", None)
    monkeypatch.setattr(ldap_client, "fetch_all_users", lambda: raws)


def test_to_employee_fields_excludes_disabled_account() -> None:
    from app.ad.client import RawUser
    from app.ad.service import to_employee_fields

    disabled = RawUser("gone.user", "비활성계정", "사원", "OU=TeamA,DC=corp", 0x202, None, [])
    assert to_employee_fields(disabled) is None  # uac 0x2 → 동기화 제외


def test_sync_prunes_stale_ad_rows_and_keeps_local(client: TestClient, monkeypatch) -> None:
    from app.ad.client import RawUser

    _seed_ad_row("stale.user")  # 이번 스캔에 없는 기존 ad 행 → 프룬 대상
    raws = [
        RawUser("fresh.user", "Fresh User", "사원", "OU=TeamA,DC=corp", 0x200, None, []),
        RawUser("disabled.user", "Disabled User", "사원", "OU=TeamA,DC=corp", 0x202, None, []),
    ]
    _mock_ldap(monkeypatch, raws)

    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 2
    assert body["upserted"] == 1
    assert body["excluded"] == 1  # disabled.user — 비활성 제외
    assert body["purged"] >= 1  # stale.user 포함, 유효 집합 밖 ad 행 삭제
    assert not _employee_exists("stale.user")
    assert not _employee_exists("disabled.user")  # 비활성은 애초에 미생성
    assert _employee_exists("fresh.user")
    assert _employee_exists("user.lee")  # source='local' 시드는 보존


def test_sync_empty_scan_skips_prune(client: TestClient, monkeypatch) -> None:
    _seed_ad_row("survivor.ad")
    _mock_ldap(monkeypatch, [])

    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 0
    assert body["purged"] == 0
    assert _employee_exists("survivor.ad")  # 빈 스캔 → 전멸 방지 가드


def test_sync_all_excluded_scan_skips_prune(client: TestClient, monkeypatch) -> None:
    """스캔이 비어있지 않아도 전원 제외(유효 0명)면 프룬 스킵 — NOT IN 전삭제 방지 가드."""
    from app.ad.client import RawUser

    _seed_ad_row("survivor2.ad")
    raws = [RawUser("disabled.only", "Disabled Only", "사원", "OU=TeamA,DC=corp", 0x202, None, [])]
    _mock_ldap(monkeypatch, raws)

    res = client.post("/api/employees/sync", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["scanned"] == 1
    assert body["excluded"] == 1
    assert body["purged"] == 0
    assert _employee_exists("survivor2.ad")
