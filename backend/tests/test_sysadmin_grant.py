"""설정 화면 부여 sysadmin — env와 별개 경로, is_sysadmin 시그니처는 불변."""

import pytest

from app.permissions import logic
from app.settings import settings


@pytest.fixture
def enforce_permissions():
    """전원 sysadmin이 되는 로컬 기본 동작을 끄고 실제 판정을 보게 한다."""
    saved = (settings.auth_mode, settings.dev_enforce_permissions, settings.bpm_sysadmins)
    settings.auth_mode = "ldap"
    settings.dev_enforce_permissions = True
    yield
    settings.auth_mode, settings.dev_enforce_permissions, settings.bpm_sysadmins = saved
    logic.grant_sysadmin_cache(set())


def test_granted_login_id_becomes_sysadmin(enforce_permissions):
    assert logic.is_sysadmin("consultant.a") is False
    logic.add_granted_sysadmin("consultant.a")
    assert logic.is_sysadmin("consultant.a") is True


def test_revoking_takes_effect_immediately(enforce_permissions):
    logic.add_granted_sysadmin("consultant.a")
    logic.remove_granted_sysadmin("consultant.a")
    assert logic.is_sysadmin("consultant.a") is False


def test_env_sysadmin_survives_cache_replacement(enforce_permissions):
    """BPM_SYSADMINS는 UI 회수의 사정권 밖 — 캐시를 비워도 유지된다(설계 §3.1 불변식)."""
    settings.bpm_sysadmins = "admin.sys"
    logic.grant_sysadmin_cache(set())
    assert logic.is_sysadmin("admin.sys") is True


def test_cache_replacement_drops_previous_grants(enforce_permissions):
    logic.add_granted_sysadmin("consultant.a")
    logic.grant_sysadmin_cache({"consultant.b"})
    assert logic.is_sysadmin("consultant.a") is False
    assert logic.is_sysadmin("consultant.b") is True


def test_ldap_mode_with_auth_enabled_unset_does_not_grant_everyone():
    """resolved_auth_mode()는 AUTH_MODE 설정 시 auth_enabled를 무시한다 —
    AUTH_MODE=ldap + AUTH_ENABLED 기본값(False) + dev_enforce_permissions 기본값(False)
    조합에서 임의 로그인이 sysadmin이 되면 전면 권한 상승이다 (이 태스크가 막는 취약점).
    """
    saved = (settings.auth_mode, settings.auth_enabled, settings.dev_enforce_permissions)
    settings.auth_mode = "ldap"
    settings.auth_enabled = False
    settings.dev_enforce_permissions = False
    try:
        assert logic.is_sysadmin("random.consultant") is False
    finally:
        settings.auth_mode, settings.auth_enabled, settings.dev_enforce_permissions = saved
