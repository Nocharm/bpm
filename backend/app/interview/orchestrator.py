"""인터뷰 턴 파이프라인 — 인터뷰어→(드래프터 병렬)→톤 검수 조율 (design 2026-07-23 §4).

커밋은 하지 않는다 — 라우터가 턴 단위로 commit/rollback해 원자성을 보장한다.
"""

import asyncio
import difflib
import logging
from dataclasses import dataclass
from typing import TypeVar

from pydantic import BaseModel

from app import ai_client
from app.interview import engine
from app.interview.agents import (
    CHOICE_VARIANT_HINTS,
    InterviewerOut,
    build_drafter_messages,
    build_interviewer_messages,
    extract_json,
    format_section_catalog,
)
from app.models import InterviewCheckpoint, InterviewMessage, InterviewSession
from app.schemas import AiProposal, InterviewTurnIn
from app.settings import settings

logger = logging.getLogger(__name__)

_HISTORY_TAIL = 8  # 인터뷰어에 싣는 최근 대화 수 — 컨텍스트 예산 가드(프롬프트 다이어트, speed redesign §3)


class TurnError(Exception):
    """AI 호출/검증 실패 — 라우터가 502로 변환. 세션 상태는 롤백으로 불변."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.status_code = 502


@dataclass(frozen=True)
class TurnResult:
    """턴 결과 신호 — 라우터가 응답 플래그로 전달 (speed redesign §4).

    draw_due: "multi"(구조 스테이지 완료) | "single"(review 진입·redraw 요청) | None.
    """

    draw_due: str | None = None


def _draw_due(pre_stage: str, interview: InterviewSession, out: InterviewerOut) -> str | None:
    transitioned = interview.current_stage != pre_stage
    if transitioned and engine.get_stage(pre_stage, interview.mode).choice_stage:
        return "multi"
    if transitioned and interview.current_stage == "review":
        return "single"
    if out.redraw or out.needs_choices:
        return "single"
    return None


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


_DEMOTE_NOTICE = {
    "ko": "{n}개 활동은 문서 섹션을 찾지 못해 일반 노드로 추가했습니다.",
    "en": "{n} activities could not be matched to a document section and were added as plain nodes.",
}


def _sanitize_word_graph(graph: dict, doc_sections: list[dict]) -> tuple[dict, int]:
    """word 드래프터 출력 정합 — 실존 앵커만 섹션 유지(라벨 '번호 제목' 재구성), 무효는 process 강등.

    프롬프트만으론 앵커 환각을 못 막는다 — 죽은 링크가 문서에 박히는 것을 서버가 차단 (design 2026-07-26 §4).
    """
    by_anchor = {s.get("anchor"): s for s in doc_sections if s.get("anchor")}
    demoted = 0
    nodes = []
    for raw in graph.get("nodes", []):
        node = dict(raw)
        anchor = ((node.get("attributes") or {}).get("section_anchor") or "").strip()
        if node.get("node_type") == "section" or anchor:
            sec = by_anchor.get(anchor)
            if sec is None:
                demoted += 1
                node["node_type"] = "process"
                node["attributes"] = {**(node.get("attributes") or {}), "section_anchor": ""}
            else:
                node["node_type"] = "section"
                node["title"] = f"{sec.get('number', '')} {sec.get('title', '')}".strip()[:200]
                node["attributes"] = {**(node.get("attributes") or {}), "section_anchor": anchor}
        nodes.append(node)
    return {**graph, "nodes": nodes}, demoted


def _sanitize_subprocess(graph: dict, prev: dict | None) -> dict:
    """AI 출력의 subprocess는 이전 작업본에 실존하는 링크(제목 매칭)만 유지 — 환각은 process 강등.

    링크 대상(linked_map_id)은 AI 응답이 아닌 이전 작업본이 단일 진실원 (word 앵커 사니타이즈와 동형).
    """
    prev_links = {
        n.get("title"): n.get("linked_map_id")
        for n in (prev or {}).get("nodes", [])
        if n.get("node_type") == "subprocess" and n.get("linked_map_id")
    }
    nodes = []
    for raw in graph.get("nodes", []):
        node = dict(raw)
        if node.get("node_type") == "subprocess":
            linked = prev_links.get(node.get("title"))
            if linked:
                node["linked_map_id"] = linked
            else:
                node["node_type"] = "process"
                node.pop("linked_map_id", None)
        nodes.append(node)
    return {**graph, "nodes": nodes}


def _word_catalog_text(interview: InterviewSession, doc_sections: list[dict] | None) -> str:
    if interview.mode != "word" or not doc_sections:
        return ""
    language = (interview.facts.get("scope") or {}).get("language") or None
    return format_section_catalog(doc_sections, language)


def _graph_signature(graph: dict | None) -> tuple:
    """구조 시그니처 — 임시키가 아닌 제목 기준으로 노드·엣지·그룹을 정규화해 안 간 동일성을 판정.

    설명·attributes 차이는 무시한다 — 화면(순서도)에서 같아 보이는 안은 같은 안이다.
    """
    if not graph:
        return ()
    titles = {n.get("key"): (n.get("title") or "").strip() for n in graph.get("nodes", [])}
    group_labels = {g.get("key"): (g.get("label") or "").strip() for g in graph.get("groups", [])}
    nodes = sorted(
        (n.get("node_type") or "", (n.get("title") or "").strip(),
         group_labels.get(n.get("group_key") or "", ""))
        for n in graph.get("nodes", [])
    )
    edges = sorted(
        (titles.get(e.get("source"), ""), titles.get(e.get("target"), ""),
         (e.get("label") or "").strip())
        for e in graph.get("edges", [])
    )
    return (tuple(nodes), tuple(edges), tuple(sorted(group_labels.values())))


async def _generate_choices(
    interview: InterviewSession, context_text: str, model: str | None,
    doc_sections: list[dict] | None = None,
) -> dict | None:
    hints = CHOICE_VARIANT_HINTS.get(interview.current_stage, [])
    count = max(1, min(settings.interview_choice_count, 3, len(hints) or 1))
    tasks = [
        _ask_json(
            build_drafter_messages(
                interview.current_stage, interview.lang, interview.facts,
                interview.working_graph, context_text, hints[i % max(len(hints), 1)],
                mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections),
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
        graph = _sanitize_subprocess(_graph_from_proposal(result), interview.working_graph)
        if interview.mode == "word" and doc_sections:
            graph, _ = _sanitize_word_graph(graph, doc_sections)
        options.append({
            "id": f"opt-{i + 1}",
            "title": hints[i % max(len(hints), 1)].split("—")[0].strip(),
            "summary": result.message,
            "graph": graph,
        })
    if not options:
        raise TurnError("AI failed to generate choices")
    # 무변화·중복 안 필터 — 현재 작업본과 같은 안, 서로 같은 안은 제시 의미가 없다 (실사용 피드백 2026-07-27)
    current_sig = _graph_signature(interview.working_graph)
    seen: set[tuple] = set()
    distinct = []
    for option in options:
        sig = _graph_signature(option["graph"])
        if sig == current_sig or sig in seen:
            continue
        seen.add(sig)
        distinct.append(option)
    if not distinct:
        return None  # 전부 현재 작업본과 동일 — 선택지 없이 일반 턴으로 계속
    return {"options": distinct}


_REDRAFT_HINT = "현재까지 확정된 facts를 충실히 반영한 표준 세분도 — 확정 안 된 내용은 넣지 않기"


# 반복 판정 임계 — 직전 컨설턴트 메시지와 거의 동일한 재출력만 잡는다(0~1, 보수적)
_REPEAT_RATIO = 0.9

_ANTI_REPEAT_NUDGE = (
    "방금 답변이 직전 컨설턴트 메시지와 동일한 반복입니다. 같은 요약을 다시 쓰지 말고, "
    "이미 확인된 내용의 재나열 없이 새로운 제안 또는 다음 질문 하나로만 다시 답하세요."
)


def _is_repeat(new: str, prev: str) -> bool:
    if not new or not prev:
        return False
    return difflib.SequenceMatcher(None, new.strip(), prev.strip()).ratio() >= _REPEAT_RATIO


_SKIP_USER_TEXT = {
    "ko": "이 단계는 여기까지 하고 다음 단계로 넘어갈게요.",
    "en": "Let's move on to the next stage.",
}

_UNKNOWN_VALUE = {"ko": "미정", "en": "TBD"}


async def _run_skip_turn(
    db, interview: InterviewSession, graph_summary: str, context_text: str, model: str | None,
    doc_sections: list[dict] | None = None,
) -> TurnResult:
    """결정적 스테이지 전진 — 미확정 필수 facts를 '미정'으로 채우고 체크포인트 후 다음 단계 개시.

    모델이 미정 항목을 놓지 못해 같은 질문을 반복하는 루프의 탈출구 (실사용 회귀 2026-07-24).
    인터뷰어 1콜만 — 그리기는 draw 이벤트로 분리 (speed redesign §3).
    """
    pre_stage = interview.current_stage
    next_key = engine.next_stage_key(interview.current_stage, interview.mode)
    if next_key is None:
        raise TurnError("cannot skip the final stage")

    stage = engine.get_stage(interview.current_stage, interview.mode)
    unknown = _UNKNOWN_VALUE.get(interview.lang, _UNKNOWN_VALUE["ko"])
    stage_facts = dict(interview.facts.get(interview.current_stage) or {})
    for name in stage.required_facts:
        if not stage_facts.get(name):
            stage_facts[name] = unknown
    interview.facts = {**interview.facts, interview.current_stage: stage_facts}

    seq = next_seq(interview)
    _append(db, interview, seq, "user", "skip",
            _SKIP_USER_TEXT.get(interview.lang, _SKIP_USER_TEXT["ko"]))
    db.add(InterviewCheckpoint(
        session_id=interview.id, stage=interview.current_stage,
        facts=interview.facts, working_graph=interview.working_graph,
        message_seq=seq,
    ))
    interview.current_stage = next_key
    interview.pending_choices = None

    out = await _ask_json(
        build_interviewer_messages(
            interview.current_stage, interview.lang, interview.facts,
            graph_summary, context_text, _history_tail(interview)[:-1],
            "[사용자가 다음 단계로 넘어가기를 선택했습니다. 새 단계의 첫 제안이나 질문을 하세요.]",
            mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections),
        ),
        model, InterviewerOut,
    )
    if out.facts_patch:
        new_facts = dict(interview.facts.get(interview.current_stage) or {})
        new_facts.update(out.facts_patch)
        interview.facts = {**interview.facts, interview.current_stage: new_facts}
    _append(db, interview, seq + 1, "consultant", "question", out.message,
            payload={"options": out.options} if out.options else None)
    return TurnResult(draw_due=_draw_due(pre_stage, interview, out))


async def run_turn(
    db,
    interview: InterviewSession,
    turn: InterviewTurnIn,
    graph_summary: str,
    context_text: str,
    model: str | None = None,
    doc_sections: list[dict] | None = None,
) -> TurnResult:
    """일반 턴 = 인터뷰어 1콜 — 그리기·선택지·톤 검수는 draw 이벤트로 분리 (speed redesign §3)."""
    if turn.type == "skip":
        return await _run_skip_turn(db, interview, graph_summary, context_text, model, doc_sections)

    pre_stage = interview.current_stage
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

    # 직전 컨설턴트 발화 — 거의 동일한 재출력이면 1회 교정 재질의 (실사용 회귀 2026-07-24 반복 루프)
    prev_consultant = next(
        (m.content for m in reversed(interview.messages)
         if not m.superseded and m.role == "consultant" and m.kind != "notice"),
        "",
    )
    interviewer_messages = build_interviewer_messages(
        interview.current_stage, interview.lang, interview.facts,
        graph_summary, context_text, _history_tail(interview)[:-1], user_input,
        mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections),
    )
    out = await _ask_json(interviewer_messages, model, InterviewerOut)
    if _is_repeat(out.message, prev_consultant):
        try:
            out = await _ask_json(
                [*interviewer_messages,
                 {"role": "assistant", "content": out.message},
                 {"role": "user", "content": _ANTI_REPEAT_NUDGE}],
                model, InterviewerOut,
            )
        except TurnError:
            logger.warning("interview anti-repeat retry failed — keeping original reply")

    # facts 병합 — 현재 스테이지 네임스페이스에만
    if out.facts_patch:
        stage_facts = dict(interview.facts.get(interview.current_stage) or {})
        stage_facts.update(out.facts_patch)
        interview.facts = {**interview.facts, interview.current_stage: stage_facts}

    _append(db, interview, seq + 1, "consultant", "question", out.message,
            payload={"options": out.options} if out.options else None)

    # 스테이지 완료 — 다음 단계가 있을 때만 체크포인트+전이.
    # review(마지막)에서는 반복 실행하지 않는다 — 매 턴 stage_complete를 주는 모델이
    # 같은 자리에서 체크포인트를 스팸하는 것을 차단 (실사용 회귀 2026-07-23).
    next_key = engine.next_stage_key(interview.current_stage, interview.mode)
    is_complete = out.stage_complete or engine.is_stage_complete(
        interview.current_stage, interview.facts, interview.mode
    )
    if is_complete and next_key is not None:
        db.add(InterviewCheckpoint(
            session_id=interview.id, stage=interview.current_stage,
            facts=interview.facts, working_graph=interview.working_graph,
            message_seq=next_seq(interview) - 1,
        ))
        interview.current_stage = next_key
    return TurnResult(draw_due=_draw_due(pre_stage, interview, out))
