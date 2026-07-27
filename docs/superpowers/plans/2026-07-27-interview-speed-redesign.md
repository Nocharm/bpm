# Interview Speed & Timing Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 일반 턴을 인터뷰어 1콜로 경량화하고, 그리기를 명시적 `/draw` 이벤트(진행 오버레이)로 응축하며, 델타 드래프팅·facts 아웃라인·맵 기준 배지로 체감 속도와 채팅-맵 동기성을 회복한다.

**Architecture:** 오케스트레이터에서 턴 내 재드래프트·선택지·톤 검수를 제거하고 `TurnResult.draw_due` 신호만 남긴다. 생성 로직은 `generate_proposals()`로 이동해 신규 `POST /interviews/{id}/draw`가 동기 호출(프론트는 오버레이+채팅 잠금). 드래프터는 델타 계약(기존 노드 키 에코, `exclude_unset` 복원). 프론트는 draw_due 자동 호출·Draw map 버튼·facts 아웃라인 패널·맵 기준 배지.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic v2 · Next.js + @xyflow/react · pytest / vitest / Playwright(pw-smoke)

**Spec:** `docs/design/2026-07-27-interview-speed-redesign-design.md`

## Global Constraints

- P1/P2 플랜의 Global Constraints 전부 유지 — 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ai-consultant`(브랜치 `worktree-ai-consultant`, checkout 금지) · AI 모킹 `monkeypatch.setattr(ai_client, "call_ai", fake)` · KST · LF · 토큰만 · data-id 부여 · React Compiler 제약.
- 게이트: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`(805 기준) · ruff / vitest(566 기준) · tsc · lint · build · pw-smoke-consult(+word).
- 스펙 정밀화 1건: `draw_due`는 bool이 아닌 **`"multi" | "single" | null`** — 트리거 종류(구조 완료=multi, review 진입·redraw=single)를 백엔드가 알기 때문에 리터럴로 내린다.
- 기존 세션 호환: DB 변경 없음. `pending_choices`·`choices` 메시지·choice 턴 계약 재사용.
- 커밋: 태스크당 1커밋 + PROGRESS.md 동반 갱신. **dev 머지는 전체 완료 후 사용자 확인.**

## File Structure

```
backend/app/interview/orchestrator.py   [수정] 턴 경량화·generate_proposals·_expand_delta
backend/app/interview/agents.py         [수정] 톤 계약 삭제·드래프터 델타/명명 규칙·컴팩트 작업본
backend/app/routers/interviews.py       [수정] draw 엔드포인트·draw_due 세팅·SP 훅 이동
backend/app/schemas.py                  [수정] AiNode.title 완화·InterviewStateOut.draw_due·InterviewDrawIn
backend/tests/test_interview_orchestrator.py  [수정] 턴 1콜·델타 단위
backend/tests/test_interview_api.py     [수정+추가] draw API·draw_due·SP 훅 이동
frontend/src/lib/api.ts                 [수정] drawProposals·draw_due 타입
frontend/src/lib/interview.ts           [수정] deriveOutline
frontend/src/lib/interview.test.ts      [추가] 아웃라인 파생 vitest (파일 없으면 신규)
frontend/src/app/maps/[mapId]/consult/page.tsx      [수정] draw_due 자동 호출·drawBusy 전파
frontend/src/components/interview/interview-preview.tsx  [수정] 오버레이·Draw map 버튼·배지·아웃라인 장착
frontend/src/components/interview/interview-outline.tsx  [신규] facts 아웃라인 패널
frontend/scripts/pw-smoke-consult.mjs   [수정] 새 흐름(턴→draw→모달→수락)
frontend/scripts/pw-smoke-consult-word.mjs [수정] 동일
```

---

### Task 1: 백엔드 — 턴 경량화 (인터뷰어 1콜 + 톤 검수 폐지 + draw_due 신호)

**Files:**
- Modify: `backend/app/interview/orchestrator.py`, `backend/app/interview/agents.py`, `backend/app/schemas.py`, `backend/app/routers/interviews.py`
- Test: `backend/tests/test_interview_orchestrator.py`, `backend/tests/test_interview_api.py`

**Interfaces:**
- Produces: `run_turn(...) -> TurnResult` — `@dataclass TurnResult: draw_due: str | None = None` (`"multi"`/`"single"`/None).
- Produces: `InterviewStateOut.draw_due: str | None = None` (비영속 — 라우터가 턴 응답에만 세팅).
- 삭제: `_tone_review`·`build_tone_messages`·`ToneReviewOut`·`_TONE_NOTICE`·`_tone_notice_text`·`_redraft`·턴 내 `_generate_choices` 분기·`_DEMOTE_NOTICE`의 턴 경로(강등 노티스는 Task 2의 draw로 이동).

- [x] **Step 1: 실패 테스트 작성** — test_interview_orchestrator.py 전면 개정:

```python
def test_answer_turn_is_single_interviewer_call() -> None:
    """일반 턴은 인터뷰어 1콜만 소비한다 — 재드래프트·톤 검수 폐지 (speed redesign §3)."""
    db, interview = _FakeDb(), _session()
    fake, state = _scripted_ai([INTERVIEWER_Q])  # 큐 1개 — 추가 호출 시 IndexError로 실패
    # ... _run과 동일 패턴, 큐 잔량 0 단언
    assert interview.working_graph is None  # 턴은 맵을 건드리지 않는다

def test_structure_stage_completion_signals_multi_draw() -> None:
    """activities 완료 전이 턴은 TurnResult.draw_due == 'multi'."""

def test_review_entry_signals_single_draw() -> None:
    """review로 전이한 턴은 draw_due == 'single'."""

def test_redraw_request_signals_single_draw() -> None:
    """redraw/needs_choices 플래그 턴은 전이 없어도 draw_due == 'single', 드래프터 미호출."""

def test_plain_turn_has_no_draw_due() -> None:
```

기존 테스트 정리: `test_choices_generated_in_parallel_and_pending_set`·중복 필터 2종은 Task 2의 draw 테스트로 이관, `test_stage_complete_runs_tone_review_renames`·`test_review_stage_completion_does_not_spam...`(톤 부분)·`test_facts_update_triggers_live_redraft`·`test_redraft_failure...`·word 재드래프트 노티스 2종 삭제/이관. `test_choice_turn_applies_graph_and_clears_pending`·skip·반복 교정·오프닝 시드는 유지(호출 수만 조정).

- [x] **Step 2: 실행 — 실패 확인** `pytest tests/test_interview_orchestrator.py -q` → FAIL (TurnResult 미존재)

- [x] **Step 3: 구현**

orchestrator.py — run_turn 말미를 다음 골격으로 교체(체크포인트·전이·facts 병합·반복 교정 유지):

```python
@dataclass(frozen=True)
class TurnResult:
    draw_due: str | None = None  # "multi" | "single" | None — 라우터가 응답 플래그로 전달


def _draw_due(pre_stage: str, interview: InterviewSession, out: InterviewerOut, mode: str) -> str | None:
    transitioned = interview.current_stage != pre_stage
    if transitioned and engine.get_stage(pre_stage, mode).choice_stage:
        return "multi"
    if transitioned and interview.current_stage == "review":
        return "single"
    if out.redraw or out.needs_choices:
        return "single"
    return None
```

run_turn: `pre_stage = interview.current_stage` 캡처 → 인터뷰어 1콜(+반복 교정) → facts 병합 → (choice 턴이면 chosen 그래프 반영) → stage_complete면 체크포인트+전이(톤 검수 없이) → `return TurnResult(draw_due=_draw_due(pre_stage, interview, out, interview.mode))`. `_run_skip_turn`도 재드래프트 제거 후 동일 계산으로 TurnResult 반환.

agents.py: `_TONE_CONTRACT`·`build_tone_messages`·`ToneReviewOut` 삭제. 드래프터 규칙 2를 확장: `2. 좌표는 넣지 마세요(자동 배치). 노드 제목은 조직 표준 '명사+동사' 명사구('요청서 작성') — '~하기' 동명사형 금지, start/end 제목은 자유.` `_HISTORY_TAIL` 12→8.

schemas.py: `InterviewStateOut.draw_due: str | None = None`.

routers/interviews.py post_turn: `result = await run_turn(...)` → 성공 커밋 후 `state = await _state_out(...)` 반환 직전 `state.draw_due = result.draw_due`. (word 모드 강등 노티스는 draw로 이동하므로 demoted 처리 제거.)

- [x] **Step 4: 실행 — 통과 확인** `pytest tests/test_interview_orchestrator.py tests/test_interview_api.py -q` → PASS (draw 관련 기존 api 테스트는 Task 2에서 복원)

- [x] **Step 5: 커밋** `feat(interview): single-call turns with draw_due signal — 턴 경량화(톤 검수 폐지·draw 신호)`

---

### Task 2: 백엔드 — `POST /interviews/{id}/draw` + generate_proposals 이동

**Files:**
- Modify: `backend/app/interview/orchestrator.py`(`_generate_choices` → `generate_proposals`), `backend/app/routers/interviews.py`, `backend/app/schemas.py`
- Test: `backend/tests/test_interview_api.py`

**Interfaces:**
- Produces: `orchestrator.generate_proposals(interview, context_text, model, doc_sections, variants: str) -> tuple[dict | None, int]` — (pending_choices 형태 `{"options": [...]}` 또는 전멸 시 None, word 강등 수). multi=`CHOICE_VARIANT_HINTS[<최근 완료 choice 스테이지>]`×`interview_choice_count`, single=`_REDRAFT_HINT` 1안. 무변화·중복 필터(`_graph_signature`)·`_sanitize_subprocess`·word `_sanitize_word_graph` 적용.
- Produces: `InterviewDrawIn(variants: Literal["multi","single"] = "single")` schema, `POST /api/interviews/{id}/draw` → `InterviewStateOut`.
- 최근 완료 choice 스테이지: `next((c.stage for c in sorted(interview.checkpoints, key=lambda c: c.id, reverse=True) if engine.get_stage(c.stage, interview.mode).choice_stage), "activities" if interview.mode == "normal" else "draft")`.

- [x] **Step 1: 실패 테스트** — test_interview_api.py에 추가(기존 choices 오케스트레이터 테스트 3종도 draw 경유로 이관):

```python
def test_draw_multi_generates_proposals(client, monkeypatch):
    """draw(multi)가 병렬 N안을 pending_choices+choices 메시지로 적재."""
    # 인터뷰 생성 → 스크립트 AI: [DRAFT, DRAFT_B] → POST /draw {"variants":"multi"}
    # 응답 pending 반영: messages[-1].kind == "choices", payload options 2개

def test_draw_single_uses_one_draft(client, monkeypatch): ...

def test_draw_all_filtered_appends_notice(client, monkeypatch):
    """전 안이 현재 작업본과 동일하면 choices 대신 notice — 작업본 불변."""

def test_draw_failure_rolls_back(client, monkeypatch):
    """AI 전멸 시 502, working_graph·messages 불변."""

def test_draw_word_demote_notice(client, monkeypatch):
    """word 모드 draw에서 무효 앵커 강등 시 노티스 동반 (기존 word 재드래프트 노티스의 대체)."""
```

- [x] **Step 2: 실행 — 실패 확인** → FAIL (404 draw)

- [x] **Step 3: 구현** — routers/interviews.py:

```python
@router.post("/interviews/{interview_id}/draw", response_model=InterviewStateOut)
async def draw_proposals(
    interview_id: int, payload: InterviewDrawIn,
    user: str = Depends(get_current_user), session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    """그리기 이벤트(동기) — 제안 생성만 담당, 작업본은 수락(choice 턴) 시점에만 변경."""
    _require_ai_enabled()
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")
    context_text = await _context_text(interview)
    doc_sections = ...  # 기존 post_turn과 동일 로딩
    try:
        choices, demoted = await generate_proposals(
            session_interview=interview, context_text=context_text, model=None,
            doc_sections=doc_sections, variants=payload.variants,
        )
    except TurnError as exc:
        await session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    seq = next_seq(interview)
    if choices is None:
        _append_notice(...)  # "현재 맵과 같은 안뿐입니다 — 대화를 더 진행한 뒤 다시 그려보세요."
    else:
        interview.pending_choices = choices
        # choices 메시지 content는 고정 안내문(인터뷰어 미호출): lang별 "안을 골라주세요…"
    if demoted: _append 강등 노티스
    AiUsageEvent(kind="interview") 기록 후 commit → _state_out
```

- [x] **Step 4: 전체 인터뷰 테스트 통과 확인** `pytest tests/test_interview_*.py tests/test_kb_pipeline.py -q`

- [x] **Step 5: 커밋** `feat(interview): synchronous draw endpoint — 그리기 이벤트 분리`

---

### Task 3: 백엔드 — 델타 드래프팅 (키 에코 + exclude_unset 복원)

**Files:**
- Modify: `backend/app/schemas.py`(AiNode.title), `backend/app/interview/agents.py`(계약·컴팩트 작업본), `backend/app/interview/orchestrator.py`(`_expand_delta` — generate_proposals 경로에 삽입)
- Test: `backend/tests/test_interview_orchestrator.py`

**Interfaces:**
- `AiNode.title: str = Field(default="", max_length=200)` (min_length 제거 — 키 에코 허용).
- `agents.format_graph_compact(graph: dict | None) -> str` — `"<key> | <node_type> | <title>"` 줄 목록, 없으면 "(없음)".
- `orchestrator._expand_delta(proposal: AiProposal, prev: dict | None) -> AiProposal` — 노드별 `model_dump(exclude_unset=True)`를 prev(키 조인) 위에 병합해 완전한 노드로 복원. prev에 없고 title 빈 노드는 드롭(참조 엣지도 드롭). generate_proposals가 `_graph_from_proposal` 전에 적용.

- [x] **Step 1: 실패 테스트**

```python
def test_expand_delta_restores_echoed_nodes() -> None:
    """{"key":"a"}만 에코해도 이전 작업본의 title/type/attributes가 복원된다."""

def test_expand_delta_field_override_wins() -> None:
    """에코에 title만 실으면 title만 갱신, 나머지는 복원."""

def test_expand_delta_missing_key_means_delete() -> None:
    """목록에서 빠진 키는 결과에 없다(삭제) — 참조 엣지도 소거."""

def test_expand_delta_unknown_key_without_title_dropped() -> None:
```

- [x] **Step 2: 실행 — 실패 확인**

- [x] **Step 3: 구현** — `_expand_delta` 핵심:

```python
def _expand_delta(proposal: AiProposal, prev: dict | None) -> AiProposal:
    """델타 복원 — 기존 노드 키 에코를 이전 작업본으로 완성 (speed redesign §5)."""
    prev_by_key = {n["key"]: n for n in (prev or {}).get("nodes", [])}
    nodes, kept = [], set()
    for node in proposal.nodes:
        data = node.model_dump(exclude_unset=True)
        base = prev_by_key.get(node.key)
        if base is None and not data.get("title"):
            continue  # 이전에도 없고 제목도 없는 노드 — 해석 불가 드롭
        merged = {**(base or {}), **{k: v for k, v in data.items() if k != "key"}, "key": node.key}
        nodes.append(AiNode.model_validate(merged))
        kept.add(node.key)
    edges = [e for e in proposal.edges if e.source in kept and e.target in kept]
    return proposal.model_copy(update={"nodes": nodes, "edges": edges})
```

드래프터 계약(agents.py) 규칙 추가 + [현재 작업본]을 `format_graph_compact`로 교체:

```
6. **델타 출력**: 최종 그래프에 포함할 노드 전체 목록을 쓰되, [현재 작업본]에 이미 있고
   그대로 유지할 노드는 {"key":"<키>"}만 쓰세요(다른 필드 생략 — 시스템이 복원).
   수정하거나 새로 만드는 노드만 전체 필드를 작성합니다. 목록에서 뺀 키는 삭제됩니다.
```
(word 애든덤 번호는 7~10으로 재조정.)

- [x] **Step 4: 통과 확인 + 전체 백엔드** `pytest tests/ -q`

- [x] **Step 5: 커밋** `feat(interview): delta drafting contract — 델타 드래프팅(키 에코 복원)`

---

### Task 4: 백엔드 — SP 제안 훅을 choice 턴으로 이동

**Files:**
- Modify: `backend/app/routers/interviews.py`
- Test: `backend/tests/test_kb_pipeline.py`

**Interfaces:**
- post_turn의 `_maybe_sp_suggestion` 호출 조건을 `interview.mode == "normal" and payload.type == "choice"`로 교체(스테이지 조건 삭제 — 수락 직후가 작업본 갱신 유일 시점).

- [x] **Step 1: 기존 테스트 수정** — `test_turn_appends_sp_suggestion_once`를 choice 턴 시나리오로(사전에 pending_choices 시드 → choice 턴 → sp_suggestion 1건, 중복 재제안 없음). answer 턴은 제안 없음 단언 추가.
- [x] **Step 2: 실패 확인 → 구현 → 통과** `pytest tests/test_kb_pipeline.py -q`
- [x] **Step 3: 커밋** `refactor(interview): move SP suggestion to accept turn — SP 제안 훅 이동`

---

### Task 5: 프론트 — draw 배선·진행 오버레이·Draw map 버튼

**Files:**
- Modify: `frontend/src/lib/api.ts`, `frontend/src/app/maps/[mapId]/consult/page.tsx`, `frontend/src/components/interview/interview-preview.tsx`
- Test: `frontend/scripts/pw-smoke-consult.mjs`(Task 7에서 최종), tsc/vitest/lint

**Interfaces:**
- api.ts: `InterviewState.draw_due?: "multi" | "single" | null;` · `export function drawProposals(id: number, variants: "multi" | "single"): Promise<InterviewState>` (`POST /interviews/${id}/draw`).
- page.tsx: `const [drawBusy, setDrawBusy] = useState<false | "multi" | "single">(false)` — runTurn 성공 시 `state.draw_due`면 `void startDraw(state.draw_due)`; `startDraw`는 실패 시 `drawError` 세팅(오버레이 Retry). `InterviewPanel busy={busy || !!drawBusy}`(채팅 잠금), `InterviewPreview`에 `drawBusy`/`drawError`/`onDraw(variants)` 전달.
- interview-preview.tsx: 액션바에 "Draw map" 버튼(`data-id="iv-draw"`, review 아닌 active 상태에서 노출, `onDraw("single")`) · `drawBusy`면 캔버스 중앙 오버레이(`data-id="iv-draw-overlay"`): 스켈레톤 카드 + "Drawing proposals…" + 경과초(1s interval state) + `drawError`면 에러 문구+Retry 버튼(`data-id="iv-draw-retry"`).

- [x] **Step 1: 구현** (위 인터페이스 그대로 — 오버레이는 ChoiceOverlay와 같은 z-20 절대 배치, 경과초는 `useEffect` interval + start timestamp state)
- [x] **Step 2: 게이트** `npx tsc --noEmit && npx vitest run && npm run lint` → PASS
- [x] **Step 3: 커밋** `feat(interview): draw wiring with progress overlay — draw 배선·오버레이·버튼`

---

### Task 6: 프론트 — facts 아웃라인 패널 + 맵 기준 배지

**Files:**
- Create: `frontend/src/components/interview/interview-outline.tsx`
- Modify: `frontend/src/lib/interview.ts`, `frontend/src/components/interview/interview-preview.tsx`
- Test: `frontend/src/lib/interview.test.ts`(파일 있으면 추가, 없으면 신규)

**Interfaces:**
- interview.ts:

```ts
export interface OutlineEntry { stage: string; label: string; items: [string, string][] }
// facts를 스테이지 순서로 평탄화 — 값은 배열이면 " · " 조인, 60자 클램프
export function deriveOutline(facts: Record<string, Record<string, unknown>> | null, mode?: string): OutlineEntry[]
// activities 스테이지 facts에서 배열/쉼표 열거 값을 찾아 시퀀스 미리보기(최대 8) — 없으면 []
export function deriveSequencePreview(facts: Record<string, Record<string, unknown>> | null): string[]
```

주의: `InterviewState`에 `facts`가 현재 노출되지 않으면 `InterviewStateOut`/`api.ts`에 `facts` 필드 추가(백엔드 1줄 — InterviewSession.facts 그대로).
- interview-outline.tsx: 좌하단 접기 카드(`data-id="iv-outline"`) — 헤더 "Collected so far" + 스테이지별 체크리스트 + 시퀀스 미리보기(`Start → A → B`), 항목 0이면 미렌더.
- 배지: 액션바 좌측 문구 교체 — 마지막 라이브 `kind==="choice"` user 메시지 이후 라이브 user 메시지 수 N: N===0 → "Map up to date", 없으면 "Map not drawn yet", 그 외 "Map from N turns ago"(`data-id="iv-map-baseline"`).

- [x] **Step 1: vitest 작성**(deriveOutline 평탄화·배열 조인·시퀀스 추출·빈 facts) → 실패 확인
- [x] **Step 2: 구현 → vitest 통과**
- [x] **Step 3: 패널·배지 장착 + tsc/lint** → PASS
- [x] **Step 4: 커밋** `feat(interview): facts outline panel and map baseline badge — 아웃라인 패널·맵 기준 배지`

---

### Task 7: 스모크 재작성 + 전체 게이트 + 문서

**Files:**
- Modify: `frontend/scripts/pw-smoke-consult.mjs`, `frontend/scripts/pw-smoke-consult-word.mjs`, `PROGRESS.md`

- [x] **Step 1: 스모크 갱신** — 새 흐름: 인사 → answer 턴(응답 `draw_due:"multi"` 목) → `**/api/interviews/1/draw` 목 대기 중 `iv-draw-overlay` 확인 → 완료 응답(choices 3안) → ChoiceOverlay 탭 → 수락(choice 턴) → 체크포인트·프리뷰·SP 카드·아웃라인(`iv-outline`)·배지(`iv-map-baseline`) 단언. draw 목은 `route.fulfill` 지연(`setTimeout` 300ms)으로 오버레이 노출 검증. word 스모크도 draft 완료 → draw(single) 흐름으로 갱신.
- [x] **Step 2: 전체 게이트** — BE pytest+ruff / FE vitest+tsc+lint+build+스모크 3종(word-home 포함) 전부 그린.
- [x] **Step 3: PROGRESS·플랜 체크박스·메모리 갱신 후 커밋** `test(interview): smoke for draw flow + gates — 스모크 재작성·게이트`
- [x] **Step 4: dev 머지 전 사용자 확인** — 게이트 결과 보고 후 승인 시 dev --no-ff/ff 머지+푸시.

## Self-Review 결과

- 스펙 §3(경량화)=Task 1, §4(draw)=Task 2·5, §5(델타)=Task 3, §6(아웃라인·배지)=Task 6, §7(에러)=Task 2·5, §8(테스트)=각 태스크+Task 7, SP 이동(§5 부수)=Task 4 — 커버 확인.
- `draw_due` 리터럴 정밀화는 Global Constraints에 명시(스펙 bool → literal).
- 타입 일관성: TurnResult/InterviewDrawIn/drawProposals/OutlineEntry 시그니처 태스크 간 일치 확인.
