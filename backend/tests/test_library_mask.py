"""resolved_graph 권한 마스킹 테스트 — Task 1 (feat/expand-sync).

viewer 미만 호출자는 200 + locked=True + 빈 nodes/edges.
viewer 이상 호출자는 200 + locked 없음(False) + 실제 그래프.

enforce fixture (auth_enabled=True + sysadmin 1명)로 실 권한 판정 활성화.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import (
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
)
from app.settings import settings

SYSADMIN = "lib.sysadmin"

# ── 공통 픽스처 ────────────────────────────────────────────────


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth_enabled=True + sysadmin 1명 지정 — 실 권한 판정 활성화. 테스트 후 복원."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


# ── DB 직접 시드 헬퍼 ─────────────────────────────────────────


def _seed(coro_factory) -> object:  # type: ignore[type-arg]
    async def _run() -> object:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_map_with_graph(
    grants: list[tuple[str, str, str]] | None = None,
) -> tuple[int, int]:
    """맵 + 버전 + 노드 1개 시드. (map_id, version_id) 반환.

    grants: [(principal_type, principal_id, role), ...]
    노드는 'n1' id의 process 노드 1개 — 권한자 조회 시 nodes가 비어있지 않음을 확인하는 용도.
    """

    async def _make(session) -> tuple[int, int]:
        m = ProcessMap(name="mask-test-map", visibility="private", owner_id=None)
        v = MapVersion(label="As-Is")
        m.versions.append(v)
        session.add(m)
        await session.flush()
        for ptype, pid, role in grants or []:
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type=ptype,
                    principal_id=pid,
                    role=role,
                    granted_by="seed",
                )
            )
        # 노드 1개 직접 삽입 — 권한자가 조회했을 때 non-empty 그래프 확인 용도
        session.add(Node(id=f"n-mask-{m.id}", version_id=v.id, title="T", node_type="process"))
        return m.id, v.id

    return _seed(_make)  # type: ignore[return-value]


# ── 마스킹 테스트 ─────────────────────────────────────────────


def test_resolved_graph_below_viewer_returns_locked_empty(
    client: TestClient, enforce: None
) -> None:
    """viewer 미만(권한 없음) 호출자 → 200 + locked=True + nodes/edges 빈 배열.

    이 테스트가 핵심 보안 단언(security assertion)이다.
    데이터를 빌드했다가 비우는 게 아니라, 처음부터 빈 payload를 반환해야 한다.
    """
    map_id, vid = seed_map_with_graph(grants=[])  # no permission for noaccess.u
    act_as("noaccess.u")
    r = client.get(f"/api/library/processes/{map_id}/resolved", params={"pinned": vid})
    assert r.status_code == 200
    body = r.json()
    assert body["locked"] is True
    assert len(body["nodes"]) == 0  # security: node data must NOT be returned
    assert len(body["edges"]) == 0  # security: edge data must NOT be returned


def test_resolved_graph_viewer_returns_real_graph_unlocked(
    client: TestClient, enforce: None
) -> None:
    """viewer 호출자 → 200 + locked 없거나 False + 실제 노드 포함.

    viewer가 차단되면 회귀 — 이 테스트가 over-blocking을 막는다.
    """
    map_id, vid = seed_map_with_graph(grants=[("user", "viewer.u", "viewer")])
    act_as("viewer.u")
    r = client.get(f"/api/library/processes/{map_id}/resolved", params={"pinned": vid})
    assert r.status_code == 200
    body = r.json()
    assert not body.get("locked", False)  # locked은 False이거나 키가 없어야 함
    assert len(body["nodes"]) > 0  # viewer는 실제 그래프를 봐야 함


def test_resolved_graph_owner_returns_real_graph(
    client: TestClient, enforce: None
) -> None:
    """owner 호출자 → 200 + 실제 그래프(pass-through)."""
    map_id, vid = seed_map_with_graph(grants=[("user", "owner.u", "owner")])
    act_as("owner.u")
    r = client.get(f"/api/library/processes/{map_id}/resolved", params={"pinned": vid})
    assert r.status_code == 200
    body = r.json()
    assert not body.get("locked", False)
    assert len(body["nodes"]) > 0


def test_resolved_graph_sysadmin_returns_real_graph(
    client: TestClient, enforce: None
) -> None:
    """sysadmin 호출자 → 200 + 실제 그래프(pass-through). sysadmin은 owner 역할 취득."""
    map_id, vid = seed_map_with_graph(grants=[])  # no explicit grant; sysadmin is always owner
    act_as(SYSADMIN)
    r = client.get(f"/api/library/processes/{map_id}/resolved", params={"pinned": vid})
    assert r.status_code == 200
    body = r.json()
    assert not body.get("locked", False)
    assert len(body["nodes"]) > 0
