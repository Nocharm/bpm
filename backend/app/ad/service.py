"""로컬 시드 + AD title 전용 패스(HR 전환 2026-08-10 — 디렉터리 소스는 app/hr)."""

import asyncio

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad import client
from app.models import Employee

# 로컬 임시 유저 5명 (auth OFF). loginId는 '.' 포함·'_' 미포함(필터 비충돌), name 무 '_'.
# AD-aligned English data — login_id(=sAMAccountName) 불변, name/title/org만 영문화.
# 3가지 패턴: ① lee==park(same team), ② choi(same Procurement Office prefix, diff team),
#             ③ jung(no l3 → parent Procurement Office prefix).
LOCAL_USERS: list[dict] = [
    {
        "login_id": "admin.kim", "name": "Junho Kim", "title": "Manager", "role": "admin",
        "org_l1": "Management Support Division", "org_l2": "Process Innovation Office",
        "org_l3": "Process Innovation Team",
        "org_l4": None, "org_l5": None, "department": "Process Innovation Team",
    },
    {
        "login_id": "user.lee", "name": "Minjae Lee", "title": "Senior", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 1",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 1",
    },
    {
        "login_id": "user.park", "name": "Soyeon Park", "title": "Associate", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 1",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 1",
    },
    {
        "login_id": "user.choi", "name": "Daehyun Choi", "title": "Principal", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": "Sourcing Team 2",
        "org_l4": None, "org_l5": None, "department": "Sourcing Team 2",
    },
    {
        "login_id": "user.jung", "name": "Hana Jung", "title": "Senior", "role": "user",
        "org_l1": "Management Support Division", "org_l2": "Procurement Office",
        "org_l3": None,
        "org_l4": None, "org_l5": None, "department": "Procurement Office",
    },
]


async def seed_local_employees(session: AsyncSession) -> None:
    """로컬 임시 유저 멱등 upsert — auth OFF일 때만 호출.

    이미 직원이 있으면(예: reset_db 종합 시드로 채워진 DB) 재시드하지 않는다 —
    기동 시 구 5명이 종합 시드 DB에 다시 섞이는 것 방지. 빈 DB(테스트·최초 기동)만 시드.
    """
    if await session.scalar(select(Employee.login_id).limit(1)) is not None:
        return
    for spec in LOCAL_USERS:
        emp = await session.get(Employee, spec["login_id"])
        if emp is None:
            emp = Employee(login_id=spec["login_id"], source="local")
            session.add(emp)
        # 매번 갱신 — 스키마 변경(org_l* 추가) 후에도 기존 행이 채워지도록
        emp.name = spec["name"]
        emp.title = spec["title"]
        emp.role = spec["role"]
        emp.org_l1 = spec["org_l1"]
        emp.org_l2 = spec["org_l2"]
        emp.org_l3 = spec["org_l3"]
        emp.org_l4 = spec["org_l4"]
        emp.org_l5 = spec["org_l5"]
        emp.department = spec["department"]
        emp.active = True  # Dev users are always active
    await session.commit()


async def refresh_titles(session: AsyncSession) -> int:
    """HR 전체 동기화 후속 — AD에서 title만 갱신(이름·조직·active 미터치). 반환: 갱신 행 수.

    HR 응답에 title이 없어 AD 조인 유지 (design 2026-08-10 §5-7). 실패는 호출부가 삼켜 sync를 지키다.
    """
    raws = await asyncio.to_thread(client.fetch_all_users)
    updated = 0
    for raw in raws:
        if not raw.title:
            continue
        emp = await session.get(Employee, raw.sam_account_name)
        if emp is not None and emp.title != raw.title:
            emp.title = raw.title
            updated += 1
    await session.commit()
    return updated
