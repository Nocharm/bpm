"""권한 판정 순수 함수 — DB 미접근, 입력값 명시적 전달로 단위 테스트 가능.

Frontend mock `permissions-logic.ts`의 우선순위를 Python으로 이식.
"""

from typing import TYPE_CHECKING

from app.ad.org import org_path
from app.settings import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# 역할 서열 — None 은 role_rank() 에서 0 반환
ROLE_RANK: dict[str, int] = {"viewer": 1, "editor": 2, "owner": 3}


def role_rank(role: str | None) -> int:
    """역할 문자열 → 서열 정수. None(미부여) = 0."""
    return ROLE_RANK.get(role or "", 0)


def is_downgrade(from_role: str | None, to_role: str | None) -> bool:
    """to_role 이 from_role 보다 낮거나 None(제거)이면 True."""
    return role_rank(to_role) < role_rank(from_role)


def requires_downgrade_approval(from_role: str | None, to_role: str | None) -> bool:
    """editor → viewer/제거만 승인 게이트 (설계 §4③, mock parity).

    ⚠️ FE 미러: frontend/src/lib/permission-staging.ts forecastStagedOp — 규칙 수정 시 동기화.
    """
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


# 설정 화면에서 부여한 sysadmin — local_credentials가 원본, 이건 조회 캐시다 (설계 §3.1).
# is_sysadmin은 동기 함수이고 앱 33곳이 세션 없이 호출하므로 DB를 직접 읽을 수 없다.
# 전제: 백엔드는 단일 uvicorn 프로세스(Dockerfile에 --workers 없음). 워커를 늘리면
# 프로세스별 캐시가 갈라져 부여·회수가 일부 워커에만 반영된다 → 그때는 DB 조회로 전환할 것.
_granted_sysadmins: set[str] = set()


def grant_sysadmin_cache(login_ids: set[str]) -> None:
    """캐시 전체 교체 — 기동 시 DB 로드용."""
    global _granted_sysadmins
    _granted_sysadmins = set(login_ids)


def add_granted_sysadmin(login_id: str) -> None:
    _granted_sysadmins.add(login_id)


def remove_granted_sysadmin(login_id: str) -> None:
    _granted_sysadmins.discard(login_id)


def is_sysadmin(login_id: str) -> bool:
    """BPM 시스템 관리자 판정.

    dev 모드 + dev_enforce_permissions OFF → 전원 True (로컬 잠금 방지, 현행 동작).
    그 외 → BPM_SYSADMINS 목록(모든 모드) 또는 설정 화면에서 부여한 로컬 계정
    (_granted_sysadmins — ldap 모드 한정, 설계 §9.4가 허용한 바이패스는 ldap
    모드에 한해서만 적용된다. keycloak/dev 전환 후 남은 부여분이 동일 로그인 id의
    Keycloak 계정에 새어들지 않도록 predicate에서 직접 게이팅한다).
    """
    if settings.resolved_auth_mode() == "dev" and not settings.dev_enforce_permissions:
        return True
    if login_id in settings.sysadmin_login_ids():
        return True
    return settings.resolved_auth_mode() == "ldap" and login_id in _granted_sysadmins


def list_sysadmin_logins() -> set[str]:
    """알림 수신자용 sysadmin 로그인 전체 열거 — is_sysadmin과 동일 소스(BPM_SYSADMINS +
    ldap 모드의 로컬 부여분), dev 모드의 '전원 True' 바이패스는 열거 불가라 반영하지 않는다
    (fw_confirm_requested 등 수신자 계산, 2026-09-02).
    """
    ids = set(settings.sysadmin_login_ids())
    if settings.resolved_auth_mode() == "ldap":
        ids |= _granted_sysadmins
    return ids


async def load_granted_sysadmins(session: "AsyncSession") -> None:
    """기동 시 local_credentials에서 부여분을 읽어 캐시를 채운다."""
    from sqlalchemy import select

    from app.models import LocalCredential

    rows = await session.execute(
        select(LocalCredential.login_id).where(LocalCredential.is_sysadmin.is_(True))
    )
    grant_sysadmin_cache({row[0] for row in rows})


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


# 대시보드 열람 principal 튜플: (principal_type, principal_id) — 역할 구분 없음
DashboardPrincipal = tuple[str, str]


def can_view_dashboard(
    is_sysadmin_flag: bool,
    login_id: str,
    emp_org_path: str,
    user_group_ids: set[str],
    principals: list[DashboardPrincipal],
) -> bool:
    """대시보드 열람 권한 판정 (순수 함수 — DB 미접근).

    sysadmin이면 True 반환. 그 외엔 principals에 적용되는 행이 있으면 True.
    principal 해석 규약은 map_permissions과 동일:
    - user: login_id 일치만 인정
    - department: emp_org_path가 principal_id (또는 하위)에 속하면 인정
    - group: principal_id가 user_group_ids (caller 소속 ACTIVE 그룹)에 있으면 인정
    """
    if is_sysadmin_flag:
        return True

    for ptype, pid in principals:
        if ptype == "user" and pid == login_id:
            return True
        if ptype == "department" and belongs_to_department(emp_org_path, pid):
            return True
        if ptype == "group" and pid in user_group_ids:
            return True
    return False


# Re-export org_path so callers can build emp_org_path without importing app.ad.org directly
__all__ = [
    "ROLE_RANK",
    "role_rank",
    "is_downgrade",
    "requires_downgrade_approval",
    "belongs_to_department",
    "is_sysadmin",
    "list_sysadmin_logins",
    "effective_role",
    "is_visible",
    "can_comment",
    "can_view_dashboard",
    "org_path",
    "Permission",
    "DashboardPrincipal",
]
