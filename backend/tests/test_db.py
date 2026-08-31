"""스키마 보강 스톱갭 테스트 — 기존 테이블에 누락 컬럼 추가 (app/db.py)."""

import asyncio
import pathlib

from sqlalchemy import create_engine, inspect, text

from app.db import _ADDED_COLUMNS, _add_missing_columns, engine


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


def test_added_columns_registers_io_linking_fields() -> None:
    # io-linking §3 신규 컬럼 6개가 _ADDED_COLUMNS에 정확한 타입으로 등록됐는지 잠금 —
    # 운영은 startup 자동 ALTER(create_all 후속)로만 보강되므로 누락 시 배포본에 컬럼이 안 생긴다.
    expected = [
        ("nodes", "output_ids", "TEXT DEFAULT ''"),
        ("nodes", "input_links", "TEXT DEFAULT ''"),
        ("nodes", "output_links", "TEXT DEFAULT ''"),
        ("nodes", "input_flags", "TEXT DEFAULT ''"),
        ("process_maps", "sp_input_ids", "TEXT"),
        ("process_maps", "sp_output_ids", "TEXT"),
    ]
    for entry in expected:
        assert entry in _ADDED_COLUMNS


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


def test_drops_legacy_sp_description(tmp_path: pathlib.Path) -> None:
    """폐기 컬럼 물리 삭제 — 값이 있어도 드랍하고, 이미 없으면 no-op(멱등) (2026-08-31)."""
    from app.db import _drop_legacy_sp_description

    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE process_maps "
                "(id INTEGER PRIMARY KEY, name VARCHAR, description TEXT, sp_description TEXT)"
            )
        )
        conn.execute(
            text(
                "INSERT INTO process_maps (id, name, description, sp_description) "
                "VALUES (1, 'm', '맵 설명', '구 지정 설명')"
            )
        )

    with engine.begin() as conn:
        _drop_legacy_sp_description(conn)
    with engine.begin() as conn:
        _drop_legacy_sp_description(conn)  # 멱등 — 컬럼이 이미 없어도 예외 없이 통과

    with engine.connect() as conn:
        columns = {col["name"] for col in inspect(conn).get_columns("process_maps")}
        assert "sp_description" not in columns
        # 맵 설명은 그대로 — 일원화 대상이라 손대지 않는다
        assert conn.execute(text("SELECT description FROM process_maps WHERE id = 1")).scalar() == "맵 설명"


def test_drop_legacy_sp_description_skips_missing_table(tmp_path: pathlib.Path) -> None:
    """테이블 자체가 없는 DB(첫 기동)에서도 조용히 통과."""
    from app.db import _drop_legacy_sp_description

    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    with engine.begin() as conn:
        _drop_legacy_sp_description(conn)
