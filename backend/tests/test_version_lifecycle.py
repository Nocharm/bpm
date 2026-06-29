"""Tests for version numbering (version_number) and expired status — Task 1.
Also covers Task 4: republish expired/published version into a new draft.
"""

import asyncio
import uuid

import pytest
from fastapi.testclient import TestClient
from uuid import uuid4
from sqlalchemy import func, select

import app.auth as _auth_mod
from app.db import SessionLocal
from app.main import app as _fastapi_app
from app.models import MapVersion, Node
from app.settings import settings


def _create_map(client: TestClient) -> tuple[int, int]:
    """새 맵 생성 후 (map_id, initial_version_id) 반환."""
    created = client.post("/api/maps", json={"name": f"lc map {uuid4().hex[:8]}"}).json()
    return created["id"], created["versions"][0]["id"]


def _publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    map_id: int,
    version_id: int,
) -> dict:
    """Checkout → submit → approve (approver='a') → publish. 게시된 VersionOut 반환."""
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    return client.post(f"/api/versions/{version_id}/publish").json()


def test_publish_numbers_and_expires(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    ① 첫 게시 → version_number == 1.
    ② 두 번째 게시 → 직전 published는 'expired'(approved 아님), 새 버전은 version_number == 2.
    ③ 만료된 버전의 version_number는 이후 게시에도 불변.
    """
    map_id, v1 = _create_map(client)

    # ① 첫 게시 → version_number 1
    result_v1 = _publish(client, monkeypatch, map_id, v1)
    assert result_v1["status"] == "published"
    assert result_v1["version_number"] == 1

    # v2 생성 (v1이 published → 새 버전 허용)
    v2 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be", "source_version_id": v1},
    ).json()["id"]

    # ② 두 번째 게시 → v1은 expired, v2는 version_number 2
    result_v2 = _publish(client, monkeypatch, map_id, v2)
    assert result_v2["status"] == "published"
    assert result_v2["version_number"] == 2

    detail = client.get(f"/api/maps/{map_id}").json()
    by_id = {v["id"]: v for v in detail["versions"]}

    assert by_id[v1]["status"] == "expired"        # approved 아님
    assert by_id[v1]["version_number"] == 1        # 불변

    # v3 생성 (v2가 published → 새 버전 허용)
    v3 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be v3", "source_version_id": v2},
    ).json()["id"]

    # ③ 세 번째 게시 → v2는 expired, v3는 version_number 3, v1 번호 불변
    result_v3 = _publish(client, monkeypatch, map_id, v3)
    assert result_v3["status"] == "published"
    assert result_v3["version_number"] == 3

    detail = client.get(f"/api/maps/{map_id}").json()
    by_id = {v["id"]: v for v in detail["versions"]}

    assert by_id[v1]["status"] == "expired"
    assert by_id[v1]["version_number"] == 1        # 만료 후에도 불변
    assert by_id[v2]["status"] == "expired"
    assert by_id[v2]["version_number"] == 2        # 만료 후에도 불변
    assert by_id[v3]["status"] == "published"
    assert by_id[v3]["version_number"] == 3


def test_workflow_state_version_number(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """
    GET /versions/{id}/workflow 응답에 version_number가 올바르게 포함되는지 검증.
    - 미게시 초안: version_number == None
    - 게시 후: version_number == 1
    """
    map_id, v1 = _create_map(client)

    # 미게시 초안 — version_number는 None
    wf = client.get(f"/api/versions/{v1}/workflow").json()
    assert wf["version_number"] is None

    # 게시 → version_number 1
    _publish(client, monkeypatch, map_id, v1)
    wf = client.get(f"/api/versions/{v1}/workflow").json()
    assert wf["version_number"] == 1


# ---------------------------------------------------------------------------
# Task 4: 만료본 재게시 (republish)
# ---------------------------------------------------------------------------


def _seed_node(version_id: int) -> None:
    """버전에 노드 1개 직접 삽입 (그래프 복제 검증용)."""

    async def _run() -> None:
        async with SessionLocal() as session:
            session.add(Node(id=uuid.uuid4().hex, version_id=version_id, title="seed"))
            await session.commit()

    asyncio.run(_run())


def _node_count(version_id: int) -> int:
    """버전의 노드 수 직접 조회."""

    async def _run() -> int:
        async with SessionLocal() as session:
            result = await session.scalar(
                select(func.count()).select_from(Node).where(Node.version_id == version_id)
            )
            return result or 0

    return asyncio.run(_run())


def _force_version_status(version_id: int, status: str) -> None:
    """버전 상태 직접 설정 (테스트 시나리오 세팅용)."""

    async def _run() -> None:
        async with SessionLocal() as session:
            v = await session.get(MapVersion, version_id)
            v.status = status
            await session.commit()

    asyncio.run(_run())


def test_republish_expired_creates_draft(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Expired 버전 republish → 그래프 복제 새 draft, version_number=None, checked_out_by=caller."""
    map_id, v1 = _create_map(client)
    _seed_node(v1)  # v1에 노드 1개 삽입

    # v1 publish → published (version_number=1)
    _publish(client, monkeypatch, map_id, v1)

    # v2 publish → v1 expired
    v2 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be", "source_version_id": v1},
    ).json()["id"]
    _publish(client, monkeypatch, map_id, v2)

    # 확인: v1은 expired
    detail = client.get(f"/api/maps/{map_id}").json()
    by_id = {v["id"]: v for v in detail["versions"]}
    assert by_id[v1]["status"] == "expired"
    v1_label = by_id[v1]["label"]

    # republish v1 (expired) → 새 draft
    resp = client.post(f"/api/versions/{v1}/republish")
    assert resp.status_code == 201, resp.text
    nd = resp.json()

    assert nd["status"] == "draft"
    assert nd["version_number"] is None
    assert nd["label"] == v1_label  # label 승계

    # 그래프 복제 검증: 새 draft에 노드 1개 (v1과 동수)
    assert _node_count(v1) == 1
    assert _node_count(nd["id"]) == 1

    # 생성자 점유권 확인
    wf = client.get(f"/api/versions/{nd['id']}/workflow").json()
    assert wf["checkout_holder"] == "local-dev"


def test_republish_draft_exists_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """맵에 이미 draft가 있으면 republish → 409."""
    map_id, v1 = _create_map(client)
    _publish(client, monkeypatch, map_id, v1)  # v1 = published

    # v2 draft 생성 → 작업본 존재
    client.post(f"/api/maps/{map_id}/versions", json={"label": "To-Be"})

    # v1 (published) republish 시도 → 409
    resp = client.post(f"/api/versions/{v1}/republish")
    assert resp.status_code == 409, resp.text
    assert "draft" in resp.json()["detail"]


def test_republish_no_editor_role_403(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """editor+ 권한 없는 사용자 → 403.

    dev_enforce_permissions 기본값(False)에서는 전원 sysadmin이라 권한 차단이 안 됨.
    auth_enabled=True + 단일 sysadmin 지정 + get_current_user 오버라이드로 실제 역할 적용.
    """
    map_id, v1 = _create_map(client)
    _publish(client, monkeypatch, map_id, v1)  # v1 = published (private map, owner=local-dev)

    monkeypatch.setattr(settings, "auth_enabled", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", "local-dev")
    _fastapi_app.dependency_overrides[_auth_mod.get_current_user] = lambda: "no-access-user"
    try:
        resp = client.post(f"/api/versions/{v1}/republish")
    finally:
        _fastapi_app.dependency_overrides.pop(_auth_mod.get_current_user, None)
    assert resp.status_code == 403, resp.text


def test_republish_source_status_gates(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """draft/pending source → 409 차단; published source → 201 허용."""
    # draft source → 409
    _, v_draft = _create_map(client)
    resp = client.post(f"/api/versions/{v_draft}/republish")
    assert resp.status_code == 409, resp.text
    assert "draft" in resp.json()["detail"]

    # pending source → 409
    _, v_pending = _create_map(client)
    _force_version_status(v_pending, "pending")
    resp = client.post(f"/api/versions/{v_pending}/republish")
    assert resp.status_code == 409, resp.text

    # published source (no existing draft) → 201
    map_id_c, v_pub = _create_map(client)
    _publish(client, monkeypatch, map_id_c, v_pub)
    resp = client.post(f"/api/versions/{v_pub}/republish")
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == "draft"
