"""GET /api/directory — 인증 사용자 공개 디렉터리 엔드포인트 테스트 (Layer 4 Task 0)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import DeptInfo, Employee


def test_directory_accessible_by_non_admin(client: TestClient) -> None:
    """non-admin 사용자가 200을 받고 영문 사용자 목록 + 부서 org-path 를 반환받는다."""
    # user.lee는 일반 user role
    res = client.get("/api/directory", headers={"X-Dev-User": "user.lee"})
    assert res.status_code == 200

    body = res.json()
    user_ids = [u["id"] for u in body["users"]]
    dept_ids = [d["id"] for d in body["departments"]]

    # 5명 이상의 영문 사용자 시드가 포함되어야 한다 / At least 5 English users from seed.
    assert len(body["users"]) >= 5

    # 영문 이름 확인 (한글 이름은 없어야 함) / English names only — no Korean.
    for u in body["users"]:
        assert not any(
            "가" <= ch <= "힣" for ch in u["name"]
        ), f"Korean name found in directory: {u['name']}"

    # login_id 포함 여부 / login_ids present.
    assert "user.lee" in user_ids
    assert "admin.kim" in user_ids

    # 부서 org-path 목록 — Management Support Division(l1)이 포함되어야 함 /
    # Department org-paths include l1 prefix.
    assert "Management Support Division" in dept_ids

    # Procurement Office(l2) 프리픽스 포함 / l2 prefix included.
    assert "Management Support Division/Procurement Office" in dept_ids

    # 리프 팀(Sourcing Team 1)도 포함 / leaf team included.
    assert "Management Support Division/Procurement Office/Sourcing Team 1" in dept_ids


def test_directory_admin_also_accessible(client: TestClient) -> None:
    """admin 사용자도 정상 접근 / admin can also access the directory."""
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    assert len(res.json()["users"]) >= 5


def test_directory_includes_korean_name(client: TestClient) -> None:
    """멤버 카드 한/영 토글용 — /api/directory 유저 항목에 korean_name 노출."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_name = "이민재"
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["id"]: u for u in res.json()["users"]}
    assert by_id["user.lee"]["korean_name"] == "이민재"


def test_directory_includes_korean_dept(client: TestClient) -> None:
    """멤버 카드 한/영 토글용 — /api/directory 유저 항목에 korean_dept 노출."""

    async def _run() -> None:
        async with SessionLocal() as session:
            emp = await session.get(Employee, "user.lee")
            emp.korean_dept = "소싱1팀"
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    by_id = {u["id"]: u for u in res.json()["users"]}
    assert by_id["user.lee"]["korean_dept"] == "소싱1팀"


def test_directory_departments_include_dept_info(client: TestClient) -> None:
    """피커 부서 검색·한/영 표시용 — 부서 항목에 dept_info(한글 부서명·부서장) 조인."""

    async def _run() -> None:
        async with SessionLocal() as session:
            await session.merge(
                DeptInfo(department="Sourcing Team 1", korean_name="구매1팀", manager="hong.gildong")
            )
            await session.commit()

    asyncio.run(_run())
    res = client.get("/api/directory", headers={"X-Dev-User": "admin.kim"})
    assert res.status_code == 200
    depts = {d["name"]: d for d in res.json()["departments"]}
    assert depts["Sourcing Team 1"]["korean_name"] == "구매1팀"
    assert depts["Sourcing Team 1"]["manager"] == "hong.gildong"
    # dept_info 없는 부서(상위 조직 프리픽스)는 빈 문자열 기본값
    assert depts["Management Support Division"]["korean_name"] == ""
    assert depts["Management Support Division"]["manager"] == ""
