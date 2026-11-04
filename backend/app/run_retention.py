"""실행 체크(Run) 하루 한 번 정리 — 방치 알림 · 자동 중단 · 끝난 실행의 한 줄 요약 전환. `main.py` lifespan 루프가 새벽에 부른다.

설계: 2026-11-04-run-check-design.md §4.6(보존과 정리).
휴지통 맵의 실행은 건너뛴다(복구되면 다음 회차가 처리). 각 단계는 자기 일을 커밋하고, 행 잠금에 걸린 실행(사용자가 만지는 중)은
건너뛰어 다음 날로 미룬다(postgres `SKIP LOCKED`, sqlite는 잠금 문구 없음).
"""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import Select, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import RunLimits, get_run_limits
from app.clock import convert_to_kst
from app.models import (
    MapVersion,
    ProcessMap,
    Run,
    RunComment,
    RunEvent,
    RunNodeState,
    RunParticipant,
    RunScope,
)
from app.run_notify import notify_idle_warning, notify_stopped

RETENTION_HOUR_KST = 3  # DB 백업(04:00 KST)과 겹치지 않는 새벽
RETENTION_MINUTE_KST = 30

_ENDED_STATUSES = ("done", "stopped")
_SUMMARIZED_TABLES = (RunNodeState, RunComment, RunEvent, RunScope)  # 요약 때 지우는 세부 기록


@dataclass(frozen=True)
class RetentionResult:
    warned: int
    stopped: int
    summarized: int

    def format_detail(self) -> str:
        """설정 Batch jobs 탭에 보이는 한 줄."""
        return f"warned {self.warned} · stopped {self.stopped} · summarized {self.summarized}"


def get_seconds_until_kst(hour: int, minute: int, now: datetime) -> float:
    """다음 KST hh:mm까지 남은 초 — 지금이 정확히 그 시각이면 다음 날(86400). KST는 서머타임이 없어 일 단위 덧셈이 안전하다."""
    local = convert_to_kst(now)
    target = local.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return (target - local).total_seconds()


def _select_live_runs(*conditions) -> Select:
    """휴지통 맵이 아닌 실행 — 다른 요청이 잡고 있는 행은 건너뛴다(기다리지 않는다)."""
    return (
        select(Run)
        .join(ProcessMap, ProcessMap.id == Run.map_id)
        .where(ProcessMap.deleted_at.is_(None), *conditions)
        .order_by(Run.id)
        .with_for_update(skip_locked=True, of=Run)
    )


async def _warn_idle_runs(session: AsyncSession, now: datetime, limits: RunLimits, stop_days: int) -> int:
    """경고 일수를 넘긴 열린 실행에 방치 알림을 한 번 보낸다 — 이번 회차에 멈출 실행은 경고하지 않는다(경고 직후 중단 알림이 가는 모순)."""
    runs = await session.scalars(
        _select_live_runs(
            Run.status == "open",
            Run.idle_warned_at.is_(None),
            Run.last_activity_at <= now - timedelta(days=limits.idle_warn_days),
            Run.last_activity_at > now - timedelta(days=stop_days),
        )
    )
    warned = runs.all()
    for run in warned:
        await notify_idle_warning(session, run, stop_days - limits.idle_warn_days)
        run.idle_warned_at = now
    await session.commit()
    return len(warned)


async def _stop_idle_runs(session: AsyncSession, now: datetime, limits: RunLimits, stop_days: int) -> int:
    """중단 일수를 넘긴 열린 실행을 자동 중단한다 — 직접 중단과 같이 끝난 실행으로 가고, 보존이면 요약 예정일이 없다."""
    runs = await session.scalars(
        _select_live_runs(Run.status == "open", Run.last_activity_at <= now - timedelta(days=stop_days))
    )
    stopped = runs.all()
    for run in stopped:
        run.status = "stopped"
        run.end_reason = "auto_stopped"
        run.ended_at = now
        run.summarize_after = None if run.keep else now + timedelta(days=limits.summary_days)
        session.add(RunEvent(run_id=run.id, actor=None, action="auto_stop", created_at=now))
        await notify_stopped(session, run, None)
    await session.commit()
    return len(stopped)


async def _build_summary(session: AsyncSession, run: Run, now: datetime) -> dict:
    """요약 뒤에도 남기는 한 줄 집계 — 이름·결과·기간·기준 버전·문제 단계 수·참여자 (design §4.6)."""
    version = await session.get(MapVersion, run.version_id)
    logins = await session.scalars(
        select(RunParticipant.login_id).where(RunParticipant.run_id == run.id).order_by(RunParticipant.id)
    )
    problems = await session.execute(
        select(RunEvent.scope_path, RunEvent.node_id).where(RunEvent.run_id == run.id, RunEvent.action == "problem")
    )
    started = convert_to_kst(run.created_at)
    ended = convert_to_kst(run.ended_at or now)
    return {
        "result": run.end_reason,
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "days": (ended.date() - started.date()).days + 1,
        "version_number": version.version_number,
        "version_label": version.label,
        "problem_steps": len({(scope_path, node_id) for scope_path, node_id in problems.all()}),
        "participants": list(logins.all()),
        "starter": run.starter,
    }


async def _summarize_ended_runs(session: AsyncSession, now: datetime) -> int:
    """요약 예정일이 지난 끝난 실행의 세부 기록을 지우고 요약만 남긴다 — 보존 표시된 실행은 건너뛴다."""
    runs = await session.scalars(
        _select_live_runs(
            Run.status.in_(_ENDED_STATUSES), Run.keep.is_(False), Run.summarize_after <= now
        )
    )
    summarized = runs.all()
    for run in summarized:
        run.summary = await _build_summary(session, run, now)
        for table in _SUMMARIZED_TABLES:
            await session.execute(delete(table).where(table.run_id == run.id))
        run.status = "summarized"
    await session.commit()
    return len(summarized)


async def run_run_retention(session: AsyncSession, now: datetime) -> RetentionResult:
    """경고 → 자동 중단 → 요약 순으로 처리하고 커밋한다 — 자동 중단 실행은 요약 예정일이 미래라 같은 회차에 요약되지 않는다.

    자동 중단 일수는 경고 일수보다 하루 이상 뒤다(설정이 중단 <= 경고여도 경고 없이 멈추지 않는다).
    """
    now = convert_to_kst(now)
    limits = await get_run_limits(session)
    stop_days = max(limits.idle_stop_days, limits.idle_warn_days + 1)
    warned = await _warn_idle_runs(session, now, limits, stop_days)
    stopped = await _stop_idle_runs(session, now, limits, stop_days)
    summarized = await _summarize_ended_runs(session, now)
    return RetentionResult(warned=warned, stopped=stopped, summarized=summarized)
