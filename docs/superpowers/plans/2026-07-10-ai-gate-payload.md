# AI 권한 게이트 + 제안 페이로드 저장 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 챗·그래프 조회에 viewer 권한 게이트를 걸고, AI 제안 페이로드를 DB에 저장해 과거 대화 재열람 시 분석/워크스루/graph·ops 카드를 재현한다.

**Architecture:** 백엔드는 기존 `require_version_map_role("viewer")` 의존성을 3개 라우트에 부착(새 권한 로직 없음)하고, `ai_chat_messages`에 `payload` Text 컬럼 1개를 추가해 kind별 서브셋 JSON을 write-through에 동봉한다. 프론트는 메시지 뷰모델에 kind/payload를 보존하고, 분리 임시 state(findings/steps)를 제거해 카드를 메시지 부착형으로 통일한다(새 파일 `ai-chat-cards.tsx`로 추출).

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + React (React Compiler lint 활성) / pytest + vitest + Playwright 스모크

**Spec:** `docs/superpowers/specs/2026-07-10-ai-gate-payload-design.md`

## Global Constraints

- 브랜치: `feat/ai-gate-payload` — 실행 시 superpowers:using-git-worktrees로 워크트리 생성.
- **`frontend/src/app/maps/[mapId]/page.tsx` 등 브래킷 경로는 시스템 grep(ugrep)이 조용히 건너뜀 — 검색은 반드시 `git grep` 또는 Python.**
- React Compiler lint: effect 내 동기 setState 금지(`react-hooks/set-state-in-effect`), `useCallback`/`useMemo` 수동 deps 불일치 금지 — 사소한 핸들러는 plain function으로.
- UI 텍스트는 영어(i18n EN/KO 양쪽 등록), 아이콘은 Lucide 16px/strokeWidth 1.5, raw hex 금지(토큰 클래스만), 주요 신규 구조 요소에 `data-id` 부여.
- 오류 관례: 리소스(맵/버전) 없음=404, 권한 부족=403. private 은닉용 404 위장 금지.
- 각 커밋 직전 `PROGRESS.md`의 `## 2026-07-10 — AI 권한 게이트 + 페이로드 저장 설계 (main)` 섹션에 한 줄 추가(코드와 같은 커밋).
- 커밋 메시지: `type(scope): English summary — 한국어 요약`.
- 테스트 실행: backend는 `backend/`에서 `.venv/bin/python -m pytest`, frontend는 `frontend/`에서 `npx vitest run`.

---

### Task 1: 백엔드 권한 게이트 — AI 챗 + 그래프 조회 GET 2종

**Files:**
- Modify: `backend/app/routers/ai.py` (라우트 데코레이터, ~:138)
- Modify: `backend/app/routers/graph.py` (GET 2종 데코레이터, :77 · :106)
- Test: `backend/tests/test_permission_gates.py` (파일 끝에 추가)

**Interfaces:**
- Consumes: `app.permissions.deps.require_version_map_role(min_role: str)` — version_id 경로 파라미터로 게이트, 버전 없음 404 / 권한 부족 403. `graph.py`는 이미 import 중(:17), `ai.py`는 import 추가 필요.
- Produces: 게이트된 3개 라우트. 이후 태스크가 의존하는 시그니처 변경 없음.

- [ ] **Step 1: 실패하는 게이트 테스트 작성**

`backend/tests/test_permission_gates.py` 파일 끝에 추가 (기존 `enforce`/`act_as`/`seed_map`/`version_of` 픽스처 재사용 — 같은 파일 :31-99에 정의됨):

```python
# ── AI 챗·그래프 조회 viewer 게이트 (design 2026-07-10) ─────────────


def test_ai_chat_private_map_stranger_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="private")
    version_id = version_of(map_id)
    act_as("stranger")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 403


def test_ai_chat_viewer_grant_passes_gate(client: TestClient, enforce: None) -> None:
    # 게이트 통과 증명 — AI 비활성(테스트 기본)이라 핸들러의 503에 도달하면 게이트는 열린 것.
    # 403(게이트 거부)과 503(핸들러 도달)을 구분하므로 AI 목킹이 필요 없다.
    map_id = seed_map(visibility="private", grants=[("user", "viewer.user", "viewer")])
    version_id = version_of(map_id)
    act_as("viewer.user")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 503


def test_ai_chat_public_map_passes_gate(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="public")
    version_id = version_of(map_id)
    act_as("anyone")
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "hi"})
    assert resp.status_code == 503  # 게이트 통과 → AI 비활성 503


def test_graph_get_private_map_stranger_403(client: TestClient, enforce: None) -> None:
    map_id = seed_map(visibility="private")
    version_id = version_of(map_id)
    act_as("stranger")
    assert client.get(f"/api/versions/{version_id}/graph").status_code == 403
    assert client.get(f"/api/versions/{version_id}/graph/all").status_code == 403


def test_graph_get_public_or_granted_200(client: TestClient, enforce: None) -> None:
    public_id = seed_map(visibility="public")
    act_as("anyone")
    assert client.get(f"/api/versions/{version_of(public_id)}/graph").status_code == 200
    granted_id = seed_map(visibility="private", grants=[("user", "viewer.user", "viewer")])
    act_as("viewer.user")
    assert client.get(f"/api/versions/{version_of(granted_id)}/graph").status_code == 200
    assert client.get(f"/api/versions/{version_of(granted_id)}/graph/all").status_code == 200


def test_graph_get_missing_version_404(client: TestClient, enforce: None) -> None:
    act_as(SYSADMIN)
    assert client.get("/api/versions/999999/graph").status_code == 404
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_permission_gates.py -q -k "ai_chat or graph_get"`
Expected: FAIL — 403 기대 자리에서 503(ai/chat, 게이트 없음) 또는 200(graph GET) 반환.

- [ ] **Step 3: 게이트 부착**

`backend/app/routers/ai.py` — import 추가(기존 import 블록의 `from app.checkout import ...` 아래):

```python
from app.permissions.deps import require_version_map_role
```

라우트 데코레이터 교체 (`@router.post("/versions/{version_id}/ai/chat", response_model=AiProposal)` → ):

```python
@router.post(
    "/versions/{version_id}/ai/chat",
    response_model=AiProposal,
    # viewer 게이트 — 무권한자는 그래프가 프롬프트에 실리기 전에 403 (design 2026-07-10)
    dependencies=[Depends(require_version_map_role("viewer"))],
)
```

`backend/app/routers/graph.py` — GET 2종 데코레이터 교체 (`require_version_map_role`은 이미 import됨):

```python
@router.get(
    "/{version_id}/graph/all",
    response_model=VersionGraphOut,
    # 읽기 viewer 게이트 — AI 챗 게이트와 짝(우회로 차단) (design 2026-07-10)
    dependencies=[Depends(require_version_map_role("viewer"))],
)
```

```python
@router.get(
    "/{version_id}/graph",
    response_model=GraphOut,
    dependencies=[Depends(require_version_map_role("viewer"))],
)
```

핸들러 본문(`_get_version_or_404` 호출 포함)은 수정하지 않는다 — 게이트 의존성이 enforce 여부와 무관하게 항상 먼저 실행되어 버전 없음 404를 보장하지만, 핸들러는 version 객체 자체가 필요하므로 fetch는 유지한다(중복 404 체크는 무해).

- [ ] **Step 4: 테스트 통과 확인 (신규 + 기존 전체)**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`
Expected: PASS 전체 — 기본 스위트는 enforce OFF(전원 sysadmin)라 기존 테스트(test_ai.py·test_ai_chat_history.py의 ai/chat 호출, graph GET 사용처)에 회귀 없음. 실패 시 게이트가 기본 환경에서 닫혀 있다는 뜻이므로 `conftest.py`의 `DEV_ENFORCE_PERMISSIONS=false` 베이스라인 확인.

- [ ] **Step 5: ruff + 커밋**

```bash
cd backend && .venv/bin/ruff check app/ tests/
cd .. && git add backend/app/routers/ai.py backend/app/routers/graph.py backend/tests/test_permission_gates.py PROGRESS.md
git commit -m "feat(perm): viewer gate on AI chat + graph reads — AI 챗·그래프 조회 viewer 게이트"
```

(PROGRESS.md에 한 줄: `- 게이트 1/2: ai/chat·graph GET 2종에 require_version_map_role("viewer") 부착 + 게이트 테스트 6종.`)

---

### Task 2: 백엔드 페이로드 저장 — 컬럼 + 직렬화 + API 노출

**Files:**
- Modify: `backend/app/models.py` (AiChatMessage, :51-65)
- Modify: `backend/app/db.py` (_ADDED_COLUMNS, :16-53)
- Modify: `backend/app/chat_history.py` (직렬화/파싱 헬퍼 추가)
- Modify: `backend/app/routers/ai.py` (write-through, ~:204)
- Modify: `backend/app/schemas.py` (AiChatMessageOut, :871)
- Modify: `backend/app/routers/ai_sessions.py` (메시지 조회, :84-97)
- Test: `backend/tests/test_ai_chat_history.py`

**Interfaces:**
- Consumes: `AiProposal`(schemas, kind/findings/steps/nodes/edges/groups/ops 필드), 기존 write-through 블록(`ai.py:196-212`), `_fake_ai`/`_enable_ai`/`_draft_version_checked_out`(tests/test_ai.py).
- Produces: `chat_history.serialize_proposal_payload(proposal: AiProposal) -> str | None`, `chat_history.parse_proposal_payload(raw: str | None) -> dict | None`, `AiChatMessage.payload: str | None`(ORM), `AiChatMessageOut.payload: dict | None`(API). Task 3의 프론트 타입이 이 API 형태를 미러링.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_chat_history.py` 파일 끝에 추가:

```python
# ── 제안 페이로드 저장 — 카드 히스토리 재현 (design 2026-07-10) ─────────────


def test_parse_proposal_payload_degrades_corrupt_to_none() -> None:
    from app.chat_history import parse_proposal_payload

    assert parse_proposal_payload(None) is None
    assert parse_proposal_payload("") is None
    assert parse_proposal_payload("not json{") is None
    assert parse_proposal_payload("[1, 2]") is None  # dict 아님 — 강등
    assert parse_proposal_payload('{"findings": []}') == {"findings": []}


def test_chat_stores_payload_for_analysis(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    finding = {
        "severity": "high",
        "category": "orphan",
        "node_ids": [],
        "message": "고아 노드",
        "suggestion": "연결하세요",
    }
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(json.dumps({"kind": "analysis", "message": "분석", "findings": [finding]})),
    )
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "분석해줘"})
    assert resp.status_code == 200
    session_id = resp.json()["session_id"]

    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    assert msgs[0]["payload"] is None  # user 메시지는 항상 NULL
    assistant = msgs[1]
    assert assistant["kind"] == "analysis"
    assert assistant["payload"]["findings"][0]["category"] == "orphan"
    assert assistant["payload"]["findings"][0]["severity"] == "high"


def test_chat_answer_payload_is_null(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "도움말"}))
    )
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "어떻게 써?"})
    session_id = resp.json()["session_id"]
    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    assert all(m["payload"] is None for m in msgs)


def test_chat_stores_payload_for_graph(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
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
    version_id = _draft_version_checked_out(client)
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "그려줘"})
    session_id = resp.json()["session_id"]
    msgs = client.get(f"/api/ai/chat-sessions/{session_id}/messages").json()["messages"]
    payload = msgs[1]["payload"]
    assert [n["key"] for n in payload["nodes"]] == ["a", "b"]
    assert payload["edges"][0]["source"] == "a"
    assert payload["groups"] == []
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_chat_history.py -q`
Expected: FAIL — `parse_proposal_payload` ImportError, 응답에 `payload` 키 부재(KeyError).

- [ ] **Step 3: 구현**

**(a)** `backend/app/models.py` — `AiChatMessage`의 `kind` 필드 아래에 추가, docstring 갱신:

```python
class AiChatMessage(Base):
    """AI 챗 메시지 — user 질문/assistant 답변 + 제안 페이로드(kind별 서브셋 JSON)."""
```

```python
    kind: Mapped[str | None] = mapped_column(String(20), default=None)  # assistant만
    # 제안 원자료(kind별 서브셋 JSON 문자열) — 히스토리 재열람 시 카드 재현. user/answer는 NULL
    payload: Mapped[str | None] = mapped_column(Text, default=None)
```

**(b)** `backend/app/db.py` — `_ADDED_COLUMNS` 리스트 끝에 추가:

```python
    # AI 제안 페이로드 — 카드 히스토리 재현 (design 2026-07-10)
    ("ai_chat_messages", "payload", "TEXT"),
```

**(c)** `backend/app/chat_history.py` — 파일 상단 import에 `json`·`AiProposal` 추가, 헬퍼 2개 추가:

```python
import json
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import AiChatMessage, AiChatSession
from app.schemas import AiProposal
```

```python
# kind → 저장 서브셋 필드 — 프론트 toPayload(chat-sessions.ts)와 같은 규칙 유지
_PAYLOAD_FIELDS: dict[str, tuple[str, ...]] = {
    "analysis": ("findings",),
    "walkthrough": ("steps",),
    "graph": ("nodes", "edges", "groups"),
    "ops": ("ops",),
}


def serialize_proposal_payload(proposal: AiProposal) -> str | None:
    """카드 재현용 kind별 서브셋 직렬화 — answer/빈 제안은 None."""
    fields = _PAYLOAD_FIELDS.get(proposal.kind)
    if fields is None:
        return None
    data = {
        field: [item.model_dump(mode="json") for item in getattr(proposal, field)]
        for field in fields
    }
    if not any(data.values()):
        return None
    return json.dumps(data, ensure_ascii=False)


def parse_proposal_payload(raw: str | None) -> dict | None:
    """저장 payload 디코드 — 오염 행은 None 강등(대화 조회가 죽지 않게)."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None
```

**(d)** `backend/app/routers/ai.py` — import 블록의 chat_history 항목에 `serialize_proposal_payload` 추가:

```python
from app.chat_history import (
    derive_chat_title,
    prune_chat_session_messages,
    prune_map_chat_sessions,
    serialize_proposal_payload,
)
```

assistant 메시지 저장에 payload 동봉 (`ai.py:204-212`의 `session.add(AiChatMessage(...role="assistant"...))` 블록 교체):

```python
    session.add(
        AiChatMessage(
            session_id=chat_session.id,
            role="assistant",
            content=proposal.message,
            kind=proposal.kind,
            payload=serialize_proposal_payload(proposal),
            version_id=version_id,
        )
    )
```

(다운그레이드된 answer proposal은 자연히 NULL — `serialize_proposal_payload`가 kind로 판정하므로 별도 분기 불요.)

**(e)** `backend/app/schemas.py` — `AiChatMessageOut`(:871)에 필드 추가:

```python
class AiChatMessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: Literal["user", "assistant"]
    content: str
    kind: str | None = None
    # 제안 원자료(kind별 서브셋) — 오염 행은 None (parse_proposal_payload 강등)
    payload: dict | None = None
    version_id: int | None = None
    created_at: datetime
```

**(f)** `backend/app/routers/ai_sessions.py` — import 추가 및 조회 구성에 payload 추가:

```python
from app.chat_history import parse_proposal_payload, prune_expired_chat_sessions
```

`list_chat_messages`의 `AiChatMessageOut(...)` 구성(:86-94)에 한 줄:

```python
            AiChatMessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                kind=m.kind,
                payload=parse_proposal_payload(m.payload),
                version_id=m.version_id,
                created_at=m.created_at,
            )
```

- [ ] **Step 4: 테스트 통과 확인 + 전체 스위트**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q`
Expected: PASS 전체. (`test_ai_chat_history.py`의 기존 admin-table 검증은 raw 문자열 payload를 못 보므로 영향 없음 — 신규 컬럼은 rows에 추가 키로만 등장.)

- [ ] **Step 5: ruff + 커밋**

```bash
cd backend && .venv/bin/ruff check app/ tests/
cd .. && git add backend/app/models.py backend/app/db.py backend/app/chat_history.py backend/app/routers/ai.py backend/app/routers/ai_sessions.py backend/app/schemas.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai-chat): persist proposal payload per message — 제안 페이로드 메시지 단위 저장"
```

(PROGRESS.md 한 줄: `- 페이로드 1/2: ai_chat_messages.payload TEXT(+_ADDED_COLUMNS)·kind별 서브셋 직렬화·조회 시 오염 NULL 강등.`)

---

### Task 3: 프론트 뷰모델 — kind·payload 보존 + toPayload

**Files:**
- Modify: `frontend/src/lib/api.ts` (:1460 AiChatMessageRow 주변)
- Modify: `frontend/src/lib/chat-sessions.ts` (전체 27줄 — 아래 코드로 확장)
- Test: `frontend/src/lib/chat-sessions.test.ts`

**Interfaces:**
- Consumes: Task 2의 API 응답 형태(`payload: dict | null`), 기존 `AiFinding`/`AiStep`/`AiNode`/`AiEdge`/`AiGroup`/`AiOp`/`AiProposal` 타입(api.ts :1349-1429).
- Produces: `AiMessagePayload` 인터페이스(api.ts), `ChatMessage.kind: string | null`·`ChatMessage.payload: AiMessagePayload | null`, `createLocalMessage(role, content, kind?, payload?)`, `toPayload(proposal: AiProposal): AiMessagePayload | null`. Task 4의 패널이 이 시그니처를 사용.

- [ ] **Step 1: 실패하는 vitest 작성**

`frontend/src/lib/chat-sessions.test.ts`에 추가 (기존 테스트의 import 블록에 `toPayload` 추가):

```ts
describe("kind/payload preservation (2026-07-10)", () => {
  it("toChatMessage preserves kind and payload", () => {
    const row = {
      id: 5,
      role: "assistant" as const,
      content: "분석",
      kind: "analysis",
      payload: { findings: [{ severity: "high", category: "orphan", node_ids: [], message: "m", suggestion: "s" }] },
      version_id: 1,
      created_at: "2026-07-10T09:00:00+09:00",
    };
    const message = toChatMessage(row);
    expect(message.kind).toBe("analysis");
    expect(message.payload?.findings?.[0]?.category).toBe("orphan");
  });

  it("createLocalMessage defaults kind/payload to null", () => {
    const message = createLocalMessage("user", "hi");
    expect(message.kind).toBeNull();
    expect(message.payload).toBeNull();
  });

  it("toPayload maps kind-specific subsets and returns null for answer/empty", () => {
    const base = { message: "", nodes: [], edges: [], groups: [], ops: [], steps: [], findings: [] };
    const finding = { severity: "low" as const, category: "naming", node_ids: [], message: "m", suggestion: "" };
    expect(toPayload({ ...base, kind: "analysis", findings: [finding] })).toEqual({ findings: [finding] });
    expect(toPayload({ ...base, kind: "analysis" })).toBeNull(); // 빈 findings
    expect(toPayload({ ...base, kind: "answer" })).toBeNull();
    const node = { key: "a", title: "A", node_type: "start", description: "", attributes: null, group_key: null };
    expect(toPayload({ ...base, kind: "graph", nodes: [node] })).toEqual({ nodes: [node], edges: [], groups: [] });
    const op = { action: "remove" as const, node_id: "n1", node: null, source: null, target: null, label: null, title: null, attributes: null, description: null };
    expect(toPayload({ ...base, kind: "ops", ops: [op] })).toEqual({ ops: [op] });
  });
});
```

기존 테스트 중 `toChatMessage`/`createLocalMessage` 반환 객체를 `toEqual`로 전량 비교하는 케이스가 있으면 기대값에 `kind: null, payload: null`(row의 kind는 해당 값)을 추가해 보정한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd frontend && npx vitest run src/lib/chat-sessions.test.ts`
Expected: FAIL — `toPayload` export 부재, `kind`/`payload` undefined.

- [ ] **Step 3: 구현**

**(a)** `frontend/src/lib/api.ts` — `AiChatMessageRow`(:1460) 위에 인터페이스 추가, Row에 필드 추가:

```ts
// 카드 재현용 제안 원자료 — kind별 서브셋(백엔드 serialize_proposal_payload 미러)
export interface AiMessagePayload {
  findings?: AiFinding[];
  steps?: AiStep[];
  nodes?: AiNode[];
  edges?: AiEdge[];
  groups?: AiGroup[];
  ops?: AiOp[];
}

export interface AiChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  kind: string | null;
  payload: AiMessagePayload | null;
  version_id: number | null;
  created_at: string;
}
```

**(b)** `frontend/src/lib/chat-sessions.ts` — 전체를 다음으로 교체:

```ts
// AI 챗 서버 저장 히스토리 — 메시지 뷰모델 변환·낙관 표시용 로컬 메시지. 서버가 원장(localStorage 폐기).
import type { AiChatMessageRow, AiMessagePayload, AiProposal } from "@/lib/api";

export interface ChatMessage {
  id: number; // 서버 메시지 id — 낙관(미저장 표시) 메시지는 음수 임시 id
  role: "user" | "assistant";
  content: string;
  at: number | null; // epoch ms — 렌더에서 KST 포맷
  kind: string | null; // assistant만 — 메시지 부착 카드 판별
  payload: AiMessagePayload | null; // 카드 재현 원자료 — 없으면 텍스트만
}

let localSeq = 0;

// 낙관 표시용 로컬 메시지 — Date.now()는 컴포넌트 밖 팩토리에서만(react-hooks/purity)
export function createLocalMessage(
  role: ChatMessage["role"],
  content: string,
  kind: string | null = null,
  payload: AiMessagePayload | null = null,
): ChatMessage {
  localSeq -= 1;
  return { id: localSeq, role, content, at: Date.now(), kind, payload };
}

export function toChatMessage(row: AiChatMessageRow): ChatMessage {
  const at = Date.parse(row.created_at);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    at: Number.isNaN(at) ? null : at,
    kind: row.kind,
    payload: row.payload,
  };
}

// 라이브 제안 → 메시지 payload — 백엔드 저장 서브셋(_PAYLOAD_FIELDS)과 같은 규칙
export function toPayload(proposal: AiProposal): AiMessagePayload | null {
  switch (proposal.kind) {
    case "analysis":
      return proposal.findings.length > 0 ? { findings: proposal.findings } : null;
    case "walkthrough":
      return proposal.steps.length > 0 ? { steps: proposal.steps } : null;
    case "graph":
      return proposal.nodes.length > 0 || proposal.groups.length > 0
        ? { nodes: proposal.nodes, edges: proposal.edges, groups: proposal.groups }
        : null;
    case "ops":
      return proposal.ops.length > 0 ? { ops: proposal.ops } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd frontend && npx vitest run src/lib/chat-sessions.test.ts`
Expected: PASS 전체 (기존 케이스 포함).

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/chat-sessions.ts frontend/src/lib/chat-sessions.test.ts PROGRESS.md
git commit -m "feat(ai-chat): preserve kind/payload in chat viewmodel — 뷰모델 kind·payload 보존 + toPayload"
```

(PROGRESS.md 한 줄: `- 페이로드 2/2 준비: 프론트 뷰모델 kind/payload 보존·toPayload(vitest).`)

---

### Task 4: 프론트 카드 렌더 통일 — 메시지 부착형 + 카드 컴포넌트 추출

**Files:**
- Create: `frontend/src/components/ai-chat-cards.tsx`
- Modify: `frontend/src/components/ai-chat-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (EN ~:583 아래, KO ~:1845 아래)

**Interfaces:**
- Consumes: Task 3의 `ChatMessage.kind/payload`, `toPayload`, `createLocalMessage(role, content, kind, payload)`, 기존 패널 props(`onHighlightNode`, `aiPreviewActive`, `onCommitPreview`, `onDiscardPreview`).
- Produces: `AnalysisCard({ findings, onHighlightNode })`, `WalkthroughCard({ steps, live, onHighlightNode })`, `ProposalSummaryCard({ kind, payload, preview? })` — 패널 전용. 패널 props 계약(page.tsx 마운트 :7272)은 **무변경**.

- [ ] **Step 1: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts` — EN 섹션 `"ai.previewHint"`(:583) 아래에:

```ts
  "ai.proposalGraphTitle": "Flow proposal",
  "ai.proposalOpsTitle": "Edit proposal",
  "ai.proposalCountsGraph": "{nodes} nodes · {edges} edges · {groups} groups",
  "ai.proposalCountsOps": "{n} operations",
  "ai.proposalMore": "+{n} more",
  "ai.proposalReadOnly": "Recorded proposal — for reference.",
```

KO 섹션 `"ai.previewHint"`(:1845) 아래에:

```ts
  "ai.proposalGraphTitle": "순서도 제안",
  "ai.proposalOpsTitle": "편집 제안",
  "ai.proposalCountsGraph": "노드 {nodes} · 엣지 {edges} · 그룹 {groups}",
  "ai.proposalCountsOps": "오퍼레이션 {n}개",
  "ai.proposalMore": "+{n}개 더",
  "ai.proposalReadOnly": "기록된 제안 — 참고용 표시입니다.",
```

- [ ] **Step 2: 카드 컴포넌트 파일 생성**

`frontend/src/components/ai-chat-cards.tsx` 생성 — findings 카드(panel :695-768)와 스텝퍼(:770-838) JSX를 이식하되, 최상위 `max-w-[80%]`는 제거(메시지 컬럼이 이미 폭 제한)하고 `mt-2`로 통일:

```tsx
"use client";

// AI 챗 메시지 부착 카드 — 분석 findings·워크스루 스텝퍼·graph/ops 요약(+라이브 미리보기 커밋) (design 2026-07-10)
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Info,
  Lightbulb,
  Pause,
  Play,
  Route,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { AiFinding, AiMessagePayload, AiStep } from "@/lib/api";
import { useI18n } from "@/lib/i18n";

// 분석 findings — 심각도 레일·클릭 시 노드 하이라이트. 히스토리에서도 동작(사라진 노드는 부모가 no-op).
export function AnalysisCard({
  findings,
  onHighlightNode,
}: {
  findings: AiFinding[];
  onHighlightNode: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div data-id="ai-analysis-card" className="mt-2 flex flex-col gap-2">
      <span className="flex items-center gap-1.5 px-0.5 text-caption-strong text-ink">
        <Search size={14} strokeWidth={1.6} className="text-accent" />
        {t("ai.analysisTitle")}
        <span className="rounded-full bg-surface-alt px-1.5 text-fine text-ink-tertiary">
          {findings.length}
        </span>
      </span>
      {findings.map((finding, index) => {
        const sev = finding.severity;
        // 심각도별 좌측 레일·아이콘 톤 — high=경고 빨강, medium=액센트, low=중성
        const rail =
          sev === "high" ? "border-l-error" : sev === "medium" ? "border-l-accent" : "border-l-divider";
        const iconTone =
          sev === "high"
            ? "bg-error/10 text-error"
            : sev === "medium"
              ? "bg-accent-tint text-accent"
              : "bg-surface-alt text-ink-tertiary";
        return (
          <button
            key={`finding-${index}`}
            type="button"
            className={`group flex w-full gap-2.5 rounded-[3px] border border-l-[3px] border-hairline ${rail} bg-surface p-2.5 text-left shadow-sm hover:bg-surface-alt disabled:opacity-60`}
            onClick={() => onHighlightNode(finding.node_ids[0])}
            disabled={finding.node_ids.length === 0}
          >
            <span className={`mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
              {sev === "high" ? (
                <AlertTriangle size={14} strokeWidth={1.7} />
              ) : (
                <Info size={14} strokeWidth={1.7} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-caption-strong text-ink">{finding.category}</span>
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase ${
                    sev === "high" ? "bg-error/10 text-error" : "bg-surface-alt text-ink-tertiary"
                  }`}
                >
                  {finding.severity}
                </span>
              </span>
              <span className="mt-1 block text-fine leading-relaxed text-ink">{finding.message}</span>
              {finding.suggestion && (
                <span className="mt-1.5 flex items-start gap-1.5 rounded-xs bg-accent-tint px-2 py-1 text-fine text-accent">
                  <Lightbulb size={13} strokeWidth={1.6} className="mt-px shrink-0" />
                  <span>{finding.suggestion}</span>
                </span>
              )}
            </span>
            {finding.node_ids.length > 0 && (
              <ArrowUpRight
                size={14}
                strokeWidth={1.5}
                className="mt-px shrink-0 text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// 워크스루 스텝퍼 — live(이번 세션 응답)에서만 자동재생 허용, 히스토리는 수동 이전/다음만.
export function WalkthroughCard({
  steps,
  live,
  onHighlightNode,
}: {
  steps: AiStep[];
  live: boolean;
  onHighlightNode: (nodeId: string) => void;
}) {
  const { t } = useI18n();
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);

  // 사용자 조작으로만 하이라이트 — 마운트(창 열림·히스토리 로딩) 시 캔버스가 움직이지 않게
  const goTo = (index: number) => {
    const next = Math.min(steps.length - 1, Math.max(0, index));
    setStepIndex(next);
    if (steps[next]) onHighlightNode(steps[next].node_id);
  };

  // 자동재생 — 2.5초 간격. 정지 판정은 타이머 콜백 안(async)에서: effect 내 동기 setState 금지 회피
  useEffect(() => {
    if (!autoplay || steps.length === 0) return;
    const timer = setTimeout(() => {
      const next = Math.min(steps.length - 1, stepIndex + 1);
      setStepIndex(next);
      if (steps[next]) onHighlightNode(steps[next].node_id);
      if (next >= steps.length - 1) setAutoplay(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, [autoplay, stepIndex, steps, onHighlightNode]);

  return (
    <div
      data-id="ai-walkthrough-card"
      className="mt-2 overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-caption-strong text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
            <Route size={13} strokeWidth={1.7} />
          </span>
          {t("ai.walkthrough")}
        </span>
        <div className="flex items-center gap-0.5">
          <span className="mr-1.5 flex items-center gap-1">
            {steps.map((step, i) => (
              <span
                key={step.order}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === stepIndex
                    ? "bg-accent"
                    : i < stepIndex
                      ? "bg-accent/40"
                      : "border border-hairline bg-surface-pearl"
                }`}
              />
            ))}
          </span>
          <span className="mr-1 text-fine tabular-nums text-ink-tertiary">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            type="button"
            aria-label={t("ai.prevStep")}
            className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
            onClick={() => goTo(stepIndex - 1)}
            disabled={stepIndex === 0}
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label={t("ai.nextStep")}
            className="rounded-sm p-1 hover:bg-surface-pearl disabled:opacity-40"
            onClick={() => goTo(stepIndex + 1)}
            disabled={stepIndex === steps.length - 1}
          >
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
          {live && (
            <button
              type="button"
              aria-label={t("ai.autoplay")}
              className={`rounded-sm p-1 hover:bg-surface-pearl ${autoplay ? "text-accent" : ""}`}
              onClick={() => setAutoplay((value) => !value)}
            >
              {autoplay ? <Pause size={16} strokeWidth={1.5} /> : <Play size={16} strokeWidth={1.5} />}
            </button>
          )}
        </div>
      </div>
      <div className="flex items-start gap-2 px-2.5 py-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-on-accent">
          {stepIndex + 1}
        </span>
        <p className="text-caption leading-relaxed text-ink">{steps[stepIndex]?.narration}</p>
      </div>
    </div>
  );
}

const SUMMARY_ITEM_CAP = 8; // 요약 카드 항목 나열 상한 — 넘치면 "+N more"

// graph/ops 요약 — 히스토리는 읽기전용, 라이브 최신 제안은 preview로 커밋/취소 버튼 동봉.
export function ProposalSummaryCard({
  kind,
  payload,
  preview,
}: {
  kind: "graph" | "ops";
  payload: AiMessagePayload;
  preview?: { onCommit?: () => void; onDiscard?: () => void };
}) {
  const { t } = useI18n();
  const items =
    kind === "graph"
      ? (payload.nodes ?? []).map((node) => `${node.node_type} · ${node.title}`)
      : (payload.ops ?? []).map((op) => {
          const target =
            op.node?.title ?? op.title ?? op.node_id ?? [op.source, op.target].filter(Boolean).join(" → ");
          return `${op.action} · ${target}`;
        });
  const shown = items.slice(0, SUMMARY_ITEM_CAP);
  const rest = items.length - shown.length;
  const counts =
    kind === "graph"
      ? t("ai.proposalCountsGraph", {
          nodes: (payload.nodes ?? []).length,
          edges: (payload.edges ?? []).length,
          groups: (payload.groups ?? []).length,
        })
      : t("ai.proposalCountsOps", { n: (payload.ops ?? []).length });
  return (
    <div
      data-id="ai-proposal-card"
      className="mt-2 overflow-hidden rounded-sm border border-hairline bg-surface shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-hairline bg-surface-alt px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-caption-strong text-ink">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent-tint text-accent">
            <Sparkles size={13} strokeWidth={1.7} />
          </span>
          {t(kind === "graph" ? "ai.proposalGraphTitle" : "ai.proposalOpsTitle")}
        </span>
        <span className="text-fine tabular-nums text-ink-tertiary">{counts}</span>
      </div>
      <ul className="flex flex-col gap-0.5 px-2.5 py-2">
        {shown.map((item, index) => (
          <li key={index} className="truncate text-fine text-ink-secondary">
            {item}
          </li>
        ))}
        {rest > 0 && <li className="text-fine text-ink-tertiary">{t("ai.proposalMore", { n: rest })}</li>}
      </ul>
      {preview ? (
        <div className="border-t border-accent-tint-border bg-accent-tint p-2.5">
          <p className="text-fine leading-relaxed text-ink">{t("ai.previewHint")}</p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={preview.onCommit}
              className="flex flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus"
            >
              <Check size={14} strokeWidth={1.8} />
              {t("ai.previewAdd")}
            </button>
            <button
              type="button"
              onClick={preview.onDiscard}
              className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            >
              {t("approvers.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-hairline px-2.5 py-1.5 text-fine text-ink-tertiary">
          {t("ai.proposalReadOnly")}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 패널 리팩터**

`frontend/src/components/ai-chat-panel.tsx` 수정 사항 (전부 이 파일 안):

**(a) import 정리** — lucide import에서 카드 전용 아이콘 제거: `AlertTriangle`, `ArrowUpRight`, `ChevronLeft`, `ChevronRight`, `Info`, `Pause`, `Play`, `Route`, `Search`는 카드 파일로 이동. 단 `Route`·`Search`·`FileText`·`Lightbulb`는 QUICK_CHIPS·팁 렌더에서 계속 사용하므로 **유지**(제거 대상: `AlertTriangle`, `ArrowUpRight`, `ChevronLeft`, `ChevronRight`, `Info`, `Pause`, `Play`만). 추가:

```ts
import { AnalysisCard, ProposalSummaryCard, WalkthroughCard } from "@/components/ai-chat-cards";
import { createLocalMessage, toChatMessage, toPayload, type ChatMessage } from "@/lib/chat-sessions";
```

api import에서 `AiFinding`·`AiStep` 타입 import 제거(패널에서 더 이상 직접 사용 안 함 — 카드 파일이 소유).

**(b) 분리 state 제거** — 다음 4줄(:140-143) 삭제:

```ts
  const [findings, setFindings] = useState<AiFinding[]>([]);
  const [steps, setSteps] = useState<AiStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
```

**(c) 관련 effect 2개 삭제** — 워크스루 포커스 effect(:344-357, `focusKeyRef` 선언 포함)와 자동재생 effect(:359-369) 전체 삭제(카드 컴포넌트로 이동됨).

**(d) resetTransient 축소** — findings/steps 리셋이 사라지므로:

```ts
  const resetTransient = () => {
    setLoadingOlder(false);
  };
```

**(e) send() 응답 처리 교체** — `:390-396`의 블록을:

```ts
      if (activeSessionIdRef.current === targetSessionId) {
        setMessages((prev) => [
          ...prev,
          createLocalMessage("assistant", content, proposal.kind, toPayload(proposal)),
        ]);
      }
```

**(f) 파생값 추가** — `const isForeign = ...`(:157) 아래에:

```ts
  // 라이브 미리보기 카드 부착 대상 — 이번 세션(음수 id)의 마지막 graph/ops 제안 메시지
  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant") ?? null;
  const previewAttached =
    latestAssistant !== null &&
    latestAssistant.id < 0 &&
    latestAssistant.payload !== null &&
    (latestAssistant.kind === "graph" || latestAssistant.kind === "ops");
```

**(g) assistant 메시지 렌더에 카드 부착** — assistant `<li>`(:667-684)의 `<MarkdownView .../>`와 타임스탬프 사이에 삽입:

```tsx
                  {message.kind === "analysis" && message.payload?.findings?.length ? (
                    <AnalysisCard findings={message.payload.findings} onHighlightNode={onHighlightNode} />
                  ) : null}
                  {message.kind === "walkthrough" && message.payload?.steps?.length ? (
                    <WalkthroughCard
                      steps={message.payload.steps}
                      live={message.id < 0}
                      onHighlightNode={onHighlightNode}
                    />
                  ) : null}
                  {(message.kind === "graph" || message.kind === "ops") && message.payload ? (
                    <ProposalSummaryCard
                      kind={message.kind}
                      payload={message.payload}
                      preview={
                        aiPreviewActive && previewAttached && message.id === latestAssistant?.id
                          ? { onCommit: onCommitPreview, onDiscard: onDiscardPreview }
                          : undefined
                      }
                    />
                  ) : null}
```

**(h) 스레드 밖 카드 블록 제거·폴백 유지** — findings 블록(:695-769)과 steps 블록(:770-839) **삭제**. `aiPreviewActive` 독립 카드(:840-870)는 payload 없는 예외 상황(제안 빈 배열 등) 폴백으로만 유지 — 조건을 다음으로 교체:

```tsx
        {/* 미리보기 폴백 — 부착 대상 메시지가 없을 때만(빈 payload 등 예외 경로) */}
        {aiPreviewActive && !previewAttached && (
```

(블록 내부 JSX는 그대로.)

- [ ] **Step 4: 검증 — vitest + lint + 수동 구동**

```bash
cd frontend && npx vitest run && npm run lint
```

Expected: PASS / 0 errors. lint에서 `react-hooks/preserve-manual-memoization`·`set-state-in-effect` 신규 에러가 나오면 해당 핸들러를 plain function으로 조정.

수동 확인(백엔드 AI 비활성이어도 가능): `npm run dev` + backend 기동 후 에디터에서 AI 패널 열기 → 기존 대화 히스토리 로딩 정상, 과거 analysis/walkthrough 대화가 있으면 카드 재현 확인. (payload NULL인 구 메시지는 텍스트만 — 기대 동작.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ai-chat-cards.tsx frontend/src/components/ai-chat-panel.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(ai-chat): message-attached cards restore from history — 메시지 부착 카드·히스토리 재현(읽기전용 graph/ops 요약)"
```

(PROGRESS.md 한 줄: `- 카드 통일: 분리 state 제거→메시지 부착(ai-chat-cards.tsx), graph/ops 읽기전용 요약+라이브 커밋 카드 부착, 히스토리 워크스루 자동재생 없음.`)

---

### Task 5: 게이트 프론트 영향 점검 + highlightNode 가드

**Files:**
- Investigate: `frontend/src/lib/api.ts`, `frontend/src/app/maps/[mapId]/page.tsx`, `frontend/src/app/maps/[mapId]/compare/*`
- Modify(조건부): `frontend/src/app/maps/[mapId]/page.tsx` (highlightNode)

**Interfaces:**
- Consumes: Task 1의 게이트(그래프 GET 403 가능성), Task 4의 카드(사라진 노드 하이라이트 호출).
- Produces: 검증 결과 기록(PROGRESS.md) + 필요 시 highlightNode 가드.

- [ ] **Step 1: 그래프 GET 호출처 전수 조사**

```bash
git grep -n "graph/all\|}/graph\`" frontend/src/lib/api.ts
git grep -n -E "getGraph|getFullGraph|fetchGraph" frontend/src
```

각 호출처에 대해 확인: 그 화면에 도달하려면 이미 viewer 가시성이 필요한가? (에디터·비교 화면은 게이트된 `GET /maps/{id}` 통과 후 진입 — 403 모달 선차단. 서브프로세스 임베드는 library 라우터 자체 마스킹.) 새로 403이 노출되는 경로가 있으면 그 화면의 에러 처리(빈 화면/크래시 여부)를 확인하고 발견 사항을 PROGRESS.md에 기록. 크래시 경로가 발견되면 사용자에게 보고 후 처리 방향 결정(무단 수정 금지 — 스코프 확장).

- [ ] **Step 2: highlightNode 사라진 노드 가드 확인**

`git grep -n "highlightNode" "frontend/src/app/maps/[mapId]/page.tsx"` 로 정의를 찾아 Read. 존재하지 않는 nodeId 인자에 대해 조기 return하는지 확인. 가드가 없고 예외/오동작(setCenter(NaN) 등) 가능성이 있으면 정의 첫 줄에 추가:

```ts
    if (!nodesRef.current.some((node) => node.id === nodeId)) return; // 히스토리 카드의 사라진 노드 — no-op
```

(실제 노드 컬렉션 참조 이름은 정의부에서 확인해 맞춘다 — `nodes` state 직접 참조 시 useCallback deps 주의, ref 미러가 있으면 ref 사용.)

- [ ] **Step 3: 검증 + 커밋**

```bash
cd frontend && npm run lint && npm run build
```

Expected: 0 errors, 빌드 성공.

```bash
git add -A frontend/src PROGRESS.md
git commit -m "fix(editor): guard highlightNode for missing nodes — 사라진 노드 하이라이트 no-op 가드"
```

(수정이 없었으면 커밋 생략, PROGRESS.md에 조사 결과만 다음 태스크 커밋에 포함.)

---

### Task 6: 스모크 보정 + enforce 수동 검증 + 최종 게이트

**Files:**
- Modify: `frontend/scripts/pw-smoke-ai-chat-history.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1-5 전체 결과물, 기존 스모크 16체크, `docs/db-seed.md`의 시드 절차.
- Produces: 통과하는 스모크(+카드 재현 체크), 수동 검증 기록, 머지 준비 완료 상태.

- [ ] **Step 1: 스모크 스크립트 읽고 현행 체크 파악**

`frontend/scripts/pw-smoke-ai-chat-history.mjs`(268줄)를 Read — 세션/메시지 시드 방식(직접 sqlite insert인지 API 경유인지), 16체크가 참조하는 셀렉터 확인. 카드 DOM을 참조하는 체크가 있으면 신규 `data-id`(`ai-analysis-card`/`ai-walkthrough-card`/`ai-proposal-card`)로 보정.

- [ ] **Step 2: 카드 재현 체크 추가**

스크립트의 시드 단계에서 assistant 메시지 1건을 `kind="analysis"`, `payload='{"findings":[{"severity":"high","category":"orphan","node_ids":[],"message":"smoke finding","suggestion":"fix"}]}'` 로 삽입(기존 시드 방식 그대로 사용 — sqlite면 INSERT 컬럼에 payload 추가, API 경유면 백엔드 mock 응답에 findings 포함). 체크 추가:

```js
// check 17: 히스토리 재열람 시 분석 카드 재현 — payload 저장 검증
await page.reload();
// (세션 재선택 로직은 스크립트 기존 패턴 재사용)
const card = page.locator('[data-id="ai-analysis-card"]');
await card.waitFor({ state: "visible", timeout: 5000 });
ok("history analysis card restored", (await card.locator("button").count()) >= 1);
```

(정확한 helper 함수명(`ok`/`check`)과 세션 선택 로직은 Step 1에서 파악한 기존 패턴을 따른다.)

- [ ] **Step 3: 스모크 실행**

로컬 dev 서버(backend :8000 + frontend :3000) 기동 후:

```bash
cd frontend && node scripts/pw-smoke-ai-chat-history.mjs
```

Expected: 기존 16체크 + 신규 체크 전부 OK. 실패 시 좀비 dev 서버(3000 점유→3001 폴백) 여부 먼저 확인(`pkill -f "next dev"` 후 재기동).

- [ ] **Step 4: enforce ON 수동 검증 (권한 게이트 실동작)**

```bash
cd backend
DEV_ENFORCE_PERMISSIONS=true BPM_SYSADMINS=admin.sys .venv/bin/uvicorn app.main:app --port 8000
```

(⚠️ `--reload`는 .env 재로드 안 함 — 환경변수 인라인 지정 또는 완전 재기동.)

브라우저에서 sysadmin 아닌 계정(로그인 피커)으로: ① 무권한 private 맵의 version_id로 `GET /api/versions/{id}/graph` 직접 호출 → 403 확인, ② 같은 버전에 AI 챗 전송 → 403 확인, ③ viewer 권한 맵에서는 정상. 결과를 PROGRESS.md에 기록.

- [ ] **Step 5: 최종 게이트 전체 실행**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && npm run lint && npm run build
```

Expected: 전부 PASS / 0 errors.

- [ ] **Step 6: PROGRESS 마무리 + 커밋**

PROGRESS.md 브랜치 섹션에 완료 요약(스모크 결과·enforce 수동 검증 결과·**배포 노트: 서버는 startup `_ADDED_COLUMNS`가 payload 컬럼 자동 보강, 별도 수동 DDL 불요**) 기입.

```bash
git add frontend/scripts/pw-smoke-ai-chat-history.mjs PROGRESS.md
git commit -m "test(ai-chat): smoke check for card restore + gate verification — 카드 재현 스모크·게이트 수동 검증"
```

머지·브랜치 정리는 superpowers:finishing-a-development-branch 스킬로 진행(사용자 확인 후).
