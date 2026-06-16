"""AD 동기화 서비스 — 로컬 시드 + 단일/전체 동기화 (design 2026-06-16)."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Employee

# 로컬 임시 유저 5명 (auth OFF). loginId는 '.' 포함·'_' 미포함(필터 비충돌), name 무 '_'.
LOCAL_USERS: list[dict[str, str]] = [
    {"login_id": "admin.kim", "name": "김관리", "title": "팀장", "department": "프로세스혁신팀", "role": "admin"},
    {"login_id": "user.lee", "name": "이업무", "title": "선임", "department": "구매팀", "role": "user"},
    {"login_id": "user.park", "name": "박담당", "title": "사원", "department": "인사팀", "role": "user"},
    {"login_id": "user.choi", "name": "최실무", "title": "책임", "department": "생산관리팀", "role": "user"},
    {"login_id": "user.jung", "name": "정사용", "title": "선임", "department": "품질팀", "role": "user"},
]


async def seed_local_employees(session: AsyncSession) -> None:
    """로컬 임시 유저 멱등 upsert — auth OFF일 때만 호출."""
    for spec in LOCAL_USERS:
        emp = await session.get(Employee, spec["login_id"])
        if emp is None:
            session.add(
                Employee(
                    login_id=spec["login_id"],
                    name=spec["name"],
                    title=spec["title"],
                    department=spec["department"],
                    role=spec["role"],
                    source="local",
                )
            )
    await session.commit()
