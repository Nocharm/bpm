"""개발용 DB 초기화 — drop_all + create_all + 로컬 직원 5명 + 참조 데모 맵 시드.

운영/서버 환경에서 실행 금지. sqlite dev.db 전용 (postgres면 연결 URL로 바꿀 것).

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.reset_db
    PowerShell: .venv\\Scripts\\python -m scripts.reset_db
"""

import asyncio

from sqlalchemy import text

from app.db import SessionLocal, engine
from app.models import Base, Employee
from scripts.seed_reference_demo import main as seed_demo

# 로컬 직원 5명 — auth OFF 환경용 (org_l* 은 null → org_path 반환 시 department 폴백)
LOCAL_USERS: list[dict[str, str]] = [
    {"login_id": "admin.kim", "name": "김관리", "title": "팀장", "department": "프로세스혁신팀", "role": "admin"},
    {"login_id": "user.lee", "name": "이업무", "title": "선임", "department": "구매팀", "role": "user"},
    {"login_id": "user.park", "name": "박담당", "title": "사원", "department": "인사팀", "role": "user"},
    {"login_id": "user.choi", "name": "최실무", "title": "책임", "department": "생산관리팀", "role": "user"},
    {"login_id": "user.jung", "name": "정사용", "title": "선임", "department": "품질팀", "role": "user"},
]


async def main() -> None:
    # 1. 스키마 재생성
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("schema  drop_all + create_all 완료")

    # 2. 로컬 직원 5명 시드
    async with SessionLocal() as session:
        for spec in LOCAL_USERS:
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
    print(f"seed    employees {len(LOCAL_USERS)}명")

    # 3. 참조 데모 맵 시드 (seed_reference_demo.main 재사용)
    await seed_demo()

    # 4. 확인 — 테이블 존재 + 직원 수
    async with SessionLocal() as session:
        emp_count = (await session.execute(text("SELECT count(*) FROM employees"))).scalar()
        perm_count = (await session.execute(text("SELECT count(*) FROM map_permissions"))).scalar()
        ar_count = (await session.execute(text("SELECT count(*) FROM approval_requests"))).scalar()
    print(f"verify  employees={emp_count}, map_permissions={perm_count}, approval_requests={ar_count}")


if __name__ == "__main__":
    asyncio.run(main())
