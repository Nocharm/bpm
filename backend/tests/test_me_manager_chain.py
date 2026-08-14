"""/api/me manager_ids — 부서 체인(리프→루트) 노출 직책 보유자로 산출 (Task 4, design 2026-08-11 §5)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import Department, Employee


def _seed(*rows: Department | Employee) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for row in rows:
                await session.merge(row)
            await session.commit()

    asyncio.run(_run())


def _dept(code: str, parent: str | None = None) -> Department:
    return Department(dept_code=code, name=code, parent_dept_code=parent)


def _emp(
    login_id: str, dept_code: str | None, position: str | None = None, active: bool = True
) -> Employee:
    return Employee(
        login_id=login_id, name=login_id, dept_code=dept_code,
        position=position, active=active, source="local",
    )


def test_manager_ids_from_dept_chain_leaf_first(client: TestClient) -> None:
    """부서 체인(D1←D2←D3)의 노출 직책 보유자를 리프→루트 순으로 모은다."""
    _seed(
        _dept("MC1-D1"),
        _dept("MC1-D2", "MC1-D1"),
        _dept("MC1-D3", "MC1-D2"),
        _emp("mc1.lead1", "MC1-D1", position="센터장"),
        _emp("mc1.lead2", "MC1-D2", position="팀장"),
        _emp("mc1.me", "MC1-D3"),
    )
    res = client.get("/api/me", headers={"X-Dev-User": "mc1.me"})
    assert res.status_code == 200
    assert res.json()["manager_ids"] == ["mc1.lead2", "mc1.lead1"]


def test_manager_ids_excludes_non_allowlisted_position(client: TestClient) -> None:
    """allowlist 밖 직책(예: 프로외기타)은 부서장이어도 노출되지 않는다."""
    _seed(
        _dept("MC2-D1"),
        _dept("MC2-D2", "MC2-D1"),
        _dept("MC2-D3", "MC2-D2"),
        _emp("mc2.leadout", "MC2-D1", position="프로외기타"),
        _emp("mc2.leadin", "MC2-D2", position="팀장"),
        _emp("mc2.me", "MC2-D3"),
    )
    res = client.get("/api/me", headers={"X-Dev-User": "mc2.me"})
    assert res.json()["manager_ids"] == ["mc2.leadin"]


def test_manager_ids_excludes_inactive_and_self(client: TestClient) -> None:
    """퇴직(비활성) 리더는 제외되고, 본인이 자기 부서 리더여도 목록에서 빠진다."""
    _seed(
        _dept("MC3-D1"),
        _dept("MC3-D2", "MC3-D1"),
        _emp("mc3.leadinactive", "MC3-D1", position="센터장", active=False),
        _emp("mc3.me", "MC3-D2", position="팀장"),  # 본인이 자기 부서 리더
    )
    res = client.get("/api/me", headers={"X-Dev-User": "mc3.me"})
    assert res.json()["manager_ids"] == []


def test_manager_ids_empty_without_dept_code_or_departments(client: TestClient) -> None:
    """dept_code 미보유·departments에 없는 코드는 빈 목록으로 폴백한다."""
    _seed(_emp("mc4.nodept", None))
    res = client.get("/api/me", headers={"X-Dev-User": "mc4.nodept"})
    assert res.json()["manager_ids"] == []

    _seed(_emp("mc4.staledept", "MC4-GHOST"))  # departments에 등록되지 않은 코드
    res2 = client.get("/api/me", headers={"X-Dev-User": "mc4.staledept"})
    assert res2.json()["manager_ids"] == []


def test_exposed_positions_app_settings(client: TestClient) -> None:
    """노출 직책 allowlist GET 기본값·PUT 저장 반영·available_positions distinct 정렬."""
    from app.app_settings import DEFAULT_EXPOSED_POSITIONS

    body = client.get("/api/admin/app-settings").json()
    assert body["exposed_positions"] == DEFAULT_EXPOSED_POSITIONS

    _seed(_emp("mc5.holder", None, position="MC5-특수직책"))
    body = client.get("/api/admin/app-settings").json()
    assert "MC5-특수직책" in body["available_positions"]
    assert body["available_positions"] == sorted(body["available_positions"])

    put_body = client.put("/api/admin/app-settings", json={"exposed_positions": ["팀장"]}).json()
    assert put_body["exposed_positions"] == ["팀장"]
    # 복원 — 공유 DB 오염 방지
    client.put("/api/admin/app-settings", json={"exposed_positions": DEFAULT_EXPOSED_POSITIONS})
