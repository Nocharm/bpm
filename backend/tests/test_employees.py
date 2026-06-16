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
