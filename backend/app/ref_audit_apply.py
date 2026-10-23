"""고아 참조 미리보기·적용 — 적용 시점에 줄마다 다시 판정하고 결과별 경로로 쓴다(설계 2026-10-23 §5~§8).

판정은 `ref_audit_policy.decide` 한 곳이고, 여기는 결과별 쓰기만 한다: 설정류 바로 쓰기, 노드 작업본(내 점유·점유
가져오기·새 Draft), grant 제거 승인 요청, 수신자별 알림. 검증 실패는 쓰기 전에 `RemapError`(라우터 422)로 요청 전체를 거부한다.
"""

from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app import workflow
from app.clock import now as now_kst
from app.models import (
    CategoryPermission,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroupMember,
)
from app.permissions import governance
from app.permissions.logic import role_rank
from app.ref_audit import (
    DEPT_SOURCES,
    REMOVE_BLOCKED,
    USER_SOURCES,
    RefLine,
    load_valid_sets,
    scan_refs,
    split_names,
)
from app.ref_audit_policy import (
    GRANT_SOURCES,
    GROUP_SOURCES,
    NODE_SOURCES,
    ActorScope,
    Decision,
    DecisionContext,
    NotifyTo,
    decide,
    is_line_visible,
    is_new_grant_refused,
    load_actor_scope,
    load_decision_context,
)
from app.schemas import RefApplyIn, RefApplyOut, RefDraftOut, RefSkippedOut
from app.version_events import record_version_event

CLEANUP_DRAFT_LABEL = "Reference cleanup"
# target_id pk 상한 — PK 컬럼이 32비트 정수라 넘는 값은 조회 전에 거부한다(postgres는 범위 밖 정수 바인딩이 500)
MAX_PK = 2**31 - 1
# target_id의 pk가 맵 id인 소스 — 나머지(grant·그룹 멤버·카테고리 권한)는 그 행의 id
MAP_PK_SOURCES: frozenset[str] = frozenset({
    "owning_dept", "sp_dept", "node_dept", "map_owner", "map_approver", "sp_assignee", "node_assignee",
})
# 알림 payload의 맵별 곳 수 키 — notify가 나올 수 있는 맵 소스 전부(grant 줄은 재직 승인자가 없을 때 오너에게 간다)
NOTIFY_COUNT_SOURCES: tuple[str, ...] = (
    "node_dept", "node_assignee", "sp_dept", "sp_assignee", "owning_dept", "map_approver", "map_grant", "map_collab",
)


class RemapError(ValueError):
    """요청 전체를 거부하는 검증 실패 — 라우터가 422로 변환."""


@dataclass
class _Target:
    target_id: str
    from_value: str
    source: str
    pk: int


@dataclass
class _Plan:
    """적용 시점 판정 — 판정된 줄(요청 순서)과 건너뛴 대상 (target_id, 이유)."""

    decided: list[tuple[RefLine, Decision]]
    skipped: list[tuple[str, str]]
    ctx: DecisionContext | None


@dataclass
class _Notice:
    """수신자 한 명에게 보낼 묶음 — 맵별 소스 곳 수. 오너로 받는 줄이 하나라도 있으면 as=owner(오너는 전부 고칠 수 있다)."""

    role: str
    maps: dict[int, dict[str, int | str]] = field(default_factory=dict)


def _parse_pk(target_id: str) -> int:
    return int(target_id.partition(":")[2])


def _parse_targets(body: RefApplyIn) -> list[_Target]:
    """형식·종류·제거 금지 검증 — 하나라도 어긋나면 요청 전체를 거부한다. 같은 (target_id, 값)은 하나로 친다."""
    expected = DEPT_SOURCES if body.kind == "dept" else USER_SOURCES
    targets: dict[tuple[str, str], _Target] = {}
    for target in body.targets:
        source, _, pk = target.target_id.partition(":")
        if (source not in DEPT_SOURCES + USER_SOURCES or not (pk.isascii() and pk.isdigit())
                or int(pk) > MAX_PK):
            raise RemapError(f"invalid target_id {target.target_id!r}")
        if source not in expected:
            raise RemapError(f"{target.target_id} does not belong to kind {body.kind}")
        if body.mode == "remove" and source in REMOVE_BLOCKED:
            raise RemapError(f"{source} cannot be removed")
        targets.setdefault(
            (target.target_id, target.from_value),
            _Target(target.target_id, target.from_value, source, int(pk)),
        )
    return list(targets.values())


def _leaf(path: str) -> str:
    return path.rsplit("/", 1)[-1]


async def _resolve_to_value(session: AsyncSession, kind: str, mode: str, to_value: str) -> tuple[str, str]:
    """(to_id, to_name) — dept는 (경로, 리프), user는 (login, 직원 name). remove면 ("", "")."""
    if mode == "remove":
        return "", ""
    valid = await load_valid_sets(session)
    if kind == "dept":
        if to_value not in valid.dept_paths:
            raise RemapError("to_value is not a current department path")
        return to_value, _leaf(to_value)
    if to_value not in valid.user_ids:
        raise RemapError("to_value is not an active employee")
    emp = await session.get(Employee, to_value)
    return to_value, (emp.name if emp and emp.name else to_value)


async def _lock_target_maps(session: AsyncSession, targets: list[_Target]) -> None:
    """대상 맵 행을 id 순으로 먼저 잠근다 — create_version과 같은 잠금이라 동시 적용이 Draft를 둘 만들지 않는다.

    잠근 뒤에 스캔·판정하므로 판정이 곧 적용 시점 상태다(그 사이 점유·최신 버전이 바뀌었으면 바뀐 상태로 판정한다).
    """
    map_ids = {t.pk for t in targets if t.source in MAP_PK_SOURCES}
    grant_ids = [t.pk for t in targets if t.source in GRANT_SOURCES]
    if grant_ids:
        map_ids.update((await session.scalars(
            select(MapPermission.map_id).where(MapPermission.id.in_(grant_ids))
        )).all())
    for map_id in sorted(map_ids):
        await session.get(ProcessMap, map_id, with_for_update=True, populate_existing=True)


async def _classify_missing(session: AsyncSession, target: _Target, scope: ActorScope) -> str:
    """스캔에 없는 대상 — 그 자리(맵·그룹·카테고리)가 내 범위면 이미 바뀐 것, 아니면 범위 밖. 행이 사라졌으면 이미 바뀐 것."""
    stub = RefLine(source=target.source, count=0, target_id=target.target_id)
    if target.source in MAP_PK_SOURCES:
        stub.map_id = target.pk
    elif target.source in GRANT_SOURCES:
        stub.map_id = await session.scalar(select(MapPermission.map_id).where(MapPermission.id == target.pk))
    elif target.source in GROUP_SOURCES:
        stub.group_id = await session.scalar(
            select(UserGroupMember.group_id).where(UserGroupMember.id == target.pk)
        )
    else:
        stub.category_id = await session.scalar(
            select(CategoryPermission.category_id).where(CategoryPermission.id == target.pk)
        )
    if stub.map_id is None and stub.group_id is None and stub.category_id is None:
        return "already_changed"
    return "already_changed" if is_line_visible(stub, scope) else "out_of_scope"


async def _plan_targets(
    session: AsyncSession, *, actor: str, body: RefApplyIn, targets: list[_Target], to_value: str | None
) -> _Plan:
    """다시 스캔해 요청한 줄만 판정한다 — 스캔에 없거나 범위 밖인 대상은 쓰지 않고 건너뛴다."""
    scope = await load_actor_scope(session, actor)
    dept_groups, user_groups = await scan_refs(session)
    scanned = {
        (line.target_id, line.from_value): line
        for group in (dept_groups if body.kind == "dept" else user_groups)
        for line in group.lines
    }
    found: list[RefLine] = []
    skipped: list[tuple[str, str]] = []
    for target in targets:
        line = scanned.get((target.target_id, target.from_value))
        if line is None:
            skipped.append((target.target_id, await _classify_missing(session, target, scope)))
        elif is_line_visible(line, scope):
            found.append(line)
        else:
            skipped.append((target.target_id, "out_of_scope"))
    if not found:
        return _Plan(decided=[], skipped=skipped, ctx=None)
    ctx = await load_decision_context(session, found, scope, to_value=to_value)
    decided: list[tuple[RefLine, Decision]] = []
    for line in found:
        if is_line_visible(line, scope, ctx):
            decided.append((line, decide(line, scope, ctx, mode=body.mode, to_value=to_value)))
        else:
            skipped.append((line.target_id, "out_of_scope"))
    return _Plan(decided=decided, skipped=skipped, ctx=ctx)


async def preview_targets(session: AsyncSession, *, actor: str, body: RefApplyIn) -> list[tuple[RefLine, Decision]]:
    """apply와 같은 검증·판정, 쓰기 없음. 대체 값을 아직 고르지 않았으면(replace인데 빈 값) 값 없이 판정한다.

    줄을 그대로 돌려준다 — 합친 카드는 같은 target_id를 값마다 따로 보내므로 응답도 (target_id, from_value)로 짝짓는다.
    """
    targets = _parse_targets(body)
    to_value = None
    if body.mode == "replace" and body.to_value:
        to_value, _ = await _resolve_to_value(session, body.kind, body.mode, body.to_value)
    plan = await _plan_targets(session, actor=actor, body=body, targets=targets, to_value=to_value)
    return plan.decided


async def apply_targets(session: AsyncSession, *, actor: str, body: RefApplyIn) -> RefApplyOut:
    """검증(422) → 대상 맵 잠금 → 다시 판정 → 결과별 쓰기 → 수신자별 알림. 한 트랜잭션이고 commit은 라우터."""
    targets = _parse_targets(body)
    to_id, to_name = await _resolve_to_value(session, body.kind, body.mode, body.to_value)
    await _lock_target_maps(session, targets)
    plan = await _plan_targets(session, actor=actor, body=body, targets=targets, to_value=to_id or None)
    run = _ApplyRun(session, actor=actor, mode=body.mode, to_id=to_id, to_name=to_name, ctx=plan.ctx,
                    skipped=list(plan.skipped))
    for line, decision in plan.decided:
        await run.apply(line, decision)
    await run.release_checkouts()
    await run.send_notices()
    return run.build_result()


class _ApplyRun:
    """적용 한 번의 쓰기와 집계 — 같은 맵의 다음 노드 줄은 먼저 만든 Draft를 다시 쓴다."""

    def __init__(self, session: AsyncSession, *, actor: str, mode: str, to_id: str, to_name: str,
                 ctx: DecisionContext | None, skipped: list[tuple[str, str]]) -> None:
        self.session = session
        self.actor = actor
        self.mode = mode
        self.to_id = to_id
        self.to_name = to_name
        self.ctx = ctx
        self.skipped = skipped
        self.places: dict[str, int] = {}
        self.drafts: dict[int, int] = {}  # map_id → 이번 적용이 만든 Draft id
        self.approval_requests = 0
        self.notices: dict[str, _Notice] = {}
        self.grant_map_ids: set[int] = set()  # grant를 지우거나 오너를 바꾼 맵 — 끝에 점유를 재평가한다

    async def apply(self, line: RefLine, decision: Decision) -> None:
        outcome = decision.outcome
        if outcome in ("locked", "pending"):
            self.skipped.append((line.target_id, decision.reason or "pending"))
            return
        if outcome == "notify":
            self._queue_notice(line, decision.notify_to)
            return
        if line.source in NODE_SOURCES:
            count = await self._write_node_line(line, outcome)
        elif outcome == "approval":
            await self._request_grant_removal(line)
            count = line.count
        elif await _apply_line(self.session, line, mode=self.mode, to_id=self.to_id, to_name=self.to_name,
                               actor=self.actor):
            count = line.count
            if line.source in GRANT_SOURCES or line.source == "map_owner":
                self.grant_map_ids.add(line.map_id)
        else:
            self.skipped.append((line.target_id, "already_changed"))
            return
        self.places[outcome] = self.places.get(outcome, 0) + count

    async def _write_node_line(self, line: RefLine, outcome: str) -> int:
        """§6 — 내 점유 작업본(direct)·점유 가져오기(checkout)·게시본을 복제한 새 Draft(new_draft). 게시본엔 쓰지 않는다."""
        target = self.ctx.node_targets[line.map_id]
        if outcome == "new_draft":
            if line.map_id not in self.drafts:
                self.drafts[line.map_id] = await self._create_cleanup_draft(line.map_id, target.published_id)
            version_id = self.drafts[line.map_id]
        else:
            version_id = target.working_id
            if outcome == "checkout":
                # 판정이 점유 없는 작업본에만 checkout을 낸다(남의 점유는 notify) — 평소 acquire_checkout과 같은 상태
                version = await self.session.get(MapVersion, version_id)
                version.checked_out_by, version.checked_out_at = self.actor, now_kst()
        return await write_node_values(self.session, version_id, line.source, line.from_value, self.to_name,
                                       self.mode)

    async def _create_cleanup_draft(self, map_id: int, published_id: int) -> int:
        """create_version과 같은 생성 — 게시본 복제, created 이벤트, 점유=actor. 맵 행은 이미 잠겨 있다."""
        from app.routers.versions import clone_graph  # 라우터 모듈과의 순환 import 방지

        # 같은 세션에 게시본이 먼저 올라와 있어도 노드·엣지·그룹을 다시 싣는다(지연 로드는 async에서 실패)
        source = await self.session.get(
            MapVersion, published_id, populate_existing=True,
            options=[selectinload(MapVersion.nodes), selectinload(MapVersion.edges), selectinload(MapVersion.groups)],
        )
        draft = MapVersion(map_id=map_id, label=CLEANUP_DRAFT_LABEL)
        self.session.add(draft)
        await self.session.flush()
        await clone_graph(self.session, source, draft.id)
        record_version_event(self.session, draft.id, "created", self.actor)
        draft.checked_out_by, draft.checked_out_at = self.actor, now_kst()
        return draft.id

    async def _request_grant_removal(self, line: RefLine) -> None:
        """평소 delete_permission의 승인 경로 — 옛 grant 제거는 permission_downgrade 요청, 대체면 새 grant는 바로 준다."""
        grant = self.ctx.grants[_parse_pk(line.target_id)]
        m = self.ctx.maps[line.map_id]
        if self.mode == "replace":
            await _add_replacement_grant(self.session, m, grant, self.to_id, self.actor)
        await governance.build_removal_request(self.session, grant=grant, requested_by=self.actor)
        await governance.notify_permission_request(
            self.session, map_id=m.id, map_name=m.name, requested_by=self.actor, kind="permission_downgrade",
        )
        self.approval_requests += 1

    def _queue_notice(self, line: RefLine, to: NotifyTo) -> None:
        if to.id == self.actor:
            return  # 오너 폴백(created_by)이 actor 자신인 맵 — 자기에게는 알리지 않는다
        notice = self.notices.setdefault(to.id, _Notice(role=to.role))
        if to.role == "owner":
            notice.role = "owner"
        entry = notice.maps.setdefault(line.map_id, {
            "id": line.map_id, "name": line.map_name or "", **dict.fromkeys(NOTIFY_COUNT_SOURCES, 0),
        })
        entry[line.source] += line.count
        self.places["notify"] = self.places.get("notify", 0) + line.count

    async def release_checkouts(self) -> None:
        """평소 권한 라우터처럼 grant 변경 뒤 편집권을 잃은 점유자의 체크아웃을 푼다(퇴직 오너가 쥔 Draft 등)."""
        for map_id in sorted(self.grant_map_ids):
            await governance.release_checkouts_without_edit_role(self.session, map_id)

    async def send_notices(self) -> None:
        """수신자별 1건 — 맵 목록·소스별 곳 수·받는 자격(as: owner|holder)."""
        if not self.notices:
            return
        actor_name = await workflow.get_display_name(self.session, self.actor)
        for recipient, notice in self.notices.items():
            maps = list(notice.maps.values())
            await workflow.create_notifications(
                self.session, [recipient], type="ref_fix_requested", map_id=None,
                message=f"{actor_name} asked you to fix stale department or user references in {len(maps)} map(s)",
                payload={"actor": self.actor, "actor_name": actor_name, "count": len(maps), "as": notice.role,
                         "maps": maps},
            )

    def build_result(self) -> RefApplyOut:
        return RefApplyOut(
            places=self.places,
            drafts=[RefDraftOut(map_id=map_id, version_id=version_id) for map_id, version_id in self.drafts.items()],
            approval_requests=self.approval_requests,
            notified=len(self.notices),
            skipped=[RefSkippedOut(target_id=target_id, reason=reason) for target_id, reason in self.skipped],
        )


async def write_node_values(
    session: AsyncSession, version_id: int, source: str, from_value: str, to_name: str, mode: str
) -> int:
    """버전 노드의 낡은 값 하나를 바꾸거나 지운다 → 바뀐 노드 수. 쓴 버전은 updated_at을 올린다.

    부서는 값이 같으면 교체·비움. 담당자는 목록에서 그 이름만 교체·제거하고 순서를 지켜 중복을 합친다
    (그 이름이 없는 노드는 원문 그대로).
    """
    replacing = mode == "replace"
    changed = 0
    for node in (await session.scalars(select(Node).where(Node.version_id == version_id))).all():
        if source == "node_dept":
            if node.department != from_value:
                continue
            node.department = to_name if replacing else ""
        else:
            names = split_names(node.assignee)
            if from_value not in names:
                continue
            if replacing:
                names = [to_name if name == from_value else name for name in names]
            else:
                names = [name for name in names if name != from_value]
            node.assignee = ", ".join(dict.fromkeys(names))
        changed += 1
    if changed:
        version = await session.get(MapVersion, version_id)
        version.updated_at = now_kst()  # 그래프 PUT과 같은 관례 — 노드만 바뀌어도 버전 시각을 올린다
    return changed


async def _add_replacement_grant(
    session: AsyncSession, m: ProcessMap, old: MapPermission, to_id: str, actor: str
) -> None:
    """옛 grant의 역할을 새 대상에게 — 이미 grant가 있으면 높은 역할만 남긴다.

    평소 add_permission이 거부하는 grant는 만들지 않는다: 공개 맵의 viewer(전원 열람), 오우닝 부서(이미 파생 editor).
    """
    dup = await session.scalar(select(MapPermission).where(
        MapPermission.map_id == old.map_id, MapPermission.principal_type == old.principal_type,
        MapPermission.principal_id == to_id))
    if dup is not None:
        if role_rank(old.role) > role_rank(dup.role):
            dup.role = old.role
        return
    if is_new_grant_refused(old, m, to_id):
        return  # 미리보기 판정이 같은 술어로 no_new_grant 경고를 낸다
    session.add(MapPermission(map_id=old.map_id, principal_type=old.principal_type, principal_id=to_id,
                              role=old.role, granted_by=actor))


async def _replace_owner(session: AsyncSession, m: ProcessMap, to_login: str, actor: str) -> None:
    """퇴직 오너 → 새 오너. transfer_owner와 결과 상태 동일(owner grant 정확히 1개) + owner_assigned 알림.

    퇴직한 옛 오너의 grant는 지운다(평소 이전은 editor로 남기지만 퇴직자라 새 고아만 생긴다).
    """
    old_owner = m.owner_id
    grants = (await session.scalars(select(MapPermission).where(
        MapPermission.map_id == m.id, MapPermission.principal_type == "user"))).all()
    new_grant = None
    for grant in grants:
        if grant.principal_id == old_owner:
            await session.delete(grant)
        elif grant.principal_id == to_login:
            new_grant = grant
        elif grant.role == "owner":
            grant.role = "editor"
    if new_grant is None:
        session.add(MapPermission(map_id=m.id, principal_type="user", principal_id=to_login,
                                  role="owner", granted_by=actor))
    else:
        # transfer_owner와 같이 — 새 오너 grant에 걸린 대기 다운그레이드가 나중에 승인되면 오너 grant가 지워진다
        await governance.supersede_pending_downgrades(session, m.id, new_grant.id, actor=actor)
        new_grant.role = "owner"
    m.owner_id = to_login
    m.consultant_owner_pending = False
    actor_emp = await session.get(Employee, actor)
    old_emp = await session.get(Employee, old_owner) if old_owner else None
    actor_name = actor_emp.name if actor_emp and actor_emp.name else actor
    from_name = old_emp.name if old_emp and old_emp.name else (old_owner or "")
    await workflow.create_notifications(
        session, [to_login], type="owner_assigned", map_id=m.id,
        message=f"{actor_name} made you the owner of '{m.name}' (previous owner {from_name} has left)",
        payload={"map_name": m.name, "actor": actor, "actor_name": actor_name, "from_name": from_name},
    )


async def _apply_line(session: AsyncSession, line: RefLine, *, mode: str, to_id: str, to_name: str,
                      actor: str) -> bool:
    """설정류 줄 바로 쓰기(판정 direct) — 값이 이미 바뀌었으면 False."""
    source, pk, from_value = line.source, _parse_pk(line.target_id), line.from_value

    if source in GRANT_SOURCES:
        grant = await session.get(MapPermission, pk)
        if grant is None or grant.principal_id != from_value:
            return False
        # 오너(sysadmin 포함)의 직접 적용은 같은 grant의 대기 다운그레이드를 대체한다 — 평소 라우터와 같은 결과
        await governance.supersede_pending_downgrades(session, grant.map_id, grant.id, actor=actor)
        if mode == "replace":
            await _add_replacement_grant(session, await session.get(ProcessMap, grant.map_id), grant, to_id, actor)
        await session.delete(grant)
        return True

    if source in GROUP_SOURCES:
        member = await session.get(UserGroupMember, pk)
        if member is None or member.member_id != from_value:
            return False
        if mode == "remove":
            await session.delete(member)
        else:
            dup = await session.scalar(select(UserGroupMember).where(
                UserGroupMember.group_id == member.group_id, UserGroupMember.member_type == member.member_type,
                UserGroupMember.member_id == to_id))
            if dup is not None:
                await session.delete(member)
            else:
                member.member_id = to_id
        return True

    if source == "category_perm":
        perm = await session.get(CategoryPermission, pk)
        if perm is None or perm.principal_id != from_value:
            return False
        if mode == "remove":
            await session.delete(perm)
        else:
            dup = await session.scalar(select(CategoryPermission).where(
                CategoryPermission.category_id == perm.category_id, CategoryPermission.principal_type == "user",
                CategoryPermission.principal_id == to_id))
            if dup is not None:
                await session.delete(perm)
            else:
                perm.principal_id = to_id
        return True

    if source == "map_approver":
        approver = await session.get(MapApprover, (pk, from_value))
        if approver is None:
            return False
        if mode == "remove":
            await session.delete(approver)
        else:
            dup = await session.get(MapApprover, (pk, to_id))
            if dup is not None:
                await session.delete(approver)
            else:
                await session.delete(approver)
                await session.flush()
                session.add(MapApprover(map_id=pk, user_id=to_id, assigned_by=actor))
        return True

    # 이하 맵 컬럼 계열 — pk = map_id
    m = await session.get(ProcessMap, pk)
    if m is None:
        return False
    if source == "owning_dept":
        if m.owning_department != from_value:
            return False
        m.owning_department = to_id
    elif source == "sp_dept":
        if m.sp_department != from_value:
            return False
        m.sp_department = to_name
        m.sp_changed_by, m.sp_changed_at = actor, now_kst()
    elif source == "sp_assignee":
        names = split_names(m.sp_assignee)
        if from_value not in names:
            return False
        kept = [n for n in names if n != from_value]
        if mode == "replace" and to_name not in kept:
            kept.append(to_name)
        m.sp_assignee = ", ".join(kept)
        m.sp_changed_by, m.sp_changed_at = actor, now_kst()
    elif source == "map_owner":
        if m.owner_id != from_value:
            return False
        await _replace_owner(session, m, to_id, actor)
    return True
