"""운영 Postgres 전용 결함 가드 (리뷰 2026-10-19 H-2·H-4·H-6) — sqlite가 숨기는 길이·형 차이."""

import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import VARCHAR, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import TEXT, TIMESTAMP

from app.db import _reconcile_column_types, engine, find_column_type_drift
from app.models import Base
from app.schemas import EdgeIn, GroupRenameIn, NodeIn

_seq = 0


def _create_version(client: TestClient) -> int:
    global _seq
    _seq += 1
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"pg guard map {_seq}"}
    ).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


def test_title_label_name_reject_over_column_length() -> None:
    long = "x" * 201
    with pytest.raises(ValidationError):
        NodeIn(id="n1", title=long)
    with pytest.raises(ValidationError):
        EdgeIn(id="e1", source_node_id="a", target_node_id="b", label=long)
    with pytest.raises(ValidationError):
        GroupRenameIn(name=long)
    assert NodeIn(id="n1", title="x" * 200).title == "x" * 200


def test_graph_put_with_long_title_is_422(client: TestClient) -> None:
    version_id = _create_version(client)
    payload = {"nodes": [{"id": f"long-{version_id}", "title": "가" * 201}], "edges": [], "groups": []}

    response = client.put(f"/api/versions/{version_id}/graph", json=payload)

    assert response.status_code == 422


def test_drift_finds_naive_timestamp_and_short_varchar() -> None:
    db_columns = {
        "app_settings": {"key": VARCHAR(100), "value": VARCHAR(500), "updated_at": TIMESTAMP(timezone=True)},
        "feedback": {"reply_notified_at": TIMESTAMP(timezone=False), "status_notified_at": TIMESTAMP(timezone=True)},
    }

    drift = find_column_type_drift(Base.metadata, db_columns)

    assert ("app_settings", "value", "TEXT") in drift
    assert ("feedback", "reply_notified_at", "TIMESTAMPTZ") in drift
    assert ("feedback", "status_notified_at", "TIMESTAMPTZ") not in drift
    assert all(col != "key" for _, col, _ in drift)  # 모델도 VARCHAR면 건드리지 않는다


def test_drift_ignores_matching_and_unknown_columns() -> None:
    db_columns = {
        "app_settings": {"value": TEXT(), "updated_at": TIMESTAMP(timezone=True)},
        "no_such_table": {"x": TIMESTAMP(timezone=False)},
        "feedback": {"id": Integer(), "missing_in_model": DateTime()},
    }

    assert find_column_type_drift(Base.metadata, db_columns) == []


def test_every_model_timestamp_is_timezone_aware() -> None:
    """드리프트 판정의 전제 — 모델 시각 컬럼이 전부 timezone=True여야 운영 형을 그쪽으로 맞춘다."""
    naive = [
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if isinstance(column.type, DateTime) and not column.type.timezone
    ]
    assert naive == []
    assert isinstance(Base.metadata.tables["app_settings"].columns["value"].type, Text)


def test_reconcile_step_is_noop_on_sqlite(client: TestClient) -> None:
    async def _run() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(_reconcile_column_types)

    asyncio.run(_run())  # 예외 없이 지나가면 된다(sqlite는 형을 강제하지 않는다)
