"""SP 역참조(subprocess-usage) API — 지정 메타·used-by 목록·라이브 버전 판정·가시성 마스킹. (design 2026-07-18)"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapPermission, MapVersion, Node, ProcessMap
from app.settings import settings

SYSADMIN = "usage.sysadmin"
OWNER = "usage.owner"
OTHER = "usage.other"


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


def _seed(coro_factory):
    async def _run():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def seed_target(name: str, *, visibility: str = "public") -> int:
    """지정 대상 맵 + published 버전(version_number=1) + OWNER 권한행. map_id 반환."""

    async def _make(session) -> int:
        m = ProcessMap(name=name, visibility=visibility, owner_id=OWNER)
        v = MapVersion(label="As-Is", status="published", version_number=1)
        m.versions.append(v)
        session.add(m)
        await session.flush()
        session.add(
            MapPermission(
                map_id=m.id,
                principal_type="user",
                principal_id=OWNER,
                role="owner",
                granted_by=SYSADMIN,
            )
        )
        return m.id

    return _seed(_make)


def seed_host(
    name: str,
    target_map_id: int,
    node_prefix: str,
    *,
    visibility: str = "public",
    versions: list[tuple[str, int]] | None = None,
    deleted: bool = False,
) -> int:
    """target을 링크하는 호스트 맵 시드 — versions는 (status, 링크 노드 수) 목록.

    검증(시작노드 규칙)을 안 타도록 DB 직접 시드. node id는 전역 PK라 prefix를 테스트별 유니크하게.
    """
    from app.clock import now as now_kst

    async def _make(session) -> int:
        m = ProcessMap(name=name, visibility=visibility, owner_id=OWNER)
        if deleted:
            m.deleted_at = now_kst()
        session.add(m)
        await session.flush()
        for vi, (status, link_count) in enumerate(versions or [("draft", 1)]):
            v = MapVersion(map_id=m.id, label=f"v{vi}", status=status)
            session.add(v)
            await session.flush()
            for ni in range(link_count):
                session.add(
                    Node(
                        id=f"{node_prefix}-{vi}-{ni}",
                        version_id=v.id,
                        node_type="subprocess",
                        title="call target",
                        linked_map_id=target_map_id,
                    )
                )
        return m.id

    return _seed(_make)


DESIGNATE_BODY = {"department": "Sales"}


def test_usage_meta_and_parents(client: TestClient, enforce) -> None:
    """지정 메타(버전·시점·행위자) + used-by 목록·노드 수·이름 정렬."""
    target = seed_target("usage-target")
    act_as(OWNER)
    res = client.put(f"/api/maps/{target}/subprocess-designation", json=DESIGNATE_BODY)
    assert res.status_code == 200
    seed_host("usage-host B", target, "uhb", versions=[("draft", 2)])
    seed_host("usage-host A", target, "uha", versions=[("draft", 1)])
    res = client.get(f"/api/maps/{target}/subprocess-usage")
    assert res.status_code == 200
    data = res.json()
    assert data["designated"] is True
    assert data["designated_at"] is not None
    assert data["changed_by"] == OWNER
    assert data["changed_at"] is not None
    assert data["designated_version_number"] == 1
    assert data["designated_version_label"] == "As-Is"
    assert [(u["name"], u["node_count"]) for u in data["used_by"]] == [
        ("usage-host A", 1),
        ("usage-host B", 2),
    ]
    assert data["hidden_count"] == 0


def test_usage_undesignated_still_reports(client: TestClient, enforce) -> None:
    """미지정 맵도 200 — designated=False로 응답(탭 노출 여부는 프론트 판단)."""
    target = seed_target("usage-undesignated")
    act_as(OWNER)
    res = client.get(f"/api/maps/{target}/subprocess-usage")
    assert res.status_code == 200
    assert res.json()["designated"] is False


def test_usage_counts_live_version_only(client: TestClient, enforce) -> None:
    """사용처 판정은 라이브 버전(게시본 우선) 기준 — 드래프트만의 링크 추가/제거는 미반영."""
    target = seed_target("usage-live-target")
    # 게시본에 링크, 최신 드래프트에서 제거 → 여전히 사용처(라이브=게시본)
    seed_host("usage-live-keep", target, "ulk", versions=[("published", 1), ("draft", 0)])
    # 게시본에 없고 최신 드래프트에만 링크 → 사용처 아님(라이브=게시본)
    seed_host("usage-live-drop", target, "uld", versions=[("published", 0), ("draft", 1)])
    act_as(OWNER)
    data = client.get(f"/api/maps/{target}/subprocess-usage").json()
    assert [u["name"] for u in data["used_by"]] == ["usage-live-keep"]
    assert data["hidden_count"] == 0


def test_usage_masks_invisible_parent(client: TestClient, enforce) -> None:
    """볼 수 없는 부모 맵은 이름 미노출 — hidden_count로만 집계. sysadmin은 전부 열람."""
    target = seed_target("usage-mask-target")
    seed_host("usage-mask-secret", target, "ums", visibility="private")
    act_as(OTHER)  # target은 public → viewer, 부모 private 맵은 접근 불가
    data = client.get(f"/api/maps/{target}/subprocess-usage").json()
    assert data["used_by"] == []
    assert data["hidden_count"] == 1
    act_as(SYSADMIN)
    data = client.get(f"/api/maps/{target}/subprocess-usage").json()
    assert [u["name"] for u in data["used_by"]] == ["usage-mask-secret"]
    assert data["hidden_count"] == 0


def test_usage_excludes_deleted_parent(client: TestClient, enforce) -> None:
    """소프트삭제된 부모 맵은 목록·hidden 어디에도 없음."""
    target = seed_target("usage-del-target")
    seed_host("usage-del-host", target, "udh", deleted=True)
    act_as(OWNER)
    data = client.get(f"/api/maps/{target}/subprocess-usage").json()
    assert data["used_by"] == []
    assert data["hidden_count"] == 0


def test_usage_requires_viewer_on_target(client: TestClient, enforce) -> None:
    """target 맵 viewer 미만은 403 — 에디터 접근 가능자만 탭 데이터 조회."""
    target = seed_target("usage-guard-target", visibility="private")
    act_as(OTHER)
    res = client.get(f"/api/maps/{target}/subprocess-usage")
    assert res.status_code == 403
