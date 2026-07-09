"""관찰용 korean 필드 노출 테스트 — /api/admin/users korean_dept/korean_name 필드 확인."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import Employee


def _seed_org(
    login_id: str, levels: list[str], korean_dept: str = "", korean_name: str = ""
) -> None:
    """org 경로까지 지정하는 멱등 시드 — korean 필드 노출 테스트용."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="local")
                session.add(emp)
            padded = (levels + [None] * 5)[:5]
            emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5 = padded
            emp.department = levels[-1] if levels else ""
            emp.korean_dept = korean_dept
            emp.korean_name = korean_name
            await session.commit()

    asyncio.run(_run())


def _cleanup_test_employees() -> None:
    """테스트 용 직원 삭제 — dk. 접두사만 삭제해서 기존 시드 보존."""

    async def _run() -> None:
        async with SessionLocal() as session:
            await session.execute(delete(Employee).where(Employee.login_id.like("dk.%")))
            await session.commit()

    asyncio.run(_run())


@pytest.fixture(autouse=True)
def _cleanup_after_test() -> Iterator[None]:
    """각 테스트 후 dk. 접두사 직원 삭제."""
    yield
    _cleanup_test_employees()


def test_admin_users_include_korean_fields(client: TestClient) -> None:
    _seed_org("dk.user1", ["HQ", "DeptB", "TeamA"], korean_dept="팀A", korean_name="김하나")
    res = client.get("/api/admin/users", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["login_id"]: u for u in res.json()["users"]}
    assert by_id["dk.user1"]["korean_dept"] == "팀A"
    assert by_id["dk.user1"]["korean_name"] == "김하나"
