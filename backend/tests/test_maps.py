"""Map CRUD endpoint tests."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.models import MapVersion, ProcessMap


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
            m.versions.append(MapVersion(label="As-Is", status="approved"))
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
