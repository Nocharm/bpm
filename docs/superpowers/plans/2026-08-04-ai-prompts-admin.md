# AI 프롬프트 관리 (sysadmin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sysadmin이 `/settings`에서 AI 시스템 프롬프트 7종을 열람·수정·기본값 복원한다 (설계: `docs/design/2026-08-04-ai-prompts-admin-design.md`).

**Architecture:** 신규 `ai_prompts` 테이블에 **오버라이드만 행으로 저장**(행 없음 = 코드 기본값). `app/prompt_registry.py`가 key→기본값 매핑과 오버라이드 조회의 단일 소스. 각 프롬프트 빌더에 `overrides` 파라미터를 추가하되 `None`이면 기존 상수 폴백(기존 호출부·테스트 무영향). 프론트는 설정 Content 카테고리에 sysadmin 전용 탭 1개 — 매뉴얼 관리 패널의 textarea+Preview 토글 패턴과 `MarkdownView` 재사용.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + React (기존 스택, 신규 의존성 없음)

## Global Constraints

- 작업 브랜치: `feat/ai-prompts-admin` (이미 생성됨, main 기준). 매 태스크 마지막에 커밋.
- **매 커밋에 `PROGRESS.md`의 `## 2026-08-04` 섹션 한 줄 갱신을 같은 커밋에 포함** (`rules/common/git.md`).
- 커밋 메시지: `type(scope): English summary — 한국어 요약` + 트레일러 2줄(`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01MwWNuKbQkZzQ4JHXLPPEfy`).
- 백엔드 테스트 실행(backend/ 에서): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` — `backend/.env`가 있으면 이 env 3종 없이 6건이 깨진다. 린트: `.venv/bin/ruff check app/ tests/`.
- 프론트 게이트(frontend/ 에서): `npm run lint` · `npm test`(vitest) · `npm run build`.
- Python: 타입힌트 필수, 함수명 동사 시작, `X | None`, import 3그룹.
- TS/React: 함수형·`const`·named export·`interface` props·`any` 금지. **트리비얼 핸들러는 plain function**(useCallback 금지 — React Compiler `preserve-manual-memoization` 빌드 실패), **effect 내 동기 setState 금지**.
- UI: raw hex 금지(토큰만), Lucide 16px(툴바 버튼 14px 기존 관례)/strokeWidth 1.5, 이모지 금지, UI 영어 기본(en/ko i18n 병기), 다크모드 스타일 금지, 버튼 hover 배경만(커서·눌림은 전역 base), 주요 구조 요소에 `data-id`.
- 시각 표시는 KST: `formatKstShort` (`@/lib/datetime`) — raw `toLocaleString()` 금지.
- id 생성은 `genId()`(`@/lib/id`) — `crypto.randomUUID()` 금지 (이 기능에선 신규 id 생성 없음).
- 신규 테이블이므로 `db.py` `_ADDED_COLUMNS` 등록 불필요(그건 기존 테이블의 신규 컬럼용). startup `create_all`이 생성.

---

### Task 1: AiPrompt 모델 + prompt_registry

**Files:**
- Modify: `backend/app/models.py` (AppSetting 클래스 뒤, ~41행)
- Create: `backend/app/prompt_registry.py`
- Create: `backend/tests/test_ai_prompts.py`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: `app.models.Base`, `app.clock` 경유 `_now`(models 내 기존), 7개 프롬프트 상수(`ai_prompt._INSTRUCTIONS`, `agents._INTERVIEWER_CONTRACT`, `agents._DRAFTER_CONTRACT`, `agents._INTERVIEWER_WORD_ADDENDUM`, `agents._DRAFTER_WORD_ADDENDUM`, `orchestrator._EXTRACT_CONTRACT`, `orchestrator._ANTI_REPEAT_NUDGE`)
- Produces: `models.AiPrompt`(key/content/updated_by/updated_at), `prompt_registry.PROMPT_KEYS: tuple[str, ...]`, `prompt_registry.get_prompt_defaults() -> dict[str, str]`, `prompt_registry.get_prompt_overrides(session: AsyncSession) -> dict[str, str]` — Task 2·3이 이 이름·시그니처 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_prompts.py` 신규:

```python
"""AI 프롬프트 관리 — 레지스트리·오버라이드 API·빌더 반영 테스트."""

from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults


def test_prompt_defaults_cover_all_keys() -> None:
    defaults = get_prompt_defaults()
    assert set(defaults) == set(PROMPT_KEYS)
    assert len(PROMPT_KEYS) == 7
    # 전 항목이 비어있지 않은 실제 프롬프트 문자열
    assert all(isinstance(value, str) and value.strip() for value in defaults.values())
```

- [ ] **Step 2: 실패 확인**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_ai_prompts.py -q`
Expected: FAIL — `ModuleNotFoundError: app.prompt_registry`

- [ ] **Step 3: 모델 추가**

`backend/app/models.py` — `AppSetting` 클래스 정의 바로 뒤에 추가:

```python
class AiPrompt(Base):
    """AI 시스템 프롬프트 오버라이드 — 행이 있으면 코드 기본값 대신 사용. 복원=행 삭제."""

    __tablename__ = "ai_prompts"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    content: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str | None] = mapped_column(String(100), default=None)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
```

(`Text`, `String`, `DateTime`, `datetime`, `_now` 모두 models.py에 이미 있음 — import 추가 불필요.)

- [ ] **Step 4: 레지스트리 작성**

`backend/app/prompt_registry.py` 신규:

```python
"""AI 프롬프트 레지스트리 — 코드 기본값 단일 소스 + sysadmin DB 오버라이드 조회 (설계: docs/design/2026-08-04-ai-prompts-admin-design.md)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AiPrompt

# 편집 가능한 프롬프트 key — API·UI 노출 순서 그대로
PROMPT_KEYS: tuple[str, ...] = (
    "ai_chat_instructions",
    "interviewer_contract",
    "drafter_contract",
    "interviewer_word_addendum",
    "drafter_word_addendum",
    "extract_contract",
    "anti_repeat_nudge",
)


def get_prompt_defaults() -> dict[str, str]:
    """key → 코드 기본 프롬프트. 지연 import — orchestrator가 이 모듈을 import해도 순환 없음."""
    from app import ai_prompt
    from app.interview import agents, orchestrator

    return {
        "ai_chat_instructions": ai_prompt._INSTRUCTIONS,
        "interviewer_contract": agents._INTERVIEWER_CONTRACT,
        "drafter_contract": agents._DRAFTER_CONTRACT,
        "interviewer_word_addendum": agents._INTERVIEWER_WORD_ADDENDUM,
        "drafter_word_addendum": agents._DRAFTER_WORD_ADDENDUM,
        "extract_contract": orchestrator._EXTRACT_CONTRACT,
        "anti_repeat_nudge": orchestrator._ANTI_REPEAT_NUDGE,
    }


async def get_prompt_overrides(session: AsyncSession) -> dict[str, str]:
    """DB 오버라이드 전체(≤7행) — 요청/턴당 1회 조회해 빌더에 전달."""
    rows = (await session.scalars(select(AiPrompt))).all()
    return {row.key: row.content for row in rows if row.key in PROMPT_KEYS}
```

주의: `_INSTRUCTIONS` 등 사설 상수 접근을 `ruff check`가 SLF001로 잡으면(설정에 따라 다름) 해당 라인에 `# noqa: SLF001 -- 레지스트리가 기본값의 단일 집결지` 추가. 상수를 public으로 개명하지 말 것(수정 범위 최소화).

- [ ] **Step 5: 통과 확인 + 기존 회귀 없음**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_ai_prompts.py -q` → PASS
Run: `.venv/bin/ruff check app/ tests/` → clean

- [ ] **Step 6: 커밋**

`PROGRESS.md`의 `## 2026-08-04` 섹션에 한 줄 추가: `- 구현: AiPrompt 오버라이드 모델 + prompt_registry(기본값 매핑·오버라이드 조회).`

```bash
git add backend/app/models.py backend/app/prompt_registry.py backend/tests/test_ai_prompts.py PROGRESS.md
git commit -m "feat(ai-prompts): add override model + prompt registry — AI 프롬프트 오버라이드 모델·레지스트리"
```

(트레일러 2줄 포함 — Global Constraints 참조. 이하 모든 커밋 동일.)

---

### Task 2: sysadmin 관리 API (GET/PUT/DELETE)

**Files:**
- Modify: `backend/app/schemas.py` (`AppSettingsOut`/`AppSettingsUpdate` 근처 ~1169행 뒤)
- Create: `backend/app/routers/ai_prompts.py`
- Modify: `backend/app/main.py` (라우터 import + `include_router` — `app_settings` 줄 옆)
- Modify: `backend/tests/test_ai_prompts.py` (테스트 추가)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1의 `PROMPT_KEYS`, `get_prompt_defaults`, `models.AiPrompt`; 기존 `app.auth.get_current_user`/`require_sysadmin`, `app.db.get_session`
- Produces: `GET /api/admin/ai-prompts` → `list[AiPromptOut]`(PROMPT_KEYS 순서), `PUT /api/admin/ai-prompts/{key}` body `{"content": str}` → `AiPromptOut`, `DELETE /api/admin/ai-prompts/{key}` → `AiPromptOut`(기본값 복원 결과). `AiPromptOut = {key, content, is_customized, updated_by, updated_at}` — Task 4 프론트가 이 형태 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_prompts.py`에 추가 (파일 상단 import 갱신 포함):

```python
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults
from app.settings import settings

SYSADMIN = "admin.kim"
NON_SYSADMIN = "user.lee"


@pytest.fixture
def sysadmin_enforced(client: TestClient) -> Iterator[None]:
    """auth OFF + dev_enforce_permissions ON + sysadmin=admin.kim. Restore after."""
    prev_auth = settings.auth_enabled
    prev_enforce = settings.dev_enforce_permissions
    prev_sys = settings.bpm_sysadmins
    settings.auth_enabled = False
    settings.dev_enforce_permissions = True
    settings.bpm_sysadmins = SYSADMIN
    yield
    settings.auth_enabled = prev_auth
    settings.dev_enforce_permissions = prev_enforce
    settings.bpm_sysadmins = prev_sys
    app.dependency_overrides.clear()


def test_list_returns_defaults(client: TestClient) -> None:
    resp = client.get("/api/admin/ai-prompts")
    assert resp.status_code == 200
    body = resp.json()
    assert [item["key"] for item in body] == list(PROMPT_KEYS)
    assert all(item["is_customized"] is False for item in body)
    assert all(item["content"].strip() for item in body)
    assert all(item["updated_by"] is None for item in body)


def test_put_then_reset_roundtrip(client: TestClient) -> None:
    key = "anti_repeat_nudge"
    put = client.put(f"/api/admin/ai-prompts/{key}", json={"content": "커스텀 넛지"})
    assert put.status_code == 200
    assert put.json()["is_customized"] is True
    assert put.json()["content"] == "커스텀 넛지"
    assert put.json()["updated_by"]
    assert put.json()["updated_at"]
    listed = {item["key"]: item for item in client.get("/api/admin/ai-prompts").json()}
    assert listed[key]["content"] == "커스텀 넛지"
    reset = client.delete(f"/api/admin/ai-prompts/{key}")
    assert reset.status_code == 200
    assert reset.json()["is_customized"] is False
    assert reset.json()["content"] == get_prompt_defaults()[key]
    # 멱등 — 이미 기본값이어도 200
    assert client.delete(f"/api/admin/ai-prompts/{key}").status_code == 200


def test_put_validation(client: TestClient) -> None:
    assert client.put("/api/admin/ai-prompts/nope", json={"content": "x"}).status_code == 404
    assert client.delete("/api/admin/ai-prompts/nope").status_code == 404
    blank = client.put("/api/admin/ai-prompts/anti_repeat_nudge", json={"content": "   "})
    assert blank.status_code == 422


def test_requires_sysadmin(client: TestClient, sysadmin_enforced: None) -> None:
    headers = {"X-Dev-User": NON_SYSADMIN}
    key = "anti_repeat_nudge"
    assert client.get("/api/admin/ai-prompts", headers=headers).status_code == 403
    assert (
        client.put(f"/api/admin/ai-prompts/{key}", json={"content": "x"}, headers=headers).status_code
        == 403
    )
    assert client.delete(f"/api/admin/ai-prompts/{key}", headers=headers).status_code == 403
    ok = {"X-Dev-User": SYSADMIN}
    assert client.get("/api/admin/ai-prompts", headers=ok).status_code == 200
```

(`client` 픽스처는 `tests/conftest.py` 기존 것. `sysadmin_enforced` 패턴은 `tests/test_app_settings.py`와 동일.)

- [ ] **Step 2: 실패 확인**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_ai_prompts.py -q`
Expected: FAIL — `/api/admin/ai-prompts` 404 (라우터 없음)

- [ ] **Step 3: 스키마 추가**

`backend/app/schemas.py` — `AppSettingsUpdate` 정의 뒤에 추가 (`Field`, `field_validator`, `datetime`은 파일에 이미 import돼 있음 — 없으면 추가):

```python
class AiPromptOut(BaseModel):
    """AI 프롬프트 항목 — content는 유효값(오버라이드 있으면 그것, 없으면 코드 기본값)."""

    key: str
    content: str
    is_customized: bool
    updated_by: str | None = None
    updated_at: datetime | None = None


class AiPromptUpdate(BaseModel):
    content: str = Field(max_length=50_000)  # 프롬프트 상한 — 가장 긴 기본값(~6k)의 여유 배수

    @field_validator("content")
    @classmethod
    def check_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        return value
```

- [ ] **Step 4: 라우터 작성 + 등록**

`backend/app/routers/ai_prompts.py` 신규:

```python
"""AI 프롬프트 관리 API — sysadmin이 시스템 프롬프트를 열람·오버라이드·기본값 복원 (설계: docs/design/2026-08-04-ai-prompts-admin-design.md)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_sysadmin
from app.db import get_session
from app.models import AiPrompt
from app.prompt_registry import PROMPT_KEYS, get_prompt_defaults
from app.schemas import AiPromptOut, AiPromptUpdate

router = APIRouter(
    prefix="/api",
    tags=["ai-prompts"],
    dependencies=[Depends(get_current_user), Depends(require_sysadmin)],
)


def _to_out(key: str, row: AiPrompt | None, default: str) -> AiPromptOut:
    if row is None:
        return AiPromptOut(key=key, content=default, is_customized=False)
    return AiPromptOut(
        key=key, content=row.content, is_customized=True,
        updated_by=row.updated_by, updated_at=row.updated_at,
    )


def _ensure_known_key(key: str) -> None:
    if key not in PROMPT_KEYS:
        raise HTTPException(status_code=404, detail=f"unknown prompt key: {key}")


@router.get("/admin/ai-prompts", response_model=list[AiPromptOut])
async def list_ai_prompts(session: AsyncSession = Depends(get_session)) -> list[AiPromptOut]:
    rows = {row.key: row for row in (await session.scalars(select(AiPrompt))).all()}
    defaults = get_prompt_defaults()
    return [_to_out(key, rows.get(key), defaults[key]) for key in PROMPT_KEYS]


@router.put("/admin/ai-prompts/{key}", response_model=AiPromptOut)
async def put_ai_prompt(
    key: str,
    payload: AiPromptUpdate,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiPromptOut:
    _ensure_known_key(key)
    row = await session.get(AiPrompt, key)
    if row is None:
        row = AiPrompt(key=key, content=payload.content, updated_by=user)
        session.add(row)
    else:
        row.content = payload.content
        row.updated_by = user
    await session.commit()
    await session.refresh(row)
    return _to_out(key, row, "")


@router.delete("/admin/ai-prompts/{key}", response_model=AiPromptOut)
async def reset_ai_prompt(
    key: str, session: AsyncSession = Depends(get_session)
) -> AiPromptOut:
    """오버라이드 행 삭제 = 코드 기본값 복원. 행이 없어도 200(멱등)."""
    _ensure_known_key(key)
    row = await session.get(AiPrompt, key)
    if row is not None:
        await session.delete(row)
        await session.commit()
    return _to_out(key, None, get_prompt_defaults()[key])
```

`backend/app/main.py` — 라우터 import 줄(예: `from app.routers import admin, ai, ai_sessions, app_settings, ...`)에 `ai_prompts` 추가, `app.include_router(app_settings.router)` 아래에 `app.include_router(ai_prompts.router)` 추가.

- [ ] **Step 5: 통과 확인**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_ai_prompts.py -q` → PASS (5 tests)
Run: `.venv/bin/ruff check app/ tests/` → clean

- [ ] **Step 6: 커밋**

`PROGRESS.md` 2026-08-04 섹션에 한 줄 추가: `- 구현: /api/admin/ai-prompts GET/PUT/DELETE(sysadmin 전용, 404/422/멱등 복원).`

```bash
git add backend/app/schemas.py backend/app/routers/ai_prompts.py backend/app/main.py backend/tests/test_ai_prompts.py PROGRESS.md
git commit -m "feat(ai-prompts): sysadmin CRUD API for prompt overrides — 프롬프트 오버라이드 관리 API"
```

---

### Task 3: 빌더에 오버라이드 스레딩

**Files:**
- Modify: `backend/app/ai_prompt.py` (`build_system_prompt` ~239행, `build_messages` ~261행)
- Modify: `backend/app/routers/ai.py` (`build_messages` 호출 ~198행)
- Modify: `backend/app/interview/agents.py` (`build_interviewer_messages` ~188행, `build_drafter_messages` ~242행)
- Modify: `backend/app/interview/orchestrator.py` (`generate_proposals` ~444행, `extract_attachment_facts` ~563행, `_run_skip_turn` ~645행, `run_turn` ~695행, 넛지 사용부 ~769행)
- Modify: `backend/app/routers/interviews.py` (`run_turn` 호출 ~553행, `generate_proposals` 호출 ~647행)
- Modify: `backend/tests/test_ai_prompts.py`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1 `get_prompt_overrides(session)`
- Produces: 모든 빌더가 키워드 인자 `overrides: Mapping[str, str] | None = None` 수용. `None`/키 부재 시 기존 상수 폴백 — **기존 호출부·기존 테스트는 무변경으로 통과해야 한다.**

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_prompts.py`에 추가:

```python
def test_overrides_reach_prompt_builders() -> None:
    from app.ai_prompt import build_system_prompt
    from app.interview.agents import build_drafter_messages, build_interviewer_messages
    from app.schemas import GraphOut

    graph = GraphOut(nodes=[], edges=[])
    custom = build_system_prompt("", graph, True, overrides={"ai_chat_instructions": "CUSTOM-CHAT"})
    assert custom.startswith("CUSTOM-CHAT")
    assert not build_system_prompt("", graph, True).startswith("CUSTOM-CHAT")

    interviewer = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "hi", overrides={"interviewer_contract": "CUSTOM-INT"}
    )
    assert interviewer[0]["content"].startswith("CUSTOM-INT")

    word = build_interviewer_messages(
        "scope", "ko", {}, "", "", [], "hi", mode="word",
        overrides={"interviewer_word_addendum": "\nCUSTOM-ADDENDUM"},
    )
    assert "CUSTOM-ADDENDUM" in word[0]["content"]

    drafter = build_drafter_messages(
        "activities", "ko", {}, None, "", "표준", overrides={"drafter_contract": "CUSTOM-DRAFT"}
    )
    assert drafter[0]["content"].startswith("CUSTOM-DRAFT")
```

- [ ] **Step 2: 실패 확인**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_ai_prompts.py -q`
Expected: FAIL — `TypeError: ... unexpected keyword argument 'overrides'`

- [ ] **Step 3: ai_prompt.py 수정**

파일 상단 import에 `from collections.abc import Mapping` 추가(그룹 1). 두 함수 수정:

```python
def build_system_prompt(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    overrides: Mapping[str, str] | None = None,
) -> str:
    instructions = (overrides or {}).get("ai_chat_instructions") or _INSTRUCTIONS
    edit_note = (
        "사용자는 현재 이 맵을 편집할 수 있습니다(graph/ops 가능)."
        if can_edit
        else "사용자는 편집 권한이 없습니다 — graph/ops는 만들지 말고 answer/analysis/walkthrough(읽기 전용)로만 답하세요."
    )
    hints = _structure_hints(current_graph)
    hint_block = (
        "[구조 힌트]\n" + "\n".join(f"- {hint}" for hint in hints) + "\n\n" if hints else ""
    )
    return (
        f"{instructions}\n{edit_note}\n\n"
        f"{hint_block}"
        f"[현재 그래프]\n{_serialize_graph(current_graph)}\n\n"
        f"[제품 매뉴얼]\n{manual}"
    )
```

`build_messages`는 시그니처 끝에 `overrides: Mapping[str, str] | None = None` 추가, 내부 호출을 `build_system_prompt(manual, current_graph, can_edit, overrides)`로.

`backend/app/routers/ai.py` — import에 `from app.prompt_registry import get_prompt_overrides` 추가, 호출부(~198행) 수정:

```python
    messages = build_messages(
        manual_text, current, can_edit, payload.instruction, payload.history,
        overrides=await get_prompt_overrides(session),
    )
```

- [ ] **Step 4: agents.py 수정**

파일 상단 import에 `from collections.abc import Mapping` 추가. `build_interviewer_messages` 시그니처 끝에 `overrides: Mapping[str, str] | None = None` 추가, contract 조립 줄(~202행)을:

```python
    ov = overrides or {}
    contract = (ov.get("interviewer_contract") or _INTERVIEWER_CONTRACT) + (
        (ov.get("interviewer_word_addendum") or _INTERVIEWER_WORD_ADDENDUM)
        if mode == "word" else ""
    )
```

`build_drafter_messages` 시그니처 끝에 동일 파라미터 추가, contract 줄(~254행)을:

```python
    ov = overrides or {}
    contract = (ov.get("drafter_contract") or _DRAFTER_CONTRACT) + (
        (ov.get("drafter_word_addendum") or _DRAFTER_WORD_ADDENDUM) if mode == "word" else ""
    )
```

- [ ] **Step 5: orchestrator.py 수정**

상단 import: `from collections.abc import Mapping`(이미 있으면 생략) + `from app.prompt_registry import get_prompt_overrides` (registry는 orchestrator를 지연 import하므로 순환 없음).

1. `generate_proposals` 시그니처에 `overrides: Mapping[str, str] | None = None,` 추가 → 내부 `build_drafter_messages(...)` 호출에 `overrides=overrides,` 추가.
2. `_run_skip_turn` 시그니처에 `overrides: Mapping[str, str] | None = None,` 추가 → 내부 `build_interviewer_messages(...)` 호출에 `overrides=overrides,` 추가.
3. `run_turn` 시그니처에 `overrides: Mapping[str, str] | None = None,` 추가 → `_run_skip_turn(...)` 호출과 `build_interviewer_messages(...)` 호출(757행)에 `overrides=overrides` 전달. 반복 넛지 재질의(~769행)의 `_ANTI_REPEAT_NUDGE`를 `((overrides or {}).get("anti_repeat_nudge") or _ANTI_REPEAT_NUDGE)`로 교체.
4. `extract_attachment_facts` — 첫 `async with SessionLocal() as session:` 블록 안(parsed_text 확보 후)에 `overrides = await get_prompt_overrides(session)` 추가, AI 콜(~585행)의 `_EXTRACT_CONTRACT`를 `(overrides.get("extract_contract") or _EXTRACT_CONTRACT)`로 교체.

- [ ] **Step 6: interviews.py 호출부 수정**

import에 `from app.prompt_registry import get_prompt_overrides` 추가. 두 호출부:

```python
        result = await run_turn(
            session, interview, payload, graph_summary, context_text,
            doc_sections=doc_sections, dept_catalog=await _dept_catalog(session, interview),
            overrides=await get_prompt_overrides(session),
        )
```

```python
        choices, demoted = await generate_proposals(
            interview, context_text, doc_sections=doc_sections, variants=payload.variants,
            overrides=await get_prompt_overrides(session),
        )
```

- [ ] **Step 7: 통과 확인 + 전체 회귀**

Run(backend/): `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: 전체 PASS — 특히 `test_ai.py`·`test_interview_*` 기존 테스트가 무변경 통과(폴백 검증).
Run: `.venv/bin/ruff check app/ tests/` → clean

- [ ] **Step 8: 커밋**

`PROGRESS.md` 2026-08-04 섹션에 한 줄 추가: `- 구현: 프롬프트 빌더 7표면에 overrides 스레딩(None=기존 상수 폴백, 기존 테스트 무변경 그린).`

```bash
git add backend/app/ai_prompt.py backend/app/routers/ai.py backend/app/interview/agents.py backend/app/interview/orchestrator.py backend/app/routers/interviews.py backend/tests/test_ai_prompts.py PROGRESS.md
git commit -m "feat(ai-prompts): thread DB overrides into prompt builders — 빌더에 프롬프트 오버라이드 적용"
```

---

### Task 4: 프론트 — API 클라이언트 + i18n + 설정 탭 + 패널

**Files:**
- Modify: `frontend/src/lib/api.ts` (`getAiTips` 뒤 ~1040행)
- Modify: `frontend/src/lib/i18n-messages.ts` (en `"aiLog.*"` 블록 뒤 + ko 대응 블록 뒤)
- Create: `frontend/src/components/settings/ai-prompts-panel.tsx`
- Modify: `frontend/src/app/settings/page.tsx` (TabId 유니언 ~30행, CATEGORIES Content 탭 ~57행, 패널 마운트 ~224행, import)
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 2 API 형태(`AiPromptOut`), 기존 `MarkdownView({source})`, `ConfirmDialog`, `formatKstShort`, `useI18n`/`MessageKey`
- Produces: `api.ts`의 `AiPromptItem`/`getAiPrompts()`/`putAiPrompt(key, content)`/`resetAiPrompt(key)`, `AiPromptsPanel({onToast})` — Task 5 스모크가 `data-id` 셀렉터 사용.

- [ ] **Step 1: api.ts 추가**

`getAiTips` 함수 뒤에:

```ts
// ── AI 프롬프트 관리 (sysadmin) ────────────────────────────────
export interface AiPromptItem {
  key: string;
  content: string; // 유효값 — 오버라이드 있으면 그것, 없으면 코드 기본값
  is_customized: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export function getAiPrompts(): Promise<AiPromptItem[]> {
  return request<AiPromptItem[]>("/admin/ai-prompts");
}

export function putAiPrompt(key: string, content: string): Promise<AiPromptItem> {
  return request<AiPromptItem>(`/admin/ai-prompts/${key}`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

// 기본값 복원 — 오버라이드 행 삭제(멱등)
export function resetAiPrompt(key: string): Promise<AiPromptItem> {
  return request<AiPromptItem>(`/admin/ai-prompts/${key}`, { method: "DELETE" });
}
```

- [ ] **Step 2: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts` — en 객체의 `"aiLog.*"` 키 블록 바로 뒤에:

```ts
  // ── AI 프롬프트 관리 / AI prompt management (sysadmin) ─────────
  "aiPrompts.tab": "AI prompts",
  "aiPrompts.title": "AI Prompts",
  "aiPrompts.desc":
    "System prompts sent to the AI. Changes apply from the next AI call; prompts without an override use the built-in default.",
  "aiPrompts.warning":
    "Prompts embed JSON response contracts the server parses — breaking them can disable AI features. If anything misbehaves, use Reset to default.",
  "aiPrompts.customized": "Customized",
  "aiPrompts.updatedBy": "{by} · {at}",
  "aiPrompts.edit": "Edit",
  "aiPrompts.preview": "Preview",
  "aiPrompts.save": "Save",
  "aiPrompts.reset": "Reset to default",
  "aiPrompts.resetTitle": "Reset to default?",
  "aiPrompts.resetMessage":
    "Deletes the customized prompt. The built-in default takes effect immediately.",
  "aiPrompts.dirtyTitle": "Discard unsaved changes?",
  "aiPrompts.dirtyMessage": "Your edits to this prompt have not been saved.",
  "aiPrompts.saved": "Prompt saved",
  "aiPrompts.resetDone": "Restored to built-in default",
  "aiPrompts.error": "Failed to load or update prompt",
  "aiPrompts.name.ai_chat_instructions": "Map editor AI chat",
  "aiPrompts.hint.ai_chat_instructions": "System instructions for the editor AI chat (modes, JSON schemas, rules)",
  "aiPrompts.name.interviewer_contract": "Interviewer contract",
  "aiPrompts.hint.interviewer_contract": "Consultant interviewer persona and response contract",
  "aiPrompts.name.drafter_contract": "Drafter contract",
  "aiPrompts.hint.drafter_contract": "Flowchart drafter rules (delta output, titles, attributes)",
  "aiPrompts.name.interviewer_word_addendum": "Interviewer — Word mode",
  "aiPrompts.hint.interviewer_word_addendum": "Addendum applied to the interviewer in Word/SOP mode",
  "aiPrompts.name.drafter_word_addendum": "Drafter — Word mode",
  "aiPrompts.hint.drafter_word_addendum": "Addendum applied to the drafter in Word/SOP mode (section nodes, anchors)",
  "aiPrompts.name.extract_contract": "Attachment extraction",
  "aiPrompts.hint.extract_contract": "Contract for extracting interview facts from uploaded documents",
  "aiPrompts.name.anti_repeat_nudge": "Anti-repeat nudge",
  "aiPrompts.hint.anti_repeat_nudge": "Retry nudge injected when the consultant repeats its previous reply",
```

ko 객체의 대응 위치(ko `"aiLog.*"` 블록 뒤)에 같은 키로 한국어 값:

```ts
  // ── AI 프롬프트 관리 (sysadmin) ─────────────────────────────
  "aiPrompts.tab": "AI 프롬프트",
  "aiPrompts.title": "AI 프롬프트",
  "aiPrompts.desc":
    "AI에 전달되는 시스템 프롬프트입니다. 저장 즉시 다음 AI 호출부터 적용되며, 오버라이드가 없는 항목은 내장 기본값을 사용합니다.",
  "aiPrompts.warning":
    "프롬프트에는 서버가 파싱하는 JSON 응답 계약이 포함돼 있습니다 — 계약이 깨지면 AI 기능이 오동작할 수 있습니다. 문제가 생기면 기본값 복원을 사용하세요.",
  "aiPrompts.customized": "커스텀",
  "aiPrompts.updatedBy": "{by} · {at}",
  "aiPrompts.edit": "편집",
  "aiPrompts.preview": "미리보기",
  "aiPrompts.save": "저장",
  "aiPrompts.reset": "기본값 복원",
  "aiPrompts.resetTitle": "기본값으로 복원할까요?",
  "aiPrompts.resetMessage": "커스텀 프롬프트가 삭제되고 내장 기본값이 즉시 적용됩니다.",
  "aiPrompts.dirtyTitle": "저장하지 않은 변경을 버릴까요?",
  "aiPrompts.dirtyMessage": "이 프롬프트의 수정 내용이 저장되지 않았습니다.",
  "aiPrompts.saved": "프롬프트를 저장했습니다",
  "aiPrompts.resetDone": "내장 기본값으로 복원했습니다",
  "aiPrompts.error": "프롬프트 조회/저장에 실패했습니다",
  "aiPrompts.name.ai_chat_instructions": "맵 에디터 AI 챗",
  "aiPrompts.hint.ai_chat_instructions": "에디터 AI 챗 시스템 지침(모드·JSON 스키마·규칙)",
  "aiPrompts.name.interviewer_contract": "인터뷰어 계약",
  "aiPrompts.hint.interviewer_contract": "컨설턴트 인터뷰어 페르소나·응답 계약",
  "aiPrompts.name.drafter_contract": "드래프터 계약",
  "aiPrompts.hint.drafter_contract": "순서도 드래프터 규칙(델타 출력·제목·속성)",
  "aiPrompts.name.interviewer_word_addendum": "인터뷰어 — Word 모드",
  "aiPrompts.hint.interviewer_word_addendum": "Word/SOP 모드에서 인터뷰어에 덧붙는 애드덤",
  "aiPrompts.name.drafter_word_addendum": "드래프터 — Word 모드",
  "aiPrompts.hint.drafter_word_addendum": "Word/SOP 모드에서 드래프터에 덧붙는 애드덤(섹션 노드·앵커)",
  "aiPrompts.name.extract_contract": "첨부 추출 계약",
  "aiPrompts.hint.extract_contract": "업로드 문서에서 인터뷰 facts를 추출하는 계약",
  "aiPrompts.name.anti_repeat_nudge": "반복 방지 넛지",
  "aiPrompts.hint.anti_repeat_nudge": "직전 답변을 반복할 때 주입되는 재시도 넛지",
```

`{by}`/`{at}` 치환은 기존 `aiLog.updatedBy` 사용부(`ai-chat-settings-panel.tsx` ~203행)의 방식을 그대로 따른다(`.replace("{by}", ...)` 등 — 구현 시 확인해 동일하게).

- [ ] **Step 3: 패널 컴포넌트 작성**

`frontend/src/components/settings/ai-prompts-panel.tsx` 신규:

```tsx
"use client";

// AI 프롬프트 관리 패널 — sysadmin이 AI 시스템 프롬프트를 열람·오버라이드·기본값 복원.
// 행 없음 = 코드 기본값 (설계: docs/design/2026-08-04-ai-prompts-admin-design.md)

import { useEffect, useState } from "react";
import { AlertTriangle, Eye, Pencil, RotateCcw } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { MarkdownView } from "@/components/markdown-view";
import { getAiPrompts, putAiPrompt, resetAiPrompt, type AiPromptItem } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const OUTLINE_BTN =
  "flex items-center gap-1.5 rounded-sm border border-hairline px-2.5 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt";

// key → i18n 라벨 — 백엔드는 key만 주고 표시명·설명은 프론트가 소유
const PROMPT_LABELS: Record<string, { name: MessageKey; hint: MessageKey }> = {
  ai_chat_instructions: {
    name: "aiPrompts.name.ai_chat_instructions",
    hint: "aiPrompts.hint.ai_chat_instructions",
  },
  interviewer_contract: {
    name: "aiPrompts.name.interviewer_contract",
    hint: "aiPrompts.hint.interviewer_contract",
  },
  drafter_contract: {
    name: "aiPrompts.name.drafter_contract",
    hint: "aiPrompts.hint.drafter_contract",
  },
  interviewer_word_addendum: {
    name: "aiPrompts.name.interviewer_word_addendum",
    hint: "aiPrompts.hint.interviewer_word_addendum",
  },
  drafter_word_addendum: {
    name: "aiPrompts.name.drafter_word_addendum",
    hint: "aiPrompts.hint.drafter_word_addendum",
  },
  extract_contract: {
    name: "aiPrompts.name.extract_contract",
    hint: "aiPrompts.hint.extract_contract",
  },
  anti_repeat_nudge: {
    name: "aiPrompts.name.anti_repeat_nudge",
    hint: "aiPrompts.hint.anti_repeat_nudge",
  },
};

interface AiPromptsPanelProps {
  onToast: (message: string) => void;
}

export function AiPromptsPanel({ onToast }: AiPromptsPanelProps) {
  const { t } = useI18n();
  const [items, setItems] = useState<AiPromptItem[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);

  // 마운트 1회 로드 — setter만 사용해 deps 없음(로드 실패는 인라인 표기)
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const list = await getAiPrompts();
        if (active) setItems(list);
      } catch {
        if (active) setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selected = items.find((item) => item.key === selectedKey) ?? null;
  const dirty = selected !== null && draft !== selected.content;

  const applySelect = (key: string) => {
    const item = items.find((entry) => entry.key === key);
    if (!item) return;
    setSelectedKey(key);
    setDraft(item.content);
    setPreview(false);
  };

  const selectPrompt = (key: string) => {
    if (key === selectedKey) return;
    if (dirty) {
      setPendingSwitch(key);
      return;
    }
    applySelect(key);
  };

  const save = async () => {
    if (!selectedKey || draft.trim() === "") return;
    setBusy(true);
    try {
      const updated = await putAiPrompt(selectedKey, draft);
      setItems((prev) => prev.map((item) => (item.key === updated.key ? updated : item)));
      setDraft(updated.content);
      onToast(t("aiPrompts.saved"));
    } catch {
      onToast(t("aiPrompts.error"));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!selectedKey) return;
    setBusy(true);
    try {
      const restored = await resetAiPrompt(selectedKey);
      setItems((prev) => prev.map((item) => (item.key === restored.key ? restored : item)));
      setDraft(restored.content);
      setPendingReset(false);
      onToast(t("aiPrompts.resetDone"));
    } catch {
      onToast(t("aiPrompts.error"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4" data-id="ai-prompts-panel">
      <div>
        <h2 className="text-body-strong text-ink">{t("aiPrompts.title")}</h2>
        <p className="pt-1 text-caption text-ink-tertiary">{t("aiPrompts.desc")}</p>
      </div>

      {/* JSON 계약 파손 경고 — 오편집 시 AI 기능 오동작 안내 */}
      <div className="flex items-center gap-2 rounded-sm border border-hairline bg-surface-alt px-3 py-2 text-caption text-ink-secondary">
        <AlertTriangle size={16} strokeWidth={1.5} className="shrink-0 text-error" />
        {t("aiPrompts.warning")}
      </div>

      {loadError ? <p className="text-caption text-error">{t("aiPrompts.error")}</p> : null}

      {/* 프롬프트 목록 */}
      <div className="flex shrink-0 flex-col rounded-sm border border-hairline" data-id="ai-prompts-list">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            data-id={`ai-prompt-row-${item.key}`}
            className={`flex items-center gap-3 border-b border-hairline px-3 py-2 text-left last:border-b-0 ${
              selectedKey === item.key ? "bg-accent-tint" : "hover:bg-surface-alt"
            }`}
            onClick={() => selectPrompt(item.key)}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-caption-strong text-ink">
                {t(PROMPT_LABELS[item.key]?.name ?? "aiPrompts.title")}
              </span>
              <span className="truncate text-fine text-ink-tertiary">
                {t(PROMPT_LABELS[item.key]?.hint ?? "aiPrompts.desc")}
              </span>
            </span>
            {item.is_customized ? (
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className="rounded-full bg-accent-tint px-2 py-0.5 text-fine text-accent">
                  {t("aiPrompts.customized")}
                </span>
                <span className="text-fine text-ink-tertiary">
                  {t("aiPrompts.updatedBy")
                    .replace("{by}", item.updated_by ?? "")
                    .replace("{at}", formatKstShort(item.updated_at))}
                </span>
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* 편집기 / 미리보기 — 매뉴얼 관리 패널 패턴 */}
      {selected ? (
        <div
          className="flex min-h-[320px] flex-1 flex-col rounded-sm border border-hairline"
          data-id="ai-prompt-editor"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-hairline bg-surface-alt px-3 py-1.5">
            <span className="font-mono text-fine text-ink-tertiary">{selected.key}</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-pressed={preview}
                data-id="ai-prompt-preview-toggle"
                className={
                  OUTLINE_BTN + (preview ? " bg-accent-tint text-accent hover:bg-accent-tint" : "")
                }
                onClick={() => setPreview((value) => !value)}
              >
                {preview ? (
                  <Pencil size={14} strokeWidth={1.5} />
                ) : (
                  <Eye size={14} strokeWidth={1.5} />
                )}
                {preview ? t("aiPrompts.edit") : t("aiPrompts.preview")}
              </button>
              <button
                type="button"
                data-id="ai-prompt-reset"
                disabled={busy || !selected.is_customized}
                className={OUTLINE_BTN + " disabled:opacity-50"}
                onClick={() => setPendingReset(true)}
              >
                <RotateCcw size={14} strokeWidth={1.5} />
                {t("aiPrompts.reset")}
              </button>
              <button
                type="button"
                data-id="ai-prompt-save"
                disabled={busy || !dirty || draft.trim() === ""}
                className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-50"
                onClick={() => void save()}
              >
                {t("aiPrompts.save")}
              </button>
            </div>
          </div>
          {preview ? (
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <MarkdownView source={draft} />
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none rounded-b-sm bg-surface px-5 py-4 font-mono text-caption leading-relaxed text-ink outline-none"
            />
          )}
        </div>
      ) : null}

      {/* 기본값 복원 확인 */}
      {pendingReset && (
        <ConfirmDialog
          icon={<RotateCcw size={28} strokeWidth={1.5} />}
          title={t("aiPrompts.resetTitle")}
          message={t("aiPrompts.resetMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          danger
          onConfirm={() => void reset()}
          onClose={() => setPendingReset(false)}
        />
      )}
      {/* 더티 상태에서 다른 프롬프트 선택 확인 */}
      {pendingSwitch !== null && (
        <ConfirmDialog
          title={t("aiPrompts.dirtyTitle")}
          message={t("aiPrompts.dirtyMessage")}
          confirmLabel={t("common.confirm")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            applySelect(pendingSwitch);
            setPendingSwitch(null);
          }}
          onClose={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
```

주의: `common.confirm`/`common.cancel` 키는 기존 존재(매뉴얼 패널 사용 중). `useI18n` import 경로가 `@/lib/i18n`이 아니면(구현 시 확인) 기존 패널과 동일 경로로.

- [ ] **Step 4: 설정 페이지 배선**

`frontend/src/app/settings/page.tsx`:
1. import 블록에 `import { AiPromptsPanel } from "@/components/settings/ai-prompts-panel";` 추가(`AiChatSettingsPanel` 줄 옆).
2. `type TabId` 유니언에 `| "aiPrompts"` 추가.
3. `CATEGORIES`의 Content 카테고리(`admin.catContent`) tabs 배열에서 `aiChat` 항목 뒤에 `{ id: "aiPrompts", labelKey: "aiPrompts.tab" },` 추가.
4. `<main>` 렌더 블록의 `{current === "aiChat" && ...}` 뒤에 추가:

```tsx
          {current === "aiPrompts" && (
            <AiPromptsPanel onToast={(message) => showToast({ id: genId(), message })} />
          )}
```

- [ ] **Step 5: 게이트 확인**

Run(frontend/): `npm run lint` → clean, `npm test` → 기존 전부 PASS, `npm run build` → 성공.
(React Compiler 룰 위반·`MessageKey` 타입 불일치가 여기서 잡힌다.)

- [ ] **Step 6: 커밋**

`PROGRESS.md` 2026-08-04 섹션에 한 줄 추가: `- 구현: 설정 Content > AI prompts 탭(7종 목록·편집/프리뷰·기본값 복원, MarkdownView 재사용).`

```bash
git add frontend/src/lib/api.ts frontend/src/lib/i18n-messages.ts frontend/src/components/settings/ai-prompts-panel.tsx frontend/src/app/settings/page.tsx PROGRESS.md
git commit -m "feat(ai-prompts): settings tab to view/edit/reset AI prompts — 설정 AI 프롬프트 편집 탭"
```

---

### Task 5: 브라우저 스모크 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-ai-prompts.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 4의 `data-id`(`ai-prompts-list`, `ai-prompt-row-*`, `ai-prompt-editor`, `ai-prompt-save`, `ai-prompt-reset`, `ai-prompt-preview-toggle`), 로컬 dev 서버(백엔드 8000·프론트 3000), devUser `admin.sys`(기본 로컬은 전원 sysadmin)
- Produces: PASS/FAIL 체크 출력 + 스크린샷 — 최종 검증 증거.

- [ ] **Step 1: 스모크 스크립트 작성**

`frontend/scripts/pw-smoke-ai-prompts.mjs` 신규 (기존 `pw-smoke-*.mjs` 하네스 관례 — playwright-core + 시스템 Chrome):

```js
// AI 프롬프트 관리 스모크 — 설정 탭 진입 → 7종 목록 → 편집·저장(커스텀 배지) →
// 마크다운 프리뷰 → 새로고침 지속성 → 기본값 복원(배지 해제) → 정리.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3000 SHOT_DIR=<dir> node scripts/pw-smoke-ai-prompts.mjs
// 전제: backend(8000)+frontend(3000) 네이티브 기동, 로컬 기본(전원 sysadmin). 언어 en 고정.
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const SHOT_DIR = process.env.SHOT_DIR ?? ".";
const CUSTOM = "SMOKE custom nudge — **bold-marker**";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

try {
  // 1) 설정 → AI prompts 탭
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "AI prompts" }).click();
  await page.waitForSelector('[data-id="ai-prompts-list"]', { timeout: 8000 });
  const rows = await page.locator('[data-id^="ai-prompt-row-"]').count();
  check("list shows 7 prompts", rows === 7, `rows=${rows}`);

  // 2) 항목 선택 → 편집기에 기본값 로드
  await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').click();
  await page.waitForSelector('[data-id="ai-prompt-editor"]');
  const initial = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("editor loads default content", initial.trim().length > 0);
  check("save disabled while pristine", await page.locator('[data-id="ai-prompt-save"]').isDisabled());

  // 3) 수정 → 저장 → 커스텀 배지
  await page.locator('[data-id="ai-prompt-editor"] textarea').fill(CUSTOM);
  await page.locator('[data-id="ai-prompt-save"]').click();
  await page.waitForTimeout(600);
  const rowText = await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').innerText();
  check("customized badge after save", rowText.includes("Customized"));
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-saved.png` });

  // 4) 마크다운 프리뷰
  await page.locator('[data-id="ai-prompt-preview-toggle"]').click();
  const bold = await page.locator('[data-id="ai-prompt-editor"] strong', { hasText: "bold-marker" }).count();
  check("markdown preview renders", bold >= 1);
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-preview.png` });

  // 5) 새로고침 지속성
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "AI prompts" }).click();
  await page.waitForSelector('[data-id="ai-prompts-list"]');
  await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').click();
  const persisted = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("override persists after reload", persisted === CUSTOM);

  // 6) 기본값 복원(확인 모달 경유) → 배지 해제 + 내용 복귀
  await page.locator('[data-id="ai-prompt-reset"]').click();
  await page.getByRole("button", { name: "Confirm" }).click(); // common.confirm 실라벨 확인해 조정
  await page.waitForTimeout(600);
  const restored = await page.locator('[data-id="ai-prompt-editor"] textarea').inputValue();
  check("reset restores default", restored !== CUSTOM && restored.trim().length > 0);
  const rowAfter = await page.locator('[data-id="ai-prompt-row-anti_repeat_nudge"]').innerText();
  check("badge cleared after reset", !rowAfter.includes("Customized"));
  check("reset disabled at default", await page.locator('[data-id="ai-prompt-reset"]').isDisabled());
  await page.screenshot({ path: `${SHOT_DIR}/ai-prompts-reset.png` });

  check("no page errors", consoleErrors.length === 0, consoleErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
```

주의: `common.confirm` en 실라벨이 "Confirm"이 아니면 스크립트의 `getByRole` name을 실제 값으로 조정. `ConfirmDialog` confirm 버튼에 data-id가 없으므로 라벨 셀렉터 사용.

- [ ] **Step 2: 서버 기동 + 스모크 실행**

```bash
# 좀비 프론트 정리(3000 점유 시 3001 폴백으로 구버전에 붙는 함정 — lessons/browser-verification.md)
pkill -f "next dev" 2>/dev/null; pkill -f "uvicorn app.main" 2>/dev/null; sleep 1
# backend (backend/ 에서 — 로컬 기본: sqlite, 전원 sysadmin)
.venv/bin/uvicorn app.main:app --port 8000 &
# frontend (frontend/ 에서)
npm run dev &
sleep 8
# 스모크 (frontend/ 에서)
SHOT_DIR=/tmp/ai-prompts-smoke node scripts/pw-smoke-ai-prompts.mjs
```

Expected: 전 체크 PASS(10개), 스크린샷 3장. dev.db 오염으로 이상 동작 시 lessons의 dev.db 함정 확인. (Claude Code 세션에선 백그라운드 서버가 턴 종료 시 회수되는 함정 — 서버 기동과 스모크를 **같은 턴**에서 실행.)

- [ ] **Step 3: 전체 게이트 재확인**

```bash
# backend/ 에서
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q
.venv/bin/ruff check app/ tests/
# frontend/ 에서
npm run lint && npm test && npm run build
```

Expected: 모두 그린. 실패 시 원인 수정 후 재실행(같은 실패 2회면 중단·보고).

- [ ] **Step 4: 커밋**

`PROGRESS.md` 2026-08-04 섹션에 한 줄 추가: `- 검증: pw 스모크 10체크 그린(편집·저장·프리뷰·지속성·복원) + 전체 게이트(pytest·ruff·lint·vitest·build).`

```bash
git add frontend/scripts/pw-smoke-ai-prompts.mjs PROGRESS.md
git commit -m "test(ai-prompts): browser smoke for prompt admin tab — 프롬프트 관리 탭 브라우저 스모크"
```

---

## 잔여 리스크 (구현 밖 — 완료 보고에 명시)

- 오버라이드가 **실제 AI 응답**에 반영되는지는 GPU 서버 실모델 스모크에서만 확인 가능(로컬은 AI_ENABLED=false). 빌더 단위 테스트 + 라우터 글루 1줄이 커버하는 범위 명시.
- 서버 배포 시 `ai_prompts` 테이블은 startup `create_all`이 생성 — 별도 마이그레이션 불필요, 배포 후 `/settings` 탭 확인 1회.
