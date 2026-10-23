"""고아 참조 감사 카드 조립 — 스캔 그룹을 actor 범위로 거르고 줄마다 결과를 붙여 화면 카드로 합친다(설계 2026-10-23 §8).

부서는 경로 그룹과 리프 그룹을 리프명으로, 사람은 로그인 그룹과 이름 그룹을 같은 퇴직자로 합친다.
합쳐도 줄마다 원래 그룹의 값(`RefLine.from_value`)을 지니므로 적용은 줄별 값으로 한다.
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee, MapVersion, ProcessMap, UserGroup
from app.ref_audit import RefGroup, RefLine, scan_refs
from app.ref_audit_policy import (
    ACTIONABLE,
    ActorScope,
    Decision,
    DecisionContext,
    decide,
    is_line_visible,
    load_actor_scope,
    load_decision_context,
)

PATH_SEPARATOR = " › "


@dataclass
class CardLine:
    line: RefLine
    decision: Decision
    map_role: str | None
    version_label: str | None = None

    @property
    def version_status(self) -> str | None:
        """작업본을 겨냥한 줄은 작업본 상태, 게시본을 겨냥한 줄(새 Draft·게시 대기)은 published."""
        if self.line.version_id is None:
            return None
        return self.line.working_status if self.line.version_status == "draft" else "published"


@dataclass
class RefCard:
    kind: Literal["dept", "user"]
    key: str
    label: str
    sub: str
    lines: list[CardLine]


@dataclass
class ScopeCounts:
    maps: int
    groups: int
    categories: int


@dataclass
class AuditCards:
    scope: ActorScope
    departments: list[RefCard]
    users: list[RefCard]


@dataclass
class _Identity:
    """퇴직자 한 명의 카드 신원 — login이 카드 key, label은 표시명(없으면 한글명)."""

    key: str
    label: str


async def build_cards(
    session: AsyncSession, groups: list[RefGroup], scope: ActorScope, ctx: DecisionContext
) -> list[RefCard]:
    """범위 밖 줄을 빼고 줄마다 결과를 붙여 카드로 합친다 — 줄이 남지 않은 카드는 없다.

    ctx는 호출부가 범위 안 줄로 미리 로드한 것이다. 스캔 뒤 사라진 대상의 줄은 ctx로 걸러져 decide에 닿지 않는다.
    """
    kept: list[tuple[RefGroup, list[CardLine]]] = []
    for group in groups:
        card_lines = [
            CardLine(line, decide(line, scope, ctx), scope.roles.get(line.map_id) if line.map_id is not None else None)
            for line in group.lines
            if is_line_visible(line, scope, ctx)
        ]
        if card_lines:
            kept.append((group, card_lines))
    if not kept:
        return []

    await _attach_version_labels(session, [cl for _, card_lines in kept for cl in card_lines])
    identities = await _load_user_identities(session, [group for group, _ in kept if group.kind == "user"])
    cards: dict[tuple[str, str], RefCard] = {}
    for group, card_lines in kept:
        if group.kind == "dept":
            key, label, sub = _describe_dept_group(group)
        else:
            key, label, sub = _describe_user_group(group, identities)
        # 사람 key는 login 또는 못 찾은 이름 원문이라 우연히 겹치면 한 카드로 합쳐진다 — 줄이 값을 지니므로 무해
        card = cards.setdefault((group.kind, key), RefCard(group.kind, key, label, sub, []))
        if not card.sub and sub:  # 리프명이 같은 경로 그룹이 여럿이면 먼저 나온 상위 경로를 보인다
            card.sub = sub
        card.lines.extend(card_lines)
    for card in cards.values():
        card.lines.sort(key=_line_sort_key)
    return sorted(cards.values(), key=lambda c: (c.label.lower(), c.key))


def _line_sort_key(card_line: CardLine) -> tuple[str, str, str]:
    line = card_line.line
    return (line.map_name or line.group_name or line.category_name or "", line.source, line.target_id)


async def _attach_version_labels(session: AsyncSession, card_lines: list[CardLine]) -> None:
    """줄이 겨냥한 버전의 라벨 — 쿼리 하나."""
    version_ids = sorted({cl.line.version_id for cl in card_lines if cl.line.version_id is not None})
    if not version_ids:
        return
    labels = dict((await session.execute(
        select(MapVersion.id, MapVersion.label).where(MapVersion.id.in_(version_ids))
    )).all())
    for cl in card_lines:
        cl.version_label = labels.get(cl.line.version_id)


def _describe_dept_group(group: RefGroup) -> tuple[str, str, str]:
    """(key, label, sub) — key·label은 리프명, sub는 경로 그룹의 상위 경로("A/B/C" → "A › B")."""
    segments = [segment for segment in group.value.split("/") if segment]
    if group.value_kind != "path" or not segments:
        return group.value, group.value, ""
    return segments[-1], segments[-1], PATH_SEPARATOR.join(segments[:-1])


def _describe_user_group(group: RefGroup, identities: dict[tuple[str, str], _Identity]) -> tuple[str, str, str]:
    """(key, label, sub) — 신원을 찾으면 key=login·label=이름·sub=login, 못 찾으면 값 그대로(로그인 그룹은 sub도 로그인)."""
    identity = identities.get((group.value_kind, group.value))
    if identity is None:
        return group.value, group.value, group.value if group.value_kind == "login" else ""
    return identity.key, identity.label, identity.key


async def _load_user_identities(
    session: AsyncSession, groups: list[RefGroup]
) -> dict[tuple[str, str], _Identity]:
    """(value_kind, value) → 신원 — 로그인은 직원 기록의 이름, 이름은 name·korean_name이 가리키는 login.

    이름 그룹은 현직자와 겹치지 않아 맞는 직원은 퇴직자뿐이다. 같은 이름이 둘 이상의 login을 가리키면
    누구인지 알 수 없으므로 못 찾은 것으로 둔다. 쿼리는 최대 둘.
    """
    logins = sorted({g.value for g in groups if g.value_kind == "login"})
    names = sorted({g.value for g in groups if g.value_kind == "name"})
    identities: dict[tuple[str, str], _Identity] = {}
    if logins:
        for login, name, korean_name in (await session.execute(
            select(Employee.login_id, Employee.name, Employee.korean_name).where(Employee.login_id.in_(logins))
        )).all():
            if label := name or korean_name:
                identities[("login", login)] = _Identity(key=login, label=label)
    if names:
        owners: dict[str, dict[str, _Identity]] = {}
        for login, name, korean_name in (await session.execute(
            select(Employee.login_id, Employee.name, Employee.korean_name)
            .where(or_(Employee.name.in_(names), Employee.korean_name.in_(names)))
        )).all():
            for value in {name, korean_name}.intersection(names):
                owners.setdefault(value, {})[login] = _Identity(key=login, label=name or korean_name)
        for value, by_login in owners.items():
            if len(by_login) == 1:
                identities[("name", value)] = next(iter(by_login.values()))
    return identities


def count_actionable(cards: list[RefCard]) -> int:
    """빨간 점 소스 — 직접 고칠 수 있는 줄(direct·checkout·new_draft·approval)의 곳 수 합."""
    return sum(cl.line.count for card in cards for cl in card.lines if cl.decision.outcome in ACTIONABLE)


async def count_scope(session: AsyncSession, scope: ActorScope) -> ScopeCounts:
    """히어로 "범위" 칩 — scope가 덮는 살아 있는 맵·그룹과 임명 가능 카테고리 수.

    맵: roles는 editor·owner 맵이며 비sysadmin은 소프트삭제 맵이 이미 빠져 있다. sysadmin의 roles는 소프트삭제 맵까지
    전부 owner라 살아 있는 맵만 다시 센다. 그룹: sysadmin은 모든 살아 있는 그룹, 그 외는 관리하는 그룹 중 살아 있는 것
    (스캔이 소프트삭제 그룹을 건너뛴다). 카테고리: sysadmin의 manageable은 전체 카테고리다.
    """
    if scope.is_sysadmin:
        maps = await session.scalar(select(func.count()).select_from(ProcessMap).where(ProcessMap.deleted_at.is_(None)))
        groups = await session.scalar(select(func.count()).select_from(UserGroup).where(UserGroup.deleted_at.is_(None)))
    else:
        maps = len(scope.roles)
        groups = 0
        if scope.managed_group_ids:
            groups = await session.scalar(
                select(func.count()).select_from(UserGroup)
                .where(UserGroup.id.in_(scope.managed_group_ids), UserGroup.deleted_at.is_(None))
            )
    return ScopeCounts(maps=maps or 0, groups=groups or 0, categories=len(scope.manageable_category_ids))


async def load_audit_cards(session: AsyncSession, login_id: str) -> AuditCards:
    """actor 기준 전체 파이프라인 — 스캔 → 범위 안 줄만 판정 사실 로드 → 카드. GET·summary·(후속) preview가 공유한다."""
    scope = await load_actor_scope(session, login_id)
    dept_groups, user_groups = await scan_refs(session)
    visible = [ln for group in dept_groups + user_groups for ln in group.lines if is_line_visible(ln, scope)]
    if not visible:
        return AuditCards(scope=scope, departments=[], users=[])
    ctx = await load_decision_context(session, visible, scope)
    return AuditCards(
        scope=scope,
        departments=await build_cards(session, dept_groups, scope, ctx),
        users=await build_cards(session, user_groups, scope, ctx),
    )
