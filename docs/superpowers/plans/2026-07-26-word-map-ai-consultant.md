# Word Map AI Consultant (Doc-to-Flowchart Conversion Mode) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** word 맵에서 컨설턴트 진입 시 문서→순서도 변환 모드(3스테이지)로 분기하고, 드래프터가 섹션 노드(문서 앵커)를 계약·검증하에 그리게 한다.

**Architecture:** 기존 인터뷰 엔진/오케스트레이터를 mode 파라미터로 확장(기본값 유지 = 일반 맵 무변경). word 모드는 `WORD_STAGES`(scope/draft/review)·카탈로그 프롬프트 주입·서버측 앵커 검증(`_sanitize_word_graph`: 무효 강등+라벨 재구성+노티스)을 추가한다. FE는 이미 `buildGraphFromAiProposal`에 `section_anchor` 픽이 있어, 나머지 반쪽(`aiNodeToGraphNode`)과 스테이지 칩 모드 대응만 스레딩한다.

**Tech Stack:** FastAPI + SQLAlchemy(async) + pytest(AI 모킹 `_scripted_ai`) / Next.js + vitest + playwright-core.

**Spec:** `docs/design/2026-07-26-word-map-ai-consultant-design.md` (§N로 참조)

## Global Constraints

- **작업 위치**: `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 매 태스크 시작 시 `pwd && git branch --show-current` 확인.
- **일반 맵 인터뷰 동작 불변** — 모든 신규 파라미터는 기본값(`mode="normal"`, `doc_sections=None`, `section_catalog=""`)으로 기존 경로 무변경. 기존 인터뷰 테스트는 수정 없이 그린이어야 함(시그니처 기본값 설계).
- 백엔드 테스트: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`.
- 프론트 게이트: `cd frontend && npx vitest run && npx tsc --noEmit && npm run lint`.
- 신규 DB 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS` 등록 필수(§2 — `interview_sessions` 테이블은 개발서버에 기존재).
- 커밋: `type(scope): English — 한국어` + **같은 커밋에 `PROGRESS.md` 한 줄**(`## 2026-07-26 — Word 맵 AI 컨설턴트 변환 모드 설계 (dev)` 섹션에 구현 라인 추가). 커밋 끝: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 프롬프트/노티스 텍스트는 ko/en 딕셔너리 관례(`_GREETING`·`_TONE_NOTICE` 참조), UI 텍스트 영어.

---

### Task 1: Engine — word 스테이지셋 + mode 파라미터

**Files:**
- Modify: `backend/app/interview/engine.py`
- Test: `backend/tests/test_interview_engine.py`

**Interfaces:**
- Produces: `WORD_STAGES: tuple[StageDef, ...]` (keys `scope`/`draft`/`review`), 모든 헬퍼에 `mode: str = "normal"` 파라미터 — `get_stage(key, mode="normal")`, `stage_index(key, mode="normal")`, `next_stage_key(key, mode="normal")`, `is_stage_complete(key, facts, mode="normal")`, `first_incomplete_stage(facts, mode="normal")`. 기본값이라 기존 호출부 무변경.

- [ ] **Step 1: Write the failing test** — `backend/tests/test_interview_engine.py` 끝에 추가:

```python
def test_word_stage_set_transitions() -> None:
    """word 모드 3스테이지 — scope→draft→review, review가 마지막 (design 2026-07-26 §3)."""
    from app.interview.engine import WORD_STAGES, get_stage, next_stage_key, stage_index

    assert [s.key for s in WORD_STAGES] == ["scope", "draft", "review"]
    assert next_stage_key("scope", "word") == "draft"
    assert next_stage_key("draft", "word") == "review"
    assert next_stage_key("review", "word") is None
    assert stage_index("draft", "word") == 1
    assert get_stage("draft", "word").title == "Draft"


def test_word_stage_completion_and_first_incomplete() -> None:
    from app.interview.engine import first_incomplete_stage, is_stage_complete

    facts = {"scope": {"draw_scope": "전체"}}
    assert is_stage_complete("scope", facts, "word") is True
    assert is_stage_complete("draft", facts, "word") is False
    assert first_incomplete_stage(facts, "word") == "draft"
    assert first_incomplete_stage({}, "word") == "scope"


def test_normal_mode_unchanged() -> None:
    """mode 기본값 — 기존 7스테이지 동작 그대로."""
    from app.interview.engine import STAGES, next_stage_key

    assert len(STAGES) == 7
    assert next_stage_key("scope") == "io"
```

- [ ] **Step 2: Run to verify FAIL** — `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_interview_engine.py -q` Expected: ImportError (WORD_STAGES 없음)

- [ ] **Step 3: Implement** — `engine.py`의 `STAGES` 정의 아래에 추가:

```python
# word 맵 전용 — 문서→순서도 변환 모드 3스테이지 (design 2026-07-26 §3). 시작/끝 키는
# 일반 세트와 동일("scope"/"review")라 InterviewSession.current_stage 기본값·체크포인트가 공용.
WORD_STAGES: tuple[StageDef, ...] = (
    StageDef(
        "scope", "Scope",
        "문서에서 그릴 범위(전체/특정 섹션 서브트리)와 언어 트리를 확정하고 원본 .docx 업로드를 권한다",
        "Confirm what to draw (whole document or a section subtree), the language tree, and suggest uploading the original .docx",
        ("draw_scope",),
    ),
    StageDef(
        "draft", "Draft",
        "섹션 카탈로그(와 본문 발췌)를 근거로 순서도 초안을 제안하고 사용자 교정을 반영한다",
        "Propose a flowchart draft grounded in the section catalog (and body excerpts), refine with the user",
        ("draft_confirmed",),
    ),
    StageDef(
        "review", "Review",
        "라벨 톤과 문서 링크 커버리지(노드 N개 중 M개 링크)를 요약하고 승인 여부를 확인한다",
        "Summarize label tone and document-link coverage (M of N nodes linked), confirm approval",
        ("approved",),
    ),
)

_WORD_BY_KEY = {stage.key: stage for stage in WORD_STAGES}


def _stage_set(mode: str) -> tuple[tuple[StageDef, ...], dict[str, StageDef]]:
    return (WORD_STAGES, _WORD_BY_KEY) if mode == "word" else (STAGES, _BY_KEY)
```

기존 헬퍼 5개를 mode 인자로 확장(기존 본문을 `_stage_set` 기반으로 교체):

```python
def get_stage(key: str, mode: str = "normal") -> StageDef:
    stages, by_key = _stage_set(mode)
    stage = by_key.get(key)
    if stage is None:
        raise ValueError(f"unknown stage: {key}")
    return stage


def stage_index(key: str, mode: str = "normal") -> int:
    stages, _ = _stage_set(mode)
    return [s.key for s in stages].index(get_stage(key, mode).key)


def next_stage_key(key: str, mode: str = "normal") -> str | None:
    stages, _ = _stage_set(mode)
    idx = stage_index(key, mode)
    return stages[idx + 1].key if idx + 1 < len(stages) else None


def is_stage_complete(key: str, facts: dict, mode: str = "normal") -> bool:
    stage = get_stage(key, mode)
    stage_facts = facts.get(key) or {}
    return all(stage_facts.get(name) for name in stage.required_facts)


def first_incomplete_stage(facts: dict, mode: str = "normal") -> str:
    """문서/기존 맵이 미리 채운 스테이지는 건너뛴 시작점 — 전부 완료면 review."""
    stages, _ = _stage_set(mode)
    for stage in stages:
        if not is_stage_complete(stage.key, facts, mode):
            return stage.key
    return "review"
```

- [ ] **Step 4: Run tests** — 해당 파일 PASS + 전체 `pytest tests/ -q` 그린(기본값 덕에 기존 무변경) + ruff.

- [ ] **Step 5: Commit** (PROGRESS 한 줄 포함)

```bash
git add backend/app/interview/engine.py backend/tests/test_interview_engine.py PROGRESS.md
git commit -m "feat(interview): word-mode stage set (scope/draft/review) with mode-aware engine — word 전용 3스테이지 엔진"
```

---

### Task 2: 세션 mode — 컬럼·생성 분기·StateOut·skip 가드

**Files:**
- Modify: `backend/app/models.py` (InterviewSession, `lang` 컬럼 아래)
- Modify: `backend/app/db.py` (`_ADDED_COLUMNS` 끝)
- Modify: `backend/app/schemas.py` (`InterviewStateOut`)
- Modify: `backend/app/routers/interviews.py` (create ~line 148, `_state_out` ~line 84, skip 가드 ~line 215, `_GREETING` 인접)
- Test: `backend/tests/test_interview_api.py`

**Interfaces:**
- Consumes: Task 1 `next_stage_key(key, mode)`
- Produces: `InterviewSession.mode: str`(normal|word), `InterviewStateOut.mode: str = "normal"` — Task 4(오케스트레이터)·Task 5(FE)가 사용.

- [ ] **Step 1: Write the failing test** — `test_interview_api.py`의 `_iv_map` 패턴을 따라 추가(파일의 기존 map 생성 헬퍼·클라이언트 픽스처 재사용):

```python
def test_create_on_word_map_sets_word_mode(client: TestClient) -> None:
    """word 맵에서 세션 생성 시 mode='word' + word 인사말 (design 2026-07-26 §2)."""
    m = client.post(
        "/api/maps",
        json={
            "name": f"iv-word-{uuid4().hex[:8]}",
            "owning_department": "Owning Anchor Division",
            "mode": "word",
            "doc_name": "sop.docx",
            "doc_sections": [{"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1}],
        },
    ).json()
    version_id = m["versions"][0]["id"]
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": version_id}
    ).json()
    assert state["mode"] == "word"
    assert state["current_stage"] == "scope"
    assert "순서도" in state["messages"][0]["content"]


def test_create_on_normal_map_keeps_normal_mode(client: TestClient) -> None:
    m = client.post(
        "/api/maps",
        json={"name": f"iv-n-{uuid4().hex[:8]}", "owning_department": "Owning Anchor Division"},
    ).json()
    state = client.post(
        f"/api/maps/{m['id']}/interviews", json={"version_id": m["versions"][0]["id"]}
    ).json()
    assert state["mode"] == "normal"
```

(`uuid4`·기존 인터뷰 생성 엔드포인트 경로는 파일 내 기존 테스트와 동일하게 — 경로가 다르면 기존 테스트의 것을 따른다.)

- [ ] **Step 2: Run to verify FAIL** — `pytest tests/test_interview_api.py -q` Expected: KeyError 'mode'

- [ ] **Step 3: Implement**

`models.py` InterviewSession, `lang` 줄 아래:

```python
    # 인터뷰 모드 — normal(7스테이지) | word(문서→순서도 변환 3스테이지) (design 2026-07-26 §2)
    mode: Mapped[str] = mapped_column(String(20), default="normal")
```

`db.py` `_ADDED_COLUMNS` 끝:

```python
    # 인터뷰 word 변환 모드 — interview_sessions는 개발서버에 기존재라 자동 ALTER 필요 (design 2026-07-26 §2)
    ("interview_sessions", "mode", "VARCHAR(20) DEFAULT 'normal'"),
```

`schemas.py` `InterviewStateOut`에 `lang: str` 아래:

```python
    mode: str = "normal"
```

`interviews.py`:
1. `_GREETING` 정의 인접에 추가:

```python
_GREETING_WORD = {
    "ko": "안녕하세요! 이 Word 맵의 SOP 문서를 순서도로 옮겨 드릴게요. 문서 전체를 그릴까요, 특정 섹션 범위만 그릴까요? 원본 .docx를 첨부해 주시면 본문까지 반영해 더 정확하게 제안할 수 있습니다.",
    "en": "Hi! I'll turn this Word map's SOP document into a flowchart. Should I draw the whole document or one section subtree? Attach the original .docx and I can ground the draft in the body text.",
}
```

2. `create_or_resume_interview`: `version` 조회 뒤에 맵 로드·모드 결정(Import에 `ProcessMap` 추가 — 이미 있으면 생략):

```python
    found_map = await session.get(ProcessMap, map_id)
    interview_mode = "word" if found_map is not None and found_map.mode == "word" else "normal"
```

`InterviewSession(...)` 생성자에 `mode=interview_mode,` 추가. 인사말 선택 교체:

```python
    greeting_src = _GREETING_WORD if interview_mode == "word" else _GREETING
    ...content=greeting_src.get(payload.lang, greeting_src["ko"]), stage="scope",
```

3. `_state_out`의 `InterviewStateOut(...)` 인자에 `mode=interview.mode,` 추가.
4. skip 가드(~line 215): `next_stage_key(interview.current_stage, interview.mode)`.

- [ ] **Step 4: Run tests** — 신규 2개 PASS + 전체 pytest + ruff 그린.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/interviews.py backend/tests/test_interview_api.py PROGRESS.md
git commit -m "feat(interview): session mode column + word-map branch on create + mode in state — 세션 mode·생성 분기·상태 노출"
```

---

### Task 3: Agents — word 계약·카탈로그 주입 + `AiNodeAttributes.section_anchor`

**Files:**
- Modify: `backend/app/schemas.py` (`AiNodeAttributes`, `url_label` 필드 아래 ~line 1275)
- Modify: `backend/app/interview/agents.py`
- Test: `backend/tests/test_interview_agents.py`

**Interfaces:**
- Consumes: Task 1 `get_stage(key, mode)`
- Produces:
  - `AiNodeAttributes.section_anchor: str | None`(max 200) — 드래프터 JSON의 `attributes.section_anchor`가 파싱을 통과하게 함.
  - `format_section_catalog(doc_sections: list[dict], language: str | None) -> str`
  - `build_interviewer_messages(..., mode: str = "normal", section_catalog: str = "")`, `build_drafter_messages(..., mode: str = "normal", section_catalog: str = "")` — Task 4가 호출.

- [ ] **Step 1: Write the failing test** — `test_interview_agents.py` 끝에 추가:

```python
def test_format_section_catalog_filters_language() -> None:
    from app.interview.agents import format_section_catalog

    sections = [
        {"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1, "language": "ko"},
        {"anchor": "_Toc9", "title": "Inventory", "number": "1", "level": 1, "language": "en"},
    ]
    ko = format_section_catalog(sections, "ko")
    assert "_Toc1" in ko and "_Toc9" not in ko
    # 언어 미확정이면 전체 노출
    both = format_section_catalog(sections, None)
    assert "_Toc1" in both and "_Toc9" in both


def test_word_mode_prompts_carry_catalog_and_contract() -> None:
    from app.interview.agents import build_drafter_messages, build_interviewer_messages

    catalog = "- _Toc1 | 1 재고 (level 1)"
    iv = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "안녕", mode="word", section_catalog=catalog,
    )
    assert "_Toc1" in iv[0]["content"]
    assert "변환" in iv[0]["content"]  # word 인터뷰어 애든덤

    dr = build_drafter_messages("draft", "ko", {}, None, "", "힌트", mode="word", section_catalog=catalog)
    assert "_Toc1" in dr[0]["content"]
    assert "section_anchor" in dr[0]["content"]  # word 드래프터 계약


def test_normal_mode_prompts_unchanged() -> None:
    from app.interview.agents import build_drafter_messages

    dr = build_drafter_messages("activities", "ko", {}, None, "", "힌트")
    assert "section_anchor" not in dr[0]["content"]


def test_ai_node_attributes_accepts_section_anchor() -> None:
    from app.schemas import AiNodeAttributes

    attr = AiNodeAttributes(section_anchor="_Toc1")
    assert attr.section_anchor == "_Toc1"
```

- [ ] **Step 2: Run to verify FAIL** — `pytest tests/test_interview_agents.py -q` Expected: ImportError/TypeError

- [ ] **Step 3: Implement**

`schemas.py` `AiNodeAttributes` — `url_label` 필드 아래:

```python
    # 문서 섹션 앵커 — word 맵 드래프터/제안 passthrough. 실존 검증은 orchestrator
    # _sanitize_word_graph에서 (design 2026-07-26 §4)
    section_anchor: str | None = Field(default=None, max_length=200)
```

`agents.py`:

1. 카탈로그 포매터(모듈 레벨, `_facts_block` 인접):

```python
# 카탈로그 프롬프트 상한 — 초대형 SOP도 프롬프트를 깨지 않게 (300줄 ≈ 대형 문서 전체 수준)
_CATALOG_MAX_LINES = 300


def format_section_catalog(doc_sections: list[dict], language: str | None) -> str:
    """word 맵 섹션 카탈로그 → 프롬프트 블록. language 확정 시 그 트리만(양쪽 있을 때)."""
    rows = doc_sections
    if language:
        filtered = [s for s in rows if (s.get("language") or "") == language]
        if filtered:
            rows = filtered
    lines = [
        f"- {s['anchor']} | {s.get('number', '')} {s.get('title', '')} (level {s.get('level', 1)})".strip()
        for s in rows[:_CATALOG_MAX_LINES]
    ]
    return "\n".join(lines)
```

2. word 애든덤 상수(`_DRAFTER_CONTRACT` 아래):

```python
_INTERVIEWER_WORD_ADDENDUM = """
[Word 맵 변환 모드]
당신은 이 SOP 문서를 순서도로 변환하는 컨설턴트입니다. 문서가 사실의 원천입니다 — 백지 질문 대신
[문서 섹션 카탈로그]에서 추론한 구체 제안으로 확인만 받으세요.
- scope: 그릴 범위(전체/특정 섹션 서브트리)를 확정해 facts_patch {"draw_scope": <범위>}로 저장.
  카탈로그에 두 언어(ko/en)가 섞여 있으면 어느 트리로 그릴지 확인해 {"language": "ko"|"en"}도 저장
  (한 언어뿐이면 묻지 말고 그 언어로 저장). 원본 .docx 첨부를 한 번 권유하되 강요하지 마세요.
  범위가 매우 크면 1페이지에 들어가도록 상위 섹션 수준 요약이나 서브트리 분할을 제안하세요.
- draft: 초안을 제안하고 교정을 반영하세요. 사용자가 초안에 동의하면 {"draft_confirmed": "yes"}.
- review: 문서 링크 커버리지("노드 N개 중 M개가 문서 섹션 링크 보유")를 요약하고 승인을 확인,
  승인 시 {"approved": "yes"}.
- [문서 섹션 카탈로그]가 비어 있으면 맵의 문서 재임포트(에디터 섹션 패널)를 한 번 안내하고,
  일반 노드만으로 진행 가능함을 알리세요."""

_DRAFTER_WORD_ADDENDUM = """
[Word 맵 변환 모드 — 추가 규칙]
5. 문서 섹션에 대응하는 활동은 node_type="section"으로 만들고 attributes.section_anchor에
   [문서 섹션 카탈로그]의 앵커 값을 그대로 넣으세요. 카탈로그에 없는 앵커는 금지.
6. 문서에 없는 중간 단계·분기는 일반 process/decision으로 두세요(section 아님).
7. 섹션 노드 제목은 시스템이 카탈로그 기준 "번호 제목"으로 재구성합니다 — 제목은 대략만.
8. 1페이지에 들어가도록 노드 수 약 12개 이내 — 범위가 크면 상위 섹션 수준으로 요약."""
```

3. `build_interviewer_messages` 시그니처에 `mode: str = "normal", section_catalog: str = ""` 추가, 본문 수정:

```python
    stage = get_stage(stage_key, mode)
    goal = stage.goal_ko if lang == "ko" else stage.goal_en
    contract = _INTERVIEWER_CONTRACT + (_INTERVIEWER_WORD_ADDENDUM if mode == "word" else "")
    catalog_block = f"\n[문서 섹션 카탈로그]\n{section_catalog}\n" if section_catalog else ""
    system = (
        f"{contract}\n{_LANG_LINE.get(lang, _LANG_LINE['ko'])}\n\n"
        f"[참고 문서]\n{context_text or '(없음)'}\n{catalog_block}\n"
        f"[현재 스테이지] {stage.key} — {goal}\n"
        ...  # 이하 기존 그대로
```

4. `build_drafter_messages`도 동일 패턴: `mode`/`section_catalog` 파라미터, `contract = _DRAFTER_CONTRACT + (_DRAFTER_WORD_ADDENDUM if mode == "word" else "")`, `[참고 문서]` 블록 뒤에 동일한 `catalog_block` 삽입.

- [ ] **Step 4: Run tests** — 신규 4개 PASS + 전체 pytest(기존 agents 테스트 무변경 통과) + ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas.py backend/app/interview/agents.py backend/tests/test_interview_agents.py PROGRESS.md
git commit -m "feat(interview): word-mode prompts + section catalog injection + AiNodeAttributes.section_anchor — word 계약·카탈로그 주입"
```

---

### Task 4: Orchestrator — 앵커 검증(sanitize)·강등 노티스·doc_sections 스레딩

**Files:**
- Modify: `backend/app/interview/orchestrator.py` (`_graph_from_proposal` 인접, `_redraft` ~line 173, `_generate_choices` ~line 99, `run_turn` ~line 262, `_run_skip_turn` ~line 214)
- Modify: `backend/app/routers/interviews.py` (`post_turn` ~line 204 — run_turn 호출부)
- Test: `backend/tests/test_interview_orchestrator.py`

**Interfaces:**
- Consumes: Task 3 `format_section_catalog`, `build_*(…, mode, section_catalog)`; Task 2 `interview.mode`
- Produces:
  - `_sanitize_word_graph(graph: dict, doc_sections: list[dict]) -> tuple[dict, int]`
  - `_redraft(interview, context_text, model, doc_sections: list[dict] | None = None) -> tuple[bool, int]` (변경: bool → (changed, demoted))
  - `run_turn(db, interview, turn, graph_summary, context_text, model=None, doc_sections: list[dict] | None = None)` — 라우터가 word 맵이면 `map.doc_sections` 전달.

- [ ] **Step 1: Write the failing tests** — `test_interview_orchestrator.py` 끝에 추가 (파일 상단의 `_FakeDb`/`_session`/`_scripted_ai` 재사용):

```python
_WORD_SECTIONS = [
    {"anchor": "_Toc1", "title": "재고", "number": "1", "level": 1, "language": "ko"},
    {"anchor": "_Toc2", "title": "출고", "number": "2", "level": 1, "language": "ko"},
]

WORD_DRAFT = json.dumps({
    "kind": "graph", "message": "문서 기반 초안",
    "nodes": [
        {"key": "s", "title": "시작", "node_type": "start"},
        {"key": "a", "title": "아무거나", "node_type": "section",
         "attributes": {"section_anchor": "_Toc1"}},
        {"key": "b", "title": "유령 섹션", "node_type": "section",
         "attributes": {"section_anchor": "_TocGhost"}},
        {"key": "e", "title": "끝", "node_type": "end"},
    ],
    "edges": [{"source": "s", "target": "a"}, {"source": "a", "target": "b"},
              {"source": "b", "target": "e"}],
    "groups": [],
})


def test_sanitize_word_graph_demotes_and_rebuilds_labels() -> None:
    graph = json.loads(WORD_DRAFT)
    cleaned, demoted = orchestrator._sanitize_word_graph(
        {"nodes": graph["nodes"], "edges": graph["edges"], "groups": []}, _WORD_SECTIONS
    )
    by_key = {n["key"]: n for n in cleaned["nodes"]}
    assert demoted == 1
    assert by_key["a"]["node_type"] == "section"
    assert by_key["a"]["title"] == "1 재고"  # 카탈로그 기준 라벨 재구성 (§4)
    assert by_key["b"]["node_type"] == "process"  # 무효 앵커 강등
    assert (by_key["b"].get("attributes") or {}).get("section_anchor", "") == ""
    assert by_key["s"]["node_type"] == "start"  # 비섹션 무변경


def test_word_turn_sanitizes_redraft_and_appends_demote_notice() -> None:
    db = _FakeDb()
    interview = _session(mode="word", current_stage="draft")
    reply = json.dumps({"message": "초안입니다", "facts_patch": {"seen": "y"}})
    _run(db, interview, InterviewTurnIn(type="answer", content="그려줘"),
         [reply, WORD_DRAFT], doc_sections=_WORD_SECTIONS)
    titles = {n["key"]: n["title"] for n in interview.working_graph["nodes"]}
    assert titles["a"] == "1 재고"
    notices = [m for m in db.added if getattr(m, "kind", "") == "notice"]
    assert any("1" in (m.content or "") for m in notices)  # 강등 1건 노티스


def test_normal_turn_unaffected_by_missing_doc_sections() -> None:
    db = _FakeDb()
    interview = _session()
    _run(db, interview, InterviewTurnIn(type="answer", content="네"),
         [INTERVIEWER_Q, DRAFT])
    assert interview.working_graph is not None
```

`_run` 헬퍼 확장(기존 시그니처 뒤 keyword 추가 — 기존 호출 무변경):

```python
def _run(db, interview, turn, replies, doc_sections=None):
    ...
            await orchestrator_call.run_turn(
                db, interview, turn, "(빈 캔버스)", "", doc_sections=doc_sections
            )
```

- [ ] **Step 2: Run to verify FAIL** — `pytest tests/test_interview_orchestrator.py -q` Expected: AttributeError `_sanitize_word_graph` / TypeError

- [ ] **Step 3: Implement** — `orchestrator.py`:

1. `_graph_from_proposal` 아래에:

```python
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


def _word_catalog_text(interview: InterviewSession, doc_sections: list[dict] | None) -> str:
    if interview.mode != "word" or not doc_sections:
        return ""
    language = (interview.facts.get("scope") or {}).get("language") or None
    return format_section_catalog(doc_sections, language)
```

(`format_section_catalog`를 agents import 라인에 추가. `InterviewSession.mode` 접근은 Task 2 컬럼.)

2. `_redraft` 교체 — 시그니처·반환·sanitize:

```python
async def _redraft(
    interview: InterviewSession, context_text: str, model: str | None,
    doc_sections: list[dict] | None = None,
) -> tuple[bool, int]:
    """드래프터로 작업본 재생성 — 실패는 턴을 죽이지 않는다. (갱신 여부, word 강등 수) 반환."""
    try:
        proposal = await _ask_json(
            build_drafter_messages(
                interview.current_stage, interview.lang, interview.facts,
                interview.working_graph, context_text, _REDRAFT_HINT,
                mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections),
            ),
            model, AiProposal,
        )
        if proposal.kind == "graph" and proposal.nodes:
            graph = _graph_from_proposal(proposal)
            demoted = 0
            if interview.mode == "word" and doc_sections:
                graph, demoted = _sanitize_word_graph(graph, doc_sections)
            interview.working_graph = graph
            return True, demoted
    except TurnError:
        logger.warning("interview redraft skipped (drafter failed) — turn continues")
    return False, 0
```

3. `_generate_choices`: 시그니처에 `doc_sections: list[dict] | None = None` 추가, `build_drafter_messages(...)`에 `mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections)` 전달, 옵션 graph도 sanitize:

```python
        graph = _graph_from_proposal(result)
        if interview.mode == "word" and doc_sections:
            graph, _ = _sanitize_word_graph(graph, doc_sections)
        options.append({... "graph": graph})
```

4. `run_turn`: 시그니처 끝에 `doc_sections: list[dict] | None = None` 추가. 내부 전파:
   - `_run_skip_turn(db, interview, graph_summary, context_text, model, doc_sections)` (skip 함수도 동일 kw 추가 — 내부의 engine 호출들에 `interview.mode` 전달, `_redraft` 호출이 있으면 새 반환형 반영).
   - `build_interviewer_messages(...)`에 `mode=interview.mode, section_catalog=_word_catalog_text(interview, doc_sections)` 추가.
   - `engine.get_stage(interview.current_stage)` → `engine.get_stage(interview.current_stage, interview.mode)` / `engine.next_stage_key(...)`·`engine.is_stage_complete(...)`도 `interview.mode` 전달 (run_turn·_run_skip_turn 내 전 지점 — `git grep -n "engine\." backend/app/interview/orchestrator.py`로 전수).
   - 연속 드래프트 블록 교체:

```python
    graph_changed = chosen is not None
    demoted = 0
    if turn.type != "choice" and (out.facts_patch or out.redraw):
        changed, demoted = await _redraft(interview, context_text, model, doc_sections)
        graph_changed = changed or graph_changed
```

   - 강등 노티스 — run_turn의 두 종료 경로(스테이지 완료/미완료)에서 최종 consultant `_append` **직후**에 공통으로:

```python
    if demoted:
        _append(db, interview, next_seq(interview), "consultant", "notice",
                _DEMOTE_NOTICE.get(interview.lang, _DEMOTE_NOTICE["ko"]).format(n=demoted))
```

(완료 경로는 체크포인트 `db.add` 이전·이후 어디든 메시지 순서만 맞으면 됨 — 톤 노티스 패턴과 동일하게 consultant 메시지 뒤.)

5. `routers/interviews.py` `post_turn`: `current = await _load_graph(...)` 인접에서 맵 로드 후 전달(Import `ProcessMap` — Task 2에서 이미 추가됨):

```python
    doc_sections: list[dict] | None = None
    if interview.mode == "word":
        found_map = await session.get(ProcessMap, interview.map_id)
        doc_sections = list(found_map.doc_sections) if found_map else []
    ...
        await run_turn(
            session, interview, payload, _graph_summary(current), context_text,
            doc_sections=doc_sections,
        )
```

- [ ] **Step 4: Run tests** — 신규 3개 PASS + **기존 orchestrator 테스트 전부 무수정 통과**(`_redraft` 반환형 변경이 기존 테스트를 깨면 해당 테스트의 단언이 아닌 run_turn 내부 수정 누락이다) + 전체 pytest + ruff.

- [ ] **Step 5: Commit**

```bash
git add backend/app/interview/orchestrator.py backend/app/routers/interviews.py backend/tests/test_interview_orchestrator.py PROGRESS.md
git commit -m "feat(interview): word anchor sanitize + demote notice + doc_sections threading — 앵커 검증·강등 노티스·카탈로그 스레딩"
```

---

### Task 5: FE — mode 노출·word 스테이지 칩

**Files:**
- Modify: `frontend/src/lib/api.ts` (InterviewState 타입 — `current_stage` 필드가 있는 인터페이스를 grep으로 확정)
- Modify: `frontend/src/lib/interview.ts` (INTERVIEW_STAGES 아래)
- Modify: `frontend/src/app/maps/[mapId]/consult/page.tsx` (~line 176, 195)
- Modify: `frontend/src/components/interview/interview-panel.tsx` (스테이지 칩 — `git grep -n "INTERVIEW_STAGES\|stageIndex" frontend/src`로 사용처 전수 확인)
- Test: `frontend/src/lib/interview.test.ts`

**Interfaces:**
- Consumes: Task 2 `InterviewStateOut.mode`
- Produces: `WORD_INTERVIEW_STAGES`, `stagesForMode(mode: string | undefined)`, `stageIndex(key: string, mode?: string)` — 칩/닷 렌더가 mode 기반으로 3단계 표시.

- [ ] **Step 1: Write the failing test** — `interview.test.ts`에 추가:

```ts
import { INTERVIEW_STAGES, WORD_INTERVIEW_STAGES, stageIndex, stagesForMode } from "@/lib/interview";

describe("stagesForMode", () => {
  it("returns the word 3-stage set for word mode, 7-stage otherwise", () => {
    expect(stagesForMode("word").map((s) => s.key)).toEqual(["scope", "draft", "review"]);
    expect(stagesForMode(undefined)).toBe(INTERVIEW_STAGES);
    expect(WORD_INTERVIEW_STAGES).toHaveLength(3);
  });

  it("stageIndex is mode-aware", () => {
    expect(stageIndex("review", "word")).toBe(2);
    expect(stageIndex("review")).toBe(6);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `cd frontend && npx vitest run src/lib/interview.test.ts`

- [ ] **Step 3: Implement**

`lib/interview.ts` — `INTERVIEW_STAGES` 아래:

```ts
// 백엔드 engine.WORD_STAGES와 키·순서 동기 — word 변환 모드 3단계 (design 2026-07-26 §3)
export const WORD_INTERVIEW_STAGES = [
  { key: "scope", label: "Scope" },
  { key: "draft", label: "Draft" },
  { key: "review", label: "Review" },
] as const;

export function stagesForMode(
  mode: string | undefined,
): readonly { readonly key: string; readonly label: string }[] {
  return mode === "word" ? WORD_INTERVIEW_STAGES : INTERVIEW_STAGES;
}

export function stageIndex(key: string, mode?: string): number {
  return stagesForMode(mode).findIndex((s) => s.key === key);
}
```

`api.ts` — 인터뷰 상태 인터페이스(`current_stage: string`이 있는 타입)에:

```ts
  // 인터뷰 모드 — normal | word (design 2026-07-26 §2)
  mode?: string;
```

`consult/page.tsx` — `stageIndex(interview.current_stage)` → `stageIndex(interview.current_stage, interview.mode)`; 닷 렌더 `INTERVIEW_STAGES.map(...)` → `stagesForMode(interview?.mode).map(...)` (import 교체).

`interview-panel.tsx` — `git grep -n "INTERVIEW_STAGES\|stageIndex\|Stage " frontend/src/components/interview/`로 스테이지 칩("Stage n of N")·라벨 사용처를 찾아 같은 방식으로 mode 스레딩(패널이 interview state 또는 stage만 받으면 `mode` prop 추가 — 호출측 consult page에서 `mode={interview?.mode}` 전달).

- [ ] **Step 4: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/interview.ts "frontend/src/app/maps/[mapId]/consult/page.tsx" frontend/src/components/interview/interview-panel.tsx frontend/src/lib/interview.test.ts PROGRESS.md
git commit -m "feat(interview): word-mode 3-stage chips on consult UI — word 모드 스테이지 칩"
```

---

### Task 6: FE — `aiNodeToGraphNode` section_anchor 스레딩 (+회귀 테스트)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`aiNodeToGraphNode` ~line 606-639)
- Test: `frontend/src/lib/csv-import.test.ts`

**Interfaces:**
- Consumes: FE `AiNodeAttributes.section_anchor`(api.ts에 기존재), `buildGraphFromAiProposal`의 기존 `section_anchor` 픽(csv-import.ts ~line 771 — 무변경 확인 대상)

배경: `buildGraphFromAiProposal`(제안 전체 적용 경로 — 인터뷰 적용 포함)은 이미 `section_anchor: attr?.section_anchor ?? ""`를 픽하지만, **AiOp add 경로의 `aiNodeToGraphNode`는 누락** — 노드 속성 체크리스트의 "AI 변환 2곳" 중 한 곳이 비어 있다(라이프사이클 C4 교훈과 동일 함정).

- [ ] **Step 1: Write the failing test** — `csv-import.test.ts`에 추가 (기존 buildGraphFromAiProposal 테스트의 proposal 픽스처 관례를 따름):

```ts
it("threads attributes.section_anchor into generated nodes (word map drafter)", () => {
  const outcome = buildGraphFromAiProposal({
    kind: "graph",
    message: "",
    nodes: [
      { key: "s", title: "Start", node_type: "start", description: "" },
      {
        key: "a", title: "1 재고", node_type: "section", description: "",
        attributes: { section_anchor: "_Toc1" },
      },
      { key: "e", title: "End", node_type: "end", description: "" },
    ],
    edges: [
      { source: "s", target: "a", label: "" },
      { source: "a", target: "e", label: "" },
    ],
    groups: [],
    ops: [],
  });
  const section = outcome.graph?.nodes.find((n) => n.title === "1 재고");
  expect(section?.node_type).toBe("section");
  expect(section?.section_anchor).toBe("_Toc1");
});
```

(픽스처 필드가 기존 테스트와 다르면 — `ops` 유무 등 — 그 파일의 기존 AI proposal 테스트 형태에 맞춘다. 이 테스트는 기존 코드로도 **통과할 수 있다** — 그 경우 이 테스트는 회귀 가드로 두고 Step 3의 aiNodeToGraphNode 수정이 본 작업이다.)

- [ ] **Step 2: Run** — `npx vitest run src/lib/csv-import.test.ts` (통과 여부 기록 — 위 노트 참조)

- [ ] **Step 3: Implement** — `page.tsx` `aiNodeToGraphNode`의 반환 리터럴에서 `url_label: attr?.url_label ?? "",` 줄 아래에:

```ts
    // 문서 섹션 앵커 — word 맵 제안 스레딩(AI 변환 2곳 대칭 — csv-import buildGraphFromAiProposal과 동일)
    section_anchor: attr?.section_anchor ?? "",
```

- [ ] **Step 4: Gates** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/csv-import.test.ts PROGRESS.md
git commit -m "fix(interview): thread section_anchor through aiNodeToGraphNode (ops add path) — AI 변환 2곳 대칭 완성"
```

---

### Task 7: pw 스모크 word 변형 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-consult-word.mjs` (기존 `frontend/scripts/pw-smoke-consult.mjs`를 복제해 수정 — 전 API 모킹 방식 유지)

**Interfaces:**
- Consumes: Task 5의 `stagesForMode` 렌더(닷 3개), Task 2의 `mode:"word"` state

- [ ] **Step 1: 스모크 작성** — `pw-smoke-consult.mjs`를 복제한 뒤 다음만 수정:
  1. 모킹된 인터뷰 state 픽스처에 `mode: "word"`, `current_stage: "draft"` 설정.
  2. 모킹된 맵 detail 픽스처(있다면)에 `mode: "word"`, `doc_sections: [{ anchor: "_Toc1", title: "재고", number: "1", level: 1, language: "ko" }]`.
  3. `working_graph` 픽스처에 섹션 노드 1개 포함:
     `{ key: "a", title: "1 재고", node_type: "section", attributes: { section_anchor: "_Toc1" } }`.
  4. 단언 추가/교체:
     - 스테이지 닷/칩이 **3단계**: 기존 스모크가 닷을 세는 셀렉터를 그대로 쓰되 기대값 3 (칩 텍스트가 있으면 `Stage 2 of 3` 형태 확인).
     - 프리뷰 캔버스에 `1 재고` 텍스트 노출(섹션 노드 렌더).
  5. 파일 상단 주석에 실행 조건(`node scripts/pw-smoke-consult-word.mjs`, 서버 3000/8000 — 단 전 API 모킹이면 기존 스모크의 전제와 동일하게).

Run: `cd frontend && node scripts/pw-smoke-consult-word.mjs` Expected: pass 로그 + exit 0. (기존 `pw-smoke-consult.mjs`도 실행해 회귀 없음 확인.)

- [ ] **Step 2: 전체 게이트**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```

Expected: 전부 그린(0 fail).

- [ ] **Step 3: Commit**

```bash
git add frontend/scripts/pw-smoke-consult-word.mjs PROGRESS.md
git commit -m "test(interview): word-mode consult smoke (3-stage chips, section node preview) — word 모드 스모크"
```
