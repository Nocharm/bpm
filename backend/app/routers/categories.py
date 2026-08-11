"""컨설턴트 체계 카테고리 트리 — lazy 자식 조회 + 카테고리별 맵 페이지네이션 (design 2026-08-08)."""

from collections.abc import Sequence
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import (
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.orgchart import load_dept_index, resolve_org_path
from app.permissions import logic
from app.permissions.access import get_user_active_group_ids
from app.schemas import (
    CategoryCreateIn,
    CategoryMapsOut,
    CategoryNodeOut,
    CategoryUpdateIn,
    MapOut,
)

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

    def _path(cid: int) -> str:
        if cid in cache:
            return cache[cid]
        _, parent_id, name = by_id[cid]
        path = f"{_path(parent_id)}/{name}" if parent_id in by_id else name
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


@router.get("/nodes", response_model=list[CategoryNodeOut])
async def list_category_nodes(
    parent_id: int | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
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
    # 서브트리 합산 — 레벨 역순(깊은 노드 먼저)으로 부모에 누적하면 한 번의 순회로 끝난다.
    subtree_count: dict[int, int] = {row.id: own_map_count.get(row.id, 0) for row in rows}
    for row in sorted(rows, key=lambda r: -r.level):
        if row.parent_id is not None:
            subtree_count[row.parent_id] = subtree_count.get(row.parent_id, 0) + subtree_count[row.id]

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
        )
        for r in targets
    ]


@router.get("/{category_id}/chain", response_model=list[CategoryNodeOut])
async def get_category_chain(
    category_id: int,
    session: AsyncSession = Depends(get_session),
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

    return [
        CategoryNodeOut(
            id=r.id,
            code=r.code,
            name=r.name,
            level=r.level,
            sort_order=r.sort_order,
            child_count=len(children_by_parent.get(r.id, [])),
            map_count=0,
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
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> CategoryNodeOut:
    """카테고리 생성 — parent_id 지정 시 level=parent+1(무부모=1), code 미지정 시 `ui-` 접두 자동채번."""
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
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> CategoryNodeOut:
    """이름·정렬 갱신 + 이동(서브트리 level 재계산). parent_id는 fields_set으로 미전송/null 구분."""
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")

    if payload.name is not None:
        category.name = payload.name

    moved = False
    if "parent_id" in payload.model_fields_set:
        new_parent_id = payload.parent_id  # None=루트로 이동
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

        # 자손 집합 + 서브트리 높이 — 한 번의 BFS로 함께 산정(자기자신 이동 가드·깊이 가드 공용)
        descendants: set[int] = set()
        subtree_height = 0
        frontier = children_by_parent.get(category_id, [])
        depth = 1
        while frontier:
            descendants.update(frontier)
            subtree_height = depth
            frontier = [nid for n in frontier for nid in children_by_parent.get(n, [])]
            depth += 1

        if new_parent_id is not None and (
            new_parent_id == category_id or new_parent_id in descendants
        ):
            raise HTTPException(status_code=422, detail="cannot move under own subtree")

        new_level = by_id[new_parent_id].level + 1 if new_parent_id is not None else 1
        if new_level + subtree_height > MAX_CATEGORY_LEVEL:
            raise HTTPException(status_code=422, detail="max depth is 5")

        # 서브트리 전체 level 재계산 — BFS로 부모 level+1 전파
        level_by_id: dict[int, int] = {category_id: new_level}
        frontier = children_by_parent.get(category_id, [])
        while frontier:
            next_frontier: list[int] = []
            for nid in frontier:
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
    login_id: str = Depends(require_sysadmin),
    session: AsyncSession = Depends(get_session),
) -> None:
    """빈 카테고리만 삭제 가능 — 자식 보유 409, 연결 맵(소프트삭제 포함) 존재 409."""
    category = await session.get(ProcessCategory, category_id)
    if category is None:
        raise HTTPException(status_code=404, detail=f"category {category_id} not found")

    child_count = await session.scalar(
        select(func.count())
        .select_from(ProcessCategory)
        .where(ProcessCategory.parent_id == category_id)
    )
    if child_count:
        raise HTTPException(status_code=409, detail=f"has {child_count} child categories")

    map_count = await session.scalar(
        select(func.count()).select_from(ProcessMap).where(ProcessMap.category_id == category_id)
    )
    if map_count:
        raise HTTPException(status_code=409, detail=f"{map_count} maps are linked")

    await session.delete(category)
    await session.commit()
