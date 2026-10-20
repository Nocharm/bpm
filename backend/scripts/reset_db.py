"""개발용 DB 초기화 — drop_all + create_all + 종합 데모 시드(조직도·직원400·그룹6·맵12).

운영/서버 환경에서 실행 금지. sqlite dev.db 전용(postgres면 DATABASE_URL로 대상 변경).
시드 내용·조직 구조는 scripts/seed_org_demo.py 참고. sysadmin 계정: admin.sys.

실행 (backend/ 에서):
    bash:       .venv/bin/python -m scripts.reset_db
    PowerShell: .venv\\Scripts\\python -m scripts.reset_db
"""

import asyncio

from sqlalchemy import Connection, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import SessionLocal, engine
from app.models import Base, MapVersion, ProcessMap, VersionEvent
from scripts.seed_org_demo import seed_org_demo


async def backfill_version_events(session: AsyncSession) -> int:
    """created 이벤트가 없는 버전에 created_at 기준 created 1건을 합성한다(멱등). 반환=추가 건수.

    종합 시드는 이벤트를 직접 만들지만, 레거시/부분 시드 DB를 정규화할 때 쓰는 유틸.
    """
    have_created = set(
        (
            await session.scalars(
                select(VersionEvent.version_id).where(VersionEvent.event_type == "created")
            )
        ).all()
    )
    rows = (
        await session.execute(
            select(MapVersion, ProcessMap.owner_id, ProcessMap.created_by).join(
                ProcessMap, ProcessMap.id == MapVersion.map_id
            )
        )
    ).all()
    added = 0
    for version, owner_id, created_by in rows:
        if version.id in have_created:
            continue
        session.add(
            VersionEvent(
                version_id=version.id,
                event_type="created",
                actor=owner_id or created_by or "unknown",
                created_at=version.created_at,
            )
        )
        added += 1
    await session.commit()
    return added


def ensure_reset_allowed(conn: Connection) -> None:
    """postgres는 빈 DB에서만 — 맵·직원이 한 건이라도 있으면 drop_all 전에 멈춘다(SystemExit).

    운영 이미지에도 이 스크립트가 실려 있어 compose `-p` 하나만 틀려도 운영 DB가 지워질 수 있었다 (리뷰 2026-10-19).
    로컬 sqlite는 데모 리셋이 본래 용도라 막지 않는다.
    """
    if conn.dialect.name == "sqlite":
        return
    tables = set(inspect(conn).get_table_names())
    for table in ("process_maps", "employees"):
        if table in tables and conn.execute(text(f"SELECT 1 FROM {table} LIMIT 1")).first() is not None:
            raise SystemExit(
                f"refusing to reset: {table} has rows in {conn.engine.url.render_as_string(hide_password=True)}"
                " - reset_db drops every table and is only for a new, empty database (setup-once A8)"
            )


async def main() -> None:
    # 1. 스키마 재생성 — 전체 삭제 후 새로
    async with engine.begin() as conn:
        await conn.run_sync(ensure_reset_allowed)
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    print("schema  drop_all + create_all 완료")

    # 2. 종합 데모 시드
    async with SessionLocal() as session:
        summary = await seed_org_demo(session)
    print(
        f"seed    org demo - employees={summary['employees']} (incl. sysadmin admin.sys), "
        f"groups={summary['groups']}, maps={summary['maps']}"
    )

    # 3. 확인 — 핵심 카운트
    async with SessionLocal() as session:
        counts = {}
        for table in (
            "employees", "process_maps", "map_versions", "map_permissions",
            "map_approvers", "version_approvals", "version_events",
            "user_groups", "user_group_members",
        ):
            counts[table] = (
                await session.execute(text(f"SELECT count(*) FROM {table}"))
            ).scalar()
        by_status = dict(
            (
                await session.execute(
                    text("SELECT status, count(*) FROM map_versions GROUP BY status")
                )
            ).all()
        )
        by_vis = dict(
            (
                await session.execute(
                    text("SELECT visibility, count(*) FROM process_maps GROUP BY visibility")
                )
            ).all()
        )
    print("verify  " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"verify  versions by status={by_status}")
    print(f"verify  maps by visibility={by_vis}")


if __name__ == "__main__":
    asyncio.run(main())
