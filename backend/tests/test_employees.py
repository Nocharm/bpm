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
    )
    fields = to_employee_fields(raw)
    assert fields is not None
    assert fields.login_id == "hong.gildong"
    assert fields.department == "TeamA"  # 루트→리프 중 가장 깊은 레벨
    assert fields.role == "user"

    excluded = RawUser("nodot", "이름", "", "OU=TeamA,DC=corp")  # loginId에 '.' 없음
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
    assert body["department"] == "프로세스혁신팀"


def test_me_falls_back_for_unknown_user(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "unknown.person"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "unknown.person"
    assert body["role"] == "user"  # employees에 없으면 기본 user
