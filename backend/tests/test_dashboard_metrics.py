"""운영 대시보드 집계 — /summary 스냅샷, /timeseries 시계열 (design 2026-07-11)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import DashboardCoverageDept, MapVersion, Notification, ProcessMap


def _seed_map(name: str, owning_department: str, statuses: list[str]) -> int:
    """맵 1개 + 주어진 status의 버전들을 시드하고 map_id 반환."""

    async def _run() -> int:
        async with SessionLocal() as session:
            found_map = ProcessMap(
                name=name, owner_id="admin.sys", owning_department=owning_department
            )
            session.add(found_map)
            await session.flush()
            for index, status in enumerate(statuses):
                session.add(
                    MapVersion(map_id=found_map.id, label=f"v{index + 1}", status=status)
                )
            await session.commit()
            return found_map.id

    return asyncio.run(_run())


def _set_coverage(paths: list[str]) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for path in paths:
                if await session.get(DashboardCoverageDept, path) is None:
                    session.add(DashboardCoverageDept(org_path=path, added_by="admin.sys"))
            await session.commit()

    asyncio.run(_run())


def test_summary_counts_maps_and_version_status(client: TestClient) -> None:
    before = client.get("/api/dashboard/summary").json()
    _seed_map("Cov Map A", "Cov Div/Cov Office", ["published", "draft"])
    after = client.get("/api/dashboard/summary").json()

    assert after["maps"]["total"] == before["maps"]["total"] + 1
    assert after["maps"]["published"] == before["maps"]["published"] + 1
    assert after["maps"]["draft"] == before["maps"]["draft"] + 1
    assert after["version_status"]["published"] == before["version_status"]["published"] + 1
    assert after["version_status"]["draft"] == before["version_status"]["draft"] + 1


def test_trashed_map_excluded_from_total_and_counted_in_trashed(client: TestClient) -> None:
    """소프트삭제(deleted_at) 맵은 total/버전집계에서 빠지고 trashed에만 잡힌다."""
    map_id = _seed_map("Cov Map C", "Cov Div/Cov Office", ["published"])
    before = client.get("/api/dashboard/summary").json()

    async def _soft_delete() -> None:
        async with SessionLocal() as session:
            found_map = await session.get(ProcessMap, map_id)
            assert found_map is not None
            found_map.deleted_at = found_map.created_at
            await session.commit()

    asyncio.run(_soft_delete())
    after = client.get("/api/dashboard/summary").json()

    assert after["maps"]["total"] == before["maps"]["total"] - 1
    assert after["maps"]["published"] == before["maps"]["published"] - 1
    assert after["maps"]["trashed"] == before["maps"]["trashed"] + 1
    assert after["version_status"]["published"] == before["version_status"]["published"] - 1


def test_coverage_counts_descendant_department_maps(client: TestClient) -> None:
    """하위 부서(Cov Div/Cov Office)의 맵이 상위 지정 부서(Cov Div)에 귀속된다."""
    _seed_map("Cov Map B", "Cov Div/Cov Office", ["published"])
    _set_coverage(["Cov Div", "Empty Div"])

    coverage = client.get("/api/dashboard/summary").json()["coverage"]
    rows = {row["org_path"]: row for row in coverage["rows"]}

    assert rows["Cov Div"]["maps"] >= 1
    assert rows["Empty Div"]["maps"] == 0
    assert "Empty Div" in [row["org_path"] for row in coverage["rows"] if row["maps"] == 0]
    assert coverage["depts_total"] >= 2
    # 커버리지 % = 맵 보유 부서 / 전체 지정 부서
    assert 0 <= coverage["coverage_pct"] <= 100


def test_coverage_pct_is_zero_when_no_depts_configured(client: TestClient) -> None:
    """지정 부서가 0개면 0으로 나누지 않고 0%."""

    async def _clear() -> None:
        from sqlalchemy import delete

        async with SessionLocal() as session:
            await session.execute(delete(DashboardCoverageDept))
            await session.commit()

    asyncio.run(_clear())
    coverage = client.get("/api/dashboard/summary").json()["coverage"]
    assert coverage["depts_total"] == 0
    assert coverage["coverage_pct"] == 0
    assert coverage["rows"] == []


def test_unread_notifications_scoped_to_requester(client: TestClient) -> None:
    """unread_notifications는 요청자 본인 수신분만 — 전사 합계가 아니다."""
    requester = "dash-summary-notif-me"
    other = "dash-summary-notif-other"

    async def _seed_notifications() -> None:
        async with SessionLocal() as session:
            session.add(Notification(recipient=requester, type="test", read=False))
            session.add(Notification(recipient=other, type="test", read=False))
            await session.commit()

    before = client.get(
        "/api/dashboard/summary", headers={"X-Dev-User": requester}
    ).json()["ops"]["unread_notifications"]
    asyncio.run(_seed_notifications())
    after = client.get(
        "/api/dashboard/summary", headers={"X-Dev-User": requester}
    ).json()["ops"]["unread_notifications"]

    assert after == before + 1
