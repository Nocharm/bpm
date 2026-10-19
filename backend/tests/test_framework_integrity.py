"""업무 체계 무결성 — 시스템 리뷰 2026-10-19 6단계(E-1·E-3~E-9) 회귀.

동시성 픽스(E-7 이동 잠금·E-8 캔버스 생성 잠금·E-10 결정 잠금)는 sqlite가 FOR UPDATE를 무시해 여기서 재현되지 않는다
— 일회용 postgres에서 따로 확인한다. 공유 세션 DB라 카테고리 코드는 테스트마다 고유 접두사(FWI-<tag>)로 격리한다.
"""

from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.main import app
from app.models import CategoryPermission, ProcessCategory, ProcessMap
from app.settings import settings
from tests.test_framework_canvas import SYSADMIN, _checkout, _put_graph, act_as
from tests.test_framework_canvas import _seed_category as _seed_cat
from tests.test_framework_canvas import _seed_l6_map as _seed_l6
from tests.test_framework_slots import _apply, _create_map, _draft_id, _put_edge, _run
from tests.test_framework_slots import _seed_l6_map as _seed_owned_l6

UPPER = "fwi.upper"    # L1 체인 관리자 — 확정은 요청만
DIRECT = "fwi.direct"  # 직속 L5 관리자 — 결정권자
OWNER = "fwi.owner"    # 일반 맵 오너(어느 L5 관리자도 아님)


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    prev_auth, prev_sys = settings.auth_enabled, settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled, settings.bpm_sysadmins = prev_auth, prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def _tag() -> str:
    return f"FWI-{uuid4().hex[:6]}"


def _grant(client: TestClient, category_id: int, login: str) -> None:
    act_as(SYSADMIN)
    r = client.put(f"/api/categories/{category_id}/permissions",
                   json={"permissions": [{"principal_type": "user", "principal_id": login}]})
    assert r.status_code == 200, r.text


def _chain_canvas(client: TestClient, with_l6: bool = True) -> tuple[int, int, int, int]:
    """L1(UPPER) → L5(DIRECT) + 연계 캔버스. 반환 (l1, l5, canvas_map_id, draft_id)."""
    tag = _tag()
    l1 = _seed_cat(client, f"{tag}-L1", f"{tag} L1")
    l5 = _seed_cat(client, f"{tag}-L5", f"{tag} L5", level=5, parent_id=l1)
    if with_l6:
        _seed_l6(client, l5, f"{tag} 업무", f"{tag}-M1")
    _grant(client, l1, UPPER)
    _grant(client, l5, DIRECT)
    act_as(SYSADMIN)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    return l1, l5, canvas, _draft_id(client, canvas)


def _acquire(client: TestClient, user: str, draft_id: int) -> dict:
    act_as(user)
    r = client.post(f"/api/versions/{draft_id}/checkout", json={})
    assert r.status_code == 200, r.text
    return r.json()


# ── E-1 확정 요청 중 점유 ───────────────────────────────────────────────────────


def test_confirm_request_keeps_checkout_free_for_the_decider(client: TestClient, enforce: None) -> None:
    """요청 뒤 요청자 폴링이 점유를 되가져가면 직속 관리자의 승인이 409였다 — 대기 중엔 결정권자만 점유한다."""
    _, _, canvas, draft = _chain_canvas(client)
    assert _acquire(client, UPPER, draft)["mine"] is True
    req = client.post(f"/api/maps/{canvas}/fw-confirm-requests", json={"note": "please"})
    assert req.status_code == 201, req.text

    polled = _acquire(client, UPPER, draft)  # 열려 있는 요청자 에디터의 10초 폴
    assert polled["mine"] is False and polled["confirm_pending"] is True
    assert polled["checked_out_by"] is None

    act_as(DIRECT)
    decided = client.post(f"/api/approval-requests/{req.json()['id']}/decide", json={"decision": "approve"})
    assert decided.status_code == 200, decided.text
    assert decided.json()["status"] == "applied"
    # 결정이 끝나면 대기 표시는 풀린다 — 확정자는 확정하면서 점유를 가져가므로(spec §4) 평소처럼 "편집 중"
    after = _acquire(client, UPPER, draft)
    assert after["confirm_pending"] is False and after["checked_out_by"] == DIRECT


def test_withdrawn_confirm_request_lets_the_requester_edit_again(client: TestClient, enforce: None) -> None:
    _, _, canvas, draft = _chain_canvas(client)
    _acquire(client, UPPER, draft)
    assert client.post(f"/api/maps/{canvas}/fw-confirm-requests", json={}).status_code == 201
    assert _acquire(client, UPPER, draft)["confirm_pending"] is True
    # 결정권자는 대기 중에도 점유할 수 있다
    assert _acquire(client, DIRECT, draft)["mine"] is True
    assert client.delete(f"/api/versions/{draft}/checkout").status_code == 204

    act_as(UPPER)
    assert client.delete(f"/api/maps/{canvas}/fw-confirm-requests/pending").status_code == 204
    after = _acquire(client, UPPER, draft)
    assert after["mine"] is True and after["confirm_pending"] is False


# ── E-3 삭제된 캔버스 ───────────────────────────────────────────────────────────


def _l5_row(client: TestClient, l1: int, l5: int) -> dict:
    act_as(SYSADMIN)
    return next(r for r in client.get(f"/api/categories/nodes?parent_id={l1}").json() if r["id"] == l5)


def _pointer(l5: int) -> int | None:
    async def _get(session):
        return (await session.get(ProcessCategory, l5)).linkage_map_id

    return _run(_get)


def test_deleted_canvas_reads_as_no_canvas_and_restores(client: TestClient, enforce: None) -> None:
    tag = _tag()
    l1 = _seed_cat(client, f"{tag}-L1", f"{tag} L1")
    l5 = _seed_cat(client, f"{tag}-L5", f"{tag} L5", level=5, parent_id=l1)
    _seed_l6(client, l5, f"{tag} 업무", f"{tag}-M1")
    _grant(client, l5, DIRECT)
    act_as(DIRECT)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    assert _l5_row(client, l1, l5)["linkage_map_id"] == canvas

    act_as(SYSADMIN)
    assert client.delete(f"/api/maps/{canvas}").status_code == 204
    row = _l5_row(client, l1, l5)
    assert row["linkage_map_id"] is None and row["canvas_state"] == "none"
    assert client.get(f"/api/categories/{l5}/chain").json()[-1]["linkage_map_id"] is None
    assert client.get(f"/api/categories/{l5}/summary").json()["l5"]["linkage_map_id"] is None
    l1_summary = client.get(f"/api/categories/{l1}/summary").json()["subtree_confirm"]
    assert l1_summary["no_canvas"] == 1
    # 만든 L5 관리자 휴지통에는 안 보인다(복구가 sysadmin뿐이라 버튼이 403으로 끝났다)
    act_as(DIRECT)
    assert canvas not in [m["id"] for m in client.get("/api/maps/deleted/list").json()]

    # 포인터는 남아 있어 sysadmin 복구로 그 L5에 돌아온다
    act_as(SYSADMIN)
    assert client.post(f"/api/maps/{canvas}/restore").status_code == 200
    assert _l5_row(client, l1, l5)["linkage_map_id"] == canvas

    # 그 사이 새 캔버스를 만들었다면 옛 캔버스는 되살리지 않는다(고아 캔버스)
    assert client.delete(f"/api/maps/{canvas}").status_code == 204
    act_as(DIRECT)
    fresh = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    assert fresh != canvas
    act_as(SYSADMIN)
    assert client.post(f"/api/maps/{canvas}/restore").status_code == 409


def test_purged_canvas_unlinks_its_l5(client: TestClient, enforce: None) -> None:
    """옛 DB엔 FK(SET NULL)가 없어 영구삭제 뒤에도 포인터가 남았고 그 L5는 지울 수 없었다(409)."""
    tag = _tag()
    l5 = _seed_cat(client, f"{tag}-L5", f"{tag} L5", level=5)
    act_as(SYSADMIN)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    assert client.delete(f"/api/maps/{canvas}").status_code == 204
    assert client.delete(f"/api/maps/{canvas}/permanent").status_code == 204
    assert _pointer(l5) is None
    assert client.delete(f"/api/categories/{l5}").status_code == 204


# ── E-4 레벨이 바뀌는 이동 · 형제 이름 ────────────────────────────────────────────


def _tree(client: TestClient) -> dict[str, int]:
    """L1 → L2a·L2b → L3a(L2a 아래)·L3b(L2b 아래) → X(L4, L3a 아래) → Y(L5, 맵 1개)."""
    tag = _tag()
    ids: dict[str, int] = {"tag": tag}  # type: ignore[dict-item]
    ids["l1"] = _seed_cat(client, f"{tag}-1", f"{tag} 1")
    ids["l2a"] = _seed_cat(client, f"{tag}-2a", f"{tag} 2a", level=2, parent_id=ids["l1"])
    ids["l2b"] = _seed_cat(client, f"{tag}-2b", f"{tag} 2b", level=2, parent_id=ids["l1"])
    ids["l3a"] = _seed_cat(client, f"{tag}-3a", f"{tag} 3a", level=3, parent_id=ids["l2a"])
    ids["l3b"] = _seed_cat(client, f"{tag}-3b", f"{tag} 3b", level=3, parent_id=ids["l2b"])
    ids["x"] = _seed_cat(client, f"{tag}-x", f"{tag} X", level=4, parent_id=ids["l3a"])
    ids["y"] = _seed_cat(client, f"{tag}-y", f"{tag} Y", level=5, parent_id=ids["x"])
    _seed_l6(client, ids["y"], f"{tag} 업무", f"{tag}-M")
    return ids


def test_move_that_relevels_slotted_l5_is_rejected(client: TestClient, enforce: None) -> None:
    ids = _tree(client)
    act_as(SYSADMIN)
    # L4 X를 L2 아래로 — Y가 L4가 되면 슬롯(L5 전용)이 깨진다
    r = client.patch(f"/api/categories/{ids['x']}", json={"parent_id": ids["l2b"]})
    assert r.status_code == 422 and "levels" in r.json()["detail"]
    # 같은 레벨로의 이동은 그대로 된다
    assert client.patch(f"/api/categories/{ids['x']}", json={"parent_id": ids["l3b"]}).status_code == 200


def test_move_that_relevels_an_empty_subtree_is_allowed(client: TestClient, enforce: None) -> None:
    tag = _tag()
    l1 = _seed_cat(client, f"{tag}-1", f"{tag} 1")
    l2 = _seed_cat(client, f"{tag}-2", f"{tag} 2", level=2, parent_id=l1)
    l3 = _seed_cat(client, f"{tag}-3", f"{tag} 3", level=3, parent_id=l2)
    x = _seed_cat(client, f"{tag}-x", f"{tag} X", level=4, parent_id=l3)
    _seed_cat(client, f"{tag}-y", f"{tag} Y", level=5, parent_id=x)
    act_as(SYSADMIN)
    r = client.patch(f"/api/categories/{x}", json={"parent_id": l1})
    assert r.status_code == 200, r.text
    assert r.json()["level"] == 2


def test_rename_or_move_into_a_same_named_sibling_is_rejected(client: TestClient, enforce: None) -> None:
    ids = _tree(client)
    taken = f"{ids['tag']} 겹침"
    _seed_cat(client, f"{ids['tag']}-dup", taken, level=4, parent_id=ids["l3b"])
    _seed_cat(client, f"{ids['tag']}-sib", f"{ids['tag']} 형제", level=4, parent_id=ids["l3a"])
    act_as(SYSADMIN)
    assert client.patch(f"/api/categories/{ids['x']}", json={"name": f"{ids['tag']} 형제"}).status_code == 409
    assert client.patch(f"/api/categories/{ids['x']}", json={"name": taken}).status_code == 200
    # 같은 이름이 있는 부모로 이동
    assert client.patch(f"/api/categories/{ids['x']}", json={"parent_id": ids["l3b"]}).status_code == 409


# ── E-5 빈 L5 삭제 ──────────────────────────────────────────────────────────────


def test_l5_referenced_by_a_canvas_placeholder_cannot_be_deleted(client: TestClient, enforce: None) -> None:
    """지우면 그 캔버스 저장이 매번 422(없는 카테고리 참조)가 됐다."""
    l1, _, _, draft = _chain_canvas(client)
    target = _seed_cat(client, f"{_tag()}-PH", "자리 대상 L5", level=5, parent_id=l1)
    act_as(SYSADMIN)
    _checkout(client, draft)
    graph = client.get(f"/api/versions/{draft}/graph").json()
    node = graph["nodes"][0]
    placeholder = dict(node, id=uuid4().hex, title="미등록", linked_map_id=None,
                       placeholder_category_id=target, pos_y=node["pos_y"] + 200)
    _put_graph(client, draft, [node, placeholder])

    r = client.delete(f"/api/categories/{target}")
    assert r.status_code == 409 and "placeholder" in r.json()["detail"]
    _put_graph(client, draft, [node])
    assert client.delete(f"/api/categories/{target}").status_code == 204
    _put_graph(client, draft, [node])  # 캔버스 저장은 계속 된다


def test_deleting_a_category_removes_its_permission_rows(client: TestClient, enforce: None) -> None:
    """sqlite는 FK CASCADE를 강제하지 않아 권한 행이 고아로 남고 위임 범위 계산이 500이 됐다."""
    l5 = _seed_cat(client, f"{_tag()}-L5", "권한만 있는 L5", level=5)
    _grant(client, l5, DIRECT)
    assert client.delete(f"/api/categories/{l5}").status_code == 204

    async def _count(session):
        return len((await session.scalars(
            select(CategoryPermission).where(CategoryPermission.category_id == l5)
        )).all())

    assert _run(_count) == 0
    act_as(DIRECT)
    assert client.get("/api/categories/nodes").status_code == 200


# ── E-6 슬롯 교체 뒤 낡은 자동저장 ───────────────────────────────────────────────


def test_stale_save_cannot_bring_back_a_replaced_map(client: TestClient) -> None:
    """후계가 이미 캔버스에 있으면 서버가 옛 노드를 지우고 엣지를 옮긴다 — 점유자의 낡은 저장이 되살리던 경로."""
    tag = _tag()
    l5 = _seed_cat(client, f"{tag}-L5", f"{tag} L5", level=5)
    other = _seed_cat(client, f"{tag}-X5", f"{tag} X5", level=5)
    a = _seed_owned_l6(l5, f"{tag} A", f"{tag}-A")
    b = _seed_owned_l6(l5, f"{tag} B", f"{tag}-B")
    c = _seed_owned_l6(other, f"{tag} C", f"{tag}-C")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code == 200
    graph = client.get(f"/api/versions/{draft}/graph").json()
    na = next(n for n in graph["nodes"] if n["linked_map_id"] == a)
    nc = dict(na, id=uuid4().hex, linked_map_id=c, title=f"{tag} C", pos_y=na["pos_y"] + 240)
    assert client.put(f"/api/versions/{draft}/graph",
                      json={"nodes": graph["nodes"] + [nc], "edges": [], "groups": []}).status_code == 200
    _put_edge(client, draft, a, b)
    stale = client.get(f"/api/versions/{draft}/graph").json()  # 점유자 화면에 남은 그래프

    _apply({"action": "unassign", "map_id": c})

    async def _clear_code(session):
        (await session.get(ProcessMap, c)).consultant_code = None

    _run(_clear_code)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    r = client.put(f"/api/versions/{draft}/graph",
                   json={"nodes": stale["nodes"], "edges": stale["edges"], "groups": []})
    assert r.status_code == 422
    assert r.json()["detail"].startswith("retired L6 maps cannot be linked on the canvas")
    linked = {n["linked_map_id"] for n in client.get(f"/api/versions/{draft}/graph").json()["nodes"]}
    assert a not in linked and c in linked


# ── E-9 승인 대기 배지 ──────────────────────────────────────────────────────────


def _slot_pending(client: TestClient, l5_ids: list[int]) -> dict[int, int]:
    act_as(SYSADMIN)
    rows = client.get("/api/categories/nodes").json()
    return {r["id"]: r.get("slot_pending_count") for r in rows if r["id"] in l5_ids}


def test_slot_pending_badge_counts_the_side_that_must_decide(client: TestClient, enforce: None) -> None:
    """맵의 지금 L5로만 세면 move의 도착 L5는 0, 출발 L5는 승인한 뒤에도 1로 남았다(인박스와 불일치)."""
    tag = _tag()
    src = _seed_cat(client, f"{tag}-S5", f"{tag} 출발", level=5)
    dst = _seed_cat(client, f"{tag}-D5", f"{tag} 도착", level=5)
    _grant(client, src, "fwi.src")
    _grant(client, dst, "fwi.dst")
    act_as(OWNER)
    moved = _create_map(client, f"{tag} 맵")

    async def _slot(session):
        found = await session.get(ProcessMap, moved)
        found.category_id, found.consultant_code = src, f"{tag}-MV"

    _run(_slot)
    r = client.post(f"/api/maps/{moved}/slot-changes", json={"action": "move", "to_category_id": dst})
    assert r.status_code == 200 and r.json()["mode"] == "requested", r.text
    assert _slot_pending(client, [src, dst]) == {src: 1, dst: 1}

    act_as("fwi.src")
    left = client.post(f"/api/approval-requests/{r.json()['request_id']}/decide", json={"decision": "approve"})
    assert left.status_code == 200 and left.json()["status"] == "pending", left.text
    assert _slot_pending(client, [src, dst]) == {src: 0, dst: 1}

    act_as("fwi.dst")
    framework = client.get("/api/me/dashboard").json()["framework"]
    assert next(c for c in framework if c["category_id"] == dst)["slot_pending_count"] == 1


# ── E-7 부모 사이클 ─────────────────────────────────────────────────────────────


def test_chain_survives_a_parent_cycle_left_in_the_db(client: TestClient, enforce: None) -> None:
    """동시 이동으로 사이클이 남으면 chain 조회가 단일 워커를 무한 루프에 빠뜨렸다."""
    tag = _tag()
    a = _seed_cat(client, f"{tag}-A", f"{tag} A")
    b = _seed_cat(client, f"{tag}-B", f"{tag} B", level=2, parent_id=a)

    async def _set_parent(session, child: int, parent: int | None):
        (await session.get(ProcessCategory, child)).parent_id = parent

    _run(lambda s: _set_parent(s, a, b))
    try:
        act_as(SYSADMIN)
        r = client.get(f"/api/categories/{a}/chain")
        assert r.status_code == 200
        assert sorted(row["id"] for row in r.json()) == sorted([a, b])
    finally:
        _run(lambda s: _set_parent(s, a, None))
