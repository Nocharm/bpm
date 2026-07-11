"""운영 대시보드 집계 — /summary 스냅샷, /timeseries 시계열 (design 2026-07-11)."""

import asyncio
from datetime import date, datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.clock import KST
from app.clock import now as now_kst
from app.db import SessionLocal
from app.models import (
    CheckoutRequest,
    Comment,
    DashboardCoverageDept,
    Employee,
    LoginRecord,
    MapVersion,
    Notification,
    ProcessMap,
    VersionEvent,
)


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


def _first_version_id(map_id: int) -> int:
    """맵의 첫 버전 id — ops/이벤트 시드가 붙일 version_id를 얻는다."""

    async def _run() -> int:
        async with SessionLocal() as session:
            version = (
                await session.scalars(select(MapVersion).where(MapVersion.map_id == map_id))
            ).first()
            assert version is not None
            return version.id

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


def test_ops_counts_unresolved_comment_and_pending_checkout(client: TestClient) -> None:
    """unresolved_comments·pending_checkouts는 전사 카운트라 델타(+1)로 비교한다."""
    map_id = _seed_map("Ops Delta Map", "Ops Div/Ops Office", ["draft"])
    version_id = _first_version_id(map_id)

    before = client.get("/api/dashboard/summary").json()["ops"]

    async def _seed_ops() -> None:
        async with SessionLocal() as session:
            session.add(
                Comment(
                    version_id=version_id,
                    node_id="n1",
                    author="ops-delta-author",
                    body="unresolved comment",
                )
            )
            session.add(
                CheckoutRequest(version_id=version_id, requested_by="ops-delta-requester")
            )
            await session.commit()

    asyncio.run(_seed_ops())
    after = client.get("/api/dashboard/summary").json()["ops"]

    assert after["unresolved_comments"] == before["unresolved_comments"] + 1
    assert after["pending_checkouts"] == before["pending_checkouts"] + 1


def test_recent_events_sorted_desc_with_join_and_actor_fallback(client: TestClient) -> None:
    """recent_events는 created_at desc 정렬·map_name/version_label 조인·actor_name 해석(Employee 있으면 이름, 없으면 login_id)을 지킨다."""
    map_id = _seed_map("Events Order Map", "Events Div/Events Office", ["draft"])
    version_id = _first_version_id(map_id)

    known_actor = "events-order-known-actor"
    unknown_actor = "events-order-unknown-actor"

    async def _seed_events() -> None:
        async with SessionLocal() as session:
            session.add(Employee(login_id=known_actor, name="Known Actor Name", source="local"))
            # 두 이벤트는 base 기준 1마이크로초 차이 — 세션 전체에서 항상 가장 최근 2건이 되도록
            # "지금"에 최대한 붙인다. 초 단위로 과거로 물러나면 직전에 실행된 다른 테스트(예:
            # test_collab.py의 맵 생성 "created" 이벤트)가 그 사이에 끼어 정렬 단언이 깨진다
            # (단일 프로세스 순차 실행이라도, 앞서 실행된 테스트의 실제 이벤트가 그 시간대에 존재).
            base = now_kst()
            older = base - timedelta(microseconds=1)
            newer = base
            session.add(
                VersionEvent(
                    version_id=version_id,
                    event_type="created",
                    actor=unknown_actor,
                    created_at=older,
                )
            )
            session.add(
                VersionEvent(
                    version_id=version_id,
                    event_type="submitted",
                    actor=known_actor,
                    created_at=newer,
                )
            )
            await session.commit()

    asyncio.run(_seed_events())

    events = client.get("/api/dashboard/summary").json()["recent_events"]
    assert len(events) >= 2
    newest, second = events[0], events[1]

    # 정렬 — 방금 시드한 더 최근 이벤트가 항상 맨 앞
    assert newest["event_type"] == "submitted"
    assert newest["map_name"] == "Events Order Map"
    assert newest["version_label"] == "v1"
    assert newest["actor_name"] == "Known Actor Name"

    assert second["event_type"] == "created"
    assert second["map_name"] == "Events Order Map"
    assert second["version_label"] == "v1"
    assert second["actor_name"] == unknown_actor  # Employee 행 없음 → login_id 그대로 폴백

    assert newest["created_at"] >= second["created_at"]


def _date_key(value) -> str:
    return value.strftime("%Y-%m-%d")


def test_timeseries_zero_fills_and_buckets_logins(client: TestClient) -> None:
    """빈 날도 0으로 채우고, 로그인은 KST 날짜 버킷에 담긴다."""
    today = now_kst()
    start = today - timedelta(days=2)

    async def _seed() -> None:
        async with SessionLocal() as session:
            session.add(LoginRecord(login_id="ts.user"))  # 오늘
            await session.commit()

    asyncio.run(_seed())

    response = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(start), "to": _date_key(today)},
    )
    assert response.status_code == 200
    body = response.json()
    assert [point["date"] for point in body["points"]] == [
        _date_key(start),
        _date_key(start + timedelta(days=1)),
        _date_key(today),
    ]
    today_point = body["points"][-1]
    assert today_point["logins"] >= 1


def test_timeseries_rejects_inverted_and_oversized_range(client: TestClient) -> None:
    today = now_kst()
    inverted = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today), "to": _date_key(today - timedelta(days=1))},
    )
    assert inverted.status_code == 422

    oversized = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today - timedelta(days=400)), "to": _date_key(today)},
    )
    assert oversized.status_code == 422


def test_timeseries_rejects_malformed_date(client: TestClient) -> None:
    """`from`/`to`가 YYYY-MM-DD 형식이 아니면 422 — 파싱 실패를 명시적으로 거부한다."""
    response = client.get(
        "/api/dashboard/timeseries", params={"from": "2026/07/01", "to": "2026-07-05"}
    )
    assert response.status_code == 422


def test_kst_date_key_normalizes_naive_and_aware_datetimes() -> None:
    """_kst_date_key 단위 회귀 — Finding 2(UTC 버킷 밀림)는 DB를 거치지 않고 여기서 잡는다.
    sqlite는 tz-aware 컬럼도 naive로 왕복시켜(이미 KST 값) 로컬 테스트로는
    asyncpg(Postgres, UTC aware 반환) 버그가 절대 재현되지 않는다 — 이 테스트가 유일한 방어선."""
    from app.routers.dashboard import _kst_date_key

    naive = datetime(2026, 7, 11, 23, 0)  # sqlite 왕복값 — tzinfo 없음, 이미 KST로 저장된 값
    assert _kst_date_key(naive) == "2026-07-11"

    utc_aware = datetime(2026, 7, 11, 20, 0, tzinfo=timezone.utc)  # KST로는 07-12 05:00
    assert _kst_date_key(utc_aware) == "2026-07-12"  # 픽스 전 코드라면 "2026-07-11"을 냄

    kst_aware = datetime(2026, 7, 12, 5, 0, tzinfo=KST)
    assert _kst_date_key(kst_aware) == "2026-07-12"


def test_timeseries_accepts_max_range_and_rejects_one_more(client: TestClient) -> None:
    """상한이 정확히 366일임을 못박는다 — off-by-one 방지."""
    start = date(2024, 1, 1)
    ok = client.get(
        "/api/dashboard/timeseries",
        params={"from": start.isoformat(), "to": (start + timedelta(days=365)).isoformat()},
    )
    assert ok.status_code == 200
    assert len(ok.json()["points"]) == 366

    too_big = client.get(
        "/api/dashboard/timeseries",
        params={"from": start.isoformat(), "to": (start + timedelta(days=366)).isoformat()},
    )
    assert too_big.status_code == 422


def test_timeseries_single_day_range_returns_one_point(client: TestClient) -> None:
    """from == to 는 유효한 하루짜리 범위 — 포인트 정확히 1개."""
    today = now_kst()
    response = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today), "to": _date_key(today)},
    )
    assert response.status_code == 200
    body = response.json()
    assert len(body["points"]) == 1
    assert body["points"][0]["date"] == _date_key(today)


def test_timeseries_buckets_maps_created_and_versions_created(client: TestClient) -> None:
    """맵·버전 생성이 오늘 버킷에 집계된다 — 기존 테스트는 logins만 검증해 공백이 있었다."""
    today = now_kst()
    _seed_map("TS Bucket Map", "TS Div/TS Office", ["draft"])

    response = client.get(
        "/api/dashboard/timeseries",
        params={"from": _date_key(today), "to": _date_key(today)},
    )
    assert response.status_code == 200
    today_point = response.json()["points"][-1]
    assert today_point["maps_created"] >= 1
    assert today_point["versions_created"] >= 1
