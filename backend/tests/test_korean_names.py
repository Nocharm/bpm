"""한글이름(korean_name) 필드·일괄 등록 엔드포인트 테스트 — spec 2026-07-09."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee


def _seed(login_id: str, korean_name: str = "") -> None:
    """employees 행 멱등 시드 — korean_name까지 지정."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="local")
                session.add(emp)
            emp.korean_name = korean_name
            await session.commit()

    asyncio.run(_run())


def _korean_name_of(login_id: str) -> str | None:
    async def _run() -> str | None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            return None if emp is None else emp.korean_name

    return asyncio.run(_run())


def test_employees_include_korean_name(client: TestClient) -> None:
    _seed("kr.have", "홍길동")
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {row["login_id"]: row for row in res.json()}
    assert by_id["kr.have"]["korean_name"] == "홍길동"


def test_ad_upsert_preserves_korean_name(client: TestClient) -> None:
    """AD 동기화 upsert가 korean_name을 덮지 않는다 — AD 미제공 필드 회귀 가드."""
    from app.ad.service import EmployeeFields, _upsert

    _seed("kr.sync", "김철수")

    async def _run() -> None:
        fields = EmployeeFields(
            login_id="kr.sync",
            name="CS Kim",
            title="Pro",
            org_l1=None,
            org_l2=None,
            org_l3=None,
            org_l4=None,
            org_l5=None,
            department="TeamA",
            role="user",
            active=True,
            email="",
        )
        async with SessionLocal() as session:
            await _upsert(session, fields)
            await session.commit()

    asyncio.run(_run())
    assert _korean_name_of("kr.sync") == "김철수"
