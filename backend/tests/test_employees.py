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
