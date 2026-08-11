"""로컬 시드 + AD title/position 패스(HR 전환 2026-08-10 — 디렉터리 소스는 app/hr)."""

import asyncio
import logging
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ad import client
from app.models import Employee

if TYPE_CHECKING:  # hr.client → ad.service 순환 방지, 타입 힌트 전용 (설계 2026-08-11 §4)
    from app.hr.client import RawHrPosition

logger = logging.getLogger(__name__)

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


async def refresh_titles_and_positions(
    session: AsyncSession, positions: "list[RawHrPosition]"
) -> tuple[int, int, int]:
    """HR sync 후속 AD 패스 — title 갱신 + EDW 부서장 직책 매핑(employeeNumber=EMPID).

    HR 응답에 title이 없어 AD 조인 유지 (design 2026-08-10 §5-7). 실패는 호출부가 삼켜 sync를 지킨다.
    반환 (title_refreshed, position_refreshed, position_unmatched).
    소거는 positions 비어있지 않을 때만 — 빈 피드 전멸 방어 (설계 2026-08-11 §4-2).
    AD가 employeeNumber를 전혀 안 주면(empno_to_sam 전멸)도 동일하게 매칭 불가 전원 소거로
    이어지므로 스킵 — EDW는 정상인데 AD 쪽 피드 이상으로 기존 보유자가 전부 지워지는 사고 방지.
    """
    raws = await asyncio.to_thread(client.fetch_all_users)
    empno_to_sam: dict[str, str] = {}
    dup_empnos: set[str] = set()
    for r in raws:
        empno = (r.employee_number or "").strip()
        if not empno:
            continue
        if empno in empno_to_sam and empno_to_sam[empno] != r.sam_account_name:
            dup_empnos.add(empno)  # 사번 중복 — 오매칭 방지, 매핑 불가 처리
        else:
            empno_to_sam[empno] = r.sam_account_name
    titles = 0
    for raw in raws:
        if not raw.title:
            continue
        emp = await session.get(Employee, raw.sam_account_name)
        if emp is not None and emp.title != raw.title:
            emp.title = raw.title
            titles += 1
    pos_refreshed = 0
    unmatched = 0
    if positions and not empno_to_sam:
        logger.warning(
            "AD employeeNumber feed empty — skipping position match/erasure (%d unmatched)",
            len(positions),
        )
        unmatched = len(positions)
    elif positions:
        matched: set[str] = set()
        for p in positions:
            sam = None if p.emp_id in dup_empnos else empno_to_sam.get(p.emp_id)
            emp = await session.get(Employee, sam) if sam else None
            if emp is None:
                unmatched += 1
                continue
            matched.add(emp.login_id)
            if emp.position != p.position:
                emp.position = p.position
                pos_refreshed += 1
        # matched를 not_in() 바인드로 넘기면 부서장 수만큼 파라미터가 전개된다 — sqlite 999 상한 위험
        # (hr/service.py가 삭제를 500단위로 청크하는 이유와 동일). position 보유자만 뽑아 파이썬에서 차집합.
        holder_ids = (
            await session.scalars(select(Employee.login_id).where(Employee.position.is_not(None)))
        ).all()
        stale_ids = [lid for lid in holder_ids if lid not in matched]
        for lid in stale_ids:  # 목록 밖 기존 보유자 소거 — 승진·이동 반영
            emp = await session.get(Employee, lid)
            if emp is not None:
                emp.position = None
                pos_refreshed += 1
    await session.commit()
    return titles, pos_refreshed, unmatched
