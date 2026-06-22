"""시드 워크플로 불변식 정규화 — 멱등 보정 (design 2026-06-23)."""

import asyncio
from collections.abc import Awaitable, Callable
from typing import TypeVar

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import MapApprover, MapVersion, ProcessMap, VersionApproval

T = TypeVar("T")


def _run(coro_factory: Callable[..., Awaitable[T]]) -> T:
    async def _inner() -> T:
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_inner())


def test_normalize_fills_owner_approver_submitter_approvals(client: TestClient) -> None:
    from scripts.seed_invariants import normalize_workflow_invariants

    async def seed_broken(session) -> int:
        # owner 없음 + 승인자 없음 + published인데 submitted_by 없음 + 승인이력 없음
        m = ProcessMap(name="broken demo", owner_id=None, created_by=None)
        m.versions.append(MapVersion(label="As-Is", status="published"))
        session.add(m)
        await session.flush()
        return m.id

    map_id = _run(seed_broken)
    _run(normalize_workflow_invariants)

    async def check(session) -> dict:
        m = await session.get(ProcessMap, map_id)
        approver_rows = (
            await session.scalars(select(MapApprover.user_id).where(MapApprover.map_id == map_id))
        ).all()
        v = (
            await session.scalars(select(MapVersion).where(MapVersion.map_id == map_id))
        ).all()[0]
        approval_rows = (
            await session.scalars(
                select(VersionApproval.approver).where(VersionApproval.version_id == v.id)
            )
        ).all()
        assert m is not None
        return {
            "owner": m.owner_id,
            "approvers": list(approver_rows),
            "submitted_by": v.submitted_by,
            "approvals": sorted(approval_rows),
            "status": v.status,
        }

    result = _run(check)
    assert result["owner"] is not None
    assert len(result["approvers"]) >= 1
    assert result["submitted_by"] is not None
    # published → 모든 승인자가 승인행을 가져야 (만장일치)
    assert result["approvals"] == sorted(result["approvers"])


def test_normalize_is_idempotent(client: TestClient) -> None:
    from scripts.seed_invariants import normalize_workflow_invariants

    async def seed_broken(session) -> None:
        m = ProcessMap(name="idem demo", owner_id=None, created_by=None)
        m.versions.append(MapVersion(label="As-Is", status="pending"))
        session.add(m)
        await session.flush()

    _run(seed_broken)
    first = _run(normalize_workflow_invariants)
    second = _run(normalize_workflow_invariants)

    assert sum(first.values()) >= 1
    assert sum(second.values()) == 0
