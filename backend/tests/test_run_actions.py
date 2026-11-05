"""실행 체크(Run) 노드 동작 — 전이표·갈래·루프·하위 범위·실행 끝 (design 2026-11-04 §4.2)."""

import asyncio
import itertools
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import ProcessMap, Run, RunComment, RunEvent, RunScope
from app.run_graph import RunScopeState, derive_run_statuses
from app.run_service import load_version_graph
from tests.run_helpers import OWNING_DEPARTMENT, as_user, load_case_graph, republish_map, seed_published_map

_names = itertools.count(1)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"run-actions {label} {next(_names)}"


def _seed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    shape: str,
    label: str,
    *,
    visibility: str = "private",
    designate: bool = False,
) -> dict:
    return seed_published_map(
        client,
        monkeypatch,
        graph=load_case_graph(shape),
        name=_unique(label),
        visibility=visibility,
        designate=designate,
    )


def _seed_sp_pair(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    label: str,
    *,
    host_shape: str = "sp_exits",
    host_id: str = "q",
    parent_visibility: str = "private",
    designate_child: bool = True,
) -> tuple[dict, dict]:
    """하위 맵(linear, 기본은 서브프로세스 지정)과 그 맵을 하위프로세스로 부르는 바깥 맵 — (바깥, 하위)."""
    child = _seed(client, monkeypatch, "linear", f"{label} child", designate=designate_child)
    graph = load_case_graph(host_shape)
    host = next(n for n in graph["nodes"] if n["id"] == host_id)
    host.update(node_type="subprocess", linked_map_id=child["map_id"])
    parent = seed_published_map(
        client, monkeypatch, graph=graph, name=_unique(f"{label} parent"), visibility=parent_visibility
    )
    return parent, child


def _create_run(
    client: TestClient,
    seeded: dict,
    user: str | None = None,
    *,
    scope: str = "solo",
    participants: list[str] | None = None,
) -> dict:
    """실행 하나 — 시작한 사람은 기본으로 매번 새 이름이다(개인 실행 상한 10개가 테스트끼리 쌓이지 않게)."""
    starter = user or f"act.starter.{next(_names)}"
    body = {"name": "LOT-1", "version_id": seeded["version_id"], "scope": scope, "participants": participants or []}
    res = client.post(f"/api/maps/{seeded['map_id']}/runs", json=body, headers=as_user(client, starter))
    assert res.status_code == 201, res.text
    return res.json()


def _act(
    client: TestClient,
    run: dict,
    node_id: str,
    action: str,
    *,
    user: str | None = None,
    scope_path: str = "",
    **extra: Any,
):
    body = {"scope_path": scope_path, "node_id": node_id, "action": action, **extra}
    return client.post(f"/api/runs/{run['id']}/actions", json=body, headers=as_user(client, user or run["starter"]))


def _get_detail(client: TestClient, run: dict, user: str | None = None) -> dict:
    return _ok(client.get(f"/api/runs/{run['id']}", headers=as_user(client, user or run["starter"])))


def _get_graph(client: TestClient, run: dict, scope: str, user: str | None = None):
    return client.get(
        f"/api/runs/{run['id']}/graph", params={"scope": scope}, headers=as_user(client, user or run["starter"])
    )


def _graph_node_ids(client: TestClient, run: dict, scope: str) -> set[str]:
    return {n["id"] for n in _ok(_get_graph(client, run, scope))["nodes"]}


def _ok(res) -> dict:
    assert res.status_code == 200, res.text
    return res.json()


def _rejected(res) -> tuple[int, str]:
    return res.status_code, res.json()["detail"]


def _states(detail: dict, scope_path: str = "") -> dict[str, str]:
    return {s["node_id"]: s["status"] for s in detail["states"] if s["scope_path"] == scope_path}


def _state_row(detail: dict, node_id: str, scope_path: str = "") -> dict:
    return next(s for s in detail["states"] if s["scope_path"] == scope_path and s["node_id"] == node_id)


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


def _count_events(run: dict, action: str) -> int:
    async def _work(session) -> int:
        return await session.scalar(
            select(func.count()).select_from(RunEvent).where(RunEvent.run_id == run["id"], RunEvent.action == action)
        )

    return _read_db(_work)


def test_start_complete_advances_next_step(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "advance")
    ids = seeded["ids"]
    run = _create_run(client, seeded)

    started = _ok(_act(client, run, ids["a"], "start"))
    done = _ok(_act(client, run, ids["a"], "complete"))

    assert _states(started) == {ids["a"]: "active"}
    assert _states(done) == {ids["a"]: "done"}
    assert done["progress"] == {"done": 1, "total": 2}
    row = _state_row(done, ids["a"])
    assert (row["node_title"], row["updated_by"]) == ("접수", run["starter"])
    assert _count_events(run, "start") == 1 and _count_events(run, "complete") == 1


def test_complete_waiting_node_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "waiting")
    run = _create_run(client, seeded)

    res = _act(client, run, seeded["ids"]["b"], "complete")

    assert _rejected(res) == (409, "action not allowed in this state")


def test_start_and_end_nodes_are_not_actionable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "start end")
    run = _create_run(client, seeded)

    for node_id in (seeded["ids"]["s"], seeded["ids"]["e"], "no-such-node"):
        assert _rejected(_act(client, run, node_id, "complete")) == (422, "node is not actionable")


def test_decision_requires_branch_and_skips_other(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "decision", "branch")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, ids["a"], "complete"))

    assert _rejected(_act(client, run, ids["d"], "complete")) == (422, "choose a branch")
    assert _rejected(_act(client, run, ids["d"], "complete", edge_id=ids["e2"])) == (422, "choose a branch")
    detail = _ok(_act(client, run, ids["d"], "complete", edge_id=ids["e3"]))

    chosen = _state_row(detail, ids["d"])
    assert (chosen["status"], chosen["chosen_edge_id"]) == ("done", ids["e3"])
    state = RunScopeState(manual=_states(detail), choice={ids["d"]: ids["e3"]})
    graph = _read_db(lambda session: load_version_graph(session, seeded["version_id"]))
    statuses = derive_run_statuses(graph, state)
    assert (statuses[ids["y"]], statuses[ids["n"]]) == ("ready", "skipped")
    assert detail["progress"] == {"done": 2, "total": 4}  # 건너뛴 반품은 분모에서 빠진다


def test_undo_blocked_after_later_step(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "decision", "undo blocked")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, ids["a"], "complete"))
    _ok(_act(client, run, ids["d"], "complete", edge_id=ids["e3"]))

    assert _rejected(_act(client, run, ids["a"], "undo")) == (409, "later steps already changed: 적합?")
    undone = _ok(_act(client, run, ids["d"], "undo"))
    assert _states(undone) == {ids["a"]: "done"}  # 판단 선택도 함께 지워진다
    assert _states(_ok(_act(client, run, ids["a"], "undo"))) == {}


def test_undo_downstream_clears_later_steps(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "decision", "undo downstream")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, ids["a"], "complete"))
    _ok(_act(client, run, ids["d"], "complete", edge_id=ids["e3"]))
    _ok(_act(client, run, ids["y"], "start"))

    detail = _ok(_act(client, run, ids["a"], "undo", downstream=True))

    assert _states(detail) == {}  # 판단 선택·진행 중 뒤 단계까지 한꺼번에
    assert _count_events(run, "cleared") == 2  # 적합?·등록 — 이 단계(입고)는 undo 한 줄
    assert _count_events(run, "undo") == 1


def test_child_undo_downstream_clears_outer_later_steps(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "child undo downstream")
    q, child_b = parent["ids"]["q"], child["ids"]["b"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=q))
    _ok(_act(client, run, child_b, "complete", scope_path=q))
    _ok(_act(client, run, parent["ids"]["a"], "start"))

    detail = _ok(_act(client, run, child_b, "undo", scope_path=q, downstream=True))

    assert parent["ids"]["a"] not in _states(detail)  # 바깥 뒤 단계(출고)도 지워진다
    host = _state_row(detail, q)
    assert (host["status"], host["exit_key"]) == ("active", None)
    assert _states(detail, q) == {child["ids"]["a"]: "done"}


def test_undo_downstream_on_subprocess_still_needs_cascade(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "downstream cascade")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=q))
    _ok(_act(client, run, child["ids"]["b"], "complete", scope_path=q))
    _ok(_act(client, run, parent["ids"]["a"], "start"))  # 완료하면 실행이 끝난다

    assert _rejected(_act(client, run, q, "undo", downstream=True)) == (409, "subprocess has progress")
    assert parent["ids"]["a"] in _states(_get_detail(client, run))  # 거절되면 뒤 단계도 그대로다
    detail = _ok(_act(client, run, q, "undo", downstream=True, cascade=True))
    assert detail["states"] == []


def test_problem_resolve_and_unstart(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "problem")
    a = seeded["ids"]["a"]
    run = _create_run(client, seeded)

    assert _states(_ok(_act(client, run, a, "problem"))) == {a: "problem"}
    assert _rejected(_act(client, run, a, "unstart")) == (409, "action not allowed in this state")
    assert _states(_ok(_act(client, run, a, "resolve"))) == {a: "active"}
    assert _states(_ok(_act(client, run, a, "unstart"))) == {}
    assert _rejected(_act(client, run, a, "undo")) == (409, "action not allowed in this state")


def test_problem_completes_but_done_cannot_become_problem(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "problem complete")
    a = seeded["ids"]["a"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, a, "problem"))

    assert _states(_ok(_act(client, run, a, "complete"))) == {a: "done"}  # 문제에서 바로 완료
    # 완료에서 문제로 가는 길은 없다 — 완료 취소 뒤 다시 표시한다 (design §4.2)
    assert _rejected(_act(client, run, a, "problem")) == (409, "action not allowed in this state")


def test_loop_choice_resets_body(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "loop", "loop")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, ids["w"], "complete"))

    detail = _ok(_act(client, run, ids["r"], "complete", edge_id=ids["h3"]))

    assert _states(detail) == {}
    assert _count_events(run, "loop") == 1
    assert _count_events(run, "complete") == 1  # 루프는 완료로 세지 않는다
    # 되감은 뒤 다시 돌아 승인으로 나가면 끝난다
    _ok(_act(client, run, ids["w"], "complete"))
    assert _ok(_act(client, run, ids["r"], "complete", edge_id=ids["h4"]))["status"] == "done"


def test_loop_clears_subprocess_scope_in_body(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "loop sp", host_shape="loop", host_id="w")
    w, r = parent["ids"]["w"], parent["ids"]["r"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=w))
    assert _states(_ok(_act(client, run, child["ids"]["b"], "complete", scope_path=w)))[w] == "done"

    detail = _ok(_act(client, run, r, "complete", edge_id=parent["ids"]["h3"]))

    # 고리 안 하위프로세스의 하위 기록과 고정 버전까지 지워 다음 바퀴는 새로 들어간다
    assert (detail["states"], detail["scopes"]) == ([], [])


def test_unpinned_scope_rows_are_hidden_from_everyone(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "unpinned hidden", host_shape="loop", host_id="w")
    w, child_a = parent["ids"]["w"], child["ids"]["a"]
    run = _create_run(client, parent, scope="shared")
    _ok(_act(client, run, child_a, "complete", scope_path=w))

    async def _comment(session) -> None:
        session.add(RunComment(run_id=run["id"], scope_path=w, node_id=child_a, author=run["starter"], body="note"))

    _write_db(_comment)
    assert _get_detail(client, run)["comment_counts"] == [{"scope_path": w, "node_id": child_a, "count": 1}]
    _ok(_act(client, run, w, "complete"))
    _ok(_act(client, run, parent["ids"]["r"], "complete", edge_id=parent["ids"]["h3"]))  # 루프가 고정을 지운다

    # 고정이 없어 어느 맵인지 확인할 수 없는 범위는 참여자에게도 바깥 사람에게도 싣지 않는다(기본 가림)
    for viewer in (run["starter"], "unpinned.outsider"):
        seen = _get_detail(client, run, viewer)
        assert (seen["states"], seen["scopes"], seen["comment_counts"]) == ([], [], [])


def _seed_nested(client: TestClient, monkeypatch: pytest.MonkeyPatch, label: str) -> tuple[dict, dict, dict]:
    """3단 — 바깥(sp_exits의 q) → 중간(linear의 b가 하위프로세스) → 손자(linear). (바깥, 중간, 손자)."""
    grandchild = _seed(client, monkeypatch, "linear", f"{label} grandchild", designate=True)
    middle_graph = load_case_graph("linear")
    next(n for n in middle_graph["nodes"] if n["id"] == "b").update(
        node_type="subprocess", linked_map_id=grandchild["map_id"]
    )
    middle = seed_published_map(
        client, monkeypatch, graph=middle_graph, name=_unique(f"{label} middle"), designate=True
    )
    top_graph = load_case_graph("sp_exits")
    next(n for n in top_graph["nodes"] if n["id"] == "q").update(linked_map_id=middle["map_id"])
    top = seed_published_map(client, monkeypatch, graph=top_graph, name=_unique(f"{label} top"))
    return top, middle, grandchild


def test_nested_subprocess_chain(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    top, middle, grandchild = _seed_nested(client, monkeypatch, "nested")
    q, mid_b = top["ids"]["q"], middle["ids"]["b"]
    inner = f"{q}/{mid_b}"
    run = _create_run(client, top)

    _ok(_act(client, run, middle["ids"]["a"], "complete", scope_path=q))
    entered = _ok(_act(client, run, grandchild["ids"]["a"], "start", scope_path=inner))
    assert (_states(entered)[q], _states(entered, q)[mid_b]) == ("active", "active")
    _ok(_act(client, run, grandchild["ids"]["a"], "complete", scope_path=inner))
    detail = _ok(_act(client, run, grandchild["ids"]["b"], "complete", scope_path=inner))

    # 손자 맵이 끝나 중간 호스트가 완료되고, 그로써 중간 맵이 끝나 바깥 호스트까지 완료된다
    assert _states(detail, q)[mid_b] == "done"
    assert _state_row(detail, q)["exit_key"] == "__primary__"
    assert [s["scope_path"] for s in detail["scopes"]] == [q, inner]
    # 손자 맵 안의 완료 취소는 완료된 호스트를 따라 루트까지 되돌린다
    undone = _ok(_act(client, run, grandchild["ids"]["b"], "undo", scope_path=inner))
    assert (_states(undone)[q], _states(undone, q)[mid_b]) == ("active", "active")


def test_run_finishes_when_all_steps_done(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "finish")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    assert _ok(_act(client, run, ids["a"], "complete"))["status"] == "open"

    detail = _ok(_act(client, run, ids["b"], "complete"))

    assert (detail["status"], detail["end_reason"]) == ("done", "completed")
    ended = datetime.fromisoformat(detail["ended_at"])
    summarize = datetime.fromisoformat(detail["summarize_after"])
    assert summarize - ended == timedelta(days=30)
    assert detail["can_act"] is False
    assert _rejected(_act(client, run, ids["b"], "undo")) == (409, "run is not open")


def test_kept_run_finishes_without_summary_date(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "finish kept")
    ids = seeded["ids"]
    run = _create_run(client, seeded)

    async def _keep(session) -> None:
        (await session.get(Run, run["id"])).keep = True

    _write_db(_keep)
    _ok(_act(client, run, ids["a"], "complete"))
    detail = _ok(_act(client, run, ids["b"], "complete"))

    assert detail["status"] == "done" and detail["summarize_after"] is None


def test_subprocess_enter_and_auto_complete(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "enter")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)

    entered = _ok(_act(client, run, child["ids"]["a"], "start", scope_path=q))
    assert _states(entered) == {q: "active"}
    assert _states(entered, q) == {child["ids"]["a"]: "active"}
    assert entered["scopes"] == [{"scope_path": q, "version_id": child["version_id"], "closed": False}]

    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=q))
    detail = _ok(_act(client, run, child["ids"]["b"], "complete", scope_path=q))

    host = _state_row(detail, q)
    assert (host["status"], host["exit_key"], host["node_title"]) == ("done", "__primary__", "품질 시험")
    assert detail["progress"] == {"done": 1, "total": 2}  # 하위프로세스는 하나로 센다, 재시험 요청은 건너뜀


def test_subprocess_direct_complete_needs_exit_and_closes_child(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "direct")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=q))

    assert _rejected(_act(client, run, q, "complete")) == (422, "choose an exit")
    assert _rejected(_act(client, run, q, "complete", exit_key="없는 출구")) == (422, "choose an exit")
    detail = _ok(_act(client, run, q, "complete", exit_key="불합격"))

    assert detail["scopes"][0]["closed"] is True
    host = _state_row(detail, q)
    assert (host["status"], host["exit_key"]) == ("done", "불합격")
    # 닫힌 하위 범위의 남은 단계는 건너뜀이라 더 밟을 수 없다
    assert _rejected(_act(client, run, child["ids"]["b"], "complete", scope_path=q)) == (
        409,
        "action not allowed in this state",
    )


def test_subprocess_version_pinned_on_first_touch(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "pin")
    q = parent["ids"]["q"]
    first_ids = {child["ids"][key] for key in ("s", "a", "b", "e")}
    run = _create_run(client, parent)

    assert _graph_node_ids(client, run, q) == first_ids
    assert _get_detail(client, run)["scopes"] == []  # 보기만으로는 고정하지 않는다
    _ok(_act(client, run, child["ids"]["a"], "start", scope_path=q))
    republish_map(client, monkeypatch, child["version_id"])

    assert _graph_node_ids(client, run, q) == first_ids
    fresh_ids = _graph_node_ids(client, _create_run(client, parent), q)
    assert fresh_ids and fresh_ids.isdisjoint(first_ids)  # 고정하지 않은 실행은 새 게시본을 본다
    assert _graph_node_ids(client, run, "") == {parent["ids"][k] for k in ("s", "q", "a", "b", "e", "f")}


def test_outer_undo_needs_cascade_then_clears_child(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "outer undo")
    q, child_a = parent["ids"]["q"], child["ids"]["a"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child_a, "complete", scope_path=q))
    assert _states(_ok(_act(client, run, child["ids"]["b"], "complete", scope_path=q)))[q] == "done"

    async def _comment(session) -> None:
        session.add(RunComment(run_id=run["id"], scope_path=q, node_id=child_a, author=run["starter"], body="note"))

    _write_db(_comment)

    assert _rejected(_act(client, run, q, "undo")) == (409, "subprocess has progress")
    detail = _ok(_act(client, run, q, "undo", cascade=True))

    assert detail["states"] == []
    assert detail["scopes"] == [{"scope_path": q, "version_id": child["version_id"], "closed": False}]
    assert detail["comment_counts"] == [{"scope_path": q, "node_id": child_a, "count": 1}]


def test_outer_unstart_cascade(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "outer unstart")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)
    assert _states(_ok(_act(client, run, child["ids"]["a"], "start", scope_path=q)))[q] == "active"

    assert _rejected(_act(client, run, q, "unstart")) == (409, "subprocess has progress")
    detail = _ok(_act(client, run, q, "unstart", cascade=True))

    assert detail["states"] == []
    # 고정 버전은 남아 다시 들어가도 같은 하위 맵을 밟는다
    assert detail["scopes"] == [{"scope_path": q, "version_id": child["version_id"], "closed": False}]


def test_child_undo_reopens_host_unless_outer_touched(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "child undo")
    q, child_b = parent["ids"]["q"], child["ids"]["b"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "complete", scope_path=q))
    _ok(_act(client, run, child_b, "complete", scope_path=q))
    _ok(_act(client, run, parent["ids"]["a"], "start"))

    assert _rejected(_act(client, run, child_b, "undo", scope_path=q)) == (409, "later steps already changed: 출고")
    _ok(_act(client, run, parent["ids"]["a"], "unstart"))
    detail = _ok(_act(client, run, child_b, "undo", scope_path=q))

    host = _state_row(detail, q)
    assert (host["status"], host["exit_key"]) == ("active", None)


def test_child_scope_of_waiting_host_is_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "waiting host", host_shape="linear", host_id="b")
    run = _create_run(client, parent)

    # 앞 단계(접수)가 남은 하위프로세스 안은 아직 밟을 수 없다 — 하위 범위에서 끝까지 가도 호스트가 완료되면 안 된다
    res = _act(client, run, child["ids"]["a"], "start", scope_path=parent["ids"]["b"])

    assert _rejected(res) == (409, "action not allowed in this state")
    assert _get_detail(client, run)["scopes"] == []  # 실패한 동작의 버전 고정도 남지 않는다


def test_child_scope_of_directly_completed_host_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "direct host")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)
    _ok(_act(client, run, q, "complete", exit_key="__primary__"))

    # 들어가지 않고 바로 완료한 하위프로세스의 남은 단계는 건너뜀이라 나중에 들어가 밟지 않는다
    res = _act(client, run, child["ids"]["a"], "start", scope_path=q)

    assert _rejected(res) == (409, "action not allowed in this state")


def test_comment_pins_directly_completed_child_closed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "comment closed pin")
    q, child_a = parent["ids"]["q"], child["ids"]["a"]
    run = _create_run(client, parent)
    _ok(_act(client, run, q, "complete", exit_key="__primary__"))
    _ok(_act(client, run, parent["ids"]["a"], "start"))

    # 코멘트는 호스트 게이트 없이 범위를 처음 고정한다 — 들어가지 않고 완료한 호스트의 범위는 닫힌 채로 고정한다
    posted = client.post(
        f"/api/runs/{run['id']}/comments",
        json={"scope_path": q, "node_id": child_a, "body": "late note"},
        headers=as_user(client, run["starter"]),
    )
    assert posted.status_code == 201, posted.text

    assert _get_detail(client, run)["scopes"] == [{"scope_path": q, "version_id": child["version_id"], "closed": True}]
    assert _rejected(_act(client, run, child_a, "start", scope_path=q)) == (409, "action not allowed in this state")
    detail = _get_detail(client, run)
    host = _state_row(detail, q)
    assert (host["status"], host["exit_key"]) == ("done", "__primary__")  # 호스트가 진행 중으로 되돌아가지 않는다
    assert _states(detail)[parent["ids"]["a"]] == "active"


def test_comment_pins_nested_scope_under_closed_scope_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    top, middle, grandchild = _seed_nested(client, monkeypatch, "comment nested closed")
    q, grand_a = top["ids"]["q"], grandchild["ids"]["a"]
    inner = f"{q}/{middle['ids']['b']}"
    run = _create_run(client, top)
    _ok(_act(client, run, q, "complete", exit_key="__primary__"))

    posted = client.post(
        f"/api/runs/{run['id']}/comments",
        json={"scope_path": inner, "node_id": grand_a, "body": "deep note"},
        headers=as_user(client, run["starter"]),
    )
    assert posted.status_code == 201, posted.text

    # 사슬로 함께 고정되는 바깥 범위가 닫히면 그 아래 범위도 닫힌 채로 고정한다
    assert {s["scope_path"]: s["closed"] for s in _get_detail(client, run)["scopes"]} == {q: True, inner: True}
    assert _rejected(_act(client, run, grand_a, "start", scope_path=inner)) == (409, "action not allowed in this state")


def test_closed_child_scope_is_read_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "closed read only")
    q, child_a = parent["ids"]["q"], child["ids"]["a"]
    finished = _create_run(client, parent)  # 닫힌 범위에 완료 단계가 남은 실행
    _ok(_act(client, finished, child_a, "complete", scope_path=q))
    _ok(_act(client, finished, q, "complete", exit_key="__primary__"))
    flagged = _create_run(client, parent)  # 닫힌 범위에 문제 단계가 남은 실행
    _ok(_act(client, flagged, child_a, "problem", scope_path=q))
    assert _ok(_act(client, flagged, q, "complete", exit_key="__primary__"))["scopes"][0]["closed"] is True

    # 닫힌 범위의 완료·문제는 기록으로만 남는다 — 되돌리거나 해결·완료하지 않는다 (R9)
    read_only = (409, "action not allowed in this state")
    assert _rejected(_act(client, finished, child_a, "undo", scope_path=q)) == read_only
    assert _rejected(_act(client, flagged, child_a, "resolve", scope_path=q)) == read_only
    assert _rejected(_act(client, flagged, child_a, "complete", scope_path=q)) == read_only
    assert _states(_get_detail(client, flagged), q) == {child_a: "problem"}


def test_scope_nested_under_closed_scope_is_read_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    top, middle, grandchild = _seed_nested(client, monkeypatch, "closed nested")
    q, mid_b = top["ids"]["q"], middle["ids"]["b"]
    inner = f"{q}/{mid_b}"
    run = _create_run(client, top)
    _ok(_act(client, run, middle["ids"]["a"], "complete", scope_path=q))
    _ok(_act(client, run, grandchild["ids"]["a"], "complete", scope_path=inner))

    detail = _ok(_act(client, run, q, "complete", exit_key="__primary__"))

    # 바깥 호스트를 바로 완료하면 덜 밟은 아래 범위까지 모두 닫힌다
    assert {s["scope_path"]: s["closed"] for s in detail["scopes"]} == {q: True, inner: True}
    read_only = (409, "action not allowed in this state")
    assert _rejected(_act(client, run, grandchild["ids"]["a"], "undo", scope_path=inner)) == read_only

    async def _reopen_inner(session) -> None:
        # 아래 범위를 함께 닫기 전에 남은 기록처럼 — 바깥 범위가 닫힌 것만으로도 읽기 전용이어야 한다
        scope = await session.scalar(select(RunScope).where(RunScope.run_id == run["id"], RunScope.scope_path == inner))
        scope.closed = False

    _write_db(_reopen_inner)
    assert _rejected(_act(client, run, grandchild["ids"]["a"], "undo", scope_path=inner)) == read_only
    assert _states(_get_detail(client, run), q)[mid_b] == "active"  # 닫힌 범위 안 호스트를 다시 쓰지 않았다


def test_scope_path_rules(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, _child = _seed_sp_pair(client, monkeypatch, "scope rules")
    a = parent["ids"]["a"]
    run = _create_run(client, parent)

    deep = "/".join([parent["ids"]["q"]] * 6)
    assert _rejected(_act(client, run, "x", "start", scope_path=deep)) == (422, "subprocess is too deep")
    # 하위프로세스가 아닌 노드는 하위 범위를 열지 않는다
    assert _rejected(_act(client, run, "x", "start", scope_path=a)) == (422, "node is not actionable")
    assert _rejected(_get_graph(client, run, a)) == (422, "node is not actionable")


def test_subprocess_map_without_published_version_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 게시본 없이 Draft만 있는 맵 — 링크 해석이 Draft로 내려가도 실행은 들어가지 않는다(편집으로 노드 id가 바뀐다)
    draft_only = client.post(
        "/api/maps", json={"owning_department": OWNING_DEPARTMENT, "name": _unique("draft child")}
    )
    assert draft_only.status_code == 201, draft_only.text
    graph = load_case_graph("sp_exits")
    next(n for n in graph["nodes"] if n["id"] == "q")["linked_map_id"] = draft_only.json()["id"]
    parent = seed_published_map(client, monkeypatch, graph=graph, name=_unique("draft parent"))
    q = parent["ids"]["q"]
    run = _create_run(client, parent)

    acted = _act(client, run, "any-node", "start", scope_path=q)

    assert _rejected(acted) == (422, "subprocess map has no published version")
    assert _rejected(_get_graph(client, run, q)) == (422, "subprocess map has no published version")
    assert _get_detail(client, run)["scopes"] == []


def test_trashed_subprocess_map_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "trashed child")
    q = parent["ids"]["q"]
    run = _create_run(client, parent)
    _ok(_act(client, run, child["ids"]["a"], "start", scope_path=q))  # 버전 고정 뒤 휴지통 — 고정본 경로도 막는다

    assert client.delete(f"/api/maps/{child['map_id']}").status_code == 204

    unavailable = (422, "subprocess map is unavailable")
    assert _rejected(_act(client, run, child["ids"]["a"], "complete", scope_path=q)) == unavailable
    assert _rejected(_get_graph(client, run, q)) == unavailable
    assert _rejected(_get_graph(client, _create_run(client, parent), q)) == unavailable  # 해석 경로


def test_undesignated_subprocess_map_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "undesignated child", designate_child=False)
    q = parent["ids"]["q"]
    run = _create_run(client, parent)

    acted = _act(client, run, child["ids"]["a"], "start", scope_path=q)

    assert _rejected(acted) == (422, "subprocess map is unavailable")
    assert _rejected(_get_graph(client, run, q)) == (422, "subprocess map is unavailable")
    # 하위 맵에 들어갈 수 없어도 바깥에서 바로 완료하는 길은 열려 있다
    assert _states(_ok(_act(client, run, q, "complete", exit_key="__primary__"))) == {q: "done"}


def test_framework_subprocess_map_is_unavailable(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "framework child")
    q = parent["ids"]["q"]

    async def _flip(session) -> None:
        # L5 연계 캔버스는 지정할 수 없지만, 지정·게시된 맵이 framework가 된 경우까지 실행이 막는지 본다
        (await session.get(ProcessMap, child["map_id"])).mode = "framework"

    _write_db(_flip)
    run = _create_run(client, parent)

    assert _rejected(_act(client, run, child["ids"]["a"], "start", scope_path=q)) == (
        422,
        "subprocess map is unavailable",
    )
    assert _rejected(_get_graph(client, run, q)) == (422, "subprocess map is unavailable")


def test_child_scope_hidden_from_viewer_without_child_access(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    enforce_permissions: None,
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "hidden scope", parent_visibility="public")
    q, child_a = parent["ids"]["q"], child["ids"]["a"]
    member, outsider = "hide.child.member", "hide.child.outsider"  # 둘 다 공개 바깥 맵은 본다
    grant = client.post(
        f"/api/maps/{child['map_id']}/permissions",
        json={"principal_type": "user", "principal_id": member, "role": "viewer"},
        headers=as_user(client, child["owner"]),
    )
    assert grant.status_code == 201, grant.text
    run = _create_run(client, parent, member, scope="shared")
    _ok(_act(client, run, child_a, "start", scope_path=q))
    _ok(_act(client, run, child_a, "complete", scope_path=q))

    async def _comment(session) -> None:
        session.add(RunComment(run_id=run["id"], scope_path=q, node_id=child_a, author=member, body="note"))

    _write_db(_comment)

    seen = _get_detail(client, run, outsider)
    assert [s["scope_path"] for s in seen["states"]] == [""]  # 바깥 호스트(진행 중)만 보인다
    assert (seen["scopes"], seen["comment_counts"]) == ([], [])
    assert _rejected(_get_graph(client, run, q, outsider)) == (403, "cannot view the subprocess map")
    own = _get_detail(client, run, member)
    assert {s["scope_path"] for s in own["states"]} == {"", q} and len(own["scopes"]) == 1
    assert own["comment_counts"] == [{"scope_path": q, "node_id": child_a, "count": 1}]


def test_stale_action_is_rejected_and_state_kept(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "stale")
    a = seeded["ids"]["a"]
    member = "stale.member"
    seed_employee(member)
    run = _create_run(client, seeded, scope="shared", participants=[member])
    _ok(_act(client, run, a, "complete"))

    res = _act(client, run, a, "start", user=member)

    assert _rejected(res) == (409, "action not allowed in this state")
    assert _states(_get_detail(client, run, member)) == {a: "done"}


def test_run_continues_after_republish(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "republish")
    ids = seeded["ids"]
    run = _create_run(client, seeded)
    _ok(_act(client, run, ids["a"], "complete"))

    republish_map(client, monkeypatch, seeded["version_id"])
    detail = _ok(_act(client, run, ids["b"], "complete"))

    assert detail["version_is_current"] is False
    assert detail["status"] == "done"


def test_non_participant_cannot_act(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "bystander", visibility="public")
    run = _create_run(client, seeded, seeded["owner"], scope="shared")

    res = _act(client, run, seeded["ids"]["a"], "start", user="act.bystander")

    assert _rejected(res) == (403, "only participants can change this run")


def test_subprocess_map_access_is_checked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "sub access", parent_visibility="public")
    q = parent["ids"]["q"]
    run = _create_run(client, parent, "act.public.viewer")  # 공개 바깥 맵은 보지만 비공개 하위 맵은 못 본다

    acted = _act(client, run, child["ids"]["a"], "start", scope_path=q)

    assert _rejected(acted) == (403, "cannot view the subprocess map")
    assert _rejected(_get_graph(client, run, q)) == (403, "cannot view the subprocess map")
    # 하위 맵을 못 봐도 바깥에서 바로 완료하는 길은 열려 있다
    assert _states(_ok(_act(client, run, q, "complete", exit_key="__primary__"))) == {q: "done"}
