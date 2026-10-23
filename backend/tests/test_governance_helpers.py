"""거버넌스 판정 공용 헬퍼 — 라우터와 감사 경로가 같은 규칙을 쓰는지 (permissions/governance.py)."""

import asyncio
import uuid

from app import workflow
from app.db import SessionLocal
from app.models import ApprovalRequest, MapPermission, MapVersion, ProcessMap
from app.permissions import governance


async def _new_map(session, **kw) -> ProcessMap:
    found = ProcessMap(
        name=f"gov helpers {uuid.uuid4().hex[:8]}",
        visibility="private",
        created_by="user.lee",
        owner_id="user.lee",
        **kw,
    )
    session.add(found)
    await session.flush()
    return found


async def _new_version(session, map_id: int, status: str, **kw) -> MapVersion:
    version = MapVersion(map_id=map_id, label=status, status=status, **kw)
    session.add(version)
    await session.flush()
    return version


def test_is_in_active_workflow_holder_and_submitter() -> None:
    async def run() -> dict[str, bool]:
        async with SessionLocal() as session:
            holder_map = await _new_map(session)
            await _new_version(session, holder_map.id, workflow.DRAFT, checked_out_by="u.holder")
            pending_map = await _new_map(session)
            await _new_version(session, pending_map.id, workflow.PENDING, submitted_by="u.sub")
            # 게시 끝난 버전에 남은 점유·제출 흔적은 진행 중이 아니다
            done_map = await _new_map(session)
            await _new_version(
                session, done_map.id, workflow.PUBLISHED,
                checked_out_by="u.old", submitted_by="u.old",
            )
            return {
                "holder": await governance.is_in_active_workflow(session, holder_map.id, "u.holder"),
                "holder_other": await governance.is_in_active_workflow(session, holder_map.id, "u.other"),
                "submitter": await governance.is_in_active_workflow(session, pending_map.id, "u.sub"),
                "published_trace": await governance.is_in_active_workflow(session, done_map.id, "u.old"),
            }

    got = asyncio.run(run())

    assert got == {
        "holder": True,
        "holder_other": False,
        "submitter": True,
        "published_trace": False,
    }


def test_has_version_in_approval() -> None:
    async def run() -> dict[str, bool]:
        async with SessionLocal() as session:
            approved_map = await _new_map(session)
            await _new_version(session, approved_map.id, workflow.APPROVED)
            draft_map = await _new_map(session)
            await _new_version(session, draft_map.id, workflow.DRAFT)
            published_map = await _new_map(session)
            await _new_version(session, published_map.id, workflow.PUBLISHED)
            return {
                "approved": await governance.has_version_in_approval(session, approved_map.id),
                "draft": await governance.has_version_in_approval(session, draft_map.id),
                "published": await governance.has_version_in_approval(session, published_map.id),
            }

    got = asyncio.run(run())

    assert got == {"approved": True, "draft": False, "published": False}


def test_has_own_pending_downgrade_and_find() -> None:
    async def run() -> dict[str, object]:
        async with SessionLocal() as session:
            found = await _new_map(session)
            grant = MapPermission(
                map_id=found.id, principal_type="user", principal_id="u.editor",
                role="editor", granted_by="user.lee",
            )
            session.add(grant)
            await session.flush()
            before = await governance.has_own_pending_downgrade(session, found.id, "u.editor")
            request = ApprovalRequest(
                map_id=found.id, kind="permission_downgrade", requested_by="user.lee",
                status="pending",
                payload={"permission_id": grant.id, "principal_type": "user",
                         "principal_id": "u.editor", "from_role": "editor", "to_role": "viewer"},
            )
            session.add(request)
            await session.flush()
            during = await governance.has_own_pending_downgrade(session, found.id, "u.editor")
            stranger = await governance.has_own_pending_downgrade(session, found.id, "u.stranger")
            looked_up = await governance.find_pending_downgrade(session, found.id, grant.id)
            request.status = "applied"
            await session.flush()
            after = await governance.has_own_pending_downgrade(session, found.id, "u.editor")
            return {
                "before": before, "during": during, "stranger": stranger,
                "found_id": looked_up.id if looked_up is not None else None,
                "request_id": request.id, "after": after,
            }

    got = asyncio.run(run())

    assert (got["before"], got["during"], got["stranger"], got["after"]) == (
        False, True, False, False
    )
    assert got["found_id"] == got["request_id"]


def test_build_removal_request_payload() -> None:
    async def run() -> tuple[ApprovalRequest, bool]:
        async with SessionLocal() as session:
            found = await _new_map(session)
            grant = MapPermission(
                map_id=found.id, principal_type="user", principal_id="u.editor",
                role="editor", granted_by="user.lee",
            )
            session.add(grant)
            await session.flush()
            request = await governance.build_removal_request(
                session, grant=grant, requested_by="user.req"
            )
            return request, request in session.new

    request, is_staged = asyncio.run(run())

    assert request.kind == "permission_downgrade"
    assert request.status == "pending"
    assert request.requested_by == "user.req"
    assert set(request.payload) == {
        "permission_id", "principal_type", "principal_id", "from_role", "to_role"
    }
    assert request.payload["to_role"] is None
    assert request.payload["from_role"] == "editor"
    assert request.payload["principal_id"] == "u.editor"
    assert is_staged
