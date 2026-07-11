"""대시보드 열람 권한 — 순수 판정 함수 (design 2026-07-11)."""

from app.permissions.logic import can_view_dashboard


def test_sysadmin_always_views() -> None:
    """sysadmin은 권한 행이 없어도 통과."""
    assert can_view_dashboard(True, "admin", "", set(), []) is True


def test_no_principal_row_denied() -> None:
    """권한 행이 없으면 비-sysadmin은 거부 — 기본값은 '거부'다."""
    assert can_view_dashboard(False, "u1", "Div/Office", set(), []) is False


def test_user_principal() -> None:
    """user principal은 login_id 일치만 인정."""
    perms = [("user", "u1")]
    assert can_view_dashboard(False, "u1", "", set(), perms) is True
    assert can_view_dashboard(False, "u2", "", set(), perms) is False


def test_department_principal_includes_subpath() -> None:
    """department principal은 org_path 하위 포함 — belongs_to_department 정책."""
    perms = [("department", "Div/Office")]
    assert can_view_dashboard(False, "u1", "Div/Office", set(), perms) is True
    assert can_view_dashboard(False, "u1", "Div/Office/Team1", set(), perms) is True
    # 경계 없는 부분 일치는 거부 — "Div/OfficeX"는 하위가 아니다
    assert can_view_dashboard(False, "u1", "Div/OfficeX", set(), perms) is False


def test_group_principal_requires_membership() -> None:
    """그룹 권한은 caller가 속한 ACTIVE 그룹일 때만 (user_group_ids는 caller가 주입)."""
    perms = [("group", "7")]
    assert can_view_dashboard(False, "u1", "", {"7"}, perms) is True
    assert can_view_dashboard(False, "u1", "", {"8"}, perms) is False
    assert can_view_dashboard(False, "u1", "", set(), perms) is False
