"""고아 참조 감사 데모·스모크 시드 — 소멸 부서 경로·리프, 퇴직자, 노드/SP 낡은 값.

실행 (backend/ 에서, reset_db 종합 시드 위에):
    bash:       .venv/bin/python -m scripts.seed_ref_audit_demo
    PowerShell: .venv\\Scripts\\python -m scripts.seed_ref_audit_demo

멱등: 같은 이름 데모 맵·그룹·직원이 있으면 지우고 다시 만든다. 오너는 admin.sys(reset_db 시드).
"""

import asyncio

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.models import (
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
from app.orgchart import load_dept_index, resolve_org_path

OWNER = "admin.sys"
GONE_USER = "gone.user"
GONE_PATH = "Old Division/Old Office/Old Team"
GONE_LEAF = "Old Team"
MAP_NODES = "Ref demo - stale node refs"
MAP_OWNER = "Ref demo - departed owner"
GROUP = "Ref demo group"


async def _purge(session) -> None:
    maps = (await session.scalars(select(ProcessMap).where(ProcessMap.name.in_([MAP_NODES, MAP_OWNER])))).all()
    for m in maps:
        vids = list((await session.scalars(select(MapVersion.id).where(MapVersion.map_id == m.id))).all())
        if vids:
            await session.execute(delete(Node).where(Node.version_id.in_(vids)))
            await session.execute(delete(MapVersion).where(MapVersion.id.in_(vids)))
        await session.execute(delete(MapPermission).where(MapPermission.map_id == m.id))
        await session.execute(delete(MapApprover).where(MapApprover.map_id == m.id))
        await session.delete(m)
    groups = (await session.scalars(select(UserGroup).where(UserGroup.name == GROUP))).all()
    for g in groups:
        await session.execute(delete(UserGroupMember).where(UserGroupMember.group_id == g.id))
        await session.delete(g)
    await session.flush()


async def seed(session) -> dict:
    await _purge(session)
    owner = await session.get(Employee, OWNER)
    if owner is None:
        raise SystemExit("run scripts.reset_db first - admin.sys missing")
    live_path = resolve_org_path(owner, await load_dept_index(session))
    if await session.get(Employee, GONE_USER) is None:
        session.add(Employee(login_id=GONE_USER, name="Gone Person", source="local", active=False,
                             org_l1="Old Division", org_l2="Old Office", org_l3="Old Team", department=GONE_LEAF))

    nodes_map = ProcessMap(name=MAP_NODES, visibility="public", created_by=OWNER, owner_id=OWNER,
                           owning_department=GONE_PATH, sp_department=GONE_LEAF,
                           sp_assignee="Gone Person", description="ref-audit demo")
    owner_map = ProcessMap(name=MAP_OWNER, visibility="private", created_by=GONE_USER, owner_id=GONE_USER,
                           owning_department=live_path, description="ref-audit demo")
    group = UserGroup(name=GROUP, status="active", created_by=OWNER)
    session.add_all([nodes_map, owner_map, group])
    await session.flush()
    session.add_all([
        MapPermission(map_id=nodes_map.id, principal_type="user", principal_id=OWNER, role="owner", granted_by=OWNER),
        MapPermission(map_id=nodes_map.id, principal_type="department", principal_id=GONE_PATH, role="viewer", granted_by=OWNER),
        MapPermission(map_id=owner_map.id, principal_type="user", principal_id=GONE_USER, role="owner", granted_by=GONE_USER),
        MapApprover(map_id=owner_map.id, user_id=GONE_USER),
        UserGroupMember(group_id=group.id, member_type="department", member_id=GONE_PATH),
        UserGroupMember(group_id=group.id, member_type="user", member_id=GONE_USER),
    ])
    published = MapVersion(map_id=nodes_map.id, label="As-Is", status="published", version_number=1)
    draft = MapVersion(map_id=nodes_map.id, label="To-Be", status="draft")
    session.add_all([published, draft])
    await session.flush()
    for version, prefix in ((published, "p"), (draft, "d")):
        session.add_all([
            Node(id=f"{prefix}-start", version_id=version.id, title="Start", node_type="start"),
            Node(id=f"{prefix}-a", version_id=version.id, title="Check request", department=GONE_LEAF,
                 assignee="Gone Person"),
            Node(id=f"{prefix}-b", version_id=version.id, title="Approve", department=GONE_LEAF),
        ])
    await session.commit()
    return {"nodes_map": nodes_map.id, "owner_map": owner_map.id, "group": group.id, "live_path": live_path}


async def main() -> None:
    async with SessionLocal() as session:
        print(await seed(session))


if __name__ == "__main__":
    asyncio.run(main())
