# AI L5 2라운드 스프린트 ④a 캠페인 엔진(백엔드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 캠페인 백엔드를 2라운드 계약으로 올린다 — 질문 섹션·종류 지시(B12), IO 배열(B8), 러너 병렬(B13), 세션 캔버스 컬럼과 relations 왕복(B4/B5 기반), 자연어 피드백 엔드포인트(B4/B5/B9 기반).

**Architecture:** `app/framework_interview/canvas.py`(신설)가 relations↔canvas 변환의 단일 진실이고, 라우터는 relations 제안 시 canvas를 함께 채우고 확정 시 canvas를 relations로 역산한다. 피드백은 `POST /feedback` 한 경로에서 scope로 갈라 canvas 또는 row를 AI에 다시 묻는다. 러너는 세션당 "실행 가능한 잡 전부"를 세마포어(`fw_consult_concurrency`) 안에서 `gather`한다(전역 AI 상한은 기존 `ai_max_concurrency`가 그대로 건다).

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2(Python 3.11 문법만), pytest(fake `ai_client.call_ai` 큐 패턴).

**Spec:** `docs/superpowers/specs/2026-09-23-ai-l5-campaign-round2-design.md` §4 (4.1~4.6)

## Global Constraints

- Python 3.11 문법만(`backend/ruff.toml target-version py311`). PEP 695 등 금지.
- 새 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS` 등록 필수(운영 DB 자동 ALTER, 리셋 금지).
- 새 Settings 필드는 `.env.example` + `docker-compose.yml` backend `environment:`(`VAR: ${VAR:-기본}`)에 같이 매핑(backend는 `env_file` 없음).
- 프롬프트 문구에 긴 대시(—) 금지. 인터뷰 JSON 0.5 키 집합 불변 — `rows[]` 키는 어댑터 `_ROW_KEYS/_FIELD_KEYS/_ACTION_KEYS` 안에서만(값 형태 변경은 허용: input/output 배열).
- 4표면 계약(어댑터 `scripts/consultant_interview.py` ↔ 조립기 `assemble.py`+`contracts.py` ↔ 외부 프롬프트 `frontend/src/lib/interview-json-prompt.ts`+`docs/samples/interview-json-0.5.md` ↔ 역변환 `existing.py map_to_row`)이 바뀌면 넷을 같이 옮기고 `test_framework_interview_assemble.py`·`test_framework_interview_existing.py`·`interview-json-prompt.test.ts`로 확인.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`(병렬 실행 금지, sqlite) + `.venv/bin/ruff check app/ tests/`. FE 타입을 건드리면 frontend/ `npx tsc --noEmit -p tsconfig.json`.
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 서브에이전트는 이 절대경로에서 `pwd`·`git branch --show-current`를 먼저 확인한다. 복합 Bash는 harness가 거부할 수 있으니 단순 명령으로 나눈다. 광범위 `pkill` 금지.
- 테스트 fixture 규약: `client`(세션 스코프 TestClient, DB 공유 → 이름/코드는 `uuid4().hex[:6]` 태그로 격리), `HEADERS = {"X-Dev-User": "fw.admin"}`, `_enable(monkeypatch)`(ai_enabled·sysadmin·runner.kick no-op), `_fake_ai_queue(monkeypatch, [json_str, ...])`(호출 순서대로 소비). 예시는 `tests/test_framework_interview_api.py`·`tests/test_framework_interview_runner.py`.

---

### Task 1: 질문 섹션 + 종류 선택 지시 (B12)

**Files:**
- Modify: `backend/app/framework_interview/contracts.py:34-48` (`Question`), `:157-170` (`L6_QUESTIONNAIRE_CONTRACT`)
- Modify: `backend/app/framework_interview/normalize.py` (`normalize_questionnaire` — `section` 정규화)
- Modify: `frontend/src/lib/api.ts:2878-2885` (`FwQuestion.section`)
- Test: `backend/tests/test_framework_interview_normalize.py`, `backend/tests/test_framework_interview_contracts.py`

**Interfaces:**
- `QuestionSection = Literal["basic", "activities", "exceptions", "io"]`, `Question.section: QuestionSection = "basic"`. 정규화: 미지·누락은 `"basic"`, `maps_to`가 `activities`면 `"activities"`, `branches`면 `"exceptions"`, `io`면 `"io"`(모델이 section을 안 줬을 때의 폴백).
- FE: `section: "basic" | "activities" | "exceptions" | "io"`.

- [ ] **Step 1: 실패하는 테스트**

```python
# tests/test_framework_interview_normalize.py 에 추가
def test_normalize_questionnaire_fills_section_from_maps_to() -> None:
    raw = {"questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동", "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "suggested": ["a"]},
        {"id": "q2", "kind": "single", "maps_to": "roles", "text": "역할", "options": [{"id": "r", "label": "R"}, {"id": "s", "label": "S"}], "suggested": ["r"], "section": "weird"},
        {"id": "q3", "kind": "text", "maps_to": "io", "text": "입력", "options": [], "suggested": "x", "section": "exceptions"},
    ]}
    out = normalize_questionnaire(raw)
    sections = {q["id"]: q["section"] for q in out["questions"]}
    assert sections == {"q1": "activities", "q2": "basic", "q3": "exceptions"}  # 명시 값은 존중, 미지 값은 basic, 누락은 maps_to로
```

```python
# tests/test_framework_interview_contracts.py 에 추가
def test_question_section_defaults_and_prompt_mentions_kind_rules() -> None:
    q = Question(id="q1", kind="text", maps_to="conditions", text="t", suggested="s")
    assert q.section == "basic"
    assert "single" in L6_QUESTIONNAIRE_CONTRACT and "section" in L6_QUESTIONNAIRE_CONTRACT
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_framework_interview_normalize.py tests/test_framework_interview_contracts.py -q -k "section"` → FAIL.

- [ ] **Step 3: 구현** — `contracts.py`:

```python
QuestionSection = Literal["basic", "activities", "exceptions", "io"]

class Question(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: QuestionKind
    maps_to: MapsTo
    section: QuestionSection = "basic"  # 폼 그룹 — basic(기본 정보)/activities(활동)/exceptions(예외·분기)/io(입출력)
    ...
```

`L6_QUESTIONNAIRE_CONTRACT` 규칙 블록에 추가(기존 "kind: single…" 줄 아래):

```
- 종류 선택 기준: 하나만 고르는 배타 선택은 single(예/아니오도 single 2옵션), 여럿이 해당하면 multi, 순서가 의미 있으면 ordered, 자유 서술만 text.
- section: basic(담당·범위 같은 기본 정보) / activities(활동 순서, ordered 문항) / exceptions(예외·분기·되돌아감) / io(입력물·산출물·시스템). 문항마다 하나를 적으세요.
- 구성 가이드: basic 2~3, activities 1, exceptions 1~2, io 1~2.
```

예시 JSON 한 줄에 `"section":"activities"` 추가. `normalize.py` `normalize_questionnaire`의 문항 dict 조립부에:

```python
SECTION_BY_MAPS_TO = {"activities": "activities", "branches": "exceptions", "io": "io"}
SECTIONS = {"basic", "activities", "exceptions", "io"}
...
        section = _lower(item.get("section"))
        question["section"] = section if section in SECTIONS else SECTION_BY_MAPS_TO.get(question["maps_to"], "basic")
```

`api.ts` `FwQuestion`에 `section: "basic" | "activities" | "exceptions" | "io";`. FE 픽스처(`src/lib/framework-interview.test.ts` 등)에 FwQuestion 리터럴이 있으면 `section: "basic"` 추가(tsc가 알려준다).

- [ ] **Step 4: 통과 확인** — 위 pytest PASS · 전체 `tests/test_framework_interview_*.py` green · ruff · frontend tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/framework_interview/contracts.py backend/app/framework_interview/normalize.py backend/tests/test_framework_interview_normalize.py backend/tests/test_framework_interview_contracts.py frontend/src/lib/api.ts PROGRESS.md
git commit -m "feat(fw-interview): question sections and kind-selection rules — 질문 섹션·종류 선택 지시"
```

---

### Task 2: IO 배열 계약 (B8a)

**Files:**
- Modify: `backend/app/framework_interview/contracts.py:76-84` (`RowAction.input/output`), `:172-182` (`L6_ROW_DRAFTER_CONTRACT` 예시·규칙)
- Modify: `backend/app/framework_interview/normalize.py:174-215` (`normalize_row` — input/output → list[str])
- Modify: `backend/app/framework_interview/existing.py:137-141` (`map_to_row` — 개행 문자열 → list)
- Modify: `frontend/src/lib/interview-json-prompt.ts:30-31` (예시 `input: []`), `docs/samples/interview-json-0.5.md`(input/output 배열 표기 한 줄)
- Test: `backend/tests/test_framework_interview_normalize.py`, `backend/tests/test_framework_interview_existing.py`, `backend/tests/test_framework_interview_assemble.py`, `frontend/src/lib/interview-json-prompt.test.ts`

**Interfaces:**
- `RowAction.input: list[str] | str | None`, `output` 동일. 정규화 후 row JSON은 **항상 `list[str]`**(빈 값이면 키 생략). 문자열이면 `,`·`/`·`·`·개행으로 분해·trim·빈 값 제거·중복 제거(순서 유지).
- 어댑터 `_join_multi`는 이미 list→개행이라 무변경. `link_matching_io`(임포터)가 같은 줄 텍스트를 링크하므로 프롬프트에 "앞 활동의 output 항목을 다음 활동 input에 같은 표기로 다시 쓴다" 규칙만 더한다.
- 역변환 `map_to_row`는 노드 `input`/`output`(개행 문자열)을 `list[str]`로 돌려준다 — 왕복 테스트 갱신.

- [ ] **Step 1: 실패하는 테스트**

```python
# tests/test_framework_interview_normalize.py
def test_normalize_row_splits_io_into_lists() -> None:
    raw = {"l6": "x", "actions": [
        {"seq": 1, "label": "A", "input": "요청서, 첨부 / 요청서", "output": ["확인 메모", " "]},
        {"seq": 2, "label": "B", "input": ["확인 메모"], "output": ""},
    ]}
    out = normalize_row(raw)
    assert out["actions"][0]["input"] == ["요청서", "첨부"]
    assert out["actions"][0]["output"] == ["확인 메모"]
    assert out["actions"][1]["input"] == ["확인 메모"]
    assert "output" not in out["actions"][1]
```

```python
# tests/test_framework_interview_existing.py 의 test_map_to_row_pure_shape 옆에 추가
def test_map_to_row_returns_io_as_lists() -> None:
    # 기존 pure-shape 테스트가 만드는 노드 팩토리를 재사용해 input="요청서\n첨부", output="접수증"인 process 노드 1개
    ...
    row = map_to_row("맵", None, nodes, edges)
    assert row["actions"][0]["input"] == ["요청서", "첨부"]
    assert row["actions"][0]["output"] == ["접수증"]
```

```ts
// frontend/src/lib/interview-json-prompt.test.ts
it("shows input/output as arrays in the skeleton", () => {
  const text = buildInterviewJsonPromptText(undefined);
  expect(text).toMatch(/"input":\s*\[\]/);
  expect(text).toMatch(/"output":\s*\[\]/);
});
```

- [ ] **Step 2: 실패 확인** — pytest `-k "io_"` FAIL, vitest FAIL.

- [ ] **Step 3: 구현** — `normalize.py`:

```python
_IO_SPLIT = re.compile(r"[,\n/·]")

def _io_list(value: Any) -> list[str]:
    """str 또는 list → 항목 리스트(trim, 빈 값·중복 제거, 순서 유지). IO는 배열이 정본이다 (2026-09-23)."""
    items = value if isinstance(value, list) else _IO_SPLIT.split(str(value)) if value is not None else []
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        text = _text(item)
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out
```

`normalize_row` 액션 루프에서 `("name", "rule", "system")`만 문자열로, `input`/`output`은 `_io_list`로 넣고 비면 생략. `contracts.py` `RowAction.input: list[str] | str | None = None`(output 동일), 예시 JSON `"input":[],"output":[]`, 규칙 추가 `- input/output은 항목 배열입니다. 앞 활동의 output 항목을 다음 활동의 input에 같은 표기로 다시 쓰면 캔버스에서 자동으로 이어집니다.`. `existing.py map_to_row`의 `for key in ("input", "output")` 블록은 `value.split("\n")`을 trim·빈 값 제거해 list로. `interview-json-prompt.ts` 예시 두 줄 `input: [], output: []`(decision은 `[]`). 샘플 md의 actions 설명에 "input/output은 문자열 배열(한 항목 = 한 줄, 앞 활동 output과 같은 표기면 IO 연결)" 한 줄.

- [ ] **Step 4: 통과 확인** — pytest 위 3파일 + `tests/test_consultant_interview*.py`(어댑터 list 경로) green · ruff · vitest `interview-json-prompt.test.ts` PASS · tsc.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/framework_interview/contracts.py backend/app/framework_interview/normalize.py backend/app/framework_interview/existing.py backend/tests/test_framework_interview_normalize.py backend/tests/test_framework_interview_existing.py frontend/src/lib/interview-json-prompt.ts frontend/src/lib/interview-json-prompt.test.ts docs/samples/interview-json-0.5.md PROGRESS.md
git commit -m "feat(fw-interview): input/output as arrays across the 0.5 surfaces — IO 배열 계약"
```

---

### Task 3: 러너 병렬 (B13)

**Files:**
- Modify: `backend/app/settings.py:66-67`(`ai_max_concurrency` 옆), `.env.example:100` 옆, `docker-compose.yml:68` 옆
- Modify: `backend/app/framework_interview/runner.py` (`PREFETCH_READY` 폐기, `run_one_step` → `run_jobs`)
- Modify: `frontend/src/lib/framework-interview.ts:7,71-78` (`hasBackgroundWork` 단순화)
- Test: `backend/tests/test_framework_interview_runner.py` (기존 `test_prefetch_two_questionnaires_then_idle`·`test_submitted_task_is_drawn_before_prefetch` 재작성 + 병렬 상한 테스트), `frontend/src/lib/framework-interview.test.ts`

**Interfaces:**
- Settings `fw_consult_concurrency: int = 3` (`# 캠페인 러너 세션당 동시 AI 잡 수 — 전역 상한은 ai_max_concurrency`), `.env.example` `FW_CONSULT_CONCURRENCY=3`, compose `FW_CONSULT_CONCURRENCY: ${FW_CONSULT_CONCURRENCY:-3}`.
- ```python
  def collect_jobs(tasks: list[FrameworkInterviewTask]) -> list[tuple[str, FrameworkInterviewTask]]  # [("draw", t)...] + [("generate", t)...] 순, seq 정렬
  async def run_jobs(db: AsyncSession, session_id: int) -> bool  # 잡이 하나라도 있으면 전부 gather(세마포어) 후 True, 없으면 False
  ```
  `_generate_questionnaire`/`_draw_row`는 각자 **자기 DB 세션**을 연다(동시 커밋 충돌 방지): 시그니처를 `(session_id: int, task_id: int)`로 바꾸고 안에서 `SessionLocal()`로 session/task를 다시 읽는다. 잡 시작 직전 `paused`/`LIVE_STATUSES`/`ai_enabled`를 재확인해 아니면 그 잡을 건너뛴다.
- `process_session` 루프는 `run_jobs` 결과로 계속/종료. `kick`·`_wake`·`recover_stale_tasks`·`resume_live_sessions` 불변.
- FE `hasBackgroundWork`: pending/generating/submitted/drawing 중 하나라도 있으면 true(`PREFETCH_READY` 상수 제거).

- [ ] **Step 1: 실패하는 테스트**

```python
# tests/test_framework_interview_runner.py
def test_all_pending_questionnaires_generate_in_parallel_under_cap(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(settings, "fw_consult_concurrency", 2)
    sid = _make_locked_session(client, ["A", "B", "C", "D"])
    active = {"now": 0, "peak": 0}

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        active["now"] += 1
        active["peak"] = max(active["peak"], active["now"])
        await asyncio.sleep(0.05)
        active["now"] -= 1
        return ai_client.AiReply(content=Q_JSON, prompt_tokens=1, completion_tokens=1)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    asyncio.run(_run_jobs_once(sid))
    statuses = [t["status"] for t in client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"]]
    assert statuses == ["ready"] * 4          # PREFETCH 2장 제한 없이 전부 준비
    assert active["peak"] == 2                # 세션 세마포어 상한
```

`_run_jobs_once(sid)`는 `async with SessionLocal() as db: return await runner.run_jobs(db, sid)` 헬퍼(파일 상단 `_step`과 나란히). 기존 `test_prefetch_two_questionnaires_then_idle`은 "4장 pending → 한 번의 run_jobs로 전부 ready, 두 번째 호출은 False"로, `test_submitted_task_is_drawn_before_prefetch`는 "submitted 1 + pending 1 → 같은 run_jobs에서 drawn·ready 둘 다"로 바꾼다.

```ts
// frontend/src/lib/framework-interview.test.ts 에 추가(session 헬퍼 재사용)
it("hasBackgroundWork is true while any task is pending, regardless of ready count", () => {
  expect(hasBackgroundWork(session(["ready", "ready", "pending"]))).toBe(true);
  expect(hasBackgroundWork(session(["ready", "drawn"]))).toBe(false);
});
```

- [ ] **Step 2: 실패 확인** — pytest `-k "parallel_under_cap"` FAIL(`run_jobs` 없음), vitest FAIL(ready 2장이면 false).

- [ ] **Step 3: 구현** — `runner.py` 핵심:

```python
_session_semaphores: dict[int, asyncio.Semaphore] = {}

def _semaphore_for(session_id: int) -> asyncio.Semaphore:
    sem = _session_semaphores.get(session_id)
    if sem is None:
        sem = asyncio.Semaphore(max(1, settings.fw_consult_concurrency))
        _session_semaphores[session_id] = sem
    return sem


def collect_jobs(tasks: list[FrameworkInterviewTask]) -> list[tuple[str, FrameworkInterviewTask]]:
    """드로잉(submitted) 먼저, 설문 생성(pending) 다음 — 둘 다 seq 순. ready 장수 제한은 없다(전부 미리 받는다)."""
    ordered = sorted(tasks, key=lambda t: t.seq)
    return [("draw", t) for t in ordered if t.status == "submitted"] + [("generate", t) for t in ordered if t.status == "pending"]


async def _run_job(kind: str, session_id: int, task_id: int) -> None:
    async with _semaphore_for(session_id):
        async with SessionLocal() as db:
            if not await is_ai_access_enabled(db):
                return
            session = await db.get(FrameworkInterviewSession, session_id)
            if session is None or session.paused or session.status not in LIVE_STATUSES:
                return
            task = await db.get(FrameworkInterviewTask, task_id)
            if task is None:
                return
            if kind == "draw":
                await _draw_row(db, session, task)
            else:
                await _generate_questionnaire(db, session, task)


async def run_jobs(db: AsyncSession, session_id: int) -> bool:
    """실행 가능한 잡 전부를 세마포어 안에서 병렬로. False = 할 일 없음(일시정지·비활성·AI 꺼짐·큐 비움)."""
    if not await is_ai_access_enabled(db):
        return False
    session = await db.get(FrameworkInterviewSession, session_id)
    if session is None or session.paused or session.status not in LIVE_STATUSES:
        return False
    await db.refresh(session, ["tasks"])
    jobs = collect_jobs(list(session.tasks))
    if not jobs:
        return False
    await asyncio.gather(*(_run_job(kind, session_id, task.id) for kind, task in jobs))
    return True
```

`process_session`의 `run_one_step` 호출을 `run_jobs`로. `_generate_questionnaire`/`_draw_row` 본문은 그대로(인자로 받은 db/session/task 사용). `settings` import 추가. FE `hasBackgroundWork`:

```ts
export function hasBackgroundWork(session: FwInterviewSession): boolean {
  if (session.paused) return false;
  if (session.status !== "plan_locked" && session.status !== "linking") return false;
  return session.tasks.some((t) => t.status === "pending" || t.status === "generating" || t.status === "submitted" || t.status === "drawing");
}
```

- [ ] **Step 4: 통과 확인** — `pytest tests/test_framework_interview_runner.py tests/test_framework_interview_api.py -q` green(재작성한 두 테스트 포함) · 전체 pytest · ruff · vitest `framework-interview.test.ts` · tsc.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/settings.py .env.example docker-compose.yml backend/app/framework_interview/runner.py backend/tests/test_framework_interview_runner.py frontend/src/lib/framework-interview.ts frontend/src/lib/framework-interview.test.ts PROGRESS.md
git commit -m "feat(fw-interview): run campaign jobs in parallel under a per-session cap — 러너 병렬화"
```

---

### Task 4: 세션 캔버스 컬럼 + relations↔canvas 변환 + 엔드포인트 (B4/B5 기반)

**Files:**
- Create: `backend/app/framework_interview/canvas.py`, `backend/tests/test_framework_interview_canvas.py`
- Modify: `backend/app/models.py:1057-1090` (`canvas`, `feedback_log` 컬럼), `backend/app/db.py:162` 옆(`_ADDED_COLUMNS` 2행)
- Modify: `backend/app/schemas.py:2751-2753, 2801-2820` (`FrameworkInterviewRelationsIn`에 `canvas`, `FrameworkInterviewCanvasIn`, `FrameworkInterviewRelationsGenerateIn`, `FrameworkInterviewOut.canvas/feedback_log`)
- Modify: `backend/app/routers/framework_interviews.py:75-97` (`_out`), `:522-561` (relations 두 라우트), 신설 `PUT /{session_id}/canvas`
- Modify: `backend/app/framework_interview/contracts.py:334-352` (`build_relations_messages(comment, previous)`)
- Modify: `frontend/src/lib/api.ts` (`FwCanvas` 타입, `FwInterviewSession.canvas/feedback_log`)
- Test: `backend/tests/test_framework_interview_api.py`

**Interfaces:**
- 컬럼: `canvas: Mapped[dict | None] = mapped_column(JSON, default=None)`, `feedback_log: Mapped[list | None] = mapped_column(JSON, default=None)`; `_ADDED_COLUMNS` `("framework_interview_sessions", "canvas", "JSON")`, `("framework_interview_sessions", "feedback_log", "JSON")`.
- canvas JSON:
  ```python
  {"nodes": [{"id": str, "node_type": "subprocess"|"decision"|"start"|"end", "title": str, "task_id": str|None, "pos_x": float, "pos_y": float}],
   "edges": [{"id": str, "source_node_id": str, "target_node_id": str, "label": str}]}
  ```
  subprocess 노드 id = task_id, 분기 노드 id = `__branch__{task_id}`(+연쇄면 `__branch__{task_id}__{n}`), start/end id `__start__`/`__end__`.
- `canvas.py`:
  ```python
  def expand_relations_to_canvas(relations: dict, tasks: list[tuple[str, str]]) -> dict   # tasks=[(task_id, name)] seq 순. import_consultant.expand_linkage_branches와 같은 규칙(팬아웃≥2 & 전부 parallel 아님 | 자기 반복 → 분기 노드) + consultant_layout.layout_flow LR 배치 + start/end 보강
  def collapse_canvas_to_relations(canvas: dict, known_task_ids: set[str]) -> dict       # 분기 노드 D: 들어오는 X마다 D의 나가는 (D→Y, 라벨 L) → X→Y kind=branch gateway=exclusive condition=L; subprocess→subprocess 직접 엣지 seq(대상 seq가 앞이면 loop); 분기 연쇄는 재귀 전개; start→첫 노드 = entry(triggerType manual, label ""), end 엣지 무시. 알 수 없는 task_id 엣지는 버린다.
  def validate_canvas(canvas: dict, known_task_ids: set[str]) -> list[str]                # 오류 문자열 목록: 노드 id 중복, task_id가 known 밖, subprocess 노드가 task_id 없음, 엣지 끝점 미존재
  ```
  `expand_relations_to_canvas`는 `scripts.consultant_layout`을 import(경로 `from scripts.consultant_layout import LayoutNode, layout_flow` — backend/ 루트에서 `scripts`는 이미 `scripts.consultant_interview`를 `assemble.py`가 쓰는 방식과 같게).
- 라우트:
  - `POST /{id}/relations` body `FrameworkInterviewRelationsGenerateIn { comment: str = "" }`(옵션, 없으면 빈 body 허용 — `payload: … | None = None`). 프롬프트에 `comment`가 있으면 `[직전 제안]`(현재 `row.relations` JSON) + `[사용자 피드백]` 블록. 결과 relations 저장 + `row.canvas = expand_relations_to_canvas(...)`.
  - `PUT /{id}/canvas` body `FrameworkInterviewCanvasIn { canvas: dict }` → `validate_canvas` 422 / 저장(relations 불변) → `_out`.
  - `PUT /{id}/relations` body `FrameworkInterviewRelationsIn { relations: dict | None = None; canvas: dict | None = None }` — canvas가 오면 `collapse_canvas_to_relations`로 relations를 만들고 canvas도 저장; 둘 다 없으면 422.
- `_out`에 `canvas=s.canvas, feedback_log=s.feedback_log or []`. FE `FwCanvas` 인터페이스 + `FwInterviewSession.canvas: FwCanvas | null; feedback_log: FwFeedbackEntry[]`(`{scope, task_pk, message, at}`).

- [ ] **Step 1: 실패하는 테스트**

```python
# tests/test_framework_interview_canvas.py
from app.framework_interview.canvas import collapse_canvas_to_relations, expand_relations_to_canvas, validate_canvas

TASKS = [("t1", "접수"), ("t2", "검토"), ("t3", "반려 처리"), ("t4", "완료")]

def test_expand_inserts_branch_node_for_fanout_and_lays_out_left_to_right() -> None:
    relations = {"entry": {"taskId": "t1", "triggerType": "manual", "label": ""}, "edges": [
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "t3", "kind": "branch", "gateway": "exclusive", "condition": "반려"},
        {"src": "t2", "dst": "t4", "kind": "branch", "gateway": "exclusive", "condition": "승인"},
    ]}
    canvas = expand_relations_to_canvas(relations, TASKS)
    ids = {n["id"]: n for n in canvas["nodes"]}
    assert ids["__branch__t2"]["node_type"] == "decision"
    assert {n["node_type"] for n in canvas["nodes"]} == {"start", "end", "subprocess", "decision"}
    labels = {(e["source_node_id"], e["target_node_id"]): e["label"] for e in canvas["edges"]}
    assert labels[("__branch__t2", "t3")] == "반려" and labels[("t2", "__branch__t2")] == ""
    assert ids["t1"]["pos_x"] < ids["t2"]["pos_x"] < ids["__branch__t2"]["pos_x"] < ids["t3"]["pos_x"]

def test_collapse_round_trips_expand() -> None:
    relations = {"entry": {"taskId": "t1", "triggerType": "manual", "label": ""}, "edges": [
        {"src": "t1", "dst": "t2", "kind": "seq"},
        {"src": "t2", "dst": "t3", "kind": "branch", "gateway": "exclusive", "condition": "반려"},
        {"src": "t2", "dst": "t4", "kind": "branch", "gateway": "exclusive", "condition": "승인"},
        {"src": "t3", "dst": "t2", "kind": "loop"},
    ]}
    back = collapse_canvas_to_relations(expand_relations_to_canvas(relations, TASKS), {t for t, _ in TASKS})
    assert back["entry"]["taskId"] == "t1"
    key = lambda e: (e["src"], e["dst"])
    assert sorted(back["edges"], key=key) == sorted(relations["edges"], key=key)

def test_collapse_marks_backward_direct_edges_as_loop_and_drops_unknown() -> None:
    canvas = {"nodes": [
        {"id": "__start__", "node_type": "start", "title": "Start", "task_id": None, "pos_x": 0, "pos_y": 0},
        {"id": "t1", "node_type": "subprocess", "title": "a", "task_id": "t1", "pos_x": 100, "pos_y": 0},
        {"id": "t2", "node_type": "subprocess", "title": "b", "task_id": "t2", "pos_x": 200, "pos_y": 0},
        {"id": "ghost", "node_type": "subprocess", "title": "g", "task_id": "zz", "pos_x": 300, "pos_y": 0},
    ], "edges": [
        {"id": "e0", "source_node_id": "__start__", "target_node_id": "t1", "label": ""},
        {"id": "e1", "source_node_id": "t1", "target_node_id": "t2", "label": ""},
        {"id": "e2", "source_node_id": "t2", "target_node_id": "t1", "label": ""},
        {"id": "e3", "source_node_id": "t2", "target_node_id": "ghost", "label": ""},
    ]}
    back = collapse_canvas_to_relations(canvas, {"t1", "t2"})
    kinds = {(e["src"], e["dst"]): e["kind"] for e in back["edges"]}
    assert kinds == {("t1", "t2"): "seq", ("t2", "t1"): "loop"}

def test_validate_canvas_reports_shape_errors() -> None:
    bad = {"nodes": [{"id": "t1", "node_type": "subprocess", "title": "a", "task_id": None, "pos_x": 0, "pos_y": 0},
                     {"id": "t1", "node_type": "subprocess", "title": "b", "task_id": "t9", "pos_x": 0, "pos_y": 0}],
           "edges": [{"id": "e", "source_node_id": "t1", "target_node_id": "nope", "label": ""}]}
    errors = validate_canvas(bad, {"t1"})
    assert any("duplicate" in e for e in errors) and any("unknown task" in e for e in errors) and any("edge" in e for e in errors)
```

```python
# tests/test_framework_interview_api.py — full-flow 테스트 뒤에 추가(같은 헬퍼 재사용)
def test_relations_flow_fills_canvas_and_confirms_from_canvas(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in ["A", "B"]]
    body = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS).json()
    t1, t2 = body["tasks"]
    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON, ROW_JSON,
                                 RELATIONS_TMPL % (t1["task_id"], t1["task_id"], t2["task_id"]),
                                 RELATIONS_TMPL % (t2["task_id"], t2["task_id"], t1["task_id"])])
    _step(sid); _step(sid)
    full = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "요청서", "q6": ""}
    for tid in (t1["id"], t2["id"]):
        client.post(f"/api/framework-interviews/{sid}/tasks/{tid}/answers", json={"answers": full}, headers=HEADERS)
    _step(sid); _step(sid)
    proposed = client.post(f"/api/framework-interviews/{sid}/relations", json={}, headers=HEADERS).json()
    assert proposed["canvas"] is not None and {n["id"] for n in proposed["canvas"]["nodes"]} >= {t1["task_id"], t2["task_id"], "__start__", "__end__"}
    # 코멘트로 다시 제안 — 프롬프트에 피드백 블록이 들어간다(가짜 큐는 두 번째 relations를 준다)
    again = client.post(f"/api/framework-interviews/{sid}/relations", json={"comment": "B가 먼저"}, headers=HEADERS).json()
    assert again["relations"]["entry"]["taskId"] == t2["task_id"]
    # 캔버스 편집 저장 → 확정은 캔버스로
    canvas = again["canvas"]
    canvas["edges"] = [e for e in canvas["edges"] if e["target_node_id"] != "__end__"] + [{"id": "x", "source_node_id": t1["task_id"], "target_node_id": "__end__", "label": ""}]
    saved = client.put(f"/api/framework-interviews/{sid}/canvas", json={"canvas": canvas}, headers=HEADERS)
    assert saved.status_code == 200
    bad = client.put(f"/api/framework-interviews/{sid}/canvas", json={"canvas": {"nodes": [], "edges": [{"id": "e", "source_node_id": "a", "target_node_id": "b", "label": ""}]}}, headers=HEADERS)
    assert bad.status_code == 422
    confirmed = client.put(f"/api/framework-interviews/{sid}/relations", json={"canvas": canvas}, headers=HEADERS).json()
    assert confirmed["status"] == "ready"
    assert {(e["src"], e["dst"]) for e in confirmed["relations"]["edges"]} == {(t2["task_id"], t1["task_id"])}
```

- [ ] **Step 2: 실패 확인** — `pytest tests/test_framework_interview_canvas.py tests/test_framework_interview_api.py -q -k "canvas"` FAIL.

- [ ] **Step 3: 구현** — `canvas.py`(핵심 골격; 배치는 `layout_flow`에 `LayoutNode(id, node_type)`를 넘기고 `back_pairs`에 loop/자기반복 쌍, `labeled`에 (src,dst,label)):

```python
"""세션 연결 캔버스 — relations(엣지 목록) ↔ canvas(노드+엣지 그래프) 변환의 단일 진실 (spec 2026-09-23 §4.2).

expand: import_consultant.expand_linkage_branches와 같은 분기 규칙(팬아웃≥2이고 전부 parallel이 아니면, 또는 자기 반복이면
분기 노드를 세운다) + consultant_layout LR 배치 + start/end 보강. collapse: 분기 노드를 접어 branch 엣지로 되돌린다.
분기 노드 이름은 손실 허용(등록 시 다시 만든다).
"""
START_ID = "__start__"
END_ID = "__end__"
BRANCH_PREFIX = "__branch__"
```

`expand_relations_to_canvas(relations, tasks)`: (1) `known = [t for t,_ in tasks]`, 엣지를 known 안으로 필터. (2) src별 그룹 → `forks = has_self or (len>=2 and not all_parallel)` → 분기 노드 `BRANCH_PREFIX+src` 삽입, 그룹 엣지를 분기 노드에서 나가게, 라벨 = `condition or label or ""`. (3) start→entry(없으면 첫 task), 나가는 엣지 없는 노드 → end(loop 대상 제외 규칙은 buildL5PreviewGraph와 동일: 들어오는 엣지가 loop뿐인 노드도 start 연결). (4) `layout_flow` 후 좌표 기록. 노드 순서: start, tasks(seq 순, 분기 노드는 anchor 뒤), end.

`collapse_canvas_to_relations(canvas, known)`: 노드 맵, `incoming/outgoing` 인덱스. entry = start의 첫 타깃(subprocess)이 없으면 known 중 첫 노드. subprocess X의 나가는 엣지 Y가 (a) subprocess → `seq`(Y의 seq가 X보다 앞이면 `loop`; seq는 known 순서 인덱스), (b) decision D → D의 나가는 엣지 Z마다(Z가 decision이면 재귀) `{"src": X, "dst": Z, "kind": "branch", "gateway": "exclusive", "condition": label}`(Z==X면 kind loop), (c) end → 무시. 미지 task_id/노드 제외.

라우터: `generate_relations`에 `payload: FrameworkInterviewRelationsGenerateIn | None = None`; `comment = (payload.comment if payload else "").strip()`; `build_relations_messages(..., comment=comment, previous=row.relations if comment else None)`; 저장 후 `row.canvas = expand_relations_to_canvas(row.relations, [(t.task_id, t.name) for t in sorted(row.tasks, key=seq)])`. `contracts.build_relations_messages`에 `comment: str = "", previous: dict | None = None` 추가 — user 메시지 끝에 `\n\n[직전 제안]\n{json.dumps(previous, ensure_ascii=False)}\n\n[사용자 피드백]\n{comment}` (comment 있을 때만). `confirm_relations`는 canvas 우선. `PUT /canvas` 신설.

- [ ] **Step 4: 통과 확인** — 두 테스트 파일 + 전체 pytest green · ruff · tsc(api.ts 타입).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/framework_interview/canvas.py backend/tests/test_framework_interview_canvas.py backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/framework_interviews.py backend/app/framework_interview/contracts.py backend/tests/test_framework_interview_api.py frontend/src/lib/api.ts PROGRESS.md
git commit -m "feat(fw-interview): session canvas column with relations round-trip and comment-driven re-proposal — 세션 캔버스·relations 왕복·코멘트 재제안"
```

---

### Task 5: 피드백 엔드포인트 (B4/B5/B9 기반)

**Files:**
- Modify: `backend/app/framework_interview/contracts.py` (`CANVAS_FEEDBACK_CONTRACT`, `ROW_FEEDBACK_CONTRACT`, `CanvasOut` 모델, `build_canvas_feedback_messages`, `build_row_feedback_messages`)
- Modify: `backend/app/prompt_registry.py:20-50` (키 2개 등록)
- Modify: `backend/app/schemas.py` (`FrameworkInterviewFeedbackIn`), `backend/app/routers/framework_interviews.py` (`POST /{id}/feedback`)
- Modify: `backend/app/framework_interview/normalize.py` (`normalize_canvas`)
- Modify: `frontend/src/lib/api.ts` (`sendFrameworkFeedback`)
- Test: `backend/tests/test_framework_interview_api.py`, `backend/tests/test_framework_interview_contracts.py`

**Interfaces:**
- `POST /framework-interviews/{id}/feedback` body `{scope: "relations"|"task", task_pk?: int, message: str(1..2000)}`.
  - relations: 상태 `linking` 필수. AI 입력 = 현재 canvas + 카드 목록(task_id·이름) + message → `CanvasOut`(canvas와 같은 형태, 노드 id·task_id 보존 규칙) → `normalize_canvas`(미지 노드/엣지 제거, subprocess 노드 누락 시 원 canvas에서 보충) → `validate_canvas` → `row.canvas` 저장 → relations는 건드리지 않음(확정 시 역산).
  - task: 카드 `drawn` 필수. AI 입력 = 현재 row + message → `RowOut`(normalize_row) → `validate_row` → `task.row/issues` 갱신, `drawn_at` 갱신; 오류 이슈면 422 detail에 이슈. 세션이 `ready`였다면 `linking`으로 되돌린다(등록 문서 재조립 필요).
  - 둘 다 `row.feedback_log`에 `{"scope","task_pk","message","at": now_kst().isoformat()}` append(최근 10건 유지) 후 `_out`.
- 계약 문구: `CANVAS_FEEDBACK_CONTRACT` = "당신은 업무 프로세스 컨설턴트입니다. 아래 L5 연계 캔버스(노드·엣지)를 사용자 피드백대로 고치세요. 규칙: 노드 id와 task_id는 바꾸지 말 것, 새 분기 노드 id는 `__branch__` 접두, start/end는 유지, 좌표는 0으로 두어도 됨(서버가 다시 배치), 다른 설명 없이 같은 형식의 JSON 한 개만." `ROW_FEEDBACK_CONTRACT` = "…아래 rows[] 원소를 사용자 피드백대로 고치세요. 키 집합·seq 규칙은 유지, 다른 설명 없이 JSON 한 개만." 예시 JSON 포함. 레지스트리 키 `l5_canvas_feedback_contract`, `l6_row_feedback_contract`.
- FE: `sendFrameworkFeedback(id, body: { scope: "relations" | "task"; task_pk?: number; message: string }): Promise<FwInterviewSession>`.

- [ ] **Step 1: 실패하는 테스트** — `test_framework_interview_api.py`의 Task 4 테스트 뒤:

```python
CANVAS_FEEDBACK_TMPL = '{"nodes":[{"id":"__start__","node_type":"start","title":"Start","task_id":null,"pos_x":0,"pos_y":0},' \
    '{"id":"%s","node_type":"subprocess","title":"A","task_id":"%s","pos_x":0,"pos_y":0},{"id":"%s","node_type":"subprocess","title":"B","task_id":"%s","pos_x":0,"pos_y":0},' \
    '{"id":"__end__","node_type":"end","title":"End","task_id":null,"pos_x":0,"pos_y":0}],' \
    '"edges":[{"id":"e0","source_node_id":"__start__","target_node_id":"%s","label":""},{"id":"e1","source_node_id":"%s","target_node_id":"%s","label":""},{"id":"e2","source_node_id":"%s","target_node_id":"__end__","label":""}]}'

def test_feedback_relations_rewrites_canvas_and_task_redraws_row(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in ["A", "B"]]
    t1, t2 = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS).json()["tasks"]
    a, b = t1["task_id"], t2["task_id"]
    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON, ROW_JSON, RELATIONS_TMPL % (a, a, b),
                                 CANVAS_FEEDBACK_TMPL % (b, b, a, a, b, b, a, a),   # B → A 로 뒤집은 캔버스
                                 ROW_JSON.replace("요청 접수", "요청 접수(수정)")])
    _step(sid); _step(sid)
    full = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "요청서", "q6": ""}
    for tid in (t1["id"], t2["id"]):
        client.post(f"/api/framework-interviews/{sid}/tasks/{tid}/answers", json={"answers": full}, headers=HEADERS)
    _step(sid); _step(sid)
    client.post(f"/api/framework-interviews/{sid}/relations", json={}, headers=HEADERS)

    fb = client.post(f"/api/framework-interviews/{sid}/feedback", json={"scope": "relations", "message": "B를 먼저"}, headers=HEADERS)
    assert fb.status_code == 200, fb.text
    edges = {(e["source_node_id"], e["target_node_id"]) for e in fb.json()["canvas"]["edges"]}
    assert (b, a) in edges and ("__start__", b) in edges
    assert fb.json()["feedback_log"][-1]["scope"] == "relations"

    fb2 = client.post(f"/api/framework-interviews/{sid}/feedback", json={"scope": "task", "task_pk": t1["id"], "message": "이름 고쳐"}, headers=HEADERS)
    assert fb2.status_code == 200, fb2.text
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{t1['id']}", headers=HEADERS).json()
    assert detail["row"]["l6"] == "요청 접수(수정)" and detail["status"] == "drawn"
    assert len(fb2.json()["feedback_log"]) == 2

    bad = client.post(f"/api/framework-interviews/{sid}/feedback", json={"scope": "task", "message": "x"}, headers=HEADERS)
    assert bad.status_code == 422
```

- [ ] **Step 2: 실패 확인** — `-k feedback` FAIL(404).

- [ ] **Step 3: 구현** — `contracts.py`에 `CanvasNodeOut`/`CanvasEdgeOut`/`CanvasOut`(canvas JSON과 같은 필드, `pos_x/pos_y: float = 0`), 두 계약 문자열, 메시지 빌더:

```python
def build_canvas_feedback_messages(*, lang, canvas: dict, tasks: list[tuple[str, str]], message: str, overrides=None) -> list[dict]:
    contract = (overrides or {}).get("l5_canvas_feedback_contract") or CANVAS_FEEDBACK_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}"
    task_lines = "\n".join(f"- {tid}: {name}" for tid, name in tasks)
    user = f"[L6 카드]\n{task_lines}\n\n[현재 캔버스]\n{json.dumps(canvas, ensure_ascii=False)}\n\n[사용자 피드백]\n{message}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]

def build_row_feedback_messages(*, lang, row: dict, message: str, overrides=None) -> list[dict]: ...  # [현재 행] + [사용자 피드백]
```

`normalize.py normalize_canvas(raw, base: dict, known: set[str])`: 노드는 base의 subprocess/start/end를 보장(모델이 빠뜨리면 base에서 채움), decision 노드는 id가 `__branch__` 접두일 때만, 엣지는 양 끝 존재하는 것만, 좌표는 base 값 우선. 라우터 `feedback_session`:

```python
@router.post("/{session_id}/feedback", response_model=FrameworkInterviewOut)
async def feedback_session(session_id: int, payload: FrameworkInterviewFeedbackIn, user=Depends(require_sysadmin), db=Depends(get_session)):
    await _require_ai_enabled(db)
    row = await _get_session_row(db, session_id)
    tasks = sorted(row.tasks, key=lambda t: t.seq)
    if payload.scope == "relations":
        if row.status != "linking" or not row.canvas:
            raise HTTPException(status_code=409, detail="relations feedback needs a proposed canvas")
        known = {t.task_id for t in tasks}
        messages = build_canvas_feedback_messages(lang=row.lang, canvas=row.canvas, tasks=[(t.task_id, t.name) for t in tasks], message=payload.message, overrides=await get_prompt_overrides(db))
        base = row.canvas
        out = await _ask(messages, CanvasOut, db, user, normalizer=lambda raw: normalize_canvas(raw, base, known))
        canvas = out.model_dump()
        errors = validate_canvas(canvas, known)
        if errors:
            raise HTTPException(status_code=422, detail=errors)
        row.canvas = expand_layout(canvas)  # 좌표 재배치: canvas.py relayout_canvas(canvas) — layout_flow만 다시
    else:
        if payload.task_pk is None:
            raise HTTPException(status_code=422, detail="task_pk required")
        task = await _get_task(db, row, payload.task_pk)
        if task.status != "drawn" or not task.row:
            raise HTTPException(status_code=409, detail="only drawn tasks take feedback")
        messages = build_row_feedback_messages(lang=row.lang, row=task.row, message=payload.message, overrides=await get_prompt_overrides(db))
        out = await _ask(messages, RowOut, db, user, normalizer=normalize_row)
        new_row = out.model_dump(by_alias=True, exclude_none=True)
        new_row.pop("owner", None)
        chain = await load_category_chain(db, row.category_id)
        l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
        issues = validate_row(chain, l5, {"taskId": task.task_id, **new_row})
        if any(i["severity"] == "error" for i in issues):
            raise HTTPException(status_code=422, detail=[i["message"] for i in issues if i["severity"] == "error"])
        task.row, task.issues, task.drawn_at = new_row, issues, now_kst()
        if row.status == "ready":
            row.status = "linking"
            row.assembled = None
    log = list(row.feedback_log or [])
    log.append({"scope": payload.scope, "task_pk": payload.task_pk, "message": payload.message, "at": now_kst().isoformat()})
    row.feedback_log = log[-10:]
    await db.commit()
    return await _out(db, row)
```

`canvas.py`에 `relayout_canvas(canvas) -> dict`(기존 노드·엣지로 `layout_flow`만 다시 돌려 좌표 갱신) 추가. `prompt_registry.py` 키·기본값 등록(기존 두 키와 같은 자리). FE `sendFrameworkFeedback`.

- [ ] **Step 4: 통과 확인** — 전체 pytest green · ruff · tsc.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/framework_interview/contracts.py backend/app/framework_interview/normalize.py backend/app/framework_interview/canvas.py backend/app/prompt_registry.py backend/app/schemas.py backend/app/routers/framework_interviews.py backend/tests/test_framework_interview_api.py backend/tests/test_framework_interview_contracts.py frontend/src/lib/api.ts PROGRESS.md
git commit -m "feat(fw-interview): natural-language feedback endpoint for the canvas and drawn rows — 자연어 피드백 엔드포인트"
```

---

### Task 6: 가짜 AI 라우팅 확장 + 백엔드 스프린트 마감

**Files:**
- Modify: `frontend/scripts/fake-ai-server.mjs` (`route`에 피드백 두 계약 마커 추가)
- Modify: `CLAUDE.md` Lessons(인터뷰 JSON 항목에 "input/output은 배열" 한 줄), `docs/manual/`은 ④b에서

**Interfaces:**
- 마커: system에 `"연계 캔버스(노드·엣지)를 사용자 피드백대로"` → `[현재 캔버스]` JSON을 파싱해 엣지 방향을 뒤집어(첫 subprocess 엣지 src/dst 교환) 반환; `"rows[] 원소를 사용자 피드백대로"` → `[현재 행]` JSON의 `l6`에 `(수정)` 접미. 기존 설문 라우팅에 `section` 필드(q1 activities, q2·q3 basic, q4 exceptions, q5·q6 io) 추가, 행 라우팅의 input/output을 배열로.

- [ ] **Step 1: 라우팅 추가·설문/행 캔드 JSON 갱신** — 위 규칙대로 `fake-ai-server.mjs` 수정.
- [ ] **Step 2: 스모크 회귀** — 가짜 AI + backend(+`FW_CONSULT_CONCURRENCY` 기본) + frontend 기동 후 `pw-fw-consult.mjs`·`pw-fw-consult-existing.mjs`·`pw-fw-consult-ux.mjs` green(연결 단계 UI는 아직 표 그대로 — ④b가 바꾼다).
- [ ] **Step 3: 전체 게이트 + 커밋 + 푸시**

```bash
git add frontend/scripts/fake-ai-server.mjs CLAUDE.md PROGRESS.md
git commit -m "test(fw-consult): fake AI routes for feedback contracts — 가짜 AI 피드백 라우팅"
git push origin dev
```
