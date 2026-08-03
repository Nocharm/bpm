# AI Consultant Interview Mode — P1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 풀스크린 컨설팅 모드 — 고정 7스테이지 인터뷰로 프로세스 맵을 함께 그리는 AI 컨설턴트 (P1: 인터뷰 코어, 임베딩 없음).

**Architecture:** 백엔드가 인터뷰의 주인 — `interview_sessions` 상태머신 + 역할 3에이전트(인터뷰어/드래프터/톤 검수자)를 오케스트레이터가 조율, 선택지는 `asyncio.gather` 병렬 생성. 프론트는 새 라우트 `/maps/[mapId]/consult`(좌 대화 + 우 읽기전용 React Flow 프리뷰). 작업본은 세션에 저장, 적용은 프론트가 기존 `buildGraphFromAiProposal`+graph PUT 재사용(레이아웃이 프론트 dagre라서 — 스펙 §5 apply 엔드포인트의 의도적 단순화).

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic v2 · httpx2 · Next.js(App Router) + @xyflow/react + dagre · pytest / vitest / Playwright

**Spec:** `docs/design/2026-07-23-ai-consultant-interview-design.md` (P1 범위 = 스펙 §12 P1)

## Global Constraints

- HTTP 클라이언트는 **`httpx2`** (`import httpx2`) — `httpx` 아님.
- 타임스탬프는 KST: 모델은 `mapped_column(DateTime(timezone=True), default=_now)` (`_now` = `app.clock.now`).
- 신규 테이블은 startup `create_all`로 자동 생성 — `_ADDED_COLUMNS` 등록은 **기존 테이블에 컬럼 추가할 때만**.
- AI 비활성(`AI_ENABLED=false`, 기본) 시 인터뷰 API는 503 — 전체 테스트는 AI 모킹으로 그린 유지: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`.
- AI 모킹 패턴: `monkeypatch.setattr(ai_client, "call_ai", fake)` — fake 시그니처 `(messages: list[dict], model: str | None = None) -> ai_client.AiReply`.
- 권한 게이트는 의존성 팩토리: `Depends(require_map_role("editor"))` / `Depends(require_version_map_role("editor"))`.
- 프론트 id 생성은 `genId()`(`@/lib/id`) — `crypto.randomUUID()` 금지(평문 HTTP insecure context).
- React Compiler: `useCallback`/`useMemo` deps 불일치 시 빌드 실패 — 사소한 핸들러는 plain function으로. effect 내 동기 setState 금지.
- 색·스타일은 디자인 토큰만(raw hex 금지), Lucide 16px strokeWidth 1.5, 이모지 금지, 라이트 전용, UI 크롬 영어. 주요 구조 요소에 `data-id`.
- 커밋: `type(scope): English summary — 한국어 요약`, **매 커밋에 PROGRESS.md 한 줄 추가**(2026-07-23 섹션, 같은 커밋).
- 줄바꿈 LF. 파일 쓰기 시 `\uXXXX` 이스케이프 금지(리터럴 한글로).
- 작업 디렉터리: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/ai-consultant` (브랜치 `worktree-ai-consultant`). **git checkout/switch 금지.**
- 백엔드 실행: `backend/`에서 `.venv/bin/python -m pytest tests/ -q` · 프론트: `frontend/`에서 `npm test`, `npm run lint`, `npx tsc --noEmit`.

## File Structure (P1)

```
backend/app/settings.py                 [수정] ai_max_concurrency 등 3필드
backend/app/ai_client.py                [수정] 전역 세마포어
backend/app/models.py                   [수정] Interview* 모델 4종
backend/app/schemas.py                  [수정] Interview* 스키마
backend/app/interview/__init__.py       [신규]
backend/app/interview/engine.py         [신규] 스테이지 정의·전이·완료판정 (순수 로직)
backend/app/interview/parsing.py        [신규] 첨부 파싱 + 예산 클리핑
backend/app/interview/agents.py         [신규] 프롬프트 빌더 + 출력 계약 + JSON 추출
backend/app/interview/orchestrator.py   [신규] 턴 파이프라인 + 병렬 선택지 + 체크포인트
backend/app/routers/interviews.py       [신규] API 8종
backend/app/main.py                     [수정] 라우터 등록
backend/requirements.txt                [수정] pypdf·python-docx·openpyxl
backend/tests/test_interview_engine.py        [신규]
backend/tests/test_interview_parsing.py       [신규]
backend/tests/test_interview_agents.py        [신규]
backend/tests/test_interview_orchestrator.py  [신규]
backend/tests/test_interview_api.py           [신규]
backend/tests/test_ai_concurrency.py          [신규]
.env.example                            [수정] 신규 키 3종
frontend/src/lib/api.ts                 [수정] 인터뷰 타입 + API 함수 (컨벤션: API는 api.ts)
frontend/src/lib/interview.ts           [신규] 순수 헬퍼(스테이지 상수·그래프 변환·diff 키)
frontend/src/lib/interview.test.ts      [신규]
frontend/src/app/maps/[mapId]/consult/page.tsx  [신규] 풀스크린 라우트(TopNav 아래 main 영역 채움)
frontend/src/components/interview/interview-panel.tsx   [신규] 좌측 대화 패널
frontend/src/components/interview/choice-card.tsx       [신규] 선택지 카드 + 미니 SVG 프리뷰
frontend/src/components/interview/interview-preview.tsx [신규] 우측 읽기전용 React Flow
frontend/src/app/maps/[mapId]/page.tsx  [수정] 헤더 진입 버튼 (최소 변경)
frontend/scripts/pw-smoke-consult.mjs   [신규] Playwright 스모크(API 모킹)
```

**P1 프론트 범위 메모(스펙 대비 의도적 단순화 — 최종 태스크에서 스펙에 반영):**
- 적용(apply)은 프론트가 `buildGraphFromAiProposal` + `saveGraph`(graph PUT) 재사용 — 백엔드 apply 엔드포인트 없음(레이아웃이 프론트 dagre).
- 변경 하이라이트는 `ring-added` 토큰이 아니라 기존 diff 메커니즘(`NodeData.diffStatus="added"` → ProcessNode `border-added`).
- 확인 카드(적응 스킵 전용 UI)는 P1에서 인터뷰어의 질문 문구로 대체 — 전용 카드는 P2.
- UI 크롬은 영어 리터럴 고정(디자인 룰 "UI 영어 기본") — i18n 키 추가 없음. 인터뷰 대화 언어는 세션 `lang`으로 백엔드가 제어.

---

### Task 1: AI 전역 동시성 세마포어 + 설정 3종

**Files:**
- Modify: `backend/app/settings.py`
- Modify: `backend/app/ai_client.py`
- Modify: `.env.example`
- Test: `backend/tests/test_ai_concurrency.py`

**Interfaces:**
- Consumes: 기존 `ai_client.call_ai(messages, model)`, `settings`
- Produces: `settings.ai_max_concurrency: int`(기본 4) · `settings.interview_choice_count: int`(기본 2) · `settings.interview_context_budget: int`(기본 12000). `call_ai`는 동작 동일하되 전역 `asyncio.Semaphore`로 동시 실행 상한.

- [ ] **Step 1: Write the failing test**

`backend/tests/test_ai_concurrency.py`:

```python
"""전역 AI 동시성 세마포어 — call_ai가 ai_max_concurrency를 넘지 않는지."""

import asyncio

import pytest

from app import ai_client
from app.settings import settings


def test_call_ai_respects_concurrency_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_base_url", "http://fake")
    monkeypatch.setattr(settings, "ai_max_concurrency", 2)
    monkeypatch.setattr(ai_client, "_semaphore", None)  # 설정 반영 위해 재생성 유도

    active = 0
    peak = 0

    class _FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "{}"}}], "usage": {}}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json=None, headers=None):
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return _FakeResponse()

    monkeypatch.setattr(ai_client.httpx2, "AsyncClient", _FakeClient)

    async def _run() -> None:
        await asyncio.gather(*[ai_client.call_ai([{"role": "user", "content": "x"}]) for _ in range(6)])

    asyncio.run(_run())
    assert peak <= 2


def test_settings_have_interview_defaults() -> None:
    assert settings.ai_max_concurrency >= 1
    assert settings.interview_choice_count >= 1
    assert settings.interview_context_budget >= 1000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_concurrency.py -q`
Expected: FAIL — `AttributeError: ... has no attribute 'ai_max_concurrency'` (또는 `_semaphore` 부재)

- [ ] **Step 3: Implement settings fields + semaphore**

`backend/app/settings.py` — AI 블록(`ai_endpoints` 아래)에 추가:

```python
    # AI 부하 가드 — 백엔드 전체 동시 AI 호출 상한(인터뷰·챗 공용)
    ai_max_concurrency: int = 4
    # 인터뷰 선택지 병렬 생성 개수(구조 결정 지점에서만)
    interview_choice_count: int = 2
    # 인터뷰 컨텍스트 주입 문자 예산(첨부 발췌 등)
    interview_context_budget: int = 12000
```

`backend/app/ai_client.py` — 상단 import에 `import asyncio` 추가, `MODEL_SEP` 근처에:

```python
# 전역 동시성 가드 — 이벤트 루프 안에서 지연 생성(모듈 import 시점엔 루프 없음)
_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(max(1, settings.ai_max_concurrency))
    return _semaphore
```

`call_ai`의 httpx2 블록을 세마포어로 감싼다 (기존 본문 유지, 들여쓰기만 한 단계):

```python
    async with _get_semaphore():
        async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
            response = await client.post(url, json=payload, headers=_headers(endpoint))
            response.raise_for_status()
            data = response.json()
```

`.env.example` — AI 블록에 주석과 함께 추가:

```
# AI 부하 가드 — 동시 AI 호출 상한(인터뷰·챗 공용)
AI_MAX_CONCURRENCY=4
# 인터뷰 선택지 병렬 생성 개수(최대 3 권장)
INTERVIEW_CHOICE_COUNT=2
# 인터뷰 컨텍스트 주입 문자 예산
INTERVIEW_CONTEXT_BUDGET=12000
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_concurrency.py tests/test_ai.py -q`
Expected: 신규 2 PASS + 기존 test_ai 전부 PASS (세마포어가 기존 경로를 깨지 않음)

- [ ] **Step 5: Lint + Commit**

Run: `cd backend && .venv/bin/ruff check app/ tests/`
PROGRESS.md 2026-07-23 섹션에 한 줄 추가 후:

```bash
git add backend/app/settings.py backend/app/ai_client.py backend/tests/test_ai_concurrency.py .env.example PROGRESS.md
git commit -m "feat(ai): global AI concurrency semaphore + interview settings — AI 동시 호출 상한·인터뷰 설정 3종"
```

---

### Task 2: Interview 모델 4종 + 스키마

**Files:**
- Modify: `backend/app/models.py` (파일 끝에 추가)
- Modify: `backend/app/schemas.py` (파일 끝에 추가)
- Test: `backend/tests/test_interview_api.py` (스키마 단위 테스트만 이 태스크에서)

**Interfaces:**
- Consumes: `models._now`, `Base`, 기존 `AiProposal`·`GraphIn` 스키마
- Produces (후속 태스크가 의존하는 정확한 이름):
  - 모델: `InterviewSession`(id, map_id, version_id, login_id, status, current_stage, lang, facts:dict, working_graph:dict|None, pending_choices:dict|None, base_graph_updated_at, created_at, updated_at, completed_at) · `InterviewMessage`(id, session_id, seq, role, kind, content, payload:dict|None, stage, superseded:bool, created_at) · `InterviewCheckpoint`(id, session_id, stage, facts:dict, working_graph:dict|None, message_seq:int, created_at) · `InterviewAttachment`(id, session_id, filename, mime, size, parsed_text, status, error, created_at)
  - 스키마: `InterviewCreateIn(version_id:int, lang:Literal["ko","en"]="ko")` · `InterviewTurnIn(type:Literal["answer","choice","confirm","skip"], content:str="", choice_id:str|None=None)` · `InterviewRevertIn(stage:str)` · `InterviewMessageOut` · `InterviewCheckpointOut(stage:str, message_seq:int, created_at:datetime)` · `InterviewAttachmentOut` · `InterviewStateOut(id, map_id, version_id, status, current_stage, lang, working_graph:dict|None, messages:list[InterviewMessageOut], checkpoints:list[InterviewCheckpointOut], attachments:list[InterviewAttachmentOut], version_updated_at:datetime|None, base_graph_updated_at:datetime|None)`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_interview_api.py` (첫 내용 — API 테스트는 Task 7에서 확장):

```python
"""인터뷰 API — 스키마·세션·턴·체크포인트·권한."""

import pytest
from pydantic import ValidationError

from app.schemas import InterviewCreateIn, InterviewStateOut, InterviewTurnIn


def test_turn_in_rejects_unknown_type() -> None:
    with pytest.raises(ValidationError):
        InterviewTurnIn(type="banana")


def test_turn_in_defaults() -> None:
    turn = InterviewTurnIn(type="answer", content="구매 요청 프로세스입니다")
    assert turn.choice_id is None


def test_create_in_lang_default_ko() -> None:
    assert InterviewCreateIn(version_id=1).lang == "ko"


def test_state_out_smoke() -> None:
    state = InterviewStateOut(
        id=1, map_id=1, version_id=1, status="active", current_stage="scope",
        lang="ko", working_graph=None, messages=[], checkpoints=[], attachments=[],
        version_updated_at=None, base_graph_updated_at=None,
    )
    assert state.current_stage == "scope"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_api.py -q`
Expected: FAIL — `ImportError: cannot import name 'InterviewCreateIn'`

- [ ] **Step 3: Add models**

`backend/app/models.py` 파일 끝에:

```python
class InterviewSession(Base):
    """AI 컨설턴트 인터뷰 세션 — 작업본·facts의 단일 소스. 맵×사용자당 active 1개 (design 2026-07-23)."""

    __tablename__ = "interview_sessions"
    __table_args__ = (Index("ix_interview_sessions_login_map", "login_id", "map_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    # FK 아님 — 버전이 삭제돼도 세션 기록 보존(ai_chat_messages.version_id 관례)
    version_id: Mapped[int] = mapped_column(Integer)
    login_id: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|completed|abandoned
    current_stage: Mapped[str] = mapped_column(String(20), default="scope")
    lang: Mapped[str] = mapped_column(String(5), default="ko")  # ko|en — 생성 시 고정
    facts: Mapped[dict] = mapped_column(JSON, default=dict)  # 스테이지 키별 수집 항목
    # 작업본 그래프 — AiProposal graph 서브셋 {nodes,edges,groups} (키 기반, 좌표 없음)
    working_graph: Mapped[dict | None] = mapped_column(JSON, default=None)
    # 마지막 choices 카드 원자료 — 선택 턴에서 조회 후 소거
    pending_choices: Mapped[dict | None] = mapped_column(JSON, default=None)
    # 세션 시작 시점의 대상 draft updated_at — 적용 전 충돌 경고 판정용
    base_graph_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )

    messages: Mapped[list["InterviewMessage"]] = relationship(cascade="all, delete-orphan")
    checkpoints: Mapped[list["InterviewCheckpoint"]] = relationship(cascade="all, delete-orphan")
    attachments: Mapped[list["InterviewAttachment"]] = relationship(cascade="all, delete-orphan")


class InterviewMessage(Base):
    """인터뷰 대화 1건 — P3 RAG 축적의 원재료. 되돌리기는 삭제 대신 superseded 접기."""

    __tablename__ = "interview_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(12))  # consultant|user
    # consultant: question|choices|confirm|notice / user: answer|choice|confirm|skip
    kind: Mapped[str] = mapped_column(String(12))
    content: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict | None] = mapped_column(JSON, default=None)  # 선택지·선택결과 등
    stage: Mapped[str] = mapped_column(String(20))
    superseded: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InterviewCheckpoint(Base):
    """스테이지 완료 시점 스냅샷 — '이전 단계로'의 복원 지점."""

    __tablename__ = "interview_checkpoints"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    stage: Mapped[str] = mapped_column(String(20))
    facts: Mapped[dict] = mapped_column(JSON, default=dict)
    working_graph: Mapped[dict | None] = mapped_column(JSON, default=None)
    # 이 시점까지의 메시지 seq — 복원 시 이후 메시지를 superseded 처리하는 경계
    message_seq: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class InterviewAttachment(Base):
    """세션 첨부 문서 — 원본 미보존, parsed_text만 저장 (design 2026-07-23 §13)."""

    __tablename__ = "interview_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(300))
    mime: Mapped[str] = mapped_column(String(100), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    parsed_text: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(10), default="parsed")  # parsed|failed
    error: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

- [ ] **Step 4: Add schemas**

`backend/app/schemas.py` 파일 끝에:

```python
# ---------- AI 컨설턴트 인터뷰 (design 2026-07-23) ----------

InterviewUserTurnType = Literal["answer", "choice", "confirm", "skip"]


class InterviewCreateIn(BaseModel):
    version_id: int
    lang: Literal["ko", "en"] = "ko"


class InterviewTurnIn(BaseModel):
    type: InterviewUserTurnType
    content: str = Field(default="", max_length=4000)
    choice_id: str | None = Field(default=None, max_length=20)


class InterviewRevertIn(BaseModel):
    stage: str = Field(min_length=1, max_length=20)


class InterviewMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    seq: int
    role: str
    kind: str
    content: str
    payload: dict | None = None
    stage: str
    superseded: bool
    created_at: datetime


class InterviewCheckpointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stage: str
    message_seq: int
    created_at: datetime


class InterviewAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    mime: str
    size: int
    status: str
    error: str
    created_at: datetime


class InterviewStateOut(BaseModel):
    id: int
    map_id: int
    version_id: int
    status: str
    current_stage: str
    lang: str
    working_graph: dict | None = None
    messages: list[InterviewMessageOut] = Field(default_factory=list)
    checkpoints: list[InterviewCheckpointOut] = Field(default_factory=list)
    attachments: list[InterviewAttachmentOut] = Field(default_factory=list)
    # 충돌 경고 판정용 — 현재 draft updated_at vs 세션 시작 시점
    version_updated_at: datetime | None = None
    base_graph_updated_at: datetime | None = None
```

- [ ] **Step 5: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_api.py -q`
Expected: 4 PASS

- [ ] **Step 6: Lint + Commit**

Run: `cd backend && .venv/bin/ruff check app/ tests/`

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_interview_api.py PROGRESS.md
git commit -m "feat(interview): session/message/checkpoint/attachment models + schemas — 인터뷰 테이블 4종·스키마"
```

---

### Task 3: 스테이지 엔진 (순수 로직)

**Files:**
- Create: `backend/app/interview/__init__.py` (빈 파일)
- Create: `backend/app/interview/engine.py`
- Test: `backend/tests/test_interview_engine.py`

**Interfaces:**
- Consumes: 없음 (순수 로직)
- Produces:
  - `StageDef` dataclass: `key:str, title:str, goal_ko:str, goal_en:str, required_facts:tuple[str,...], choice_stage:bool`
  - `STAGES: tuple[StageDef, ...]` — 키 순서: `scope, io, activities, branches, roles, params, review`
  - `get_stage(key:str) -> StageDef` (KeyError면 ValueError)
  - `next_stage_key(key:str) -> str | None` (review 다음은 None)
  - `stage_index(key:str) -> int`
  - `is_stage_complete(key:str, facts:dict) -> bool` — `facts.get(key, {})`에 required_facts가 전부 truthy
  - `first_incomplete_stage(facts:dict) -> str` — 전부 완료면 `"review"`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_interview_engine.py`:

```python
"""스테이지 엔진 — 전이·완료 판정·적응 스킵의 순수 로직."""

import pytest

from app.interview import engine


def test_stage_order_fixed() -> None:
    assert [s.key for s in engine.STAGES] == [
        "scope", "io", "activities", "branches", "roles", "params", "review",
    ]


def test_next_stage_key() -> None:
    assert engine.next_stage_key("scope") == "io"
    assert engine.next_stage_key("review") is None


def test_get_stage_unknown_raises() -> None:
    with pytest.raises(ValueError):
        engine.get_stage("banana")


def test_is_stage_complete_requires_all_facts() -> None:
    facts = {"scope": {"process_name": "구매 요청", "purpose": "표준화", "boundaries": ""}}
    assert engine.is_stage_complete("scope", facts) is False
    facts["scope"]["boundaries"] = "요청 접수부터 발주까지"
    assert engine.is_stage_complete("scope", facts) is True


def test_first_incomplete_stage_skips_prefilled() -> None:
    facts = {
        "scope": {"process_name": "구매", "purpose": "p", "boundaries": "b"},
        "io": {"trigger": "t", "inputs": "i", "outputs": "o"},
    }
    assert engine.first_incomplete_stage(facts) == "activities"
    assert engine.first_incomplete_stage({}) == "scope"


def test_choice_stages() -> None:
    assert engine.get_stage("activities").choice_stage is True
    assert engine.get_stage("branches").choice_stage is True
    assert engine.get_stage("scope").choice_stage is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_engine.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.interview'`

- [ ] **Step 3: Implement engine**

`backend/app/interview/__init__.py`: 빈 파일 생성.

`backend/app/interview/engine.py`:

```python
"""인터뷰 스테이지 상태머신 — 고정 7단계 정의·전이·완료 판정 (design 2026-07-23 §3)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class StageDef:
    key: str
    title: str  # UI 크롬 표시(영어)
    goal_ko: str  # 인터뷰어 프롬프트 브리프
    goal_en: str
    # 이 스테이지가 채워야 하는 facts 키 — 전부 truthy면 완료(적응 스킵 판정에도 사용)
    required_facts: tuple[str, ...]
    # 구조 결정 지점 — 드래프터 선택지 병렬 생성 허용 (스펙 §3: ③활동·④분기 2곳)
    choice_stage: bool = False


STAGES: tuple[StageDef, ...] = (
    StageDef(
        "scope", "Scope",
        "프로세스의 이름·목적·시작과 끝 경계를 확정한다",
        "Confirm the process name, purpose, and start/end boundaries",
        ("process_name", "purpose", "boundaries"),
    ),
    StageDef(
        "io", "Inputs & Outputs",
        "프로세스를 촉발하는 트리거, 투입물(인풋), 산출물(아웃풋)을 확정한다",
        "Confirm the trigger, inputs, and outputs",
        ("trigger", "inputs", "outputs"),
    ),
    StageDef(
        "activities", "Activities",
        "주요 활동을 순서대로 나열한다 — 세분도(활동 6±3개)가 핵심 결정",
        "List the main activities in order — granularity is the key decision",
        ("activities",),
        choice_stage=True,
    ),
    StageDef(
        "branches", "Branches & Exceptions",
        "분기(디시전)와 예외 흐름을 확정한다",
        "Confirm decision branches and exception flows",
        ("branches",),
        choice_stage=True,
    ),
    StageDef(
        "roles", "Roles & Systems",
        "각 활동의 담당자/부서와 사용 시스템을 채운다",
        "Fill in assignee/department and systems for each activity",
        ("roles",),
    ),
    StageDef(
        "params", "Parameters",
        "회당 파라미터(소요시간·비용·인원·연간횟수·FTE)를 아는 범위에서 채운다",
        "Fill in per-run parameters (duration, cost, headcount, annual count, FTE)",
        ("params_done",),
    ),
    StageDef(
        "review", "Review",
        "완성된 맵을 함께 검토하고 승인 여부를 확인한다",
        "Review the finished map together and confirm approval",
        ("approved",),
    ),
)

_BY_KEY = {stage.key: stage for stage in STAGES}


def get_stage(key: str) -> StageDef:
    stage = _BY_KEY.get(key)
    if stage is None:
        raise ValueError(f"unknown stage: {key}")
    return stage


def stage_index(key: str) -> int:
    return [s.key for s in STAGES].index(get_stage(key).key)


def next_stage_key(key: str) -> str | None:
    idx = stage_index(key)
    return STAGES[idx + 1].key if idx + 1 < len(STAGES) else None


def is_stage_complete(key: str, facts: dict) -> bool:
    stage = get_stage(key)
    stage_facts = facts.get(key) or {}
    return all(stage_facts.get(name) for name in stage.required_facts)


def first_incomplete_stage(facts: dict) -> str:
    """문서/기존 맵이 미리 채운 스테이지는 건너뛴 시작점 — 전부 완료면 review."""
    for stage in STAGES:
        if not is_stage_complete(stage.key, facts):
            return stage.key
    return "review"
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_engine.py -q`
Expected: 6 PASS

- [ ] **Step 5: Lint + Commit**

```bash
cd backend && .venv/bin/ruff check app/ tests/
git add backend/app/interview/ backend/tests/test_interview_engine.py PROGRESS.md
git commit -m "feat(interview): stage engine with fixed 7 stages + adaptive skip — 스테이지 엔진(고정 7단계·적응 스킵)"
```

---

### Task 4: 첨부 파싱 + 예산 클리핑 (+ 의존성 추가)

**Files:**
- Modify: `backend/requirements.txt` (pypdf·python-docx·openpyxl 추가)
- Create: `backend/app/interview/parsing.py`
- Test: `backend/tests/test_interview_parsing.py`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `parse_attachment(filename:str, data:bytes) -> str` — 확장자 디스패치(.pdf/.docx/.xlsx/.txt/.md), 미지원 확장자·파싱 실패는 `ParseError` raise
  - `ParseError(Exception)` — message가 사용자 표시용
  - `clip_to_budget(sections:list[tuple[str,str]], budget:int) -> str` — `[파일명]` 헤더 섹션 합본, 초과 시 균등 절단
  - `ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".txt", ".md"}` · `MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024`

- [ ] **Step 1: Add dependencies**

`backend/requirements.txt`에 추가 (설치 시점 최신 안정판으로 조정 가능하되 반드시 핀 고정):

```
pypdf==5.1.0
python-docx==1.1.2
openpyxl==3.1.5
```

Run: `cd backend && .venv/bin/pip install -r requirements-dev.txt`
Expected: 3개 패키지 설치 성공 (버전이 없으면 해당 최신 안정판으로 핀 조정 후 재실행)

- [ ] **Step 2: Write the failing test**

`backend/tests/test_interview_parsing.py`:

```python
"""첨부 파싱 — docx/xlsx 실물 왕복, txt 인코딩 폴백, 예산 클리핑."""

import io

import pytest
from docx import Document
from openpyxl import Workbook

from app.interview.parsing import (
    ALLOWED_EXTENSIONS,
    ParseError,
    clip_to_budget,
    parse_attachment,
)


def _docx_bytes(paragraphs: list[str]) -> bytes:
    doc = Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _xlsx_bytes(rows: list[list[str]]) -> bytes:
    wb = Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_docx_extracts_paragraphs() -> None:
    text = parse_attachment("sop.docx", _docx_bytes(["구매 요청 절차", "1. 요청서 작성"]))
    assert "구매 요청 절차" in text
    assert "요청서 작성" in text


def test_parse_xlsx_extracts_cells_tab_separated() -> None:
    text = parse_attachment("list.xlsx", _xlsx_bytes([["단계", "담당"], ["접수", "구매팀"]]))
    assert "단계\t담당" in text
    assert "접수\t구매팀" in text


def test_parse_txt_utf8_and_cp949() -> None:
    assert parse_attachment("a.txt", "한글 메모".encode("utf-8")) == "한글 메모"
    assert parse_attachment("b.txt", "한글 메모".encode("cp949")) == "한글 메모"


def test_parse_unknown_extension_raises() -> None:
    with pytest.raises(ParseError):
        parse_attachment("evil.exe", b"MZ")


def test_parse_corrupt_docx_raises_parse_error() -> None:
    with pytest.raises(ParseError):
        parse_attachment("broken.docx", b"not a zip")


def test_allowed_extensions() -> None:
    assert ALLOWED_EXTENSIONS == {".pdf", ".docx", ".xlsx", ".txt", ".md"}


def test_clip_to_budget_headers_and_even_cut() -> None:
    sections = [("a.txt", "가" * 100), ("b.txt", "나" * 100)]
    merged = clip_to_budget(sections, budget=120)
    assert "[a.txt]" in merged and "[b.txt]" in merged
    # 각 섹션 본문이 예산의 절반 수준으로 잘림
    assert len(merged) <= 120 + len("[a.txt]\n\n") + len("[b.txt]\n\n") + 4


def test_clip_to_budget_no_cut_when_under() -> None:
    merged = clip_to_budget([("a.txt", "짧다")], budget=1000)
    assert "짧다" in merged
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_parsing.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.interview.parsing'`

- [ ] **Step 4: Implement parsing**

`backend/app/interview/parsing.py`:

```python
"""첨부 문서 파싱 — PDF/DOCX/XLSX/TXT/MD → 텍스트, 컨텍스트 예산 클리핑 (design 2026-07-23)."""

import io
from pathlib import PurePosixPath

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".txt", ".md"}
MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024  # 업로드 상한 20MB


class ParseError(Exception):
    """파싱 실패 — message는 사용자 표시용(내부 스택 노출 금지)."""


def _parse_pdf(data: bytes) -> str:
    from pypdf import PdfReader  # 무거운 import 지연 — 파싱 경로에서만

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _parse_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            parts.append("\t".join(cell.text.strip() for cell in row.cells))
    return "\n".join(parts)


def _parse_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for ws in wb.worksheets:
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                parts.append("\t".join(cells))
    return "\n".join(parts)


def _parse_text(data: bytes) -> str:
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp949")  # 사내 Windows 산출 텍스트 폴백


def parse_attachment(filename: str, data: bytes) -> str:
    """확장자 디스패치 파싱 — 실패는 전부 ParseError로 정규화(라우터가 400/상태 기록)."""
    ext = PurePosixPath(filename.lower()).suffix
    if ext not in ALLOWED_EXTENSIONS:
        raise ParseError(f"unsupported file type: {ext or filename}")
    try:
        if ext == ".pdf":
            return _parse_pdf(data)
        if ext == ".docx":
            return _parse_docx(data)
        if ext == ".xlsx":
            return _parse_xlsx(data)
        return _parse_text(data)
    except ParseError:
        raise
    except Exception as exc:  # noqa: BLE001 -- 라이브러리별 예외를 경계에서 정규화
        raise ParseError(f"failed to parse {filename}") from exc


def clip_to_budget(sections: list[tuple[str, str]], budget: int) -> str:
    """[파일명] 헤더 섹션 합본 — 총량이 예산을 넘으면 각 섹션을 균등 비율로 절단."""
    if not sections:
        return ""
    total = sum(len(text) for _, text in sections)
    parts: list[str] = []
    for name, text in sections:
        if total > budget:
            share = max(200, budget * len(text) // max(total, 1))  # 최소 200자는 보존
            text = text[:share]
        parts.append(f"[{name}]\n{text}")
    return "\n\n".join(parts)
```

- [ ] **Step 5: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_parsing.py -q`
Expected: 8 PASS

- [ ] **Step 6: Lint + Commit**

```bash
cd backend && .venv/bin/ruff check app/ tests/
git add backend/requirements.txt backend/app/interview/parsing.py backend/tests/test_interview_parsing.py PROGRESS.md
git commit -m "feat(interview): attachment parsing (pdf/docx/xlsx/txt) + context budget — 첨부 파싱·예산 클리핑"
```

---

### Task 5: 에이전트 — 프롬프트 빌더 + 출력 계약

**Files:**
- Create: `backend/app/interview/agents.py`
- Test: `backend/tests/test_interview_agents.py`

**Interfaces:**
- Consumes: `engine.StageDef`/`get_stage`, `schemas.AiProposal`
- Produces:
  - `extract_json(text:str) -> str` (ai.py `_extract_json`과 동일 5줄 — 라우터 프라이빗이라 의도적 소량 중복)
  - `InterviewerOut(BaseModel)`: `message:str` · `facts_patch:dict[str,Any]={}` · `stage_complete:bool=False` · `needs_choices:bool=False`
  - `ToneReviewOut(BaseModel)`: `message:str=""` · `renames:list[ToneRename]=[]`, `ToneRename(key:str, title:str)`
  - `build_interviewer_messages(stage_key:str, lang:str, facts:dict, graph_summary:str, context_text:str, history:list[dict], user_input:str) -> list[dict]`
  - `build_drafter_messages(stage_key:str, lang:str, facts:dict, working_graph:dict|None, context_text:str, variant_hint:str) -> list[dict]`
  - `build_tone_messages(lang:str, working_graph:dict) -> list[dict]`
  - `CHOICE_VARIANT_HINTS: dict[str, list[str]]` — stage_key(`activities`/`branches`)별 변형 힌트 리스트(선택지 병렬 생성 시 i번째 힌트 사용)

- [ ] **Step 1: Write the failing test**

`backend/tests/test_interview_agents.py`:

```python
"""에이전트 출력 계약 파싱 + 프롬프트 빌더의 구조 검증(AI 호출 없음)."""

import json

from app.interview.agents import (
    CHOICE_VARIANT_HINTS,
    InterviewerOut,
    ToneReviewOut,
    build_drafter_messages,
    build_interviewer_messages,
    build_tone_messages,
    extract_json,
)


def test_extract_json_strips_fences() -> None:
    raw = '설명입니다\n```json\n{"message": "안녕"}\n```'
    assert json.loads(extract_json(raw)) == {"message": "안녕"}


def test_interviewer_out_defaults() -> None:
    out = InterviewerOut.model_validate_json('{"message": "이름이 뭔가요?"}')
    assert out.facts_patch == {}
    assert out.stage_complete is False
    assert out.needs_choices is False


def test_tone_review_out_parses_renames() -> None:
    out = ToneReviewOut.model_validate_json(
        '{"message": "정리", "renames": [{"key": "n1", "title": "요청 접수"}]}'
    )
    assert out.renames[0].key == "n1"


def test_interviewer_messages_structure() -> None:
    messages = build_interviewer_messages(
        stage_key="scope", lang="ko", facts={}, graph_summary="(빈 캔버스)",
        context_text="[sop.docx]\n구매 절차…", history=[{"role": "user", "content": "안녕"}],
        user_input="구매 프로세스요",
    )
    assert messages[0]["role"] == "system"
    assert "scope" in messages[0]["content"] or "범위" in messages[0]["content"]
    assert "[sop.docx]" in messages[0]["content"]
    assert messages[-1] == {"role": "user", "content": "구매 프로세스요"}


def test_interviewer_messages_english_when_en() -> None:
    messages = build_interviewer_messages(
        stage_key="scope", lang="en", facts={}, graph_summary="", context_text="",
        history=[], user_input="hi",
    )
    assert "English" in messages[0]["content"]


def test_drafter_messages_contain_variant_hint() -> None:
    messages = build_drafter_messages(
        stage_key="activities", lang="ko", facts={"scope": {"process_name": "구매"}},
        working_graph=None, context_text="", variant_hint=CHOICE_VARIANT_HINTS["activities"][0],
    )
    assert CHOICE_VARIANT_HINTS["activities"][0] in messages[0]["content"]
    # 드래프터는 AiProposal graph JSON을 요구
    assert '"kind"' in messages[0]["content"]


def test_tone_messages_embed_graph() -> None:
    graph = {"nodes": [{"key": "a", "title": "start", "node_type": "start"}], "edges": [], "groups": []}
    messages = build_tone_messages("ko", graph)
    assert "start" in messages[0]["content"]


def test_choice_variant_hints_cover_choice_stages() -> None:
    assert set(CHOICE_VARIANT_HINTS) == {"activities", "branches"}
    assert all(len(v) >= 3 for v in CHOICE_VARIANT_HINTS.values())
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_agents.py -q`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Implement agents**

`backend/app/interview/agents.py`:

```python
"""역할 에이전트 — 인터뷰어·드래프터·톤 검수자의 프롬프트 빌더와 출력 계약 (design 2026-07-23 §4).

프롬프트는 고정 프리픽스(역할·표준) → 문서 발췌 → facts → 히스토리 순으로 조립해
vLLM prefix cache 적중을 유도한다. AI 호출 자체는 orchestrator가 수행.
"""

import json
from typing import Any

from pydantic import BaseModel, Field

from app.interview.engine import get_stage


def extract_json(text: str) -> str:
    """모델이 ```json 펜스나 앞뒤 설명을 붙여도 본문 JSON만 추출 — ai.py _extract_json과 동일 계약."""
    start, end = text.find("{"), text.rfind("}")
    if start != -1 and end > start:
        return text[start : end + 1]
    return text


class InterviewerOut(BaseModel):
    """인터뷰어 응답 — 다음 질문/확인과 facts 갱신."""

    message: str
    facts_patch: dict[str, Any] = Field(default_factory=dict)
    stage_complete: bool = False
    needs_choices: bool = False


class ToneRename(BaseModel):
    key: str
    title: str = Field(max_length=200)


class ToneReviewOut(BaseModel):
    """톤 검수자 응답 — 명명·세분도 표준화 개명 제안."""

    message: str = ""
    renames: list[ToneRename] = Field(default_factory=list)


# 선택지 병렬 생성용 변형 힌트 — i번째 안이 i번째 힌트를 사용 (스펙 §3 구조 결정 지점 2곳)
CHOICE_VARIANT_HINTS: dict[str, list[str]] = {
    "activities": [
        "표준 세분도 — 핵심 활동 6±3개, '명사+동사' 명명, 담당 조직 단위로 묶기",
        "세밀 분해 — 검증·승인·기록 단계까지 명시, 활동 8~12개",
        "간결 요약 — 핵심 가치 활동만 4~6개, 세부는 설명(description)으로",
    ],
    "branches": [
        "표준 분기 — 핵심 디시전만 마름모로, 예외는 설명에 기록",
        "예외 명시 — 반려/보류/재작업 루프를 엣지로 모두 표현",
        "해피패스 우선 — 분기 최소화, 예외는 별도 노드 없이 라벨로",
    ],
}

_LANG_LINE = {
    "ko": "모든 message와 질문은 한국어로 작성하세요.",
    "en": "Write all messages and questions in English.",
}

_INTERVIEWER_CONTRACT = """당신은 프로세스 컨설턴트입니다. 현업 담당자를 인터뷰해 프로세스 맵을 함께 만듭니다.
조직 표준: 노드 제목은 '명사+동사'(예: '요청서 작성'), 활동 6±3개 세분도, 한 질문에 한 주제만.

반드시 아래 JSON 하나만 반환:
{"message": <사용자에게 보일 다음 질문 또는 확인 문장>,
 "facts_patch": {<이번 답변에서 확정된 현재 스테이지 facts 키:값>},
 "stage_complete": <현재 스테이지 필수 항목이 모두 확정되면 true>,
 "needs_choices": <구조 대안을 시각적으로 제시하는 게 나으면 true — 활동/분기 스테이지에서만>}

규칙:
1. stage_complete=true일 때 message에는 다음 주제로 넘어가는 첫 질문을 포함하세요.
2. 이미 문서/기존 맵으로 파악된 항목은 다시 묻지 말고 "~로 이해했는데 맞나요?"로 확인만 하세요.
3. facts_patch 값은 문자열 또는 문자열 배열만."""

_DRAFTER_CONTRACT = """당신은 프로세스 맵 드래프터입니다. 확정된 facts로 순서도 그래프를 생성합니다.
반드시 아래 JSON 하나만 반환 (kind는 항상 "graph"):
{"kind": "graph", "message": <이 안의 특징 한 줄>,
 "nodes": [{"key": <임시키>, "title": <제목>, "node_type": "start|process|decision|end",
            "description": <설명>, "attributes": {"assignee": …, "department": …, "system": …,
            "duration": …, "cost_krw": …, "headcount": …, "annual_count": …, "fte": …} 또는 생략,
            "group_key": <그룹키 또는 생략>}],
 "edges": [{"source": <키>, "target": <키>, "label": <분기 라벨 또는 "">}],
 "groups": [{"key": <키>, "label": <레인/묶음 이름>}]}

규칙:
1. start 1개로 시작, end 1개 이상으로 끝나는 연결 그래프.
2. 좌표는 넣지 마세요(자동 배치). 노드 제목은 '명사+동사'.
3. 분기는 node_type="decision" + 나가는 엣지에 라벨."""

_TONE_CONTRACT = """당신은 프로세스 맵 톤 검수자입니다. 노드 명명·세분도가 조직 표준('명사+동사', 활동 6±3개, 존댓말 금지)에 맞는지 검토합니다.
반드시 아래 JSON 하나만 반환:
{"message": <검수 요약 한 줄>, "renames": [{"key": <노드 키>, "title": <표준화된 새 제목>}]}
표준에 이미 맞으면 renames는 빈 배열."""


def _facts_block(facts: dict) -> str:
    return json.dumps(facts, ensure_ascii=False)


def build_interviewer_messages(
    stage_key: str,
    lang: str,
    facts: dict,
    graph_summary: str,
    context_text: str,
    history: list[dict],
    user_input: str,
) -> list[dict]:
    stage = get_stage(stage_key)
    goal = stage.goal_ko if lang == "ko" else stage.goal_en
    system = (
        f"{_INTERVIEWER_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[참고 문서]\n{context_text or '(없음)'}\n\n"
        f"[현재 스테이지] {stage.key} — {goal}\n"
        f"[누적 facts]\n{_facts_block(facts)}\n\n"
        f"[현재 작업본 요약]\n{graph_summary or '(빈 캔버스)'}"
    )
    return [
        {"role": "system", "content": system},
        *history,
        {"role": "user", "content": user_input},
    ]


def build_drafter_messages(
    stage_key: str,
    lang: str,
    facts: dict,
    working_graph: dict | None,
    context_text: str,
    variant_hint: str,
) -> list[dict]:
    current = json.dumps(working_graph, ensure_ascii=False) if working_graph else "(없음)"
    system = (
        f"{_DRAFTER_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[참고 문서]\n{context_text or '(없음)'}\n\n"
        f"[확정 facts]\n{_facts_block(facts)}\n\n"
        f"[현재 작업본]\n{current}\n\n"
        f"[이 안의 방향] {variant_hint}"
    )
    user = "위 facts와 방향에 맞는 전체 그래프를 생성하세요."
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


def build_tone_messages(lang: str, working_graph: dict) -> list[dict]:
    system = f"{_TONE_CONTRACT}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}"
    user = f"[검수 대상 그래프]\n{json.dumps(working_graph, ensure_ascii=False)}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_agents.py -q`
Expected: 9 PASS

- [ ] **Step 5: Lint + Commit**

```bash
cd backend && .venv/bin/ruff check app/ tests/
git add backend/app/interview/agents.py backend/tests/test_interview_agents.py PROGRESS.md
git commit -m "feat(interview): interviewer/drafter/tone-reviewer prompts + output contracts — 에이전트 프롬프트·출력 계약"
```

---

### Task 6: 오케스트레이터 — 턴 파이프라인 + 병렬 선택지 + 체크포인트

**Files:**
- Create: `backend/app/interview/orchestrator.py`
- Test: `backend/tests/test_interview_orchestrator.py`

**Interfaces:**
- Consumes: `agents.*`, `engine.*`, `ai_client.call_ai`, `schemas.AiProposal`, `models.InterviewSession/InterviewMessage/InterviewCheckpoint`, `settings.interview_choice_count`
- Produces:
  - `class TurnError(Exception)` — `status_code:int`(502) + 사용자 메시지. 라우터가 HTTPException으로 변환
  - `async def run_turn(db, interview:InterviewSession, turn:InterviewTurnIn, graph_summary:str, context_text:str, model:str|None=None) -> None` — 부수효과로 `interview`(facts·current_stage·working_graph·pending_choices) 갱신 + `db.add()`로 메시지/체크포인트 적재. **커밋은 호출자(라우터)** — 예외 시 라우터 rollback으로 턴 원자성.
  - `async def _ask_json(messages, model, schema_cls)` — call_ai + extract_json + 검증, 실패 1회 재프롬프트 후 `TurnError(502)`
  - `def next_seq(interview) -> int` — 로드된 messages 관계 기준 max+1
  - choices payload 형식(메시지 `payload` 및 `pending_choices`): `{"options": [{"id": "opt-1", "title": str, "summary": str, "graph": {nodes,edges,groups}}]}`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_interview_orchestrator.py`:

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_orchestrator.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.interview.orchestrator'`

- [ ] **Step 3: Implement orchestrator**

`backend/app/interview/orchestrator.py`:

```python
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


async def _tone_review(interview: InterviewSession, model: str | None) -> ToneReviewOut | None:
    if not interview.working_graph or not interview.working_graph.get("nodes"):
        return None
    review = await _ask_json(
        build_tone_messages(interview.lang, interview.working_graph), model, ToneReviewOut
    )
    if review.renames:
        by_key = {r.key: r.title for r in review.renames}
        nodes = [
            {**n, "title": by_key.get(n["key"], n["title"])}
            for n in interview.working_graph["nodes"]
        ]
        interview.working_graph = {**interview.working_graph, "nodes": nodes}
    return review


async def run_turn(
    db,
    interview: InterviewSession,
    turn: InterviewTurnIn,
    graph_summary: str,
    context_text: str,
    model: str | None = None,
) -> None:
    seq = next_seq(interview)
    user_content = turn.content or (turn.choice_id or "")
    _append(db, interview, seq, "user", turn.type, user_content,
            payload={"choice_id": turn.choice_id} if turn.choice_id else None)

    # 선택 턴 — pending에서 그래프 채택 후 인터뷰어 이어가기
    if turn.type == "choice":
        pending = interview.pending_choices or {}
        chosen = next(
            (o for o in pending.get("options", []) if o["id"] == turn.choice_id), None
        )
        if chosen is None:
            raise TurnError("unknown choice id")
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

    # 스테이지 완료 — 체크포인트 + 톤 검수 + 전이
    if out.stage_complete or engine.is_stage_complete(interview.current_stage, interview.facts):
        consultant_msg = _append(db, interview, seq + 1, "consultant", "question", out.message)
        review = await _tone_review(interview, model)
        if review and review.renames:
            _append(db, interview, consultant_msg.seq + 1, "consultant", "notice",
                    review.message or "노드 명명을 표준에 맞게 정리했습니다.")
        db.add(InterviewCheckpoint(
            session_id=interview.id, stage=interview.current_stage,
            facts=interview.facts, working_graph=interview.working_graph,
            message_seq=next_seq(interview) - 1,
        ))
        next_key = engine.next_stage_key(interview.current_stage)
        if next_key is not None:
            interview.current_stage = next_key
        return

    _append(db, interview, seq + 1, "consultant", "question", out.message)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_orchestrator.py -q`
Expected: 6 PASS

- [ ] **Step 5: Lint + Commit**

```bash
cd backend && .venv/bin/ruff check app/ tests/
git add backend/app/interview/orchestrator.py backend/tests/test_interview_orchestrator.py PROGRESS.md
git commit -m "feat(interview): turn orchestrator with parallel choices + checkpoints — 턴 파이프라인·병렬 선택지·체크포인트"
```

---

### Task 7: 인터뷰 라우터 — API 8종 + main 등록

**Files:**
- Create: `backend/app/routers/interviews.py`
- Modify: `backend/app/main.py` (import 그룹 + include_router 1줄)
- Test: `backend/tests/test_interview_api.py` (Task 2 파일에 API 테스트 추가)

**Interfaces:**
- Consumes: `orchestrator.run_turn/TurnError`, `engine.first_incomplete_stage/stage_index`, `parsing.parse_attachment/ParseError/ALLOWED_EXTENSIONS/MAX_ATTACHMENT_BYTES/clip_to_budget`, `agents`, `_load_graph`(graph 라우터), `require_map_role`, `workflow.is_editable_status`, `settings.ai_enabled/interview_context_budget`
- Produces (프론트가 의존): 아래 엔드포인트 계약 — 응답 스키마는 Task 2의 `InterviewStateOut`

| 엔드포인트 | 동작 |
|---|---|
| `POST /api/maps/{map_id}/interviews` body `InterviewCreateIn` | editor 게이트. `ai_enabled` 아니면 503. version이 map 소속·editable status 아니면 404/409. 같은 맵×사용자 active 세션 있으면 그것 반환(재개). 새 세션이면 현재 그래프에서 facts 시드는 하지 않고, `base_graph_updated_at=version.updated_at`, 첫 컨설턴트 인사(question, AI 호출 없음 — 고정 문구) 삽입. → `InterviewStateOut` |
| `GET /api/interviews/{id}` | 소유자만(타인 404). → `InterviewStateOut` (`version_updated_at`은 현재 버전 조회값, 버전 삭제 시 None) |
| `POST /api/interviews/{id}/turns` body `InterviewTurnIn` | 소유자만·active만(409). 그래프 요약 = `_load_graph` 직렬화 요약, context = 첨부 합본 예산 클리핑. `run_turn` 후 commit. `TurnError`→502(rollback). AiUsageEvent(kind="interview") 기록. → `InterviewStateOut` |
| `POST /api/interviews/{id}/attachments` multipart `file` | 소유자만. 확장자·20MB 검증(422). `asyncio.to_thread(parse_attachment)` — 모듈 `asyncio.Lock`으로 직렬화(파싱 큐 단순화). 실패 시 status="failed" 저장 + 200. → `InterviewAttachmentOut` |
| `POST /api/interviews/{id}/revert` body `InterviewRevertIn` | 소유자만. 해당 stage의 **마지막** 체크포인트 복원: facts·working_graph·current_stage=stage, `message_seq` 초과 메시지 `superseded=True`, 이후 스테이지 체크포인트 삭제, pending_choices=None. 없으면 404. → `InterviewStateOut` |
| `POST /api/interviews/{id}/complete` | 소유자만·active만. status="completed", completed_at=now. (그래프 적용은 프론트가 graph PUT으로 선행 — §5 참고) → `InterviewStateOut` |
| `DELETE /api/interviews/{id}` | 소유자만. status="abandoned" (데이터 보존). 204 |
| `GET /api/maps/{map_id}/interviews/active` | editor 게이트. 내 active 세션 있으면 `InterviewStateOut`, 없으면 404 — 에디터 진입 버튼의 재개 판정용 |

- [ ] **Step 1: Write the failing tests** (`backend/tests/test_interview_api.py`에 추가)

```python
import json

from fastapi.testclient import TestClient

from app import ai_client
from app.settings import settings

_iv_seq = 0


def _iv_map(client: TestClient) -> dict:
    global _iv_seq
    _iv_seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"interview map {_iv_seq}"},
    ).json()


def _enable_ai(monkeypatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str):
    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(content=content, prompt_tokens=10, completion_tokens=5)

    return _call


_Q = json.dumps({"message": "프로세스 이름이 뭔가요?", "facts_patch": {}})


def test_interview_requires_ai_enabled(client: TestClient) -> None:
    created = _iv_map(client)
    resp = client.post(
        f"/api/maps/{created['id']}/interviews",
        json={"version_id": created["versions"][0]["id"]},
    )
    assert resp.status_code == 503


def test_interview_create_and_resume(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    first = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert first.status_code == 200
    body = first.json()
    assert body["status"] == "active" and body["current_stage"] == "scope"
    assert body["messages"][0]["role"] == "consultant"  # 고정 인사
    # 같은 맵 재호출 → 동일 세션 재개
    second = client.post(f"/api/maps/{created['id']}/interviews", json={"version_id": version_id})
    assert second.json()["id"] == body["id"]


def test_interview_turn_flow(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(_Q))
    resp = client.post(
        f"/api/interviews/{session_id}/turns",
        json={"type": "answer", "content": "구매 요청 프로세스입니다"},
    )
    assert resp.status_code == 200
    kinds = [m["kind"] for m in resp.json()["messages"]]
    assert kinds[-2:] == ["answer", "question"]


def test_interview_turn_ai_failure_is_atomic(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]

    async def _boom(messages, model=None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    before = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 502
    after = len(client.get(f"/api/interviews/{session_id}").json()["messages"])
    assert after == before  # 롤백 — 사용자 메시지도 남지 않음


def test_interview_idor_other_user_404(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    resp = client.get(f"/api/interviews/{session_id}", headers={"X-Dev-User": "someone.else"})
    assert resp.status_code == 404


def test_interview_attachment_upload_and_reject(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    ok = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("memo.txt", "구매 절차 메모".encode(), "text/plain")},
    )
    assert ok.status_code == 200 and ok.json()["status"] == "parsed"
    bad = client.post(
        f"/api/interviews/{session_id}/attachments",
        files={"file": ("virus.exe", b"MZ", "application/octet-stream")},
    )
    assert bad.status_code == 422


def test_interview_revert_restores_checkpoint(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = json.dumps({
        "message": "확정. 다음 주제로.", "facts_patch": {
            "process_name": "구매", "purpose": "표준화", "boundaries": "접수~발주"},
        "stage_complete": True,
    })
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(done))
    client.post(f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "…"})
    state = client.get(f"/api/interviews/{session_id}").json()
    assert state["current_stage"] == "io"
    assert [c["stage"] for c in state["checkpoints"]] == ["scope"]
    reverted = client.post(f"/api/interviews/{session_id}/revert", json={"stage": "scope"})
    assert reverted.status_code == 200
    assert reverted.json()["current_stage"] == "scope"


def test_interview_complete_and_delete(client: TestClient, monkeypatch) -> None:
    _enable_ai(monkeypatch)
    created = _iv_map(client)
    version_id = created["versions"][0]["id"]
    session_id = client.post(
        f"/api/maps/{created['id']}/interviews", json={"version_id": version_id}
    ).json()["id"]
    done = client.post(f"/api/interviews/{session_id}/complete")
    assert done.status_code == 200 and done.json()["status"] == "completed"
    # 완료 후 턴은 409
    resp = client.post(
        f"/api/interviews/{session_id}/turns", json={"type": "answer", "content": "x"}
    )
    assert resp.status_code == 409
    gone = client.delete(f"/api/interviews/{session_id}")
    assert gone.status_code == 204
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_api.py -q`
Expected: 신규 테스트들 FAIL (404 — 라우터 미등록)

- [ ] **Step 3: Implement router**

`backend/app/routers/interviews.py`:

```python
"""AI 컨설턴트 인터뷰 API — 세션·턴·첨부·체크포인트·완료 (design 2026-07-23 §5)."""

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app import workflow
from app.auth import get_current_user
from app.clock import now as now_kst
from app.db import get_session
from app.interview import engine
from app.interview.orchestrator import TurnError, run_turn
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
    MapVersion,
)
from app.permissions.deps import require_map_role
from app.routers.graph import _load_graph
from app.schemas import (
    InterviewAttachmentOut,
    InterviewCreateIn,
    InterviewRevertIn,
    InterviewStateOut,
    InterviewTurnIn,
)
from app.settings import settings

router = APIRouter(prefix="/api", tags=["interviews"], dependencies=[Depends(get_current_user)])

logger = logging.getLogger(__name__)

# 파싱 직렬화 — 무거운 파싱이 동시에 몰리지 않게 1개씩 (스펙 §4 백그라운드 직렬화의 단순화)
_parse_lock = asyncio.Lock()

_GREETING = {
    "ko": "안녕하세요, 프로세스 컨설턴트입니다. 지금부터 몇 가지 질문으로 프로세스 맵을 함께 만들어보겠습니다. 먼저, 이 프로세스의 이름과 목적을 알려주세요. 참고할 문서가 있다면 지금 첨부하셔도 좋습니다.",
    "en": "Hello, I'm your process consultant. I'll ask a few questions to build the process map together. First, what is this process called and what is its purpose? Feel free to attach reference documents.",
}


def _require_ai_enabled() -> None:
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")


async def _get_owned_interview(
    session: AsyncSession, interview_id: int, user: str
) -> InterviewSession:
    """본인 세션만 — 없거나 타인 것이면 404(존재 노출 안 함)."""
    row = await session.get(InterviewSession, interview_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail=f"interview {interview_id} not found")
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
    _require_ai_enabled()
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

    interview = InterviewSession(
        map_id=map_id,
        version_id=payload.version_id,
        login_id=user,
        lang=payload.lang,
        facts={},
        base_graph_updated_at=version.updated_at,
    )
    session.add(interview)
    await session.flush()  # id 채번 — 메시지 FK
    session.add(
        InterviewMessage(
            session_id=interview.id, seq=1, role="consultant", kind="question",
            content=_GREETING.get(payload.lang, _GREETING["ko"]), stage="scope",
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
async def post_turn(
    interview_id: int,
    payload: InterviewTurnIn,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InterviewStateOut:
    _require_ai_enabled()
    interview = await _get_owned_interview(session, interview_id, user)
    if interview.status != "active":
        raise HTTPException(status_code=409, detail="interview is not active")

    current = await _load_graph(session, interview.version_id)
    context_text = await _context_text(interview)
    try:
        await run_turn(
            session, interview, payload, _graph_summary(current), context_text
        )
    except TurnError as exc:
        await session.rollback()
        # 실패도 계량 — 별도 커밋, 실패해도 502 전파 유지
        try:
            session.add(AiUsageEvent(
                login_id=user, map_id=interview.map_id, version_id=interview.version_id,
                model="", kind=None, ok=False,
            ))
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답을 바꾸지 않는다
            await session.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    session.add(AiUsageEvent(
        login_id=user, map_id=interview.map_id, version_id=interview.version_id,
        model="", kind="interview", ok=True,
    ))
    interview.updated_at = now_kst()
    await session.commit()
    loaded = await _get_owned_interview(session, interview_id, user)
    return await _state_out(session, loaded)


@router.post("/interviews/{interview_id}/attachments", response_model=InterviewAttachmentOut)
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
    await session.commit()
    await session.refresh(row)
    return InterviewAttachmentOut.model_validate(row)


@router.post("/interviews/{interview_id}/revert", response_model=InterviewStateOut)
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
async def abandon_interview(
    interview_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    interview = await _get_owned_interview(session, interview_id, user)
    interview.status = "abandoned"
    await session.commit()
```

`backend/app/main.py` — import 그룹에 `interviews` 추가(알파벳 순서 위치: `inbox` 다음), `app.include_router(inbox.router)` 아래에:

```python
app.include_router(interviews.router)
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_interview_api.py -q`
Expected: 전부 PASS (스키마 4 + API 8)

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: 기존 696 + 신규 전부 PASS

- [ ] **Step 6: Lint + Commit**

```bash
cd backend && .venv/bin/ruff check app/ tests/
git add backend/app/routers/interviews.py backend/app/main.py backend/tests/test_interview_api.py PROGRESS.md
git commit -m "feat(interview): interview API (create/resume, turns, attachments, revert, complete) — 인터뷰 API 8종"
```

---

### Task 8: 프론트 API 함수 + 순수 헬퍼 (lib)

**Files:**
- Modify: `frontend/src/lib/api.ts` (파일 끝에 추가 — `aiChat` 블록 아래)
- Create: `frontend/src/lib/interview.ts`
- Test: `frontend/src/lib/interview.test.ts`

**Interfaces:**
- Consumes: `api.ts`의 `request<T>`·`ApiError`·모듈 상태(`authToken`/`devUser`), `@/lib/flow-layout` `autoLayoutFlow`, `@/lib/canvas` `nodeSizeOf`/`normalizeNodeType`/`AppNode`, 기존 `AiNode`/`AiEdge`/`AiGroup` 타입
- Produces (후속 태스크가 사용):
  - api.ts: `interface InterviewMessage {id;seq;role;kind;content;payload:Record<string,unknown>|null;stage;superseded;created_at}` · `interface InterviewCheckpoint {stage;message_seq;created_at}` · `interface InterviewAttachment {id;filename;mime;size;status;error;created_at}` · `interface WorkingGraph {nodes:AiNode[];edges:AiEdge[];groups:AiGroup[]}` · `interface InterviewState {id;map_id;version_id;status;current_stage;lang;working_graph:WorkingGraph|null;messages:InterviewMessage[];checkpoints:InterviewCheckpoint[];attachments:InterviewAttachment[];version_updated_at:string|null;base_graph_updated_at:string|null}` · `interface ChoiceOption {id;title;summary;graph:WorkingGraph}`
  - api.ts 함수: `createOrResumeInterview(mapId:number, versionId:number, lang:"ko"|"en"):Promise<InterviewState>` · `getInterview(id:number)` · `getActiveInterview(mapId:number)` · `postInterviewTurn(id:number, turn:{type:"answer"|"choice"|"confirm"|"skip"; content?:string; choice_id?:string})` · `postInterviewRevert(id:number, stage:string)` · `completeInterview(id:number)` · `abandonInterview(id:number)` · `uploadInterviewAttachment(id:number, file:File):Promise<InterviewAttachment>`(multipart — Content-Type 자동)
  - interview.ts: `INTERVIEW_STAGES:{key:string;label:string}[]`(7단계, label 영어) · `stageIndex(key):number` · `choiceOptionsOf(messages:InterviewMessage[]):ChoiceOption[]|null`(마지막 메시지가 kind==="choices"일 때만 payload.options 반환) · `addedNodeKeys(prev:WorkingGraph|null, next:WorkingGraph|null):Set<string>` · `layoutWorkingGraph(graph:WorkingGraph|null, added:Set<string>):{nodes:AppNode[];edges:Edge[]}`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/interview.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { InterviewMessage, WorkingGraph } from "./api";
import {
  INTERVIEW_STAGES,
  addedNodeKeys,
  choiceOptionsOf,
  layoutWorkingGraph,
  stageIndex,
} from "./interview";

const GRAPH: WorkingGraph = {
  nodes: [
    { key: "s", title: "시작", node_type: "start", description: "", attributes: null, group_key: null },
    { key: "a", title: "요청서 작성", node_type: "process", description: "", attributes: null, group_key: null },
  ],
  edges: [{ source: "s", target: "a", label: "" }],
  groups: [],
};

function msg(over: Partial<InterviewMessage>): InterviewMessage {
  return {
    id: 1, seq: 1, role: "consultant", kind: "question", content: "",
    payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T00:00:00+09:00",
    ...over,
  };
}

describe("INTERVIEW_STAGES", () => {
  it("고정 7단계 순서", () => {
    expect(INTERVIEW_STAGES.map((s) => s.key)).toEqual(
      ["scope", "io", "activities", "branches", "roles", "params", "review"],
    );
    expect(stageIndex("activities")).toBe(2);
  });
});

describe("choiceOptionsOf", () => {
  it("마지막 메시지가 choices일 때만 옵션 반환", () => {
    const options = [{ id: "opt-1", title: "표준안", summary: "", graph: GRAPH }];
    const withChoices = [msg({}), msg({ id: 2, seq: 2, kind: "choices", payload: { options } })];
    expect(choiceOptionsOf(withChoices)?.[0].id).toBe("opt-1");
    const answered = [...withChoices, msg({ id: 3, seq: 3, role: "user", kind: "choice" })];
    expect(choiceOptionsOf(answered)).toBeNull();
  });
});

describe("addedNodeKeys", () => {
  it("이전 대비 새 키만", () => {
    const next: WorkingGraph = { ...GRAPH, nodes: [...GRAPH.nodes, { key: "b", title: "검토", node_type: "process", description: "", attributes: null, group_key: null }] };
    expect(addedNodeKeys(GRAPH, next)).toEqual(new Set(["b"]));
    expect(addedNodeKeys(null, GRAPH)).toEqual(new Set());  // 첫 그래프는 전체 하이라이트 안 함
  });
});

describe("layoutWorkingGraph", () => {
  it("dagre 배치 후 좌표·diffStatus 부여", () => {
    const { nodes, edges } = layoutWorkingGraph(GRAPH, new Set(["a"]));
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    const a = nodes.find((n) => n.id === "a");
    expect(a?.data.diffStatus).toBe("added");
    expect(typeof a?.position.x).toBe("number");
    expect(layoutWorkingGraph(null, new Set()).nodes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/interview.test.ts`
Expected: FAIL — 모듈 없음

- [ ] **Step 3: Implement api.ts additions**

`frontend/src/lib/api.ts` 파일 끝(`aiChat`/세션 함수 블록 아래)에:

```ts
// ---------- AI 컨설턴트 인터뷰 (design 2026-07-23) ----------

export interface WorkingGraph {
  nodes: AiNode[];
  edges: AiEdge[];
  groups: AiGroup[];
}

export interface ChoiceOption {
  id: string;
  title: string;
  summary: string;
  graph: WorkingGraph;
}

export interface InterviewMessage {
  id: number;
  seq: number;
  role: string; // consultant | user
  kind: string; // question | choices | notice | answer | choice | confirm | skip
  content: string;
  payload: Record<string, unknown> | null;
  stage: string;
  superseded: boolean;
  created_at: string;
}

export interface InterviewCheckpoint {
  stage: string;
  message_seq: number;
  created_at: string;
}

export interface InterviewAttachment {
  id: number;
  filename: string;
  mime: string;
  size: number;
  status: string; // parsed | failed
  error: string;
  created_at: string;
}

export interface InterviewState {
  id: number;
  map_id: number;
  version_id: number;
  status: string; // active | completed | abandoned
  current_stage: string;
  lang: string;
  working_graph: WorkingGraph | null;
  messages: InterviewMessage[];
  checkpoints: InterviewCheckpoint[];
  attachments: InterviewAttachment[];
  version_updated_at: string | null;
  base_graph_updated_at: string | null;
}

export function createOrResumeInterview(
  mapId: number,
  versionId: number,
  lang: "ko" | "en",
): Promise<InterviewState> {
  return request<InterviewState>(`/maps/${mapId}/interviews`, {
    method: "POST",
    body: JSON.stringify({ version_id: versionId, lang }),
  });
}

export function getInterview(id: number): Promise<InterviewState> {
  return request<InterviewState>(`/interviews/${id}`);
}

export function getActiveInterview(mapId: number): Promise<InterviewState> {
  return request<InterviewState>(`/maps/${mapId}/interviews/active`);
}

export function postInterviewTurn(
  id: number,
  turn: { type: "answer" | "choice" | "confirm" | "skip"; content?: string; choice_id?: string },
): Promise<InterviewState> {
  return request<InterviewState>(`/interviews/${id}/turns`, {
    method: "POST",
    body: JSON.stringify({ content: "", ...turn }),
  });
}

export function postInterviewRevert(id: number, stage: string): Promise<InterviewState> {
  return request<InterviewState>(`/interviews/${id}/revert`, {
    method: "POST",
    body: JSON.stringify({ stage }),
  });
}

export function completeInterview(id: number): Promise<InterviewState> {
  return request<InterviewState>(`/interviews/${id}/complete`, { method: "POST" });
}

export function abandonInterview(id: number): Promise<void> {
  return request<void>(`/interviews/${id}`, { method: "DELETE" });
}

export async function uploadInterviewAttachment(
  id: number,
  file: File,
): Promise<InterviewAttachment> {
  // multipart — request()의 JSON Content-Type을 쓰면 boundary가 깨져 별도 경로
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = {};
  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  } else if (devUser) {
    headers["X-Dev-User"] = devUser;
  }
  const response = await fetch(`/api/interviews/${id}/attachments`, {
    method: "POST",
    body: form,
    headers,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ApiError(
      `API POST /interviews/${id}/attachments failed: ${response.status}${detail ? ` — ${detail}` : ""}`,
      response.status,
      detail,
    );
  }
  return (await response.json()) as InterviewAttachment;
}
```

- [ ] **Step 4: Implement interview.ts helpers**

`frontend/src/lib/interview.ts` — **주의: `data` 필드 구성은 `compare/page.tsx:195-227`의 `buildAppNodes`를 먼저 Read해 실제 `NodeData` 필드명에 맞출 것** (아래 초안은 nodeType/diffStatus/sideHandles 확인분 기준):

```ts
// AI 컨설턴트 인터뷰 — 순수 헬퍼: 스테이지 상수·선택지 추출·작업본 diff·dagre 배치 (design 2026-07-23)

import type { Edge } from "@xyflow/react";

import type { ChoiceOption, InterviewMessage, WorkingGraph } from "./api";
import type { AppNode } from "./canvas";
import { nodeSizeOf, normalizeNodeType } from "./canvas";
import { autoLayoutFlow } from "./flow-layout";

// 백엔드 engine.STAGES와 키·순서 동기 — 변경 시 양쪽 함께 (UI 라벨은 영어 고정)
export const INTERVIEW_STAGES = [
  { key: "scope", label: "Scope" },
  { key: "io", label: "Inputs & Outputs" },
  { key: "activities", label: "Activities" },
  { key: "branches", label: "Branches" },
  { key: "roles", label: "Roles & Systems" },
  { key: "params", label: "Parameters" },
  { key: "review", label: "Review" },
] as const;

export function stageIndex(key: string): number {
  return INTERVIEW_STAGES.findIndex((s) => s.key === key);
}

export function choiceOptionsOf(messages: InterviewMessage[]): ChoiceOption[] | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "consultant" || last.kind !== "choices") return null;
  const options = (last.payload as { options?: ChoiceOption[] } | null)?.options;
  return options && options.length > 0 ? options : null;
}

export function addedNodeKeys(
  prev: WorkingGraph | null,
  next: WorkingGraph | null,
): Set<string> {
  if (!prev || !next) return new Set(); // 첫 그래프는 전체가 신규 — 하이라이트 안 함
  const before = new Set(prev.nodes.map((n) => n.key));
  return new Set(next.nodes.filter((n) => !before.has(n.key)).map((n) => n.key));
}

export function layoutWorkingGraph(
  graph: WorkingGraph | null,
  added: Set<string>,
): { nodes: AppNode[]; edges: Edge[] } {
  if (!graph || graph.nodes.length === 0) return { nodes: [], edges: [] };
  const nodes: AppNode[] = graph.nodes.map((n) => {
    const nodeType = normalizeNodeType(n.node_type);
    return {
      id: n.key,
      type: "process",
      position: { x: 0, y: 0 },
      width: nodeSizeOf(nodeType).w,
      height: nodeSizeOf(nodeType).h,
      data: {
        title: n.title,
        description: n.description,
        nodeType,
        color: "",
        sideHandles: true,
        diffStatus: added.has(n.key) ? ("added" as const) : undefined,
      },
    } as AppNode;
  });
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e-${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
  }));
  return autoLayoutFlow(nodes, edges, "LR");
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/lib/interview.test.ts && npx tsc --noEmit`
Expected: 테스트 PASS + 타입 에러 0 (NodeData 필드 불일치 시 buildAppNodes 기준으로 수정)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/interview.ts frontend/src/lib/interview.test.ts PROGRESS.md
git commit -m "feat(interview-fe): interview API client + pure helpers — 인터뷰 API 클라이언트·순수 헬퍼"
```

---

### Task 9: consult 라우트 — 세션 부트스트랩 + 레이아웃 + 대화 턴

**Files:**
- Create: `frontend/src/app/maps/[mapId]/consult/page.tsx`
- Create: `frontend/src/components/interview/interview-panel.tsx`

**Interfaces:**
- Consumes: Task 8 전부, `getMe`/`getMap`/`ApiError`/`getApiErrorDetail`, `ConfirmDialog`(`@/components/confirm-dialog`), Lucide 아이콘
- Produces: `/maps/[mapId]/consult?version=<id>` 라우트. `InterviewPanel` props: `{ interview: InterviewState; busy: boolean; error: string | null; onSend(content: string): void; onChoose(choiceId: string): void; onRetry(): void; onAttach(file: File): void }`

- [ ] **Step 1: consult page 골격 구현** (라우트·부트스트랩·상태 — 시각 검증은 Step 3)

`frontend/src/app/maps/[mapId]/consult/page.tsx`:

```tsx
"use client";

// AI 컨설턴트 인터뷰 모드 — 풀스크린(TopNav 아래): 좌 대화 + 우 읽기전용 프리뷰 (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Headset } from "lucide-react";

import {
  ApiError,
  createOrResumeInterview,
  getApiErrorDetail,
  getMe,
  getMap,
  postInterviewTurn,
  uploadInterviewAttachment,
  type InterviewState,
} from "@/lib/api";
import { INTERVIEW_STAGES, stageIndex } from "@/lib/interview";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InterviewPanel } from "@/components/interview/interview-panel";
import { InterviewPreview } from "@/components/interview/interview-preview";

export default function ConsultPage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);
  const router = useRouter();

  const [interview, setInterview] = useState<InterviewState | null>(null);
  const [mapName, setMapName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null); // 403/503 등 진입 불가
  const lastTurnRef = useRef<{ type: "answer" | "choice"; content?: string; choice_id?: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await getMe();
        if (!me.ai_enabled) {
          if (!cancelled) setFatal("AI is disabled on this server.");
          return;
        }
        const detail = await getMap(mapId);
        if (cancelled) return;
        setMapName(detail.name);
        const query = new URLSearchParams(window.location.search);
        const fromQuery = Number(query.get("version"));
        const draft = detail.versions.find((v) => v.id === fromQuery)
          ?? detail.versions.find((v) => v.status === "draft");
        if (!draft) {
          setFatal("No editable draft version.");
          return;
        }
        const state = await createOrResumeInterview(mapId, draft.id, "ko");
        if (!cancelled) setInterview(state);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setFatal("You don't have permission to consult on this map.");
        } else if (err instanceof ApiError && err.status === 503) {
          setFatal("AI is disabled on this server.");
        } else {
          setFatal(getApiErrorDetail(err) || "Failed to start the interview.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  async function runTurn(turn: { type: "answer" | "choice"; content?: string; choice_id?: string }) {
    if (!interview || busy) return;
    lastTurnRef.current = turn;
    setBusy(true);
    setError(null);
    try {
      setInterview(await postInterviewTurn(interview.id, turn));
    } catch (err) {
      setError(getApiErrorDetail(err) || "AI request failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAttach(file: File) {
    if (!interview) return;
    try {
      const uploaded = await uploadInterviewAttachment(interview.id, file);
      setInterview({ ...interview, attachments: [...interview.attachments, uploaded] });
    } catch (err) {
      setError(getApiErrorDetail(err) || "Failed to upload the file.");
    }
  }

  if (fatal) {
    return (
      <ConfirmDialog
        title="Cannot open consultant"
        message={fatal}
        confirmLabel="Back to map"
        onConfirm={() => router.replace(`/maps/${mapId}`)}
        onClose={() => router.replace(`/maps/${mapId}`)}
      />
    );
  }

  const stageIdx = interview ? stageIndex(interview.current_stage) : 0;

  return (
    <div className="flex h-full flex-col" data-id="consult-page">
      <header className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-2">
        <Link
          href={`/maps/${mapId}`}
          className="flex items-center gap-1 text-caption text-ink-tertiary hover:text-ink"
          data-id="consult-exit"
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
          Back
        </Link>
        <Headset size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-body-strong">{mapName || "…"}</span>
        <span className="text-caption text-ink-muted">— Consultant</span>
        <ol className="ml-auto flex items-center gap-1" data-id="consult-progress">
          {INTERVIEW_STAGES.map((stage, i) => (
            <li
              key={stage.key}
              title={stage.label}
              className={
                "h-1.5 w-6 rounded-xs " +
                (i < stageIdx ? "bg-accent" : i === stageIdx ? "bg-accent/60" : "bg-surface-alt")
              }
            />
          ))}
        </ol>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[440px] shrink-0 flex-col border-r border-hairline bg-surface">
          {interview ? (
            <InterviewPanel
              interview={interview}
              busy={busy}
              error={error}
              onSend={(content) => runTurn({ type: "answer", content })}
              onChoose={(choiceId) => runTurn({ type: "choice", choice_id: choiceId })}
              onRetry={() => lastTurnRef.current && runTurn(lastTurnRef.current)}
              onAttach={handleAttach}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-caption text-ink-muted">
              Starting interview…
            </div>
          )}
        </aside>
        <InterviewPreview interview={interview} onUpdated={setInterview} mapId={mapId} />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: InterviewPanel 구현**

`frontend/src/components/interview/interview-panel.tsx`:

```tsx
"use client";

// 인터뷰 좌측 패널 — 메시지 스트림(질문·선택지·알림) + 입력 + 첨부 (design 2026-07-23 §6)

import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, RotateCcw, Send } from "lucide-react";

import type { InterviewState } from "@/lib/api";
import { choiceOptionsOf } from "@/lib/interview";
import { ChoiceCard } from "@/components/interview/choice-card";

interface InterviewPanelProps {
  interview: InterviewState;
  busy: boolean;
  error: string | null;
  onSend: (content: string) => void;
  onChoose: (choiceId: string) => void;
  onRetry: () => void;
  onAttach: (file: File) => void;
}

export function InterviewPanel({
  interview, busy, error, onSend, onChoose, onRetry, onAttach,
}: InterviewPanelProps) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const live = interview.messages.filter((m) => !m.superseded);
  const choices = interview.status === "active" ? choiceOptionsOf(live) : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [live.length, busy]);

  function submit() {
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    onSend(content);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-id="interview-panel">
      <ul ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {live.map((message) => (
          <li key={message.id} data-id={`iv-msg-${message.kind}`}>
            {message.role === "user" ? (
              <div className="ml-8 rounded-md bg-accent-tint px-3 py-2 text-body">
                {message.content}
              </div>
            ) : message.kind === "notice" ? (
              <div className="rounded-md border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
                {message.content}
              </div>
            ) : (
              <div className="mr-8 rounded-md border border-hairline bg-surface px-3 py-2 text-body shadow-sm">
                {message.content}
              </div>
            )}
          </li>
        ))}
        {choices ? (
          <li data-id="iv-choices">
            <div className="grid gap-2">
              {choices.map((option) => (
                <ChoiceCard key={option.id} option={option} disabled={busy} onChoose={onChoose} />
              ))}
            </div>
          </li>
        ) : null}
        {busy ? (
          <li className="flex items-center gap-2 text-caption text-ink-muted" data-id="iv-thinking">
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
            Consultant is thinking…
          </li>
        ) : null}
        {error ? (
          <li className="rounded-md border border-error/40 bg-error/5 px-3 py-2 text-caption text-error" data-id="iv-error">
            {error}
            <button className="ml-2 inline-flex items-center gap-1 text-caption-strong" onClick={onRetry}>
              <RotateCcw size={16} strokeWidth={1.5} /> Retry
            </button>
          </li>
        ) : null}
      </ul>
      <div className="border-t border-hairline p-2">
        {interview.attachments.length > 0 ? (
          <div className="mb-1 flex flex-wrap gap-1">
            {interview.attachments.map((a) => (
              <span
                key={a.id}
                className={
                  "rounded-xs px-1.5 py-0.5 text-fine " +
                  (a.status === "parsed" ? "bg-surface-alt text-ink-secondary" : "bg-error/10 text-error")
                }
                title={a.error || a.filename}
              >
                {a.filename}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex items-end gap-1.5">
          <button
            className="rounded-sm p-1.5 text-ink-tertiary hover:bg-surface-alt"
            title="Attach document (pdf, docx, xlsx, txt, md)"
            onClick={() => fileRef.current?.click()}
            data-id="iv-attach"
          >
            <Paperclip size={16} strokeWidth={1.5} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.xlsx,.txt,.md"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onAttach(file);
              e.target.value = "";
            }}
          />
          <textarea
            className="max-h-32 flex-1 resize-none rounded-sm border border-hairline bg-surface px-2 py-1.5 text-body outline-none focus:border-accent"
            rows={2}
            placeholder={interview.status === "active" ? "Type your answer…" : "Interview finished"}
            disabled={interview.status !== "active" || busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            data-id="iv-input"
          />
          <button
            className="rounded-sm bg-accent p-1.5 text-on-accent disabled:opacity-40"
            disabled={interview.status !== "active" || busy || !input.trim()}
            onClick={submit}
            data-id="iv-send"
          >
            <Send size={16} strokeWidth={1.5} />
          </button>
        </div>
      </div>
    </div>
  );
}
```

주의: `InterviewPreview`는 Task 10에서 구현 — 이 태스크의 타입체크를 위해 Task 10과 **같은 브랜치 순서로 연달아 진행**하거나, 임시로 `interview-preview.tsx`에 빈 스텁(`export function InterviewPreview(){return <div className="flex-1 bg-canvas"/>}`)을 만들고 Task 10에서 대체한다(스텁 사용 시 이 태스크 커밋에 포함).

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 그린 (React Compiler 린트 포함)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/maps/\[mapId\]/consult/ frontend/src/components/interview/ PROGRESS.md
git commit -m "feat(interview-fe): consult route with interview panel — 컨설팅 라우트·대화 패널"
```

---

### Task 10: 우측 프리뷰(읽기전용 React Flow) + 선택지 미니 프리뷰 + 체크포인트/적용 바

**Files:**
- Create/Replace: `frontend/src/components/interview/interview-preview.tsx`
- Create: `frontend/src/components/interview/choice-card.tsx`

**Interfaces:**
- Consumes: Task 8 헬퍼, compare 페이지의 read-only ReactFlow 패턴(`compare/page.tsx:1077-1099` — **구현 전 Read 필수**), `NodeActionsContext`(`@/lib/node-actions`), `ProcessNode`, `buildGraphFromAiProposal`(`@/lib/csv-import` — `CsvImportContext` 필드 확인), `getGraph`/`saveGraph`/`completeInterview`/`postInterviewRevert`, `ConfirmDialog`
- Produces: `InterviewPreview` props `{ interview: InterviewState | null; onUpdated(state: InterviewState): void; mapId: number }` · `ChoiceCard` props `{ option: ChoiceOption; disabled: boolean; onChoose(id: string): void }`

- [ ] **Step 1: ChoiceCard 구현 (미니 SVG 프리뷰 — ReactFlow 인스턴스 추가 없이)**

`frontend/src/components/interview/choice-card.tsx`:

```tsx
"use client";

// 선택지 카드 — dagre 배치 좌표로 그리는 정적 SVG 미니 프리뷰 (ReactFlow 미사용: 경량)

import { useMemo } from "react";

import type { ChoiceOption } from "@/lib/api";
import { layoutWorkingGraph } from "@/lib/interview";

interface ChoiceCardProps {
  option: ChoiceOption;
  disabled: boolean;
  onChoose: (id: string) => void;
}

export function ChoiceCard({ option, disabled, onChoose }: ChoiceCardProps) {
  const laid = useMemo(() => layoutWorkingGraph(option.graph, new Set()), [option.graph]);
  const box = useMemo(() => {
    if (laid.nodes.length === 0) return { x: 0, y: 0, w: 100, h: 60 };
    const xs = laid.nodes.map((n) => n.position.x);
    const ys = laid.nodes.map((n) => n.position.y);
    const pad = 30;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return {
      x: minX, y: minY,
      w: Math.max(...laid.nodes.map((n) => n.position.x + (n.width ?? 120))) - minX + pad,
      h: Math.max(...laid.nodes.map((n) => n.position.y + (n.height ?? 48))) - minY + pad,
    };
  }, [laid]);
  const centers = useMemo(
    () => new Map(laid.nodes.map((n) => [
      n.id,
      { cx: n.position.x + (n.width ?? 120) / 2, cy: n.position.y + (n.height ?? 48) / 2 },
    ])),
    [laid],
  );

  return (
    <div className="rounded-md border border-hairline bg-surface p-2 shadow-sm" data-id="iv-choice-card">
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-caption-strong">{option.title}</span>
        <span className="truncate text-fine text-ink-tertiary">{option.summary}</span>
      </div>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} className="h-28 w-full rounded-xs bg-canvas">
        {laid.edges.map((e) => {
          const s = centers.get(e.source);
          const t = centers.get(e.target);
          if (!s || !t) return null;
          return (
            <line key={e.id} x1={s.cx} y1={s.cy} x2={t.cx} y2={t.cy}
              stroke="var(--color-border-strong)" strokeWidth={2} />
          );
        })}
        {laid.nodes.map((n) => (
          <g key={n.id}>
            <rect x={n.position.x} y={n.position.y} width={n.width ?? 120} height={n.height ?? 48}
              rx={8} fill="var(--color-surface)" stroke="var(--color-border-strong)" strokeWidth={1.5} />
            <text x={n.position.x + (n.width ?? 120) / 2} y={n.position.y + (n.height ?? 48) / 2}
              textAnchor="middle" dominantBaseline="central"
              style={{ fontSize: 12, fill: "var(--color-ink-secondary)" }}>
              {(n.data.title as string).slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>
      <button
        className="mt-1.5 w-full rounded-sm bg-accent-tint py-1 text-caption-strong text-accent hover:bg-accent-tint/70 disabled:opacity-40"
        disabled={disabled}
        onClick={() => onChoose(option.id)}
        data-id="iv-choice-pick"
      >
        Use this option
      </button>
    </div>
  );
}
```

- [ ] **Step 2: InterviewPreview 구현** — 구현 전 `compare/page.tsx:82, 151-160, 1077-1099`를 Read해 props·context를 그대로 따를 것:

`frontend/src/components/interview/interview-preview.tsx`:

```tsx
"use client";

// 우측 프리뷰 — 작업본 그래프 읽기전용 렌더 + 변경 하이라이트(diffStatus) + 체크포인트/적용 바

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Background, BackgroundVariant, ReactFlow, ReactFlowProvider, useReactFlow } from "@xyflow/react";
import type { NodeTypes } from "@xyflow/react";
import { CheckCheck, Undo2 } from "lucide-react";
import "@xyflow/react/dist/style.css";

import {
  completeInterview, getApiErrorDetail, getGraph, postInterviewRevert, saveGraph,
  type InterviewState, type WorkingGraph,
} from "@/lib/api";
import { addedNodeKeys, layoutWorkingGraph, INTERVIEW_STAGES } from "@/lib/interview";
import { buildGraphFromAiProposal } from "@/lib/csv-import";
import { NodeActionsContext, type NodeActions } from "@/lib/node-actions";
import { ProcessNode } from "@/components/process-node";
import { ConfirmDialog } from "@/components/confirm-dialog";

const nodeTypes: NodeTypes = { process: ProcessNode };

// compare의 COMPARE_NODE_ACTIONS와 동일 — ProcessNode가 요구하는 읽기전용 context
const PREVIEW_NODE_ACTIONS: NodeActions = {
  onToggleExpand: null,
  expandedInlineIds: new Set<string>(),
  displayFields: ["params"],
  editingNodeId: null,
  onStartRename: null,
  onRename: null,
  onCancelRename: null,
  ctrlDragIds: new Set<string>(),
};

interface InterviewPreviewProps {
  interview: InterviewState | null;
  onUpdated: (state: InterviewState) => void;
  mapId: number;
}

function PreviewCanvas({ graph, added }: { graph: WorkingGraph | null; added: Set<string> }) {
  const { nodes, edges } = useMemo(() => layoutWorkingGraph(graph, added), [graph, added]);
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (nodes.length > 0) fitView({ duration: 400, padding: 0.2 });
  }, [nodes, fitView]);
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      fitView
      minZoom={0.2}
      panOnDrag
      panOnScroll
      zoomOnScroll={false}
      zoomActivationKeyCode={["Control", "Meta"]}
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1.5} color="var(--color-canvas-dot)" />
    </ReactFlow>
  );
}

export function InterviewPreview({ interview, onUpdated, mapId }: InterviewPreviewProps) {
  const router = useRouter();
  const prevGraphRef = useRef<WorkingGraph | null>(null);
  const [revertStage, setRevertStage] = useState<string | null>(null);
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const graph = interview?.working_graph ?? null;
  const added = useMemo(() => addedNodeKeys(prevGraphRef.current, graph), [graph]);
  useEffect(() => {
    prevGraphRef.current = graph;
  }, [graph]);

  const conflict =
    interview?.version_updated_at != null &&
    interview?.base_graph_updated_at != null &&
    interview.version_updated_at !== interview.base_graph_updated_at;

  async function handleApply() {
    if (!interview || !graph) return;
    setApplyBusy(true);
    setApplyError(null);
    try {
      const base = await getGraph(interview.version_id);
      const outcome = buildGraphFromAiProposal(
        { nodes: graph.nodes, edges: graph.edges, groups: graph.groups },
        { base },
      );
      if (!outcome.graph) {
        setApplyError(outcome.errors.join(", ") || "Failed to build the graph.");
        return;
      }
      await saveGraph(interview.version_id, outcome.graph);
      const done = await completeInterview(interview.id);
      onUpdated(done);
      router.push(`/maps/${mapId}?version=${interview.version_id}`);
    } catch (err) {
      // 423/409 = 점유 없음 — 에디터에서 checkout 후 재시도 안내
      setApplyError(getApiErrorDetail(err) || "Failed to apply. Check out the draft in the editor first.");
    } finally {
      setApplyBusy(false);
      setApplyOpen(false);
    }
  }

  return (
    <div className="relative flex min-w-0 flex-1 flex-col bg-canvas" data-id="interview-preview">
      <ReactFlowProvider>
        <NodeActionsContext.Provider value={PREVIEW_NODE_ACTIONS}>
          <div className="min-h-0 flex-1">
            {graph && graph.nodes.length > 0 ? (
              <PreviewCanvas graph={graph} added={added} />
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-ink-muted">
                The map will appear here as the interview progresses.
              </div>
            )}
          </div>
        </NodeActionsContext.Provider>
      </ReactFlowProvider>
      <div className="flex items-center gap-1.5 border-t border-hairline bg-surface px-3 py-1.5" data-id="iv-checkpoints">
        {(interview?.checkpoints ?? []).map((cp) => {
          const label = INTERVIEW_STAGES.find((s) => s.key === cp.stage)?.label ?? cp.stage;
          return (
            <button
              key={`${cp.stage}-${cp.message_seq}`}
              className="flex items-center gap-1 rounded-sm border border-hairline px-1.5 py-0.5 text-fine text-ink-secondary hover:bg-surface-alt"
              onClick={() => setRevertStage(cp.stage)}
              title={`Go back to ${label}`}
              data-id={`iv-checkpoint-${cp.stage}`}
            >
              <Undo2 size={16} strokeWidth={1.5} />
              {label}
            </button>
          );
        })}
        {interview?.current_stage === "review" && interview.status === "active" ? (
          <button
            className="ml-auto flex items-center gap-1 rounded-sm bg-accent px-2.5 py-1 text-caption-strong text-on-accent disabled:opacity-40"
            disabled={applyBusy || !graph || graph.nodes.length === 0}
            onClick={() => setApplyOpen(true)}
            data-id="iv-apply"
          >
            <CheckCheck size={16} strokeWidth={1.5} />
            Apply to draft
          </button>
        ) : null}
        {applyError ? (
          <span className="ml-auto text-fine text-error" data-id="iv-apply-error">{applyError}</span>
        ) : null}
      </div>
      {revertStage ? (
        <ConfirmDialog
          title="Go back to a previous stage?"
          message="Messages and map changes after this checkpoint will be set aside."
          confirmLabel="Go back"
          cancelLabel="Cancel"
          danger
          onConfirm={async () => {
            if (!interview) return;
            const state = await postInterviewRevert(interview.id, revertStage);
            onUpdated(state);
            setRevertStage(null);
          }}
          onClose={() => setRevertStage(null)}
        />
      ) : null}
      {applyOpen ? (
        <ConfirmDialog
          title="Apply the interview result to the draft?"
          message={
            conflict
              ? "Warning: the draft has been edited since this interview started. Applying will merge onto the latest draft."
              : "The working map will be merged into the draft version."
          }
          confirmLabel={applyBusy ? "Applying…" : "Apply"}
          cancelLabel="Cancel"
          danger={conflict}
          confirmDisabled={applyBusy}
          onConfirm={handleApply}
          onClose={() => setApplyOpen(false)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm test`
Expected: 전부 그린. `CsvImportContext`에 `base`가 선택 필드가 아니면(`directory` 필수 등) csv-import.ts 실제 시그니처에 맞춰 호출 수정.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/interview/ PROGRESS.md
git commit -m "feat(interview-fe): read-only preview + choice cards + checkpoints/apply — 프리뷰·선택지·체크포인트·적용"
```

---

### Task 11: 에디터 진입 버튼

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (헤더 툴바 — undo 버튼 인근, `page.tsx:7134` 부근)

**Interfaces:**
- Consumes: 에디터의 `topIconBtn` 클래스 문자열, `readOnly` 플래그, `versionId`(현재 열린 버전 상태 변수 — 에디터 내 실제 이름을 grep으로 확인: `const readOnly =` 근처), `router`
- Produces: 헤더에 `data-id="open-consultant"` 버튼 — 클릭 시 `/maps/${mapId}/consult?version=${versionId}` 이동

- [ ] **Step 1: 버튼 추가** — undo 버튼(`page.tsx:7134-7141`) 위쪽에 삽입. `~9400줄 파일이므로 grep으로 정확한 앵커 확인 후 최소 삽입`:

```tsx
<button
  className={topIconBtn}
  onClick={() => router.push(`/maps/${mapId}/consult?version=${versionId}`)}
  disabled={readOnly}
  title="AI Consultant"
  data-id="open-consultant"
>
  <Headset size={16} strokeWidth={1.5} />
</button>
```

lucide-react import 목록에 `Headset` 추가. `versionId`는 에디터의 현재 버전 상태 변수명으로 치환(예: `version?.id` — 실제 이름 확인).

- [ ] **Step 2: Verify + Commit**

Run: `cd frontend && npx tsc --noEmit && npm run lint`
Expected: 그린

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(interview-fe): consultant entry button in editor header — 에디터 헤더 진입 버튼"
```

---

### Task 12: Playwright 스모크 (API 모킹) + 전체 게이트 + 스펙 동기화

**Files:**
- Create: `frontend/scripts/pw-smoke-consult.mjs`
- Modify: `docs/design/2026-07-23-ai-consultant-interview-design.md` (P1 단순화 반영)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: 기존 pw 스크립트 패턴(`scripts/pw-smoke-map-403.mjs`의 `page.route` 모킹, `bpm.devUser` init script), dev 서버 백엔드 :8000 + 프론트 :3000 기동 상태
- Produces: `node scripts/pw-smoke-consult.mjs` 그린

- [ ] **Step 1: 스모크 스크립트 작성**

`frontend/scripts/pw-smoke-consult.mjs` — 모든 인터뷰 API를 `page.route`로 모킹(백엔드 AI 불필요):

```js
// consult 라우트 스모크 — API 모킹으로 인사→답변→선택지→선택→프리뷰 갱신 검증
// 전제: frontend dev(:3000) 기동. 사용: node scripts/pw-smoke-consult.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const MAP_ID = 9101;

const graph = (keys) => ({
  nodes: keys.map((k, i) => ({
    key: k, title: `step ${i}`, node_type: i === 0 ? "start" : i === keys.length - 1 ? "end" : "process",
    description: "", attributes: null, group_key: null,
  })),
  edges: keys.slice(1).map((k, i) => ({ source: keys[i], target: k, label: "" })),
  groups: [],
});

const state = {
  id: 1, map_id: MAP_ID, version_id: 501, status: "active", current_stage: "scope", lang: "ko",
  working_graph: null, checkpoints: [], attachments: [],
  version_updated_at: "2026-07-23T10:00:00+09:00", base_graph_updated_at: "2026-07-23T10:00:00+09:00",
  messages: [{ id: 1, seq: 1, role: "consultant", kind: "question", content: "안녕하세요, 컨설턴트입니다.", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:00:00+09:00" }],
};

const afterAnswer = {
  ...state,
  messages: [...state.messages,
    { id: 2, seq: 2, role: "user", kind: "answer", content: "구매 프로세스", payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T10:01:00+09:00" },
    { id: 3, seq: 3, role: "consultant", kind: "choices", content: "안을 골라주세요.", stage: "activities",
      payload: { options: [
        { id: "opt-1", title: "Standard", summary: "6 steps", graph: graph(["s", "a", "e"]) },
        { id: "opt-2", title: "Detailed", summary: "9 steps", graph: graph(["s", "a", "b", "e"]) },
      ] }, superseded: false, created_at: "2026-07-23T10:01:05+09:00" }],
};

const afterChoice = {
  ...afterAnswer, working_graph: graph(["s", "a", "e"]),
  checkpoints: [{ stage: "activities", message_seq: 5, created_at: "2026-07-23T10:02:00+09:00" }],
  messages: [...afterAnswer.messages,
    { id: 4, seq: 4, role: "user", kind: "choice", content: "opt-1", payload: { choice_id: "opt-1" }, stage: "activities", superseded: false, created_at: "2026-07-23T10:02:00+09:00" },
    { id: 5, seq: 5, role: "consultant", kind: "question", content: "역할을 알려주세요.", payload: null, stage: "roles", superseded: false, created_at: "2026-07-23T10:02:05+09:00" }],
};

const run = async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    window.localStorage.setItem("bpm.devUser", "admin.sys");
    window.localStorage.setItem("bpm.lang", "en");
  });
  const page = await ctx.newPage();
  let turnCount = 0;

  await page.route("**/api/me", (r) => r.fulfill({ json: { login_id: "admin.sys", name: "Admin", ai_enabled: true, manual_url: "", csv_manual_url: "", role: "admin", is_sysadmin: true, can_view_dashboard: true } }));
  await page.route(`**/api/maps/${MAP_ID}`, (r) => r.fulfill({ json: { id: MAP_ID, name: "Consult Smoke", description: "", created_by: null, created_at: "", updated_at: "", my_role: "owner", visibility: "public", owning_department: "X", versions: [{ id: 501, label: "As-Is", status: "draft", events: [] }] } }));
  await page.route(`**/api/maps/${MAP_ID}/interviews`, (r) => r.fulfill({ json: state }));
  await page.route("**/api/interviews/1/turns", (r) => {
    turnCount += 1;
    r.fulfill({ json: turnCount === 1 ? afterAnswer : afterChoice });
  });

  await page.goto(`${BASE}/maps/${MAP_ID}/consult`);
  await page.waitForSelector('[data-id="interview-panel"]');
  if (!(await page.textContent('[data-id="interview-panel"]')).includes("컨설턴트")) throw new Error("greeting missing");

  await page.fill('[data-id="iv-input"]', "구매 프로세스");
  await page.click('[data-id="iv-send"]');
  await page.waitForSelector('[data-id="iv-choice-card"]');
  const cards = await page.$$('[data-id="iv-choice-card"]');
  if (cards.length !== 2) throw new Error(`expected 2 choice cards, got ${cards.length}`);

  await page.click('[data-id="iv-choice-pick"]');
  await page.waitForSelector('[data-id="iv-checkpoint-activities"]');
  await page.waitForSelector(".react-flow__node");
  const nodes = await page.$$(".react-flow__node");
  if (nodes.length !== 3) throw new Error(`expected 3 preview nodes, got ${nodes.length}`);

  console.log("PW consult smoke: OK");
  await browser.close();
};

run().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run smoke**

Run: `cd frontend && npm run dev &` (이미 떠 있으면 생략 — 좀비 3000 포트 주의: `pkill -f "next dev"` 후 재기동), 이후 `node scripts/pw-smoke-consult.mjs`
Expected: `PW consult smoke: OK`

- [ ] **Step 3: 전체 게이트**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
cd frontend && npm test && npm run lint && npx tsc --noEmit && npm run build
```
Expected: 전부 그린 (백엔드 696+, 프론트 512+)

- [ ] **Step 4: 스펙 동기화** — `docs/design/2026-07-23-ai-consultant-interview-design.md`의 §5 표에서 apply 행을 "프론트가 `buildGraphFromAiProposal`+graph PUT 재사용, `/complete`는 상태 전이만"으로, §6의 `ring-added`를 `diffStatus("added") → border-added`로, 확인 카드를 "P1은 질문 문구로 대체(전용 카드 P2)"로 수정.

- [ ] **Step 5: Final Commit**

```bash
git add frontend/scripts/pw-smoke-consult.mjs docs/design/2026-07-23-ai-consultant-interview-design.md PROGRESS.md
git commit -m "test(interview): consult smoke + spec sync for P1 simplifications — 스모크·스펙 동기화"
```
