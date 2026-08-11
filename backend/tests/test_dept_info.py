"""부서 부가정보(dept_info) 임포트·조회 테스트 — 한글 부서명·부서장."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.settings import settings

SYS = {"X-Dev-User": "admin.kim"}


def _dept_info_row(client: TestClient, department: str) -> dict:
    """dept_info 원본 행 조회 — 어드민 테이블 뷰어 경유.

    한글명 표시 소스가 departments로 전환(2026-08-11)돼 admin/users·directory는 더 이상
    dept_info를 조인하지 않는다 — PUT의 영속 동작 자체(upsert·partial-preserve)는 테이블
    뷰어로 직접 확인한다.
    """
    res = client.get("/api/admin/tables/dept_info", params={"q": department}, headers=SYS)
    return next(r for r in res.json()["rows"] if r["department"] == department)


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


def test_dept_info_upsert_persists_row(client: TestClient) -> None:
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

    row = _dept_info_row(client, "Process Innovation Team")
    assert row["korean_name"] == "공정혁신팀"
    assert row["manager"] == "hong.gildong"


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
    row = _dept_info_row(client, "Sourcing Team 1")
    assert row["korean_name"] == "구매1팀"
    assert row["manager"] == "lee.mj"


def test_dept_info_blank_entry_ignored(client: TestClient) -> None:
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 2": {"korean_name": "  ", "manager": ""}}},
    )
    assert res.status_code == 200
    assert res.json() == {"updated": 0, "unknown": []}


def test_dept_info_accepts_parent_org_levels(client: TestClient) -> None:
    """조직도 tree는 본부·실까지 담는다 — 직원이 직접 소속되지 않은 상위 레벨도 PUT이 수용해야 한다.

    (한글명 표시·manager_ids는 각각 departments.name_ko·EDW position allowlist로 전환됨 —
    이 PUT 자체의 영속 동작만 여기서 검증한다, 2026-08-11)
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

    row = _dept_info_row(client, "Management Support Division")
    assert row["korean_name"] == "경영지원본부"
    assert row["manager"] == "admin.kim"


def test_dept_info_rejects_over_200_chars(client: TestClient) -> None:
    res = client.put(
        "/api/admin/dept-info",
        headers=SYS,
        json={"entries": {"Sourcing Team 1": {"korean_name": "가" * 201, "manager": ""}}},
    )
    assert res.status_code == 422
