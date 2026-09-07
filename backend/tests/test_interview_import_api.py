"""인터뷰 다중 파일 웹 임포트 — POST /api/categories/import-interview.

설계: docs/design/2026-08-18-interview-import-design.md §1·§6 +
2026-09-01-interview-import-v04-design.md §3(L5 연계 캔버스 시드). 파일별 독립(에러 파일 스킵),
dry-run 기본, 노트·연계 캔버스 적재 동반.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings
from tests.test_consultant_interview import _interview

STRANGER_SYSADMIN = "iv.sysadmin"


def _run(coro):
    import asyncio

    return asyncio.run(coro)


def _post(client: TestClient, files: list[dict], apply: bool = False):
    return client.post(
        "/api/categories/import-interview",
        json={"files": files, "apply": apply, "label": "IV web"},
    )


def _map_row(code: str):
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessMap

    async def _load():
        async with SessionLocal() as session:
            return (await session.scalars(
                select(ProcessMap).where(ProcessMap.consultant_code == code)
            )).first()

    return _run(_load())


def test_dry_run_reports_files_without_persisting(client: TestClient) -> None:
    resp = _post(client, [{"name": "calibration.json", "content": _interview()}])
    assert resp.status_code == 200
    body = resp.json()
    assert body["applied"] is False
    assert len(body["files"]) == 1
    f = body["files"][0]
    assert f["name"] == "calibration.json" and f["ok"] is True
    assert f["map_count"] == 1 and f["note_count"] == 4  # +entry (0.4 relations)
    assert body["summary"]["created"] == 1 and body["summary"]["notes"] == 4
    assert any(r["code"] == "task-prep-0001" for r in body["rows"])
    assert _map_row("task-prep-0001") is None  # rollback — DB 무변경


def test_apply_persists_maps_and_notes(client: TestClient) -> None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapNote

    resp = _post(client, [{"name": "calibration.json", "content": _interview()}], apply=True)
    assert resp.status_code == 200
    assert resp.json()["applied"] is True
    m = _map_row("task-prep-0001")
    assert m is not None and m.consultant_owner_pending is True
    assert m.description.startswith("[Interview]")

    async def _notes():
        async with SessionLocal() as session:
            on_map = (await session.scalars(select(MapNote).where(MapNote.map_id == m.id))).all()
            global_notes = (await session.scalars(
                select(MapNote).where(MapNote.map_id.is_(None),
                                      MapNote.category_code == "19-01-06-01-02")
            )).all()
        return on_map, global_notes

    on_map, global_notes = _run(_notes())
    assert sorted(n.kind for n in on_map) == ["exception", "rule_basis"]
    assert sorted(n.kind for n in global_notes) == ["entry", "voc"]  # entry는 L5 스코프


def test_error_file_skipped_but_others_proceed(client: TestClient) -> None:
    bad = _interview()
    bad["l5"]["nodeCode"] = "00-00"  # framework에 없는 L5 → 파일 error
    good = _interview()
    good["rows"][0]["taskId"] = "task-good-0001"
    resp = _post(client, [
        {"name": "bad.json", "content": bad},
        {"name": "good.json", "content": good},
    ])
    body = resp.json()
    assert body["files"][0]["ok"] is False and body["files"][0]["map_count"] == 0
    assert any(i["severity"] == "error" for i in body["files"][0]["issues"])
    assert body["files"][1]["ok"] is True and body["files"][1]["map_count"] == 1
    assert body["summary"]["created"] == 1


def test_duplicate_task_id_across_files_skips_later_file(client: TestClient) -> None:
    # 앞선 apply 테스트와 독립되도록 고유 taskId 사용(세션 공유 DB — created 카운트 오염 방지)
    one = _interview()
    one["rows"][0]["taskId"] = "task-dup-0001"
    two = _interview()
    two["rows"][0]["taskId"] = "task-dup-0001"  # 같은 taskId — 같은 파일 재선택 실수
    resp = _post(client, [
        {"name": "one.json", "content": one},
        {"name": "two.json", "content": two},
    ])
    body = resp.json()
    assert body["files"][0]["ok"] is True
    assert body["files"][1]["ok"] is False
    assert any("duplicate taskId" in i["message"] for i in body["files"][1]["issues"])
    assert body["summary"]["created"] == 1


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def test_non_sysadmin_forbidden(client: TestClient, enforce: None) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: "iv.regular"
    resp = _post(client, [{"name": "calibration.json", "content": _interview()}])
    assert resp.status_code == 403


def _linkage_graph(category_code: str):
    """L5 카테고리의 연계 캔버스 draft — (SP 노드 목록, 엣지 끝점 쌍)."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Edge, MapVersion, Node, ProcessCategory

    async def _load():
        async with SessionLocal() as session:
            cat = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == category_code))
            if cat is None or cat.linkage_map_id is None:
                return None, None
            draft = await session.scalar(
                select(MapVersion).where(MapVersion.map_id == cat.linkage_map_id,
                                         MapVersion.status == "draft"))
            nodes = (await session.scalars(
                select(Node).where(Node.version_id == draft.id))).all()
            edges = (await session.scalars(
                select(Edge).where(Edge.version_id == draft.id))).all()
            return list(nodes), list(edges)

    return _run(_load())


def test_apply_seeds_linkage_canvas_and_is_idempotent(client: TestClient) -> None:
    """L6 흐름 → L5 연계 캔버스. 재임포트는 보강만 — 노드·엣지가 중복 생성되지 않는다."""
    data = _interview()
    data["l5"]["nodeCode"] = "19-01-06-01-09"
    data["framework"]["categories"].append(
        {"code": "19-01-06-01-09", "name": "연계 시드 검증", "level": 5, "parent": "19-01-06-01"})
    data["rows"][0]["taskId"] = "task-lk-0001"
    data["rows"][0]["fields"].update({"annual_count": 52, "fte": 0.03})
    data["rows"].append({
        "taskId": "task-lk-0002", "unitId": "unit-lk-0002", "l6": "연계 두번째",
        "owner": None, "ownerRole": None, "approvers": [], "department": None,
        "fields": {}, "actions": [{"seq": 1, "label": "단일 활동"}],
        "relations": {"edges": []},
    })
    data["relations"]["entry"]["taskId"] = "task-lk-0002"  # 진입 L6 = 배치 첫 자리
    data["relations"]["edges"] = [
        {"src": "task-lk-0002", "dst": "task-lk-0001", "kind": "seq",
         "gateway": None, "condition": "준비 완료 시", "label": "다음 단계", "quote": None},
    ]

    assert _post(client, [{"name": "lk.json", "content": data}], apply=True).status_code == 200
    nodes, edges = _linkage_graph("19-01-06-01-09")
    assert nodes is not None
    assert [n.node_type for n in nodes] == ["subprocess", "subprocess"]
    first = min(nodes, key=lambda n: n.sort_order)
    assert first.title == "연계 두번째"  # entry가 맨 앞
    seeded = next(n for n in nodes if n.title == "교정 준비")
    assert (seeded.annual_count, seeded.fte) == ("52", "0.03")
    assert len(edges) == 1 and edges[0].label == "다음 단계\n준비 완료 시"
    # SP 끝점 전용 핸들 — 없으면 React Flow가 엣지를 통째로 못 붙여 캔버스에서 선이 사라진다
    assert (edges[0].source_handle, edges[0].target_handle) == ("__primary__", "in")

    # 재임포트 — 보강만(추가 없음)
    assert _post(client, [{"name": "lk.json", "content": data}], apply=True).status_code == 200
    nodes2, edges2 = _linkage_graph("19-01-06-01-09")
    assert len(nodes2) == 2 and len(edges2) == 1


def test_linkage_keeps_user_edited_sp_params(client: TestClient) -> None:
    """SP 노드 annual_count/fte는 사용자 직접 편집 필드 — 재전달이 덮지 않고 경고만 남긴다."""
    from app.db import SessionLocal
    from app.models import Node

    data = _interview()
    data["l5"]["nodeCode"] = "19-01-06-01-10"
    data["framework"]["categories"].append(
        {"code": "19-01-06-01-10", "name": "연계 보존 검증", "level": 5, "parent": "19-01-06-01"})
    data["rows"][0]["taskId"] = "task-keep-0001"
    data["rows"][0]["fields"].update({"annual_count": 52, "fte": None})
    assert _post(client, [{"name": "k.json", "content": data}], apply=True).status_code == 200

    nodes, _ = _linkage_graph("19-01-06-01-10")
    node_id = nodes[0].id

    async def _edit():
        async with SessionLocal() as session:
            node = await session.get(Node, node_id)
            node.annual_count = "999"
            await session.commit()

    _run(_edit())
    body = _post(client, [{"name": "k.json", "content": data}], apply=True).json()
    nodes2, _ = _linkage_graph("19-01-06-01-10")
    assert nodes2[0].annual_count == "999"
    assert any("annual_count '999' kept" in r["detail"] for r in body["rows"])


def _files(doc: dict, name: str = "delivery.json") -> list[dict]:
    """_post의 files 파라미터 포맷으로 문서 1건을 감싼다."""
    return [{"name": name, "content": doc}]


def _ext_delivery(l5_code: str, task_ids: list[str] | None = None) -> dict:
    """PHX 계열 L5용 최소 인터뷰 문서 — 외부 taskId 플레이스홀더 테스트 전용(기본 row 2개, 엣지 없음)."""
    ids = task_ids or [f"{l5_code.lower()}-task-0001", f"{l5_code.lower()}-task-0002"]
    data = _interview()
    data["l5"] = {"label": l5_code, "nodeCode": l5_code}
    data["framework"]["categories"].append(
        {"code": l5_code, "name": l5_code, "level": 5, "parent": "19-01-06-01"})
    data["rows"] = [
        {
            "taskId": tid, "unitId": f"unit-{tid}", "l6": f"{tid} 활동",
            "owner": None, "ownerRole": None, "approvers": [], "department": None,
            "fields": {}, "actions": [{"seq": 1, "label": "단일 활동"}],
            "relations": {"edges": []},
        }
        for tid in ids
    ]
    data["relations"] = {"edges": []}
    return data


def _canvas_map_id(client: TestClient, category_code: str) -> int:
    """L5 코드로 연계 캔버스 맵 id 조회 — 이미 시드돼 있다고 전제."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _load():
        async with SessionLocal() as session:
            cat = await session.scalar(
                select(ProcessCategory).where(ProcessCategory.code == category_code))
            return cat.linkage_map_id if cat else None

    map_id = _run(_load())
    assert map_id is not None, f"no linkage canvas for {category_code!r}"
    return map_id


def _draft_id(client: TestClient, map_id: int) -> int:
    """맵 id로 draft 버전 id 조회."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion

    async def _load():
        async with SessionLocal() as session:
            draft = await session.scalar(
                select(MapVersion).where(MapVersion.map_id == map_id, MapVersion.status == "draft")
                .order_by(MapVersion.id.desc()))
            return draft.id if draft else None

    draft_id = _run(_load())
    assert draft_id is not None, f"no draft version for map {map_id}"
    return draft_id


def test_external_edge_becomes_placeholder_and_resolves_on_later_delivery(client: TestClient) -> None:
    """L5-A 전달분의 엣지가 아직 없는 taskId를 가리키면 플레이스홀더 노드+엣지로 남고,
    그 taskId를 담은 L5-B 전달분이 오면 A 캔버스의 플레이스홀더가 자동 연결된다 (spec 2026-09-06 §8)."""
    doc_a = _ext_delivery("PHX-A")            # rows: 이 L5의 task 2개, relations.edges 포함
    ext_code = "phx-b-task-0001"
    doc_a["relations"]["edges"].append({"src": doc_a["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    res_a = _post(client, _files(doc_a), apply=True)
    assert res_a.status_code == 200, res_a.text
    canvas_a = _canvas_map_id(client, "PHX-A")
    graph_a = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    ph = [n for n in graph_a["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]
    assert len(ph) == 1 and ph[0]["title"] == ext_code and ph[0]["placeholder_category_id"] is None
    assert any(e["target_node_id"] == ph[0]["id"] for e in graph_a["edges"])

    doc_b = _ext_delivery("PHX-B", task_ids=[ext_code, "phx-b-task-0002"])
    res_b = _post(client, _files(doc_b), apply=True)
    assert res_b.status_code == 200, res_b.text
    graph_a2 = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    resolved = next(n for n in graph_a2["nodes"] if n["id"] == ph[0]["id"])
    assert resolved["linked_map_id"] is not None
    assert any(e["target_node_id"] == ph[0]["id"] for e in graph_a2["edges"])  # 해소 후에도 엣지 유지
    assert graph_a2["subprocess_refs"][str(resolved["linked_map_id"])]["category_path"].endswith("PHX-B")
    # 재임포트 멱등 — 플레이스홀더가 다시 생기지 않는다
    _post(client, _files(doc_a), apply=True)
    graph_a3 = client.get(f"/api/versions/{_draft_id(client, canvas_a)}/graph").json()
    assert not [n for n in graph_a3["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]


def test_placeholder_stays_unresolved_when_target_map_is_trashed(client: TestClient) -> None:
    """휴지통(소프트삭제)에 들어간 맵은 재전달돼도 플레이스홀더에 연결되지 않는다 — 콜사이트가
    deleted_at IS NULL 가드로 아예 후보에서 뺀다 (controller ruling round 1, spec 2026-09-06 §8)."""
    from sqlalchemy import select

    from app.clock import now as now_kst
    from app.db import SessionLocal
    from app.models import ProcessMap

    ext_code = "phx-d-task-0001"
    doc_d = _ext_delivery("PHX-D", task_ids=[ext_code])
    assert _post(client, _files(doc_d), apply=True).status_code == 200

    async def _trash():
        async with SessionLocal() as session:
            m = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == ext_code))
            m.deleted_at = now_kst()
            await session.commit()

    _run(_trash())

    # ext_code가 휴지통이라 apply_interview_linkage의 라이브 조회에서 빠져 플레이스홀더로 배치된다
    doc_c = _ext_delivery("PHX-C")
    doc_c["relations"]["edges"].append({"src": doc_c["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    assert _post(client, _files(doc_c), apply=True).status_code == 200
    canvas_c = _canvas_map_id(client, "PHX-C")
    graph_c = client.get(f"/api/versions/{_draft_id(client, canvas_c)}/graph").json()
    ph = next(n for n in graph_c["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None)
    assert ph["title"] == ext_code

    # 재전달 — pass1은 trashed로 에러 행만 남기고 스킵, 해소 콜사이트도 code_to_map에서 제외
    body = _post(client, _files(doc_d), apply=True).json()
    assert not any("external placeholder node" in r["detail"] for r in body["rows"])
    graph_c2 = client.get(f"/api/versions/{_draft_id(client, canvas_c)}/graph").json()
    resolved = next(n for n in graph_c2["nodes"] if n["id"] == ph["id"])
    assert resolved["linked_map_id"] is None


def test_reimport_while_target_trashed_does_not_duplicate_lineage_node(client: TestClient) -> None:
    """해소된 플레이스홀더의 대상 맵이 잠시 휴지통에 들어간 사이 파일 A가 재임포트되면, 대상이
    (일시적으로) map_ids에서 빠져 이 코드가 다시 "미배치"로 보인다. linked_map_id가 아니라
    계보 키(source_node_id)로 기존 노드를 먼저 찾아야 그 옆에 노드가 하나 더 생기지 않는다.
    복구 후에도 재임포트가 노드/엣지 수를 그대로 유지해야 한다 (controller ruling F1)."""
    from sqlalchemy import select

    from app.clock import now as now_kst
    from app.db import SessionLocal
    from app.models import ProcessMap

    ext_code = "phx-f1-task-0001"
    doc_a = _ext_delivery("PHX-F1A")
    doc_a["relations"]["edges"].append({"src": doc_a["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    canvas_a = _canvas_map_id(client, "PHX-F1A")
    draft_a = _draft_id(client, canvas_a)

    doc_b = _ext_delivery("PHX-F1B", task_ids=[ext_code, "phx-f1b-task-0002"])
    assert _post(client, _files(doc_b), apply=True).status_code == 200
    graph_1 = client.get(f"/api/versions/{draft_a}/graph").json()
    sp_1 = [n for n in graph_1["nodes"] if n["node_type"] == "subprocess"]
    assert len(sp_1) == 3 and len(graph_1["edges"]) == 1  # 이 L5의 업무 2개 + 해소된 외부 1개
    assert all(n["linked_map_id"] is not None for n in sp_1)  # 플레이스홀더가 이미 해소됨

    async def _set_trashed(trashed: bool) -> None:
        async with SessionLocal() as session:
            m = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == ext_code))
            m.deleted_at = now_kst() if trashed else None
            await session.commit()

    _run(_set_trashed(True))
    # 대상이 휴지통이라 apply_interview_linkage의 라이브 조회에서 빠진다 — 계보 키가 없다면
    # (구 코드) 이 시점에 새 플레이스홀더가 하나 더 생겨 같은 코드가 노드 2개로 나뉜다
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    graph_2 = client.get(f"/api/versions/{draft_a}/graph").json()
    sp_2 = [n for n in graph_2["nodes"] if n["node_type"] == "subprocess"]
    assert len(sp_2) == 3 and len(graph_2["edges"]) == 1  # 여전히 3개 — 계보 노드 옆에 중복 없음

    _run(_set_trashed(False))
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    graph_3 = client.get(f"/api/versions/{draft_a}/graph").json()
    sp_3 = [n for n in graph_3["nodes"] if n["node_type"] == "subprocess"]
    assert len(sp_3) == 3 and len(graph_3["edges"]) == 1
    assert all(n["linked_map_id"] is not None for n in sp_3)  # 복구 후에도 계속 연결 상태 유지


def test_reimport_finds_linked_node_without_lineage_key_via_map_id_fallback(client: TestClient) -> None:
    """linked_map_id는 있지만 source_node_id가 없는 노드(이 픽스 이전 임포트가 만들었거나
    에디터가 직접 만든 노드)도 재임포트가 찾아야 한다 — lineage_nodes만 보면 안 보여서 옆에
    중복 노드가 생기고, _node_of가 엣지를 그 중복으로 옮겨 원본을 고아로 만든다
    (controller ruling F1-2, 재검토에서 레거시 노드로 재현됨)."""
    import uuid

    from app.db import SessionLocal
    from app.lineage import external_lineage_key
    from app.models import Node

    ext_code = "phx-f1b-ext-0001"
    # 외부 코드의 맵을 먼저 존재시킨다 — 다른 L5가 이미 전달한 것처럼
    doc_ext = _ext_delivery("PHX-F1B-EXT", task_ids=[ext_code])
    assert _post(client, _files(doc_ext), apply=True).status_code == 200
    ext_map_id = _map_row(ext_code).id

    doc_a = _ext_delivery("PHX-F1B-A", task_ids=["phx-f1b-a-task-0001"])
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    canvas_a = _canvas_map_id(client, "PHX-F1B-A")
    draft_a = _draft_id(client, canvas_a)

    # 레거시 상태를 직접 심는다 — linked_map_id만 있고 source_node_id는 없는 subprocess 노드
    # (이 픽스 이전의 missing_external 루프가 만든 노드, 또는 에디터가 만든 노드와 동형)
    legacy_id = uuid.uuid4().hex

    async def _seed_legacy_node() -> None:
        async with SessionLocal() as session:
            session.add(Node(
                id=legacy_id, version_id=draft_a, title="legacy external node",
                node_type="subprocess", linked_map_id=ext_map_id, follow_latest=True,
                pos_x=900, pos_y=900, sort_order=99,
            ))
            await session.commit()

    _run(_seed_legacy_node())

    doc_a2 = _ext_delivery("PHX-F1B-A", task_ids=["phx-f1b-a-task-0001"])
    doc_a2["relations"]["edges"].append(
        {"src": doc_a2["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    assert _post(client, _files(doc_a2), apply=True).status_code == 200

    nodes, edges = _linkage_graph("PHX-F1B-A")
    sp_nodes = [n for n in nodes if n.node_type == "subprocess"]
    assert len(sp_nodes) == 2  # own + legacy — 옆에 중복이 생기지 않는다
    legacy = next(n for n in nodes if n.id == legacy_id)
    assert legacy.source_node_id == external_lineage_key(ext_code)  # 백필됨
    assert legacy.linked_map_id == ext_map_id  # 재지정되지 않음
    assert any(e.target_node_id == legacy.id for e in edges)  # 엣지가 레거시 노드에 붙는다

    # 재임포트 — 이제 계보 키가 찍혔으니 그대로 멱등
    assert _post(client, _files(doc_a2), apply=True).status_code == 200
    nodes2, edges2 = _linkage_graph("PHX-F1B-A")
    assert len([n for n in nodes2 if n.node_type == "subprocess"]) == 2
    assert len(edges2) == len(edges)


def test_new_canvas_layout_places_placeholder_without_overlapping_ranked_nodes(client: TestClient) -> None:
    """5개 업무가 순차 흐름(체인)으로 이어진 신규 캔버스에서, 외부 플레이스홀더도 같은 자동정렬
    계산에 껴야 한다 — 빠지면 격자 폴백 좌표가 이미 자동정렬된 노드의 바운딩박스와 겹친다
    (controller ruling F2)."""
    task_ids = [f"phx-f2-task-{i:04d}" for i in range(5)]
    doc = _ext_delivery("PHX-F2", task_ids=task_ids)
    ext_code = "phx-f2-ext-0001"
    doc["relations"]["edges"] = [
        {"src": task_ids[i], "dst": task_ids[i + 1], "kind": "seq"} for i in range(4)
    ] + [{"src": task_ids[4], "dst": ext_code, "kind": "seq"}]
    assert _post(client, _files(doc), apply=True).status_code == 200

    nodes, edges = _linkage_graph("PHX-F2")
    assert len(nodes) == 6 and len(edges) == 5  # 자기 업무 5개 + 외부 플레이스홀더 1개

    # subprocess 노드 실측 크기(180x64) — scripts/consultant_layout.py _NODE_SIZE와 수동 동기
    w, h = 180, 64
    boxes = [(n.pos_x, n.pos_y) for n in nodes]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            x1, y1 = boxes[i]
            x2, y2 = boxes[j]
            overlapping = x1 < x2 + w and x2 < x1 + w and y1 < y2 + h and y2 < y1 + h
            assert not overlapping, f"node position overlap: {boxes[i]} vs {boxes[j]}"
    assert len(boxes) == len(set(boxes))  # 최소 기준 — 좌표 완전 동일도 없어야 한다


def test_external_placeholder_resolution_skips_canvas_checked_out_by_another_user(
    client: TestClient,
) -> None:
    """플레이스홀더가 있는 캔버스가 남에게 체크아웃 중이면 resolve_external_placeholders가
    건드리지 않고 경고만 남긴다 — apply_interview_linkage·open_linkage_map과 같은 체크아웃
    규약 (controller ruling F3). 체크아웃이 풀리면 다음 전달이 정상 해소한다."""
    from app.db import SessionLocal
    from app.models import MapVersion

    ext_code = "phx-f3-task-0001"
    doc_a = _ext_delivery("PHX-F3A")
    doc_a["relations"]["edges"].append({"src": doc_a["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    canvas_a = _canvas_map_id(client, "PHX-F3A")
    draft_a = _draft_id(client, canvas_a)

    async def _check_out(login: str | None) -> None:
        async with SessionLocal() as session:
            draft = await session.get(MapVersion, draft_a)
            draft.checked_out_by = login
            await session.commit()

    _run(_check_out("someone.else"))

    doc_b = _ext_delivery("PHX-F3B", task_ids=[ext_code, "phx-f3b-task-0002"])
    body = _post(client, _files(doc_b), apply=True).json()
    graph_a = client.get(f"/api/versions/{draft_a}/graph").json()
    ph = next(n for n in graph_a["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None)
    assert ph["title"] == ext_code  # 체크아웃 중이라 미해소
    assert any("checked out" in r["detail"] for r in body["rows"])

    _run(_check_out(None))
    assert _post(client, _files(doc_b), apply=True).status_code == 200  # 다음 전달 — 체크아웃 풀림
    graph_a2 = client.get(f"/api/versions/{draft_a}/graph").json()
    resolved = next(n for n in graph_a2["nodes"] if n["id"] == ph["id"])
    assert resolved["linked_map_id"] is not None


def test_resolve_external_placeholders_does_not_skip_when_importer_holds_the_checkout(
    client: TestClient,
) -> None:
    """캔버스를 임포트 실행자 본인이 체크아웃 중이면 건너뛰지 않는다 — 스킵 조건은 "actor가
    아닌 남"이지 "누구든 체크아웃 중"이 아니다 (F3 보강 — 자기 자신 케이스 커버리지)."""
    from app.db import SessionLocal
    from app.models import MapVersion
    from app.settings import settings

    ext_code = "phx-f3c-ext-0001"  # PHX-F3C 자기 행 id(-task-000N)와 겹치지 않게 — 안 그러면 self edge가 돼 external 판정이 안 된다
    doc_a = _ext_delivery("PHX-F3C")
    doc_a["relations"]["edges"].append({"src": doc_a["rows"][0]["taskId"], "dst": ext_code, "kind": "seq"})
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    canvas_a = _canvas_map_id(client, "PHX-F3C")
    draft_a = _draft_id(client, canvas_a)
    graph_before = client.get(f"/api/versions/{draft_a}/graph").json()
    ph = next(n for n in graph_before["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None)

    async def _check_out_self() -> None:
        async with SessionLocal() as session:
            draft = await session.get(MapVersion, draft_a)
            draft.checked_out_by = settings.dev_user  # 이번 임포트를 실행하는 actor 본인
            await session.commit()

    _run(_check_out_self())

    doc_b = _ext_delivery("PHX-F3D", task_ids=[ext_code, "phx-f3d-task-0002"])
    assert _post(client, _files(doc_b), apply=True).status_code == 200
    graph_after = client.get(f"/api/versions/{draft_a}/graph").json()
    resolved = next(n for n in graph_after["nodes"] if n["id"] == ph["id"])
    assert resolved["linked_map_id"] is not None  # 본인 체크아웃은 건너뛰지 않는다


def test_external_source_endpoint_places_placeholder_as_edge_source(client: TestClient) -> None:
    """외부 taskId가 엣지의 target이 아니라 source여도(다른 L5의 업무 → 이 L5의 업무) 플레이스홀더로
    배치되고 엣지 방향이 보존된다 (M10)."""
    ext_code = "phx-m10-ext-0001"
    doc = _ext_delivery("PHX-M10")
    doc["relations"]["edges"].append({"src": ext_code, "dst": doc["rows"][0]["taskId"], "kind": "seq"})
    assert _post(client, _files(doc), apply=True).status_code == 200

    nodes, edges = _linkage_graph("PHX-M10")
    ph = next(n for n in nodes if n.node_type == "subprocess" and n.linked_map_id is None)
    assert ph.title == ext_code
    own_map = _map_row(doc["rows"][0]["taskId"])
    own_node = next(n for n in nodes if n.linked_map_id == own_map.id)
    assert any(e.source_node_id == ph.id and e.target_node_id == own_node.id for e in edges)


# ── 0.5 externalTasks — spec 2026-09-07 ────────────────────────────────────────────


def test_home_claim_wins_over_external_lineage_across_files(client: TestClient) -> None:
    """같은 code를 한 파일은 홈으로, 다른 파일은 외부 계보로 실으면 파일 순서와 무관하게 홈 이름이 남는다 (spec 2026-09-07 §4.3)."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    def _pair(order: str) -> list[dict]:
        home = _interview()
        home["schema_version"] = "0.5-bpm-interface-draft"
        home["framework"]["categories"] = [
            {"code": "HW", "name": "홈 루트", "level": 1, "parent": None},
            {"code": "HW-1", "name": "홈 L2", "level": 2, "parent": "HW"},
            {"code": "HW-1-1", "name": "홈 L3", "level": 3, "parent": "HW-1"},
            {"code": "HW-1-1-1", "name": "홈 L4", "level": 4, "parent": "HW-1-1"},
            {"code": "HW-1-1-1-1", "name": "홈 L5 정식명", "level": 5, "parent": "HW-1-1-1"},
        ]
        home["l5"] = {"label": "홈 L5 정식명", "nodeCode": "HW-1-1-1-1"}
        home["rows"][0]["taskId"] = f"hw-task-{order}"
        other = _interview()
        other["schema_version"] = "0.5-bpm-interface-draft"
        other["framework"]["categories"] += home["framework"]["categories"][:4] + [
            {"code": "HW-1-1-1-1", "name": "다른 파일이 부른 이름", "level": 5, "parent": "HW-1-1-1"}]
        other["rows"][0]["taskId"] = f"hw-other-{order}"
        other["externalTasks"] = [{"refId": "ext-hw", "l5": {"nodeCode": "HW-1-1-1-1", "label": None}, "l6": "아무 업무", "note": None}]
        other["relations"]["edges"] = [{"src": f"hw-other-{order}", "dst": "ext-hw", "kind": "seq", "gateway": None,
                                        "condition": None, "label": None, "quote": None}]
        files = [{"name": "home.json", "content": home}, {"name": "other.json", "content": other}]
        return files if order == "a" else list(reversed(files))

    async def _name():
        async with SessionLocal() as session:
            return await session.scalar(select(ProcessCategory.name).where(ProcessCategory.code == "HW-1-1-1-1"))

    for order in ("a", "b"):
        res = _post(client, _pair(order), apply=True)
        assert res.status_code == 200, res.text
        assert all(f["ok"] for f in res.json()["files"]), res.json()["files"]
        assert _run(_name()) == "홈 L5 정식명"


def _ext_ref_delivery(l5_code: str, ref_id: str, target_l5: str, l6: object, *, target_lineage: bool = True,
                      task_ids: list[str] | None = None) -> dict:
    """홈 L5 최소 문서(rows 2) + 선언 외부 참조 1건(rows[0] → ref). target_lineage=False면 외부 L5 계보 미동봉."""
    doc = _ext_delivery(l5_code, task_ids)
    doc["schema_version"] = "0.5-bpm-interface-draft"
    if target_lineage:
        doc["framework"]["categories"].append(
            {"code": target_l5, "name": f"L5 {target_l5}", "level": 5, "parent": "19-01-06-01"})
    doc["externalTasks"] = [{"refId": ref_id, "l5": {"nodeCode": target_l5, "label": f"L5 {target_l5}"}, "l6": l6, "note": None}]
    doc["relations"]["edges"] = [{"src": doc["rows"][0]["taskId"], "dst": ref_id, "kind": "seq", "gateway": None,
                                  "condition": None, "label": "인계", "quote": None}]
    return doc


def _category_id(code: str) -> int | None:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _load():
        async with SessionLocal() as session:
            return await session.scalar(select(ProcessCategory.id).where(ProcessCategory.code == code))
    return _run(_load())


def _placeholders(client: TestClient, l5_code: str) -> list[dict]:
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, l5_code))}/graph").json()
    return [n for n in graph["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is None]


def test_declared_external_ref_places_placeholder_with_origin_and_title(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-A", "ext-a1", "PHY-A-EXT", "외부 업무 A")
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200, res.text
    ph = _placeholders(client, "PHY-A")
    assert len(ph) == 1
    assert ph[0]["title"] == "외부 업무 A"
    assert ph[0]["placeholder_category_id"] == _category_id("PHY-A-EXT")  # 계보 동봉 → 빈 카테고리 생성
    assert any(r["detail"] == "placeholder for external task '외부 업무 A' @ PHY-A-EXT (map not delivered yet)"
               for r in res.json()["rows"])


def test_declared_external_ref_with_null_l6_gets_unspecified_title(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-B", "ext-b1", "PHY-B-EXT", None)
    assert _post(client, _files(doc), apply=True).status_code == 200
    ph = _placeholders(client, "PHY-B")
    assert len(ph) == 1 and ph[0]["title"] == "(L6 unspecified) L5 PHY-B-EXT"


def test_declared_external_ref_unknown_l5_has_no_origin_but_warns(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-C", "ext-c1", "PHY-C-NOWHERE", "어딘가의 업무", target_lineage=False)
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    ph = _placeholders(client, "PHY-C")
    assert len(ph) == 1 and ph[0]["placeholder_category_id"] is None and ph[0]["title"] == "어딘가의 업무"
    assert any(r["detail"] == "external L5 PHY-C-NOWHERE not found - placeholder without origin"
               for r in res.json()["rows"])


def test_declared_external_ref_links_directly_when_exact_name_exists(client: TestClient) -> None:
    # 외부 L5 먼저 전달 — 이름 "검체 접수"
    target = _ext_delivery("PHY-D-EXT", task_ids=["phy-d-ext-0001"])
    target["rows"][0]["l6"] = "검체 접수"
    assert _post(client, _files(target), apply=True).status_code == 200
    doc = _ext_ref_delivery("PHY-D", "ext-d1", "PHY-D-EXT", "검체접수")  # 공백만 다름 → 정규화 일치
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    assert _placeholders(client, "PHY-D") == []
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHY-D'))}/graph").json()
    linked = [n for n in graph["nodes"] if n["node_type"] == "subprocess" and n["linked_map_id"] is not None]
    ext = next(n for n in linked if n["title"] == "검체 접수")
    assert graph["subprocess_refs"][str(ext["linked_map_id"])]["category_path"].endswith("PHY-D-EXT")
    assert any(r["detail"].startswith("linked external task '검체접수' @ PHY-D-EXT -> map ") for r in res.json()["rows"])


def test_declared_external_ref_ambiguous_name_stays_placeholder(client: TestClient) -> None:
    target = _ext_delivery("PHY-E-EXT", task_ids=["phy-e-ext-0001", "phy-e-ext-0002"])
    target["rows"][0]["l6"] = "중복 이름"
    target["rows"][1]["l6"] = "중복이름"
    assert _post(client, _files(target), apply=True).status_code == 200
    res = _post(client, _files(_ext_ref_delivery("PHY-E", "ext-e1", "PHY-E-EXT", "중복 이름")), apply=True)
    assert res.status_code == 200
    assert len(_placeholders(client, "PHY-E")) == 1
    assert any(r["detail"] == "external task '중복 이름' @ PHY-E-EXT: 2 maps share the name - left as placeholder"
               for r in res.json()["rows"])


def test_reimport_updates_unlinked_placeholder_title_and_origin_without_duplicating(client: TestClient) -> None:
    doc = _ext_ref_delivery("PHY-F", "ext-f1", "PHY-F-EXT", "옛 이름")
    assert _post(client, _files(doc), apply=True).status_code == 200
    doc["externalTasks"][0]["l6"] = "고친 이름"
    assert _post(client, _files(doc), apply=True).status_code == 200
    ph = _placeholders(client, "PHY-F")
    assert len(ph) == 1 and ph[0]["title"] == "고친 이름"
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHY-F'))}/graph").json()
    assert sum(1 for e in graph["edges"] if e["target_node_id"] == ph[0]["id"]) == 1


def test_legacy_undeclared_code_still_uses_taskid_lineage(client: TestClient) -> None:
    """미선언 코드는 dev 2026-09-06 동작 그대로 — taskId 계보 키, 제목=코드, 출처 없음, 리포트는 @ unknown."""
    doc = _ext_delivery("PHY-G")
    doc["relations"]["edges"].append({"src": doc["rows"][0]["taskId"], "dst": "phy-g-ext-0001", "kind": "seq"})
    res = _post(client, _files(doc), apply=True)
    assert res.status_code == 200
    ph = _placeholders(client, "PHY-G")
    assert len(ph) == 1 and ph[0]["title"] == "phy-g-ext-0001" and ph[0]["placeholder_category_id"] is None
    assert any(r["detail"] == "placeholder for external task 'phy-g-ext-0001' @ unknown (map not delivered yet)"
               for r in res.json()["rows"])


def test_name_placeholder_resolves_when_origin_l5_is_delivered_later(client: TestClient) -> None:
    doc_a = _ext_ref_delivery("PHZ-A", "ext-za", "PHZ-A-EXT", "OOS 접수 및 초동 평가")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    ph = _placeholders(client, "PHZ-A")
    assert len(ph) == 1 and ph[0]["placeholder_category_id"] == _category_id("PHZ-A-EXT")

    later = _ext_delivery("PHZ-A-EXT", task_ids=["phz-a-ext-0001", "phz-a-ext-0002"])
    later["rows"][0]["l6"] = "OOS접수 및 초동평가"  # 공백만 다름 → 정규화 일치
    res = _post(client, _files(later), apply=True)
    assert res.status_code == 200, res.text
    assert any(r["detail"] == "resolved 1 external placeholder node(s)" for r in res.json()["rows"])
    graph = client.get(f"/api/versions/{_draft_id(client, _canvas_map_id(client, 'PHZ-A'))}/graph").json()
    node = next(n for n in graph["nodes"] if n["id"] == ph[0]["id"])
    assert node["linked_map_id"] is not None and node["placeholder_category_id"] is None
    assert node["title"] == "OOS접수 및 초동평가"
    assert any(e["target_node_id"] == node["id"] for e in graph["edges"])  # 엣지 유지


def test_name_placeholder_stays_when_delivery_has_two_maps_with_that_name(client: TestClient) -> None:
    doc_a = _ext_ref_delivery("PHZ-B", "ext-zb", "PHZ-B-EXT", "중복")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    later = _ext_delivery("PHZ-B-EXT", task_ids=["phz-b-ext-0001", "phz-b-ext-0002"])
    later["rows"][0]["l6"] = "중복"
    later["rows"][1]["l6"] = "중 복"
    res = _post(client, _files(later), apply=True)
    assert res.status_code == 200
    assert len(_placeholders(client, "PHZ-B")) == 1
    assert any(r["detail"] == "external task '중복' @ PHZ-B-EXT: 2 maps share the name - left as placeholder"
               for r in res.json()["rows"])


def test_hand_made_placeholder_without_origin_is_not_auto_linked(client: TestClient) -> None:
    """UI 라이브러리 footer가 만드는 이름만 있는 플레이스홀더(placeholder_category_id NULL)는 이름 경로 대상이 아니다."""
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import Node

    doc_a = _ext_ref_delivery("PHZ-C", "ext-zc", "PHZ-C-EXT", "손으로 만든 이름")
    assert _post(client, _files(doc_a), apply=True).status_code == 200
    ph = _placeholders(client, "PHZ-C")[0]

    async def _strip_origin():
        async with SessionLocal() as session:
            node = await session.scalar(select(Node).where(Node.id == ph["id"]))
            node.placeholder_category_id = None
            await session.commit()
    _run(_strip_origin())

    later = _ext_delivery("PHZ-C-EXT", task_ids=["phz-c-ext-0001"])
    later["rows"][0]["l6"] = "손으로 만든 이름"
    assert _post(client, _files(later), apply=True).status_code == 200
    assert [n["id"] for n in _placeholders(client, "PHZ-C")] == [ph["id"]]
