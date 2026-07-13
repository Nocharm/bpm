"""SP 숫자 파라미터 — 지정 경계 정규화·응답 레거시 소거·refs 확장."""

import asyncio
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import MapPermission, MapVersion, Node, ProcessMap

OWNER = "spparams.owner"

T = TypeVar("T")


def _seed(coro_factory: Callable[[Any], Coroutine[Any, Any, T]]) -> T:
    """비동기 SessionLocal 작업을 동기 테스트에서 실행 — test_subprocess_designation._seed 미러."""

    async def _run() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


@pytest.fixture
def session() -> Callable[[Callable[[Any], Coroutine[Any, Any, T]]], T]:
    """DB 직접 조작용 — 레거시 자유텍스트 값을 API 경계를 우회해 심는다."""
    return _seed


@pytest.fixture
def published_map_id(client: TestClient) -> int:
    """게시 버전 1개 + owner 권한행을 가진 맵 — SP 지정 대상 (seed_map 미러, spec 2026-07-06)."""

    async def _make(db_session: Any) -> int:
        m = ProcessMap(name="sp-params-map", visibility="private", owner_id=OWNER)
        v = MapVersion(label="As-Is", status="published")
        m.versions.append(v)
        db_session.add(m)
        await db_session.flush()
        db_session.add(
            MapPermission(
                map_id=m.id,
                principal_type="user",
                principal_id=OWNER,
                role="owner",
                granted_by=OWNER,
            )
        )
        return m.id

    return _seed(_make)


def seed_host_with_subprocess_node(target_map_id: int, node_id: str) -> int:
    """subprocess 노드 1개가 target을 가리키는 호스트 맵 시드 — version_id 반환.

    test_subprocess_designation.seed_host_with_subprocess_node 미러. 검증(시작노드 규칙)을
    안 타도록 REST 대신 DB 직접 시드.
    """

    async def _make(db_session: Any) -> int:
        m = ProcessMap(name=f"sp-params-host-{node_id}", visibility="public", owner_id=OWNER)
        v = MapVersion(label="As-Is", status="draft")
        m.versions.append(v)
        db_session.add(m)
        await db_session.flush()
        db_session.add(
            Node(
                id=node_id,
                version_id=v.id,
                node_type="subprocess",
                title="call target",
                linked_map_id=target_map_id,
            )
        )
        return v.id

    return _seed(_make)


def test_designation_normalizes_numeric_params(client: TestClient, published_map_id: int) -> None:
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={
            "department": "Owning Anchor Division",
            "duration": "0.75",
            "headcount": "2",
            "cost_krw": "300",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["sp_duration"] == "1.15"  # 60분 이월
    assert (body["sp_headcount"], body["sp_cost_krw"], body["sp_cost_usd"]) == ("2", "300", "")


def test_designation_clears_invalid_values(client: TestClient, published_map_id: int) -> None:
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={"department": "Owning Anchor Division", "duration": "2일", "headcount": "두명"},
    )
    assert resp.status_code == 200
    assert resp.json()["sp_duration"] == ""
    assert resp.json()["sp_headcount"] == ""


def test_sp_designation_rejects_both_currencies(client: TestClient, published_map_id: int) -> None:
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={"department": "Owning Anchor Division", "cost_krw": "1000", "cost_usd": "10"},
    )
    assert resp.status_code == 422


def test_sp_designation_has_no_annual_or_fte(client: TestClient, published_map_id: int) -> None:
    """연간 건수·FTE는 부모 맥락 값이라 SP 지정에 존재하지 않는다 — 보내도 무시된다."""
    resp = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={
            "department": "Owning Anchor Division",
            "duration": "1.30",
            "annual_count": "999",
            "fte": "9",
        },
    )
    assert resp.status_code == 200
    detail = client.get(f"/api/maps/{published_map_id}").json()
    assert detail["sp_duration"] == "1.30"
    assert "sp_annual_count" not in detail
    assert "sp_fte" not in detail


def test_legacy_free_text_sp_duration_cleared_in_responses(
    client: TestClient,
    session: Callable[[Callable[[Any], Coroutine[Any, Any, Any]]], Any],
    published_map_id: int,
) -> None:
    # DB에 레거시 자유텍스트를 직접 심고 응답 경계 소거 확인 (MapOut + subprocess_refs)
    async def _set_legacy(db_session: Any) -> None:
        found_map = await db_session.get(ProcessMap, published_map_id)
        found_map.sp_duration = "3일"

    session(_set_legacy)

    map_resp = client.get(f"/api/maps/{published_map_id}")
    assert map_resp.status_code == 200
    assert map_resp.json()["sp_duration"] is None

    host_version_id = seed_host_with_subprocess_node(published_map_id, "sp-params-sp1")
    graph_resp = client.get(f"/api/versions/{host_version_id}/graph")
    assert graph_resp.status_code == 200
    ref = graph_resp.json()["subprocess_refs"][str(published_map_id)]
    assert ref["duration"] is None


def test_legacy_free_text_sp_duration_cleared_in_library_list(
    client: TestClient,
    session: Callable[[Callable[[Any], Coroutine[Any, Any, Any]]], Any],
    published_map_id: int,
) -> None:
    # 라이브러리 목록은 raw dict 직렬화라 스키마 validator를 안 탄다 — 조립부 소거 확인
    designate = client.put(
        f"/api/maps/{published_map_id}/subprocess-designation",
        json={"department": "Owning Anchor Division"},
    )
    assert designate.status_code == 200

    async def _set_legacy(db_session: Any) -> None:
        found_map = await db_session.get(ProcessMap, published_map_id)
        found_map.sp_duration = "3일"

    session(_set_legacy)

    rows = client.get("/api/library/processes").json()
    mine = next(r for r in rows if r["map_id"] == published_map_id)
    assert mine["duration"] is None
