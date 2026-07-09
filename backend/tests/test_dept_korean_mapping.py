"""부서 한글명 매핑 — /admin/users korean 필드 노출 + 부서 전원 korean_dept 일괄 갱신."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


def _seed_org(
    login_id: str, levels: list[str], korean_dept: str = "", korean_name: str = ""
) -> None:
    """org 경로까지 지정하는 멱등 시드 — 부서 매핑 테스트용."""

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


def _get_korean_dept(login_id: str) -> str | None:
    async def _run() -> str | None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, login_id)
            return None if emp is None else emp.korean_dept

    return asyncio.run(_run())


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


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    """enforce ON + sysadmin=admin.kim — 비 sysadmin 403 검증용(test_employees.py와 동일 패턴)."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_admin_users_include_korean_fields(client: TestClient) -> None:
    _seed_org("dk.user1", ["HQ", "DeptB", "TeamA"], korean_dept="팀A", korean_name="김하나")
    res = client.get("/api/admin/users", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["login_id"]: u for u in res.json()["users"]}
    assert by_id["dk.user1"]["korean_dept"] == "팀A"
    assert by_id["dk.user1"]["korean_name"] == "김하나"


def test_dept_mapping_updates_exact_path_only(client: TestClient) -> None:
    _seed_org("dk.a1", ["HQ", "DeptB", "TeamA"], korean_dept="팀A구")
    _seed_org("dk.a2", ["HQ", "DeptB", "TeamA"], korean_dept="")
    _seed_org("dk.child", ["HQ", "DeptB", "TeamA", "Cell1"], korean_dept="셀1")
    _seed_org("dk.sibling", ["HQ", "DeptB", "TeamB"], korean_dept="팀B")
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": ["HQ", "DeptB", "TeamA"], "korean_dept": " 팀A그룹 "},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 2}
    # 전원 덮어쓰기(빈 값·다른 값 모두) + trim, 하위/형제 경로 미간섭
    assert _get_korean_dept("dk.a1") == "팀A그룹"
    assert _get_korean_dept("dk.a2") == "팀A그룹"
    assert _get_korean_dept("dk.child") == "셀1"
    assert _get_korean_dept("dk.sibling") == "팀B"


def test_dept_mapping_unknown_path_updates_zero(client: TestClient) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": ["No", "Such", "Path"], "korean_dept": "무소속"},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0}


def test_dept_mapping_rejects_blank_and_overlong(client: TestClient) -> None:
    for korean_dept in ("   ", "그" * 201):
        res = client.put(
            "/api/admin/departments/korean-dept",
            headers={"X-Dev-User": "admin.kim"},
            json={"org_levels": ["HQ"], "korean_dept": korean_dept},
        )
        assert res.status_code == 422


def test_dept_mapping_rejects_empty_levels(client: TestClient) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "admin.kim"},
        json={"org_levels": [], "korean_dept": "무소속"},
    )
    assert res.status_code == 422


def test_dept_mapping_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.put(
        "/api/admin/departments/korean-dept",
        headers={"X-Dev-User": "user.lee"},
        json={"org_levels": ["HQ"], "korean_dept": "무소속"},
    )
    assert res.status_code == 403
