"""오케스트레이터 — 턴 파이프라인·병렬 선택지·스테이지 완료 체크포인트 (AI 모킹)."""

import asyncio
import json

import pytest

from app import ai_client
from app.interview import orchestrator
from app.models import InterviewSession
from app.schemas import InterviewTurnIn
from app.settings import settings


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
    """호출 순서대로 응답을 소모하는 fake call_ai — 병렬 검증용 동시 카운터 포함."""
    queue = list(replies)
    state = {"active": 0, "peak": 0}

    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
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
INTERVIEWER_CHOICES = json.dumps({
    "message": "활동 골격 안을 보여드릴게요.", "facts_patch": {}, "needs_choices": True,
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
TONE = json.dumps({"message": "표준 부합", "renames": [{"key": "a", "title": "요청서 접수"}]})


def _run(db, interview, turn, replies):
    fake, state = _scripted_ai(replies)

    async def _go(monkey_target=fake):
        orchestrator_call = orchestrator  # 가독용
        orig = ai_client.call_ai
        ai_client.call_ai = monkey_target
        try:
            await orchestrator_call.run_turn(db, interview, turn, "(빈 캔버스)", "")
        finally:
            ai_client.call_ai = orig

    asyncio.run(_go())
    return state


def test_answer_turn_appends_messages_and_merges_facts() -> None:
    db, interview = _FakeDb(), _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"), [INTERVIEWER_Q])
    assert interview.facts["scope"]["process_name"] == "구매"
    roles = [m.role for m in db.added]
    assert roles == ["user", "consultant"]
    assert db.added[1].kind == "question"


def test_stage_complete_creates_checkpoint_and_advances() -> None:
    db, interview = _FakeDb(), _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="접수부터 발주까지"),
         [INTERVIEWER_DONE])
    assert interview.current_stage == "io"
    checkpoints = [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"]
    assert len(checkpoints) == 1 and checkpoints[0].stage == "scope"


def test_choices_generated_in_parallel_and_pending_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "interview_choice_count", 2)
    db = _FakeDb()
    interview = _session(current_stage="activities",
                         facts={"scope": {"process_name": "구매", "purpose": "p", "boundaries": "b"},
                                "io": {"trigger": "t", "inputs": "i", "outputs": "o"}})
    state = _run(db, interview, InterviewTurnIn(type="answer", content="활동 보여줘"),
                 [INTERVIEWER_CHOICES, DRAFT, DRAFT])
    assert state["peak"] == 2  # 드래프터 2안 병렬
    assert interview.pending_choices is not None
    assert len(interview.pending_choices["options"]) == 2
    consultant = [m for m in db.added if m.role == "consultant"][-1]
    assert consultant.kind == "choices"


def test_choice_turn_applies_graph_and_clears_pending() -> None:
    db = _FakeDb()
    option = {"id": "opt-1", "title": "표준안", "summary": "", "graph": json.loads(DRAFT)}
    option["graph"].pop("kind", None)
    interview = _session(current_stage="activities",
                         pending_choices={"options": [option]},
                         facts={"activities": {}})
    _run(db, interview, InterviewTurnIn(type="choice", choice_id="opt-1"), [INTERVIEWER_Q])
    assert interview.pending_choices is None
    assert interview.working_graph is not None
    assert any(n["key"] == "a" for n in interview.working_graph["nodes"])
    # 대화 이력엔 옵션 id가 아닌 제목이 남는다 (실사용 회귀 2026-07-23)
    user_msg = next(m for m in db.added if m.role == "user")
    assert user_msg.content == "표준안"


def test_stage_complete_runs_tone_review_renames() -> None:
    db = _FakeDb()
    graph = json.loads(DRAFT)
    graph.pop("kind", None)
    interview = _session(current_stage="activities", working_graph=graph,
                         facts={"activities": {}})
    # 연속 드래프트가 먼저 실행(facts_patch 존재)되므로 인터뷰어→드래프터→톤 순으로 스크립트
    _run(db, interview,
         InterviewTurnIn(type="answer", content="이대로 좋아요"),
         [json.dumps({"message": "확정", "facts_patch": {"activities": "요청서 작성"},
                      "stage_complete": True}), DRAFT, TONE])
    titles = {n["key"]: n["title"] for n in interview.working_graph["nodes"]}
    assert titles["a"] == "요청서 접수"  # 톤 검수 개명 반영
    # 노티스는 무슨 개명이 적용됐는지 구체적으로 알린다 (실사용 회귀 2026-07-23)
    notice = next(m for m in db.added if getattr(m, "kind", "") == "notice")
    assert "'요청서 작성' → '요청서 접수'" in notice.content


def test_review_stage_completion_does_not_spam_checkpoint_or_tone() -> None:
    """review(마지막)에서 stage_complete여도 체크포인트·톤 검수 반복 금지 (실사용 회귀 2026-07-23)."""
    db = _FakeDb()
    graph = json.loads(DRAFT)
    graph.pop("kind", None)
    interview = _session(current_stage="review", working_graph=graph, facts={})
    # 스크립트 응답이 1개뿐 — 톤 검수가 호출되면 queue 고갈로 실패했을 것
    _run(db, interview,
         InterviewTurnIn(type="answer", content="좋아요 이대로 확정"),
         [json.dumps({"message": "검토 완료입니다. 우측 하단 Apply로 적용하세요.",
                      "stage_complete": True})])
    assert interview.current_stage == "review"
    assert [type(o).__name__ for o in db.added if type(o).__name__ == "InterviewCheckpoint"] == []
    kinds = [m.kind for m in db.added]
    assert kinds == ["answer", "question"]


def test_facts_update_triggers_live_redraft() -> None:
    """facts가 갱신된 일반 턴은 드래프터를 돌려 맵을 라이브 갱신한다 (실사용 회귀 2026-07-24)."""
    db, interview = _FakeDb(), _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"),
         [INTERVIEWER_Q, DRAFT])
    assert interview.working_graph is not None
    assert any(n["title"] == "요청서 작성" for n in interview.working_graph["nodes"])


def test_redraft_failure_does_not_kill_turn() -> None:
    """드래프터 실패는 턴을 죽이지 않는다 — 인터뷰어 응답은 그대로 전달."""
    db, interview = _FakeDb(), _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="구매 프로세스"),
         [INTERVIEWER_Q, "깨진 드래프트", "여전히 깨짐"])
    assert interview.working_graph is None
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
    """skip 턴은 미확정 필수 facts를 '미정'으로 채우고 결정적으로 다음 단계로 전진한다.

    미정 항목을 모델이 놓지 못해 같은 질문을 반복하는 루프의 탈출구 (실사용 회귀 2026-07-24).
    """
    db = _FakeDb()
    interview = _session(
        current_stage="io",
        facts={"scope": {"process_name": "다이어트", "purpose": "p", "boundaries": "b"},
               "io": {"trigger": "몸무게 88 도달", "inputs": "운동 계획"}},
    )
    # 스크립트: 새 스테이지 인터뷰어 → 재드래프트
    _run(db, interview, InterviewTurnIn(type="skip"), [INTERVIEWER_Q, DRAFT])
    assert interview.facts["io"]["outputs"] == "미정"
    assert interview.facts["io"]["trigger"] == "몸무게 88 도달"  # 기확정 값은 보존
    assert interview.current_stage == "activities"
    checkpoints = [o for o in db.added if type(o).__name__ == "InterviewCheckpoint"]
    assert len(checkpoints) == 1 and checkpoints[0].stage == "io"
    user_msg = next(m for m in db.added if getattr(m, "role", "") == "user")
    assert user_msg.kind == "skip"
    consultant = next(m for m in db.added if getattr(m, "role", "") == "consultant")
    assert consultant.stage == "activities"  # 개시 질문은 새 스테이지 소속
    assert interview.working_graph is not None  # 미정 채움 후 재드래프트 수행


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


def test_redraw_request_triggers_redraft_without_facts() -> None:
    """facts 변화가 없어도 redraw=true면 드래프터가 돌아 맵이 갱신된다 (실사용 회귀 2026-07-24)."""
    db, interview = _FakeDb(), _session(
        facts={"scope": {"process_name": "다이어트"}},
    )
    reply = json.dumps({"message": "맵을 갱신했습니다.", "facts_patch": {}, "redraw": True})
    _run(db, interview, InterviewTurnIn(type="answer", content="그림 그리라고 그림"), [reply, DRAFT])
    assert interview.working_graph is not None
    assert any(n["title"] == "요청서 작성" for n in interview.working_graph["nodes"])
