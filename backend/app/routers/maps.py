"""Process map CRUD endpoints (docs/spec.md §3.5)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.db import get_session
from app.models import Employee, MapApprover, MapPermission, MapVersion, ProcessMap
from app.permissions import logic
from app.permissions.deps import require_map_role
from app.schemas import MapCreate, MapDetailOut, MapOut, MapUpdate

router = APIRouter(
    prefix="/api/maps", tags=["maps"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[MapOut])
async def list_maps(
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> list[ProcessMap]:
    # 가시성 필터 — 사용자 권한/승인자/부서를 한 번씩만 로드해 맵별 effective_role을
    # 메모리에서 계산(N+1 회피). role이 None(접근 불가)인 맵은 제외.
    maps = list(
        (
            await session.scalars(
                select(ProcessMap).order_by(ProcessMap.updated_at.desc())
            )
        ).all()
    )
    is_admin = logic.is_sysadmin(user)
    if is_admin:
        return maps  # sysadmin → 전 맵 owner, 필터 불필요(쿼리도 생략)

    emp = await session.get(Employee, user)
    emp_org_path = (
        logic.org_path(emp.org_l1, emp.org_l2, emp.org_l3, emp.org_l4, emp.org_l5, emp.department)
        if emp is not None
        else ""
    )
    # 사용자에게 걸린 권한 행 전체(맵별로 묶어 메모리 판정)
    perm_rows = (
        await session.execute(
            select(
                MapPermission.map_id,
                MapPermission.principal_type,
                MapPermission.principal_id,
                MapPermission.role,
            )
        )
    ).all()
    perms_by_map: dict[int, list[logic.Permission]] = {}
    for mid, ptype, pid, role in perm_rows:
        perms_by_map.setdefault(mid, []).append((ptype, pid, role))
    approver_map_ids = set(
        (
            await session.scalars(
                select(MapApprover.map_id).where(MapApprover.user_id == user)
            )
        ).all()
    )

    return [
        m
        for m in maps
        if logic.is_visible(
            user,
            False,  # is_admin True는 위에서 조기 반환
            emp_org_path,
            m.visibility,
            perms_by_map.get(m.id, []),
            m.id in approver_map_ids,
        )
    ]


@router.post("", response_model=MapDetailOut, status_code=201)
async def create_map(
    payload: MapCreate,
    session: AsyncSession = Depends(get_session),
    user: str = Depends(get_current_user),
) -> ProcessMap:
    # 맵 생성 시 기본 버전(As-Is) 1개를 함께 만든다 — 캔버스는 버전에 귀속 (spec §1)
    new_map = ProcessMap(
        name=payload.name,
        description=payload.description,
        created_by=user,
        owner_id=user,
        visibility="private",
    )
    new_map.versions.append(MapVersion(label="As-Is"))
    session.add(new_map)
    await session.flush()
    # 생성자에게 owner 권한 행 부여 — enforcement ON에서 본인 맵 잠금 방지 (brief §C)
    session.add(
        MapPermission(
            map_id=new_map.id,
            principal_type="user",
            principal_id=user,
            role="owner",
            granted_by=user,
        )
    )
    await session.commit()
    await session.refresh(new_map, attribute_names=["versions"])
    return new_map


@router.get(
    "/{map_id}",
    response_model=MapDetailOut,
    dependencies=[Depends(require_map_role("viewer"))],
)
async def get_map(
    map_id: int, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    found_map = await session.get(
        ProcessMap, map_id, options=[selectinload(ProcessMap.versions)]
    )
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    return found_map


@router.patch(
    "/{map_id}",
    response_model=MapOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def update_map(
    map_id: int, payload: MapUpdate, session: AsyncSession = Depends(get_session)
) -> ProcessMap:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    if payload.name is not None:
        found_map.name = payload.name
    if payload.description is not None:
        found_map.description = payload.description
    await session.commit()
    await session.refresh(found_map)
    return found_map


@router.delete(
    "/{map_id}",
    status_code=204,
    dependencies=[Depends(require_map_role("owner"))],
)
async def delete_map(map_id: int, session: AsyncSession = Depends(get_session)) -> None:
    found_map = await session.get(ProcessMap, map_id)
    if found_map is None:
        raise HTTPException(status_code=404, detail=f"map {map_id} not found")
    await session.delete(found_map)
    await session.commit()
