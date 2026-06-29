"""Version approval workflow — transitions, guards, permissions (design 2026-06-14).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증된다. 다중 사용자
시나리오는 dev_user를 monkeypatch로 바꿔 재현한다 (tests/test_collab.py 패턴).
"""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


_wf_seq = 0


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _wf_seq
    _wf_seq += 1
    created = client.post("/api/maps", json={"name": f"wf map {_wf_seq}"}).json()
    return created["id"], created["versions"][0]["id"]


def test_new_version_defaults_to_draft(client: TestClient) -> None:
    _map_id, version_id = _create_map_with_version(client)

    detail = client.get(f"/api/maps/{_map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)

    assert version["status"] == "draft"
    assert version["submitted_by"] is None
    assert version["reject_reason"] is None


def test_is_editable_status() -> None:
    from app import workflow

    assert workflow.is_editable_status("draft") is True
    assert workflow.is_editable_status("rejected") is True
    assert workflow.is_editable_status("pending") is False
    assert workflow.is_editable_status("approved") is False
    assert workflow.is_editable_status("published") is False


def test_set_and_list_approvers(client: TestClient) -> None:
    map_id, _version_id = _create_map_with_version(client)

    put = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss", "lead"]})
    listed = client.get(f"/api/maps/{map_id}/approvers").json()

    assert put.status_code == 200
    assert listed == ["boss", "lead"]


def test_set_approvers_owner_only(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    map_id, _version_id = _create_map_with_version(client)

    monkeypatch.setattr(settings, "dev_user", "intruder")
    forbidden = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["x"]})

    assert forbidden.status_code == 403


def test_submit_requires_checkout_and_approvers(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # 승인자 미지정 → 제출 차단
    blocked = client.post(f"/api/versions/{version_id}/submit")
    assert blocked.status_code == 409

    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss"]})
    ok = client.post(f"/api/versions/{version_id}/submit")
    assert ok.status_code == 200
    assert ok.json()["status"] == "pending"
    assert ok.json()["submitted_by"] == settings.dev_user


def test_submit_requires_checkout_holder(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["boss"]})
    client.post(f"/api/versions/{version_id}/checkout", json={})  # local-dev holds it

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/submit")
    assert forbidden.status_code == 403


def test_workflow_state_endpoint(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a", "b"]})

    state = client.get(f"/api/versions/{version_id}/workflow").json()

    assert state["status"] == "draft"
    assert state["approvers"] == ["a", "b"]
    assert state["approvals"] == []


def _submit_with_approvers(client: TestClient, approvers: list[str]) -> tuple[int, int]:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": approvers})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    return map_id, version_id


def test_unanimous_approval(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])

    monkeypatch.setattr(settings, "dev_user", "a")
    after_first = client.post(f"/api/versions/{version_id}/approve").json()
    assert after_first["status"] == "pending"  # 1/2 — 아직 미통과

    monkeypatch.setattr(settings, "dev_user", "b")
    after_second = client.post(f"/api/versions/{version_id}/approve").json()
    assert after_second["status"] == "approved"  # 2/2 — 만장일치 통과


def test_approve_is_idempotent_per_user(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 같은 승인자가 두 번 눌러도 2명 게이트를 조기 통과하지 않는다
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])

    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")
    repeat = client.post(f"/api/versions/{version_id}/approve").json()

    assert repeat["status"] == "pending"  # a가 두 번 눌러도 여전히 1/2


def test_graph_save_blocked_on_pending(client: TestClient) -> None:
    # 비편집 상태(pending) 버전은 그래프 저장이 거부되어야 한다 (편집 잠금이 없어도)
    _map_id, version_id = _submit_with_approvers(client, ["a"])  # pending, 체크아웃 해제됨

    blocked = client.put(
        f"/api/versions/{version_id}/graph", json={"nodes": [], "edges": []}
    )
    assert blocked.status_code == 409


def test_approve_non_approver_forbidden(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/approve")
    assert forbidden.status_code == 403


def test_approve_on_draft_conflicts(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, version_id = _create_map_with_version(client)
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]})

    monkeypatch.setattr(settings, "dev_user", "a")
    conflict = client.post(f"/api/versions/{version_id}/approve")  # still draft
    assert conflict.status_code == 409


def test_reject_sets_reason_and_resets_tally(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # 1/2 recorded

    monkeypatch.setattr(settings, "dev_user", "b")
    rejected = client.post(
        f"/api/versions/{version_id}/reject", json={"reason": "needs rework"}
    ).json()
    assert rejected["status"] == "rejected"
    assert rejected["reject_reason"] == "needs rework"

    # 재제출 시 tally 리셋 — rejected는 편집 가능. submitter(local-dev)로 복귀해 재제출
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.post(f"/api/versions/{version_id}/submit")
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["approvals"] == []


def test_reject_requires_reason(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "a")
    missing = client.post(f"/api/versions/{version_id}/reject", json={})
    assert missing.status_code == 422


def test_publish_demotes_prior(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v1}/approve")  # approved
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    published = client.post(f"/api/versions/{v1}/publish").json()
    assert published["status"] == "published"

    # v2 클론 → 승인 → 게시. v1은 expired(terminal)로 전환되어야 한다.
    v2 = client.post(
        f"/api/maps/{map_id}/versions",
        json={"label": "To-Be", "source_version_id": v1},
    ).json()["id"]
    client.post(f"/api/versions/{v2}/checkout", json={})
    client.post(f"/api/versions/{v2}/submit")
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v2}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{v2}/publish")

    detail = client.get(f"/api/maps/{map_id}").json()
    statuses = {v["id"]: v["status"] for v in detail["versions"]}
    assert statuses[v1] == "expired"
    assert statuses[v2] == "published"


def test_publish_submitter_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # approved; a is not submitter
    forbidden = client.post(f"/api/versions/{version_id}/publish")
    assert forbidden.status_code == 403


def test_publish_on_pending_conflicts(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])
    conflict = client.post(f"/api/versions/{version_id}/publish")  # still pending
    assert conflict.status_code == 409


def test_withdraw_returns_to_draft(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    withdrawn = client.post(f"/api/versions/{version_id}/withdraw").json()
    assert withdrawn["status"] == "draft"

    # 체크아웃 재획득됨 → 즉시 저장 가능
    save = client.put(
        f"/api/versions/{version_id}/graph", json={"nodes": [], "edges": []}
    )
    assert save.status_code == 200


def test_withdraw_records_event(client: TestClient) -> None:
    """회수(withdraw)는 'withdrawn' 이벤트를 기록한다 (철회 기록 — H3 표시용)."""
    map_id, version_id = _submit_with_approvers(client, ["a"])
    client.post(f"/api/versions/{version_id}/withdraw")

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    event_types = [e["event_type"] for e in version["events"]]
    assert "withdrawn" in event_types, event_types


def test_withdraw_from_approved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 전원 승인된(Approved) 버전도 submitter가 회수해 Draft로 되돌릴 수 있다
    _map_id, version_id = _submit_with_approvers(client, ["a"])
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # → approved

    monkeypatch.setattr(settings, "dev_user", "local-dev")
    withdrawn = client.post(f"/api/versions/{version_id}/withdraw").json()
    assert withdrawn["status"] == "draft"


def test_withdraw_submitter_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])

    monkeypatch.setattr(settings, "dev_user", "stranger")
    forbidden = client.post(f"/api/versions/{version_id}/withdraw")
    assert forbidden.status_code == 403


def test_checkout_blocked_on_pending(client: TestClient) -> None:
    _map_id, version_id = _submit_with_approvers(client, ["a"])  # now pending

    blocked = client.post(f"/api/versions/{version_id}/checkout", json={})
    assert blocked.status_code == 409


def test_delete_blocked_on_published(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])
    client.post(f"/api/maps/{map_id}/versions", json={"label": "keep"})  # not last
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{v1}/approve")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    client.post(f"/api/versions/{v1}/publish")

    blocked = client.delete(f"/api/versions/{v1}")
    assert blocked.status_code == 409


def test_delete_blocked_on_pending(client: TestClient) -> None:
    map_id, v1 = _submit_with_approvers(client, ["a"])  # pending
    client.post(f"/api/maps/{map_id}/versions", json={"label": "keep"})  # not last

    blocked = client.delete(f"/api/versions/{v1}")
    assert blocked.status_code == 409


def test_me_returns_current_user(client: TestClient) -> None:
    me = client.get("/api/me").json()
    assert me["username"] == settings.dev_user
    assert me["ai_enabled"] is False


def test_map_detail_exposes_created_by(client: TestClient) -> None:
    map_id, _version_id = _create_map_with_version(client)
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["created_by"] == settings.dev_user
