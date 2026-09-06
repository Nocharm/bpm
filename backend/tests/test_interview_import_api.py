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
