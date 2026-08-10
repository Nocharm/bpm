"""HR 스키마 테스트 — departments 테이블·dept_code 컬럼·email 모델 제거 회귀."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Department, Employee


def test_employee_insert_without_email_and_department_table(client: TestClient) -> None:
    """email 모델 제거 후 신규 INSERT 성공 + departments 테이블 생성 확인 (설계 §3)."""

    async def _run() -> tuple[bool, bool]:
        async with SessionLocal() as session:
            emp = Employee(login_id="hr.schema-probe", name="Probe", source="hr", dept_code="D9")
            session.add(emp)
            session.add(Department(dept_code="D9", name="Probe Team", name_ko="프로브팀", level=3))
            await session.commit()
            saved = await session.get(Employee, "hr.schema-probe")
            dept = await session.get(Department, "D9")
            return saved is not None and saved.dept_code == "D9", dept is not None

    emp_ok, dept_ok = asyncio.run(_run())
    assert emp_ok and dept_ok


def test_employee_model_has_no_email() -> None:
    assert not hasattr(Employee, "email")
