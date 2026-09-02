"""카테고리 관리 CRUD API — 생성·이름변경/재정렬·이동(레벨 재계산)·삭제, sysadmin 전용 게이트."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

STRANGER_SYSADMIN = "adm.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """enforcement ON — test_categories_api.py의 동일 픽스처를 미러(brief §2 지시).

    기본 스위트는 auth OFF라 is_sysadmin이 전원 True → 403 게이트가 트리거되지 않는다.
    """
    prev_auth = settings.auth_enabled
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = True
    settings.bpm_sysadmins = STRANGER_SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.pop(auth_mod.get_current_user, None)


def act_as(user: str) -> None:
    """이후 요청의 인증 사용자를 user로 고정 (JWT 검증 우회)."""
    app.dependency_overrides[auth_mod.get_current_user] = lambda: user


def _create_chain(client: TestClient, depth: int, prefix: str) -> list[dict]:
    """depth단 체인(부모→자식)을 code=f"{prefix}-L{i}"로 생성, 노드 리스트(L1..Ldepth) 반환."""
    nodes = []
    parent_id = None
    for i in range(1, depth + 1):
        node = client.post(
            "/api/categories",
            json={"name": f"{prefix} L{i}", "parent_id": parent_id, "code": f"{prefix}-L{i}"},
        ).json()
        nodes.append(node)
        parent_id = node["id"]
    return nodes


def test_create_root_and_child(client: TestClient) -> None:
    root = client.post("/api/categories", json={"name": "ADM Root"}).json()
    assert root["level"] == 1
    assert root["code"].startswith("ui-")

    child1 = client.post(
        "/api/categories", json={"name": "ADM Child 1", "parent_id": root["id"]}
    ).json()
    assert child1["level"] == 2 and child1["sort_order"] == 0

    child2 = client.post(
        "/api/categories", json={"name": "ADM Child 2", "parent_id": root["id"]}
    ).json()
    assert child2["sort_order"] == 1


def test_create_depth_and_dup_code(client: TestClient) -> None:
    chain = _create_chain(client, 5, "ADM-DEPTH")
    resp = client.post(
        "/api/categories", json={"name": "too deep", "parent_id": chain[-1]["id"]}
    )
    assert resp.status_code == 422
    assert "max depth is 5" in resp.json()["detail"]

    dup = client.post("/api/categories", json={"name": "dup", "code": "ADM-DEPTH-L1"})
    assert dup.status_code == 409


def test_rename_and_reorder(client: TestClient) -> None:
    node = client.post(
        "/api/categories", json={"name": "ADM Rename Me", "code": "ADM-RENAME"}
    ).json()
    resp = client.patch(
        f"/api/categories/{node['id']}", json={"name": "ADM Renamed", "sort_order": 7}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "ADM Renamed" and body["sort_order"] == 7


def test_move_recomputes_levels(client: TestClient) -> None:
    root_a = client.post("/api/categories", json={"name": "R", "code": "ADM-MV-A"}).json()
    sub = client.post(
        "/api/categories", json={"name": "S", "parent_id": root_a["id"], "code": "ADM-MV-SUB"}
    ).json()
    leaf = client.post(
        "/api/categories", json={"name": "L", "parent_id": sub["id"], "code": "ADM-MV-LEAF"}
    ).json()
    assert sub["level"] == 2 and leaf["level"] == 3

    root_c = client.post("/api/categories", json={"name": "RC", "code": "ADM-MV-C"}).json()
    mid = client.post(
        "/api/categories", json={"name": "M", "parent_id": root_c["id"], "code": "ADM-MV-MID"}
    ).json()
    assert mid["level"] == 2

    resp = client.patch(f"/api/categories/{sub['id']}", json={"parent_id": mid["id"]})
    assert resp.status_code == 200
    assert resp.json()["level"] == 3  # mid(level2)의 자식

    leaf_row = next(
        c
        for c in client.get(f"/api/categories/nodes?parent_id={sub['id']}").json()
        if c["id"] == leaf["id"]
    )
    assert leaf_row["level"] == 4  # sub 이동에 연동해 자손도 +1


def test_cycle_safe_paths_and_move(client: TestClient) -> None:
    """(동시성으로 생긴) 부모 사이클이 있어도 build_category_paths·update_category의 BFS 서브트리
    순회가 멈추지 않아야 한다(merge review FIX 3). API로는 사이클에 도달할 수 없으므로(자기자신/
    자손 이동 가드) ORM으로 직접 만들어 레이스를 시뮬레이션한다."""
    import asyncio

    from app.db import SessionLocal
    from app.models import ProcessCategory
    from app.routers.categories import build_category_paths

    root_a = client.post("/api/categories", json={"name": "CYC A", "code": "ADM-CYC-A"}).json()
    node_b = client.post(
        "/api/categories", json={"name": "CYC B", "parent_id": root_a["id"], "code": "ADM-CYC-B"}
    ).json()
    root_c = client.post("/api/categories", json={"name": "CYC C", "code": "ADM-CYC-C"}).json()

    async def _corrupt() -> None:
        async with SessionLocal() as session:
            row = await session.get(ProcessCategory, root_a["id"])
            row.parent_id = node_b["id"]  # A→B→A 사이클 완성
            await session.commit()

    asyncio.run(_corrupt())

    # (a) 경로 조립 — RecursionError 없이 부분 경로(사이클 지점에서 끊긴)를 반환
    rows = [(root_a["id"], node_b["id"], "A"), (node_b["id"], root_a["id"], "B")]
    paths = build_category_paths(rows)
    assert set(paths) == {root_a["id"], node_b["id"]}

    # (b) 사이클을 포함한 서브트리를 옮기는 PATCH가 (행 아니라) 정상 응답한다
    resp = client.patch(f"/api/categories/{root_a['id']}", json={"parent_id": root_c["id"]})
    assert resp.status_code == 200


def test_move_guards(client: TestClient) -> None:
    root = client.post("/api/categories", json={"name": "GR", "code": "ADM-GD-ROOT"}).json()
    child = client.post(
        "/api/categories", json={"name": "GC", "parent_id": root["id"], "code": "ADM-GD-CHILD"}
    ).json()

    # 자기 자손 아래 이동 → 422
    resp = client.patch(f"/api/categories/{root['id']}", json={"parent_id": child["id"]})
    assert resp.status_code == 422
    assert "cannot move under own subtree" in resp.json()["detail"]

    # 이동 후 깊이 초과 → 422 (root는 자식 1개 보유·높이1, level4 부모 아래로 이동하면 5+1=6)
    chain = _create_chain(client, 4, "ADM-GD-DEEP")
    resp2 = client.patch(f"/api/categories/{root['id']}", json={"parent_id": chain[-1]["id"]})
    assert resp2.status_code == 422
    assert "max depth is 5" in resp2.json()["detail"]

    # 새 부모 404
    resp3 = client.patch(f"/api/categories/{root['id']}", json={"parent_id": 999999})
    assert resp3.status_code == 404


def test_delete_guards_and_ok(client: TestClient) -> None:
    """2026-08-12 정책 — 서브트리에 맵이 1개라도 있으면 409, 없으면 하위 카테고리까지 묶음 삭제."""
    parent = client.post("/api/categories", json={"name": "DP", "code": "ADM-DEL-P"}).json()
    child = client.post(
        "/api/categories", json={"name": "DC", "parent_id": parent["id"], "code": "ADM-DEL-C"}
    ).json()

    created_map = client.post(
        "/api/maps",
        json={
            "name": "ADM delete guard map",
            "description": "",
            "owning_department": "Owning Anchor Division",
            "visibility": "public",
        },
    ).json()
    # 맵 슬롯은 L5 전용(2026-08-30 확정) — 배정 가능한 말단(L5)까지 체인 생성 후 연결
    c3 = client.post(
        "/api/categories", json={"name": "DC3", "parent_id": child["id"], "code": "ADM-DEL-C3"}
    ).json()
    c4 = client.post(
        "/api/categories", json={"name": "DC4", "parent_id": c3["id"], "code": "ADM-DEL-C4"}
    ).json()
    c5 = client.post(
        "/api/categories", json={"name": "DC5", "parent_id": c4["id"], "code": "ADM-DEL-C5"}
    ).json()
    assert client.put(
        f"/api/maps/{created_map['id']}/category", json={"category_id": child["id"]}
    ).status_code == 422  # 비-L5 배정 차단
    link = client.put(
        f"/api/maps/{created_map['id']}/category", json={"category_id": c5["id"]}
    )
    assert link.status_code == 200

    # 맵이 자식(서브트리)에 걸려 있으면 부모 삭제도 거부 — 직접 연결이 아니어도 막힌다
    resp = client.delete(f"/api/categories/{parent['id']}")
    assert resp.status_code == 409
    assert "maps are linked in this subtree" in resp.json()["detail"]

    resp2 = client.delete(f"/api/categories/{child['id']}")
    assert resp2.status_code == 409
    assert "maps are linked in this subtree" in resp2.json()["detail"]

    # 맵 연결 해제 후 부모(3레벨 서브트리) 삭제 → 자식·손자까지 묶음으로 사라진다.
    # 삭제는 레벨 역순 명시적 벌크 DELETE — Postgres의 자기참조 FK 즉시 강제 하에서도 안전
    # (sqlite는 FK 미강제라 순서 버그가 로컬 테스트론 안 잡힘 — 9910 실측 500의 원인이었다).
    client.put(f"/api/maps/{created_map['id']}/category", json={"category_id": None})
    grandchild = client.post(
        "/api/categories", json={"name": "DG", "parent_id": child["id"], "code": "ADM-DEL-G"}
    ).json()
    resp3 = client.delete(f"/api/categories/{parent['id']}")
    assert resp3.status_code == 204

    roots_after = client.get("/api/categories/nodes").json()
    assert all(n["id"] != parent["id"] for n in roots_after)
    assert client.get(f"/api/categories/nodes?parent_id={parent['id']}").json() == []
    assert client.get(f"/api/categories/nodes?parent_id={child['id']}").json() == []
    assert client.delete(f"/api/categories/{grandchild['id']}").status_code == 404


def test_crud_requires_sysadmin(client: TestClient, enforce: None) -> None:
    act_as("adm.normal_user")
    assert client.post("/api/categories", json={"name": "no"}).status_code == 403
    assert client.patch("/api/categories/1", json={"name": "no"}).status_code == 403
    assert client.delete("/api/categories/1").status_code == 403


DELEG_ADMIN = "deleg.mid"
DELEG_STRANGER = "deleg.stranger"  # no permission rows anywhere


def _seed_deleg_tree(client: TestClient, prefix: str) -> dict[str, int]:
    """L1(root) > L2(mid, DELEG_ADMIN 권한 부여) > L3(sub) > L4(leaf). 형제 L2(other)는
    위임 서브트리 밖(이동/생성 차단 검증용). prefix는 code 네임스페이스 격리용(세션 공유 DB)."""
    act_as(STRANGER_SYSADMIN)
    root = client.post("/api/categories", json={"name": "Deleg Root", "code": f"{prefix}-ROOT"}).json()
    mid = client.post(
        "/api/categories",
        json={"name": "Deleg Mid", "parent_id": root["id"], "code": f"{prefix}-MID"},
    ).json()
    sub = client.post(
        "/api/categories",
        json={"name": "Deleg Sub", "parent_id": mid["id"], "code": f"{prefix}-SUB"},
    ).json()
    leaf = client.post(
        "/api/categories",
        json={"name": "Deleg Leaf", "parent_id": sub["id"], "code": f"{prefix}-LEAF"},
    ).json()
    other = client.post(
        "/api/categories",
        json={"name": "Deleg Other", "parent_id": root["id"], "code": f"{prefix}-OTHER"},
    ).json()
    client.put(
        f"/api/categories/{mid['id']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": DELEG_ADMIN}]},
    )
    return {
        "root": root["id"], "mid": mid["id"], "sub": sub["id"],
        "leaf": leaf["id"], "other": other["id"],
    }


def test_delegated_create_child_inside_subtree(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG1")
    act_as(DELEG_ADMIN)
    resp = client.post(
        "/api/categories", json={"name": "New under sub", "parent_id": tree["sub"]}
    )
    assert resp.status_code == 201
    assert resp.json()["level"] == 4  # sub(L3)의 자식


def test_delegated_create_outside_subtree_403(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG2")
    act_as(DELEG_ADMIN)
    resp = client.post(
        "/api/categories", json={"name": "Sneaky", "parent_id": tree["other"]}
    )
    assert resp.status_code == 403
    assert "outside your delegated subtree" in resp.json()["detail"]


def test_delegated_root_create_sysadmin_only(client: TestClient, enforce: None) -> None:
    _seed_deleg_tree(client, "DG3")
    act_as(DELEG_ADMIN)
    assert client.post("/api/categories", json={"name": "New root"}).status_code == 403
    act_as(STRANGER_SYSADMIN)
    assert client.post("/api/categories", json={"name": "New root ok"}).status_code == 201


def test_delegated_rename_own_seed_allowed(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG4")
    act_as(DELEG_ADMIN)
    resp = client.patch(f"/api/categories/{tree['mid']}", json={"name": "Mid Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Mid Renamed"


def test_delegated_move_seed_forbidden(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG5")
    act_as(DELEG_ADMIN)
    resp = client.patch(f"/api/categories/{tree['mid']}", json={"parent_id": tree["other"]})
    assert resp.status_code == 403


def test_delegated_move_outside_target_parent_403(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG6")
    act_as(DELEG_ADMIN)
    resp = client.patch(f"/api/categories/{tree['sub']}", json={"parent_id": tree["other"]})
    assert resp.status_code == 403
    assert "outside your delegated subtree" in resp.json()["detail"]


def test_delegated_delete_seed_forbidden_child_ok(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG7")
    act_as(DELEG_ADMIN)
    assert client.delete(f"/api/categories/{tree['mid']}").status_code == 403
    assert client.delete(f"/api/categories/{tree['leaf']}").status_code == 204


def test_delegated_perms_lower_level_only(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG8")
    act_as(DELEG_ADMIN)
    ok = client.put(
        f"/api/categories/{tree['sub']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": "someone"}]},
    )
    assert ok.status_code == 200
    same_level = client.put(
        f"/api/categories/{tree['mid']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": "someone"}]},
    )
    assert same_level.status_code == 403
    assert "can only manage lower-level categories" in same_level.json()["detail"]


def test_delegated_perms_get_scope(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG9")
    act_as(DELEG_ADMIN)
    assert client.get(f"/api/categories/{tree['sub']}/permissions").status_code == 200
    assert client.get(f"/api/categories/{tree['other']}/permissions").status_code == 403


def _seed_deleg_tree_l5(client: TestClient, prefix: str) -> dict[str, int]:
    """L1(root) > L2(mid) > L3(sub) > L4(leaf) > L5(bottom) — L5-only 가드 검증용(final review
    Finding 1). mid에 DELEG_ADMIN 권한 부여(서브트리에 L5 포함 시 기존 동작 회귀 가드),
    bottom에 별도 L5-only 관리자 권한 부여."""
    act_as(STRANGER_SYSADMIN)
    tree = _seed_deleg_tree(client, prefix)
    bottom = client.post(
        "/api/categories",
        json={"name": "Deleg Bottom", "parent_id": tree["leaf"], "code": f"{prefix}-BOTTOM"},
    ).json()
    assert bottom["level"] == 5
    client.put(
        f"/api/categories/{bottom['id']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": DELEG_L5_ADMIN}]},
    )
    tree["bottom"] = bottom["id"]
    return tree


DELEG_L5_ADMIN = "deleg.l5only"  # seed 전체가 L5인 관리자 — 구조 변경(개명·정렬·이동) 차단 대상


def test_delegated_l5_only_rename_forbidden(client: TestClient, enforce: None) -> None:
    """L5-only 관리자는 자기 카테고리 개명도 403 — L5는 캔버스 배정만 가능, 구조는 불가(spec §7)."""
    tree = _seed_deleg_tree_l5(client, "DG11")
    act_as(DELEG_L5_ADMIN)
    resp = client.patch(f"/api/categories/{tree['bottom']}", json={"name": "Sneaky Rename"})
    assert resp.status_code == 403
    assert "L5 admins cannot modify category structure" in resp.json()["detail"]


def test_delegated_l2_with_l5_subtree_rename_still_allowed(client: TestClient, enforce: None) -> None:
    """회귀 가드: 관리자 seed에 L1~L4가 섞여 있으면(서브트리에 L5가 있어도) 구조 변경은 기존대로 허용."""
    tree = _seed_deleg_tree_l5(client, "DG12")
    act_as(DELEG_ADMIN)
    resp = client.patch(f"/api/categories/{tree['mid']}", json={"name": "Mid Renamed Again"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Mid Renamed Again"


def test_nonadmin_still_403_everywhere(client: TestClient, enforce: None) -> None:
    tree = _seed_deleg_tree(client, "DG10")
    act_as(DELEG_STRANGER)
    assert client.post(
        "/api/categories", json={"name": "no", "parent_id": tree["mid"]}
    ).status_code == 403
    assert client.patch(f"/api/categories/{tree['mid']}", json={"name": "no"}).status_code == 403
    assert client.delete(f"/api/categories/{tree['leaf']}").status_code == 403
    assert client.get(f"/api/categories/{tree['mid']}/permissions").status_code == 403
    assert client.put(
        f"/api/categories/{tree['mid']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": "x"}]},
    ).status_code == 403


def test_permissions_map_scoped_by_role(client: TestClient, enforce: None) -> None:
    """전 카테고리 권한자 일괄 조회 — sysadmin=전체, 위임 관리자=자기 스코프 내 행만, 일반 403."""
    tree = _seed_deleg_tree(client, "PMAP")
    act_as(STRANGER_SYSADMIN)
    # 스코프 밖(other)에도 행을 심어 필터링을 구분 가능하게
    client.put(
        f"/api/categories/{tree['other']}/permissions",
        json={"permissions": [{"principal_type": "user", "principal_id": "pmap.outside"}]},
    )
    all_rows = client.get("/api/categories/permissions-map").json()["rows"]
    cat_ids = {r["category_id"] for r in all_rows}
    assert tree["mid"] in cat_ids and tree["other"] in cat_ids

    act_as(DELEG_ADMIN)
    scoped = client.get("/api/categories/permissions-map").json()["rows"]
    scoped_ids = {r["category_id"] for r in scoped}
    assert tree["mid"] in scoped_ids
    assert tree["other"] not in scoped_ids  # 위임 서브트리 밖 행은 미노출

    act_as("pmap.nobody")
    assert client.get("/api/categories/permissions-map").status_code == 403
