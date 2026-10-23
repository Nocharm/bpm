"""거버넌스 판정 공용 헬퍼 — 권한·승인자 라우터와 고아 참조 감사 경로가 같은 규칙을 쓰는 단일 소스."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.models import ApprovalRequest, Employee, MapPermission, MapVersion, ProcessMap, _now
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic
from app.permissions.access import get_effective_role


async def is_in_active_workflow(session: AsyncSession, map_id: int, login_id: str) -> bool:
    """진행 중 버전 워크플로 참여자인지 (R2 상호 배제).

    (a) 편집 가능 상태 버전의 체크아웃 보유자 (b) pending/approved 버전의 제출자.
    """
    versions = await session.scalars(
        select(MapVersion).where(MapVersion.map_id == map_id)
    )
    return any(
        (v.checked_out_by == login_id and workflow.is_editable_status(v.status))
        or (
            v.submitted_by == login_id
            and v.status in (workflow.PENDING, workflow.APPROVED)
        )
        for v in versions.all()
    )


async def find_pending_downgrade(
    session: AsyncSession, map_id: int, permission_id: int
) -> ApprovalRequest | None:
    """같은 grant 대상 pending 다운그레이드 요청 — payload 가 JSON 이라 파이썬에서 필터(맵당 소량)."""
    rows = await session.scalars(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == map_id,
            ApprovalRequest.kind == "permission_downgrade",
            ApprovalRequest.status == "pending",
        )
    )
    return next(
        (r for r in rows.all() if r.payload.get("permission_id") == permission_id), None
    )


async def supersede_pending_downgrades(
    session: AsyncSession, map_id: int, permission_id: int, *, actor: str
) -> None:
    """직접 적용이 pending 다운그레이드를 무효화 — rename supersede 선례(maps._supersede_pending_rename)."""
    req = await find_pending_downgrade(session, map_id, permission_id)
    if req is None:
        return
    req.status = "superseded"
    req.decided_by = actor
    req.decided_at = _now()
    found_map = await session.get(ProcessMap, map_id)
    map_name = found_map.name if found_map is not None else f"map {map_id}"
    await workflow.create_notifications(
        session,
        [req.requested_by],
        type="permission_superseded",
        map_id=map_id,
        message=f"Your permission change request on '{map_name}' was superseded - the owner applied a change directly",
        payload={"map_name": map_name, "reason": "direct"},
    )


async def release_checkouts_without_edit_role(session: AsyncSession, map_id: int) -> None:
    """편집권을 잃은 점유자의 체크아웃 해제 — 권한 변경 적용 직후 호출 (리뷰 2026-10-19 B-6).

    점유는 시간으로 풀리지 않아(app/checkout.py) 제거된 협업자가 쥔 Draft는 sysadmin 강제 인수 말고는
    풀 길이 없었다. 그룹 grant 변경도 같은 판정으로 덮는다(대상 유저를 따로 풀지 않고 보유자를 재평가).
    """
    held = await session.scalars(
        select(MapVersion).where(
            MapVersion.map_id == map_id, MapVersion.checked_out_by.is_not(None)
        )
    )
    for version in held.all():
        role = await get_effective_role(session, version.checked_out_by, map_id)
        if role not in ("owner", "editor"):
            version.checked_out_by = None
            version.checked_out_at = None


async def has_own_pending_downgrade(session: AsyncSession, map_id: int, login_id: str) -> bool:
    """본인 user grant 에 걸린 pending 다운그레이드가 있는지 — 워크플로 상호 배제 역방향 (R2)."""
    grant = await session.scalar(
        select(MapPermission).where(
            MapPermission.map_id == map_id,
            MapPermission.principal_type == "user",
            MapPermission.principal_id == login_id,
        )
    )
    if grant is None:
        return False
    return await find_pending_downgrade(session, map_id, grant.id) is not None


async def has_version_in_approval(session: AsyncSession, map_id: int) -> bool:
    """승인 진행 중(pending/approved) 버전이 있는지 — 있으면 승인자 변경 금지(승인 tally 보호)."""
    in_flight = await session.scalar(
        select(MapVersion.id)
        .where(
            MapVersion.map_id == map_id,
            MapVersion.status.in_([workflow.PENDING, workflow.APPROVED]),
        )
        .limit(1)
    )
    return in_flight is not None


async def is_owning_department_member(
    session: AsyncSession, login_id: str, owning_department: str | None
) -> bool:
    """오우닝 부서(하위 포함) 소속 여부 — effective_role 의 파생 editor 판정과 같은 접두 규칙."""
    if not owning_department:
        return False
    emp = await session.get(Employee, login_id)
    if emp is None:
        return False
    emp_org_path = resolve_org_path(emp, await load_dept_index(session))
    return logic.belongs_to_department(emp_org_path, owning_department)


async def notify_permission_request(
    session: AsyncSession, *, map_id: int, map_name: str, requested_by: str, kind: str
) -> None:
    """승인 지연 요청 발생 → 활성 승인자에게 벨 알림 (요청자 제외, design 2026-07-16)."""
    requester_name = await workflow.get_display_name(session, requested_by)
    what = "a visibility change" if kind == "visibility_change" else "a permission change"
    recipients = [
        a for a in await workflow.load_active_approvers(session, map_id) if a != requested_by
    ]
    await workflow.create_notifications(
        session,
        recipients,
        type="permission_requested",
        map_id=map_id,
        message=f"{requester_name} requested {what} on '{map_name}'",
        payload={"map_name": map_name, "actor": requested_by,
                 "actor_name": requester_name, "kind": kind},
    )


async def build_removal_request(
    session: AsyncSession, *, grant: MapPermission, requested_by: str
) -> ApprovalRequest:
    """grant 제거용 pending 다운그레이드 요청을 세션에 추가(커밋은 호출부) — to_role=None 이 '제거'."""
    req = ApprovalRequest(
        map_id=grant.map_id,
        kind="permission_downgrade",
        payload={
            "permission_id": grant.id,
            "principal_type": grant.principal_type,
            "principal_id": grant.principal_id,
            "from_role": grant.role,
            "to_role": None,
        },
        requested_by=requested_by,
        status="pending",
    )
    session.add(req)
    return req
