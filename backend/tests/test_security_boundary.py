"""보안 경계 회귀 — 2026-10-19 시스템 리뷰 1단계(P0-1·P0-2·F-2·C-2·C-4·C-3·G-9·H-8).

리뷰어 재현 시나리오를 그대로 옮겼다. enforce 픽스처로 실 권한 판정을 켠다.
E-2(framework draft 가드)는 캔버스 시드 헬퍼가 있는 test_framework_canvas.py에 둔다.
"""

import asyncio
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

import app.auth as auth_mod
from app.clock import now as now_kst
from app.db import SessionLocal
from app.main import app
from app.models import (
    AiChatMessage,
    AiChatSession,
    Comment,
    Edge,
    Group,
    LocalCredential,
    MapPermission,
    MapVersion,
    Node,
    ProcessMap,
)
from app.settings import settings

SYSADMIN = "sec.sysadmin"
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


def _next_key() -> int:
    global _seq
    _seq += 1
    return _seq


def _seed_map(
    *,
    grants: tuple[tuple[str, str, str], ...] = (),
    visibility: str = "private",
    status: str = "draft",
    created_by: str | None = None,
    designated: bool = False,
    nodes: tuple[tuple[str, str], ...] = (),
) -> tuple[int, int]:
    """맵 + 버전 1개 시드. nodes=((id, node_type), ...). (map_id, version_id) 반환."""
    key = _next_key()

    async def _make(session) -> tuple[int, int]:  # type: ignore[no-untyped-def]
        m = ProcessMap(
            name=f"sec map {key}",
            visibility=visibility,
            created_by=created_by,
            sp_designated_at=now_kst() if designated else None,
            sp_department="Secret Dept",
            sp_assignee="Secret Person",
            description="secret description",
        )
        v = MapVersion(label="As-Is", status=status)
        m.versions.append(v)
        session.add(m)
        await session.flush()
        for ptype, pid, role in grants:
            session.add(
                MapPermission(
                    map_id=m.id, principal_type=ptype, principal_id=pid, role=role, granted_by="seed"
                )
            )
        for node_id, node_type in nodes:
            session.add(
                Node(id=node_id, version_id=v.id, title=f"T-{node_id}", node_type=node_type)
            )
        return m.id, v.id

    return _run(_make)


def _add_rows(*rows: object) -> None:
    async def _make(session) -> None:  # type: ignore[no-untyped-def]
        for row in rows:
            session.add(row)

    _run(_make)


def _checkout(client: TestClient, version_id: int) -> None:
    assert client.post(f"/api/versions/{version_id}/checkout", json={}).json()["mine"] is True


def _node(node_id: str, node_type: str = "process", **extra: object) -> dict:
    return {"id": node_id, "title": node_id, "node_type": node_type, "pos_x": 0, "pos_y": 0, **extra}


def _own_draft(owner: str) -> tuple[int, int, str]:
    """owner가 점유한 자기 Draft — (map_id, version_id, start 노드 id)."""
    key = _next_key()
    start_id = f"own-start-{key}"
    map_id, vid = _seed_map(grants=(("user", owner, "owner"),), nodes=((start_id, "start"),))
    return map_id, vid, start_id


# ── P0-1: 다른 버전의 node·group·edge id 끌어오기 ───────────────


def test_put_rejects_node_id_from_another_version(client: TestClient, enforce: None) -> None:
    key = _next_key()
    victim_task = f"victim-task-{key}"
    victim_map, victim_vid = _seed_map(
        visibility="public", status="published",
        nodes=((f"victim-start-{key}", "start"), (victim_task, "process")),
    )
    _add_rows(
        Edge(id=f"victim-edge-{key}", version_id=victim_vid,
             source_node_id=f"victim-start-{key}", target_node_id=victim_task),
        Comment(version_id=victim_vid, node_id=victim_task, author="victim.owner", body="keep me"),
    )
    _, vid, start_id = _own_draft("atk.u")
    act_as("atk.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph",
                   json={"nodes": [_node(start_id, "start"), _node(victim_task)], "edges": []})

    assert r.status_code == 409

    async def _check(session) -> tuple[int | None, int, int]:  # type: ignore[no-untyped-def]
        node = await session.get(Node, victim_task)
        edges = len((await session.scalars(select(Edge).where(Edge.version_id == victim_vid))).all())
        comments = len((await session.scalars(select(Comment).where(Comment.version_id == victim_vid))).all())
        return (node.version_id if node else None), edges, comments

    assert _run(_check) == (victim_vid, 1, 1)


def test_put_rejects_group_id_from_another_version(client: TestClient, enforce: None) -> None:
    key = _next_key()
    _, victim_vid = _seed_map(visibility="public", status="published")
    victim_group = f"victim-group-{key}"
    _add_rows(Group(id=victim_group, version_id=victim_vid, label="victim area"))
    _, vid, start_id = _own_draft("atk.u")
    act_as("atk.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={
        "nodes": [_node(start_id, "start", group_ids=[victim_group])],
        "edges": [],
        "groups": [{"id": victim_group, "label": "stolen"}],
    })

    assert r.status_code == 409

    async def _check(session):  # type: ignore[no-untyped-def]
        group = await session.get(Group, victim_group)
        return group.version_id, group.label

    assert _run(_check) == (victim_vid, "victim area")


def test_put_rejects_edge_id_from_another_version(client: TestClient, enforce: None) -> None:
    """종전엔 처리되지 않은 IntegrityError 500이었다(A-2와 같은 경로)."""
    key = _next_key()
    _, victim_vid = _seed_map(
        visibility="public", status="published",
        nodes=((f"ve-start-{key}", "start"), (f"ve-task-{key}", "process")),
    )
    victim_edge = f"victim-edge2-{key}"
    _add_rows(Edge(id=victim_edge, version_id=victim_vid,
                   source_node_id=f"ve-start-{key}", target_node_id=f"ve-task-{key}"))
    _, vid, start_id = _own_draft("atk.u")
    act_as("atk.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={
        "nodes": [_node(start_id, "start"), _node(f"own-task-{key}")],
        "edges": [{"id": victim_edge, "source_node_id": start_id, "target_node_id": f"own-task-{key}"}],
    })

    assert r.status_code == 409


# ── P0-2: resolved?pinned= 로 다른 맵 버전 열람 ────────────────


def test_resolved_rejects_pin_from_another_map(client: TestClient, enforce: None) -> None:
    key = _next_key()
    _, secret_vid = _seed_map(nodes=((f"secret-node-{key}", "process"),))
    public_map, public_vid = _seed_map(
        visibility="public", designated=True, status="published",
        nodes=((f"public-node-{key}", "process"),),
    )
    act_as("outsider.u")

    leaked = client.get(f"/api/library/processes/{public_map}/resolved", params={"pinned": secret_vid})
    own = client.get(f"/api/library/processes/{public_map}/resolved", params={"pinned": public_vid})

    assert leaked.status_code == 404
    assert own.status_code == 200
    assert [n["id"] for n in own.json()["nodes"]] == [f"public-node-{key}"]


def test_put_rejects_pin_outside_linked_map(client: TestClient, enforce: None) -> None:
    _, secret_vid = _seed_map()
    public_map, _ = _seed_map(visibility="public", designated=True, status="published")
    _, vid, start_id = _own_draft("pin.u")
    act_as("pin.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={"nodes": [
        _node(start_id, "start"),
        _node(f"pin-sp-{vid}", "subprocess", linked_map_id=public_map,
              follow_latest=False, linked_version_id=secret_vid),
    ], "edges": []})

    assert r.status_code == 422


def test_put_keeps_already_stored_pin(client: TestClient, enforce: None) -> None:
    """이미 저장된 핀은 재검증하지 않는다 — 매 저장이 막혀 맵이 사실상 읽기전용이 되는 것을 피한다.

    잘못된 핀이 남아 있어도 resolved가 404라 내용은 새지 않는다.
    """
    _, secret_vid = _seed_map()
    public_map, _ = _seed_map(visibility="public", designated=True, status="published")
    _, vid, start_id = _own_draft("pin2.u")
    sp_id = f"pin2-sp-{vid}"
    _add_rows(Node(id=sp_id, version_id=vid, title="sp", node_type="subprocess",
                   linked_map_id=public_map, follow_latest=False, linked_version_id=secret_vid))
    act_as("pin2.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={"nodes": [
        _node(start_id, "start"),
        _node(sp_id, "subprocess", linked_map_id=public_map,
              follow_latest=False, linked_version_id=secret_vid),
    ], "edges": []})

    assert r.status_code == 200


# ── F-2: 볼 수 없는 맵 링크·refs 메타데이터 노출 ───────────────


def test_put_rejects_link_to_unviewable_undesignated_map(client: TestClient, enforce: None) -> None:
    secret_map, _ = _seed_map()
    _, vid, start_id = _own_draft("link.u")
    act_as("link.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={"nodes": [
        _node(start_id, "start"), _node(f"link-sp-{vid}", "subprocess", linked_map_id=secret_map),
    ], "edges": []})

    assert r.status_code == 422


def test_put_allows_link_to_designated_or_viewable_map(client: TestClient, enforce: None) -> None:
    """지정 맵은 라이브러리 공개라 누구나, 미지정 맵은 볼 수 있으면 링크할 수 있다."""
    designated_map, _ = _seed_map(designated=True)
    viewable_map, _ = _seed_map(grants=(("user", "link2.u", "viewer"),))
    _, vid, start_id = _own_draft("link2.u")
    act_as("link2.u")
    _checkout(client, vid)

    r = client.put(f"/api/versions/{vid}/graph", json={"nodes": [
        _node(start_id, "start"),
        _node(f"link2-a-{vid}", "subprocess", linked_map_id=designated_map),
        _node(f"link2-b-{vid}", "subprocess", linked_map_id=viewable_map),
    ], "edges": []})

    assert r.status_code == 200
    refs = r.json()["subprocess_refs"]
    assert refs[str(designated_map)]["department"] == "Secret Dept"
    assert refs[str(viewable_map)]["name"] is not None


def test_refs_mask_unviewable_undesignated_map(client: TestClient, enforce: None) -> None:
    """이미 저장된 링크(가드 이전 데이터)도 응답에서는 가린다. 다시 저장해도 막히지 않는다."""
    secret_map, _ = _seed_map()
    _, vid, start_id = _own_draft("mask.u")
    sp_id = f"mask-sp-{vid}"
    _add_rows(Node(id=sp_id, version_id=vid, title="sp", node_type="subprocess", linked_map_id=secret_map))
    act_as("mask.u")

    ref = client.get(f"/api/versions/{vid}/graph").json()["subprocess_refs"][str(secret_map)]

    assert ref["designated"] is False
    assert ref["name"] is None
    assert ref["department"] is None
    assert ref["assignee"] is None
    assert ref["sp_description"] is None

    _checkout(client, vid)
    resave = client.put(f"/api/versions/{vid}/graph", json={"nodes": [
        _node(start_id, "start"), _node(sp_id, "subprocess", linked_map_id=secret_map),
    ], "edges": []})
    assert resave.status_code == 200

    act_as(SYSADMIN)
    assert client.get(f"/api/versions/{vid}/graph").json()["subprocess_refs"][str(secret_map)]["name"]


# ── C-2: 코멘트 조회 게이트 ────────────────────────────────────


def test_comments_list_requires_viewer(client: TestClient, enforce: None) -> None:
    key = _next_key()
    node_id = f"cmt-node-{key}"
    _, vid = _seed_map(grants=(("user", "cmt.viewer", "viewer"),), nodes=((node_id, "process"),))
    _add_rows(Comment(version_id=vid, node_id=node_id, author="owner", body="secret comment"))

    act_as("outsider.u")
    assert client.get(f"/api/versions/{vid}/comments").status_code == 403
    act_as("cmt.viewer")
    assert [c["body"] for c in client.get(f"/api/versions/{vid}/comments").json()] == ["secret comment"]


# ── C-4: 워크플로·승인자 조회 게이트 ─────────────────────────────


def test_workflow_and_approvers_require_viewer(client: TestClient, enforce: None) -> None:
    map_id, vid = _seed_map(grants=(("user", "wf.viewer", "viewer"),))

    act_as("outsider.u")
    assert client.get(f"/api/versions/{vid}/workflow").status_code == 403
    assert client.get(f"/api/maps/{map_id}/approvers").status_code == 403
    act_as("wf.viewer")
    assert client.get(f"/api/versions/{vid}/workflow").status_code == 200
    assert client.get(f"/api/maps/{map_id}/approvers").status_code == 200


# ── C-3: 승인자 변경 = 현재 오너·sysadmin ─────────────────────────


def test_set_approvers_on_ownerless_map_needs_owner(client: TestClient, enforce: None) -> None:
    """created_by가 비어 있는 맵(시드·레거시)도 외부인이 자기를 승인자로 넣지 못한다."""
    map_id, vid = _seed_map(created_by=None)

    act_as("outsider.u")
    assert client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["outsider.u"]}).status_code == 403
    assert client.get(f"/api/versions/{vid}/graph").status_code == 403


def test_set_approvers_follows_current_owner(client: TestClient, enforce: None) -> None:
    """오너가 바뀐 맵은 현재 오너가 바꾸고, 역할을 잃은 원작성자는 못 바꾼다."""
    map_id, _ = _seed_map(created_by="orig.author", grants=(("user", "new.owner", "owner"),))

    act_as("orig.author")
    assert client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]}).status_code == 403
    act_as("new.owner")
    assert client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["a"]}).status_code == 200
    act_as(SYSADMIN)
    assert client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["b"]}).status_code == 200


# ── G-9: 접근을 잃은 맵의 AI 챗 기록 ───────────────────────────


def test_chat_history_hidden_after_access_lost(client: TestClient, enforce: None) -> None:
    map_id, _ = _seed_map(grants=(("user", "chat.u", "viewer"),))

    async def _make(session) -> int:  # type: ignore[no-untyped-def]
        chat = AiChatSession(map_id=map_id, login_id="chat.u", title="secret chat")
        session.add(chat)
        await session.flush()
        session.add(AiChatMessage(session_id=chat.id, role="user", content="secret question"))
        return chat.id

    chat_id = _run(_make)
    act_as("chat.u")
    assert chat_id in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert client.get(f"/api/ai/chat-sessions/{chat_id}/messages").status_code == 200

    async def _revoke(session) -> None:  # type: ignore[no-untyped-def]
        await session.execute(delete(MapPermission).where(MapPermission.map_id == map_id))

    _run(_revoke)
    assert chat_id not in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert client.get(f"/api/ai/chat-sessions/{chat_id}/messages").status_code == 404


# ── H-8: 관리자 테이블 뷰어의 비밀번호 해시 ─────────────────────


def test_admin_tables_redact_password_hash(client: TestClient, enforce: None) -> None:
    key = _next_key()
    login_id = f"sec.local.{key}"
    secret = f"scrypt$deadbeef{key}"
    _add_rows(LocalCredential(login_id=login_id, password_hash=secret, created_by="seed"))
    act_as(SYSADMIN)

    page = client.get("/api/admin/tables/local_credentials", params={"q": login_id}).json()
    by_hash = client.get("/api/admin/tables/local_credentials", params={"q": f"deadbeef{key}"}).json()
    csv_text = client.get("/api/admin/tables/local_credentials/export").text

    assert [r["password_hash"] for r in page["rows"]] == ["[redacted]"]
    assert by_hash["total"] == 0
    assert secret not in csv_text
    assert login_id in csv_text
