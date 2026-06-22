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
