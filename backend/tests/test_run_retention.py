"""실행 체크(Run) 하루 한 번 정리 잡 — 방치 알림·자동 중단·요약 전환과 새벽 스케줄 루프 (design 2026-11-04 §4.6)."""

import asyncio
import itertools
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import clock
from app.batch_runs import JOB_RUN_RETENTION
from app.db import SessionLocal
from app.models import BatchJobRun, Notification, ProcessMap, Run, RunComment, RunEvent, RunNodeState, RunScope
from app.run_retention import (
    RetentionResult,
    get_seconds_until_kst,
    run_run_retention,
)
from tests.run_helpers import as_user, load_case_graph, seed_published_map

_names = itertools.count(1)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"run-retention {label} {next(_names)}"


def _user(label: str) -> str:
    # 알림·개인 실행 상한이 테스트끼리 쌓이지 않게 테스트마다 새 사용자를 쓴다
    return f"ret.{label}.{next(_names)}"


def _seed(client: TestClient, monkeypatch: pytest.MonkeyPatch, label: str) -> dict:
    return seed_published_map(
        client, monkeypatch, graph=load_case_graph("linear"), name=_unique(label), visibility="public"
    )


def _create_run(
    client: TestClient, seeded: dict, starter: str, *, scope: str = "solo", participants: list[str] | None = None
) -> dict:
    body = {"name": "LOT-9", "version_id": seeded["version_id"], "scope": scope, "participants": participants or []}
    res = client.post(f"/api/maps/{seeded['map_id']}/runs", json=body, headers=as_user(client, starter))
    assert res.status_code == 201, res.text
    return res.json()


def _call(client: TestClient, method: str, path: str, user: str, **kwargs: Any):
    return client.request(method, f"/api{path}", headers=as_user(client, user), **kwargs)


def _read_db(work: Callable) -> Any:
    async def _run() -> Any:
        async with SessionLocal() as session:
            return await work(session)

    return asyncio.run(_run())


def _write_db(work: Callable) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            await work(session)
            await session.commit()

    asyncio.run(_run())


def _set_run_fields(run_id: int, **fields: object) -> None:
    async def _work(session) -> None:
        run = await session.get(Run, run_id)
        for key, value in fields.items():
            setattr(run, key, value)

    _write_db(_work)


def _read_run(run_id: int) -> dict:
    async def _work(session) -> dict:
        run = await session.get(Run, run_id)
        return {c.name: getattr(run, c.name) for c in Run.__table__.columns}

    return _read_db(_work)


def _run_job() -> RetentionResult:
    async def _work(session) -> RetentionResult:
        return await run_run_retention(session, clock.now())

    return _read_db(_work)


def _count_rows(model: type, run_id: int) -> int:
    async def _work(session) -> int:
        return await session.scalar(select(func.count()).select_from(model).where(model.run_id == run_id))

    return _read_db(_work)


def _count_events(run_id: int, action: str) -> int:
    async def _work(session) -> int:
        return await session.scalar(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id, RunEvent.action == action)
        )

    return _read_db(_work)


def _notices(login: str, type_: str) -> list[dict]:
    async def _work(session) -> list[dict]:
        rows = await session.scalars(
            select(Notification)
            .where(Notification.recipient == login, Notification.type == type_)
            .order_by(Notification.id)
        )
        return [{"payload": n.payload, "message": n.message} for n in rows.all()]

    return _read_db(_work)


def _as_kst(stamp: datetime) -> datetime:
    """sqlite는 시각의 시간대를 떼고 돌려준다 — 같은 KST 벽시계로 보고 비교한다."""
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=clock.KST)


def _is_about(stamp: datetime, expected: datetime) -> bool:
    return abs(_as_kst(stamp) - expected) < timedelta(minutes=1)


def _days_ago(days: int) -> datetime:
    return clock.now() - timedelta(days=days, minutes=5)  # 경계에서 흔들리지 않게 5분 더 지난 것으로


@pytest.fixture
def set_limits(client: TestClient) -> Iterator[Callable[..., None]]:
    """방치·요약 일수를 바꾸고 끝나면 기본값으로 되돌린다."""

    def _set(**limits: int) -> None:
        res = client.put("/api/admin/app-settings", json=limits)
        assert res.status_code == 200, res.text

    yield _set
    client.put(
        "/api/admin/app-settings", json={"run_idle_warn_days": 30, "run_idle_stop_days": 40, "run_summary_days": 30}
    )


# ── 스케줄 시각 ──


def test_seconds_until_kst() -> None:
    day = datetime(2026, 11, 4, tzinfo=clock.KST)
    assert get_seconds_until_kst(3, 30, day.replace(hour=2)) == 5400.0
    assert get_seconds_until_kst(3, 30, day.replace(hour=3, minute=30)) == 86400.0  # 정각이면 다음 날
    assert get_seconds_until_kst(3, 30, day.replace(hour=23)) == 16200.0
    # 다른 시간대로 들어와도 KST 벽시계로 센다 (UTC 17:00 = KST 02:00)
    utc_now = datetime(2026, 11, 3, 17, 0, tzinfo=timezone.utc)
    assert get_seconds_until_kst(3, 30, utc_now) == 5400.0


def test_retention_result_detail() -> None:
    assert RetentionResult(warned=2, stopped=1, summarized=3).format_detail() == "warned 2 · stopped 1 · summarized 3"


# ── 방치 알림 · 자동 중단 ──


def test_idle_warning_then_auto_stop(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "idle then stop")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    _set_run_fields(run["id"], last_activity_at=_days_ago(31))

    first = _run_job()
    assert first.warned >= 1
    for login in (starter, member):
        warnings = _notices(login, "run_idle_warning")
        assert len(warnings) == 1 and warnings[0]["payload"]["days"] == 10  # 40 - 30
    assert _read_run(run["id"])["idle_warned_at"] is not None
    assert _read_run(run["id"])["status"] == "open"

    _run_job()  # 두 번째 실행은 같은 실행을 다시 알리지 않는다
    assert len(_notices(starter, "run_idle_warning")) == 1

    _set_run_fields(run["id"], last_activity_at=_days_ago(41))
    _run_job()
    stopped = _read_run(run["id"])
    assert (stopped["status"], stopped["end_reason"]) == ("stopped", "auto_stopped")
    assert _is_about(stopped["ended_at"], clock.now())
    assert _is_about(stopped["summarize_after"], clock.now() + timedelta(days=30))
    assert _count_events(run["id"], "auto_stop") == 1
    for login in (starter, member):  # 자동 중단은 참여자 모두에게, 행동한 사람 없이 간다
        notice = _notices(login, "run_stopped")
        assert len(notice) == 1 and notice[0]["payload"]["auto"] is True and notice[0]["payload"]["actor"] is None

    async def _actors(session) -> list[str | None]:
        rows = await session.scalars(
            select(RunEvent.actor).where(RunEvent.run_id == run["id"], RunEvent.action == "auto_stop")
        )
        return list(rows.all())

    assert _read_db(_actors) == [None]
    _run_job()  # 끝난 실행은 다시 멈추거나 알리지 않는다
    assert _count_events(run["id"], "auto_stop") == 1 and len(_notices(starter, "run_stopped")) == 1


def test_solo_run_gets_idle_warning_but_no_stop_notice(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "solo idle")
    starter = _user("solo")
    run = _create_run(client, seeded, starter)
    _set_run_fields(run["id"], last_activity_at=_days_ago(31))
    _run_job()
    assert len(_notices(starter, "run_idle_warning")) == 1  # 개인 실행은 방치 알림만 본인에게 간다

    _set_run_fields(run["id"], last_activity_at=_days_ago(41))
    _run_job()
    assert _read_run(run["id"])["end_reason"] == "auto_stopped"
    assert _notices(starter, "run_stopped") == []


def test_overdue_run_stops_without_a_warning(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """잡이 쉰 사이 40일을 넘긴 실행은 경고 없이 바로 멈춘다 (경고 직후 중단 알림이 가는 모순을 막는다)."""
    seeded = _seed(client, monkeypatch, "overdue")
    starter = _user("starter")
    run = _create_run(client, seeded, starter, scope="shared")
    _set_run_fields(run["id"], last_activity_at=_days_ago(41))

    _run_job()

    assert _read_run(run["id"])["end_reason"] == "auto_stopped"
    assert _notices(starter, "run_idle_warning") == []
    assert len(_notices(starter, "run_stopped")) == 1


def test_stop_never_comes_before_warning(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_limits: Callable[..., None]
) -> None:
    """설정이 중단 <= 경고여도 자동 중단은 경고 다음 날부터다 (R8: 중단 일수 = max(중단, 경고 + 1))."""
    seeded = _seed(client, monkeypatch, "stop le warn")
    starter = _user("starter")
    run = _create_run(client, seeded, starter)
    set_limits(run_idle_warn_days=30, run_idle_stop_days=20)
    _set_run_fields(run["id"], last_activity_at=_days_ago(30))

    _run_job()
    assert _read_run(run["id"])["status"] == "open"
    warnings = _notices(starter, "run_idle_warning")
    assert len(warnings) == 1 and warnings[0]["payload"]["days"] == 1

    _set_run_fields(run["id"], last_activity_at=_days_ago(31))
    _run_job()
    assert _read_run(run["id"])["end_reason"] == "auto_stopped"


def test_touch_resets_idle_warning(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "touch resets")
    starter = _user("starter")
    run = _create_run(client, seeded, starter)
    _set_run_fields(run["id"], last_activity_at=_days_ago(31))
    _run_job()
    assert _read_run(run["id"])["idle_warned_at"] is not None

    comment = {"scope_path": "", "node_id": seeded["ids"]["a"], "body": "still on it"}
    assert _call(client, "POST", f"/runs/{run['id']}/comments", starter, json=comment).status_code == 201

    after = _read_run(run["id"])
    assert after["idle_warned_at"] is None and _is_about(after["last_activity_at"], clock.now())
    _run_job()  # 다시 손댄 실행은 새로 방치될 때까지 알림이 없다
    assert len(_notices(starter, "run_idle_warning")) == 1


# ── 요약 ──


def test_summary_after_countdown(client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]) -> None:
    seeded = _seed(client, monkeypatch, "summary")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    a = seeded["ids"]["a"]
    action = {"scope_path": "", "node_id": a, "action": "problem"}
    assert _call(client, "POST", f"/runs/{run['id']}/actions", member, json=action).status_code == 200
    comment = {"scope_path": "", "node_id": a, "body": "supplier is late"}
    assert _call(client, "POST", f"/runs/{run['id']}/comments", starter, json=comment).status_code == 201
    assert _call(client, "POST", f"/runs/{run['id']}/stop", starter).status_code == 200
    assert _count_rows(RunNodeState, run["id"]) == 1 and _count_rows(RunComment, run["id"]) == 1

    _run_job()  # 요약 예정일 전에는 그대로
    assert _read_run(run["id"])["status"] == "stopped"

    created = _read_run(run["id"])["created_at"]
    _set_run_fields(
        run["id"],
        ended_at=_as_kst(created) + timedelta(days=2),  # 시작 날 + 2일 = 3일째에 끝남
        summarize_after=clock.now() - timedelta(minutes=5),
    )
    _run_job()

    summarized = _read_run(run["id"])
    assert summarized["status"] == "summarized"
    summary = summarized["summary"]
    assert summary["result"] == "stopped"
    assert summary["problem_steps"] == 1
    assert summary["days"] == 3
    assert summary["participants"] == [starter, member] and summary["starter"] == starter
    assert summary["version_number"] == 1 and isinstance(summary["version_label"], str)
    assert summary["started_at"] == _as_kst(created).astimezone(clock.KST).isoformat()
    assert summary["ended_at"] == (_as_kst(created) + timedelta(days=2)).astimezone(clock.KST).isoformat()
    for model in (RunNodeState, RunComment, RunEvent, RunScope):
        assert _count_rows(model, run["id"]) == 0, model.__name__
    reopened = _call(client, "POST", f"/runs/{run['id']}/reopen", starter)
    assert (reopened.status_code, reopened.json()["detail"]) == (409, "summarized runs cannot reopen")
    detail = _call(client, "GET", f"/runs/{run['id']}", starter)
    assert detail.status_code == 200 and detail.json()["summary"]["problem_steps"] == 1


def test_done_run_summary_result_is_completed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "done summary")
    starter = _user("starter")
    run = _create_run(client, seeded, starter)
    for node in ("a", "b"):
        body = {"scope_path": "", "node_id": seeded["ids"][node], "action": "complete"}
        assert _call(client, "POST", f"/runs/{run['id']}/actions", starter, json=body).status_code == 200
    assert _read_run(run["id"])["status"] == "done"

    _set_run_fields(run["id"], summarize_after=clock.now() - timedelta(minutes=5))
    _run_job()

    summarized = _read_run(run["id"])
    assert summarized["status"] == "summarized"
    assert summarized["summary"]["result"] == "completed" and summarized["summary"]["days"] == 1
    assert summarized["summary"]["problem_steps"] == 0


def test_kept_run_not_summarized(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "kept")
    starter = _user("starter")
    run = _create_run(client, seeded, starter)
    assert _call(client, "PATCH", f"/runs/{run['id']}", starter, json={"keep": True}).status_code == 200
    assert _call(client, "POST", f"/runs/{run['id']}/stop", starter).status_code == 200
    _set_run_fields(run["id"], summarize_after=clock.now() - timedelta(days=1))  # 보존 전 예정일이 남은 경우도 막는다

    _run_job()
    assert _read_run(run["id"])["status"] == "stopped"

    # 보존인 채로 방치돼 자동 중단돼도 기록은 남고 요약 예정일은 없다
    other = _create_run(client, seeded, starter)
    assert _call(client, "PATCH", f"/runs/{other['id']}", starter, json={"keep": True}).status_code == 200
    _set_run_fields(other["id"], last_activity_at=_days_ago(41))
    _run_job()
    auto = _read_run(other["id"])
    assert (auto["status"], auto["end_reason"], auto["summarize_after"]) == ("stopped", "auto_stopped", None)


# ── 휴지통 맵 ──


def test_runs_on_trashed_maps_are_skipped(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "trashed")
    starter = _user("starter")
    stale = _create_run(client, seeded, starter)
    ended = _create_run(client, seeded, starter)
    assert _call(client, "POST", f"/runs/{ended['id']}/stop", starter).status_code == 200
    _set_run_fields(stale["id"], last_activity_at=_days_ago(41))
    _set_run_fields(ended["id"], summarize_after=clock.now() - timedelta(days=1))

    async def _trash(session, deleted_at: datetime | None) -> None:
        (await session.get(ProcessMap, seeded["map_id"])).deleted_at = deleted_at

    _write_db(lambda session: _trash(session, clock.now()))
    try:
        _run_job()
        assert _read_run(stale["id"])["status"] == "open" and _read_run(stale["id"])["idle_warned_at"] is None
        assert _read_run(ended["id"])["status"] == "stopped"
        assert _notices(starter, "run_idle_warning") == [] and _notices(starter, "run_stopped") == []
    finally:
        _write_db(lambda session: _trash(session, None))

    _run_job()  # 휴지통에서 돌아오면 다음 회차가 처리한다
    assert _read_run(stale["id"])["end_reason"] == "auto_stopped"
    assert _read_run(ended["id"])["status"] == "summarized"


# ── 스케줄 루프 ──


def test_loop_records_batch_run(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import main as main_mod

    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) > 1:
            raise asyncio.CancelledError  # 한 바퀴 돈 뒤 루프 탈출

    monkeypatch.setattr(main_mod.asyncio, "sleep", fake_sleep)

    async def _drive() -> None:
        try:
            await main_mod._run_run_retention_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_drive())

    assert len(sleeps) == 2 and 0 < sleeps[0] <= 86400  # 다음 새벽 3시 30분까지

    async def _row(session) -> BatchJobRun | None:
        return await session.get(BatchJobRun, (JOB_RUN_RETENTION, "success"))

    row = _read_db(_row)
    assert row is not None and row.detail.startswith("warned ")


def test_loop_records_failure_and_survives(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import main as main_mod

    calls = {"n": 0}

    async def fake_sleep(_seconds: float) -> None:
        calls["n"] += 1
        if calls["n"] > 2:
            raise asyncio.CancelledError

    async def boom(session, now):
        raise RuntimeError("retention exploded")

    monkeypatch.setattr(main_mod.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(main_mod, "run_run_retention", boom)

    async def _drive() -> None:
        try:
            await main_mod._run_run_retention_loop()
        except asyncio.CancelledError:
            pass

    asyncio.run(_drive())

    assert calls["n"] == 3  # 첫 회차가 실패해도 다음 새벽을 다시 기다린다

    async def _row(session) -> BatchJobRun | None:
        return await session.get(BatchJobRun, (JOB_RUN_RETENTION, "failure"))

    row = _read_db(_row)
    assert row is not None and row.detail == "retention exploded"
