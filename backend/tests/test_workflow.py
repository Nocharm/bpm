"""Version approval workflow — transitions, guards, permissions (design 2026-06-14).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증된다. 다중 사용자
시나리오는 dev_user를 monkeypatch로 바꿔 재현한다 (tests/test_collab.py 패턴).
"""

import asyncio
from collections.abc import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import app.auth as _auth_mod
from app.db import SessionLocal
from app.main import app as _app
from app.models import (
    CheckoutRequest,
    Employee,
    MapPermission,
    MapVersion,
    ProcessMap,
    UserGroup,
    UserGroupMember,
)
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


def test_set_approvers_owner_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, _transfer_enforce: None
) -> None:
    """승인자 변경은 오너·sysadmin만 — 비권한 침입자는 403(enforce라야 경계 유의미)."""
    map_id, _version_id = _create_map_with_version(client)  # owner = 기본 dev_user

    monkeypatch.setattr(settings, "dev_user", "intruder")
    forbidden = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["x"]})
    assert forbidden.status_code == 403

    # sysadmin 오버라이드 — 오너가 아니어도 승인자 변경 가능
    monkeypatch.setattr(settings, "dev_user", _TRANSFER_SYSADMIN)
    ok = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["x"]})
    assert ok.status_code == 200


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


def test_reject_removes_own_approval_and_sets_rejected_by(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """승인한 승인자가 거절하면 → 그 사람의 승인 철회(approvals 제외) + rejected_by 노출."""
    _map_id, version_id = _submit_with_approvers(client, ["a", "b"])  # pending, 승인자 a,b

    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # a 승인
    assert "a" in client.get(f"/api/versions/{version_id}/workflow").json()["approvals"]

    client.post(f"/api/versions/{version_id}/reject", json={"reason": "changed mind"})
    wf = client.get(f"/api/versions/{version_id}/workflow").json()
    assert wf["status"] == "rejected"
    assert "a" not in wf["approvals"]  # 승인 철회 → 'Approved'로 안 남음
    assert wf["rejected_by"] == "a"  # 거절자 노출


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


def test_withdraw_no_approvals_clears_submitted(client: TestClient) -> None:
    """승인 0건 회수 → 승인요청(submitted) 기록 삭제, withdrawn 미기록 (흔적 없음)."""
    map_id, version_id = _submit_with_approvers(client, ["a"])
    client.post(f"/api/versions/{version_id}/withdraw")

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    event_types = [e["event_type"] for e in version["events"]]
    assert "submitted" not in event_types, event_types
    assert "withdrawn" not in event_types, event_types


def test_withdraw_with_approval_keeps_record(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """승인 1건 이상 후 회수 → withdrawn 기록 남고 submitted·approved 이력도 유지."""
    map_id, version_id = _submit_with_approvers(client, ["a", "b"])  # 승인자 2인
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/approve")  # 1/2 — 아직 pending
    monkeypatch.setattr(settings, "dev_user", "local-dev")  # 제출자가 회수
    client.post(f"/api/versions/{version_id}/withdraw")

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    event_types = [e["event_type"] for e in version["events"]]
    assert "submitted" in event_types, event_types
    assert "approved" in event_types, event_types
    assert "withdrawn" in event_types, event_types


def test_withdraw_from_rejected_keeps_record(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """반려본 회수 → 승인 0건이어도 withdrawn 기록 남기고 submitted/rejected 이력 유지."""
    map_id, version_id = _submit_with_approvers(client, ["a"])  # pending, 0 approvals
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/reject", json={"reason": "nope"})  # → rejected
    monkeypatch.setattr(settings, "dev_user", "local-dev")  # submitter
    client.post(f"/api/versions/{version_id}/withdraw")  # rejected → draft

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    event_types = [e["event_type"] for e in version["events"]]
    assert "submitted" in event_types, event_types
    assert "rejected" in event_types, event_types
    assert "withdrawn" in event_types, event_types  # 반려본이라 승인 0건이어도 기록


def test_set_approvers_blocked_while_pending(client: TestClient) -> None:
    """승인 진행 중(pending)엔 승인자 변경 금지 — 409 (진행 중 tally 깨짐 방지)."""
    map_id, _version_id = _submit_with_approvers(client, ["a"])  # now pending
    resp = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a", "b"]})
    assert resp.status_code == 409, resp.text


def test_set_approvers_allowed_on_draft(client: TestClient) -> None:
    """draft 상태에선 승인자 변경 허용."""
    map_id, _version_id = _create_map_with_version(client)  # draft
    resp = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a", "b"]})
    assert resp.status_code == 200, resp.text
    assert resp.json() == ["a", "b"]


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


def test_withdraw_submitter_only(client: TestClient, _transfer_enforce: None) -> None:
    """회수 권한 — 제출자만(비권한 편집자는 403). enforce 모드라야 경계가 유의미."""
    _map_id, version_id = _seed_with_grants(
        [("sub.u", "editor"), ("stranger.u", "editor")],
        status="rejected",
        submitted_by="sub.u",
    )

    _act_as("stranger.u")
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 403

    _act_as("sub.u")
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 200


def test_withdraw_owner_sysadmin_override(client: TestClient, _transfer_enforce: None) -> None:
    """회수 오버라이드 — 제출자가 아니어도 오너·sysadmin은 회수 가능(제출자 부재 대비)."""
    # 오너 회수
    _map_id, version_id = _seed_with_grants(
        [("sub.u", "editor"), ("owner.u", "owner")],
        status="rejected",
        submitted_by="sub.u",
    )
    _act_as("owner.u")
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 200

    # sysadmin 회수
    _map_id2, version_id2 = _seed_with_grants(
        [("sub.u", "editor")],
        status="rejected",
        submitted_by="sub.u",
    )
    _act_as(_TRANSFER_SYSADMIN)
    assert client.post(f"/api/versions/{version_id2}/withdraw").status_code == 200


def test_withdraw_override_blocked_on_pending(
    client: TestClient, _transfer_enforce: None
) -> None:
    """승인요청 단계(pending)에선 제출자만 회수 — 오너·sysadmin도 403(반려 상태에서만 오버라이드)."""
    _map_id, version_id = _seed_with_grants(
        [("sub.u", "editor"), ("owner.u", "owner")],
        status="pending",
        submitted_by="sub.u",
    )
    _act_as("owner.u")
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 403
    _act_as(_TRANSFER_SYSADMIN)
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 403
    _act_as("sub.u")
    assert client.post(f"/api/versions/{version_id}/withdraw").status_code == 200


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


# ── Checkout transfer (Task 2) ────────────────────────────────────────────────

_TRANSFER_SYSADMIN = "transfer.admin"


@pytest.fixture
def _transfer_enforce(client: TestClient) -> Iterator[None]:
    """dev_enforce_permissions=True + sysadmin 1명 — checkout transfer 테스트 전용."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = _TRANSFER_SYSADMIN
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    _app.dependency_overrides.pop(_auth_mod.get_current_user, None)


def _act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    _app.dependency_overrides[_auth_mod.get_current_user] = lambda: user


def _seed_with_grants(
    grants: list[tuple[str, str]],
    *,
    status: str = "draft",
    submitted_by: str | None = None,
) -> tuple[int, int]:
    """새 맵 + 버전 + user 권한 시드 → (map_id, version_id).

    grants: [(login_id, role), ...] — role ∈ {owner, editor, viewer}
    status/submitted_by: 비-draft(예: rejected) 버전을 submit 흐름 없이 직접 시드 (회수 게이트 테스트용).
    """
    name = f"tr-map-{uuid4().hex[:6]}"

    async def _make(session) -> tuple[int, int]:
        m = ProcessMap(name=name, visibility="private")
        mv = MapVersion(label="As-Is", status=status, submitted_by=submitted_by)
        m.versions.append(mv)
        session.add(m)
        await session.flush()
        for lid, role in grants:
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id=lid,
                    role=role,
                    granted_by="seed",
                )
            )
        await session.flush()
        return m.id, mv.id

    async def _run() -> tuple[int, int]:
        async with SessionLocal() as session:
            result = await _make(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def test_transfer_holder_to_editor(client: TestClient, _transfer_enforce: None) -> None:
    """① 점유자가 editor+에게 transfer → 점유 이전."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    # holder.u가 checkout 획득
    _act_as("holder.u")
    assert client.post(f"/api/versions/{version_id}/checkout", json={}).status_code == 200

    # holder.u가 editor.u에게 이전
    res = client.post(f"/api/versions/{version_id}/checkout/transfer", json={"to": "editor.u"})
    assert res.status_code == 200
    assert res.json()["checked_out_by"] == "editor.u"

    # workflow state도 반영
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "editor.u"


def test_transfer_non_editor_target_422(client: TestClient, _transfer_enforce: None) -> None:
    """② 비-editor 대상 거부 → 422; 점유자는 변경 없음."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # stranger.u는 맵에 아무 권한 없음 → 422
    res = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "stranger.u"}
    )
    assert res.status_code == 422
    # 422 거부 후 점유자 변경 없음
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "holder.u"


def test_transfer_non_holder_non_owner_403(
    client: TestClient, _transfer_enforce: None
) -> None:
    """③ 비점유·비오너·비sysadmin 호출자 → 403."""
    map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("intruder.u", "editor")]
    )

    # holder.u가 checkout 획득
    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # intruder.u는 편집자지만 점유자도 오너도 sysadmin도 아님 → 403
    _act_as("intruder.u")
    res = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "editor.u"}
    )
    assert res.status_code == 403


def test_transfer_owner_and_sysadmin_can_transfer(
    client: TestClient, _transfer_enforce: None
) -> None:
    """④ 오너와 sysadmin은 타인의 점유권을 이전할 수 있다."""
    map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("owner.u", "owner")]
    )

    # holder.u가 checkout 획득
    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # 오너가 이전
    _act_as("owner.u")
    res = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "editor.u"}
    )
    assert res.status_code == 200
    assert res.json()["checked_out_by"] == "editor.u"

    # sysadmin이 이전 (editor.u → holder.u)
    _act_as(_TRANSFER_SYSADMIN)
    res2 = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "holder.u"}
    )
    assert res2.status_code == 200
    assert res2.json()["checked_out_by"] == "holder.u"


def test_editors_list_name_resolution_and_group(
    client: TestClient, _transfer_enforce: None
) -> None:
    """editors 피커 — Employee 이름/id 폴백/그룹 경유 편집자 모두 포함 (Fix 1 회귀 방지).

    인증 게이트: require_map_role("viewer") — owner.u가 맵 viewer+ 이므로 통과.
    """
    name = f"editors-map-{uuid4().hex[:6]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, visibility="private")
            mv = MapVersion(label="As-Is")
            m.versions.append(mv)
            session.add(m)
            await session.flush()

            # 직접 user editor — Employee 행 있음 → name 사용
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id="editor.with.emp",
                    role="editor",
                    granted_by="seed",
                )
            )
            session.add(Employee(login_id="editor.with.emp", name="홍길동", department="개발팀"))

            # 직접 user editor — Employee 행 없음 → login_id 폴백
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id="editor.no.emp",
                    role="editor",
                    granted_by="seed",
                )
            )

            # 그룹 경유 editor — Fix 1 회귀 방지
            grp = UserGroup(name=f"grp-{uuid4().hex[:4]}", status="active", created_by="seed")
            session.add(grp)
            await session.flush()
            session.add(
                UserGroupMember(group_id=grp.id, member_type="user", member_id="group.editor.u")
            )
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="group",
                    principal_id=str(grp.id),
                    role="editor",
                    granted_by="seed",
                )
            )

            # owner.u — 엔드포인트 호출자 (viewer+ gate 통과)
            session.add(
                MapPermission(
                    map_id=m.id,
                    principal_type="user",
                    principal_id="owner.u",
                    role="owner",
                    granted_by="seed",
                )
            )
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())

    _act_as("owner.u")
    res = client.get(f"/api/maps/{map_id}/editors")
    assert res.status_code == 200

    items = {e["id"]: e for e in res.json()}

    # Employee 행 있는 편집자 → Employee.name 사용
    assert "editor.with.emp" in items
    assert items["editor.with.emp"]["name"] == "홍길동"

    # Employee 행 없는 편집자 → login_id 폴백
    assert "editor.no.emp" in items
    assert items["editor.no.emp"]["name"] == "editor.no.emp"

    # 그룹 경유 편집자 → 포함됨 (Fix 1 핵심)
    assert "group.editor.u" in items


def test_transfer_no_checkout_409(client: TestClient, _transfer_enforce: None) -> None:
    """⑤ checkout 없는 버전에 이전 시도 → 409; checked_out_by는 None 유지."""
    map_id, version_id = _seed_with_grants([("owner.u", "owner"), ("editor.u", "editor")])

    # checkout 없이 바로 transfer 시도 (오너로)
    _act_as("owner.u")
    res = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "editor.u"}
    )
    assert res.status_code == 409

    # checked_out_by는 여전히 None
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] is None


# ── Checkout request/decide (Task 3) ──────────────────────────────────────────


def test_checkout_request_editor_non_holder(
    client: TestClient, _transfer_enforce: None
) -> None:
    """① editor + 미점유자가 request 생성 → 201, pending 행 생성, workflow state 반영."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    # holder.u가 checkout 획득
    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # editor.u가 점유 요청
    _act_as("editor.u")
    res = client.post(f"/api/versions/{version_id}/checkout/request")
    assert res.status_code == 201
    body = res.json()
    assert body["requested_by"] == "editor.u"
    assert body["status"] == "pending"
    assert body["version_id"] == version_id

    # workflow state에 pending_checkout_request 반영
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["pending_checkout_request"] is not None
    assert state["pending_checkout_request"]["requested_by"] == "editor.u"


def test_checkout_request_duplicate_409(
    client: TestClient, _transfer_enforce: None
) -> None:
    """② 동일 사용자의 중복 pending 요청 → 409."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    client.post(f"/api/versions/{version_id}/checkout/request")  # first OK
    dup = client.post(f"/api/versions/{version_id}/checkout/request")  # duplicate
    assert dup.status_code == 409


def test_checkout_request_multiple_and_approve_auto_rejects(
    client: TestClient, _transfer_enforce: None
) -> None:
    """요청자 복수 허용 — 각자 요청 가능(요청자당 1건), 한 명 승인 시 나머지는 자동 거절 + provenance."""
    _map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("editor2.u", "editor")]
    )

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    r1 = client.post(f"/api/versions/{version_id}/checkout/request")
    assert r1.status_code == 201
    # 같은 사용자 재요청은 409 (요청자당 1건)
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 409

    _act_as("editor2.u")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 201  # 복수 허용

    wf = client.get(f"/api/versions/{version_id}/workflow").json()
    assert len(wf["pending_checkout_requests"]) == 2

    # holder가 editor.u 요청 승인 → 점유 이전 + editor2.u 요청 자동 거절 + provenance 기록
    _act_as("holder.u")
    client.post(f"/api/checkout-requests/{r1.json()['id']}/decide", json={"approve": True})

    wf = client.get(f"/api/versions/{version_id}/workflow").json()
    assert wf["checkout_holder"] == "editor.u"
    assert wf["checkout_from"] == "holder.u"
    assert wf["pending_checkout_requests"] == []  # 나머지 자동 거절


def test_checkout_request_withdraw(
    client: TestClient, _transfer_enforce: None
) -> None:
    """요청자 본인이 미결 요청을 철회 → pending 목록에서 사라짐. 타인 철회는 403."""
    _map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("editor2.u", "editor")]
    )
    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]

    # 타인 철회 불가
    _act_as("editor2.u")
    assert client.post(f"/api/checkout-requests/{req_id}/withdraw").status_code == 403

    # 본인 철회
    _act_as("editor.u")
    assert client.post(f"/api/checkout-requests/{req_id}/withdraw").status_code == 200
    wf = client.get(f"/api/versions/{version_id}/workflow").json()
    assert wf["pending_checkout_requests"] == []


def test_checkout_request_requires_editable_status(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """점유 요청은 draft 전용 — pending·rejected 버전엔 409."""
    _map_id, version_id = _submit_with_approvers(client, ["a"])  # now pending
    monkeypatch.setattr(settings, "dev_user", "editor.x")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 409

    # 반려본도 draft 아님 → 요청 불가 (draft 복귀는 제출자 회수로만)
    monkeypatch.setattr(settings, "dev_user", "a")
    client.post(f"/api/versions/{version_id}/reject", json={"reason": "no"})
    monkeypatch.setattr(settings, "dev_user", "editor.x")
    assert client.post(f"/api/versions/{version_id}/checkout/request").status_code == 409


def test_transfer_blocked_on_rejected(client: TestClient, _transfer_enforce: None) -> None:
    """점유 이전은 draft 전용 — rejected 버전엔 409(상태 게이트가 no-checkout보다 먼저)."""
    _map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor")],
        status="rejected",
        submitted_by="holder.u",
    )
    _act_as("holder.u")
    res = client.post(
        f"/api/versions/{version_id}/checkout/transfer", json={"to": "editor.u"}
    )
    assert res.status_code == 409


def test_decide_blocked_on_non_draft(client: TestClient, _transfer_enforce: None) -> None:
    """점유 요청 결정은 draft 전용 — draft에서 만든 요청이 rejected로 이월돼도 승인 불가(409).

    이 게이트가 없으면 rejected 버전에 점유(홀더≠제출자)가 생겨 회수 로직과 충돌한다(버그 재현).
    """
    _map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor")],
        status="rejected",
        submitted_by="holder.u",
    )

    async def _seed_req() -> int:
        async with SessionLocal() as session:
            req = CheckoutRequest(
                version_id=version_id, requested_by="editor.u", status="pending"
            )
            session.add(req)
            await session.commit()
            await session.refresh(req)
            return req.id

    req_id = asyncio.run(_seed_req())

    _act_as(_TRANSFER_SYSADMIN)
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": True})
    assert res.status_code == 409


def test_checkout_request_approve_moves_checkout(
    client: TestClient, _transfer_enforce: None
) -> None:
    """③ 점유자가 approve → 점유 이전 + 요청 status=approved."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req = client.post(f"/api/versions/{version_id}/checkout/request").json()
    req_id = req["id"]

    # holder.u가 approve
    _act_as("holder.u")
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": True})
    assert res.status_code == 200
    assert res.json()["status"] == "approved"

    # 점유가 editor.u로 이전됨
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "editor.u"
    # pending_checkout_request는 이제 없음
    assert state["pending_checkout_request"] is None


def test_checkout_request_owner_approve(
    client: TestClient, _transfer_enforce: None
) -> None:
    """③-b 맵 오너가 approve → 점유 이전."""
    map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("owner.u", "owner")]
    )

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]

    _act_as("owner.u")
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": True})
    assert res.status_code == 200
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "editor.u"


def test_checkout_request_sysadmin_approve(
    client: TestClient, _transfer_enforce: None
) -> None:
    """③-c sysadmin이 approve → 점유 이전."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]

    _act_as(_TRANSFER_SYSADMIN)
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": True})
    assert res.status_code == 200
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "editor.u"


def test_checkout_request_reject_keeps_checkout(
    client: TestClient, _transfer_enforce: None
) -> None:
    """④ reject → 요청 status=rejected, 점유 유지."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]

    # 점유자가 reject
    _act_as("holder.u")
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": False})
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"

    # 점유는 여전히 holder.u
    state = client.get(f"/api/versions/{version_id}/workflow").json()
    assert state["checkout_holder"] == "holder.u"


def test_checkout_request_viewer_403(
    client: TestClient, _transfer_enforce: None
) -> None:
    """⑤ viewer가 request 시도 → 403."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("viewer.u", "viewer")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("viewer.u")
    res = client.post(f"/api/versions/{version_id}/checkout/request")
    assert res.status_code == 403


def test_checkout_request_non_holder_decide_403(
    client: TestClient, _transfer_enforce: None
) -> None:
    """③- 비점유·비오너·비sysadmin이 decide 시도 → 403."""
    map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("other.u", "editor")]
    )

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    req_id = client.post(f"/api/versions/{version_id}/checkout/request").json()["id"]

    # other.u는 편집자지만 점유자·오너·sysadmin 아님
    _act_as("other.u")
    res = client.post(f"/api/checkout-requests/{req_id}/decide", json={"approve": True})
    assert res.status_code == 403


def test_checkout_pending_queue_for_holder(
    client: TestClient, _transfer_enforce: None
) -> None:
    """pending queue — 점유자는 자신 버전의 pending 요청을 볼 수 있다."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    client.post(f"/api/versions/{version_id}/checkout/request")

    _act_as("holder.u")
    res = client.get("/api/checkout-requests/pending")
    assert res.status_code == 200
    items = res.json()
    assert any(r["version_id"] == version_id for r in items)


def test_checkout_pending_queue_context(
    client: TestClient, _transfer_enforce: None
) -> None:
    """pending queue 응답에 map_id·map_name·version_label 컨텍스트 포함 확인."""
    map_id, version_id = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    client.post(f"/api/versions/{version_id}/checkout/request")

    _act_as("holder.u")
    res = client.get("/api/checkout-requests/pending")
    assert res.status_code == 200
    items = res.json()
    item = next(r for r in items if r["version_id"] == version_id)
    assert item["map_id"] == map_id
    assert isinstance(item["map_name"], str) and item["map_name"]
    assert item["version_label"] == "As-Is"


def test_checkout_pending_queue_map_id_filter(
    client: TestClient, _transfer_enforce: None
) -> None:
    """?map_id= 필터 — 해당 맵 요청만 반환, 다른 맵 요청 제외."""
    map_id1, version_id1 = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])
    map_id2, version_id2 = _seed_with_grants([("holder.u", "editor"), ("editor.u", "editor")])

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id1}/checkout", json={})
    client.post(f"/api/versions/{version_id2}/checkout", json={})

    _act_as("editor.u")
    client.post(f"/api/versions/{version_id1}/checkout/request")
    client.post(f"/api/versions/{version_id2}/checkout/request")

    # sysadmin으로 map1만 필터링
    _act_as(_TRANSFER_SYSADMIN)
    res = client.get(f"/api/checkout-requests/pending?map_id={map_id1}")
    assert res.status_code == 200
    items = res.json()
    assert all(r["map_id"] == map_id1 for r in items)
    assert any(r["version_id"] == version_id1 for r in items)
    assert not any(r["version_id"] == version_id2 for r in items)
