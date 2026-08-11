"""웹 JSON 대량 임포트 API — POST /api/categories/import (dry-run/apply, CLI 엔진 재사용)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings
from tests.test_consultant_import import _run, _seed_import_employees

STRANGER_SYSADMIN = "imp.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — test_categories_admin.py의 동일 픽스처를 미러."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _cats(prefix: str) -> list[dict]:
    return [
        {"code": f"{prefix}-A", "name": "구매", "level": 1, "parent": None},
        {"code": f"{prefix}-A1", "name": "직접구매", "level": 2, "parent": f"{prefix}-A"},
    ]


def _map_payload(**over: object) -> dict:
    base: dict = {
        "code": "CM-WEB-01", "name": "원자재 구매", "category": "WEB-A1", "owner": "cons.owner",
        "approvers": ["cons.appr"], "department": "Consult Div/Consult Team",
        "params": {"duration": "1.30", "input": "PR", "output": "PO"},
        "nodes": [
            {"code": "N1", "name": "요청", "type": "process", "seq": 1},
            {"code": "N2", "name": "발주", "type": "process", "seq": 2},
        ],
        "edges": [], "links": [],
    }
    base.update(over)
    return base


def test_dry_run_reports_without_persisting(client: TestClient) -> None:
    _seed_import_employees()
    resp = client.post(
        "/api/categories/import",
        json={"categories": _cats("WEB"), "maps": [_map_payload()], "apply": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["applied"] is False
    # warning은 라우터가 항상 채운다(0건이어도 키 존재 — fix round 1, rows 캡 대비 별도 카운트)
    assert body["summary"] == {"created": 1, "warning": 0}
    assert body["truncated"] is False
    assert [r["action"] for r in body["rows"]] == ["created"]

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory, ProcessMap

    async def _check() -> tuple:
        async with SessionLocal() as session:
            m = (
                await session.scalars(
                    select(ProcessMap).where(ProcessMap.consultant_code == "CM-WEB-01")
                )
            ).first()
            c = (
                await session.scalars(
                    select(ProcessCategory).where(ProcessCategory.code == "WEB-A")
                )
            ).first()
            return m, c

    m, c = _run(_check())
    assert m is None and c is None  # dry-run은 rollback — 맵도 카테고리도 영속 안 됨


def test_apply_persists_and_publishes(client: TestClient) -> None:
    _seed_import_employees()
    payload = {
        "categories": _cats("WA"),
        "maps": [_map_payload(code="CM-WA-01", category="WA-A1")],
        "apply": True,
    }
    resp = client.post("/api/categories/import", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["applied"] is True
    assert body["summary"] == {"created": 1, "warning": 0}

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    async def _load() -> tuple:
        async with SessionLocal() as session:
            m = (
                await session.scalars(
                    select(ProcessMap).where(ProcessMap.consultant_code == "CM-WA-01")
                )
            ).one()
            v = (await session.scalars(select(MapVersion).where(MapVersion.map_id == m.id))).one()
            return m, v

    m, v = _run(_load())
    assert m.category_id is not None
    assert v.status == "published" and v.version_number == 1

    resp2 = client.post("/api/categories/import", json=payload)
    assert resp2.status_code == 200
    assert resp2.json()["summary"] == {"unchanged": 1, "warning": 0}


def test_invalid_map_item_reports_error_row(client: TestClient) -> None:
    _seed_import_employees()
    bad_map = _map_payload(
        code="CM-WEB-BAD", category="WEC-A1", edges=[{"from": "N1", "to": "GHOST"}]
    )
    good_map = _map_payload(code="CM-WEB-GOOD", category="WEC-A1")
    resp = client.post(
        "/api/categories/import",
        json={"categories": _cats("WEC"), "maps": [bad_map, good_map], "apply": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["created"] == 1
    assert body["summary"]["error"] == 1
    error_rows = [r for r in body["rows"] if r["action"] == "error"]
    assert len(error_rows) == 1
    assert error_rows[0]["code"] == "-"
    assert "GHOST" in error_rows[0]["detail"]


def test_summary_includes_warning_count(client: TestClient) -> None:
    """summary["warning"]은 counts()가 제외해도 라우터가 별도로 채운다(fix round 1 IMPORTANT 2).

    department="" → 미지정 department는 known이 아니라 owner org로 폴백하며 경고 행을 남긴다
    (import_consultant.resolve_owning_department, cons.owner의 org는 conftest 시드).
    """
    _seed_import_employees()
    payload = {
        "categories": _cats("WWARN"),
        "maps": [
            # name도 고유하게 — 기본값("원자재 구매")은 앞선 테스트(session-scoped client/db)가 이미
            # 영속시켜, 겹치면 duplicate-name 경고가 하나 더 붙어 count가 어긋난다.
            _map_payload(code="CM-WWARN-01", name="경고 테스트 맵", category="WWARN-A1", department="")
        ],
        "apply": False,
    }
    resp = client.post("/api/categories/import", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["summary"]["warning"] == 1
    warning_rows = [r for r in body["rows"] if r["action"] == "warning"]
    assert len(warning_rows) == 1
    assert "fallback" in warning_rows[0]["detail"]


def test_invalid_categories_422(client: TestClient) -> None:
    resp = client.post(
        "/api/categories/import",
        json={
            "categories": [{"code": "WEB-ORPHAN", "name": "고아", "level": 2, "parent": "NOPE"}],
            "maps": [],
            "apply": False,
        },
    )
    assert resp.status_code == 422
    assert "parent" in resp.json()["detail"]


def test_import_requires_sysadmin(client: TestClient, enforce: None) -> None:
    act_as("imp.normal_user")
    resp = client.post(
        "/api/categories/import", json={"categories": [], "maps": [], "apply": False}
    )
    assert resp.status_code == 403
