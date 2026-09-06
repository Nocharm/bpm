"""Framework 슬롯 변경 코어 — 전제 검증·적용(캔버스 재지정·계보·이벤트·알림)의 단일 진입점.

라우터(slot_changes.py)·레거시 어댑터(maps.py)·요청 승인(permissions._apply_request)이 공용으로
부른다. 요청 생성(dry_run)과 승인 적용이 같은 validate를 거쳐 전제가 한 곳에만 산다 (spec 2026-09-06 §5).
"""

from dataclasses import dataclass, field
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.clock import now as now_kst
from app.lineage import external_lineage_key
from app.models import (
    ApprovalRequest,
    Edge,
    FrameworkSlotEvent,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.permissions import logic
from app.permissions.access import get_category_admin_logins, is_direct_l5_admin
from app.subprocess import LINKAGE_Y0, LINKAGE_Y_STEP, grid_positions
from app.version_events import record_version_event

SLOT_ACTIONS: tuple[str, ...] = ("assign", "unassign", "move", "replace", "delete")


@dataclass
class SlotChange:
    action: str
    map_id: int
    to_category_id: int | None = None
    to_map_id: int | None = None
    note: str = ""


@dataclass
class SlotPlan:
    change: SlotChange
    source: ProcessMap
    target: ProcessMap | None
    from_category_id: int | None
    # 승인이 필요한 L5 카테고리 id — move는 [from, to], 나머지는 1개 (spec §4.1)
    sides: list[int] = field(default_factory=list)
    self_apply: bool = False


async def _load_live_map(session: AsyncSession, map_id: int) -> ProcessMap:
    found = await session.get(ProcessMap, map_id)
    if found is None or found.deleted_at is not None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found


def _assert_normal(found: ProcessMap) -> None:
    if found.mode != "normal":
        raise HTTPException(status_code=422, detail="only normal maps can hold a framework slot")


async def _load_l5(session: AsyncSession, category_id: int | None) -> ProcessCategory:
    if category_id is None:
        raise HTTPException(status_code=422, detail="to_category_id is required")
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    if category.level != 5:
        raise HTTPException(status_code=422, detail="maps can only be attached to a level-5 category")
    return category


async def can_self_apply(session: AsyncSession, actor: str, sides: list[int]) -> bool:
    """sysadmin이거나 모든 side의 직속 L5 관리자면 요청 없이 즉시 적용 (spec §2 자기결재)."""
    if logic.is_sysadmin(actor):
        return True
    for cid in sides:
        if not await is_direct_l5_admin(session, actor, cid):
            return False
    return bool(sides)


async def validate_slot_change(session: AsyncSession, change: SlotChange, actor: str) -> SlotPlan:
    """액션별 전제(spec §5 표) — 통과하면 적용 계획을 돌려준다. 호출자 자격(owner)은 라우터가 검증.

    mode 가드(_assert_normal)는 슬롯을 "붙일" 때만 건다(assign/move/replace) — 해제·삭제(unassign/delete)는
    잔존 슬롯 정리 경로라 비정상 소스도 허용한다(예: 캔버스 맵에 실수로 붙은 stray category_id 해제).
    커버: test_core_clearing_a_stray_slot_on_a_canvas_map_is_allowed.
    """
    if change.action not in SLOT_ACTIONS:
        raise HTTPException(status_code=422, detail=f"unknown slot action {change.action!r}")
    source = await _load_live_map(session, change.map_id)
    from_category_id = source.category_id
    target: ProcessMap | None = None
    sides: list[int]

    if change.action == "assign":
        _assert_normal(source)
        if from_category_id is not None:
            raise HTTPException(status_code=409, detail="map already has a framework slot")
        category = await _load_l5(session, change.to_category_id)
        sides = [category.id]
    elif change.action == "unassign":
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        sides = [from_category_id]
    elif change.action == "move":
        _assert_normal(source)
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        category = await _load_l5(session, change.to_category_id)
        if category.id == from_category_id:
            raise HTTPException(status_code=409, detail="map is already in that category")
        sides = [from_category_id, category.id]
    else:  # replace · delete
        if from_category_id is None:
            raise HTTPException(status_code=409, detail="source map has no framework slot")
        slot_category = await session.get(ProcessCategory, from_category_id)
        if slot_category is None or slot_category.level != 5:
            raise HTTPException(
                status_code=409,
                detail="framework slot must point to a level-5 category - reassign before transfer",
            )
        if change.action == "replace":
            _assert_normal(source)
        if change.action == "replace" or change.to_map_id is not None:
            if change.to_map_id is None:
                raise HTTPException(status_code=422, detail="to_map_id is required")
            if change.to_map_id == source.id:
                raise HTTPException(status_code=409, detail="target must differ from source")
            target = await _load_live_map(session, change.to_map_id)
            _assert_normal(target)
            if target.category_id is not None or target.consultant_code is not None:
                raise HTTPException(status_code=409, detail="target map already has a framework slot")
        sides = [from_category_id]

    return SlotPlan(
        change=change, source=source, target=target, from_category_id=from_category_id,
        sides=sides, self_apply=await can_self_apply(session, actor, sides),
    )


async def _home_draft(session: AsyncSession, category_id: int | None) -> tuple[ProcessMap | None, MapVersion | None]:
    """L5의 연계 캔버스 라이브 draft — 캔버스가 없거나 삭제됐으면 (None, None)."""
    if category_id is None:
        return None, None
    category = await session.get(ProcessCategory, category_id)
    if category is None or category.linkage_map_id is None:
        return None, None
    canvas = await session.get(ProcessMap, category.linkage_map_id)
    if canvas is None or canvas.deleted_at is not None:
        return None, None
    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == canvas.id, MapVersion.status == workflow.DRAFT)
        .order_by(MapVersion.id.desc())
    )
    return canvas, draft


async def _append_contained_node(session: AsyncSession, draft: MapVersion, found: ProcessMap) -> bool:
    """소속 L6 노드가 없으면 격자 하단에 append — open_linkage_map 보강과 같은 산식. 추가했으면 True.

    임포트가 남긴 외부 플레이스홀더(source_node_id=external_lineage_key(consultant_code),
    linked_map_id=None)가 이미 있으면 새 노드 대신 그 자리를 채운다 — 뒤늦게 슬롯을 받은 맵도
    캔버스 위치·엣지가 보존된다 (spec 2026-09-06 §8 연장).
    """
    exists = await session.scalar(
        select(Node.id).where(
            Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == found.id
        )
    )
    if exists is not None:
        return False
    if found.consultant_code:
        placeholder = await session.scalar(
            select(Node).where(
                Node.version_id == draft.id, Node.node_type == "subprocess",
                Node.linked_map_id.is_(None),
                Node.source_node_id == external_lineage_key(found.consultant_code),
            )
        )
        if placeholder is not None:
            placeholder.linked_map_id = found.id
            placeholder.title = found.name
            placeholder.placeholder_category_id = None
            return True
    max_y, max_sort, node_count = (
        await session.execute(
            select(func.max(Node.pos_y), func.max(Node.sort_order), func.count())
            .where(Node.version_id == draft.id)
        )
    ).one()
    base_y = (max_y + LINKAGE_Y_STEP) if node_count else LINKAGE_Y0
    (px, py), = grid_positions(0, 1, base_y)
    session.add(
        Node(id=uuid4().hex, version_id=draft.id, title=found.name, node_type="subprocess",
             linked_map_id=found.id, follow_latest=True, pos_x=px, pos_y=py,
             sort_order=(max_sort + 1) if node_count else 0)
    )
    return True


def _record_event(
    session: AsyncSession, *, map_id: int, action: str, actor: str,
    from_category_id: int | None = None, to_category_id: int | None = None,
    to_map_id: int | None = None, request_id: int | None = None,
) -> None:
    session.add(
        FrameworkSlotEvent(
            map_id=map_id, action=action, from_category_id=from_category_id,
            to_category_id=to_category_id, to_map_id=to_map_id, actor=actor, request_id=request_id,
        )
    )


async def category_path(session: AsyncSession, category_id: int | None) -> str | None:
    if category_id is None:
        return None
    from app.routers.categories import build_category_paths  # 지역 import — 순환 회피(subprocess.py 관례)

    rows = (
        await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name))
    ).all()
    return build_category_paths(rows).get(category_id)


async def _notify_applied(
    session: AsyncSession, plan: SlotPlan, actor: str, drafts: list[MapVersion]
) -> None:
    """L5 직속·조상 관리자 + 대상/후계자 owner + 캔버스 체크아웃 보유자에게 fw_slot_applied (spec §7.4)."""
    recipients: list[str] = []
    for cid in plan.sides:
        recipients += await get_category_admin_logins(session, cid, direct_only=False)
    for m in (plan.source, plan.target):
        if m is None:
            continue
        # "owner" = map_permissions role=owner 협업자 ∪ owner_id/created_by(임포트 맵은 후자만 채워짐, 2026-09-02 표기 규약)
        recipients += await workflow.load_map_user_collaborators(session, m.id, role="owner")
        if m.owner_id or m.created_by:
            recipients.append(m.owner_id or m.created_by)
    recipients += [d.checked_out_by for d in drafts if d.checked_out_by]
    recipients = [r for r in dict.fromkeys(recipients) if r != actor]
    if not recipients:
        return
    actor_name = await workflow.get_display_name(session, actor)
    change = plan.change
    await workflow.create_notifications(
        session,
        recipients,
        type="fw_slot_applied",
        map_id=plan.source.id,
        message=f"{actor_name} applied slot change '{change.action}' on '{plan.source.name}'",
        payload={
            "map_name": plan.source.name, "actor": actor, "actor_name": actor_name,
            "action": change.action,
            "from_path": await category_path(session, plan.from_category_id),
            "to_path": await category_path(session, change.to_category_id),
            "to_map_id": plan.target.id if plan.target is not None else None,
            "to_map_name": plan.target.name if plan.target is not None else None,
        },
    )


async def apply_slot_change(
    session: AsyncSession, plan: SlotPlan, actor: str, request_id: int | None = None
) -> None:
    """검증된 계획을 한 세션 트랜잭션에서 적용 — 데이터·캔버스·계보·이벤트·알림. commit은 호출자 책임."""
    # target은 여기서 안 쓴다 — handover(replace/delete)는 _apply_handover가 target을 읽는다.
    change, source = plan.change, plan.source
    touched_drafts: list[MapVersion] = []

    if change.action == "assign":
        source.category_id = change.to_category_id
        source.retired_to_map_id = None  # 슬롯을 되찾으면 옛 계보를 지운다 — superseded/stale 해제 (최종 리뷰 #1)
        _, draft = await _home_draft(session, change.to_category_id)
        if draft is not None and await _append_contained_node(session, draft, source):
            record_version_event(session, draft.id, "slot_changed", actor, note=f"assign {source.name}")
            touched_drafts.append(draft)
        _record_event(session, map_id=source.id, action="assign", actor=actor,
                      to_category_id=change.to_category_id, request_id=request_id)

    elif change.action == "unassign":
        # consultant_code는 유지 — 재전달 결착 키. 홈 캔버스 노드는 그대로 두고 unassigned 상태로 파생 표시.
        source.category_id = None
        _record_event(session, map_id=source.id, action="unassign", actor=actor,
                      from_category_id=plan.from_category_id, request_id=request_id)

    elif change.action == "move":
        source.category_id = change.to_category_id
        _, draft = await _home_draft(session, change.to_category_id)
        if draft is not None and await _append_contained_node(session, draft, source):
            record_version_event(session, draft.id, "slot_changed", actor, note=f"move-in {source.name}")
            touched_drafts.append(draft)
        _record_event(session, map_id=source.id, action="move", actor=actor,
                      from_category_id=plan.from_category_id, to_category_id=change.to_category_id,
                      request_id=request_id)

    else:
        touched_drafts += await _apply_handover(session, plan, actor, request_id)

    await session.flush()
    await _notify_applied(session, plan, actor, touched_drafts)


async def _apply_handover(
    session: AsyncSession, plan: SlotPlan, actor: str, request_id: int | None
) -> list[MapVersion]:
    """replace / delete — 슬롯 승계(flush 순서 안전)·계보·홈 캔버스 재지정. 후계자 없는 delete는 소프트삭제만."""
    change, source, target = plan.change, plan.source, plan.target
    from_category_id = plan.from_category_id
    slot_code = source.consultant_code
    touched: list[MapVersion] = []

    if target is not None:
        # 결함 ①: source를 먼저 비우고 flush — UPDATE는 PK 순이라 target이 먼저 코드를 받으면 unique 충돌
        source.category_id = None
        source.consultant_code = None
        await session.flush()
        target.category_id = from_category_id
        target.consultant_code = slot_code
        target.retired_to_map_id = None  # target도 슬롯을 되찾은 맵일 수 있다 — 옛 계보를 지운다 (최종 리뷰 #1)
        source.retired_to_map_id = target.id
        _, draft = await _home_draft(session, from_category_id)
        if draft is not None:
            await _repoint_home_canvas(session, draft, source, target)
            record_version_event(
                session, draft.id, "slot_changed", actor, note=f"{source.name} -> {target.name}"
            )
            touched.append(draft)
        _record_event(session, map_id=target.id, action="succeed", actor=actor,
                      to_category_id=from_category_id, to_map_id=source.id, request_id=request_id)

    if change.action == "delete":
        # delete_map(maps.py)와 동일 — 소프트삭제 + KB 청크 제거. 슬롯은 후계자가 없으면 그대로(휴지통 복구 시 회복)
        from app.routers.maps import _delete_map_kb_chunks  # 지역 import — 라우터 순환 회피

        source.deleted_at = now_kst()
        await _delete_map_kb_chunks(session, [source.id])

    _record_event(session, map_id=source.id, action=change.action, actor=actor,
                  from_category_id=from_category_id, to_map_id=target.id if target else None,
                  request_id=request_id)
    return touched


async def _repoint_home_canvas(
    session: AsyncSession, draft: MapVersion, source: ProcessMap, target: ProcessMap
) -> None:
    """홈 캔버스 draft에서 source를 가리키는 노드를 target으로 — 엣지·좌표·폭 유지.
    target 노드가 이미 있으면 source 노드의 엣지를 target 노드로 옮기고(중복 쌍 제거) source 노드를 지운다."""
    source_nodes = list(
        (await session.scalars(
            select(Node).where(
                Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == source.id
            )
        )).all()
    )
    if not source_nodes:
        return
    existing_target = await session.scalar(
        select(Node).where(
            Node.version_id == draft.id, Node.node_type == "subprocess", Node.linked_map_id == target.id
        )
    )
    if existing_target is None:
        for node in source_nodes:
            node.linked_map_id = target.id
            node.title = target.name
            node.linked_version_id = None  # 고정 버전은 옛 맵의 것 — 후계자는 최신 추종으로 시작
            node.follow_latest = True
        return
    source_ids = {n.id for n in source_nodes}
    edges = list((await session.scalars(select(Edge).where(Edge.version_id == draft.id))).all())
    pairs = {(e.source_node_id, e.target_node_id) for e in edges if e.source_node_id not in source_ids
             and e.target_node_id not in source_ids}
    for edge in edges:
        new_src = existing_target.id if edge.source_node_id in source_ids else edge.source_node_id
        new_tgt = existing_target.id if edge.target_node_id in source_ids else edge.target_node_id
        if (new_src, new_tgt) == (edge.source_node_id, edge.target_node_id):
            continue
        if new_src == new_tgt or (new_src, new_tgt) in pairs:
            await session.delete(edge)  # 자기루프·중복 쌍은 버린다
            continue
        edge.source_node_id, edge.target_node_id = new_src, new_tgt
        pairs.add((new_src, new_tgt))
    for node in source_nodes:
        await session.delete(node)


async def build_preview(session: AsyncSession, plan: SlotPlan, actor: str) -> dict:
    """dry_run 응답 — side별 승인자·호출자 충족 여부 + 영향 집계 (spec §4.1)."""
    sides = []
    for cid in plan.sides:
        approvers = await get_category_admin_logins(session, cid, direct_only=True)
        satisfied = logic.is_sysadmin(actor) or await is_direct_l5_admin(session, actor, cid)
        sides.append({"category_id": cid, "path": await category_path(session, cid),
                      "approvers": approvers, "satisfied_by_caller": satisfied})
    canvas, draft = await _home_draft(session, plan.from_category_id)
    home_nodes = edges_kept = 0
    if draft is not None:
        node_ids = list(
            (await session.scalars(
                select(Node.id).where(Node.version_id == draft.id, Node.linked_map_id == plan.source.id)
            )).all()
        )
        home_nodes = len(node_ids)
        if node_ids:
            edges_kept = await session.scalar(
                select(func.count()).select_from(Edge).where(
                    Edge.version_id == draft.id,
                    (Edge.source_node_id.in_(node_ids)) | (Edge.target_node_id.in_(node_ids)),
                )
            ) or 0
    other_q = (
        select(func.count(func.distinct(MapVersion.map_id)))
        .select_from(Node).join(MapVersion, MapVersion.id == Node.version_id)
        .join(ProcessMap, ProcessMap.id == MapVersion.map_id)
        .where(Node.linked_map_id == plan.source.id, ProcessMap.deleted_at.is_(None))
    )
    if canvas is not None:
        other_q = other_q.where(MapVersion.map_id != canvas.id)
    other_canvas = await session.scalar(other_q.where(ProcessMap.mode == "framework")) or 0
    referencing = await session.scalar(other_q.where(ProcessMap.mode != "framework")) or 0
    return {
        "self_apply": plan.self_apply,
        "sides": sides,
        "impact": {"home_canvas_nodes": home_nodes, "other_canvas_nodes": other_canvas,
                   "referencing_maps": referencing, "edges_kept": edges_kept},
    }


def build_request_payload(plan: SlotPlan, note: str) -> dict:
    """ApprovalRequest.payload — 승인 시 재검증에 필요한 최소 좌표 + 표시용 이름 (spec §4.1)."""
    change = plan.change
    return {
        "action": change.action,
        "map_name": plan.source.name,
        "from_category_id": plan.from_category_id,
        "to_category_id": change.to_category_id,
        "to_map_id": change.to_map_id,
        "to_map_name": plan.target.name if plan.target is not None else None,
        "note": note,
        "sides": list(plan.sides),
        "approvals": {},
    }


def change_from_payload(map_id: int, payload: dict) -> SlotChange:
    return SlotChange(
        action=str(payload.get("action")), map_id=map_id,
        to_category_id=payload.get("to_category_id"), to_map_id=payload.get("to_map_id"),
        note=str(payload.get("note") or ""),
    )


async def remaining_sides(session: AsyncSession, req: ApprovalRequest) -> list[int]:
    approvals = req.payload.get("approvals") or {}
    return [int(c) for c in req.payload.get("sides", []) if str(c) not in approvals]


async def can_decide_slot_for_map(
    session: AsyncSession, user: str, found_map: ProcessMap
) -> bool:
    """이 맵의 fw_slot 요청 결정권자인지 — get_map(MapDetail.can_decide_slot)과 승인 목록
    게이트(permissions.list_approval_requests)가 공유하는 단일 판정 규칙.

    sysadmin 전원 → 대기 중인 fw_slot 요청의 잔여 side 직속 L5 관리자(이미 결정한 side의
    관리자는 재결정권 없음) → 대기 요청이 없으면 현재 소속 카테고리 직속 관리자로 폴백
    (spec 2026-09-06 §4.2).
    """
    if logic.is_sysadmin(user):
        return True
    pending_slot_req = await session.scalar(
        select(ApprovalRequest).where(
            ApprovalRequest.map_id == found_map.id,
            ApprovalRequest.kind == "fw_slot",
            ApprovalRequest.status == "pending",
        )
    )
    if pending_slot_req is not None:
        for cid in await remaining_sides(session, pending_slot_req):
            if await is_direct_l5_admin(session, user, cid):
                return True
        return False
    return found_map.category_id is not None and await is_direct_l5_admin(
        session, user, found_map.category_id
    )


async def record_slot_approvals(session: AsyncSession, req: ApprovalRequest, user: str) -> list[int]:
    """호출자가 관리자인 side 전부를 approvals에 기록 — JSON 컬럼은 재할당해야 변경이 감지된다. 남은 side 반환."""
    sides = [int(c) for c in req.payload.get("sides", [])]
    approvals = dict(req.payload.get("approvals") or {})
    for cid in sides:
        if str(cid) in approvals:
            continue
        if logic.is_sysadmin(user) or await is_direct_l5_admin(session, user, cid):
            approvals[str(cid)] = {"by": user, "at": now_kst().isoformat()}
    req.payload = {**req.payload, "approvals": approvals}
    return [c for c in sides if str(c) not in approvals]


async def notify_slot_requested(
    session: AsyncSession, plan: SlotPlan, req: ApprovalRequest, actor: str
) -> None:
    """side 직속 관리자 + sysadmin(대체 처리자)에게 fw_slot_requested — fw_confirm 요청 알림과 같은 수신 규칙."""
    recipients: list[str] = []
    for cid in plan.sides:
        recipients += await get_category_admin_logins(session, cid, direct_only=True)
    recipients += list(logic.list_sysadmin_logins())
    recipients = [r for r in dict.fromkeys(recipients) if r != actor]
    actor_name = await workflow.get_display_name(session, actor)
    await workflow.create_notifications(
        session,
        recipients,
        type="fw_slot_requested",
        map_id=plan.source.id,
        message=f"{actor_name} requested slot change '{plan.change.action}' on '{plan.source.name}'",
        payload={
            "map_name": plan.source.name, "actor": actor, "actor_name": actor_name,
            "action": plan.change.action, "note": plan.change.note,
            "from_path": await category_path(session, plan.from_category_id),
            "to_path": await category_path(session, plan.change.to_category_id),
            "to_map_name": plan.target.name if plan.target is not None else None,
            "request_id": req.id,
        },
    )
