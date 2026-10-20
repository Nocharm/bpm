"""관리 콘솔 API — sysadmin-only 직원·부서 디렉터리 (Layer 4 Task 0b).

/api/directory (피커용)보다 풍부한 필드를 반환하되, sysadmin 만 접근 가능.
Admin console directory — richer fields than /api/directory, sysadmin-gated.
"""

import asyncio
import json
import re
import sqlite3
from datetime import date, datetime, time, timedelta
from pathlib import Path
from collections.abc import Mapping
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import ColumnElement, String, Table, Text, and_, asc, cast, delete, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.batch_runs import record_batch_run
from app.clock import KST
from app.clock import now as now_kst
from app.db import get_session
from app.models import (
    Base,
    BatchJobRun,
    Employee,
    FeedbackNote,
    FeedbackNoteRevision,
    HrSyncRun,
    Notification,
)
from app.orgchart import (
    has_org_info,
    load_dept_index,
    resolve_org_path,
)
from app.permissions.logic import is_sysadmin
from app import ref_audit
from app.settings import settings
from app.schemas import (
    AdminDeptOut,
    BackupFileOut,
    BackupRunOut,
    BatchRunOut,
    AdminDirectoryOut,
    AdminUserOut,
    HrSyncRunDetailOut,
    HrSyncRunOut,
    NotificationBulkDeleteOut,
    NotificationPurgeGroupOut,
    NotificationPurgeIn,
    RefAuditOut,
    RefNotifyIn,
    RefNotifyOut,
    RefRemapIn,
    RefRemapOut,
    TableDataOut,
    TableInfoOut,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# 테이블 뷰어 페이지 크기 — 기본 50, 상한 200 (대량 테이블 보호) / page-size bounds.
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200

# CSV 내보내기 배치 크기 — 전체를 리스트로 모으지 않고 이 단위로 fetch/yield (메모리 바운드).
EXPORT_BATCH_SIZE = 500

# 값 대신 표식만 내보낼 비밀 컬럼 — 테이블 뷰어·CSV·검색(q) 공통. sysadmin 전용 화면이어도
# "비밀번호 해시는 응답에 싣지 않는다" 불변식을 지킨다 (리뷰 2026-10-19 H-8).
REDACTED_COLUMNS: dict[str, frozenset[str]] = {"local_credentials": frozenset({"password_hash"})}
REDACTED_MARK = "[redacted]"


def _build_row(table_name: str, row: Mapping[str, object], columns: list[str]) -> dict[str, object]:
    """화면·CSV 공용 행 렌더 — 비밀 컬럼은 표식으로 바꾼다."""
    hidden = REDACTED_COLUMNS.get(table_name, frozenset())
    return {c: REDACTED_MARK if c in hidden else _render_cell(row[c]) for c in columns}


def _build_filter(table: Table, q: str | None) -> ColumnElement[bool] | None:
    """문자열 컬럼 ILIKE(OR) 필터 — 비밀 컬럼은 검색 대상에서 빼 값 추측(오라클)을 막는다."""
    if not q:
        return None
    hidden = REDACTED_COLUMNS.get(table.name, frozenset())
    text_cols = [
        c for c in table.columns if isinstance(c.type, (String, Text)) and c.name not in hidden
    ]
    if not text_cols:
        return None
    return or_(*[cast(c, String).ilike(f"%{q}%") for c in text_cols])


@router.get("/users", response_model=AdminDirectoryOut)
async def get_admin_users(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AdminDirectoryOut:
    """sysadmin 전용 — 전 직원 + 부서 목록 (영문, 풍부한 필드).

    Sysadmin-only. Returns all employees with org_levels + per-user is_sysadmin flag
    + real active status (from AD userAccountControl, Task 2), plus a derived department list.
    """
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")

    rows = (await session.scalars(select(Employee).order_by(Employee.login_id))).all()
    dept_index = await load_dept_index(session)

    users: list[AdminUserOut] = []
    # Track distinct leaf org-paths for department list.
    # Key = tuple of levels (unique leaf path); value = list[str] of levels.
    seen_leaves: dict[tuple[str, ...], list[str]] = {}

    for emp in rows:
        # resolver 경로(departments 체인 우선, org 컬럼 폴백) → 세그먼트 리스트. 빈 경로는 [] (design 2026-08-11 §3)
        path = resolve_org_path(emp, dept_index)
        levels = path.split("/") if path else []
        users.append(
            AdminUserOut(
                login_id=emp.login_id,
                name=emp.name,
                department=emp.department,
                role=emp.role,
                is_sysadmin=is_sysadmin(emp.login_id),
                org_levels=levels,
                active=emp.active,
                korean_name=emp.korean_name,
                korean_dept=emp.korean_dept,
            )
        )
        # 부서 목록은 active + 조직 정보 실재 직원 경로만 — 퇴사자 스테일 경로와
        # org 전무 직원의 department 단독 경로가 트리 밖 고아 노드로 샌다 (2026-08 9910 적발)
        if levels and emp.active and has_org_info(emp, dept_index):
            key = tuple(levels)
            if key not in seen_leaves:
                seen_leaves[key] = levels

    departments = []
    for levels in sorted(seen_leaves.values(), key=lambda lv: lv):
        leaf = levels[-1] if levels else ""
        departments.append(
            AdminDeptOut(
                name=leaf,
                org_levels=levels,
                korean_name=dept_index.name_ko_by_name.get(leaf, ""),
            )
        )

    return AdminDirectoryOut(users=users, departments=departments)


def _require_sysadmin(login_id: str) -> None:
    """공통 게이트 — sysadmin 아니면 403 / Shared gate: 403 unless sysadmin."""
    if not is_sysadmin(login_id):
        raise HTTPException(status_code=403, detail="sysadmin required")


@router.get("/ref-audit", response_model=RefAuditOut)
async def get_ref_audit(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefAuditOut:
    """sysadmin 전용 — 현 조직에 없는 부서·사용자를 참조하는 12곳 온디맨드 스캔 (design 2026-09-09)."""
    _require_sysadmin(login_id)
    departments, users = await ref_audit.scan_refs(session)
    return RefAuditOut(departments=departments, users=users, generated_at=now_kst())


@router.post("/ref-audit/remap", response_model=RefRemapOut)
async def post_ref_remap(
    payload: RefRemapIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefRemapOut:
    """sysadmin 전용 — 체크한 라인만 replace/remove. 검증 실패는 전체 422(부분 적용 없음)."""
    _require_sysadmin(login_id)
    try:
        result = await ref_audit.apply_remap(
            session, kind=payload.kind, from_value=payload.from_value, mode=payload.mode,
            to_value=payload.to_value, target_ids=payload.target_ids, actor=login_id,
        )
    except ref_audit.RemapError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await session.commit()
    return RefRemapOut(applied=result.applied, skipped=result.skipped)


@router.post("/ref-audit/notify", response_model=RefNotifyOut)
async def post_ref_notify(
    payload: RefNotifyIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> RefNotifyOut:
    """sysadmin 전용 — 노드/SP 낡은 참조를 맵 오너에게 오너당 1건으로 묶어 알린다."""
    _require_sysadmin(login_id)
    try:
        result = await ref_audit.send_fix_requests(session, payload.target_ids, login_id)
    except ref_audit.RemapError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await session.commit()
    return RefNotifyOut(recipients=result.recipients, maps=result.maps, skipped_maps=result.skipped_maps)


@router.get("/batch-runs", response_model=list[BatchRunOut])
async def list_batch_runs(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[BatchJobRun]:
    """sysadmin 전용 — 배치 작업(백업·인원동기화) 잡·결과별 최신 실행 기록."""
    _require_sysadmin(login_id)
    rows = (await session.execute(select(BatchJobRun))).scalars().all()
    return list(rows)


# HR 동기화 이력 목록 크기 — 탭에는 최근 회차만 보인다(보존은 hr.history.HR_SYNC_HISTORY_KEEP)
HR_SYNC_HISTORY_PAGE = 30


@router.get("/hr-sync-runs", response_model=list[HrSyncRunOut])
async def list_hr_sync_runs(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[HrSyncRun]:
    """sysadmin 전용 — HR 전체 동기화 최근 회차 요약(최신순). 바뀐 사람 목록은 회차 상세에서."""
    _require_sysadmin(login_id)
    rows = await session.scalars(
        select(HrSyncRun).order_by(HrSyncRun.id.desc()).limit(HR_SYNC_HISTORY_PAGE)
    )
    return list(rows)


@router.get("/hr-sync-runs/{run_id}", response_model=HrSyncRunDetailOut)
async def get_hr_sync_run(
    run_id: int,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> HrSyncRun:
    """sysadmin 전용 — HR 동기화 회차 1건 + 신규·퇴직·재입사·삭제·중복 인원."""
    _require_sysadmin(login_id)
    run = await session.get(HrSyncRun, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail=f"hr sync run {run_id} not found")
    return run


# 백업 파일명 화이트리스트 — 사이드카 pg_dump(bpm-*.dump)·로컬 sqlite 사본(bpm-*.sqlite)만 노출.
# 경로 구분자가 못 들어가는 형식이라 다운로드 경로 탈출이 원천 차단된다.
_BACKUP_NAME_RE = re.compile(r"^bpm-\d{8}-\d{6}\.(dump|sqlite)$")
# 온디맨드 트리거 — 백엔드가 이 파일을 쓰면 db-backup 사이드카(≤5s 폴링)가 지우고 즉시 pg_dump 1회.
# 하위 디렉터리는 사이드카(root)가 1777로 만든다 — 비root backend가 root 소유 백업 디렉터리엔 못 쓴다 (H-9)
BACKUP_TRIGGER_DIRNAME = "requests"
BACKUP_TRIGGER_FILENAME = "backup.request"


def _get_backup_dir() -> Path:
    return Path(settings.backup_dir)


def _copy_sqlite(src: str, dest: Path) -> None:
    """sqlite 온라인 백업 — 파일 cp 대신 backup API(쓰기 중에도 일관 스냅샷)."""
    with sqlite3.connect(src) as source, sqlite3.connect(dest) as target:
        source.backup(target)


@router.get("/backups", response_model=list[BackupFileOut])
async def list_backups(login_id: str = Depends(get_current_user)) -> list[BackupFileOut]:
    """sysadmin 전용 — 백업 디렉터리의 다운로드 가능 파일 목록(최신순)."""
    _require_sysadmin(login_id)
    backup_dir = _get_backup_dir()
    if not backup_dir.is_dir():
        return []
    files = [
        BackupFileOut(
            filename=path.name,
            size=path.stat().st_size,
            modified_at=datetime.fromtimestamp(path.stat().st_mtime, tz=KST),
        )
        for path in backup_dir.iterdir()
        if _BACKUP_NAME_RE.match(path.name)
    ]
    return sorted(files, key=lambda f: f.filename, reverse=True)


@router.post("/backups/run", response_model=BackupRunOut)
async def run_backup_now(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BackupRunOut:
    """sysadmin 전용 — 온디맨드 백업. sqlite=즉시 사본 생성, postgres=사이드카 트리거 파일 기록."""
    _require_sysadmin(login_id)
    backup_dir = _get_backup_dir()
    backup_dir.mkdir(parents=True, exist_ok=True)
    if settings.database_url.startswith("sqlite"):
        src = settings.database_url.rsplit("///", 1)[-1]
        filename = f"bpm-{now_kst():%Y%m%d-%H%M%S}.sqlite"
        dest = backup_dir / filename
        try:
            await asyncio.to_thread(_copy_sqlite, src, dest)
        except Exception as exc:
            dest.unlink(missing_ok=True)
            await record_batch_run(session, "db_backup", "failure", f"on-demand: {exc}")
            raise HTTPException(status_code=500, detail=f"backup failed: {exc}") from exc
        await record_batch_run(
            session, "db_backup", "success", f"{filename} (on-demand by {login_id})"
        )
        return BackupRunOut(status="completed", filename=filename)
    # postgres — pg_dump는 db와 버전이 맞는 사이드카가 수행(트리거 소비·검증·기록까지)
    trigger = backup_dir / BACKUP_TRIGGER_DIRNAME / BACKUP_TRIGGER_FILENAME
    try:
        trigger.write_text(f"{login_id} {now_kst().isoformat()}\n")
    except OSError as exc:
        # 사이드카가 아직 새 스크립트로 안 떴거나(요청 디렉터리 없음) 권한이 바뀐 경우 — 500 대신 원인과 조치를 알린다
        await record_batch_run(session, "db_backup", "failure", f"on-demand trigger not writable: {exc}")
        raise HTTPException(
            status_code=503,
            detail=f"backup request could not be written to {trigger.parent} ({exc.strerror}) - "
            "restart the db-backup service (docs/deploy/backup.md 2.5)",
        ) from exc
    return BackupRunOut(status="requested")


@router.get("/backups/{filename}")
async def download_backup(
    filename: str, login_id: str = Depends(get_current_user)
) -> FileResponse:
    """sysadmin 전용 — 백업 파일 다운로드(사이드카 덤프를 관리자 로컬 PC로 내려받기)."""
    _require_sysadmin(login_id)
    if not _BACKUP_NAME_RE.match(filename):
        raise HTTPException(status_code=404, detail="unknown backup file")
    path = _get_backup_dir() / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="unknown backup file")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")


@router.get("/tables", response_model=list[TableInfoOut])
async def list_tables(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[TableInfoOut]:
    """sysadmin 전용 — 등록된 모든 테이블 이름 + 행수(읽기전용 COUNT). 뷰어 선택 pill 표시용.

    Sysadmin-only. Names come from SQLAlchemy metadata (no DDL, no schema change);
    each count is a plain SELECT COUNT(*).
    """
    _require_sysadmin(login_id)
    out: list[TableInfoOut] = []
    for name in sorted(Base.metadata.tables.keys()):
        table = Base.metadata.tables[name]
        count = (await session.execute(select(func.count()).select_from(table))).scalar_one()
        out.append(TableInfoOut(name=name, count=count))
    return out


@router.get("/tables/{name}", response_model=TableDataOut)
async def read_table(
    name: str,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    page: int = Query(1, ge=1),
    size: int = Query(DEFAULT_PAGE_SIZE, ge=1, le=MAX_PAGE_SIZE),
    sort: str | None = Query(None),
    order: str = Query("asc"),
    q: str | None = Query(None),
) -> TableDataOut:
    """sysadmin 전용 — 선택 테이블의 행을 서버측 페이징/정렬/필터로 반환 (읽기전용 SELECT).

    Sysadmin-only, read-only. Safe by construction: table & sort columns are validated
    against SQLAlchemy metadata; `q` is bound (no SQL injection); only SELECT is issued.
    """
    _require_sysadmin(login_id)

    # 테이블명 검증 — 메타데이터에 있는 테이블만 (임의 SQL 차단) / validate against metadata.
    table = Base.metadata.tables.get(name)
    if table is None:
        raise HTTPException(status_code=404, detail="unknown table")

    columns = [c.name for c in table.columns]

    # 필터 — 문자열 컬럼에 대해서만 ILIKE(OR). q는 바인드 파라미터 / text-column ILIKE, q is bound.
    where = _build_filter(table, q)

    count_stmt = select(func.count()).select_from(table)
    if where is not None:
        count_stmt = count_stmt.where(where)
    total = (await session.execute(count_stmt)).scalar_one()

    stmt = select(table)
    if where is not None:
        stmt = stmt.where(where)
    # 정렬 — sort 컬럼은 실제 컬럼만 허용, 아니면 PK(없으면 무정렬) / validate sort col.
    if sort and sort in columns:
        col = table.c[sort]
        stmt = stmt.order_by(desc(col) if order == "desc" else asc(col))
    elif table.primary_key.columns:
        stmt = stmt.order_by(*table.primary_key.columns)
    stmt = stmt.limit(size).offset((page - 1) * size)

    result = (await session.execute(stmt)).mappings().all()
    rows = [_build_row(name, row, columns) for row in result]
    return TableDataOut(columns=columns, rows=rows, total=total, page=page, size=size)


def _render_cell(value: object) -> object:
    """행 값 → JSON 직렬화 가능 값. 바이너리(kb_chunks.embedding 등)는 크기 표시로 대체 — 500 방지."""
    if isinstance(value, (bytes, memoryview)):
        return f"<binary {len(value)} bytes>"
    return value


_FORMULA_LEAD_RE = re.compile(r"'*[=+\-@\t\r]")


def _escape_csv_cell(value: str) -> str:
    """CSV 셀 이스케이프 — FE `lib/csv.ts` escapeCsvCell과 동치(byte-for-byte) 유지 필수.

    1) 수식 인젝션 가드: `=`/`+`/`-`/`@`/TAB/CR로 시작하면(앞에 `'`가 몇 개 있어도) `'` 1개 접두(Excel/Sheets가 수식으로 안 읽음).
    2) 쉼표·따옴표·CR·LF 포함 시에만 `"..."` 인용, 내부 `"`는 `""`로 이중화.
    """
    guarded = f"'{value}" if _FORMULA_LEAD_RE.match(value) else value
    if any(ch in guarded for ch in (",", '"', "\r", "\n")):
        return '"' + guarded.replace('"', '""') + '"'
    return guarded


def _stringify_csv_value(value: object) -> str:
    """CSV 셀 값 → 문자열. JSON 컬럼(dict/list)은 json.dumps, bool은 소문자 true/false —
    뷰어(JSON.stringify) 출력과 동치 유지(`_render_cell`의 JSON 직렬화 경로는 건드리지 않음)."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _build_csv_row(values: list[object]) -> str:
    """값 리스트 → CRLF로 끝나는 한 줄 CSV(각 셀은 `_stringify_csv_value`+`_escape_csv_cell`로 변환)."""
    cells = [_escape_csv_cell(_stringify_csv_value(v)) for v in values]
    return ",".join(cells) + "\r\n"


@router.get("/tables/{name}/export")
async def export_table_csv(
    name: str,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    sort: str | None = Query(None),
    order: str = Query("asc"),
    q: str | None = Query(None),
) -> StreamingResponse:
    """sysadmin 전용 — 선택 테이블 전체 행을 CSV로 스트리밍(읽기전용, 페이징 없음).

    read_table과 동일한 게이트·테이블명 검증·정렬/필터를 적용하되 전체 행을 낸다.
    BOM은 붙이지 않음(FE downloadCsv가 접두 — 이중 BOM 방지). 500행 배치 fetch로 메모리 바운드.
    """
    _require_sysadmin(login_id)

    # 테이블명 검증 — 메타데이터에 있는 테이블만 (임의 SQL 차단) / validate against metadata.
    table = Base.metadata.tables.get(name)
    if table is None:
        raise HTTPException(status_code=404, detail="unknown table")

    columns = [c.name for c in table.columns]

    # 필터 — 문자열 컬럼에 대해서만 ILIKE(OR). q는 바인드 파라미터 / text-column ILIKE, q is bound.
    where = _build_filter(table, q)

    stmt = select(table)
    if where is not None:
        stmt = stmt.where(where)
    # 정렬 — sort 컬럼은 실제 컬럼만 허용, 아니면 PK(없으면 무정렬) / validate sort col.
    # PK를 항상 타이브레이커로 덧붙인다 — sort 컬럼에 동값이 많으면(예: role) OFFSET 배치마다
    # DB가 동값 그룹 내 순서를 다르게 낼 수 있어, 배치 경계에서 행이 중복되거나 누락된다.
    if sort and sort in columns:
        col = table.c[sort]
        sort_expr = desc(col) if order == "desc" else asc(col)
        stmt = stmt.order_by(sort_expr, *table.primary_key.columns)
    elif table.primary_key.columns:
        stmt = stmt.order_by(*table.primary_key.columns)

    async def _stream_rows() -> AsyncIterator[str]:
        yield _build_csv_row(columns)
        offset = 0
        while True:
            batch = (
                await session.execute(stmt.limit(EXPORT_BATCH_SIZE).offset(offset))
            ).mappings().all()
            if not batch:
                break
            for row in batch:
                yield _build_csv_row(list(_build_row(name, row, columns).values()))
            if len(batch) < EXPORT_BATCH_SIZE:
                break
            offset += EXPORT_BATCH_SIZE

    return StreamingResponse(
        _stream_rows(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'},
    )


def _build_kst_range(from_date: date, to_date: date) -> tuple[datetime, datetime]:
    """[from 00:00, to+1일 00:00) KST — to 날짜 하루 전체 포함."""
    start = datetime.combine(from_date, time.min, tzinfo=KST)
    end = datetime.combine(to_date + timedelta(days=1), time.min, tzinfo=KST)
    return start, end


@router.get("/notifications/purge-preview", response_model=list[NotificationPurgeGroupOut])
async def preview_notification_purge(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    from_date: date = Query(alias="from"),
    to_date: date = Query(alias="to"),
) -> list[NotificationPurgeGroupOut]:
    """sysadmin 전용 — 기간 내 알림을 (type, message)로 묶어 검토 목록 반환 (last_at desc)."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(from_date, to_date)
    rows = await session.execute(
        select(
            Notification.type,
            Notification.message,
            func.count(),
            func.min(Notification.created_at),
            func.max(Notification.created_at),
        )
        .where(Notification.created_at >= start, Notification.created_at < end)
        .group_by(Notification.type, Notification.message)
        .order_by(func.max(Notification.created_at).desc())
    )
    return [
        NotificationPurgeGroupOut(type=r[0], message=r[1], count=r[2], first_at=r[3], last_at=r[4])
        for r in rows.all()
    ]


@router.post("/notifications/purge", response_model=NotificationBulkDeleteOut)
async def purge_notifications(
    payload: NotificationPurgeIn,
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """sysadmin 전용 — 확정된 (type, message) 묶음의 기간 내 전 수신자 행 하드 삭제."""
    _require_sysadmin(login_id)
    start, end = _build_kst_range(payload.from_date, payload.to_date)
    group_match = or_(
        *[
            and_(Notification.type == g.type, Notification.message == g.message)
            for g in payload.groups
        ]
    )
    result = await session.execute(
        delete(Notification).where(
            Notification.created_at >= start, Notification.created_at < end, group_match
        )
    )
    await session.commit()
    return NotificationBulkDeleteOut(deleted=max(result.rowcount, 0))


@router.post("/feedback-notes/purge-archived", response_model=NotificationBulkDeleteOut)
async def purge_archived_feedback_notes(
    login_id: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> NotificationBulkDeleteOut:
    """sysadmin 전용 — 아카이브된 피드백 노트를 이력째 영구 삭제.

    앱에서 노트 삭제는 아카이브까지만 — 되돌릴 수 없는 삭제는 이 관리자 경로에서만 (알림 퍼지와 동일 관례).
    """
    _require_sysadmin(login_id)
    note_ids = list(
        await session.scalars(
            select(FeedbackNote.id).where(FeedbackNote.archived_at.is_not(None))
        )
    )
    if not note_ids:
        return NotificationBulkDeleteOut(deleted=0)
    # sqlite는 FK CASCADE 기본 비활성 — 이력을 먼저 지운다
    await session.execute(
        delete(FeedbackNoteRevision).where(FeedbackNoteRevision.note_id.in_(note_ids))
    )
    result = await session.execute(delete(FeedbackNote).where(FeedbackNote.id.in_(note_ids)))
    await session.commit()
    return NotificationBulkDeleteOut(deleted=max(result.rowcount, 0))
