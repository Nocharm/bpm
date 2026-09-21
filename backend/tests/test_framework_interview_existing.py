"""기존 L6 맵 → 인터뷰 행 역변환 + 계획 카드 병합 (spec 2026-09-22 §2.1·§2.3)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.framework_interview.assemble import build_document, load_category_chain, validate_row
from app.framework_interview.existing import existing_row_of, load_existing_l6, map_to_row, merge_existing_cards
from app.models import Edge, MapVersion, Node, ProcessMap

HEADERS = {"X-Dev-User": "admin.sys"}

ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착", "done_criteria": "접수증 발급"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action", "name": "요청서 내용 확인", "rule": "양식 A", "system": "ERP"},
        {"seq": 2, "label": "완결성 판정", "kind": "decision"},
        {"seq": 3, "label": "접수 등록", "kind": "action", "variant": "exception"},
        {"seq": 4, "label": "부서 전달", "kind": "handoff", "input": "접수증", "output": "전달 메일"},
    ],
    "relations": {"edges": [
        {"src": 1, "dst": 2, "kind": "seq"},
        {"src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "완결"},
        {"src": 2, "dst": 1, "kind": "loop", "condition": "보완 필요"},
        {"src": 3, "dst": 4, "kind": "seq"},
    ]},
}


def _make_l5(client: TestClient, tag: str) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    return node["id"]


def _import_row(client: TestClient, l5_id: int, row: dict, task_id: str) -> None:
    async def _chain() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)
    chain = asyncio.run(_chain())
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    doc = build_document(chain, l5, [{"taskId": task_id, **row}], None, label="t", session_id=0)
    res = client.post("/api/categories/import-interview", headers=HEADERS,
                      json={"files": [{"name": "a.json", "content": doc}], "apply": True})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["applied"] is True and body["files"][0]["ok"] is True, body["files"]


def test_map_to_row_round_trips_imported_map(client: TestClient) -> None:
    l5_id = _make_l5(client, "ex")

    async def _code() -> str:
        async with SessionLocal() as db:
            chain = await load_category_chain(db, l5_id)
            return chain[-1]["code"]
    task_id = f"{asyncio.run(_code())}-01"
    _import_row(client, l5_id, ROW, task_id)

    async def _load() -> list[dict]:
        async with SessionLocal() as db:
            return await load_existing_l6(db, l5_id)
    existing = asyncio.run(_load())
    assert [e["code"] for e in existing] == [task_id]
    got = existing[0]
    assert got["name"] == "요청 접수"
    assert got["activities"] == ["요청 확인", "완결성 판정", "접수 등록", "부서 전달"]
    row = got["row"]
    assert row["l6"] == "요청 접수"
    assert row["ownerRole"] == "담당자"
    assert row["fields"] == {"start_condition": "요청서 도착", "done_criteria": "접수증 발급"}
    assert [(a["seq"], a["label"], a["kind"]) for a in row["actions"]] == [
        (1, "요청 확인", "action"), (2, "완결성 판정", "decision"), (3, "접수 등록", "action"), (4, "부서 전달", "handoff")]
    assert row["actions"][0]["name"] == "요청서 내용 확인"
    assert row["actions"][0]["rule"] == "양식 A"
    # 시스템은 왕복하지 않는다 — 임포터가 카탈로그(commit_system)로 정규화해 미등록 값은 Other가 되고
    # 원문은 node.system_fallback에 남는다. 역변환은 맵에 저장된 값을 그대로 읽는다
    assert row["actions"][0]["system"] == "Other"
    assert "name" not in row["actions"][2]
    assert row["actions"][2]["variant"] == "exception"
    assert row["actions"][3]["input"] == "접수증" and row["actions"][3]["output"] == "전달 메일"
    kinds = {(e["src"], e["dst"]): e["kind"] for e in row["relations"]["edges"]}
    assert kinds[(1, 2)] == "seq" and kinds[(2, 3)] == "branch" and kinds[(2, 1)] == "loop" and kinds[(3, 4)] == "seq"
    branch = next(e for e in row["relations"]["edges"] if (e["src"], e["dst"]) == (2, 3))
    assert branch["condition"] == "완결" and branch["gateway"] == "exclusive"

    async def _issues() -> list[dict]:
        async with SessionLocal() as db:
            chain = await load_category_chain(db, l5_id)
            return validate_row(chain, {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}, {"taskId": task_id, **row})
    assert [i for i in asyncio.run(_issues()) if i["severity"] == "error"] == []
    assert existing_row_of(existing, task_id) is row
    assert existing_row_of(existing, "nope") is None


def test_load_existing_skips_trashed_and_codeless_maps(client: TestClient) -> None:
    l5_id = _make_l5(client, "ex2")

    async def _seed() -> None:
        async with SessionLocal() as db:
            from app.clock import now

            # 게시본까지 붙여야 필터가 실제로 검증된다 — 버전 없는 맵은 어차피 제외된다
            trashed = ProcessMap(name="trashed", category_id=l5_id, consultant_code="ex2-trash", deleted_at=now())
            codeless = ProcessMap(name="manual", category_id=l5_id, consultant_code=None)
            db.add_all([trashed, codeless])
            await db.flush()
            db.add_all([
                MapVersion(map_id=trashed.id, label="v1", status="published"),
                MapVersion(map_id=codeless.id, label="v1", status="published"),
            ])
            await db.commit()
    asyncio.run(_seed())

    async def _load() -> list[dict]:
        async with SessionLocal() as db:
            return await load_existing_l6(db, l5_id)
    assert asyncio.run(_load()) == []


def test_map_to_row_pure_shape() -> None:
    # 순수 함수 검증(DB 없음): 게시본 선택은 load_existing_l6 몫이고 map_to_row는 노드/엣지만 본다
    nodes = [
        Node(id="s", version_id=1, title="Start", node_type="start", sort_order=0),
        Node(id="a", version_id=1, title="A", node_type="process", sort_order=1, description="이름\n\nRule: r1\nKind: handoff"),
        Node(id="b", version_id=1, title="B", node_type="decision", sort_order=2),
        Node(id="c", version_id=1, title="C", node_type="process", sort_order=3, color="#c2849a", assignee_role="검토자"),
        Node(id="e", version_id=1, title="End", node_type="end", sort_order=4),
    ]
    edges = [
        Edge(id="1", version_id=1, source_node_id="s", target_node_id="a"),
        Edge(id="2", version_id=1, source_node_id="a", target_node_id="b"),
        Edge(id="3", version_id=1, source_node_id="b", target_node_id="c", label="예", gateway="exclusive"),
        Edge(id="4", version_id=1, source_node_id="b", target_node_id="a", label="아니오"),
        Edge(id="5", version_id=1, source_node_id="c", target_node_id="e"),
    ]
    row = map_to_row("맵", "품질팀", nodes, edges)
    assert row["department"] == "품질팀" and row["ownerRole"] == "검토자"
    assert [a["kind"] for a in row["actions"]] == ["handoff", "decision", "action"]
    assert row["actions"][0]["name"] == "이름" and row["actions"][0]["rule"] == "r1"
    assert row["actions"][2]["variant"] == "exception"
    # 엣지는 (src seq, dst seq) 순으로 정렬돼 나온다
    assert [(e["src"], e["dst"], e["kind"]) for e in row["relations"]["edges"]] == [
        (1, 2, "seq"), (2, 1, "loop"), (2, 3, "branch")]


def test_merge_existing_cards_keeps_every_existing_map_once() -> None:
    existing = [
        {"map_id": 1, "code": "x-01", "name": "접수", "summary": "s1", "activities": ["a"], "row": {}},
        {"map_id": 2, "code": "x-02", "name": "검토", "summary": "s2", "activities": ["b"], "row": {}},
    ]
    cards = [
        {"name": "검토 ", "summary": "", "owner_role": "", "department": "", "depends_on": [], "mode": "revise", "existing_code": "x-02"},
        {"name": "신규", "summary": "", "owner_role": "", "department": "", "depends_on": [], "existing_code": "ghost"},
        {"name": "접수", "summary": "", "owner_role": "", "department": "", "depends_on": []},
    ]
    merged = merge_existing_cards(cards, existing)
    by_name = {c["name"].strip(): c for c in merged}
    assert by_name["접수"]["mode"] == "keep" and by_name["접수"]["existing_code"] == "x-01"
    assert by_name["검토"]["mode"] == "revise" and by_name["검토"]["existing_code"] == "x-02"
    assert by_name["신규"]["mode"] == "new" and by_name["신규"]["existing_code"] is None
    assert len(merged) == 3

    # 기존 카드를 지워도 되살아난다(앞쪽, 기존 순서)
    merged2 = merge_existing_cards([{"name": "신규", "summary": "", "owner_role": "", "department": "", "depends_on": []}], existing)
    assert [c["name"] for c in merged2] == ["접수", "검토", "신규"]
    assert merged2[0]["mode"] == "keep" and merged2[0]["summary"] == "s1"
