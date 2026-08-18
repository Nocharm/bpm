"""Async database engine, session factory, and schema init."""

import logging
from collections.abc import AsyncGenerator

from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.settings import settings

logger = logging.getLogger(__name__)

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
    # 한글이름·한글그룹 — AD 미제공, 어드민 임포트 전용 (2026-07-09). 기존 행은 ''로 백필(EmployeeOut str 비-nullable)
    ("employees", "korean_name", "VARCHAR(200) DEFAULT ''"),
    ("employees", "korean_dept", "VARCHAR(200) DEFAULT ''"),
    # AI 제안 페이로드 — 카드 히스토리 재현 (design 2026-07-10)
    ("ai_chat_messages", "payload", "TEXT"),
    # 오우닝 부서 — 기존 행은 NULL=누락, 설정에서 owner가 수동 지정 (spec 2026-07-10)
    ("process_maps", "owning_department", "VARCHAR(200)"),
    # 회당 단가 파라미터 (design 2026-07-13) — 운영 미배포라 구 컬럼(etf/cost/extra)은 이관 없이 폐기
    ("nodes", "cost_krw", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "cost_usd", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "headcount", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "annual_count", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "fte", "VARCHAR(50) DEFAULT ''"),
    ("process_maps", "sp_cost_krw", "VARCHAR(50)"),
    ("process_maps", "sp_cost_usd", "VARCHAR(50)"),
    ("process_maps", "sp_headcount", "VARCHAR(50)"),
    # 지정 설명 — 자유 텍스트 (design 2026-07-17)
    ("process_maps", "sp_description", "TEXT"),
    # 문서 내부 섹션 앵커 — Word 맵 섹션 노드의 주 링크 (design 2026-07-18)
    ("nodes", "section_anchor", "VARCHAR(200) DEFAULT ''"),
    # Word 맵 모드 & 임포트 카탈로그 — mode="word"만 doc_name·doc_sections 사용 (design 2026-07-18)
    ("process_maps", "mode", "VARCHAR(20) DEFAULT 'normal'"),
    ("process_maps", "doc_name", "VARCHAR(300) DEFAULT ''"),
    ("process_maps", "doc_sections", "JSON"),
    # Word 맵 개정 타임스탬프 — 재임포트·완결 문서 생성 시각 (design 2026-07-24 §5)
    ("process_maps", "doc_imported_at", "TIMESTAMP"),
    ("process_maps", "doc_generated_at", "TIMESTAMP"),
    # 인터뷰 word 변환 모드 — interview_sessions는 개발서버에 기존재라 자동 ALTER 필요 (design 2026-07-26 §2)
    ("interview_sessions", "mode", "VARCHAR(20) DEFAULT 'normal'"),
    # 컨설턴트 체계 수용 (design 2026-08-08) — process_categories는 신규 테이블이라 create_all이 처리.
    # 기존 DB의 consultant_code 유니크는 ALTER로 못 걸어 앱 계층(코드 기준 업서트)이 보장한다.
    ("process_maps", "category_id", "INTEGER"),
    ("process_maps", "consultant_code", "VARCHAR(200)"),
    ("process_maps", "sp_input", "TEXT"),
    ("process_maps", "sp_output", "TEXT"),
    # HR 웹훅 동기화 — deptCode 미러 (design 2026-08-10 §3)
    ("employees", "dept_code", "VARCHAR(100)"),
    # EDW 부서장 직책(FRNM) — AD employeeNumber 매핑으로 갱신 (설계 2026-08-11 §4)
    ("employees", "position", "VARCHAR(100)"),
    # 승인요청 거절 사유 — 받은함 거절 코멘트 (spec 2026-08-14)
    ("approval_requests", "decision_reason", "VARCHAR(500)"),
    # 인터뷰 임포트 오너 미확정 마킹 (design 2026-08-18 §4)
    ("process_maps", "consultant_owner_pending", "BOOLEAN DEFAULT FALSE"),
]

# 기존 테이블에 추가된 인덱스 보강 — create_all은 이미 존재하는 테이블의 인덱스를 만들지 않는다.
# (table, index_name, "(col, ...)") — CREATE INDEX IF NOT EXISTS는 sqlite/postgres 공통 지원 (2026-07-16)
_ADDED_INDEXES: list[tuple[str, str, str]] = [
    ("notifications", "ix_notifications_recipient_read", "(recipient, read)"),
    ("notifications", "ix_notifications_recipient_created", "(recipient, created_at)"),
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


def _add_missing_indexes(conn: Connection) -> None:
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    for table, index_name, cols in _ADDED_INDEXES:
        if table not in tables:
            continue  # 신규 테이블은 create_all이 __table_args__ 인덱스 포함해 생성
        conn.execute(text(f"CREATE INDEX IF NOT EXISTS {index_name} ON {table} {cols}"))


def _enforce_interview_seq_unique(conn: Connection) -> None:
    """interview_messages (session_id, seq) 유니크 보강 — 동시 쓰기 seq 중복의 최종 방어
    (hardening T3). 기존 중복 행은 세션 max 뒤로 리넘버 — 비중복 seq를 건드리지 않아
    체크포인트 message_seq 참조가 보존된다(중복 seq는 이미 순서가 모호했던 행만 이동)."""
    inspector = inspect(conn)
    if "interview_messages" not in inspector.get_table_names():
        return
    dupes = conn.execute(text(
        "SELECT session_id, seq FROM interview_messages "
        "GROUP BY session_id, seq HAVING COUNT(*) > 1"
    )).fetchall()
    for session_id, seq in dupes:
        max_seq = conn.execute(
            text("SELECT MAX(seq) FROM interview_messages WHERE session_id = :s"),
            {"s": session_id},
        ).scalar() or 0
        ids = [row[0] for row in conn.execute(
            text("SELECT id FROM interview_messages "
                 "WHERE session_id = :s AND seq = :q ORDER BY id"),
            {"s": session_id, "q": seq},
        ).fetchall()]
        for offset, message_id in enumerate(ids[1:], 1):  # 최저 id 1건은 제자리 유지
            conn.execute(
                text("UPDATE interview_messages SET seq = :new_seq WHERE id = :i"),
                {"new_seq": max_seq + offset, "i": message_id},
            )
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_messages_session_seq "
        "ON interview_messages (session_id, seq)"
    ))


def _sweep_orphan_kb_chunks(conn: Connection) -> None:
    """삭제(소프트/영구)된 맵의 KB 청크 잔재 정리 — 훅 추가 이전 데이터 소급 (hardening T16).

    매 기동 시 멱등 실행 — kb_chunks는 소규모 전제라 비용 미미.
    """
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    if "kb_chunks" not in tables or "process_maps" not in tables:
        return
    conn.execute(text(
        "DELETE FROM kb_chunks WHERE source_type = 'map' AND source_id NOT IN "
        "(SELECT id FROM process_maps WHERE deleted_at IS NULL)"
    ))


def _widen_interview_message_kind(conn: Connection) -> None:
    """interview_messages.kind VARCHAR(12)→VARCHAR(20) — sp_suggestion(13자)이 운영 Postgres에서
    extras 커밋을 터뜨려 무음 유실되던 회귀(final review 2026-07-30). 컬럼 추가가 아닌 타입 변경이라
    _ADDED_COLUMNS로는 못 다루는 케이스. sqlite는 길이 미강제라 스킵."""
    if conn.dialect.name != "postgresql":
        return
    inspector = inspect(conn)
    if "interview_messages" not in inspector.get_table_names():
        return
    conn.execute(text("ALTER TABLE interview_messages ALTER COLUMN kind TYPE VARCHAR(20)"))


def _relax_employees_email_not_null(conn: Connection) -> None:
    """employees.email 모델 제거(design 2026-08-10 §3) 후속 — 운영 Postgres 컬럼이 NOT NULL(서버 default 없음)이라
    ORM INSERT가 email을 안 보내면 즉사. 물리 드랍 없이 NULL 허용 완화만. sqlite는 ALTER 불가 → 로컬 reset_db로 흡수."""
    if conn.dialect.name != "postgresql":
        return
    inspector = inspect(conn)
    if "employees" not in inspector.get_table_names():
        return
    cols = {c["name"]: c for c in inspector.get_columns("employees")}
    if "email" in cols and not cols["email"].get("nullable", True):
        conn.execute(text("ALTER TABLE employees ALTER COLUMN email DROP NOT NULL"))


async def init_models() -> None:
    """Create tables if absent + 누락 컬럼 보강. 본격 마이그레이션(Alembic)은 후속 단계."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)
        await conn.run_sync(_add_missing_indexes)
    # 정리성 보강 스텝은 트랜잭션 분리 + 비치명 — Postgres는 트랜잭션 내 오류가 이후 문장까지
    # 오염시키고, 스키마 보강 실패가 서비스 전체 기동을 막아선 안 된다(락이 1차 방어라 축소 동작 가능).
    for step in (
        _enforce_interview_seq_unique,
        _sweep_orphan_kb_chunks,
        _widen_interview_message_kind,
        _relax_employees_email_not_null,
    ):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(step)
        except Exception:  # noqa: BLE001 -- 실패는 크게 로깅하고 기동은 계속
            logger.exception("bootstrap step %s failed — continuing startup", step.__name__)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
