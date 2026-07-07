"""Async database engine, session factory, and schema init."""

from collections.abc import AsyncGenerator

from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.settings import settings

engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# create_all로 못 채우는 신규 컬럼(기존 테이블에 추가된 것)을 보강하는 경량 스톱갭.
# Alembic 도입 전까지 기존 DB가 깨지지 않도록 startup에서 멱등 적용. (table, column, DDL 타입)
_ADDED_COLUMNS: list[tuple[str, str, str]] = [
    ("nodes", "group_id", "VARCHAR(50)"),  # spec Phase 2 — 업무 묶음 소속
    # 버전 승인 워크플로우 — 기존 map_versions에 컬럼 보강 (design 2026-06-14)
    # status는 기존 행이 NULL이면 VersionOut(status:str) 검증이 깨지므로 DEFAULT 'draft'로 백필
    ("map_versions", "status", "VARCHAR(20) DEFAULT 'draft'"),
    ("map_versions", "submitted_by", "VARCHAR(100)"),
    ("map_versions", "reject_reason", "VARCHAR(500)"),
    # 게시 순차번호 — 버전 라이프사이클(2026-06-29 Task1). 서버 등 기존 DB(덤프 복원 포함)
    # 에 컬럼이 없으면 publish/workflow 조회가 500 → 기동 시 nullable로 보강(기존 행 생존).
    ("map_versions", "version_number", "INTEGER"),
    # 점유 이전 출처(누구에게서) — 점유권 탭 provenance 표시 (2026-07-02)
    ("map_versions", "checked_out_from", "VARCHAR(100)"),
    ("groups", "parent_group_id", "VARCHAR(50)"),  # 그룹 중첩(하위 그룹핑) — design 2026-06-15
    ("nodes", "group_ids", "JSON"),  # 다중 그룹(태그) 소속 — design 2026-06-15
    ("user_groups", "deleted_at", "TIMESTAMP"),  # 그룹 소프트삭제(7일 보존) — 2026-06-27
    ("user_groups", "name_changed_at", "TIMESTAMP"),  # 주 1회 rename 제한 — 2026-06-27
    # 매뉴얼 다중 문서 — 제목·언어·정렬 (F10, 2026-07-06). 레거시 단일 게시본 행은 ko로 흡수
    ("manual_docs", "title", "VARCHAR(200) DEFAULT ''"),
    ("manual_docs", "language", "VARCHAR(5) DEFAULT 'ko'"),
    ("manual_docs", "sort_order", "INTEGER DEFAULT 0"),
    # 서브프로세스 지정 — 지정 맵만 피커 노출 + 라이브 어트리뷰트 (2026-07-06)
    ("process_maps", "sp_designated_at", "TIMESTAMP"),
    ("process_maps", "sp_department", "VARCHAR(100)"),
    ("process_maps", "sp_assignee", "VARCHAR(100)"),
    ("process_maps", "sp_system", "VARCHAR(100)"),
    ("process_maps", "sp_duration", "VARCHAR(50)"),
    ("process_maps", "sp_changed_by", "VARCHAR(100)"),
    ("process_maps", "sp_changed_at", "TIMESTAMP"),
    # 노드 참조 링크 — CSV import design 2026-07-06
    ("nodes", "url", "VARCHAR(500) DEFAULT ''"),
    # URL 라벨 + 서브프로세스 지정 URL — url-label design 2026-07-07
    ("nodes", "url_label", "VARCHAR(100) DEFAULT ''"),
    ("process_maps", "sp_url", "VARCHAR(500)"),
    ("process_maps", "sp_url_label", "VARCHAR(100)"),
]


def _add_missing_columns(conn: Connection) -> None:
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    for table, column, ddl_type in _ADDED_COLUMNS:
        if table not in tables:
            continue  # 신규 테이블은 create_all이 모든 컬럼 포함해 생성
        existing = {col["name"] for col in inspector.get_columns(table)}
        if column not in existing:
            # nullable 컬럼 추가 — sqlite/postgres 모두 지원, 기존 행은 NULL(DDL에 DEFAULT 있으면 백필)
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


async def init_models() -> None:
    """Create tables if absent + 누락 컬럼 보강. 본격 마이그레이션(Alembic)은 후속 단계."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
