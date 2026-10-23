"""고아 참조 감사 조회 API — 로그인한 누구나 자기 범위의 카드·요약을 본다(설계 2026-10-23 §8).

범위·결과 판정은 서버가 줄마다 정한다. 권한이 없는 사용자는 403이 아니라 빈 목록을 받는다.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.ref_audit_cards import (
    CardLine,
    RefCard,
    count_actionable,
    count_scope,
    load_audit_cards,
)
from app.schemas import (
    RefAuditOut,
    RefAuditScopeOut,
    RefAuditSummaryOut,
    RefCardLineOut,
    RefCardOut,
    RefNotifyToOut,
)

router = APIRouter(prefix="/api/ref-audit", tags=["ref-audit"])


def _to_line_out(card_line: CardLine) -> RefCardLineOut:
    line, decision = card_line.line, card_line.decision
    notify_to = decision.notify_to
    return RefCardLineOut(
        source=line.source, target_id=line.target_id, from_value=line.from_value, count=line.count,
        outcome=decision.outcome, reason=decision.reason, warning=decision.warning,
        notify_to=RefNotifyToOut(id=notify_to.id, name=notify_to.name, role=notify_to.role) if notify_to else None,
        map_id=line.map_id, map_name=line.map_name, map_role=card_line.map_role,
        version_id=line.version_id, version_label=card_line.version_label,
        version_status=card_line.version_status,
        group_id=line.group_id, group_name=line.group_name,
        category_id=line.category_id, category_name=line.category_name,
    )


def _to_card_out(card: RefCard) -> RefCardOut:
    return RefCardOut(
        kind=card.kind, key=card.key, label=card.label, sub=card.sub,
        lines=[_to_line_out(cl) for cl in card.lines],
    )


@router.get("", response_model=RefAuditOut)
async def get_ref_audit(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefAuditOut:
    """내 범위의 고아 참조 카드 — 부서·사람 카드와 줄별 결과, 범위 칩 숫자."""
    audit = await load_audit_cards(session, login_id)
    scope = await count_scope(session, audit.scope)
    return RefAuditOut(
        departments=[_to_card_out(c) for c in audit.departments],
        users=[_to_card_out(c) for c in audit.users],
        scope=RefAuditScopeOut(maps=scope.maps, groups=scope.groups, categories=scope.categories),
        generated_at=now_kst(),
    )


@router.get("/summary", response_model=RefAuditSummaryOut)
async def get_ref_audit_summary(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefAuditSummaryOut:
    """빨간 점 소스 — 내가 직접 고칠 수 있는 줄(알림·잠김·게시 대기 제외)의 곳 수 합."""
    audit = await load_audit_cards(session, login_id)
    return RefAuditSummaryOut(actionable=count_actionable(audit.departments + audit.users))
