"""조립기 — task_id 채번·카테고리 체인·row 검증·0.5 문서가 어댑터를 이슈 0으로 통과 (spec §7)."""

import asyncio

from fastapi.testclient import TestClient

from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview.assemble import (
    allocate_task_ids, build_document, load_category_chain, load_existing_codes, validate_row,
)
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
