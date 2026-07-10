"""종합 데모 시드 — 조직도(센터/담당/팀/파트) + 직원 ~400명 + 그룹 6 + 맵 12(버전 워크플로).

reset_db가 이 단일 시드로 DB를 새로 채운다(기존 분산 데모 대체). RNG seed 고정으로 재현성 확보.
조직 리프 깊이 혼합 — 파트가 리프 / 팀이 리프(파트 없음) / 담당이 리프(팀 없음) 3종.
맵마다 v1~v5 게시(정상 워크플로: 생성→제출→승인→게시, v1~4 만료·v5 게시) + 최상위 작업본
(대부분 draft, 일부 rejected). 일부 버전 이력에 반려·회수 케이스 삽입.
"""

import random
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.clock import now as now_kst
from app.models import (
    Edge,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
    UserGroup,
    UserGroupMember,
    VersionApproval,
    VersionEvent,
)

RNG = random.Random(42)

# center → { dept → { team → [parts] } } | { team: [] }(팀 리프) | None(담당 리프)
ORG_TREE: dict = {
    "Growth Center": {
        "Strategy Office": {
            "Planning Team": ["Planning Part 1", "Planning Part 2"],
            "Analytics Team": ["Analytics Part 1"],
            "Insights Team": [],
        },
        "Marketing Office": {
            "Brand Team": ["Brand Part 1", "Brand Part 2", "Brand Part 3"],
            "Growth Team": [],
        },
    },
    "Operations Center": {
        "Delivery Office": {
            "Logistics Team": ["Logistics Part 1", "Logistics Part 2"],
            "Fulfillment Team": ["Fulfillment Part 1"],
            "Support Team": [],
        },
        "Facilities Office": None,
    },
}

SURNAMES = [
    "Kim", "Lee", "Park", "Choi", "Jung", "Kang", "Cho", "Yoon", "Jang", "Lim",
    "Han", "Oh", "Seo", "Shin", "Kwon", "Hwang", "Ahn", "Song", "Yoo", "Hong",
]
GIVEN = [
    "Junho", "Minjae", "Soyeon", "Daehyun", "Hana", "Jiwon", "Seojun", "Yuna",
    "Doyun", "Haeun", "Sion", "Nari", "Taeyang", "Bora", "Gunwoo", "Sujin",
    "Hyun", "Mina", "Jaewon", "Eunseo", "Woojin", "Jia", "Sanghyun", "Yerin",
]
TITLES = ["Manager", "Senior", "Associate", "Staff", "Lead"]

MAP_SPECS = [
    ("Order Fulfillment", "public"),
    ("Employee Onboarding", "private"),
    ("Incident Response", "public"),
    ("Procurement Flow", "private"),
    ("Payroll Cycle", "private"),
    ("Customer Support", "public"),
    ("Release Pipeline", "public"),
    ("Audit Workflow", "private"),
    ("Recruitment Process", "public"),
    ("Budget Approval", "private"),
    ("Data Pipeline", "public"),
    ("Vendor Management", "private"),
]

# 서브프로세스 지정 — 대표 업무 4종(맵 인덱스 → 시스템/소요시간). 부서는 오너 소속 리프.
# 나머지 맵은 의도적으로 미지정 → 피커 미노출·소비 노드 경고+잠금 시연 (spec 2026-07-06)
DESIGNATED_SPECS: dict[int, tuple[str, str]] = {
    0: ("SAP ERP", "3 days"),      # Order Fulfillment
    2: ("PagerDuty", "1 day"),     # Incident Response
    5: ("Zendesk", "2 days"),      # Customer Support
    6: ("Jenkins", "4 hours"),     # Release Pipeline
}


def _build_leaves() -> list[dict]:
    """조직 트리 → 리프 단위(직원 소속 최말단) 목록. 각 dict에 l1~l4·department."""
    leaves: list[dict] = []
    for center, depts in ORG_TREE.items():
        for dept, teams in depts.items():
            if teams is None:  # 담당 리프
                leaves.append({"l1": center, "l2": dept, "l3": None, "l4": None,
                               "department": dept})
                continue
            for team, parts in teams.items():
                if not parts:  # 팀 리프
                    leaves.append({"l1": center, "l2": dept, "l3": team, "l4": None,
                                   "department": team})
                    continue
                for part in parts:  # 파트 리프
                    leaves.append({"l1": center, "l2": dept, "l3": team, "l4": part,
                                   "department": part})
    return leaves


def _org_path(leaf: dict) -> str:
    return "/".join(v for v in (leaf["l1"], leaf["l2"], leaf["l3"], leaf["l4"]) if v)


def _flow(version_id: int, prefix: str) -> list:
    return [
        Node(id=f"{prefix}-s", version_id=version_id, title="Start", node_type="start",
             pos_x=80.0, pos_y=200.0, sort_order=0),
        Node(id=f"{prefix}-t", version_id=version_id, title="Process Request", node_type="task",
             pos_x=300.0, pos_y=200.0, sort_order=1),
        Node(id=f"{prefix}-e", version_id=version_id, title="End", node_type="end",
             pos_x=520.0, pos_y=200.0, sort_order=2, is_primary_end=True),
        Edge(id=f"{prefix}-e1", version_id=version_id, source_node_id=f"{prefix}-s",
             target_node_id=f"{prefix}-t", source_side="right", target_side="left"),
        Edge(id=f"{prefix}-e2", version_id=version_id, source_node_id=f"{prefix}-t",
             target_node_id=f"{prefix}-e", source_side="right", target_side="left"),
    ]


def _publish_events(
    session: AsyncSession, vid: int, owner: str, approvers: list[str], created,
    reject: bool = False, withdraw: bool = False,
) -> None:
    """게시본의 정상 워크플로 이벤트(+승인 이력) 생성. reject/withdraw면 이력에 삽입."""
    t = created
    session.add(VersionEvent(version_id=vid, event_type="created", actor=owner, created_at=t))
    t = t + timedelta(hours=1)
    session.add(VersionEvent(version_id=vid, event_type="submitted", actor=owner, created_at=t))
    if reject:
        t = t + timedelta(hours=1)
        session.add(VersionEvent(version_id=vid, event_type="rejected",
                                 actor=approvers[0], note="minor fix requested", created_at=t))
        t = t + timedelta(hours=2)
        session.add(VersionEvent(version_id=vid, event_type="submitted", actor=owner, created_at=t))
    if withdraw:
        t = t + timedelta(hours=1)
        session.add(VersionEvent(version_id=vid, event_type="withdrawn", actor=owner, created_at=t))
        t = t + timedelta(hours=2)
        session.add(VersionEvent(version_id=vid, event_type="submitted", actor=owner, created_at=t))
    for aid in approvers:
        session.add(VersionApproval(version_id=vid, approver=aid))
        t = t + timedelta(minutes=30)
        session.add(VersionEvent(version_id=vid, event_type="approved", actor=aid, created_at=t))
    t = t + timedelta(hours=1)
    session.add(VersionEvent(version_id=vid, event_type="published", actor=owner, created_at=t))


async def _seed_employees(session: AsyncSession, total: int = 400) -> list[dict]:
    """sysadmin 1명 + 직원 total명. 리프에 라운드로빈 분포. 반환=요약 리스트."""
    leaves = _build_leaves()
    used_ids: set[str] = set()
    people: list[dict] = []

    def _login(given: str, surname: str) -> str:
        base = f"{given.lower()}.{surname.lower()}"
        lid, n = base, 1
        while lid in used_ids:
            n += 1
            lid = f"{base}{n}"
        used_ids.add(lid)
        return lid

    admin_leaf = {"l1": "Management Center", "l2": "IT Office", "l3": "System Team",
                  "l4": None, "department": "System Team"}
    session.add(Employee(
        login_id="admin.sys", name="System Admin", title="Manager", source="local",
        role="admin", org_l1=admin_leaf["l1"], org_l2=admin_leaf["l2"],
        org_l3=admin_leaf["l3"], org_l4=None, department=admin_leaf["department"],
        active=True, email="admin.sys@corp",
    ))
    used_ids.add("admin.sys")
    people.append({"login_id": "admin.sys", "name": "System Admin", "role": "admin",
                   "leaf": admin_leaf, "path": _org_path(admin_leaf)})

    for i in range(total):
        leaf = leaves[i % len(leaves)]
        given, surname = RNG.choice(GIVEN), RNG.choice(SURNAMES)
        lid = _login(given, surname)
        name = f"{given} {surname}"
        session.add(Employee(
            login_id=lid, name=name, title=RNG.choice(TITLES), source="local",
            role="user", org_l1=leaf["l1"], org_l2=leaf["l2"], org_l3=leaf["l3"],
            org_l4=leaf["l4"], department=leaf["department"], active=True, email=f"{lid}@corp",
        ))
        people.append({"login_id": lid, "name": name, "role": "user", "leaf": leaf,
                       "path": _org_path(leaf)})
    await session.flush()
    return people


async def _seed_groups(session: AsyncSession, people: list[dict]) -> dict:
    """그룹 6 — 유저구성2·파트구성2·혼합2. 반환={'user':[...],'part':[...],'mixed':[...]}."""
    users = [p for p in people if p["role"] == "user"]
    part_paths = sorted({p["path"] for p in people if p["leaf"]["l4"]})
    specs: list[tuple[str, str, list[tuple[str, str]]]] = []
    for i in range(2):
        specs.append(("user", f"User Group {i + 1}",
                      [("user", p["login_id"]) for p in RNG.sample(users, 5)]))
    for i in range(2):
        specs.append(("part", f"Part Group {i + 1}",
                      [("department", pp) for pp in RNG.sample(part_paths, min(3, len(part_paths)))]))
    for i in range(2):
        members = ([("user", p["login_id"]) for p in RNG.sample(users, 3)]
                   + [("department", pp) for pp in RNG.sample(part_paths, min(2, len(part_paths)))])
        specs.append(("mixed", f"Mixed Group {i + 1}", members))

    result: dict = {"user": [], "part": [], "mixed": []}
    for kind, name, members in specs:
        g = UserGroup(name=name, description=f"Demo — {name}", status="active",
                      created_by="admin.sys")
        session.add(g)
        await session.flush()
        result[kind].append(g.id)
        for mtype, mid in members:
            session.add(UserGroupMember(group_id=g.id, member_type=mtype, member_id=mid))
    await session.flush()
    return result


async def _seed_versions(
    session: AsyncSession, map_id: int, owner: str, approvers: list[str], base, map_idx: int,
) -> None:
    for n in range(1, 6):
        status = workflow.PUBLISHED if n == 5 else workflow.EXPIRED
        created = base - timedelta(days=(6 - n) * 7)
        v = MapVersion(map_id=map_id, label=f"Release {n}", status=status,
                       version_number=n, submitted_by=owner, created_at=created)
        session.add(v)
        await session.flush()
        if n == 5:
            session.add_all(_flow(v.id, f"m{map_id}v{n}"))
        _publish_events(session, v.id, owner, approvers, created,
                        reject=(map_idx % 4 == 1 and n == 3),
                        withdraw=(map_idx % 4 == 2 and n == 4))

    # 최상위 작업본 — 대부분 draft, 일부(맵 인덱스%5==3) rejected
    created = base - timedelta(days=1)
    if map_idx % 5 == 3:
        v = MapVersion(map_id=map_id, label="Release 6", status=workflow.REJECTED,
                       version_number=None, submitted_by=owner,
                       reject_reason="Needs revision before release", created_at=created)
        session.add(v)
        await session.flush()
        session.add_all(_flow(v.id, f"m{map_id}v6"))
        session.add(VersionEvent(version_id=v.id, event_type="created", actor=owner, created_at=created))
        session.add(VersionEvent(version_id=v.id, event_type="submitted", actor=owner,
                                 created_at=created + timedelta(hours=1)))
        session.add(VersionEvent(version_id=v.id, event_type="rejected", actor=approvers[0],
                                 note="Needs revision before release",
                                 created_at=created + timedelta(hours=2)))
    else:
        v = MapVersion(map_id=map_id, label="Release 6", status=workflow.DRAFT,
                       version_number=None, checked_out_by=owner, checked_out_at=created,
                       created_at=created)
        session.add(v)
        await session.flush()
        session.add_all(_flow(v.id, f"m{map_id}v6"))
        session.add(VersionEvent(version_id=v.id, event_type="created", actor=owner, created_at=created))


async def _seed_maps(session: AsyncSession, people: list[dict], groups: dict) -> list[int]:
    users = [p for p in people if p["role"] == "user"]
    part_paths = sorted({p["path"] for p in people if p["leaf"]["l4"]})
    all_groups = groups["user"] + groups["part"] + groups["mixed"]
    base = now_kst()
    map_ids: list[int] = []
    for idx, (name, vis) in enumerate(MAP_SPECS):
        owner = RNG.choice(users)
        m = ProcessMap(name=name, description=f"{name} — demo map", created_by=owner["login_id"],
                       owner_id=owner["login_id"], visibility=vis)
        # 오우닝 부서 — 2/3은 오너 소속 경로로 지정, 1/3(idx%3==0)은 누락으로 남겨
        # 홈 배지·누락 필터·설정 Assign 플로우를 시연 가능하게 한다 (spec 2026-07-10)
        if idx % 3 != 0:
            m.owning_department = owner["path"]
        # 서브프로세스 지정 — 대표 업무만(게시 v5 존재 전제 충족). 부서 필수 + 최근 변경 기록.
        if idx in DESIGNATED_SPECS:
            system, duration = DESIGNATED_SPECS[idx]
            m.sp_designated_at = base
            m.sp_department = owner["leaf"]["department"]
            m.sp_system = system
            m.sp_duration = duration
            m.sp_changed_by = owner["login_id"]
            m.sp_changed_at = base
        session.add(m)
        await session.flush()
        map_ids.append(m.id)

        others = [u for u in users if u["login_id"] != owner["login_id"]]
        perms: list[tuple[str, str, str]] = [("user", owner["login_id"], "owner")]
        for p in RNG.sample(others, 2):
            perms.append(("user", p["login_id"], "editor"))
        for p in RNG.sample(others, 3):
            perms.append(("user", p["login_id"], "viewer"))
        perms.append(("department", RNG.choice(part_paths), RNG.choice(["editor", "viewer"])))
        perms.append(("group", str(RNG.choice(all_groups)), RNG.choice(["editor", "viewer"])))
        for ptype, pid, role in perms:
            session.add(MapPermission(map_id=m.id, principal_type=ptype, principal_id=pid,
                                      role=role, granted_by=owner["login_id"]))

        approver_ids = [p["login_id"] for p in RNG.sample(users, RNG.randint(1, 3))]
        for aid in approver_ids:
            session.add(MapApprover(map_id=m.id, user_id=aid, assigned_by=owner["login_id"]))

        await _seed_versions(session, m.id, owner["login_id"], approver_ids, base, idx)

    # 소비 데모 — Employee Onboarding 최신 draft에 subprocess 노드 2개:
    # 지정 맵(정상 펼침·어트리뷰트) vs 미지정 맵(경고+잠금)을 나란히 시연 (spec 2026-07-06)
    consumer_map = map_ids[1]
    draft_vid = await session.scalar(
        select(MapVersion.id).where(
            MapVersion.map_id == consumer_map, MapVersion.label == "Release 6"
        )
    )
    if draft_vid is not None:
        session.add_all([
            Node(id=f"m{consumer_map}-sp-designated", version_id=draft_vid,
                 title=MAP_SPECS[0][0], node_type="subprocess",
                 linked_map_id=map_ids[0], follow_latest=True,
                 pos_x=80.0, pos_y=420.0, sort_order=10),
            Node(id=f"m{consumer_map}-sp-undesignated", version_id=draft_vid,
                 title=MAP_SPECS[3][0], node_type="subprocess",
                 linked_map_id=map_ids[3], follow_latest=True,
                 pos_x=340.0, pos_y=420.0, sort_order=11),
        ])
    await session.flush()
    return map_ids


async def seed_org_demo(session: AsyncSession) -> dict:
    """전체 시드 — 반환 요약(카운트)."""
    people = await _seed_employees(session)
    groups = await _seed_groups(session, people)
    map_ids = await _seed_maps(session, people, groups)
    await session.commit()
    return {
        "employees": len(people),
        "groups": sum(len(v) for v in groups.values()),
        "maps": len(map_ids),
    }
