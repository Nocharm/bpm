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
