"""운영 잔여 — 시스템 리뷰 2026-10-19 7d(H-11·ref_audit 범위·reset_db 가드) 회귀."""

import asyncio

from sqlalchemy import delete, func, select

from app import ref_audit
from app.db import SessionLocal, engine
from app.models import ApprovalRequest, MapPermission, MapVersion, ProcessMap
from scripts.reset_db import ensure_reset_allowed


async def _new_map(session, name: str) -> ProcessMap:
    m = ProcessMap(name=f"{name} {id(object())}", visibility="private", created_by="user.lee", owner_id="user.lee")
    session.add(m)
    await session.flush()
    return m


def test_sqlite_purge_cascades_like_postgres() -> None:
    """sqlite가 FK를 꺼 두어 영구삭제 맵의 권한·요청 행이 남고, 재사용된 id로 새 맵이 물려받았다 (H-11)."""

    async def _run() -> tuple[int, int]:
        async with SessionLocal() as session:
            m = await _new_map(session, "fk cascade")
            session.add(MapPermission(map_id=m.id, principal_type="user", principal_id="user.kim",
                                      role="editor", granted_by="user.lee"))
            session.add(ApprovalRequest(map_id=m.id, kind="map_rename", payload={}, requested_by="user.lee"))
            await session.commit()
            map_id = m.id
        async with SessionLocal() as session:
            # ORM cascade를 거치지 않는 Core delete — 남은 정리는 DB의 ON DELETE CASCADE 몫
            await session.execute(delete(ProcessMap).where(ProcessMap.id == map_id))
            await session.commit()
            perms = await session.scalar(select(func.count()).select_from(MapPermission).where(MapPermission.map_id == map_id))
            reqs = await session.scalar(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.map_id == map_id))
            return perms, reqs

    assert asyncio.run(_run()) == (0, 0)


def test_ref_audit_scans_rejected_and_pending_working_copies() -> None:
    """작업본이 반려·결재 대기인 맵은 스캔에서 빠져 고아 참조가 숨었다 (리뷰 확인 필요 항목)."""

    async def _run() -> tuple[dict, int, int, int]:
        async with SessionLocal() as session:
            rejected_map = await _new_map(session, "audit rejected")
            pending_map = await _new_map(session, "audit pending")
            pub = MapVersion(map_id=rejected_map.id, label="pub", status="published")
            rejected = MapVersion(map_id=rejected_map.id, label="rej", status="rejected")
            pending = MapVersion(map_id=pending_map.id, label="pend", status="pending")
            expired = MapVersion(map_id=pending_map.id, label="old", status="expired")
            session.add_all([pub, rejected, pending, expired])
            await session.commit()
            targets = await ref_audit.load_target_versions(session)
            return targets, pub.id, rejected.id, pending.id

    targets, pub_id, rejected_id, pending_id = asyncio.run(_run())
    scanned = {vid for rows in targets.values() for vid, _ in rows}
    assert {pub_id, rejected_id, pending_id} <= scanned
    assert (rejected_id, "draft") in next(rows for rows in targets.values() if (pub_id, "published") in rows)


def test_reset_db_guard_leaves_local_sqlite_alone() -> None:
    """postgres 빈 DB 판정은 일회용 postgres로 확인(보고서) — 로컬 sqlite 데모 리셋은 그대로 된다."""

    async def _run() -> None:
        async with engine.connect() as conn:
            await conn.run_sync(ensure_reset_allowed)

    asyncio.run(_run())
