"""시드 후 워크플로 불변식 보정 — 정상 워크플로에서 불가능한 상태 제거 (멱등). 개발 시드 전용."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad.service import LOCAL_USERS
from app.models import MapApprover, MapVersion, ProcessMap, VersionApproval

_NON_DRAFT = ("pending", "approved", "published")
_FULLY_APPROVED = ("approved", "published")


def _demo_user_ids() -> list[str]:
    """LOCAL_USERS의 login_id 결정적 순서."""
    return [u["login_id"] for u in LOCAL_USERS]


async def normalize_workflow_invariants(session: AsyncSession) -> dict[str, int]:
    """모든 맵/버전을 훑어 워크플로 불변식을 보정한다. 반환: 보정 건수."""
    counts = {"owners_set": 0, "approvers_added": 0, "submitters_set": 0, "approvals_added": 0}
    user_ids = _demo_user_ids()
    fallback = user_ids[0] if user_ids else "unknown"

    maps = (await session.scalars(select(ProcessMap))).all()
    for m in maps:
        # 1) owner / created_by
        if m.owner_id is None:
            m.owner_id = m.created_by or fallback
            counts["owners_set"] += 1
        if m.created_by is None:
            m.created_by = m.owner_id

        # 2) 승인자 ≥ 1 (owner와 다른 사람 우선)
        approvers = list(
            (await session.scalars(
                select(MapApprover.user_id).where(MapApprover.map_id == m.id)
            )).all()
        )
        if not approvers:
            pick = next((u for u in user_ids if u != m.owner_id), fallback)
            session.add(MapApprover(map_id=m.id, user_id=pick, assigned_by=m.owner_id))
            approvers = [pick]
            counts["approvers_added"] += 1

        # 3) 비-draft 버전: submitted_by + (approved/published) 승인이력
        versions = (
            await session.scalars(select(MapVersion).where(MapVersion.map_id == m.id))
        ).all()
        for v in versions:
            if v.status in _NON_DRAFT and v.submitted_by is None:
                v.submitted_by = m.owner_id
                counts["submitters_set"] += 1
            if v.status in _FULLY_APPROVED:
                approved = set(
                    (await session.scalars(
                        select(VersionApproval.approver).where(
                            VersionApproval.version_id == v.id
                        )
                    )).all()
                )
                for ap in approvers:
                    if ap not in approved:
                        session.add(VersionApproval(version_id=v.id, approver=ap))
                        counts["approvals_added"] += 1

    await session.commit()
    return counts
