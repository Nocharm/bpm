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
from app.models import Employee, MapPermission, MapVersion, ProcessMap, UserGroup, UserGroupMember
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


def test_withdraw_not_tracked(client: TestClient) -> None:
    """회수(withdraw)는 버전 기록에서 제외 — 'withdrawn' 이벤트를 남기지 않는다(트랙킹 제외)."""
    map_id, version_id = _submit_with_approvers(client, ["a"])
    client.post(f"/api/versions/{version_id}/withdraw")

    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    event_types = [e["event_type"] for e in version["events"]]
    assert "withdrawn" not in event_types, event_types


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


def _seed_with_grants(grants: list[tuple[str, str]]) -> tuple[int, int]:
    """새 맵 + 버전 + user 권한 시드 → (map_id, version_id).

    grants: [(login_id, role), ...] — role ∈ {owner, editor, viewer}
    """
    name = f"tr-map-{uuid4().hex[:6]}"

    async def _make(session) -> tuple[int, int]:
        m = ProcessMap(name=name, visibility="private")
        mv = MapVersion(label="As-Is")
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


def test_checkout_request_different_user_409(
    client: TestClient, _transfer_enforce: None
) -> None:
    """②-b 다른 사용자의 요청이 pending 중일 때 또 다른 editor가 요청 → 409 (per-version dedup)."""
    map_id, version_id = _seed_with_grants(
        [("holder.u", "editor"), ("editor.u", "editor"), ("editor2.u", "editor")]
    )

    _act_as("holder.u")
    client.post(f"/api/versions/{version_id}/checkout", json={})

    _act_as("editor.u")
    first = client.post(f"/api/versions/{version_id}/checkout/request")
    assert first.status_code == 201  # editor.u 요청 성공

    _act_as("editor2.u")
    dup = client.post(f"/api/versions/{version_id}/checkout/request")  # different user
    assert dup.status_code == 409  # 버전당 1건 불변식


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
