"""권한·결재 잔여 — 시스템 리뷰 2026-10-19 7a(C-6·C-7·E-12·B-10·B-11) 회귀.

B-10의 동시 최초 생성(유니크 위반 재시도)은 sqlite에서 경쟁이 안 나 일회용 postgres에서 따로 확인한다.
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai_client, login_throttle
from app.db import SessionLocal
from app.hr.service import _upsert, to_employee_fields
from app.models import Employee, LocalCredential, Notification
from app.permissions import logic
from app.version_events import record_version_event
from tests.hr_sync_helpers import _hr_row
from tests.test_ai_compare_summary import _enable_ai, _map_with_two_versions, _post, _spy_ai
from tests.test_framework_canvas import SYSADMIN, act_as
from tests.test_framework_canvas import _seed_category as _seed_cat
from tests.test_framework_integrity import enforce  # noqa: F401 -- 픽스처 재사용
from tests.test_versions import _set_version_status


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_go())


# ── C-6 로그인 시도 제한 ───────────────────────────────────────────────────────


@pytest.fixture
def clean_throttle() -> Iterator[None]:
    login_throttle.clear_all()
    yield
    login_throttle.clear_all()


def test_throttle_counts_attempts_before_the_bind(clean_throttle: None) -> None:
    """실패를 bind 뒤에만 세면 동시 요청이 모두 검사를 통과해 AD bind로 나갔다 — 검사 시점에 센다."""
    key = "c6.user|10.0.0.1"
    allowed = [login_throttle.check_and_count(key) for _ in range(login_throttle.MAX_ATTEMPTS + 3)]
    assert allowed == [True] * login_throttle.MAX_ATTEMPTS + [False] * 3


def test_successful_login_frees_the_attempts(clean_throttle: None) -> None:
    key = "c6.ok|10.0.0.2"
    for _ in range(login_throttle.MAX_ATTEMPTS - 1):
        assert login_throttle.check_and_count(key)
    login_throttle.reset(key)
    assert all(login_throttle.check_and_count(key) for _ in range(login_throttle.MAX_ATTEMPTS))


# ── C-7 HR 인수 시 로컬 sysadmin ────────────────────────────────────────────────


def test_hr_takeover_revokes_the_local_sysadmin_grant(client: TestClient) -> None:
    """같은 login_id의 AD 계정이 로컬 계정에 준 sysadmin을 물려받았다."""
    login = f"c7.{uuid4().hex[:6]}"

    async def _seed(session):
        session.add(Employee(login_id=login, name=login, source="local", active=True))
        session.add(LocalCredential(login_id=login, password_hash="x", is_sysadmin=True, created_by=SYSADMIN))

    _run(_seed)
    logic.add_granted_sysadmin(login)
    try:
        _run(lambda s: _upsert(s, to_employee_fields(_hr_row(login))))

        async def _state(session):
            return (await session.get(Employee, login)).source, (await session.get(LocalCredential, login)).is_sysadmin

        assert _run(_state) == ("hr", False)
        assert login not in logic.list_sysadmin_logins() | logic._granted_sysadmins
    finally:
        logic.remove_granted_sysadmin(login)


# ── E-12 권한자 교체 알림 ───────────────────────────────────────────────────────


def _notes(category_id: int) -> list[tuple[str, str]]:
    async def _q(session):
        rows = (await session.scalars(
            select(Notification).where(Notification.type == "fw_admin_removed")
        )).all()
        return [(n.recipient, n.payload.get("from_name")) for n in rows if n.payload.get("category_id") == category_id]

    return _run(_q)


def test_replaced_category_admin_is_notified(client: TestClient, enforce: None) -> None:  # noqa: F811
    """상위 관리자가 L5 임명을 자기로 바꿔도 허용(사용자 결정) — 빠진 사람은 알림을 받는다."""
    tag = uuid4().hex[:6]
    l1 = _seed_cat(client, f"E12-{tag}-1", f"E12 {tag}")
    l5 = _seed_cat(client, f"E12-{tag}-5", f"E12 {tag} L5", level=5, parent_id=l1)
    upper, old, stay = f"e12.up.{tag}", f"e12.old.{tag}", f"e12.stay.{tag}"
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": upper}]})
    client.put(f"/api/categories/{l5}/permissions", json={"permissions": [
        {"principal_type": "user", "principal_id": old}, {"principal_type": "user", "principal_id": stay},
    ]})

    act_as(upper)
    r = client.put(f"/api/categories/{l5}/permissions", json={"permissions": [
        {"principal_type": "user", "principal_id": upper}, {"principal_type": "user", "principal_id": stay},
    ]})
    assert r.status_code == 200, r.text
    notes = _notes(l5)
    assert [recipient for recipient, _ in notes] == [old]
    assert notes[0][1].endswith(f"E12 {tag} L5")


# ── B-10 비교 요약 캐시 ─────────────────────────────────────────────────────────


def test_new_submit_comment_regenerates_the_cached_report(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """재제출로 제출 코멘트가 바뀌어도 옛 코멘트 기준 보고서를 돌려줬다."""
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target).status_code == 200

    async def _submit(session):
        record_version_event(session, target, "submitted", "c.submitter", note="감사 지적 대응")

    _run(_submit)
    regenerated = _post(client, map_id, base, target)
    assert regenerated.status_code == 200 and regenerated.json()["cached"] is False
    assert len(seen) == 2
    again = _post(client, map_id, base, target)
    assert again.json()["cached"] is True and len(seen) == 2


# ── B-11 게시·만료 이력 ─────────────────────────────────────────────────────────


def test_published_and_expired_versions_keep_their_history(client: TestClient) -> None:
    map_id, published, draft = _map_with_two_versions(client)
    assert client.patch(f"/api/versions/{published}", json={"label": "renamed"}).status_code == 409
    assert client.patch(f"/api/versions/{draft}", json={"label": "draft label ok"}).status_code == 200
    _set_version_status(published, "expired")
    assert client.patch(f"/api/versions/{published}", json={"label": "renamed"}).status_code == 409
    assert client.delete(f"/api/versions/{published}").status_code == 409


def test_editor_without_checkout_cannot_rename_the_draft(client: TestClient, enforce: None) -> None:  # noqa: F811
    """점유하지 않은 editor가 버전 이름을 바꿀 수 있었다 — 점유자·오너·sysadmin만."""
    from app.models import MapPermission, MapVersion

    act_as(SYSADMIN)
    map_id, _, draft = _map_with_two_versions(client)
    editor = f"b11.editor.{uuid4().hex[:6]}"

    async def _grant_and_release(session):
        session.add(Employee(login_id=editor, name=editor, source="local", active=True))
        session.add(MapPermission(map_id=map_id, principal_type="user", principal_id=editor, role="editor", granted_by=SYSADMIN))
        version = await session.get(MapVersion, draft)
        version.checked_out_by = None
        version.checked_out_at = None

    _run(_grant_and_release)
    act_as(editor)
    assert client.patch(f"/api/versions/{draft}", json={"label": "not mine"}).status_code == 403
    assert client.post(f"/api/versions/{draft}/checkout", json={}).json()["mine"] is True
    assert client.patch(f"/api/versions/{draft}", json={"label": "mine now"}).status_code == 200
