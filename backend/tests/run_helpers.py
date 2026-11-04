"""실행 체크(Run) API 테스트 공용 헬퍼 — 게시된 맵 시드·사용자 헤더·권한 강제 픽스처.

Task 4 이후 테스트도 같은 시드를 쓴다. 맵 이름·노드 id는 세션 공유 DB에서 충돌하지 않게 호출자가 고유하게 준다.
"""

import copy
import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

CASES_PATH = Path(__file__).parent / "fixtures" / "run_graph_cases.json"
OWNING_DEPARTMENT = "Owning Anchor Division"
APPROVER = "boss"


def load_case_graph(name: str) -> dict:
    """계산 엔진 공용 사례 파일의 그래프 한 개 — `{"nodes": [...], "edges": [{"source", "target", ...}]}`."""
    cases = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    return copy.deepcopy(cases["graphs"][name])


def as_user(client: TestClient, user: str) -> dict:
    """요청 헤더 — dev 인증 모드에서 사용자를 바꾼다. client는 호출 지점을 읽기 쉽게 하려고 받는다."""
    return {"X-Dev-User": user}


@pytest.fixture
def enforce_permissions(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin 없음. 끝나면 원복한다."""
    prev = (settings.auth_enabled, settings.dev_enforce_permissions, settings.bpm_sysadmins)
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = ""
    yield
    settings.auth_enabled, settings.dev_enforce_permissions, settings.bpm_sysadmins = prev
    app.dependency_overrides.clear()


def _build_graph_payload(graph: dict, version_id: int) -> tuple[dict, dict[str, str]]:
    """사례 모양 그래프 → PUT /graph 본문. node·edge id는 전역 PK라 version_id를 접미사로 섞는다."""
    ids = {item["id"]: f"{item['id']}-{version_id}" for item in [*graph["nodes"], *graph["edges"]]}
    nodes = [{**node, "id": ids[node["id"]]} for node in graph["nodes"]]
    edges = []
    for edge in graph["edges"]:
        body = {k: v for k, v in edge.items() if k not in ("source", "target")}
        body.update(
            id=ids[edge["id"]],
            source_node_id=ids[edge["source"]],
            target_node_id=ids[edge["target"]],
        )
        edges.append(body)
    return {"nodes": nodes, "edges": edges, "groups": []}, ids


def _assert_ok(response, step: str) -> None:
    assert response.status_code in (200, 201), f"{step}: {response.status_code} {response.text}"


def seed_published_map(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    graph: dict,
    name: str,
    visibility: str = "private",
) -> dict:
    """맵 생성 → 그래프 저장 → 제출·승인·게시. `{"map_id", "version_id", "ids", "owner"}`를 돌려준다.

    ids는 사례 id → 실제 id, owner는 맵을 만든(=오너가 된) 개발 사용자다.
    권한 강제가 켜져 있어도 시드는 끄고 돌린다 — 시나리오가 아니라 준비 단계이기 때문이다.
    """
    owner = settings.dev_user
    prev_enforce = settings.dev_enforce_permissions
    settings.dev_enforce_permissions = False
    try:
        created = client.post(
            "/api/maps",
            json={"owning_department": OWNING_DEPARTMENT, "name": name, "visibility": visibility},
        )
        _assert_ok(created, "create map")
        map_id = created.json()["id"]
        version_id = created.json()["versions"][0]["id"]
        payload, ids = _build_graph_payload(graph, version_id)
        _assert_ok(client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [APPROVER]}), "approvers")
        _assert_ok(client.post(f"/api/versions/{version_id}/checkout", json={}), "checkout")
        _assert_ok(client.put(f"/api/versions/{version_id}/graph", json=payload), "put graph")
        _assert_ok(client.post(f"/api/versions/{version_id}/submit"), "submit")
        monkeypatch.setattr(settings, "dev_user", APPROVER)
        _assert_ok(client.post(f"/api/versions/{version_id}/approve"), "approve")
        monkeypatch.setattr(settings, "dev_user", owner)
        _assert_ok(client.post(f"/api/versions/{version_id}/publish"), "publish")
    finally:
        settings.dev_enforce_permissions = prev_enforce
    return {"map_id": map_id, "version_id": version_id, "ids": ids, "owner": owner}
