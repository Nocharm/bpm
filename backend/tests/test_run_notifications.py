"""실행 체크(Run) 알림 — 7종·묶기·문제 메모·접근 필터·결재 알림 보호 (design 2026-11-04 §4.5)."""

import asyncio
import itertools
from collections.abc import Callable
from datetime import timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import clock, run_notify
from app.app_settings import DEFAULT_RUN_IDLE_STOP_DAYS
from app.db import SessionLocal
from app.models import Notification, Run
from app.workflow import NOTIFICATION_CAP, RUN_NOTIFICATION_PREFIX, create_notifications
from tests.run_helpers import as_user, load_case_graph, seed_published_map

_names = itertools.count(1)
EM_DASH = chr(0x2014)  # 알림 문구에 긴 대시를 쓰지 않는다 (사용자 지시)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"run-notify {label} {next(_names)}"


def _user(label: str) -> str:
    # 알림은 사람 단위로 쌓이므로 테스트마다 새 사용자를 쓴다(세션 공유 DB)
    return f"ntf.{label}.{next(_names)}"


def _seed(client: TestClient, monkeypatch: pytest.MonkeyPatch, shape: str, label: str, *, visibility: str = "public") -> dict:
    name = _unique(label)
    seeded = seed_published_map(client, monkeypatch, graph=load_case_graph(shape), name=name, visibility=visibility)
    return {**seeded, "name": name}


def _seed_sp_pair(client: TestClient, monkeypatch: pytest.MonkeyPatch, label: str) -> tuple[dict, dict]:
    """하위 맵(linear, 서브프로세스 지정)과 그 맵을 sp_exits의 q로 부르는 공개 바깥 맵 — (바깥, 하위)."""
    child = seed_published_map(
        client, monkeypatch, graph=load_case_graph("linear"), name=_unique(f"{label} child"), designate=True
    )
    graph = load_case_graph("sp_exits")
    next(n for n in graph["nodes"] if n["id"] == "q").update(node_type="subprocess", linked_map_id=child["map_id"])
    parent = seed_published_map(client, monkeypatch, graph=graph, name=_unique(f"{label} parent"), visibility="public")
    return parent, child


def _create_run(
    client: TestClient, seeded: dict, starter: str, *, scope: str = "shared", participants: list[str] | None = None
) -> dict:
    body = {"name": "LOT-7", "version_id": seeded["version_id"], "scope": scope, "participants": participants or []}
    res = client.post(f"/api/maps/{seeded['map_id']}/runs", json=body, headers=as_user(client, starter))
    assert res.status_code == 201, res.text
    return res.json()


def _call(client: TestClient, method: str, path: str, user: str, **kwargs: Any):
    return client.request(method, f"/api{path}", headers=as_user(client, user), **kwargs)


def _act(client: TestClient, run: dict, user: str, node_id: str, action: str, *, scope_path: str = "", **extra: Any):
    body = {"scope_path": scope_path, "node_id": node_id, "action": action, **extra}
    res = _call(client, "POST", f"/runs/{run['id']}/actions", user, json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _comment(client: TestClient, run: dict, user: str, node_id: str, body: str, *, scope_path: str = ""):
    res = _call(
        client, "POST", f"/runs/{run['id']}/comments", user, json={"scope_path": scope_path, "node_id": node_id, "body": body}
    )
    assert res.status_code == 201, res.text


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


def _rows(login: str, type_: str | None = None) -> list[dict]:
    """받는 사람의 알림 행(오래된 순)을 사전으로 — 세션이 닫혀도 읽을 수 있게 필요한 열만 옮긴다."""

    async def _work(session) -> list[dict]:
        query = select(Notification).where(Notification.recipient == login).order_by(Notification.id)
        if type_ is not None:
            query = query.where(Notification.type == type_)
        return [
            {
                "id": n.id,
                "type": n.type,
                "map_id": n.map_id,
                "version_id": n.version_id,
                "message": n.message,
                "payload": n.payload,
                "read": n.read,
            }
            for n in (await session.scalars(query)).all()
        ]

    return _read_db(_work)


def _members(seed_employee: Callable[..., None], *labels: str) -> list[str]:
    logins = [_user(label) for label in labels]
    for login in logins:
        seed_employee(login)
    return logins


def _only(login: str, type_: str) -> dict:
    rows = _rows(login, type_)
    assert len(rows) == 1, rows
    return rows[0]


# ── 묶기 · 대상 ──


def test_steps_done_grouped_per_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "grouped")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])

    _act(client, run, member, a, "complete")
    _act(client, run, member, b, "complete")

    row = _only(starter, "run_steps_done")
    assert (row["map_id"], row["version_id"]) == (seeded["map_id"], seeded["version_id"])  # 딥링크용 (R3)
    payload = row["payload"]
    assert (payload["count"], payload["node_title"], payload["actors"]) == (2, "검토", [member])
    assert (payload["run_id"], payload["run_name"], payload["actor"], payload["actor_name"]) == (
        run["id"],
        "LOT-7",
        member,
        member,
    )
    assert payload["map_name"] == seeded["name"]
    assert EM_DASH not in row["message"]


def test_steps_done_collects_actors_and_skips_the_actor(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "actors")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter = _user("starter")
    first, second = _members(seed_employee, "first", "second")
    run = _create_run(client, seeded, starter, participants=[first, second])

    _act(client, run, first, a, "complete")
    _act(client, run, second, b, "complete")

    mine = _only(starter, "run_steps_done")["payload"]
    assert (mine["count"], mine["actors"], mine["actor"]) == (2, [first, second], second)
    assert "1 more" in _only(starter, "run_steps_done")["message"]
    assert _only(first, "run_steps_done")["payload"]["actors"] == [second]  # 본인이 한 완료는 본인 행에 없다
    assert _only(second, "run_steps_done")["payload"]["actors"] == [first]


def test_actor_gets_no_notification(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "actor")
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])

    _act(client, run, member, seeded["ids"]["a"], "problem")
    _act(client, run, member, seeded["ids"]["a"], "resolve")
    _act(client, run, member, seeded["ids"]["a"], "complete")
    _act(client, run, member, seeded["ids"]["b"], "complete")  # 실행이 끝난다

    assert [n["type"] for n in _rows(member)] == ["run_invited"]  # 받은 것은 초대뿐 — 한 일의 알림은 없다
    assert {n["type"] for n in _rows(starter)} == {"run_problem", "run_resolved", "run_steps_done", "run_finished"}


def test_read_group_row_starts_a_new_row(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "read group")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])
    _act(client, run, member, a, "complete")

    first = _only(starter, "run_steps_done")

    async def _mark_read(session) -> None:
        (await session.get(Notification, first["id"])).read = True

    _write_db(_mark_read)
    _act(client, run, member, b, "complete")

    rows = _rows(starter, "run_steps_done")
    assert [(r["read"], r["payload"]["count"]) for r in rows] == [(True, 1), (False, 1)]


def test_muted_participant_skipped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "muted")
    starter = _user("starter")
    member, quiet = _members(seed_employee, "member", "quiet")
    run = _create_run(client, seeded, starter, participants=[member, quiet])
    assert _call(client, "PATCH", f"/runs/{run['id']}", quiet, json={"muted": True}).status_code == 200

    _act(client, run, member, seeded["ids"]["a"], "problem")

    assert len(_rows(starter, "run_problem")) == 1
    assert _rows(quiet, "run_problem") == []


def test_solo_run_sends_no_step_notifications(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "solo")
    starter = _user("solo")
    run = _create_run(client, seeded, starter, scope="solo")

    _act(client, run, starter, seeded["ids"]["a"], "problem")
    _act(client, run, starter, seeded["ids"]["a"], "resolve")
    _act(client, run, starter, seeded["ids"]["a"], "complete")
    _act(client, run, starter, seeded["ids"]["b"], "complete")  # 끝
    assert _call(client, "POST", f"/runs/{run['id']}/reopen", starter).status_code == 200
    assert _call(client, "POST", f"/runs/{run['id']}/stop", starter).status_code == 200

    assert _rows(starter) == []


def test_start_unstart_undo_and_loop_send_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "loop", "quiet actions")
    w, r, back = seeded["ids"]["w"], seeded["ids"]["r"], seeded["ids"]["h3"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])

    _act(client, run, member, w, "start")
    _act(client, run, member, w, "unstart")
    assert _rows(starter) == []
    _act(client, run, member, w, "complete")
    _act(client, run, member, w, "undo")
    _act(client, run, member, w, "complete")
    assert _only(starter, "run_steps_done")["payload"]["count"] == 2  # 완료 둘뿐, 취소는 세지 않는다
    _act(client, run, member, r, "complete", edge_id=back)  # 되돌아가는 갈래 = 루프

    assert _only(starter, "run_steps_done")["payload"]["count"] == 2
    assert [n["type"] for n in _rows(starter)] == ["run_steps_done"]


# ── 초대 · 문제 · 해결 · 끝 · 중단 ──


def test_invited_on_create_share_and_participants_add(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "invited")
    starter = _user("starter")
    first, second, third = _members(seed_employee, "first", "second", "third")

    created = _create_run(client, seeded, starter, participants=[first])
    solo = _create_run(client, seeded, _user("solo"), scope="solo")
    _call(client, "POST", f"/runs/{solo['id']}/share", solo["starter"], json={"participants": [second]})
    _call(client, "POST", f"/runs/{created['id']}/participants", starter, json={"add": [third, first]})

    invite = _only(first, "run_invited")
    assert (invite["map_id"], invite["version_id"]) == (seeded["map_id"], seeded["version_id"])
    assert (invite["payload"]["actor"], invite["payload"]["run_id"], invite["payload"]["run_name"]) == (
        starter,
        created["id"],
        "LOT-7",
    )
    assert _only(second, "run_invited")["payload"]["run_id"] == solo["id"]
    assert _only(third, "run_invited")["payload"]["run_id"] == created["id"]
    assert len(_rows(first, "run_invited")) == 1  # 이미 있던 참여자는 다시 초대하지 않는다
    assert _rows(starter) == [] and _rows(solo["starter"]) == []  # 초대한 본인에게는 가지 않는다


def test_problem_and_resolved_notify_with_node(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "problem")
    a = seeded["ids"]["a"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])

    _act(client, run, member, a, "problem")
    _act(client, run, member, a, "resolve")
    _act(client, run, member, a, "problem")

    problems = _rows(starter, "run_problem")
    assert len(problems) == 2  # 문제는 묶지 않고 하나씩 따로
    assert (problems[0]["map_id"], problems[0]["version_id"]) == (seeded["map_id"], seeded["version_id"])
    assert (problems[0]["payload"]["node_title"], problems[0]["payload"]["node_id"]) == ("접수", a)
    assert problems[0]["payload"]["scope_path"] == ""
    resolved = _only(starter, "run_resolved")
    assert (resolved["payload"]["node_title"], resolved["payload"]["actor"]) == ("접수", member)
    assert (resolved["map_id"], resolved["version_id"]) == (seeded["map_id"], seeded["version_id"])


def test_finished_and_stopped_notify_other_participants(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "end")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    done_run = _create_run(client, seeded, starter, participants=[member])
    stopped_run = _create_run(client, seeded, starter, participants=[member])

    _act(client, done_run, member, a, "complete")
    _act(client, done_run, member, b, "complete")
    assert _call(client, "POST", f"/runs/{stopped_run['id']}/stop", starter).status_code == 200

    finished = _only(starter, "run_finished")
    assert (finished["payload"]["run_id"], finished["payload"]["actor"]) == (done_run["id"], member)
    assert (finished["map_id"], finished["version_id"]) == (seeded["map_id"], seeded["version_id"])
    assert _rows(member, "run_finished") == []
    stopped = _only(member, "run_stopped")
    assert (stopped["payload"]["run_id"], stopped["payload"]["actor"], stopped["payload"]["auto"]) == (
        stopped_run["id"],
        starter,
        False,
    )
    assert _rows(starter, "run_stopped") == []


def test_auto_stop_goes_to_every_participant(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "auto stop")
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])

    async def _stop(session) -> None:
        await run_notify.notify_stopped(session, await session.get(Run, run["id"]), None)

    _write_db(_stop)

    for login in (starter, member):
        payload = _only(login, "run_stopped")["payload"]
        assert payload["auto"] is True and payload["days"] == DEFAULT_RUN_IDLE_STOP_DAYS and payload["actor"] is None


def test_idle_warning_for_solo_and_shared(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "idle")
    solo_user, starter = _user("solo"), _user("starter")
    member, quiet = _members(seed_employee, "member", "quiet")
    solo = _create_run(client, seeded, solo_user, scope="solo")
    shared = _create_run(client, seeded, starter, participants=[member, quiet])
    assert _call(client, "PATCH", f"/runs/{shared['id']}", quiet, json={"muted": True}).status_code == 200

    async def _warn(session) -> None:
        await run_notify.notify_idle_warning(session, await session.get(Run, solo["id"]), 10)
        await run_notify.notify_idle_warning(session, await session.get(Run, shared["id"]), 10)

    _write_db(_warn)

    assert _only(solo_user, "run_idle_warning")["payload"]["days"] == 10
    for login in (starter, member):
        row = _only(login, "run_idle_warning")
        assert (row["payload"]["run_id"], row["payload"]["days"]) == (shared["id"], 10)
        assert (row["map_id"], row["version_id"]) == (seeded["map_id"], seeded["version_id"])
    assert _rows(quiet, "run_idle_warning") == []


# ── 문제 메모 ──


def test_problem_note_attached_within_a_minute(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "note")
    a = seeded["ids"]["a"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])
    _act(client, run, member, a, "problem")

    _comment(client, run, starter, a, "not the one who flagged it")  # 표시한 사람이 아니면 붙지 않는다
    assert "snippet" not in _only(starter, "run_problem")["payload"]
    note = "가" * 130
    _comment(client, run, member, a, note)

    payload = _only(starter, "run_problem")["payload"]
    assert payload["snippet"] == "가" * 120
    assert payload["node_title"] == "접수"  # 다른 열은 그대로


def test_problem_note_not_attached_after_a_minute(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "late note")
    a = seeded["ids"]["a"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])
    _act(client, run, member, a, "problem")
    monkeypatch.setattr(run_notify, "now", lambda: clock.now() + timedelta(seconds=61))

    _comment(client, run, member, a, "too late")

    assert "snippet" not in _only(starter, "run_problem")["payload"]


def test_problem_note_only_for_the_same_node(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "other node note")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter, (member,) = _user("starter"), _members(seed_employee, "member")
    run = _create_run(client, seeded, starter, participants=[member])
    _act(client, run, member, a, "problem")

    _comment(client, run, member, b, "about another node")

    assert "snippet" not in _only(starter, "run_problem")["payload"]


# ── 접근 · 하위 맵 가림 ──


def test_recipient_without_access_gets_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "lost access", visibility="private")
    starter, kept, lost = _user("starter"), _user("kept"), _user("lost")
    for login in (kept, lost):
        seed_employee(login)
    grants = {}
    for login in (starter, kept, lost):
        res = _call(
            client,
            "POST",
            f"/maps/{seeded['map_id']}/permissions",
            seeded["owner"],
            json={"principal_type": "user", "principal_id": login, "role": "viewer"},
        )
        assert res.status_code == 201, res.text
        grants[login] = res.json()["id"]
    run = _create_run(client, seeded, starter, participants=[kept, lost])
    res = _call(client, "DELETE", f"/maps/{seeded['map_id']}/permissions/{grants[lost]}", seeded["owner"])
    assert res.status_code == 200, res.text

    _act(client, run, kept, seeded["ids"]["a"], "problem")

    assert len(_rows(starter, "run_problem")) == 1
    assert _rows(lost, "run_problem") == []  # 접근을 잃은 참여자에게는 더 가지 않는다


def test_child_scope_titles_are_hidden_from_recipients_without_access(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "hidden titles")
    q, child_a, child_b = parent["ids"]["q"], child["ids"]["a"], child["ids"]["b"]
    starter = _user("starter")
    insider, outsider = _members(seed_employee, "insider", "outsider")
    for login in (starter, insider):  # 바깥 맵은 공개라 모두 보고, 하위 맵은 둘만 본다
        res = _call(
            client,
            "POST",
            f"/maps/{child['map_id']}/permissions",
            child["owner"],
            json={"principal_type": "user", "principal_id": login, "role": "viewer"},
        )
        assert res.status_code == 201, res.text
    run = _create_run(client, parent, starter, participants=[insider, outsider])

    _act(client, run, starter, child_a, "problem", scope_path=q)
    _act(client, run, starter, child_a, "complete", scope_path=q)
    _act(client, run, starter, child_b, "complete", scope_path=q)

    seen_problem = _only(insider, "run_problem")
    hidden_problem = _only(outsider, "run_problem")
    assert (seen_problem["payload"]["node_title"], seen_problem["payload"]["scope_path"]) == ("접수", q)
    assert seen_problem["payload"]["node_id"] == child_a and "접수" in seen_problem["message"]
    for key in ("node_title", "node_id", "scope_path"):
        assert key not in hidden_problem["payload"], key
    assert "접수" not in hidden_problem["message"]
    hidden_steps = _only(outsider, "run_steps_done")
    assert hidden_steps["payload"]["count"] == 2  # 개수는 세어도 숨은 제목은 행에 넣지 않는다
    assert "node_title" not in hidden_steps["payload"]
    assert "접수" not in hidden_steps["message"] and "검토" not in hidden_steps["message"]
    assert _only(insider, "run_steps_done")["payload"]["node_title"] == "검토"


# ── 결재 알림 보호 (인당 상한) ──


def test_run_notification_types_share_the_cap_prefix() -> None:
    types = [
        value for name, value in vars(run_notify).items() if name.startswith("RUN_") and isinstance(value, str)
    ]
    assert len(types) == 7
    assert all(value.startswith(RUN_NOTIFICATION_PREFIX) for value in types)


def _seed_rows(recipient: str, types: list[str]) -> None:
    """상한 검사를 거치지 않고 오래된 순으로 직접 넣는다 — 한 시간 전부터 1초 간격."""
    base = clock.now() - timedelta(hours=1)

    async def _work(session) -> None:
        for offset, type_ in enumerate(types):
            session.add(
                Notification(
                    recipient=recipient,
                    type=type_,
                    message=f"seed {offset}",
                    created_at=base + timedelta(seconds=offset),
                )
            )

    _write_db(_work)


def _count_rows(recipient: str, *, run_only: bool = False) -> int:
    async def _work(session) -> int:
        query = select(func.count()).select_from(Notification).where(Notification.recipient == recipient)
        if run_only:
            query = query.where(Notification.type.startswith(RUN_NOTIFICATION_PREFIX, autoescape=True))
        return await session.scalar(query)

    return _read_db(_work)


def _add_notification(recipient: str, type_: str, message: str) -> None:
    async def _work(session) -> None:
        await create_notifications(session, [recipient], type=type_, message=message)

    _write_db(_work)


def test_cap_trims_run_notifications_first() -> None:
    recipient = _user("cap-run")
    _seed_rows(recipient, ["version_submitted"] + ["run_steps_done"] * NOTIFICATION_CAP)  # 가장 오래된 것이 결재 알림

    _add_notification(recipient, "run_problem", "newest")

    messages = {n["message"] for n in _rows(recipient)}
    assert _count_rows(recipient) == NOTIFICATION_CAP
    assert "seed 0" in messages  # 결재 알림은 가장 오래됐어도 남는다
    assert "newest" in messages
    assert "seed 1" not in messages and "seed 2" not in messages  # 오래된 실행 알림 둘이 먼저 지워진다


def test_cap_unchanged_without_run_notifications() -> None:
    recipient = _user("cap-plain")

    for index in range(NOTIFICATION_CAP + 1):
        _add_notification(recipient, "notice", f"plain {index}")

    messages = {n["message"] for n in _rows(recipient)}
    assert _count_rows(recipient) == NOTIFICATION_CAP
    assert "plain 0" not in messages and "plain 1" in messages and f"plain {NOTIFICATION_CAP}" in messages


def test_cap_falls_back_to_other_types_when_no_run_notification_is_left() -> None:
    recipient = _user("cap-fallback")
    _seed_rows(recipient, ["version_submitted"] * (NOTIFICATION_CAP + 1))

    _add_notification(recipient, "run_problem", "newest")

    messages = {n["message"] for n in _rows(recipient)}
    assert _count_rows(recipient) == NOTIFICATION_CAP
    assert _count_rows(recipient, run_only=True) == 0  # 실행 알림을 먼저 지우고
    assert "seed 0" not in messages  # 모자란 한 건은 가장 오래된 다른 알림을 지운다
    assert "seed 1" in messages
