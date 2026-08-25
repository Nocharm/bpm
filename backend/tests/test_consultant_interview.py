"""인터뷰 결과 JSON 어댑터 — 키 검증·canonical 변환·노트 추출.

설계: docs/design/2026-08-18-interview-import-design.md §2·§3. 픽스처는 손타이핑 스키마
(0.3-bpm-interface-draft) 기반 합성 데이터 — 실전달물 키 차이는 dry-run 리포트로 흡수한다.
"""

from scripts.consultant_interview import EXCEPTION_VARIANT_COLOR, convert_interview


def _action(seq: int, label: str, **over: object) -> dict:
    base: dict = {
        "seq": seq, "label": label, "name": f"{label} 상세", "kind": "action",
        "variant": "normal", "rule": None, "input": None, "output": None,
        "system": None, "screen": None, "dataForm": None, "quote": None,
    }
    base.update(over)
    return base


def _interview() -> dict:
    return {
        "_readme": ["interface draft"],
        "schema_version": "0.3-bpm-interface-draft",
        "labelSource": "llm-generated-draft",
        "framework": {"categories": [
            {"code": "19", "name": "EPCV", "level": 1, "parent": None},
            {"code": "19-01", "name": "Facility", "level": 2, "parent": "19"},
            {"code": "19-01-06", "name": "계측 보전", "level": 3, "parent": "19-01"},
            {"code": "19-01-06-01", "name": "Calibration 기획 및 운영", "level": 4, "parent": "19-01-06"},
            {"code": "19-01-06-01-02", "name": "Calibration 수행 및 결과 보고", "level": 5,
             "parent": "19-01-06-01"},
        ]},
        "l5": {"label": "Calibration 수행 및 결과 보고", "nodeCode": "19-01-06-01-02"},
        "rows": [
            {
                "taskId": "task-prep-0001",
                "unitId": "unit-prep-0001",
                "l6": "교정 준비",
                "owner": None,
                "ownerRole": "교정 담당자",
                "approvers": [],
                "department": None,
                "fields": {
                    "start_condition": "교정 주기 도래 시 EAM에서 작업지시 자동 발생",
                    "input_data": "교정 작업지시(EAM)",
                    "output_data": "준비 목록",
                    "done_criteria": "준비 목록 나오면 끝",
                    "systems": "EAM",
                    "total_time": "한번에 한시간쯤",
                    "total_time_min": None,
                    "touch_time": "한시간쯤",
                    "touch_time_min": None,
                    "frequency": "주 1회",
                    "annual_count": None,
                    "headcount": None,
                    "fte": None,
                    "gmp": "GMP 문서 맞음, 교정관리 SOP(EM-CAL-001) 다름",
                    "artifact_role": "deliverable",
                },
                "actions": [
                    _action(1, "작업지시 확인",
                            name="EAM에서 작업지시를 열어 대상 계측기와 측정 범위를 확인한다",
                            input="그 주 작업지시", output="대상 계측기와 측정 범위",
                            system="EAM", dataForm="structured",
                            quote="EAM에서 그 주 작업지시를 열어 확인해요."),
                    _action(2, "표준기 선정"),
                    _action(2, "양식 준비"),
                    _action(3, "표준기 유효성 판정", kind="decision", rule="유효기간 내면 진행"),
                ],
            },
        ],
        "tasks": [
            {"id": "task-prep-0001", "doc": None, "seq": 1, "name": "교정 준비", "note": None,
             "state": "confirmed",
             "evidence": [{"id": "ev1", "quote": "준비하고,", "sourceKind": "chat"}],
             "revision": 1, "ownerRole": "교정 담당자",
             "exceptions": [{"name": "현장 수기 기록",
                             "rule": "급할 때 양식 없이 현장에서 손으로 적어 온다", "evidence": []}],
             "endCondition": "준비 목록이 나오면 끝",
             "startCondition": "교정 주기 도래 시 EAM에서 작업지시 자동 발생"},
        ],
        "summary": {"l6_total": 1, "l7_total": 4, "voc_total": 1, "rows_total": 1},
        "openItems": [],
        "sideNotes": [
            {"kind": "voc", "text": "급한 건은 팀 메신저로 한번 더 알려야 함", "unitId": None},
            {"kind": "rule_basis", "text": "tacit: 준비목록이 나오면 끝", "unitId": "unit-prep-0001"},
        ],
    }


def test_convert_basic_map_and_nodes() -> None:
    res = convert_interview(_interview())
    assert not res.has_error()
    assert [c.code for c in res.categories][-1] == "19-01-06-01-02"
    assert len(res.maps) == 1
    m = res.maps[0]
    assert m.code == "task-prep-0001" and m.name == "교정 준비"
    assert m.category == "19-01-06-01-02"
    assert m.owner is None and m.approvers == [] and m.department == ""
    assert m.params.input == "교정 작업지시(EAM)" and m.params.output == "준비 목록"
    n1 = next(n for n in m.nodes if n.name == "작업지시 확인")
    assert n1.description.startswith("EAM에서 작업지시를 열어")
    assert "Quote: EAM에서 그 주 작업지시를 열어 확인해요." in n1.description
    # 승격 필드 — 설명 KV에서 빠지고 고유 필드로 (design 2026-08-19 §4.1)
    assert n1.input == "그 주 작업지시" and n1.output == "대상 계측기와 측정 범위"
    assert n1.data_form == "structured"
    assert n1.system == "EAM" and n1.system_fallback == "EAM"
    for gone in ("Input:", "Output:", "System:", "Data form:"):
        assert gone not in n1.description


def test_seq_groups_make_parallel_edges() -> None:
    m = convert_interview(_interview()).maps[0]
    assert [n.code for n in m.nodes] == ["a01", "a02", "a02-2", "a03"]
    pairs = {(e.source, e.target) for e in m.edges}
    assert pairs == {("a01", "a02"), ("a01", "a02-2"), ("a02", "a03"), ("a02-2", "a03")}


def test_decision_and_handoff_kinds() -> None:
    data = _interview()
    data["rows"][0]["actions"].append(_action(4, "결과 인계", kind="handoff"))
    m = convert_interview(data).maps[0]
    decision = next(n for n in m.nodes if n.name == "표준기 유효성 판정")
    assert decision.type == "decision"
    handoff = next(n for n in m.nodes if n.name == "결과 인계")
    assert handoff.type == "process" and "Kind: handoff" in handoff.description


def test_total_time_min_to_duration() -> None:
    data = _interview()
    data["rows"][0]["fields"]["total_time_min"] = 90
    assert convert_interview(data).maps[0].params.duration == "1.30"
    assert convert_interview(_interview()).maps[0].params.duration == ""  # None → ""


def test_unknown_key_warning_with_path() -> None:
    data = _interview()
    data["rows"][0]["actions"][0]["done_criterial"] = "x"  # 액션 레벨 미지 키
    res = convert_interview(data)
    assert not res.has_error()
    hits = [i for i in res.issues
            if i.severity == "warning" and i.path == "rows[0].actions[0]" and "done_criterial" in i.message]
    assert hits


def test_missing_l5_node_code_is_file_error() -> None:
    data = _interview()
    data["l5"]["nodeCode"] = "99-99"
    res = convert_interview(data)
    assert res.has_error() and res.maps == []


def test_notes_extraction() -> None:
    res = convert_interview(_interview())
    triples = {(n.kind, n.map_code, n.category_code) for n in res.notes}
    assert ("exception", "task-prep-0001", None) in triples
    assert ("rule_basis", "task-prep-0001", None) in triples  # unitId 매칭 → 맵 스코프
    assert ("voc", None, "19-01-06-01-02") in triples  # unitId null → L5 스코프
    exc = next(n for n in res.notes if n.kind == "exception")
    assert exc.title == "현장 수기 기록" and "손으로" in exc.text


def test_map_fields_promoted_and_description_shrunk() -> None:
    m = convert_interview(_interview()).maps[0]
    # [Interview] 직렬화는 Owner role만 잔류 — 승격 키는 고유/폴백 필드로 (design 2026-08-19 §4.1)
    assert m.description == "[Interview]\nOwner role: 교정 담당자"
    assert m.start_condition == "교정 주기 도래 시 EAM에서 작업지시 자동 발생"
    assert m.end_condition == "준비 목록 나오면 끝"
    assert m.system == "EAM" and m.system_fallback == "EAM"
    assert m.gmp_fallback == "GMP 문서 맞음, 교정관리 SOP(EM-CAL-001) 다름"
    assert m.frequency_fallback == "주 1회"
    assert m.total_time_fallback == "한번에 한시간쯤"
    assert m.touch_time_fallback == "한시간쯤"

    # 손타이핑 모호 — done_criterial 표기도 같은 자리로 수용 (실파일 대조 전 이중 수용)
    data = _interview()
    fields = data["rows"][0]["fields"]
    fields["done_criterial"] = fields.pop("done_criteria")
    assert convert_interview(data).maps[0].end_condition == "준비 목록 나오면 끝"


def test_touch_time_min_to_param() -> None:
    data = _interview()
    data["rows"][0]["fields"]["touch_time_min"] = 60
    assert convert_interview(data).maps[0].params.touch_time == "1.00"
    assert convert_interview(_interview()).maps[0].params.touch_time == ""  # None → ""


def test_multi_value_io_joined_with_newline() -> None:
    # 현 전달은 str이지만 list가 와도 개행 join — IO 복수 시맨틱 (design 2026-08-19 §4.1)
    data = _interview()
    data["rows"][0]["actions"][0]["input"] = ["작업지시", "표준기 목록"]
    n1 = next(n for n in convert_interview(data).maps[0].nodes if n.name == "작업지시 확인")
    assert n1.input == "작업지시\n표준기 목록"


def test_open_items_and_task_note_preserved() -> None:
    data = _interview()
    data["openItems"] = [{"text": "성적서 전자화 범위 — IT 협의", "unitId": None}, "문자열 항목"]
    data["tasks"][0]["note"] = "표준기 관리대장은 아직 엑셀"
    res = convert_interview(data)
    triples = {(n.kind, n.text, n.map_code, n.category_code) for n in res.notes}
    assert ("open_item", "성적서 전자화 범위 — IT 협의", None, "19-01-06-01-02") in triples
    assert ("open_item", "문자열 항목", None, "19-01-06-01-02") in triples
    assert ("task_note", "표준기 관리대장은 아직 엑셀", "task-prep-0001", None) in triples


def test_variant_preserved_and_exception_colored() -> None:
    data = _interview()
    data["rows"][0]["actions"].append(
        _action(4, "현장 수기 기록", variant="exception", rule="급할 때 양식 없이 수기"))
    m = convert_interview(data).maps[0]
    exc = next(n for n in m.nodes if n.name == "현장 수기 기록")
    assert "Variant: exception" in exc.description
    assert exc.color == EXCEPTION_VARIANT_COLOR
    # variant="normal"(기본)은 노이즈 — Variant 줄도 색도 없다
    normal = next(n for n in m.nodes if n.name == "작업지시 확인")
    assert "Variant" not in normal.description
    assert normal.color == ""
