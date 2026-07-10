"""부서 부가정보(dept_info) 임포트·조회 테스트 — 한글 부서명·부서장."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.settings import settings

SYS = {"X-Dev-User": "admin.kim"}


@pytest.fixture
def sysadmin_enforced() -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim. 정리 시 복원."""
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = "admin.kim"
    yield
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys


def test_dept_info_put_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    res = client.put(
        "/api/admin/dept-info",
        headers={"X-Dev-User": "user.lee"},
        json={"entries": {}},
    )
    assert res.status_code == 403


def test_dept_info_upsert_and_join(client: TestClient) -> None:
    # 시드 부서(Process Innovation Team)는 반영, 미존재 부서는 unknown 보고
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={
            "entries": {
                "Process Innovation Team": {"korean_name": "공정혁신팀", "manager": "hong.gildong"},
                "No Such Dept": {"korean_name": "없는부서", "manager": ""},
            }
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["updated"] == 1
    assert body["unknown"] == ["No Such Dept"]

    # GET /admin/users의 departments에 조인되어 나온다
    dirs = client.get("/api/admin/users", headers=SYS).json()
    dept = next(d for d in dirs["departments"] if d["name"] == "Process Innovation Team")
    assert dept["korean_name"] == "공정혁신팀"
    assert dept["manager"] == "hong.gildong"


def test_dept_info_partial_update_preserves_other_field(client: TestClient) -> None:
    client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 1": {"korean_name": "구매1팀", "manager": "kim.cs"}}},
    )
    # manager만 온 재임포트 — korean_name은 보존
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 1": {"korean_name": "", "manager": "lee.mj"}}},
    )
    assert res.json()["updated"] == 1
    dirs = client.get("/api/admin/users", headers=SYS).json()
    dept = next(d for d in dirs["departments"] if d["name"] == "Sourcing Team 1")
    assert dept["korean_name"] == "구매1팀"
    assert dept["manager"] == "lee.mj"


def test_dept_info_blank_entry_ignored(client: TestClient) -> None:
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 2": {"korean_name": "  ", "manager": ""}}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0, "unknown": []}


def test_dept_info_accepts_parent_org_levels(client: TestClient) -> None:
    """조직도 tree는 본부·실까지 담는다 — 직원이 직접 소속되지 않은 상위 레벨도 수용해야 한다.

    상위 레벨 dept_info가 있어야 /api/me의 상위 부서장 체인(manager_ids)과
    피커의 상위 부서 한글 검색이 동작한다.
    """
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={
            "entries": {
                # org_l1 — 어떤 직원의 department도 아니다
                "Management Support Division": {"korean_name": "경영지원본부", "manager": "admin.kim"},
                # org_l2 — 마찬가지
                "Process Innovation Office": {"korean_name": "공정혁신실", "manager": "admin.kim"},
                "Still No Such Dept": {"korean_name": "없는부서", "manager": ""},
            }
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["updated"] == 2
    assert body["unknown"] == ["Still No Such Dept"]

    # 디렉터리는 org-path 프리픽스를 모두 내려주므로 상위 부서에도 한글명이 조인된다
    depts = client.get("/api/directory", headers=SYS).json()["departments"]
    division = next(d for d in depts if d["id"] == "Management Support Division")
    assert division["korean_name"] == "경영지원본부"
    assert division["manager"] == "admin.kim"


def test_dept_info_rejects_over_200_chars(client: TestClient) -> None:
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 1": {"korean_name": "가" * 201, "manager": ""}}},
    )
    assert res.status_code == 422
