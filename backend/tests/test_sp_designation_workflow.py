"""sp_designation 워크플로 테스트 — 플레이스홀더 링크·등록 요청·수락 (spec 2026-07-19).

test_map_rename_workflow.py 의 enforce/act_as/_seed 패턴을 따른다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.clock import now as now_kst
from app.db import SessionLocal
from app.main import app
from app.models import MapPermission, MapVersion, ProcessMap
from app.settings import settings

SYSADMIN = "admin.sys"
OWNER = "sp.owner"
EDITOR = "sp.editor"
VIEWER = "sp.viewer"
STRANGER = "sp.stranger"


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


def _seed(coro_factory):
    async def _run():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_sp_map(
    name: str,
    *,
    designated: bool = False,
    visibility: str = "public",
    published: bool = True,
    stale_department: str | None = None,
) -> int:
    """owner/editor/viewer 그랜트 + (옵션) 게시 버전이 있는 맵 시드. map_id 반환.

    stale_department: 미지정 맵에 남은 직전 지정 잔존값 재현용(마스킹 검증).
    """

    async def _factory(session):
        m = ProcessMap(
            name=name,
            description="",
            owning_department="Owning Anchor Division",
            visibility=visibility,
        )
        if designated:
            m.sp_designated_at = now_kst()
            m.sp_department = "Design Dept"
        elif stale_department is not None:
            m.sp_department = stale_department
        session.add(m)
        await session.flush()
        if published:
            session.add(
                MapVersion(map_id=m.id, label="v1", status="published", version_number=1)
            )
        for login, role in ((OWNER, "owner"), (EDITOR, "editor"), (VIEWER, "viewer")):
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id=login,
                    role=role,
                    granted_by=SYSADMIN,
                )
            )
        return m.id

    return _seed(_factory)


def _rows_by_id(body: list[dict]) -> dict[int, dict]:
    return {row["map_id"]: row for row in body}


class TestLibraryUndesignated:
    def test_default_excludes_undesignated(self, client, enforce):
        designated_id = seed_sp_map("Lib Designated A", designated=True)
        undesignated_id = seed_sp_map("Lib Undesignated A")
        act_as(VIEWER)
        rows = _rows_by_id(client.get("/api/library/processes").json())
        assert designated_id in rows
        assert undesignated_id not in rows

    def test_designated_rows_have_designated_true(self, client, enforce):
        designated_id = seed_sp_map("Lib Designated B", designated=True)
        act_as(VIEWER)
        rows = _rows_by_id(client.get("/api/library/processes").json())
        assert rows[designated_id]["designated"] is True

    def test_flag_includes_visible_undesignated_with_masked_attrs(self, client, enforce):
        undesignated_id = seed_sp_map(
            "Lib Undesignated B", stale_department="Stale Dept"
        )
        act_as(VIEWER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        row = rows[undesignated_id]
        assert row["designated"] is False
        # 직전 지정 잔존값 유출 방지 — 미지정 행은 sp 어트리뷰트 마스킹
        assert row["department"] is None
        assert row["assignee"] is None
        assert row["system"] is None
        assert row["duration"] is None

    def test_flag_hides_private_undesignated_from_stranger(self, client, enforce):
        private_id = seed_sp_map("Lib Private Undesignated", visibility="private")
        act_as(STRANGER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        assert private_id not in rows
        # 권한 보유자(owner)에게는 보인다
        act_as(OWNER)
        rows = _rows_by_id(
            client.get("/api/library/processes?include_undesignated=true").json()
        )
        assert private_id in rows
