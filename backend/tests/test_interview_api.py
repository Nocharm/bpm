"""인터뷰 API — 스키마·세션·턴·체크포인트·권한."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select

from app import ai_client
from app.db import SessionLocal
from app.models import AiUsageEvent
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

    # 실패도 계량 — ok=False 이벤트가 남는다 (rollback 후 만료 접근 회귀 방지)
    async def _count_failed() -> int:
        async with SessionLocal() as s:
            rows = (await s.scalars(select(AiUsageEvent).where(AiUsageEvent.ok.is_(False)))).all()
            return len(rows)

    assert asyncio.run(_count_failed()) >= 1


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


def test_graph_put_bumps_version_updated_at_for_conflict_signal(client: TestClient, monkeypatch) -> None:
    """graph PUT이 version.updated_at을 올려야 인터뷰 충돌 경고가 실편집을 감지한다 (final review C1)."""
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    # 체크아웃 자체도 version 행을 건드려 onupdate로 updated_at을 올린다 — 그 부수효과와
    # 섞이지 않도록 체크아웃 "이후"를 기준선으로 잡아 PUT 그래프만의 효과를 격리한다.
    client.post(f"/api/versions/{version_id}/checkout", json={})
    before = client.get(f"/api/interviews/{session_id}").json()["version_updated_at"]
    graph = {
        "nodes": [
            {"id": "n-start", "title": "Start", "node_type": "start"},
            {"id": "n-conflict-1", "title": "edited", "node_type": "process"},
        ],
        "edges": [],
    }
    assert client.put(f"/api/versions/{version_id}/graph", json=graph).status_code == 200
    after = client.get(f"/api/interviews/{session_id}").json()["version_updated_at"]
    assert after != before


def test_interview_requires_live_editor_role(client: TestClient, monkeypatch) -> None:
    """세션 소유자라도 editor 권한이 회수되면 이후 접근이 차단된다 (final review I3)."""
    _enable_ai(monkeypatch)
    global _iv_seq
    _iv_seq += 1
    actor_a, actor_b = "iv-role-a", "iv-role-b"
    headers_a = {"X-Dev-User": actor_a}
    created = client.post(
        "/api/maps",
        json={
            "owning_department": "Owning Anchor Division",
            "name": f"interview role map {_iv_seq}",
        },
        headers=headers_a,
    ).json()
    map_id, version_id = created["id"], created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{map_id}/interviews", json={"version_id": version_id}, headers=headers_a
    ).json()["id"]

    # A의 owner 권한을 B로 이전하고 A를 viewer로 강등 — enforcement가 켜지면
    # 세션은 여전히 A 소유(IDOR 통과)이지만 맵에 대한 editor+ 권한은 더 이상 없다.
    perms = client.get(f"/api/maps/{map_id}/permissions", headers=headers_a).json()
    a_grant_id = next(
        p["id"] for p in perms if p["principal_id"] == actor_a and p["role"] == "owner"
    )
    assert client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": actor_b, "role": "editor"},
        headers=headers_a,
    ).status_code == 201
    assert client.post(
        f"/api/maps/{map_id}/transfer-owner", json={"new_owner": actor_b}, headers=headers_a
    ).status_code == 200
    downgrade = client.patch(
        f"/api/maps/{map_id}/permissions/{a_grant_id}",
        json={"role": "viewer"},
        headers=headers_a,
    )
    assert downgrade.status_code == 200 and downgrade.json()["pending"] is False

    monkeypatch.setattr(settings, "dev_enforce_permissions", True)
    resp = client.get(f"/api/interviews/{session_id}", headers=headers_a)
    assert resp.status_code == 403
