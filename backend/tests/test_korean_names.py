"""한글이름(korean_name) 필드·일괄 등록 엔드포인트 테스트 — spec 2026-07-09."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


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


def _get_korean_name(login_id: str) -> str | None:
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
    assert _get_korean_name("kr.sync") == "김철수"


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


def test_import_skip_mode_and_unknown(client: TestClient) -> None:
    _seed("kr.empty1", "")
    _seed("kr.taken", "기존이름")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={
            "mode": "skip",
            "entries": {"kr.empty1": " 신규이름 ", "kr.taken": "새이름", "kr.ghost": "유령"},
        },
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 1, "skipped": 1, "unknown": ["kr.ghost"]}
    assert _get_korean_name("kr.empty1") == "신규이름"  # trim 적용
    assert _get_korean_name("kr.taken") == "기존이름"  # skip — 기존 값 유지


def test_import_overwrite_mode(client: TestClient) -> None:
    _seed("kr.taken2", "기존이름")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "overwrite", "entries": {"kr.taken2": "새이름"}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 1, "skipped": 0, "unknown": []}
    assert _get_korean_name("kr.taken2") == "새이름"


def test_import_ignores_blank_values(client: TestClient) -> None:
    _seed("kr.blank", "기존")
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "overwrite", "entries": {"kr.blank": "   "}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0, "skipped": 0, "unknown": []}
    assert _get_korean_name("kr.blank") == "기존"  # 빈 값은 삭제가 아니라 무시


def test_import_rejects_bad_mode(client: TestClient) -> None:
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "merge", "entries": {}},
    )
    assert res.status_code == 422


def test_import_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "user.lee"},
        json={"mode": "skip", "entries": {}},
    )
    assert res.status_code == 403


def test_import_rejects_overlong_name(client: TestClient) -> None:
    """VARCHAR(200) 초과 이름은 422 — PG DataError 500 방지(경계 검증)."""
    res = client.put(
        "/api/employees/korean-names",
        headers={"X-Dev-User": "admin.kim"},
        json={"mode": "overwrite", "entries": {"kr.long": "가" * 201}},
    )
    assert res.status_code == 422
