"""맵 단위 인터뷰 원문 메모 PATCH — 에디터 이상 편집, 보낸 필드만 갱신 (design 2026-09-03 followups §2)."""

import pytest
from fastapi.testclient import TestClient

from app.models import MapPermission
from tests.test_subprocess_designation import (
    OTHER,
    OWNER,
    SYSADMIN,
    _seed,
    act_as,
    enforce,  # noqa: F401 — 픽스처 재사용(usefixtures로 참조)
    seed_map,
)

EDITOR = "fb.editor"
VIEWER = "fb.viewer"


def _grant(map_id: int, user: str, role: str) -> None:
    async def _make(session) -> None:
        session.add(MapPermission(
            map_id=map_id, principal_type="user", principal_id=user, role=role, granted_by=SYSADMIN,
        ))

    _seed(_make)


@pytest.mark.usefixtures("enforce")
def test_editor_patches_only_sent_fields(client: TestClient) -> None:
    map_id = seed_map("fb-editor", published=True)
    _grant(map_id, EDITOR, "editor")
    act_as(EDITOR)
    res = client.patch(f"/api/maps/{map_id}/fallback-notes",
                       json={"system_fallback": " EAM, 수기 ", "gmp_fallback": "GMP 문서 맞음"})
    assert res.status_code == 200
    body = res.json()
    assert body["sp_system_fallback"] == "EAM, 수기"
    assert body["sp_gmp_fallback"] == "GMP 문서 맞음"
    assert body["sp_total_time_fallback"] is None

    kept = client.patch(f"/api/maps/{map_id}/fallback-notes", json={"total_time_fallback": "한시간"}).json()
    assert kept["sp_system_fallback"] == "EAM, 수기" and kept["sp_total_time_fallback"] == "한시간"
    cleared = client.patch(f"/api/maps/{map_id}/fallback-notes", json={"system_fallback": ""}).json()
    assert cleared["sp_system_fallback"] is None


@pytest.mark.usefixtures("enforce")
def test_viewer_and_stranger_forbidden(client: TestClient) -> None:
    map_id = seed_map("fb-viewer", published=True)
    _grant(map_id, VIEWER, "viewer")
    act_as(VIEWER)
    assert client.patch(f"/api/maps/{map_id}/fallback-notes", json={"system_fallback": "x"}).status_code == 403
    act_as(OTHER)
    assert client.patch(f"/api/maps/{map_id}/fallback-notes", json={"system_fallback": "x"}).status_code in (403, 404)
    act_as(OWNER)
    assert client.patch(f"/api/maps/{map_id}/fallback-notes", json={"system_fallback": "x"}).status_code == 200
