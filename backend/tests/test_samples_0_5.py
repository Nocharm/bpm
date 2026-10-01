"""저장소 인터뷰 샘플(0.5) 규격 고정 — 7파일 error 0·의도 경고만·L6 ≥4·행마다 loop+branch·externalTasks 전부
참조·스모크 앵커 보존 (spec 2026-09-07 §8). 샘플을 고치면 이 테스트가 규격 이탈을 잡는다."""

import json
from pathlib import Path

import pytest

from scripts.consultant_interview import LOOP_BRANCH_NODE_NAME, convert_interview

SAMPLES = Path(__file__).resolve().parents[2] / "docs" / "samples"
FILES = sorted((SAMPLES / "consultant-interview-sample").glob("*.json")) + sorted(
    (SAMPLES / "framework-linkage-dummy").glob("*.json"))
# 파일별 의도된 warning 부분 문자열 — 그 외 warning은 규격 이탈
INTENDED_WARNINGS: dict[str, list[str]] = {
    "qc-raw-material-l5.json": ["external L5 '22-01-01-01-01' not in framework.categories"],
    # 활동에서 건너뛰기+다음 단계가 나가는 택일 — "{활동} 결과" ◇ 자동 생성 시연(대체 표준기 선정)
    "calibration-l5.json": ["auto-generated branch node a03f"],
}
# 모든 샘플 공통 의도 경고 — 샘플은 행마다 loop를 싣고(규격), 되돌아가기+다음 단계가 한 활동에서 나가면
# 어댑터가 뒤에 "반복 여부" ◇를 자동 생성한다(출력 규칙 2026-10-01). 변환 안내라 규격 이탈이 아니다.
# 반복 이름으로만 좁힌다 — 병행 갈래가 다른 연결과 섞여 "{활동} 결과" ◇로 접히는 회귀를 잡기 위해
COMMON_INTENDED_WARNINGS = [LOOP_BRANCH_NODE_NAME]


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_sample_converts_without_errors_or_unintended_warnings(path: Path) -> None:
    res = convert_interview(_load(path))
    errors = [(i.path, i.message) for i in res.issues if i.severity == "error"]
    assert not errors, errors
    allowed = [*INTENDED_WARNINGS.get(path.name, []), *COMMON_INTENDED_WARNINGS]
    unexpected = [(i.path, i.message) for i in res.issues
                  if i.severity == "warning" and not any(a in i.message for a in allowed)]
    assert not unexpected, unexpected
    # 병행 갈래가 ◇ 없이 출발 활동의 병렬 출구로 착지하는 시연이 파일마다 하나 이상 있다
    assert any(n.parallel for m in res.maps for n in m.nodes), path.name


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_sample_shape_meets_the_0_5_spec(path: Path) -> None:
    doc = _load(path)
    assert doc["schema_version"].startswith("0.5")
    rows = doc["rows"]
    assert len(rows) >= 4
    for row in rows:
        # actions IO는 문자열 배열이 정본(2026-09-23) — fields.input_data/output_data는 문자열 그대로
        for action in row["actions"]:
            assert isinstance(action["input"], list) and isinstance(action["output"], list), (
                row["taskId"], action["seq"])
        kinds = [e["kind"] for e in row["relations"]["edges"]]
        assert "loop" in kinds, row["taskId"]
        assert "branch" in kinds, row["taskId"]
        assert any(a["kind"] == "decision" for a in row["actions"]), row["taskId"]
        assert len(row["actions"]) >= 6, row["taskId"]
    top = doc["relations"]["edges"]
    assert {"branch", "loop"} <= {e["kind"] for e in top}
    refs = {t["refId"] for t in doc["externalTasks"]}
    assert refs
    assert refs <= {e["src"] for e in top} | {e["dst"] for e in top}
    text = json.dumps(doc, ensure_ascii=False)
    for needle in ('"gateway": "parallel"', '"kind": "bypass"', '"variant": "exception"', '"kind": "handoff"'):
        assert needle in text, f"{path.name} lacks {needle}"


def test_calibration_keeps_smoke_anchors() -> None:
    doc = _load(SAMPLES / "consultant-interview-sample" / "calibration-l5.json")
    row = next(r for r in doc["rows"] if r["taskId"] == "smp-cal-task-0001")
    assert row["l6"] == "교정 준비" and row["owner"] is None
    assert row["actions"][0]["input"] == ["그 주 작업지시"]
    assert row["actions"][0]["output"] == ["대상 계측기와 측정 범위"]
    assert row["fields"]["annual_count"] == 52 and row["fields"]["artifact_role"] == "deliverable"
    assert row["fields"]["start_condition"].startswith("교정 주기 도래")
    util = _load(SAMPLES / "consultant-interview-sample" / "utility-l5.json")
    assert util["rows"][0]["taskId"] == "smp-util-task-0001" and util["rows"][0]["owner"] is None


def _load_set(names: list[str]) -> list[dict]:
    folder = SAMPLES / "framework-linkage-dummy"
    return [{"name": n, "content": _load(folder / n)} for n in names]


def _canvas_nodes(client, l5_code: str) -> tuple[list[dict], list[dict], dict]:
    import asyncio

    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import ProcessCategory

    async def _canvas():
        async with SessionLocal() as session:
            cat = await session.scalar(select(ProcessCategory).where(ProcessCategory.code == l5_code))
            return cat.linkage_map_id, cat.name
    map_id, home_name = asyncio.run(_canvas())
    detail = client.get(f"/api/maps/{map_id}").json()
    draft = next(v for v in detail["versions"] if v["status"] == "draft")
    graph = client.get(f"/api/versions/{draft['id']}/graph").json()
    sp = [n for n in graph["nodes"] if n["node_type"] == "subprocess"]
    refs = graph["subprocess_refs"]
    # 연결된 노드 중 외부(타 L5) L6만 — 링크맵 카테고리 경로가 홈 L5 이름으로 끝나지 않는 것
    external_linked = [
        n for n in sp if n["linked_map_id"] is not None
        and not (refs.get(str(n["linked_map_id"])) or {}).get("category_path", "").endswith(home_name)
    ]
    return [n for n in sp if n["linked_map_id"] is None], external_linked, graph


def test_linkage_dummy_set_scenarios_end_to_end(client) -> None:
    """B 세트: qa-deviation 없이 4파일 → 플레이스홀더, 그 뒤 qa-deviation 전달 → 이름 경로 후차 해소 (spec 2026-09-07 §8)."""
    first = ["qc-raw-material-l5.json", "qc-finished-product-l5.json", "change-control-l5.json", "brr-l5.json"]
    res = client.post("/api/categories/import-interview",
                      json={"files": _load_set(first), "apply": True, "label": "B-1"})
    assert res.status_code == 200, res.text
    assert all(f["ok"] for f in res.json()["files"]), res.json()["files"]

    # qc-raw-material: OOS 접수(qa-deviation 미전달 → 출처 있는 플레이스홀더) + 구매 L5(계보 없음 → 출처 없음)
    ph, linked, _ = _canvas_nodes(client, "20-01-01-01-01")
    titles = {n["title"]: n for n in ph}
    assert titles["OOS 접수 및 초동 평가"]["placeholder_category_id"] is not None
    assert titles["입고 검수"]["placeholder_category_id"] is None
    # qc-finished-product: brr 정확 일치 직결, OOS(공백 변형)는 플레이스홀더(qa-deviation 미전달)
    ph, linked, _ = _canvas_nodes(client, "20-01-01-02-01")
    assert "검토 접수 및 배치 편성" in {n["title"] for n in linked}
    assert "OOS접수 및 초동평가" in {n["title"] for n in ph}
    # change-control: brr 직결 1 + 일탈 종결 플레이스홀더 1 / brr: fp 직결 1 + 일탈 종결 플레이스홀더 1
    ph_cc, linked_cc, _ = _canvas_nodes(client, "21-03-02-01-01")
    assert len(linked_cc) == 1 and len(ph_cc) == 1
    ph_brr, linked_brr, _ = _canvas_nodes(client, "21-06-01-01-01")
    assert len(linked_brr) == 1 and len(ph_brr) == 1

    res2 = client.post("/api/categories/import-interview",
                       json={"files": _load_set(["qa-deviation-oos-l5.json"]), "apply": True, "label": "B-2"})
    assert res2.status_code == 200, res2.text
    assert res2.json()["files"][0]["ok"], res2.json()["files"][0]
    # 후차 해소: OOS 접수(정확·공백 변형) 2 + 일탈 종결 2 = 4
    assert any(r["detail"] == "resolved 4 external placeholder node(s)" for r in res2.json()["rows"])
    ph, _, _ = _canvas_nodes(client, "20-01-01-01-01")
    assert [n["title"] for n in ph] == ["입고 검수"]  # 출처 없는 것만 남는다
    assert _canvas_nodes(client, "20-01-01-02-01")[0] == []
    assert _canvas_nodes(client, "21-03-02-01-01")[0] == [] and _canvas_nodes(client, "21-06-01-01-01")[0] == []
    # qa-deviation 자신의 캔버스: 변경관리 근사 불일치 플레이스홀더(출처=변경관리 L5) + unnamed CAPA 플레이스홀더
    ph_qa, linked_qa, _ = _canvas_nodes(client, "20-02-01-01-01")
    by_title = {n["title"]: n for n in ph_qa}
    assert by_title["변경요청 접수"]["placeholder_category_id"] is not None
    assert any(t.startswith("(L6 unspecified) ") for t in by_title)
    assert linked_qa == []
