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


def _summary_json(title: str = "발주 프로세스 v2 변경 보고") -> str:
    """명사형 종결(개조식) 보고서 — 절 본문은 points 목록."""
    return json.dumps(
        {
            "title": title,
            "opening": "발주 승인 이후 품질 검토 단계 추가를 위한 개정",
            "sections": [
                {
                    "heading": "QA 검토 단계 신설",
                    "points": ["발주 승인 뒤 QA 검토 단계 추가", "승인 결과가 검토를 거쳐 다음 단계로 전달되도록 흐름 연결"],
                    "refs": ["n1", "e1"],
                },
                {"heading": "발주 승인 소요시간 증가", "points": ["1시간 → 2시간 30분"], "refs": ["n2"]},
            ],
            "impacts": ["리드타임 증가 검토 필요"],
            "closing": "검토 후 결재 요청",
        }
    )


def _spy_ai(seen: list[list[dict]], content: str | None = None):
    """호출된 메시지를 기록하는 fake — 호출 횟수(len(seen))가 캐시 히트/미스의 증거."""

    async def _call(messages: list[dict], model: str | None = None, *, reasoning: str | None = None, max_tokens: int | None = None):
        seen.append(messages)
        return ai_client.AiReply(content=content or _summary_json(), prompt_tokens=1, completion_tokens=1)

    return _call


def _post(client: TestClient, map_id: int, base: int, target: int, diff: dict | None = None, **extra):
    body = {"base_version_id": base, "target_version_id": target, "lang": "ko", "diff": diff or _diff_payload(), **extra}
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
    assert body["title"] == "발주 프로세스 v2 변경 보고"
    assert body["opening"] == "발주 승인 이후 품질 검토 단계 추가를 위한 개정"
    assert [s["heading"] for s in body["sections"]] == ["QA 검토 단계 신설", "발주 승인 소요시간 증가"]
    assert body["sections"][0]["points"] == ["발주 승인 뒤 QA 검토 단계 추가", "승인 결과가 검토를 거쳐 다음 단계로 전달되도록 흐름 연결"]
    assert body["sections"][0]["refs"] == ["n1", "e1"]
    assert body["impacts"] == ["리드타임 증가 검토 필요"]
    assert body["closing"] == "검토 후 결재 요청"
    # stats는 모델 출력이 아니라 서버가 요청 totals를 되돌려준다
    assert body["stats"]["nodes_added"] == 1
    assert body["stats"]["edges_added"] == 1
    # 캐시 메타 — 첫 생성은 cached=False + 생성 시각
    assert body["cached"] is False
    assert body["generated_at"]
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
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target, lang="en").status_code == 200
    system = seen[0][0]["content"]
    user = seen[0][-1]["content"]
    assert seen[0][0]["role"] == "system"
    assert "English" in system  # lang=en → 출력 언어 지시
    assert "명사형" in system  # 개조식(명사형 종결) 문체 계약
    assert "QA 검토" in user and "2.30" in user  # diff 본문 직렬화
    assert "v2" in user  # target 버전 라벨


def test_prompt_carries_map_context_and_added_node_attrs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """보고서 맥락 — 맵 이름·오너 부서·제출 코멘트와 추가 노드의 담당/부서/시스템/설명이 프롬프트에 실린다."""
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]}).status_code == 200
    client.post(f"/api/versions/{target}/checkout", json={})  # submit은 점유 전제
    assert client.post(f"/api/versions/{target}/submit", json={"comment": "감사 지적 대응으로 검토 단계 추가"}).status_code == 200
    diff = _diff_payload()
    diff["nodes"][0].update(
        {"description": "출고 전 품질 서류 확인", "assignee_role": "QA 담당", "department": "품질팀", "system": "LIMS"}
    )

    assert _post(client, map_id, base, target, diff=diff).status_code == 200

    user = seen[0][-1]["content"]
    assert f"cmp summary {_seq}" in user  # 맵 이름
    assert "Owning Anchor Division" in user  # 오너 부서
    assert "감사 지적 대응으로 검토 단계 추가" in user  # 제출 코멘트
    assert "품질팀" in user and "LIMS" in user and "QA 담당" in user and "출고 전 품질 서류 확인" in user


def test_same_diff_is_served_from_cache_without_model_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    first = _post(client, map_id, base, target).json()
    usage_after_first = len(_read_table(client, "ai_usage_events"))

    second = _post(client, map_id, base, target)

    assert second.status_code == 200
    assert len(seen) == 1  # 모델 재호출 없음
    assert len(_read_table(client, "ai_usage_events")) == usage_after_first  # 계량도 없음
    body = second.json()
    assert body["cached"] is True
    assert body["title"] == first["title"]
    assert body["generated_at"] == first["generated_at"]
    assert body["stats"]["nodes_added"] == 1  # stats는 요청 totals 그대로


def test_changed_diff_regenerates(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target).status_code == 200
    diff = _diff_payload()
    diff["nodes"][1]["changes"][0]["after"] = "3.00"  # 초안이 더 편집됨

    resp = _post(client, map_id, base, target, diff=diff)

    assert resp.status_code == 200
    assert len(seen) == 2
    assert resp.json()["cached"] is False


def test_cache_is_per_language(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target, lang="ko").status_code == 200

    assert _post(client, map_id, base, target, lang="en").json()["cached"] is False
    assert _post(client, map_id, base, target, lang="ko").json()["cached"] is True
    assert len(seen) == 2


def test_force_regenerates_and_replaces_cache(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen))
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target).status_code == 200
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen, _summary_json(title="다시 쓴 보고")))

    forced = _post(client, map_id, base, target, force=True).json()
    again = _post(client, map_id, base, target).json()

    assert len(seen) == 2
    assert forced["cached"] is False and forced["title"] == "다시 쓴 보고"
    assert again["cached"] is True and again["title"] == "다시 쓴 보고"  # 캐시가 새 결과로 교체됨


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
