"""실행 체크(Run) API — 만들기·읽기·목록, 보기 규칙과 열린 실행 상한 (design 2026-11-04 §4.1·§4.4)."""

import asyncio
import itertools
from collections.abc import Callable, Iterator

import pytest
from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import MapVersion, ProcessMap, Run
from tests.run_helpers import as_user, load_case_graph, seed_published_map

_names = itertools.count(1)


def _unique(label: str) -> str:
    # 맵 이름은 전역 유니크이고 세션 DB는 리셋되지 않는다
    return f"runs-api {label} {next(_names)}"


def _seed(client: TestClient, monkeypatch: pytest.MonkeyPatch, label: str, *, visibility: str = "private") -> dict:
    return seed_published_map(
        client, monkeypatch, graph=load_case_graph("linear"), name=_unique(label), visibility=visibility
    )


def _create_run(
    client: TestClient,
    seeded: dict,
    user: str,
    *,
    name: str = "LOT-1",
    scope: str = "solo",
    participants: list[str] | None = None,
):
    body = {"name": name, "version_id": seeded["version_id"], "scope": scope, "participants": participants or []}
    return client.post(f"/api/maps/{seeded['map_id']}/runs", json=body, headers=as_user(client, user))


def _update_db(work: Callable) -> None:
    """테스트 준비용 직접 쓰기 — 아직 없는 중단·요약 같은 상태 전이를 DB에 둔다."""

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

    _update_db(_work)


@pytest.fixture
def set_run_caps(client: TestClient) -> Iterator[Callable[..., None]]:
    """열린 실행 상한을 바꾸고 끝나면 기본값(개인 10·공유 30)으로 되돌린다."""

    def _set(**caps: int) -> None:
        res = client.put("/api/admin/app-settings", json=caps)
        assert res.status_code == 200, res.text

    yield _set
    client.put("/api/admin/app-settings", json={"run_open_solo_cap": 10, "run_open_shared_cap": 30})


def test_create_solo_run_returns_detail(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "solo detail")
    starter = "run.solo.starter"

    res = _create_run(client, seeded, starter, name="LOT-7")

    assert res.status_code == 201, res.text
    body = res.json()
    assert body["scope"] == "solo"
    assert body["status"] == "open"
    assert body["name"] == "LOT-7"
    assert body["starter"] == starter
    assert body["participants"] == [{"login_id": starter, "muted": False}]
    assert body["progress"] == {"done": 0, "total": 2}
    assert body["problem_count"] == 0
    assert body["version_id"] == seeded["version_id"]
    assert body["version_is_current"] is True
    assert body["version_number"] is not None
    assert body["version_label"] == "As-Is"
    assert body["map_name"].startswith("runs-api solo detail")
    assert (body["can_act"], body["can_manage"], body["can_keep"]) == (True, True, True)
    assert (body["states"], body["scopes"], body["comment_counts"]) == ([], [], [])


def test_get_run_returns_the_created_detail(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "get detail")
    created = _create_run(client, seeded, "run.get.starter").json()

    res = client.get(f"/api/runs/{created['id']}", headers=as_user(client, "run.get.starter"))

    assert res.status_code == 200
    assert res.json() == created


def test_get_unknown_run_is_404(client: TestClient) -> None:
    res = client.get("/api/runs/99999999")
    assert (res.status_code, res.json()["detail"]) == (404, "run 99999999 not found")


def test_create_rejects_draft_version(client: TestClient) -> None:
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": _unique("draft")}
    ).json()

    res = client.post(
        f"/api/maps/{created['id']}/runs",
        json={"name": "LOT-1", "version_id": created["versions"][0]["id"], "scope": "solo"},
    )

    assert (res.status_code, res.json()["detail"]) == (422, "run needs a published version")


def test_create_rejects_version_of_another_map(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    mine = _seed(client, monkeypatch, "mine")
    other = _seed(client, monkeypatch, "other")

    res = client.post(
        f"/api/maps/{mine['map_id']}/runs",
        json={"name": "LOT-1", "version_id": other["version_id"], "scope": "solo"},
    )

    assert (res.status_code, res.json()["detail"]) == (422, "run needs a published version")


def test_create_allows_expired_version_that_is_not_current(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    seeded = _seed(client, monkeypatch, "expired")

    async def _expire(session) -> None:
        (await session.get(MapVersion, seeded["version_id"])).status = "expired"

    _update_db(_expire)
    res = _create_run(client, seeded, "run.expired.starter")

    assert res.status_code == 201, res.text
    assert res.json()["version_is_current"] is False


def test_create_rejects_framework_map(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "framework")

    async def _flip(session) -> None:
        (await session.get(ProcessMap, seeded["map_id"])).mode = "framework"

    _update_db(_flip)
    res = _create_run(client, seeded, "run.fw.starter")

    assert (res.status_code, res.json()["detail"]) == (422, "framework maps cannot run")


def test_shared_run_participant_must_view_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "participant access")

    res = _create_run(client, seeded, seeded["owner"], scope="shared", participants=["outsider.lee"])

    assert (res.status_code, res.json()["detail"]) == (422, "participant outsider.lee cannot view this map")


def test_shared_run_participants_are_deduped_and_include_starter(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "participant dedupe", visibility="public")
    starter = seeded["owner"]

    res = _create_run(client, seeded, starter, scope="shared", participants=["pub.a", "pub.a", starter, "pub.b"])

    assert res.status_code == 201, res.text
    assert [p["login_id"] for p in res.json()["participants"]] == [starter, "pub.a", "pub.b"]


def test_viewer_can_start_run(client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None) -> None:
    seeded = _seed(client, monkeypatch, "viewer start", visibility="public")

    res = _create_run(client, seeded, "pub.viewer")

    assert res.status_code == 201, res.text
    assert res.json()["can_act"] is True


def test_user_without_map_access_cannot_start_run(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "private start")

    assert _create_run(client, seeded, "outsider.lee").status_code == 403


def test_solo_cap(client: TestClient, monkeypatch: pytest.MonkeyPatch, set_run_caps: Callable[..., None]) -> None:
    set_run_caps(run_open_solo_cap=2)
    seeded = _seed(client, monkeypatch, "solo cap")
    starter = "cap.solo.starter"

    assert _create_run(client, seeded, starter, name="1").status_code == 201
    assert _create_run(client, seeded, starter, name="2").status_code == 201
    third = _create_run(client, seeded, starter, name="3")

    assert (third.status_code, third.json()["detail"]) == (409, "open solo run limit reached")
    # 다른 사람의 개인 실행은 내 상한에 세지 않는다
    assert _create_run(client, seeded, "cap.solo.other").status_code == 201


def test_solo_cap_counts_across_maps_but_not_trashed_maps(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_run_caps: Callable[..., None]
) -> None:
    set_run_caps(run_open_solo_cap=2)
    first, second = _seed(client, monkeypatch, "cross a"), _seed(client, monkeypatch, "cross b")
    starter = "cap.cross.starter"

    assert _create_run(client, first, starter, name="1").status_code == 201
    assert _create_run(client, second, starter, name="2").status_code == 201
    assert _create_run(client, second, starter, name="3").status_code == 409  # 맵을 가로질러 센다
    assert client.delete(f"/api/maps/{first['map_id']}").status_code == 204
    # 휴지통 맵의 실행은 보이지도 지울 수도 없어 상한에서 뺀다
    assert _create_run(client, second, starter, name="4").status_code == 201


def test_shared_cap_counts_only_shared_runs_of_the_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, set_run_caps: Callable[..., None]
) -> None:
    set_run_caps(run_open_shared_cap=2)
    seeded = _seed(client, monkeypatch, "shared cap")

    assert _create_run(client, seeded, "cap.shared.a", scope="solo").status_code == 201
    assert _create_run(client, seeded, "cap.shared.a", name="1", scope="shared").status_code == 201
    assert _create_run(client, seeded, "cap.shared.b", name="2", scope="shared").status_code == 201
    fourth = _create_run(client, seeded, "cap.shared.c", name="3", scope="shared")

    assert (fourth.status_code, fourth.json()["detail"]) == (409, "open shared run limit reached")


def test_solo_run_hidden_from_others(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "solo hidden", visibility="public")
    run_id = _create_run(client, seeded, "hide.viewer.a").json()["id"]

    for other in ("hide.viewer.b", seeded["owner"]):  # 맵 오너도 남의 개인 실행은 보지 않는다
        headers = as_user(client, other)
        res = client.get(f"/api/runs/{run_id}", headers=headers)
        assert (res.status_code, res.json()["detail"]) == (404, f"run {run_id} not found")
        listed = client.get(f"/api/maps/{seeded['map_id']}/runs", headers=headers).json()
        assert listed["items"] == [] and listed["total"] == 0

    mine = client.get(f"/api/maps/{seeded['map_id']}/runs", headers=as_user(client, "hide.viewer.a")).json()
    assert [r["id"] for r in mine["items"]] == [run_id]


def test_shared_run_is_readable_by_non_participant_viewers(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "shared read", visibility="public")
    run_id = _create_run(client, seeded, "read.starter", scope="shared", participants=["read.member"]).json()["id"]

    res = client.get(f"/api/runs/{run_id}", headers=as_user(client, "read.bystander"))

    assert res.status_code == 200
    body = res.json()
    assert (body["can_act"], body["can_manage"], body["can_keep"]) == (False, False, False)
    member = client.get(f"/api/runs/{run_id}", headers=as_user(client, "read.member")).json()
    assert (member["can_act"], member["can_manage"], member["can_keep"]) == (True, False, False)


def test_map_owner_can_keep_shared_but_not_solo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "keep owner", visibility="public")
    shared_id = _create_run(client, seeded, "keep.starter", scope="shared").json()["id"]
    solo_id = _create_run(client, seeded, "keep.starter", name="own").json()["id"]

    owner = as_user(client, seeded["owner"])
    shared = client.get(f"/api/runs/{shared_id}", headers=owner).json()
    assert (shared["can_keep"], shared["can_manage"], shared["can_act"]) == (True, False, False)
    assert client.get(f"/api/runs/{solo_id}", headers=owner).status_code == 404


def test_participant_without_access_cannot_open(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, enforce_permissions: None
) -> None:
    seeded = _seed(client, monkeypatch, "access lost")
    owner, member = as_user(client, seeded["owner"]), "lost.member"
    grant = client.post(
        f"/api/maps/{seeded['map_id']}/permissions",
        json={"principal_type": "user", "principal_id": member, "role": "viewer"},
        headers=owner,
    )
    assert grant.status_code == 201, grant.text
    run_id = _create_run(client, seeded, seeded["owner"], scope="shared", participants=[member]).json()["id"]
    assert client.get(f"/api/runs/{run_id}", headers=as_user(client, member)).status_code == 200

    removed = client.delete(f"/api/maps/{seeded['map_id']}/permissions/{grant.json()['id']}", headers=owner)
    assert removed.status_code == 200, removed.text

    res = client.get(f"/api/runs/{run_id}", headers=as_user(client, member))
    assert (res.status_code, res.json()["detail"]) == (404, f"run {run_id} not found")


def test_list_tabs_and_filters(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "list filters")
    a, b = "list.user.a", "list.user.b"
    solo_a = _create_run(client, seeded, a, name="Alpha solo").json()["id"]
    shared_a = _create_run(client, seeded, a, name="Beta shared", scope="shared", participants=[b]).json()["id"]
    solo_b = _create_run(client, seeded, b, name="Gamma solo b").json()["id"]
    shared_b = _create_run(client, seeded, b, name="Delta shared b", scope="shared").json()["id"]
    summarized = _create_run(client, seeded, b, name="Eps shared old", scope="shared").json()["id"]
    url = f"/api/maps/{seeded['map_id']}/runs"
    headers = as_user(client, a)

    def ids(**params: object) -> list[int]:
        res = client.get(url, params=params, headers=headers)
        assert res.status_code == 200, res.text
        assert res.json()["page_size"] == 8
        return [row["id"] for row in res.json()["items"]]

    _set_run_fields(summarized, status="summarized")
    # 열린 탭이 기본이고 남의 개인 실행(solo_b)은 빠진다 — 정렬은 최근 활동, 같으면 id 큰 쪽이 위
    assert ids() == [shared_b, shared_a, solo_a]
    assert ids(tab="open", mine=True) == [shared_a, solo_a]
    assert ids(q="ALPHA") == [solo_a]
    assert ids(q="shared") == [shared_b, shared_a]
    assert ids(q="%") == []  # LIKE 와일드카드는 글자 그대로 찾는다
    assert ids(tab="summary") == [summarized]

    _set_run_fields(solo_a, status="done", end_reason="completed")
    _set_run_fields(shared_a, status="stopped", end_reason="stopped", keep=True)
    assert ids(tab="ended") == [shared_a, solo_a]
    assert ids(tab="ended", kept=True) == [shared_a]
    assert ids(tab="open") == [shared_b]
    assert solo_b not in ids(tab="ended") + ids(tab="open") + ids(tab="summary")


def test_list_paginates_eight_per_page(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "list pages")
    created = [
        _create_run(client, seeded, "page.user", name=f"LOT-{n}", scope="shared").json()["id"] for n in range(9)
    ]
    url = f"/api/maps/{seeded['map_id']}/runs"

    first = client.get(url, params={"page": 1}).json()
    second = client.get(url, params={"page": 2}).json()

    assert (first["total"], first["page"], first["page_size"]) == (9, 1, 8)
    assert [r["id"] for r in first["items"]] == sorted(created, reverse=True)[:8]
    assert [r["id"] for r in second["items"]] == [created[0]]
    assert client.get(url, params={"page": 0}).status_code == 422
    assert client.get(url, params={"tab": "bogus"}).status_code == 422


def test_trashed_map_hides_runs(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seeded = _seed(client, monkeypatch, "trashed")
    starter = "trash.starter"
    run_id = _create_run(client, seeded, starter).json()["id"]
    headers = as_user(client, starter)

    assert client.delete(f"/api/maps/{seeded['map_id']}").status_code == 204

    detail = client.get(f"/api/runs/{run_id}", headers=headers)
    assert (detail.status_code, detail.json()["detail"]) == (404, f"run {run_id} not found")
    listed = client.get(f"/api/maps/{seeded['map_id']}/runs", headers=headers)
    assert (listed.status_code, listed.json()["detail"]) == (404, f"map {seeded['map_id']} not found")
    assert _create_run(client, seeded, starter).status_code == 404
