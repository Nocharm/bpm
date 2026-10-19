"""결재 무결성 회귀 — 2026-10-19 시스템 리뷰 2단계(B-1·B-3·B-4·B-5·B-6·B-7·B-8).

리뷰어 재현 시나리오를 옮겼다. B-2(행 잠금)는 sqlite가 FOR UPDATE를 무시해 여기서 재현되지 않는다 —
운영과 같은 postgres에서 동시 요청 스크립트로 확인한다(PROGRESS 2026-10-19 항목).
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import IntegrityError

import app.auth as auth_mod
from app import workflow
from app.clock import now as now_kst
from app.db import SessionLocal, _enforce_version_approval_unique
from app.main import app
from app.models import (
    ApprovalRequest,
    CheckoutRequest,
    Employee,
    MapApprover,
    MapPermission,
    MapVersion,
    ProcessMap,
    VersionApproval,
)
from app.settings import settings

SYSADMIN = "integ.sysadmin"
_seq = 0


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth_enabled=True + sysadmin 1명 — 실 권한 판정 활성화. 테스트 후 복원."""
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _run(coro_factory):  # type: ignore[no-untyped-def]
    async def _inner():  # type: ignore[no-untyped-def]
        async with SessionLocal() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_inner())


def _people(*names: str) -> dict[str, str]:
    """테스트마다 고유 login_id — 공유 sqlite에서 다른 테스트의 승인자·점유와 섞이지 않게."""
    global _seq
    _seq += 1
    return {name: f"{name}.{_seq}" for name in names}


def _seed_flow(
    *,
    owner: str,
    approvers: list[str],
    editors: tuple[str, ...] = (),
    inactive: tuple[str, ...] = (),
) -> tuple[int, int]:
    """비공개 맵 + 오너·editor grant + 승인자 + 오너가 점유한 Draft. 사람은 전부 재직 직원으로 시드."""

    async def _make(session) -> tuple[int, int]:  # type: ignore[no-untyped-def]
        for login in {owner, *approvers, *editors, *inactive}:
            session.add(
                Employee(login_id=login, name=login, source="local", active=login not in inactive)
            )
        m = ProcessMap(
            name=f"integrity {owner}", visibility="private", owner_id=owner, created_by=owner
        )
        session.add(m)
        await session.flush()
        session.add(
            MapPermission(
                map_id=m.id, principal_type="user", principal_id=owner, role="owner",
                granted_by="seed",
            )
        )
        for editor in editors:
            session.add(
                MapPermission(
                    map_id=m.id, principal_type="user", principal_id=editor, role="editor",
                    granted_by="seed",
                )
            )
        for approver in approvers:
            session.add(MapApprover(map_id=m.id, user_id=approver))
        v = MapVersion(
            map_id=m.id, label="As-Is", checked_out_by=owner, checked_out_at=now_kst()
        )
        session.add(v)
        await session.flush()
        return m.id, v.id

    return _run(_make)


def _depart(login: str) -> None:
    """퇴사 처리 — HR 동기화와 같은 순서(active=False 후 reconcile)."""

    async def _go(session) -> None:  # type: ignore[no-untyped-def]
        (await session.get(Employee, login)).active = False
        await workflow.reconcile_departures(session, {login})

    _run(_go)


def _post(client: TestClient, user: str, path: str, json: dict | None = None) -> int:
    act_as(user)
    return client.post(path, json=json or {}).status_code


def _status(version_id: int) -> str:
    async def _get(session) -> str:  # type: ignore[no-untyped-def]
        return (await session.get(MapVersion, version_id)).status

    return _run(_get)


# ── B-1 승인자당 1행 ──────────────────────────────────────────


def test_duplicate_approval_row_is_rejected_by_unique_index(client: TestClient) -> None:
    """(version_id, approver) 유니크 — 동시 approve 2건이 2표로 세지던 구멍의 DB 방어선."""
    people = _people("own", "ap1")
    _, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]])

    async def _insert_twice(session) -> None:  # type: ignore[no-untyped-def]
        session.add(VersionApproval(version_id=vid, approver=people["ap1"]))
        await session.flush()
        session.add(VersionApproval(version_id=vid, approver=people["ap1"]))
        await session.flush()

    with pytest.raises(IntegrityError):
        _run(_insert_twice)


def test_bootstrap_removes_duplicate_approvals_then_adds_unique_index() -> None:
    """기존 DB 보강 — 중복 행을 최저 id 1건만 남기고 지운 뒤 유니크 인덱스를 건다(멱등)."""
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.execute(text(
            "CREATE TABLE version_approvals "
            "(id INTEGER PRIMARY KEY, version_id INTEGER, approver VARCHAR(100), approved_at TIMESTAMP)"
        ))
        conn.execute(text(
            "INSERT INTO version_approvals (id, version_id, approver) VALUES "
            "(1, 7, 'ap1'), (2, 7, 'ap1'), (3, 7, 'ap2'), (4, 8, 'ap1')"
        ))
        _enforce_version_approval_unique(conn)
        _enforce_version_approval_unique(conn)
        rows = conn.execute(text("SELECT id FROM version_approvals ORDER BY id")).fetchall()
        with pytest.raises(IntegrityError):
            conn.execute(text(
                "INSERT INTO version_approvals (id, version_id, approver) VALUES (5, 7, 'ap2')"
            ))

    assert [row[0] for row in rows] == [1, 3, 4]


def test_repeat_approve_by_same_approver_does_not_reach_quorum(
    client: TestClient, enforce: None
) -> None:
    """[ap1, ap2]에서 ap1만 두 번 approve → pending 유지, ap2가 승인해야 approved."""
    people = _people("own", "ap1", "ap2")
    _, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"], people["ap2"]])
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200

    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 200
    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 200
    assert _status(vid) == "pending"

    assert _post(client, people["ap2"], f"/api/versions/{vid}/approve") == 200
    assert _status(vid) == "approved"


# ── B-3 퇴사·교체 승인자의 옛 승인 ─────────────────────────────


def test_departed_approver_approval_does_not_count(client: TestClient, enforce: None) -> None:
    """[ap1, ap2, ap3]: ap1 승인 → 퇴사 → ap2 승인 → ap3가 남아 pending. 진행 수도 ap2만."""
    people = _people("own", "ap1", "ap2", "ap3")
    approvers = [people["ap1"], people["ap2"], people["ap3"]]
    _, vid = _seed_flow(owner=people["own"], approvers=approvers)
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200
    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 200
    _depart(people["ap1"])

    assert _post(client, people["ap2"], f"/api/versions/{vid}/approve") == 200
    assert _status(vid) == "pending"
    act_as(people["own"])
    wf = client.get(f"/api/versions/{vid}/workflow").json()
    assert wf["approvers"] == sorted([people["ap2"], people["ap3"]])
    assert wf["approvals"] == [people["ap2"]]

    assert _post(client, people["ap3"], f"/api/versions/{vid}/approve") == 200
    assert _status(vid) == "approved"


def test_replaced_approver_must_approve_again(client: TestClient, enforce: None) -> None:
    """ref-audit 교체(apx→apy)처럼 승인자 행만 바뀌어도 apx의 옛 승인이 apy 몫을 채우지 않는다."""
    people = _people("own", "apx", "apa", "apy")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["apx"], people["apa"]], editors=(people["apy"],))
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200
    assert _post(client, people["apx"], f"/api/versions/{vid}/approve") == 200

    async def _replace(session) -> None:  # type: ignore[no-untyped-def]
        row = await session.get(MapApprover, (mid, people["apx"]))
        await session.delete(row)
        session.add(MapApprover(map_id=mid, user_id=people["apy"]))

    _run(_replace)
    assert _post(client, people["apa"], f"/api/versions/{vid}/approve") == 200
    assert _status(vid) == "pending"


# ── B-4 제출자 퇴사 → sysadmin 대신 게시·회수 ─────────────────


def test_sysadmin_publishes_when_submitter_left(client: TestClient, enforce: None) -> None:
    """승인 뒤 제출자 퇴사 → submitter_unavailable, sysadmin만 대신 게시(오너는 여전히 403)."""
    people = _people("sub", "own", "ap1")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["sub"],))

    async def _hand_to_submitter(session) -> None:  # type: ignore[no-untyped-def]
        (await session.get(MapVersion, vid)).checked_out_by = people["sub"]

    _run(_hand_to_submitter)
    assert _post(client, people["sub"], f"/api/versions/{vid}/submit") == 200
    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 200

    act_as(people["own"])
    assert client.get(f"/api/versions/{vid}/workflow").json()["submitter_unavailable"] is False
    assert _post(client, SYSADMIN, f"/api/versions/{vid}/publish") == 403

    _depart(people["sub"])
    act_as(people["own"])
    assert client.get(f"/api/versions/{vid}/workflow").json()["submitter_unavailable"] is True
    assert _post(client, people["own"], f"/api/versions/{vid}/publish") == 403
    assert _post(client, SYSADMIN, f"/api/versions/{vid}/publish") == 200
    assert _status(vid) == "published"


def test_sysadmin_withdraws_pending_when_submitter_left(client: TestClient, enforce: None) -> None:
    """결재 중 제출자 퇴사 → sysadmin이 회수해 Draft로 돌리고 점유를 받는다."""
    people = _people("sub", "own", "ap1")
    _, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["sub"],))

    async def _hand_to_submitter(session) -> None:  # type: ignore[no-untyped-def]
        (await session.get(MapVersion, vid)).checked_out_by = people["sub"]

    _run(_hand_to_submitter)
    assert _post(client, people["sub"], f"/api/versions/{vid}/submit") == 200
    _depart(people["sub"])

    assert _post(client, SYSADMIN, f"/api/versions/{vid}/withdraw") == 200
    act_as(people["own"])
    wf = client.get(f"/api/versions/{vid}/workflow").json()
    assert (wf["status"], wf["checkout_holder"]) == ("draft", SYSADMIN)


# ── B-5 승인자 전원 퇴사 취소 시 동봉 가시성 ───────────────────


def test_cancelled_flow_withdraws_bundled_visibility(client: TestClient, enforce: None) -> None:
    """동봉 public 요청 → 유일 승인자 퇴사로 취소 → 요청 withdrawn, 동봉 없이 재제출·게시해도 private."""
    people = _people("own", "ap1", "ap2")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["ap2"],))
    assert _post(client, people["own"], f"/api/versions/{vid}/submit", {"to_visibility": "public"}) == 200
    _depart(people["ap1"])

    async def _requests(session) -> list[str]:  # type: ignore[no-untyped-def]
        rows = await session.scalars(
            select(ApprovalRequest.status).where(
                ApprovalRequest.map_id == mid, ApprovalRequest.kind == "visibility_change"
            )
        )
        return list(rows.all())

    assert _status(vid) == "draft"
    assert _run(_requests) == ["withdrawn"]

    act_as(people["own"])
    assert client.put(f"/api/maps/{mid}/approvers", json={"user_ids": [people["ap2"]]}).status_code == 200
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200
    assert _post(client, people["ap2"], f"/api/versions/{vid}/approve") == 200
    assert _post(client, people["own"], f"/api/versions/{vid}/publish") == 200

    async def _visibility(session) -> str:  # type: ignore[no-untyped-def]
        return (await session.get(ProcessMap, mid)).visibility

    assert _run(_visibility) == "private"


# ── B-6 제거된 협업자의 점유·제출·게시 ──────────────────────────


def test_removal_applied_releases_checkout_handed_over_meanwhile(
    client: TestClient, enforce: None
) -> None:
    """ed1 제거 요청 pending 중 오너가 점유를 ed1에게 이전 → 제거 승인 시 점유가 풀려 제출 불가."""
    people = _people("own", "ed1", "ed2", "ap1")
    mid, vid = _seed_flow(
        owner=people["own"], approvers=[people["ap1"]], editors=(people["ed1"], people["ed2"])
    )

    async def _grant_id(session) -> int:  # type: ignore[no-untyped-def]
        return await session.scalar(
            select(MapPermission.id).where(
                MapPermission.map_id == mid, MapPermission.principal_id == people["ed1"]
            )
        )

    act_as(people["ed2"])
    removal = client.delete(f"/api/maps/{mid}/permissions/{_run(_grant_id)}").json()
    assert removal["pending"] is True
    act_as(people["own"])
    assert client.post(
        f"/api/versions/{vid}/checkout/transfer", json={"to": people["ed1"]}
    ).status_code == 200
    act_as(people["ap1"])
    assert client.post(
        f"/api/approval-requests/{removal['approval_request']['id']}/decide",
        json={"decision": "approve"},
    ).status_code == 200

    act_as(people["own"])
    assert client.get(f"/api/versions/{vid}/workflow").json()["checkout_holder"] is None
    assert _post(client, people["ed1"], f"/api/versions/{vid}/submit") == 403


def test_holder_without_edit_role_cannot_submit(client: TestClient, enforce: None) -> None:
    """점유는 남았지만 grant가 없는 사용자(그룹·부서 경유 상실 포함) — 제출 403."""
    people = _people("own", "gone", "ap1")
    _, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["gone"],))

    async def _strip(session) -> None:  # type: ignore[no-untyped-def]
        (await session.get(MapVersion, vid)).checked_out_by = people["gone"]
        grant = await session.scalar(
            select(MapPermission).where(MapPermission.principal_id == people["gone"])
        )
        await session.delete(grant)

    _run(_strip)
    act_as(people["gone"])
    resp = client.post(f"/api/versions/{vid}/submit", json={})
    assert resp.status_code == 403
    assert "editor or owner" in resp.json()["detail"]


def test_submitter_without_edit_role_cannot_publish(client: TestClient, enforce: None) -> None:
    """승인 뒤 제출자가 편집권을 잃으면 본인 게시 403 → sysadmin이 대신 게시."""
    people = _people("sub", "own", "ap1")
    _, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["sub"],))

    async def _hand_to_submitter(session) -> None:  # type: ignore[no-untyped-def]
        (await session.get(MapVersion, vid)).checked_out_by = people["sub"]

    _run(_hand_to_submitter)
    assert _post(client, people["sub"], f"/api/versions/{vid}/submit") == 200
    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 200

    async def _strip(session) -> None:  # type: ignore[no-untyped-def]
        grant = await session.scalar(
            select(MapPermission).where(MapPermission.principal_id == people["sub"])
        )
        await session.delete(grant)

    _run(_strip)
    assert _post(client, people["sub"], f"/api/versions/{vid}/publish") == 403
    assert _post(client, SYSADMIN, f"/api/versions/{vid}/publish") == 200


# ── B-7 진행 중 버전 1개 ──────────────────────────────────────


def test_republish_blocked_while_a_version_is_pending(client: TestClient, enforce: None) -> None:
    """만료본 재게시는 Draft뿐 아니라 결재 중 버전이 있어도 409 — Draft 2개 방지."""
    people = _people("own", "ap1")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]])

    async def _add_expired(session) -> int:  # type: ignore[no-untyped-def]
        expired = MapVersion(map_id=mid, label="Old", status="expired", version_number=1)
        session.add(expired)
        await session.flush()
        return expired.id

    expired_id = _run(_add_expired)
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200

    act_as(people["own"])
    resp = client.post(f"/api/versions/{expired_id}/republish")
    assert resp.status_code == 409
    assert "in progress" in resp.json()["detail"]


# ── B-8 결정할 수 없는 인박스 항목 ─────────────────────────────


def test_trashed_map_pending_version_leaves_inbox_and_blocks_transitions(
    client: TestClient, enforce: None
) -> None:
    """휴지통 맵의 결재 대기 — 인박스에서 빠지고 approve·publish 404(열면 404인 것과 일치)."""
    people = _people("own", "ap1")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]])
    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200
    act_as(people["own"])
    assert client.delete(f"/api/maps/{mid}").status_code in (200, 204)

    act_as(people["ap1"])
    inbox = client.get("/api/inbox/approvals").json()
    assert [item for item in inbox if item["map_id"] == mid] == []
    assert _post(client, people["ap1"], f"/api/versions/{vid}/approve") == 404
    assert _post(client, people["own"], f"/api/versions/{vid}/publish") == 404


def test_checkout_request_on_submitted_version_leaves_queues(
    client: TestClient, enforce: None
) -> None:
    """Draft에서 받은 점유 요청은 제출 뒤 decide 409 — 인박스·점유 요청 큐에서 뺀다."""
    people = _people("own", "ed1", "ap1")
    mid, vid = _seed_flow(owner=people["own"], approvers=[people["ap1"]], editors=(people["ed1"],))
    act_as(people["ed1"])
    assert client.post(f"/api/versions/{vid}/checkout/request").status_code == 201
    act_as(people["own"])
    assert [i for i in client.get("/api/inbox/approvals").json() if i["map_id"] == mid] != []

    assert _post(client, people["own"], f"/api/versions/{vid}/submit") == 200
    act_as(people["own"])
    assert [i for i in client.get("/api/inbox/approvals").json() if i["map_id"] == mid] == []
    assert client.get(f"/api/checkout-requests/pending?map_id={mid}").json() == []

    async def _still_pending(session) -> int:  # type: ignore[no-untyped-def]
        return len(
            (
                await session.scalars(
                    select(CheckoutRequest).where(
                        CheckoutRequest.version_id == vid, CheckoutRequest.status == "pending"
                    )
                )
            ).all()
        )

    # 행은 그대로 — Draft로 돌아오면 다시 결정할 수 있다
    assert _run(_still_pending) == 1
