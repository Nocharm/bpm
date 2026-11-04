"""실행 체크(Run) 관리 API — 코멘트·참여자·공유 전환·중단/다시 열기/삭제·보존·알림 끄기 (design 2026-11-04 §4.4·§4.6)."""

import asyncio
import itertools
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app import clock
from app.db import SessionLocal
from app.models import Notification, ProcessMap, Run, RunComment, RunEvent, RunScope
from tests.run_helpers import as_user, load_case_graph, seed_published_map

_names = itertools.count(1)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"run-manage {label} {next(_names)}"


def _user(label: str) -> str:
    # 개인 실행 상한(사람당 10개)이 테스트끼리 쌓이지 않게 테스트마다 새 사용자를 쓴다
    return f"mng.{label}.{next(_names)}"


def _seed(client: TestClient, monkeypatch: pytest.MonkeyPatch, label: str, *, visibility: str = "public") -> dict:
    return seed_published_map(
        client, monkeypatch, graph=load_case_graph("linear"), name=_unique(label), visibility=visibility
    )


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
    client: TestClient,
    seeded: dict,
    user: str,
    *,
    scope: str = "solo",
    participants: list[str] | None = None,
    name: str = "LOT-1",
) -> dict:
    body = {"name": name, "version_id": seeded["version_id"], "scope": scope, "participants": participants or []}
    res = client.post(f"/api/maps/{seeded['map_id']}/runs", json=body, headers=as_user(client, user))
    assert res.status_code == 201, res.text
    return res.json()


def _call(client: TestClient, method: str, path: str, user: str, **kwargs: Any):
    return client.request(method, f"/api{path}", headers=as_user(client, user), **kwargs)


def _comment(client: TestClient, run: dict, user: str, body: str = "note", **extra: Any):
    payload = {"node_id": extra.pop("node_id", "unset"), "body": body, **extra}
    return _call(client, "POST", f"/runs/{run['id']}/comments", user, json=payload)


def _ok(res) -> dict:
    assert res.status_code == 200, res.text
    return res.json()


def _rejected(res) -> tuple[int, str]:
    return res.status_code, res.json()["detail"]


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


def _count_events(run_id: int, action: str) -> int:
    async def _work(session) -> int:
        return await session.scalar(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run_id, RunEvent.action == action)
        )

    return _read_db(_work)


def _as_kst(stamp: datetime) -> datetime:
    """sqlite는 시각의 시간대를 떼고 돌려준다 — 같은 KST 벽시계로 보고 비교한다."""
    return stamp if stamp.tzinfo else stamp.replace(tzinfo=clock.KST)


def _is_about(stamp: datetime, expected: datetime) -> bool:
    return abs(_as_kst(stamp) - expected) < timedelta(minutes=1)


@pytest.fixture
def set_caps(client: TestClient) -> Iterator[Callable[..., None]]:
    """열린 실행·보존 상한을 바꾸고 끝나면 기본값으로 되돌린다."""

    def _set(**caps: int) -> None:
        res = client.put("/api/admin/app-settings", json=caps)
        assert res.status_code == 200, res.text

    yield _set
    defaults = {"run_open_solo_cap": 10, "run_open_shared_cap": 30, "run_keep_shared_cap": 50, "run_keep_solo_cap": 10}
    client.put("/api/admin/app-settings", json=defaults)


# ── 코멘트 ──


def test_comment_roundtrip_and_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "comment roundtrip")
    a, b = seeded["ids"]["a"], seeded["ids"]["b"]
    starter = _user("comment")
    run = _create_run(client, seeded, starter)

    long_ok = _comment(client, run, starter, "가" * 2000, node_id=a)
    too_long = _comment(client, run, starter, "가" * 2001, node_id=a)
    second = _comment(client, run, starter, "두 번째", node_id=a)
    other_node = _comment(client, run, starter, "다른 노드", node_id=b)

    assert long_ok.status_code == 201, long_ok.text
    assert too_long.status_code == 422
    posted = second.json()
    assert (posted["author"], posted["scope_path"], posted["node_id"], posted["body"]) == (starter, "", a, "두 번째")
    assert other_node.status_code == 201
    listed = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", starter, params={"scope": "", "node_id": a}))
    assert [c["body"] for c in listed] == ["가" * 2000, "두 번째"]  # 오래된 순, 다른 노드는 거른다
    everything = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", starter))
    assert [c["node_id"] for c in everything] == [a, a, b]
    detail = _ok(_call(client, "GET", f"/runs/{run['id']}", starter))
    assert {(c["node_id"], c["count"]) for c in detail["comment_counts"]} == {(a, 2), (b, 1)}


def test_blank_comment_is_rejected_and_body_is_trimmed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "comment blank")
    a = seeded["ids"]["a"]
    starter = _user("blank")
    run = _create_run(client, seeded, starter)

    blank = _comment(client, run, starter, " \t\n ", node_id=a)
    trimmed = _comment(client, run, starter, "  hold the lot  ", node_id=a)

    assert blank.status_code == 422
    assert trimmed.status_code == 201, trimmed.text
    assert trimmed.json()["body"] == "hold the lot"
    listed = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", starter, params={"scope": "", "node_id": a}))
    assert [c["body"] for c in listed] == ["hold the lot"]


def test_comment_on_unknown_node_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "comment unknown node")
    starter = _user("unknown")
    run = _create_run(client, seeded, starter)

    res = _comment(client, run, starter, node_id="no-such-node")

    assert _rejected(res) == (422, "node not found")


def test_comment_on_ended_run_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "comment ended")
    a = seeded["ids"]["a"]
    starter = _user("ended")
    run = _create_run(client, seeded, starter)
    _comment(client, run, starter, "before", node_id=a)
    _ok(_call(client, "POST", f"/runs/{run['id']}/stop", starter))

    res = _comment(client, run, starter, "after", node_id=a)

    assert _rejected(res) == (409, "run is not open")
    kept = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", starter))  # 닫힌 실행도 읽을 수는 있다
    assert [c["body"] for c in kept] == ["before"]


def test_comment_needs_participant_but_bystander_can_read(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "comment bystander")
    a = seeded["ids"]["a"]
    starter, bystander = _user("starter"), _user("bystander")
    run = _create_run(client, seeded, starter, scope="shared")
    _comment(client, run, starter, "hello", node_id=a)

    posted = _comment(client, run, bystander, "me too", node_id=a)
    seen = _call(client, "GET", f"/runs/{run['id']}/comments", bystander)

    assert _rejected(posted) == (403, "only participants can change this run")
    assert [c["body"] for c in _ok(seen)] == ["hello"]


def test_comment_in_child_scope_pins_it_and_hides_from_outsiders(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "comment scope")
    q, child_a, parent_a = parent["ids"]["q"], child["ids"]["a"], parent["ids"]["a"]
    member, outsider = _user("member"), _user("outsider")
    for login in (member, outsider):
        seed_employee(login)
    granted = _call(
        client,
        "POST",
        f"/maps/{child['map_id']}/permissions",
        child["owner"],
        json={"principal_type": "user", "principal_id": member, "role": "viewer"},
    )
    assert granted.status_code == 201, granted.text
    run = _create_run(client, parent, member, scope="shared", participants=[outsider])

    def _count_pins() -> int:
        return _read_db(lambda s: s.scalar(select(func.count()).select_from(RunScope).where(RunScope.run_id == run["id"])))

    rejected = _comment(client, run, member, "ghost", scope_path=q, node_id="no-such-node")
    assert _rejected(rejected) == (422, "node not found")
    assert _count_pins() == 0  # 거절된 코멘트는 고정도 남기지 않는다

    # 호스트에 닿지 않았어도(막힌 노드) 코멘트는 남기고, 그때 하위 맵 버전이 고정된다
    posted = _comment(client, run, member, "child note", scope_path=q, node_id=child_a)
    _comment(client, run, member, "root note", node_id=parent_a)

    assert posted.status_code == 201, posted.text
    assert posted.json()["scope_path"] == q
    assert _count_pins() == 1
    mine = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", member, params={"scope": q}))
    assert [c["body"] for c in mine] == ["child note"]
    # 하위 맵을 볼 수 없는 참여자는 그 범위를 읽지도 쓰지도 못하고, 범위를 안 정한 읽기엔 바깥 코멘트만 온다
    denied_read = _call(client, "GET", f"/runs/{run['id']}/comments", outsider, params={"scope": q})
    denied_write = _comment(client, run, outsider, "peek", scope_path=q, node_id=child_a)
    unscoped = _ok(_call(client, "GET", f"/runs/{run['id']}/comments", outsider))
    assert _rejected(denied_read) == (403, "cannot view the subprocess map")
    assert _rejected(denied_write) == (403, "cannot view the subprocess map")
    assert [c["body"] for c in unscoped] == ["root note"]


def test_comment_in_unpinned_or_invalid_scope_is_denied(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "comment bad scope")
    starter = _user("badscope")
    run = _create_run(client, seeded, starter)

    read = _call(client, "GET", f"/runs/{run['id']}/comments", starter, params={"scope": "ghost"})
    write = _comment(client, run, starter, scope_path="ghost", node_id=seeded["ids"]["a"])

    # 고정 행이 없는 범위는 범위 그래프와 같은 사슬 검사를 거친다 — 호스트가 하위프로세스 노드가 아니다
    assert _rejected(read) == (422, "node is not actionable")
    assert _rejected(write) == (422, "node is not actionable")


def test_comment_list_on_unpinned_child_scope_matches_graph(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "comment unpinned")
    q = parent["ids"]["q"]
    member, outsider = _user("member"), _user("outsider")
    for login in (member, outsider):
        seed_employee(login)
    granted = _call(
        client,
        "POST",
        f"/maps/{child['map_id']}/permissions",
        child["owner"],
        json={"principal_type": "user", "principal_id": member, "role": "viewer"},
    )
    assert granted.status_code == 201, granted.text
    run = _create_run(client, parent, member, scope="shared", participants=[outsider])

    def _get(path: str, user: str):
        return _call(client, "GET", f"/runs/{run['id']}/{path}", user, params={"scope": q})

    # 펼쳤지만 아직 들어가지 않은(고정 전) 하위 맵 — 그래프를 볼 수 있으면 코멘트 목록도 빈 목록으로 열린다
    assert _get("graph", member).status_code == 200
    assert _ok(_get("comments", member)) == []
    assert _rejected(_get("graph", outsider)) == (403, "cannot view the subprocess map")
    assert _rejected(_get("comments", outsider)) == (403, "cannot view the subprocess map")
    assert _read_db(lambda s: s.scalar(select(func.count()).select_from(RunScope).where(RunScope.run_id == run["id"]))) == 0


def test_comment_and_lifecycle_changes_touch_activity(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "activity")
    starter = _user("activity")
    run = _create_run(client, seeded, starter)
    long_ago = clock.now() - timedelta(days=31)

    def _make_stale() -> None:
        _set_run_fields(run["id"], last_activity_at=long_ago, idle_warned_at=long_ago)

    _make_stale()
    _comment(client, run, starter, node_id=seeded["ids"]["a"])
    after_comment = _read_run(run["id"])
    assert _is_about(after_comment["last_activity_at"], clock.now()) and after_comment["idle_warned_at"] is None

    for step in ("stop", "reopen"):
        _make_stale()
        _ok(_call(client, "POST", f"/runs/{run['id']}/{step}", starter))
        row = _read_run(run["id"])
        assert _is_about(row["last_activity_at"], clock.now()), step
        assert row["idle_warned_at"] is None, step


# ── 중단 · 다시 열기 · 삭제 ──


def test_only_starter_can_stop_and_reopen(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "stop reopen")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    path = f"/runs/{run['id']}"

    assert _rejected(_call(client, "POST", f"{path}/stop", member)) == (403, "only the starter can do this")
    stopped = _ok(_call(client, "POST", f"{path}/stop", starter))
    assert (stopped["status"], stopped["end_reason"], stopped["can_act"]) == ("stopped", "stopped", False)
    assert stopped["ended_at"] is not None and stopped["summarize_after"] is not None
    assert _rejected(_call(client, "POST", f"{path}/stop", starter)) == (409, "run is not open")
    assert _rejected(_call(client, "POST", f"{path}/reopen", member)) == (403, "only the starter can do this")
    reopened = _ok(_call(client, "POST", f"{path}/reopen", starter))

    assert reopened["status"] == "open" and reopened["can_act"] is True
    assert (reopened["end_reason"], reopened["ended_at"], reopened["summarize_after"]) == (None, None, None)
    assert (_count_events(run["id"], "stop"), _count_events(run["id"], "reopen")) == (1, 1)


def test_stop_keeps_progress_and_honors_keep(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "stop progress")
    a = seeded["ids"]["a"]
    starter = _user("stopper")
    run = _create_run(client, seeded, starter)
    _ok(_call(client, "POST", f"/runs/{run['id']}/actions", starter, json={"node_id": a, "action": "complete"}))
    kept_run = _create_run(client, seeded, starter, name="kept")
    _ok(_call(client, "PATCH", f"/runs/{kept_run['id']}", starter, json={"keep": True}))

    stopped = _ok(_call(client, "POST", f"/runs/{run['id']}/stop", starter))
    kept_stopped = _ok(_call(client, "POST", f"/runs/{kept_run['id']}/stop", starter))

    assert stopped["progress"] == {"done": 1, "total": 2}  # 중단 전 계산이 분모를 정한다
    assert _is_about(datetime.fromisoformat(stopped["summarize_after"]), clock.now() + timedelta(days=30))
    assert kept_stopped["summarize_after"] is None  # 보존이면 요약하지 않는다


def test_cannot_act_on_stopped_run(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "stopped readonly")
    starter = _user("readonly")
    run = _create_run(client, seeded, starter)
    _ok(_call(client, "POST", f"/runs/{run['id']}/stop", starter))

    res = _call(client, "POST", f"/runs/{run['id']}/actions", starter, json={"node_id": seeded["ids"]["a"], "action": "start"})

    assert _rejected(res) == (409, "run is not open")


def test_reopen_rejects_summarized_and_open_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "reopen states")
    starter = _user("reopen")
    run = _create_run(client, seeded, starter)

    assert _rejected(_call(client, "POST", f"/runs/{run['id']}/reopen", starter)) == (409, "run is already open")
    _set_run_fields(run["id"], status="summarized")

    assert _rejected(_call(client, "POST", f"/runs/{run['id']}/reopen", starter)) == (409, "summarized runs cannot reopen")


@pytest.mark.parametrize(
    ("scope", "expected"), [("solo", "open solo run limit reached"), ("shared", "open shared run limit reached")]
)
def test_reopen_rechecks_open_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_caps: Callable[..., None], scope: str, expected: str
) -> None:
    seeded = _seed(client, monkeypatch, f"reopen cap {scope}")
    starter = _user("reopencap")
    first = _create_run(client, seeded, starter, scope=scope)
    _ok(_call(client, "POST", f"/runs/{first['id']}/stop", starter))
    set_caps(run_open_solo_cap=1, run_open_shared_cap=1)
    _create_run(client, seeded, starter, scope=scope, name="second")  # 상한 1 — 방금 빈 자리를 채운다

    res = _call(client, "POST", f"/runs/{first['id']}/reopen", starter)

    assert _rejected(res) == (409, expected)
    assert _read_run(first["id"])["status"] == "stopped"


def test_delete_run_is_starter_only_and_cascades(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "delete")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    _comment(client, run, starter, node_id=seeded["ids"]["a"])
    path = f"/runs/{run['id']}"

    assert _rejected(_call(client, "DELETE", path, member)) == (403, "only the starter can do this")
    assert _rejected(_call(client, "DELETE", path, seeded["owner"])) == (403, "only the starter can do this")  # 오너 삭제 권한 없음
    deleted = _call(client, "DELETE", path, starter)

    assert deleted.status_code == 204
    assert _call(client, "GET", path, starter).status_code == 404
    left = _read_db(lambda s: s.scalar(select(func.count()).select_from(RunComment).where(RunComment.run_id == run["id"])))
    assert left == 0


def test_delete_run_deletes_its_run_notifications(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "delete notifications")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])  # 초대 알림 하나
    other = _create_run(client, seeded, starter, scope="shared", participants=[member], name="LOT-2")

    async def _seed_extra(session) -> None:
        payload = {"run_id": run["id"]}
        session.add_all(
            [
                Notification(recipient=member, type="notice", map_id=seeded["map_id"], message="keep", payload=payload),
                # 다른 맵의 같은 실행 id(sqlite는 지운 id를 다시 쓴다) — 이 실행의 알림이 아니다
                Notification(recipient=member, type="run_problem", map_id=-1, message="other map", payload=payload),
            ]
        )

    _write_db(_seed_extra)

    def _messages() -> list[tuple[str, int | None]]:
        async def _work(session) -> list[tuple[str, int | None]]:
            rows = await session.scalars(select(Notification).where(Notification.recipient == member))
            return sorted((n.type, (n.payload or {}).get("run_id")) for n in rows.all())

        return _read_db(_work)

    assert ("run_invited", run["id"]) in _messages()
    assert _call(client, "DELETE", f"/runs/{run['id']}", starter).status_code == 204

    assert _messages() == sorted(
        [("notice", run["id"]), ("run_problem", run["id"]), ("run_invited", other["id"])]
    )


def _list_member_run_notifications(client: TestClient, member: str, map_id: int) -> list[dict]:
    rows = _ok(_call(client, "GET", "/notifications", member))
    return [n for n in rows if n["map_id"] == map_id and n["type"].startswith("run_")]


def test_notifications_flag_runs_of_a_trashed_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "trash flag")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    _create_run(client, seeded, starter, scope="shared", participants=[member])  # 초대 알림 하나

    before = _list_member_run_notifications(client, member, seeded["map_id"])
    assert _call(client, "DELETE", f"/maps/{seeded['map_id']}", seeded["owner"]).status_code == 204
    trashed = _list_member_run_notifications(client, member, seeded["map_id"])
    read = _ok(_call(client, "POST", f"/notifications/{trashed[0]['id']}/read", member))
    assert _call(client, "POST", f"/maps/{seeded['map_id']}/restore", seeded["owner"]).status_code == 200
    restored = _list_member_run_notifications(client, member, seeded["map_id"])

    assert [n["map_in_trash"] for n in before] == [False]
    assert [n["map_in_trash"] for n in trashed] == [True]  # 휴지통 동안은 표시만 바뀌고 지우지 않는다
    assert (read["read"], read["map_in_trash"]) == (True, True)  # 읽음 응답이 목록 줄을 갈아 끼워도 표시가 남는다
    assert [n["map_in_trash"] for n in restored] == [False]


def _count_member_notifications(member: str, map_id: int) -> list[str]:
    async def _work(session) -> list[str]:
        rows = await session.scalars(
            select(Notification.type).where(Notification.recipient == member, Notification.map_id == map_id)
        )
        return sorted(rows.all())

    return _read_db(_work)


def test_purging_a_map_deletes_its_run_notifications(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "purge notifications")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    _create_run(client, seeded, starter, scope="shared", participants=[member])

    async def _seed_notice(session) -> None:
        session.add(Notification(recipient=member, type="notice", map_id=seeded["map_id"], message="keep"))

    _write_db(_seed_notice)
    assert _call(client, "DELETE", f"/maps/{seeded['map_id']}", seeded["owner"]).status_code == 204
    assert _count_member_notifications(member, seeded["map_id"]) == ["notice", "run_invited"]
    purged = _call(client, "DELETE", f"/maps/{seeded['map_id']}/permanent", seeded["owner"])

    assert purged.status_code == 204
    assert _count_member_notifications(member, seeded["map_id"]) == ["notice"]  # 실행 알림만 지운다


def test_expired_trash_purge_deletes_run_notifications(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "expired purge notifications")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    _create_run(client, seeded, starter, scope="shared", participants=[member])
    assert _call(client, "DELETE", f"/maps/{seeded['map_id']}", seeded["owner"]).status_code == 204

    async def _age_trash(session) -> None:
        found = await session.get(ProcessMap, seeded["map_id"])
        found.deleted_at = clock.now() - timedelta(days=8)  # 복구 기간 7일이 지난 휴지통

    _write_db(_age_trash)
    assert _call(client, "GET", "/maps/deleted/list", seeded["owner"]).status_code == 200  # 조회가 만료분을 정리한다

    assert _count_member_notifications(member, seeded["map_id"]) == []


# ── 보존 · 이름 · 알림 끄기 ──


def test_keep_cap_and_summary_countdown(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_caps: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "keep cap")
    starter = _user("keeper")
    first = _create_run(client, seeded, starter, scope="shared")
    second = _create_run(client, seeded, starter, scope="shared", name="second")
    set_caps(run_keep_shared_cap=1)

    assert _ok(_call(client, "PATCH", f"/runs/{first['id']}", starter, json={"keep": True}))["keep"] is True
    blocked = _call(client, "PATCH", f"/runs/{second['id']}", starter, json={"keep": True})
    assert _rejected(blocked) == (409, "keep limit reached")
    assert _read_run(second["id"])["keep"] is False

    ended = _ok(_call(client, "POST", f"/runs/{first['id']}/stop", starter))
    assert ended["keep"] is True and ended["summarize_after"] is None
    released = _ok(_call(client, "PATCH", f"/runs/{first['id']}", starter, json={"keep": False}))
    assert released["keep"] is False
    assert _is_about(datetime.fromisoformat(released["summarize_after"]), clock.now() + timedelta(days=30))
    # 끈 자리는 바로 다른 실행이 쓰고, 이미 켠 실행을 다시 켜는 것은 상한과 무관하다
    assert _ok(_call(client, "PATCH", f"/runs/{second['id']}", starter, json={"keep": True}))["keep"] is True
    assert _ok(_call(client, "PATCH", f"/runs/{second['id']}", starter, json={"keep": True}))["keep"] is True
    relocked = _call(client, "PATCH", f"/runs/{first['id']}", starter, json={"keep": True})  # 끝난 실행도 상한을 따른다
    assert _rejected(relocked) == (409, "keep limit reached")
    assert _read_run(first["id"])["summarize_after"] is not None


def test_solo_keep_cap_counts_across_maps(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_caps: Callable[..., None]
) -> None:
    first_map = _seed(client, monkeypatch, "solo keep a")
    second_map = _seed(client, monkeypatch, "solo keep b")
    starter = _user("solokeep")
    one = _create_run(client, first_map, starter)
    two = _create_run(client, second_map, starter)
    set_caps(run_keep_solo_cap=1)

    _ok(_call(client, "PATCH", f"/runs/{one['id']}", starter, json={"keep": True}))
    blocked = _call(client, "PATCH", f"/runs/{two['id']}", starter, json={"keep": True})

    assert _rejected(blocked) == (409, "keep limit reached")


def test_map_owner_can_keep_shared_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "owner keep")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    path = f"/runs/{run['id']}"

    from_member = _call(client, "PATCH", path, member, json={"keep": True})
    from_owner = _call(client, "PATCH", path, seeded["owner"], json={"keep": True})
    owner_off = _call(client, "PATCH", path, seeded["owner"], json={"keep": False})

    assert _rejected(from_member) == (403, "only the starter or the map owner can change keep")
    assert _ok(from_owner)["keep"] is True
    assert _ok(owner_off)["keep"] is False


def test_rename_is_starter_only_and_patch_is_atomic(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "rename")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    path = f"/runs/{run['id']}"

    assert _rejected(_call(client, "PATCH", path, member, json={"name": "hijack"})) == (
        403,
        "only the starter can do this",
    )
    assert _ok(_call(client, "PATCH", path, starter, json={"name": "  LOT-9  "}))["name"] == "LOT-9"
    # 한 요청의 한 필드가 거절되면 나머지도 저장하지 않는다
    mixed = _call(client, "PATCH", path, member, json={"muted": True, "name": "again"})
    assert mixed.status_code == 403
    after = _ok(_call(client, "GET", path, starter))
    assert after["name"] == "LOT-9" and not any(p["muted"] for p in after["participants"])
    assert _call(client, "PATCH", path, starter, json={"name": ""}).status_code == 422


def test_summarized_run_rejects_keep_and_rename(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "summarized patch")
    starter = _user("summ")
    run = _create_run(client, seeded, starter)
    _set_run_fields(run["id"], status="summarized")

    keep = _call(client, "PATCH", f"/runs/{run['id']}", starter, json={"keep": True})
    rename = _call(client, "PATCH", f"/runs/{run['id']}", starter, json={"name": "x"})

    assert _rejected(keep) == (409, "summarized runs cannot be changed")
    assert _rejected(rename) == (409, "summarized runs cannot be changed")


def test_summarized_run_detail_offers_no_keep_or_actions(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "summarized detail")
    starter = _user("summ")
    run = _create_run(client, seeded, starter)
    _set_run_fields(run["id"], status="summarized", end_reason="completed")

    detail = _ok(_call(client, "GET", f"/runs/{run['id']}", starter))

    # 요약된 실행은 보존을 바꿀 수 없어(409) 보존 버튼을 내지 않는다
    assert (detail["can_keep"], detail["can_act"]) == (False, False)


def test_mute_is_per_participant(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "mute")
    starter, member, bystander = _user("starter"), _user("member"), _user("bystander")
    seed_employee(member)
    run = _create_run(client, seeded, starter, scope="shared", participants=[member])
    path = f"/runs/{run['id']}"

    muted = _ok(_call(client, "PATCH", path, member, json={"muted": True}))
    flags = {p["login_id"]: p["muted"] for p in muted["participants"]}
    assert flags == {starter: False, member: True}
    stranger = _call(client, "PATCH", path, bystander, json={"muted": True})  # 참여자가 아니면 끌 알림도 없다
    assert _rejected(stranger) == (403, "only participants can change this run")
    unmuted = _ok(_call(client, "PATCH", path, member, json={"muted": False}))
    assert not any(p["muted"] for p in unmuted["participants"])


# ── 나만 → 공유 · 참여자 ──


def test_switch_solo_to_shared_and_back_is_blocked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "share switch")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter)
    path = f"/runs/{run['id']}/share"
    assert _call(client, "GET", f"/runs/{run['id']}", member).status_code == 404  # 나만 실행은 남에게 안 보인다

    shared = _ok(_call(client, "POST", path, starter, json={"participants": [member, starter, member]}))

    assert shared["scope"] == "shared"
    assert [p["login_id"] for p in shared["participants"]] == [starter, member]
    assert _ok(_call(client, "GET", f"/runs/{run['id']}", member))["can_act"] is True
    again = _call(client, "POST", path, starter, json={"participants": [member]})
    assert _rejected(again) == (409, "run is already shared")


def test_share_validation_and_caps(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    enforce_permissions: None,
    seed_employee: Callable[..., None],
) -> None:
    seeded = _seed(client, monkeypatch, "share rules")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    run = _create_run(client, seeded, starter)
    path = f"/runs/{run['id']}/share"

    assert _call(client, "POST", path, starter, json={"participants": []}).status_code == 422
    ghost = _call(client, "POST", path, starter, json={"participants": ["ghost.nobody"]})
    assert _rejected(ghost) == (422, "participant ghost.nobody cannot view this map")
    assert _read_run(run["id"])["scope"] == "solo"
    assert _rejected(_call(client, "POST", path, member, json={"participants": [member]})) == (404, f"run {run['id']} not found")
    _ok(_call(client, "POST", f"/runs/{run['id']}/stop", starter))
    assert _rejected(_call(client, "POST", path, starter, json={"participants": [member]})) == (409, "run is not open")


def test_share_respects_open_shared_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_caps: Callable[..., None], seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "share cap")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    _create_run(client, seeded, starter, scope="shared")
    solo = _create_run(client, seeded, starter, name="solo")
    set_caps(run_open_shared_cap=1)

    res = _call(client, "POST", f"/runs/{solo['id']}/share", starter, json={"participants": [member]})

    assert _rejected(res) == (409, "open shared run limit reached")
    assert _read_run(solo["id"])["scope"] == "solo"


def test_share_of_kept_run_respects_keep_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_caps: Callable[..., None], seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "share keep cap")
    starter, member = _user("starter"), _user("member")
    seed_employee(member)
    shared = _create_run(client, seeded, starter, scope="shared")
    solo = _create_run(client, seeded, starter, name="solo")
    _ok(_call(client, "PATCH", f"/runs/{shared['id']}", starter, json={"keep": True}))
    _ok(_call(client, "PATCH", f"/runs/{solo['id']}", starter, json={"keep": True}))  # 개인 보존은 따로 센다
    set_caps(run_keep_shared_cap=1)

    res = _call(client, "POST", f"/runs/{solo['id']}/share", starter, json={"participants": [member]})

    assert _rejected(res) == (409, "keep limit reached")


def test_participants_add_remove_and_starter_stays(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "participants")
    a = seeded["ids"]["a"]
    starter, first, second = _user("starter"), _user("first"), _user("second")
    for login in (first, second):
        seed_employee(login)
    run = _create_run(client, seeded, starter, scope="shared", participants=[first])
    path = f"/runs/{run['id']}/participants"
    _ok(_call(client, "POST", f"/runs/{run['id']}/actions", first, json={"node_id": a, "action": "start"}))
    _comment(client, run, first, "from first", node_id=a)

    added = _ok(_call(client, "POST", path, starter, json={"add": [second, first, second]}))
    assert [p["login_id"] for p in added["participants"]] == [starter, first, second]
    removed = _ok(_call(client, "POST", path, starter, json={"remove": [first]}))
    assert [p["login_id"] for p in removed["participants"]] == [starter, second]

    # 뺀 사람의 기록은 이름과 함께 남고, 그 사람은 더 이상 바꿀 수 없다
    assert [(s["node_id"], s["updated_by"]) for s in removed["states"]] == [(a, first)]
    assert removed["comment_counts"] == [{"scope_path": "", "node_id": a, "count": 1}]
    assert _call(client, "POST", f"/runs/{run['id']}/actions", first, json={"node_id": a, "action": "complete"}).status_code == 403
    assert _ok(_call(client, "GET", f"/runs/{run['id']}", first))["can_act"] is False


def test_starter_cannot_be_removed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "starter stays")
    starter = _user("starter")
    run = _create_run(client, seeded, starter, scope="shared")

    res = _call(client, "POST", f"/runs/{run['id']}/participants", starter, json={"remove": [starter]})

    assert _rejected(res) == (422, "the starter stays in the run")
    assert [p["login_id"] for p in _ok(_call(client, "GET", f"/runs/{run['id']}", starter))["participants"]] == [starter]


def test_participants_endpoint_rules(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "participants rules")
    starter, member, third = _user("starter"), _user("member"), _user("third")
    for login in (member, third):
        seed_employee(login)
    solo = _create_run(client, seeded, starter)
    shared = _create_run(client, seeded, starter, scope="shared", participants=[member])

    on_solo = _call(client, "POST", f"/runs/{solo['id']}/participants", starter, json={"add": [member]})
    by_member = _call(client, "POST", f"/runs/{shared['id']}/participants", member, json={"add": [third]})
    ghost = _call(client, "POST", f"/runs/{shared['id']}/participants", starter, json={"add": ["ghost.nobody"]})
    too_many = _call(
        client, "POST", f"/runs/{shared['id']}/participants", starter, json={"add": [f"p{n}" for n in range(101)]}
    )

    assert _rejected(on_solo) == (409, "run is not shared")
    assert _rejected(by_member) == (403, "only the starter can do this")
    # 끝난 실행에는 초대하지 않는다(R38) — 사람을 더하려면 다시 연다
    ended = _create_run(client, seeded, starter, scope="shared", participants=[member], name="LOT-ended")
    _ok(_call(client, "POST", f"/runs/{ended['id']}/stop", starter))
    on_ended = _call(client, "POST", f"/runs/{ended['id']}/participants", starter, json={"add": [third]})
    assert _rejected(on_ended) == (409, "run is not open")
    assert [p["login_id"] for p in _ok(_call(client, "GET", f"/runs/{ended['id']}", starter))["participants"]] == [
        starter,
        member,
    ]
    assert _rejected(ghost) == (422, "participant ghost.nobody cannot view this map")
    assert too_many.status_code == 422 and isinstance(too_many.json()["detail"], list)
