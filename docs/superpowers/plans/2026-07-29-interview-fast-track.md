# 인터뷰 패스트트랙 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문서 첨부만으로 범위 확인 후 추가 질문 없이 맵을 그리는 패스트트랙(인사 보기 진입 → 범위 제안 AI 1콜 → 결정적 fast-forward AI 0콜 → 기존 multi draw) + 인터뷰어 어체 간결화.

**Architecture:** 새 세션 모드 없이 기존 부품 오케스트레이션 — BE는 인사 보기 문구·`POST /fast-forward`(skip 시맨틱 일괄 전진)·계약 룰 2개, FE는 로컬 상태머신(armed/awaiting)과 quick reply 인터셉트. 스펙: `docs/design/2026-07-29-interview-fast-track-design.md`.

**Tech Stack:** FastAPI + SQLAlchemy(백엔드), Next.js/React(프론트), pytest + Playwright 스모크.

## Global Constraints

- 브랜치 `worktree-ai-consultant`(AI 독립 라인) — 작업 전 `pwd`·`git branch` 확인, 이 워크트리 밖 커밋 금지.
- 전진(단계 생략)은 프롬프트 순종성에 맡기지 않는다 — 서버가 결정적으로 수행.
- 패스트트랙 보기 문구는 FE 상수가 단일 소스 — BE 인사말·인터뷰어 룰 문구와 **글자 단위로 동일**해야 인터셉트가 성립(ko/en 각각).
- word 모드는 대상 아님(이미 문서 기반 3단계).
- 테스트 실행: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (backend/에서).
- 커밋 형식: `type(scope): English — 한국어` + PROGRESS.md 동반 갱신(마지막 태스크에서 일괄).

---

### Task 1: BE — 인사말 패스트트랙 보기

**Files:**
- Modify: `backend/app/routers/interviews.py` (인사 payload 부근, `_EXISTING_GREETING_OPTIONS` 아래)
- Test: `backend/tests/test_interview_api.py`

**Interfaces:**
- Produces: 인사말 payload options에 문구 `"문서로 바로 그리기"`(ko) / `"Draw from a document"`(en) — Task 4 FE 상수 `FAST_TRACK_START_LABELS`와 동일해야 함.

- [ ] **Step 1: 실패하는 테스트 작성** — `test_interview_api.py` 끝에 추가:

```python
def test_greeting_offers_fast_track_option(client: TestClient, monkeypatch) -> None:
    """normal 모드 인사말에 패스트트랙 보기 — word는 제외 (design 2026-07-29 §2)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    greeting = state["messages"][0]
    assert "문서로 바로 그리기" in (greeting["payload"] or {}).get("options", [])
    client.delete(f"/api/interviews/{state['id']}")


def test_word_greeting_has_no_fast_track_option(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-ft-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    options = (state["messages"][0]["payload"] or {}).get("options", [])
    assert "문서로 바로 그리기" not in options
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_interview_api.py::test_greeting_offers_fast_track_option -q` → FAIL (payload None).

- [ ] **Step 3: 구현** — `interviews.py`의 `_EXISTING_GREETING_OPTIONS` 아래에 상수 추가:

```python
# 패스트트랙 진입 보기 — FE lib/interview.ts FAST_TRACK_START_LABELS와 글자 단위 동일 (design 2026-07-29)
_FAST_TRACK_OPTION = {"ko": "문서로 바로 그리기", "en": "Draw from a document"}
```

`create_or_resume_interview`의 greeting_payload 로직 수정 — 기존:

```python
    greeting_payload: dict | None = None
    if has_existing and seed is not None and interview_mode == "normal":
        ...
        greeting_payload = {
            "options": _EXISTING_GREETING_OPTIONS.get(payload.lang, _EXISTING_GREETING_OPTIONS["ko"])
        }
```

를 다음으로 교체(빈 맵 인사에도 보기 부여 + 기존맵 인사엔 append):

```python
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
```

- [ ] **Step 4: 기존 단언 갱신** — `test_interview_api.py`의 기존 테스트 중 `assert greeting["payload"] is None`(normal 맵 인사)을 찾아 아래로 교체:

```python
    assert greeting["payload"] == {"options": ["문서로 바로 그리기"]}
```

- [ ] **Step 5: 통과 확인** — `pytest tests/test_interview_api.py -q` → 전부 PASS.

- [ ] **Step 6: 커밋** — `git add backend/app/routers/interviews.py backend/tests/test_interview_api.py && git commit -m "feat(interview): fast-track greeting option — 인사말에 '문서로 바로 그리기' 보기"`

---

### Task 2: BE — fast-forward 엔드포인트 + draw 힌트 보정

**Files:**
- Modify: `backend/app/routers/interviews.py` (apply-params 엔드포인트 아래에 신규), imports에 `InterviewCheckpoint` 추가
- Modify: `backend/app/interview/orchestrator.py::_recent_choice_stage`
- Test: `backend/tests/test_interview_api.py`, `backend/tests/test_interview_orchestrator.py`

**Interfaces:**
- Produces: `POST /api/interviews/{id}/fast-forward` → `InterviewStateOut`(+`draw_due="multi"`), 사용자 메시지 `kind="fast_forward"`(12자 — String(12) 상한에 딱 맞음, 초과 금지).
- Consumes: `_locked_by_interview`, `get_stage`/`next_stage_key`(engine), `_state_out`, `now_kst`.

- [ ] **Step 1: 실패하는 API 테스트** — `test_interview_api.py`에 추가:

```python
def test_fast_forward_jumps_to_review_and_signals_draw(client: TestClient, monkeypatch) -> None:
    """fast-forward — 남은 스테이지 '미정' 채움+체크포인트 후 review 점프, draw_due='multi' (AI 0콜)."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)
    calls = _scripted(monkeypatch, [])  # AI 호출이 있으면 IndexError로 실패
    body = client.post(f"/api/interviews/{state['id']}/fast-forward").json()
    assert calls["calls"] == 0
    assert body["current_stage"] == "review"
    assert body["draw_due"] == "multi"
    for stage_key, names in [
        ("scope", ["process_name", "purpose", "boundaries"]),
        ("io", ["trigger", "inputs", "outputs"]),
        ("activities", ["activities"]),
        ("branches", ["branches"]),
        ("roles", ["roles"]),
    ]:
        for name in names:
            assert body["facts"][stage_key][name] == "미정"
    assert [c["stage"] for c in body["checkpoints"]] == [
        "scope", "io", "activities", "branches", "roles",
    ]
    kinds = [m["kind"] for m in body["messages"]]
    assert "fast_forward" in kinds and kinds[-1] == "notice"
    client.delete(f"/api/interviews/{state['id']}")


def test_fast_forward_preserves_collected_facts(client: TestClient, monkeypatch) -> None:
    """이미 수집된 facts(문서 추출분)는 '미정'으로 덮지 않는다."""
    _enable_ai(monkeypatch)
    state = _iv_session(client)

    async def _seed() -> None:
        from app.models import InterviewSession as IvSession

        async with SessionLocal() as session:
            row = await session.get(IvSession, state["id"])
            row.facts = {"scope": {"process_name": "구매 프로세스"}}
            await session.commit()

    asyncio.run(_seed())
    body = client.post(f"/api/interviews/{state['id']}/fast-forward").json()
    assert body["facts"]["scope"]["process_name"] == "구매 프로세스"
    assert body["facts"]["scope"]["purpose"] == "미정"
    client.delete(f"/api/interviews/{state['id']}")


def test_fast_forward_guards(client: TestClient, monkeypatch) -> None:
    """word 모드 400 · review에서 400."""
    _enable_ai(monkeypatch)
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-ff-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word", "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    word_state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    assert client.post(f"/api/interviews/{word_state['id']}/fast-forward").status_code == 400

    state = _iv_session(client)
    client.post(f"/api/interviews/{state['id']}/fast-forward")
    assert client.post(f"/api/interviews/{state['id']}/fast-forward").status_code == 400  # 이미 review
    client.delete(f"/api/interviews/{state['id']}")
    client.delete(f"/api/interviews/{word_state['id']}")
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_interview_api.py -k fast_forward -q` → FAIL (404).

- [ ] **Step 3: 엔드포인트 구현** — `interviews.py`의 models import에 `InterviewCheckpoint` 추가 후, `apply_interview_params` 아래에:

```python
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
    _require_ai_enabled()
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
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_interview_api.py -k fast_forward -q` → PASS.

- [ ] **Step 5: draw 힌트 보정 실패 테스트** — `test_interview_orchestrator.py`에 추가:

```python
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
```

`_session` 헬퍼는 `s.messages = []`만 세팅하므로 `interview.checkpoints` 직접 할당이 필요하다(위 코드 그대로).

- [ ] **Step 6: 실패 확인** — `pytest tests/test_interview_orchestrator.py::test_recent_choice_stage_prefers_activities_after_fast_forward -q` → FAIL ("branches" 반환).

- [ ] **Step 7: 보정 구현** — `orchestrator.py::_recent_choice_stage` 함수 서두에 추가:

```python
def _recent_choice_stage(interview: InterviewSession) -> str:
    """가장 최근 완료(체크포인트)된 구조 스테이지 — multi 변형 힌트 선택 기준."""
    # 패스트트랙 직후엔 세분도(activities)가 결정 축 — 일괄 체크포인트 순서상 branches가
    # 최신으로 잡히는 것을 보정 (design 2026-07-29 §3)
    last_user = next(
        (m for m in reversed(interview.messages) if not m.superseded and m.role == "user"),
        None,
    )
    if last_user is not None and last_user.kind == "fast_forward":
        return "activities"
    for cp in sorted(interview.checkpoints, key=lambda c: c.id or 0, reverse=True):
        if engine.get_stage(cp.stage, interview.mode).choice_stage:
            return cp.stage
    return "draft" if interview.mode == "word" else "activities"
```

- [ ] **Step 8: 전체 통과 확인** — `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` → 전부 PASS, `ruff check app/ tests/` → 0.

- [ ] **Step 9: 커밋** — `git add backend/app/routers/interviews.py backend/app/interview/orchestrator.py backend/tests/test_interview_api.py backend/tests/test_interview_orchestrator.py && git commit -m "feat(interview): deterministic fast-forward endpoint — 남은 단계 미정 처리 후 review 점프+multi draw"`

---

### Task 3: BE — 인터뷰어 계약 룰(간결체·패스트트랙 보기)

**Files:**
- Modify: `backend/app/interview/agents.py::_INTERVIEWER_CONTRACT` (룰 13 뒤)
- Test: `backend/tests/test_interview_agents.py`

**Interfaces:**
- Produces: 인터뷰어 보기 문구 `["이대로 그리기", "수정할래요", "일반 인터뷰로 진행"]` / `["Draw it as proposed", "I want changes", "Continue the full interview"]` — Task 4 FE 상수와 글자 단위 동일.

- [ ] **Step 1: 실패하는 테스트** — `test_interview_agents.py`에 추가:

```python
def test_contract_has_concise_style_rule() -> None:
    """어체 간결화 룰 — 과한 격식·인사치레 금지 (실사용 피드백 2026-07-29)."""
    msgs = build_interviewer_messages(
        stage_key="scope", lang="ko", facts={}, graph_summary="", context_text="",
        history=[], user_input="안녕",
    )
    assert "인사치레" in msgs[0]["content"]
    assert "담백하게" in msgs[0]["content"]


def test_contract_has_fast_track_rule() -> None:
    msgs = build_interviewer_messages(
        stage_key="scope", lang="ko", facts={}, graph_summary="", context_text="",
        history=[], user_input="안녕",
    )
    assert '"이대로 그리기", "수정할래요", "일반 인터뷰로 진행"' in msgs[0]["content"]
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_interview_agents.py -k "concise or fast_track_rule" -q` → FAIL.

- [ ] **Step 3: 룰 추가** — `_INTERVIEWER_CONTRACT` 룰 13 뒤에:

```
14. **간결하게**: 문장은 짧게 쓰세요. 인사치레·사족·"~해 주시면 감사하겠습니다"류 과한 격식 금지 — 정중하되 담백하게.
15. **문서로 바로 그리기(패스트트랙)**: 사용자가 첨부 문서로 바로 그리길 원하면 [참고 문서]에서 프로세스 이름·목적·범위를 추론해 제안하고, options를 정확히 ["이대로 그리기", "수정할래요", "일반 인터뷰로 진행"]으로 주세요(영어 세션은 ["Draw it as proposed", "I want changes", "Continue the full interview"]). 수정 의견을 받으면 범위만 고쳐 같은 보기로 재제안하세요. facts_patch에는 제안한 scope 값(process_name·purpose·boundaries)을 담으세요.
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_interview_agents.py -q` → PASS.

- [ ] **Step 5: 커밋** — `git add backend/app/interview/agents.py backend/tests/test_interview_agents.py && git commit -m "feat(interview): concise style + fast-track scope rules — 간결체·패스트트랙 보기 계약"`

---

### Task 4: FE — API 함수·문구 상수

**Files:**
- Modify: `frontend/src/lib/api.ts` (`abandonInterview` 부근)
- Modify: `frontend/src/lib/interview.ts` (파일 끝)

**Interfaces:**
- Produces: `fastForwardInterview(id: number): Promise<InterviewState>` · 상수 `FAST_TRACK_START_LABELS`/`FAST_TRACK_CONFIRM_LABELS`/`FAST_TRACK_NORMAL_LABELS`/`FAST_TRACK_SCOPE_MESSAGE` — Task 5가 사용.
- Consumes: BE 문구(Task 1·3)와 글자 단위 동일해야 함.

- [ ] **Step 1: api.ts에 추가** (`abandonInterview` 아래):

```ts
export function fastForwardInterview(id: number): Promise<InterviewState> {
  return request<InterviewState>(`/interviews/${id}/fast-forward`, { method: "POST" });
}
```

- [ ] **Step 2: interview.ts 끝에 상수 추가**:

```ts
// 패스트트랙 문구 — BE 인사 보기(_FAST_TRACK_OPTION)·인터뷰어 룰 15와 글자 단위 동일(단일 소스는
// 여기, design 2026-07-29 §3). 인터뷰어가 다른 문구를 내면 클릭은 일반 턴으로 흘러간다(무해).
export const FAST_TRACK_START_LABELS = ["문서로 바로 그리기", "Draw from a document"];
export const FAST_TRACK_CONFIRM_LABELS = ["이대로 그리기", "Draw it as proposed"];
export const FAST_TRACK_NORMAL_LABELS = ["일반 인터뷰로 진행", "Continue the full interview"];
export const FAST_TRACK_SCOPE_MESSAGE: Record<string, string> = {
  ko: "이 문서로 프로세스 맵을 그리고 싶어요. 이름·목적·범위를 먼저 제안해 주세요.",
  en: "I'd like to draw the process map from this document. Please propose the name, purpose, and scope first.",
};
```

- [ ] **Step 3: 타입 확인** — `npx tsc --noEmit` → 0 에러.

- [ ] **Step 4: 커밋** — `git add frontend/src/lib/api.ts frontend/src/lib/interview.ts && git commit -m "feat(interview): fast-track api + label constants — FE 단일 소스 문구"`

---

### Task 5: FE — consult 페이지 상태머신 + 패널 첨부 열기 이벤트

**Files:**
- Modify: `frontend/src/components/interview/interview-panel.tsx` (`MENTION_EVENT` 부근 + effect 1개)
- Modify: `frontend/src/app/maps/[mapId]/consult/page.tsx`

**Interfaces:**
- Consumes: Task 4의 `fastForwardInterview`·상수 4종.
- Produces: `ATTACH_EVENT`(panel export) — 페이지가 dispatch하면 패널이 첨부 안내 모달을 연다.

- [ ] **Step 1: 패널에 이벤트 추가** — `interview-panel.tsx`의 `MENTION_EVENT` export 옆에:

```ts
// 첨부 안내 열기 — 패스트트랙(문서로 바로 그리기)이 페이지에서 첨부 플로우를 트리거 (design 2026-07-29)
export const ATTACH_EVENT = "iv-open-attach";
```

컴포넌트 본문(기존 effect들 부근)에 리스너 추가:

```tsx
  useEffect(() => {
    const onOpenAttach = () => setShowAttachInfo(true);
    window.addEventListener(ATTACH_EVENT, onOpenAttach);
    return () => window.removeEventListener(ATTACH_EVENT, onOpenAttach);
  }, []);
```

- [ ] **Step 2: consult/page.tsx — import·상태 추가**:

```ts
import {
  FAST_TRACK_CONFIRM_LABELS, FAST_TRACK_NORMAL_LABELS, FAST_TRACK_SCOPE_MESSAGE,
  FAST_TRACK_START_LABELS, choiceOptionsOf, deriveParamsTable, stageIndex, stagesForMode,
} from "@/lib/interview";
import { ATTACH_EVENT, InterviewPanel } from "@/components/interview/interview-panel";
```

(`fastForwardInterview`는 api import 목록에 추가.) 상태:

```tsx
  // 패스트트랙 — 인사 보기 클릭(armed) → 첨부 성공 시 범위 제안 자동 턴(awaiting) →
  // "이대로 그리기" 인터셉트. 새로고침 시 소실 → 일반 인터뷰 폴백(무해, design 2026-07-29 §2)
  const [fastTrack, setFastTrack] = useState<"idle" | "armed" | "awaiting">("idle");
```

- [ ] **Step 3: 전송 인터셉트 핸들러** — `runTurn` 아래에 추가:

```tsx
  async function handleFastForward() {
    if (!interview || busy || drawBusy) return;
    setBusy(true);
    setError(null);
    setPending(interview.lang === "en" ? FAST_TRACK_CONFIRM_LABELS[1] : FAST_TRACK_CONFIRM_LABELS[0]);
    try {
      const state = await fastForwardInterview(interview.id);
      setInterview(state);
      setPending(null);
      setFastTrack("idle");
      if (state.draw_due === "multi" || state.draw_due === "single") void startDraw(state.draw_due);
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to fast-forward.");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  function handleSend(content: string) {
    if (FAST_TRACK_START_LABELS.includes(content)) {
      // 턴을 소비하지 않고 첨부 플로우만 연다 — 첨부 성공이 범위 제안 턴을 발화
      setFastTrack("armed");
      window.dispatchEvent(new CustomEvent(ATTACH_EVENT));
      return;
    }
    if (fastTrack === "awaiting" && FAST_TRACK_CONFIRM_LABELS.includes(content)) {
      void handleFastForward();
      return;
    }
    if (fastTrack !== "idle" && FAST_TRACK_NORMAL_LABELS.includes(content)) {
      setFastTrack("idle");
      void runTurn({ type: "answer", content });
      return;
    }
    if (fastTrack === "armed") setFastTrack("idle"); // 첨부 대신 자유 발화 — 일반 흐름 복귀
    void runTurn({ type: "answer", content });
  }
```

- [ ] **Step 4: 배선** — `<InterviewPanel ... onSend={(content) => runTurn({ type: "answer", content })}` 를 `onSend={handleSend}` 로 교체. `handleAttach` 성공 경로(`scheduleExtractionRefresh(interview.id);` 다음)에 추가:

```tsx
      if (fastTrack === "armed") {
        // 패스트트랙 — 첨부 도착 즉시 범위 제안 턴(첨부 본문은 턴 컨텍스트에 이미 포함)
        setFastTrack("awaiting");
        void runTurn({
          type: "answer",
          content: FAST_TRACK_SCOPE_MESSAGE[interview.lang] ?? FAST_TRACK_SCOPE_MESSAGE.ko,
        });
      }
```

- [ ] **Step 5: 게이트** — `npx vitest run` · `npx tsc --noEmit` · `npm run lint` → 전부 그린(에러 0).

- [ ] **Step 6: 커밋** — `git add frontend/src/components/interview/interview-panel.tsx "frontend/src/app/maps/[mapId]/consult/page.tsx" && git commit -m "feat(interview): fast-track client flow — 보기 인터셉트·첨부 트리거·자동 범위 턴"`

---

### Task 6: 스모크·문서·마무리 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-consult-fast.mjs`
- Modify: `docs/design/2026-07-29-interview-fast-track-design.md` (계측 문구 1줄)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1~5 전부. 스모크는 전 API 모킹 — dev 서버(:3000)만 필요.

- [ ] **Step 1: 스모크 작성** — `frontend/scripts/pw-smoke-consult-fast.mjs` (전체 신규, 기존 pw-smoke-consult.mjs와 동일 관례 — en 세션이므로 영어 문구 사용):

```js
// 패스트트랙 스모크 — 인사 보기 → 첨부 → 자동 범위 턴 → 이대로 그리기(fast-forward) → multi draw
// 전제: frontend dev(:3000) 기동. 사용: node scripts/pw-smoke-consult-fast.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = 9102;

const graph = (keys) => ({
  nodes: keys.map((k, i) => ({
    key: k, title: `step ${i}`, node_type: i === 0 ? "start" : i === keys.length - 1 ? "end" : "process",
    description: "", attributes: null, group_key: null,
  })),
  edges: keys.slice(1).map((k, i) => ({ source: keys[i], target: k, label: "" })),
  groups: [],
});

const state = {
  id: 2, map_id: MAP_ID, version_id: 601, status: "active", current_stage: "scope", lang: "en",
  facts: {}, working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-29T10:00:00+09:00", base_graph_updated_at: "2026-07-29T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "Hello, I'm your process consultant.",
    payload: { options: ["Draw from a document"] }, stage: "scope", superseded: false, created_at: "2026-07-29T10:00:00+09:00" }],
};

const afterScopeTurn = {
  ...state,
  facts: { scope: { process_name: "Purchasing", purpose: "standardize", boundaries: "req~po" } },
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer",
      content: "I'd like to draw the process map from this document. Please propose the name, purpose, and scope first.",
      payload: null, stage: "scope", superseded: false, created_at: "2026-07-29T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "question", content: "Here is the proposed scope.",
      payload: { options: ["Draw it as proposed", "I want changes", "Continue the full interview"] },
      stage: "scope", superseded: false, created_at: "2026-07-29T10:01:05+09:00" }],
};

const afterFastForward = {
  ...afterScopeTurn, current_stage: "review", draw_due: "multi",
  checkpoints: [
    { stage: "scope", message_seq: 4, working_graph: null, created_at: "2026-07-29T10:02:00+09:00" },
    { stage: "activities", message_seq: 4, working_graph: null, created_at: "2026-07-29T10:02:00+09:00" },
  ],
  messages: [...afterScopeTurn.messages,
    { id: 4, seq: 4, role: "user", kind: "fast_forward", content: "Draw it as proposed.", payload: null, stage: "scope", superseded: false, created_at: "2026-07-29T10:02:00+09:00" },
    { id: 5, seq: 5, role: "consultant", kind: "notice", content: "Drawing straight from the document.", payload: null, stage: "review", superseded: false, created_at: "2026-07-29T10:02:01+09:00" }],
};

const afterDraw = {
  ...afterFastForward, draw_due: null,
  messages: [...afterFastForward.messages,
    { id: 6, seq: 6, role: "consultant", kind: "choices", content: "Proposals are ready.", stage: "review",
      payload: { options: [
        { id: "opt-7-1", title: "Standard", summary: "10 steps", graph: graph(["s", "a", "b", "e"]) },
        { id: "opt-7-2", title: "Detailed", summary: "14 steps", graph: graph(["s", "a", "b", "c", "e"]) },
      ] }, superseded: false, created_at: "2026-07-29T10:02:20+09:00" }],
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();

  await page.route("**/api/me", (r) => r.fulfill({ json: { login_id: "admin.sys", name: "Admin", ai_enabled: true, manual_url: "", csv_manual_url: "", role: "admin", is_sysadmin: true, can_view_dashboard: true } }));
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Fast Track Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 601, label: "As-Is", status: "draft", events: [] }] } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/2/attachments", (r) => r.fulfill({ json: { id: 11, filename: "sop.txt", mime: "text/plain", size: 5, status: "parsed", error: null, created_at: "2026-07-29T10:00:30+09:00" } }));
  await page.route("**/api/interviews/2/turns", (r) => r.fulfill({ json: afterScopeTurn }));
  await page.route("**/api/interviews/2/fast-forward", (r) => r.fulfill({ json: afterFastForward }));
  await page.route("**/api/interviews/2/draw", async (r) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    r.fulfill({ json: afterDraw });
  });
  await page.route("**/api/interviews/2", (r) =>
    r.request().method() === "DELETE" ? r.fulfill({ status: 204 }) : r.fulfill({ json: afterScopeTurn }),
  );
  await page.route("**/api/notifications*", (r) => r.fulfill({ json: [] }));

  await page.goto(`${BASE}/maps/${MAP_ID}/consult`);
  await page.waitForSelector('[data-id="interview-panel"]');

  // 1) 인사 보기 클릭 → 첨부 안내 모달(턴 소비 없음)
  await page.click('[data-id="iv-question-option"]:has-text("Draw from a document")');
  await page.waitForSelector('[data-id="iv-attach-info"]');

  // 2) 파일 주입 → 업로드 → 자동 범위 제안 턴 → 확인 보기 노출
  await page.setInputFiles('[data-id="iv-file-input"]', [
    { name: "sop.txt", mimeType: "text/plain", buffer: Buffer.from("purchase process doc") },
  ]);
  await page.waitForSelector('[data-id="iv-question-option"]:has-text("Draw it as proposed")');

  // 3) 이대로 그리기 → fast-forward → 자동 multi draw → 오버레이 → 복수안 모달
  await page.click('[data-id="iv-question-option"]:has-text("Draw it as proposed")');
  await page.waitForSelector('[data-id="iv-draw-overlay"]');
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 2) throw new Error(`expected 2 choice cards, got ${cards.length}`);

  console.log("PW consult-fast smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
```

주의: 첨부 안내 모달(iv-attach-info)이 열린 채 `setInputFiles`가 동작하는 것은 기존 pw-smoke-consult.mjs와 동일 관례. 단일 유효 파일은 리뷰 모달 없이 즉시 업로드된다.

- [ ] **Step 2: 스모크 실행** — 좀비 정리(`pkill -f "next dev"`) 후 `npm run dev` 백그라운드 기동 → `cd scripts && node pw-smoke-consult-fast.mjs` → OK. 기존 `pw-smoke-consult.mjs`·`pw-smoke-consult-word.mjs`도 재실행해 회귀 없음 확인.

- [ ] **Step 3: 설계 문서 정정(2곳)** — `docs/design/2026-07-29-interview-fast-track-design.md`:
  1. "계측은 kind=\"interview\" ok=True(토큰 0 — AI 무관)" → "계측 이벤트 없음 — apply-params와 동일한 AI 0콜 관례"로 교체(구현과 일치).
  2. "파일 선택 취소 시 disarm" → "파일 선택 취소 시 armed 잔류 — 취소 감지가 불안정해 단순화. 자유 발화 시 해제되고, 잔류 중 첨부하면 범위 제안이 이어져 무해"로 교체(구현과 일치).

- [ ] **Step 4: PROGRESS.md** — 최상단에 항목 추가:

```markdown
## 2026-07-29 — 인터뷰 패스트트랙 + 세분도 표준 10±3 (worktree-ai-consultant)
- **패스트트랙**: 인사 보기 "문서로 바로 그리기" → 첨부 → 자동 범위 제안 턴(AI 1콜, 첨부 본문 컨텍스트) → "이대로 그리기" FE 인터셉트 → `POST /fast-forward`(AI 0콜 — skip 시맨틱 일괄 전진·체크포인트·review 점프) → 자동 multi draw(힌트는 fast_forward 감지로 activities 고정). 문구 단일 소스 FE `FAST_TRACK_*` 상수(BE 인사·룰 15와 글자 동일). 스모크 `pw-smoke-consult-fast.mjs` 신설. 설계 `docs/design/2026-07-29-interview-fast-track-design.md`.
- **어체 간결화(룰 14)**: 인사치레·과격식 금지. **세분도 표준 10±3**: 계약·활동 힌트(표준 10내외/세밀 13~18/간결 6~8)·엔진 goal·린트(7~13) 동기(f735220).
```

- [ ] **Step 5: 최종 게이트** — BE 전체 pytest + ruff / FE vitest + tsc + lint + build + 스모크 3종(consult·word·fast) 전부 그린 확인.

- [ ] **Step 6: 커밋·푸시** — `git add frontend/scripts/pw-smoke-consult-fast.mjs docs/design/2026-07-29-interview-fast-track-design.md PROGRESS.md && git commit -m "test(interview): fast-track smoke + docs — 패스트트랙 스모크·문서 정리" && git push origin worktree-ai-consultant`
