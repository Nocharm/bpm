"""Employee 모델·동기화·엔드포인트 테스트."""

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Employee


def test_employees_table_created(client: TestClient) -> None:
    async def _count() -> int:
        async with SessionLocal() as session:
            return len(list((await session.scalars(select(Employee))).all()))

    # Task 1 단계에서는 시드(Task 3)가 없어 0 이상이면 통과 — 테이블 존재 확인이 목적
    assert asyncio.get_event_loop().run_until_complete(_count()) >= 0
