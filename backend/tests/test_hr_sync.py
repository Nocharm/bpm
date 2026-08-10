"""HR 전체 동기화 테스트 — 목·시드 헬퍼는 hr_sync_helpers 공유(실 HTTP 없음). 설계 §5."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.hr.client import RawHrDepartment
from app.models import Department, DeptInfo
from app.settings import settings
from tests.hr_sync_helpers import _get_employee, _hr_row, _mock_hr, _run_sync, _seed_employee


def test_sync_upserts_and_converts_ad_source(client: TestClient, monkeypatch) -> None:
    _seed_employee("legacy.ad", source="ad", title="Manager", korean_name="레거시")
    _mock_hr(monkeypatch, [_hr_row("legacy.ad", name="Legacy Kim"), _hr_row("new.hr")])
    summary = _run_sync()
    assert summary.upserted == 2 and summary.aborted_reason is None
    emp = _get_employee("legacy.ad")
    assert emp.source == "hr" and emp.name == "Legacy Kim"
    assert emp.title == "Manager"       # title 미터치 (§4)
    assert emp.korean_name == "레거시"   # nameKo null → 보존
    assert _get_employee("new.hr") is not None


def test_sync_deactivates_and_preserves_local(client: TestClient, monkeypatch) -> None:
    _seed_employee("quit.user", source="hr", active=True)
    _seed_employee("local.dev1", source="local")
    _mock_hr(monkeypatch, [_hr_row("quit.user", status="inactive")])
    summary = _run_sync()
    assert summary.deactivated == 1
    assert _get_employee("quit.user").active is False       # 삭제 아님 (§5-2)
    assert _get_employee("local.dev1") is not None          # local 보존 (§5-3)


def test_sync_deletes_absent_managed_rows(client: TestClient, monkeypatch) -> None:
    _seed_employee("gone.ad", source="ad")
    _seed_employee("gone.hr", source="hr")
    _seed_employee("stay.local", source="local")
    _mock_hr(monkeypatch, [_hr_row("alive.hr")])  # 가드는 _mock_hr가 기본 해제
    summary = _run_sync()
    assert summary.deleted >= 2
    assert _get_employee("gone.ad") is None and _get_employee("gone.hr") is None
    assert _get_employee("stay.local") is not None


def test_sync_delete_cap_aborts_without_changes(client: TestClient, monkeypatch) -> None:
    _seed_employee("cap.a", source="hr")
    _seed_employee("cap.b", source="hr")
    _mock_hr(monkeypatch, [_hr_row("cap.new")])  # 기존 배치 관리 행 대부분 삭제될 피드
    monkeypatch.setattr(settings, "hr_sync_delete_cap_pct", 20)  # _mock_hr 기본 해제 후 가드 재활성
    summary = _run_sync()
    assert summary.aborted_reason is not None and "delete cap" in summary.aborted_reason
    assert _get_employee("cap.a") is not None    # 아무것도 안 바뀜
    assert _get_employee("cap.new") is None


def test_sync_count_mismatch_aborts(client: TestClient, monkeypatch) -> None:
    _mock_hr(monkeypatch, [_hr_row("x.y")], count=99)
    summary = _run_sync()
    assert summary.aborted_reason is not None and "count" in summary.aborted_reason


def test_sync_skips_rows_without_login_id_and_reports(client: TestClient, monkeypatch) -> None:
    rows = [_hr_row("ok.user"), None,
            _hr_row("deep.user", org_levels=["A", "B", "C", "D", "E", "F"], department="F")]
    _mock_hr(monkeypatch, rows)
    summary = _run_sync()
    assert summary.skipped == 1
    assert summary.truncated_levels == 1 and summary.org_mismatches == 1


def test_sync_chunked_delete_over_bind_limit(client: TestClient, monkeypatch) -> None:
    # SQLite 바인드 상한(구버전 999) 초과 삭제가 청크로 완료되는지 (§5-3)
    for i in range(1100):
        _seed_employee(f"bulk{i}.hr", source="hr")
    _mock_hr(monkeypatch, [_hr_row("survivor.hr")])
    summary = _run_sync()
    assert summary.deleted >= 1100
    assert _get_employee("bulk0.hr") is None and _get_employee("bulk1099.hr") is None


def test_sync_mirrors_departments_and_reports_dept_info_orphans(client: TestClient, monkeypatch) -> None:
    async def _seed_info() -> None:
        async with SessionLocal() as session:
            if await session.get(DeptInfo, "Ghost Team") is None:
                session.add(DeptInfo(department="Ghost Team", korean_name="유령팀", manager="ghost.mgr"))
            await session.commit()

    asyncio.run(_seed_info())
    depts = [RawHrDepartment("D1", "Div", "본부", None, 1), RawHrDepartment("D11", "Team A", "A팀", "D1", 2)]
    _mock_hr(monkeypatch, [_hr_row("mirror.user")], departments=depts)
    summary = _run_sync()
    assert summary.departments_upserted == 2
    assert "Ghost Team" in summary.dept_info_orphans

    async def _check() -> tuple:
        async with SessionLocal() as session:
            dept = await session.get(Department, "D11")
            info = await session.get(DeptInfo, "Ghost Team")
            return dept, info

    dept, info = asyncio.run(_check())
    assert dept is not None and dept.parent_dept_code == "D1"
    assert info is not None and info.manager == "ghost.mgr"  # dept_info 절대 미변경 (§5-6)


def test_reconcile_releases_checkout_of_deactivated(client: TestClient, monkeypatch) -> None:
    # 비활성 전환자가 잡던 점유가 해제되는지 — reconcile_departures 경유 (§5-2)
    from app.models import MapVersion, ProcessMap

    async def _seed() -> int:
        async with SessionLocal() as session:
            pmap = ProcessMap(name="HR Reconcile Map", created_by="local-dev",
                              owning_department="Owning Anchor Division")
            session.add(pmap)
            await session.flush()
            # MapVersion에는 created_by 컬럼이 없음(모델 확인) — label/status/checked_out_by만.
            version = MapVersion(map_id=pmap.id, label="draft", status="draft",
                                 checked_out_by="hold.user")
            session.add(version)
            await session.commit()
            return version.id

    version_id = asyncio.run(_seed())
    _seed_employee("hold.user", source="hr", active=True)
    _mock_hr(monkeypatch, [_hr_row("hold.user", status="inactive")])
    _run_sync()

    async def _checked_out() -> str | None:
        async with SessionLocal() as session:
            return (await session.get(MapVersion, version_id)).checked_out_by

    assert asyncio.run(_checked_out()) is None
