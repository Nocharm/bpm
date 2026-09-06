"""Framework 슬롯 변경 — 결함 회귀·코어·slot-changes 엔드포인트 (spec 2026-09-06).

client 픽스처가 세션 스코프 공유 DB라 카테고리 코드는 이 파일 전용 접두사(FWS-*)로 격리한다.
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapVersion, ProcessCategory, ProcessMap
from app.settings import settings

SYSADMIN = "fws.sysadmin"
DEPT = "Owning Anchor Division"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이어서 권한 분기가 안 걸린다."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _run(coro_factory):
    async def _go():
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_go())


def _seed_category(code: str, name: str, level: int = 1, parent_id: int | None = None) -> int:
    async def _seed(session):
        row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
        if row is None:
            row = ProcessCategory(code=code, name=name, level=level, parent_id=parent_id, sort_order=0)
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _seed_l6_map(category_id: int | None, name: str, code: str | None, owner: str = SYSADMIN) -> int:
    """게시본 1개를 가진 일반 맵 — code가 있으면 consultant_code(멱등 키)로 재사용."""

    async def _seed(session):
        row = None
        if code is not None:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
        if row is None:
            row = ProcessMap(name=name, created_by=owner, owner_id=owner, visibility="public",
                             category_id=category_id, consultant_code=code)
            row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
            session.add(row)
            await session.flush()
        return row.id

    return _run(_seed)


def _map_row(map_id: int) -> dict:
    async def _get(session):
        m = await session.get(ProcessMap, map_id)
        return {"category_id": m.category_id, "consultant_code": m.consultant_code,
                "deleted": m.deleted_at is not None, "retired_to": m.retired_to_map_id, "mode": m.mode}

    return _run(_get)


def _draft_id(client: TestClient, map_id: int) -> int:
    detail = client.get(f"/api/maps/{map_id}").json()
    return next(v for v in detail["versions"] if v["status"] == "draft")["id"]


def _create_map(client: TestClient, name: str) -> int:
    resp = client.post("/api/maps", json={"name": name, "visibility": "public", "owning_department": DEPT})
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


# ── 결함 회귀 (2026-09-03 프로브 승격) ─────────────────────────────────────────


def test_transfer_succeeds_when_target_id_is_lower(client: TestClient) -> None:
    """결함 ①: target.id < source.id 이면 UPDATE 순서(PK 오름차순) 때문에 unique(consultant_code) 충돌."""
    l5 = _seed_category("FWS-A5", "핫픽스A", level=5)
    target = _create_map(client, "fws hotfix target older")
    source = _seed_l6_map(l5, "fws hotfix source", "FWS-A-SRC")
    assert target < source
    resp = client.post(f"/api/maps/{source}/framework-transfer", json={"to_map_id": target})
    assert resp.status_code == 200, resp.text
    assert _map_row(source)["consultant_code"] is None
    assert _map_row(target) == {"category_id": l5, "consultant_code": "FWS-A-SRC", "deleted": False,
                                "retired_to": None, "mode": "normal"}


def test_slot_endpoints_reject_non_normal_maps(client: TestClient) -> None:
    """결함 ②: 연계 캔버스(mode=framework)는 슬롯 대상도 이양 대상도 될 수 없다."""
    l5 = _seed_category("FWS-B5", "핫픽스B", level=5)
    other_l5 = _seed_category("FWS-B5X", "핫픽스BX", level=5)
    canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]
    src = _seed_l6_map(l5, "fws hotfix src", "FWS-B-SRC")
    r1 = client.put(f"/api/maps/{canvas}/category", json={"category_id": l5})
    assert r1.status_code == 422 and "normal maps" in r1.json()["detail"]
    r2 = client.post(f"/api/maps/{src}/framework-transfer", json={"to_map_id": canvas})
    assert r2.status_code == 422 and "normal maps" in r2.json()["detail"]
    assert _map_row(canvas)["category_id"] is None


def test_clearing_a_stray_slot_on_a_canvas_map_is_allowed(client: TestClient) -> None:
    """mode 가드는 슬롯을 '붙일' 때만 — 결함 ② 이전에 생긴 잔존 슬롯은 해제(category_id=null)로 치울 수 있어야 한다."""
    l5 = _seed_category("FWS-B5C", "핫픽스B정리", level=5)
    other_l5 = _seed_category("FWS-B5CX", "핫픽스B정리X", level=5)
    canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]

    async def _stray(session):
        m = await session.get(ProcessMap, canvas)
        m.category_id = l5

    _run(_stray)
    assert _map_row(canvas)["category_id"] == l5
    assert client.put(f"/api/maps/{canvas}/category", json={"category_id": None}).status_code == 200
    assert _map_row(canvas)["category_id"] is None


# ── 코어: 이력 테이블 (Task 2) ──────────────────────────────────────────


def test_slot_event_table_roundtrip(client: TestClient) -> None:
    """신설 테이블이 create_all로 존재하고 ORM 왕복이 된다 (spec §6.1)."""
    from app.models import FrameworkSlotEvent

    l5 = _seed_category("FWS-E5", "이벤트", level=5)
    mid = _seed_l6_map(l5, "fws event map", "FWS-E-M1")

    async def _go(session):
        session.add(FrameworkSlotEvent(map_id=mid, action="assign", to_category_id=l5, actor=SYSADMIN))
        await session.flush()
        row = await session.scalar(select(FrameworkSlotEvent).where(FrameworkSlotEvent.map_id == mid))
        return (row.action, row.to_category_id, row.request_id, row.created_at is not None)

    assert _run(_go) == ("assign", l5, None, True)


# ── 코어: validate / apply ─────────────────────────────────────────────────────


def _apply(change_kwargs: dict, actor: str = SYSADMIN) -> None:
    from app.framework_slots import SlotChange, apply_slot_change, validate_slot_change

    async def _go(session):
        plan = await validate_slot_change(session, SlotChange(**change_kwargs), actor)
        await apply_slot_change(session, plan, actor)

    _run(_go)


def _events(map_id: int) -> list[tuple[str, int | None, int | None, int | None]]:
    from app.models import FrameworkSlotEvent

    async def _go(session):
        rows = (await session.scalars(
            select(FrameworkSlotEvent).where(FrameworkSlotEvent.map_id == map_id)
            .order_by(FrameworkSlotEvent.id)
        )).all()
        return [(r.action, r.from_category_id, r.to_category_id, r.to_map_id) for r in rows]

    return _run(_go)


def _linked_ids(client: TestClient, canvas_map_id: int) -> list[int]:
    graph = client.get(f"/api/versions/{_draft_id(client, canvas_map_id)}/graph").json()
    return sorted(n["linked_map_id"] for n in graph["nodes"] if n["node_type"] == "subprocess")


def test_core_assign_unassign_move(client: TestClient) -> None:
    """assign은 홈 캔버스에 노드 append, unassign은 노드 유지, move는 새 캔버스 append — 이벤트 각 1행."""
    l5a = _seed_category("FWS-C5A", "코어A", level=5)
    l5b = _seed_category("FWS-C5B", "코어B", level=5)
    canvas_a = client.post(f"/api/categories/{l5a}/linkage-map").json()["map_id"]
    canvas_b = client.post(f"/api/categories/{l5b}/linkage-map").json()["map_id"]
    mid = _create_map(client, "fws core map")

    _apply({"action": "assign", "map_id": mid, "to_category_id": l5a})
    assert _map_row(mid)["category_id"] == l5a
    assert mid in _linked_ids(client, canvas_a)

    _apply({"action": "move", "map_id": mid, "to_category_id": l5b})
    assert _map_row(mid)["category_id"] == l5b
    assert mid in _linked_ids(client, canvas_a)  # 옛 캔버스 노드 유지(외부 L6로 표시)
    assert mid in _linked_ids(client, canvas_b)

    async def _set_code(session):
        m = await session.get(ProcessMap, mid)
        m.consultant_code = "FWS-C-KEEP"

    _run(_set_code)

    _apply({"action": "unassign", "map_id": mid})
    assert _map_row(mid)["category_id"] is None
    assert _map_row(mid)["consultant_code"] == "FWS-C-KEEP"  # unassign은 consultant_code 보존(재전달 결착 키)
    assert mid in _linked_ids(client, canvas_b)  # 노드 유지 → unassigned 상태로 파생 표시

    assert _events(mid) == [("assign", None, l5a, None), ("move", l5a, l5b, None), ("unassign", l5b, None, None)]


def test_core_validation_errors(client: TestClient) -> None:
    from fastapi import HTTPException

    from app.framework_slots import SlotChange, validate_slot_change

    l1 = _seed_category("FWS-V1", "검증L1")
    l5 = _seed_category("FWS-V5", "검증L5", level=5, parent_id=l1)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    slotted = _seed_l6_map(l5, "fws validate slotted", "FWS-V-M1")
    free = _create_map(client, "fws validate free")

    def _status(kwargs: dict) -> int:
        async def _go(session):
            try:
                await validate_slot_change(session, SlotChange(**kwargs), SYSADMIN)
            except HTTPException as exc:
                return exc.status_code
            return 200

        return _run(_go)

    assert _status({"action": "assign", "map_id": free, "to_category_id": l1}) == 422       # L5 아님
    assert _status({"action": "assign", "map_id": slotted, "to_category_id": l5}) == 409    # 이미 슬롯
    assert _status({"action": "assign", "map_id": canvas, "to_category_id": l5}) == 422     # mode
    assert _status({"action": "unassign", "map_id": free}) == 409                           # 슬롯 없음
    assert _status({"action": "move", "map_id": slotted, "to_category_id": l5}) == 409      # 같은 L5
    assert _status({"action": "replace", "map_id": slotted, "to_map_id": canvas}) == 422    # target mode
    assert _status({"action": "replace", "map_id": slotted, "to_map_id": slotted}) == 409   # 자기 자신
    assert _status({"action": "delete", "map_id": free}) == 409                             # 슬롯 없음
    assert _status({"action": "bogus", "map_id": free}) == 422


def test_core_clearing_a_stray_slot_on_a_canvas_map_is_allowed(client: TestClient) -> None:
    """mode 가드는 슬롯을 "붙일" 때만 — unassign/delete는 캔버스의 stray category_id도 코어에서 직접 정리한다.

    레거시 test_clearing_a_stray_slot_on_a_canvas_map_is_allowed는 /maps/{id}/category(maps.py) 경유라
    이 코어(validate_slot_change/apply_slot_change)의 mode 가드 예외는 실측하지 않는다 — 여기서 직접 검증.
    """
    from fastapi import HTTPException

    from app.framework_slots import SlotChange, validate_slot_change

    l5 = _seed_category("FWS-D5", "잔존슬롯", level=5)
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]

    async def _stray(session):
        m = await session.get(ProcessMap, canvas)
        m.category_id = l5

    _run(_stray)
    assert _map_row(canvas)["category_id"] == l5

    def _plan(kwargs: dict):
        async def _go(session):
            return await validate_slot_change(session, SlotChange(**kwargs), SYSADMIN)

        return _run(_go)

    assert _plan({"action": "unassign", "map_id": canvas}).sides == [l5]
    # delete apply는 별도 테스트(test_core_delete_with_and_without_successor)가 다룬다 — validate만
    assert _plan({"action": "delete", "map_id": canvas}).sides == [l5]

    _apply({"action": "unassign", "map_id": canvas})
    assert _map_row(canvas)["category_id"] is None
    assert _events(canvas) == [("unassign", l5, None, None)]

    def _status(kwargs: dict) -> int:
        async def _go(session):
            try:
                await validate_slot_change(session, SlotChange(**kwargs), SYSADMIN)
            except HTTPException as exc:
                return exc.status_code
            return 200

        return _run(_go)

    assert _status({"action": "assign", "map_id": canvas, "to_category_id": l5}) == 422  # 슬롯을 "붙일" 땐 mode 가드 그대로


# ── 코어: replace / delete ─────────────────────────────────────────────────────


def _readiness_codes(client: TestClient, canvas_map_id: int) -> list[str]:
    body = client.get(f"/api/maps/{canvas_map_id}/confirm-readiness").json()
    return sorted(f["code"] for f in body["failures"])


def _put_edge(client: TestClient, draft_id: int, source_map: int, target_map: int) -> None:
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    na = next(n for n in graph["nodes"] if n["linked_map_id"] == source_map)
    nb = next(n for n in graph["nodes"] if n["linked_map_id"] == target_map)
    edge = {"id": uuid4().hex, "source_node_id": na["id"], "target_node_id": nb["id"]}
    r = client.put(f"/api/versions/{draft_id}/graph",
                   json={"nodes": graph["nodes"], "edges": graph["edges"] + [edge], "groups": []})
    assert r.status_code == 200, r.text


def test_core_replace_repoints_home_canvas_and_keeps_edges(client: TestClient) -> None:
    """결함 ③ 회귀: 이양 후 옛 노드가 남지 않고 C 노드가 A 자리에 엣지를 물려받는다. missing_l6 없음."""
    l5 = _seed_category("FWS-R5", "대체", level=5)
    a = _seed_l6_map(l5, "fws replace A", "FWS-R-A")
    b = _seed_l6_map(l5, "fws replace B", "FWS-R-B")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    _put_edge(client, draft, a, b)
    c = _seed_l6_map(None, "fws replace C", None)  # 슬롯 없는 일반 맵(게시본 있음)

    async def _stale_lineage(session):
        m = await session.get(ProcessMap, c)
        m.retired_to_map_id = b  # 예전에 슬롯을 넘긴 적 있는 척 — target도 슬롯을 받으면 지워져야 한다(최종 리뷰 #1)

    _run(_stale_lineage)

    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    assert _map_row(a) == {"category_id": None, "consultant_code": None, "deleted": False,
                           "retired_to": c, "mode": "normal"}
    assert _map_row(c)["category_id"] == l5 and _map_row(c)["consultant_code"] == "FWS-R-A"
    assert _map_row(c)["retired_to"] is None  # target도 슬롯을 받으면 옛 계보가 지워진다 (최종 리뷰 #1)
    assert _linked_ids(client, canvas) == sorted([b, c])
    graph = client.get(f"/api/versions/{draft}/graph").json()
    nc = next(n for n in graph["nodes"] if n["linked_map_id"] == c)
    assert nc["title"] == "fws replace C"
    assert len(graph["edges"]) == 1 and graph["edges"][0]["source_node_id"] == nc["id"]
    assert "missing_l6" not in _readiness_codes(client, canvas)
    assert _events(a) == [("replace", l5, None, c)]
    assert _events(c) == [("succeed", None, l5, a)]


def test_core_replace_merges_when_target_already_on_canvas(client: TestClient) -> None:
    """C가 이미 캔버스에(외부 노드로) 있으면 A 노드의 엣지를 C 노드로 옮기고 A 노드를 지운다(중복 쌍 제거)."""
    l5 = _seed_category("FWS-M5", "합치기", level=5)
    other = _seed_category("FWS-M5X", "합치기X", level=5)
    a = _seed_l6_map(l5, "fws merge A", "FWS-M-A")
    b = _seed_l6_map(l5, "fws merge B", "FWS-M-B")
    c = _seed_l6_map(other, "fws merge C", "FWS-M-C")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    graph = client.get(f"/api/versions/{draft}/graph").json()
    na = next(n for n in graph["nodes"] if n["linked_map_id"] == a)
    nc = dict(na, id=uuid4().hex, linked_map_id=c, title="fws merge C", pos_y=na["pos_y"] + 240)
    r = client.put(f"/api/versions/{draft}/graph", json={"nodes": graph["nodes"] + [nc], "edges": [], "groups": []})
    assert r.status_code == 200, r.text
    _put_edge(client, draft, a, b)
    _put_edge(client, draft, c, b)  # 합칠 때 (c→b) 중복이 되는 쌍

    # C의 타 L5 슬롯을 먼저 비워 replace 전제를 맞춘다(테스트 셋업 — 실제론 슬롯 없는 맵이 target)
    _apply({"action": "unassign", "map_id": c})

    async def _clear_code(session):
        m = await session.get(ProcessMap, c)
        m.consultant_code = None

    _run(_clear_code)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    graph2 = client.get(f"/api/versions/{draft}/graph").json()
    assert sorted(n["linked_map_id"] for n in graph2["nodes"]) == sorted([b, c])
    pairs = {(e["source_node_id"], e["target_node_id"]) for e in graph2["edges"]}
    nc_id = next(n["id"] for n in graph2["nodes"] if n["linked_map_id"] == c)
    nb_id = next(n["id"] for n in graph2["nodes"] if n["linked_map_id"] == b)
    assert pairs == {(nc_id, nb_id)}


def test_core_delete_with_and_without_successor(client: TestClient) -> None:
    """결함 ④ 회귀: 후계자 있는 delete는 슬롯 승계+재지정, 없는 delete는 노드를 남긴다(stale)."""
    l5 = _seed_category("FWS-D5S", "삭제S", level=5)
    a = _seed_l6_map(l5, "fws delete A", "FWS-D-A")
    d = _seed_l6_map(l5, "fws delete D", "FWS-D-D")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    c = _seed_l6_map(None, "fws delete C", None)

    _apply({"action": "delete", "map_id": a, "to_map_id": c})
    assert _map_row(a) == {"category_id": None, "consultant_code": None, "deleted": True,
                           "retired_to": c, "mode": "normal"}
    assert _map_row(c)["category_id"] == l5 and _map_row(c)["consultant_code"] == "FWS-D-A"
    assert _linked_ids(client, canvas) == sorted([c, d])
    assert _events(a) == [("delete", l5, None, c)]

    _apply({"action": "delete", "map_id": d})
    row = _map_row(d)
    assert row["deleted"] is True and row["category_id"] == l5 and row["retired_to"] is None
    assert d in _linked_ids(client, canvas)  # 링크는 끊지 않음 — 복구 시 자동 회복, 표시는 stale
    assert "stale_link" in _readiness_codes(client, canvas)


def test_map_that_regains_a_slot_is_no_longer_superseded(client: TestClient) -> None:
    """replace로 슬롯을 넘긴 A가 다른 L5에 다시 배정되면 계보가 지워져 superseded/stale이 풀린다 (최종 리뷰 #1)."""
    l5a = _seed_category("FWS-RG5A", "재배정A", level=5)
    l5b = _seed_category("FWS-RG5B", "재배정B", level=5)
    a = _seed_l6_map(l5a, "fws regain A", "FWS-RG-A")
    client.post(f"/api/categories/{l5a}/linkage-map")
    canvas_b = client.post(f"/api/categories/{l5b}/linkage-map").json()["map_id"]
    c = _seed_l6_map(None, "fws regain C", None)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})
    assert _map_row(a)["retired_to"] == c
    _apply({"action": "assign", "map_id": a, "to_category_id": l5b})
    assert _map_row(a)["retired_to"] is None and _map_row(a)["category_id"] == l5b
    refs = client.get(f"/api/versions/{_draft_id(client, canvas_b)}/graph").json()["subprocess_refs"]
    assert refs[str(a)]["superseded"] is False
    assert "stale_link" not in _readiness_codes(client, canvas_b)


# ── refs 확장 · stale_link 확장 ──────────────────────────────────────────────────


def test_refs_expose_slot_state_and_timestamps(client: TestClient) -> None:
    l5 = _seed_category("FWS-F5", "refs", level=5)
    a = _seed_l6_map(l5, "fws refs A", "FWS-F-A")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    other_l5 = _seed_category("FWS-F5X", "refsX", level=5)
    other_canvas = client.post(f"/api/categories/{other_l5}/linkage-map").json()["map_id"]
    other_draft = _draft_id(client, other_canvas)
    assert client.post(f"/api/versions/{other_draft}/checkout", json={}).status_code in (200, 201)
    graph = client.get(f"/api/versions/{other_draft}/graph").json()
    ext = {"id": uuid4().hex, "title": "fws refs A", "node_type": "subprocess", "linked_map_id": a,
           "follow_latest": True, "pos_x": 120, "pos_y": 120, "sort_order": 0}
    assert client.put(f"/api/versions/{other_draft}/graph",
                      json={"nodes": graph["nodes"] + [ext], "edges": [], "groups": []}).status_code == 200
    c = _seed_l6_map(None, "fws refs C", None)
    _apply({"action": "replace", "map_id": a, "to_map_id": c})

    other_refs = client.get(f"/api/versions/{other_draft}/graph").json()["subprocess_refs"]
    ref_a = other_refs[str(a)]
    assert ref_a["deleted"] is False and ref_a["superseded"] is True
    assert ref_a["successor_map_id"] == c and ref_a["slot_changed_action"] == "replace"
    assert ref_a["slot_changed_at"] is not None and ref_a["map_updated_at"] is not None
    home_refs = client.get(f"/api/versions/{_draft_id(client, canvas)}/graph").json()["subprocess_refs"]
    assert home_refs[str(c)]["succeeded_at"] is not None and home_refs[str(c)]["superseded"] is False
    # 타 캔버스의 옛 노드는 stale_link 위반
    assert "stale_link" in _readiness_codes(client, other_canvas)


def test_unassigned_link_counts_as_stale(client: TestClient) -> None:
    l5 = _seed_category("FWS-U5", "해제stale", level=5)
    a = _seed_l6_map(l5, "fws stale A", "FWS-U-A")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    assert "stale_link" not in _readiness_codes(client, canvas)
    _apply({"action": "unassign", "map_id": a})
    assert _readiness_codes(client, canvas) == ["stale_link"]  # missing_l6는 아님(소속이 아니니)
    refs = client.get(f"/api/versions/{_draft_id(client, canvas)}/graph").json()["subprocess_refs"]
    assert refs[str(a)]["category_id"] is None and refs[str(a)]["slot_changed_action"] == "unassign"


# ── 라우터: slot-changes / 어댑터 / 삭제·복사 차단 ───────────────────────────────


def test_slot_changes_preview_and_apply(client: TestClient) -> None:
    l5 = _seed_category("FWS-P5", "프리뷰", level=5)
    a = _seed_l6_map(l5, "fws preview A", "FWS-P-A")
    b = _seed_l6_map(l5, "fws preview B", "FWS-P-B")
    # linkage-map 생성은 a/b 시드 뒤 — open_linkage_map은 호출 시점의 contained_rows만 시드 노드로 심는다
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    _put_edge(client, draft, a, b)
    c = _create_map(client, "fws preview C")
    preview = client.post(f"/api/maps/{a}/slot-changes",
                          json={"action": "replace", "to_map_id": c, "dry_run": True})
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["mode"] == "preview" and body["self_apply"] is True  # auth OFF → 전원 sysadmin
    assert [s["category_id"] for s in body["sides"]] == [l5]
    assert body["impact"] == {"home_canvas_nodes": 1, "other_canvas_nodes": 0,
                              "referencing_maps": 0, "edges_kept": 1}
    assert _map_row(a)["category_id"] == l5  # dry_run은 아무것도 바꾸지 않는다

    applied = client.post(f"/api/maps/{a}/slot-changes", json={"action": "replace", "to_map_id": c})
    assert applied.status_code == 200 and applied.json()["mode"] == "applied"
    assert _map_row(c)["category_id"] == l5 and _map_row(a)["retired_to"] == c
    assert client.post(f"/api/maps/{a}/slot-changes", json={"action": "unassign"}).status_code == 409


# ── 트랙 C: 요청 생성 · 대기 · 철회 ────────────────────────────────────────────

L5ADMIN = "fws.l5admin"
OWNER = "fws.owner2"


def _notif_types(user: str) -> list[str]:
    from app.models import Notification

    async def _go(session):
        rows = (await session.scalars(
            select(Notification).where(Notification.recipient == user).order_by(Notification.id)
        )).all()
        return [r.type for r in rows]

    return _run(_go)


def _seed_l5_with_admin(client: TestClient, code: str, name: str, admin: str = L5ADMIN) -> int:
    l5 = _seed_category(code, name, level=5)
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": admin}]})
    return l5


def test_non_admin_owner_creates_request_and_can_withdraw(client: TestClient, enforce: None) -> None:
    l5 = _seed_l5_with_admin(client, "FWS-Q5", "요청")
    act_as(OWNER)
    mid = _create_map(client, "fws request map")
    r = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5, "note": "please"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mode"] == "requested" and body["request_id"] is not None and body["self_apply"] is False
    assert _map_row(mid)["category_id"] is None  # 요청만, 적용 아님
    # 중복 요청 409
    dup = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert dup.status_code == 409 and "pending" in dup.json()["detail"]
    # 대기 조회 — 요청자는 can_decide False, 직속 관리자는 True
    pending = client.get(f"/api/maps/{mid}/slot-changes/pending").json()
    assert pending["request"]["kind"] == "fw_slot" and pending["request"]["payload"]["note"] == "please"
    assert pending["remaining"] == [l5] and pending["can_decide"] is False
    act_as(L5ADMIN)
    # L5 관리자는 이 맵의 viewer도 아닐 수 있다 — pending 조회는 체인 관리자에게 열려야 한다
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json()["can_decide"] is True
    assert "fw_slot_requested" in _notif_types(L5ADMIN)
    # pending 중에도 맵이 public이면 일반 viewer는 200 (게이트는 role/side-admin/sysadmin 기준)
    act_as("fws.stranger.np")
    stranger_pending = client.get(f"/api/maps/{mid}/slot-changes/pending")
    assert stranger_pending.status_code == 200 and stranger_pending.json() is not None
    # 철회는 요청자만
    act_as(L5ADMIN)
    assert client.delete(f"/api/maps/{mid}/slot-changes/pending").status_code == 403
    act_as(OWNER)
    assert client.delete(f"/api/maps/{mid}/slot-changes/pending").status_code == 204
    assert client.get(f"/api/maps/{mid}/slot-changes/pending").json() is None
    # pending이 없을 때도 게이트는 먼저 — 비공개 맵 + 무권한자는 403 (fix round 1 #1)
    priv = client.post(
        "/api/maps",
        json={"name": "fws private pending gate", "visibility": "private", "owning_department": DEPT},
    ).json()["id"]
    act_as("fws.stranger.np")
    assert client.get(f"/api/maps/{priv}/slot-changes/pending").status_code == 403


def test_decide_endpoint_guards_fw_slot_until_task_2(client: TestClient, enforce: None) -> None:
    """일반 승인 decide 엔드포인트는 fw_slot을 다루지 않는다 — Task 2의 L5 관리자 전용 플로우가 대신할 때까지 409(임시 가드)."""
    from app.models import ApprovalRequest

    l5 = _seed_category("FWS-Q7", "가드", level=5)
    act_as(OWNER)
    mid = _create_map(client, "fws decide guard map")
    r = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert r.status_code == 200 and r.json()["mode"] == "requested"
    request_id = r.json()["request_id"]
    act_as(SYSADMIN)
    decide = client.post(f"/api/approval-requests/{request_id}/decide", json={"decision": "approve"})
    assert decide.status_code == 409

    async def _status(session):
        row = await session.get(ApprovalRequest, request_id)
        return row.status

    assert _run(_status) == "pending"
    assert _map_row(mid)["category_id"] is None


def test_owner_who_becomes_direct_admin_self_applies(client: TestClient, enforce: None) -> None:
    """구 409 테스트(트랙 C에서 삭제) 커버리지 복원 — 비관리자는 요청, 직속 관리자로 임명되면 철회 후 즉시 적용."""
    l5 = _seed_category("FWS-Q8", "자기결재", level=5)
    act_as(OWNER)
    mid = _create_map(client, "fws self-apply map")
    r = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert r.status_code == 200 and r.json()["mode"] == "requested"
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": OWNER}]})
    act_as(OWNER)
    assert client.delete(f"/api/maps/{mid}/slot-changes/pending").status_code == 204
    r2 = client.post(f"/api/maps/{mid}/slot-changes", json={"action": "assign", "to_category_id": l5})
    assert r2.status_code == 200 and r2.json()["mode"] == "applied"
    assert _map_row(mid)["category_id"] == l5


def test_legacy_adapters_follow_slot_policy(client: TestClient, enforce: None) -> None:
    """PUT /category·POST /framework-transfer는 어댑터 — 관리자/sysadmin만 즉시, 그 외 409."""
    l5 = _seed_category("FWS-L5", "레거시", level=5)
    act_as("fws.legacy.owner")
    mid = _create_map(client, "fws legacy owner map")
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": l5}).status_code == 409
    act_as(SYSADMIN)
    assert client.put(f"/api/maps/{mid}/category", json={"category_id": l5}).status_code == 200
    assert client.get(f"/api/maps/{mid}").json()["category_id"] == l5


def test_legacy_transfer_non_admin_owner_409(client: TestClient, enforce: None) -> None:
    """framework-transfer도 slot-changes와 같은 정책 — owner라도 L5 직속 관리자가 아니면 409."""
    l5 = _seed_category("FWS-LT5", "레거시이양", level=5)
    act_as("fws.lt.owner")
    src = _create_map(client, "fws legacy transfer src")
    act_as(SYSADMIN)
    assert client.post(f"/api/maps/{src}/slot-changes",
                       json={"action": "assign", "to_category_id": l5}).status_code == 200
    act_as("fws.lt.owner")
    to_map = _create_map(client, "fws legacy transfer target")
    r = client.post(f"/api/maps/{src}/framework-transfer", json={"to_map_id": to_map})
    assert r.status_code == 409 and "approval" in r.json()["detail"]


def test_slotted_map_delete_and_copy_retire_are_blocked(client: TestClient) -> None:
    l5 = _seed_category("FWS-X5", "차단", level=5)
    slotted = _seed_l6_map(l5, "fws blocked slotted", "FWS-X-M1")
    free = _seed_l6_map(None, "fws blocked free", None)
    r = client.delete(f"/api/maps/{slotted}")
    assert r.status_code == 409 and "slot-changes" in r.json()["detail"]
    r2 = client.post(f"/api/maps/{slotted}/copy", json={"name": "fws blocked copy", "retire_source": True})
    assert r2.status_code == 409 and "slot-changes" in r2.json()["detail"]
    assert client.post(f"/api/maps/{slotted}/copy", json={"name": "fws plain copy"}).status_code == 201
    assert client.delete(f"/api/maps/{free}").status_code == 204


# ── 알림: fw_slot_applied 수신자 ───────────────────────────────────────────────────


def test_applied_notification_recipients(client: TestClient, enforce: None) -> None:
    """fw_slot_applied 수신자 = side 직속·조상 관리자 ∪ source owner ∪ 후계자 owner ∪ 캔버스 체크아웃 보유자 − 행위자 (spec §7.4)."""
    from app.models import Notification

    l1 = _seed_category("FWS-NT1", "알림L1")
    l5 = _seed_category("FWS-NT5", "알림L5", level=5, parent_id=l1)
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fws.nt.upper"}]})
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fws.nt.direct"}]})
    a = _seed_l6_map(l5, "fws notify A", "FWS-NT-A", owner="fws.nt.owner")
    c = _seed_l6_map(None, "fws notify C", None, owner="fws.nt.succ")
    canvas = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    draft = _draft_id(client, canvas)
    act_as("fws.nt.direct")
    assert client.post(f"/api/versions/{draft}/checkout", json={}).status_code in (200, 201)
    act_as(SYSADMIN)
    _apply({"action": "replace", "map_id": a, "to_map_id": c}, actor=SYSADMIN)

    async def _recipients(session):
        rows = (await session.scalars(
            select(Notification).where(Notification.type == "fw_slot_applied", Notification.map_id == a)
        )).all()
        return sorted({r.recipient for r in rows})

    assert _run(_recipients) == sorted({"fws.nt.upper", "fws.nt.direct", "fws.nt.owner", "fws.nt.succ"})
