"""HR 웹훅 클라이언트 파싱 테스트 — 순수 함수(HTTP 없음). 설계 §1 계약: loginId 외 전부 null 가능."""

import asyncio

from app.hr import client as hr_client
from app.hr.client import (
    RawHrEmployee,
    RawHrPosition,
    parse_department_row,
    parse_employee_row,
    parse_position_row,
)
from app.settings import settings


def test_parse_employee_full_row() -> None:
    row = {
        "loginId": "hong.gd", "status": "active", "name": "Gildong Hong",
        "nameKo": "홍길동", "deptCode": "D100", "department": "Sourcing Team 1",
        "departmentKo": "구매1팀",
        "orgLevels": ["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    }
    parsed = parse_employee_row(row)
    assert parsed == RawHrEmployee(
        login_id="hong.gd", status="active", name="Gildong Hong", name_ko="홍길동",
        dept_code="D100", department="Sourcing Team 1", department_ko="구매1팀",
        org_levels=["Management Support Division", "Procurement Office", "Sourcing Team 1"],
    )


def test_parse_employee_nulls_and_blank_levels() -> None:
    # loginId 외 전부 null/공백 — 전부 None, orgLevels의 빈 항목은 압축
    row = {"loginId": " kim.cs ", "status": None, "name": "", "orgLevels": ["A", "", None, "B"]}
    parsed = parse_employee_row(row)
    assert parsed is not None
    assert parsed.login_id == "kim.cs"
    assert parsed.status is None and parsed.name is None
    assert parsed.org_levels == ["A", "B"]


def test_parse_employee_missing_login_id_returns_none() -> None:
    assert parse_employee_row({"name": "X"}) is None
    assert parse_employee_row({"loginId": "  "}) is None
    assert parse_employee_row("not-a-dict") is None


def test_parse_department_row() -> None:
    parsed = parse_department_row(
        {"deptCode": "D100", "name": "HR Team", "nameKo": "인사팀", "parentDeptCode": "D1", "level": 3}
    )
    assert parsed is not None
    assert (parsed.dept_code, parsed.parent_dept_code, parsed.level) == ("D100", "D1", 3)
    assert parse_department_row({"name": "no code"}) is None
    assert parse_department_row({"deptCode": "D2", "level": "bad"}).level is None


def test_parse_position_row() -> None:
    assert parse_position_row("not-a-dict") is None
    assert parse_position_row({"deptCode": "D1", "position": "Team Lead"}) is None  # empId 결측
    assert parse_position_row({"empId": "100", "deptCode": "D1", "name": "Kim"}) is None  # position 결측
    parsed = parse_position_row(
        {"empId": " 100 ", "deptCode": "D1", "name": " Kim ", "position": " Team Lead "}
    )
    assert parsed == RawHrPosition(emp_id="100", dept_code="D1", name="Kim", position="Team Lead")


def test_fetch_positions_parses_rows(monkeypatch) -> None:
    captured: dict = {}

    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS, url: str | None = None) -> dict:
        captured["url"] = url
        captured["timeout"] = timeout
        return {"kind": "positions", "rows": [{"empId": "100", "position": "Team Lead"}]}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    monkeypatch.setattr(settings, "n8n_position_url", "http://hr.local/webhook/position")
    result = asyncio.run(hr_client.fetch_positions())
    assert result == [RawHrPosition(emp_id="100", dept_code=None, name=None, position="Team Lead")]
    assert captured["url"] == "http://hr.local/webhook/position"
    assert captured["timeout"] == hr_client.HR_POSITION_TIMEOUT_SECONDS


def test_fetch_positions_malformed_rows_returns_empty(monkeypatch) -> None:
    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS, url: str | None = None) -> dict:
        return {"rows": "not-a-list"}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    assert asyncio.run(hr_client.fetch_positions()) == []


def test_fetch_employee_uses_single_timeout(monkeypatch) -> None:
    """단건 조회는 전수용 180초가 아닌 로그인 크리티컬 패스용 10초 타임아웃 사용 (F2)."""
    captured: dict = {}

    async def fake_post(payload: dict, timeout: float = hr_client.HR_TIMEOUT_SECONDS) -> dict:
        captured["timeout"] = timeout
        return {"rows": []}

    monkeypatch.setattr(hr_client, "_post", fake_post)
    asyncio.run(hr_client.fetch_employee("someone"))
    assert captured["timeout"] == hr_client.HR_SINGLE_TIMEOUT_SECONDS == 10.0
