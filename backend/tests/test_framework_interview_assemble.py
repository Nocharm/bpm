"""조립기 — task_id 채번·카테고리 체인·row 검증·0.5 문서가 어댑터를 이슈 0으로 통과 (spec §7)."""

import asyncio

from fastapi.testclient import TestClient

from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview.assemble import (
    allocate_task_ids, build_document, finalize_row_output, load_category_chain, load_existing_codes, validate_row,
)
from app.framework_interview.contracts import ROW_FIELD_KEYS, RowOut
from app.framework_interview.normalize import normalize_row
from app.models import ProcessMap
from scripts.consultant_interview import convert_interview

HEADERS = {"X-Dev-User": "admin.sys"}


def _make_l5(client: TestClient, tag: str) -> tuple[int, str]:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        assert "id" in node, node
        parent = node["id"]
    return node["id"], node["code"]


def test_allocate_task_ids_continues_after_max() -> None:
    assert allocate_task_ids("ui-abc", ["ui-abc-02", "ui-abc-07", "other-99"], 2) == ["ui-abc-08", "ui-abc-09"]
    assert allocate_task_ids("ui-abc", [], 1) == ["ui-abc-01"]


ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착", "input_data": "요청서", "output_data": "접수증"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action"},
        {"seq": 2, "label": "완결성 판정", "kind": "decision"},
        {"seq": 3, "label": "접수 등록", "kind": "action"},
    ],
    "relations": {"edges": [
        {"src": 1, "dst": 2, "kind": "seq"},
        {"src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "완결"},
        {"src": 2, "dst": 1, "kind": "loop", "condition": "보완 필요"},
    ]},
}


def test_document_passes_adapter_without_errors(client: TestClient) -> None:
    l5_id, l5_code = _make_l5(client, "asm")

    async def _chain() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)

    chain = asyncio.run(_chain())
    assert [c["level"] for c in chain] == [1, 2, 3, 4, 5]
    assert chain[-1]["code"] == l5_code and chain[0]["parent"] is None
    l5 = {"label": chain[-1]["name"], "nodeCode": l5_code}
    task_id = f"{l5_code}-01"
    rows = [{"taskId": task_id, **ROW}]
    relations = {"entry": {"taskId": task_id, "triggerType": "manual", "label": "시작"}, "edges": []}
    doc = build_document(chain, l5, rows, relations, label="t", session_id=1)
    assert doc["schema_version"] == "0.5-bpm-interface-draft"
    result = convert_interview(doc)
    assert not result.has_error(), [i.message for i in result.issues]
    assert [m.code for m in result.maps] == [task_id]
    assert validate_row(chain, l5, rows[0]) == [
        i for i in validate_row(chain, l5, rows[0]) if i["severity"] != "error"
    ]


def test_existing_codes_reserve_trashed_maps(client: TestClient) -> None:
    """휴지통 맵의 코드도 채번에서 비켜간다 — 임포터가 소프트삭제 맵의 코드를 거절하기 때문."""
    l5_id, l5_code = _make_l5(client, "trash")

    async def _seed_and_load() -> list[str]:
        async with SessionLocal() as db:
            db.add(ProcessMap(name="trashed", category_id=l5_id,
                              consultant_code=f"{l5_code}-03", deleted_at=now_kst()))
            await db.commit()
            return await load_existing_codes(db, l5_id)

    codes = asyncio.run(_seed_and_load())
    assert f"{l5_code}-03" in codes
    assert allocate_task_ids(l5_code, codes, 1) == [f"{l5_code}-04"]


def test_every_contract_field_survives_the_ai_gate_and_lands_in_the_adapter(client: TestClient) -> None:
    """프롬프트 fields 한 벌(ROW_FIELD_KEYS)이 normalize_row를 지나 어댑터에 모르는 키 없이 착지한다."""
    # Arrange — 모델이 낼 법한 모양(분 정수·숫자·IO 배열)
    l5_id, l5_code = _make_l5(client, "asmfull")

    async def _chain() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)
    chain = asyncio.run(_chain())
    raw_fields = {
        "start_condition": "요청서 도착", "input_data": ["요청서", "첨부"], "output_data": "접수증",
        "done_criteria": "접수증 발급", "systems": "ERP", "frequency": "주 2회",
        "total_time": "반나절", "total_time_min": 90, "touch_time": "45분", "touch_time_min": 45,
        "annual_count": 100, "headcount": 2, "fte": 0.5, "gmp": "GMP 대상", "artifact_role": "접수 기록",
    }
    assert set(raw_fields) == set(ROW_FIELD_KEYS)

    # Act
    row = RowOut.model_validate(normalize_row({**ROW, "fields": raw_fields})).model_dump(exclude_none=True)
    task_id = f"{l5_code}-01"
    doc = build_document(chain, {"label": chain[-1]["name"], "nodeCode": l5_code},
                         [{"taskId": task_id, **row}], None, label="t", session_id=1)
    result = convert_interview(doc)

    # Assert
    assert set(row["fields"]) == set(ROW_FIELD_KEYS)
    assert not [i.message for i in result.issues if "unknown key" in i.message or "not a number" in i.message]
    params = result.maps[0].params
    assert (params.duration, params.touch_time) == ("1.30", "0.45")
    assert params.input == "요청서\n첨부"


# 이전 행: 접수에서 검토·보관으로 동시에 가는 병행 갈래
PARALLEL_PREVIOUS = {
    "actions": [{"seq": 1, "label": "접수"}, {"seq": 2, "label": "검토"}, {"seq": 3, "label": "보관"}],
    "relations": {"edges": [
        {"src": 1, "dst": 2, "kind": "branch", "gateway": "parallel"},
        {"src": 1, "dst": 3, "kind": "branch", "gateway": "parallel"},
    ]},
}


def _gateways_after_finalize(actions: list[dict], edges: list[dict]) -> list[str | None]:
    out = RowOut.model_validate({"l6": "x", "actions": actions, "relations": {"edges": edges}})
    row = finalize_row_output(out, {}, PARALLEL_PREVIOUS)
    return [edge.get("gateway") for edge in row["relations"]["edges"]]


def test_finalize_restores_parallel_when_the_whole_branch_group_lost_its_gateway() -> None:
    """모델이 갈래 묶음 전체에서 표시만 빠뜨리면 이전 행의 parallel을 잇는다 (seq가 밀려도 label 기준)."""
    # Arrange
    actions = [{"seq": 1, "label": "사전 확인"}, {"seq": 2, "label": "접수"},
               {"seq": 3, "label": "검토"}, {"seq": 4, "label": "보관"}]
    edges = [{"src": 1, "dst": 2, "kind": "seq"},
             {"src": 2, "dst": 3, "kind": "branch"}, {"src": 2, "dst": 4, "kind": "branch"}]

    # Act
    gateways = _gateways_after_finalize(actions, edges)

    # Assert
    assert gateways == [None, "parallel", "parallel"]


def test_finalize_keeps_a_mixed_branch_group_as_the_model_wrote_it() -> None:
    """형제 하나라도 gateway를 적었으면 묶음 전체를 모델 판단으로 둔다 — parallel·exclusive 혼재 행 금지."""
    # Arrange
    actions = [{"seq": 1, "label": "접수"}, {"seq": 2, "label": "검토"}, {"seq": 3, "label": "보관"}]
    edges = [{"src": 1, "dst": 2, "kind": "branch"},
             {"src": 1, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "바뀜"}]

    # Act
    gateways = _gateways_after_finalize(actions, edges)

    # Assert
    assert gateways == [None, "exclusive"]


def test_finalize_skips_restore_when_a_new_branch_joins_the_group() -> None:
    """이전에 없던 갈래가 섞이면 묶음이 한 값으로 풀리지 않아 잇지 않는다 — 일부만 parallel인 행 금지."""
    # Arrange
    actions = [{"seq": 1, "label": "접수"}, {"seq": 2, "label": "검토"},
               {"seq": 3, "label": "보관"}, {"seq": 4, "label": "통보"}]
    edges = [{"src": 1, "dst": 2, "kind": "branch"}, {"src": 1, "dst": 3, "kind": "branch"},
             {"src": 1, "dst": 4, "kind": "branch"}]

    # Act
    gateways = _gateways_after_finalize(actions, edges)

    # Assert
    assert gateways == [None, None, None]


def test_finalize_does_not_restore_parallel_from_a_decision_source() -> None:
    """출발 활동을 decision으로 바꿨으면 택일로 다시 정한 것이라 병행 표시를 잇지 않는다."""
    # Arrange
    actions = [{"seq": 1, "label": "접수", "kind": "decision"}, {"seq": 2, "label": "검토"}, {"seq": 3, "label": "보관"}]
    edges = [{"src": 1, "dst": 2, "kind": "branch"}, {"src": 1, "dst": 3, "kind": "branch"}]

    # Act
    gateways = _gateways_after_finalize(actions, edges)

    # Assert
    assert gateways == [None, None]
