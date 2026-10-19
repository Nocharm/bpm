"""시스템 리뷰 2026-10-19 3단계 — 임포트·AI 데이터 무결성 회귀 (P0-3·G-2~G-7·G-10·G-11).

재전달·유지·정정이 오너가 넣은 값을 엉뚱한 활동에 옮기거나 지우지 않는지, 임포트가 기존 체계와 다른 L5의 맵을
조용히 옮기지 않는지, 캠페인 카드 전환과 맵 인터뷰 적용 대상이 맞는지 본다.
"""

import asyncio
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import ai_client
from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview import runner
from app.framework_interview.assemble import build_document, load_category_chain
from app.framework_interview.existing import load_existing_l6
from app.models import (
    Edge,
    FrameworkInterviewSession,
    FrameworkInterviewTask,
    MapVersion,
    Node,
    ProcessCategory,
    ProcessMap,
)
from app.settings import settings
from tests.test_framework_interview_api import HEADERS, _card, _enable, _fake_ai_queue, _make_l5
from tests.test_framework_interview_runner import ROW_JSON, _step


def _run(coro):
    return asyncio.run(coro)


def _chain(l5_id: int) -> list[dict]:
    async def _load() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)
    return _run(_load())


def _row(name: str, labels: list[str], **actions_extra: dict) -> dict:
    """활동 제목 목록으로 0.5 행 하나 — 엣지를 비우면 어댑터가 순번 순서로 잇는다."""
    actions = [{"seq": i, "label": label, "kind": "action", **actions_extra.get(label, {})}
               for i, label in enumerate(labels, start=1)]
    return {"l6": name, "ownerRole": "담당자", "department": "", "fields": {}, "actions": actions}


def _doc(chain: list[dict], rows: list[dict], categories: list[dict] | None = None) -> dict:
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    return build_document(categories or chain, l5, rows, None, label="integ", session_id=0)


def _post(client: TestClient, doc: dict, *, apply: bool = True) -> dict:
    res = client.post("/api/categories/import-interview", headers=HEADERS,
                      json={"files": [{"name": "d.json", "content": doc}], "apply": apply})
    assert res.status_code == 200, res.text
    return res.json()


def _import(client: TestClient, chain: list[dict], rows: list[dict]) -> dict:
    body = _post(client, _doc(chain, rows))
    assert body["files"][0]["ok"] is True, body["files"]
    return body


def _new_l5(client: TestClient) -> tuple[int, list[dict], str]:
    l5_id = _make_l5(client, f"integ3-{uuid4().hex[:6]}")
    chain = _chain(l5_id)
    return l5_id, chain, chain[-1]["code"]


def _map(code: str) -> ProcessMap:
    async def _load() -> ProcessMap:
        async with SessionLocal() as db:
            return (await db.scalars(select(ProcessMap).where(ProcessMap.consultant_code == code))).one()
    return _run(_load())


def _versions(code: str) -> list[MapVersion]:
    async def _load() -> list[MapVersion]:
        async with SessionLocal() as db:
            m = (await db.scalars(select(ProcessMap).where(ProcessMap.consultant_code == code))).one()
            return list((await db.scalars(
                select(MapVersion).where(MapVersion.map_id == m.id).order_by(MapVersion.id))).all())
    return _run(_load())


def _published_nodes(code: str) -> dict[str, Node]:
    """최신 게시본의 활동 노드를 제목으로."""
    async def _load() -> dict[str, Node]:
        async with SessionLocal() as db:
            m = (await db.scalars(select(ProcessMap).where(ProcessMap.consultant_code == code))).one()
            latest = (await db.scalars(select(MapVersion).where(
                MapVersion.map_id == m.id, MapVersion.status == "published"))).one()
            nodes = (await db.scalars(select(Node).where(Node.version_id == latest.id))).all()
            return {n.title: n for n in nodes if n.node_type in ("process", "decision")}
    return _run(_load())


def _edit_published(code: str, edit) -> None:
    """오너가 게시본에 값을 넣은 상황 — edit(session, process_map, version_id, nodes)."""
    async def _apply() -> None:
        async with SessionLocal() as db:
            m = (await db.scalars(select(ProcessMap).where(ProcessMap.consultant_code == code))).one()
            latest = (await db.scalars(select(MapVersion).where(
                MapVersion.map_id == m.id, MapVersion.status == "published"))).one()
            nodes = list((await db.scalars(select(Node).where(Node.version_id == latest.id))).all())
            await edit(db, m, latest.id, {n.title: n for n in nodes})
            await db.commit()
    _run(_apply())


def _set_values(**by_title: dict):
    async def _edit(_db, _m, _vid, nodes: dict[str, Node]) -> None:
        for title, values in by_title.items():
            for key, value in values.items():
                setattr(nodes[title], key, value)
    return _edit


# --- P0-3 활동 계보 ---------------------------------------------------------------------------


def test_redelivery_inserted_activity_does_not_take_its_neighbours_values(client: TestClient) -> None:
    """2번 자리에 활동을 끼워 다시 보내도 오너 값은 원래 활동에 남는다 — 끼운 활동은 빈 값으로 시작한다."""
    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토", "승인"])}])
    _edit_published(code, _set_values(
        검토={"duration": "2.00", "assignee_role": "구매 담당", "gmp": "GMP"},
        승인={"url": "https://example.com/approve"},
    ))

    body = _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "예산 확인", "검토", "승인"])}])
    assert body["summary"]["updated"] == 1

    nodes = _published_nodes(code)
    assert (nodes["검토"].duration, nodes["검토"].assignee_role, nodes["검토"].gmp) == ("2.00", "구매 담당", "GMP")
    assert (nodes["예산 확인"].duration, nodes["예산 확인"].assignee_role, nodes["예산 확인"].gmp) == ("", "", "")
    assert nodes["승인"].url == "https://example.com/approve"


def test_redelivery_keeps_lineage_so_compare_sees_one_added_activity(client: TestClient) -> None:
    """같은 활동은 직전 게시본 계보를 이어받고, 끼운 활동은 어느 옛 계보와도 겹치지 않는다(비교 화면이 1건 추가로 본다)."""
    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토", "승인"])}])
    before = {title: n.source_node_id for title, n in _published_nodes(code).items()}

    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "예산 확인", "검토", "승인"])}])
    after = {title: n.source_node_id for title, n in _published_nodes(code).items()}

    assert {t: after[t] for t in before} == before
    assert after["예산 확인"] not in before.values()
    assert len(set(after.values())) == 4


def test_redelivery_rename_in_place_keeps_values(client: TestClient) -> None:
    """같은 자리에서 이름만 바뀐 활동은 같은 활동이다 — 값이 남는다."""
    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토", "승인"])}])
    _edit_published(code, _set_values(검토={"duration": "1.30"}))

    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "1차 검토", "승인"])}])
    assert _published_nodes(code)["1차 검토"].duration == "1.30"


# --- 유지(keep) 행은 맵을 다시 쓰지 않는다 -------------------------------------------------------


def _keep_row(l5_id: int, code: str) -> dict:
    async def _load() -> dict:
        async with SessionLocal() as db:
            items = await load_existing_l6(db, l5_id)
        return next(item["row"] for item in items if item["code"] == code)
    return _run(_load())


def test_keep_row_leaves_an_owner_edited_map_untouched(client: TestClient) -> None:
    """오너가 활동 하나를 지우고 값을 넣은 맵을 유지로 등록해도 새 버전이 나가지 않고 값·지정값이 그대로다."""
    l5_id, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토", "승인"])}])

    async def _owner_edit(db, m, vid, nodes: dict[str, Node]) -> None:
        dropped = nodes["검토"]
        for edge in (await db.scalars(select(Edge).where(Edge.version_id == vid))).all():
            if dropped.id in (edge.source_node_id, edge.target_node_id):
                await db.delete(edge)
        await db.delete(dropped)
        db.add(Edge(id=uuid4().hex, version_id=vid, source_node_id=nodes["접수"].id,
                    target_node_id=nodes["승인"].id, label=""))
        nodes["승인"].duration = "3.00"
        m.sp_cost_krw = "120000"
        m.description = "오너가 쓴 설명"
    _edit_published(code, _owner_edit)
    versions_before = [(v.id, v.status) for v in _versions(code)]

    row = _keep_row(l5_id, code)
    body = _post(client, _doc(chain, [{"taskId": code, **row, "keep": True}]))
    assert body["files"][0]["ok"] is True, body["files"]
    assert body["summary"].get("unchanged") == 1 and "updated" not in body["summary"]

    assert [(v.id, v.status) for v in _versions(code)] == versions_before
    m = _map(code)
    assert (m.sp_cost_krw, m.description) == ("120000", "오너가 쓴 설명")
    nodes = _published_nodes(code)
    assert set(nodes) == {"접수", "승인"} and nodes["승인"].duration == "3.00"


def test_keep_row_for_unknown_map_is_an_error(client: TestClient) -> None:
    _, chain, l5_code = _new_l5(client)
    body = _post(client, _doc(chain, [{"taskId": f"{l5_code}-09", **_row("없는 맵", ["접수"]), "keep": True}]))
    rows = [r for r in body["rows"] if r["code"] == f"{l5_code}-09"]
    assert any(r["action"] == "error" for r in rows), rows
    assert body["summary"].get("created") is None


def test_campaign_document_marks_keep_rows(client: TestClient, monkeypatch) -> None:
    """캠페인 조립 문서의 유지 행은 keep 표시를 단다 — 임포터가 그 맵을 건드리지 않게."""
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5_id, chain, l5_code = _new_l5(client)
    _import(client, chain, [{"taskId": f"{l5_code}-01", **_row("요청 접수", ["확인", "등록"])}])
    sid = client.post("/api/framework-interviews", json={"category_id": l5_id}, headers=HEADERS).json()["id"]
    locked = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS, json={"cards": [], "lock": True})
    assert locked.status_code == 200, locked.text
    relations = {"entry": {"taskId": f"{l5_code}-01", "triggerType": "manual"}, "edges": []}
    confirmed = client.put(f"/api/framework-interviews/{sid}/relations", headers=HEADERS, json={"relations": relations})
    assert confirmed.status_code == 200, confirmed.text
    doc = client.get(f"/api/framework-interviews/{sid}/document", headers=HEADERS).json()
    assert doc["rows"][0]["keep"] is True


# --- G-3 전달 칸이 없는 값 ----------------------------------------------------------------------


def test_same_delivery_again_keeps_node_department_assignee_color(client: TestClient) -> None:
    """0.5는 활동 단위 부서·담당자를 싣지 않는다 — 같은 파일을 다시 넣어도 오너 값이 남고 새 버전이 없다."""
    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    rows = [{"taskId": code, **_row("구매 요청", ["접수", "검토"])}]
    _import(client, chain, rows)
    _edit_published(code, _set_values(접수={"department": "품질팀", "assignee": "hong.gd", "color": "#3B7A57"}))

    body = _import(client, chain, rows)
    assert body["summary"].get("unchanged") == 1, body["summary"]
    node = _published_nodes(code)["접수"]
    assert (node.department, node.assignee, node.color) == ("품질팀", "hong.gd", "#3B7A57")


def test_delivered_exception_colour_still_wins_over_owner_colour(client: TestClient) -> None:
    """색은 예외 variant로 전달되는 값이다 — 전달물이 예외라고 하면 그 색이 이긴다."""
    from scripts.consultant_interview import EXCEPTION_VARIANT_COLOR

    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토"])}])
    _edit_published(code, _set_values(접수={"color": "#3B7A57"}))

    _import(client, chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토"], 접수={"variant": "exception"})}])
    assert _published_nodes(code)["접수"].color == EXCEPTION_VARIANT_COLOR


def test_redelivery_keeps_map_cost_the_delivery_cannot_carry(client: TestClient) -> None:
    """0.5에는 비용 칸이 없다 — 재전달이 오너가 넣은 SP 비용을 지우지 않는다."""
    _, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    rows = [{"taskId": code, **_row("구매 요청", ["접수"])}]
    _import(client, chain, rows)

    async def _set_cost(_db, m, _vid, _nodes) -> None:
        m.sp_cost_krw = "120000"
    _edit_published(code, _set_cost)

    changed = [{"taskId": code, **_row("구매 요청", ["접수"]), "fields": {"start_condition": "요청서 도착"}}]
    _import(client, chain, changed)
    m = _map(code)
    assert (m.sp_cost_krw, m.sp_start_condition) == ("120000", "요청서 도착")


# --- G-2 외부 AI가 지어낸 상위 분류 ---------------------------------------------------------------


def test_import_refuses_to_move_an_existing_l5_under_another_chain(client: TestClient) -> None:
    """파일이 기존 L5를 다른 L4 아래로 옮기려 하면 파일 오류 — 지어낸 L1~L4도 만들지 않는다."""
    l5_id, chain, l5_code = _new_l5(client)
    tag = uuid4().hex[:6]
    fake = [{"code": f"fake-{tag}-{lv}", "name": f"가짜 L{lv}", "level": lv,
             "parent": f"fake-{tag}-{lv - 1}" if lv > 1 else None} for lv in range(1, 5)]
    categories = [*fake, {**chain[-1], "parent": f"fake-{tag}-4"}]
    doc = _doc(chain, [{"taskId": f"{l5_code}-01", **_row("구매 요청", ["접수"])}], categories=categories)

    async def _state() -> tuple[int | None, int]:
        async with SessionLocal() as db:
            l5 = await db.get(ProcessCategory, l5_id)
            fakes = (await db.scalars(select(ProcessCategory).where(
                ProcessCategory.code.like(f"fake-{tag}-%")))).all()
            return l5.parent_id, len(fakes)
    parent_before, _ = _run(_state())

    for apply in (False, True):
        body = _post(client, doc, apply=apply)
        assert body["files"][0]["ok"] is False
        assert any(i["severity"] == "error" and "move" in i["message"] for i in body["files"][0]["issues"])

    assert _run(_state()) == (parent_before, 0)
    assert [c["code"] for c in _chain(l5_id)] == [c["code"] for c in chain]


def test_import_warns_when_only_a_category_name_differs(client: TestClient) -> None:
    _, chain, l5_code = _new_l5(client)
    categories = [*chain[:3], {**chain[3], "name": chain[3]["name"] + " (개정)"}, chain[4]]
    body = _post(client, _doc(chain, [{"taskId": f"{l5_code}-01", **_row("구매 요청", ["접수"])}],
                              categories=categories), apply=False)
    file = body["files"][0]
    assert file["ok"] is True
    assert any(i["severity"] == "warning" and "name" in i["message"] for i in file["issues"])


# --- G-5 다른 L5 소속 맵 -----------------------------------------------------------------------


def test_import_refuses_a_task_that_belongs_to_another_l5(client: TestClient) -> None:
    """다른 L5의 맵 taskId를 이 L5 파일에 넣으면 파일 오류 — 맵을 조용히 이 L5로 옮기지 않는다."""
    home_id, home_chain, home_code = _new_l5(client)
    code = f"{home_code}-01"
    _import(client, home_chain, [{"taskId": code, **_row("구매 요청", ["접수"])}])
    _, other_chain, _ = _new_l5(client)

    body = _post(client, _doc(other_chain, [{"taskId": code, **_row("구매 요청", ["접수", "검토"])}]))
    assert body["files"][0]["ok"] is False
    assert any(i["severity"] == "error" and "another L5" in i["message"] for i in body["files"][0]["issues"])
    assert _map(code).category_id == home_id
    assert set(_published_nodes(code)) == {"접수"}


# --- G-4 정정 카드 건너뛰기 = 유지로 되돌리기 ----------------------------------------------------


def _lock_revise(client: TestClient, monkeypatch) -> tuple[int, int, str, dict]:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5_id, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("출하 검사", ["샘플 채취", "시험", "판정"])}])
    sid = client.post("/api/framework-interviews", json={"category_id": l5_id}, headers=HEADERS).json()["id"]
    locked = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS, json={
        "cards": [_card("출하 검사", existing_code=code, mode="revise")], "lock": True})
    assert locked.status_code == 200, locked.text
    return sid, l5_id, code, locked.json()["tasks"][0]


def test_skip_on_a_failed_revise_card_returns_it_to_keep(client: TestClient, monkeypatch) -> None:
    sid, _, code, task = _lock_revise(client, monkeypatch)
    _fake_ai_queue(monkeypatch, ["not json", "still not json", "and again not json"])
    _step(sid)
    assert client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]["status"] == "failed"

    skipped = client.post(f"/api/framework-interviews/{sid}/tasks/{task['id']}/skip", headers=HEADERS)
    assert skipped.status_code == 200, skipped.text
    out = skipped.json()
    assert (out["tasks"][0]["mode"], out["tasks"][0]["status"], out["tasks"][0]["placeholder"]) == ("keep", "drawn", False)
    assert [c["mode"] for c in out["plan"]] == ["keep"]
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{task['id']}", headers=HEADERS).json()
    assert [a["label"] for a in detail["row"]["actions"]] == ["샘플 채취", "시험", "판정"]


# --- G-6 유지 카드 피드백 = 정정 전환 ------------------------------------------------------------


def test_feedback_on_a_keep_card_switches_it_to_revise(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5_id, chain, l5_code = _new_l5(client)
    code = f"{l5_code}-01"
    _import(client, chain, [{"taskId": code, **_row("요청 접수", ["요청 확인", "완결성 판정", "접수 등록"])}])
    sid = client.post("/api/framework-interviews", json={"category_id": l5_id}, headers=HEADERS).json()["id"]
    task = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
                      json={"cards": [], "lock": True}).json()["tasks"][0]
    assert task["mode"] == "keep"

    _fake_ai_queue(monkeypatch, [ROW_JSON.replace("요청 확인", "요청서 확인")])
    fb = client.post(f"/api/framework-interviews/{sid}/feedback", headers=HEADERS,
                     json={"scope": "task", "task_pk": task["id"], "message": "첫 활동 이름 고쳐"})
    assert fb.status_code == 200, fb.text
    assert fb.json()["tasks"][0]["mode"] == "revise"
    assert [c["mode"] for c in fb.json()["plan"]] == ["revise"]

    relations = {"entry": {"taskId": code, "triggerType": "manual"}, "edges": []}
    confirmed = client.put(f"/api/framework-interviews/{sid}/relations", headers=HEADERS, json={"relations": relations})
    assert confirmed.status_code == 200, confirmed.text
    doc = client.get(f"/api/framework-interviews/{sid}/document", headers=HEADERS).json()
    assert "keep" not in doc["rows"][0]
    assert doc["rows"][0]["actions"][0]["label"] == "요청서 확인"


# --- G-11 정정 카드는 그 사이 다시 게시된 맵을 덮지 않는다 -----------------------------------------


def test_revise_card_is_blocked_when_the_map_was_published_again(client: TestClient, monkeypatch) -> None:
    sid, l5_id, code, task = _lock_revise(client, monkeypatch)
    chain = _chain(l5_id)

    async def _draw_from_snapshot() -> None:
        async with SessionLocal() as db:
            t = await db.get(FrameworkInterviewTask, task["id"])
            s = await db.get(FrameworkInterviewSession, sid)
            t.row = next(item["row"] for item in s.existing if item["code"] == code)
            t.status, t.issues, t.drawn_at = "drawn", [], now_kst()
            await db.commit()
    _run(_draw_from_snapshot())

    # 캠페인 도중 오너 쪽에서 새 게시본이 나간다
    _import(client, chain, [{"taskId": code, **_row("출하 검사", ["샘플 채취", "시험", "판정", "성적서 발행"])}])

    relations = {"entry": {"taskId": code, "triggerType": "manual"}, "edges": []}
    blocked = client.put(f"/api/framework-interviews/{sid}/relations", headers=HEADERS, json={"relations": relations})
    assert blocked.status_code == 409, blocked.text
    assert "출하 검사" in blocked.text

    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{task['id']}", headers=HEADERS).json()
    assert any(i["severity"] == "error" and "published again" in i["message"] for i in detail["issues"])

    async def _snapshot_labels() -> list[str]:
        async with SessionLocal() as db:
            s = await db.get(FrameworkInterviewSession, sid)
            row = next(item["row"] for item in s.existing if item["code"] == code)
            return [a["label"] for a in row["actions"]]
    # 다시 그리면 최신 게시본 기준 — 스냅샷이 새 게시본으로 바뀌어 있다
    assert _run(_snapshot_labels()) == ["샘플 채취", "시험", "판정", "성적서 발행"]
    reopened = client.post(f"/api/framework-interviews/{sid}/tasks/{task['id']}/reopen", headers=HEADERS)
    assert reopened.status_code == 200, reopened.text


# --- G-7 AI 빈 content ------------------------------------------------------------------------


class _NullContentResponse:
    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"choices": [{"message": {"content": None}}], "usage": {"prompt_tokens": 7, "completion_tokens": 0}}


class _NullContentClient:
    def __init__(self, timeout: int | None = None) -> None:
        pass

    async def __aenter__(self) -> "_NullContentClient":
        return self

    async def __aexit__(self, *args: object) -> bool:
        return False

    async def post(self, url: str, json: dict | None = None, headers: dict | None = None) -> _NullContentResponse:
        return _NullContentResponse()


def test_call_ai_turns_null_content_into_an_empty_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    """content null은 빈 응답으로 — 호출부의 무효 응답 처리(재시도·실패 표시·사용량 기록)를 그대로 탄다."""
    monkeypatch.setattr(settings, "ai_endpoints", "")
    monkeypatch.setattr(settings, "ai_base_url", "http://ai:8000/v1")
    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", _NullContentClient)
    reply = asyncio.run(ai_client.call_ai([{"role": "user", "content": "hi"}]))
    assert reply.content == "" and reply.prompt_tokens == 7


# --- G-10 맵 인터뷰 적용 대상 옮기기 --------------------------------------------------------------


def test_interview_retargets_to_the_current_draft_after_its_draft_was_published(client: TestClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    created = client.post("/api/maps", json={"owning_department": "Owning Anchor Division",
                                             "name": f"retarget {uuid4().hex[:6]}"}).json()
    first = created["versions"][0]["id"]
    iv = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": first}).json()
    assert iv["version_editable"] is True

    async def _publish_first() -> None:
        async with SessionLocal() as db:
            v = await db.get(MapVersion, first)
            v.status, v.version_number, v.checked_out_by = "published", 1, None
            await db.commit()
    _run(_publish_first())
    state = client.get(f"/api/interviews/{iv['id']}").json()
    assert state["version_editable"] is False
    assert client.post(f"/api/interviews/{iv['id']}/retarget").status_code == 409  # 옮길 Draft가 없다

    async def _new_draft() -> tuple[int, set[str]]:
        from app.routers.versions import clone_graph

        async with SessionLocal() as db:
            v = MapVersion(map_id=created["id"], label="v2", status="draft")
            db.add(v)
            await db.flush()
            source = await db.get(MapVersion, first)
            await db.refresh(source, ["nodes", "edges", "groups"])
            await clone_graph(db, source, v.id)
            await db.commit()
            ids = set((await db.scalars(select(Node.id).where(Node.version_id == v.id))).all())
            return v.id, ids
    second, second_ids = _run(_new_draft())
    moved = client.post(f"/api/interviews/{iv['id']}/retarget")
    assert moved.status_code == 200, moved.text
    assert (moved.json()["version_id"], moved.json()["version_editable"]) == (second, True)
    # 새 Draft는 복제라 id가 다르다 — 작업본 키가 같은 계보의 새 id로 옮겨져 적용 병합이 키로 잇는다
    keys = {n["key"] for n in moved.json()["working_graph"]["nodes"]}
    assert keys and keys <= second_ids
