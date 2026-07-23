"""인터뷰 API — 스키마·세션·턴·체크포인트·권한."""

import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import ai_client
from app.schemas import InterviewCreateIn, InterviewStateOut, InterviewTurnIn
from app.settings import settings


def test_turn_in_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        InterviewTurnIn(type="banana")


def test_turn_in_defaults() -> None:
    turn = InterviewTurnIn(type="answer", content="구매 요청 프로세스입니다")
    assert turn.choice_id is None


def test_create_in_lang_default_ko() -> None:
    assert InterviewCreateIn(version_id=1).lang == "ko"


def test_state_out_smoke() -> None:
    state = InterviewStateOut(
        id=1, map_id=1, version_id=1, status="active", current_stage="scope",
        lang="ko", working_graph=None, messages=[], checkpoints=[], attachments=[],
        version_updated_at=None, base_graph_updated_at=None,
    )
    assert state.current_stage == "scope"


# === API Tests ===

_iv_seq = 0


def _iv_map(client: TestClient) -> dict:
    global _iv_seq
    _iv_seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"interview map {_iv_seq}"},
    ).json()


def _enable_ai(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str):
    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=content, prompt_tokens=10, completion_tokens=5)

    return _call


_Q = json.dumps({"message": "프로세스 이름이 뭔가요?", "facts_patch": {}})


def test_interview_requires_ai_enabled(client: TestClient) -> None:
    created = _iv_map(client)
    resp = client.post(
        f"/api/maps/{created['id']}/interviews",
        json={"version_id": created["versions"][0]["id"]},
    )
    assert resp.status_code == 503


def test_interview_create_and_resume(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    first = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "active" and body["current_stage"] == "scope"
    assert body["messages"][0]["role"] == "consultant"  # 고정 인사
    # 같은 맵 재호출 → 동일 세션 재개
    second = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert second.json()["id"] == body["id"]


def test_interview_turn_flow(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_Q))
    resp = client.post(
        f"/api/interviews/{session_id}/turns",
        json={"type": "answer", "content": "구매 요청 프로세스입니다"},
    )
    assert resp.status_code == 200
    kinds = [m["kind"] for m in resp.json()["messages"]]
    assert kinds[-2:] == ["answer", "question"]


def test_interview_turn_ai_failure_is_atomic(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]

    async def _boom(messages, model=None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    before = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 502
    after = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    assert after == before  # 롤백 — 사용자 메시지도 남지 않음


def test_interview_idor_other_user_404(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    resp = client.get(f"/api/interviews/{session_id}", headers={"X-Dev-User": "someone.else"})
    assert resp.status_code == 404


def test_interview_attachment_upload_and_reject(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    ok = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("memo.txt", "구매 절차 메모".encode(), "text/plain")},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "parsed"
    bad = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert bad.status_code == 422


def test_interview_revert_restores_checkpoint(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = json.dumps({
        "message": "확정. 다음 주제로.", "facts_patch": {
            "process_name": "구매", "purpose": "표준화", "boundaries": "접수~발주"},
        "stage_complete": True,
    })
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(done))
    client.post(f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "…"})
    state = client.get(f"/api/interviews/{session_id}").json()
    assert state["current_stage"] == "io"
    assert [c["stage"] for c in state["checkpoints"]] == ["scope"]
    reverted = client.post(f"/api/interviews/{session_id}/revert", json={"stage": "scope"})
    assert reverted.status_code == 200
    assert reverted.json()["current_stage"] == "scope"


def test_interview_complete_and_delete(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = client.post(f"/api/interviews/{session_id}/complete")
    assert done.status_code == 200 and done.json()["status"] == "completed"
    # 완료 후 턴은 409
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 409
    gone = client.delete(f"/api/interviews/{session_id}")
    assert gone.status_code == 204
