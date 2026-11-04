"""GET /api/me/dashboard — 내 열린 실행 수·줄: 정렬·상태 종류·가림·제외 (design 2026-11-04 §4.8)."""

import asyncio
import itertools
from collections.abc import Callable, Iterator
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import clock
from app.db import SessionLocal
from app.models import Run
from app.routers import me_dashboard
from tests.run_helpers import as_user, load_case_graph, seed_published_map

_names = itertools.count(1)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"me-dash-runs {label} {next(_names)}"


def _user(label: str) -> str:
    # 대시보드는 호출자 기준이라 테스트마다 새 사용자를 쓰면 목록에 내가 만든 실행만 남는다
    return f"mdr.{label}.{next(_names)}"


def _seed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, shape: str, label: str, *, visibility: str = "public"
) -> dict:
    return seed_published_map(
        client, monkeypatch, graph=load_case_graph(shape), name=_unique(label), visibility=visibility
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


def _act(client: TestClient, run: dict, user: str, node_id: str, action: str, *, scope_path: str = "") -> None:
    body = {"scope_path": scope_path, "node_id": node_id, "action": action}
    res = _call(client, "POST", f"/runs/{run['id']}/actions", user, json=body)
    assert res.status_code == 200, res.text


def _dashboard(client: TestClient, user: str) -> dict:
    res = _call(client, "GET", "/me/dashboard", user)
    assert res.status_code == 200, res.text
    return res.json()


def _set_run_fields(run_id: int, **fields: object) -> None:
    async def _work() -> None:
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            for key, value in fields.items():
                setattr(run, key, value)
            await session.commit()

    asyncio.run(_work())


def _days_ago(days: int) -> datetime:
    return clock.now() - timedelta(days=days, minutes=5)  # 경계에서 흔들리지 않게 5분 더 지난 것으로


@pytest.fixture
def set_limits(client: TestClient) -> Iterator[Callable[..., None]]:
    """방치 일수를 바꾸고 끝나면 기본값으로 되돌린다."""

    def _set(**limits: int) -> None:
        res = client.put("/api/admin/app-settings", json=limits)
        assert res.status_code == 200, res.text

    yield _set
    client.put("/api/admin/app-settings", json={"run_idle_warn_days": 30, "run_idle_stop_days": 40})


# ── 정렬 · 상태 종류 ──


def test_dashboard_runs_order_and_kinds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "order")
    a = seeded["ids"]["a"]
    user, member = _user("owner"), _user("member")
    seed_employee(member)
    # 만든 순서는 급한 순과 반대로 둔다: 다음 → 방치 → 문제
    next_run = _create_run(client, seeded, user, scope="shared", participants=[member], name="next-run")
    idle_run = _create_run(client, seeded, user, name="idle-run")
    problem_run = _create_run(client, seeded, user, name="problem-run")
    _set_run_fields(idle_run["id"], last_activity_at=_days_ago(31))
    _act(client, problem_run, user, a, "problem")

    body = _dashboard(client, user)

    assert [r["run_id"] for r in body["runs"]] == [problem_run["id"], idle_run["id"], next_run["id"]]
    problem, idle, upcoming = body["runs"]
    assert (problem["state_kind"], problem["state_title"], problem["state_more"]) == ("problem", "접수", 0)
    assert (idle["state_kind"], idle["is_idle"], idle["idle_days"], idle["stop_in_days"]) == ("idle", True, 31, 9)  # 40 - 31
    assert (problem["is_idle"], upcoming["is_idle"]) == (False, False)
    assert (upcoming["state_kind"], upcoming["state_title"], upcoming["state_more"]) == ("next", "접수", 0)
    assert (upcoming["idle_days"], upcoming["stop_in_days"]) == (0, 0)  # 방치가 아니면 채우지 않는다
    assert (problem["scope"], upcoming["scope"]) == ("solo", "shared")
    assert (problem["participant_count"], upcoming["participant_count"]) == (1, 2)
    assert (upcoming["done"], upcoming["total"]) == (0, 2)
    assert (problem["map_id"], problem["version_id"], problem["name"]) == (
        seeded["map_id"],
        seeded["version_id"],
        "problem-run",
    )
    assert problem["map_name"].startswith("me-dash-runs order ")
    activity = body["activity"]
    assert (activity["runs_open"], activity["runs_problem"], activity["runs_idle"]) == (3, 1, 1)


def test_dashboard_runs_empty_for_user_without_runs(client: TestClient) -> None:
    body = _dashboard(client, _user("none"))

    assert body["runs"] == []
    assert (body["activity"]["runs_open"], body["activity"]["runs_problem"], body["activity"]["runs_idle"]) == (0, 0, 0)


def test_dashboard_same_group_orders_by_recent_activity(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "same group")
    user = _user("recent")
    older = _create_run(client, seeded, user, name="older")
    newer = _create_run(client, seeded, user, name="newer")
    _set_run_fields(older["id"], last_activity_at=_days_ago(3))
    _set_run_fields(newer["id"], last_activity_at=_days_ago(1))

    body = _dashboard(client, user)

    assert [r["run_id"] for r in body["runs"]] == [newer["id"], older["id"]]


def test_dashboard_problem_title_is_first_in_flow_order_with_more_count(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded = _seed(client, monkeypatch, "start_parallel", "problem more")
    user = _user("more")
    run = _create_run(client, seeded, user)
    _act(client, run, user, seeded["ids"]["b"], "problem")  # 흐름 뒤쪽(서류 확인)을 먼저 문제로 둔다
    _act(client, run, user, seeded["ids"]["a"], "problem")

    row = _dashboard(client, user)["runs"][0]

    assert (row["state_kind"], row["state_title"], row["state_more"]) == ("problem", "시료 채취", 1)


def test_dashboard_next_title_is_first_ready_node_with_more_count(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded = _seed(client, monkeypatch, "start_parallel", "next more")
    user = _user("next")
    _create_run(client, seeded, user)

    row = _dashboard(client, user)["runs"][0]

    assert (row["state_kind"], row["state_title"], row["state_more"]) == ("next", "시료 채취", 1)  # 서류 확인도 ready


def test_dashboard_next_follows_progress(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "next progress")
    user = _user("progress")
    run = _create_run(client, seeded, user)
    _act(client, run, user, seeded["ids"]["a"], "complete")

    row = _dashboard(client, user)["runs"][0]

    assert (row["state_kind"], row["state_title"], row["done"], row["total"]) == ("next", "검토", 1, 2)


# ── 방치 일수 (R8) ──


def test_dashboard_idle_uses_effective_stop_days(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_limits: Callable[..., None]
) -> None:
    """설정이 중단 <= 경고여도 자동 중단은 경고 다음 날부터다 (R8: 중단 일수 = max(중단, 경고 + 1))."""
    seeded = _seed(client, monkeypatch, "linear", "idle effective")
    user = _user("idle")
    run = _create_run(client, seeded, user)
    set_limits(run_idle_warn_days=30, run_idle_stop_days=20)

    _set_run_fields(run["id"], last_activity_at=_days_ago(30))
    row = _dashboard(client, user)["runs"][0]
    assert (row["state_kind"], row["is_idle"], row["idle_days"], row["stop_in_days"]) == ("idle", True, 30, 1)  # 31 - 30

    _set_run_fields(run["id"], last_activity_at=_days_ago(33))  # 잡이 쉰 사이 넘긴 실행은 0에서 멈춘다
    row = _dashboard(client, user)["runs"][0]
    assert (row["idle_days"], row["stop_in_days"]) == (33, 0)


def test_dashboard_not_idle_before_warning_days(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "not idle")
    user = _user("fresh")
    run = _create_run(client, seeded, user)
    _set_run_fields(run["id"], last_activity_at=_days_ago(29))

    body = _dashboard(client, user)

    row = body["runs"][0]
    assert (row["state_kind"], row["is_idle"], row["idle_days"], row["stop_in_days"]) == ("next", False, 0, 0)
    assert body["activity"]["runs_idle"] == 0


def test_dashboard_problem_run_past_warning_days_is_also_idle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_limits: Callable[..., None]
) -> None:
    """"곧 중단"은 문제와 별개다 (R20): 줄 종류는 문제가 앞서도 방치 표시·일수·숫자는 그대로 채운다."""
    seeded = _seed(client, monkeypatch, "linear", "problem and idle")
    user = _user("both")
    both = _create_run(client, seeded, user, name="both")
    calm_idle = _create_run(client, seeded, user, name="calm idle")
    _act(client, both, user, seeded["ids"]["a"], "problem")
    _set_run_fields(both["id"], last_activity_at=_days_ago(35))
    _set_run_fields(calm_idle["id"], last_activity_at=_days_ago(33))

    body = _dashboard(client, user)

    row = body["runs"][0]
    assert row["run_id"] == both["id"]  # 줄 종류 우선순위와 정렬은 그대로: 문제 > 방치
    assert (row["state_kind"], row["state_title"], row["is_idle"]) == ("problem", "접수", True)
    assert (row["idle_days"], row["stop_in_days"]) == (35, 5)  # 40 - 35
    assert (body["runs"][1]["state_kind"], body["runs"][1]["is_idle"]) == ("idle", True)
    assert (body["activity"]["runs_problem"], body["activity"]["runs_idle"]) == (1, 2)  # 문제 실행도 곧 중단에 센다

    set_limits(run_idle_warn_days=30, run_idle_stop_days=20)  # R8: 중단 일수 = max(중단, 경고 + 1) = 31, 일수를 넘기면 0
    assert _dashboard(client, user)["runs"][0]["stop_in_days"] == 0


# ── 제외 ──


def test_dashboard_excludes_ended_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "ended")
    user = _user("ended")
    open_run = _create_run(client, seeded, user, name="still open")
    stopped = _create_run(client, seeded, user, name="stopped")
    done = _create_run(client, seeded, user, name="done")
    assert _call(client, "POST", f"/runs/{stopped['id']}/stop", user).status_code == 200
    for node in ("a", "b"):
        _act(client, done, user, seeded["ids"][node], "complete")

    body = _dashboard(client, user)

    assert [r["run_id"] for r in body["runs"]] == [open_run["id"]]
    assert body["activity"]["runs_open"] == 1


def test_dashboard_excludes_trashed_map_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    kept = _seed(client, monkeypatch, "linear", "trash kept")
    trashed = _seed(client, monkeypatch, "linear", "trash gone")
    user = _user("trash")
    kept_run = _create_run(client, kept, user)
    _create_run(client, trashed, user)

    assert client.delete(f"/api/maps/{trashed['map_id']}").status_code == 204
    body = _dashboard(client, user)

    assert [r["run_id"] for r in body["runs"]] == [kept_run["id"]]
    assert body["activity"]["runs_open"] == 1


def test_dashboard_only_lists_runs_i_participate_in(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, seed_employee: Callable[..., None]
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "participant")
    starter, member, bystander = _user("starter"), _user("member"), _user("bystander")
    seed_employee(member)
    shared = _create_run(client, seeded, starter, scope="shared", participants=[member])
    solo = _create_run(client, seeded, starter)

    assert {r["run_id"] for r in _dashboard(client, starter)["runs"]} == {shared["id"], solo["id"]}
    assert [r["run_id"] for r in _dashboard(client, member)["runs"]] == [shared["id"]]  # 남의 개인 실행은 안 보인다
    assert _dashboard(client, bystander)["runs"] == []
    assert shared["id"] not in {r["run_id"] for r in _dashboard(client, seeded["owner"])["runs"]}  # 맵 오너도 참여자가 아니면 빠진다


def test_dashboard_excludes_runs_on_maps_i_can_no_longer_view(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    enforce_permissions: None,
    seed_employee: Callable[..., None],
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
    run = _create_run(client, seeded, starter, scope="shared", participants=[kept, lost])
    res = _call(client, "DELETE", f"/maps/{seeded['map_id']}/permissions/{grants[lost]}", seeded["owner"])
    assert res.status_code == 200, res.text

    assert [r["run_id"] for r in _dashboard(client, kept)["runs"]] == [run["id"]]
    lost_body = _dashboard(client, lost)
    assert lost_body["runs"] == []
    assert lost_body["activity"]["runs_open"] == 0  # 줄만이 아니라 숫자에서도 빠진다


# ── 하위 맵 가림 (R16) ──


def test_dashboard_child_problem_title_hidden_without_child_access(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    enforce_permissions: None,
    seed_employee: Callable[..., None],
) -> None:
    parent, child = _seed_sp_pair(client, monkeypatch, "hidden child")
    q, child_a = parent["ids"]["q"], child["ids"]["a"]
    insider, outsider = _user("insider"), _user("outsider")  # 둘 다 공개 바깥 맵은 본다
    seed_employee(outsider)
    grant = _call(
        client,
        "POST",
        f"/maps/{child['map_id']}/permissions",
        child["owner"],
        json={"principal_type": "user", "principal_id": insider, "role": "viewer"},
    )
    assert grant.status_code == 201, grant.text
    run = _create_run(client, parent, insider, scope="shared", participants=[outsider])
    _act(client, run, insider, child_a, "problem", scope_path=q)

    seen = _dashboard(client, insider)["runs"][0]
    hidden_body = _dashboard(client, outsider)
    hidden = hidden_body["runs"][0]

    assert (seen["state_kind"], seen["state_title"], seen["state_more"]) == ("problem", "접수", 0)
    assert (hidden["state_kind"], hidden["state_title"], hidden["state_more"]) == ("problem", "", 0)  # 문제로는 센다
    assert hidden_body["activity"]["runs_problem"] == 1


def test_dashboard_visible_scopes_are_computed_only_for_child_problem_runs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded = _seed(client, monkeypatch, "linear", "no scope lookup")
    user = _user("rootonly")
    run = _create_run(client, seeded, user)
    _act(client, run, user, seeded["ids"]["a"], "problem")
    calls: list[int] = []
    real = me_dashboard.get_visible_scope_paths

    async def _spy(session, spied_run, spied_user):
        calls.append(spied_run.id)
        return await real(session, spied_run, spied_user)

    monkeypatch.setattr(me_dashboard, "get_visible_scope_paths", _spy)

    assert _dashboard(client, user)["runs"][0]["state_kind"] == "problem"
    assert calls == []  # 바깥 맵 문제는 하위 범위 가림 판정이 필요 없다


# ── 읽기 비용 · 상한 ──


def test_dashboard_loads_each_version_graph_once(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "graph cache")
    other = _seed(client, monkeypatch, "decision", "graph cache other")
    user = _user("cache")
    for _ in range(2):
        _create_run(client, seeded, user)
    _create_run(client, other, user)
    loaded: list[int] = []
    real = me_dashboard.load_version_graph

    async def _spy(session, version_id):
        loaded.append(version_id)
        return await real(session, version_id)

    monkeypatch.setattr(me_dashboard, "load_version_graph", _spy)

    assert len(_dashboard(client, user)["runs"]) == 3
    assert sorted(loaded) == sorted([seeded["version_id"], other["version_id"]])


def test_dashboard_caps_rows_but_counts_every_open_run(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "linear", "cap")
    user = _user("cap")
    calm = _create_run(client, seeded, user, name="calm")
    first = _create_run(client, seeded, user, name="first")
    second = _create_run(client, seeded, user, name="second")
    for run in (first, second):
        _act(client, run, user, seeded["ids"]["a"], "problem")
    monkeypatch.setattr(me_dashboard, "_RUN_LIMIT", 2)

    body = _dashboard(client, user)

    assert len(body["runs"]) == 2 and calm["id"] not in {r["run_id"] for r in body["runs"]}  # 급한 줄이 남는다
    assert body["activity"]["runs_open"] == 3 and body["activity"]["runs_problem"] == 2


def test_run_limit_is_thirty() -> None:
    assert me_dashboard._RUN_LIMIT == 30
