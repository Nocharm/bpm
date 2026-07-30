"""오케스트레이터 — 경량 턴(인터뷰어 1콜)·draw_due 신호·체크포인트·사니타이저 (AI 모킹)."""

import asyncio
import json

import pytest

from app import ai_client
from app.interview import orchestrator
from app.models import InterviewSession
from app.schemas import InterviewTurnIn


class _FakeDb:
    """db.add 수집만 하는 대역 — 커밋은 라우터 책임이라 여기 없음."""

    def __init__(self) -> None:
        self.added: list = []

    def add(self, obj) -> None:
        self.added.append(obj)


def _session(**over) -> InterviewSession:
    base = dict(
        id=1, map_id=1, version_id=1, login_id="tester", status="active",
        current_stage="scope", lang="ko", facts={}, working_graph=None,
        pending_choices=None,
    )
    base.update(over)
    s = InterviewSession(**base)
    s.messages = []
    return s


def _scripted_ai(replies: list[str]):
    """호출 순서대로 응답을 소모하는 fake call_ai — 총 호출 수·동시 피크 카운터 포함."""
    queue = list(replies)
    state = {"active": 0, "peak": 0, "calls": 0}

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        state["calls"] += 1
        state["active"] += 1
        state["peak"] = max(state["peak"], state["active"])
        await asyncio.sleep(0.01)
        state["active"] -= 1
        return ai_client.AiReply(content=queue.pop(0))

    return _call, state


INTERVIEWER_Q = json.dumps({"message": "목적이 뭔가요?", "facts_patch": {"process_name": "구매"}})
INTERVIEWER_DONE = json.dumps({
    "message": "범위 확정. 다음으로 트리거를 알려주세요.",
    "facts_patch": {"purpose": "표준화", "boundaries": "접수~발주"},
    "stage_complete": True,
})
DRAFT = json.dumps({
    "kind": "graph", "message": "표준안",
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start"},
        {"key": "a", "title": "요청서 작성", "node_type": "process"},
        {"key": "e", "title": "끝", "node_type": "end"},
    ],
    "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "e"}],
    "groups": [],
})


def _run(db, interview, turn, replies, doc_sections=None):
    """턴 실행 — (fake AI 카운터, TurnResult) 반환."""
    fake, state = _scripted_ai(replies)
    holder = {}

    async def _go() -> None:
        orig = ai_client.call_ai
        ai_client.call_ai = fake
        try:
            holder["result"] = await orchestrator.run_turn(
                db, interview, turn, "(빈 캔버스)", "", doc_sections=doc_sections
            )
        finally:
            ai_client.call_ai = orig

    asyncio.run(_go())
    return state, holder["result"]


def test_answer_turn_appends_messages_and_merges_facts() -> None:
    db, interview = _FakeDb(), _session()
    state, result = _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"),
                         [INTERVIEWER_Q])
    assert interview.facts["scope"]["process_name"] == "구매"
    roles = [m.role for m in db.added]
    assert roles == ["user", "consultant"]
    assert db.added[1].kind == "question"
    assert result.draw_due is None


def test_answer_turn_is_single_interviewer_call() -> None:
    """일반 턴은 인터뷰어 1콜만 소비 — 재드래프트·톤 검수 폐지 (speed redesign §3)."""
    db, interview = _FakeDb(), _session()
    state, _ = _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"),
                    [INTERVIEWER_Q])
    assert state["calls"] == 1
    assert interview.working_graph is None  # 턴은 맵을 건드리지 않는다


def test_stage_complete_creates_checkpoint_and_advances() -> None:
    db, interview = _FakeDb(), _session()
    state, result = _run(db, interview, InterviewTurnIn(type="answer", content="접수부터 발주까지"),
                         [INTERVIEWER_DONE])
    assert interview.current_stage == "io"
    checkpoints = [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"]
    assert len(checkpoints) == 1 and checkpoints[0].stage == "scope"
    assert state["calls"] == 1
    assert result.draw_due is None  # scope는 구조 스테이지가 아니다


def test_structure_stage_completion_signals_multi_draw() -> None:
    """activities 완료 전이 턴은 draw_due == 'multi' (speed redesign §4)."""
    db = _FakeDb()
    interview = _session(current_stage="activities")
    reply = json.dumps({"message": "활동 확정", "facts_patch": {"activities": "요청·비교·발주"},
                        "stage_complete": True})
    _, result = _run(db, interview, InterviewTurnIn(type="answer", content="이대로"), [reply])
    assert interview.current_stage == "branches"
    assert result.draw_due == "multi"


def test_params_completion_signals_params_table() -> None:
    """params 완료 전이는 그리지 않는다 — 수집 표가 있으면 draw_due == 'params' (표 확정 흐름)."""
    db = _FakeDb()
    interview = _session(current_stage="params",
                         facts={"params": {"params_table": {"요청서 작성": {"duration": "0.30"}}}})
    reply = json.dumps({"message": "파라미터 끝", "facts_patch": {"params_done": "yes"},
                        "stage_complete": True})
    _, result = _run(db, interview, InterviewTurnIn(type="answer", content="확정"), [reply])
    assert interview.current_stage == "review"
    assert result.draw_due == "params"


def test_params_completion_without_table_no_autodraw() -> None:
    db = _FakeDb()
    interview = _session(current_stage="params")
    reply = json.dumps({"message": "파라미터 없음", "facts_patch": {"params_done": "yes"},
                        "stage_complete": True})
    _, result = _run(db, interview, InterviewTurnIn(type="answer", content="넘어가"), [reply])
    assert interview.current_stage == "review"
    assert result.draw_due is None


def test_params_table_deep_merges_across_turns() -> None:
    """params_table은 활동별 딥머지 — 통짜 교체로 이전 턴 확정분이 유실되지 않는다."""
    db = _FakeDb()
    interview = _session(current_stage="params",
                         facts={"params": {"params_table": {"A": {"duration": "0.30"}}}})
    reply = json.dumps({"message": "확인", "facts_patch": {
        "params_table": {"A": {"cost_krw": "1000"}, "B": {"headcount": "2"}},
    }})
    _run(db, interview, InterviewTurnIn(type="answer", content="B는 2명"), [reply])
    table = interview.facts["params"]["params_table"]
    assert table["A"] == {"duration": "0.30", "cost_krw": "1000"}
    assert table["B"] == {"headcount": "2"}


def test_redraw_request_signals_single_draw_without_drafter_call() -> None:
    """redraw 요청은 draw_due 신호만 — 턴 안에서 드래프터를 돌리지 않는다."""
    db, interview = _FakeDb(), _session()
    reply = json.dumps({"message": "그릴게요", "facts_patch": {}, "redraw": True})
    state, result = _run(db, interview, InterviewTurnIn(type="answer", content="그려줘"), [reply])
    assert result.draw_due == "single"
    assert state["calls"] == 1
    assert interview.working_graph is None


def test_choice_turn_applies_graph_and_clears_pending() -> None:
    db = _FakeDb()
    option = {"id": "opt-1", "title": "표준안", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(current_stage="activities",
                         pending_choices={"options": [option]},
                         facts={"activities": {}})
    state, result = _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"),
                         [INTERVIEWER_Q])
    assert interview.pending_choices is None
    assert interview.working_graph is not None
    assert any(n["key"] == "a" for n in interview.working_graph["nodes"])
    assert state["calls"] == 1  # 수락 턴도 인터뷰어 1콜
    # 대화 이력엔 옵션 id가 아닌 제목이 남는다 (실사용 회귀 2026-07-23)
    user_msg = next(m for m in db.added if m.role == "user")
    assert user_msg.content == "표준안"


def test_review_stage_completion_does_not_spam_checkpoint() -> None:
    """review(마지막)에서 stage_complete여도 체크포인트 반복 금지 (실사용 회귀 2026-07-23)."""
    db = _FakeDb()
    graph = json.loads(DRAFT)
    graph.pop("kind", None)
    interview = _session(current_stage="review", working_graph=graph, facts={})
    _run(db, interview,
         InterviewTurnIn(type="answer", content="좋아요 이대로 확정"),
         [json.dumps({"message": "검토 완료입니다. 우측 하단 Apply로 적용하세요.",
                      "stage_complete": True})])
    assert interview.current_stage == "review"
    assert [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"] == []
    kinds = [m.kind for m in db.added]
    assert kinds == ["answer", "question"]


def test_question_options_stored_in_payload() -> None:
    """명확화 보기(options)가 질문 메시지 payload로 프론트에 전달된다 (2026-07-23 UX)."""
    db, interview = _FakeDb(), _session()
    reply = json.dumps({"message": "목적이 뭔가요?", "facts_patch": {},
                        "options": ["표준화", "비용 절감"]})
    _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"), [reply])
    question = next(m for m in db.added if m.kind == "question")
    assert question.payload == {"options": ["표준화", "비용 절감"]}


def test_invalid_ai_json_retries_then_turn_error() -> None:
    db, interview = _FakeDb(), _session()
    with pytest.raises(orchestrator.TurnError):
        _run(db, interview, InterviewTurnIn(type="answer", content="x"),
             ["깨진 응답", "여전히 깨짐"])


def test_skip_turn_fills_unknowns_checkpoints_and_advances() -> None:
    """skip 턴은 미확정 필수 facts를 '미정'으로 채우고 결정적으로 다음 단계로 전진한다."""
    db = _FakeDb()
    interview = _session(
        current_stage="io",
        facts={"scope": {"process_name": "다이어트", "purpose": "p", "boundaries": "b"},
               "io": {"trigger": "몸무게 88 도달", "inputs": "운동 계획"}},
    )
    state, result = _run(db, interview, InterviewTurnIn(type="skip"), [INTERVIEWER_Q])
    assert interview.facts["io"]["outputs"] == "미정"
    assert interview.facts["io"]["trigger"] == "몸무게 88 도달"  # 기확정 값은 보존
    assert interview.current_stage == "activities"
    checkpoints = [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"]
    assert len(checkpoints) == 1 and checkpoints[0].stage == "io"
    user_msg = next(m for m in db.added if getattr(m, "role", "") == "user")
    assert user_msg.kind == "skip"
    consultant = next(m for m in db.added if getattr(m, "role", "") == "consultant")
    assert consultant.stage == "activities"  # 개시 질문은 새 스테이지 소속
    assert state["calls"] == 1  # skip도 인터뷰어 1콜
    assert result.draw_due is None  # io는 구조 스테이지가 아니다


def test_skip_structure_stage_signals_multi_draw() -> None:
    """구조 스테이지(activities)를 skip으로 마감해도 draw 신호는 나온다."""
    db = _FakeDb()
    interview = _session(current_stage="activities")
    _, result = _run(db, interview, InterviewTurnIn(type="skip"), [INTERVIEWER_Q])
    assert interview.current_stage == "branches"
    assert result.draw_due == "multi"


def test_skip_on_final_stage_raises() -> None:
    db, interview = _FakeDb(), _session(current_stage="review")
    with pytest.raises(orchestrator.TurnError):
        _run(db, interview, InterviewTurnIn(type="skip"), [])


def test_repeated_reply_gets_one_corrective_retry() -> None:
    """직전 컨설턴트 메시지를 거의 그대로 재출력하면 1회 교정 재질의한다 (실사용 회귀 2026-07-24)."""
    from app.models import InterviewMessage

    db, interview = _FakeDb(), _session()
    prev = "정리했습니다.\n- 트리거: 몸무게 88 도달\n- 산출물: 미정\n\n이대로 진행할까요?"
    interview.messages.append(InterviewMessage(
        session_id=1, seq=1, role="consultant", kind="question", content=prev, stage="scope",
    ))
    repeat = json.dumps({"message": prev, "facts_patch": {}})
    fresh = json.dumps({"message": "산출물은 비워 두고 활동 정리로 넘어가시죠.", "facts_patch": {}})
    _run(db, interview, InterviewTurnIn(type="answer", content="네, 맞습니다"), [repeat, fresh])
    question = next(m for m in db.added if getattr(m, "kind", "") == "question")
    assert question.content == "산출물은 비워 두고 활동 정리로 넘어가시죠."


def test_normal_turn_unaffected_by_missing_doc_sections() -> None:
    db = _FakeDb()
    interview = _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="네"), [INTERVIEWER_Q])
    assert interview.working_graph is None  # 일반 턴은 그리지 않는다


# ---------- 사니타이저 단위 (draw 이벤트 경로에서 사용) ----------

_WORD_SECTIONS = [
    {"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1, "language": "ko"},
    {"anchor": "_Toc2", "title": "출고", "number": "2", "level": 1, "language": "ko"},
]

WORD_DRAFT = json.dumps({
    "kind": "graph", "message": "문서 기반 초안",
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start"},
        {"key": "a", "title": "아무거나", "node_type": "section",
         "attributes": {"section_anchor": "_Toc1"}},
        {"key": "b", "title": "유령 섹션", "node_type": "section",
         "attributes": {"section_anchor": "_TocGhost"}},
        {"key": "e", "title": "끝", "node_type": "end"},
    ],
    "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "b"},
              {"source": "b", "target": "e"}],
    "groups": [],
})


def test_sanitize_word_graph_demotes_and_rebuilds_labels() -> None:
    graph = json.loads(WORD_DRAFT)
    cleaned, demoted = orchestrator._sanitize_word_graph(
        {"nodes": graph["nodes"], "edges": graph["edges"], "groups": []}, _WORD_SECTIONS
    )
    by_key = {n["key"]: n for n in cleaned["nodes"]}
    assert demoted == 1
    assert by_key["a"]["node_type"] == "section"
    assert by_key["a"]["title"] == "1 재고"  # 카탈로그 기준 라벨 재구성 (§4)
    assert by_key["b"]["node_type"] == "process"  # 무효 앵커 강등
    assert (by_key["b"].get("attributes") or {}).get("section_anchor", "") == ""
    assert by_key["s"]["node_type"] == "start"  # 비섹션 무변경


def test_sanitize_promotes_valid_anchor_on_plain_node() -> None:
    """유효 앵커를 단 일반 노드는 섹션으로 승격 — '섹션 우선' 계약 잠금 (design 2026-07-26 §4)."""
    graph = {"nodes": [{"key": "p", "title": "아무거나", "node_type": "process",
                        "attributes": {"section_anchor": "_Toc2"}}], "edges": [], "groups": []}
    cleaned, demoted = orchestrator._sanitize_word_graph(graph, _WORD_SECTIONS)
    assert demoted == 0
    assert cleaned["nodes"][0]["node_type"] == "section"
    assert cleaned["nodes"][0]["title"] == "2 출고"


# ---------- 델타 드래프팅 (_expand_delta, speed redesign §5) ----------

_PREV = {
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start", "description": "", "attributes": None, "group_key": None},
        {"key": "a", "title": "요청서 작성", "node_type": "process", "description": "설명",
         "attributes": {"assignee": "김담당"}, "group_key": None},
        {"key": "e", "title": "끝", "node_type": "end", "description": "", "attributes": None, "group_key": None},
    ],
    "edges": [{"source": "s", "target": "a", "label": ""}, {"source": "a", "target": "e", "label": ""}],
    "groups": [],
}


def _proposal(nodes_json: list[dict], edges_json: list[dict]):
    from app.schemas import AiProposal

    return AiProposal.model_validate({
        "kind": "graph", "message": "", "nodes": nodes_json, "edges": edges_json, "groups": [],
    })


def test_expand_delta_restores_echoed_nodes() -> None:
    """{"key":"a"}만 에코해도 이전 작업본의 제목·타입·attributes가 복원된다."""
    proposal = _proposal(
        [{"key": "s"}, {"key": "a"},
         {"key": "n1", "title": "견적 비교", "node_type": "process"}, {"key": "e"}],
        [{"source": "s", "target": "a"}, {"source": "a", "target": "n1"},
         {"source": "n1", "target": "e"}],
    )
    expanded = orchestrator._expand_delta(proposal, _PREV)
    by_key = {n.key: n for n in expanded.nodes}
    assert by_key["a"].title == "요청서 작성"
    assert by_key["a"].description == "설명"
    assert by_key["a"].attributes is not None and by_key["a"].attributes.assignee == "김담당"
    assert by_key["s"].node_type == "start" and by_key["e"].node_type == "end"
    assert by_key["n1"].title == "견적 비교"  # 신규 노드는 풀 스펙 그대로


def test_expand_delta_field_override_wins() -> None:
    """에코에 title만 실으면 title만 갱신되고 나머지는 복원된다."""
    proposal = _proposal([{"key": "a", "title": "요청서 접수"}], [])
    expanded = orchestrator._expand_delta(proposal, _PREV)
    node = expanded.nodes[0]
    assert node.title == "요청서 접수"
    assert node.description == "설명"  # 미제공 필드는 이전 값


def test_expand_delta_missing_key_means_delete() -> None:
    """목록에서 빠진 키(a)는 결과에 없다 — 델타의 삭제 표현."""
    proposal = _proposal(
        [{"key": "s"}, {"key": "e"}],
        [{"source": "s", "target": "e"}],
    )
    expanded = orchestrator._expand_delta(proposal, _PREV)
    assert {n.key for n in expanded.nodes} == {"s", "e"}
    assert [(e.source, e.target) for e in expanded.edges] == [("s", "e")]


def test_expand_delta_unknown_key_without_title_dropped() -> None:
    proposal = _proposal([{"key": "ghost"}, {"key": "a"}], [{"source": "ghost", "target": "a"}])
    expanded = orchestrator._expand_delta(proposal, _PREV)
    assert {n.key for n in expanded.nodes} == {"a"}
    assert expanded.edges == []


def test_expand_delta_full_spec_on_empty_prev() -> None:
    """빈 캔버스 첫 생성 — prev 없음이면 풀 스펙 노드만 통과한다."""
    proposal = _proposal(
        [{"key": "s", "title": "시작", "node_type": "start"},
         {"key": "x", "title": "활동", "node_type": "process"}],
        [{"source": "s", "target": "x"}],
    )
    expanded = orchestrator._expand_delta(proposal, None)
    assert {n.key for n in expanded.nodes} == {"s", "x"}


def test_expand_delta_survives_invalid_previous_node() -> None:
    """이전 작업본 노드가 계약 위반(두 통화 공존)이어도 예외 없이 드롭 — draw 500 방지."""
    prev = {
        "nodes": [{"key": "bad", "title": "위반 노드", "node_type": "process",
                   "attributes": {"cost_krw": "1000", "cost_usd": "5"}, "group_key": None}],
        "edges": [], "groups": [],
    }
    proposal = _proposal([{"key": "bad"}, {"key": "ok", "title": "정상", "node_type": "process"}],
                         [{"source": "bad", "target": "ok"}])
    expanded = orchestrator._expand_delta(proposal, prev)
    assert {n.key for n in expanded.nodes} == {"ok"}  # 위반 노드는 조용히 드롭
    assert expanded.edges == []


def test_roles_completion_with_table_signals_params() -> None:
    """roles→review 전이(새 시퀀스)에서 수집 표가 있으면 draw_due == 'params'."""
    db = _FakeDb()
    interview = _session(current_stage="roles",
                         facts={"params": {"params_table": {"A": {"duration": "0.30"}}}})
    reply = json.dumps({"message": "역할 확정", "facts_patch": {"roles": "구매팀"},
                        "stage_complete": True})
    _, result = _run(db, interview, InterviewTurnIn(type="answer", content="확정"), [reply])
    assert interview.current_stage == "review"
    assert result.draw_due == "params"


def test_params_table_routes_to_params_namespace_from_any_stage() -> None:
    """params_table은 어느 스테이지에서 수집돼도 'params' 네임스페이스로 — 표/반영 경로 단일화."""
    db = _FakeDb()
    interview = _session(current_stage="activities")
    reply = json.dumps({"message": "확인", "facts_patch": {
        "activities": "요청서 작성",
        "params_table": {"요청서 작성": {"duration": "1.00"}},
    }})
    _run(db, interview, InterviewTurnIn(type="answer", content="1시간 걸려"), [reply])
    assert interview.facts["params"]["params_table"]["요청서 작성"]["duration"] == "1.00"
    assert "params_table" not in interview.facts["activities"]
    assert interview.facts["activities"]["activities"] == "요청서 작성"


def test_choice_turn_suppresses_redraw_signals() -> None:
    """수락 턴은 multi/single 재드로 신호를 내지 않는다 — 수락→재드로→모달 반복 루프 차단 (2026-07-28)."""
    db = _FakeDb()
    option = {"id": "opt-1", "title": "표준안", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(current_stage="activities", pending_choices={"options": [option]})
    reply = json.dumps({"message": "확정했습니다", "facts_patch": {"activities": "요청·비교"},
                        "stage_complete": True, "redraw": True})
    _, result = _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"), [reply])
    assert interview.current_stage == "branches"  # 전이·체크포인트는 그대로
    assert result.draw_due is None


def test_choice_turn_params_signal_passes_through() -> None:
    """수락 턴이 review로 전이하면 params 표 신호(AI 0콜 모달)는 그대로 통과한다."""
    db = _FakeDb()
    option = {"id": "opt-1", "title": "표준안", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(
        current_stage="roles",
        pending_choices={"options": [option]},
        facts={"params": {"params_table": {"요청서 작성": {"duration": "0.30"}}}},
    )
    reply = json.dumps({"message": "역할 확정", "facts_patch": {"roles": "구매팀"},
                        "stage_complete": True})
    _, result = _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"), [reply])
    assert interview.current_stage == "review"
    assert result.draw_due == "params"


def test_expand_delta_deep_merges_attributes() -> None:
    """수정 노드의 attributes 딥머지 — 드래프터가 모르는 apply-params 축적분(duration 등)이
    통짜 교체로 증발하지 않는다 (hardening T6)."""
    from app.schemas import AiProposal

    prev = {"nodes": [{"key": "a", "title": "요청서 작성", "node_type": "process",
                       "description": "", "group_key": None,
                       "attributes": {"duration": "0.30", "cost_krw": "1000"}}],
            "edges": [], "groups": []}
    proposal = AiProposal.model_validate({
        "kind": "graph", "message": "",
        "nodes": [{"key": "a", "title": "구매 요청서 작성", "node_type": "process",
                   "attributes": {"assignee": "김구매"}}],
        "edges": [], "groups": [],
    })
    out = orchestrator._expand_delta(proposal, prev)
    attrs = out.nodes[0].attributes
    assert attrs is not None
    assert attrs.duration == "0.30"  # 기존 params 보존
    assert attrs.cost_krw == "1000"
    assert attrs.assignee == "김구매"  # 명시 필드는 반영
    assert out.nodes[0].title == "구매 요청서 작성"


def test_expand_delta_restores_groups_and_drops_ghost_refs() -> None:
    """에코 노드가 물려받은 group_key의 그룹은 이전 작업본에서 복원, 이전 작업본에도 정의가
    없는 참조는 제거 (hardening T6). AiProposal 검증기가 명시 노드의 미지 group_key는 이미
    거부하므로 — 이 경로는 에코 병합에서만 발생한다."""
    from app.schemas import AiProposal

    prev = {"nodes": [
        {"key": "a", "title": "요청", "node_type": "process",
         "description": "", "group_key": "g1", "attributes": None},
        {"key": "c", "title": "검수", "node_type": "process",
         "description": "", "group_key": "ghost", "attributes": None},  # prev 자체 결손 방어
    ], "edges": [], "groups": [{"key": "g1", "label": "구매팀 레인"}]}
    proposal = AiProposal.model_validate({
        "kind": "graph", "message": "",
        "nodes": [{"key": "a"}, {"key": "c"}],
        "edges": [], "groups": [],
    })
    out = orchestrator._expand_delta(proposal, prev)
    assert [g.key for g in out.groups] == ["g1"]
    by_key = {n.key: n for n in out.nodes}
    assert by_key["a"].group_key == "g1"  # 에코 노드의 그룹 복원
    assert by_key["c"].group_key is None  # 어디에도 정의 없는 참조 제거


def test_sanitize_subprocess_key_match_survives_rename() -> None:
    """SP 링크는 키 우선 매칭 — 라벨 언어 변경 등 리네임만으로 process 강등되지 않는다 (hardening T7)."""
    prev = {"nodes": [{"key": "sp1", "title": "정산 처리", "node_type": "subprocess",
                       "linked_map_id": 42}]}
    graph = {"nodes": [{"key": "sp1", "title": "Run settlement", "node_type": "subprocess"}],
             "edges": [], "groups": []}
    out = orchestrator._sanitize_subprocess(graph, prev)
    assert out["nodes"][0]["node_type"] == "subprocess"
    assert out["nodes"][0]["linked_map_id"] == 42


def test_recent_choice_stage_prefers_activities_after_fast_forward() -> None:
    """fast-forward 직후 multi 힌트는 세분도(activities) 축 — 체크포인트 순서상 branches가
    최신으로 잡히는 것을 보정 (design 2026-07-29 §3)."""
    from app.models import InterviewCheckpoint, InterviewMessage

    interview = _session(current_stage="review")
    interview.messages.append(InterviewMessage(
        session_id=1, seq=5, role="user", kind="fast_forward", content="이대로 그려주세요.",
        stage="scope",
    ))
    interview.checkpoints = [
        InterviewCheckpoint(id=1, session_id=1, stage="activities", facts={},
                            working_graph=None, message_seq=5),
        InterviewCheckpoint(id=2, session_id=1, stage="branches", facts={},
                            working_graph=None, message_seq=5),
    ]
    assert orchestrator._recent_choice_stage(interview) == "activities"


def test_choice_accept_stamps_stage_facts_and_advances() -> None:
    """수락 = 구조 결정 확정 — choice 스테이지 필수 facts를 수락안으로 스탬프하고 같은 턴에 전이.
    안 하면 인터뷰어가 '이대로 확정할까요?'를 재질문하고 그 답변 턴의 전이가 재드로를
    유발해 채팅-맵 싱크가 깨진다 (실사용 피드백 2026-07-30)."""
    db = _FakeDb()
    option = {"id": "opt-1", "title": "표준안", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(current_stage="activities", pending_choices={"options": [option]})
    # 인터뷰어가 stage_complete를 주지 않아도 결정적으로 전이한다
    reply = json.dumps({"message": "다음은 분기입니다.", "facts_patch": {}})
    _, result = _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"), [reply])
    assert interview.facts["activities"]["activities"] == ["요청서 작성"]
    assert interview.current_stage == "branches"
    assert result.draw_due is None  # 수락 턴 재드로 억제와 결합 — 루프 종결
    checkpoints = [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"]
    assert len(checkpoints) == 1 and checkpoints[0].stage == "activities"


def test_choice_accept_branches_without_decisions_stamps_fallback() -> None:
    db = _FakeDb()
    option = {"id": "opt-1", "title": "해피패스", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(current_stage="branches", pending_choices={"options": [option]})
    reply = json.dumps({"message": "역할로 넘어가죠.", "facts_patch": {}})
    _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"), [reply])
    assert interview.facts["branches"]["branches"] == "분기 없음(수락안 기준)"
    assert interview.current_stage == "roles"
