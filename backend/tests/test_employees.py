"""Employee 모델·동기화·엔드포인트 테스트."""

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Employee


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


def test_employees_list_requires_admin(client: TestClient) -> None:
    # 일반 유저 → 403, admin → 200
    assert client.get("/api/employees", headers={"X-Dev-User": "user.lee"}).status_code == 403
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    assert len(res.json()) >= 5


def test_sync_requires_admin(client: TestClient) -> None:
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
