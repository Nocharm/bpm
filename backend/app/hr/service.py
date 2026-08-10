"""HR 웹훅 동기화 서비스 — 전체/단건 동기화·부서 미러·이행 프리뷰.

설계: docs/design/2026-08-10-hr-webhook-directory-design.md §4~§6·§9.
title은 절대 건드리지 않는다 — AD title 패스(app/ad/service.refresh_titles) 전용.
"""

import logging
from dataclasses import dataclass

from app.hr.client import RawHrEmployee
from app.settings import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class HrEmployeeFields:
    login_id: str
    name: str
    korean_name: str | None  # None = HR 결측 → 기존값 보존(소거 아님)
    korean_dept: str | None
    dept_code: str | None
    department: str
    org_l1: str | None
    org_l2: str | None
    org_l3: str | None
    org_l4: str | None
    org_l5: str | None
    active: bool
    role: str
    dept_mismatch: bool  # department != 저장 경로 리프 — 부서 권한 매칭 사각 리포트용 (§4)
    truncated: bool      # orgLevels 6단계 이상 절사 리포트용


def _resolve_role(login_id: str) -> str:
    return "admin" if login_id in settings.admin_login_ids() else "user"


def to_employee_fields(raw: RawHrEmployee) -> HrEmployeeFields:
    """RawHrEmployee → 저장 필드. 순수 — DB 미접근. 매핑 표는 설계 §4."""
    top5 = raw.org_levels[:5]  # 5레벨 초과는 루트 쪽 5개 (AD parse_org와 동일 규약)
    l1 = top5[0] if len(top5) > 0 else None
    l2 = top5[1] if len(top5) > 1 else None
    l3 = top5[2] if len(top5) > 2 else None
    l4 = top5[3] if len(top5) > 3 else None
    l5 = top5[4] if len(top5) > 4 else None
    stored_leaf = l5 or l4 or l3 or l2 or l1
    department = raw.department or stored_leaf or ""
    return HrEmployeeFields(
        login_id=raw.login_id,
        name=raw.name or raw.login_id,
        korean_name=raw.name_ko,
        korean_dept=raw.department_ko,
        dept_code=raw.dept_code,
        department=department,
        org_l1=l1, org_l2=l2, org_l3=l3, org_l4=l4, org_l5=l5,
        # status 결측은 보수적으로 활성 — AD uac None 관례와 동일
        active=(raw.status or "active") == "active",
        role=_resolve_role(raw.login_id),
        dept_mismatch=bool(department and stored_leaf and department != stored_leaf),
        truncated=len(raw.org_levels) > 5,
    )
