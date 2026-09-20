"""제출 시 변경 사유 AI 초안 엔드포인트 — 게시본 대비 diff로 개조식 코멘트 초안을 받는다 (AI 서버는 fake)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from tests.test_ai_compare_summary import _diff_payload, _enable_ai, _map_with_two_versions, _read_table, _spy_ai


def _note_json() -> str:
    return json.dumps({"note": "감사 지적 대응 QA 검토 단계 신설\n발주 승인 소요시간 1시간 → 2시간 30분"})


def _post(client: TestClient, map_id: int, base: int | None, target: int, **extra):
    body = {"base_version_id": base, "target_version_id": target, "lang": "ko", "diff": _diff_payload(), **extra}
    return client.post(f"/api/maps/{map_id}/compare/submit-note-draft", json=body)


def test_disabled_returns_503(client: TestClient) -> None:
    map_id, base, target = _map_with_two_versions(client)
    assert _post(client, map_id, base, target).status_code == 503


def test_draft_returns_note_and_records_usage(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen, _note_json()))
    map_id, base, target = _map_with_two_versions(client)
    before = len(_read_table(client, "ai_usage_events"))

    resp = _post(client, map_id, base, target)

    assert resp.status_code == 200, resp.text
    assert resp.json()["note"].startswith("감사 지적 대응 QA 검토 단계 신설")
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    assert events[-1]["kind"] == "submit_note"
    assert events[-1]["version_id"] == target
    user = seen[0][-1]["content"]
    assert "QA 검토" in user and "2.30" in user  # diff 본문
    assert "명사형" in seen[0][0]["content"]  # 개조식 계약


def test_draft_without_published_base(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """첫 제출(게시본 없음) — base 없이도 초안을 쓴다."""
    _enable_ai(monkeypatch)
    seen: list[list[dict]] = []
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai(seen, _note_json()))
    map_id, _base, target = _map_with_two_versions(client)

    assert _post(client, map_id, None, target).status_code == 200
    assert "base: (없음" in seen[0][-1]["content"]


def test_version_of_other_map_is_404(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(ai_client, "call_ai", _spy_ai([], _note_json()))
    map_id, base, _target = _map_with_two_versions(client)
    _other, _b, other_target = _map_with_two_versions(client)
    assert _post(client, map_id, base, other_target).status_code == 404
