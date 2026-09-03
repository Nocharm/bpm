"""재임포트 거버넌스 확인 적용 — dry-run이 오너·오우닝 부서·승인자 차이를 내고, apply는 체크한 것만 교체.

설계: docs/superpowers/specs/2026-09-03-import-governance-review-design.md §3·§4.
"""

from fastapi.testclient import TestClient

from tests.test_consultant_interview import _interview
from tests.test_interview_import_api import _map_row, _run


def _delivery(code: str, *, owner: str | None, approvers: list[str], department: str | None) -> dict:
    data = _interview()
    row = data["rows"][0]
    row["taskId"] = code
    row["owner"] = owner
    row["approvers"] = approvers
    row["department"] = department
    return data


def _post(client: TestClient, data: dict, *, apply: bool, decisions: list[dict] | None = None):
    body = {"files": [{"name": f"{data['rows'][0]['taskId']}.json", "content": data}],
            "apply": apply, "label": "gov"}
    if decisions is not None:
        body["decisions"] = decisions
    return client.post("/api/categories/import-interview", json=body)


def _approvers(map_id: int) -> list[str]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapApprover

    async def _load():
        async with SessionLocal() as session:
            return sorted((await session.scalars(
                select(MapApprover.user_id).where(MapApprover.map_id == map_id))).all())

    return _run(_load())


def _owner_grants(map_id: int) -> list[str]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapPermission

    async def _load():
        async with SessionLocal() as session:
            return sorted((await session.scalars(select(MapPermission.principal_id).where(
                MapPermission.map_id == map_id, MapPermission.role == "owner"))).all())

    return _run(_load())


def _gov(body: dict, field: str) -> dict | None:
    return next((g for g in body["governance"] if g["field"] == field), None)


def test_dry_run_lists_diffs_for_confirmed_owner_without_writing(client: TestClient) -> None:
    code = "task-gov-0001"
    assert _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    assert m.owner_id == "a" and m.consultant_owner_pending is False

    body = _post(client, _delivery(code, owner="b", approvers=["lead"], department=None),
                 apply=False).json()
    owner = _gov(body, "owner")
    assert owner == {"code": code, "name": "교정 준비", "field": "owner",
                     "current": "a", "delivered": "b", "applied": False, "default_checked": False}
    approvers = _gov(body, "approvers")
    assert approvers["current"] == "boss" and approvers["delivered"] == "lead"
    assert _gov(body, "department") is None  # 전달 부서 없음 = 차이 아님
    m2 = _map_row(code)
    assert m2.owner_id == "a" and _approvers(m2.id) == ["boss"]


def test_apply_without_decisions_keeps_current_even_when_pending(client: TestClient) -> None:
    code = "task-gov-0002"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    assert m.consultant_owner_pending is True
    importer = m.owner_id

    body = _post(client, _delivery(code, owner="a", approvers=["boss"], department="QA/Calibration"),
                 apply=True).json()
    assert body["applied"] is True
    assert {g["field"] for g in body["governance"] if g["code"] == code} >= {"owner", "approvers", "department"}
    assert all(g["applied"] is False for g in body["governance"])
    m2 = _map_row(code)
    assert m2.owner_id == importer and m2.consultant_owner_pending is True
    assert m2.owning_department is None and _approvers(m2.id) == []


def test_apply_with_owner_decision_replaces_owner_and_clears_pending(client: TestClient) -> None:
    code = "task-gov-0003"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    body = _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True, decisions=[{"code": code, "field": "owner"}]).json()
    assert _gov(body, "owner")["applied"] is True
    assert _gov(body, "approvers")["applied"] is False
    m = _map_row(code)
    assert m.owner_id == "a" and m.consultant_owner_pending is False
    assert _owner_grants(m.id) == ["a"]
    assert _approvers(m.id) == []  # 미체크 필드는 유지
    assert any(r["action"] == "governance" and "owner a assigned" in r["detail"] for r in body["rows"])


def test_apply_with_approvers_and_department_decisions(client: TestClient) -> None:
    code = "task-gov-0004"
    assert _post(client, _delivery(code, owner="a", approvers=[], department=None),
                 apply=True).status_code == 200
    body = _post(
        client, _delivery(code, owner="a", approvers=["boss", "lead", "boss"], department="QA/Calibration"),
        apply=True,
        decisions=[{"code": code, "field": "approvers"}, {"code": code, "field": "department"}],
    ).json()
    dept = _gov(body, "department")
    assert dept["current"] == "" and dept["delivered"] == "QA/Calibration" and dept["applied"] is True
    assert any("registered as delivered" in r["detail"] for r in body["rows"] if r["action"] == "warning")
    m = _map_row(code)
    assert m.owning_department == "QA/Calibration"
    assert _approvers(m.id) == ["boss", "lead"]
    assert m.owner_id == "a"


def test_unknown_decision_is_422_and_writes_nothing(client: TestClient) -> None:
    code = "task-gov-0005"
    assert _post(client, _delivery(code, owner="a", approvers=[], department=None),
                 apply=True).status_code == 200
    resp = _post(client, _delivery(code, owner="b", approvers=[], department=None),
                 apply=True, decisions=[{"code": "task-nope", "field": "owner"}])
    assert resp.status_code == 422
    assert "unknown governance decision task-nope/owner" in resp.json()["detail"]
    assert _map_row(code).owner_id == "a"


def test_empty_delivered_values_are_not_diffs(client: TestClient) -> None:
    code = "task-gov-0006"
    assert _post(client, _delivery(code, owner="a", approvers=["boss"], department=None),
                 apply=True).status_code == 200
    body = _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=False).json()
    # notes 행은 임포트 노트가 있는 맵마다 뜬다(교체 결정) — 거버넌스 3종만 없어야 한다
    assert [g for g in body["governance"] if g["field"] != "notes"] == []


def _notes(map_id: int) -> list[dict]:
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import MapNote

    async def _load():
        async with SessionLocal() as session:
            rows = (await session.scalars(select(MapNote).where(MapNote.map_id == map_id).order_by(MapNote.id))).all()
            return [{"id": n.id, "source": n.source, "edited": n.edited_at is not None, "text": n.text} for n in rows]

    return _run(_load())


def test_reimport_notes_replace_is_a_decision(client: TestClient) -> None:
    """임포트 노트가 있는 맵은 notes 차이 행 — 미수정이면 기본 체크, 사람이 고쳤으면 기본 해제.
    체크 시 임포트 노트만 교체(사용자 노트 보존) (design 2026-09-03 followups §3)."""
    code = "task-gov-notes"
    data = _delivery(code, owner="a", approvers=[], department=None)
    assert _post(client, data, apply=True).status_code == 200
    m = _map_row(code)
    before = _notes(m.id)
    assert len(before) > 0 and all(n["source"] == "consultant-import" for n in before)

    def notes_row_of(body: dict) -> dict:
        # L5 스코프(카테고리 code) notes 행도 함께 오므로 맵 code로 고른다
        return next(g for g in body["governance"] if g["field"] == "notes" and g["code"] == code)

    # 미결정 재임포트 → 노트 그대로, 차이 행은 기본 체크(수정 없음)
    body = _post(client, data, apply=True).json()
    notes_row = notes_row_of(body)
    assert notes_row["default_checked"] is True and notes_row["applied"] is False
    assert notes_row["current"] == f"{len(before)} notes"
    assert [n["id"] for n in _notes(m.id)] == [n["id"] for n in before]

    # 오너가 임포트 노트 하나를 고치고 사용자 노트도 하나 추가
    edited_id = before[0]["id"]
    assert client.patch(f"/api/maps/{m.id}/notes/{edited_id}", json={"text": "고침"}).status_code == 200
    user_note = client.post(f"/api/maps/{m.id}/notes", json={"kind": "note", "text": "내 메모"}).json()
    body = _post(client, data, apply=False).json()
    notes_row = notes_row_of(body)
    assert notes_row["default_checked"] is False and "1 edited" in notes_row["current"]

    # 체크하고 apply → 임포트 노트 교체(고친 것 소멸), 사용자 노트 보존
    body = _post(client, data, apply=True, decisions=[{"code": code, "field": "notes"}]).json()
    assert notes_row_of(body)["applied"] is True
    after = _notes(m.id)
    assert edited_id not in [n["id"] for n in after]
    assert user_note["id"] in [n["id"] for n in after]
    assert sum(1 for n in after if n["source"] == "consultant-import") == len(before)


def test_map_detail_exposes_owner_pending_flag(client: TestClient) -> None:
    code = "task-gov-0007"
    assert _post(client, _delivery(code, owner=None, approvers=[], department=None),
                 apply=True).status_code == 200
    m = _map_row(code)
    body = client.get(f"/api/maps/{m.id}").json()
    assert body["consultant_owner_pending"] is True
