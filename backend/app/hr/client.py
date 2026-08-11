"""n8n HR 웹훅 클라이언트 — 사용자·조직도 단일 소스.

설계: docs/design/2026-08-10-hr-webhook-directory-design.md §1·§2.
부분검색 불가 계약 — 단건은 반드시 loginId, 전수는 status=all.
"""

from dataclasses import dataclass

import httpx2

from app.settings import settings

# 계약 §1 — 전수 약 6,000명/3MB/수초, 상한 180초
HR_TIMEOUT_SECONDS = 180.0
# 로그인 크리티컬 패스 — /api/me 1인 동기화가 최대 대기하는 상한 (전수 180초는 부적합)
HR_SINGLE_TIMEOUT_SECONDS = 10.0
# EDW 부서장 목록 — 뷰 스캔이 느려 전수와 동일 180초 (9910 실측: 30초는 타임아웃)
HR_POSITION_TIMEOUT_SECONDS = 180.0


@dataclass(frozen=True)
class RawHrEmployee:
    login_id: str
    status: str | None  # "active" | "inactive" | None(결측 → 서비스가 active 보수 판정)
    name: str | None
    name_ko: str | None
    dept_code: str | None
    department: str | None
    department_ko: str | None
    org_levels: list[str]  # 루트→리프, 빈 단계 압축(최대 6)


@dataclass(frozen=True)
class RawHrPosition:
    emp_id: str
    dept_code: str | None
    name: str | None
    position: str


@dataclass(frozen=True)
class RawHrDepartment:
    dept_code: str
    name: str | None
    name_ko: str | None
    parent_dept_code: str | None
    level: int | None


def _clean(value: object) -> str | None:
    """문자열 필드 정규화 — 비문자열·공백은 None (loginId 외 전 필드 null 가능 계약)."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def parse_employee_row(row: object) -> RawHrEmployee | None:
    """employees row → RawHrEmployee. loginId 결측·비객체 행은 None — 호출부가 skip 카운트."""
    if not isinstance(row, dict):
        return None
    login_id = _clean(row.get("loginId"))
    if login_id is None:
        return None
    levels_raw = row.get("orgLevels")
    org_levels = (
        [lv for lv in (_clean(x) for x in levels_raw) if lv is not None]
        if isinstance(levels_raw, list)
        else []
    )
    return RawHrEmployee(
        login_id=login_id,
        status=_clean(row.get("status")),
        name=_clean(row.get("name")),
        name_ko=_clean(row.get("nameKo")),
        dept_code=_clean(row.get("deptCode")),
        department=_clean(row.get("department")),
        department_ko=_clean(row.get("departmentKo")),
        org_levels=org_levels,
    )


def parse_department_row(row: object) -> RawHrDepartment | None:
    """departments row → RawHrDepartment. deptCode 결측 행은 None."""
    if not isinstance(row, dict):
        return None
    dept_code = _clean(row.get("deptCode"))
    if dept_code is None:
        return None
    level = row.get("level")
    return RawHrDepartment(
        dept_code=dept_code,
        name=_clean(row.get("name")),
        name_ko=_clean(row.get("nameKo")),
        parent_dept_code=_clean(row.get("parentDeptCode")),
        level=level if isinstance(level, int) else None,
    )


def parse_position_row(row: object) -> RawHrPosition | None:
    """positions row 파싱 — empId·position 결측/비dict은 None(호출부가 skip)."""
    if not isinstance(row, dict):
        return None
    emp_id = _clean(row.get("empId"))
    position = _clean(row.get("position"))
    if not emp_id or not position:
        return None
    return RawHrPosition(
        emp_id=emp_id,
        dept_code=_clean(row.get("deptCode")),
        name=_clean(row.get("name")),
        position=position,
    )


async def _post(payload: dict, timeout: float = HR_TIMEOUT_SECONDS, url: str | None = None) -> dict:
    async with httpx2.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            url or settings.n8n_hr_url,
            json=payload,
            headers={"X-API-Key": settings.n8n_hr_token},
        )
        response.raise_for_status()
        body = response.json()
        return body if isinstance(body, dict) else {}


async def fetch_all_employees() -> tuple[int, list[RawHrEmployee | None]]:
    """전 직원(퇴직 포함, status=all). (응답 count, 행별 파싱 결과) — count·len 정합은 서비스가 검증."""
    body = await _post({"kind": "employees", "status": "all"})
    rows = body.get("rows") or []
    return int(body.get("count") or 0), [parse_employee_row(r) for r in rows]


async def fetch_employee(login_id: str) -> RawHrEmployee | None:
    """단건 조회 — 계약상 부분검색 불가, loginId 정확 일치만 신뢰."""
    body = await _post({"kind": "employees", "loginId": login_id}, timeout=HR_SINGLE_TIMEOUT_SECONDS)
    for row in body.get("rows") or []:
        parsed = parse_employee_row(row)
        if parsed is not None and parsed.login_id == login_id:
            return parsed
    return None


async def fetch_departments() -> list[RawHrDepartment]:
    body = await _post({"kind": "departments"})
    return [d for d in (parse_department_row(r) for r in body.get("rows") or []) if d is not None]


async def fetch_positions() -> list[RawHrPosition]:
    """EDW 부서장 목록 — n8n hr-position 워크플로(FRNM≠'프로' 필터 완료본)."""
    data = await _post({"kind": "positions"}, HR_POSITION_TIMEOUT_SECONDS, url=settings.n8n_position_url)
    rows = data.get("rows") if isinstance(data, dict) else None
    if not isinstance(rows, list):
        return []
    parsed = (parse_position_row(r) for r in rows)
    return [p for p in parsed if p is not None]
