"""Framework L5 연계 캔버스 — 모델·권한·linkage-map·검증·확정·가드 (design 2026-08-28)."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import app.auth as auth_mod
from app.main import app
from app.settings import settings

SYSADMIN = "fwc.sysadmin"


@pytest.fixture
def enforce(client: TestClient) -> Iterator[None]:
    """auth ON + sysadmin 1명 — 기본 스위트는 auth OFF라 전원 sysadmin이라 권한 분기가 안 걸린다."""
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


def test_models_roundtrip(client: TestClient) -> None:
    """신설 테이블/컬럼이 create_all·자동 ALTER로 존재하고 ORM 왕복이 된다."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import CategoryPermission, MapVersion, ProcessCategory

    async def _run() -> None:
        async with SessionLocal() as session:
            cat = ProcessCategory(code="FWC-M1", name="모델검증", level=1, sort_order=0)
            session.add(cat)
            await session.flush()
            session.add(
                CategoryPermission(
                    category_id=cat.id, principal_type="user",
                    principal_id="fwc.admin1", granted_by=SYSADMIN,
                )
            )
            cat.linkage_map_id = None  # 컬럼 존재 확인
            await session.commit()
            row = await session.scalar(
                select(CategoryPermission).where(CategoryPermission.category_id == cat.id)
            )
            assert row is not None and row.principal_id == "fwc.admin1"
            # MapVersion fw 컬럼 존재 — 인스턴스 생성으로 확인
            assert MapVersion(map_id=1, label="x", fw_major=1, fw_minor=0).fw_major == 1

    asyncio.run(_run())


def _seed_category(client: TestClient, code: str, name: str, level: int = 1,
                   parent_id: int | None = None) -> int:
    """멱등 카테고리 시드 — 세션 스코프 공유 DB라 code 재사용."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == code))
            if row is None:
                row = ProcessCategory(code=code, name=name, level=level,
                                      parent_id=parent_id, sort_order=0)
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_category_permissions_put_replaces_and_gates(client: TestClient, enforce: None) -> None:
    cid = _seed_category(client, "FWC-P1", "권한검증")
    body = {"permissions": [{"principal_type": "user", "principal_id": "fwc.admin1"}]}
    act_as("fwc.pleb")
    assert client.put(f"/api/categories/{cid}/permissions", json=body).status_code == 403
    act_as(SYSADMIN)
    res = client.put(f"/api/categories/{cid}/permissions", json=body)
    assert res.status_code == 200
    assert res.json()["permissions"] == body["permissions"]
    # replace 멱등 — 다른 목록으로 갈아끼우면 이전 행은 사라진다
    body2 = {"permissions": [{"principal_type": "group", "principal_id": "7"}]}
    assert client.put(f"/api/categories/{cid}/permissions", json=body2).status_code == 200
    got = client.get(f"/api/categories/{cid}/permissions").json()["permissions"]
    assert got == body2["permissions"]
    assert client.get("/api/categories/999999/permissions").status_code == 404


def _seed_canvas_map(client: TestClient, category_id: int, name: str) -> int:
    """mode=framework 캔버스 맵 + draft 버전 1개 + linkage 결착 — 권한/검증 테스트용 최소 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessCategory, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.name == name))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, owner_id=SYSADMIN,
                                 visibility="public", mode="framework")
                row.versions.append(MapVersion(label="Linkage"))
                session.add(row)
                await session.flush()
                cat = await session.get(ProcessCategory, category_id)
                cat.linkage_map_id = row.id
                await session.commit()
            return row.id

    return asyncio.run(_run())


def test_framework_role_derivation(client: TestClient, enforce: None) -> None:
    """권한자(자기/조상 체인)=editor, 비권한자=viewer, sysadmin=owner — map_permissions 무시."""
    import asyncio

    from app.db import SessionLocal
    from app.permissions.access import get_effective_role

    l1 = _seed_category(client, "FWC-R1", "역할L1")
    l5 = _seed_category(client, "FWC-R5", "역할L5", level=5, parent_id=l1)
    canvas_id = _seed_canvas_map(client, l5, "역할검증 연계")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l1}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.ancestor"}]})
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.direct"}]})

    async def _roles() -> tuple[str | None, str | None, str | None, str | None]:
        async with SessionLocal() as session:
            return (
                await get_effective_role(session, "fwc.direct", canvas_id),
                await get_effective_role(session, "fwc.ancestor", canvas_id),  # L1 권한자 → 상속
                await get_effective_role(session, "fwc.pleb", canvas_id),
                await get_effective_role(session, SYSADMIN, canvas_id),
            )

    direct, ancestor, pleb, sysadmin = asyncio.run(_roles())
    assert direct == "editor"
    assert ancestor == "editor"
    assert pleb == "viewer"
    assert sysadmin == "owner"


def _seed_l6_map(client: TestClient, category_id: int, name: str, code: str) -> int:
    """카테고리에 연결된 게시본 있는 L6 맵 멱등 시드."""
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap

    async def _run() -> int:
        async with SessionLocal() as session:
            row = await session.scalar(select(ProcessMap).where(ProcessMap.consultant_code == code))
            if row is None:
                row = ProcessMap(name=name, created_by=SYSADMIN, visibility="public",
                                 category_id=category_id, consultant_code=code)
                row.versions.append(MapVersion(label="As-Is", status="published", version_number=1))
                session.add(row)
                await session.commit()
                await session.refresh(row)
            return row.id

    return asyncio.run(_run())


def test_linkage_map_open_create_seed_and_reconcile(client: TestClient, enforce: None) -> None:
    l1 = _seed_category(client, "FWC-O1", "열기L1")
    l5 = _seed_category(client, "FWC-O5", "열기L5", level=5, parent_id=l1)
    m1 = _seed_l6_map(client, l5, "열기업무1", "FWC-OM1")
    m2 = _seed_l6_map(client, l5, "열기업무2", "FWC-OM2")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.opener"}]})

    # level!=5 → 422
    assert client.post(f"/api/categories/{l1}/linkage-map").status_code == 422
    # 캔버스 없음 + 비권한자 → 404
    act_as("fwc.pleb")
    assert client.post(f"/api/categories/{l5}/linkage-map").status_code == 404
    # 권한자 생성 — 소속 L6 2개가 subprocess 노드로 시드
    act_as("fwc.opener")
    created = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert created["added_count"] == 2 and created["missing_count"] == 0
    map_id = created["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["mode"] == "framework"
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    linked = {n["linked_map_id"] for n in graph["nodes"]}
    assert linked == {m1, m2}
    assert all(n["node_type"] == "subprocess" for n in graph["nodes"])
    # 멱등 재호출 — 추가 없음
    again = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert again["map_id"] == map_id and again["added_count"] == 0
    # 새 L6 유입 후 재열기 → 자동 보강 append
    _seed_l6_map(client, l5, "열기업무3", "FWC-OM3")
    assert client.post(f"/api/categories/{l5}/linkage-map").json()["added_count"] == 1
    # 뷰어 열람 — 보강 없이 missing_count만
    _seed_l6_map(client, l5, "열기업무4", "FWC-OM4")
    act_as("fwc.pleb")
    viewed = client.post(f"/api/categories/{l5}/linkage-map").json()
    assert viewed["added_count"] == 0 and viewed["missing_count"] == 1


def _checkout(client: TestClient, version_id: int) -> None:
    res = client.post(f"/api/versions/{version_id}/checkout", json={})
    assert res.status_code in (200, 201), res.text


def test_framework_graph_validation(client: TestClient, enforce: None) -> None:
    """캔버스 저장: subprocess-only 허용(start 없음 OK), 타 타입 유입은 422. 일반 맵은 start 강제 유지."""
    l5 = _seed_category(client, "FWC-V5", "검증L5", level=5)
    _seed_l6_map(client, l5, "검증업무1", "FWC-VM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.editor"}]})
    act_as("fwc.editor")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    node = graph["nodes"][0]
    # start 없이 subprocess 노드만 + 엣지 없이 저장 — 통과해야 한다
    payload = {"nodes": [node], "edges": [], "groups": []}
    assert client.put(f"/api/versions/{draft['id']}/graph", json=payload).status_code == 200, (
        client.put(f"/api/versions/{draft['id']}/graph", json=payload).text
    )
    # process 노드 유입 → 422
    bad = dict(node, id="fwcbadnode000000000000000000000001", node_type="process", linked_map_id=None)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, bad], "edges": [], "groups": []})
    assert res.status_code == 422
    assert "framework" in res.json()["detail"]


def test_framework_placeholder_roundtrip(client: TestClient, enforce: None) -> None:
    """플레이스홀더(linked 없음) 허용 + 출처 L5 저장·경로 주입·스냅샷 보존 (design §10.1 그릇)."""
    l1 = _seed_category(client, "FWC-PH1", "자리L1")
    l5 = _seed_category(client, "FWC-PH5", "자리L5", level=5, parent_id=l1)
    other_l5 = _seed_category(client, "FWC-PHX", "타L5", level=5, parent_id=l1)
    _seed_l6_map(client, l5, "자리업무1", "FWC-PHM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.ph"}]})
    act_as("fwc.ph")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    node = graph["nodes"][0]
    ph = dict(node, id="fwcphnode000000000000000000000001", title="미등록 자리",
              linked_map_id=None, placeholder_category_id=other_l5, width=216)
    # 미지 카테고리 → 422 (노드 FK 부재 — 앱 경계 검증)
    bad = dict(ph, id="fwcphnode000000000000000000000002", placeholder_category_id=99999999)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, bad], "edges": [], "groups": []})
    assert res.status_code == 422
    assert "placeholder_category_id" in res.json()["detail"]
    # 플레이스홀더 저장 허용 + 응답에 출처 경로 주입
    _put_graph(client, draft["id"], [node, ph])
    got = client.get(f"/api/versions/{draft['id']}/graph").json()
    saved = next(n for n in got["nodes"] if n["id"] == ph["id"])
    assert saved["linked_map_id"] is None
    assert saved["placeholder_category_id"] == other_l5
    assert saved["placeholder_category_path"] == "자리L1/타L5"
    assert saved["width"] == 216  # 표시 폭 왕복 (2026-08-30)
    # 확정 스냅샷 복제 보존 + 게이트 시그니처에 출처 포함(변경으로 판정)
    first = client.post(f"/api/maps/{map_id}/framework-confirm", json={})
    assert first.status_code == 200, first.text
    snap = client.get(f"/api/versions/{first.json()['version']['id']}/graph").json()
    cloned = next(n for n in snap["nodes"] if n["title"] == "미등록 자리")
    assert cloned["placeholder_category_id"] == other_l5
    assert cloned["width"] == 216  # 스냅샷 clone도 폭 보존
    # 무변경 재확정 → 409, 출처만 바꾸면 콘텐츠 변경으로 통과
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={}).status_code == 409
    third_l5 = _seed_category(client, "FWC-PHY", "타L5b", level=5, parent_id=l1)
    _put_graph(client, draft["id"], [node, dict(ph, placeholder_category_id=third_l5)])
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={}).status_code == 200


def _put_graph(client: TestClient, version_id: int, nodes: list, edges: list | None = None) -> None:
    res = client.put(f"/api/versions/{version_id}/graph",
                     json={"nodes": nodes, "edges": edges or [], "groups": []})
    assert res.status_code == 200, res.text


def _make_canvas(client: TestClient, code: str, name: str) -> tuple[int, int]:
    """L5+연결맵 생성 후 fwc.confirmer로 draft 체크아웃 — 확정 플로우 테스트 공유 셋업.

    카테고리 코드는 호출자가 고유하게 지정 — client 픽스처가 세션 스코프라 테스트 간 DB를 공유한다.
    반환값 (map_id, draft_id).
    """
    l5 = _seed_category(client, code, name, level=5)
    _seed_l6_map(client, l5, f"{name}업무1", f"{code}M1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.confirmer"}]})
    act_as("fwc.confirmer")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    return map_id, draft["id"]


def test_framework_confirm_versioning(client: TestClient, enforce: None) -> None:
    """확정 게이트(마이너=내용 변경 필수, 좌표만은 불가)·메이저 프룬(X.0·최종만 유지) (2026-08-28 개선)."""
    map_id, draft_id = _make_canvas(client, "FWC-C5", "확정L5")

    act_as("fwc.pleb")
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).status_code == 403
    act_as("fwc.confirmer")
    # 최초 확정 — 스냅샷이 없으므로 항상 허용
    v1 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert (v1["version"]["label"], v1["version"]["status"]) == ("v1.0", "confirmed")
    assert v1["pruned_labels"] == []
    # 무변경 재확정 → 409
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).status_code == 409
    # 좌표만 이동해도 409 — 노드 내 위치는 변경으로 안 친다
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    moved = [dict(n, pos_x=n["pos_x"] + 200) for n in graph["nodes"]]
    _put_graph(client, draft_id, moved, graph["edges"])
    assert client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).status_code == 409
    # 내용 변경(분기 노드 추가) → v1.1
    base = dict(graph["nodes"][0])
    decision = dict(base, id="fwcconfdec0000000000000000000001", node_type="decision",
                    linked_map_id=None, title="확정 분기", is_primary_end=False)
    _put_graph(client, draft_id, moved + [decision], graph["edges"])
    v2 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert v2["version"]["label"] == "v1.1"
    # 또 내용 변경(분기 이름) → v1.2
    decision2 = dict(decision, title="확정 분기 개정")
    _put_graph(client, draft_id, moved + [decision2], graph["edges"])
    v3 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    assert v3["version"]["label"] == "v1.2"
    # 메이저 승급 — 게이트 우회(무변경이어도 승급 가능), 직전 라인은 1.0·1.2만 남고 1.1 영구삭제
    v4 = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": True}).json()
    assert v4["version"]["label"] == "v2.0"
    assert v4["pruned_labels"] == ["v1.1"]
    detail = client.get(f"/api/maps/{map_id}").json()
    labels = [v["label"] for v in detail["versions"]]
    assert "v1.0" in labels and "v1.2" in labels and "v2.0" in labels
    assert "v1.1" not in labels
    statuses = [v["status"] for v in detail["versions"]]
    assert statuses.count("confirmed") == 3 and statuses.count("draft") == 1
    # 일반 맵에는 422
    act_as(SYSADMIN)
    normal = client.post("/api/maps", json={"name": "확정검증 일반맵",
                                            "owning_department": "Owning Anchor Division"}).json()
    assert client.post(f"/api/maps/{normal['id']}/framework-confirm",
                       json={"major": False}).status_code == 422


def test_confirm_snapshot_is_confirmed_without_version_number(client: TestClient, enforce: None) -> None:
    """확정 스냅샷은 confirmed 상태·confirmed 이벤트·게시 순번 없음 (spec 2026-09-02 §3)."""
    map_id, _draft_id = _make_canvas(client, "FWC-CS5", "확정상태L5")
    body = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()
    ver = body["version"]
    assert ver["status"] == "confirmed"
    assert ver.get("version_number") in (None, 0)
    detail = client.get(f"/api/maps/{map_id}").json()
    snap = next(v for v in detail["versions"] if v["id"] == ver["id"])
    assert any(e["event_type"] == "confirmed" for e in snap["events"])


def test_edge_gateway_roundtrip_and_clone(client: TestClient, enforce: None) -> None:
    """Edge.gateway가 graph PUT→GET 왕복·확정 clone에 보존된다 (spec §4 게이트 6 예외 재료)."""
    map_id, draft_id = _make_canvas(client, "FWC-GW5", "게이트웨이왕복")
    # _make_canvas는 L6 1개만 시드(노드 1개) — 엣지 구성에 노드 2개 필요, 2번째 L6 시드 후
    # linkage-map 재호출(멱등 보강)로 노드를 append한다. l5 id는 카테고리 코드로 멱등 조회.
    l5 = _seed_category(client, "FWC-GW5", "게이트웨이왕복")
    _seed_l6_map(client, l5, "게이트웨이왕복업무2", "FWC-GW5M2")
    client.post(f"/api/categories/{l5}/linkage-map")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    edges = graph["edges"]
    if not edges:
        n = graph["nodes"]
        edges = [{"id": "gwedge000000000000000000000000001", "source_node_id": n[0]["id"],
                  "target_node_id": n[1]["id"], "label": "", "gateway": "parallel"}]
    else:
        edges = [dict(edges[0], gateway="parallel")] + edges[1:]
    _put_graph(client, draft_id, graph["nodes"], edges)
    got = client.get(f"/api/versions/{draft_id}/graph").json()["edges"]
    assert any(e.get("gateway") == "parallel" for e in got)
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]
    snap = client.get(f"/api/versions/{ver['id']}/graph").json()["edges"]
    assert any(e.get("gateway") == "parallel" for e in snap)


def test_migrate_framework_confirmed_idempotent(client: TestClient, enforce: None) -> None:
    """구버전 published fw 스냅샷을 startup 훅이 confirmed로 이전, 재실행해도 무해 (spec 2026-09-02 §3)."""
    import asyncio

    from sqlalchemy import text

    from app.db import _migrate_framework_confirmed, engine

    map_id, _draft_id = _make_canvas(client, "FWC-MIG5", "이전L5")
    act_as("fwc.confirmer")
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]

    async def _run() -> tuple[str, str]:
        async with engine.begin() as conn:
            # 운영 DB 시뮬레이션 — Task 1 이전 코드가 남긴 published 상태로 되돌린다.
            await conn.execute(
                text("UPDATE map_versions SET status='published' WHERE id=:i"), {"i": ver["id"]}
            )
            await conn.execute(
                text(
                    "UPDATE version_events SET event_type='published' "
                    "WHERE version_id=:i AND event_type='confirmed'"
                ),
                {"i": ver["id"]},
            )
        async with engine.begin() as conn:
            await conn.run_sync(_migrate_framework_confirmed)
            await conn.run_sync(_migrate_framework_confirmed)  # 멱등 재실행
        async with engine.connect() as conn:
            status = (
                await conn.execute(text("SELECT status FROM map_versions WHERE id=:i"), {"i": ver["id"]})
            ).scalar()
            event_type = (
                await conn.execute(
                    text("SELECT event_type FROM version_events WHERE version_id=:i"), {"i": ver["id"]}
                )
            ).scalar()
            return status, event_type

    status, event_type = asyncio.run(_run())
    assert status == "confirmed"
    assert event_type == "confirmed"


def test_confirmed_snapshot_cannot_be_deleted(client: TestClient, enforce: None) -> None:
    """확정 스냅샷은 pending/published와 같은 삭제 보호를 받는다 (spec §3.1)."""
    map_id, _draft_id = _make_canvas(client, "FWC-DEL5", "삭제금지확정")
    act_as("fwc.confirmer")
    ver = client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False}).json()["version"]
    act_as(SYSADMIN)
    res = client.delete(f"/api/versions/{ver['id']}")
    assert res.status_code == 409


def test_confirmed_snapshot_shows_in_dashboard(client: TestClient, enforce: None) -> None:
    """대시보드 집계에서 confirmed 스냅샷 카운트를 포함한다 (spec §3.1)."""
    map_id, _draft_id = _make_canvas(client, "FWC-DASH5", "대시보드확정")
    act_as("fwc.confirmer")
    client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False})
    act_as(SYSADMIN)
    summary = client.get("/api/dashboard/summary").json()
    assert summary["version_status"]["confirmed"] >= 1


def test_framework_map_rejects_version_workflow(client: TestClient, enforce: None) -> None:
    """framework 캔버스는 일반 버전 워크플로 옆문 전건 422 (spec 2026-09-02 §6).

    실파손 시나리오였던 것: 확정 후 create-version이 빈 draft를 만들고 다음 확정이 그
    빈 draft를 복제, 게시 옆문은 confirmed 스냅샷 이력과 충돌. Task 1 이후 확정 직후의
    최신 버전은 confirmed(≠published)라 create는 원래 409도 뜰 수 있으나, 가드는 404
    체크 직후·다른 상태 게이트보다 먼저 걸려야 하므로 detail 문자열까지 단언한다.
    """
    detail_msg = "framework maps use the confirm workflow"
    map_id, draft_id = _make_canvas(client, "FWC-VW5", "버전워크플로차단")
    act_as("fwc.confirmer")
    client.post(f"/api/maps/{map_id}/framework-confirm", json={"major": False})

    res = client.post(f"/api/maps/{map_id}/versions", json={"label": "x"})
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    action_bodies: dict[str, dict | None] = {
        "submit": {},
        "approve": {},
        "reject": {"reason": "x"},  # RejectIn.reason 필수 — 유효 바디로 가드가 페이로드 검증보다 먼저 걸리는지 확인
        "publish": {},
        "republish": None,  # republish는 바디 없음
        "withdraw": {},
    }
    for action, body in action_bodies.items():
        res = (
            client.post(f"/api/versions/{draft_id}/{action}")
            if body is None
            else client.post(f"/api/versions/{draft_id}/{action}", json=body)
        )
        assert res.status_code == 422, f"{action}: {res.status_code} {res.text}"
        assert res.json()["detail"] == detail_msg, f"{action}: {res.json()}"

    res = client.patch(f"/api/versions/{draft_id}", json={"label": "hack"})
    assert res.status_code == 422 and res.json()["detail"] == detail_msg


def test_framework_canvas_allows_decision_and_end(client: TestClient, enforce: None) -> None:
    """분기·끝 노드 생성 허용(끝 규칙 적용), start/process는 계속 차단 (2026-08-28 개선)."""
    l5 = _seed_category(client, "FWC-D5", "분기L5", level=5)
    _seed_l6_map(client, l5, "분기업무1", "FWC-DM1")
    act_as(SYSADMIN)
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    node = graph["nodes"][0]
    decision = dict(node, id="fwcdecnode0000000000000000000001", node_type="decision",
                    linked_map_id=None, title="판정", is_primary_end=False)
    end = dict(node, id="fwcendnode0000000000000000000001", node_type="end",
               linked_map_id=None, title="완료", is_primary_end=False)
    _put_graph(client, draft["id"], [node, decision, end])
    saved = client.get(f"/api/versions/{draft['id']}/graph").json()
    end_saved = next(n for n in saved["nodes"] if n["node_type"] == "end")
    assert end_saved["is_primary_end"] is True  # 대표 끝 자동 지정
    # start 유입 → 422
    start = dict(node, id="fwcstartnode00000000000000000001", node_type="start",
                 linked_map_id=None, title="Start", is_primary_end=False)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, start], "edges": [], "groups": []})
    assert res.status_code == 422
    # process 유입 → 422
    proc = dict(node, id="fwcprocnode000000000000000000001", node_type="process",
                linked_map_id=None, title="일반", is_primary_end=False)
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": [node, proc], "edges": [], "groups": []})
    assert res.status_code == 422


def test_framework_contained_l6_cannot_be_removed(client: TestClient, enforce: None) -> None:
    """소속 L6 노드는 저장에서 제거 불가(422), 외부 L6는 추가·제거 자유 (2026-08-28 개선)."""
    l5 = _seed_category(client, "FWC-X5", "삭제금지L5", level=5)
    m1 = _seed_l6_map(client, l5, "삭제금지업무1", "FWC-XM1")
    m2 = _seed_l6_map(client, l5, "삭제금지업무2", "FWC-XM2")
    l5b = _seed_category(client, "FWC-X5B", "삭제금지외부L5", level=5)
    ext = _seed_l6_map(client, l5b, "삭제금지외부업무", "FWC-XME")
    act_as(SYSADMIN)
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    _checkout(client, draft["id"])
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    nodes = graph["nodes"]
    assert {n["linked_map_id"] for n in nodes} == {m1, m2}
    # 외부 L6 추가 → OK
    ext_node = dict(nodes[0], id="fwcextnode0000000000000000000001", linked_map_id=ext)
    _put_graph(client, draft["id"], nodes + [ext_node])
    # 소속 L6(m2) 제거 → 422
    without_m2 = [n for n in nodes if n["linked_map_id"] != m2] + [ext_node]
    res = client.put(f"/api/versions/{draft['id']}/graph",
                     json={"nodes": without_m2, "edges": [], "groups": []})
    assert res.status_code == 422
    assert "contained" in res.json()["detail"]
    # 외부 L6 제거 → OK
    _put_graph(client, draft["id"], nodes)


def test_framework_guards(client: TestClient, enforce: None) -> None:
    l5 = _seed_category(client, "FWC-G5", "가드L5", level=5)
    _seed_l6_map(client, l5, "가드업무1", "FWC-GM1")
    act_as(SYSADMIN)
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]
    # SP 지정 거부
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json={"department": "X"})
    assert res.status_code == 422
    # 복사 거부
    assert client.post(f"/api/maps/{map_id}/copy", json={"name": "가드 복사본"}).status_code == 422
    # 카테고리 개명 → 캔버스 이름 동기
    client.patch(f"/api/categories/{l5}", json={"name": "가드L5개명"})
    assert client.get(f"/api/maps/{map_id}").json()["name"].startswith("가드L5개명 연계")
    # 캔버스만 있는 카테고리 삭제 → 409 (detail에 linkage 명시)
    l5b = _seed_category(client, "FWC-G5B", "가드빈L5", level=5)
    client.post(f"/api/categories/{l5b}/linkage-map")
    res = client.delete(f"/api/categories/{l5b}")
    assert res.status_code == 409
    assert "linkage" in res.json()["detail"]


def test_surface_fields(client: TestClient, enforce: None) -> None:
    l1 = _seed_category(client, "FWC-S1", "표면L1")
    l5 = _seed_category(client, "FWC-S5", "표면L5", level=5, parent_id=l1)
    m1 = _seed_l6_map(client, l5, "표면업무1", "FWC-SM1")
    act_as(SYSADMIN)
    client.put(f"/api/categories/{l5}/permissions",
               json={"permissions": [{"principal_type": "user", "principal_id": "fwc.surfer"}]})
    act_as("fwc.surfer")
    map_id = client.post(f"/api/categories/{l5}/linkage-map").json()["map_id"]

    # 트리: L5 행에 linkage_map_id + can_edit_linkage(권한자 상속)
    nodes = client.get(f"/api/categories/nodes?parent_id={l1}").json()
    row = next(n for n in nodes if n["id"] == l5)
    assert row["linkage_map_id"] == map_id and row["can_edit_linkage"] is True
    act_as("fwc.pleb")
    row = next(n for n in client.get(f"/api/categories/nodes?parent_id={l1}").json()
               if n["id"] == l5)
    assert row["linkage_map_id"] == map_id and row["can_edit_linkage"] is False
    # chain에도 동일 필드
    chain = client.get(f"/api/categories/{l5}/chain").json()
    assert chain[-1]["linkage_map_id"] == map_id

    # MapOut: 캔버스에 linkage_category_id/path
    detail = client.get(f"/api/maps/{map_id}").json()
    assert detail["linkage_category_id"] == l5
    assert detail["linkage_category_path"] == "표면L1/표면L5"

    # SubprocessRefOut: 그래프 refs에 category_path
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    assert graph["subprocess_refs"][str(m1)]["category_path"] == "표면L1/표면L5"
    # 홈 L5 id — 외부 L6 색상 키 (2026-08-28 개선)
    assert graph["subprocess_refs"][str(m1)]["category_id"] == l5


def test_framework_map_rejects_permission_side_doors(client: TestClient, enforce: None) -> None:
    """승인자 지정(작성자 게이트 우회 경로)·협업자·개명요청·SP지정요청 전건 422 (spec §6).

    실위험이었던 것: approvers PUT은 created_by 기준이라 캔버스를 만든 카테고리 권한자가
    승인자를 심을 수 있었다. 협업자 POST/PATCH/DELETE는 써져도 role 판정이 무시하는
    사일런트 노옵이었고, sp-designation-requests는 영구 pending 좀비를 만들었다.
    """
    detail_msg = "framework maps use the confirm workflow"
    map_id, draft_id = _make_canvas(client, "FWC-SD5", "옆문차단")
    # _make_canvas 종료 시점 act_as는 fwc.confirmer(=created_by, category editor) — 각 옆문의
    # 기존 게이트를 모두 통과하는 신원이라 422가 순수하게 framework 가드에서 나온다.

    res = client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": ["fwc.confirmer"]})
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    res = client.post(
        f"/api/maps/{map_id}/permissions",
        json={"principal_type": "user", "principal_id": "fwc.pleb", "role": "editor"},
    )
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    # PATCH/DELETE는 기존 grant가 필요 — framework 맵은 permissions 자체가 무시되므로
    # 존재하지 않는 permission_id(0)로도 가드가 404보다 먼저 걸리는지 확인한다.
    res = client.patch(f"/api/maps/{map_id}/permissions/0", json={"role": "viewer"})
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    res = client.delete(f"/api/maps/{map_id}/permissions/0")
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    res = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": "hack"})
    assert res.status_code == 422 and res.json()["detail"] == detail_msg

    res = client.post(
        f"/api/maps/{map_id}/sp-designation-requests", json={"from_map_id": draft_id}
    )
    assert res.status_code == 422 and res.json()["detail"] == detail_msg


def _confirm_readiness(map_id: int, draft_id: int) -> list:
    """validate_confirm_readiness 직접 호출 — GET 엔드포인트 부재(Task 3 이전) 단위 테스트 경로.

    draft를 nodes/edges selectinload로 재조회해 검사기 전제(비지연로드)를 맞춘다.
    """
    import asyncio

    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from app.db import SessionLocal
    from app.models import MapVersion, ProcessMap
    from app.subprocess import validate_confirm_readiness

    async def _run() -> list:
        async with SessionLocal() as session:
            found_map = await session.get(ProcessMap, map_id)
            draft = await session.scalar(
                select(MapVersion)
                .options(selectinload(MapVersion.nodes), selectinload(MapVersion.edges))
                .where(MapVersion.id == draft_id)
            )
            return await validate_confirm_readiness(session, found_map, draft)

    return asyncio.run(_run())


def test_confirm_readiness_missing_l6(client: TestClient, enforce: None) -> None:
    """소속 L6가 캔버스에 미배치면 missing_l6 (linkage-map을 다시 열지 않아 보강이 안 걸린다)."""
    map_id, draft_id = _make_canvas(client, "FWC-GT-MISS", "게이트결측")
    l5 = _seed_category(client, "FWC-GT-MISS", "게이트결측", level=5)
    _seed_l6_map(client, l5, "게이트결측업무2", "FWC-GT-MISSM2")  # 캔버스엔 반영 안 함
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "missing_l6" in failures and failures["missing_l6"].count == 1


def test_confirm_readiness_placeholder(client: TestClient, enforce: None) -> None:
    """linked_map_id=None subprocess가 있으면 placeholder."""
    map_id, draft_id = _make_canvas(client, "FWC-GT-PH", "게이트자리")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    node = graph["nodes"][0]
    ph = dict(node, id="fwcgtphnode000000000000000000001", title="자리", linked_map_id=None)
    _put_graph(client, draft_id, [node, ph])
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "placeholder" in failures and failures["placeholder"].node_ids == [ph["id"]]


def test_confirm_readiness_stale_link(client: TestClient, enforce: None) -> None:
    """링크 대상 L6가 소프트삭제되면 stale_link."""
    import asyncio

    map_id, draft_id = _make_canvas(client, "FWC-GT-STALE", "게이트끊김")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    linked_id = graph["nodes"][0]["linked_map_id"]

    async def _soften() -> None:
        from app.clock import now as now_kst
        from app.db import SessionLocal
        from app.models import ProcessMap

        async with SessionLocal() as session:
            m = await session.get(ProcessMap, linked_id)
            m.deleted_at = now_kst()
            await session.commit()

    asyncio.run(_soften())
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "stale_link" in failures and failures["stale_link"].count == 1


def test_confirm_readiness_l6_unpublished(client: TestClient, enforce: None) -> None:
    """링크된 맵에 게시본이 없으면 l6_unpublished."""
    import asyncio

    map_id, draft_id = _make_canvas(client, "FWC-GT-UNPUB", "게이트미게시")

    async def _seed_unpublished() -> int:
        from app.db import SessionLocal
        from app.models import MapVersion, ProcessMap

        async with SessionLocal() as session:
            m = ProcessMap(name="미게시링크", created_by=SYSADMIN, visibility="public")
            m.versions.append(MapVersion(label="As-Is", status="draft"))
            session.add(m)
            await session.commit()
            await session.refresh(m)
            return m.id

    unpub_id = asyncio.run(_seed_unpublished())
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    node = graph["nodes"][0]
    linked_node = dict(node, id="fwcgtunpubnode00000000000000001", title="미게시링크",
                        linked_map_id=unpub_id)
    _put_graph(client, draft_id, [node, linked_node])
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "l6_unpublished" in failures
    assert failures["l6_unpublished"].node_ids == [linked_node["id"]]


def test_confirm_readiness_noexit_cycle(client: TestClient, enforce: None) -> None:
    """A→B→A 순환 + 밖으로 나가는 엣지가 없으면 noexit_cycle."""
    l5_code = "FWC-GT-CYC"
    map_id, draft_id = _make_canvas(client, l5_code, "게이트순환")
    l5 = _seed_category(client, l5_code, "게이트순환", level=5)
    _seed_l6_map(client, l5, "게이트순환업무2", f"{l5_code}M2")
    client.post(f"/api/categories/{l5}/linkage-map")  # 2번째 L6 보강(fwc.confirmer=권한자·체크아웃 보유자)
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    nodes = graph["nodes"]
    assert len(nodes) == 2
    a, b = nodes
    edges = [
        {"id": "fwcgtcycedge000000000000000001", "source_node_id": a["id"], "target_node_id": b["id"]},
        {"id": "fwcgtcycedge000000000000000002", "source_node_id": b["id"], "target_node_id": a["id"]},
    ]
    _put_graph(client, draft_id, nodes, edges)
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "noexit_cycle" in failures and failures["noexit_cycle"].count == 2


def test_confirm_readiness_plain_fanout(client: TestClient, enforce: None) -> None:
    """subprocess에서 엣지 2개가 직접 나가고 전부 병행(gateway=parallel)이 아니면 plain_fanout."""
    map_id, draft_id = _make_canvas(client, "FWC-GT-FAN", "게이트팬아웃")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    node = graph["nodes"][0]
    e1 = dict(node, id="fwcgtfanend1000000000000000001", node_type="end",
              linked_map_id=None, title="팬아웃끝1", is_primary_end=False)
    e2 = dict(node, id="fwcgtfanend2000000000000000001", node_type="end",
              linked_map_id=None, title="팬아웃끝2", is_primary_end=False)
    edges = [
        {"id": "fwcgtfanedge000000000000000001", "source_node_id": node["id"], "target_node_id": e1["id"]},
        {"id": "fwcgtfanedge000000000000000002", "source_node_id": node["id"], "target_node_id": e2["id"]},
    ]
    _put_graph(client, draft_id, [node, e1, e2], edges)
    failures = {f.code: f for f in _confirm_readiness(map_id, draft_id)}
    assert "plain_fanout" in failures and failures["plain_fanout"].node_ids == [node["id"]]


def test_confirm_readiness_parallel_fanout_ok(client: TestClient, enforce: None) -> None:
    """두 엣지 모두 gateway=parallel이면 plain_fanout 예외 — 게이트 전건 통과([])."""
    map_id, draft_id = _make_canvas(client, "FWC-GT-PAR", "게이트병행")
    graph = client.get(f"/api/versions/{draft_id}/graph").json()
    node = graph["nodes"][0]
    e1 = dict(node, id="fwcgtparend1000000000000000001", node_type="end",
              linked_map_id=None, title="병행끝1", is_primary_end=False)
    e2 = dict(node, id="fwcgtparend2000000000000000001", node_type="end",
              linked_map_id=None, title="병행끝2", is_primary_end=False)
    edges = [
        {"id": "fwcgtparedge000000000000000001", "source_node_id": node["id"],
         "target_node_id": e1["id"], "gateway": "parallel"},
        {"id": "fwcgtparedge000000000000000002", "source_node_id": node["id"],
         "target_node_id": e2["id"], "gateway": "parallel"},
    ]
    _put_graph(client, draft_id, [node, e1, e2], edges)
    assert _confirm_readiness(map_id, draft_id) == []


def test_confirm_readiness_clean_passes(client: TestClient, enforce: None) -> None:
    """정상 캔버스(링크 완전·게시·순환 없음)는 게이트 전건 통과 → []."""
    map_id, draft_id = _make_canvas(client, "FWC-GT-CLEAN", "게이트클린")
    assert _confirm_readiness(map_id, draft_id) == []
