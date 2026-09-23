"""기존 L6 맵 → 인터뷰 행 역변환 + 계획 카드 병합 (spec 2026-09-22 §2.1·§2.3)."""

import asyncio
import json

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.app_settings import SYSTEMS_KEY
from app.db import SessionLocal
from app.framework_interview.assemble import build_document, load_category_chain, validate_row
from app.framework_interview.existing import existing_row_of, load_existing_l6, map_to_row, merge_existing_cards
from app.models import AppSetting, Edge, MapVersion, Node, ProcessMap

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


def _import_row(client: TestClient, l5_id: int, row: dict, task_id: str) -> dict:
    """행 1건을 인터뷰 문서로 감싸 임포트하고 리포트를 돌려준다(재임포트 action 검증용)."""
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
    return body


def _action_of(report: dict, code: str) -> str:
    """리포트에서 그 맵의 결과 행 — warning 행은 결과가 아니라 주석이라 건너뛴다."""
    return next(r["action"] for r in report["rows"] if r["code"] == code and r["action"] != "warning")


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
    # 임포터가 카탈로그(commit_system)로 정규화해 미등록 값은 Other + 원문 메모가 된다 —
    # 역변환은 메모를 되살려 정정 설문이 'Other'를 되묻지 않게 한다
    assert row["actions"][0]["system"] == "ERP"
    assert "name" not in row["actions"][2]
    assert row["actions"][2]["variant"] == "exception"
    assert row["actions"][3]["input"] == ["접수증"] and row["actions"][3]["output"] == ["전달 메일"]
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
        Node(id="c", version_id=1, title="C", node_type="process", sort_order=3, color="#c2849a", assignee_role="검토자",
             system="Other", system_fallback="SAP"),
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
    # 카탈로그 미등록 시스템은 Other로 저장된다 — 원문 메모를 되살린다
    assert row["actions"][2]["system"] == "SAP"
    # 엣지는 (src seq, dst seq) 순으로 정렬돼 나온다
    assert [(e["src"], e["dst"], e["kind"]) for e in row["relations"]["edges"]] == [
        (1, 2, "seq"), (2, 1, "loop"), (2, 3, "branch")]


def test_map_to_row_returns_io_as_lists() -> None:
    nodes = [
        Node(id="s", version_id=1, title="Start", node_type="start", sort_order=0),
        Node(id="a", version_id=1, title="A", node_type="process", sort_order=1,
             input="요청서\n첨부", output="접수증"),
        Node(id="e", version_id=1, title="End", node_type="end", sort_order=2),
    ]
    edges = [
        Edge(id="1", version_id=1, source_node_id="s", target_node_id="a"),
        Edge(id="2", version_id=1, source_node_id="a", target_node_id="e"),
    ]
    row = map_to_row("맵", None, nodes, edges)
    assert row["actions"][0]["input"] == ["요청서", "첨부"]
    assert row["actions"][0]["output"] == ["접수증"]


def test_map_to_row_folds_auto_generated_loop_branch_node() -> None:
    # 어댑터가 self edge를 그리려고 세운 분기 노드(◇)는 행에 되돌리지 않는다 — A→◇→A는 A→A로,
    # ◇로 이설됐던 A의 원래 진출(◇→B)은 A→B로 접힌다
    from scripts.consultant_interview import LOOP_BRANCH_NODE_NAME

    nodes = [
        Node(id="s", version_id=1, title="Start", node_type="start", sort_order=0),
        Node(id="a", version_id=1, title="A", node_type="process", sort_order=1),
        Node(id="r", version_id=1, title=LOOP_BRANCH_NODE_NAME, node_type="decision", sort_order=2),
        Node(id="b", version_id=1, title="B", node_type="process", sort_order=3),
        Node(id="e", version_id=1, title="End", node_type="end", sort_order=4),
    ]
    edges = [
        Edge(id="1", version_id=1, source_node_id="s", target_node_id="a"),
        Edge(id="2", version_id=1, source_node_id="a", target_node_id="r"),
        Edge(id="3", version_id=1, source_node_id="r", target_node_id="a", label="보완 필요"),
        Edge(id="4", version_id=1, source_node_id="r", target_node_id="b"),
        Edge(id="5", version_id=1, source_node_id="b", target_node_id="e"),
    ]
    row = map_to_row("맵", None, nodes, edges)
    assert [(a["seq"], a["label"]) for a in row["actions"]] == [(1, "A"), (2, "B")]
    assert row["relations"]["edges"] == [
        {"src": 1, "dst": 1, "kind": "loop", "condition": "보완 필요"},
        {"src": 1, "dst": 2, "kind": "seq"},
    ]


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


FULL_FIELDS_ROW = {
    "l6": "품질 점검", "ownerRole": "담당자", "department": "",
    "fields": {
        "start_condition": "점검 요청 접수", "done_criteria": "점검 보고서 발행",
        "input_data": "점검 요청서", "output_data": "점검 보고서",
        "systems": "LIMS",
        "total_time_min": 90, "touch_time_min": 45,
        "total_time": "반나절", "touch_time": "45분 내외",
        "frequency": "주 2회", "headcount": 2, "annual_count": 120, "fte": 0.5,
        "gmp": "GMP 대상", "artifact_role": "품질 기록",
    },
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action"},
        {"seq": 2, "label": "점검 수행", "kind": "action"},
    ],
    "relations": {"edges": [{"src": 1, "dst": 2, "kind": "seq"}]},
}


def _l5_code(client: TestClient, l5_id: int) -> str:
    return client.get(f"/api/categories/{l5_id}/chain", headers=HEADERS).json()[-1]["code"]


def _load_existing(l5_id: int) -> list[dict]:
    async def _run() -> list[dict]:
        async with SessionLocal() as db:
            return await load_existing_l6(db, l5_id)
    return asyncio.run(_run())


def _load_map(code: str) -> ProcessMap:
    async def _run() -> ProcessMap:
        async with SessionLocal() as db:
            return (await db.scalars(select(ProcessMap).where(ProcessMap.consultant_code == code))).one()
    return asyncio.run(_run())


def test_keep_row_carries_every_map_field(client: TestClient) -> None:
    """유지 행은 맵 컬럼에 흩어진 fields를 전부 싣는다 — 빠지면 재임포트가 sp_* 를 지운다 (review 2026-09-22 #1)."""
    l5_id = _make_l5(client, "exfull")
    task_id = f"{_l5_code(client, l5_id)}-01"
    _import_row(client, l5_id, FULL_FIELDS_ROW, task_id)

    row = _load_existing(l5_id)[0]["row"]
    assert row["fields"] == {
        "start_condition": "점검 요청 접수", "done_criteria": "점검 보고서 발행",
        "input_data": "점검 요청서", "output_data": "점검 보고서",
        # 카탈로그 미등록 → Other + 원문 메모로 저장되므로 메모를 되살린다
        "systems": "LIMS",
        "total_time_min": 90, "touch_time_min": 45,
        "total_time": "반나절", "touch_time": "45분 내외",
        "frequency": "주 2회", "headcount": "2", "annual_count": "120", "fte": "0.5",
        "gmp": "GMP 대상", "artifact_role": "품질 기록",
    }

    # 유지 행을 그대로 다시 넣으면 무변경이어야 한다(그래프·맵 필드 양쪽)
    report = _import_row(client, l5_id, row, task_id)
    assert _action_of(report, task_id) == "unchanged", report["rows"]
    m = _load_map(task_id)
    assert (m.sp_input, m.sp_output, m.sp_duration, m.sp_touch_time) == (
        "점검 요청서", "점검 보고서", "1.30", "0.45")
    assert (m.sp_headcount, m.sp_annual_count, m.sp_fte) == ("2", "120", "0.5")
    assert (m.sp_system, m.sp_system_fallback) == ("Other", "LIMS")
    assert (m.sp_total_time_fallback, m.sp_touch_time_fallback) == ("반나절", "45분 내외")
    assert (m.sp_frequency_fallback, m.sp_gmp_fallback) == ("주 2회", "GMP 대상")


def _set_system_catalog(entries: list[dict] | None) -> None:
    """시스템 카탈로그 행을 세우거나 지운다 — 테스트 DB는 세션 스코프라 쓴 뒤 반드시 되돌린다."""
    async def _run() -> None:
        async with SessionLocal() as db:
            row = await db.get(AppSetting, SYSTEMS_KEY)
            if entries is None:
                if row is not None:
                    await db.delete(row)
            elif row is None:
                db.add(AppSetting(key=SYSTEMS_KEY, value=json.dumps(entries)))
            else:
                row.value = json.dumps(entries)
            await db.commit()
    asyncio.run(_run())


def test_keep_row_returns_the_alias_the_catalog_normalized_away(client: TestClient) -> None:
    """별칭 전달분은 별칭 원문으로 되돌린다 — 정식 표기를 돌려주면 폴백이 덮여 무변경이 '변경'이 된다 (review #5)."""
    _set_system_catalog([{"value": "SAP ERP", "aliases": ["SAP"]}])
    try:
        l5_id = _make_l5(client, "exalias")
        task_id = f"{_l5_code(client, l5_id)}-01"
        aliased = {**ROW, "fields": {**ROW["fields"], "systems": "SAP"},
                   "actions": [{"seq": 1, "label": "전표 입력", "kind": "action", "system": "SAP"}],
                   "relations": {"edges": []}}
        _import_row(client, l5_id, aliased, task_id)

        # 노드(그래프 서명)와 맵 지정값(sp_system_fallback) 양쪽이 같은 규칙을 따른다
        row = _load_existing(l5_id)[0]["row"]
        assert row["actions"][0]["system"] == "SAP"
        assert row["fields"]["systems"] == "SAP"
        assert (_load_map(task_id).sp_system, _load_map(task_id).sp_system_fallback) == ("SAP ERP", "SAP")
        assert _action_of(_import_row(client, l5_id, row, task_id), task_id) == "unchanged"
    finally:
        _set_system_catalog(None)


def _seed_map_with_subprocess(l5_id: int, code: str) -> None:
    async def _run() -> None:
        async with SessionLocal() as db:
            m = ProcessMap(name="링크 보유 맵", category_id=l5_id, consultant_code=code)
            db.add(m)
            await db.flush()
            version = MapVersion(map_id=m.id, label="v1", status="published")
            db.add(version)
            await db.flush()
            db.add_all([
                Node(id=f"{code}-a", version_id=version.id, title="활동", node_type="process", sort_order=1),
                Node(id=f"{code}-sp", version_id=version.id, title="하위 맵", node_type="subprocess", sort_order=2),
            ])
            await db.commit()
    asyncio.run(_run())


def test_load_existing_freezes_maps_with_subprocess_nodes(client: TestClient) -> None:
    """하위 맵 링크가 있는 캔버스는 역변환이 링크를 떨어뜨린다 — 행 없이 동결해 재게시 대상에서 뺀다 (review #3)."""
    l5_id = _make_l5(client, "exfrozen")
    _seed_map_with_subprocess(l5_id, "exfrozen-01")

    item = _load_existing(l5_id)[0]
    assert item["frozen"] is True
    assert item["row"] is None and item["activities"] == []
    assert item["name"] == "링크 보유 맵"
    assert existing_row_of([item], "exfrozen-01") is None


def test_merge_existing_cards_drops_frozen_maps() -> None:
    """동결 맵은 카드를 만들지도, AI가 만든 중복 카드를 남기지도 않는다 (review #3)."""
    existing = [
        {"map_id": 1, "code": "x-01", "name": "접수", "summary": "s1", "activities": ["a"], "row": {}},
        {"map_id": 2, "code": "x-09", "name": "링크 보유", "summary": "s9", "activities": [],
         "row": None, "frozen": True},
    ]
    cards = [
        {"name": "링크 보유", "summary": "", "owner_role": "", "department": "", "depends_on": []},
        {"name": "다른 이름", "summary": "", "owner_role": "", "department": "", "depends_on": [],
         "existing_code": "x-09"},
        {"name": "신규", "summary": "", "owner_role": "", "department": "", "depends_on": []},
    ]
    merged = merge_existing_cards(cards, existing)
    assert [(c["name"], c["mode"]) for c in merged] == [("접수", "keep"), ("신규", "new")]
