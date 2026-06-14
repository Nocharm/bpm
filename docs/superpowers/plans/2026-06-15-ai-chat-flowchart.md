# On-Prem AI Chat (Flowchart + Manual) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a chat panel where users instruct an on-prem (OpenAI-compatible) AI to draw/edit the current process-map scope (preview-then-apply) and ask usage questions, with the backend proxying the GPU server.

**Architecture:** A backend `/api/versions/{id}/ai/chat` endpoint loads the current scope graph, builds a system prompt (graph schema + manual markdown + current graph + edit-permission), calls a swappable `ai_client` adapter (OpenAI-compatible), validates the AI's JSON into a discriminated `AiProposal` (`kind: graph|answer`), and returns it. The frontend chat panel previews a `graph` proposal by laying it out with the existing dagre and applying it to the canvas behind an Apply/Discard bar (autosave suppressed until Apply); an `answer` is shown as chat text. AI server is mocked in tests; the manual prose is written last.

**Tech Stack:** FastAPI/Pydantic v2, SQLAlchemy async, `httpx2` (this repo's OpenAI-compatible HTTP client, promoted to prod), pytest + TestClient (AI mocked via monkeypatch). Frontend: Next.js client component, `@xyflow/react`, existing `layoutWithDagre`, Lucide, `useI18n`.

**Spec:** `docs/superpowers/specs/2026-06-15-ai-chat-flowchart-design.md`

**Run commands (bash / PowerShell):**
- Backend (from `backend/`): `.venv/bin/python -m pytest tests/ -q` · `.venv/bin/ruff check app/ tests/` (PowerShell `.venv\Scripts\...`)
- Frontend (from `frontend/`): `npm run lint` · `npm run build` · `npm run dev`

**Verification reality:** backend is fully unit-tested with the AI server mocked. The real `ai_client.call_ai` HTTP path is NOT unit-tested (no network in tests) — it is integration-verified manually against the GPU server; state this when reporting. Frontend has no JS test harness — verify with lint + build + explicit manual checks (do NOT fabricate tests).

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/app/settings.py` | AI config fields | Modify |
| `backend/requirements.txt` / `requirements-dev.txt` | promote `httpx2` to prod | Modify |
| `backend/.env.example` | AI env vars | Modify |
| `backend/app/schemas.py` | `AiChatRequest`, `AiNode/AiEdge`, `AiProposal` | Modify |
| `backend/app/ai_prompt.py` | build system prompt + messages (pure) | Create |
| `backend/app/manual.py` | load `manual.md` | Create |
| `backend/app/manual.md` | usage manual (prose written last) | Create |
| `backend/app/ai_client.py` | OpenAI-compatible call adapter (swappable) | Create |
| `backend/app/routers/ai.py` | `/ai/chat` endpoint: guards, validate, retry | Create |
| `backend/app/main.py` | register router; `MeOut.ai_enabled` | Modify |
| `backend/tests/test_ai.py` | endpoint tests (AI mocked) | Create |
| `frontend/src/lib/api.ts` | `aiChat()` + types; `getMe` ai_enabled | Modify |
| `frontend/src/components/ai-chat-panel.tsx` | chat UI + answer display | Create |
| `frontend/src/app/maps/[mapId]/page.tsx` | panel toggle + preview/apply wiring | Modify |
| `frontend/src/lib/i18n-messages.ts` | `ai.*` keys | Modify |

All backend paths are relative to `backend/`, frontend to `frontend/`.

---

### Task 1: Settings + dependency + .env

**Files:** `app/settings.py`, `requirements.txt`, `requirements-dev.txt`, `.env.example`, `tests/test_ai.py` (create)

- [ ] **Step 1: Write the failing test** — create `tests/test_ai.py`:

```python
"""On-prem AI chat tests — AI server mocked via monkeypatch (design 2026-06-15)."""

import pytest
from fastapi.testclient import TestClient

from app.settings import settings


def test_ai_settings_default_disabled() -> None:
    assert settings.ai_enabled is False
    assert settings.ai_timeout_seconds == 60
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_ai.py::test_ai_settings_default_disabled -v` → FAIL (`ai_enabled` attribute missing).

- [ ] **Step 3: Add Settings fields** — in `app/settings.py`, inside `class Settings`, after `checkout_ttl_minutes`, add:

```python
    # 온프레미스 AI (OpenAI 호환 GPU 서버) — 로컬 기본 비활성, 서버 compose만 활성 (design 2026-06-15)
    ai_enabled: bool = False
    ai_base_url: str = ""  # 예: http://<gpu>:8000/v1
    ai_api_token: str = ""  # Bearer 토큰 (시크릿 — .env만, git 금지)
    ai_model: str = ""
    ai_timeout_seconds: int = 60  # 요청 타임아웃(초)
```

- [ ] **Step 4: Promote `httpx2` to production deps** — in `requirements.txt`, append:

```
httpx2==2.3.0
```

In `requirements-dev.txt`, remove the now-redundant `httpx2==2.3.0` line (it is inherited via `-r requirements.txt`). Keep the explanatory comment if present, or drop it.

- [ ] **Step 5: Add `.env.example` block** — append to `backend/.env.example`:

```
# 온프레미스 AI (OpenAI 호환 GPU 서버). 로컬은 비활성, 서버 compose에서만 설정.
AI_ENABLED=false
AI_BASE_URL=
AI_API_TOKEN=
AI_MODEL=
AI_TIMEOUT_SECONDS=60
```

- [ ] **Step 6: Run test + suite** — `.venv/bin/python -m pytest tests/test_ai.py::test_ai_settings_default_disabled -v` → PASS. `.venv/bin/python -m pytest tests/ -q` → green. `.venv/bin/ruff check app/ tests/` → clean.

- [ ] **Step 7: Commit**
```bash
git add app/settings.py requirements.txt requirements-dev.txt .env.example tests/test_ai.py
git commit -m "feat(backend): AI settings + promote httpx2 to prod deps — AI 설정·의존성"
```

---

### Task 2: Schemas — request + discriminated proposal with validation

**Files:** `app/schemas.py`, `tests/test_ai.py`

- [ ] **Step 1: Write failing tests** — append to `tests/test_ai.py`:

```python
def test_proposal_rejects_orphan_edge() -> None:
    from pydantic import ValidationError

    from app.schemas import AiProposal

    with pytest.raises(ValidationError):
        AiProposal.model_validate(
            {
                "kind": "graph",
                "message": "x",
                "nodes": [{"key": "a", "title": "A", "node_type": "process"}],
                "edges": [{"source": "a", "target": "ghost"}],
            }
        )


def test_proposal_rejects_bad_node_type() -> None:
    from pydantic import ValidationError

    from app.schemas import AiProposal

    with pytest.raises(ValidationError):
        AiProposal.model_validate(
            {
                "kind": "graph",
                "message": "x",
                "nodes": [{"key": "a", "title": "A", "node_type": "loop"}],
                "edges": [],
            }
        )


def test_proposal_answer_ok_without_graph() -> None:
    from app.schemas import AiProposal

    proposal = AiProposal.model_validate({"kind": "answer", "message": "hello"})
    assert proposal.kind == "answer"
    assert proposal.nodes == []
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_ai.py::test_proposal_rejects_orphan_edge -v` → FAIL (`AiProposal` undefined).

- [ ] **Step 3: Add schemas** — in `app/schemas.py`, add `from typing import Literal` to the top imports if absent, and `from pydantic import model_validator` (extend the existing pydantic import line which already has `BaseModel, ConfigDict, Field`). Append at the END of the file:

```python
AI_NODE_TYPES = {"start", "process", "decision", "end"}


class AiChatTurn(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    parent: str | None = None
    instruction: str = Field(min_length=1, max_length=2000)
    history: list[AiChatTurn] = Field(default_factory=list, max_length=20)


class AiNode(BaseModel):
    key: str = Field(min_length=1, max_length=50)
    title: str = Field(min_length=1, max_length=200)
    node_type: str = "process"
    description: str = ""


class AiEdge(BaseModel):
    source: str
    target: str
    label: str = ""


class AiProposal(BaseModel):
    # 판별 타입 — graph: 순서도 제안, answer: 사용법 텍스트 (design 2026-06-15)
    kind: Literal["graph", "answer"]
    message: str = ""
    nodes: list[AiNode] = Field(default_factory=list)
    edges: list[AiEdge] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_graph_integrity(self) -> "AiProposal":
        if self.kind != "graph":
            return self
        keys = [node.key for node in self.nodes]
        if len(keys) != len(set(keys)):
            raise ValueError("duplicate node keys")
        keyset = set(keys)
        for node in self.nodes:
            if node.node_type not in AI_NODE_TYPES:
                raise ValueError(f"invalid node_type: {node.node_type}")
        for edge in self.edges:
            if edge.source not in keyset or edge.target not in keyset:
                raise ValueError("edge references unknown node key")
        return self
```

- [ ] **Step 4: Run tests** — `.venv/bin/python -m pytest tests/test_ai.py -k proposal -v` → all PASS. `.venv/bin/ruff check app/ tests/` → clean.

- [ ] **Step 5: Commit**
```bash
git add app/schemas.py tests/test_ai.py
git commit -m "feat(backend): AI chat request + validated discriminated proposal — AI 스키마·검증"
```

---

### Task 3: Manual loader + stub

**Files:** `app/manual.py` (create), `app/manual.md` (create), `tests/test_ai.py`

- [ ] **Step 1: Write failing test** — append to `tests/test_ai.py`:

```python
def test_manual_loads_nonempty() -> None:
    from app.manual import get_manual

    assert len(get_manual().strip()) > 0
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_ai.py::test_manual_loads_nonempty -v` → FAIL (`app.manual` missing).

- [ ] **Step 3: Create `app/manual.py`**:

```python
"""사용법 매뉴얼 로더 — app/manual.md를 1회 읽어 캐시 (design 2026-06-15)."""

from functools import lru_cache
from pathlib import Path

_MANUAL_PATH = Path(__file__).parent / "manual.md"


@lru_cache(maxsize=1)
def get_manual() -> str:
    """매뉴얼 마크다운 전문. 파일 없으면 빈 문자열."""
    try:
        return _MANUAL_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""
```

- [ ] **Step 4: Create `app/manual.md` (stub — prose finalized in Task 10)**:

```markdown
# BPM 사용 매뉴얼

(이 매뉴얼 본문은 구현 마지막 단계에서 보강됩니다. 아래는 핵심 골격입니다.)

## 맵과 캔버스
- 홈에서 맵을 만들고 엽니다. 캔버스에서 노드를 추가/이동하고 핸들을 끌어 연결합니다.

## 버전과 승인 워크플로우
- 버전은 Draft→Pending→Approved→Published 단계로 흐릅니다. 오른쪽 인스펙터 하단 승인 대시보드에서 진행합니다.

## AI 채팅
- AI 채팅 패널에 "구매 프로세스를 그려줘"처럼 지시하면 순서도를 제안합니다. 미리보기에서 적용/거절합니다.
```

- [ ] **Step 5: Run test** — `.venv/bin/python -m pytest tests/test_ai.py::test_manual_loads_nonempty -v` → PASS.

- [ ] **Step 6: Commit**
```bash
git add app/manual.py app/manual.md tests/test_ai.py
git commit -m "feat(backend): manual markdown loader + stub — 매뉴얼 로더"
```

---

### Task 4: Prompt builder (pure)

**Files:** `app/ai_prompt.py` (create), `tests/test_ai.py`

- [ ] **Step 1: Write failing test** — append to `tests/test_ai.py`:

```python
def test_build_messages_includes_graph_manual_and_instruction() -> None:
    from app.ai_prompt import build_messages
    from app.schemas import AiChatTurn, GraphOut, NodeOut, EdgeIn

    graph = GraphOut(
        nodes=[NodeOut(id="x1", title="발주", node_type="start")],
        edges=[EdgeIn(id="e1", source_node_id="x1", target_node_id="x1")],
        groups=[],
    )
    messages = build_messages(
        manual="MANUAL_BODY",
        current_graph=graph,
        can_edit=True,
        instruction="구매 프로세스 그려줘",
        history=[AiChatTurn(role="user", content="이전")],
    )

    system = messages[0]["content"]
    assert messages[0]["role"] == "system"
    assert "발주" in system  # 현재 그래프 직렬화
    assert "MANUAL_BODY" in system  # 매뉴얼 주입
    assert messages[-1] == {"role": "user", "content": "구매 프로세스 그려줘"}
    assert any(turn["content"] == "이전" for turn in messages)  # history 포함
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_ai.py::test_build_messages_includes_graph_manual_and_instruction -v` → FAIL (`app.ai_prompt` missing).

- [ ] **Step 3: Create `app/ai_prompt.py`**:

```python
"""AI 시스템 프롬프트 구성 — 그래프 스키마 + 매뉴얼 + 현재 그래프 직렬화 (design 2026-06-15)."""

from app.schemas import AiChatTurn, GraphOut

_INSTRUCTIONS = """당신은 BPM 프로세스맵 편집 도우미입니다.
반드시 JSON 한 개만 반환하세요(설명 텍스트 금지).
- 순서도 생성/편집: {"kind":"graph","message":<한국어 설명>,"nodes":[{"key":<임시키>,"title":<제목>,"node_type":"start|process|decision|end","description":""}],"edges":[{"source":<key>,"target":<key>,"label":""}]}
- 사용법/질문 답변: {"kind":"answer","message":<한국어 답변>}
edges의 source/target는 nodes의 key를 참조합니다. 좌표는 넣지 마세요(자동 배치)."""


def _serialize_graph(graph: GraphOut) -> str:
    nodes = "\n".join(
        f"- {node.id} [{node.node_type}] {node.title}" for node in graph.nodes
    )
    edges = "\n".join(
        f"- {edge.source_node_id} -> {edge.target_node_id}" for edge in graph.edges
    )
    return f"nodes:\n{nodes or '(없음)'}\nedges:\n{edges or '(없음)'}"


def build_system_prompt(manual: str, current_graph: GraphOut, can_edit: bool) -> str:
    edit_note = (
        "사용자는 현재 이 맵을 편집할 수 있습니다."
        if can_edit
        else "사용자는 현재 편집 권한이 없으니 그래프를 그리지 말고 kind=answer로만 답하세요."
    )
    return (
        f"{_INSTRUCTIONS}\n{edit_note}\n\n"
        f"[현재 그래프]\n{_serialize_graph(current_graph)}\n\n"
        f"[제품 매뉴얼]\n{manual}"
    )


def build_messages(
    manual: str,
    current_graph: GraphOut,
    can_edit: bool,
    instruction: str,
    history: list[AiChatTurn],
) -> list[dict]:
    messages: list[dict] = [
        {"role": "system", "content": build_system_prompt(manual, current_graph, can_edit)}
    ]
    for turn in history:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": instruction})
    return messages
```

- [ ] **Step 4: Run test** — `.venv/bin/python -m pytest tests/test_ai.py::test_build_messages_includes_graph_manual_and_instruction -v` → PASS. `.venv/bin/ruff check app/ tests/` → clean.

- [ ] **Step 5: Commit**
```bash
git add app/ai_prompt.py tests/test_ai.py
git commit -m "feat(backend): AI prompt builder (schema + manual + current graph) — 프롬프트 구성"
```

---

### Task 5: AI client adapter (swappable)

**Files:** `app/ai_client.py` (create)

No unit test (network path; mocked at the router level in Task 6). Integration-verified manually against the GPU server.

- [ ] **Step 1: Create `app/ai_client.py`**:

```python
"""온프레미스 AI(OpenAI 호환) 호출 어댑터 — 교체 가능 경계. 비OpenAI 서버면 이 파일만 수정 (design 2026-06-15)."""

import httpx2

from app.settings import settings


async def call_ai(messages: list[dict]) -> str:
    """OpenAI 호환 /chat/completions 호출 → 첫 choice의 message.content 반환.

    네트워크/HTTP 오류는 예외로 전파(라우터가 502로 변환). 토큰은 로그에 남기지 않는다.
    """
    url = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    payload = {
        "model": settings.ai_model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    }
    headers = {"Authorization": f"Bearer {settings.ai_api_token}"}
    async with httpx2.AsyncClient(timeout=settings.ai_timeout_seconds) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        data = response.json()
    return data["choices"][0]["message"]["content"]
```

> Note: this assumes `httpx2.AsyncClient` is httpx-compatible (`AsyncClient(timeout=...)`, `await client.post(url, json=, headers=)`, `response.raise_for_status()`, `response.json()`). Confirm against the installed `httpx2` API; if a method differs, adjust only this file. If the GPU server rejects `response_format`, drop that key (the prompt already forces JSON).

- [ ] **Step 2: Verify import** — `.venv/bin/python -c "from app import ai_client; print('ok')"` → prints `ok`. `.venv/bin/ruff check app/` → clean.

- [ ] **Step 3: Commit**
```bash
git add app/ai_client.py
git commit -m "feat(backend): OpenAI-compatible AI client adapter — AI 호출 어댑터"
```

---

### Task 6: AI chat endpoint (guards + validate + retry)

**Files:** `app/routers/ai.py` (create), `app/main.py` (register + `MeOut.ai_enabled`), `tests/test_ai.py`

- [ ] **Step 1: Write failing tests** — append to `tests/test_ai.py`:

```python
import json

from app import ai_client


def _enable_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "ai_enabled", True)


def _fake_ai(content: str):
    async def _call(messages: list[dict]) -> str:
        return content

    return _call


def _draft_version_checked_out(client: TestClient) -> int:
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]
    client.post(f"/api/versions/{version_id}/checkout", json={})
    return version_id


def test_ai_disabled_returns_503(client: TestClient) -> None:
    version_id = _draft_version_checked_out(client)
    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "draw"}
    )
    assert resp.status_code == 503


def test_ai_graph_proposal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    content = json.dumps(
        {
            "kind": "graph",
            "message": "그렸어요",
            "nodes": [
                {"key": "a", "title": "시작", "node_type": "start"},
                {"key": "b", "title": "처리", "node_type": "process"},
            ],
            "edges": [{"source": "a", "target": "b"}],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"}
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["kind"] == "graph"
    assert len(body["nodes"]) == 2


def test_ai_answer_proposal(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "도움말"}))
    )

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "어떻게 써?"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "answer"


def test_ai_graph_downgraded_when_not_editable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    # 체크아웃하지 않은 버전 → can_edit False
    created = client.post("/api/maps", json={"name": "ai map"}).json()
    version_id = created["versions"][0]["id"]
    content = json.dumps(
        {
            "kind": "graph",
            "message": "x",
            "nodes": [{"key": "a", "title": "A", "node_type": "process"}],
            "edges": [],
        }
    )
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai(content))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"}
    )

    assert resp.status_code == 200
    assert resp.json()["kind"] == "answer"  # 편집 불가 → 그래프 다운그레이드


def test_ai_invalid_then_retry_succeeds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    valid = json.dumps({"kind": "answer", "message": "ok"})
    calls = {"n": 0}

    async def _flaky(messages: list[dict]) -> str:
        calls["n"] += 1
        return "not json" if calls["n"] == 1 else valid

    monkeypatch.setattr(ai_client, "call_ai", _flaky)

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "?"}
    )

    assert resp.status_code == 200
    assert calls["n"] == 2  # 1회 재프롬프트


def test_ai_invalid_twice_returns_502(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    version_id = _draft_version_checked_out(client)
    monkeypatch.setattr(ai_client, "call_ai", _fake_ai("still not json"))

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "?"}
    )

    assert resp.status_code == 502
```

- [ ] **Step 2: Run, verify FAIL** — `.venv/bin/python -m pytest tests/test_ai.py::test_ai_graph_proposal -v` → FAIL (route 404 / `app.routers.ai` missing).

- [ ] **Step 3: Create `app/routers/ai.py`**:

```python
"""AI 채팅 — 순서도 생성/편집 제안 + 사용법 안내 (design 2026-06-15)."""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app import ai_client, workflow
from app.ai_prompt import build_messages
from app.auth import get_current_user
from app.checkout import is_checkout_active
from app.db import get_session
from app.manual import get_manual
from app.models import MapVersion
from app.routers.graph import _load_scope
from app.schemas import AiChatRequest, AiProposal
from app.settings import settings

router = APIRouter(prefix="/api", tags=["ai"], dependencies=[Depends(get_current_user)])

_NOT_EDITABLE_MSG = "이 버전은 편집할 수 없어 그래프를 적용할 수 없습니다. 도움말만 가능합니다."


async def _ask_and_validate(messages: list[dict]) -> AiProposal:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502."""
    for attempt in range(2):
        try:
            content = await ai_client.call_ai(messages)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            raise HTTPException(status_code=502, detail=f"AI server error: {exc}") from exc
        try:
            return AiProposal.model_validate_json(content)
        except ValueError:
            if attempt == 0:
                messages = [*messages, {"role": "user", "content": "유효한 JSON 한 개만 반환하세요."}]
                continue
            raise HTTPException(status_code=502, detail="AI returned invalid response") from None
    raise HTTPException(status_code=502, detail="AI returned invalid response")


@router.post("/versions/{version_id}/ai/chat", response_model=AiProposal)
async def ai_chat(
    version_id: int,
    payload: AiChatRequest,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiProposal:
    if not settings.ai_enabled:
        raise HTTPException(status_code=503, detail="AI is disabled")
    version = await session.get(MapVersion, version_id)
    if version is None:
        raise HTTPException(status_code=404, detail=f"version {version_id} not found")

    now = datetime.now(timezone.utc)
    can_edit = (
        workflow.is_editable_status(version.status)
        and is_checkout_active(version, now)
        and version.checked_out_by == user
    )
    current = await _load_scope(session, version_id, payload.parent)
    messages = build_messages(
        get_manual(), current, can_edit, payload.instruction, payload.history
    )

    proposal = await _ask_and_validate(messages)
    # 편집 불가인데 그래프를 제안하면 적용 불가 — answer로 다운그레이드 (실제 적용 가드는 saveGraph가 최종 enforce)
    if proposal.kind == "graph" and not can_edit:
        return AiProposal(kind="answer", message=_NOT_EDITABLE_MSG)
    return proposal
```

- [ ] **Step 4: Register router + add `MeOut.ai_enabled`** — in `app/main.py`:
  - Add `ai` to the routers import: `from app.routers import ai, approvers, comments, graph, maps, notifications, versions`.
  - After the other `include_router` calls, add `app.include_router(ai.router)`.
  - Change the `/api/me` endpoint to expose `ai_enabled`. First, in `app/schemas.py`, change `MeOut`:
    ```python
    class MeOut(BaseModel):
        username: str
        ai_enabled: bool
    ```
  - In `app/main.py`, update `get_me` to `return MeOut(username=user, ai_enabled=settings.ai_enabled)` and add `from app.settings import settings` if not already imported.

- [ ] **Step 5: Update the existing `/api/me` test** — in `tests/test_workflow.py`, `test_me_returns_current_user` currently asserts only `username`. It still passes (additive), but add an assertion: `assert me["ai_enabled"] is False`. (Read the test, append the assertion.)

- [ ] **Step 6: Run AI tests + full suite + lint**
- `.venv/bin/python -m pytest tests/test_ai.py -v` → all PASS
- `.venv/bin/python -m pytest tests/ -q` → green
- `.venv/bin/ruff check app/ tests/` → clean

- [ ] **Step 7: Commit**
```bash
git add app/routers/ai.py app/main.py app/schemas.py tests/test_ai.py tests/test_workflow.py
git commit -m "feat(backend): /ai/chat endpoint with guards, validation, retry — AI 채팅 엔드포인트"
```

---

### Task 7: Frontend API client + me.ai_enabled

**Files:** `frontend/src/lib/api.ts`

- [ ] **Step 1: Extend `getMe` return type + add AI types/function** — in `src/lib/api.ts`:
  - Change `getMe` to:
    ```typescript
    export function getMe(): Promise<{ username: string; ai_enabled: boolean }> {
      return request<{ username: string; ai_enabled: boolean }>("/me");
    }
    ```
    (If `getMe` was added in a prior feature returning `{ username }`, replace its signature as above.)
  - Append at the END of the file:
    ```typescript
    // ── 온프레미스 AI 채팅 (design 2026-06-15) ──────────────

    export interface AiNode {
      key: string;
      title: string;
      node_type: string;
      description: string;
    }

    export interface AiEdge {
      source: string;
      target: string;
      label: string;
    }

    export interface AiProposal {
      kind: "graph" | "answer";
      message: string;
      nodes: AiNode[];
      edges: AiEdge[];
    }

    export interface AiChatTurn {
      role: string;
      content: string;
    }

    export function aiChat(
      versionId: number,
      parent: string | null,
      instruction: string,
      history: AiChatTurn[],
    ): Promise<AiProposal> {
      return request<AiProposal>(`/versions/${versionId}/ai/chat`, {
        method: "POST",
        body: JSON.stringify({ parent, instruction, history }),
      });
    }
    ```

- [ ] **Step 2: Verify** — `npm run build` → green; `npm run lint` → clean. (Types only; consumed in Task 8-9.) No manual check.

- [ ] **Step 3: Commit**
```bash
git add src/lib/api.ts
git commit -m "feat(frontend): aiChat API client + me.ai_enabled — AI 클라이언트"
```

---

### Task 8: AI chat panel component

**Files:** `frontend/src/components/ai-chat-panel.tsx` (create), `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: Add i18n keys** — in `src/lib/i18n-messages.ts`, add to `en` AND `ko` (parity enforced):

en:
```typescript
  "ai.title": "AI assistant",
  "ai.toggle": "AI assistant",
  "ai.placeholder": "Describe the flowchart, or ask how to use…",
  "ai.send": "Send",
  "ai.thinking": "Thinking…",
  "ai.readOnly": "Editing is locked — only help answers are available.",
  "ai.error": "AI request failed",
```
ko:
```typescript
  "ai.title": "AI 도우미",
  "ai.toggle": "AI 도우미",
  "ai.placeholder": "순서도를 설명하거나 사용법을 물어보세요…",
  "ai.send": "보내기",
  "ai.thinking": "생각 중…",
  "ai.readOnly": "편집이 잠겨 도움말 답변만 가능합니다.",
  "ai.error": "AI 요청 실패",
```

- [ ] **Step 2: Create `src/components/ai-chat-panel.tsx`**:

```tsx
"use client";

// 에디터 AI 채팅 패널 — 순서도 생성/편집 지시 + 사용법 안내 (design 2026-06-15)
import { Send } from "lucide-react";
import { useState } from "react";

import { aiChat, type AiChatTurn, type AiProposal } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AiChatPanelProps {
  versionId: number;
  parent: string | null;
  canEdit: boolean;
  onGraphProposal: (proposal: AiProposal) => void;
}

export function AiChatPanel({ versionId, parent, canEdit, onGraphProposal }: AiChatPanelProps) {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    const instruction = input.trim();
    if (!instruction || busy) return;
    setInput("");
    setBusy(true);
    const nextMessages: ChatMessage[] = [...messages, { role: "user", content: instruction }];
    setMessages(nextMessages);
    // 최근 6턴만 history로 전송
    const history: AiChatTurn[] = nextMessages.slice(-6).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    try {
      const proposal = await aiChat(versionId, parent, instruction, history);
      setMessages((prev) => [...prev, { role: "assistant", content: proposal.message }]);
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: err instanceof Error ? err.message : t("ai.error") },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex-1 overflow-y-auto p-3">
        {!canEdit && (
          <p className="mb-2 text-fine text-ink-tertiary">{t("ai.readOnly")}</p>
        )}
        <ul className="flex flex-col gap-2">
          {messages.map((message, index) => (
            <li
              key={index}
              className={`max-w-[90%] rounded-md px-2 py-1 text-caption ${
                message.role === "user"
                  ? "self-end bg-accent-tint text-ink"
                  : "self-start bg-surface-alt text-ink"
              }`}
            >
              {message.content}
            </li>
          ))}
          {busy && <li className="self-start text-fine text-ink-tertiary">{t("ai.thinking")}</li>}
        </ul>
      </div>
      <div className="flex items-end gap-1 border-t border-hairline p-2">
        <textarea
          className="min-h-9 flex-1 resize-none rounded-sm border border-hairline px-2 py-1 text-caption"
          rows={2}
          placeholder={t("ai.placeholder")}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="rounded-sm border border-hairline p-2 hover:bg-surface-alt disabled:opacity-40"
          onClick={() => void send()}
          disabled={busy || input.trim().length === 0}
          aria-label={t("ai.send")}
        >
          <Send size={16} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
```

(Verify token classes exist via grep, as in prior tasks. `min-h-9` → if not generated, use `min-h-[36px]`.)

- [ ] **Step 3: Verify** — `npm run build` → green; `npm run lint` → clean (the component is not yet mounted — that's Task 9; build still compiles an unused module). No manual check yet.

- [ ] **Step 4: Commit**
```bash
git add src/components/ai-chat-panel.tsx src/lib/i18n-messages.ts
git commit -m "feat(frontend): AI chat panel component — AI 채팅 패널"
```

---

### Task 9: Editor wiring — toggle, ai_enabled, preview/apply

**Files:** `frontend/src/app/maps/[mapId]/page.tsx`

This task mounts the panel and implements preview-then-apply. Read the file's existing helpers: `currentParentId`, `pushHistory`, `toAppNodes`/`toAppEdges`, `saveCurrentScope`, `scheduleAutoSave`, `setNodes`/`setEdges`, `layoutWithDagre` (imported from `@/lib/canvas`), `readOnly`, `checkout`, `username` (from getMe). The undo function exists (history past/future) — find it (likely `undo`).

- [ ] **Step 1: Add AI state + ai_enabled** — near other `useState` in `MapEditor`:

```tsx
const [aiOpen, setAiOpen] = useState(false);
const [aiEnabled, setAiEnabled] = useState(false);
const [aiPreviewActive, setAiPreviewActive] = useState(false);
const aiPreviewRef = useRef(false);
```

In the existing `getMe()` effect (added in a prior feature), capture ai_enabled: where it does `setUsername(me.username)`, also `setAiEnabled(me.ai_enabled)`. Imports: ensure `aiChat`, `type AiProposal` and `AiChatPanel` are imported (`import { AiChatPanel } from "@/components/ai-chat-panel";`, and `type AiProposal` from `@/lib/api`).

- [ ] **Step 2: Suppress autosave during preview** — in `saveCurrentScope` (the `useCallback`), add at the very top of its body: `if (aiPreviewRef.current) return;`. In `scheduleAutoSave`, add at the top: `if (aiPreviewRef.current) return;`. (These already early-return on `readOnly`; add the preview guard alongside.)

- [ ] **Step 3: Add preview/apply handlers** — add inside `MapEditor`:

```tsx
const applyAiProposal = useCallback(
  (proposal: AiProposal) => {
    const keyToId = new Map<string, string>();
    const gnodes = proposal.nodes.map((node) => {
      const id = crypto.randomUUID();
      keyToId.set(node.key, id);
      return {
        id,
        title: node.title,
        description: node.description,
        node_type: node.node_type,
        color: "",
        assignee: "",
        department: "",
        system: "",
        duration: "",
        pos_x: 0,
        pos_y: 0,
        sort_order: 0,
        group_id: null,
      };
    });
    const gedges = proposal.edges
      .map((edge) => {
        const source = keyToId.get(edge.source);
        const target = keyToId.get(edge.target);
        if (!source || !target) return null;
        return { id: crypto.randomUUID(), source_node_id: source, target_node_id: target, label: edge.label };
      })
      .filter((edge): edge is NonNullable<typeof edge> => edge !== null);

    const graph = { nodes: gnodes, edges: gedges, groups: [] };
    const laidOut = layoutWithDagre(toAppNodes(graph), toAppEdges(graph));

    pushHistory(); // Discard = undo
    aiPreviewRef.current = true;
    setNodes(laidOut);
    setEdges(toAppEdges(graph));
    setAiPreviewActive(true);
  },
  [pushHistory, setNodes, setEdges],
);

const commitAiPreview = useCallback(() => {
  aiPreviewRef.current = false;
  setAiPreviewActive(false);
  void saveCurrentScope();
}, [saveCurrentScope]);

const discardAiPreview = useCallback(() => {
  aiPreviewRef.current = false;
  setAiPreviewActive(false);
  undo(); // 직전 스냅샷 복원 (pushHistory로 저장됨)
}, [undo]);
```

> If the undo callback has a different name, use it. If undo cannot be referenced cleanly here (hooks order), instead snapshot before preview: store `{nodes, edges}` in a ref at apply time and restore them in `discardAiPreview` via `setNodes`/`setEdges`. Pick whichever keeps lint clean.

- [ ] **Step 4: Render toggle + panel + apply bar** — in the editor header toolbar, add an AI toggle button (only when `aiEnabled`):

```tsx
{aiEnabled && (
  <button
    type="button"
    className="rounded-sm border border-hairline px-2 py-1 text-caption hover:bg-surface-alt"
    onClick={() => setAiOpen((open) => !open)}
    title={t("ai.toggle")}
  >
    {t("ai.toggle")}
  </button>
)}
```

Render the panel as a right-side drawer when `aiOpen` (place near the inspector panel render; a fixed-width column):

```tsx
{aiEnabled && aiOpen && versionId !== null && (
  <div className="flex w-80 shrink-0 border-l border-hairline">
    <AiChatPanel
      versionId={versionId}
      parent={currentParentId}
      canEdit={!readOnly && (checkout?.mine ?? false)}
      onGraphProposal={applyAiProposal}
    />
  </div>
)}
```

Render the Apply/Discard bar over the canvas when `aiPreviewActive` (e.g. a top-center floating bar):

```tsx
{aiPreviewActive && (
  <div className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md bg-surface px-3 py-2 shadow-lg">
    <span className="text-caption text-ink">{t("ai.title")}</span>
    <button type="button" className="rounded-sm border border-hairline px-2 py-1 text-caption text-accent" onClick={commitAiPreview}>
      {t("approvers.save")}
    </button>
    <button type="button" className="rounded-sm border border-hairline px-2 py-1 text-caption text-error" onClick={discardAiPreview}>
      {t("approvers.cancel")}
    </button>
  </div>
)}
```

(Reuse existing `approvers.save`/`approvers.cancel` for Apply/Discard labels, or add `ai.apply`/`ai.discard` keys to both locales if you prefer distinct wording — keep i18n parity either way.)

- [ ] **Step 5: Verify**
- `npm run build` → green; `npm run lint` → clean.
- **Manual** (requires a running AI server OR a temporary stub): with `AI_ENABLED=true` and a reachable `AI_BASE_URL`, open the editor on a draft you hold checkout on. Confirm: AI toggle appears; sending "구매 프로세스를 그려줘" returns a graph and previews it on the canvas with an Apply/Discard bar; Apply persists (reload shows it), Discard reverts. Ask "버전 어떻게 승인해?" → an answer appears in chat (no canvas change). On a pending/read-only version, the panel shows the read-only note and graph requests come back as answers. If no AI server is available, report this step as UNVERIFIED and note exactly what was checked (build/lint only).

- [ ] **Step 6: Commit**
```bash
git add "src/app/maps/[mapId]/page.tsx"
git commit -m "feat(frontend): AI panel toggle + preview/apply wiring — AI 패널·미리보기 적용"
```

---

### Task 10: Write the manual prose

**Files:** `backend/app/manual.md`

- [ ] **Step 1: Replace the stub** with a real, concise usage manual covering: creating/opening maps; canvas editing (add/move nodes, drag-connect, drop zones, groups, sub-process drill-down); outline; versions (create/clone/rename/delete, compare); the approval workflow (Draft→Pending→Approved→Published, approver assignment, submit/approve/reject/publish/withdraw, the dashboard); checkout locking; comments; PNG export; and the AI chat (how to phrase draw/edit requests, preview/apply, asking usage questions). Write it in Korean (dynamic/help content), markdown, a few hundred lines max. Keep it accurate to the current features — cross-check `README.md` and `docs/spec.md`.

- [ ] **Step 2: Verify it loads** — `.venv/bin/python -m pytest tests/test_ai.py::test_manual_loads_nonempty -v` → PASS (still nonempty). No behavior change beyond content.

- [ ] **Step 3: Commit**
```bash
git add app/manual.md
git commit -m "docs(manual): write BPM usage manual for AI help — 사용 매뉴얼 작성"
```

---

### Task 11: Sync deploy config + final verification + PROGRESS

**Files:** `Dockerfile`/`docker-compose.yml`/`.env.example`/`README.md` (as needed), `PROGRESS.md`

- [ ] **Step 1: Backend full verification** — `.venv/bin/python -m pytest tests/ -q` green; `.venv/bin/ruff check app/ tests/` clean.
- [ ] **Step 2: Frontend** — `npm run lint` clean; `npm run build` green.
- [ ] **Step 3: Sync** — ensure the new `AI_*` env vars appear in `docker-compose.yml` (`environment:` with `${AI_ENABLED}` etc.), and that the backend image builds `requirements.txt` (now including `httpx2`). Update `README.md` env-var section. Follow `rules/backend/sync-checklist.md`. (No Dockerfile change expected beyond installing prod requirements, which already happens.)
- [ ] **Step 4: Update PROGRESS.md** — dated entry summarizing the AI chat feature (what + why), noting the AI server path is manually integration-verified and the frontend manual smoke status.
- [ ] **Step 5: Commit**
```bash
git add docker-compose.yml .env.example README.md PROGRESS.md
git commit -m "chore: sync AI env/deploy config + record in PROGRESS — AI 배포 설정 동기화"
```

---

## Self-Review (completed during authoring)

**Spec coverage:**
- §3 architecture (endpoint → load scope → prompt → adapter → validate → proposal) → Tasks 4-6. Adapter boundary `ai_client.py` → Task 5.
- §4 output contract (discriminated kind, logical nodes/edges, validation: unique keys, node_type whitelist, orphan-edge reject, 1 reprompt) → Tasks 2 + 6.
- §4 client apply (key→uuid, dagre layout, scope replace) → Task 9.
- §5 chat UX (toggle panel, multi-turn non-persistent history of 6, preview/apply, answer text) → Tasks 8-9.
- §6 permission guards (can_edit = editable status + checkout holder; answer allowed when not editable; graph downgraded; real apply gate is saveGraph) → Task 6 + Task 9 (`canEdit` prop, preview applies through saveCurrentScope which already enforces).
- §7 config (AI_* + AI_ENABLED 503 + httpx2 prod + panel hidden when disabled via me.ai_enabled) → Tasks 1, 6, 7, 9, 11.
- §8 error handling (timeout/5xx→502, invalid→reprompt→502, no token logging) → Tasks 5-6.
- §9 tests (graph/answer/disabled/non-editable/invalid×2/orphan/bad-type/manual/prompt) → Tasks 2, 3, 4, 6.
- §10 manual prose last → Task 10.

**Placeholder scan:** none — every code step has full code; the `manual.md` stub is intentional and finalized in Task 10 (not a placeholder defect).

**Type consistency:** `AiProposal`/`AiNode`/`AiEdge` identical shape in backend (`schemas.py`) and frontend (`api.ts`); `kind` literal `"graph"|"answer"` consistent; `call_ai(messages) -> str` mocked the same way across all Task 6 tests; `MeOut.ai_enabled` added in Task 6 and consumed by `getMe` in Task 7 → `aiEnabled` in Task 9. `_load_scope(session, version_id, parent)` reused from `routers/graph.py`. `build_messages(manual, current_graph, can_edit, instruction, history)` signature identical in Task 4 definition and Task 6 call.

**Open risk flagged in-step:** Task 9 undo-vs-snapshot for Discard, and Task 5 `httpx2` API shape — both have explicit fallback instructions.
