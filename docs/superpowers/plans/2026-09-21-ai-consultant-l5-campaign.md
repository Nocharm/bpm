# AI Consultant L5 Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a sysadmin pick an existing L5 category, build L6 maps one by one through AI-generated multiple-choice questionnaires, and register the whole L5 through the existing interview-JSON import.

**Architecture:** A new "upper layer" (`framework_interview_sessions` + `_tasks`) plans L6 cards, generates one questionnaire per L6, draws each submitted L6 in a background runner (pipelined: draw the submitted card, prefetch the next questionnaire), assembles an interview JSON 0.5 document, and hands it to the existing `POST /api/categories/import-interview` (dry-run then apply). The frontend is a full-screen page with a task board on the left and the current step on the right, plus two buttons in the admin Framework panel (start session, copy external-AI prompt).

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2 (backend, Python 3.11 syntax only), Next.js + React + Tailwind tokens + @xyflow/react (frontend), pytest with monkeypatched `ai_client.call_ai`, vitest (jsdom, `src/**/*.test.ts` only), Playwright + system Chrome for smoke.

**Spec:** `docs/superpowers/specs/2026-09-21-ai-consultant-l5-campaign-design.md`

## Global Constraints

- Backend syntax must run on **Python 3.11** (no PEP 695 generics, no `type X = ...`). `ruff check app/ tests/` must be green (`backend/ruff.toml` target py311).
- Frontend must build on **node 20**. `npx tsc --noEmit -p tsconfig.json`, `npm run lint`, `npx vitest run` must be green before every commit.
- Line endings LF. Commit message format `type(scope): English summary — 한국어 요약` and end with the attribution lines given in the session. Update `PROGRESS.md` (1–3 lines) in the same commit as code.
- UI copy in English by default, Korean allowed in comments and dynamic data. **No em-dash (—) in UI strings, prompts, or manuals** (user rule 2026-09-21). Use `.`, `,`, `·`, or parentheses.
- Colors only via tokens (`bg-surface`, `text-ink`, `text-accent`, `bg-accent-tint`, `border-hairline`, `text-error`, `bg-surface-alt`, `bg-surface-pearl`, `text-ink-secondary`, `text-ink-tertiary`, `text-on-accent`, `hover:bg-accent-focus`). Icons: Lucide, `size={14|16} strokeWidth={1.5}`. Buttons get only hover background classes (cursor and press are global).
- Every interactive element gets a `data-id="surface-role"`; list items append the key (`fw-consult-task-${task.id}`).
- Function names start with a verb. Python `snake_case`, TS `camelCase`. Module docstring / one-line header comment on every new file (the component catalog reads the first comment sentence).
- New components under `frontend/src/components/**` require `cd frontend && node scripts/build-component-catalog.mjs` in the same commit.
- Vitest only picks up `src/**/*.test.ts`; put testable logic in `frontend/src/lib/*.ts`.
- Dependencies: `app.db.get_session` (not `get_db`), `app.auth.get_current_user` / `require_sysadmin`, `app.app_settings.is_ai_access_enabled`. AI calls go through `app.ai_client.call_ai` only.
- `AiUsageEvent.map_id`/`version_id` are non-nullable: this feature writes `0` for both and `kind="fw_interview"` (String(20)).
- Import contract coupling: three surfaces move together when the interview JSON 0.5 contract changes: adapter `backend/scripts/consultant_interview.py`, assembler `backend/app/framework_interview/assemble.py` (+ prompts), external prompt `frontend/src/lib/interview-json-prompt.ts` (+ `docs/samples/interview-json-0.5.md`). Task 14 records this in CLAUDE.md.
- Tests that need sysadmin use header `X-Dev-User` plus `monkeypatch.setattr(settings, "bpm_sysadmins", "fw.admin")` and `monkeypatch.setattr(settings, "ai_enabled", True)`.

## File Structure

**Backend (create)**
- `backend/app/framework_interview/__init__.py` — package marker (one-line docstring).
- `backend/app/framework_interview/contracts.py` — the 4 prompt contracts (module constants), Pydantic response models (`PlanOut`, `QuestionnaireOut`, `RowOut`, `RelationsOut`), and message builders (`build_plan_messages`, `build_questionnaire_messages`, `build_row_messages`, `build_relations_messages`).
- `backend/app/framework_interview/answers.py` — pure answer validation and suggested-fill (`fill_answers`).
- `backend/app/framework_interview/assemble.py` — task-id allocation, category chain, row document validation via the adapter, and `assemble_document`.
- `backend/app/framework_interview/runner.py` — background step runner (`run_one_step`, `kick`, `recover_stale_tasks`) using the `kb.indexing.spawn` pattern.
- `backend/app/routers/framework_interviews.py` — HTTP endpoints (sysadmin + AI gate).
- `backend/tests/test_framework_interview_answers.py`, `test_framework_interview_contracts.py`, `test_framework_interview_assemble.py`, `test_framework_interview_api.py`, `test_framework_interview_runner.py`.

**Backend (modify)**
- `backend/app/models.py` — `FrameworkInterviewSession`, `FrameworkInterviewTask`.
- `backend/app/schemas.py` — `FrameworkInterview*In/Out`.
- `backend/app/prompt_registry.py` — 4 new keys + defaults.
- `backend/app/main.py` — include router; startup recovery.
- `backend/tests/test_ai_prompts.py:19` — key count 9 → 13.

**Frontend (create)**
- `frontend/src/lib/framework-interview.ts` — types re-exports, `validateAnswers`, `fillSuggested`, `deriveProgress`, `findCurrentTask`, `hasBackgroundWork`.
- `frontend/src/lib/framework-interview.test.ts`
- `frontend/src/lib/interview-json-prompt.ts` — `buildInterviewJsonPromptText`.
- `frontend/src/lib/interview-json-prompt.test.ts`
- `frontend/src/components/framework-interview/task-board.tsx`, `plan-editor.tsx`, `questionnaire-form.tsx`, `answer-review.tsx`, `relations-step.tsx`, `register-step.tsx`, `interview-json-prompt-button.tsx`.
- `frontend/src/app/framework/consult/[sessionId]/page.tsx`
- `frontend/scripts/pw-fw-consult.mjs`

**Frontend (modify)**
- `frontend/src/lib/api.ts` — types + API functions.
- `frontend/src/lib/i18n-messages.ts` — `fwConsult.*` keys (en + ko).
- `frontend/src/components/admin/framework-panel.tsx` — two buttons + active session list.
- `frontend/COMPONENTS.md` — regenerated.

**Docs**
- `docs/manual/admin-manual-ko.md`, `docs/manual/admin-manual-en.md` — new section.
- `CLAUDE.md` — one line in the Lessons dual-implementation list.
- `PROGRESS.md` — per commit.

---

## Task 1: Models, schemas, prompt keys

**Files:**
- Modify: `backend/app/models.py` (append after `InterviewAttachment`, ~line 1050)
- Modify: `backend/app/schemas.py` (append at end)
- Modify: `backend/app/prompt_registry.py:9-38`
- Modify: `backend/tests/test_ai_prompts.py:19`
- Create: `backend/app/framework_interview/__init__.py`
- Test: `backend/tests/test_framework_interview_api.py` (first test only)

**Interfaces:**
- Produces ORM classes `FrameworkInterviewSession`, `FrameworkInterviewTask`; Pydantic `FrameworkInterviewCreateIn`, `FrameworkInterviewPlanIn`, `FrameworkInterviewAnswersIn`, `FrameworkInterviewRelationsIn`, `FrameworkInterviewTaskOut`, `FrameworkInterviewTaskDetailOut`, `FrameworkInterviewOut`; prompt keys `l5_plan_contract`, `l6_questionnaire_contract`, `l6_row_drafter_contract`, `l5_relations_contract`.

- [ ] **Step 1: Write the failing test (tables exist after lifespan)**

Create `backend/tests/test_framework_interview_api.py`:

```python
"""Framework interview session API — sysadmin AI campaign over one L5 (spec 2026-09-21)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import FrameworkInterviewSession
from app.settings import settings

SYSADMIN = "fw.admin"
HEADERS = {"X-Dev-User": SYSADMIN}


def _enable(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)


def test_tables_exist(client: TestClient) -> None:
    async def _count() -> int:
        async with SessionLocal() as db:
            rows = (await db.scalars(select(FrameworkInterviewSession))).all()
            return len(rows)

    assert asyncio.run(_count()) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py -q`
Expected: FAIL with `ImportError: cannot import name 'FrameworkInterviewSession'`

- [ ] **Step 3: Add the ORM models**

Append to `backend/app/models.py` (after `InterviewAttachment`):

```python
class FrameworkInterviewSession(Base):
    """AI L5 캠페인 세션 — L5 하나 아래 L6 n개를 설문·드로잉·조립하는 위층 (spec 2026-09-21 §3)."""

    __tablename__ = "framework_interview_sessions"
    __table_args__ = (Index("ix_fw_interview_sessions_category", "category_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    category_id: Mapped[int] = mapped_column(
        ForeignKey("process_categories.id", ondelete="CASCADE")
    )
    # planning|plan_locked|linking|ready|applied|abandoned — 설문 진행 상태는 tasks에서 파생
    status: Mapped[str] = mapped_column(String(20), default="planning")
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    lang: Mapped[str] = mapped_column(String(5), default="ko")
    brief: Mapped[str] = mapped_column(Text, default="")  # 목적/범위 + 첨부 파싱 텍스트
    plan: Mapped[list | None] = mapped_column(JSON, default=None)  # 잠금 전/후 L6 카드 목록
    relations: Mapped[dict | None] = mapped_column(JSON, default=None)  # 최상위 relations
    assembled: Mapped[dict | None] = mapped_column(JSON, default=None)  # 마지막 조립 0.5 문서
    label: Mapped[str] = mapped_column(String(100), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    tasks: Mapped[list["FrameworkInterviewTask"]] = relationship(
        cascade="all, delete-orphan", order_by="FrameworkInterviewTask.seq"
    )


class FrameworkInterviewTask(Base):
    """캠페인의 L6 1건 — 설문지·답·드로잉 결과(rows[] 원소)를 들고 상태 기계를 돈다."""

    __tablename__ = "framework_interview_tasks"
    __table_args__ = (
        UniqueConstraint("session_id", "task_id", name="uq_fw_interview_tasks_session_task"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("framework_interview_sessions.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[str] = mapped_column(String(200))  # rows[].taskId = consultant_code
    seq: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    # pending|generating|ready|submitted|drawing|drawn|failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    questionnaire: Mapped[dict | None] = mapped_column(JSON, default=None)
    answers: Mapped[dict | None] = mapped_column(JSON, default=None)
    row: Mapped[dict | None] = mapped_column(JSON, default=None)
    issues: Mapped[list] = mapped_column(JSON, default=list)  # AdapterIssue dicts
    error: Mapped[str | None] = mapped_column(Text, default=None)
    drawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

Create `backend/app/framework_interview/__init__.py`:

```python
"""AI L5 캠페인 — 계획·설문·드로잉·조립 (spec docs/superpowers/specs/2026-09-21-ai-consultant-l5-campaign-design.md)."""
```

- [ ] **Step 4: Add the schemas**

Append to `backend/app/schemas.py`:

```python
# ── Framework interview (AI L5 campaign, spec 2026-09-21) ──


class FrameworkInterviewCreateIn(BaseModel):
    category_id: int
    brief: str = ""
    lang: Literal["ko", "en"] = "ko"


class FrameworkPlanCardIn(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    summary: str = ""
    owner_role: Annotated[str, StringConstraints(max_length=100)] = ""
    department: Annotated[str, StringConstraints(max_length=100)] = ""
    depends_on: list[str] = []  # 선행 카드 이름


class FrameworkInterviewPlanIn(BaseModel):
    cards: list[FrameworkPlanCardIn] = []
    lock: bool = False


class FrameworkInterviewAnswersIn(BaseModel):
    answers: dict[str, Any]


class FrameworkInterviewRelationsIn(BaseModel):
    relations: dict[str, Any]


class FrameworkInterviewTaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: str
    seq: int
    name: str
    status: str
    issues: list[InterviewIssueOut] = []
    error: str | None = None
    drawn_at: datetime | None = None


class FrameworkInterviewTaskDetailOut(FrameworkInterviewTaskOut):
    questionnaire: dict | None = None
    answers: dict | None = None
    row: dict | None = None


class FrameworkInterviewProgressOut(BaseModel):
    total: int
    drawn: int
    failed: int
    working: bool  # generating/drawing 중인 task가 있다


class FrameworkInterviewOut(BaseModel):
    id: int
    category_id: int
    category_code: str
    category_name: str
    status: str
    paused: bool
    lang: str
    brief: str
    plan: list | None
    relations: dict | None
    label: str
    tasks: list[FrameworkInterviewTaskOut]
    progress: FrameworkInterviewProgressOut
    created_at: datetime
    updated_at: datetime
```

Check that `Any`, `Literal`, `Annotated`, `StringConstraints`, `ConfigDict` are already imported at the top of `schemas.py` (they are used by `InterviewImportIn`); add to the import line only if missing.

- [ ] **Step 5: Register the prompt keys**

In `backend/app/prompt_registry.py`, extend `PROMPT_KEYS`:

```python
PROMPT_KEYS: tuple[str, ...] = (
    "ai_chat_instructions",
    "interviewer_contract",
    "drafter_contract",
    "interviewer_word_addendum",
    "drafter_word_addendum",
    "extract_contract",
    "anti_repeat_nudge",
    "compare_summary_contract",
    "submit_note_contract",
    # AI L5 캠페인 4종 (spec 2026-09-21 §5)
    "l5_plan_contract",
    "l6_questionnaire_contract",
    "l6_row_drafter_contract",
    "l5_relations_contract",
)
```

In `get_prompt_defaults()` add the lazy import and four entries (the constants are created in Task 3; until then this import fails, so do Task 3 before running the prompt tests, or temporarily commit Task 1 and 3 together):

```python
    from app.framework_interview import contracts as fw_contracts
    ...
        "l5_plan_contract": fw_contracts.L5_PLAN_CONTRACT,
        "l6_questionnaire_contract": fw_contracts.L6_QUESTIONNAIRE_CONTRACT,
        "l6_row_drafter_contract": fw_contracts.L6_ROW_DRAFTER_CONTRACT,
        "l5_relations_contract": fw_contracts.L5_RELATIONS_CONTRACT,
```

Update `backend/tests/test_ai_prompts.py:19` to `assert len(PROMPT_KEYS) == 13`. Fix the stale docstring in `get_prompt_overrides` ("≤8행" → "≤13행").

- [ ] **Step 6: Run the tests**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py tests/test_ai_prompts.py -q`
Expected: `test_tables_exist` PASS; `test_ai_prompts` fails on the missing `contracts` module until Task 3 lands (run Task 3 next before committing if you want a green commit; otherwise commit Tasks 1+3 together).

- [ ] **Step 7: Ruff, then commit together with Task 3 (see Task 3 Step 6)**

Run: `cd backend && .venv/bin/ruff check app/ tests/`

---

## Task 2: Answer validation and suggested fill (pure)

**Files:**
- Create: `backend/app/framework_interview/answers.py`
- Test: `backend/tests/test_framework_interview_answers.py`

**Interfaces:**
- Produces `fill_answers(questionnaire: dict, answers: dict) -> tuple[dict, list[str]]` returning `(filled, missing_ids)`. `filled[qid] = {"value": ..., "auto": bool}`. `missing_ids` non-empty means reject with 422.

- [ ] **Step 1: Write the failing tests**

```python
"""fill_answers — 전 문항 필수, 빈 주관식은 제안값 자동 적용 (spec 2026-09-21 §4)."""

from app.framework_interview.answers import fill_answers

Q = {
    "questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동",
         "options": [{"id": "a", "label": "접수"}, {"id": "b", "label": "검토"}], "suggested": ["a", "b"]},
        {"id": "q2", "kind": "single", "maps_to": "roles", "text": "역할",
         "options": [{"id": "r1", "label": "담당자"}, {"id": "r2", "label": "관리자"}], "suggested": ["r1"]},
        {"id": "q3", "kind": "text", "maps_to": "conditions", "text": "시작 조건", "options": [],
         "suggested": "요청서 접수"},
    ]
}


def test_blank_text_is_filled_from_suggested_and_marked_auto() -> None:
    filled, missing = fill_answers(Q, {"q1": ["b", "a"], "q2": "r2", "q3": ""})
    assert missing == []
    assert filled["q3"] == {"value": "요청서 접수", "auto": True}
    assert filled["q1"] == {"value": ["b", "a"], "auto": False}


def test_missing_choice_is_reported() -> None:
    filled, missing = fill_answers(Q, {"q1": ["a", "b"], "q3": "x"})
    assert missing == ["q2"]


def test_unknown_option_counts_as_missing() -> None:
    _, missing = fill_answers(Q, {"q1": ["zzz"], "q2": "r1", "q3": "x"})
    assert missing == ["q1"]


def test_single_rejects_list_value() -> None:
    _, missing = fill_answers(Q, {"q1": ["a"], "q2": ["r1"], "q3": "x"})
    assert missing == ["q2"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_framework_interview_answers.py -q`
Expected: FAIL `ModuleNotFoundError: app.framework_interview.answers`

- [ ] **Step 3: Implement**

```python
"""설문 답 검증·보정 — 객관식은 옵션 id만, 주관식 빈칸은 제안값으로 채우고 auto 표시 (spec §4)."""

CHOICE_KINDS = {"single", "multi", "ordered"}


def _option_ids(question: dict) -> set[str]:
    return {str(o.get("id")) for o in question.get("options") or [] if isinstance(o, dict)}


def fill_answers(questionnaire: dict, answers: dict) -> tuple[dict, list[str]]:
    """(filled, missing) — filled[qid]={value, auto}. missing에 하나라도 있으면 제출 거부."""
    filled: dict = {}
    missing: list[str] = []
    for question in questionnaire.get("questions") or []:
        qid = str(question.get("id"))
        kind = question.get("kind")
        raw = answers.get(qid)
        if kind == "text":
            text = raw.strip() if isinstance(raw, str) else ""
            if text:
                filled[qid] = {"value": text, "auto": False}
            else:
                filled[qid] = {"value": str(question.get("suggested") or ""), "auto": True}
            continue
        if kind not in CHOICE_KINDS:
            continue
        allowed = _option_ids(question)
        if kind == "single":
            if isinstance(raw, str) and raw in allowed:
                filled[qid] = {"value": raw, "auto": False}
            else:
                missing.append(qid)
            continue
        if isinstance(raw, list) and raw and all(isinstance(v, str) and v in allowed for v in raw):
            filled[qid] = {"value": list(raw), "auto": False}
        else:
            missing.append(qid)
    return filled, missing
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_framework_interview_answers.py -q`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/framework_interview/answers.py backend/tests/test_framework_interview_answers.py
git commit -m "feat(fw-interview): answer validation with suggested fill — 설문 답 검증·빈 주관식 제안값 자동 적용"
```
(Add the `PROGRESS.md` line for the campaign track in this or the next commit; keep 1–3 lines per commit.)

---

## Task 3: Prompt contracts, response models, message builders

**Files:**
- Create: `backend/app/framework_interview/contracts.py`
- Test: `backend/tests/test_framework_interview_contracts.py`

**Interfaces:**
- Produces constants `L5_PLAN_CONTRACT`, `L6_QUESTIONNAIRE_CONTRACT`, `L6_ROW_DRAFTER_CONTRACT`, `L5_RELATIONS_CONTRACT`.
- Pydantic: `PlanCard(name, summary, owner_role, department, depends_on)`, `PlanOut(cards)`, `QuestionOption(id, label)`, `Question(id, kind, maps_to, text, options, suggested)`, `QuestionnaireOut(questions)`, `RowAction(seq, label, name, kind, variant, rule, input, output, system)`, `RowEdge(src, dst, kind, gateway, condition, label)`, `RowRelations(edges)`, `RowOut(l6, ownerRole, department, fields, actions, relations)`, `RelationsEntry(taskId, triggerType, label)`, `RelationsEdge(src, dst, kind, gateway, condition, label)`, `RelationsOut(entry, edges)`.
- Builders (all return `list[dict]` chat messages): `build_plan_messages(lang, category_path, brief, existing_names, role_catalog, dept_catalog, overrides)`, `build_questionnaire_messages(lang, category_path, brief, card, neighbors, role_catalog, system_catalog, overrides)`, `build_row_messages(lang, card, questionnaire, answers, role_catalog, system_catalog, overrides)`, `build_relations_messages(lang, plan, rows, overrides)`.
- `format_managed_catalog(entries)` (moved from `routers/interviews.py` private helper; keep the old one, do not refactor).

- [ ] **Step 1: Write the failing tests**

```python
"""캠페인 프롬프트 빌더·응답 모델 — 카탈로그 블록 삽입·오버라이드 적용·스키마 검증."""

import pytest
from pydantic import ValidationError

from app.framework_interview import contracts as c


def test_plan_messages_include_catalogs_and_override() -> None:
    msgs = c.build_plan_messages(
        lang="ko", category_path="EPCV > Facility > 유틸리티 > 정제수 > 정제수 일상 점검",
        brief="매일 정제수 라운드", existing_names=["기존 L6"],
        role_catalog="- 운전원", dept_catalog="- 유틸리티팀",
        overrides={"l5_plan_contract": "OVERRIDE"},
    )
    system = msgs[0]["content"]
    assert system.startswith("OVERRIDE")
    assert "- 운전원" in system and "- 유틸리티팀" in system
    assert "기존 L6" in msgs[-1]["content"]


def test_questionnaire_out_requires_activities_ordered() -> None:
    with pytest.raises(ValidationError):
        c.QuestionnaireOut.model_validate({"questions": [
            {"id": "q1", "kind": "single", "maps_to": "roles", "text": "?",
             "options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "suggested": ["a"]},
        ] * 6})
    ok = c.QuestionnaireOut.model_validate({"questions": [
        {"id": "q1", "kind": "ordered", "maps_to": "activities", "text": "활동",
         "options": [{"id": "a", "label": "접수"}, {"id": "b", "label": "검토"}], "suggested": ["a", "b"]},
    ] + [
        {"id": f"q{i}", "kind": "text", "maps_to": "conditions", "text": "?", "options": [], "suggested": "x"}
        for i in range(2, 7)
    ]})
    assert len(ok.questions) == 6


def test_question_suggested_must_reference_options() -> None:
    with pytest.raises(ValidationError):
        c.Question.model_validate({"id": "q", "kind": "multi", "maps_to": "systems", "text": "?",
                                   "options": [{"id": "a", "label": "A"}], "suggested": ["zzz"]})


def test_row_out_dump_matches_interview_row_keys() -> None:
    row = c.RowOut.model_validate({
        "l6": "접수", "ownerRole": "담당자", "department": "",
        "fields": {"start_condition": "요청 접수"},
        "actions": [{"seq": 1, "label": "접수"}, {"seq": 2, "label": "검토", "kind": "decision"}],
        "relations": {"edges": [{"src": 1, "dst": 2, "kind": "seq"}]},
    })
    dumped = row.model_dump(by_alias=True, exclude_none=True)
    assert set(dumped) <= {"l6", "owner", "ownerRole", "department", "fields", "actions", "relations"}
    assert dumped["actions"][1]["kind"] == "decision"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && .venv/bin/python -m pytest tests/test_framework_interview_contracts.py -q`
Expected: FAIL `ModuleNotFoundError`

- [ ] **Step 3: Implement `contracts.py`**

```python
"""AI L5 캠페인 프롬프트 계약 4종 + 응답 스키마 + 메시지 빌더 (spec 2026-09-21 §4·§5).

계약 문구는 prompt_registry 오버라이드로 교체 가능. 출력은 전부 JSON 한 개.
키 이름은 인터뷰 JSON 0.4/0.5 계약(scripts/consultant_interview.py)과 같다 — 어댑터가 바뀌면 여기도 같이.
"""

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

# ── 응답 스키마 ──


class PlanCard(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    summary: str = ""
    owner_role: str = Field(default="", max_length=100)
    department: str = Field(default="", max_length=100)
    depends_on: list[str] = []


class PlanOut(BaseModel):
    cards: list[PlanCard] = Field(min_length=1, max_length=40)


class QuestionOption(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    label: str = Field(min_length=1, max_length=200)


QuestionKind = Literal["single", "multi", "text", "ordered"]
MapsTo = Literal["activities", "branches", "roles", "systems", "io", "conditions", "params"]


class Question(BaseModel):
    id: str = Field(min_length=1, max_length=40)
    kind: QuestionKind
    maps_to: MapsTo
    text: str = Field(min_length=1, max_length=400)
    options: list[QuestionOption] = []
    suggested: list[str] | str = []

    @model_validator(mode="after")
    def _check_shape(self) -> "Question":
        if self.kind == "text":
            if not isinstance(self.suggested, str):
                raise ValueError("text question needs a string suggestion")
            return self
        if len(self.options) < 2:
            raise ValueError("choice question needs at least 2 options")
        ids = {o.id for o in self.options}
        if len(ids) != len(self.options):
            raise ValueError("duplicate option id")
        if not isinstance(self.suggested, list) or any(s not in ids for s in self.suggested):
            raise ValueError("suggested must reference option ids")
        return self


class QuestionnaireOut(BaseModel):
    questions: list[Question] = Field(min_length=6, max_length=12)

    @model_validator(mode="after")
    def _check_activities(self) -> "QuestionnaireOut":
        if not any(q.kind == "ordered" and q.maps_to == "activities" for q in self.questions):
            raise ValueError("questionnaire needs one ordered activities question")
        ids = [q.id for q in self.questions]
        if len(set(ids)) != len(ids):
            raise ValueError("duplicate question id")
        return self


class RowAction(BaseModel):
    seq: int = Field(ge=1)
    label: str = Field(min_length=1, max_length=200)
    name: str | None = None
    kind: Literal["action", "handoff", "decision"] = "action"
    variant: str | None = None  # normal|exception
    rule: str | None = None
    input: str | None = None
    output: str | None = None
    system: str | None = None


class RowEdge(BaseModel):
    src: int
    dst: int
    kind: Literal["seq", "branch", "loop", "bypass"] = "seq"
    gateway: Literal["exclusive", "parallel"] | None = None
    condition: str | None = None
    label: str | None = None


class RowRelations(BaseModel):
    edges: list[RowEdge] = []


class RowOut(BaseModel):
    """rows[] 원소(taskId 제외) — 키는 어댑터 _ROW_KEYS·_FIELD_KEYS·_ACTION_KEYS의 부분집합."""

    l6: str = Field(min_length=1, max_length=200)
    owner: str | None = None
    ownerRole: str = ""  # noqa: N815 -- 인터뷰 JSON 키 그대로
    department: str = ""
    fields: dict[str, Any] = {}
    actions: list[RowAction] = Field(min_length=2, max_length=20)
    relations: RowRelations | None = None

    @model_validator(mode="after")
    def _check_seq(self) -> "RowOut":
        seqs = [a.seq for a in self.actions]
        if len(set(seqs)) != len(seqs):
            raise ValueError("duplicate action seq")
        return self


class RelationsEntry(BaseModel):
    taskId: str  # noqa: N815
    triggerType: Literal["message", "timer", "condition", "manual"] = "manual"  # noqa: N815
    label: str | None = None


class RelationsEdge(BaseModel):
    src: str
    dst: str
    kind: Literal["seq", "branch", "loop", "bypass"] = "seq"
    gateway: Literal["exclusive", "parallel"] | None = None
    condition: str | None = None
    label: str | None = None


class RelationsOut(BaseModel):
    entry: RelationsEntry
    edges: list[RelationsEdge] = []


# ── 계약 문구 (관리자 오버라이드 가능) ──

L5_PLAN_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 주어진 L5 업무(카테고리 경로)와 설명을 읽고,
그 아래에 등록할 L6 단위 업무(각각 하나의 프로세스 맵) 목록을 제안하세요.

규칙
- 3개 이상 12개 이하. 이미 등록된 L6 이름과 겹치지 않게.
- name: 동사형 업무명 20자 이내. summary: 한 문장. owner_role: 역할 후보 목록의 표기 우선.
- department: 부서 후보 목록의 항목만 사용, 모르면 빈 문자열.
- depends_on: 선행해야 하는 다른 카드의 name 목록(없으면 빈 배열).
- 다른 설명 없이 JSON 한 개만: {"cards":[{"name":"","summary":"","owner_role":"","department":"","depends_on":[]}]}"""

L6_QUESTIONNAIRE_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. L6 업무 하나의 흐름을 그리기 위한 설문지를 만드세요.
답하는 사람은 바쁜 현업입니다. 객관식 위주로, 제안 답을 미리 골라 두세요.

규칙
- 문항 6개 이상 12개 이하. id는 q1, q2 순서.
- kind: single(하나)·multi(여러 개)·ordered(순서 있는 여러 개)·text(주관식). text는 최대 3개.
- maps_to: activities·branches·roles·systems·io·conditions·params 중 하나.
- 반드시 kind=ordered, maps_to=activities 문항 1개: 활동 후보 5개 이상 12개 이하, suggested에 제안 순서 전부.
- 역할 문항의 options는 역할 후보 목록 표기를, 시스템 문항은 시스템 목록 표기를 우선.
- text 문항의 suggested는 그대로 답으로 써도 되는 완성 문장.
- 다른 설명 없이 JSON 한 개만:
{"questions":[{"id":"q1","kind":"ordered","maps_to":"activities","text":"","options":[{"id":"a1","label":""}],"suggested":["a1"]}]}"""

L6_ROW_DRAFTER_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 설문 답을 바탕으로 L6 업무 하나의 흐름을 인터뷰 JSON rows[] 원소로 작성하세요.

규칙
- actions: 활동 문항의 선택 순서를 seq 1부터. label은 동사형 20자 이내, kind는 action·handoff·decision.
- 분기 답이 있으면 판단 activity에 kind=decision을 주고 relations.edges에 kind=branch, gateway=exclusive, condition을 적으세요.
- relations.edges의 src/dst는 actions의 seq 정수. 모든 activity가 이어지게(seq 흐름 + 분기 + 필요하면 loop).
- fields: start_condition, input_data, output_data, done_criteria, systems, frequency, total_time, headcount 중 답이 있는 것만.
- ownerRole은 역할 답, department는 카드의 부서. owner는 넣지 마세요(실명 금지).
- 다른 설명 없이 JSON 한 개만:
{"l6":"","ownerRole":"","department":"","fields":{},"actions":[{"seq":1,"label":"","kind":"action","input":"","output":"","system":""}],"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"}]}}"""

L5_RELATIONS_CONTRACT = """당신은 업무 프로세스 컨설턴트입니다. 한 L5 아래 L6 업무들의 흐름(연계 캔버스)을 정하세요.

규칙
- entry.taskId: 가장 먼저 시작되는 L6의 taskId. triggerType은 manual·timer·message·condition.
- edges: src/dst는 taskId. 순차는 kind=seq, 갈림은 kind=branch + gateway=exclusive + condition, 되돌아감은 kind=loop.
- 모든 L6가 최소 한 번은 등장해야 하고, 각 카드의 depends_on과 시작/종료 조건을 존중하세요.
- 다른 설명 없이 JSON 한 개만: {"entry":{"taskId":"","triggerType":"manual","label":""},"edges":[{"src":"","dst":"","kind":"seq"}]}"""


# ── 빌더 ──


def format_managed_catalog(entries: list[dict[str, object]], limit: int = 120) -> str:
    """관리 목록({value, aliases}) → '- 값 (별칭: …)' 줄 목록. routers/interviews.py와 같은 표기."""
    lines: list[str] = []
    for entry in entries[:limit]:
        aliases = entry.get("aliases") or []
        alias_text = f" (별칭: {', '.join(str(a) for a in aliases)})" if aliases else ""
        lines.append(f"- {entry.get('value')}{alias_text}")
    return "\n".join(lines)


def _lang_line(lang: str) -> str:
    return "출력 언어: 한국어." if lang == "ko" else "Output language: English."


def _catalog_blocks(role_catalog: str = "", system_catalog: str = "", dept_catalog: str = "") -> str:
    parts: list[str] = []
    if dept_catalog:
        parts.append(f"[부서 후보 목록 - department 값은 이 목록의 항목만 사용]\n{dept_catalog}")
    if role_catalog:
        parts.append(f"[역할 후보 목록 - owner_role/ownerRole은 이 표기를 우선]\n{role_catalog}")
    if system_catalog:
        parts.append(f"[시스템 목록 - system은 이 정식 표기를 우선]\n{system_catalog}")
    return ("\n\n".join(parts) + "\n\n") if parts else ""


def build_plan_messages(
    *, lang: str, category_path: str, brief: str, existing_names: list[str],
    role_catalog: str = "", dept_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l5_plan_contract") or L5_PLAN_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, '', dept_catalog)}"
    existing = "\n".join(f"- {n}" for n in existing_names) or "- (없음)"
    user = f"[L5 경로]\n{category_path}\n\n[설명·범위·첨부 요약]\n{brief or '(없음)'}\n\n[이미 등록된 L6]\n{existing}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_questionnaire_messages(
    *, lang: str, category_path: str, brief: str, card: dict, neighbors: list[dict],
    role_catalog: str = "", system_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l6_questionnaire_contract") or L6_QUESTIONNAIRE_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, system_catalog)}"
    neighbor_text = "\n".join(f"- {n.get('name')}: {n.get('summary', '')}" for n in neighbors) or "- (없음)"
    user = (
        f"[L5 경로]\n{category_path}\n\n[L5 설명]\n{brief or '(없음)'}\n\n"
        f"[이 L6]\n이름: {card.get('name')}\n요약: {card.get('summary', '')}\n"
        f"역할: {card.get('owner_role', '')}\n부서: {card.get('department', '')}\n\n"
        f"[이웃 L6(선행/후행)]\n{neighbor_text}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def _render_answers(questionnaire: dict, answers: dict) -> str:
    lines: list[str] = []
    for q in questionnaire.get("questions") or []:
        qid = str(q.get("id"))
        got = answers.get(qid) or {}
        value = got.get("value")
        labels = {o.get("id"): o.get("label") for o in q.get("options") or []}
        if isinstance(value, list):
            shown = " → ".join(str(labels.get(v, v)) for v in value)
        else:
            shown = str(labels.get(value, value)) if value is not None else ""
        lines.append(f"- ({q.get('maps_to')}) {q.get('text')}: {shown}")
    return "\n".join(lines)


def build_row_messages(
    *, lang: str, card: dict, questionnaire: dict, answers: dict,
    role_catalog: str = "", system_catalog: str = "",
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l6_row_drafter_contract") or L6_ROW_DRAFTER_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}\n\n{_catalog_blocks(role_catalog, system_catalog)}"
    user = (
        f"[L6]\n이름: {card.get('name')}\n요약: {card.get('summary', '')}\n부서: {card.get('department', '')}\n\n"
        f"[설문 답]\n{_render_answers(questionnaire, answers)}"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_relations_messages(
    *, lang: str, plan: list[dict], rows: dict[str, dict],
    overrides: Mapping[str, str] | None = None,
) -> list[dict]:
    ov = overrides or {}
    contract = ov.get("l5_relations_contract") or L5_RELATIONS_CONTRACT
    system = f"{contract}\n\n{_lang_line(lang)}"
    lines: list[str] = []
    for card in plan:
        task_id = card.get("task_id")
        row = rows.get(task_id, {}) if task_id else {}
        fields = row.get("fields") or {}
        lines.append(
            f"- taskId={task_id} 이름={card.get('name')} 선행={card.get('depends_on') or []} "
            f"시작조건={fields.get('start_condition', '')} 완료기준={fields.get('done_criteria', '')}"
        )
    user = "[L6 목록]\n" + "\n".join(lines)
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_framework_interview_contracts.py tests/test_ai_prompts.py tests/test_framework_interview_api.py -q`
Expected: all pass (13 prompt keys, defaults cover all keys).

- [ ] **Step 5: Ruff**

Run: `cd backend && .venv/bin/ruff check app/ tests/`
Expected: clean (add `# noqa: N815` where camelCase JSON keys are required, as shown).

- [ ] **Step 6: Commit Tasks 1 + 3 together**

```bash
git add backend/app/models.py backend/app/schemas.py backend/app/prompt_registry.py backend/app/framework_interview/__init__.py backend/app/framework_interview/contracts.py backend/tests/test_framework_interview_api.py backend/tests/test_framework_interview_contracts.py backend/tests/test_ai_prompts.py PROGRESS.md
git commit -m "feat(fw-interview): session/task models, schemas, 4 prompt contracts — L5 캠페인 모델·스키마·프롬프트 계약 4종"
```

---

## Task 4: Assembler (task ids, category chain, row validation, document)

**Files:**
- Create: `backend/app/framework_interview/assemble.py`
- Test: `backend/tests/test_framework_interview_assemble.py`

**Interfaces:**
- `allocate_task_ids(category_code: str, existing_codes: list[str], count: int) -> list[str]` → `["{code}-01", ...]` starting after the max existing `NN`.
- `async load_category_chain(db, category_id) -> list[dict]` → `[{"code","name","level","parent"}]` root→self (parent = parent code or None), same shape as `framework.categories[]`.
- `build_document(chain, l5, rows, relations, label, session_id) -> dict` (pure). `l5 = {"label","nodeCode"}`.
- `validate_row(chain, l5, row: dict) -> list[dict]` → adapter issues for a one-row document as `[{"severity","path","message"}]`.
- `async assemble_document(db, session: FrameworkInterviewSession) -> dict` → sets/returns the full 0.5 document.

- [ ] **Step 1: Write the failing tests**

```python
"""조립기 — task_id 채번·카테고리 체인·row 검증·0.5 문서가 어댑터를 이슈 0으로 통과 (spec §7)."""

import asyncio

from fastapi.testclient import TestClient

from app.db import SessionLocal
from app.framework_interview.assemble import (
    allocate_task_ids, build_document, load_category_chain, validate_row,
)
from scripts.consultant_interview import convert_interview

HEADERS = {"X-Dev-User": "admin.sys"}


def _make_l5(client: TestClient, tag: str) -> tuple[int, str]:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        assert "id" in node, node
        parent = node["id"]
    return node["id"], node["code"]


def test_allocate_task_ids_continues_after_max() -> None:
    assert allocate_task_ids("ui-abc", ["ui-abc-02", "ui-abc-07", "other-99"], 2) == ["ui-abc-08", "ui-abc-09"]
    assert allocate_task_ids("ui-abc", [], 1) == ["ui-abc-01"]


ROW = {
    "l6": "요청 접수", "ownerRole": "담당자", "department": "",
    "fields": {"start_condition": "요청서 도착", "input_data": "요청서", "output_data": "접수증"},
    "actions": [
        {"seq": 1, "label": "요청 확인", "kind": "action"},
        {"seq": 2, "label": "완결성 판정", "kind": "decision"},
        {"seq": 3, "label": "접수 등록", "kind": "action"},
    ],
    "relations": {"edges": [
        {"src": 1, "dst": 2, "kind": "seq"},
        {"src": 2, "dst": 3, "kind": "branch", "gateway": "exclusive", "condition": "완결"},
        {"src": 2, "dst": 1, "kind": "loop", "condition": "보완 필요"},
    ]},
}


def test_document_passes_adapter_without_errors(client: TestClient) -> None:
    l5_id, l5_code = _make_l5(client, "asm")

    async def _chain() -> list[dict]:
        async with SessionLocal() as db:
            return await load_category_chain(db, l5_id)

    chain = asyncio.run(_chain())
    assert [c["level"] for c in chain] == [1, 2, 3, 4, 5]
    assert chain[-1]["code"] == l5_code and chain[0]["parent"] is None
    l5 = {"label": chain[-1]["name"], "nodeCode": l5_code}
    task_id = f"{l5_code}-01"
    rows = [{"taskId": task_id, **ROW}]
    relations = {"entry": {"taskId": task_id, "triggerType": "manual", "label": "시작"}, "edges": []}
    doc = build_document(chain, l5, rows, relations, label="t", session_id=1)
    assert doc["schema_version"] == "0.5-bpm-interface-draft"
    result = convert_interview(doc)
    assert not result.has_error(), [i.message for i in result.issues]
    assert [m.code for m in result.maps] == [task_id]
    assert validate_row(chain, l5, rows[0]) == [
        i for i in validate_row(chain, l5, rows[0]) if i["severity"] != "error"
    ]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_assemble.py -q`
Expected: FAIL `ModuleNotFoundError`

- [ ] **Step 3: Implement `assemble.py`**

```python
"""캠페인 → 인터뷰 JSON 0.5 조립 — 어댑터(scripts/consultant_interview.py)가 계약의 단일 진실 (spec §7).

어댑터 키 집합이 바뀌면 여기와 프롬프트(contracts.py)·FE 외부 프롬프트(interview-json-prompt.ts)를 같이 옮긴다.
"""

import re
from dataclasses import asdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import FrameworkInterviewSession, ProcessCategory, ProcessMap

SCHEMA_VERSION = "0.5-bpm-interface-draft"
LABEL_SOURCE = "ai-assisted"


def allocate_task_ids(category_code: str, existing_codes: list[str], count: int) -> list[str]:
    """'{L5 code}-{NN}' 채번 — 기존 consultant_code의 최대 NN 다음부터 (spec §3)."""
    pattern = re.compile(rf"^{re.escape(category_code)}-(\d+)$")
    top = 0
    for code in existing_codes:
        match = pattern.match(code or "")
        if match:
            top = max(top, int(match.group(1)))
    return [f"{category_code}-{top + i:02d}" for i in range(1, count + 1)]


async def load_existing_codes(db: AsyncSession, category_id: int) -> list[str]:
    rows = await db.scalars(
        select(ProcessMap.consultant_code).where(
            ProcessMap.category_id == category_id, ProcessMap.deleted_at.is_(None)
        )
    )
    return [code for code in rows.all() if code]


async def load_category_chain(db: AsyncSession, category_id: int) -> list[dict]:
    """root→self 체인을 framework.categories[] 모양으로 (routers/categories.get_category_chain과 같은 걷기)."""
    rows = (await db.scalars(select(ProcessCategory))).all()
    by_id = {row.id: row for row in rows}
    chain: list[ProcessCategory] = []
    current = by_id.get(category_id)
    while current is not None:
        chain.append(current)
        current = by_id.get(current.parent_id) if current.parent_id else None
    chain.reverse()
    return [
        {"code": c.code, "name": c.name, "level": c.level,
         "parent": by_id[c.parent_id].code if c.parent_id else None}
        for c in chain
    ]


def build_document(
    chain: list[dict], l5: dict, rows: list[dict], relations: dict | None,
    *, label: str, session_id: int,
) -> dict:
    doc: dict = {
        "_readme": [f"AI campaign session {session_id} · {now_kst():%Y-%m-%d %H:%M} · {label}"],
        "schema_version": SCHEMA_VERSION,
        "labelSource": LABEL_SOURCE,
        "framework": {"categories": chain},
        "l5": l5,
        "rows": rows,
    }
    if relations:
        doc["relations"] = relations
    return doc


def validate_row(chain: list[dict], l5: dict, row: dict) -> list[dict]:
    """row 1건짜리 문서를 어댑터에 넣어 그 행의 이슈만 dict로 (severity/path/message)."""
    from scripts.consultant_interview import convert_interview  # 지연 import — 스크립트 패키지

    doc = build_document(chain, l5, [row], None, label="validate", session_id=0)
    result = convert_interview(doc)
    return [asdict(issue) for issue in result.issues if issue.path.startswith("rows[") or issue.path == "$"]


async def assemble_document(db: AsyncSession, session: FrameworkInterviewSession) -> dict:
    chain = await load_category_chain(db, session.category_id)
    l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
    rows = [
        {"taskId": task.task_id, **task.row}
        for task in sorted(session.tasks, key=lambda t: t.seq)
        if task.status == "drawn" and task.row
    ]
    doc = build_document(chain, l5, rows, session.relations, label=session.label, session_id=session.id)
    session.assembled = doc
    return doc
```

- [ ] **Step 4: Run tests**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_assemble.py -q`
Expected: 2 passed. If the adapter reports an error for the sample `ROW`, read the message and fix the row shape in the test (the adapter is the truth), not the assembler.

- [ ] **Step 5: Commit**

```bash
git add backend/app/framework_interview/assemble.py backend/tests/test_framework_interview_assemble.py
git commit -m "feat(fw-interview): assemble interview JSON 0.5 from session — 세션→0.5 문서 조립·task_id 채번·row 검증"
```

---

## Task 5: Router part A (session lifecycle, brief attachments, plan)

**Files:**
- Create: `backend/app/routers/framework_interviews.py`
- Modify: `backend/app/main.py:126-127` (include router after `interviews`)
- Test: `backend/tests/test_framework_interview_api.py` (extend)

**Interfaces:**
- Endpoints: `POST /api/framework-interviews`, `GET /api/framework-interviews?active=1`, `GET /api/framework-interviews/{id}`, `DELETE /api/framework-interviews/{id}`, `POST /api/framework-interviews/{id}/attachments`, `POST /api/framework-interviews/{id}/plan`, `PUT /api/framework-interviews/{id}/plan`.
- Produces helpers reused by Task 7: `_get_owned(db, id, user) -> FrameworkInterviewSession` (404), `_out(db, session) -> FrameworkInterviewOut`, `_require_ai_enabled(db)`, `_ask(messages, schema_cls, db, user)` (calls `orchestrator._ask_json`, records `AiUsageEvent` with `map_id=0, version_id=0, kind="fw_interview"`).
- Task 6's `runner.kick(session_id)` is called at plan lock; until Task 6 exists, import guard: define `kick` import at module top (Task 6 creates the module before this file is run in tests, so implement Task 6 right after; the tests in this task monkeypatch `runner.kick` to a no-op).

- [ ] **Step 1: Write the failing tests (append to `test_framework_interview_api.py`)**

```python
from app import ai_client
from app.framework_interview import runner


def _make_l5(client: TestClient, tag: str) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"{tag}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    return node["id"]


def _fake_ai_queue(monkeypatch, contents: list[str]) -> None:
    queue = list(contents)

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        return ai_client.AiReply(content=queue.pop(0), prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(ai_client, "call_ai", _call)


PLAN_JSON = '{"cards":[{"name":"요청 접수","summary":"요청을 받는다","owner_role":"담당자","department":"","depends_on":[]},' \
            '{"name":"검토 승인","summary":"검토한다","owner_role":"관리자","department":"","depends_on":["요청 접수"]}]}'


def test_create_requires_sysadmin_and_ai(client: TestClient, monkeypatch) -> None:
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)
    r = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS)
    assert r.status_code == 503  # AI disabled
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "auth_enabled", True)
    r = client.post("/api/framework-interviews", json={"category_id": l5}, headers={"X-Dev-User": "someone"})
    assert r.status_code == 403


def test_create_plan_lock_flow(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    created = client.post("/api/framework-interviews", json={"category_id": l5, "brief": "매일 라운드"},
                          headers=HEADERS)
    assert created.status_code == 200, created.text
    body = created.json()
    sid = body["id"]
    assert body["status"] == "planning" and body["tasks"] == []
    assert body["category_code"] and body["progress"]["total"] == 0

    dup = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS)
    assert dup.status_code == 409

    listed = client.get("/api/framework-interviews?active=1", headers=HEADERS).json()
    assert any(s["id"] == sid for s in listed)

    _fake_ai_queue(monkeypatch, [PLAN_JSON])
    planned = client.post(f"/api/framework-interviews/{sid}/plan", headers=HEADERS).json()
    assert [c["name"] for c in planned["plan"]] == ["요청 접수", "검토 승인"]

    edited = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS, json={
        "cards": [{"name": "요청 접수", "summary": "", "owner_role": "담당자", "department": "", "depends_on": []},
                  {"name": "검토 승인", "summary": "", "owner_role": "관리자", "department": "", "depends_on": ["요청 접수"]},
                  {"name": "통보", "summary": "", "owner_role": "", "department": "", "depends_on": ["검토 승인"]}],
        "lock": True,
    })
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["status"] == "plan_locked"
    assert [t["seq"] for t in body["tasks"]] == [1, 2, 3]
    assert body["tasks"][0]["task_id"].endswith("-01") and body["tasks"][0]["status"] == "pending"
    assert body["plan"][0]["task_id"] == body["tasks"][0]["task_id"]

    locked_again = client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
                              json={"cards": [], "lock": True})
    assert locked_again.status_code == 409

    gone = client.delete(f"/api/framework-interviews/{sid}", headers=HEADERS)
    assert gone.status_code == 204
    assert client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["status"] == "abandoned"


def test_attachment_merges_into_brief(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5, "brief": "기본"}, headers=HEADERS).json()["id"]
    r = client.post(f"/api/framework-interviews/{sid}/attachments", headers=HEADERS,
                    files={"file": ("memo.txt", b"purified water round", "text/plain")})
    assert r.status_code == 200, r.text
    assert "purified water round" in r.json()["brief"]
    bad = client.post(f"/api/framework-interviews/{sid}/attachments", headers=HEADERS,
                      files={"file": ("x.exe", b"00", "application/octet-stream")})
    assert bad.status_code == 422
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py -q`
Expected: FAIL (404 on unknown routes / ImportError for `runner`).

- [ ] **Step 3: Create a stub `runner.py` so the router imports (Task 6 replaces it)**

```python
"""캠페인 백그라운드 러너 — Task 6에서 구현. (임시 스텁)"""


def kick(session_id: int) -> None:  # noqa: ARG001
    return None
```

- [ ] **Step 4: Implement the router (part A)**

```python
"""AI L5 캠페인 API — sysadmin 전용, AI 게이트, 세션·계획·설문·러너·조립 (spec 2026-09-21 §8)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems, is_ai_access_enabled
from app.auth import require_sysadmin
from app.clock import now as now_kst
from app.db import get_session
from app.framework_interview import runner
from app.framework_interview.answers import fill_answers
from app.framework_interview.assemble import (
    allocate_task_ids, assemble_document, load_category_chain, load_existing_codes,
)
from app.framework_interview.contracts import (
    PlanOut, RelationsOut, build_plan_messages, build_relations_messages, format_managed_catalog,
)
from app.interview.orchestrator import TurnError, _ask_json, sum_usage, usage_log  # noqa: PLC2701 -- 재사용
from app.interview.parsing import ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES, ParseError, parse_attachment
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask, ProcessCategory
from app.permissions.access import get_eligible_users
from app.prompt_registry import get_prompt_overrides
from app.schemas import (
    FrameworkInterviewAnswersIn, FrameworkInterviewCreateIn, FrameworkInterviewOut,
    FrameworkInterviewPlanIn, FrameworkInterviewProgressOut, FrameworkInterviewRelationsIn,
    FrameworkInterviewTaskDetailOut, FrameworkInterviewTaskOut,
)

router = APIRouter(
    prefix="/api/framework-interviews", tags=["framework-interviews"],
    dependencies=[Depends(require_sysadmin)],
)
logger = logging.getLogger(__name__)
_parse_lock = asyncio.Lock()
BRIEF_MAX = 20_000  # 첨부 병합 상한(문자) — 프롬프트 예산
WORKING = {"generating", "drawing"}


async def _require_ai_enabled(db: AsyncSession) -> None:
    if not await is_ai_access_enabled(db):
        raise HTTPException(status_code=503, detail="AI is disabled")


async def _get_owned(db: AsyncSession, session_id: int, user: str) -> FrameworkInterviewSession:
    row = await db.get(FrameworkInterviewSession, session_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail="framework interview not found")
    await db.refresh(row, ["tasks"])
    return row


async def _out(db: AsyncSession, s: FrameworkInterviewSession) -> FrameworkInterviewOut:
    category = await db.get(ProcessCategory, s.category_id)
    tasks = sorted(s.tasks, key=lambda t: t.seq)
    return FrameworkInterviewOut(
        id=s.id, category_id=s.category_id,
        category_code=category.code if category else "", category_name=category.name if category else "",
        status=s.status, paused=s.paused, lang=s.lang, brief=s.brief, plan=s.plan,
        relations=s.relations, label=s.label,
        tasks=[FrameworkInterviewTaskOut.model_validate(t) for t in tasks],
        progress=FrameworkInterviewProgressOut(
            total=len(tasks), drawn=sum(t.status == "drawn" for t in tasks),
            failed=sum(t.status == "failed" for t in tasks),
            working=any(t.status in WORKING for t in tasks),
        ),
        created_at=s.created_at, updated_at=s.updated_at,
    )


async def _ask(messages: list[dict], schema_cls: type[BaseModel], db: AsyncSession, user: str) -> BaseModel:
    """AI 1콜 + JSON 검증 + usage 계량(map/version 없음 → 0, kind='fw_interview'). 실패는 502."""
    usage: list = []
    token = usage_log.set(usage)
    ok = True
    try:
        return await _ask_json(messages, None, schema_cls, reasoning="high")
    except TurnError as exc:
        ok = False
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        usage_log.reset(token)
        prompt_total, completion_total = sum_usage(usage)
        db.add(AiUsageEvent(
            login_id=user, map_id=0, version_id=0, model="", kind="fw_interview" if ok else None,
            ok=ok, prompt_tokens=prompt_total, completion_tokens=completion_total,
        ))


async def _catalogs(db: AsyncSession) -> tuple[str, str]:
    return (
        format_managed_catalog(await get_assignee_roles(db)),
        format_managed_catalog(await get_systems(db)),
    )


async def _category_path(db: AsyncSession, category_id: int) -> str:
    chain = await load_category_chain(db, category_id)
    return " > ".join(c["name"] for c in chain)


@router.post("", response_model=FrameworkInterviewOut)
async def create_framework_interview(
    payload: FrameworkInterviewCreateIn,
    user: str = Depends(require_sysadmin),
    db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    category = await db.get(ProcessCategory, payload.category_id)
    if category is None or category.level != 5:
        raise HTTPException(status_code=422, detail="category must be a level-5 category")
    active = (await db.scalars(select(FrameworkInterviewSession).where(
        FrameworkInterviewSession.category_id == payload.category_id,
        FrameworkInterviewSession.status.notin_(("applied", "abandoned")),
    ))).first()
    if active is not None:
        raise HTTPException(status_code=409, detail=f"active session {active.id} exists for this category")
    row = FrameworkInterviewSession(
        login_id=user, category_id=payload.category_id, brief=payload.brief.strip(), lang=payload.lang,
        label=f"AI consult {now_kst():%Y-%m-%d}",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row, ["tasks"])
    return await _out(db, row)


@router.get("", response_model=list[FrameworkInterviewOut])
async def list_framework_interviews(
    active: int = 0,
    user: str = Depends(require_sysadmin),
    db: AsyncSession = Depends(get_session),
) -> list[FrameworkInterviewOut]:
    query = select(FrameworkInterviewSession).where(FrameworkInterviewSession.login_id == user)
    if active:
        query = query.where(FrameworkInterviewSession.status.notin_(("applied", "abandoned")))
    rows = (await db.scalars(query.order_by(FrameworkInterviewSession.updated_at.desc()))).all()
    out: list[FrameworkInterviewOut] = []
    for row in rows:
        await db.refresh(row, ["tasks"])
        out.append(await _out(db, row))
    return out


@router.get("/{session_id}", response_model=FrameworkInterviewOut)
async def get_framework_interview(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    return await _out(db, await _get_owned(db, session_id, user))


@router.delete("/{session_id}", status_code=204)
async def abandon_framework_interview(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> Response:
    row = await _get_owned(db, session_id, user)
    row.status = "abandoned"
    row.paused = True
    await db.commit()
    return Response(status_code=204)


@router.post("/{session_id}/attachments", response_model=FrameworkInterviewOut)
async def upload_framework_attachment(
    session_id: int, file: UploadFile,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    filename = file.filename or "attachment"
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=422, detail=f"unsupported file type: {ext or filename}")
    data = await file.read()
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise HTTPException(status_code=422, detail="file too large (max 20MB)")
    async with _parse_lock:
        try:
            text = await asyncio.to_thread(parse_attachment, filename, data)
        except ParseError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    merged = f"{row.brief}\n\n[첨부 {filename}]\n{text}".strip()
    row.brief = merged[:BRIEF_MAX]
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def generate_plan(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    row = await _get_owned(db, session_id, user)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    role_catalog, _ = await _catalogs(db)
    # 부서 후보 목록(dept_catalog)은 v1 생략 — 맵이 없어 get_eligible_users 기준이 없다
    chain = await load_category_chain(db, row.category_id)
    existing = await db.scalars(select(FrameworkInterviewTask.name).where(FrameworkInterviewTask.session_id == row.id))
    messages = build_plan_messages(
        lang=row.lang, category_path=" > ".join(c["name"] for c in chain), brief=row.brief,
        existing_names=list(existing.all()), role_catalog=role_catalog,
        overrides=await get_prompt_overrides(db),
    )
    plan = await _ask(messages, PlanOut, db, user)
    row.plan = [card.model_dump() for card in plan.cards]
    await db.commit()
    return await _out(db, row)


@router.put("/{session_id}/plan", response_model=FrameworkInterviewOut)
async def save_plan(
    session_id: int, payload: FrameworkInterviewPlanIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    if row.status != "planning":
        raise HTTPException(status_code=409, detail="plan is locked")
    cards = [card.model_dump() for card in payload.cards]
    if payload.lock:
        if not cards:
            raise HTTPException(status_code=422, detail="plan needs at least one card")
        names = [c["name"] for c in cards]
        if len(set(names)) != len(names):
            raise HTTPException(status_code=422, detail="duplicate card names")
        category = await db.get(ProcessCategory, row.category_id)
        ids = allocate_task_ids(category.code, await load_existing_codes(db, row.category_id), len(cards))
        for seq, (card, task_id) in enumerate(zip(cards, ids, strict=True), start=1):
            card["task_id"] = task_id
            db.add(FrameworkInterviewTask(session_id=row.id, task_id=task_id, seq=seq, name=card["name"]))
        row.status = "plan_locked"
    row.plan = cards
    await db.commit()
    await db.refresh(row, ["tasks"])
    if payload.lock:
        runner.kick(row.id)
    return await _out(db, row)
```

Drop the unused `get_eligible_users` import (department candidates are not available without a map; `dept_catalog` stays empty in v1).

In `backend/app/main.py`, import `framework_interviews` with the other routers and add `app.include_router(framework_interviews.router)` right after the `interviews` line (~127).

- [ ] **Step 5: Run tests + ruff**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py -q && .venv/bin/ruff check app/ tests/`
Expected: 4 passed, ruff clean. If `require_sysadmin` passes for everyone while `auth_enabled=False`, the 403 assertion depends on `monkeypatch.setattr(settings, "auth_enabled", True)` already in the test; keep it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/routers/framework_interviews.py backend/app/framework_interview/runner.py backend/app/main.py backend/tests/test_framework_interview_api.py PROGRESS.md
git commit -m "feat(fw-interview): session lifecycle, brief attachments, AI plan and lock — 캠페인 세션·첨부·계획 생성/잠금 API"
```

---

## Task 6: Background runner (draw submitted, prefetch questionnaire, pause, recovery)

**Files:**
- Modify (replace stub): `backend/app/framework_interview/runner.py`
- Modify: `backend/app/main.py` lifespan (~line 93) — call `recover_stale_tasks`
- Test: `backend/tests/test_framework_interview_runner.py`

**Interfaces:**
- `kick(session_id: int) -> None` — spawn `process_session` unless one is active for that id.
- `async process_session(session_id: int) -> None` — loop `run_one_step` with a fresh `SessionLocal()` each step until it returns `False`.
- `async run_one_step(db, session_id) -> bool` — priority 1: a `submitted` task → `drawing` → row drafter → `validate_row` → `drawn`/`failed`. Priority 2: if fewer than `PREFETCH_READY = 2` tasks are `ready`, take the lowest-seq `pending` → `generating` → questionnaire → `ready`. Returns `False` when paused, session not live, or nothing to do.
- `async recover_stale_tasks(db) -> int` — `drawing`→`submitted`, `generating`→`pending`.
- `TESTING_SYNC` is not used; tests call `run_one_step` directly with `kick` monkeypatched.

- [ ] **Step 1: Write the failing tests**

```python
"""러너 — 제출 카드 드로잉 우선, 설문 prefetch 2장, 일시정지, 재기동 복구 (spec §6)."""

import asyncio
from uuid import uuid4

from fastapi.testclient import TestClient

from app import ai_client
from app.db import SessionLocal
from app.framework_interview import runner
from app.models import FrameworkInterviewSession, FrameworkInterviewTask
from app.settings import settings

SYSADMIN = "fw.admin"
HEADERS = {"X-Dev-User": SYSADMIN}

Q_JSON = ('{"questions":['
          '{"id":"q1","kind":"ordered","maps_to":"activities","text":"활동","options":[{"id":"a1","label":"요청 확인"},'
          '{"id":"a2","label":"완결성 판정"},{"id":"a3","label":"접수 등록"}],"suggested":["a1","a2","a3"]},'
          '{"id":"q2","kind":"single","maps_to":"roles","text":"역할","options":[{"id":"r1","label":"담당자"},{"id":"r2","label":"관리자"}],"suggested":["r1"]},'
          '{"id":"q3","kind":"multi","maps_to":"systems","text":"시스템","options":[{"id":"s1","label":"ERP"},{"id":"s2","label":"메일"}],"suggested":["s1"]},'
          '{"id":"q4","kind":"text","maps_to":"conditions","text":"시작 조건","options":[],"suggested":"요청서 도착"},'
          '{"id":"q5","kind":"text","maps_to":"io","text":"입력물","options":[],"suggested":"요청서"},'
          '{"id":"q6","kind":"text","maps_to":"io","text":"산출물","options":[],"suggested":"접수증"}]}')

ROW_JSON = ('{"l6":"요청 접수","ownerRole":"담당자","department":"","fields":{"start_condition":"요청서 도착"},'
            '"actions":[{"seq":1,"label":"요청 확인","kind":"action"},{"seq":2,"label":"완결성 판정","kind":"decision"},'
            '{"seq":3,"label":"접수 등록","kind":"action"}],'
            '"relations":{"edges":[{"src":1,"dst":2,"kind":"seq"},{"src":2,"dst":3,"kind":"branch","gateway":"exclusive","condition":"완결"}]}}')


def _enable(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "bpm_sysadmins", SYSADMIN)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)


def _fake_ai_queue(monkeypatch, contents: list[str]) -> list[str]:
    queue = list(contents)

    async def _call(messages, model=None, *, reasoning=None, max_tokens=None):
        return ai_client.AiReply(content=queue.pop(0), prompt_tokens=10, completion_tokens=5)

    monkeypatch.setattr(ai_client, "call_ai", _call)
    return queue


def _make_locked_session(client: TestClient, names: list[str]) -> int:
    parent = None
    node: dict = {}
    for level in range(1, 6):
        node = client.post("/api/categories", json={"name": f"rn-{uuid4().hex[:4]}-L{level}", "parent_id": parent},
                           headers=HEADERS).json()
        parent = node["id"]
    sid = client.post("/api/framework-interviews", json={"category_id": node["id"]}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in names]
    r = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS)
    assert r.status_code == 200, r.text
    return sid


def _statuses(sid: int) -> list[str]:
    async def _load() -> list[str]:
        async with SessionLocal() as db:
            s = await db.get(FrameworkInterviewSession, sid)
            await db.refresh(s, ["tasks"])
            return [t.status for t in sorted(s.tasks, key=lambda t: t.seq)]

    return asyncio.run(_load())


def _step(sid: int) -> bool:
    async def _run() -> bool:
        async with SessionLocal() as db:
            return await runner.run_one_step(db, sid)

    return asyncio.run(_run())


def test_prefetch_two_questionnaires_then_idle(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B", "C"])
    queue = _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON])
    assert _step(sid) is True
    assert _statuses(sid) == ["ready", "pending", "pending"]
    assert _step(sid) is True
    assert _statuses(sid) == ["ready", "ready", "pending"]
    assert _step(sid) is False  # prefetch cap reached, nothing submitted
    assert queue == []


def test_submitted_task_is_drawn_before_prefetch(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B", "C"])
    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON])
    _step(sid)
    _step(sid)
    first = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    answers = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "", "q6": ""}
    r = client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/answers", json={"answers": answers}, headers=HEADERS)
    assert r.status_code == 200, r.text
    assert _statuses(sid)[0] == "submitted"
    assert _step(sid) is True
    assert _statuses(sid) == ["drawn", "ready", "pending"]
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{first['id']}", headers=HEADERS).json()
    assert detail["row"]["actions"][0]["label"] == "요청 확인"
    assert detail["answers"]["q4"] == {"value": "요청서 도착", "auto": True}
    assert all(i["severity"] != "error" for i in detail["issues"])


def test_invalid_row_marks_failed_and_retry_requeues(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A"])
    _fake_ai_queue(monkeypatch, [Q_JSON, "not json", "still not json"])
    _step(sid)
    first = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()["tasks"][0]
    client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/answers",
                json={"answers": {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "", "q6": ""}},
                headers=HEADERS)
    assert _step(sid) is True
    assert _statuses(sid) == ["failed"]
    r = client.post(f"/api/framework-interviews/{sid}/tasks/{first['id']}/retry", headers=HEADERS)
    assert r.status_code == 200
    assert _statuses(sid) == ["submitted"]


def test_pause_stops_steps_and_recovery_resets_stale(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    sid = _make_locked_session(client, ["A", "B"])
    client.post(f"/api/framework-interviews/{sid}/pause", headers=HEADERS)
    assert _step(sid) is False

    async def _stale() -> None:
        async with SessionLocal() as db:
            s = await db.get(FrameworkInterviewSession, sid)
            await db.refresh(s, ["tasks"])
            s.tasks[0].status = "generating"
            s.tasks[1].status = "drawing"
            await db.commit()
            assert await runner.recover_stale_tasks(db) == 2
            await db.commit()

    asyncio.run(_stale())
    assert _statuses(sid) == ["pending", "submitted"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_runner.py -q`
Expected: FAIL (`run_one_step` missing; answers/pause/retry endpoints 404 until Task 7). Implement Task 6 then Task 7, and run this file again after Task 7.

- [ ] **Step 3: Implement `runner.py`**

```python
"""캠페인 백그라운드 러너 — 세션당 루프 1개, 한 스텝 = AI 1콜 (spec 2026-09-21 §6).

우선순위: 제출된 카드 드로잉 > 설문 prefetch(ready 2장 유지). 일시정지·비활성 세션이면 즉시 종료.
단일 uvicorn 워커 전제(kb/indexing.spawn 패턴). 재기동 시 drawing→submitted, generating→pending 복구.
"""

import asyncio
import logging

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.app_settings import get_assignee_roles, get_systems
from app.clock import now as now_kst
from app.db import SessionLocal
from app.framework_interview.assemble import load_category_chain, validate_row
from app.framework_interview.contracts import (
    QuestionnaireOut, RowOut, build_questionnaire_messages, build_row_messages, format_managed_catalog,
)
from app.interview.orchestrator import TurnError, _ask_json, sum_usage, usage_log  # noqa: PLC2701
from app.models import AiUsageEvent, FrameworkInterviewSession, FrameworkInterviewTask
from app.prompt_registry import get_prompt_overrides

logger = logging.getLogger(__name__)

PREFETCH_READY = 2  # 현재 답변 중 1장 + 다음 1장
LIVE_STATUSES = ("plan_locked", "linking")

_tasks: set[asyncio.Task] = set()
_active: set[int] = set()


def spawn(coro) -> None:
    task = asyncio.get_running_loop().create_task(coro)
    _tasks.add(task)

    def _done(t: asyncio.Task) -> None:
        _tasks.discard(t)
        _ = t.cancelled() or t.exception()

    task.add_done_callback(_done)


def kick(session_id: int) -> None:
    """세션 루프를 깨운다 — 이미 돌고 있으면 무시(루프가 다음 스텝에서 새 작업을 집는다)."""
    if session_id in _active:
        return
    spawn(process_session(session_id))


async def process_session(session_id: int) -> None:
    if session_id in _active:
        return
    _active.add(session_id)
    try:
        while True:
            async with SessionLocal() as db:
                try:
                    progressed = await run_one_step(db, session_id)
                except Exception:  # noqa: BLE001 -- 루프는 죽지 않고 로그만
                    logger.exception("framework interview step failed (session %s)", session_id)
                    await db.rollback()
                    return
            if not progressed:
                return
    finally:
        _active.discard(session_id)


async def _record_usage(db: AsyncSession, login_id: str, usage: list, ok: bool) -> None:
    prompt_total, completion_total = sum_usage(usage)
    db.add(AiUsageEvent(
        login_id=login_id, map_id=0, version_id=0, model="", kind="fw_interview" if ok else None,
        ok=ok, prompt_tokens=prompt_total, completion_tokens=completion_total,
    ))


def _card_of(session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> dict:
    for card in session.plan or []:
        if card.get("task_id") == task.task_id:
            return card
    return {"name": task.name}


def _neighbors_of(session: FrameworkInterviewSession, card: dict) -> list[dict]:
    names = set(card.get("depends_on") or [])
    me = card.get("name")
    return [c for c in session.plan or [] if c.get("name") in names or me in (c.get("depends_on") or [])]


async def _generate_questionnaire(db: AsyncSession, session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> None:
    task.status = "generating"
    await db.commit()
    role_catalog = format_managed_catalog(await get_assignee_roles(db))
    system_catalog = format_managed_catalog(await get_systems(db))
    chain = await load_category_chain(db, session.category_id)
    card = _card_of(session, task)
    messages = build_questionnaire_messages(
        lang=session.lang, category_path=" > ".join(c["name"] for c in chain), brief=session.brief,
        card=card, neighbors=_neighbors_of(session, card),
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await _ask_json(messages, None, QuestionnaireOut, reasoning="high")
        task.questionnaire = out.model_dump()
        task.status = "ready"
        task.error = None
        await _record_usage(db, session.login_id, usage, ok=True)
    except TurnError as exc:
        task.status = "pending"
        task.error = str(exc)
        await _record_usage(db, session.login_id, usage, ok=False)
    finally:
        usage_log.reset(token)
    await db.commit()


async def _draw_row(db: AsyncSession, session: FrameworkInterviewSession, task: FrameworkInterviewTask) -> None:
    task.status = "drawing"
    await db.commit()
    role_catalog = format_managed_catalog(await get_assignee_roles(db))
    system_catalog = format_managed_catalog(await get_systems(db))
    card = _card_of(session, task)
    messages = build_row_messages(
        lang=session.lang, card=card, questionnaire=task.questionnaire or {}, answers=task.answers or {},
        role_catalog=role_catalog, system_catalog=system_catalog, overrides=await get_prompt_overrides(db),
    )
    usage: list = []
    token = usage_log.set(usage)
    try:
        out = await _ask_json(messages, None, RowOut, reasoning=None)
        row = out.model_dump(by_alias=True, exclude_none=True)
        row["department"] = row.get("department") or card.get("department", "")
        chain = await load_category_chain(db, session.category_id)
        l5 = {"label": chain[-1]["name"], "nodeCode": chain[-1]["code"]}
        issues = validate_row(chain, l5, {"taskId": task.task_id, **row})
        task.row = row
        task.issues = issues
        if any(i["severity"] == "error" for i in issues):
            task.status = "failed"
            task.error = "; ".join(i["message"] for i in issues if i["severity"] == "error")[:2000]
        else:
            task.status = "drawn"
            task.error = None
            task.drawn_at = now_kst()
        await _record_usage(db, session.login_id, usage, ok=True)
    except TurnError as exc:
        task.status = "failed"
        task.error = str(exc)
        await _record_usage(db, session.login_id, usage, ok=False)
    finally:
        usage_log.reset(token)
    await db.commit()


async def run_one_step(db: AsyncSession, session_id: int) -> bool:
    """작업 1개 처리. False = 더 할 일 없음(일시정지·비활성·큐 비움)."""
    session = await db.get(FrameworkInterviewSession, session_id)
    if session is None or session.paused or session.status not in LIVE_STATUSES:
        return False
    await db.refresh(session, ["tasks"])
    tasks = sorted(session.tasks, key=lambda t: t.seq)
    submitted = next((t for t in tasks if t.status == "submitted"), None)
    if submitted is not None:
        await _draw_row(db, session, submitted)
        return True
    ready_count = sum(t.status == "ready" for t in tasks)
    pending = next((t for t in tasks if t.status == "pending"), None)
    if pending is not None and ready_count < PREFETCH_READY:
        await _generate_questionnaire(db, session, pending)
        return True
    return False


async def recover_stale_tasks(db: AsyncSession) -> int:
    """재기동 복구 — 진행 중이던 상태를 큐로 되돌린다(중복 실행 대신 재시도)."""
    drawing = await db.execute(
        update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "drawing").values(status="submitted")
    )
    generating = await db.execute(
        update(FrameworkInterviewTask).where(FrameworkInterviewTask.status == "generating").values(status="pending")
    )
    return (drawing.rowcount or 0) + (generating.rowcount or 0)


async def resume_live_sessions(db: AsyncSession) -> None:
    """앱 시작 시 살아있는 세션의 루프를 다시 깨운다(정지 안 된 것만)."""
    ids = await db.scalars(select(FrameworkInterviewSession.id).where(
        FrameworkInterviewSession.status.in_(LIVE_STATUSES), FrameworkInterviewSession.paused.is_(False)
    ))
    for session_id in ids.all():
        kick(session_id)
```

In `backend/app/main.py` lifespan, after `await logic.load_granted_sysadmins(session)` inside the same `async with SessionLocal() as session:` block:

```python
        from app.framework_interview import runner as fw_runner  # 지연 import — 순환 방지

        if await fw_runner.recover_stale_tasks(session):
            await session.commit()
        await fw_runner.resume_live_sessions(session)
```

- [ ] **Step 4: Run runner tests after Task 7 (they depend on answers/pause/retry endpoints)**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_runner.py -q`
Expected after Task 7: 4 passed.

- [ ] **Step 5: Commit (after Task 7 turns the tests green; a single commit for Tasks 6+7 is fine)**

---

## Task 7: Router part B (task detail, answers, retry, pause/resume, relations, document)

**Files:**
- Modify: `backend/app/routers/framework_interviews.py` (append)
- Test: `backend/tests/test_framework_interview_api.py` (append), `backend/tests/test_framework_interview_runner.py` (now green)

**Interfaces:**
- `GET /{id}/tasks/{tid}` → `FrameworkInterviewTaskDetailOut`
- `POST /{id}/tasks/{tid}/answers` body `{answers}` → session out; 409 unless task `ready`; 422 with `{"detail": "missing answers", "missing": [...]}` when choices are missing.
- `POST /{id}/tasks/{tid}/retry` → 409 unless `failed`; sets `submitted` and kicks.
- `POST /{id}/pause`, `POST /{id}/resume` → session out.
- `POST /{id}/relations` (AI) → 409 unless every task is `drawn`; sets `status="linking"`, stores `relations`.
- `PUT /{id}/relations` body `{relations}` → validates through `RelationsOut`, assembles the document, `status="ready"`.
- `GET /{id}/document` → the assembled 0.5 JSON (`dict`), 409 unless `ready` or `applied`.
- `POST /{id}/mark-applied` → `status="applied"` (the FE calls this after the existing import endpoint returns `applied: true`).

- [ ] **Step 1: Append tests to `test_framework_interview_api.py`**

```python
from tests.test_framework_interview_runner import Q_JSON, ROW_JSON, _step  # noqa: E402

RELATIONS_TMPL = '{"entry":{"taskId":"%s","triggerType":"manual","label":"시작"},"edges":[{"src":"%s","dst":"%s","kind":"seq"}]}'


def test_answers_validation_and_full_flow_to_document(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    monkeypatch.setattr(runner, "kick", lambda session_id: None)
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    cards = [{"name": n, "summary": "", "owner_role": "", "department": "", "depends_on": []} for n in ["A", "B"]]
    body = client.put(f"/api/framework-interviews/{sid}/plan", json={"cards": cards, "lock": True}, headers=HEADERS).json()
    t1, t2 = body["tasks"]

    early = client.post(f"/api/framework-interviews/{sid}/tasks/{t1['id']}/answers", json={"answers": {}}, headers=HEADERS)
    assert early.status_code == 409  # questionnaire not ready yet

    _fake_ai_queue(monkeypatch, [Q_JSON, Q_JSON, ROW_JSON, ROW_JSON,
                                 RELATIONS_TMPL % (t1["task_id"], t1["task_id"], t2["task_id"])])
    _step(sid)
    _step(sid)
    detail = client.get(f"/api/framework-interviews/{sid}/tasks/{t1['id']}", headers=HEADERS).json()
    assert detail["status"] == "ready" and len(detail["questionnaire"]["questions"]) == 6

    missing = client.post(f"/api/framework-interviews/{sid}/tasks/{t1['id']}/answers",
                          json={"answers": {"q1": ["a1"], "q3": ["s1"]}}, headers=HEADERS)
    assert missing.status_code == 422 and missing.json()["detail"]["missing"] == ["q2"]

    full = {"q1": ["a1", "a2", "a3"], "q2": "r1", "q3": ["s1"], "q4": "", "q5": "요청서", "q6": ""}
    for tid in (t1["id"], t2["id"]):
        r = client.post(f"/api/framework-interviews/{sid}/tasks/{tid}/answers", json={"answers": full}, headers=HEADERS)
        assert r.status_code == 200, r.text
    too_early = client.post(f"/api/framework-interviews/{sid}/relations", headers=HEADERS)
    assert too_early.status_code == 409
    _step(sid)
    _step(sid)
    state = client.get(f"/api/framework-interviews/{sid}", headers=HEADERS).json()
    assert state["progress"] == {"total": 2, "drawn": 2, "failed": 0, "working": False}

    linked = client.post(f"/api/framework-interviews/{sid}/relations", headers=HEADERS).json()
    assert linked["status"] == "linking" and linked["relations"]["entry"]["taskId"] == t1["task_id"]

    confirmed = client.put(f"/api/framework-interviews/{sid}/relations", headers=HEADERS,
                           json={"relations": linked["relations"]})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "ready"

    doc = client.get(f"/api/framework-interviews/{sid}/document", headers=HEADERS).json()
    assert doc["schema_version"] == "0.5-bpm-interface-draft"
    assert [r["taskId"] for r in doc["rows"]] == [t1["task_id"], t2["task_id"]]
    assert doc["l5"]["nodeCode"] == state["category_code"]

    dry = client.post("/api/categories/import-interview", headers=HEADERS,
                      json={"files": [{"name": "ai.json", "content": doc}], "apply": False})
    assert dry.status_code == 200, dry.text
    assert dry.json()["files"][0]["ok"] is True

    applied = client.post(f"/api/framework-interviews/{sid}/mark-applied", headers=HEADERS)
    assert applied.json()["status"] == "applied"


def test_pause_resume_roundtrip(client: TestClient, monkeypatch) -> None:
    _enable(monkeypatch)
    kicked: list[int] = []
    monkeypatch.setattr(runner, "kick", lambda session_id: kicked.append(session_id))
    l5 = _make_l5(client, f"fw-{uuid4().hex[:6]}")
    sid = client.post("/api/framework-interviews", json={"category_id": l5}, headers=HEADERS).json()["id"]
    client.put(f"/api/framework-interviews/{sid}/plan", headers=HEADERS,
               json={"cards": [{"name": "A", "summary": "", "owner_role": "", "department": "", "depends_on": []}], "lock": True})
    assert kicked == [sid]
    assert client.post(f"/api/framework-interviews/{sid}/pause", headers=HEADERS).json()["paused"] is True
    assert client.post(f"/api/framework-interviews/{sid}/resume", headers=HEADERS).json()["paused"] is False
    assert kicked == [sid, sid]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py -q`
Expected: the two new tests FAIL with 404.

- [ ] **Step 3: Append endpoints to the router**

```python
async def _get_task(db: AsyncSession, session: FrameworkInterviewSession, task_id: int) -> FrameworkInterviewTask:
    task = next((t for t in session.tasks if t.id == task_id), None)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task


@router.get("/{session_id}/tasks/{task_pk}", response_model=FrameworkInterviewTaskDetailOut)
async def get_task_detail(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewTaskDetailOut:
    row = await _get_owned(db, session_id, user)
    return FrameworkInterviewTaskDetailOut.model_validate(await _get_task(db, row, task_pk))


@router.post("/{session_id}/tasks/{task_pk}/answers", response_model=FrameworkInterviewOut)
async def submit_answers(
    session_id: int, task_pk: int, payload: FrameworkInterviewAnswersIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    task = await _get_task(db, row, task_pk)
    if task.status != "ready" or not task.questionnaire:
        raise HTTPException(status_code=409, detail="questionnaire is not ready")
    filled, missing = fill_answers(task.questionnaire, payload.answers)
    if missing:
        raise HTTPException(status_code=422, detail={"detail": "missing answers", "missing": missing})
    task.answers = filled
    task.status = "submitted"
    task.error = None
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/tasks/{task_pk}/retry", response_model=FrameworkInterviewOut)
async def retry_task(
    session_id: int, task_pk: int,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    task = await _get_task(db, row, task_pk)
    if task.status != "failed":
        raise HTTPException(status_code=409, detail="task is not failed")
    task.status = "submitted" if task.answers else "pending"
    task.error = None
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


@router.post("/{session_id}/pause", response_model=FrameworkInterviewOut)
async def pause_session(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    row.paused = True
    await db.commit()
    return await _out(db, row)


@router.post("/{session_id}/resume", response_model=FrameworkInterviewOut)
async def resume_session(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    row.paused = False
    await db.commit()
    runner.kick(row.id)
    return await _out(db, row)


def _assert_all_drawn(row: FrameworkInterviewSession) -> None:
    if not row.tasks or any(t.status != "drawn" for t in row.tasks):
        raise HTTPException(status_code=409, detail="all tasks must be drawn first")


@router.post("/{session_id}/relations", response_model=FrameworkInterviewOut)
async def generate_relations(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    await _require_ai_enabled(db)
    row = await _get_owned(db, session_id, user)
    _assert_all_drawn(row)
    rows_by_task = {t.task_id: t.row or {} for t in row.tasks}
    messages = build_relations_messages(
        lang=row.lang, plan=row.plan or [], rows=rows_by_task, overrides=await get_prompt_overrides(db),
    )
    out = await _ask(messages, RelationsOut, db, user)
    known = set(rows_by_task)
    if out.entry.taskId not in known or any(e.src not in known or e.dst not in known for e in out.edges):
        raise HTTPException(status_code=502, detail="AI relations reference unknown taskId")
    row.relations = out.model_dump(by_alias=True, exclude_none=True)
    row.status = "linking"
    await db.commit()
    return await _out(db, row)


@router.put("/{session_id}/relations", response_model=FrameworkInterviewOut)
async def confirm_relations(
    session_id: int, payload: FrameworkInterviewRelationsIn,
    user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    _assert_all_drawn(row)
    try:
        relations = RelationsOut.model_validate(payload.relations)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"invalid relations: {exc}") from exc
    row.relations = relations.model_dump(by_alias=True, exclude_none=True)
    await assemble_document(db, row)
    row.status = "ready"
    await db.commit()
    return await _out(db, row)


@router.get("/{session_id}/document")
async def get_document(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> dict:
    row = await _get_owned(db, session_id, user)
    if row.status not in ("ready", "applied") or not row.assembled:
        raise HTTPException(status_code=409, detail="document is not assembled yet")
    return row.assembled


@router.post("/{session_id}/mark-applied", response_model=FrameworkInterviewOut)
async def mark_applied(
    session_id: int, user: str = Depends(require_sysadmin), db: AsyncSession = Depends(get_session),
) -> FrameworkInterviewOut:
    row = await _get_owned(db, session_id, user)
    if row.status != "ready":
        raise HTTPException(status_code=409, detail="session is not ready")
    row.status = "applied"
    await db.commit()
    return await _out(db, row)
```

Note on the 422 body: FastAPI serialises `detail={"detail": ..., "missing": [...]}` as `{"detail": {"detail": "...", "missing": [...]}}`; the test asserts that nesting. The FE validates before sending (`validateAnswers`), so it only needs `getApiErrorDetail` for the fallback message.

- [ ] **Step 4: Run all framework interview tests + ruff + full suite**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py tests/test_framework_interview_runner.py -q && .venv/bin/ruff check app/ tests/ && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: all green (baseline 1501 + new).

- [ ] **Step 5: Verify Python 3.11 import (deploy runtime gap)**

Run: `cd backend && python3.11 -c "import ast,sys; [ast.parse(open(p).read(), feature_version=(3,11)) for p in ['app/framework_interview/contracts.py','app/framework_interview/runner.py','app/framework_interview/assemble.py','app/framework_interview/answers.py','app/routers/framework_interviews.py']]; print('ok')"` (if `python3.11` is unavailable, `ruff` with `target-version=py311` is the gate; do not use `type` aliases or PEP 695).

- [ ] **Step 6: Commit Tasks 6 + 7**

```bash
git add backend/app/framework_interview/runner.py backend/app/routers/framework_interviews.py backend/app/main.py backend/tests/test_framework_interview_api.py backend/tests/test_framework_interview_runner.py PROGRESS.md
git commit -m "feat(fw-interview): background runner, answers, relations, document — 러너(드로잉·prefetch·일시정지·복구)·답 제출·연결·문서 API"
```

---

## Task 8: Frontend API client + campaign view-model lib (TDD)

**Files:**
- Modify: `frontend/src/lib/api.ts` (append near the interview section, ~line 2870)
- Create: `frontend/src/lib/framework-interview.ts`
- Test: `frontend/src/lib/framework-interview.test.ts`

**Interfaces:**
- Types in `api.ts`: `FwQuestionKind`, `FwQuestion`, `FwQuestionnaire`, `FwPlanCard`, `FwTaskStatus`, `FwInterviewTask`, `FwInterviewTaskDetail`, `FwInterviewSession`, `FwAnswerValue = string | string[]`.
- Functions in `api.ts`: `createFrameworkInterview(body)`, `listFrameworkInterviews(activeOnly)`, `getFrameworkInterview(id)`, `abandonFrameworkInterview(id)`, `uploadFrameworkInterviewAttachment(id, file)`, `generateFrameworkPlan(id)`, `saveFrameworkPlan(id, cards, lock)`, `getFrameworkInterviewTask(id, taskPk)`, `submitFrameworkAnswers(id, taskPk, answers)`, `retryFrameworkTask(id, taskPk)`, `pauseFrameworkInterview(id)`, `resumeFrameworkInterview(id)`, `generateFrameworkRelations(id)`, `confirmFrameworkRelations(id, relations)`, `getFrameworkInterviewDocument(id)`, `markFrameworkInterviewApplied(id)`.
- Lib (`framework-interview.ts`): `validateAnswers(q, answers) -> string[]` (missing ids), `fillSuggested(q) -> Record<string, FwAnswerValue>`, `buildSubmitPayload(q, answers)` (adds blanks for text), `deriveProgress(session, durationsMs) -> { done, total, working, etaMs }`, `findCurrentTask(session) -> FwInterviewTask | null` (lowest seq with status pending|generating|ready), `hasBackgroundWork(session) -> boolean`, `deriveStep(session) -> "plan" | "answer" | "waiting" | "relations" | "register" | "done"`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";

import type { FwInterviewSession, FwQuestionnaire } from "./api";
import {
  buildSubmitPayload, deriveProgress, deriveStep, fillSuggested, findCurrentTask, hasBackgroundWork, validateAnswers,
} from "./framework-interview";

const Q: FwQuestionnaire = {
  questions: [
    { id: "q1", kind: "ordered", maps_to: "activities", text: "활동", options: [{ id: "a", label: "접수" }, { id: "b", label: "검토" }], suggested: ["a", "b"] },
    { id: "q2", kind: "single", maps_to: "roles", text: "역할", options: [{ id: "r1", label: "담당자" }, { id: "r2", label: "관리자" }], suggested: ["r1"] },
    { id: "q3", kind: "text", maps_to: "conditions", text: "시작", options: [], suggested: "요청서 도착" },
  ],
};

function session(statuses: string[], status = "plan_locked", paused = false): FwInterviewSession {
  return {
    id: 1, category_id: 9, category_code: "c", category_name: "L5", status, paused, lang: "ko", brief: "",
    plan: null, relations: null, label: "", created_at: "", updated_at: "",
    tasks: statuses.map((s, i) => ({ id: i + 1, task_id: `c-0${i + 1}`, seq: i + 1, name: `T${i + 1}`, status: s as never, issues: [], error: null, drawn_at: null })),
    progress: { total: statuses.length, drawn: statuses.filter((s) => s === "drawn").length, failed: 0, working: statuses.some((s) => s === "drawing" || s === "generating") },
  };
}

describe("framework-interview view model", () => {
  it("validateAnswers reports missing choices only, blank text is fine", () => {
    expect(validateAnswers(Q, { q1: ["a", "b"], q3: "" })).toEqual(["q2"]);
    expect(validateAnswers(Q, { q1: ["a"], q2: "r1" })).toEqual([]);
    expect(validateAnswers(Q, { q1: [], q2: "zzz" })).toEqual(["q1", "q2"]);
  });

  it("fillSuggested pre-selects every suggestion and leaves text blank", () => {
    expect(fillSuggested(Q)).toEqual({ q1: ["a", "b"], q2: "r1", q3: "" });
  });

  it("buildSubmitPayload sends blank text so the server applies the suggestion", () => {
    expect(buildSubmitPayload(Q, { q1: ["b"], q2: "r2" })).toEqual({ q1: ["b"], q2: "r2", q3: "" });
  });

  it("findCurrentTask picks the lowest seq that is not yet submitted", () => {
    expect(findCurrentTask(session(["drawn", "submitted", "ready", "pending"]))?.seq).toBe(3);
    expect(findCurrentTask(session(["drawn", "drawn"]))).toBeNull();
  });

  it("deriveStep follows the session status and task states", () => {
    expect(deriveStep(session([], "planning"))).toBe("plan");
    expect(deriveStep(session(["ready", "pending"]))).toBe("answer");
    expect(deriveStep(session(["generating", "pending"]))).toBe("waiting");
    expect(deriveStep(session(["drawn", "drawing"]))).toBe("waiting");
    expect(deriveStep(session(["drawn", "drawn"]))).toBe("relations");
    expect(deriveStep(session(["drawn"], "ready"))).toBe("register");
    expect(deriveStep(session(["drawn"], "applied"))).toBe("done");
  });

  it("deriveProgress estimates eta from the mean drawing duration", () => {
    const p = deriveProgress(session(["drawn", "drawn", "submitted", "pending"]), [4000, 6000]);
    expect(p).toEqual({ done: 2, total: 4, working: false, etaMs: 10000 });
    expect(deriveProgress(session(["pending"]), []).etaMs).toBeNull();
  });

  it("hasBackgroundWork is true while a task is generating or drawing, or something is queued", () => {
    expect(hasBackgroundWork(session(["submitted"]))).toBe(true);
    expect(hasBackgroundWork(session(["ready", "ready", "pending"]))).toBe(false);
    expect(hasBackgroundWork(session(["ready", "pending"]))).toBe(true);
    expect(hasBackgroundWork(session(["pending"], "plan_locked", true))).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/framework-interview.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Add types + functions to `api.ts`**

```ts
// ── Framework interview (AI L5 campaign, spec 2026-09-21) ──

export type FwQuestionKind = "single" | "multi" | "text" | "ordered";
export type FwMapsTo = "activities" | "branches" | "roles" | "systems" | "io" | "conditions" | "params";
export interface FwQuestionOption { id: string; label: string }
export interface FwQuestion {
  id: string;
  kind: FwQuestionKind;
  maps_to: FwMapsTo;
  text: string;
  options: FwQuestionOption[];
  suggested: string[] | string;
}
export interface FwQuestionnaire { questions: FwQuestion[] }
export type FwAnswerValue = string | string[];
export interface FwPlanCard {
  name: string;
  summary: string;
  owner_role: string;
  department: string;
  depends_on: string[];
  task_id?: string;
}
export type FwTaskStatus = "pending" | "generating" | "ready" | "submitted" | "drawing" | "drawn" | "failed";
export interface FwInterviewTask {
  id: number;
  task_id: string;
  seq: number;
  name: string;
  status: FwTaskStatus;
  issues: { severity: string; path: string; message: string }[];
  error: string | null;
  drawn_at: string | null;
}
export interface FwInterviewTaskDetail extends FwInterviewTask {
  questionnaire: FwQuestionnaire | null;
  answers: Record<string, { value: FwAnswerValue; auto: boolean }> | null;
  row: Record<string, unknown> | null;
}
export type FwSessionStatus = "planning" | "plan_locked" | "linking" | "ready" | "applied" | "abandoned";
export interface FwInterviewSession {
  id: number;
  category_id: number;
  category_code: string;
  category_name: string;
  status: FwSessionStatus | string;
  paused: boolean;
  lang: "ko" | "en";
  brief: string;
  plan: FwPlanCard[] | null;
  relations: Record<string, unknown> | null;
  label: string;
  tasks: FwInterviewTask[];
  progress: { total: number; drawn: number; failed: number; working: boolean };
  created_at: string;
  updated_at: string;
}

export function createFrameworkInterview(body: { category_id: number; brief?: string; lang?: "ko" | "en" }): Promise<FwInterviewSession> {
  return request<FwInterviewSession>("/framework-interviews", { method: "POST", body: JSON.stringify(body) });
}
export function listFrameworkInterviews(activeOnly = true): Promise<FwInterviewSession[]> {
  return request<FwInterviewSession[]>(`/framework-interviews${activeOnly ? "?active=1" : ""}`);
}
export function getFrameworkInterview(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}`);
}
export function abandonFrameworkInterview(id: number): Promise<void> {
  return request<void>(`/framework-interviews/${id}`, { method: "DELETE" });
}
export async function uploadFrameworkInterviewAttachment(id: number, file: File): Promise<FwInterviewSession> {
  // multipart — request()의 JSON Content-Type을 쓰면 boundary가 깨져 별도 경로 (uploadInterviewAttachment와 동일)
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  else if (devUser) headers["X-Dev-User"] = devUser;
  const response = await fetch(`/api/framework-interviews/${id}/attachments`, { method: "POST", body: form, headers });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(`API POST /framework-interviews/${id}/attachments failed: ${response.status}${detail ? ` - ${detail}` : ""}`, response.status, detail);
  }
  return (await response.json()) as FwInterviewSession;
}
export function generateFrameworkPlan(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/plan`, { method: "POST" });
}
export function saveFrameworkPlan(id: number, cards: FwPlanCard[], lock: boolean): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/plan`, { method: "PUT", body: JSON.stringify({ cards, lock }) });
}
export function getFrameworkInterviewTask(id: number, taskPk: number): Promise<FwInterviewTaskDetail> {
  return request<FwInterviewTaskDetail>(`/framework-interviews/${id}/tasks/${taskPk}`);
}
export function submitFrameworkAnswers(id: number, taskPk: number, answers: Record<string, FwAnswerValue>): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/tasks/${taskPk}/answers`, { method: "POST", body: JSON.stringify({ answers }) });
}
export function retryFrameworkTask(id: number, taskPk: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/tasks/${taskPk}/retry`, { method: "POST" });
}
export function pauseFrameworkInterview(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/pause`, { method: "POST" });
}
export function resumeFrameworkInterview(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/resume`, { method: "POST" });
}
export function generateFrameworkRelations(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/relations`, { method: "POST" });
}
export function confirmFrameworkRelations(id: number, relations: Record<string, unknown>): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/relations`, { method: "PUT", body: JSON.stringify({ relations }) });
}
export function getFrameworkInterviewDocument(id: number): Promise<Record<string, unknown>> {
  return request<Record<string, unknown>>(`/framework-interviews/${id}/document`);
}
export function markFrameworkInterviewApplied(id: number): Promise<FwInterviewSession> {
  return request<FwInterviewSession>(`/framework-interviews/${id}/mark-applied`, { method: "POST" });
}
```

- [ ] **Step 4: Implement `framework-interview.ts`**

```ts
// AI L5 캠페인 뷰 모델 — 설문 검증·제안 채우기·진행률/ETA·현재 단계 파생. 페이지와 보드가 공유 (spec 2026-09-21 §9).

import type { FwAnswerValue, FwInterviewSession, FwInterviewTask, FwQuestionnaire } from "./api";

export type FwStep = "plan" | "answer" | "waiting" | "relations" | "register" | "done";

const PREFETCH_READY = 2; // 서버 runner.PREFETCH_READY와 동기

function isChoice(kind: string): boolean {
  return kind === "single" || kind === "multi" || kind === "ordered";
}

/** 누락 문항 id — 객관식은 값 필수·옵션 id만, 주관식 빈칸은 허용(서버가 제안값 적용). */
export function validateAnswers(q: FwQuestionnaire, answers: Record<string, FwAnswerValue | undefined>): string[] {
  const missing: string[] = [];
  for (const question of q.questions) {
    if (!isChoice(question.kind)) continue;
    const allowed = new Set(question.options.map((o) => o.id));
    const value = answers[question.id];
    if (question.kind === "single") {
      if (typeof value !== "string" || !allowed.has(value)) missing.push(question.id);
    } else if (!Array.isArray(value) || value.length === 0 || value.some((v) => !allowed.has(v))) {
      missing.push(question.id);
    }
  }
  return missing;
}

/** 초기값 = 제안 답. 주관식은 빈칸(플레이스홀더가 제안을 보여준다). */
export function fillSuggested(q: FwQuestionnaire): Record<string, FwAnswerValue> {
  const out: Record<string, FwAnswerValue> = {};
  for (const question of q.questions) {
    if (question.kind === "text") out[question.id] = "";
    else if (question.kind === "single") out[question.id] = Array.isArray(question.suggested) ? (question.suggested[0] ?? "") : "";
    else out[question.id] = Array.isArray(question.suggested) ? [...question.suggested] : [];
  }
  return out;
}

export function buildSubmitPayload(q: FwQuestionnaire, answers: Record<string, FwAnswerValue | undefined>): Record<string, FwAnswerValue> {
  const out: Record<string, FwAnswerValue> = {};
  for (const question of q.questions) {
    const value = answers[question.id];
    out[question.id] = value ?? (question.kind === "text" ? "" : question.kind === "single" ? "" : []);
  }
  return out;
}

export function findCurrentTask(session: FwInterviewSession): FwInterviewTask | null {
  const sorted = [...session.tasks].sort((a, b) => a.seq - b.seq);
  return sorted.find((t) => t.status === "pending" || t.status === "generating" || t.status === "ready") ?? null;
}

export function hasBackgroundWork(session: FwInterviewSession): boolean {
  if (session.paused) return false;
  if (session.status !== "plan_locked" && session.status !== "linking") return false;
  const statuses = session.tasks.map((t) => t.status);
  if (statuses.some((s) => s === "generating" || s === "drawing" || s === "submitted")) return true;
  const ready = statuses.filter((s) => s === "ready").length;
  return statuses.includes("pending") && ready < PREFETCH_READY;
}

export function deriveStep(session: FwInterviewSession): FwStep {
  if (session.status === "applied") return "done";
  if (session.status === "ready") return "register";
  if (session.status === "planning") return "plan";
  const current = findCurrentTask(session);
  if (current) return current.status === "ready" ? "answer" : "waiting";
  if (session.tasks.some((t) => t.status === "submitted" || t.status === "drawing")) return "waiting";
  return "relations";
}

export function deriveProgress(
  session: FwInterviewSession,
  drawDurationsMs: number[],
): { done: number; total: number; working: boolean; etaMs: number | null } {
  const total = session.tasks.length;
  const done = session.tasks.filter((t) => t.status === "drawn").length;
  const remaining = total - done;
  const mean = drawDurationsMs.length
    ? drawDurationsMs.reduce((a, b) => a + b, 0) / drawDurationsMs.length
    : null;
  return { done, total, working: session.progress.working, etaMs: mean === null ? null : Math.round(mean * remaining) };
}
```

- [ ] **Step 5: Run vitest + tsc**

Run: `cd frontend && npx vitest run src/lib/framework-interview.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: 7 passed, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/framework-interview.ts frontend/src/lib/framework-interview.test.ts PROGRESS.md
git commit -m "feat(fw-interview): API client and campaign view model — 캠페인 API 클라이언트·설문 검증/진행률 뷰 모델"
```

---

## Task 9: External-AI prompt builder + copy button + i18n keys

**Files:**
- Create: `frontend/src/lib/interview-json-prompt.ts`
- Create: `frontend/src/lib/interview-json-prompt.test.ts`
- Create: `frontend/src/components/framework-interview/interview-json-prompt-button.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (en block after `framework.interviewLinkage` ~line 2475; ko mirror ~line 5126)

**Interfaces:**
- `buildInterviewJsonPromptText(target?: { code: string; name: string; path: string[] }): string`
- `<InterviewJsonPromptButton target={...} disabled />` — same tri-state copy pattern as `csv-template-actions.tsx`.
- i18n keys (add both en and ko; ko values in Korean):

```ts
  "fwConsult.copyPrompt": "Copy external AI prompt",
  "fwConsult.copyPromptHint": "Paste into an external AI with your documents. It returns interview JSON 0.5 for this L5.",
  "fwConsult.promptCopied": "Copied",
  "fwConsult.promptCopyFailed": "Copy failed",
  "fwConsult.start": "Fill L5 with AI",
  "fwConsult.startHint": "Pick a level-5 category. AI proposes L6 cards, asks one short questionnaire per L6, and registers everything through the interview import.",
  "fwConsult.pickL5": "Choose a level-5 category",
  "fwConsult.activeSessions": "Sessions in progress",
  "fwConsult.resume": "Resume",
  "fwConsult.title": "AI consultant · L5 campaign",
  "fwConsult.stepPlan": "Plan L6 cards",
  "fwConsult.stepAnswer": "Answer questionnaire",
  "fwConsult.stepWaiting": "Preparing",
  "fwConsult.stepRelations": "Connect L6",
  "fwConsult.stepRegister": "Register",
  "fwConsult.stepDone": "Registered",
  "fwConsult.brief": "Purpose and scope",
  "fwConsult.briefPlaceholder": "What this L5 covers, who does it, where it starts and ends. Attach documents if you have them.",
  "fwConsult.attach": "Attach document",
  "fwConsult.generatePlan": "Propose L6 cards",
  "fwConsult.regeneratePlan": "Propose again",
  "fwConsult.addCard": "Add card",
  "fwConsult.removeCard": "Remove",
  "fwConsult.moveUp": "Move up",
  "fwConsult.moveDown": "Move down",
  "fwConsult.cardName": "L6 name",
  "fwConsult.cardSummary": "One line summary",
  "fwConsult.cardRole": "Role",
  "fwConsult.cardDept": "Department",
  "fwConsult.lockPlan": "Confirm plan",
  "fwConsult.lockPlanHint": "Cards are fixed after this. Questionnaires start right away.",
  "fwConsult.fillAll": "Fill all with suggestions",
  "fwConsult.review": "Review answers",
  "fwConsult.backToEdit": "Back to edit",
  "fwConsult.submit": "Submit",
  "fwConsult.submitHint": "Submitted cards cannot be reopened. Blank text answers use the suggestion.",
  "fwConsult.autoApplied": "Suggestion applied",
  "fwConsult.missing": "Answer every choice question before submitting.",
  "fwConsult.textPlaceholder": "Leave blank to use: {suggested}",
  "fwConsult.waitingQuestionnaire": "Preparing the questionnaire for {name}",
  "fwConsult.waitingDrawing": "Drawing the remaining cards",
  "fwConsult.progress": "{done} of {total} drawn",
  "fwConsult.eta": "about {minutes} min left",
  "fwConsult.pause": "Pause",
  "fwConsult.resumeRun": "Resume",
  "fwConsult.paused": "Paused",
  "fwConsult.retry": "Retry",
  "fwConsult.preview": "Preview",
  "fwConsult.statusPending": "Queued",
  "fwConsult.statusGenerating": "Preparing",
  "fwConsult.statusReady": "Ready",
  "fwConsult.statusSubmitted": "Submitted",
  "fwConsult.statusDrawing": "Drawing",
  "fwConsult.statusDrawn": "Done",
  "fwConsult.statusFailed": "Failed",
  "fwConsult.proposeRelations": "Propose connections",
  "fwConsult.confirmRelations": "Confirm connections",
  "fwConsult.relationsHint": "Entry point and edges between L6 cards. This becomes the L5 linkage canvas.",
  "fwConsult.dryRun": "Check (dry run)",
  "fwConsult.apply": "Register",
  "fwConsult.download": "Download JSON",
  "fwConsult.done": "Registered. The L5 canvas is a draft; confirm it from the canvas when ready.",
  "fwConsult.openCanvas": "Open L5 canvas",
  "fwConsult.abandon": "Abandon session",
  "fwConsult.abandonConfirm": "Abandon this session? Drawn cards are discarded.",
```

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";

import { buildInterviewJsonPromptText } from "./interview-json-prompt";

describe("external AI prompt for interview JSON 0.5", () => {
  it("carries the schema skeleton, key rules and the target L5", () => {
    const text = buildInterviewJsonPromptText({ code: "19-01-02-01-01", name: "정제수 일상 점검", path: ["EPCV", "Facility", "유틸리티 운전", "정제수 시스템 운전"] });
    expect(text).toContain('"schema_version": "0.5-bpm-interface-draft"');
    expect(text).toContain("19-01-02-01-01");
    expect(text).toContain("EPCV > Facility > 유틸리티 운전 > 정제수 시스템 운전 > 정제수 일상 점검");
    for (const key of ["taskId", "l6", "ownerRole", "fields", "actions", "relations", "entry", "edges", "externalTasks"]) {
      expect(text).toContain(key);
    }
    expect(text).toContain("src/dst");
    expect(text).not.toContain("—");
    const skeletonStart = text.indexOf("{");
    const skeleton = text.slice(skeletonStart, text.lastIndexOf("}") + 1);
    expect(() => JSON.parse(skeleton)).not.toThrow();
  });

  it("works without a target", () => {
    expect(buildInterviewJsonPromptText()).toContain("nodeCode");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/lib/interview-json-prompt.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the prompt builder**

```ts
// 외부 AI용 인터뷰 JSON 0.5 작성 프롬프트 — CSV의 buildAiPromptText와 같은 왕복(복사→외부 AI→관리자 임포트).
// 키 이름은 backend/scripts/consultant_interview.py의 _TOP_KEYS/_ROW_KEYS/_FIELD_KEYS/_ACTION_KEYS/_EDGE_KEYS와 동기.
// 계약이 바뀌면 docs/samples/interview-json-0.5.md와 이 파일을 같이 옮긴다 (spec 2026-09-21 결합 표면 3종).

export interface InterviewPromptTarget {
  code: string; // L5 nodeCode (process_categories.code)
  name: string;
  path: string[]; // L1..L4 이름
}

const SKELETON = {
  schema_version: "0.5-bpm-interface-draft",
  labelSource: "human-confirmed",
  framework: { categories: [{ code: "L1코드", name: "L1 이름", level: 1, parent: null }] },
  l5: { label: "L5 이름", nodeCode: "L5코드" },
  rows: [
    {
      taskId: "L5코드-01",
      l6: "L6 업무명",
      owner: null,
      ownerRole: "역할명",
      approvers: [],
      department: null,
      fields: {
        start_condition: "", input_data: "", output_data: "", done_criteria: "",
        systems: "", total_time: "", frequency: "", headcount: null, fte: null, gmp: "",
      },
      actions: [
        { seq: 1, label: "활동명", name: "한 문장 설명", kind: "action", variant: "normal", rule: null, input: "", output: "", system: "" },
        { seq: 2, label: "판정", name: "", kind: "decision", variant: "normal", rule: "판단 기준", input: null, output: null, system: null },
      ],
      relations: {
        edges: [
          { src: 1, dst: 2, kind: "seq", gateway: null, condition: null, label: null },
          { src: 2, dst: 1, kind: "loop", gateway: "exclusive", condition: "보완 필요", label: "재작업" },
        ],
      },
    },
  ],
  relations: {
    entry: { taskId: "L5코드-01", triggerType: "manual", label: "시작 계기" },
    edges: [{ src: "L5코드-01", dst: "L5코드-02", kind: "seq", gateway: null, condition: null, label: null }],
  },
  externalTasks: [],
};

export function buildInterviewJsonPromptText(target?: InterviewPromptTarget): string {
  const pathLine = target ? [...target.path, target.name].join(" > ") : "(L5 경로를 여기에 적으세요)";
  const codeLine = target ? target.code : "(L5 코드를 여기에 적으세요)";
  return [
    "당신은 업무 프로세스 컨설턴트입니다. 아래 L5 업무에 대해 첨부 문서(규정, 지침, 절차서, 인터뷰 메모)를 읽고,",
    "그 아래 L6 단위 업무들과 각 L6의 활동 흐름을 인터뷰 결과 JSON 한 개로 작성하세요.",
    "",
    `[대상 L5] ${pathLine}`,
    `[L5 코드] ${codeLine}`,
    "",
    "[출력 형식, 반드시 지킬 것]",
    "- 다른 설명이나 코드블록 없이 JSON 객체 하나만 출력하세요.",
    '- schema_version은 정확히 "0.5-bpm-interface-draft".',
    "- framework.categories는 L1부터 L5까지 코드, 이름, level, parent(상위 코드 또는 null).",
    "- l5.nodeCode는 위 L5 코드, l5.label은 L5 이름.",
    "",
    "[rows 규칙, L6 하나가 rows 원소 하나]",
    "- taskId는 'L5코드-01', 'L5코드-02'처럼 유일하게. l6는 동사형 업무명.",
    "- owner는 null(실명 금지). ownerRole은 역할명. department는 부서명 또는 null.",
    "- fields: start_condition, input_data, output_data, done_criteria, systems, total_time, frequency, headcount, fte, gmp 중 아는 것만.",
    "- actions: seq는 1부터, label은 동사형 20자 이내, kind는 action, handoff, decision 중 하나. variant는 normal 또는 exception.",
    "- relations.edges의 src/dst는 actions의 seq 정수. kind는 seq, branch, loop, bypass. 분기는 gateway exclusive 또는 parallel과 condition.",
    "- 모든 활동이 이어지도록 edges를 채우세요. 비우면 순번 순서로 자동 연결됩니다.",
    "",
    "[최상위 relations, L6 사이의 흐름]",
    "- entry.taskId는 처음 시작하는 L6. triggerType은 manual, timer, message, condition.",
    "- edges의 src/dst는 rows의 taskId. 다른 L5의 L6를 가리키려면 externalTasks에 refId, l5.nodeCode, l6를 선언하고 그 refId를 쓰세요.",
    "",
    "[골격, 값만 바꿔 채우세요]",
    JSON.stringify(SKELETON, null, 2),
  ].join("\n");
}
```

- [ ] **Step 4: Implement the button component**

```tsx
"use client";

// 외부 AI 프롬프트 복사 버튼 — 관리자 Framework 패널(인터뷰 임포트 옆)과 캠페인 페이지 헤더가 공용.
// csv-template-actions.tsx의 tri-state 복사 패턴을 따른다(평문 HTTP에서 실패 가능, 성공 가정 금지).

import { useState } from "react";

import { AlertTriangle, Check, Sparkles } from "lucide-react";

import { copyText } from "@/lib/clipboard";
import { useI18n } from "@/lib/i18n";
import { buildInterviewJsonPromptText, type InterviewPromptTarget } from "@/lib/interview-json-prompt";

const OUTLINE_BTN =
  "inline-flex items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2.5 py-1 text-caption text-ink-secondary hover:bg-surface-alt disabled:opacity-50";

export function InterviewJsonPromptButton({ target, disabled }: { target?: InterviewPromptTarget; disabled?: boolean }) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    const ok = await copyText(buildInterviewJsonPromptText(target));
    setCopyState(ok ? "copied" : "failed");
    window.setTimeout(() => setCopyState("idle"), ok ? 1200 : 1600);
  };

  return (
    <button
      type="button"
      data-id="fw-consult-copy-prompt"
      className={OUTLINE_BTN}
      onClick={() => void handleCopy()}
      disabled={disabled}
      title={t("fwConsult.copyPromptHint")}
    >
      {copyState === "copied" ? (
        <Check size={14} strokeWidth={1.5} className="text-accent" />
      ) : copyState === "failed" ? (
        <AlertTriangle size={14} strokeWidth={1.5} className="text-error" />
      ) : (
        <Sparkles size={14} strokeWidth={1.5} />
      )}
      <span className={copyState === "failed" ? "text-error" : undefined}>
        {copyState === "copied" ? t("fwConsult.promptCopied") : copyState === "failed" ? t("fwConsult.promptCopyFailed") : t("fwConsult.copyPrompt")}
      </span>
    </button>
  );
}
```

- [ ] **Step 5: Add all `fwConsult.*` keys to `i18n-messages.ts` (en block + ko block, same key set; tsc enforces parity)**

- [ ] **Step 6: Run gates**

Run: `cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run lint && node scripts/build-component-catalog.mjs`
Expected: green; `COMPONENTS.md` regenerated with the new component row.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/lib/interview-json-prompt.ts frontend/src/lib/interview-json-prompt.test.ts frontend/src/components/framework-interview/interview-json-prompt-button.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-interview): external AI prompt for interview JSON 0.5 and i18n keys — 외부 AI용 0.5 JSON 프롬프트 복사·캠페인 문구"
```

---

## Task 10: Page shell, task board, plan editor

**Files:**
- Create: `frontend/src/app/framework/consult/[sessionId]/page.tsx`
- Create: `frontend/src/components/framework-interview/task-board.tsx`
- Create: `frontend/src/components/framework-interview/plan-editor.tsx`

**Interfaces:**
- `TaskBoard({ session, currentTaskId, drawDurationsMs, onPause, onResume, onRetry, onPreview })`
- `PlanEditor({ session, busy, onGenerate, onSave, onLock, onAttach, onBriefChange })` — `onSave(cards)` persists without lock, `onLock(cards)` locks.
- Page state: `session`, `busy`, `error`, `drawDurations` (ms per drawn task, measured client-side between `submitted` seen and `drawn` seen), polling with `setInterval(2000)` while `hasBackgroundWork(session)`.

- [ ] **Step 1: Page**

```tsx
"use client";

// AI 컨설턴트 L5 캠페인 — 풀스크린(TopNav 아래): 좌 L6 카드 보드+진행률 / 우 현재 단계 (spec 2026-09-21 §2·§9).
// 폴링 2초: 백그라운드 작업(설문 생성·드로잉)이 있는 동안만. 세션은 DB에 있어 이탈 후 복귀 가능.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Headset } from "lucide-react";

import {
  abandonFrameworkInterview, confirmFrameworkRelations, generateFrameworkPlan, generateFrameworkRelations,
  getApiErrorDetail, getFrameworkInterview, markFrameworkInterviewApplied, pauseFrameworkInterview,
  resumeFrameworkInterview, retryFrameworkTask, saveFrameworkPlan, submitFrameworkAnswers,
  uploadFrameworkInterviewAttachment, type FwAnswerValue, type FwInterviewSession, type FwPlanCard,
} from "@/lib/api";
import { deriveStep, findCurrentTask, hasBackgroundWork } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { AnswerStep } from "@/components/framework-interview/questionnaire-form";
import { InterviewJsonPromptButton } from "@/components/framework-interview/interview-json-prompt-button";
import { PlanEditor } from "@/components/framework-interview/plan-editor";
import { RegisterStep } from "@/components/framework-interview/register-step";
import { RelationsStep } from "@/components/framework-interview/relations-step";
import { TaskBoard } from "@/components/framework-interview/task-board";

const BOARD_WIDTH_KEY = "bpm.fwConsultBoardWidth";
const BOARD_MIN = 280;
const BOARD_MAX = 560;
const POLL_MS = 2000;

function readBoardWidth(): number {
  if (typeof window === "undefined") return 360;
  const stored = Number(window.localStorage.getItem(BOARD_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= BOARD_MIN && stored <= BOARD_MAX ? stored : 360;
}

export default function FrameworkConsultPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = Number(params.sessionId);
  const router = useRouter();
  const { t } = useI18n();
  const [session, setSession] = useState<FwInterviewSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [boardWidth, setBoardWidth] = useState(readBoardWidth);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [previewTaskId, setPreviewTaskId] = useState<number | null>(null);
  // 드로잉 소요 실측(ms) — ETA 추정. submitted를 처음 본 시각 → drawn을 처음 본 시각
  const submittedAtRef = useRef<Map<number, number>>(new Map());
  const [drawDurations, setDrawDurations] = useState<number[]>([]);

  const applySession = useCallback((next: FwInterviewSession) => {
    const now = Date.now();
    const durations: number[] = [];
    for (const task of next.tasks) {
      if (task.status === "submitted" || task.status === "drawing") {
        if (!submittedAtRef.current.has(task.id)) submittedAtRef.current.set(task.id, now);
      } else if (task.status === "drawn" && submittedAtRef.current.has(task.id)) {
        durations.push(now - (submittedAtRef.current.get(task.id) ?? now));
        submittedAtRef.current.delete(task.id);
      }
    }
    if (durations.length) setDrawDurations((prev) => [...prev, ...durations]);
    setSession(next);
  }, []);

  const run = useCallback(async (action: () => Promise<FwInterviewSession>) => {
    setBusy(true);
    setError(null);
    try {
      applySession(await action());
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setBusy(false);
    }
  }, [applySession]);

  useEffect(() => {
    if (!Number.isFinite(sessionId)) return;
    void run(() => getFrameworkInterview(sessionId));
  }, [sessionId, run]);

  useEffect(() => {
    if (!session || !hasBackgroundWork(session)) return;
    const timer = window.setInterval(() => {
      getFrameworkInterview(sessionId).then(applySession).catch((err) => setError(getApiErrorDetail(err)));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [session, sessionId, applySession]);

  function handleDividerDown(e: React.PointerEvent) {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => setBoardWidth(Math.min(BOARD_MAX, Math.max(BOARD_MIN, ev.clientX)));
    const finish = (ev: PointerEvent) => {
      window.localStorage.setItem(BOARD_WIDTH_KEY, String(Math.min(BOARD_MAX, Math.max(BOARD_MIN, ev.clientX))));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-caption text-ink-tertiary" data-id="fw-consult-loading">
        {error ?? "…"}
      </div>
    );
  }

  const step = deriveStep(session);
  const current = findCurrentTask(session);
  const stepLabel = {
    plan: t("fwConsult.stepPlan"), answer: t("fwConsult.stepAnswer"), waiting: t("fwConsult.stepWaiting"),
    relations: t("fwConsult.stepRelations"), register: t("fwConsult.stepRegister"), done: t("fwConsult.stepDone"),
  }[step];

  return (
    <div className="flex h-full flex-col" data-id="fw-consult-page">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <Link href="/settings?tab=framework" className="flex items-center gap-1 text-caption text-ink-tertiary hover:text-ink" data-id="fw-consult-exit">
          <ArrowLeft size={16} strokeWidth={1.5} />
          Back
        </Link>
        <Headset size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-body-strong">{session.category_name}</span>
        <span className="text-caption text-ink-muted">· {t("fwConsult.title")}</span>
        <span className="ml-auto text-caption text-ink-secondary" data-id="fw-consult-step-label">{stepLabel}</span>
        <InterviewJsonPromptButton target={{ code: session.category_code, name: session.category_name, path: [] }} />
        <button type="button" data-id="fw-consult-abandon" className="rounded-sm px-2 py-1 text-caption text-ink-secondary hover:bg-surface-alt" onClick={() => setConfirmAbandon(true)}>
          {t("fwConsult.abandon")}
        </button>
      </header>
      {error && <div className="border-b border-hairline bg-surface-pearl px-3 py-1.5 text-caption text-error" data-id="fw-consult-error">{error}</div>}
      <div className="flex min-h-0 flex-1">
        <aside className="flex shrink-0 flex-col overflow-y-auto bg-surface-pearl" style={{ width: boardWidth }} data-id="fw-consult-board">
          <TaskBoard
            session={session}
            currentTaskId={current?.id ?? null}
            drawDurationsMs={drawDurations}
            onPause={() => void run(() => pauseFrameworkInterview(session.id))}
            onResume={() => void run(() => resumeFrameworkInterview(session.id))}
            onRetry={(taskPk) => void run(() => retryFrameworkTask(session.id, taskPk))}
            onPreview={setPreviewTaskId}
          />
        </aside>
        <div
          className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline transition-colors duration-150 hover:bg-accent/40"
          role="separator" aria-orientation="vertical" aria-label="Resize board" tabIndex={0}
          onPointerDown={handleDividerDown} data-id="fw-consult-divider"
        />
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface" data-id="fw-consult-step">
          {step === "plan" && (
            <PlanEditor
              session={session}
              busy={busy}
              onBriefChange={() => undefined}
              onAttach={(file) => void run(() => uploadFrameworkInterviewAttachment(session.id, file))}
              onGenerate={() => void run(() => generateFrameworkPlan(session.id))}
              onSave={(cards: FwPlanCard[]) => void run(() => saveFrameworkPlan(session.id, cards, false))}
              onLock={(cards: FwPlanCard[]) => void run(() => saveFrameworkPlan(session.id, cards, true))}
            />
          )}
          {(step === "answer" || step === "waiting") && (
            <AnswerStep
              key={current?.id ?? "none"}
              session={session}
              task={current}
              busy={busy}
              onSubmit={(taskPk: number, answers: Record<string, FwAnswerValue>) =>
                void run(() => submitFrameworkAnswers(session.id, taskPk, answers))}
            />
          )}
          {step === "relations" && (
            <RelationsStep
              session={session}
              busy={busy}
              onPropose={() => void run(() => generateFrameworkRelations(session.id))}
              onConfirm={(relations) => void run(() => confirmFrameworkRelations(session.id, relations))}
            />
          )}
          {(step === "register" || step === "done") && (
            <RegisterStep
              session={session}
              busy={busy}
              onApplied={() => void run(() => markFrameworkInterviewApplied(session.id))}
            />
          )}
        </section>
      </div>
      {previewTaskId !== null && (
        <RegisterStep.TaskPreviewModal sessionId={session.id} taskPk={previewTaskId} onClose={() => setPreviewTaskId(null)} />
      )}
      {confirmAbandon && (
        <ConfirmDialog
          title={t("fwConsult.abandon")}
          message={t("fwConsult.abandonConfirm")}
          confirmLabel={t("fwConsult.abandon")}
          cancelLabel="Cancel"
          danger
          onClose={() => setConfirmAbandon(false)}
          onConfirm={() => {
            setConfirmAbandon(false);
            abandonFrameworkInterview(session.id).then(() => router.push("/settings?tab=framework")).catch((err) => setError(getApiErrorDetail(err)));
          }}
        />
      )}
    </div>
  );
}
```

`ConfirmDialog` props (verified, `frontend/src/components/confirm-dialog.tsx:45`): `title`, `message?`, `confirmLabel`, `cancelLabel?`, `danger?`, `onConfirm`, `onClose`. The settings page has no `?tab=` deep link today; Task 13 adds it, so `/settings?tab=framework` links resolve after Task 13 (before that they land on the default tab, which is fine). `RegisterStep.TaskPreviewModal` is defined in Task 12; until then keep the preview button disabled in `TaskBoard` (pass `onPreview={undefined}`) to keep tsc green.

- [ ] **Step 2: Task board**

```tsx
"use client";

// 캠페인 L6 카드 보드 — 상태 칩·진행률·ETA·일시정지/재개·재시도·완료 카드 미리보기. 페이지 좌측 전용.

import { Loader2, Pause, Play, RotateCcw, Eye } from "lucide-react";

import type { FwInterviewSession, FwTaskStatus } from "@/lib/api";
import { deriveProgress } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";

const STATUS_TONE: Record<FwTaskStatus, { pill: string; dot: string; key: string }> = {
  pending: { pill: "bg-surface-alt text-ink-secondary", dot: "bg-ink-tertiary", key: "fwConsult.statusPending" },
  generating: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusGenerating" },
  ready: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusReady" },
  submitted: { pill: "bg-surface-alt text-ink-secondary", dot: "bg-ink-secondary", key: "fwConsult.statusSubmitted" },
  drawing: { pill: "bg-accent-tint text-accent", dot: "bg-accent", key: "fwConsult.statusDrawing" },
  drawn: { pill: "bg-surface-alt text-ink", dot: "bg-accent", key: "fwConsult.statusDrawn" },
  failed: { pill: "bg-surface-alt text-error", dot: "bg-error", key: "fwConsult.statusFailed" },
};

interface TaskBoardProps {
  session: FwInterviewSession;
  currentTaskId: number | null;
  drawDurationsMs: number[];
  onPause: () => void;
  onResume: () => void;
  onRetry: (taskPk: number) => void;
  onPreview?: (taskPk: number) => void;
}

export function TaskBoard({ session, currentTaskId, drawDurationsMs, onPause, onResume, onRetry, onPreview }: TaskBoardProps) {
  const { t } = useI18n();
  const progress = deriveProgress(session, drawDurationsMs);
  const locked = session.status !== "planning";
  const tasks = [...session.tasks].sort((a, b) => a.seq - b.seq);
  return (
    <div className="flex flex-col gap-3 p-3">
      {locked && (
        <div className="flex flex-col gap-1.5 rounded-md border border-hairline bg-surface p-2.5" data-id="fw-consult-progress">
          <div className="flex items-center gap-2 text-caption text-ink">
            {progress.working && <Loader2 size={14} strokeWidth={1.5} className="animate-spin text-accent" />}
            <span>{t("fwConsult.progress", { done: progress.done, total: progress.total })}</span>
            {progress.etaMs !== null && progress.done < progress.total && (
              <span className="text-ink-tertiary">· {t("fwConsult.eta", { minutes: Math.max(1, Math.round(progress.etaMs / 60000)) })}</span>
            )}
            <button
              type="button"
              data-id="fw-consult-pause-toggle"
              className="ml-auto inline-flex items-center gap-1 rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
              onClick={session.paused ? onResume : onPause}
              title={session.paused ? t("fwConsult.resumeRun") : t("fwConsult.pause")}
            >
              {session.paused ? <Play size={14} strokeWidth={1.5} /> : <Pause size={14} strokeWidth={1.5} />}
              {session.paused ? t("fwConsult.resumeRun") : t("fwConsult.pause")}
            </button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-xs bg-surface-alt">
            <div className="h-full bg-accent transition-[width] duration-350 ease-smooth" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
          {session.paused && <span className="text-fine text-ink-tertiary">{t("fwConsult.paused")}</span>}
        </div>
      )}
      <ol className="flex flex-col gap-1.5" data-id="fw-consult-task-list">
        {tasks.map((task) => {
          const tone = STATUS_TONE[task.status];
          const isCurrent = task.id === currentTaskId;
          return (
            <li
              key={task.id}
              data-id={`fw-consult-task-${task.id}`}
              data-status={task.status}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${isCurrent ? "border-accent bg-surface" : "border-hairline bg-surface"}`}
            >
              <span className="w-5 text-fine text-ink-tertiary tabular-nums">{task.seq}</span>
              <span className="min-w-0 flex-1 truncate text-caption text-ink">{task.name}</span>
              <span className={`inline-flex shrink-0 items-center gap-1 rounded-[6px] px-1.5 py-[3px] text-[11px] font-semibold leading-none ${tone.pill}`}>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} />
                {t(tone.key as never)}
              </span>
              {task.status === "failed" && (
                <button type="button" data-id={`fw-consult-task-retry-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.retry")} onClick={() => onRetry(task.id)}>
                  <RotateCcw size={14} strokeWidth={1.5} />
                </button>
              )}
              {task.status === "drawn" && onPreview && (
                <button type="button" data-id={`fw-consult-task-preview-${task.id}`} className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.preview")} onClick={() => onPreview(task.id)}>
                  <Eye size={14} strokeWidth={1.5} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {tasks.some((x) => x.error) && (
        <ul className="flex flex-col gap-1 text-fine text-error" data-id="fw-consult-task-errors">
          {tasks.filter((x) => x.error).map((x) => <li key={x.id}>{x.seq}. {x.error}</li>)}
        </ul>
      )}
    </div>
  );
}
```

`t(tone.key as never)`: replace with a typed lookup (`MessageKey`) by importing `type MessageKey` from `@/lib/i18n-messages` and typing `key: MessageKey`; do not ship the `as never` cast.

- [ ] **Step 3: Plan editor**

```tsx
"use client";

// 캠페인 ① L5 개요 + L6 카드 편집 — brief 입력·첨부·AI 제안·카드 추가/삭제/순서·계획 확정(잠금). 페이지 우측 전용.

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Paperclip, Plus, Sparkles, Trash2 } from "lucide-react";

import type { FwInterviewSession, FwPlanCard } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

const FIELD = "w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink";
const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface PlanEditorProps {
  session: FwInterviewSession;
  busy: boolean;
  onBriefChange: (brief: string) => void;
  onAttach: (file: File) => void;
  onGenerate: () => void;
  onSave: (cards: FwPlanCard[]) => void;
  onLock: (cards: FwPlanCard[]) => void;
}

const EMPTY: FwPlanCard = { name: "", summary: "", owner_role: "", department: "", depends_on: [] };

export function PlanEditor({ session, busy, onAttach, onGenerate, onSave, onLock }: PlanEditorProps) {
  const { t } = useI18n();
  const [cards, setCards] = useState<FwPlanCard[]>(session.plan ?? []);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setCards(session.plan ?? []); }, [session.plan]);

  function update(i: number, patch: Partial<FwPlanCard>) {
    setCards((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }
  function move(i: number, delta: number) {
    setCards((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  const canLock = cards.length > 0 && cards.every((c) => c.name.trim()) && new Set(cards.map((c) => c.name.trim())).size === cards.length;

  return (
    <div className="flex flex-col gap-4 p-4" data-id="fw-consult-plan">
      <div className="flex flex-col gap-1.5">
        <label className="text-caption text-ink-secondary" htmlFor="fw-consult-brief">{t("fwConsult.brief")}</label>
        <textarea id="fw-consult-brief" data-id="fw-consult-brief" className={`${FIELD} min-h-24`} defaultValue={session.brief} readOnly placeholder={t("fwConsult.briefPlaceholder")} />
        <div className="flex gap-2">
          <input ref={fileRef} type="file" className="hidden" accept=".pdf,.docx,.xlsx,.txt,.md" data-id="fw-consult-attach-input"
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
          <button type="button" className={SECONDARY} data-id="fw-consult-attach" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} strokeWidth={1.5} />{t("fwConsult.attach")}
          </button>
          <button type="button" className={SECONDARY} data-id="fw-consult-generate-plan" disabled={busy} onClick={onGenerate}>
            <Sparkles size={14} strokeWidth={1.5} />{cards.length ? t("fwConsult.regeneratePlan") : t("fwConsult.generatePlan")}
          </button>
        </div>
      </div>
      <ol className="flex flex-col gap-2" data-id="fw-consult-plan-cards">
        {cards.map((card, i) => (
          <li key={i} data-id={`fw-consult-plan-card-${i}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 rounded-md border border-hairline bg-surface-pearl p-2.5">
            <span className="pt-1 text-fine text-ink-tertiary tabular-nums">{i + 1}</span>
            <div className="grid grid-cols-2 gap-1.5">
              <input className={`${FIELD} col-span-2`} data-id={`fw-consult-plan-name-${i}`} value={card.name} placeholder={t("fwConsult.cardName")} onChange={(e) => update(i, { name: e.target.value })} />
              <input className={`${FIELD} col-span-2`} data-id={`fw-consult-plan-summary-${i}`} value={card.summary} placeholder={t("fwConsult.cardSummary")} onChange={(e) => update(i, { summary: e.target.value })} />
              <input className={FIELD} data-id={`fw-consult-plan-role-${i}`} value={card.owner_role} placeholder={t("fwConsult.cardRole")} onChange={(e) => update(i, { owner_role: e.target.value })} />
              <input className={FIELD} data-id={`fw-consult-plan-dept-${i}`} value={card.department} placeholder={t("fwConsult.cardDept")} onChange={(e) => update(i, { department: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveUp")} data-id={`fw-consult-plan-up-${i}`} onClick={() => move(i, -1)}><ArrowUp size={14} strokeWidth={1.5} /></button>
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveDown")} data-id={`fw-consult-plan-down-${i}`} onClick={() => move(i, 1)}><ArrowDown size={14} strokeWidth={1.5} /></button>
              <button type="button" className="rounded-sm p-1 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.removeCard")} data-id={`fw-consult-plan-remove-${i}`} onClick={() => setCards((prev) => prev.filter((_, k) => k !== i))}><Trash2 size={14} strokeWidth={1.5} /></button>
            </div>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2">
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-add" onClick={() => setCards((prev) => [...prev, { ...EMPTY }])}>
          <Plus size={14} strokeWidth={1.5} />{t("fwConsult.addCard")}
        </button>
        <span className="ml-auto text-fine text-ink-tertiary">{t("fwConsult.lockPlanHint")}</span>
        <button type="button" className={SECONDARY} data-id="fw-consult-plan-save" disabled={busy} onClick={() => onSave(cards)}>Save</button>
        <button type="button" className={PRIMARY} data-id="fw-consult-plan-lock" disabled={busy || !canLock} onClick={() => onLock(cards)}>{t("fwConsult.lockPlan")}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Temporary stubs so tsc passes before Tasks 11–12**

Create minimal placeholder exports for `AnswerStep` (`questionnaire-form.tsx`), `RelationsStep` (`relations-step.tsx`), `RegisterStep` (`register-step.tsx`) that render `null` with the props typed as in Tasks 11–12. They are replaced in the next tasks.

- [ ] **Step 5: Gates + manual check**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && node scripts/build-component-catalog.mjs`
Manual: start backend (`AI_ENABLED=true` + a fake endpoint is not needed for the plan editor without generate) and frontend, create a session with `curl -X POST localhost:8000/api/framework-interviews -H 'X-Dev-User: admin.sys' -H 'Content-Type: application/json' -d '{"category_id": <L5 id>}'`, open `/framework/consult/<id>`, add two cards, lock, see the board switch to "Preparing".

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/framework/consult frontend/src/components/framework-interview frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-interview): campaign page shell, task board and plan editor — 캠페인 페이지 골격·카드 보드·계획 편집"
```

---

## Task 11: Questionnaire form + answer review

**Files:**
- Replace stub: `frontend/src/components/framework-interview/questionnaire-form.tsx` (exports `AnswerStep` and `QuestionnaireForm`)
- Create: `frontend/src/components/framework-interview/answer-review.tsx` (exports `AnswerReview`)

**Interfaces:**
- `AnswerStep({ session, task, busy, onSubmit })` — loads the task detail (`getFrameworkInterviewTask`) when `task.status === "ready"`, shows a skeleton while `pending|generating`, holds `answers` state initialised with `fillSuggested`, switches between form and review, submits `buildSubmitPayload(...)`.
- `QuestionnaireForm({ questionnaire, answers, onChange, missing })` — renders by kind: `single` radios (`CheckInput` styled as radio is not available; use a native `<input type="radio">` wrapped in a label), `multi` checkboxes via `CheckInput`, `ordered` checkboxes plus up/down order controls, `text` textarea with placeholder `fwConsult.textPlaceholder`.
- `AnswerReview({ questionnaire, answers })` — read-only list; blank text shows the suggestion with the `fwConsult.autoApplied` badge.

- [ ] **Step 1: `questionnaire-form.tsx`**

```tsx
"use client";

// 캠페인 ② L6 설문 단계 — 문항 렌더(객관식 위주·제안 선택됨·주관식 플레이스홀더=제안)·제안 일괄 채우기·
// 확인 화면 전환·제출. 제출 후 카드는 잠기고 백그라운드 드로잉으로 넘어간다 (spec 2026-09-21 §2·§4).

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Sparkles } from "lucide-react";

import { getApiErrorDetail, getFrameworkInterviewTask, type FwAnswerValue, type FwInterviewSession, type FwInterviewTask, type FwQuestionnaire } from "@/lib/api";
import { buildSubmitPayload, fillSuggested, validateAnswers } from "@/lib/framework-interview";
import { useI18n } from "@/lib/i18n";
import { CheckInput } from "@/components/check-input";
import { AnswerReview } from "@/components/framework-interview/answer-review";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface QuestionnaireFormProps {
  questionnaire: FwQuestionnaire;
  answers: Record<string, FwAnswerValue>;
  missing: string[];
  onChange: (qid: string, value: FwAnswerValue) => void;
}

export function QuestionnaireForm({ questionnaire, answers, missing, onChange }: QuestionnaireFormProps) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-col gap-3" data-id="fw-consult-questions">
      {questionnaire.questions.map((q, idx) => {
        const value = answers[q.id];
        const isMissing = missing.includes(q.id);
        const list = Array.isArray(value) ? value : [];
        return (
          <li key={q.id} data-id={`fw-consult-question-${q.id}`} className={`flex flex-col gap-1.5 rounded-md border p-3 ${isMissing ? "border-error" : "border-hairline"} bg-surface-pearl`}>
            <p className="text-caption text-ink"><span className="text-ink-tertiary tabular-nums">{idx + 1}. </span>{q.text}</p>
            {q.kind === "text" && (
              <textarea
                data-id={`fw-consult-answer-${q.id}`}
                className="min-h-16 w-full rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
                value={typeof value === "string" ? value : ""}
                placeholder={t("fwConsult.textPlaceholder", { suggested: typeof q.suggested === "string" ? q.suggested : "" })}
                onChange={(e) => onChange(q.id, e.target.value)}
              />
            )}
            {q.kind === "single" && (
              <div className="flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <label key={o.id} className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-caption ${value === o.id ? "border-accent bg-accent-tint text-accent" : "border-hairline bg-surface text-ink"}`}>
                    <input type="radio" name={q.id} className="sr-only" checked={value === o.id} data-id={`fw-consult-answer-${q.id}-${o.id}`} onChange={() => onChange(q.id, o.id)} />
                    {o.label}
                  </label>
                ))}
              </div>
            )}
            {(q.kind === "multi" || q.kind === "ordered") && (
              <ul className="flex flex-col gap-1">
                {(q.kind === "ordered" ? [...list.map((id) => q.options.find((o) => o.id === id)).filter(Boolean), ...q.options.filter((o) => !list.includes(o.id))] : q.options).map((o) => {
                  if (!o) return null;
                  const checked = list.includes(o.id);
                  const pos = list.indexOf(o.id);
                  return (
                    <li key={o.id} className="flex items-center gap-2">
                      <CheckInput
                        checked={checked}
                        data-id={`fw-consult-answer-${q.id}-${o.id}`}
                        aria-label={o.label}
                        onChange={() => onChange(q.id, checked ? list.filter((v) => v !== o.id) : [...list, o.id])}
                      />
                      <span className={`text-caption ${checked ? "text-ink" : "text-ink-secondary"}`}>{o.label}</span>
                      {q.kind === "ordered" && checked && (
                        <span className="ml-auto flex items-center gap-0.5">
                          <span className="text-fine text-ink-tertiary tabular-nums">{pos + 1}</span>
                          <button type="button" className="rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveUp")} data-id={`fw-consult-answer-up-${q.id}-${o.id}`} disabled={pos === 0}
                            onClick={() => { const next = [...list]; [next[pos - 1], next[pos]] = [next[pos], next[pos - 1]]; onChange(q.id, next); }}>
                            <ArrowUp size={14} strokeWidth={1.5} />
                          </button>
                          <button type="button" className="rounded-sm p-0.5 text-ink-secondary hover:bg-surface-alt" title={t("fwConsult.moveDown")} data-id={`fw-consult-answer-down-${q.id}-${o.id}`} disabled={pos === list.length - 1}
                            onClick={() => { const next = [...list]; [next[pos + 1], next[pos]] = [next[pos], next[pos + 1]]; onChange(q.id, next); }}>
                            <ArrowDown size={14} strokeWidth={1.5} />
                          </button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}

interface AnswerStepProps {
  session: FwInterviewSession;
  task: FwInterviewTask | null;
  busy: boolean;
  onSubmit: (taskPk: number, answers: Record<string, FwAnswerValue>) => void;
}

export function AnswerStep({ session, task, busy, onSubmit }: AnswerStepProps) {
  const { t } = useI18n();
  const [questionnaire, setQuestionnaire] = useState<FwQuestionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, FwAnswerValue>>({});
  const [reviewing, setReviewing] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 카드가 바뀌면 설문지를 다시 받고 제안값으로 초기화 — 제출된 카드는 돌아오지 않으므로 캐시 불필요.
  // 페이지가 <AnswerStep key={task.id}>로 리마운트하므로 여기서는 fetch만 한다(set-state-in-effect 린트 회피).
  useEffect(() => {
    if (!task || task.status !== "ready") return;
    let alive = true;
    getFrameworkInterviewTask(session.id, task.id)
      .then((detail) => {
        if (!alive || !detail.questionnaire) return;
        setQuestionnaire(detail.questionnaire);
        setAnswers(fillSuggested(detail.questionnaire));
      })
      .catch((err) => { if (alive) setLoadError(getApiErrorDetail(err)); });
    return () => { alive = false; };
  }, [session.id, task]);

  if (!task) return null;
  if (task.status !== "ready" || !questionnaire) {
    return (
      <div className="flex min-h-44 flex-col items-center justify-center gap-2" data-id="fw-consult-waiting">
        <Loader2 size={20} strokeWidth={1.5} className="animate-spin text-accent" />
        <span className="text-caption text-ink-secondary">{loadError ?? t("fwConsult.waitingQuestionnaire", { name: task.name })}</span>
      </div>
    );
  }
  const handleReview = () => {
    const miss = validateAnswers(questionnaire, answers);
    setMissing(miss);
    if (miss.length === 0) setReviewing(true);
  };
  return (
    <div className="flex flex-col gap-3 p-4" data-id="fw-consult-answer">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{task.seq}. {task.name}</span>
        {!reviewing && (
          <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-fill-all" onClick={() => setAnswers(fillSuggested(questionnaire))}>
            <Sparkles size={14} strokeWidth={1.5} />{t("fwConsult.fillAll")}
          </button>
        )}
      </div>
      {reviewing ? (
        <AnswerReview questionnaire={questionnaire} answers={answers} />
      ) : (
        <QuestionnaireForm questionnaire={questionnaire} answers={answers} missing={missing} onChange={(qid, v) => setAnswers((prev) => ({ ...prev, [qid]: v }))} />
      )}
      {missing.length > 0 && <p className="text-caption text-error" data-id="fw-consult-missing">{t("fwConsult.missing")}</p>}
      <div className="flex items-center gap-2">
        <span className="text-fine text-ink-tertiary">{t("fwConsult.submitHint")}</span>
        {reviewing ? (
          <>
            <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-back-edit" onClick={() => setReviewing(false)}>{t("fwConsult.backToEdit")}</button>
            <button type="button" className={PRIMARY} data-id="fw-consult-submit" disabled={busy} onClick={() => onSubmit(task.id, buildSubmitPayload(questionnaire, answers))}>{t("fwConsult.submit")}</button>
          </>
        ) : (
          <button type="button" className={`${PRIMARY} ml-auto`} data-id="fw-consult-review" onClick={handleReview}>{t("fwConsult.review")}</button>
        )}
      </div>
    </div>
  );
}
```

In the page (Task 10), render `<AnswerStep key={current?.id ?? "none"} …>` so each card remounts with fresh state.

- [ ] **Step 2: `answer-review.tsx`**

```tsx
"use client";

// 캠페인 설문 확인 화면 — 문항별 최종값 읽기 전용, 빈 주관식은 제안값 + "Suggestion applied" 배지. AnswerStep 전용.

import type { FwAnswerValue, FwQuestionnaire } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

export function AnswerReview({ questionnaire, answers }: { questionnaire: FwQuestionnaire; answers: Record<string, FwAnswerValue> }) {
  const { t } = useI18n();
  return (
    <ol className="flex flex-col gap-2" data-id="fw-consult-review-list">
      {questionnaire.questions.map((q, idx) => {
        const value = answers[q.id];
        const labels = new Map(q.options.map((o) => [o.id, o.label]));
        const auto = q.kind === "text" && (typeof value !== "string" || value.trim() === "");
        const shown = q.kind === "text"
          ? (auto ? (typeof q.suggested === "string" ? q.suggested : "") : String(value))
          : Array.isArray(value) ? value.map((v) => labels.get(v) ?? v).join(q.kind === "ordered" ? " → " : ", ") : (labels.get(String(value)) ?? "");
        return (
          <li key={q.id} data-id={`fw-consult-review-${q.id}`} className="flex flex-col gap-0.5 rounded-md border border-hairline bg-surface-pearl px-3 py-2">
            <span className="text-fine text-ink-tertiary">{idx + 1}. {q.text}</span>
            <span className="flex items-center gap-2 text-caption text-ink">
              {shown}
              {auto && <span className="rounded-full border border-hairline px-2 py-[2px] text-[11px] leading-none text-ink-tertiary" data-id={`fw-consult-auto-${q.id}`}>{t("fwConsult.autoApplied")}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
```

- [ ] **Step 3: Gates**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && node scripts/build-component-catalog.mjs`
Expected: clean. Lint rule "set-state-in-effect" (see `docs/lessons/react-ts-patterns.md`): the effect above sets state synchronously on task change; if the linter flags it, move the resets into the `.then` and a `key={task?.id}` remount on `<AnswerStep>` from the page instead (preferred: add `key={current?.id ?? "none"}` on the page and drop the sync resets).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/framework-interview/questionnaire-form.tsx frontend/src/components/framework-interview/answer-review.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-interview): questionnaire form and answer review — L6 설문 폼(객관식·순서·제안 채우기)·제출 전 확인 화면"
```

---

## Task 12: Relations step, register step, drawn-card preview

**Files:**
- Replace stub: `frontend/src/components/framework-interview/relations-step.tsx`
- Replace stub: `frontend/src/components/framework-interview/register-step.tsx`
- Modify: `frontend/src/components/admin/import-report/map-preview.tsx` — no change needed; `ImportMapPreview({ source, scope, dataId, onClose })` is reused as-is.

**Interfaces:**
- `RelationsStep({ session, busy, onPropose, onConfirm })` — builds a preview document `{ rows, relations }` from the session (rows from `getFrameworkInterviewTask` details, fetched once) and renders `ImportMapPreview` with `scope="canvas"`; edges are edited in a compact table (src/dst selects over task ids, kind select, condition text); `onConfirm(relations)`.
- `RegisterStep({ session, busy, onApplied })` — fetches the document, runs `importInterview({ files:[{name, content}], apply:false })`, renders `InterviewImportReport` with `buildInterviewIndex` / `buildImportReportView`, on Apply runs `apply:true` then `onApplied()`; download button serialises the document to a `.json` blob; done state shows the L5 canvas link (`/maps/{linkage_map_id}` via `getCategoryChain`'s `linkage_map_id`, or fall back to opening `/settings?tab=framework`).
- `RegisterStep.TaskPreviewModal({ sessionId, taskPk, onClose })` — `ModalBackdrop` + `ImportMapPreview scope="map"` over `{ taskId, ...row }`.

- [ ] **Step 1: `relations-step.tsx`**

```tsx
"use client";

// 캠페인 ③ L6 연결 — AI 제안 relations를 표로 편집(entry·edges)하고 L5 캔버스 미리보기(ImportMapPreview scope=canvas)로 확인 후 확정.

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";

import { getApiErrorDetail, getFrameworkInterviewTask, type FwInterviewSession } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { ImportMapPreview } from "@/components/admin/import-report/map-preview";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";
const FIELD = "rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink";
const KINDS = ["seq", "branch", "loop", "bypass"] as const;

interface Edge { src: string; dst: string; kind: (typeof KINDS)[number]; gateway?: "exclusive" | "parallel" | null; condition?: string | null; label?: string | null }
interface Relations { entry: { taskId: string; triggerType: "manual" | "timer" | "message" | "condition"; label?: string | null }; edges: Edge[] }

interface RelationsStepProps {
  session: FwInterviewSession;
  busy: boolean;
  onPropose: () => void;
  onConfirm: (relations: Record<string, unknown>) => void;
}

export function RelationsStep({ session, busy, onPropose, onConfirm }: RelationsStepProps) {
  const { t } = useI18n();
  const taskIds = useMemo(() => [...session.tasks].sort((a, b) => a.seq - b.seq).map((x) => x.task_id), [session.tasks]);
  const [relations, setRelations] = useState<Relations>(() => (session.relations as Relations | null) ?? { entry: { taskId: taskIds[0] ?? "", triggerType: "manual", label: "" }, edges: [] });
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (session.relations) setRelations(session.relations as Relations); }, [session.relations]);
  useEffect(() => {
    let alive = true;
    Promise.all(session.tasks.map((x) => getFrameworkInterviewTask(session.id, x.id)))
      .then((details) => { if (alive) setRows(details.map((d) => ({ taskId: d.task_id, ...(d.row ?? {}) }))); })
      .catch((err) => { if (alive) setError(getApiErrorDetail(err)); });
    return () => { alive = false; };
  }, [session.id, session.tasks]);

  const previewSource = useMemo(() => (rows ? { rows, relations } : null), [rows, relations]);
  function updateEdge(i: number, patch: Partial<Edge>) {
    setRelations((prev) => ({ ...prev, edges: prev.edges.map((e, k) => (k === i ? { ...e, ...patch } : e)) }));
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4" data-id="fw-consult-relations">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRelations")}</span>
        <span className="text-fine text-ink-tertiary">{t("fwConsult.relationsHint")}</span>
        <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-propose-relations" disabled={busy} onClick={onPropose}>
          <Sparkles size={14} strokeWidth={1.5} />{t("fwConsult.proposeRelations")}
        </button>
        <button type="button" className={PRIMARY} data-id="fw-consult-confirm-relations" disabled={busy || !relations.entry.taskId} onClick={() => onConfirm(relations as unknown as Record<string, unknown>)}>
          {t("fwConsult.confirmRelations")}
        </button>
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
      <div className="flex items-center gap-2 text-caption">
        <span className="text-ink-secondary">Entry</span>
        <select className={FIELD} data-id="fw-consult-entry" value={relations.entry.taskId} onChange={(e) => setRelations((p) => ({ ...p, entry: { ...p.entry, taskId: e.target.value } }))}>
          {taskIds.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select className={FIELD} data-id="fw-consult-entry-trigger" value={relations.entry.triggerType} onChange={(e) => setRelations((p) => ({ ...p, entry: { ...p.entry, triggerType: e.target.value as Relations["entry"]["triggerType"] } }))}>
          {["manual", "timer", "message", "condition"].map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      </div>
      <table className="w-full text-fine" data-id="fw-consult-edges">
        <thead><tr className="text-ink-tertiary"><th className="text-left">src</th><th className="text-left">dst</th><th className="text-left">kind</th><th className="text-left">gateway</th><th className="text-left">condition</th><th /></tr></thead>
        <tbody>
          {relations.edges.map((e, i) => (
            <tr key={i} data-id={`fw-consult-edge-${i}`}>
              <td><select className={FIELD} value={e.src} onChange={(ev) => updateEdge(i, { src: ev.target.value })}>{taskIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></td>
              <td><select className={FIELD} value={e.dst} onChange={(ev) => updateEdge(i, { dst: ev.target.value })}>{taskIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></td>
              <td><select className={FIELD} value={e.kind} onChange={(ev) => updateEdge(i, { kind: ev.target.value as Edge["kind"] })}>{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></td>
              <td><select className={FIELD} value={e.gateway ?? ""} onChange={(ev) => updateEdge(i, { gateway: (ev.target.value || null) as Edge["gateway"] })}><option value="">-</option><option value="exclusive">exclusive</option><option value="parallel">parallel</option></select></td>
              <td><input className={`${FIELD} w-full`} value={e.condition ?? ""} onChange={(ev) => updateEdge(i, { condition: ev.target.value })} /></td>
              <td><button type="button" className="rounded-sm px-1 text-ink-secondary hover:bg-surface-alt" data-id={`fw-consult-edge-remove-${i}`} onClick={() => setRelations((p) => ({ ...p, edges: p.edges.filter((_, k) => k !== i) }))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className={SECONDARY} data-id="fw-consult-edge-add" onClick={() => setRelations((p) => ({ ...p, edges: [...p.edges, { src: taskIds[0] ?? "", dst: taskIds[1] ?? taskIds[0] ?? "", kind: "seq" }] }))}>+ edge</button>
      {previewSource && (
        <div className="min-h-64 flex-1">
          <ImportMapPreview source={previewSource} scope="canvas" dataId="fw-consult-relations-preview" onClose={() => undefined} />
        </div>
      )}
    </div>
  );
}
```

Check `ImportMapPreview`'s close affordance: if it renders its own close button, pass a no-op and hide it via a wrapper class, or add an optional `hideClose?: boolean` prop to `map-preview.tsx` (a one-line prop addition is acceptable; regenerate `COMPONENTS.md`).

- [ ] **Step 2: `register-step.tsx`**

```tsx
"use client";

// 캠페인 ④ 등록 — 조립된 0.5 문서를 기존 인터뷰 임포트(dry-run→apply)로 넣고 리포트 UI를 재사용. JSON 다운로드·완료 안내.
// TaskPreviewModal: 완료 카드 미리보기(ImportMapPreview scope=map).

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";

import {
  getApiErrorDetail, getFrameworkInterviewDocument, getFrameworkInterviewTask, importInterview,
  type FwInterviewSession, type GovernanceDecision, type InterviewImportResult,
} from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { buildImportReportView, buildInterviewIndex } from "@/lib/interview-report";
import { ImportMapPreview } from "@/components/admin/import-report/map-preview";
import { InterviewImportReport, type InterviewPhase } from "@/components/admin/import-report/interview-import-report";
import { ModalBackdrop } from "@/components/modal-backdrop";

const PRIMARY = "rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40";
const SECONDARY = "inline-flex items-center gap-1.5 rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink hover:bg-surface-alt disabled:opacity-40";

interface RegisterStepProps { session: FwInterviewSession; busy: boolean; onApplied: () => void }

export function RegisterStep({ session, busy, onApplied }: RegisterStepProps) {
  const { t } = useI18n();
  const [doc, setDoc] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<InterviewImportResult | null>(null);
  const [phase, setPhase] = useState<InterviewPhase>(null);
  const [governanceChecked, setGovernanceChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const fileName = `${session.category_code}-ai-consult.json`;
  const files = useMemo(() => (doc ? [{ name: fileName, content: doc }] : []), [doc, fileName]);
  const index = useMemo(() => buildInterviewIndex(files), [files]);
  const view = useMemo(() => (result ? buildImportReportView(result.rows, index, result.files) : null), [result, index]);

  useEffect(() => {
    let alive = true;
    getFrameworkInterviewDocument(session.id).then((d) => { if (alive) setDoc(d); }).catch((err) => { if (alive) setError(getApiErrorDetail(err)); });
    return () => { alive = false; };
  }, [session.id]);

  const governanceKey = (d: { code: string; field: string }) => `${d.code}::${d.field}`;
  const parseGovernanceKey = (key: string): GovernanceDecision => {
    const [code, field] = key.split("::");
    return { code, field: field as GovernanceDecision["field"] };
  };

  async function runImport(apply: boolean) {
    if (!doc) return;
    setPhase(apply ? "apply" : "dryrun");
    setError(null);
    try {
      const r = await importInterview({ files, apply, label: session.label, decisions: apply ? [...governanceChecked].map(parseGovernanceKey) : undefined });
      setResult(r);
      if (!apply) setGovernanceChecked(new Set(r.governance.filter((d) => d.default_checked).map(governanceKey)));
      if (apply && r.applied) onApplied();
    } catch (err) {
      setError(getApiErrorDetail(err));
    } finally {
      setPhase(null);
    }
  }

  function download() {
    if (!doc) return;
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
  }

  if (session.status === "applied") {
    return (
      <div className="flex flex-col gap-3 p-4" data-id="fw-consult-done">
        <p className="text-caption text-ink">{t("fwConsult.done")}</p>
        <div className="flex gap-2">
          <a className={SECONDARY} data-id="fw-consult-open-canvas" href={`/?category=${session.category_id}`}>{t("fwConsult.openCanvas")}</a>
          <button type="button" className={SECONDARY} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-4" data-id="fw-consult-register">
      <div className="flex items-center gap-2">
        <span className="text-body-strong text-ink">{t("fwConsult.stepRegister")}</span>
        <button type="button" className={`${SECONDARY} ml-auto`} data-id="fw-consult-download" onClick={download} disabled={!doc}><Download size={14} strokeWidth={1.5} />{t("fwConsult.download")}</button>
        <button type="button" className={SECONDARY} data-id="fw-consult-dryrun" disabled={busy || !doc || phase !== null} onClick={() => void runImport(false)}>{t("fwConsult.dryRun")}</button>
      </div>
      {error && <p className="text-caption text-error" data-id="fw-consult-register-error">{error}</p>}
      {result && view && (
        <InterviewImportReport
          result={result} view={view} index={index} files={files}
          governanceChecked={governanceChecked}
          onToggleGovernance={(key) => setGovernanceChecked((prev) => { const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next; })}
          onToggleAllGovernance={(next) => setGovernanceChecked(next ? new Set(result.governance.map(governanceKey)) : new Set())}
          phase={phase}
          onCancel={() => { setResult(null); setGovernanceChecked(new Set()); }}
          onApply={() => void runImport(true)}
          onToast={(m) => setError(m)}
        />
      )}
    </div>
  );
}

RegisterStep.TaskPreviewModal = function TaskPreviewModal({ sessionId, taskPk, onClose }: { sessionId: number; taskPk: number; onClose: () => void }) {
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let alive = true;
    getFrameworkInterviewTask(sessionId, taskPk).then((d) => { if (alive) setSource({ taskId: d.task_id, ...(d.row ?? {}) }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [sessionId, taskPk]);
  return (
    <ModalBackdrop onClose={onClose} className="flex items-center justify-center">
      <div className="h-[70vh] w-[80vw] rounded-md bg-surface p-3" data-id="fw-consult-task-preview">
        {source && <ImportMapPreview source={source} scope="map" dataId="fw-consult-task-preview-canvas" onClose={onClose} />}
      </div>
    </ModalBackdrop>
  );
};
```

Check the `GovernanceDiff` shape in `api.ts:3280` for the exact `default_checked` field name and the `governanceKey`/`parseGovernanceKey` helpers already defined in `framework-panel.tsx`; if they are module-private there, move them to `frontend/src/lib/interview-report.ts` as exports and import from both places (small shared-helper extraction, regenerate nothing). `ModalBackdrop` z-index must follow the ladder (1200 modal); it already does.

The "Open L5 canvas" link: the home page opens a category via its own state; if there is no `?category=` deep link, replace the anchor with a button that calls `openLinkageMap(session.category_id)` from `@/lib/api:3022` and `router.push(\`/maps/${map_id}\`)`.

- [ ] **Step 3: Gates**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run && node scripts/build-component-catalog.mjs`

- [ ] **Step 4: End-to-end manual check with a fake AI endpoint**

Start backend with `AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_API_TOKEN=x` and a tiny fake OpenAI-compatible server (put it in the scratchpad, not the repo) that returns, in order, the plan JSON, questionnaire JSON per card, row JSON per card, and relations JSON (dispatch on a marker in the system prompt: "L6 단위 업무 목록" → plan, "설문지를 만드세요" → questionnaire, "rows[] 원소" → row, "연계 캔버스" → relations). Walk: admin tab → start → plan → lock → answer 2 cards → relations → dry-run → apply → tree shows the new L6 maps and the L5 canvas draft. Capture screenshots of the board mid-run and the register step (user rule: share screenshots for UI work).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/framework-interview frontend/src/lib/interview-report.ts frontend/src/components/admin/framework-panel.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-interview): relations editor with L5 preview and register via interview import — L6 연결 편집·L5 미리보기·임포트 리포트 재사용 등록"
```

---

## Task 13: Admin panel entry (start, resume, copy prompt) + settings tab deep link

**Files:**
- Modify: `frontend/src/components/admin/framework-panel.tsx` (interview import section, lines ~607–690)
- Modify: `frontend/src/app/settings/page.tsx` (~line 136: initial tab from `?tab=`)

**Interfaces:**
- New panel state: `activeSessions: FwInterviewSession[]`, `consultL5Id: number | null`, `consultBusy`.
- Uses `listFrameworkInterviews(true)`, `createFrameworkInterview({ category_id })`, `router.push(\`/framework/consult/${id}\`)`.
- L5 chooser: `SearchSelect` over the level-5 rows of the panel's already loaded tree (`options = l5Rows.map((r) => ({ value: String(r.id), label: r.name, sub: pathOf(r) }))`). Look at how the panel builds its tree rows (`refreshTree`, ~line 220) and reuse the flattened rows; add a `level === 5` filter.

- [ ] **Step 1: Panel JSX (insert directly under the interview import `<div>` header, before the file input)**

```tsx
          <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface-pearl p-3" data-id="fw-consult-entry">
            <div className="flex items-center gap-2">
              <Headset size={16} strokeWidth={1.5} className="text-accent" />
              <span className="text-caption text-ink">{t("fwConsult.start")}</span>
              <span className="ml-auto"><InterviewJsonPromptButton target={consultTarget} /></span>
            </div>
            <p className="text-fine text-ink-tertiary">{t("fwConsult.startHint")}</p>
            <div className="flex items-center gap-2">
              <div className="min-w-64">
                <SearchSelect
                  value={consultL5Id ? String(consultL5Id) : ""}
                  options={l5Options}
                  emptyLabel={t("fwConsult.pickL5")}
                  placeholder={t("fwConsult.pickL5")}
                  onChange={(v) => setConsultL5Id(v ? Number(v) : null)}
                />
              </div>
              <button
                type="button"
                data-id="fw-consult-start"
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
                disabled={!consultL5Id || consultBusy}
                onClick={() => void handleStartConsult()}
              >
                {t("fwConsult.start")}
              </button>
            </div>
            {activeSessions.length > 0 && (
              <ul className="flex flex-col gap-1" data-id="fw-consult-active-list">
                <li className="text-fine text-ink-tertiary">{t("fwConsult.activeSessions")}</li>
                {activeSessions.map((s) => (
                  <li key={s.id} data-id={`fw-consult-active-${s.id}`} className="flex items-center gap-2 text-caption text-ink">
                    <span className="truncate">{s.category_name}</span>
                    <span className="text-fine text-ink-tertiary">{s.progress.drawn}/{s.progress.total}</span>
                    <Link href={`/framework/consult/${s.id}`} className="ml-auto text-accent hover:underline" data-id={`fw-consult-resume-${s.id}`}>{t("fwConsult.resume")}</Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
```

Handlers and state inside `FrameworkPanel`:

```tsx
  const router = useRouter();
  const [consultL5Id, setConsultL5Id] = useState<number | null>(null);
  const [consultBusy, setConsultBusy] = useState(false);
  const [activeSessions, setActiveSessions] = useState<FwInterviewSession[]>([]);
  useEffect(() => {
    if (scopeRootIds) return; // sysadmin only, same gate as the import
    listFrameworkInterviews(true).then(setActiveSessions).catch((err) => console.warn("fw sessions", err));
  }, [scopeRootIds]);
  const l5Options = useMemo(() => flatRows.filter((r) => r.level === 5).map((r) => ({ value: String(r.id), label: r.name, sub: r.path })), [flatRows]);
  const consultTarget = useMemo(() => {
    const row = flatRows.find((r) => r.id === consultL5Id);
    return row ? { code: row.code, name: row.name, path: row.pathParts } : undefined;
  }, [flatRows, consultL5Id]);

  async function handleStartConsult() {
    if (!consultL5Id) return;
    setConsultBusy(true);
    try {
      const s = await createFrameworkInterview({ category_id: consultL5Id, lang });
      router.push(`/framework/consult/${s.id}`);
    } catch (err) {
      const detail = getApiErrorDetail(err);
      // 409 = 진행 중 세션 존재 → 목록에서 재개하도록 안내
      onToast(detail);
      listFrameworkInterviews(true).then(setActiveSessions).catch(() => undefined);
    } finally {
      setConsultBusy(false);
    }
  }
```

`flatRows` is whatever the panel already uses for its tree (check the name near `refreshTree`; if it stores a nested tree, write a tiny `flattenRows(tree)` in the panel returning `{ id, code, name, level, path: "A > B", pathParts: ["A","B"] }`).

- [ ] **Step 2: Settings deep link**

In `frontend/src/app/settings/page.tsx` next to `const [activeTab, setActiveTab] = useState<TabId | null>(null);`, initialise from the URL once:

```tsx
  const [activeTab, setActiveTab] = useState<TabId | null>(() => {
    if (typeof window === "undefined") return null;
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "framework" ? "framework" : null;
  });
```

(only `framework` is whitelisted; unknown values fall back as before.)

- [ ] **Step 3: Gates**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/admin/framework-panel.tsx frontend/src/app/settings/page.tsx PROGRESS.md
git commit -m "feat(fw-interview): admin panel entry, resume list, settings tab deep link — 관리자 탭 진입·진행 중 세션 복귀·설정 탭 딥링크"
```

---

## Task 14: Playwright smoke, manuals, CLAUDE.md contract line

**Files:**
- Create: `frontend/scripts/pw-fw-consult.mjs`
- Modify: `docs/manual/admin-manual-ko.md`, `docs/manual/admin-manual-en.md` (new section after the interview import section)
- Modify: `CLAUDE.md` Lessons list (one bullet)
- Modify: `PROGRESS.md`

- [ ] **Step 1: Fake AI server for the smoke (scratchpad, not committed)**

`/private/tmp/.../fake-ai.mjs`: an HTTP server on `:9999` answering `POST /v1/chat/completions` with `{ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }`, choosing `content` by the system prompt marker (plan / questionnaire / row / relations; use the same JSON fixtures as `backend/tests/test_framework_interview_runner.py`, with card names read from the user message so `l6` matches). Start backend with `AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_API_TOKEN=x DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=admin.sys` (local ports per memory: backend 8048 / frontend 3047 if 8000/3000 are occupied by db-viewer; `BACKEND_URL=http://localhost:8048 npm run dev -- -p 3047`).

- [ ] **Step 2: Smoke script**

```js
// AI L5 캠페인 스모크 — 관리자 탭 진입 → 계획 확정 → 설문 1건 제출 → 카드 상태 전이 → 연결 확정 → dry-run 리포트.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-fw-consult.mjs
// 전제: fake AI(9999) + backend(AI_ENABLED=true) + frontend 기동, L5 카테고리 1개 존재(시드 또는 임포트 샘플).
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();

await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="fw-consult-entry"]').waitFor();
check("entry visible", true);
await page.locator('[data-id="fw-consult-entry"] input').first().click();
await page.keyboard.type("L5");
await page.locator('[role="option"]').first().click();
await page.locator('[data-id="fw-consult-start"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/);
check("session page opened", true, page.url());

await page.locator('[data-id="fw-consult-generate-plan"]').click();
await page.locator('[data-id="fw-consult-plan-card-0"]').waitFor();
await page.locator('[data-id="fw-consult-plan-lock"]').click();
await page.locator('[data-id="fw-consult-task-list"] li').first().waitFor();
check("plan locked → tasks", (await page.locator('[data-id="fw-consult-task-list"] li').count()) >= 2);

await page.locator('[data-id="fw-consult-questions"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-fill-all"]').click();
await page.locator('[data-id="fw-consult-review"]').click();
check("review shows auto badge", (await page.locator('[data-id^="fw-consult-auto-"]').count()) > 0);
await page.locator('[data-id="fw-consult-submit"]').click();
await page.locator('[data-id="fw-consult-task-list"] li[data-status="drawn"]').first().waitFor({ timeout: 30000 });
check("first card drawn", true);
await page.screenshot({ path: "../docs/qa/screens/fw-consult-board.png" }).catch(() => undefined);

// 남은 카드 전부 제출
while (await page.locator('[data-id="fw-consult-questions"]').isVisible().catch(() => false)) {
  await page.locator('[data-id="fw-consult-fill-all"]').click();
  await page.locator('[data-id="fw-consult-review"]').click();
  await page.locator('[data-id="fw-consult-submit"]').click();
  await page.waitForTimeout(500);
}
await page.locator('[data-id="fw-consult-relations"]').waitFor({ timeout: 60000 });
await page.locator('[data-id="fw-consult-propose-relations"]').click();
await page.locator('[data-id="fw-consult-edge-0"]').waitFor({ timeout: 20000 });
await page.locator('[data-id="fw-consult-confirm-relations"]').click();
await page.locator('[data-id="fw-consult-register"]').waitFor();
await page.locator('[data-id="fw-consult-dryrun"]').click();
await page.locator('[data-id="interview-import-report"], [data-id^="import-report"]').first().waitFor({ timeout: 20000 });
check("dry-run report rendered", true);

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
```

Adjust the `SearchSelect` option selector to the real DOM (`frontend/src/components/search-select.tsx` renders a portal list; check its `data-id`s) and the report root `data-id` to what `InterviewImportReport` renders.

- [ ] **Step 3: Run the smoke**

Run: `cd frontend && BASE_URL=http://localhost:3047 node scripts/pw-fw-consult.mjs`
Expected: all PASS. Share the two screenshots with the user (SendUserFile), per the frontend-screenshot rule.

- [ ] **Step 4: Manuals**

Add to `docs/manual/admin-manual-ko.md` and `-en.md` a section "AI로 L5 채우기 / Fill an L5 with AI" right after the interview import section, covering: where the buttons are, the four steps (plan, questionnaire per L6, connections, register), what "Suggestion applied" means, pause/resume and returning to a session, that registration behaves like the interview import (maps are published, the L5 canvas stays a draft until confirmed), the JSON download, and the external-AI prompt round trip. No em-dashes.

- [ ] **Step 5: CLAUDE.md contract line**

Under "Lessons" (the bullet list that already has the layout and duration dual-implementation entries), add:

```
- **인터뷰 JSON 0.5 계약 3표면** — 어댑터 `backend/scripts/consultant_interview.py`(단일 진실) ↔ AI 캠페인 조립기 `backend/app/framework_interview/assemble.py`+프롬프트 `contracts.py` ↔ 외부 AI 프롬프트 `frontend/src/lib/interview-json-prompt.ts`+`docs/samples/interview-json-0.5.md`. 키 집합이 바뀌면 셋을 같이 옮기고 `test_framework_interview_assemble.py`(조립 문서가 어댑터를 이슈 0으로 통과)·`interview-json-prompt.test.ts`로 확인한다.
```

- [ ] **Step 6: Full gates, then commit**

Run: backend full pytest + ruff; frontend vitest + tsc + lint + `node scripts/build-component-catalog.mjs --check`.

```bash
git add frontend/scripts/pw-fw-consult.mjs docs/manual/admin-manual-ko.md docs/manual/admin-manual-en.md CLAUDE.md PROGRESS.md docs/qa/screens/fw-consult-board.png
git commit -m "docs(fw-interview): smoke script, admin manual section, contract coupling note — 캠페인 스모크·관리자 매뉴얼·0.5 계약 3표면 규칙"
```

---

## Self-review notes (already applied)

- **Spec coverage:** §2 flow → Tasks 10–13; §3 model → Task 1; §4 questionnaire contract → Tasks 2, 3, 11; §5 prompts → Task 3 (+ registry keys in Task 1); §6 runner (priority, prefetch, pause, recovery, 409 on duplicate) → Tasks 5, 6; §7 assemble/apply through the existing import → Tasks 4, 7, 12; §8 API → Tasks 5, 7; §9 FE files → Tasks 8–13; §10 tests → each task; §11 order → tasks are in P1..P6 order; decision 6 (external prompt) → Task 9; coupling rule → Task 14.
- **Deliberate deviations from the spec text:** no `answering` session status (derived on the FE from task states); `mark-applied` endpoint added so the FE can flip the session after the existing import applies; `dept_catalog` empty in v1 (no map to derive eligible users from); the spec's `format_catalog_block` is `format_managed_catalog` in `contracts.py`.
- **Type consistency:** task statuses `pending|generating|ready|submitted|drawing|drawn|failed` and session statuses `planning|plan_locked|linking|ready|applied|abandoned` are used identically in models (Task 1), runner (Task 6), router (Tasks 5, 7), `api.ts` (Task 8) and the view model (Task 8). `PREFETCH_READY = 2` is mirrored in `runner.py` and `framework-interview.ts`.
- **Known open points for the executor:** exact `ConfirmDialog` usage verified; `ImportMapPreview` close affordance (Task 12 Step 1 note); `governanceKey` helper location (Task 12 Step 2 note); `SearchSelect` option DOM for the smoke (Task 14 Step 2 note); the 422 body nesting for missing answers (Task 7 Step 3 note).
