"""인터뷰 턴 파이프라인 — 인터뷰어→(드래프터 병렬)→톤 검수 조율 (design 2026-07-23 §4).

커밋은 하지 않는다 — 라우터가 턴 단위로 commit/rollback해 원자성을 보장한다.
"""

import asyncio
import logging
from typing import TypeVar

from pydantic import BaseModel

from app import ai_client
from app.interview import engine
from app.interview.agents import (
    CHOICE_VARIANT_HINTS,
    InterviewerOut,
    ToneReviewOut,
    build_drafter_messages,
    build_interviewer_messages,
    build_tone_messages,
    extract_json,
)
from app.models import InterviewCheckpoint, InterviewMessage, InterviewSession
from app.schemas import AiProposal, InterviewTurnIn
from app.settings import settings

logger = logging.getLogger(__name__)

_HISTORY_TAIL = 12  # 인터뷰어에 싣는 최근 대화 수 — 컨텍스트 예산 가드


class TurnError(Exception):
    """AI 호출/검증 실패 — 라우터가 502로 변환. 세션 상태는 롤백으로 불변."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.status_code = 502


_SchemaT = TypeVar("_SchemaT", bound=BaseModel)


async def _ask_json(
    messages: list[dict], model: str | None, schema_cls: type[_SchemaT]
) -> _SchemaT:
    """call_ai + JSON 추출 + 스키마 검증 — 실패 1회 재프롬프트 후 TurnError."""
    for attempt in range(2):
        try:
            reply = await ai_client.call_ai(messages, model)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 오류는 TurnError로 정규화
            logger.warning("interview AI call failed: %s", exc)
            raise TurnError("AI server error") from exc
        try:
            return schema_cls.model_validate_json(extract_json(reply.content))
        except ValueError as exc:
            logger.warning(
                "interview AI invalid (attempt %d, %s): %s | raw=%.500s",
                attempt, schema_cls.__name__, exc, reply.content,
            )
            if attempt == 0:
                messages = [*messages, {"role": "user", "content": "유효한 JSON 한 개만 반환하세요."}]
    raise TurnError("AI returned invalid response")


def next_seq(interview: InterviewSession) -> int:
    return max((m.seq for m in interview.messages), default=0) + 1


def _append(
    db, interview: InterviewSession, seq: int, role: str, kind: str,
    content: str, payload: dict | None = None,
) -> InterviewMessage:
    msg = InterviewMessage(
        session_id=interview.id, seq=seq, role=role, kind=kind,
        content=content, payload=payload, stage=interview.current_stage,
    )
    db.add(msg)
    interview.messages.append(msg)
    return msg


def _history_tail(interview: InterviewSession) -> list[dict]:
    live = [m for m in interview.messages if not m.superseded]
    tail = live[-_HISTORY_TAIL:]
    role_map = {"consultant": "assistant", "user": "user"}
    return [{"role": role_map[m.role], "content": m.content} for m in tail if m.content]


def _graph_from_proposal(proposal: AiProposal) -> dict:
    """AiProposal(graph) → 작업본 dict — 키 기반, 좌표 없음(레이아웃은 프론트 dagre)."""
    return {
        "nodes": [n.model_dump() for n in proposal.nodes],
        "edges": [e.model_dump() for e in proposal.edges],
        "groups": [g.model_dump() for g in proposal.groups],
    }


async def _generate_choices(
    interview: InterviewSession, context_text: str, model: str | None
) -> dict:
    hints = CHOICE_VARIANT_HINTS.get(interview.current_stage, [])
    count = max(1, min(settings.interview_choice_count, 3, len(hints) or 1))
    tasks = [
        _ask_json(
            build_drafter_messages(
                interview.current_stage, interview.lang, interview.facts,
                interview.working_graph, context_text, hints[i % max(len(hints), 1)],
            ),
            model, AiProposal,
        )
        for i in range(count)
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    options = []
    for i, result in enumerate(results):
        if isinstance(result, BaseException) or result.kind != "graph":
            logger.warning("interview choice %d failed: %s", i, result)
            continue
        options.append({
            "id": f"opt-{i + 1}",
            "title": hints[i % max(len(hints), 1)].split("—")[0].strip(),
            "summary": result.message,
            "graph": _graph_from_proposal(result),
        })
    if not options:
        raise TurnError("AI failed to generate choices")
    return {"options": options}


async def _tone_review(
    interview: InterviewSession, model: str | None
) -> list[tuple[str, str]]:
    """톤 검수 실행 + 개명 적용 — 적용된 (기존 제목, 새 제목) 쌍을 반환(노티스 문구 재료)."""
    if not interview.working_graph or not interview.working_graph.get("nodes"):
        return []
    review = await _ask_json(
        build_tone_messages(interview.lang, interview.working_graph), model, ToneReviewOut
    )
    if not review.renames:
        return []
    # 실존 키만 + 실제로 제목이 바뀌는 것만 적용 — 모델이 지어낸 키/무의미 개명은 무시
    titles = {n["key"]: n["title"] for n in interview.working_graph["nodes"]}
    by_key = {
        r.key: r.title
        for r in review.renames
        if r.key in titles and r.title and r.title != titles[r.key]
    }
    if not by_key:
        return []
    nodes = [
        {**n, "title": by_key.get(n["key"], n["title"])}
        for n in interview.working_graph["nodes"]
    ]
    interview.working_graph = {**interview.working_graph, "nodes": nodes}
    return [(titles[key], title) for key, title in by_key.items()]


_TONE_NOTICE = {
    "ko": "노드 제목을 조직 표준('명사+동사')에 맞게 정리했습니다: {items}",
    "en": "Standardized node titles: {items}",
}


def _tone_notice_text(lang: str, applied: list[tuple[str, str]]) -> str:
    items = " · ".join(f"'{old}' → '{new}'" for old, new in applied)
    return _TONE_NOTICE.get(lang, _TONE_NOTICE["ko"]).format(items=items)


async def run_turn(
    db,
    interview: InterviewSession,
    turn: InterviewTurnIn,
    graph_summary: str,
    context_text: str,
    model: str | None = None,
) -> None:
    # 선택 턴 — 대상 옵션을 먼저 확정(사용자 메시지에 제목을 남기기 위해 append보다 선행)
    chosen: dict | None = None
    if turn.type == "choice":
        pending = interview.pending_choices or {}
        chosen = next(
            (o for o in pending.get("options", []) if o["id"] == turn.choice_id), None
        )
        if chosen is None:
            raise TurnError("unknown choice id")

    seq = next_seq(interview)
    # 대화 이력엔 옵션 id가 아닌 사람이 읽는 제목을 남긴다 (P3 RAG 원재료 겸용)
    user_content = chosen["title"] if chosen else (turn.content or "")
    _append(db, interview, seq, "user", turn.type, user_content,
            payload={"choice_id": turn.choice_id} if turn.choice_id else None)

    if chosen is not None:
        interview.working_graph = chosen["graph"]
        interview.pending_choices = None
        user_input = f"[{chosen['title']}] 안을 선택했습니다. 이어서 진행하세요."
    else:
        user_input = user_content

    out = await _ask_json(
        build_interviewer_messages(
            interview.current_stage, interview.lang, interview.facts,
            graph_summary, context_text, _history_tail(interview)[:-1], user_input,
        ),
        model, InterviewerOut,
    )

    # facts 병합 — 현재 스테이지 네임스페이스에만
    if out.facts_patch:
        stage_facts = dict(interview.facts.get(interview.current_stage) or {})
        stage_facts.update(out.facts_patch)
        interview.facts = {**interview.facts, interview.current_stage: stage_facts}

    stage = engine.get_stage(interview.current_stage)

    # 선택지 병렬 생성 — 구조 결정 스테이지에서만, 선택 턴 직후는 제외
    if out.needs_choices and stage.choice_stage and turn.type != "choice":
        choices = await _generate_choices(interview, context_text, model)
        interview.pending_choices = choices
        _append(db, interview, seq + 1, "consultant", "choices", out.message, payload=choices)
        return

    # 스테이지 완료 — 다음 단계가 있을 때만 체크포인트+톤 검수+전이.
    # review(마지막)에서는 반복 실행하지 않는다 — 매 턴 stage_complete를 주는 모델이
    # 같은 자리에서 체크포인트·톤 노티스를 스팸하는 것을 차단 (실사용 회귀 2026-07-23).
    next_key = engine.next_stage_key(interview.current_stage)
    is_complete = out.stage_complete or engine.is_stage_complete(
        interview.current_stage, interview.facts
    )
    if is_complete and next_key is not None:
        consultant_msg = _append(db, interview, seq + 1, "consultant", "question", out.message)
        applied = await _tone_review(interview, model)
        if applied:
            _append(db, interview, consultant_msg.seq + 1, "consultant", "notice",
                    _tone_notice_text(interview.lang, applied))
        db.add(InterviewCheckpoint(
            session_id=interview.id, stage=interview.current_stage,
            facts=interview.facts, working_graph=interview.working_graph,
            message_seq=next_seq(interview) - 1,
        ))
        interview.current_stage = next_key
        return

    _append(db, interview, seq + 1, "consultant", "question", out.message)
