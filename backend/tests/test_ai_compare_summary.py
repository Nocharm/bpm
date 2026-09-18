"""비교 화면 AI 요약 엔드포인트 — AI 서버는 monkeypatch fake (diff는 프론트 계산본을 그대로 전송)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from app.settings import settings
from tests.test_versions import _set_version_status

_seq = 0


def _enable_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str, prompt_tokens: int | None = 100, completion_tokens: int | None = 50):
    async def _call(messages: list[dict], model: str | None = None, *, reasoning: str | None = None, max_tokens: int | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=content, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens)

    return _call


def _read_table(client: TestClient, name: str) -> list[dict]:
    resp = client.get(f"/api/admin/tables/{name}", params={"size": 200})
    assert resp.status_code == 200
    return resp.json()["rows"]


def _map_with_two_versions(client: TestClient) -> tuple[int, int, int]:
    """맵 1개 + 버전 2개 — (map_id, 게시본 id, 두 번째 버전 id)."""
    global _seq
    _seq += 1
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"cmp summary {_seq}"}
    ).json()
    map_id = created["id"]
    first = created["versions"][0]["id"]
    _set_version_status(first, "published")  # draft 1개 제한 — 첫 버전을 게시해야 다음 버전 생성 가능
    second = client.post(f"/api/maps/{map_id}/versions", json={"label": "v2"}).json()["id"]
    return map_id, first, second


def _diff_payload() -> dict:
    return {
        "nodes": [
            {"ref": "n1", "status": "added", "title": "QA 검토", "node_type": "process", "changes": []},
            {
                "ref": "n2",
                "status": "changed",
                "title": "발주 승인",
                "node_type": "process",
                "changes": [{"field": "duration", "before": "1.00", "after": "2.30"}],
            },
        ],
        "edges": [{"ref": "e1", "status": "added", "source": "발주 승인", "target": "QA 검토", "label": ""}],
        "omitted_nodes": 0,
        "omitted_edges": 0,
        "totals": {
            "nodes_added": 1,
            "nodes_removed": 0,
            "nodes_changed": 1,
            "edges_added": 1,
            "edges_removed": 0,
            "edges_changed": 0,
        },
    }


def _summary_json() -> str:
    return json.dumps(
        {
            "headline": "QA 검토 단계가 추가되고 발주 승인 소요시간이 늘었습니다.",
            "highlights": [
                {"kind": "added", "title": "QA 검토 신설", "detail": "발주 승인 뒤에 검토 단계 삽입", "refs": ["n1", "e1"]},
                {"kind": "param", "title": "발주 승인 소요시간 1h → 2h30m", "detail": "", "refs": ["n2"]},
            ],
            "impacts": ["리드타임 증가 검토 필요"],
        }
    )


def _post(client: TestClient, map_id: int, base: int, target: int, **extra):
    body = {"base_version_id": base, "target_version_id": target, "lang": "ko", "diff": _diff_payload(), **extra}
    return client.post(f"/api/maps/{map_id}/compare/ai-summary", json=body)


def test_disabled_returns_503(client: TestClient) -> None:
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target).status_code == 503


def test_summary_ok_records_usage(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_summary_json(), prompt_tokens=321, completion_tokens=45))
    map_id, base, target = _map_with_two_versions(client)
    before = len(_read_table(client, "ai_usage_events"))

    resp = _post(client, map_id, base, target)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["headline"].startswith("QA 검토")
    assert [h["kind"] for h in body["highlights"]] == ["added", "param"]
    assert body["highlights"][0]["refs"] == ["n1", "e1"]
    assert body["impacts"] == ["리드타임 증가 검토 필요"]
    # stats는 모델 출력이 아니라 서버가 요청 totals를 되돌려준다
    assert body["stats"]["nodes_added"] == 1
    assert body["stats"]["edges_added"] == 1
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    event = events[-1]
    assert event["kind"] == "compare_summary"
    assert event["ok"] in (True, 1)
    assert event["version_id"] == target
    assert event["map_id"] == map_id
    assert event["prompt_tokens"] == 321


def test_prompt_carries_diff_and_lang(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []

    async def _spy(messages: list[dict], model: str | None = None, *, reasoning: str | None = None, max_tokens: int | None = None):
        seen.append(messages)
        return ai_client.AiReply(content=_summary_json(), prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ai_client, "call_ai", _spy)
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target, lang="en").status_code == 200
    system = seen[0][0]["content"]
    user = seen[0][-1]["content"]
    assert seen[0][0]["role"] == "system"
    assert "English" in system  # lang=en → 출력 언어 지시
    assert "QA 검토" in user and "2.30" in user  # diff 본문 직렬화
    assert "v2" in user  # target 버전 라벨


def test_version_of_other_map_is_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_summary_json()))
    map_id, base, _target = _map_with_two_versions(client)
    other_map, _b, other_target = _map_with_two_versions(client)
    assert _post(client, map_id, base, other_target).status_code == 404
    assert _post(client, other_map, base, other_target).status_code == 404


def test_invalid_ai_output_is_502_and_recorded(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai("not json at all"))
    map_id, base, target = _map_with_two_versions(client)
    before = len(_read_table(client, "ai_usage_events"))

    resp = _post(client, map_id, base, target)

    assert resp.status_code == 502
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    assert events[-1]["ok"] in (False, 0)
    assert events[-1]["kind"] is None


def test_payload_caps_rejected(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    map_id, base, target = _map_with_two_versions(client)
    payload = _diff_payload()
    payload["nodes"] = [dict(payload["nodes"][0], ref=f"n{i}") for i in range(201)]
    body = {"base_version_id": base, "target_version_id": target, "lang": "ko", "diff": payload}
    assert client.post(f"/api/maps/{map_id}/compare/ai-summary", json=body).status_code == 422
