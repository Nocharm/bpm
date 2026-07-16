"""승인 워크플로우 — 상태 상수, 편집가능 판정, 승인자 로딩, 알림, 퇴사자 정리 (design 2026-06-14)."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import (
    Employee,
    MapApprover,
    MapVersion,
    Notification,
    ProcessMap,
    VersionApproval,
)
from app.version_events import record_version_event

DRAFT = "draft"
PENDING = "pending"
APPROVED = "approved"
PUBLISHED = "published"
REJECTED = "rejected"
EXPIRED = "expired"  # terminal — 후속 게시로 대체된 published 버전

# 편집·체크아웃 가능한 상태 — 검토중/확정 버전은 읽기 전용
EDITABLE_STATUSES = frozenset({DRAFT, REJECTED})


def is_editable_status(status: str) -> bool:
    """이 상태의 버전을 편집/체크아웃할 수 있는지."""
    return status in EDITABLE_STATUSES


async def get_display_name(session: AsyncSession, login_id: str) -> str:
    """login_id → 표시 이름(Employee.name). 미등록·빈 이름이면 login_id 그대로.

    알림 메시지 등에 아이디 대신 사람 이름을 노출하기 위한 조회.
    """
    emp = await session.get(Employee, login_id)
    return emp.name if emp is not None and emp.name else login_id


NOTIFICATION_CAP = 100  # 인당 알림 보존 상한 — 초과분은 읽음 여부 무관 오래된 순 삭제 (design 2026-07-16)


async def create_notifications(
    session: AsyncSession,
    recipients: list[str],
    *,
    type: str,
    map_id: int | None = None,
    version_id: int | None = None,
    message: str,
) -> None:
    """수신자별 알림 행 추가 + 인당 NOTIFICATION_CAP 초과분 트리밍 — commit은 호출자 책임.

    map_id/version_id는 선택 — 맵/버전과 무관한 알림(공지 등)은 생략.
    트리밍의 select가 autoflush로 pending add를 먼저 flush한다.
    """
    for recipient in recipients:
        session.add(
            Notification(
                recipient=recipient,
                type=type,
                map_id=map_id,
                version_id=version_id,
                message=message,
            )
        )
    for recipient in dict.fromkeys(recipients):  # 중복 수신자 1회만 트리밍
        stale_ids = (
            await session.scalars(
                select(Notification.id)
                .where(Notification.recipient == recipient)
                .order_by(Notification.created_at.desc(), Notification.id.desc())
                .offset(NOTIFICATION_CAP)
            )
        ).all()
        if stale_ids:
            await session.execute(
                delete(Notification).where(Notification.id.in_(stale_ids))
            )


async def load_active_approvers(session: AsyncSession, map_id: int) -> list[str]:
    """맵의 유효 승인자 — employees에 active=True 행이 있는 승인자만.

    행 없음 = AD 프룬된 퇴사자 → 제외 (2026-07-09). 종전 '행 없음=활성' 가정은
    프룬 도입으로 뒤집혔다 — 퇴사 승인자가 정족수를 영구 차단하는 데드락 방지.
    """
    rows = await session.scalars(
        select(MapApprover.user_id)
        .join(Employee, Employee.login_id == MapApprover.user_id)
        .where(MapApprover.map_id == map_id, Employee.active.is_(True))
        .order_by(MapApprover.user_id)
    )
    return list(rows.all())


async def reconcile_departures(session: AsyncSession, departed: set[str]) -> None:
    """AD 프룬 직후 정리 — 퇴사자 점유 해제 + 퇴사 승인자가 걸린 pending 재평가.

    - 점유: 퇴사자는 다시 저장할 수 없으므로 잠금만 해제.
    - pending 재평가: 유효 승인자 0명 → 승인 플로우 취소(draft 복귀, 생존 제출자에게
      점유 재부여, 오너·제출자 알림). 유효 승인자 전원 기승인 → approved 전이(+제출자 알림).
    commit은 호출자(sync) 책임.
    """
    if not departed:
        return

    # 1) 퇴사자 점유 해제
    held = (
        await session.scalars(select(MapVersion).where(MapVersion.checked_out_by.in_(departed)))
    ).all()
    for version in held:
        version.checked_out_by = None
        version.checked_out_at = None

    # 2) 퇴사 승인자가 지정된 맵의 pending 버전 재평가
    map_ids = set(
        (
            await session.scalars(
                select(MapApprover.map_id).where(MapApprover.user_id.in_(departed))
            )
        ).all()
    )
    if not map_ids:
        return
    pendings = (
        await session.scalars(
            select(MapVersion).where(
                MapVersion.map_id.in_(map_ids), MapVersion.status == PENDING
            )
        )
    ).all()
    for version in pendings:
        active = await load_active_approvers(session, version.map_id)
        approvals = set(
            (
                await session.scalars(
                    select(VersionApproval.approver).where(
                        VersionApproval.version_id == version.id
                    )
                )
            ).all()
        )
        found_map = await session.get(ProcessMap, version.map_id)
        submitter = version.submitted_by
        if not active:
            # 승인할 사람이 아무도 없음 — 플로우 취소, 제출자가 살아있으면 점유 재부여
            version.status = DRAFT
            submitter_alive = (
                submitter is not None and (await session.get(Employee, submitter)) is not None
            )
            version.checked_out_by = submitter if submitter_alive else None
            version.checked_out_at = now_kst() if submitter_alive else None
            record_version_event(
                session, version.id, "withdrawn", "system",
                note="approval cancelled — approver(s) departed",
            )
            recipients = [
                r
                for r in dict.fromkeys([found_map.owner_id if found_map else None, submitter])
                if r
            ]
            await create_notifications(
                session,
                recipients,
                type="approval_cancelled",
                map_id=version.map_id,
                version_id=version.id,
                message=f"approval for '{version.label}' was cancelled — its approver(s) left the company",
            )
        elif all(approver in approvals for approver in active):
            # 퇴사자가 마지막 미승인자였음 — 남은 전원 기승인이므로 즉시 전이
            version.status = APPROVED
            if submitter:
                await create_notifications(
                    session,
                    [submitter],
                    type="approved",
                    map_id=version.map_id,
                    version_id=version.id,
                    message=f"'{version.label}' is fully approved — ready to publish",
                )
