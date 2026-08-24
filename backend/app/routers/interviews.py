"""AI 컨설턴트 인터뷰 API — 세션·턴·첨부·체크포인트·완료 (design 2026-07-23 §5)."""

import asyncio
import functools
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.app_settings import is_ai_access_enabled
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.interview.agents import format_graph_compact
from app.interview.engine import get_stage, next_stage_key
from app.interview.locks import interview_lock
from app.interview.orchestrator import (
    TurnError,
    demote_notice_text,
    extract_attachment_facts,
    generate_proposals,
    merge_params_table,
    run_turn,
    sum_usage,
    usage_log,
)
from app.kb import embed_client, indexing, retrieval, sp_suggest
from app.interview.parsing import (
    ALLOWED_EXTENSIONS,
    MAX_ATTACHMENT_BYTES,
    ParseError,
    clip_to_budget,
    parse_attachment,
)
from app.models import (
    AiUsageEvent,
    InterviewAttachment,
    InterviewCheckpoint,
    InterviewMessage,
    InterviewSession,
    KbChunk,
    MapVersion,
    ProcessMap,
)
from app.permissions.access import assert_map_role, get_effective_role, get_eligible_users
from app.permissions.deps import require_map_role
from app.prompt_registry import get_prompt_overrides
from app.routers.graph import _load_graph
from app.schemas import (
    InterviewApplyParamsIn,
    InterviewAttachmentOut,
    InterviewCreateIn,
    InterviewDrawIn,
    InterviewRevertIn,
    InterviewSpAcceptIn,
    InterviewStateOut,
    InterviewTurnIn,
)
from app.settings import settings

router = APIRouter(prefix="/api", tags=["interviews"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

# 파싱 직렬화 — 무거운 파싱이 동시에 몰리지 않게 1개씩 (스펙 §4 백그라운드 직렬화의 단순화)
_parse_lock = asyncio.Lock()


def _locked_by_interview(handler):
    """변이 핸들러 전체를 인터뷰 id 락으로 직렬화 — 동시 턴/첨부 추출의 facts 통짜 재할당
    상호 침식과 seq 중복을 차단 (hardening T3). functools.wraps로 시그니처 보존(FastAPI DI)."""

    @functools.wraps(handler)
    async def wrapper(*args, **kwargs):
        async with interview_lock(kwargs["interview_id"]):
            return await handler(*args, **kwargs)

    return wrapper

_ATTACH_NOTICE = {
    "parsed": {
        "ko": "'{filename}' 문서를 읽었습니다. 내용을 참고해 제안하며 진행하겠습니다.",
        "en": "I've read '{filename}'. I'll use it to propose answers as we go.",
    },
    "failed": {
        "ko": "'{filename}' 문서를 읽지 못했습니다(파싱 실패). 텍스트 기반 파일로 다시 올려주시면 참고하겠습니다.",
        "en": "I couldn't read '{filename}' (parse failed). Please re-upload a text-based file.",
    },
}

_GREETING = {
    "ko": "안녕하세요, 프로세스 컨설턴트입니다. 지금부터 몇 가지 질문으로 프로세스 맵을 함께 만들어보겠습니다. 먼저, 이 프로세스의 이름과 목적을 알려주세요. 참고할 문서가 있다면 지금 첨부하셔도 좋습니다.",
    "en": "Hello, I'm your process consultant. I'll ask a few questions to build the process map together. First, what is this process called and what is its purpose? Feel free to attach reference documents.",
}

_GREETING_WORD = {
    "ko": "안녕하세요! 이 Word 맵의 SOP 문서를 순서도로 옮겨 드릴게요. 문서 전체를 그릴까요, 특정 섹션 범위만 그릴까요? 원본 .docx를 첨부해 주시면 본문까지 반영해 더 정확하게 제안할 수 있습니다.",
    "en": "Hi! I'll turn this Word map's SOP document into a flowchart. Should I draw the whole document or one section subtree? Attach the original .docx and I can ground the draft in the body text.",
}

# 기존 데이터가 있는 맵의 오프닝 — 매번 같은 백지 인사 대신 파악한 내용을 먼저 제시 (실사용 피드백 2026-07-27)
_EXISTING_GREETING = {
    "ko": (
        "안녕하세요, 프로세스 컨설턴트입니다. '{map_name}' 맵에 이미 작성된 내용이 있어 먼저 파악했습니다.\n"
        "{summary}\n\n"
        "이 내용을 출발점으로 부족한 부분을 채워가겠습니다. 기존 맵을 보완할까요, 처음부터 다시 정리할까요? 참고할 문서가 있다면 지금 첨부하셔도 좋습니다."
    ),
    "en": (
        "Hello, I'm your process consultant. The map '{map_name}' already has content — here's what I found.\n"
        "{summary}\n\n"
        "I'll use this as our starting point and fill in what's missing. Should we refine the current map, or start over from scratch? Feel free to attach reference documents."
    ),
}

_EXISTING_GREETING_OPTIONS = {
    "ko": ["기존 맵을 보완할래요", "처음부터 다시 정리할래요"],
    "en": ["Refine the current map", "Start over from scratch"],
}

# 패스트트랙 진입 보기 — FE lib/interview.ts FAST_TRACK_START_LABELS와 글자 단위 동일 (design 2026-07-29)
_FAST_TRACK_OPTION = {"ko": "문서로 바로 그리기", "en": "Draw from a document"}

_EXISTING_NOTE_WORD = {
    "ko": "\n\n기존에 그려진 노드 {n}개도 파악해 두었습니다 — 문서 기준으로 이어서 다듬을 수 있어요.",
    "en": "\n\nI've also reviewed the {n} existing nodes — we can refine them against the document.",
}

# 시드 시 작업본에 싣는 노드 속성 — AiNode.attributes 계약과 동일 키
_SEED_ATTRS = (
    "assignee", "department", "system",
    "duration", "cost_krw", "cost_usd", "headcount", "annual_count", "fte",
)

# AI 계약(AI_NODE_TYPES) 밖 타입은 process로 강등. subprocess는 링크가 있으면 유지(P2 —
# 오케스트레이터 _sanitize_subprocess가 이전 작업본 기준으로 에코를 보정), 플레이스홀더(무링크)는
# process 강등(제목 유지 → apply 병합이 원본 보존). note는 흐름이 아니라 시드 제외.
_SEED_TYPES = {"start", "process", "decision", "end", "section", "subprocess"}


def _seed_working_graph(graph) -> dict | None:
    """기존 draft 그래프 → 인터뷰 작업본 시드 — 시작부터 프리뷰·드래프터가 기존 내용 위에서 동작."""
    nodes = []
    for n in graph.nodes:
        if n.node_type == "note":
            continue
        attributes = {k: v for k in _SEED_ATTRS if (v := getattr(n, k))}
        if n.section_anchor:
            attributes["section_anchor"] = n.section_anchor
        node_type = n.node_type if n.node_type in _SEED_TYPES else "process"
        if node_type == "subprocess" and not n.linked_map_id:
            node_type = "process"
        node = {
            "key": n.id,
            "title": n.title,
            "node_type": node_type,
            "description": n.description,
            "attributes": attributes or None,
            "group_key": n.group_ids[0] if n.group_ids else None,
        }
        if node_type == "subprocess":
            node["linked_map_id"] = n.linked_map_id
        nodes.append(node)
    if not nodes:
        return None
    kept = {n["key"] for n in nodes}
    edges = [
        {"source": e.source_node_id, "target": e.target_node_id, "label": e.label or ""}
        for e in graph.edges
        if e.source_node_id in kept and e.target_node_id in kept
    ]
    groups = [{"key": g.id, "label": g.label} for g in graph.groups]
    return {"nodes": nodes, "edges": edges, "groups": groups}


def _has_user_content(seed: dict | None) -> bool:
    """start/end 자동 시드만 있는 새 맵은 '기존 데이터 있음'으로 치지 않는다."""
    if not seed:
        return False
    return any(n.get("node_type") not in ("start", "end") for n in seed["nodes"])


def _existing_summary(seed: dict, lang: str) -> str:
    """시드 그래프의 마크다운 요약 — 오프닝 메시지에 '파악한 내용'으로 제시."""
    nodes = seed.get("nodes", [])
    activities = [
        n["title"] for n in nodes
        if n.get("node_type") not in ("start", "end") and n.get("title")
    ]
    decisions = sum(1 for n in nodes if n.get("node_type") == "decision")
    groups = len(seed.get("groups", []))
    shown = " · ".join(f"**{t}**" for t in activities[:6])
    more = len(activities) - 6
    if lang == "en":
        lines = [f"- Activities ({len(activities)}): {shown}" + (f" and {more} more" if more > 0 else "")]
        extras = []
        if decisions:
            extras.append(f"{decisions} decisions")
        if groups:
            extras.append(f"{groups} groups")
        if extras:
            lines.append("- " + " · ".join(extras))
    else:
        lines = [f"- 활동 {len(activities)}개: {shown}" + (f" 외 {more}개" if more > 0 else "")]
        extras = []
        if decisions:
            extras.append(f"분기 {decisions}개")
        if groups:
            extras.append(f"그룹 {groups}개")
        if extras:
            lines.append("- " + " · ".join(extras))
    return "\n".join(lines)


async def _require_ai_enabled(session: AsyncSession) -> None:
    """env AI_ENABLED + 관리자 런타임 차단 플래그(app_settings) 통합 게이트 (2026-07-30)."""
    if not await is_ai_access_enabled(session):
        raise HTTPException(status_code=503, detail="AI is disabled")


async def _get_owned_interview(
    session: AsyncSession, interview_id: int, user: str
) -> InterviewSession:
    """본인 세션만 — 없거나 타인 것이면 404(존재 노출 안 함)."""
    row = await session.get(InterviewSession, interview_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail=f"interview {interview_id} not found")
    # 세션 생성 이후 editor 권한이 회수됐을 수 있어 매 접근마다 재검증 (final review I3)
    await assert_map_role(session, user, row.map_id, "editor")
    await session.refresh(row, ["messages", "checkpoints", "attachments"])
    return row


async def _state_out(session: AsyncSession, interview: InterviewSession) -> InterviewStateOut:
    version = await session.get(MapVersion, interview.version_id)
    return InterviewStateOut(
        id=interview.id,
        map_id=interview.map_id,
        version_id=interview.version_id,
        status=interview.status,
        current_stage=interview.current_stage,
        lang=interview.lang,
        mode=interview.mode,
        facts=interview.facts or {},
        working_graph=interview.working_graph,
        messages=sorted(interview.messages, key=lambda m: m.seq),
        checkpoints=sorted(interview.checkpoints, key=lambda c: c.id),
        attachments=sorted(interview.attachments, key=lambda a: a.id),
        version_updated_at=version.updated_at if version else None,
        base_graph_updated_at=interview.base_graph_updated_at,
    )


def _graph_summary(graph) -> str:
    """작업 컨텍스트용 현재 저장 그래프 요약 — 제목 나열(프롬프트 예산 절약)."""
    titles = [f"{n.node_type}:{n.title}" for n in graph.nodes]
    return ", ".join(titles) if titles else ""


# 인터뷰어에 싣는 부서 후보 상한 — 공개(글로벌) 맵은 전 부서가 후보라 프롬프트 예산 가드
_DEPT_CATALOG_MAX = 80


async def _dept_catalog(session: AsyncSession, interview: InterviewSession) -> str:
    """노드 department 후보 목록 — 에디터 부서 피커(eligible-assignees)와 동일 모수.

    인터뷰어가 목록 밖 부서명을 지어내지 않도록 프롬프트에 주입 (실사용 피드백 2026-07-28).
    """
    if interview.mode != "normal":
        return ""
    eligible = await get_eligible_users(session, interview.map_id)
    departments = sorted({e.department for e in eligible if e.department})
    return "\n".join(f"- {d}" for d in departments[:_DEPT_CATALOG_MAX])


# 지식기반 검색 주입 (design 2026-07-23 §7 P2) — 실패는 턴을 죽이지 않는다(그레이스풀 디그레이드)
_KB_CONTEXT_BUDGET = 4000  # 참조 블록 문자 예산 — 첨부 예산과 별도(작게)

_KB_DEGRADE_NOTICE = {
    "ko": "지식기반 참조를 지금 사용할 수 없어 참조 없이 진행합니다 — 인터뷰는 계속됩니다.",
    "en": "The knowledge base is unavailable right now — continuing without references.",
}


async def _kb_reference_block(
    session: AsyncSession, interview: InterviewSession, map_name: str, user_text: str
) -> tuple[str, bool]:
    """top-k 검색 → [지식기반 참조] 블록(출처 표기). 반환 (블록, 임베딩 실패 여부)."""
    if not embed_client.is_embed_enabled():
        return "", False
    stage = get_stage(interview.current_stage, interview.mode)
    goal = stage.goal_ko if interview.lang == "ko" else stage.goal_en
    query = " ".join(part for part in (map_name, goal, user_text) if part).strip()
    try:
        hits = await retrieval.search(session, query, session_id=interview.id)
    except embed_client.EmbedError as exc:
        logger.warning("kb search failed — turn continues without references: %s", exc)
        return "", True
    # map 출처는 세션 사용자의 viewer 가시성 재검증 — 전 게시 맵이 인덱싱되므로 필터 없이는
    # 비공개 맵 내용이 타 사용자 프롬프트로 유출된다(RBAC 우회, hardening T1). top-k라 검사 소수.
    visible: dict[int, bool] = {}
    checked: list[retrieval.KbHit] = []
    for hit in hits:
        if hit.source_type == "map":
            hit_map_id = hit.meta.get("map_id") or hit.source_id
            if hit_map_id not in visible:
                role = await get_effective_role(session, interview.login_id, hit_map_id)
                visible[hit_map_id] = role is not None
            if not visible[hit_map_id]:
                continue
        checked.append(hit)
    hits = checked
    lines: list[str] = []
    total = 0
    for hit in hits:
        source = (
            hit.meta.get("title") or hit.meta.get("map_name")
            or hit.meta.get("filename") or hit.source_type
        )
        line = f"- ({source}) {hit.chunk_text}"
        if total + len(line) > _KB_CONTEXT_BUDGET:
            break
        lines.append(line)
        total += len(line)
    if not lines:
        return "", False
    header = "\n\n[지식기반 참조 — 근거로만 활용하고, 아래 출처에 없는 사실을 지어내지 마세요]\n"
    return header + "\n".join(lines), False


def _has_kb_degrade_notice(interview: InterviewSession) -> bool:
    texts = set(_KB_DEGRADE_NOTICE.values())
    return any(m.kind == "notice" and m.content in texts for m in interview.messages)


# 유사 SP 제안 (design §7 P2) — 수락(choice) 턴 직후, 맵당 1회
_SP_SUGGEST_TEXT = {
    "ko": "'{map_name}' 게시 맵과 유사한 구간(활동 {n}개)을 발견했습니다 — 캔버스의 제안 카드에서 서브프로세스 링크로 대체할 수 있어요.",
    "en": "Found a segment ({n} steps) similar to the published map '{map_name}' — you can replace it with a subprocess link from the card on the canvas.",
}

_SP_ACCEPT_NOTICE = {
    "ko": "활동 {n}개를 '{map_name}' 서브프로세스 링크로 대체했습니다. Apply 시 실제 링크 노드로 저장됩니다.",
    "en": "Replaced {n} steps with a subprocess link to '{map_name}'. It becomes a real link node when applied.",
}


def _suggested_map_ids(interview: InterviewSession) -> set[int]:
    """이미 제안했던 맵 — 무시/수락과 무관하게 재제안하지 않는다(스팸 방지)."""
    ids: set[int] = set()
    for m in interview.messages:
        if m.kind == "sp_suggestion" and m.payload and m.payload.get("map_id"):
            ids.add(m.payload["map_id"])
    return ids


async def _maybe_sp_suggestion(
    session: AsyncSession, interview: InterviewSession, user: str
) -> None:
    """유사 SP 후보를 찾아 sp_suggestion 메시지 추가 — 실패·권한 없음은 침묵(기회주의적)."""
    try:
        suggestion = await sp_suggest.suggest_subprocess(session, interview)
    except embed_client.EmbedError:
        return
    if suggestion is None or suggestion["map_id"] in _suggested_map_ids(interview):
        return
    try:
        # 대상 맵 열람 권한이 없으면 이름조차 노출하지 않는다 (RBAC)
        await assert_map_role(session, user, suggestion["map_id"], "viewer")
    except HTTPException:
        return
    text = _SP_SUGGEST_TEXT.get(interview.lang, _SP_SUGGEST_TEXT["ko"]).format(
        map_name=suggestion["map_name"], n=len(suggestion["node_keys"])
    )
    msg = InterviewMessage(
        session_id=interview.id,
        seq=max((m.seq for m in interview.messages), default=0) + 1,
        role="consultant", kind="sp_suggestion", content=text,
        payload=suggestion, stage=interview.current_stage,
    )
    session.add(msg)
    # 같은 커밋에서 뒤이어 seq를 계산하는 쪽(KB 노티스)이 이 메시지를 보게 — 동일 seq 충돌 방지
    interview.messages.append(msg)


async def _context_text(interview: InterviewSession) -> str:
    sections = [
        (a.filename, a.parsed_text)
        for a in interview.attachments
        if a.status == "parsed" and a.parsed_text
    ]
    return clip_to_budget(sections, settings.interview_context_budget)


@router.post(
    "/maps/{map_id}/interviews",
    response_model=InterviewStateOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def create_or_resume_interview(
    map_id: int,
    payload: InterviewCreateIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    await _require_ai_enabled(session)
    existing = (
        await session.scalars(
            select(InterviewSession).where(
                InterviewSession.map_id == map_id,
                InterviewSession.login_id == user,
                InterviewSession.status == "active",
            )
        )
    ).first()
    if existing is not None:
        await session.refresh(existing, ["messages", "checkpoints", "attachments"])
        return await _state_out(session, existing)

    version = await session.get(MapVersion, payload.version_id)
    if version is None or version.map_id != map_id:
        raise HTTPException(status_code=404, detail=f"version {payload.version_id} not found")
    if not workflow.is_editable_status(version.status):
        raise HTTPException(status_code=409, detail="version is not editable")

    found_map = await session.get(ProcessMap, map_id)
    interview_mode = "word" if found_map is not None and found_map.mode == "word" else "normal"

    # 기존 draft 내용을 작업본으로 시드 — 프리뷰가 처음부터 현재 맵을 보여주고,
    # 드래프터도 백지가 아닌 기존 구조 위에서 시작한다 (실사용 피드백 2026-07-27)
    seed = _seed_working_graph(await _load_graph(session, payload.version_id))
    has_existing = _has_user_content(seed)

    interview = InterviewSession(
        map_id=map_id,
        version_id=payload.version_id,
        login_id=user,
        lang=payload.lang,
        mode=interview_mode,
        facts={},
        working_graph=seed,
        base_graph_updated_at=version.updated_at,
    )
    session.add(interview)
    await session.flush()  # id 채번 — 메시지 FK
    greeting_src = _GREETING_WORD if interview_mode == "word" else _GREETING
    content = greeting_src.get(payload.lang, greeting_src["ko"])
    fast_track = _FAST_TRACK_OPTION.get(payload.lang, _FAST_TRACK_OPTION["ko"])
    greeting_payload: dict | None = (
        {"options": [fast_track]} if interview_mode == "normal" else None
    )
    if has_existing and seed is not None and interview_mode == "normal":
        # 기존 데이터 인지형 오프닝 — 파악한 내용 요약 + 보완/재정리 선택지
        template = _EXISTING_GREETING.get(payload.lang, _EXISTING_GREETING["ko"])
        content = template.format(
            map_name=found_map.name if found_map else "",
            summary=_existing_summary(seed, payload.lang),
        )
        greeting_payload = {
            "options": [
                *_EXISTING_GREETING_OPTIONS.get(payload.lang, _EXISTING_GREETING_OPTIONS["ko"]),
                fast_track,
            ]
        }
    elif has_existing and seed is not None and interview_mode == "word":
        note = _EXISTING_NOTE_WORD.get(payload.lang, _EXISTING_NOTE_WORD["ko"])
        existing_count = sum(
            1 for n in seed["nodes"] if n.get("node_type") not in ("start", "end")
        )
        content += note.format(n=existing_count)
    session.add(
        InterviewMessage(
            session_id=interview.id, seq=1, role="consultant", kind="question",
            content=content, payload=greeting_payload, stage="scope",
        )
    )
    await session.commit()
    loaded = await _get_owned_interview(session, interview.id, user)
    return await _state_out(session, loaded)


@router.get(
    "/maps/{map_id}/interviews/active",
    response_model=InterviewStateOut,
    dependencies=[Depends(require_map_role("editor"))],
)
async def get_active_interview(
    map_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    row = (
        await session.scalars(
            select(InterviewSession).where(
                InterviewSession.map_id == map_id,
                InterviewSession.login_id == user,
                InterviewSession.status == "active",
            )
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="no active interview")
    loaded = await _get_owned_interview(session, row.id, user)
    return await _state_out(session, loaded)


@router.get("/interviews/{interview_id}", response_model=InterviewStateOut)
async def get_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, interview)


@router.post("/interviews/{interview_id}/turns", response_model=InterviewStateOut)
@_locked_by_interview
async def post_turn(
    interview_id: int,
    payload: InterviewTurnIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    await _require_ai_enabled(session)
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    if payload.type == "skip" and next_stage_key(interview.current_stage, interview.mode) is None:
        raise HTTPException(status_code=400, detail="cannot skip the final stage")

    # rollback 후 만료 대비 스칼라 선캡처
    map_id, version_id = interview.map_id, interview.version_id

    # "[현재 작업본 요약]"은 실제 작업본이어야 한다 — 수락으로 진화한 working_graph 대신
    # 저장본(draft)을 주면 인터뷰어가 세션 내내 옛 맵을 보고 이미 그린 활동을 재질문 (hardening T4).
    if interview.working_graph and interview.working_graph.get("nodes"):
        graph_summary = format_graph_compact(interview.working_graph)
    else:
        graph_summary = _graph_summary(await _load_graph(session, interview.version_id))
    found_map = await session.get(ProcessMap, interview.map_id)
    kb_block, kb_failed = await _kb_reference_block(
        session, interview, found_map.name if found_map else "", payload.content or ""
    )
    context_text = await _context_text(interview) + kb_block
    doc_sections: list[dict] | None = None
    if interview.mode == "word":
        doc_sections = list(found_map.doc_sections) if found_map else []
    usage: list[tuple[int | None, int | None]] = []
    usage_token = usage_log.set(usage)
    try:
        result = await run_turn(
            session, interview, payload, graph_summary, context_text,
            doc_sections=doc_sections, dept_catalog=await _dept_catalog(session, interview),
            overrides=await get_prompt_overrides(session),
        )
    except TurnError as exc:
        await session.rollback()
        # 실패도 계량 — 별도 커밋, 실패해도 502 전파 유지
        prompt_total, completion_total = sum_usage(usage)
        try:
            session.add(AiUsageEvent(
                login_id=user, map_id=map_id, version_id=version_id,
                model="", kind=None, ok=False,
                prompt_tokens=prompt_total, completion_tokens=completion_total,
            ))
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답을 바꾸지 않는다
            logger.warning("interview usage event insert failed (failure path)")
            await session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        usage_log.reset(usage_token)

    prompt_total, completion_total = sum_usage(usage)
    session.add(AiUsageEvent(
        login_id=user, map_id=map_id, version_id=version_id,
        model="", kind="interview", ok=True,
        prompt_tokens=prompt_total, completion_tokens=completion_total,
    ))
    interview.updated_at = now_kst()
    # 턴 확정 — 이후 부가 로직(SP 제안/KB 노티스) 예외가 성공한 턴을 되돌리지 못한다 (hardening T8)
    await session.commit()

    try:
        # 유사 SP 제안 — 작업본이 갱신되는 유일 시점(수락 턴)에서만 (speed redesign 이동)
        if interview.mode == "normal" and payload.type == "choice":
            await _maybe_sp_suggestion(session, interview, user)
        # 임베딩 서버 다운 알림 — 세션당 1회만(반복 스팸 방지), 인터뷰는 계속 (design §9)
        if kb_failed and not _has_kb_degrade_notice(interview):
            notice = InterviewMessage(
                session_id=interview.id,
                seq=max((m.seq for m in interview.messages), default=0) + 1,
                role="consultant", kind="notice",
                content=_KB_DEGRADE_NOTICE.get(interview.lang, _KB_DEGRADE_NOTICE["ko"]),
                stage=interview.current_stage,
            )
            session.add(notice)
            interview.messages.append(notice)
        await session.commit()
    except Exception:  # noqa: BLE001 -- 부가 로직 실패는 로그만 — AI 비용·답변 소실 방지
        logger.exception("post-turn extras failed — turn already committed")
        await session.rollback()
    loaded = await _get_owned_interview(session, interview_id, user)
    state = await _state_out(session, loaded)
    state.draw_due = result.draw_due  # 그리기 신호 — 프론트가 draw 이벤트로 이어받는다
    return state


# draw 이벤트 안내 문구 — 인터뷰어 호출 없이 고정 (speed redesign §4)
_DRAW_CHOICES_TEXT = {
    "ko": "안을 준비했습니다 — 캔버스에서 골라주세요.",
    "en": "Proposals are ready — pick one on the canvas.",
}
_DRAW_EMPTY_TEXT = {
    "ko": "현재 맵과 사실상 같은 안뿐이라 새로 제시할 게 없습니다 — 대화를 더 진행한 뒤 다시 그려보세요.",
    "en": "All drafts matched the current map — continue the interview and draw again later.",
}


@router.post("/interviews/{interview_id}/draw", response_model=InterviewStateOut)
@_locked_by_interview
async def draw_interview_proposals(
    interview_id: int,
    payload: InterviewDrawIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    """그리기 이벤트(동기) — 제안 생성만 담당, 작업본은 수락(choice 턴) 시점에만 변경 (speed redesign §4)."""
    await _require_ai_enabled(session)
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    map_id, version_id = interview.map_id, interview.version_id

    found_map = await session.get(ProcessMap, interview.map_id)
    kb_block, _ = await _kb_reference_block(
        session, interview, found_map.name if found_map else "", ""
    )
    context_text = await _context_text(interview) + kb_block
    doc_sections: list[dict] | None = None
    if interview.mode == "word":
        doc_sections = list(found_map.doc_sections) if found_map else []
    usage: list[tuple[int | None, int | None]] = []
    usage_token = usage_log.set(usage)
    try:
        choices, demoted = await generate_proposals(
            interview, context_text, doc_sections=doc_sections, variants=payload.variants,
            overrides=await get_prompt_overrides(session),
        )
    except TurnError as exc:
        await session.rollback()
        prompt_total, completion_total = sum_usage(usage)
        try:
            session.add(AiUsageEvent(
                login_id=user, map_id=map_id, version_id=version_id,
                model="", kind=None, ok=False,
                prompt_tokens=prompt_total, completion_tokens=completion_total,
            ))
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답을 바꾸지 않는다
            logger.warning("interview usage event insert failed (draw failure path)")
            await session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    finally:
        usage_log.reset(usage_token)

    seq = max((m.seq for m in interview.messages), default=0) + 1
    if choices is None:
        session.add(InterviewMessage(
            session_id=interview.id, seq=seq, role="consultant", kind="notice",
            content=_DRAW_EMPTY_TEXT.get(interview.lang, _DRAW_EMPTY_TEXT["ko"]),
            stage=interview.current_stage,
        ))
    else:
        interview.pending_choices = choices
        session.add(InterviewMessage(
            session_id=interview.id, seq=seq, role="consultant", kind="choices",
            content=_DRAW_CHOICES_TEXT.get(interview.lang, _DRAW_CHOICES_TEXT["ko"]),
            payload=choices, stage=interview.current_stage,
        ))
    if demoted:
        session.add(InterviewMessage(
            session_id=interview.id, seq=seq + 1, role="consultant", kind="notice",
            content=demote_notice_text(interview.lang, demoted), stage=interview.current_stage,
        ))
    prompt_total, completion_total = sum_usage(usage)
    session.add(AiUsageEvent(
        login_id=user, map_id=map_id, version_id=version_id,
        model="", kind="interview", ok=True,
        prompt_tokens=prompt_total, completion_tokens=completion_total,
    ))
    interview.updated_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


# params 표 반영 — AI 0콜 결정적 적용 (speed redesign 후속, 실사용 피드백 2026-07-27)
# touch_time은 7번째 회당 파라미터 — duration과 동일 H.MM 계약 (design 2026-08-19 §2)
_PARAM_FIELDS = ("duration", "touch_time", "cost_krw", "cost_usd", "headcount", "annual_count", "fte")
_PARAM_UNKNOWN_TOKENS = {"미정", "TBD", "tbd", "-"}
_PARAMS_APPLIED_NOTICE = {
    "ko": "확정된 파라미터를 활동 {n}개에 반영했습니다.",
    "en": "Applied the confirmed parameters to {n} activities.",
}


@router.post("/interviews/{interview_id}/apply-params", response_model=InterviewStateOut)
@_locked_by_interview
async def apply_interview_params(
    interview_id: int,
    payload: InterviewApplyParamsIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    """수집된 params_table을 작업본 attributes에 결정적으로 반영 — 제목 매칭, AI 무관(즉시).

    body에 수동 편집 표가 오면 먼저 facts에 딥머지 — 채팅 없이 조정한 값도 인터뷰어/드래프터
    컨텍스트와 아웃라인에 남는다 (실사용 피드백 2026-07-30). 빈 값은 facts만 비우고 맵은 유지.
    """
    await _require_ai_enabled(session)
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    sanitized: dict[str, dict[str, str]] = {}
    if payload is not None and payload.params_table:
        sanitized = {
            str(title).strip(): {
                field: str(value).strip()
                for field, value in values.items()
                if field in _PARAM_FIELDS
            }
            for title, values in payload.params_table.items()
            if isinstance(values, dict) and str(title).strip()
        }
        sanitized = {title: values for title, values in sanitized.items() if values}
        if sanitized:
            merge_params_table(interview, sanitized)
    table = (interview.facts.get("params") or {}).get("params_table") or {}
    if not isinstance(table, dict) or not table:
        raise HTTPException(status_code=400, detail="no collected parameters")

    graph = interview.working_graph or {"nodes": [], "edges": [], "groups": []}
    by_title = {str(k).strip(): v for k, v in table.items() if isinstance(v, dict)}
    applied = 0
    nodes = []
    for raw in graph.get("nodes", []):
        node = dict(raw)
        node_title = (node.get("title") or "").strip()
        values = by_title.get(node_title)
        manual_values = sanitized.get(node_title, {})
        if values:
            # subprocess는 annual_count·fte만 직접 편집 — 나머지 4필드는 링크 맵 지정값 상속.
            # UI·CSV·AI 변환 3표면 강제 불변식의 4번째 표면 봉합 (hardening T9)
            editable = (
                ("annual_count", "fte")
                if node.get("node_type") == "subprocess" else _PARAM_FIELDS
            )
            attributes = dict(node.get("attributes") or {})
            row_krw = str(values.get("cost_krw") or "").strip()
            has_krw = bool(row_krw) and row_krw not in _PARAM_UNKNOWN_TOKENS
            touched = False
            for field in _PARAM_FIELDS:
                if field not in editable:
                    continue
                if field == "cost_usd" and has_krw:
                    continue  # 통화 배타 — 행에 둘 다 있으면 krw 우선(두 통화 공존은 저장 시 422)
                value = values.get(field)
                text = str(value).strip() if value is not None else ""
                if text and text not in _PARAM_UNKNOWN_TOKENS:
                    if field == "cost_krw":
                        attributes.pop("cost_usd", None)
                    if field == "cost_usd":
                        attributes.pop("cost_krw", None)
                    attributes[field] = text
                    touched = True
                elif field in manual_values and not text and field in attributes:
                    # 수동 표에서 명시적으로 비운 필드 — 맵 속성도 제거(행 일괄 삭제)
                    attributes.pop(field)
                    touched = True
            if touched:
                node["attributes"] = attributes
                applied += 1
        nodes.append(node)
    if applied == 0:
        raise HTTPException(
            status_code=409, detail="no matching activities for the collected parameters"
        )
    interview.working_graph = {**graph, "nodes": nodes}
    # 표 반영 전 draw된 카드가 살아있으면 스테일 수락이 이 변이를 통째로 되돌린다 (final review 2026-07-30)
    interview.pending_choices = None
    session.add(InterviewMessage(
        session_id=interview.id,
        seq=max((m.seq for m in interview.messages), default=0) + 1,
        role="consultant", kind="notice",
        content=_PARAMS_APPLIED_NOTICE.get(interview.lang, _PARAMS_APPLIED_NOTICE["ko"]).format(n=applied),
        stage=interview.current_stage,
    ))
    interview.updated_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


_FAST_FORWARD_USER_TEXT = {"ko": "이대로 그려주세요.", "en": "Draw it as proposed."}
_FAST_FORWARD_NOTICE = {
    "ko": "문서 기준으로 바로 그립니다 — 남은 단계는 '미정'으로 채우고 검토로 건너뜁니다.",
    "en": "Drawing straight from the document — remaining stages are marked TBD, jumping to review.",
}


@router.post("/interviews/{interview_id}/fast-forward", response_model=InterviewStateOut)
@_locked_by_interview
async def fast_forward_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    """패스트트랙 확정 — 남은 스테이지를 skip 시맨틱('미정' 채움+체크포인트)으로 일괄 전진해
    review로 점프, draw_due='multi' 신호 반환 (AI 0콜 — 전진을 프롬프트에 맡기지 않는다,
    design 2026-07-29 §3). 계측 이벤트 없음(apply-params와 동일한 0콜 관례).
    """
    await _require_ai_enabled(session)
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    if interview.mode == "word":
        raise HTTPException(status_code=400, detail="fast-forward is not available for word maps")
    if interview.current_stage == "review":
        raise HTTPException(status_code=400, detail="already at review")

    unknown = "TBD" if interview.lang == "en" else "미정"
    seq = max((m.seq for m in interview.messages), default=0) + 1
    message = InterviewMessage(
        session_id=interview.id, seq=seq, role="user", kind="fast_forward",
        content=_FAST_FORWARD_USER_TEXT.get(interview.lang, _FAST_FORWARD_USER_TEXT["ko"]),
        stage=interview.current_stage,
    )
    session.add(message)
    interview.messages.append(message)
    while interview.current_stage != "review":
        stage = get_stage(interview.current_stage, interview.mode)
        stage_facts = dict(interview.facts.get(interview.current_stage) or {})
        for name in stage.required_facts:
            if not stage_facts.get(name):
                stage_facts[name] = unknown
        interview.facts = {**interview.facts, interview.current_stage: stage_facts}
        session.add(InterviewCheckpoint(
            session_id=interview.id, stage=interview.current_stage,
            facts=interview.facts, working_graph=interview.working_graph,
            message_seq=seq,
        ))
        next_key = next_stage_key(interview.current_stage, interview.mode)
        if next_key is None:
            break
        interview.current_stage = next_key
    interview.pending_choices = None
    notice = InterviewMessage(
        session_id=interview.id, seq=seq + 1, role="consultant", kind="notice",
        content=_FAST_FORWARD_NOTICE.get(interview.lang, _FAST_FORWARD_NOTICE["ko"]),
        stage=interview.current_stage,
    )
    session.add(notice)
    interview.messages.append(notice)
    interview.updated_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    state = await _state_out(session, loaded)
    state.draw_due = "multi"
    return state


@router.post("/interviews/{interview_id}/attachments", response_model=InterviewAttachmentOut)
@_locked_by_interview
async def upload_attachment(
    interview_id: int,
    file: UploadFile,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewAttachmentOut:
    interview = await _get_owned_interview(session, interview_id, user)
    filename = file.filename or "attachment"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"unsupported file type: {ext or filename}")
    if len(filename) > 300:
        # 컬럼 VARCHAR(300) — sqlite는 조용히 통과하지만 Postgres는 500. 확장자 보존 절단 (hardening T9)
        filename = filename[: 300 - len(ext)] + ext
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="file too large (max 20MB)")

    row = InterviewAttachment(
        session_id=interview.id, filename=filename,
        mime=file.content_type or "", size=len(data),
    )
    async with _parse_lock:
        try:
            row.parsed_text = await asyncio.to_thread(parse_attachment, filename, data)
            row.status = "parsed"
        except ParseError as exc:
            row.status = "failed"
            row.error = str(exc)
    session.add(row)
    # 읽음 확인 노티스 — "파일이 반영됐나?" 불신 방지 + 인터뷰어 히스토리에도 문서 도착 신호가 남는다
    notice = _ATTACH_NOTICE[row.status].get(
        interview.lang, _ATTACH_NOTICE[row.status]["ko"]
    ).format(filename=filename)
    session.add(InterviewMessage(
        session_id=interview.id,
        seq=max((m.seq for m in interview.messages), default=0) + 1,
        role="consultant", kind="notice", content=notice, stage=interview.current_stage,
    ))
    await session.commit()
    await session.refresh(row)
    # 세션 스코프 지식기반 인덱싱 — fire-and-forget, 파싱 성공분만 (design 2026-07-23 §7)
    if row.status == "parsed" and embed_client.is_embed_enabled():
        indexing.spawn(indexing.index_attachment(row.id))
    # 첨부 시점 정보 추출 — 백그라운드 1콜로 facts를 최대한 미리 수집 (2026-07-28)
    # 관리자 런타임 차단(app_settings)도 존중 — env만 보면 점검 중에도 GPU로 콜이 나간다
    if row.status == "parsed" and await is_ai_access_enabled(session):
        indexing.spawn(extract_attachment_facts(interview.id, row.id))
    return InterviewAttachmentOut.model_validate(row)


@router.delete("/interviews/{interview_id}/attachments/{attachment_id}", status_code=204)
@_locked_by_interview
async def delete_attachment(
    interview_id: int,
    attachment_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """첨부 삭제 — 이후 턴의 컨텍스트 주입에서 즉시 제외된다."""
    interview = await _get_owned_interview(session, interview_id, user)
    row = next((a for a in interview.attachments if a.id == attachment_id), None)
    if row is None:
        raise HTTPException(status_code=404, detail=f"attachment {attachment_id} not found")
    await session.delete(row)
    # 첨부 청크도 함께 제거 — 이후 검색에서 즉시 제외
    await session.execute(sa_delete(KbChunk).where(
        KbChunk.source_type == "attachment", KbChunk.source_id == attachment_id
    ))
    await session.commit()
    retrieval.invalidate_cache()


@router.post("/interviews/{interview_id}/sp-accept", response_model=InterviewStateOut)
@_locked_by_interview
async def accept_sp_suggestion(
    interview_id: int,
    payload: InterviewSpAcceptIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    """유사 SP 제안 수락 — 제안 구간을 subprocess 링크 노드 하나로 치환(결정적, AI 무관)."""
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    msg = next(
        (m for m in interview.messages
         if m.id == payload.message_id and m.kind == "sp_suggestion" and not m.superseded),
        None,
    )
    if msg is None:
        raise HTTPException(status_code=404, detail="suggestion not found")
    data = msg.payload or {}
    graph = interview.working_graph or {"nodes": [], "edges": [], "groups": []}
    keys = set(data.get("node_keys") or [])
    node_keys = {n["key"] for n in graph.get("nodes", [])}
    if not keys or not keys.issubset(node_keys):
        raise HTTPException(
            status_code=409, detail="the suggested segment is no longer in the working map"
        )

    sp_key = f"sp-{data['map_id']}"
    sp_node = {
        "key": sp_key, "title": data.get("map_name") or "Subprocess",
        "node_type": "subprocess", "description": "", "attributes": None,
        "group_key": None, "linked_map_id": data["map_id"],
    }
    kept = [n for n in graph.get("nodes", []) if n["key"] not in keys]
    edges: list[dict] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    for edge in graph.get("edges", []):
        src_in, tgt_in = edge["source"] in keys, edge["target"] in keys
        if src_in and tgt_in:
            continue  # 구간 내부 엣지는 제거
        source = sp_key if src_in else edge["source"]
        target = sp_key if tgt_in else edge["target"]
        pair = (source, target, edge.get("label") or "")
        if pair in seen_pairs:
            continue  # 치환으로 겹친 엣지 dedupe
        seen_pairs.add(pair)
        edges.append({**edge, "source": source, "target": target})
    interview.working_graph = {**graph, "nodes": [*kept, sp_node], "edges": edges}
    interview.pending_choices = None  # 치환 전 카드의 스테일 수락이 SP 링크를 되돌리는 것 방지
    msg.superseded = True  # 카드 소멸 — 대화 이력에서도 접힌다
    session.add(InterviewMessage(
        session_id=interview.id,
        seq=max((m.seq for m in interview.messages), default=0) + 1,
        role="consultant", kind="notice",
        content=_SP_ACCEPT_NOTICE.get(interview.lang, _SP_ACCEPT_NOTICE["ko"]).format(
            n=len(keys), map_name=data.get("map_name", "")
        ),
        stage=interview.current_stage,
    ))
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.post("/interviews/{interview_id}/revert", response_model=InterviewStateOut)
@_locked_by_interview
async def revert_to_checkpoint(
    interview_id: int,
    payload: InterviewRevertIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    target = next(
        (c for c in sorted(interview.checkpoints, key=lambda c: c.id, reverse=True)
         if c.stage == payload.stage),
        None,
    )
    if target is None:
        raise HTTPException(status_code=404, detail=f"no checkpoint for stage {payload.stage}")

    interview.facts = target.facts
    interview.working_graph = target.working_graph
    interview.current_stage = target.stage
    interview.pending_choices = None
    for msg in interview.messages:
        if msg.seq > target.message_seq:
            msg.superseded = True
    # 복원 지점 이후의 체크포인트 제거(대상 stage 포함 이후 단계) — 재진행 시 새로 생성
    for cp in list(interview.checkpoints):
        if cp.id >= target.id:
            await session.delete(cp)
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.post("/interviews/{interview_id}/complete", response_model=InterviewStateOut)
@_locked_by_interview
async def complete_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    interview.status = "completed"
    interview.completed_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.delete("/interviews/{interview_id}", status_code=204)
@_locked_by_interview
async def abandon_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    interview = await _get_owned_interview(session, interview_id, user)
    interview.status = "abandoned"
    await session.commit()
