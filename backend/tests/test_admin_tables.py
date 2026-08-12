"""GET /api/admin/tables[/{name}] — sysadmin-gated read-only table viewer."""

from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim. Restore after."""
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.clear()


def test_list_tables_sysadmin_200(client: TestClient, sysadmin_enforced: None) -> None:
    """sysadmin → 200 with the app's table names + integer row counts (selector pills)."""
    res = client.get("/api/admin/tables", headers={"X-Dev-User": SYSADMIN})
    assert res.status_code == 200
    rows = res.json()
    names = [t["name"] for t in rows]
    for expected in ("employees", "process_maps", "nodes", "map_versions"):
        assert expected in names
    assert all(isinstance(t["count"], int) for t in rows)


def test_list_tables_non_sysadmin_403(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get("/api/admin/tables", headers={"X-Dev-User": NON_SYSADMIN})
    assert res.status_code == 403


def test_read_table_pagination(client: TestClient, sysadmin_enforced: None) -> None:
    """size caps the page; total/page/size echoed; columns reported."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"size": 2, "page": 1},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    body = res.json()
    assert "login_id" in body["columns"]
    assert body["page"] == 1 and body["size"] == 2
    assert len(body["rows"]) <= 2
    assert body["total"] >= 5  # 5 seeded LOCAL_USERS


def test_read_table_sort_desc(client: TestClient, sysadmin_enforced: None) -> None:
    """sort+order applies server-side."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"sort": "login_id", "order": "desc", "size": 100},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    ids = [r["login_id"] for r in res.json()["rows"]]
    assert ids == sorted(ids, reverse=True)


def test_read_table_filter(client: TestClient, sysadmin_enforced: None) -> None:
    """q filters across text columns (bound param)."""
    res = client.get(
        "/api/admin/tables/employees",
        params={"q": "admin.kim"},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    assert any(r["login_id"] == "admin.kim" for r in body["rows"])


def test_read_table_unknown_404(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/no_such_table", headers={"X-Dev-User": SYSADMIN}
    )
    assert res.status_code == 404


def test_read_table_non_sysadmin_403(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/employees", headers={"X-Dev-User": NON_SYSADMIN}
    )
    assert res.status_code == 403


def test_export_table_csv_sysadmin_200(client: TestClient, sysadmin_enforced: None) -> None:
    """sysadmin export → 200 text/csv, header row + CRLF-joined data rows == full seeded row count."""
    total = client.get(
        "/api/admin/tables/employees",
        params={"size": 200},
        headers={"X-Dev-User": SYSADMIN},
    ).json()["total"]

    res = client.get(
        "/api/admin/tables/employees/export", headers={"X-Dev-User": SYSADMIN}
    )
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert res.headers["content-disposition"] == 'attachment; filename="employees.csv"'

    assert res.text.endswith("\r\n")
    lines = res.text[: -len("\r\n")].split("\r\n")
    assert "login_id" in lines[0].split(",")
    assert len(lines) - 1 == total


def test_export_table_csv_filter(client: TestClient, sysadmin_enforced: None) -> None:
    """q filters across text columns, same as read_table — fewer rows than the unfiltered export."""
    res_all = client.get(
        "/api/admin/tables/employees/export", headers={"X-Dev-User": SYSADMIN}
    )
    res_filtered = client.get(
        "/api/admin/tables/employees/export",
        params={"q": "admin.kim"},
        headers={"X-Dev-User": SYSADMIN},
    )
    assert res_filtered.status_code == 200
    all_rows = res_all.text[: -len("\r\n")].split("\r\n")
    filtered_rows = res_filtered.text[: -len("\r\n")].split("\r\n")
    assert len(filtered_rows) < len(all_rows)
    assert any("admin.kim" in row for row in filtered_rows[1:])


def test_export_table_csv_non_sysadmin_403(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/employees/export", headers={"X-Dev-User": NON_SYSADMIN}
    )
    assert res.status_code == 403


def test_export_table_csv_unknown_404(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.get(
        "/api/admin/tables/no_such_table/export", headers={"X-Dev-User": SYSADMIN}
    )
    assert res.status_code == 404


def test_export_table_csv_formula_injection_guard(
    client: TestClient, sysadmin_enforced: None
) -> None:
    """Cell starting with '=' is single-quote-prefixed in the CSV (Excel/Sheets formula-injection guard)."""
    import asyncio

    from app.db import SessionLocal
    from app.models import Employee

    async def _seed() -> None:
        async with SessionLocal() as session:
            session.add(
                Employee(
                    login_id="csv.formula",
                    name="=SUM(A1)",
                    source="local",
                    active=True,
                )
            )
            await session.commit()

    asyncio.run(_seed())
    try:
        res = client.get(
            "/api/admin/tables/employees/export",
            params={"q": "csv.formula"},
            headers={"X-Dev-User": SYSADMIN},
        )
        assert res.status_code == 200
        assert "'=SUM(A1)" in res.text
    finally:

        async def _cleanup() -> None:
            async with SessionLocal() as session:
                row = await session.get(Employee, "csv.formula")
                if row is not None:
                    await session.delete(row)
                    await session.commit()

        asyncio.run(_cleanup())


def test_read_table_binary_column_rendered(client: TestClient, sysadmin_enforced: None) -> None:
    """LargeBinary 컬럼(kb_chunks.embedding)은 크기 표시로 대체 — bytes 직렬화 500 회귀 방지."""
    import asyncio

    from app.db import SessionLocal
    from app.models import KbChunk

    async def _seed() -> int:
        async with SessionLocal() as session:
            chunk = KbChunk(
                source_type="library",
                source_id=999999,
                chunk_index=0,
                chunk_text="admin tables binary render probe",
                embedding=b"\x00\x01\x02\x03",
                meta={},
            )
            session.add(chunk)
            await session.commit()
            return chunk.id

    chunk_id = asyncio.run(_seed())
    try:
        res = client.get(
            "/api/admin/tables/kb_chunks",
            params={"q": "admin tables binary render probe"},
            headers={"X-Dev-User": SYSADMIN},
        )
        assert res.status_code == 200
        rows = res.json()["rows"]
        mine = next(r for r in rows if r["id"] == chunk_id)
        assert mine["embedding"] == "<binary 4 bytes>"
    finally:
        async def _cleanup() -> None:
            async with SessionLocal() as session:
                row = await session.get(KbChunk, chunk_id)
                if row is not None:
                    await session.delete(row)
                    await session.commit()

        asyncio.run(_cleanup())
