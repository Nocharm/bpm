"""GET /categories/framework-overview 배치 현황판 + validate_confirm_readiness_batch 동치 (Track C Task 4).

캔버스 셋업은 test_framework_canvas.py의 카테고리/L6/체크아웃/그래프 헬퍼를 재사용한다
(client 픽스처가 세션 스코프 공유 DB — 카테고리 코드는 이 파일 전용 접두사(OVR-*)로 격리).
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import selectinload

import app.auth as auth_mod
from app.db import SessionLocal
from app.main import app
from app.models import MapVersion, ProcessMap
from app.settings import settings
from app.subprocess import validate_confirm_readiness, validate_confirm_readiness_batch
from tests.test_framework_canvas import (
    SYSADMIN,
    _make_canvas,
    _put_graph,
    _seed_category,
    _seed_l6_map,
    act_as,
)


def _make_canvas_under(
    client: TestClient, code: str, name: str, parent_id: int | None, *, confirmer: str
) -> tuple[int, int, int]:
    """_make_canvas와 동치 — level<5 요약(subtree_confirm)이 부모 아래 여러 L5를 필요로 해서
    parent_id를 받는 변형만 로컬로 둔다(Track C Task 5). 반환 (category_id, map_id, draft_id).
    """
    l5 = _seed_category(client, code, name, level=5, parent_id=parent_id)
    _seed_l6_map(client, l5, f"{name}업무1", f"{code}M1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": confirmer}]})
    act_as(confirmer)
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    return l5, map_id, draft["id"]


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + test_framework_canvas와 동일 sysadmin (fixture는 각 테스트 파일에 로컬 정의하는 기존 관례)."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def test_overview_sysadmin_sees_confirmed_gated_and_empty_rows(
    client: TestClient, enforce: None
) -> None:
    """sysadmin 전사 조회 — 확정 1회 캔버스·게이트 위반 캔버스·캔버스 없는 L5 3종이 모두 잡힌다."""
    # 1) 확정 1회 캔버스 — 게이트 클린이라 확정 성공, ready=True
    confirmed_map_id, confirmed_draft_id = _make_canvas(client, "OVR-CONFIRMED", "현황확정")
    act_as("fwc.confirmer")
    res = client.post(f"/api/maps/{confirmed_map_id}/framework-confirm", json={"major": False})
    assert res.status_code == 200, res.text

    # 2) 게이트 위반 캔버스 — 플레이스홀더 유입, ready=False
    gate_map_id, gate_draft_id = _make_canvas(client, "OVR-GATE", "현황게이트")
    graph = client.get(f"/api/versions/{gate_draft_id}/graph").json()
    node = graph["nodes"][0]
    ph = dict(node, id="ovrgatephnode00000000000000001", title="자리", linked_map_id=None)
    act_as("fwc.confirmer")
    _put_graph(client, gate_draft_id, [node, ph])

    # 3) 캔버스 없는 L5 — linkage-map을 아예 열지 않음
    empty_l5 = _seed_category(client, "OVR-EMPTY", "현황빈캔버스", level=5)

    act_as(SYSADMIN)
    res = client.get("/api/categories/framework-overview")
    assert res.status_code == 200, res.text
    rows = {r["category_id"]: r for r in res.json()["rows"]}

    confirmed_row = next(r for r in rows.values() if r["linkage_map_id"] == confirmed_map_id)
    assert confirmed_row["latest_fw"] == "v1.0"
    assert confirmed_row["ready"] is True
    assert confirmed_row["confirmed_by"] == "fwc.confirmer"
    assert confirmed_row["confirmed_at"] is not None
    assert confirmed_row["failures"] == []

    gate_row = next(r for r in rows.values() if r["linkage_map_id"] == gate_map_id)
    assert gate_row["ready"] is False
    assert gate_row["latest_fw"] is None  # 아직 확정된 적 없음
    codes = {f["code"] for f in gate_row["failures"]}
    assert "placeholder" in codes

    empty_row = rows[empty_l5]
    assert empty_row["linkage_map_id"] is None
    assert empty_row["ready"] is None
    assert empty_row["latest_fw"] is None
    assert empty_row["failures"] == []

    # path 오름차순 정렬
    paths = [r["path"] for r in res.json()["rows"]]
    assert paths == sorted(paths)


def test_overview_admin_scope_restricted_to_own_subtree(
    client: TestClient, enforce: None
) -> None:
    """카테고리 관리자는 자기 admin_ids 서브트리만, 밖의 root_id는 403."""
    l1 = _seed_category(client, "OVR-ADM-L1", "관리자체계L1")
    l5_in = _seed_category(client, "OVR-ADM-L5", "관리자체계L5", level=5, parent_id=l1)
    l5_out = _seed_category(client, "OVR-OUT-L5", "관리자체계바깥L5", level=5)
    act_as(SYSADMIN)
    client.put(
        f"/api/categories/{l1}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": "ovr.admin"}]},
    )

    act_as("ovr.admin")
    res = client.get("/api/categories/framework-overview")
    assert res.status_code == 200
    ids = {r["category_id"] for r in res.json()["rows"]}
    assert l5_in in ids
    assert l5_out not in ids

    # root_id를 자기 서브트리로 지정하면 통과
    scoped = client.get(f"/api/categories/framework-overview?root_id={l1}")
    assert scoped.status_code == 200
    assert {r["category_id"] for r in scoped.json()["rows"]} == {l5_in}

    # 밖의 root_id는 403
    assert client.get(f"/api/categories/framework-overview?root_id={l5_out}").status_code == 403


def test_overview_non_admin_gets_403(client: TestClient, enforce: None) -> None:
    """카테고리 권한이 전혀 없는 사용자는 root_id 유무와 무관하게 403."""
    act_as("ovr.pleb")
    assert client.get("/api/categories/framework-overview").status_code == 403


def test_validate_confirm_readiness_batch_matches_single(
    client: TestClient, enforce: None
) -> None:
    """배치 검사기가 단건과 캔버스별로 동일 판정(코드+개수, node_ids는 집합 비교)을 낸다.

    6개 게이트 코드 전부가 최소 1회 이상 이 비교에 등장하도록 캔버스를 구성한다 — 특히
    stale_link·l6_unpublished·noexit_cycle 3종은 튜플 필드가 재조립되는 배치판에서 가장
    회귀 취약해, 한 캔버스(combo)에 셋을 동시 발생시켜 상호작용까지 함께 검증한다.
    """
    clean_map_id, clean_draft_id = _make_canvas(client, "OVR-EQ-CLEAN", "동치클린")

    ph_map_id, ph_draft_id = _make_canvas(client, "OVR-EQ-PH", "동치자리")
    graph = client.get(f"/api/versions/{ph_draft_id}/graph").json()
    node = graph["nodes"][0]
    ph = dict(node, id="ovreqphnode0000000000000000001", title="자리", linked_map_id=None)
    _put_graph(client, ph_draft_id, [node, ph])

    fan_map_id, fan_draft_id = _make_canvas(client, "OVR-EQ-FAN", "동치팬아웃")
    fan_graph = client.get(f"/api/versions/{fan_draft_id}/graph").json()
    fan_node = fan_graph["nodes"][0]
    e1 = dict(fan_node, id="ovreqfanend1000000000000000001", node_type="end",
              linked_map_id=None, title="동치끝1", is_primary_end=False)
    e2 = dict(fan_node, id="ovreqfanend2000000000000000001", node_type="end",
              linked_map_id=None, title="동치끝2", is_primary_end=False)
    fan_edges = [
        {"id": "ovreqfanedge00000000000000001", "source_node_id": fan_node["id"],
         "target_node_id": e1["id"]},
        {"id": "ovreqfanedge00000000000000002", "source_node_id": fan_node["id"],
         "target_node_id": e2["id"]},
    ]
    _put_graph(client, fan_draft_id, [fan_node, e1, e2], fan_edges)

    miss_l5_code = "OVR-EQ-MISS"
    miss_map_id, miss_draft_id = _make_canvas(client, miss_l5_code, "동치결측")
    miss_l5 = _seed_category(client, miss_l5_code, "동치결측", level=5)
    _seed_l6_map(client, miss_l5, "동치결측업무2", f"{miss_l5_code}M2")  # 캔버스엔 미반영

    # 복합 캔버스 — stale_link + l6_unpublished + noexit_cycle을 한 draft에 동시 발생.
    # node1(_make_canvas의 기본 링크)의 L6를 소프트삭제해 stale_link, node2는 미게시 L6에
    # 링크해 l6_unpublished, 둘을 서로 가리키는 2노드 순환으로 엮어 noexit_cycle까지 겹친다.
    combo_map_id, combo_draft_id = _make_canvas(client, "OVR-EQ-COMBO", "동치복합")
    combo_graph = client.get(f"/api/versions/{combo_draft_id}/graph").json()
    node1 = combo_graph["nodes"][0]
    stale_l6_id = node1["linked_map_id"]

    async def _soften(map_id: int) -> None:
        from app.clock import now as now_kst
        from app.models import ProcessMap as _ProcessMap

        async with SessionLocal() as session:
            m = await session.get(_ProcessMap, map_id)
            m.deleted_at = now_kst()
            await session.commit()

    asyncio.run(_soften(stale_l6_id))

    async def _seed_unpublished_l6() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name="동치미게시링크", created_by=SYSADMIN, visibility="public")
            m.versions.append(MapVersion(label="As-Is", status="draft"))
            session.add(m)
            await session.commit()
            await session.refresh(m)
            return m.id

    unpub_l6_id = asyncio.run(_seed_unpublished_l6())
    node2 = dict(node1, id="ovreqcombonode200000000000001", title="동치미게시",
                 linked_map_id=unpub_l6_id)
    combo_edges = [
        {"id": "ovreqcomboedge0000000000001", "source_node_id": node1["id"],
         "target_node_id": node2["id"]},
        {"id": "ovreqcomboedge0000000000002", "source_node_id": node2["id"],
         "target_node_id": node1["id"]},
    ]
    _put_graph(client, combo_draft_id, [node1, node2], combo_edges)

    targets = [
        (clean_map_id, clean_draft_id),
        (ph_map_id, ph_draft_id),
        (fan_map_id, fan_draft_id),
        (miss_map_id, miss_draft_id),
        (combo_map_id, combo_draft_id),
    ]

    async def _compare() -> tuple[dict, dict]:
        async with SessionLocal() as session:
            canvases = []
            found_maps: dict[int, ProcessMap] = {}
            for map_id, draft_id in targets:
                fm = await session.get(ProcessMap, map_id)
                found_maps[map_id] = fm
                canvases.append((fm, draft_id))
            batch_result = await validate_confirm_readiness_batch(session, canvases)

            single_result: dict[int, list] = {}
            for map_id, draft_id in targets:
                draft = await session.scalar(
                    select(MapVersion)
                    .options(selectinload(MapVersion.nodes), selectinload(MapVersion.edges))
                    .where(MapVersion.id == draft_id)
                )
                single_result[map_id] = await validate_confirm_readiness(
                    session, found_maps[map_id], draft
                )
            return batch_result, single_result

    batch_result, single_result = asyncio.run(_compare())

    for map_id, _draft_id in targets:
        batch_failures = {f.code: (f.count, set(f.node_ids)) for f in batch_result[map_id]}
        single_failures = {
            f.code: (f.count, set(f.node_ids)) for f in single_result[map_id]
        }
        assert batch_failures == single_failures, (map_id, batch_failures, single_failures)

    # combo가 실제로 3종을 동시 발생시켰는지 확인 — 빈 결과끼리 우연히 일치하는 거짓 통과 방지
    combo_codes = {f.code for f in batch_result[combo_map_id]}
    assert combo_codes == {"stale_link", "l6_unpublished", "noexit_cycle"}

    # 이 테스트가 실제로 6개 게이트 코드 전부를 최소 1회 배치↔단건 비교에 태웠는지 확인
    all_codes = {f.code for failures in batch_result.values() for f in failures}
    assert all_codes == {
        "placeholder", "missing_l6", "stale_link",
        "l6_unpublished", "noexit_cycle", "plain_fanout",
    }


def test_summary_l5_reports_canvas_state(client: TestClient, enforce: None) -> None:
    """GET /categories/{id}/summary — level==5는 자기 캔버스 확정 상태(l5)를 담고 subtree_confirm은 None."""
    l5, map_id, _draft_id = _make_canvas_under(
        client, "SMY-L5", "요약L5", None, confirmer="smy.l5confirmer"
    )
    act_as("smy.l5confirmer")
    confirm = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False})
    assert confirm.status_code == 200, confirm.text

    # 게이트: 로그인 전체 — 카테고리 권한이 전혀 없는 사용자도 열람 가능
    act_as("smy.anyone")
    res = client.get(f"/api/categories/{l5}/summary")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["level"] == 5
    assert body["child_count"] == 0
    assert body["subtree_l5_count"] == 1  # 자기 자신 — L5는 항상 리프
    assert body["subtree_map_count"] == 1  # _make_canvas_under가 소속 L6 1개를 시드
    assert body["subtree_confirm"] is None
    l5_out = body["l5"]
    assert l5_out["linkage_map_id"] == map_id
    assert l5_out["latest_fw"] == "v1.0"
    assert l5_out["confirmed_by"] == "smy.l5confirmer"
    assert l5_out["confirmed_at"] is not None
    assert l5_out["ready"] is True
    assert l5_out["failures"] == []


def test_summary_l2_counts_subtree_confirm_states(client: TestClient, enforce: None) -> None:
    """level<5 요약 — 서브트리 L5 3종(confirmed·not_ready·no_canvas) 카운트가 상호배타로 집계된다."""
    parent = _seed_category(client, "SMY-L2", "요약L2")

    _confirmed_l5, confirmed_map_id, _confirmed_draft_id = _make_canvas_under(
        client, "SMY-CONF", "요약확정", parent, confirmer="smy.confirmer1"
    )
    act_as("smy.confirmer1")
    confirm = client.post(f"/api/maps/{confirmed_map_id}/framework-confirm", json={})
    assert confirm.status_code == 200, confirm.text

    _make_canvas_under(client, "SMY-NR", "요약미확정", parent, confirmer="smy.confirmer2")

    _seed_category(client, "SMY-NC", "요약캔버스없음", level=5, parent_id=parent)

    act_as(SYSADMIN)
    res = client.get(f"/api/categories/{parent}/summary")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["level"] < 5
    assert body["child_count"] == 3
    assert body["subtree_l5_count"] == 3
    assert body["subtree_confirm"] == {"confirmed": 1, "not_ready": 1, "no_canvas": 1}
    assert body["l5"] is None


def test_summary_404_for_unknown_category(client: TestClient, enforce: None) -> None:
    act_as("smy.anyone")
    assert client.get("/api/categories/999999/summary").status_code == 404


def test_summary_admins_include_inherited_ancestor_row(client: TestClient, enforce: None) -> None:
    """admins는 직접+조상 체인 행 — level은 그 사람이 걸린 행이 붙은 카테고리 레벨(상속=조상 레벨)."""
    l1 = _seed_category(client, "SMY-ADM-L1", "요약관리자L1")
    l2 = _seed_category(client, "SMY-ADM-L2", "요약관리자L2", level=2, parent_id=l1)
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "smy.l1admin"}]})
    client.put(f"/api/categories/{l2}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "smy.l2admin"}]})

    act_as("smy.viewer")
    res = client.get(f"/api/categories/{l2}/summary")
    assert res.status_code == 200, res.text
    admins = {a["login_id"]: a for a in res.json()["admins"]}
    assert admins["smy.l1admin"]["level"] == 1  # 상속 행 — L1의 level로 표기
    assert admins["smy.l2admin"]["level"] == 2  # 직접 행 — L2 자신의 level
