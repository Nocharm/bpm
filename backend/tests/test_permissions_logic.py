"""권한 판정 순수 함수 회귀 테스트 — DB 미접근, 시드 3패턴 검증."""

import pytest

from app.ad.org import org_path
from app.permissions.logic import (
    belongs_to_department,
    can_comment,
    effective_role,
    is_downgrade,
    is_sysadmin,
    is_visible,
    requires_downgrade_approval,
    role_rank,
)

# ---------------------------------------------------------------------------
# 시드 유저 org_path 상수 (service.py LOCAL_USERS 값과 동기)
# ---------------------------------------------------------------------------
PATH_KIM = org_path("경영지원본부", "프로세스혁신실", "프로세스혁신팀", None, None, "프로세스혁신팀")
PATH_LEE = org_path("경영지원본부", "구매실", "구매1팀", None, None, "구매1팀")
PATH_PARK = org_path("경영지원본부", "구매실", "구매1팀", None, None, "구매1팀")
PATH_CHOI = org_path("경영지원본부", "구매실", "구매2팀", None, None, "구매2팀")
PATH_JUNG = org_path("경영지원본부", "구매실", None, None, None, "구매실")

# 기대 경로 문자열
assert PATH_LEE == "경영지원본부/구매실/구매1팀"
assert PATH_PARK == "경영지원본부/구매실/구매1팀"
assert PATH_CHOI == "경영지원본부/구매실/구매2팀"
assert PATH_JUNG == "경영지원본부/구매실"
assert PATH_KIM == "경영지원본부/프로세스혁신실/프로세스혁신팀"


# ---------------------------------------------------------------------------
# 1. role_rank / is_downgrade / requires_downgrade_approval
# ---------------------------------------------------------------------------

class TestRoleRank:
    def test_order(self) -> None:
        assert role_rank(None) == 0
        assert role_rank("viewer") == 1
        assert role_rank("editor") == 2
        assert role_rank("owner") == 3

    def test_unknown_treated_as_none(self) -> None:
        assert role_rank("bogus") == 0


class TestIsDowngrade:
    def test_editor_to_viewer_is_downgrade(self) -> None:
        assert is_downgrade("editor", "viewer") is True

    def test_editor_to_none_is_downgrade(self) -> None:
        assert is_downgrade("editor", None) is True

    def test_editor_to_owner_is_not_downgrade(self) -> None:
        assert is_downgrade("editor", "owner") is False

    def test_viewer_to_viewer_not_downgrade(self) -> None:
        assert is_downgrade("viewer", "viewer") is False

    def test_viewer_to_owner_not_downgrade(self) -> None:
        assert is_downgrade("viewer", "owner") is False


class TestRequiresDowngradeApproval:
    def test_editor_to_viewer_requires_approval(self) -> None:
        assert requires_downgrade_approval("editor", "viewer") is True

    def test_editor_to_none_requires_approval(self) -> None:
        assert requires_downgrade_approval("editor", None) is True

    def test_editor_to_owner_does_not(self) -> None:
        assert requires_downgrade_approval("editor", "owner") is False

    def test_viewer_to_none_does_not(self) -> None:
        assert requires_downgrade_approval("viewer", None) is False

    def test_owner_to_viewer_does_not(self) -> None:
        assert requires_downgrade_approval("owner", "viewer") is False


# ---------------------------------------------------------------------------
# 2. belongs_to_department — 시드 3패턴 prefix 매트릭스
# ---------------------------------------------------------------------------

class TestBelongsToDepartment:
    # principal: 구매1팀 (leaf) → lee/park True, 나머지 False
    def test_leaf_principal_lee(self) -> None:
        assert belongs_to_department(PATH_LEE, "경영지원본부/구매실/구매1팀") is True

    def test_leaf_principal_park(self) -> None:
        assert belongs_to_department(PATH_PARK, "경영지원본부/구매실/구매1팀") is True

    def test_leaf_principal_choi_false(self) -> None:
        assert belongs_to_department(PATH_CHOI, "경영지원본부/구매실/구매1팀") is False

    def test_leaf_principal_jung_false(self) -> None:
        assert belongs_to_department(PATH_JUNG, "경영지원본부/구매실/구매1팀") is False

    def test_leaf_principal_kim_false(self) -> None:
        assert belongs_to_department(PATH_KIM, "경영지원본부/구매실/구매1팀") is False

    # principal: 구매실 (mid) → lee/park/choi True, jung True (exact), kim False
    def test_mid_principal_lee(self) -> None:
        assert belongs_to_department(PATH_LEE, "경영지원본부/구매실") is True

    def test_mid_principal_park(self) -> None:
        assert belongs_to_department(PATH_PARK, "경영지원본부/구매실") is True

    def test_mid_principal_choi(self) -> None:
        assert belongs_to_department(PATH_CHOI, "경영지원본부/구매실") is True

    def test_mid_principal_jung_exact(self) -> None:
        # jung's path IS 경영지원본부/구매실 (exact match)
        assert belongs_to_department(PATH_JUNG, "경영지원본부/구매실") is True

    def test_mid_principal_kim_false(self) -> None:
        assert belongs_to_department(PATH_KIM, "경영지원본부/구매실") is False

    # principal: 경영지원본부 (root) → all 5 True
    def test_root_principal_all_true(self) -> None:
        for path in [PATH_KIM, PATH_LEE, PATH_PARK, PATH_CHOI, PATH_JUNG]:
            assert belongs_to_department(path, "경영지원본부") is True

    # 경계 체크 — 비슷한 이름의 다른 부서는 매치 안 됨
    def test_no_false_positive_partial_name(self) -> None:
        # '경영지원본부/구매' 는 '경영지원본부/구매실/...' 과 다름 — '/' 경계 필수
        assert belongs_to_department("경영지원본부/구매실/구매1팀", "경영지원본부/구매") is False
        assert belongs_to_department("경영지원본부/구매실", "경영지원본부/구매") is False

    def test_exact_match(self) -> None:
        assert belongs_to_department("경영지원본부/구매실", "경영지원본부/구매실") is True


# ---------------------------------------------------------------------------
# 3. effective_role — 우선순위 전체
# ---------------------------------------------------------------------------

PRIVATE = "private"
PUBLIC = "public"
NO_PERMS: list = []


class TestEffectiveRole:
    def _role(
        self,
        login_id: str = "user.lee",
        sysadmin: bool = False,
        path: str = PATH_LEE,
        visibility: str = PRIVATE,
        perms: list = NO_PERMS,
        approver: bool = False,
    ) -> str | None:
        return effective_role(login_id, sysadmin, path, visibility, perms, approver)

    # 1. sysadmin → owner (무조건)
    def test_sysadmin_always_owner(self) -> None:
        assert self._role(sysadmin=True) == "owner"
        assert self._role(sysadmin=True, visibility=PUBLIC) == "owner"
        assert self._role(sysadmin=True, approver=True) == "owner"

    # 2. private, 권한 없음, 비승인자 → None
    def test_private_no_grant_invisible(self) -> None:
        assert self._role() is None

    # 3. public + 권한 없음 → viewer baseline
    def test_public_no_grant_viewer(self) -> None:
        assert self._role(visibility=PUBLIC) == "viewer"

    # 4. user grant editor → editor
    def test_user_grant_editor(self) -> None:
        perms = [("user", "user.lee", "editor")]
        assert self._role(perms=perms) == "editor"

    # 5. department grant editor on 구매실 → lee/park/choi/jung editor, kim None
    def test_dept_grant_editor_lee(self) -> None:
        perms = [("department", "경영지원본부/구매실", "editor")]
        assert effective_role("user.lee", False, PATH_LEE, PRIVATE, perms, False) == "editor"

    def test_dept_grant_editor_park(self) -> None:
        perms = [("department", "경영지원본부/구매실", "editor")]
        assert effective_role("user.park", False, PATH_PARK, PRIVATE, perms, False) == "editor"

    def test_dept_grant_editor_choi(self) -> None:
        perms = [("department", "경영지원본부/구매실", "editor")]
        assert effective_role("user.choi", False, PATH_CHOI, PRIVATE, perms, False) == "editor"

    def test_dept_grant_editor_jung(self) -> None:
        # jung's path == 경영지원본부/구매실 (exact match)
        perms = [("department", "경영지원본부/구매실", "editor")]
        assert effective_role("user.jung", False, PATH_JUNG, PRIVATE, perms, False) == "editor"

    def test_dept_grant_editor_kim_none(self) -> None:
        # kim은 프로세스혁신실 소속 → 구매실 권한 적용 안 됨
        perms = [("department", "경영지원본부/구매실", "editor")]
        assert effective_role("admin.kim", False, PATH_KIM, PRIVATE, perms, False) is None

    # 6. approver, 권한 없음, private → viewer floor
    def test_approver_floor(self) -> None:
        assert self._role(approver=True) == "viewer"

    # 7. user grant owner → owner
    def test_user_grant_owner(self) -> None:
        perms = [("user", "user.lee", "owner")]
        assert self._role(perms=perms) == "owner"

    # 8. group grant → IGNORED (Layer 4 defer)
    def test_group_grant_ignored(self) -> None:
        perms = [("group", "some-group-id", "owner")]
        assert self._role(perms=perms) is None  # private + no effective user/dept

    def test_group_grant_ignored_public_stays_viewer(self) -> None:
        perms = [("group", "some-group-id", "owner")]
        assert self._role(visibility=PUBLIC, perms=perms) == "viewer"  # baseline only

    # 9. 복수 권한 — 최고 역할 wins
    def test_highest_wins_user_viewer_dept_editor(self) -> None:
        perms = [
            ("user", "user.lee", "viewer"),
            ("department", "경영지원본부/구매실", "editor"),
        ]
        assert effective_role("user.lee", False, PATH_LEE, PRIVATE, perms, False) == "editor"

    def test_highest_wins_dept_viewer_user_owner(self) -> None:
        perms = [
            ("department", "경영지원본부/구매실", "viewer"),
            ("user", "user.lee", "owner"),
        ]
        assert effective_role("user.lee", False, PATH_LEE, PRIVATE, perms, False) == "owner"


# ---------------------------------------------------------------------------
# 4. is_sysadmin — auth OFF / ON 분기
# ---------------------------------------------------------------------------

class TestIsSysadmin:
    def test_auth_off_always_true(self) -> None:
        # auth_enabled 기본값 False + dev_enforce_permissions 기본값 False → 전원 True
        from app.settings import settings
        assert settings.auth_enabled is False
        assert settings.dev_enforce_permissions is False
        assert is_sysadmin("anyone") is True
        assert is_sysadmin("user.lee") is True
        assert is_sysadmin("unknown.user") is True

    def test_auth_on_sysadmin_list(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.settings import settings
        monkeypatch.setattr(settings, "auth_enabled", True)
        monkeypatch.setattr(settings, "bpm_sysadmins", "admin.kim,admin.choi")
        assert is_sysadmin("admin.kim") is True
        assert is_sysadmin("admin.choi") is True
        assert is_sysadmin("user.lee") is False
        assert is_sysadmin("unknown") is False

    def test_auth_on_empty_sysadmins(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from app.settings import settings
        monkeypatch.setattr(settings, "auth_enabled", True)
        monkeypatch.setattr(settings, "bpm_sysadmins", "")
        assert is_sysadmin("admin.kim") is False

    def test_dev_enforce_auth_off_non_sysadmin_false(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # auth OFF + dev_enforce_permissions ON → BPM_SYSADMINS 목록만 True
        from app.settings import settings
        monkeypatch.setattr(settings, "auth_enabled", False)
        monkeypatch.setattr(settings, "dev_enforce_permissions", True)
        monkeypatch.setattr(settings, "bpm_sysadmins", "admin.kim")
        assert is_sysadmin("admin.kim") is True   # sysadmin member → True
        assert is_sysadmin("user.lee") is False   # non-member → False
        assert is_sysadmin("anyone") is False     # non-member → False

    def test_dev_enforce_false_auth_off_all_sysadmin(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # dev_enforce_permissions OFF(기본) → auth OFF에선 전원 True (회귀 없음)
        from app.settings import settings
        monkeypatch.setattr(settings, "auth_enabled", False)
        monkeypatch.setattr(settings, "dev_enforce_permissions", False)
        monkeypatch.setattr(settings, "bpm_sysadmins", "admin.kim")
        assert is_sysadmin("user.lee") is True    # 플래그 OFF → 전원 True


# ---------------------------------------------------------------------------
# 5. can_comment / is_visible 래퍼
# ---------------------------------------------------------------------------

class TestWrappers:
    def test_can_comment_viewer(self) -> None:
        assert can_comment("viewer") is True

    def test_can_comment_editor(self) -> None:
        assert can_comment("editor") is True

    def test_can_comment_owner(self) -> None:
        assert can_comment("owner") is True

    def test_can_comment_none(self) -> None:
        assert can_comment(None) is False

    def test_is_visible_public(self) -> None:
        assert is_visible("user.lee", False, PATH_LEE, PUBLIC, [], False) is True

    def test_is_visible_private_no_access(self) -> None:
        assert is_visible("user.lee", False, PATH_LEE, PRIVATE, [], False) is False

    def test_is_visible_sysadmin(self) -> None:
        assert is_visible("user.lee", True, PATH_LEE, PRIVATE, [], False) is True
