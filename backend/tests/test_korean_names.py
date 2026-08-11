"""한글이름(korean_name)·한글그룹(korean_dept) 필드 테스트 — spec 2026-07-09.

임포트 엔드포인트(PUT /korean-names)는 dept_info→departments 전환에 따라 제거됨
(2026-08-11, v2 Task 6) — 필드 자체(GET /api/employees 응답)와 라우트 부재만 검증한다.
"""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee


def _seed(login_id: str, korean_name: str = "", korean_dept: str = "") -> None:
    """employees 행 멱등 시드 — korean_name/korean_dept까지 지정."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            if emp is None:
                emp = Employee(login_id=login_id, source="local")
                session.add(emp)
            emp.korean_name = korean_name
            emp.korean_dept = korean_dept
            await session.commit()

    asyncio.run(_run())


def test_employees_include_korean_fields(client: TestClient) -> None:
    _seed("kr.have", "홍길동", "AI Operations그룹")
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {row["login_id"]: row for row in res.json()}
    assert by_id["kr.have"]["korean_name"] == "홍길동"
    assert by_id["kr.have"]["korean_dept"] == "AI Operations그룹"


def test_korean_names_import_route_removed(client: TestClient) -> None:
    """PUT /api/employees/korean-names — 임포트 API 제거 확인 (dept_info→departments 전환)."""
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "skip", "entries": {}},
    )
    assert res.status_code == 404
