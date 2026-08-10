"""Employee 모델·동기화·엔드포인트 테스트."""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Employee
from app.settings import settings


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim — sysadmin 게이트 차별화. 정리 시 복원."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_employees_table_created(client: TestClient) -> None:
    # client fixture는 직접 호출하지 않고 lifespan(create_all + 로컬 시드) 트리거 용도
    async def _count() -> int:
        async with SessionLocal() as session:
            return len(list((await session.scalars(select(Employee))).all()))

    assert asyncio.run(_count()) >= 5  # 로컬 임시 유저 5명 시드됨


def test_get_current_user_prefers_dev_header() -> None:
    # auth_enabled=False(기본)일 때 X-Dev-User 우선, 없으면 dev_user
    from app.auth import get_current_user
    from app.settings import settings

    assert get_current_user(authorization=None, x_dev_user="admin.kim") == "admin.kim"
    assert get_current_user(authorization=None, x_dev_user=None) == settings.dev_user


def test_me_includes_manager_ids_chain(client: TestClient) -> None:
    """/api/me manager_ids — 내 org 체인(리프→루트) 부서장, 본인 제외·빈값 제외 (피커 Manager 라벨)."""
    from app.models import DeptInfo

    async def _run() -> None:
        async with SessionLocal() as session:
            # admin.kim org: Management Support Division / Process Innovation Office / Process Innovation Team
            await session.merge(DeptInfo(department="Process Innovation Team", korean_name="", manager="lead.kim"))
            await session.merge(DeptInfo(department="Process Innovation Office", korean_name="", manager="head.lee"))
            # 본인이 부서장인 상위 레벨 — 본인은 제외돼야 함
            await session.merge(DeptInfo(department="Management Support Division", korean_name="", manager="admin.kim"))
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/me", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    # 리프(직속)→루트 순, 본인 제외
    assert res.json()["manager_ids"] == ["lead.kim", "head.lee"]

    # 직원 미존재 유저 — 빈 목록
    res2 = client.get("/api/me", headers={"X-Dev-User": "unknown.person"})
    assert res2.json()["manager_ids"] == []


def test_me_uses_dev_user_header(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "admin.kim"
    assert body["role"] == "admin"
    assert body["department"] == "Process Innovation Team"


def test_me_falls_back_for_unknown_user(client: TestClient) -> None:
    res = client.get("/api/me", headers={"X-Dev-User": "unknown.person"})
    assert res.status_code == 200
    body = res.json()
    assert body["username"] == "unknown.person"
    assert body["role"] == "user"  # employees에 없으면 기본 user


def test_me_records_login_once_per_day(client: TestClient) -> None:
    """/api/me는 현황조사용 LoginRecord를 하루 1건만 기록(중복제거) — 맵 열 때마다 안 찍힘."""
    from app.models import LoginRecord

    async def _count(login_id: str) -> int:
        async with SessionLocal() as session:
            rows = (
                await session.scalars(
                    select(LoginRecord).where(LoginRecord.login_id == login_id)
                )
            ).all()
            return len(list(rows))

    # 같은 날 여러 번 호출(새 탭·새로고침 모사) → 1건만
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    client.get("/api/me", headers={"X-Dev-User": "record.me"})
    assert asyncio.run(_count("record.me")) == 1


def test_employees_list_requires_admin(client: TestClient, sysadmin_enforced: None) -> None:
    # 일반 유저(비-sysadmin) → 403, sysadmin(admin.kim) → 200 (F6: admin 흡수)
    assert client.get("/api/employees", headers={"X-Dev-User": "user.lee"}).status_code == 403
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    assert len(res.json()) >= 5


def test_employees_list_includes_active_and_sysadmin(
    client: TestClient, sysadmin_enforced: None
) -> None:
    # 설정 사용자 탭 흡수 — 직원 목록이 active와 is_sysadmin(env 계산값)을 함께 반환
    res = client.get("/api/employees", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {r["login_id"]: r for r in res.json()}
    assert by_id["admin.kim"]["is_sysadmin"] is True
    assert by_id["user.lee"]["is_sysadmin"] is False
    assert isinstance(by_id["user.lee"]["active"], bool)


def test_sync_requires_admin(client: TestClient, sysadmin_enforced: None) -> None:
    assert client.post("/api/employees/sync", headers={"X-Dev-User": "user.lee"}).status_code == 403


# ── 비활성 계정 제외 (design 2026-07-09) — sync-mocked/스테일 프룬 커버리지는
# app.hr.service 이관(2026-08-10)으로 tests/test_hr_sync.py·test_hr_endpoints.py가 대체.
# to_employee_fields 자체는 ad/service 축소(Task 6)로 제거 — is_active 순수 테스트는
# tests/test_ad_active.py에 유지 ──
