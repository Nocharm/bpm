"""SP 지정 참고치(연간 수행횟수·FTE) + 지정 PUT의 인터뷰 원문 메모 저장 (design 2026-09-03 §2·§4)."""

import pytest
from fastapi.testclient import TestClient

from tests.test_consultant_interview import _interview
from tests.test_interview_import_api import _map_row
from tests.test_subprocess_designation import (
    BODY,
    OWNER,
    SYSADMIN,
    act_as,
    enforce,  # noqa: F401 — 픽스처 재사용(usefixtures로 참조)
    seed_host_with_subprocess_node,
    seed_map,
)


@pytest.mark.usefixtures("enforce")
def test_designation_saves_annual_count_and_fte(client: TestClient) -> None:
    map_id = seed_map("ctx-params", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation",
                     json={**BODY, "annual_count": "52", "fte": "0.5"})
    assert res.status_code == 200
    assert (res.json()["sp_annual_count"], res.json()["sp_fte"]) == ("52", "0.5")
    detail = client.get(f"/api/maps/{map_id}").json()
    assert (detail["sp_annual_count"], detail["sp_fte"]) == ("52", "0.5")


@pytest.mark.usefixtures("enforce")
def test_designation_drops_invalid_context_numbers(client: TestClient) -> None:
    map_id = seed_map("ctx-invalid", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation",
                     json={**BODY, "annual_count": "weekly", "fte": "0,5"})
    assert res.status_code == 200
    assert (res.json()["sp_annual_count"], res.json()["sp_fte"]) == ("", "")


@pytest.mark.usefixtures("enforce")
def test_subprocess_ref_carries_reference_values(client: TestClient) -> None:
    target = seed_map("ctx-ref-target", published=True)
    act_as(OWNER)
    client.put(f"/api/maps/{target}/subprocess-designation",
               json={**BODY, "annual_count": "12", "fte": "0.25"})
    _host, host_version = seed_host_with_subprocess_node(target, "ctx-sp1")
    act_as(SYSADMIN)
    ref = client.get(f"/api/versions/{host_version}/graph").json()["subprocess_refs"][str(target)]
    assert (ref["annual_count"], ref["fte"]) == ("12", "0.25")


@pytest.mark.usefixtures("enforce")
def test_designation_fallback_notes_only_change_when_sent(client: TestClient) -> None:
    map_id = seed_map("ctx-fallback", published=True)
    act_as(OWNER)
    res = client.put(f"/api/maps/{map_id}/subprocess-designation", json={
        **BODY, "total_time_fallback": " 한번에 한시간쯤 ", "system_fallback": "EAM, 수기",
        "frequency_fallback": "주 1회",
    })
    assert res.status_code == 200
    body = res.json()
    assert body["sp_total_time_fallback"] == "한번에 한시간쯤"
    assert body["sp_system_fallback"] == "EAM, 수기"
    assert body["sp_frequency_fallback"] == "주 1회"
    assert body["sp_touch_time_fallback"] is None  # 안 보낸 필드는 미변경

    # 폴백 없이 재저장 → 유지, 빈 문자열 → 지움
    kept = client.put(f"/api/maps/{map_id}/subprocess-designation", json=BODY).json()
    assert kept["sp_total_time_fallback"] == "한번에 한시간쯤"
    cleared = client.put(f"/api/maps/{map_id}/subprocess-designation",
                         json={**BODY, "total_time_fallback": ""}).json()
    assert cleared["sp_total_time_fallback"] is None


def test_import_lands_annual_count_and_fte_on_map(client: TestClient) -> None:
    data = _interview()
    data["rows"][0]["taskId"] = "task-ctx-0001"
    data["rows"][0]["fields"].update({"annual_count": 52, "fte": 0.03})
    res = client.post("/api/categories/import-interview",
                      json={"files": [{"name": "ctx.json", "content": data}], "apply": True})
    assert res.status_code == 200
    m = _map_row("task-ctx-0001")
    assert (m.sp_annual_count, m.sp_fte) == ("52", "0.03")
