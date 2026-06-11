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
