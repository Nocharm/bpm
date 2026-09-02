"""Map CRUD endpoint tests."""

import asyncio
from typing import Iterator
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import SessionLocal
from app.models import MapVersion, Node, ProcessMap
from app.settings import settings


def test_create_map_returns_default_version(client: TestClient) -> None:
    response = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "구매 프로세스"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "구매 프로세스"
    assert len(body["versions"]) == 1
    assert body["versions"][0]["label"] == "As-Is"


def test_create_map_seeds_start_and_end_nodes(client: TestClient) -> None:
    """새 맵의 초기 버전은 Start·End 노드를 자동 생성한다(엣지 없음)."""
    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": "자동 시드 맵"}
    ).json()
    version_id = created["versions"][0]["id"]

    graph = client.get(f"/api/versions/{version_id}/graph").json()
    types = sorted(n["node_type"] for n in graph["nodes"])
    assert types == ["end", "start"]
    start = next(n for n in graph["nodes"] if n["node_type"] == "start")
    end = next(n for n in graph["nodes"] if n["node_type"] == "end")
    assert start["title"] == "Start"
    assert end["title"] == "End"
    assert end["is_primary_end"] is True
    assert graph["edges"] == []


def test_create_map_defaults_private(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "default vis map"}).json()
    assert created["visibility"] == "private"


def test_create_map_honors_public_visibility(client: TestClient) -> None:
    """생성 시 public 선택이 반영돼야 함 (핫픽스: 항상 private로 생성되던 버그)."""
    created = client.post(
        "/api/maps",
        json={
            "owning_department": "Owning Anchor Division",
            "name": "public at create",
            "visibility": "public",
        },
    ).json()
    assert created["visibility"] == "public"


def test_get_map_returns_created_map(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "발주"}).json()

    response = client.get(f"/api/maps/{created['id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "발주"


def test_get_missing_map_returns_404(client: TestClient) -> None:
    response = client.get("/api/maps/999999")

    assert response.status_code == 404


def test_create_map_rejects_blank_name(client: TestClient) -> None:
    response = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": ""})

    assert response.status_code == 422


def test_create_map_rejects_duplicate_name(client: TestClient) -> None:
    client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "중복맵A"})
    response = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "중복맵A"})
    assert response.status_code == 409


def test_update_map_rejects_duplicate_name(client: TestClient) -> None:
    client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "기존맵A"})
    other = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "다른맵A"}).json()
    # 다른 맵 이름으로 변경 → 409, 자기 자신 이름 유지는 허용
    assert client.patch(f"/api/maps/{other['id']}", json={"name": "기존맵A"}).status_code == 409
    assert client.patch(f"/api/maps/{other['id']}", json={"name": "다른맵A"}).status_code == 200


def test_list_maps_includes_created(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "검수"}).json()

    response = client.get("/api/maps")

    assert response.status_code == 200
    assert any(m["id"] == created["id"] for m in response.json())


def test_list_maps_includes_latest_version_status(client: TestClient) -> None:
    """목록은 최신 버전 상태를 동봉 — 신규 맵은 기본 As-Is 버전이라 'draft'."""
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "상태확인"}).json()

    row = next(m for m in client.get("/api/maps").json() if m["id"] == created["id"])

    assert row["latest_version_status"] == "draft"


def test_list_maps_includes_card_metrics(client: TestClient) -> None:
    """목록은 카드 집계(전체 버전 수·라이브 노드 수·소유자명)를 동봉 (H5b)."""
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "카드집계"}).json()
    vid = created["versions"][0]["id"]
    # 노드 2개 저장 — 라이브(published) 없으면 최신 버전 기준 폴백
    client.post(f"/api/versions/{vid}/checkout", json={})
    save = client.put(
        f"/api/versions/{vid}/graph",
        json={
            "nodes": [
                {"id": "s", "title": "Start", "node_type": "start"},
                {"id": "a", "title": "A"},
            ],
            "edges": [],
        },
    )
    assert save.status_code == 200, save.text

    row = next(m for m in client.get("/api/maps").json() if m["id"] == created["id"])
    assert row["version_count"] == 1
    assert row["node_count"] == 2
    assert "member_count" in row
    assert "owner_name" in row


def test_get_map_detail_includes_owner_name(client: TestClient) -> None:
    """상세 응답도 소유자 직원명을 동봉 — PNG 정보 카드 소스. conftest가 테스트 유저를 name=login_id로 시드."""
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "상세오너"}).json()

    detail = client.get(f"/api/maps/{created['id']}").json()

    assert detail["owner_name"] == detail["created_by"]


def test_owner_display_prefers_owner_id_over_created_by(client: TestClient) -> None:
    """오너 표기는 owner_id 기준 — created_by(생성자)와 갈라진 맵(컨설턴트 임포트)의 카드/상세 간극 방지.

    임포트 맵은 created_by=임포터·owner_id=실오너 — 표기가 created_by를 보면 카드·인스펙터에
    임포터가 노출된다 (2026-09-02 적발).
    """
    import asyncio

    from app.db import SessionLocal
    from app.models import Employee, ProcessMap

    created = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": "오너표기 간극"}
    ).json()

    async def _assign_owner() -> None:
        async with SessionLocal() as session:
            # active=False — 공지 브로드캐스트 수신자 단언 오염 방지 (conftest owning.anchor와 동일)
            if await session.get(Employee, "real.owner") is None:
                session.add(Employee(login_id="real.owner", name="Real Owner", source="local", active=False))
            m = await session.get(ProcessMap, created["id"])
            m.owner_id = "real.owner"
            await session.commit()

    asyncio.run(_assign_owner())

    row = next(m for m in client.get("/api/maps").json() if m["id"] == created["id"])
    detail = client.get(f"/api/maps/{created['id']}").json()

    assert row["owner_id"] == "real.owner" and row["owner_name"] == "Real Owner"
    assert detail["owner_id"] == "real.owner" and detail["owner_name"] == "Real Owner"


def test_update_map_changes_name(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "old"}).json()

    response = client.patch(f"/api/maps/{created['id']}", json={"name": "new"})

    assert response.status_code == 200
    assert response.json()["name"] == "new"


def test_delete_map_then_get_404(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "to delete"}).json()

    delete_response = client.delete(f"/api/maps/{created['id']}")
    get_response = client.get(f"/api/maps/{created['id']}")

    assert delete_response.status_code == 204
    assert get_response.status_code == 404


def test_delete_is_soft_and_restorable(client: TestClient) -> None:
    """삭제는 소프트삭제 — 목록/조회 제외, 휴지통에 노출, 복구하면 되살아남 (DL)."""
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "soft delete map"}).json()
    mid = created["id"]
    assert client.delete(f"/api/maps/{mid}").status_code == 204
    # 일반 조회·목록에서 제외
    assert client.get(f"/api/maps/{mid}").status_code == 404
    assert all(m["id"] != mid for m in client.get("/api/maps").json())
    # 휴지통(삭제 예정)엔 노출되고 복구 가능
    assert any(m["id"] == mid for m in client.get("/api/maps/deleted/list").json())
    assert client.post(f"/api/maps/{mid}/restore").status_code == 200
    assert client.get(f"/api/maps/{mid}").status_code == 200


def test_get_map_includes_my_role(client: TestClient) -> None:
    # 서버가 호출자의 유효 역할을 노출 — 프론트 게이팅 단일 소스 (auth OFF → sysadmin owner)
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "with role"}).json()

    body = client.get(f"/api/maps/{created['id']}").json()

    assert "my_role" in body
    assert body["my_role"] == "owner"


def test_list_maps_includes_my_role(client: TestClient) -> None:
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division", "name": "list role"}).json()

    body = client.get("/api/maps").json()

    item = next(m for m in body if m["id"] == created["id"])
    assert item["my_role"] == "owner"


def test_me_includes_is_sysadmin(client: TestClient) -> None:
    # /api/me 가 is_sysadmin 노출 — sysadmin-only UI 게이팅 (auth OFF 기본 → True)
    body = client.get("/api/me").json()

    assert "is_sysadmin" in body
    assert body["is_sysadmin"] is True


def test_me_includes_csv_manual_url(client: TestClient) -> None:
    # /api/me 가 CSV 임포트 매뉴얼 주소 노출 — 비면 프론트가 버튼을 숨긴다
    body = client.get("/api/me").json()

    assert "csv_manual_url" in body
    assert body["csv_manual_url"] == ""


def test_create_word_map_stores_catalog(client: TestClient) -> None:
    """Word 맵 생성 시 mode·doc_name·doc_sections이 응답에 그대로 실린다 (design 2026-07-18)."""
    payload = {
        "name": "SOP Flow",
        "owning_department": "Owning Anchor Division",
        "mode": "word",
        "doc_name": "sop.docx",
        "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
    }
    r = client.post("/api/maps", json=payload)
    assert r.status_code == 201
    body = r.json()
    assert body["mode"] == "word"
    assert body["doc_name"] == "sop.docx"
    assert body["doc_sections"][0]["anchor"] == "_Toc1"


def test_create_map_defaults_mode_normal(client: TestClient) -> None:
    """mode를 지정하지 않으면 기존 일반 맵과 동일하게 normal·빈 카탈로그로 남는다."""
    body = client.post(
        "/api/maps", json={"owning_department": "Owning Anchor Division", "name": "일반 맵"}
    ).json()
    assert body["mode"] == "normal"
    assert body["doc_name"] == ""
    assert body["doc_sections"] == []


def test_copy_inherits_word_mode_and_catalog(client: TestClient) -> None:
    """copy는 원본 Word 맵의 mode·doc_name·doc_sections도 상속한다 (design 2026-07-18)."""
    name = f"word-src-{uuid4().hex[:8]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name,
                visibility="public",
                mode="word",
                doc_name="sop.docx",
                doc_sections=[{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
            )
            # published — 일반 복사는 게시 이력 1회 이상 필요 (copy workflow 재편)
            m.versions.append(MapVersion(label="As-Is", status="published"))
            session.add(m)
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(f"/api/maps/{map_id}/copy", json={})
    assert res.status_code == 201
    body = res.json()
    assert body["mode"] == "word"
    assert body["doc_name"] == "sop.docx"
    assert body["doc_sections"][0]["anchor"] == "_Toc1"


def test_reimport_replaces_catalog(client: TestClient) -> None:
    """PUT /word-doc는 맵의 doc_name·doc_sections을 통째로 교체한다 (재임포트, design 2026-07-18)."""
    created = client.post(
        "/api/maps",
        json={
            "name": "reimport target",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "v1.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "Old", "number": "1", "level": 1}],
        },
    ).json()
    map_id = created["id"]
    r = client.put(
        f"/api/maps/{map_id}/word-doc",
        json={
            "doc_name": "v2.docx",
            "sections": [{"anchor": "_Toc9", "title": "New", "number": "3", "level": 1}],
        },
    )
    assert r.status_code == 200
    detail = client.get(f"/api/maps/{map_id}")
    assert detail.json()["doc_name"] == "v2.docx"
    assert detail.json()["doc_sections"] == [
        {"anchor": "_Toc9", "title": "New", "number": "3", "level": 1, "language": ""}
    ]


def test_reimport_stamps_imported_at(client: TestClient) -> None:
    """재임포트 성공 시 doc_imported_at이 찍힌다 (design 2026-07-24 §5)."""
    created = client.post(
        "/api/maps",
        json={
            "name": f"stamp-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "v1.docx",
            "doc_sections": [],
        },
    ).json()
    assert created["doc_imported_at"] is None
    r = client.put(
        f"/api/maps/{created['id']}/word-doc",
        json={"doc_name": "v2.docx", "sections": []},
    )
    assert r.status_code == 200
    assert r.json()["doc_imported_at"] is not None


def test_mark_generated_stamps_timestamp(client: TestClient) -> None:
    """완결 문서 생성 기록 — 서버는 doc_generated_at만 스탬프 (design 2026-07-24 §5)."""
    created = client.post(
        "/api/maps",
        json={
            "name": f"gen-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
        },
    ).json()
    r = client.post(f"/api/maps/{created['id']}/word-doc/generated")
    assert r.status_code == 200
    assert r.json()["doc_generated_at"] is not None

    missing = client.post("/api/maps/999999/word-doc/generated")
    assert missing.status_code in (403, 404)


def test_copy_convert_to_normal_promotes_sections(client: TestClient) -> None:
    """승격 복사 — mode/doc 소거, 섹션 노드는 process 변환(앵커 소거·url 유지) (design 2026-07-24 §6)."""
    name = f"word-promote-{uuid4().hex[:8]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name,
                visibility="public",
                mode="word",
                doc_name="sop.docx",
                doc_sections=[{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
            )
            v = MapVersion(label="As-Is", status="approved")
            m.versions.append(v)
            session.add(m)
            await session.flush()
            session.add(
                Node(
                    id="sec-1",
                    version_id=v.id,
                    title="1 재고",
                    node_type="section",
                    section_anchor="_Toc1",
                    url="http://docs.example/sop",
                    url_label="SOP",
                )
            )
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(
        f"/api/maps/{map_id}/copy",
        json={"convert_to_normal": True, "owning_department": "Owning Anchor Division"},
    )
    assert res.status_code == 201
    body = res.json()
    assert body["mode"] == "normal"
    assert body["doc_name"] == ""
    assert body["doc_sections"] == []
    assert body["owning_department"] == "Owning Anchor Division"
    graph = client.get(f"/api/versions/{body['versions'][0]['id']}/graph").json()
    node = next(n for n in graph["nodes"] if n["title"] == "1 재고")
    assert node["node_type"] == "process"
    assert node["section_anchor"] == ""
    assert node["url"] == "http://docs.example/sop"


def test_copy_rejects_unknown_owning_department(client: TestClient) -> None:
    """복사 시 owning_department override도 create_map과 동일하게 실제 조직 경로만 허용 (422)."""
    name = f"word-promote-badd-{uuid4().hex[:8]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(
                name=name,
                visibility="public",
                mode="word",
                doc_name="sop.docx",
                doc_sections=[{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
            )
            v = MapVersion(label="As-Is", status="approved")
            m.versions.append(v)
            session.add(m)
            await session.flush()
            await session.commit()
            return m.id

    map_id = asyncio.run(_seed())
    res = client.post(
        f"/api/maps/{map_id}/copy",
        json={"convert_to_normal": True, "owning_department": "No Such Division"},
    )
    assert res.status_code == 422


def test_copy_survives_null_doc_sections(client: TestClient) -> None:
    """운영 DB pre-ALTER 행(doc_sections NULL) 복사 회귀 — list(None) TypeError로 500 나던 버그.

    doc_sections DDL엔 DEFAULT가 없어(db.py _ADDED_COLUMNS) 컬럼 추가 전 행은 NULL로 남는다.
    """
    name = f"null-docsec-{uuid4().hex[:8]}"

    async def _seed() -> int:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, visibility="public")
            # published — 일반 복사는 게시 이력 1회 이상 필요 (copy workflow 재편)
            m.versions.append(MapVersion(label="As-Is", status="published"))
            session.add(m)
            await session.commit()
            map_id = m.id
        # 서버 자동 ALTER 재현 — 컬럼을 nullable로 재추가해 대상 행만 NULL로 만든다
        async with SessionLocal() as session:
            rows = (
                await session.execute(text("SELECT id, doc_sections FROM process_maps"))
            ).all()
            await session.execute(text("ALTER TABLE process_maps DROP COLUMN doc_sections"))
            await session.execute(text("ALTER TABLE process_maps ADD COLUMN doc_sections JSON"))
            for rid, val in rows:
                if rid != map_id:
                    await session.execute(
                        text("UPDATE process_maps SET doc_sections = :v WHERE id = :i"),
                        {"v": val, "i": rid},
                    )
            await session.commit()
        return map_id

    map_id = asyncio.run(_seed())
    res = client.post(f"/api/maps/{map_id}/copy", json={})
    assert res.status_code == 201
    assert res.json()["doc_sections"] == []


def _seed_two_version_map(name: str) -> tuple[int, int, int]:
    """published(PubNode) + draft(DraftNode) 2버전 맵 시드 → (map_id, pub_id, draft_id)."""

    async def _seed() -> tuple[int, int, int]:
        async with SessionLocal() as session:
            m = ProcessMap(name=name, visibility="public")
            pub = MapVersion(label="As-Is", status="published", version_number=1)
            draft = MapVersion(label="To-Be", status="draft")
            m.versions.append(pub)
            m.versions.append(draft)
            session.add(m)
            await session.flush()
            session.add(Node(id=f"{name}-p", version_id=pub.id, title="PubNode", node_type="process"))
            session.add(Node(id=f"{name}-d", version_id=draft.id, title="DraftNode", node_type="process"))
            await session.commit()
            return m.id, pub.id, draft.id

    return asyncio.run(_seed())


def test_copy_with_version_id_copies_that_version(client: TestClient) -> None:
    """복사 모달 버전 선택 — version_id 지정 시 승인 여부와 무관하게 그 버전 그래프를 복제한다."""
    map_id, _pub_id, draft_id = _seed_two_version_map(f"vsel-{uuid4().hex[:8]}")
    res = client.post(f"/api/maps/{map_id}/copy", json={"version_id": draft_id})
    assert res.status_code == 201
    body = res.json()
    graph = client.get(f"/api/versions/{body['versions'][0]['id']}/graph").json()
    assert [n["title"] for n in graph["nodes"]] == ["DraftNode"]


def test_copy_defaults_to_latest_approved(client: TestClient) -> None:
    """version_id 미지정이면 기존 동작 유지 — 최신 승인본(published) 그래프를 복제한다."""
    map_id, _pub_id, _draft_id = _seed_two_version_map(f"vdef-{uuid4().hex[:8]}")
    res = client.post(f"/api/maps/{map_id}/copy", json={})
    assert res.status_code == 201
    graph = client.get(f"/api/versions/{res.json()['versions'][0]['id']}/graph").json()
    assert [n["title"] for n in graph["nodes"]] == ["PubNode"]


def test_copy_rejects_foreign_version_id(client: TestClient) -> None:
    """다른 맵의 version_id는 404 — 맵 소속 검증."""
    map_id, _pub, _draft = _seed_two_version_map(f"vown-{uuid4().hex[:8]}")
    _other_map, other_pub, _other_draft = _seed_two_version_map(f"vown2-{uuid4().hex[:8]}")
    res = client.post(f"/api/maps/{map_id}/copy", json={"version_id": other_pub})
    assert res.status_code == 404


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    """auth OFF + enforce ON + sysadmin=admin.kim — 휴지통 즉시삭제 게이트 검증용."""
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_purge_map_sysadmin_only(client: TestClient, sysadmin_enforced: None) -> None:
    """휴지통 즉시 영구삭제 — sysadmin 전용(403), 휴지통 밖이면 409, 성공 시 목록에서 소거."""
    admin = {"X-Dev-User": "admin.kim"}
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"purge-{uuid4().hex[:8]}"},
        headers=admin,
    ).json()
    map_id = created["id"]

    # 휴지통에 없으면 409
    assert client.delete(f"/api/maps/{map_id}/permanent", headers=admin).status_code == 409

    assert client.delete(f"/api/maps/{map_id}", headers=admin).status_code == 204
    # 비-sysadmin은 403
    res = client.delete(f"/api/maps/{map_id}/permanent", headers={"X-Dev-User": "user.lee"})
    assert res.status_code == 403

    assert client.delete(f"/api/maps/{map_id}/permanent", headers=admin).status_code == 204
    deleted_ids = [m["id"] for m in client.get("/api/maps/deleted/list", headers=admin).json()]
    assert map_id not in deleted_ids
    assert client.delete(f"/api/maps/{map_id}/permanent", headers=admin).status_code == 404
