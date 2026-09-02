"""컨설턴트 체계 카테고리 트리 — lazy 자식 조회 + 카테고리별 맵 페이지네이션 (design 2026-08-08)."""

from collections.abc import Sequence
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Row, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user, require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.models import (
    CategoryPermission,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.framework_confirm import load_confirm_draft
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic
from app.permissions.access import (
    get_admin_scope,
    get_category_admin_logins,
    get_user_active_group_ids,
    is_category_admin,
)
from app.schemas import (
    CategoryAdminOut,
    CategoryCreateIn,
    CategoryMapsOut,
    CategoryNodeOut,
    CategoryPermissionEntry,
    CategoryPermissionsIn,
    CategoryPermissionsOut,
    CategorySubtreeConfirmOut,
    CategorySummaryL5Out,
    CategorySummaryOut,
    CategoryUpdateIn,
    FrameworkImportRow,
    FrameworkOverviewOut,
    FrameworkOverviewRow,
    FrameworkSearchCategory,
    FrameworkSearchMap,
    FrameworkSearchOut,
    GateFailureCountOut,
    InterviewImportFileOut,
    InterviewImportIn,
    InterviewImportOut,
    InterviewIssueOut,
    LinkageMapOut,
    MapOut,
)
from app.subprocess import (
    LINKAGE_Y0,
    LINKAGE_Y_STEP,
    find_missing_l6_ids,
    grid_positions,
    unique_linkage_name,
    validate_confirm_readiness,
    validate_confirm_readiness_batch,
)
from app.version_events import record_version_event

MAX_CATEGORY_LEVEL = 5  # 컨설턴트 체계 L1~L5 (design 2026-08-08 §2.1)

router = APIRouter(
    prefix="/api/categories", tags=["categories"], dependencies=[Depends(get_current_user)]
)


def build_category_paths(rows: Sequence[tuple[int, int | None, str]]) -> dict[int, str]:
    """카테고리 id → "L1이름/.../연결노드이름" 조인 문자열. rows: 전체 (id, parent_id, name).

    순수 함수 — maps.py list_maps/get_map이 그대로 import해 재사용(중복 구현 금지, brief §구현지침).
    """
    by_id = {row[0]: row for row in rows}
    cache: dict[int, str] = {}

    visiting: set[int] = set()  # current recursion stack — detects a parent cycle

    def _path(cid: int) -> str:
        if cid in cache:
            return cache[cid]
        _, parent_id, name = by_id[cid]
        if parent_id in by_id and parent_id not in visiting:
            visiting.add(cid)
            path = f"{_path(parent_id)}/{name}"
            visiting.discard(cid)
        else:
            # root, or parent_id already on this call's stack (cycle) — stop and return
            # the partial path instead of recursing forever into a RecursionError.
            path = name
        cache[cid] = path
        return path

    return {cid: _path(cid) for cid in by_id}


async def _split_visible_maps(
    session: AsyncSession, user: str, maps: list[ProcessMap]
) -> tuple[list[ProcessMap], int]:
    """가시성 필터 — maps.list_maps의 배치 in-memory 판정을 주어진 맵 소량 집합으로 축소 재사용.

    반환: (my_role 주입된 가시 맵, 숨김 개수). subprocess-usage의 hidden_count 마스킹과 동일 선례.
    """
    if not maps:
        return [], 0
    if logic.is_sysadmin(user):
        for m in maps:
            m.my_role = "owner"
        return maps, 0

    map_ids = [m.id for m in maps]
    emp = await session.get(Employee, user)
    emp_org_path = (
        resolve_org_path(emp, await load_dept_index(session)) if emp is not None else ""
    )
    perm_rows = (
        await session.execute(
            select(
                MapPermission.map_id,
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            ).where(MapPermission.map_id.in_(map_ids))
        )
    ).all()
    perms_by_map: dict[int, list[logic.Permission]] = {}
    for mid, ptype, pid, role in perm_rows:
        perms_by_map.setdefault(mid, []).append((ptype, pid, role))
    approver_map_ids = set(
        (
            await session.scalars(
                select(MapApprover.map_id).where(
                    MapApprover.map_id.in_(map_ids), MapApprover.user_id == user
                )
            )
        ).all()
    )
    user_group_ids = await get_user_active_group_ids(session, user, emp_org_path)

    visible: list[ProcessMap] = []
    hidden = 0
    for m in maps:
        role = logic.effective_role(
            user,
            False,  # is_sysadmin True는 위에서 조기 반환
            emp_org_path,
            m.visibility,
            perms_by_map.get(m.id, []),
            m.id in approver_map_ids,
            user_group_ids,
            owning_department=m.owning_department,
        )
        if role is None:
            hidden += 1
            continue
        m.my_role = role
        visible.append(m)
    return visible, hidden


async def _apply_card_metrics(session: AsyncSession, maps: list[ProcessMap]) -> None:
    """홈 카드 메트릭(latest_version_status·version_count·node_count·member_count·owner_name) 주입.

    maps.list_maps._set_card_metrics와 동일 계산을 소량 페이지(map_ids 스코프 쿼리)로 재사용.
    """
    if not maps:
        return
    map_ids = [m.id for m in maps]
    latest_status: dict[int, str] = {}
    latest_vid: dict[int, int] = {}
    for mid, vid, status in (
        await session.execute(
            select(MapVersion.map_id, MapVersion.id, MapVersion.status)
            .where(MapVersion.map_id.in_(map_ids))
            .order_by(MapVersion.id)
        )
    ).all():
        latest_status[mid] = status  # id 오름차순 → 마지막이 최신
        latest_vid[mid] = vid
    version_count: dict[int, int] = {
        mid: cnt
        for mid, cnt in (
            await session.execute(
                select(MapVersion.map_id, func.count())
                .where(MapVersion.map_id.in_(map_ids))
                .group_by(MapVersion.map_id)
            )
        ).all()
    }
    published_vid: dict[int, int] = {
        mid: vid
        for mid, vid in (
            await session.execute(
                select(MapVersion.map_id, MapVersion.id).where(
                    MapVersion.map_id.in_(map_ids), MapVersion.status == workflow.PUBLISHED
                )
            )
        ).all()
    }
    target_vids = {published_vid.get(m.id, latest_vid.get(m.id)) for m in maps}
    target_vids.discard(None)
    node_count_by_vid: dict[int, int] = {}
    if target_vids:
        node_count_by_vid = {
            vid: cnt
            for vid, cnt in (
                await session.execute(
                    select(Node.version_id, func.count())
                    .where(Node.version_id.in_(target_vids))
                    .group_by(Node.version_id)
                )
            ).all()
        }
    owner_ids = {m.created_by for m in maps if m.created_by}
    owner_name: dict[str, str] = {}
    if owner_ids:
        owner_name = {
            lid: nm
            for lid, nm in (
                await session.execute(
                    select(Employee.login_id, Employee.name).where(
                        Employee.login_id.in_(owner_ids)
                    )
                )
            ).all()
        }
    member_count: dict[int, int] = {
        mid: cnt
        for mid, cnt in (
            await session.execute(
                select(MapPermission.map_id, func.count())
                .where(MapPermission.map_id.in_(map_ids))
                .group_by(MapPermission.map_id)
            )
        ).all()
    }
    for m in maps:
        m.latest_version_status = latest_status.get(m.id)
        m.version_count = version_count.get(m.id, 0)
        tvid = published_vid.get(m.id, latest_vid.get(m.id))
        m.node_count = node_count_by_vid.get(tvid, 0) if tvid is not None else 0
        m.member_count = member_count.get(m.id, 0)
        m.owner_name = owner_name.get(m.created_by) if m.created_by else None


async def _admin_category_ids(session: AsyncSession, user: str) -> set[int]:
    """호출자가 권한자인 카테고리 id 전체 — get_admin_scope(access.py)의 얇은 래퍼(id만 필요)."""
    admin_ids, _seeds = await get_admin_scope(session, user)
    return admin_ids


def _subtree_map_counts(rows: Sequence[Row], own_map_count: dict[int, int]) -> dict[int, int]:
    """서브트리(자기+자손) 맵 수 합산 — 레벨 역순(깊은 노드 먼저)으로 부모에 누적, 순회 1회.

    rows: 전체 (id, parent_id, ..., level, ...) 행(속성 접근 — .id/.parent_id/.level 전제).
    list_category_nodes에서 추출 — framework-overview 등 다른 배치 조회도 재사용 가능.
    """
    subtree_count: dict[int, int] = {row.id: own_map_count.get(row.id, 0) for row in rows}
    for row in sorted(rows, key=lambda r: -r.level):
        if row.parent_id is not None:
            subtree_count[row.parent_id] = subtree_count.get(row.parent_id, 0) + subtree_count[row.id]
    return subtree_count


@router.get("/search", response_model=FrameworkSearchOut)
async def search_framework(
    q: str = Query(min_length=1, max_length=100),
    limit: int = Query(default=20, ge=1, le=50),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> FrameworkSearchOut:
    """체계 탐색 검색 — 카테고리·맵 이름 부분일치(대소문자 무시), 경로 동봉 (탐색 모달, 2026-08-30).

    맵은 카테고리 연결분만 대상이며 목록과 동일한 가시성 마스킹(_split_visible_maps)을 지나
    비가시 맵은 결과에서 제외한다(개수 힌트도 없음 — 검색 표면에선 존재 노출 자체를 피함).
    """
    like = f"%{q}%"
    cat_rows = (
        await session.scalars(
            select(ProcessCategory)
            .where(ProcessCategory.name.ilike(like))
            .order_by(ProcessCategory.level, ProcessCategory.name)
            .limit(limit)
        )
    ).all()
    map_rows = list(
        (
            await session.scalars(
                select(ProcessMap)
                .where(
                    ProcessMap.deleted_at.is_(None),
                    ProcessMap.category_id.is_not(None),
                    ProcessMap.name.ilike(like),
                )
                .order_by(ProcessMap.name)
                # 마스킹으로 줄어들 수 있어 여유분 조회 후 절단
                .limit(limit * 3)
            )
        ).all()
    )
    visible, _hidden = await _split_visible_maps(session, user, map_rows)
    visible = visible[:limit]
    paths = build_category_paths(
        (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
    )
    return FrameworkSearchOut(
        categories=[
            FrameworkSearchCategory(id=c.id, name=c.name, level=c.level, path=paths.get(c.id))
            for c in cat_rows
        ],
        maps=[
            FrameworkSearchMap(id=m.id, name=m.name, category_id=m.category_id, path=paths.get(m.category_id))
            for m in visible
            if m.category_id is not None
        ],
    )


@router.get("/nodes", response_model=list[CategoryNodeOut])
async def list_category_nodes(
    parent_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[CategoryNodeOut]:
    """자식 카테고리 lazy 조회 — parent_id 미지정=루트(L1). map_count는 가시성 무관 서브트리 총계."""
    rows = (
        await session.execute(
            select(
                ProcessCategory.id,
                ProcessCategory.parent_id,
                ProcessCategory.code,
                ProcessCategory.name,
                ProcessCategory.level,
                ProcessCategory.sort_order,
                ProcessCategory.linkage_map_id,
            )
        )
    ).all()
    children_by_parent: dict[int | None, list] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row)

    own_map_count: dict[int, int] = dict(
        (
            await session.execute(
                select(ProcessMap.category_id, func.count())
                .where(ProcessMap.deleted_at.is_(None), ProcessMap.category_id.is_not(None))
                .group_by(ProcessMap.category_id)
            )
        ).all()
    )
    subtree_count = _subtree_map_counts(rows, own_map_count)

    admin_ids = await _admin_category_ids(session, user)
    targets = sorted(children_by_parent.get(parent_id, []), key=lambda r: (r.sort_order, r.code))
    return [
        CategoryNodeOut(
            id=r.id,
            code=r.code,
            name=r.name,
            level=r.level,
            sort_order=r.sort_order,
            child_count=len(children_by_parent.get(r.id, [])),
            map_count=subtree_count.get(r.id, 0),
            linkage_map_id=r.linkage_map_id,
            can_edit_linkage=r.id in admin_ids,
        )
        for r in targets
    ]


@router.get("/framework-overview", response_model=FrameworkOverviewOut)
async def get_framework_overview(
    root_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> FrameworkOverviewOut:
    """L5 연계 캔버스 배치 현황판 — 최신 fw·확정자·게이트 준비 상태를 카테고리별로 일괄 (Track C Task 4).

    게이트: sysadmin은 root_id 생략(전사) 또는 임의 root 허용. 카테고리 관리자는 root_id가
    자기 admin_ids 서브트리 안일 때만(밖이면 403), 생략 시 자기 seed 전체(admin_ids ∩ L5).
    무권한자는 항상 403 — get_admin_scope의 seeds=={}는 sysadmin과 무권한 공통이라 is_sysadmin으로 분기.
    """
    cat_rows = (
        await session.execute(
            select(
                ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level,
                ProcessCategory.name, ProcessCategory.linkage_map_id,
            )
        )
    ).all()
    by_id = {r.id: r for r in cat_rows}
    admin_ids, seeds = await get_admin_scope(session, user)
    is_sys = logic.is_sysadmin(user)

    if root_id is not None:
        if root_id not in by_id:
            raise HTTPException(status_code=404, detail=f"category {root_id} not found")
        if not is_sys and root_id not in admin_ids:
            raise HTTPException(status_code=403, detail="not a category admin for this root")
        children_by_parent: dict[int | None, list[int]] = {}
        for r in cat_rows:
            children_by_parent.setdefault(r.parent_id, []).append(r.id)
        scope_ids: set[int] = set()
        frontier = [root_id]
        while frontier:
            scope_ids.update(frontier)
            frontier = [c for f in frontier for c in children_by_parent.get(f, [])]
    elif is_sys:
        scope_ids = set(by_id)
    elif seeds:
        scope_ids = admin_ids
    else:
        raise HTTPException(status_code=403, detail="category admin permission required")

    l5_rows = [r for r in cat_rows if r.level == 5 and r.id in scope_ids]
    paths = build_category_paths([(r.id, r.parent_id, r.name) for r in cat_rows])

    linkage_map_ids = [r.linkage_map_id for r in l5_rows if r.linkage_map_id is not None]
    maps_by_id: dict[int, ProcessMap] = {}
    draft_id_by_map: dict[int, int] = {}
    latest_snap: dict[int, tuple[int, int, str | None, object]] = {}
    if linkage_map_ids:
        maps_by_id = {
            m.id: m
            for m in (
                await session.scalars(select(ProcessMap).where(ProcessMap.id.in_(linkage_map_ids)))
            ).all()
        }
        for mid, vid in (
            await session.execute(
                select(MapVersion.map_id, MapVersion.id)
                .where(MapVersion.map_id.in_(linkage_map_ids), MapVersion.status == workflow.DRAFT)
                .order_by(MapVersion.id.desc())
            )
        ).all():
            draft_id_by_map.setdefault(mid, vid)  # desc 정렬 첫 매치=최신 draft
        # 최신 확정 스냅샷 — map_id.in_() 배치 1쿼리(framework_confirm.py 단건 max 패턴 확장)
        for mid, major, minor, submitted_by, created_at in (
            await session.execute(
                select(
                    MapVersion.map_id, MapVersion.fw_major, MapVersion.fw_minor,
                    MapVersion.submitted_by, MapVersion.created_at,
                ).where(MapVersion.map_id.in_(linkage_map_ids), MapVersion.status == workflow.CONFIRMED)
            )
        ).all():
            cur = latest_snap.get(mid)
            if cur is None or (major, minor) > (cur[0], cur[1]):
                latest_snap[mid] = (major, minor, submitted_by, created_at)

    canvases = [
        (maps_by_id[r.linkage_map_id], draft_id_by_map[r.linkage_map_id])
        for r in l5_rows
        if r.linkage_map_id is not None
        and r.linkage_map_id in maps_by_id  # 고아 linkage_map_id(무결성 위반) 방어 — 있으면 스킵
        and r.linkage_map_id in draft_id_by_map
    ]
    failures_by_map = await validate_confirm_readiness_batch(session, canvases)

    rows_out = []
    for r in l5_rows:
        map_id = r.linkage_map_id
        if map_id is None:
            rows_out.append(
                FrameworkOverviewRow(category_id=r.id, path=paths.get(r.id, r.name))
            )
            continue
        snap = latest_snap.get(map_id)
        canvas_failures = failures_by_map.get(map_id)
        rows_out.append(
            FrameworkOverviewRow(
                category_id=r.id,
                path=paths.get(r.id, r.name),
                linkage_map_id=map_id,
                latest_fw=f"v{snap[0]}.{snap[1]}" if snap else None,
                confirmed_by=snap[2] if snap else None,
                confirmed_at=snap[3].isoformat() if snap else None,
                ready=(not canvas_failures) if canvas_failures is not None else None,
                failures=(
                    [GateFailureCountOut(code=f.code, count=f.count) for f in canvas_failures]
                    if canvas_failures
                    else []
                ),
            )
        )
    rows_out.sort(key=lambda row: row.path)
    return FrameworkOverviewOut(rows=rows_out)


async def _summary_admins(
    session: AsyncSession, category_id: int, by_id: dict[int, Row]
) -> list[CategoryAdminOut]:
    """조상 체인 포함 관리자 "개인" 목록 — 동일인이 여러 행(자신+조상)에 걸리면 최소 level(가장
    상위 조상) 채택 (Track C Task 5, 브리프 지침). get_category_admin_logins(direct_only=False)는
    login 집합만 줘서 "행이 붙은 카테고리의 level"을 못 담으므로, 체인(최대 5단)을 거슬러 오르며
    카테고리별로 direct_only=True 재조회한다 — 길이가 짧아 N+1이어도 무해하다.
    """
    chain_ids: list[int] = []
    cursor: int | None = category_id
    while cursor is not None and cursor in by_id:
        chain_ids.append(cursor)
        cursor = by_id[cursor].parent_id

    level_by_login: dict[str, int] = {}
    for cid in chain_ids:
        for login in await get_category_admin_logins(session, cid, direct_only=True):
            level = by_id[cid].level
            if login not in level_by_login or level < level_by_login[login]:
                level_by_login[login] = level

    if not level_by_login:
        return []
    # get_display_name과 동일 규칙(Employee.name, 없으면 login_id)을 배치 1쿼리로 재현
    name_by_login = dict(
        (
            await session.execute(
                select(Employee.login_id, Employee.name).where(
                    Employee.login_id.in_(level_by_login.keys())
                )
            )
        ).all()
    )
    return [
        CategoryAdminOut(login_id=lid, name=name_by_login.get(lid) or lid, level=level_by_login[lid])
        for lid in sorted(level_by_login)
    ]


async def _summary_l5(
    session: AsyncSession, map_id: int | None, can_edit_linkage: bool
) -> CategorySummaryL5Out:
    """level==5 캔버스 상태 — framework-overview 1행과 동치 계산을 단건으로(브리프 지침:
    배치 대신 validate_confirm_readiness 단건판 사용). can_edit_linkage는 호출부가 판정해 그대로 싣는다.
    """
    if map_id is None:
        return CategorySummaryL5Out(can_edit_linkage=can_edit_linkage)
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:  # 고아 linkage_map_id(무결성 위반) 방어 — 포인터는 유지, 나머지는 미상(None)
        return CategorySummaryL5Out(linkage_map_id=map_id, can_edit_linkage=can_edit_linkage)
    draft = await load_confirm_draft(session, map_id)
    latest: tuple[int, int, str | None, object] | None = None
    for major, minor, submitted_by, created_at in (
        await session.execute(
            select(
                MapVersion.fw_major, MapVersion.fw_minor,
                MapVersion.submitted_by, MapVersion.created_at,
            ).where(MapVersion.map_id == map_id, MapVersion.status == workflow.CONFIRMED)
        )
    ).all():
        if latest is None or (major, minor) > (latest[0], latest[1]):
            latest = (major, minor, submitted_by, created_at)
    failures = await validate_confirm_readiness(session, found_map, draft) if draft is not None else None
    return CategorySummaryL5Out(
        linkage_map_id=map_id,
        latest_fw=f"v{latest[0]}.{latest[1]}" if latest else None,
        confirmed_by=latest[2] if latest else None,
        confirmed_at=latest[3].isoformat() if latest else None,
        ready=(not failures) if failures is not None else None,
        failures=(
            [GateFailureCountOut(code=f.code, count=f.count) for f in failures] if failures else []
        ),
        can_edit_linkage=can_edit_linkage,
    )


@router.get("/{category_id}/summary", response_model=CategorySummaryOut)
async def get_category_summary(
    category_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> CategorySummaryOut:
    """카테고리 1노드 레벨 요약 — 담당자 파악 목적이라 로그인 전체 열람(가시성 판정 없음, 404만,
    spec §8.3). level==5는 자기 캔버스 상태(l5), level<5는 서브트리 L5 확정 현황 3종(subtree_confirm).
    """
    cat_rows = (
        await session.execute(
            select(
                ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level,
                ProcessCategory.name, ProcessCategory.linkage_map_id,
            )
        )
    ).all()
    by_id = {r.id: r for r in cat_rows}
    if category_id not in by_id:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    category = by_id[category_id]

    paths = build_category_paths([(r.id, r.parent_id, r.name) for r in cat_rows])

    children_by_parent: dict[int | None, list[int]] = {}
    for r in cat_rows:
        children_by_parent.setdefault(r.parent_id, []).append(r.id)
    child_count = len(children_by_parent.get(category_id, []))

    # 서브트리(자기 포함) BFS — visited 가드로 (동시성) 부모 사이클에도 종료 보장 (delete_category 선례)
    subtree_ids: set[int] = {category_id}
    frontier = children_by_parent.get(category_id, [])
    while frontier:
        subtree_ids.update(frontier)
        frontier = [
            nid for n in frontier for nid in children_by_parent.get(n, []) if nid not in subtree_ids
        ]
    subtree_l5_rows = [by_id[i] for i in subtree_ids if by_id[i].level == 5]

    own_map_count: dict[int, int] = dict(
        (
            await session.execute(
                select(ProcessMap.category_id, func.count())
                .where(ProcessMap.deleted_at.is_(None), ProcessMap.category_id.is_not(None))
                .group_by(ProcessMap.category_id)
            )
        ).all()
    )
    subtree_map_count = _subtree_map_counts(cat_rows, own_map_count).get(category_id, 0)

    admins = await _summary_admins(session, category_id, by_id)

    l5_out: CategorySummaryL5Out | None = None
    subtree_confirm_out: CategorySubtreeConfirmOut | None = None
    if category.level == 5:
        # CategoryNodeOut.can_edit_linkage(list_category_nodes)와 동일 의미: 체인 관리자 or sysadmin.
        can_edit_linkage = logic.is_sysadmin(user) or await is_category_admin(session, user, category_id)
        l5_out = await _summary_l5(session, category.linkage_map_id, can_edit_linkage)
    else:
        l5_map_ids = [r.linkage_map_id for r in subtree_l5_rows if r.linkage_map_id is not None]
        confirmed_map_ids: set[int] = set()
        if l5_map_ids:
            confirmed_map_ids = set(
                (
                    await session.scalars(
                        select(MapVersion.map_id)
                        .where(
                            MapVersion.map_id.in_(l5_map_ids),
                            MapVersion.status == workflow.CONFIRMED,
                        )
                        .distinct()
                    )
                ).all()
            )
        no_canvas = sum(1 for r in subtree_l5_rows if r.linkage_map_id is None)
        confirmed = sum(
            1 for r in subtree_l5_rows
            if r.linkage_map_id is not None and r.linkage_map_id in confirmed_map_ids
        )
        # 우선순위(상호배타, 브리프 고정): no_canvas > 스냅샷≥1이면 confirmed > 나머지 not_ready
        # — ready==False라도 스냅샷이 있으면 confirmed로 집계(정의 충돌 해소, CLAUDE.md 계약과 동일 표기).
        # validate_confirm_readiness_batch(게이트 판정) 미사용 이유: 여기선 스냅샷 존재 여부만 필요하고
        # 현재 draft의 ready 판정은 무관 — 불필요한 노드/엣지 배치 로드를 피한다.
        not_ready = len(subtree_l5_rows) - no_canvas - confirmed
        subtree_confirm_out = CategorySubtreeConfirmOut(
            confirmed=confirmed, not_ready=not_ready, no_canvas=no_canvas
        )

    return CategorySummaryOut(
        id=category_id,
        name=category.name,
        level=category.level,
        path=paths.get(category_id, category.name),
        child_count=child_count,
        subtree_l5_count=len(subtree_l5_rows),
        subtree_map_count=subtree_map_count,
        admins=admins,
        l5=l5_out,
        subtree_confirm=subtree_confirm_out,
    )


_INTERVIEW_ISSUE_CAP = 200  # 파일당 이슈 표시 상한 — 초과분은 말미 요약 1행


@router.post("/import-interview", response_model=InterviewImportOut)
async def import_interview_delivery(
    payload: InterviewImportIn,
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> InterviewImportOut:
    """인터뷰 결과 JSON 다중 파일 임포트 — 파일별 어댑터 검증 후 공용 엔진 재사용, 기본 dry-run.

    error가 있는 파일은 통째로 스킵하고 나머지 파일만 진행한다(부분 임포트 없음 —
    dry-run으로 고친 뒤 재실행). 노트 적재는 같은 세션이라 dry-run rollback에 함께 원복.
    literal "/import-interview"는 `/{category_id}/...` 패턴보다 앞서 선언 — FastAPI는 등록
    순서대로 매칭하므로 path-param 라우트가 이 세그먼트를 가로채지 않게 한다.
    scripts는 app 모듈을 가져와 순환참조가 생기므로 함수 지역에서 지연 임포트한다.
    설계: docs/design/2026-08-18-interview-import-design.md §1·§6.
    """
    from scripts.consultant_canonical import CanonicalCategory, CanonicalMap
    from scripts.consultant_interview import (
        AdapterIssue,
        InterviewLinkage,
        InterviewNote,
        convert_interview,
    )
    from scripts.import_consultant import (
        apply_interview_linkage,
        apply_interview_notes,
        import_delivery,
    )

    files_out: list[InterviewImportFileOut] = []
    merged_cats: dict[str, CanonicalCategory] = {}
    merged_maps: list[CanonicalMap] = []
    merged_notes: list[InterviewNote] = []
    merged_linkages: list[InterviewLinkage] = []
    seen_task_codes: set[str] = set()

    for file in payload.files:
        result = convert_interview(file.content)
        issues = list(result.issues)
        ok = not result.has_error()
        if ok:
            # 파일 간 중복 taskId = 같은 파일 재선택/재전달 겹침 신호 — 뒤 파일을 통째로 제외
            dupes = [m.code for m in result.maps if m.code in seen_task_codes]
            if dupes:
                issues.append(AdapterIssue(
                    "error", "rows",
                    f"duplicate taskId across files: {', '.join(dupes)} — file skipped"
                    " (파일 간 taskId 중복 — 이 파일 전체 제외)",
                ))
                ok = False
        if ok:
            for cat in result.categories:
                prev = merged_cats.get(cat.code)
                if prev is not None and prev.name != cat.name:
                    issues.append(AdapterIssue(
                        "warning", "framework.categories",
                        f"category {cat.code} name differs across files — later file wins"
                        " (파일 간 분류 이름 불일치 — 뒤 파일 기준 적용)",
                    ))
                merged_cats[cat.code] = cat
            merged_maps.extend(result.maps)
            seen_task_codes.update(m.code for m in result.maps)
            merged_notes.extend(result.notes)
            if result.linkage is not None:
                merged_linkages.append(result.linkage)

        shown = issues[:_INTERVIEW_ISSUE_CAP]
        overflow = len(issues) - len(shown)
        rows_out = [InterviewIssueOut(severity=i.severity, path=i.path, message=i.message) for i in shown]
        if overflow > 0:
            rows_out.append(InterviewIssueOut(
                severity="warning", path="$",
                message=f"... {overflow} more issues (이슈 {overflow}건 더 있음 — 표시 생략)",
            ))
        files_out.append(InterviewImportFileOut(
            name=file.name, ok=ok,
            map_count=len(result.maps) if ok else 0,
            note_count=len(result.notes) if ok else 0,
            issues=rows_out,
        ))

    label = payload.label or f"Interview {now_kst():%Y-%m-%d}"
    report = await import_delivery(
        session, categories=list(merged_cats.values()), maps=merged_maps,
        actor=login_id, label=label, commit_every=None,
        # 연계 캔버스에 놓일 맵은 annual_count/fte 착지면이 있다 — "갈 곳 없음" 경고 대상 아님
        linkage_placed={code for lk in merged_linkages for code in lk.map_codes},
    )
    inserted_notes = await apply_interview_notes(session, merged_notes, label=label)
    # L6 흐름 → L5 연계 캔버스. 맵이 다 만들어진 뒤에만 노드를 걸 수 있어 순서가 고정된다.
    linked_count = await apply_interview_linkage(
        session, merged_linkages, actor=login_id, report=report
    )

    if payload.apply:
        await session.commit()
    else:
        await session.rollback()

    # rows 정렬·캡·warning 카운트는 기존 /import 규칙 그대로 (categories.py import_framework_delivery)
    priority = [r for r in report.rows if r[1] in ("error", "warning")]
    rest = [r for r in report.rows if r[1] not in ("error", "warning")]
    ordered = priority + rest
    summary = report.counts()
    summary["warning"] = sum(1 for r in report.rows if r[1] == "warning")
    summary["notes"] = inserted_notes
    summary["linkage"] = linked_count

    return InterviewImportOut(
        applied=payload.apply,
        files=files_out,
        summary=summary,
        rows=[FrameworkImportRow(code=c, action=a, detail=d) for c, a, d in ordered[:500]],
        truncated=len(ordered) > 500,
    )


@router.get("/{category_id}/chain", response_model=list[CategoryNodeOut])
async def get_category_chain(
    category_id: int,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[CategoryNodeOut]:
    """조상 체인 루트→자신 순 — 프론트 캐스케이드 셀렉트가 기존 연결 카테고리로 시딩할 때 사용
    (fix round 1 #2). map_count는 이 응답의 소비처(시딩)에 불필요해 0 고정 — /nodes가 진실.
    """
    rows = (
        await session.execute(
            select(
                ProcessCategory.id,
                ProcessCategory.parent_id,
                ProcessCategory.code,
                ProcessCategory.name,
                ProcessCategory.level,
                ProcessCategory.sort_order,
                ProcessCategory.linkage_map_id,
            )
        )
    ).all()
    by_id = {row.id: row for row in rows}
    if category_id not in by_id:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    children_by_parent: dict[int | None, list] = {}
    for row in rows:
        children_by_parent.setdefault(row.parent_id, []).append(row)

    chain = []
    cursor: int | None = category_id
    while cursor is not None:
        row = by_id[cursor]
        chain.append(row)
        cursor = row.parent_id
    chain.reverse()

    admin_ids = await _admin_category_ids(session, user)
    return [
        CategoryNodeOut(
            id=r.id,
            code=r.code,
            name=r.name,
            level=r.level,
            sort_order=r.sort_order,
            child_count=len(children_by_parent.get(r.id, [])),
            map_count=0,
            linkage_map_id=r.linkage_map_id,
            can_edit_linkage=r.id in admin_ids,
        )
        for r in chain
    ]


@router.get("/{category_id}/maps", response_model=CategoryMapsOut)
async def list_category_maps(
    category_id: int,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> CategoryMapsOut:
    """이 노드에 직접 연결된(서브트리 아님) 맵 페이지.

    계약: total=비삭제 직접연결 맵 전체 수, hidden=그중 호출자가 열람 불가한 수(페이지 무관, 전체
    기준으로 안정) — 즉 가시성 필터를 먼저 전체 집합에 적용한 뒤에만 offset/limit을 슬라이스한다.
    그러지 않으면 비가시 맵만 있는 페이지가 total>0인데도 maps=[]로 창을 통째로 잃는다(직접연결
    맵은 카테고리당 소량 — 서브트리가 아니라 fetch-all 금지 제약과 무관).
    """
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")

    all_maps = list(
        (
            await session.scalars(
                select(ProcessMap)
                .where(ProcessMap.category_id == category_id, ProcessMap.deleted_at.is_(None))
                .order_by(ProcessMap.updated_at.desc())
            )
        ).all()
    )
    total = len(all_maps)
    visible, hidden = await _split_visible_maps(session, user, all_maps)
    page = visible[offset : offset + limit]
    await _apply_card_metrics(session, page)
    # 페이지 내 맵은 전부 이 카테고리 하나에 연결돼 있으므로 조회는 1회로 충분 (maps.py 패턴과 동일).
    category_paths = build_category_paths(
        (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.name)
            )
        ).all()
    )
    path = category_paths.get(category_id)
    for m in page:
        m.category_path = path
    return CategoryMapsOut(
        total=total, hidden=hidden, maps=[MapOut.model_validate(m) for m in page]
    )


async def _category_metrics(session: AsyncSession, category_id: int) -> tuple[int, int]:
    """child_count(직계 자식 수)·map_count(서브트리 합산, 자기 포함) 재조회 — PATCH 응답용.

    list_category_nodes와 동일 집계 로직이나 갱신 직후 재조회가 필요해 별도로 둔다.
    """
    rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level)
        )
    ).all()
    child_count = sum(1 for r in rows if r.parent_id == category_id)
    own_map_count = dict(
        (
            await session.execute(
                select(ProcessMap.category_id, func.count())
                .where(ProcessMap.deleted_at.is_(None), ProcessMap.category_id.is_not(None))
                .group_by(ProcessMap.category_id)
            )
        ).all()
    )
    subtree_count: dict[int, int] = {r.id: own_map_count.get(r.id, 0) for r in rows}
    for r in sorted(rows, key=lambda x: -x.level):
        if r.parent_id is not None:
            subtree_count[r.parent_id] = subtree_count.get(r.parent_id, 0) + subtree_count[r.id]
    return child_count, subtree_count.get(category_id, 0)


@router.post("", response_model=CategoryNodeOut, status_code=201)
async def create_category(
    payload: CategoryCreateIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoryNodeOut:
    """카테고리 생성 — parent_id 지정 시 level=parent+1(무부모=1), code 미지정 시 `ui-` 접두 자동채번.

    위임 게이트(design 트랙 C §7): 생성은 서브트리 전체(seed 자신 포함) 허용 — parent_id가
    관리자의 admin_ids 안이면 OK. 루트 생성(parent_id=None)은 sysadmin 전용 유지.
    """
    if not logic.is_sysadmin(user):
        admin_ids, _seeds = await get_admin_scope(session, user)
        if payload.parent_id is None or payload.parent_id not in admin_ids:
            raise HTTPException(status_code=403, detail="outside your delegated subtree")

    level = 1
    if payload.parent_id is not None:
        parent = await session.get(ProcessCategory, payload.parent_id)
        if parent is None:
            raise HTTPException(
                status_code=404, detail=f"category {payload.parent_id} not found"
            )
        level = parent.level + 1
    if level > MAX_CATEGORY_LEVEL:
        raise HTTPException(status_code=422, detail="max depth is 5")

    code = payload.code
    if code is not None:
        dup = await session.scalar(select(ProcessCategory.id).where(ProcessCategory.code == code))
        if dup is not None:
            raise HTTPException(status_code=409, detail=f"code '{code}' already exists")
    else:
        # UI 생성 코드 네임스페이스 — 충돌 시(희박) 재생성 루프
        while True:
            candidate = f"ui-{uuid4().hex[:8]}"
            dup = await session.scalar(
                select(ProcessCategory.id).where(ProcessCategory.code == candidate)
            )
            if dup is None:
                code = candidate
                break

    max_sort = await session.scalar(
        select(func.max(ProcessCategory.sort_order)).where(
            ProcessCategory.parent_id == payload.parent_id
        )
    )
    sort_order = (max_sort + 1) if max_sort is not None else 0

    category = ProcessCategory(
        code=code, name=payload.name, level=level, parent_id=payload.parent_id,
        sort_order=sort_order,
    )
    session.add(category)
    await session.commit()
    await session.refresh(category)
    return CategoryNodeOut(
        id=category.id, code=category.code, name=category.name, level=category.level,
        sort_order=category.sort_order, child_count=0, map_count=0,
    )


@router.patch("/{category_id}", response_model=CategoryNodeOut)
async def update_category(
    category_id: int,
    payload: CategoryUpdateIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoryNodeOut:
    """이름·정렬 갱신 + 이동(서브트리 level 재계산). parent_id는 fields_set으로 미전송/null 구분.

    위임 게이트(design 트랙 C §7): 개명·정렬은 서브트리 전체(seed 자신 포함) 허용 — category_id가
    admin_ids 안이면 OK. 이동(parent_id가 실제로 변경될 때만)은 seed 자신 금지 + 새 부모도
    admin_ids 안이어야 함. **예외**: seed가 전부 L5인 관리자는 구조 변경(PATCH 전체) 불가
    (spec §7 — L5 관리자는 카테고리 구조를 못 건드림). seeds에 L1~L4가 하나라도 섞여 있으면
    그 서브트리 자격으로 기존 동작 유지(final review Finding 1).
    """
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")

    is_sysadmin = logic.is_sysadmin(user)
    admin_ids: set[int] = set()
    seeds: dict[int, int] = {}
    if not is_sysadmin:
        admin_ids, seeds = await get_admin_scope(session, user)
        if seeds and all(level == 5 for level in seeds.values()):
            raise HTTPException(
                status_code=403, detail="L5 admins cannot modify category structure"
            )
        if category_id not in admin_ids:
            raise HTTPException(status_code=403, detail="outside your delegated subtree")

    if payload.name is not None:
        category.name = payload.name
        # 캔버스 이름 동기 — 생성 시 자동 명명("{이름} 연계")과 동일 규칙 (design 2026-08-28 §9)
        if category.linkage_map_id is not None:
            canvas = await session.get(ProcessMap, category.linkage_map_id)
            if canvas is not None and canvas.deleted_at is None:
                canvas.name = await unique_linkage_name(
                    session, category, exclude_map_id=canvas.id
                )

    moved = False
    if "parent_id" in payload.model_fields_set:
        new_parent_id = payload.parent_id  # None=루트로 이동
        wants_move = new_parent_id != category.parent_id
        if not is_sysadmin and wants_move:
            if category_id in seeds:
                raise HTTPException(
                    status_code=403, detail="cannot move a delegated seed category"
                )
            if new_parent_id not in admin_ids:
                raise HTTPException(status_code=403, detail="outside your delegated subtree")
        rows = (
            await session.execute(
                select(ProcessCategory.id, ProcessCategory.parent_id, ProcessCategory.level)
            )
        ).all()
        by_id = {r.id: r for r in rows}
        if new_parent_id is not None and new_parent_id not in by_id:
            raise HTTPException(
                status_code=404, detail=f"category {new_parent_id} not found"
            )

        children_by_parent: dict[int | None, list[int]] = {}
        for r in rows:
            children_by_parent.setdefault(r.parent_id, []).append(r.id)

        # 자손 집합 + 서브트리 높이 — 한 번의 BFS로 함께 산정(자기자신 이동 가드·깊이 가드 공용).
        # descendants에 이미 담긴 id는 다음 frontier에서 제외 — (동시성으로 생긴) 부모 사이클이
        # 있어도 매 depth마다 같은 노드를 무한히 재방문하지 않는다(cycle guard).
        descendants: set[int] = set()
        subtree_height = 0
        frontier = children_by_parent.get(category_id, [])
        depth = 1
        while frontier:
            descendants.update(frontier)
            subtree_height = depth
            frontier = [
                nid
                for n in frontier
                for nid in children_by_parent.get(n, [])
                if nid not in descendants
            ]
            depth += 1

        if new_parent_id is not None and (
            new_parent_id == category_id or new_parent_id in descendants
        ):
            raise HTTPException(status_code=422, detail="cannot move under own subtree")

        new_level = by_id[new_parent_id].level + 1 if new_parent_id is not None else 1
        if new_level + subtree_height > MAX_CATEGORY_LEVEL:
            # 안내 명확화 — 어느 레벨까지 가능한지 명시(모달이 이 detail을 인라인 표시)
            max_parent_level = MAX_CATEGORY_LEVEL - subtree_height - 1
            raise HTTPException(
                status_code=422,
                detail=(
                    f"max depth is {MAX_CATEGORY_LEVEL}: this category spans "
                    f"{subtree_height + 1} level(s), so the new parent must be "
                    f"level {max_parent_level} or above"
                ),
            )

        # 서브트리 전체 level 재계산 — BFS로 부모 level+1 전파. level_by_id에 이미 있는 id는
        # 스킵(cycle guard) — 부모 사이클이 있으면 안 그럴 시 같은 id가 계속 frontier에 다시
        # 실려 워커를 무한 루프에 빠뜨린다.
        level_by_id: dict[int, int] = {category_id: new_level}
        frontier = children_by_parent.get(category_id, [])
        while frontier:
            next_frontier: list[int] = []
            for nid in frontier:
                if nid in level_by_id:
                    continue
                level_by_id[nid] = level_by_id[by_id[nid].parent_id] + 1
                next_frontier.extend(children_by_parent.get(nid, []))
            frontier = next_frontier
        subtree_rows = (
            await session.scalars(
                select(ProcessCategory).where(ProcessCategory.id.in_(level_by_id.keys()))
            )
        ).all()
        for row_obj in subtree_rows:
            row_obj.level = level_by_id[row_obj.id]

        category.parent_id = new_parent_id
        moved = True

    if moved and payload.sort_order is None:
        # 이동 시 sort_order 미지정이면 새 형제 맨 뒤로 — 명시 전송값은 아래에서 덮어씀
        max_sort = await session.scalar(
            select(func.max(ProcessCategory.sort_order)).where(
                ProcessCategory.parent_id == category.parent_id,
                ProcessCategory.id != category_id,
            )
        )
        category.sort_order = (max_sort + 1) if max_sort is not None else 0
    if payload.sort_order is not None:
        category.sort_order = payload.sort_order

    await session.commit()
    await session.refresh(category)

    child_count, map_count = await _category_metrics(session, category_id)
    return CategoryNodeOut(
        id=category.id, code=category.code, name=category.name, level=category.level,
        sort_order=category.sort_order, child_count=child_count, map_count=map_count,
    )


@router.delete("/{category_id}", status_code=204)
async def delete_category(
    category_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """서브트리 묶음 삭제 — 서브트리 어디든 연결 맵(소프트삭제 포함)이 1개라도 있으면 409,
    없으면 하위 카테고리까지 통째로 삭제(2026-08-12 정책: 빈 하위는 개별 정리 없이 묶음 처리).

    위임 게이트(design 트랙 C §7): 삭제는 seed 자신 금지 — 하위(서브트리 내 non-seed)는 허용.
    """
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")

    if not logic.is_sysadmin(user):
        admin_ids, seeds = await get_admin_scope(session, user)
        if category_id not in admin_ids:
            raise HTTPException(status_code=403, detail="outside your delegated subtree")
        if category_id in seeds:
            raise HTTPException(
                status_code=403, detail="cannot delete a delegated seed category"
            )

    # 서브트리 수집(자기 포함) — BFS, visited 가드로 (동시성) 부모 사이클에도 종료 보장.
    rows = (
        await session.execute(select(ProcessCategory.id, ProcessCategory.parent_id))
    ).all()
    children_by_parent: dict[int | None, list[int]] = {}
    for r in rows:
        children_by_parent.setdefault(r.parent_id, []).append(r.id)
    subtree_ids: set[int] = {category_id}
    frontier = children_by_parent.get(category_id, [])
    while frontier:
        subtree_ids.update(frontier)
        frontier = [
            nid
            for n in frontier
            for nid in children_by_parent.get(n, [])
            if nid not in subtree_ids
        ]

    map_count = await session.scalar(
        select(func.count())
        .select_from(ProcessMap)
        .where(ProcessMap.category_id.in_(subtree_ids))
    )
    if map_count:
        raise HTTPException(
            status_code=409, detail=f"{map_count} maps are linked in this subtree"
        )

    # 연계 캔버스도 맵과 동일 취급 — 서브트리에 캔버스가 남아 있으면 삭제 불가 (design 2026-08-28 §9)
    canvas_count = await session.scalar(
        select(func.count())
        .select_from(ProcessCategory)
        .where(ProcessCategory.id.in_(subtree_ids), ProcessCategory.linkage_map_id.is_not(None))
    )
    if canvas_count:
        raise HTTPException(
            status_code=409,
            detail=f"{canvas_count} linkage canvases exist in this subtree",
        )

    # 자식부터 명시적 벌크 DELETE(레벨 역순 배치) — ORM 개별 delete는 플러시 순서가 보장되지
    # 않아 부모가 자식보다 먼저 지워질 수 있고, 자기참조 FK를 즉시 강제하는 Postgres에서
    # IntegrityError(500)가 났다(sqlite는 FK 미강제라 로컬·테스트에선 재현 안 됨 — 9910 실측).
    level_rows = (
        await session.execute(
            select(ProcessCategory.id, ProcessCategory.level).where(
                ProcessCategory.id.in_(subtree_ids)
            )
        )
    ).all()
    ids_by_level: dict[int, list[int]] = {}
    for cid, lvl in level_rows:
        ids_by_level.setdefault(lvl, []).append(cid)
    for lvl in sorted(ids_by_level, reverse=True):
        await session.execute(
            delete(ProcessCategory).where(ProcessCategory.id.in_(ids_by_level[lvl]))
        )
    await session.commit()


async def _load_category_permissions(
    session: AsyncSession, category_id: int
) -> CategoryPermissionsOut:
    rows = (
        await session.execute(
            select(CategoryPermission.principal_type, CategoryPermission.principal_id)
            .where(CategoryPermission.category_id == category_id)
            .order_by(CategoryPermission.id)
        )
    ).all()
    return CategoryPermissionsOut(
        permissions=[CategoryPermissionEntry(principal_type=t, principal_id=p) for t, p in rows]
    )


@router.post("/{category_id}/linkage-map", response_model=LinkageMapOut)
async def open_linkage_map(
    category_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> LinkageMapOut:
    """연계 캔버스 멱등 열기 — 없으면 생성+소속 L6 시드, 있으면 부족분 자동 보강 (design 2026-08-28 §5).

    보강은 권한자이면서 체크아웃이 비었거나 본인일 때만 — 타인 편집 중 서버가 draft를
    건드리지 않는다(체크아웃 규약과 일관). 뷰어는 missing_count만 받는다.
    """
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    if category.level != 5:
        raise HTTPException(status_code=422, detail="linkage canvas exists only at level 5")

    is_admin = logic.is_sysadmin(user) or await is_category_admin(session, user, category_id)
    contained_rows = (
        await session.execute(
            select(ProcessMap.id, ProcessMap.name)
            .where(ProcessMap.category_id == category_id, ProcessMap.deleted_at.is_(None))
            .order_by(ProcessMap.name)
        )
    ).all()

    canvas = (
        await session.get(ProcessMap, category.linkage_map_id)
        if category.linkage_map_id is not None
        else None
    )
    if canvas is None or canvas.deleted_at is not None:
        # 생성 — 권한자만. 소프트삭제/영구삭제된 캔버스는 새로 만든다(포인터 덮어씀).
        if not is_admin:
            raise HTTPException(status_code=404, detail="no linkage canvas for this category")
        canvas = ProcessMap(
            name=await unique_linkage_name(session, category),
            created_by=user, owner_id=user, visibility="public", mode="framework",
        )
        canvas.versions.append(MapVersion(label="Linkage"))
        session.add(canvas)
        await session.flush()
        version_id = canvas.versions[0].id
        for i, ((map_id, map_name), (px, py)) in enumerate(
            zip(contained_rows, grid_positions(0, len(contained_rows), LINKAGE_Y0))
        ):
            session.add(
                Node(id=uuid4().hex, version_id=version_id, title=map_name,
                     node_type="subprocess", linked_map_id=map_id, follow_latest=True,
                     pos_x=px, pos_y=py, sort_order=i)
            )
        record_version_event(session, version_id, "created", user)
        category.linkage_map_id = canvas.id
        await session.commit()
        return LinkageMapOut(map_id=canvas.id, added_count=len(contained_rows), missing_count=0)

    # 기존 캔버스 — draft(라이브)에서 부족분 보강
    draft = await session.scalar(
        select(MapVersion)
        .where(MapVersion.map_id == canvas.id, MapVersion.status == "draft")
        .order_by(MapVersion.id.desc())
    )
    if draft is None:  # 방어 — 라이브 draft는 생성 시 항상 만들어진다
        raise HTTPException(status_code=409, detail="linkage canvas has no draft version")
    missing_ids = set(await find_missing_l6_ids(session, category_id, draft))
    missing = [(mid, name) for mid, name in contained_rows if mid in missing_ids]
    can_append = is_admin and (draft.checked_out_by is None or draft.checked_out_by == user)
    if not missing or not can_append:
        return LinkageMapOut(map_id=canvas.id, added_count=0, missing_count=len(missing))

    max_y, max_sort, node_count = (
        await session.execute(
            select(func.max(Node.pos_y), func.max(Node.sort_order), func.count())
            .where(Node.version_id == draft.id)
        )
    ).one()
    base_y = (max_y + LINKAGE_Y_STEP) if node_count else LINKAGE_Y0
    next_sort = (max_sort + 1) if node_count else 0
    for i, ((map_id, map_name), (px, py)) in enumerate(
        zip(missing, grid_positions(0, len(missing), base_y))
    ):
        session.add(
            Node(id=uuid4().hex, version_id=draft.id, title=map_name,
                 node_type="subprocess", linked_map_id=map_id, follow_latest=True,
                 pos_x=px, pos_y=py, sort_order=next_sort + i)
        )
    await session.commit()
    return LinkageMapOut(map_id=canvas.id, added_count=len(missing), missing_count=0)


async def _assert_can_manage_appointments(
    session: AsyncSession, user: str, category: ProcessCategory
) -> None:
    """임명(perms GET·PUT) 위임 게이트 — 서브트리 내 + 대상 level > min(관리자 seed levels).

    구현 단순화(브리프 지시): 다중 seed 케이스에서 최상위(최소 level) seed 기준으로 판정 —
    가장 관대하지만 §7 의도(하위 레벨만 임명 가능)에 부합한다.
    """
    if logic.is_sysadmin(user):
        return
    admin_ids, seeds = await get_admin_scope(session, user)
    if category.id not in admin_ids:
        raise HTTPException(status_code=403, detail="outside your delegated subtree")
    if category.level <= min(seeds.values()):
        raise HTTPException(
            status_code=403, detail="can only manage lower-level categories"
        )


@router.get("/{category_id}/permissions", response_model=CategoryPermissionsOut)
async def list_category_permissions(
    category_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoryPermissionsOut:
    """카테고리 권한자 목록 — sysadmin 또는 상위 위임 관리자 (설정 Framework 탭 관리 화면)."""
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    await _assert_can_manage_appointments(session, user, category)
    return await _load_category_permissions(session, category_id)


@router.put("/{category_id}/permissions", response_model=CategoryPermissionsOut)
async def set_category_permissions(
    category_id: int,
    payload: CategoryPermissionsIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> CategoryPermissionsOut:
    """권한자 전체 교체 — 멱등 PUT(setApprovers 선례). 중복 항목은 1개로 접는다."""
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")
    await _assert_can_manage_appointments(session, user, category)
    await session.execute(
        delete(CategoryPermission).where(CategoryPermission.category_id == category_id)
    )
    seen: set[tuple[str, str]] = set()
    for entry in payload.permissions:
        key = (entry.principal_type, entry.principal_id)
        if key in seen:
            continue
        seen.add(key)
        session.add(
            CategoryPermission(
                category_id=category_id, principal_type=entry.principal_type,
                principal_id=entry.principal_id, granted_by=user,
            )
        )
    await session.commit()
    return await _load_category_permissions(session, category_id)
