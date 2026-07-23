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


def test_stage_complete_runs_tone_review_renames() -> None:
    db = _FakeDb()
    graph = json.loads(DRAFT)
    graph.pop("kind", None)
    interview = _session(current_stage="activities", working_graph=graph,
                         facts={"activities": {}})
    _run(db, interview,
         InterviewTurnIn(type="answer", content="이대로 좋아요"),
         [json.dumps({"message": "확정", "facts_patch": {"activities": "요청서 작성"},
                      "stage_complete": True}), TONE])
    titles = {n["key"]: n["title"] for n in interview.working_graph["nodes"]}
    assert titles["a"] == "요청서 접수"  # 톤 검수 개명 반영


def test_invalid_ai_json_retries_then_turn_error() -> None:
    db, interview = _FakeDb(), _session()
    with pytest.raises(orchestrator.TurnError):
        _run(db, interview, InterviewTurnIn(type="answer", content="x"),
             ["깨진 응답", "여전히 깨짐"])
