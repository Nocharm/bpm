"""권한 판정·/api/me org_path가 departments 체인 resolver를 쓰는지 검증 (Task 3, brief).

Chain 시나리오는 org 컬럼 기준 판정이면 실패하도록 설계 — 통과 자체가 resolver 전환의 증거
(access.py는 test_permission_gates.py의 enforce/act_as/seed 컨벤션을 그대로 따른다).
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import Department, Employee, MapPermission, MapVersion, ProcessMap
from app.settings import settings

SYSADMIN = "orgperm.sys.admin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — is_sysadmin을 차별화해 부서 grant 판정을 실제로 태운다."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회) — test_permission_gates.py 미러."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _seed(coro_factory) -> object:
    async def _run() -> object:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def test_department_grant_uses_chain_path_not_org_columns(
    client: TestClient, enforce: None
) -> None:
    """부서 grant 판정이 org 컬럼이 아니라 departments 체인 경로를 쓰는지 증명.

    chain.user의 org_l1/department는 grant 대상과 무관한 레거시 값 — 판정이 org 컬럼
    기준이면 403이 나야 정상이다. 체인 경로("Chain Division/Chain Office")로 판정하므로
    viewer로 통과해야 resolver 전환이 실제로 적용된 것 (실패하면 access.py가 아직 org
    컬럼을 쓰고 있다는 뜻).
    """
    login_id = "orgperm.chain.user"

    async def _seed_dept_and_map(session) -> int:
        # 최상위 2레벨(법인·사업부급)은 해석 시 트림됨(settings.org_trim_levels) — 판정 경로에 안 낀다
        session.add_all(
            [
                Department(
                    dept_code="ORGPERM-D0a", name="Orgperm Corp", parent_dept_code=None, level=0
                ),
                Department(
                    dept_code="ORGPERM-D0b",
                    name="Orgperm BU",
                    parent_dept_code="ORGPERM-D0a",
                    level=1,
                ),
                Department(
                    dept_code="ORGPERM-D1",
                    name="Chain Division",
                    parent_dept_code="ORGPERM-D0b",
                    level=2,
                ),
                Department(
                    dept_code="ORGPERM-D2",
                    name="Chain Office",
                    parent_dept_code="ORGPERM-D1",
                    level=3,
                ),
            ]
        )
        emp = Employee(login_id=login_id, name="Chain User", source="local")
        emp.dept_code = "ORGPERM-D2"
        # org 컬럼은 grant 대상("Chain Division")과 무관 — 체인 미사용 시 403이 나야 함
        emp.org_l1 = "Legacy Root"
        emp.department = "Legacy Root"
        session.add(emp)

        m = ProcessMap(name="chain map", visibility="private", owner_id=None)
        m.versions.append(MapVersion(label="As-Is"))
        session.add(m)
        await session.flush()
        session.add(
            MapPermission(
                map_id=m.id,
                principal_type="department",
                principal_id="Chain Division",
                role="viewer",
                granted_by="seed",
            )
        )
        return m.id

    map_id = _seed(_seed_dept_and_map)

    act_as(login_id)
    resp = client.get(f"/api/maps/{map_id}")
    assert resp.status_code == 200, (
        "department grant should resolve via departments chain path, not org columns"
    )

    me = client.get("/api/me").json()
    assert me["org_path"] == "Chain Division/Chain Office"


def test_fallback_org_columns_when_no_dept_code(client: TestClient) -> None:
    """dept_code 미설정 직원은 기존과 동일하게 org_l1..l5 경로로 판정 (폴백 불변식)."""
    login_id = "orgperm.legacy.user"

    async def _seed_emp(session) -> None:
        emp = Employee(login_id=login_id, name="Legacy User", source="local")
        emp.dept_code = None
        emp.org_l1 = "Legacy Alpha"
        emp.org_l2 = "Legacy Beta"
        emp.department = "Legacy Beta"
        session.add(emp)

    _seed(_seed_emp)

    res = client.get("/api/me", headers={"X-Dev-User": login_id})
    assert res.status_code == 200
    assert res.json()["org_path"] == "Legacy Alpha/Legacy Beta"
