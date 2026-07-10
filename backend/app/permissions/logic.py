"""권한 판정 순수 함수 — DB 미접근, 입력값 명시적 전달로 단위 테스트 가능.

Frontend mock `permissions-logic.ts`의 우선순위를 Python으로 이식.
"""

from app.ad.org import org_path
from app.settings import settings

# 역할 서열 — None 은 role_rank() 에서 0 반환
ROLE_RANK: dict[str, int] = {"viewer": 1, "editor": 2, "owner": 3}


def role_rank(role: str | None) -> int:
    """역할 문자열 → 서열 정수. None(미부여) = 0."""
    return ROLE_RANK.get(role or "", 0)


def is_downgrade(from_role: str | None, to_role: str | None) -> bool:
    """to_role 이 from_role 보다 낮거나 None(제거)이면 True."""
    return role_rank(to_role) < role_rank(from_role)


def requires_downgrade_approval(from_role: str | None, to_role: str | None) -> bool:
    """editor → viewer/제거만 승인 게이트 (설계 §4③, mock parity)."""
    return from_role == "editor" and (to_role == "viewer" or to_role is None)


def belongs_to_department(emp_org_path: str, principal_id: str) -> bool:
    """직원이 principal_id 부서(또는 그 하위)에 속하는지 판정.

    정확 일치(exact) 또는 prefix + "/" 경계로 비교 — 부분 문자열 오검출 방지.
    예: principal='Management Support Division/Procurement Office'
      '…/Procurement Office'                  → True  (exact)
      '…/Procurement Office/Sourcing Team 1'  → True  (prefix/)
      '…/ProcurementOffice'                   → False (경계 없는 부분 일치)
    """
    return emp_org_path == principal_id or emp_org_path.startswith(principal_id + "/")


def is_sysadmin(login_id: str) -> bool:
    """BPM 시스템 관리자 판정.

    auth OFF + dev_enforce_permissions OFF → 전원 True (로컬 잠금 방지, 현행 동작).
    auth OFF + dev_enforce_permissions ON  → BPM_SYSADMINS 목록만 True (로컬 권한 시뮬레이션).
    auth ON                                → BPM_SYSADMINS 목록만 True.
    """
    if (not settings.auth_enabled) and (not settings.dev_enforce_permissions):
        return True
    return login_id in settings.sysadmin_login_ids()


# permission 튜플: (principal_type, principal_id, role)
# principal_type: 'user' | 'department' | 'group'
Permission = tuple[str, str, str]


def effective_role(
    login_id: str,
    is_sysadmin_flag: bool,
    emp_org_path: str,
    visibility: str,
    permissions: list[Permission],
    is_approver: bool,
    user_group_ids: set[str],
    owning_department: str | None = None,
) -> str | None:
    """맵에 대한 유효 역할 판정 (mock getEffectiveRole parity).

    우선순위 (상위가 먼저):
    1. sysadmin → 'owner'
    2. 적용되는 map_permissions 중 최고 역할 (user/department/group — 그룹은
       principal_id ∈ user_group_ids 일 때만 적용; user_group_ids 는 호출자가 속한
       ACTIVE 그룹 id들의 문자열 집합으로 caller가 주입한다 — 순수성 유지)
    2.5 오우닝 부서 소속(하위 포함) → 'editor' 바닥값 — 권한 행 없는 파생 (2026-07-10)
    3. visibility == 'public' → 'viewer' baseline
    4. is_approver → 'viewer' floor (2/3 에서 역할 없을 때만)
    5. None (접근 불가)
    """
    # 1. sysadmin
    if is_sysadmin_flag:
        return "owner"

    # 2. 적용 가능한 권한 중 최고 역할 — group은 caller가 속한 active 그룹일 때만
    best: str | None = None
    for ptype, pid, role in permissions:
        if ptype == "user" and pid == login_id:
            pass  # applicable
        elif ptype == "department" and belongs_to_department(emp_org_path, pid):
            pass  # applicable
        elif ptype == "group" and pid in user_group_ids:
            pass  # applicable — 호출자가 이 active 그룹의 멤버
        else:
            continue  # 비적용 (다른 user/dept, 또는 미가입 group)
        if role_rank(role) > role_rank(best):
            best = role

    # 2.5 오우닝 부서 파생 editor — 소속(prefix 하위 포함)이면 바닥값. 권한 행이 없어
    # 해제·다운그레이드가 불가능하다 = "잠금" (spec 2026-07-10)
    if (
        owning_department
        and belongs_to_department(emp_org_path, owning_department)
        and role_rank("editor") > role_rank(best)
    ):
        best = "editor"

    if best is not None:
        return best

    # 3. public visibility baseline
    if visibility == "public":
        return "viewer"

    # 4. approver floor
    if is_approver:
        return "viewer"

    # 5. no access
    return None


def is_visible(
    login_id: str,
    is_sysadmin_flag: bool,
    emp_org_path: str,
    visibility: str,
    permissions: list[Permission],
    is_approver: bool,
    user_group_ids: set[str],
    owning_department: str | None = None,
) -> bool:
    """effective_role is not None."""
    return (
        effective_role(
            login_id,
            is_sysadmin_flag,
            emp_org_path,
            visibility,
            permissions,
            is_approver,
            user_group_ids,
            owning_department=owning_department,
        )
        is not None
    )


def can_comment(role: str | None) -> bool:
    """viewer 이상(role not None)이면 댓글 가능."""
    return role is not None


# Re-export org_path so callers can build emp_org_path without importing app.ad.org directly
__all__ = [
    "ROLE_RANK",
    "role_rank",
    "is_downgrade",
    "requires_downgrade_approval",
    "belongs_to_department",
    "is_sysadmin",
    "effective_role",
    "is_visible",
    "can_comment",
    "org_path",
    "Permission",
]
