"""HR 웹훅 클라이언트 파싱 테스트 — 순수 함수(HTTP 없음). 설계 §1 계약: loginId 외 전부 null 가능."""

from app.hr.client import RawHrEmployee, parse_department_row, parse_employee_row


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
