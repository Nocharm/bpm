"""Map CRUD endpoint tests."""

from fastapi.testclient import TestClient


def test_create_map_returns_default_version(client: TestClient) -> None:
    response = client.post("/api/maps", json={"name": "구매 프로세스"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "구매 프로세스"
    assert len(body["versions"]) == 1
    assert body["versions"][0]["label"] == "As-Is"


def test_get_map_returns_created_map(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "발주"}).json()

    response = client.get(f"/api/maps/{created['id']}")

    assert response.status_code == 200
    assert response.json()["name"] == "발주"


def test_get_missing_map_returns_404(client: TestClient) -> None:
    response = client.get("/api/maps/999999")

    assert response.status_code == 404


def test_create_map_rejects_blank_name(client: TestClient) -> None:
    response = client.post("/api/maps", json={"name": ""})

    assert response.status_code == 422


def test_create_map_rejects_duplicate_name(client: TestClient) -> None:
    client.post("/api/maps", json={"name": "중복맵A"})
    response = client.post("/api/maps", json={"name": "중복맵A"})
    assert response.status_code == 409


def test_update_map_rejects_duplicate_name(client: TestClient) -> None:
    client.post("/api/maps", json={"name": "기존맵A"})
    other = client.post("/api/maps", json={"name": "다른맵A"}).json()
    # 다른 맵 이름으로 변경 → 409, 자기 자신 이름 유지는 허용
    assert client.patch(f"/api/maps/{other['id']}", json={"name": "기존맵A"}).status_code == 409
    assert client.patch(f"/api/maps/{other['id']}", json={"name": "다른맵A"}).status_code == 200


def test_list_maps_includes_created(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "검수"}).json()

    response = client.get("/api/maps")

    assert response.status_code == 200
    assert any(m["id"] == created["id"] for m in response.json())


def test_list_maps_includes_latest_version_status(client: TestClient) -> None:
    """목록은 최신 버전 상태를 동봉 — 신규 맵은 기본 As-Is 버전이라 'draft'."""
    created = client.post("/api/maps", json={"name": "상태확인"}).json()

    row = next(m for m in client.get("/api/maps").json() if m["id"] == created["id"])

    assert row["latest_version_status"] == "draft"


def test_update_map_changes_name(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "old"}).json()

    response = client.patch(f"/api/maps/{created['id']}", json={"name": "new"})

    assert response.status_code == 200
    assert response.json()["name"] == "new"


def test_delete_map_then_get_404(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "to delete"}).json()

    delete_response = client.delete(f"/api/maps/{created['id']}")
    get_response = client.get(f"/api/maps/{created['id']}")

    assert delete_response.status_code == 204
    assert get_response.status_code == 404


def test_delete_is_soft_and_restorable(client: TestClient) -> None:
    """삭제는 소프트삭제 — 목록/조회 제외, 휴지통에 노출, 복구하면 되살아남 (DL)."""
    created = client.post("/api/maps", json={"name": "soft delete map"}).json()
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
    created = client.post("/api/maps", json={"name": "with role"}).json()

    body = client.get(f"/api/maps/{created['id']}").json()

    assert "my_role" in body
    assert body["my_role"] == "owner"


def test_list_maps_includes_my_role(client: TestClient) -> None:
    created = client.post("/api/maps", json={"name": "list role"}).json()

    body = client.get("/api/maps").json()

    item = next(m for m in body if m["id"] == created["id"])
    assert item["my_role"] == "owner"


def test_me_includes_is_sysadmin(client: TestClient) -> None:
    # /api/me 가 is_sysadmin 노출 — sysadmin-only UI 게이팅 (auth OFF 기본 → True)
    body = client.get("/api/me").json()

    assert "is_sysadmin" in body
    assert body["is_sysadmin"] is True
