"""맵 복사 워크플로 재편 테스트 — 게시 이력 게이트·오너 알림·원본 은퇴(retire_source).

test_map_rename_workflow.py 의 enforce/act_as/_seed 패턴을 따른다.
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapApprover, MapPermission, MapVersion, Notification, ProcessMap
from app.settings import settings

SYSADMIN = "admin.sys"
OWNER = "owner.user"
EDITOR = "editor.user"
VIEWER = "viewer.user"
# conftest가 active 직원으로 시드하는 승인자 id — load_active_approvers 통과
APPROVERS = ["a", "b"]


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def seed_copy_map(name: str, *, statuses: list[str] = ["published"]) -> int:
    """owner/editor/viewer 그랜트 + 승인자 a,b + statuses 순서의 버전들. map_id 반환."""

    async def _factory(session):
        m = ProcessMap(
            name=name, description="", visibility="private",
            owner_id=OWNER, created_by=OWNER,
            owning_department="Owning Anchor Division",
        )
        session.add(m)
        await session.flush()
        for i, status in enumerate(statuses):
            session.add(MapVersion(map_id=m.id, label=f"V{i + 1}", status=status))
        for login, role in ((OWNER, "owner"), (EDITOR, "editor"), (VIEWER, "viewer")):
            session.add(MapPermission(
                map_id=m.id, principal_type="user", principal_id=login,
                role=role, granted_by=SYSADMIN,
            ))
        for aid in APPROVERS:
            session.add(MapApprover(map_id=m.id, user_id=aid))
        return m.id

    return _run(_factory)


def _notes(note_type: str) -> list[tuple[str, int | None, str]]:
    async def _q(session):
        rows = await session.scalars(select(Notification).where(Notification.type == note_type))
        return [(n.recipient, n.map_id, n.message) for n in rows.all()]

    return _run(_q)


def _map_row(map_id: int) -> tuple[str, object]:
    async def _q(session):
        m = await session.get(ProcessMap, map_id)
        return (m.name, m.deleted_at)

    return _run(_q)


class TestPublishHistoryGate:
    def test_never_published_409(self, client, enforce):
        map_id = seed_copy_map(f"gate-{uuid4().hex[:8]}", statuses=["approved", "draft"])
        act_as(VIEWER)
        r = client.post(f"/api/maps/{map_id}/copy", json={"name": f"c-{uuid4().hex[:8]}"})
        assert r.status_code == 409

    def test_version_id_still_requires_history(self, client, enforce):
        map_id = seed_copy_map(f"gatev-{uuid4().hex[:8]}", statuses=["draft"])
        vid = _run(lambda s: s.scalar(select(MapVersion.id).where(MapVersion.map_id == map_id)))
        act_as(VIEWER)
        r = client.post(
            f"/api/maps/{map_id}/copy", json={"name": f"c-{uuid4().hex[:8]}", "version_id": vid}
        )
        assert r.status_code == 409

    def test_expired_history_allows_copy(self, client, enforce):
        # expired = 과거 게시본 — 게시 이력으로 인정. 기본 원본은 최신 published/expired.
        map_id = seed_copy_map(f"gatee-{uuid4().hex[:8]}", statuses=["expired", "published"])
        act_as(VIEWER)
        r = client.post(f"/api/maps/{map_id}/copy", json={"name": f"c-{uuid4().hex[:8]}"})
        assert r.status_code == 201


class TestCopyNotification:
    def test_viewer_copy_notifies_owner(self, client, enforce):
        src = f"note-{uuid4().hex[:8]}"
        map_id = seed_copy_map(src)
        act_as(VIEWER)
        copy_name = f"c-{uuid4().hex[:8]}"
        r = client.post(f"/api/maps/{map_id}/copy", json={"name": copy_name})
        assert r.status_code == 201
        notes = _notes("map_copied")
        assert (OWNER, map_id) in [(rcpt, mid) for rcpt, mid, _ in notes]
        assert all(rcpt != VIEWER for rcpt, _, _ in notes)
        assert any(copy_name in msg for _, mid, msg in notes if mid == map_id)

    def test_owner_self_copy_no_notification(self, client, enforce):
        map_id = seed_copy_map(f"self-{uuid4().hex[:8]}")
        act_as(OWNER)
        r = client.post(f"/api/maps/{map_id}/copy", json={"name": f"c-{uuid4().hex[:8]}"})
        assert r.status_code == 201
        assert all(mid != map_id for _, mid, _ in _notes("map_copied"))


class TestRetireSource:
    def test_retire_requires_owner(self, client, enforce):
        map_id = seed_copy_map(f"ret403-{uuid4().hex[:8]}")
        act_as(EDITOR)
        r = client.post(
            f"/api/maps/{map_id}/copy",
            json={"name": f"c-{uuid4().hex[:8]}", "retire_source": True},
        )
        assert r.status_code == 403

    def test_retire_renames_trashes_and_notifies(self, client, enforce):
        src = f"retire-{uuid4().hex[:8]}"
        map_id = seed_copy_map(src)
        act_as(OWNER)
        # B5: 새 맵 이름 = 원본 이름 그대로 (원본이 태그 rename되어 중복 해소)
        r = client.post(
            f"/api/maps/{map_id}/copy", json={"name": src, "retire_source": True}
        )
        assert r.status_code == 201, r.text
        assert r.json()["name"] == src
        old_name, deleted_at = _map_row(map_id)
        assert old_name == f"{src} (Pending deletion)"
        assert deleted_at is not None
        # 승인자 + editor 이상 협업자에게 알림, 행위자(오너)는 제외
        recipients = [rcpt for rcpt, mid, _ in _notes("map_retired") if mid == map_id]
        for expected in [*APPROVERS, EDITOR]:
            assert expected in recipients
        assert OWNER not in recipients
        assert VIEWER not in recipients

    def test_retire_name_collision_gets_counter(self, client, enforce):
        src = f"retire2-{uuid4().hex[:8]}"
        seed_copy_map(f"{src} (Pending deletion)")  # 태그명 선점
        map_id = seed_copy_map(src)
        act_as(OWNER)
        r = client.post(
            f"/api/maps/{map_id}/copy", json={"name": src, "retire_source": True}
        )
        assert r.status_code == 201, r.text
        old_name, _ = _map_row(map_id)
        assert old_name == f"{src} (Pending deletion 2)"


class TestCopyVisibility:
    def test_copy_visibility_public(self, client, enforce):
        map_id = seed_copy_map(f"vis-{uuid4().hex[:8]}")
        act_as(OWNER)
        r = client.post(
            f"/api/maps/{map_id}/copy",
            json={"name": f"c-{uuid4().hex[:8]}", "visibility": "public"},
        )
        assert r.status_code == 201
        assert r.json()["visibility"] == "public"
