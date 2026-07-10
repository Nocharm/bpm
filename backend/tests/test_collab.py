"""Checkout lock + comment tests (spec §7 Phase C).

auth 우회 모드에서는 모든 요청이 settings.dev_user로 인증되므로,
다중 사용자 시나리오는 dev_user를 monkeypatch로 바꿔 재현한다.
"""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


_collab_seq = 0


def _create_version(client: TestClient) -> int:
    # 세션 공유 DB + 맵 이름 전역 유니크 → 호출마다 고유 이름
    global _collab_seq
    _collab_seq += 1
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": f"collab map {_collab_seq}"}).json()
    return created["versions"][0]["id"]


def _put_single_node(client: TestClient, version_id: int) -> None:
    # PUT /graph는 체크아웃 보유자만 — 노드 시드도 체크아웃 후 저장
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [{"id": "s1", "node_type": "start"}, {"id": "n1", "title": "결재"}], "edges": []},
    )


# ── 체크아웃 ──────────────────────────────────────────────


def test_checkout_acquire_and_heartbeat(client: TestClient) -> None:
    version_id = _create_version(client)

    first = client.post(f"/api/versions/{version_id}/checkout", json={}).json()
    second = client.post(f"/api/versions/{version_id}/checkout", json={}).json()

    assert first["mine"] is True
    assert first["checked_out_by"] == settings.dev_user
    # 같은 사용자의 재호출 = 연장
    assert second["mine"] is True


def test_checkout_blocked_for_other_user(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    version_id = _create_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    state = client.post(f"/api/versions/{version_id}/checkout", json={}).json()

    assert state["mine"] is False
    assert state["checked_out_by"] == "local-dev"


def test_checkout_force_takeover(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    version_id = _create_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    state = client.post(
        f"/api/versions/{version_id}/checkout", json={"force": True}
    ).json()

    assert state["mine"] is True
    assert state["checked_out_by"] == "reviewer"


def test_save_rejected_while_locked_by_other(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    version_id = _create_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    response = client.put(
        f"/api/versions/{version_id}/graph",
        json={"nodes": [], "edges": []},
    )

    assert response.status_code == 423


def test_release_unlocks_for_others(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    version_id = _create_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})
    client.delete(f"/api/versions/{version_id}/checkout")

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    state = client.post(f"/api/versions/{version_id}/checkout", json={}).json()

    assert state["mine"] is True


def test_checkout_is_sticky_no_ttl_expiry(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """점유는 시간 경과로 풀리지 않는다(지정 인계 전용) — 타인은 획득 불가, 요청/이전만."""
    version_id = _create_version(client)
    client.post(f"/api/versions/{version_id}/checkout", json={})

    # TTL을 0으로 낮춰도 sticky — 다른 사용자는 여전히 획득 못 함
    monkeypatch.setattr(settings, "checkout_ttl_minutes", 0)
    monkeypatch.setattr(settings, "dev_user", "reviewer")
    state = client.post(f"/api/versions/{version_id}/checkout", json={}).json()

    assert state["mine"] is False
    assert state["checked_out_by"] == "local-dev"


def test_delete_version_rejected_while_locked_by_other(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "collab map delete-locked"}).json()
    version_id = created["versions"][0]["id"]
    # 삭제 가능하도록 두 번째 버전 생성 후, 첫 버전을 잠금
    client.post(f"/api/maps/{created['id']}/versions", json={"label": "To-Be"})
    client.post(f"/api/versions/{version_id}/checkout", json={})

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    response = client.delete(f"/api/versions/{version_id}")

    assert response.status_code == 423


# ── 코멘트 ────────────────────────────────────────────────


def test_comment_create_and_list(client: TestClient) -> None:
    version_id = _create_version(client)
    _put_single_node(client, version_id)

    created = client.post(
        f"/api/versions/{version_id}/comments",
        json={"node_id": "n1", "body": "검토 필요"},
    )
    listed = client.get(f"/api/versions/{version_id}/comments").json()

    assert created.status_code == 201
    assert listed[0]["body"] == "검토 필요"
    assert listed[0]["author"] == settings.dev_user
    assert listed[0]["resolved"] is False


def test_comment_on_unknown_node_404(client: TestClient) -> None:
    version_id = _create_version(client)

    response = client.post(
        f"/api/versions/{version_id}/comments",
        json={"node_id": "ghost", "body": "?"},
    )

    assert response.status_code == 404


def test_comment_resolve_toggle(client: TestClient) -> None:
    version_id = _create_version(client)
    _put_single_node(client, version_id)
    comment = client.post(
        f"/api/versions/{version_id}/comments",
        json={"node_id": "n1", "body": "확인"},
    ).json()

    resolved = client.patch(
        f"/api/comments/{comment['id']}", json={"resolved": True}
    ).json()

    assert resolved["resolved"] is True


def test_comment_delete_author_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    version_id = _create_version(client)
    _put_single_node(client, version_id)
    comment = client.post(
        f"/api/versions/{version_id}/comments",
        json={"node_id": "n1", "body": "내 코멘트"},
    ).json()

    monkeypatch.setattr(settings, "dev_user", "reviewer")
    forbidden = client.delete(f"/api/comments/{comment['id']}")
    monkeypatch.setattr(settings, "dev_user", "local-dev")
    allowed = client.delete(f"/api/comments/{comment['id']}")

    assert forbidden.status_code == 403
    assert allowed.status_code == 204


def test_deleting_node_removes_its_comments(client: TestClient) -> None:
    version_id = _create_version(client)
    _put_single_node(client, version_id)
    client.post(
        f"/api/versions/{version_id}/comments",
        json={"node_id": "n1", "body": "남는지 확인"},
    )

    # 노드 제거 → 코멘트도 함께 정리
    client.put(
        f"/api/versions/{version_id}/graph", json={"nodes": [], "edges": []}
    )
    listed = client.get(f"/api/versions/{version_id}/comments").json()

    assert listed == []
