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
]


def _add_missing_columns(conn: Connection) -> None:
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    for table, column, ddl_type in _ADDED_COLUMNS:
        if table not in tables:
            continue  # 신규 테이블은 create_all이 모든 컬럼 포함해 생성
        existing = {col["name"] for col in inspector.get_columns(table)}
        if column not in existing:
            # nullable 컬럼 추가 — sqlite/postgres 모두 지원, 기존 행은 NULL
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))


async def init_models() -> None:
    """Create tables if absent + 누락 컬럼 보강. 본격 마이그레이션(Alembic)은 후속 단계."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
