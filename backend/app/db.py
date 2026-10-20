"""Async database engine, session factory, and schema init."""

import logging
from collections.abc import AsyncGenerator

from sqlalchemy import Connection, DateTime, MetaData, String, Text, event, inspect, text
from sqlalchemy.types import TypeEngine
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models import Base
from app.settings import settings

logger = logging.getLogger(__name__)

engine = create_async_engine(settings.database_url)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

if engine.dialect.name == "sqlite":

    @event.listens_for(engine.sync_engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection: object, _record: object) -> None:
        # sqlite는 연결마다 FK를 꺼 둔다 — 운영(PG)과 달리 영구삭제 잔재가 남고, 재사용된 rowid로
        # 새 맵이 지운 맵의 권한·요청 행을 물려받았다 (리뷰 2026-10-19 H-11)
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

# create_all로 못 채우는 신규 컬럼(기존 테이블에 추가된 것)을 보강하는 경량 스톱갭.
# Alembic 도입 전까지 기존 DB가 깨지지 않도록 startup에서 멱등 적용. (table, column, DDL 타입)
# 시각 컬럼은 TIMESTAMPTZ — 모델이 전부 timezone=True다. 예전 TIMESTAMP로 붙은 운영 컬럼은
# _reconcile_column_types가 바꾼다 (리뷰 2026-10-19 H-6). sqlite는 형 이름을 가리지 않는다.
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
    ("nodes", "parallel_outputs", "JSON"),  # 병렬 출구 키 — 출력 규칙 2026-10-01
    ("user_groups", "deleted_at", "TIMESTAMPTZ"),  # 그룹 소프트삭제(7일 보존) — 2026-06-27
    ("user_groups", "name_changed_at", "TIMESTAMPTZ"),  # 주 1회 rename 제한 — 2026-06-27
    # 매뉴얼 다중 문서 — 제목·언어·정렬 (F10, 2026-07-06). 레거시 단일 게시본 행은 ko로 흡수
    ("manual_docs", "title", "VARCHAR(200) DEFAULT ''"),
    ("manual_docs", "language", "VARCHAR(5) DEFAULT 'ko'"),
    ("manual_docs", "sort_order", "INTEGER DEFAULT 0"),
    # 서브프로세스 지정 — 지정 맵만 피커 노출 + 라이브 어트리뷰트 (2026-07-06)
    ("process_maps", "sp_designated_at", "TIMESTAMPTZ"),
    ("process_maps", "sp_department", "VARCHAR(100)"),
    ("process_maps", "sp_assignee", "VARCHAR(100)"),
    ("process_maps", "sp_system", "VARCHAR(100)"),
    ("process_maps", "sp_duration", "VARCHAR(50)"),
    ("process_maps", "sp_changed_by", "VARCHAR(100)"),
    ("process_maps", "sp_changed_at", "TIMESTAMPTZ"),
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
    # sp_description은 2026-08-31에 폐기(맵 description으로 일원화) — 보강 대상에서 제외한다.
    # 드랍은 아래 `_drop_legacy_sp_description` 부트스트랩 스텝이 수행한다. 폐기 정책은 두 갈래다:
    # nullable 구 컬럼(sp_description·nodes.data_form)=드랍 스텝, create_all NOT NULL 컬럼
    # (Word doc_*·section_anchor·interview_sessions.mode)=모델 매핑 유지+여기서 보강.
    # [폐기 컬럼] Word 맵 모드(2026-09-29 제거) — 모델이 매핑을 유지하므로(models.py ProcessMap 주석)
    # 컬럼이 없는 DB엔 계속 보강해야 INSERT가 깨지지 않는다. mode는 framework 캔버스가 계속 쓴다.
    ("nodes", "section_anchor", "VARCHAR(200) DEFAULT ''"),
    ("process_maps", "mode", "VARCHAR(20) DEFAULT 'normal'"),
    ("process_maps", "doc_name", "VARCHAR(300) DEFAULT ''"),
    ("process_maps", "doc_sections", "JSON"),
    ("process_maps", "doc_imported_at", "TIMESTAMPTZ"),
    ("process_maps", "doc_generated_at", "TIMESTAMPTZ"),
    ("interview_sessions", "mode", "VARCHAR(20) DEFAULT 'normal'"),
    # AI L5 캠페인 — 첨부 분리·플레이스홀더 건너뛰기 (2026-09-21, dev 서버에 테이블 기존재 대비)
    ("framework_interview_sessions", "attachments", "JSON"),
    ("framework_interview_tasks", "placeholder", "BOOLEAN DEFAULT FALSE"),
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
    # 엣지별 선 모양 — ""=레거시(FE가 꺾은선 렌더), DEFAULT로 기존 행 백필 (2026-08-18)
    ("edges", "line_style", "VARCHAR(20) DEFAULT ''"),
    # 임포트 출처 게이트웨이 종별 — "parallel"만 앱이 해석(§4 게이트 6 예외) (2026-09-02)
    ("edges", "gateway", "VARCHAR(20)"),
    # 피드백 알림 발송 시각 — 관리자 수동 발송(상태변경은 1회 한정) (2026-08-19)
    ("feedback", "reply_notified_at", "TIMESTAMPTZ"),
    ("feedback", "status_notified_at", "TIMESTAMPTZ"),
    # 노트 수정 이력/아카이브 — 삭제는 아카이브로만, 영구삭제는 관리자 퍼지 (2026-08-19)
    ("feedback_notes", "edited_at", "TIMESTAMPTZ"),
    ("feedback_notes", "archived_at", "TIMESTAMPTZ"),
    # 인터뷰 필드 승격 — 노드/SP 대칭 + 대표/폴백 쌍 (design 2026-08-19 §1)
    ("nodes", "touch_time", "VARCHAR(50) DEFAULT ''"),
    ("nodes", "input", "TEXT DEFAULT ''"),
    ("nodes", "output", "TEXT DEFAULT ''"),
    # IO 항목별 데이터 폼 — input/output 줄과 1:1 정렬 (2026-08-20)
    ("nodes", "input_forms", "TEXT DEFAULT ''"),
    ("nodes", "output_forms", "TEXT DEFAULT ''"),
    ("process_maps", "sp_input_forms", "TEXT"),
    ("process_maps", "sp_output_forms", "TEXT"),
    ("nodes", "start_condition", "TEXT DEFAULT ''"),
    ("nodes", "end_condition", "TEXT DEFAULT ''"),
    ("nodes", "system_fallback", "VARCHAR(200) DEFAULT ''"),
    ("process_maps", "sp_start_condition", "TEXT"),
    ("process_maps", "sp_end_condition", "TEXT"),
    ("process_maps", "sp_gmp", "VARCHAR(20)"),
    ("process_maps", "sp_gmp_fallback", "TEXT"),
    ("process_maps", "sp_frequency_fallback", "VARCHAR(200)"),
    ("process_maps", "sp_total_time_fallback", "VARCHAR(200)"),
    ("process_maps", "sp_touch_time", "VARCHAR(50)"),
    ("process_maps", "sp_touch_time_fallback", "VARCHAR(200)"),
    ("process_maps", "sp_system_fallback", "VARCHAR(200)"),
    # 활동별 GMP (design 2026-08-20 캔버스 필 확장)
    ("nodes", "gmp", "VARCHAR(20) DEFAULT ''"),
    # IO 링크(불러오기) — 줄 정렬은 input_forms와 동일 (io-linking design 2026-08-21 §3)
    ("nodes", "output_ids", "TEXT DEFAULT ''"),
    ("nodes", "input_links", "TEXT DEFAULT ''"),
    ("nodes", "output_links", "TEXT DEFAULT ''"),
    ("nodes", "input_flags", "TEXT DEFAULT ''"),
    ("process_maps", "sp_input_ids", "TEXT"),
    ("process_maps", "sp_output_ids", "TEXT"),
    # SP 지정 참고치 연간횟수/FTE (design 2026-09-03 §4)
    ("process_maps", "sp_annual_count", "VARCHAR(50)"),
    ("process_maps", "sp_fte", "VARCHAR(50)"),
    # 노트 사람 수정 시각 — 재임포트 교체 행 기본값 판정 (design 2026-09-03 followups §3)
    ("map_notes", "edited_at", "TIMESTAMPTZ"),
    # 알림 구조화 컨텍스트 — FE 언어 토글 렌더용, 레거시 행은 NULL→message 폴백 (2026-08-26)
    ("notifications", "payload", "JSON"),
    # Framework L5 연계 캔버스 (design 2026-08-28) — 카테고리↔캔버스 1:1 · 확정 스냅샷 번호
    ("process_categories", "linkage_map_id", "INTEGER"),
    # 카테고리 관리 부서(조직 경로, 상위 상속) — 캔버스 owning_department 파생 소스 (2026-09-21)
    ("process_categories", "admin_department", "VARCHAR(200)"),
    ("map_versions", "fw_major", "INTEGER"),
    ("map_versions", "fw_minor", "INTEGER"),
    # 플레이스홀더 출처 L5 — 미등록 SP의 소속 카테고리(임포트 기록·후차 연결) (design §10.1)
    ("nodes", "placeholder_category_id", "INTEGER"),
    # 이양 후계자 — retire_source가 기록, 은퇴 맵 SP 노드의 교체 추천 소스 (2026-08-30)
    ("process_maps", "retired_to_map_id", "INTEGER"),
    # 노드 표시 폭 — SP 그립 조절 영속(180~216, NULL=기본) (2026-08-30)
    ("nodes", "width", "INTEGER"),
    # 노드 역할 + SP 지정 역할 — 단일값, 담당자 옆 표시 (design 2026-09-11)
    ("nodes", "assignee_role", "VARCHAR(100) DEFAULT ''"),
    ("process_maps", "sp_assignee_role", "VARCHAR(100)"),
    # AI L5 캠페인 — 세션 시작 시 기존 L6 스냅샷·계획 카드 모드 (spec 2026-09-22 §2.2)
    ("framework_interview_sessions", "existing", "JSON"),
    # 편집용 연결 캔버스 + 재제안 피드백 로그 (spec 2026-09-23 §4.2)
    ("framework_interview_sessions", "canvas", "JSON"),
    ("framework_interview_sessions", "feedback_log", "JSON"),
    ("framework_interview_tasks", "mode", "VARCHAR(10) DEFAULT 'new'"),
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


def _enforce_version_approval_unique(conn: Connection) -> None:
    """version_approvals (version_id, approver) 유니크 보강 — 같은 승인자의 중복 행을 먼저 지운다
    (리뷰 2026-10-19 B-1, 사용자 결정: 기동 시 자동 정리). 최저 id 1건만 남긴다 — 승인 여부만
    의미가 있어 어느 행을 남겨도 판정은 같다."""
    inspector = inspect(conn)
    if "version_approvals" not in inspector.get_table_names():
        return
    removed = conn.execute(text(
        "DELETE FROM version_approvals WHERE id NOT IN "
        "(SELECT MIN(id) FROM version_approvals GROUP BY version_id, approver)"
    )).rowcount
    if removed:
        logger.warning("removed %d duplicate version_approvals rows", removed)
    conn.execute(text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_version_approvals_version_approver "
        "ON version_approvals (version_id, approver)"
    ))


# 이미 겹친 행 진단 — (이름, 테이블, 묶음 쿼리). 결과 행 = 겹친 한 묶음, 마지막 열은 개수
_DUPLICATE_CHECKS: list[tuple[str, str, str]] = [
    ("map version number", "map_versions",
     "SELECT map_id, version_number, COUNT(*) FROM map_versions WHERE version_number IS NOT NULL "
     "GROUP BY map_id, version_number HAVING COUNT(*) > 1"),
    ("published version", "map_versions",
     "SELECT map_id, COUNT(*) FROM map_versions WHERE status = 'published' "
     "GROUP BY map_id HAVING COUNT(*) > 1"),
    ("map permission", "map_permissions",
     "SELECT map_id, principal_type, principal_id, COUNT(*) FROM map_permissions "
     "GROUP BY map_id, principal_type, principal_id HAVING COUNT(*) > 1"),
]


def _report_duplicate_rows(conn: Connection) -> None:
    """버전 번호·게시본·권한 행 중복을 기동 로그로만 알린다 — 데이터는 바꾸지 않는다.

    새 중복은 맵 행 잠금이 막는다(게시·버전 생성·권한 추가·오너 이전). 이미 겹친 운영 데이터는 사람이 보고
    고르게 남긴다 (사용자 결정 2026-10-20, 리뷰 확인 필요 항목). 로그 예: duplicate map permission rows: 2 groups.
    """
    tables = set(inspect(conn).get_table_names())
    for label, table, query in _DUPLICATE_CHECKS:
        if table not in tables:
            continue
        groups = conn.execute(text(query)).all()
        if groups:
            logger.warning(
                "duplicate %s rows: %d groups (first %s) - left as is, review by hand",
                label, len(groups), [tuple(row) for row in groups[:5]],
            )


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


def find_column_type_drift(
    metadata: MetaData, db_columns: dict[str, dict[str, TypeEngine]]
) -> list[tuple[str, str, str]]:
    """모델보다 좁은 DB 컬럼 형 — (table, column, 바꿀 DDL 타입). 넓히는 두 방향만 다룬다:
    시간대 없는 TIMESTAMP → TIMESTAMPTZ(모델 timezone=True), VARCHAR → TEXT(모델 Text)."""
    drift: list[tuple[str, str, str]] = []
    for table in metadata.tables.values():
        existing = db_columns.get(table.name)
        if existing is None:
            continue
        for column in table.columns:
            db_type = existing.get(column.name)
            if db_type is None:
                continue
            model_type = column.type
            if (
                isinstance(model_type, DateTime) and model_type.timezone
                and isinstance(db_type, DateTime) and not db_type.timezone
            ):
                drift.append((table.name, column.name, "TIMESTAMPTZ"))
            elif (
                isinstance(model_type, Text)
                and isinstance(db_type, String) and not isinstance(db_type, Text)
            ):
                drift.append((table.name, column.name, "TEXT"))
    return drift


def _reconcile_column_types(conn: Connection) -> None:
    """운영 Postgres 컬럼 형을 모델에 맞춘다 — create_all은 기존 컬럼 형을 고치지 않는다 (리뷰 2026-10-19 H-2·H-6).

    TIMESTAMP → TIMESTAMPTZ는 USING 없이 바꾼다. 앱은 timestamptz로 바인드해 세션 TimeZone 기준
    naive 값으로 저장됐고, 암묵 캐스트도 같은 세션 TimeZone으로 읽어 같은 절대 시각으로 돌아온다.
    VARCHAR → TEXT는 재작성 없는 메타데이터 변경이다. sqlite는 형을 강제하지 않아 스킵.
    """
    if conn.dialect.name != "postgresql":
        return
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    db_columns = {
        table.name: {col["name"]: col["type"] for col in inspector.get_columns(table.name)}
        for table in Base.metadata.tables.values()
        if table.name in tables
    }
    for table, column, ddl_type in find_column_type_drift(Base.metadata, db_columns):
        conn.execute(text(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE {ddl_type}"))
        logger.warning("converted column %s.%s to %s", table, column, ddl_type)


def _drop_legacy_sp_description(conn: Connection) -> None:
    """폐기된 process_maps.sp_description 물리 삭제 — 맵 description으로 일원화 (사용자 결정 2026-08-31).

    운영에서 두 값을 따로 채운 사례가 없음을 확인하고 드랍한다. 비치명 스텝이라 실패해도
    기동은 계속된다. ⚠️ 드랍 후 구버전 코드로 롤백하면 이 컬럼에 쓰다 죽으므로, 롤백은
    이 커밋 이후 버전 사이에서만 안전하다. sqlite는 3.35+에서 DROP COLUMN 지원.
    """
    inspector = inspect(conn)
    if "process_maps" not in inspector.get_table_names():
        return
    if "sp_description" in {col["name"] for col in inspector.get_columns("process_maps")}:
        conn.execute(text("ALTER TABLE process_maps DROP COLUMN sp_description"))


def _drop_legacy_node_data_form(conn: Connection) -> None:
    """폐기된 nodes.data_form 물리 삭제 — 자료 형식은 IO 항목별 폼(output_forms)으로 일원화 (사용자 결정 2026-09-03).

    운영에서 쓰인 적 없는 컬럼이라 값 이전 없이 드랍한다. 비치명 스텝(실패해도 기동 계속).
    ⚠️ 드랍 후 구버전 코드로 롤백하면 이 컬럼에 쓰다 죽으므로 롤백은 이 커밋 이후 버전 사이에서만 안전.
    """
    inspector = inspect(conn)
    if "nodes" not in inspector.get_table_names():
        return
    if "data_form" in {col["name"] for col in inspector.get_columns("nodes")}:
        conn.execute(text("ALTER TABLE nodes DROP COLUMN data_form"))


def _migrate_framework_confirmed(conn: Connection) -> None:
    """fw 확정 스냅샷의 status published→confirmed 일회 이전 — 매 기동 멱등 (spec 2026-09-02 §3).

    fw_major가 있는 버전만 대상이라 일반 게시본은 건드리지 않는다. 이벤트도 함께 전환해
    타임라인 칩·PNG 확정일 소스가 일관된다.
    """
    inspector = inspect(conn)
    tables = set(inspector.get_table_names())
    if "map_versions" not in tables:
        return
    conn.execute(text(
        "UPDATE map_versions SET status = 'confirmed' "
        "WHERE fw_major IS NOT NULL AND status = 'published'"
    ))
    if "version_events" in tables:
        conn.execute(text(
            "UPDATE version_events SET event_type = 'confirmed' "
            "WHERE event_type = 'published' AND version_id IN "
            "(SELECT id FROM map_versions WHERE fw_major IS NOT NULL)"
        ))


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
        _enforce_version_approval_unique,
        _report_duplicate_rows,
        _sweep_orphan_kb_chunks,
        _widen_interview_message_kind,
        _reconcile_column_types,
        _relax_employees_email_not_null,
        _drop_legacy_sp_description,
        _drop_legacy_node_data_form,
        _migrate_framework_confirmed,
    ):
        try:
            async with engine.begin() as conn:
                await conn.run_sync(step)
        except Exception:  # noqa: BLE001 -- 실패는 크게 로깅하고 기동은 계속
            logger.exception("bootstrap step %s failed - continuing startup", step.__name__)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
