"""스키마 보강 스톱갭 테스트 — 기존 테이블에 누락 컬럼 추가 (app/db.py)."""

import asyncio
import pathlib

from sqlalchemy import create_engine, inspect, text

from app.db import _add_missing_columns, engine


def test_stopgap_adds_workflow_columns(tmp_path: pathlib.Path) -> None:
    # 옛 스키마: map_versions에 워크플로우 컬럼이 없는 상태 + 기존 행 1개
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE map_versions "
                "(id INTEGER PRIMARY KEY, map_id INTEGER, label VARCHAR)"
            )
        )
        conn.execute(
            text("INSERT INTO map_versions (id, map_id, label) VALUES (1, 1, 'As-Is')")
        )

    with engine.begin() as conn:
        _add_missing_columns(conn)

    with engine.connect() as conn:
        columns = {col["name"] for col in inspect(conn).get_columns("map_versions")}
        assert {"status", "submitted_by", "reject_reason"}.issubset(columns)
        # 기존 행은 NULL이 아니라 DEFAULT 'draft'로 백필돼야 VersionOut(status:str) 검증을 통과
        status = conn.execute(
            text("SELECT status FROM map_versions WHERE id = 1")
        ).scalar()
        assert status == "draft"


def test_stopgap_is_idempotent(tmp_path: pathlib.Path) -> None:
    # 이미 컬럼이 있는 최신 스키마에 재적용해도 에러 없이 통과
    engine = create_engine(f"sqlite:///{tmp_path / 'new.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE map_versions "
                "(id INTEGER PRIMARY KEY, map_id INTEGER, label VARCHAR, "
                "status VARCHAR(20), submitted_by VARCHAR(100), reject_reason VARCHAR(500))"
            )
        )

    with engine.begin() as conn:
        _add_missing_columns(conn)  # 누락 컬럼 없음 — no-op

    with engine.connect() as conn:
        columns = {col["name"] for col in inspect(conn).get_columns("map_versions")}
        assert "status" in columns


def test_added_indexes_bootstrap_idempotent(client) -> None:  # noqa: ARG001
    """기존 DB에 인덱스가 없어도 startup 보강이 만들고, 재실행은 no-op(멱등)."""
    from app.db import _add_missing_indexes

    async def _run() -> list[str]:
        async with engine.begin() as conn:
            # 기존-DB 시뮬레이션: 하나 지우고 보강 2회(멱등) 후 인덱스 목록
            await conn.execute(text("DROP INDEX IF EXISTS ix_notifications_recipient_read"))
            await conn.run_sync(_add_missing_indexes)
            await conn.run_sync(_add_missing_indexes)
            return await conn.run_sync(
                lambda c: [ix["name"] for ix in inspect(c).get_indexes("notifications")]
            )

    names = asyncio.run(_run())
    assert "ix_notifications_recipient_read" in names
    assert "ix_notifications_recipient_created" in names
