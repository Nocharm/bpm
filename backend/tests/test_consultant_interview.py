"""인터뷰 결과 JSON 어댑터 — 키 검증·canonical 변환·흐름 그래프·노트 추출.

설계: docs/design/2026-09-01-interview-import-v04-design.md(0.4 흐름 그래프) +
2026-08-18-interview-import-design.md §2·§3. 픽스처는 손타이핑 스키마
(0.4-bpm-interface-draft) 기반 합성 데이터 — 실전달물 키 차이는 dry-run 리포트로 흡수한다.
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


def _edge(src: object, dst: object, **over: object) -> dict:
    base: dict = {
        "src": src, "dst": dst, "kind": "seq",
        "gateway": None, "condition": None, "label": None, "quote": None,
    }
    base.update(over)
    return base


def _interview() -> dict:
    return {
        "_readme": ["interface draft"],
        "schema_version": "0.4-bpm-interface-draft",
        "labelSource": "human-confirmed",
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
                    _action(3, "양식 준비"),
                    _action(4, "표준기 유효성 판정", kind="decision", rule="유효기간 내면 진행"),
                ],
                "relations": {"edges": [
                    _edge(1, 2), _edge(1, 3), _edge(2, 4), _edge(3, 4),
                ]},
            },
        ],
        "relations": {
            "entry": {
                "taskId": "task-prep-0001",
                "triggerType": "timer",
                "label": "교정 주기 도래 시 EAM 작업지시 자동 발생",
                "quote": "주기가 돌아오면 작업지시가 자동으로 떨어져요.",
            },
            "edges": [],
        },
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
    # dataForm은 유일한 산출물의 자료 형식으로 착지(노드 레벨 data_form 폐기, 2026-09-03)
    assert n1.output_forms == "structured"
    assert n1.system == "EAM" and n1.system_fallback == "EAM"
    for gone in ("Input:", "Output:", "System:", "Data form:"):
        assert gone not in n1.description


def test_relations_edges_drive_the_graph() -> None:
    m = convert_interview(_interview()).maps[0]
    assert [n.code for n in m.nodes] == ["a01", "a02", "a03", "a04"]
    pairs = {(e.source, e.target) for e in m.edges}
    assert pairs == {("a01", "a02"), ("a01", "a03"), ("a02", "a04"), ("a03", "a04")}
    assert {e.kind for e in m.edges} == {"seq"}


def test_edge_label_joins_label_and_condition() -> None:
    data = _interview()
    data["rows"][0]["relations"]["edges"][0] = _edge(
        1, 2, kind="branch", gateway="exclusive", label="양식 사전 출력", condition="여유가 있는 경우")
    m = convert_interview(data).maps[0]
    edge = next(e for e in m.edges if (e.source, e.target) == ("a01", "a02"))
    assert edge.label == "양식 사전 출력\n여유가 있는 경우"
    # label이 없으면 condition만 라벨이 된다
    data2 = _interview()
    data2["rows"][0]["relations"]["edges"][0] = _edge(1, 2, condition="준비 목록 산출 시")
    m2 = convert_interview(data2).maps[0]
    assert next(e for e in m2.edges if e.source == "a01" and e.target == "a02").label == "준비 목록 산출 시"


def test_exclusive_branch_promotes_source_to_decision() -> None:
    """actions[].kind는 분기를 안 알려준다 — 엣지 kind=branch가 진실 (design 2026-09-01 §2)."""
    data = _interview()
    data["rows"][0]["relations"]["edges"][0] = _edge(1, 2, kind="branch", gateway="exclusive")
    res = convert_interview(data)
    assert not res.has_error()
    src = next(n for n in res.maps[0].nodes if n.code == "a01")
    assert src.type == "decision"
    assert any("promoted to decision" in i.message for i in res.issues)


def test_parallel_gateway_does_not_promote() -> None:
    """병행 팬아웃은 택일이 아니다 — 마름모로 그리면 오독된다."""
    data = _interview()
    data["rows"][0]["relations"]["edges"][0] = _edge(1, 2, kind="branch", gateway="parallel")
    src = next(n for n in convert_interview(data).maps[0].nodes if n.code == "a01")
    assert src.type == "process"


def test_loop_and_bypass_kinds_are_kept() -> None:
    data = _interview()
    data["rows"][0]["relations"]["edges"].extend([
        _edge(4, 2, kind="loop", condition="유효기간이 지난 경우"),
        _edge(1, 4, kind="bypass", condition="재발행 건"),
    ])
    m = convert_interview(data).maps[0]
    by_pair = {(e.source, e.target): e.kind for e in m.edges}
    assert by_pair[("a04", "a02")] == "loop"
    assert by_pair[("a01", "a04")] == "bypass"


def test_duplicate_seq_is_file_error() -> None:
    """0.4에서 seq는 relations 참조키 — 중복이면 어느 노드인지 결정 불가."""
    data = _interview()
    data["rows"][0]["actions"].append(_action(2, "중복 seq"))
    res = convert_interview(data)
    assert res.has_error()
    assert any("duplicate seq 2" in i.message for i in res.issues)


def test_unknown_seq_reference_is_dropped_with_warning() -> None:
    data = _interview()
    data["rows"][0]["relations"]["edges"].append(_edge(4, 99))
    res = convert_interview(data)
    assert not res.has_error()
    assert all(e.target != "a99" for e in res.maps[0].edges)
    assert any("unknown seq" in i.message for i in res.issues)


def test_missing_relations_falls_back_to_seq_chain() -> None:
    data = _interview()
    data["rows"][0].pop("relations")
    res = convert_interview(data)
    pairs = {(e.source, e.target) for e in res.maps[0].edges}
    assert pairs == {("a01", "a02"), ("a02", "a03"), ("a03", "a04")}
    assert any("seq chain fallback" in i.message for i in res.issues)


def test_flow_quote_becomes_map_note() -> None:
    data = _interview()
    data["rows"][0]["relations"]["edges"][0] = _edge(
        1, 2, kind="branch", gateway="exclusive", condition="급할 때", quote="급하면 손으로 적어요.")
    res = convert_interview(data)
    note = next(n for n in res.notes if n.kind == "flow" and n.map_code == "task-prep-0001")
    assert note.title == "작업지시 확인 → 표준기 선정"
    assert "급하면 손으로 적어요." in note.text
    assert "(branch/exclusive · 급할 때)" in note.text


def test_schema_version_03_is_rejected() -> None:
    """0.3은 흐름 그래프가 없어 조용히 일직선 맵이 된다 — 명시 거부 (design 2026-09-01 §1)."""
    data = _interview()
    data["schema_version"] = "0.3-bpm-interface-draft"
    res = convert_interview(data)
    assert res.has_error() and res.maps == []
    assert any("re-deliver as 0.5" in i.message for i in res.issues)  # 0.5 = 최신 계약 (2026-09-07)


def test_numeric_params_survive_json_numbers() -> None:
    """0.4는 숫자로 보낸다 — str(float)의 지수표기는 엔진 NUMERIC_RE에 걸려 소거된다 (design §4)."""
    data = _interview()
    data["rows"][0]["fields"].update({"annual_count": 52, "headcount": 1, "fte": 0.00001})
    p = convert_interview(data).maps[0].params
    assert (p.annual_count, p.headcount, p.fte) == ("52", "1", "0.00001")


def test_department_path_whitespace_normalized() -> None:
    """"A/ B" 같은 세그먼트 공백은 known 조직경로와 안 맞아 오너 org로 조용히 폴백된다."""
    data = _interview()
    data["rows"][0]["department"] = "Quality Center/ QC Department /QC Support Team"
    assert convert_interview(data).maps[0].department == (
        "Quality Center/QC Department/QC Support Team")


def test_top_level_relations_become_linkage() -> None:
    data = _interview()
    data["rows"].append({
        "taskId": "task-run-0002", "unitId": "unit-run-0002", "l6": "현장 교정 수행",
        "owner": None, "ownerRole": "교정 담당자", "approvers": [], "department": None,
        "fields": {"annual_count": 286, "fte": 0.31},
        "actions": [_action(1, "현장 측정")],
        "relations": {"edges": []},
    })
    data["relations"]["entry"]["taskId"] = "task-run-0002"  # 진입 L6가 배치 첫 자리
    data["relations"]["edges"] = [
        _edge("task-run-0002", "task-prep-0001", kind="loop",
              condition="표준기 유효기간 경과", label="처음부터 재수행", quote="다시 준비부터 해야죠."),
    ]
    res = convert_interview(data)
    assert not res.has_error()
    lk = res.linkage
    assert lk is not None
    assert lk.category_code == "19-01-06-01-02"
    assert lk.map_codes == ["task-run-0002", "task-prep-0001"]
    assert [(e.source, e.target) for e in lk.edges] == [("task-run-0002", "task-prep-0001")]
    assert lk.edges[0].label == "처음부터 재수행\n표준기 유효기간 경과"
    assert lk.params["task-run-0002"] == ("286", "0.31")
    entry = next(n for n in res.notes if n.kind == "entry")
    assert entry.title == "Entry (timer)" and entry.category_code == "19-01-06-01-02"
    l6_quote = next(
        n for n in res.notes if n.kind == "flow" and n.title == "현장 교정 수행 → 교정 준비")
    assert "다시 준비부터 해야죠." in l6_quote.text


def test_edge_with_missing_endpoint_is_dropped_not_treated_as_external() -> None:
    """src/dst 중 하나가 비면(null/공백) external 오판으로 빈 코드 플레이스홀더가 생기기 전에
    먼저 드랍한다 — 안 그러면 그 빈 문자열이 "외부 taskId"로 오인돼 제목 없는 플레이스홀더
    노드가 배치된다 (M5)."""
    data = _interview()
    data["relations"]["edges"] = [
        _edge("task-prep-0001", None),
        _edge("", "task-prep-0001"),
    ]
    res = convert_interview(data)
    assert not res.has_error()
    lk = res.linkage
    assert lk is not None
    assert lk.edges == []
    assert lk.external_refs == {}
    assert sum("edge missing src/dst" in i.message for i in res.issues) == 2


def test_decision_and_handoff_kinds() -> None:
    data = _interview()
    data["rows"][0]["actions"].append(_action(5, "결과 인계", kind="handoff"))
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
    # [Interview] 직렬화는 기록성 키(Owner role·Artifact role)만 잔류 — 승격 키는 고유/폴백 필드로
    # (design 2026-08-19 §4.1, artifact_role 잔류 복원 2026-08-24)
    assert m.description == "[Interview]\nOwner role: 교정 담당자\nArtifact role: deliverable"
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


def test_artifact_role_preserved_without_owner_role() -> None:
    """artifact_role은 [Interview] 섹션에 잔류 — 승격 리팩터에서 조용히 유실되던 회귀 봉합 (2026-08-24)."""
    data = _interview()
    data["rows"][0]["ownerRole"] = None
    assert convert_interview(data).maps[0].description == "[Interview]\nArtifact role: deliverable"


def test_unknown_keys_in_l5_tasks_and_exceptions_warn() -> None:
    """l5·tasks·exceptions도 dry-run이 미지 키를 표면화해야 실파일 대조가 완전하다 (2026-08-24)."""
    data = _interview()
    data["l5"]["extra"] = "x"
    data["tasks"][0]["surprise"] = "x"
    data["tasks"][0]["exceptions"][0]["severity"] = "high"
    res = convert_interview(data)
    assert not res.has_error()
    warns = [(i.path, i.message) for i in res.issues if i.severity == "warning"]
    assert any(p == "l5" and "'extra'" in m for p, m in warns)
    assert any(p == "tasks[0]" and "'surprise'" in m for p, m in warns)
    assert any("exceptions[0]" in p and "'severity'" in m for p, m in warns)


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
    data["openItems"] = [{"text": "성적서 전자화 범위 - IT 협의", "unitId": None}, "문자열 항목"]
    data["tasks"][0]["note"] = "표준기 관리대장은 아직 엑셀"
    res = convert_interview(data)
    triples = {(n.kind, n.text, n.map_code, n.category_code) for n in res.notes}
    assert ("open_item", "성적서 전자화 범위 - IT 협의", None, "19-01-06-01-02") in triples
    assert ("open_item", "문자열 항목", None, "19-01-06-01-02") in triples
    assert ("task_note", "표준기 관리대장은 아직 엑셀", "task-prep-0001", None) in triples


def test_variant_preserved_and_exception_colored() -> None:
    data = _interview()
    data["rows"][0]["actions"].append(
        _action(5, "현장 수기 기록", variant="exception", rule="급할 때 양식 없이 수기"))
    m = convert_interview(data).maps[0]
    exc = next(n for n in m.nodes if n.name == "현장 수기 기록")
    assert "Variant: exception" in exc.description
    assert exc.color == EXCEPTION_VARIANT_COLOR
    # variant="normal"(기본)은 노이즈 — Variant 줄도 색도 없다
    normal = next(n for n in m.nodes if n.name == "작업지시 확인")
    assert "Variant" not in normal.description
    assert normal.color == ""


def test_l5_self_edge_kept_as_loop_branch() -> None:
    """L5 self edge는 드랍 대신 loop로 강제 유지 — 엔진이 분기 노드를 세워 반복으로 그린다 (사용자 결정 2026-09-02)."""
    data = _interview()
    data["relations"]["edges"] = [
        _edge("task-prep-0001", "task-prep-0001",
              condition="재교정 필요 시", label="반복", quote="미흡하면 다시 돌려요."),
    ]
    res = convert_interview(data)
    assert not res.has_error()
    lk = res.linkage
    assert lk is not None
    assert [(e.source, e.target, e.kind) for e in lk.edges] == [
        ("task-prep-0001", "task-prep-0001", "loop"),
    ]
    assert any(
        "self edge" in i.message and "auto-generated" in i.message
        and "반복 여부(자동 생성됨)" in i.message
        for i in res.issues
    )
    # 드랍 시절엔 quote 노트도 함께 증발했다 — 유지 경로에선 flow 노트로 살아남아야 한다
    assert any(n.kind == "flow" and "미흡하면 다시 돌려요." in n.text for n in res.notes)


def test_l6_self_edge_becomes_loop_branch() -> None:
    """L6 self edge도 분기 판단 노드(a02r)를 세워 ◇→자기 루프백으로 — 진출 엣지는 ◇로 이설 (2026-09-02)."""
    data = _interview()
    data["rows"][0]["relations"]["edges"] = [
        _edge(1, 2),
        _edge(2, 2, condition="측정 불가 시", label="재선정", quote="안 맞으면 다시 골라요."),
        _edge(2, 4, label="진행"),
    ]
    res = convert_interview(data)
    assert not res.has_error()
    m = res.maps[0]
    branch = next(n for n in m.nodes if n.code == "a02r")
    assert branch.type == "decision"
    # 원본 이름을 붙이지 않는다 — 일괄 생성 티가 나는 고정 이름 (사용자 결정 2026-09-02)
    assert branch.name == "반복 여부(자동 생성됨)"
    # dry-run 노티 — 자동 생성 사실과 노드명·코드를 리포트에서 바로 읽을 수 있어야 한다
    notice = next(i for i in res.issues if "self edge" in i.message)
    assert "auto-generated" in notice.message and "a02r" in notice.message
    assert "반복 여부(자동 생성됨)" in notice.message
    # 분기 노드는 원 노드 바로 뒤에 놓인다
    codes = [n.code for n in m.nodes]
    assert codes.index("a02r") == codes.index("a02") + 1
    pairs = [(e.source, e.target, e.kind) for e in m.edges]
    assert ("a02", "a02r", "seq") in pairs
    assert ("a02r", "a02", "loop") in pairs
    assert ("a02r", "a04", "seq") in pairs  # 기존 진출은 ◇로 이설 — 택일은 분기에서 갈라진다
    assert ("a02", "a04", "seq") not in pairs
    assert any("kept as loop" in i.message for i in res.issues)
    assert any(n.kind == "flow" and "안 맞으면 다시 골라요." in n.text for n in res.notes)


def test_l6_self_branch_edge_promotes_branch_node_not_source() -> None:
    """self가 branch여도 원 노드는 process 유지 — 택일은 합성 분기 노드가 대신한다."""
    data = _interview()
    data["rows"][0]["relations"]["edges"] = [
        _edge(1, 2),
        _edge(2, 2, kind="branch", gateway="exclusive", label="재작업"),
    ]
    m = convert_interview(data).maps[0]
    assert next(n for n in m.nodes if n.code == "a02").type == "process"
    assert next(n for n in m.nodes if n.code == "a02r").type == "decision"


def test_adapter_keeps_edge_to_external_task_as_placeholder_source() -> None:
    """한쪽 끝점이 rows에 없는 엣지는 드랍하지 않고 external로 보존 — 양쪽 다 없으면 드랍 (spec 2026-09-06 §8)."""
    data = _interview()
    # task-prep-0001은 기본에 있고, task-run-0002를 추가
    data["rows"].append({
        "taskId": "task-run-0002", "unitId": "unit-run-0002", "l6": "현장 교정 수행",
        "owner": None, "ownerRole": "교정 담당자", "approvers": [], "department": None,
        "fields": {"annual_count": 100, "fte": 0.5},
        "actions": [_action(1, "현장 측정")],
        "relations": {"edges": []},
    })
    data["relations"]["edges"] = [
        _edge("task-prep-0001", "task-run-0002", kind="seq"),
        _edge("task-run-0002", "other-l5-task-9", kind="seq"),
        _edge("ghost-a", "ghost-b", kind="seq"),
    ]
    result = convert_interview(data)
    assert not result.has_error()
    lk = result.linkage
    assert lk is not None
    edges = {(e.source, e.target): e for e in lk.edges}
    # 양쪽 모두 rows에 있는 엣지는 external=False
    assert ("task-prep-0001", "task-run-0002") in edges
    assert edges[("task-prep-0001", "task-run-0002")].external is False
    # 한쪽만 rows에 있는 엣지는 external=True로 보존
    assert ("task-run-0002", "other-l5-task-9") in edges
    assert edges[("task-run-0002", "other-l5-task-9")].external is True
    # 양쪽 모두 rows에 없는 엣지는 드랍
    assert ("ghost-a", "ghost-b") not in edges
    # external_refs는 외부 끝점 목록 — 미선언이라 declared=False
    assert list(lk.external_refs) == ["other-l5-task-9"]
    assert lk.external_refs["other-l5-task-9"].declared is False
    # placeholder 메시지 포함
    assert any("placeholder" in i.message for i in result.issues)


# ── 0.5 외부 L6 참조(externalTasks) — spec 2026-09-07 §4·§5 ─────────────────────────


def _external_task(ref_id: str, node_code: str, l6: object = "외부 업무", **over: object) -> dict:
    base: dict = {"refId": ref_id, "l5": {"nodeCode": node_code, "label": "외부 L5"}, "l6": l6, "note": None}
    base.update(over)
    return base


def _with_external(data: dict) -> dict:
    """홈 rows 1건 + 외부 L5(19-01-02-01-01) 계보 동봉 + 선언 ref 1건."""
    data["schema_version"] = "0.5-bpm-interface-draft"
    data["framework"]["categories"] += [
        {"code": "19-01-02", "name": "유틸리티 운전", "level": 3, "parent": "19-01"},
        {"code": "19-01-02-01", "name": "정제수 시스템 운전", "level": 4, "parent": "19-01-02"},
        {"code": "19-01-02-01-01", "name": "정제수 일상 점검", "level": 5, "parent": "19-01-02-01"},
    ]
    data["externalTasks"] = [_external_task("ext-util", "19-01-02-01-01", "정제수 일상 점검 수행",
                                            note="점검 라운드가 끝나야 교정 준비를 시작한다고 함")]
    data["relations"]["edges"] = [_edge("ext-util", "task-prep-0001", label="점검 후 준비")]
    return data


def test_declared_external_task_becomes_external_ref_without_warning() -> None:
    res = convert_interview(_with_external(_interview()))
    assert not res.has_error()
    lk = res.linkage
    assert lk is not None
    ref = lk.external_refs["ext-util"]
    assert (ref.l5_code, ref.l5_label, ref.name, ref.declared) == (
        "19-01-02-01-01", "외부 L5", "정제수 일상 점검 수행", True)
    assert ref.note == "점검 라운드가 끝나야 교정 준비를 시작한다고 함"
    assert [(e.source, e.target, e.external) for e in lk.edges] == [("ext-util", "task-prep-0001", True)]
    assert not any("external" in i.message and i.severity == "warning" for i in res.issues)
    note = next(n for n in res.notes if n.kind == "external")
    assert note.title == "정제수 일상 점검 수행 (외부 L5)" and note.category_code == "19-01-06-01-02"


def test_undeclared_endpoint_keeps_legacy_taskid_placeholder_with_warning() -> None:
    data = _interview()
    data["relations"]["edges"] = [_edge("task-prep-0001", "other-l5-task-0009")]
    res = convert_interview(data)
    assert not res.has_error()
    ref = res.linkage.external_refs["other-l5-task-0009"]
    assert ref.declared is False and ref.l5_code is None and ref.name == ""
    assert any("kept as placeholder" in i.message and "not declared in externalTasks" in i.message
               for i in res.issues)


def test_external_edge_quote_no_longer_crashes_and_becomes_flow_note() -> None:
    data = _with_external(_interview())
    data["relations"]["edges"][0]["quote"] = "라운드 끝나면 그때 준비 들어가요."
    res = convert_interview(data)  # 이전엔 row_names[src] KeyError
    assert not res.has_error()
    flow = next(n for n in res.notes if n.kind == "flow")
    assert flow.title == "정제수 일상 점검 수행 → 교정 준비"


def test_external_task_l6_null_keeps_empty_name() -> None:
    data = _with_external(_interview())
    data["externalTasks"][0]["l6"] = None
    res = convert_interview(data)
    assert not res.has_error()
    assert res.linkage.external_refs["ext-util"].name == ""  # 제목은 엔진이 "(L6 unspecified) L5명"으로


def test_external_task_errors_and_warnings() -> None:
    data = _with_external(_interview())
    data["externalTasks"] += [
        _external_task("ext-util", "19-01-02-01-01"),               # 중복 refId
        _external_task("task-prep-0001", "19-01-02-01-01"),          # taskId 충돌
        {"refId": "ext-nol5", "l6": "x"},                            # l5 누락
        {"refId": "ext-nocode", "l5": {"label": "이름만"}, "l6": "x"},  # nodeCode 누락
    ]
    res = convert_interview(data)
    msgs = [(i.severity, i.message) for i in res.issues]
    assert ("error", "duplicate refId 'ext-util' (참조 id 중복)") in msgs
    assert any(s == "error" and "collides with rows[].taskId" in m for s, m in msgs)
    assert any(s == "error" and m.startswith("l5 missing") for s, m in msgs)
    assert any(s == "error" and m.startswith("nodeCode missing") for s, m in msgs)


def test_external_task_unknown_l5_and_unreferenced_are_warnings() -> None:
    data = _with_external(_interview())
    data["externalTasks"].append(_external_task("ext-unused", "77-01-01-01-01"))  # 파일 categories에 없음 + 엣지 미참조
    res = convert_interview(data)
    assert not res.has_error()
    assert any(i.severity == "warning" and "external L5 '77-01-01-01-01' not in framework.categories" in i.message
               for i in res.issues)
    assert any(i.severity == "warning" and "refId 'ext-unused' not referenced by any edge" in i.message
               for i in res.issues)
    assert "ext-unused" not in res.linkage.external_refs


def test_edge_between_two_external_endpoints_is_dropped() -> None:
    data = _with_external(_interview())
    data["externalTasks"].append(_external_task("ext-two", "19-01-02-01-01", "다른 외부"))
    data["relations"]["edges"].append(_edge("ext-util", "ext-two"))
    res = convert_interview(data)
    assert not res.has_error()
    assert [(e.source, e.target) for e in res.linkage.edges] == [("ext-util", "task-prep-0001")]
    assert any("references unknown taskId" in i.message for i in res.issues)


def test_schema_version_05_accepted_and_04_still_works() -> None:
    data = _interview()
    data["schema_version"] = "0.5-bpm-interface-draft"
    assert not convert_interview(data).has_error()
    data["schema_version"] = "0.4-bpm-interface-draft"
    assert not convert_interview(data).has_error()


def test_categories_outside_home_chain_are_marked_external() -> None:
    res = convert_interview(_with_external(_interview()))
    flags = {c.code: c.external for c in res.categories}
    assert flags["19"] is False and flags["19-01"] is False  # 공유 조상은 홈 체인
    assert flags["19-01-06-01-02"] is False
    assert flags["19-01-02"] is True and flags["19-01-02-01-01"] is True


def test_broken_external_chain_is_dropped_with_warning_not_error() -> None:
    data = _with_external(_interview())
    # 외부 L5의 L4 부모(19-01-02-01)를 빼 체인을 끊는다 → L5도 부모 없음으로 연쇄 제외
    data["framework"]["categories"] = [c for c in data["framework"]["categories"] if c["code"] != "19-01-02-01"]
    res = convert_interview(data)
    assert not res.has_error()
    codes = {c.code for c in res.categories}
    assert "19-01-02" in codes and "19-01-02-01-01" not in codes
    assert sum("dropped - parent" in i.message for i in res.issues if i.severity == "warning") == 1
    # nodeCode는 이제 파일에 없다 → 기존 체계로 해석 경고
    assert any("not in framework.categories" in i.message for i in res.issues)


def test_broken_home_chain_is_still_file_error() -> None:
    data = _interview()
    data["framework"]["categories"] = [c for c in data["framework"]["categories"] if c["code"] != "19-01-06"]
    res = convert_interview(data)
    assert res.has_error()


def test_category_admins_are_normalized_and_ignored_on_external_lineage() -> None:
    """framework.categories[].admins(0.5) — 어느 레벨에나, 공백·중복 정리. 외부 계보 행의 admins는 경고 후 비운다."""
    data = _with_external(_interview())
    cats = {c["code"]: c for c in data["framework"]["categories"]}
    cats["19-01-06-01-02"]["admins"] = [" cheolsu.kim ", "cheolsu.kim", "", "younghee.lee"]
    cats["19-01"]["admins"] = ["facility.lead"]  # 상위(L2) 카테고리도 파라미터 허용
    cats["19-01-02-01-01"]["admins"] = ["someone.else"]  # 외부 계보 → 무시
    res = convert_interview(data)
    assert not res.has_error()
    by_code = {c.code: c for c in res.categories}
    assert by_code["19-01-06-01-02"].admins == ["cheolsu.kim", "younghee.lee"]
    assert by_code["19-01"].admins == ["facility.lead"]
    assert by_code["19-01-02-01-01"].admins == []
    assert any("admins ignored - external lineage" in i.message for i in res.issues)
