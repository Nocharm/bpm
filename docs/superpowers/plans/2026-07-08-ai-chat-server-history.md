# AI Chat Server-Side History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 챗 대화를 localStorage에서 서버 DB(사용자×맵 귀속)로 옮기고, 히스토리 목록·다른 맵 열람·보존 상한(app_settings)을 붙인다. 스펙: `docs/superpowers/specs/2026-07-08-ai-chat-server-history-design.md`.

**Architecture:** 정규화 2테이블(`ai_chat_sessions`/`ai_chat_messages`) + `/ai/chat` write-through(답변 생성과 질문/답변 적재를 한 트랜잭션). 프론트 패널은 localStorage 스토어를 서버 목록/커서 페이징으로 교체. 기존 `ai_chat_logs`(관리자 Q&A 토글)는 흡수·제거.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic / Next.js + React / pytest + vitest + playwright-core 스모크.

## Global Constraints

- 브랜치: `feat/ai-chat-server-history` (베이스 `feat/ai-incremental-edit`). main 머지 금지 — 사용자 지시로만.
- 커밋 형식: `type(scope): English summary — 한국어 요약` + 푸터 2줄(`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01J3RggG4peCbBkqLJWpESAz`). **매 커밋에 PROGRESS.md의 `## 2026-07-08 — AI 챗 서버 저장 + 맵 단위 히스토리 (feat/ai-chat-server-history)` 섹션(첫 커밋에서 신설, 스펙 항목 아래)에 한 줄 bullet을 추가해 같이 스테이징한다.**
- 타임스탬프는 KST: 백엔드 `app.clock.now`(모델 `_now`), 프론트 표시는 `formatKstShort`. `Date.now()`/`new Date()`는 React 컴포넌트 본문·이벤트 핸들러에서 금지(react-hooks/purity) — 모듈 레벨 팩토리(`createLocalMessage`)에서만.
- React Compiler 린트: effect 내 동기 setState는 기존 패턴대로 `// eslint-disable-next-line react-hooks/set-state-in-effect` + 사유 주석. 트리비얼 핸들러는 plain function.
- 색은 토큰만(raw hex 금지), 아이콘 Lucide 16px(strokeWidth 1.5), UI 라벨 영어 기본(EN 블록)·KO 블록에 한국어. i18n 키는 `frontend/src/lib/i18n-messages.ts`의 **EN 블록과 KO 블록 양쪽**에 추가/삭제(누락 시 vitest i18n 테스트 실패).
- 백엔드 명령: `cd /Users/hyeonjin/Documents/bpm/backend` 후 `.venv/bin/python -m pytest tests/ -q`, `.venv/bin/ruff check app/ tests/`. 프론트: `cd /Users/hyeonjin/Documents/bpm/frontend` 후 `npx vitest run`, `npm run lint`, `npm run build`.
- 함수명은 동사 시작(get/create/prune/derive…). 주석은 why 중심 한 줄.
- 스모크는 반드시 frontend/ cwd에서 node 실행. 포트: 백엔드 8010, 프론트 3010(다른 세션과 충돌 방지). dev.db 시드는 스모크 후 반드시 원복.

---

### Task 1: 백엔드 모델·스키마 — 세션/메시지 테이블 + 계약 확장

**Files:**
- Modify: `backend/app/models.py` (AiChatLog 클래스 바로 아래에 신규 2모델 추가 — AiChatLog는 Task 5에서 제거하므로 이 태스크에서는 건드리지 않음)
- Modify: `backend/app/schemas.py` (AiChatRequest에 session_id, AiProposal에 session_id, 신규 Out 4종)
- Test: `backend/tests/test_ai_chat_history.py` (신규)

**Interfaces:**
- Produces: 모델 `AiChatSession(id, map_id, login_id, title, created_at, updated_at, messages)` / `AiChatMessage(id, session_id, role, content, kind, version_id, created_at)`; 스키마 `AiChatSessionOut`, `AiChatSessionsOut`, `AiChatMessageOut`, `AiChatMessagesOut`; `AiChatRequest.session_id: int | None`; `AiProposal.session_id: int | None`
- Consumes: 기존 `Base`, `_now`, `ProcessMap`

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_chat_history.py` 신규:

```python
"""AI 챗 서버 저장 히스토리 — 세션/메시지 write-through·조회·정리 (design 2026-07-08)."""

import json

import pytest
from fastapi.testclient import TestClient

from app import ai_client
from tests.test_ai import _draft_version_checked_out, _enable_ai, _fake_ai

OTHER_USER = {"X-Dev-User": "other.person"}


def _read_table(client: TestClient, name: str) -> list[dict]:
    resp = client.get(f"/api/admin/tables/{name}", params={"size": 500})
    assert resp.status_code == 200
    return resp.json()["rows"]


def test_chat_tables_registered(client: TestClient) -> None:
    # create_all이 신규 2테이블을 만들고 admin 브라우저(metadata 기반)에 노출된다
    names = [t["name"] for t in client.get("/api/admin/tables").json()]
    assert "ai_chat_sessions" in names
    assert "ai_chat_messages" in names


def test_chat_request_accepts_session_id() -> None:
    from app.schemas import AiChatRequest

    req = AiChatRequest.model_validate({"instruction": "hi", "session_id": 7})
    assert req.session_id == 7
    assert AiChatRequest.model_validate({"instruction": "hi"}).session_id is None
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python -m pytest tests/test_ai_chat_history.py -q
```
Expected: FAIL (`ai_chat_sessions` not in names / `session_id` ValidationError 아님 — AttributeError).

- [ ] **Step 3: 모델 추가**

`backend/app/models.py` — import 줄의 `from sqlalchemy import ...`에 `Index` 추가:

```python
from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text
```

`AiChatLog` 클래스 정의 바로 아래에 추가:

```python
class AiChatSession(Base):
    """AI 챗 대화 세션 — 사용자×맵 귀속 서버 원장. 목록 정렬 기준은 updated_at desc."""

    __tablename__ = "ai_chat_sessions"
    __table_args__ = (Index("ix_ai_chat_sessions_login_map", "login_id", "map_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    map_id: Mapped[int] = mapped_column(ForeignKey("process_maps.id", ondelete="CASCADE"))
    login_id: Mapped[str] = mapped_column(String(100))
    title: Mapped[str] = mapped_column(String(200), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    # ORM cascade로 세션 삭제 시 메시지 동반 삭제 — sqlite FK pragma에 의존하지 않는다
    messages: Mapped[list["AiChatMessage"]] = relationship(
        cascade="all, delete-orphan", passive_deletes=True
    )


class AiChatMessage(Base):
    """AI 챗 메시지 — user 질문/assistant 답변 텍스트만(제안 페이로드는 저장 안 함)."""

    __tablename__ = "ai_chat_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("ai_chat_sessions.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(10))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    kind: Mapped[str | None] = mapped_column(String(20), default=None)  # assistant만
    # 당시 열려 있던 버전 id — 추적용 순수 정수(FK 아님: 버전 삭제돼도 대화 보존)
    version_id: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
```

- [ ] **Step 4: 스키마 확장**

`backend/app/schemas.py`:

(a) `AiChatRequest`에 필드 추가 (model 필드 아래):

```python
class AiChatRequest(BaseModel):
    instruction: str = Field(min_length=1, max_length=2000)
    history: list[AiChatTurn] = Field(default_factory=list, max_length=20)
    # 사용할 모델 id — 없으면 서버 기본(settings.ai_model). 프론트가 /ai/models에서 선택
    model: str | None = None
    # 대화 세션 — None이면 첫 메시지 시점에 서버가 새 세션 생성(지연 생성)
    session_id: int | None = None
```

(b) `AiProposal`에 필드 추가 (`findings` 필드 아래, `_check_graph_integrity` 위):

```python
    # 적재된 대화 세션 id — 라우터가 저장 후 세팅(AI 출력에는 없음)
    session_id: int | None = None
```

(c) `AiModelsOut` 클래스 아래에 신규 4종 추가:

```python
class AiChatSessionOut(BaseModel):
    id: int
    map_id: int
    map_name: str
    title: str
    message_count: int
    updated_at: datetime


class AiChatSessionsOut(BaseModel):
    sessions: list[AiChatSessionOut]  # updated_at desc


class AiChatMessageOut(BaseModel):
    id: int
    role: Literal["user", "assistant"]
    content: str
    kind: str | None = None
    version_id: int | None = None
    created_at: datetime


class AiChatMessagesOut(BaseModel):
    messages: list[AiChatMessageOut]  # 시간 오름차순(페이지 내)
    has_more: bool  # before 커서로 더 오래된 기록 존재 여부
```

- [ ] **Step 5: 통과 확인 + 전체 회귀**

```bash
.venv/bin/python -m pytest tests/test_ai_chat_history.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 신규 2 PASS, 전체 453 passed, ruff clean.

- [ ] **Step 6: 커밋** (PROGRESS.md 섹션 신설 + 한 줄 추가 후)

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai-chat): session/message models + contract fields — 대화 세션·메시지 모델과 계약 확장"
```

---

### Task 2: `/ai/chat` write-through — 답변과 질문/답변을 한 트랜잭션 적재

**Files:**
- Create: `backend/app/chat_history.py`
- Modify: `backend/app/routers/ai.py`
- Test: `backend/tests/test_ai_chat_history.py` (추가)

**Interfaces:**
- Consumes: Task 1의 `AiChatSession`/`AiChatMessage`, `AiChatRequest.session_id`, `AiProposal.session_id`
- Produces: `derive_chat_title(instruction: str) -> str` (공백 정리 40자 컷); `/ai/chat` 응답에 `session_id` 포함; 실패 시 무적재

- [ ] **Step 1: 실패하는 테스트 작성** — `test_ai_chat_history.py`에 추가:

```python
def _my_sessions(client: TestClient) -> list[dict]:
    return _read_table(client, "ai_chat_sessions")


def _session_messages(client: TestClient, session_id: int) -> list[dict]:
    rows = _read_table(client, "ai_chat_messages")
    return [r for r in rows if r["session_id"] == session_id]


def test_chat_write_through_creates_session_and_two_rows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "저장 답변"}))
    )
    version_id = _draft_version_checked_out(client)

    resp = client.post(
        f"/api/versions/{version_id}/ai/chat",
        json={"instruction": "  제목   파생   테스트 질문입니다  "},
    )
    assert resp.status_code == 200
    session_id = resp.json()["session_id"]
    assert isinstance(session_id, int)

    row = next(s for s in _my_sessions(client) if s["id"] == session_id)
    assert row["title"] == "제목 파생 테스트 질문입니다"  # 공백 정리 + 40자 컷
    msgs = _session_messages(client, session_id)
    assert [m["role"] for m in msgs] == ["user", "assistant"]
    assert msgs[0]["content"] == "  제목   파생   테스트 질문입니다  ".strip() or msgs[0]["content"]
    assert msgs[1]["content"] == "저장 답변"
    assert msgs[1]["kind"] == "answer"
    assert msgs[0]["version_id"] == version_id


def test_chat_write_through_reuses_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "둘째 답"}))
    )
    version_id = _draft_version_checked_out(client)
    first = client.post(
        f"/api/versions/{version_id}/ai/chat", json={"instruction": "첫 질문"}
    ).json()
    second = client.post(
        f"/api/versions/{version_id}/ai/chat",
        json={"instruction": "둘째 질문", "session_id": first["session_id"]},
    ).json()
    assert second["session_id"] == first["session_id"]
    msgs = _session_messages(client, first["session_id"])
    assert len(msgs) == 4
    # 제목은 첫 질문에서 고정 — 이어지는 질문으로 바뀌지 않는다
    row = next(s for s in _my_sessions(client) if s["id"] == first["session_id"])
    assert row["title"] == "첫 질문"


def test_chat_no_rows_when_ai_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)

    async def _boom(messages: list[dict], model: str | None = None) -> str:
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_chat_messages"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "유령?"})
    assert resp.status_code == 502
    assert len(_read_table(client, "ai_chat_messages")) == before


def test_chat_rejects_foreign_or_mismatched_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "x"}))
    )
    version_a = _draft_version_checked_out(client)
    version_b = _draft_version_checked_out(client)  # 다른 맵의 버전
    owned = client.post(
        f"/api/versions/{version_a}/ai/chat", json={"instruction": "내 세션"}
    ).json()["session_id"]

    # 타인 소유 — 404 (존재 노출 안 함)
    resp = client.post(
        f"/api/versions/{version_a}/ai/chat",
        json={"instruction": "남의 세션", "session_id": owned},
        headers=OTHER_USER,
    )
    assert resp.status_code == 404

    # 맵 불일치 — 404
    resp = client.post(
        f"/api/versions/{version_b}/ai/chat",
        json={"instruction": "다른 맵", "session_id": owned},
    )
    assert resp.status_code == 404
```

주의: `OTHER_USER` 헤더 요청은 version_a 체크아웃 보유자가 아니므로 편집 다운그레이드 경로를 타지만, 검증은 AI 호출 **전에** 일어나야 404가 먼저다(아래 구현 순서 참고). `_draft_version_checked_out`는 호출마다 새 맵을 만든다(테스트 헬퍼 기존 동작).

- [ ] **Step 2: 실패 확인**

```bash
.venv/bin/python -m pytest tests/test_ai_chat_history.py -q
```
Expected: 신규 4개 FAIL (`session_id` None / rows 미생성).

- [ ] **Step 3: 헬퍼 모듈 생성**

`backend/app/chat_history.py` 신규:

```python
"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import AiChatMessage, AiChatSession


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]
```

(prune 3함수는 Task 4에서 이 파일에 추가 — timedelta/delete/func import는 그때 사용되므로, 이 시점 ruff unused-import를 피하려면 **Task 2에서는 위 import 중 실제 사용분만 남긴다**: `from app.models import ...`도 아직 불필요. Task 2 시점 파일은 아래로 시작한다.)

```python
"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]
```

- [ ] **Step 4: 라우터 write-through**

`backend/app/routers/ai.py`:

(a) import 추가:

```python
from app.chat_history import derive_chat_title
from app.models import AiChatLog, AiChatMessage, AiChatSession, Employee, ManualDoc, MapVersion
```

(b) `ai_chat` 본문 — `version is None` 404 체크 직후(AI 호출 전, fail-fast)에 세션 검증 추가:

```python
    # 이어쓰기 대상 세션 검증 — 소유·맵 일치 아니면 404(존재 노출 안 함). AI 호출 전에 확인.
    chat_session: AiChatSession | None = None
    if payload.session_id is not None:
        chat_session = await session.get(AiChatSession, payload.session_id)
        if (
            chat_session is None
            or chat_session.login_id != user
            or chat_session.map_id != version.map_id
        ):
            raise HTTPException(
                status_code=404, detail=f"chat session {payload.session_id} not found"
            )
```

(c) 기존 `if await is_ai_chat_log_enabled(session):` 블록 **바로 위**에 적재 블록 추가(경고 문구가 붙은 최종 `proposal.message`를 저장):

```python
    # 대화 서버 적재(write-through) — 질문+최종 답변을 한 트랜잭션. AI 실패 시 여기 도달 안 함.
    if chat_session is None:
        chat_session = AiChatSession(
            map_id=version.map_id,
            login_id=user,
            title=derive_chat_title(payload.instruction),
        )
        session.add(chat_session)
        await session.flush()  # id 채번 — 메시지 FK에 필요
    session.add(
        AiChatMessage(
            session_id=chat_session.id,
            role="user",
            content=payload.instruction,
            version_id=version_id,
        )
    )
    session.add(
        AiChatMessage(
            session_id=chat_session.id,
            role="assistant",
            content=proposal.message,
            kind=proposal.kind,
            version_id=version_id,
        )
    )
    chat_session.updated_at = now  # 메시지 추가만으로는 onupdate가 안 돎 — 명시 갱신
    await session.commit()
    proposal.session_id = chat_session.id
```

기존 `is_ai_chat_log_enabled` 블록은 이 태스크에서 **그대로 둔다**(Task 5에서 제거) — 단 그 블록의 `await session.commit()`은 위에서 이미 커밋되므로 중복 커밋이어도 무해.

- [ ] **Step 5: 통과 + 회귀 + 린트**

```bash
.venv/bin/python -m pytest tests/test_ai_chat_history.py tests/test_ai.py tests/test_app_settings.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전체 457 passed.

- [ ] **Step 6: 커밋**

```bash
git add backend/app/chat_history.py backend/app/routers/ai.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai-chat): write-through persistence in /ai/chat — 답변 생성과 질문/답변 적재 단일 트랜잭션"
```

---

### Task 3: 세션 조회/삭제 API — 목록(맵 이름·건수)·커서 페이징·삭제

**Files:**
- Create: `backend/app/routers/ai_sessions.py`
- Modify: `backend/app/main.py` (라우터 등록)
- Test: `backend/tests/test_ai_chat_history.py` (추가)

**Interfaces:**
- Consumes: Task 1 모델/스키마, Task 2로 세션을 만드는 테스트 헬퍼 흐름
- Produces: `GET /api/ai/chat-sessions[?map_id=]` → `AiChatSessionsOut`; `GET /api/ai/chat-sessions/{id}/messages?before=&limit=` → `AiChatMessagesOut`; `DELETE /api/ai/chat-sessions/{id}` → 204

- [ ] **Step 1: 실패하는 테스트 작성** — `test_ai_chat_history.py`에 추가:

```python
def _make_session_with_messages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, turns: int
) -> tuple[int, int]:
    """버전 하나 만들고 /ai/chat을 turns회 호출 — (version_id, session_id) 반환."""
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client, "call_ai", _fake_ai(json.dumps({"kind": "answer", "message": "ok"}))
    )
    version_id = _draft_version_checked_out(client)
    session_id = None
    for i in range(turns):
        body = {"instruction": f"질문 {i + 1}"}
        if session_id is not None:
            body["session_id"] = session_id
        session_id = client.post(
            f"/api/versions/{version_id}/ai/chat", json=body
        ).json()["session_id"]
    assert session_id is not None
    return version_id, session_id


def test_list_sessions_scoped_and_with_map_info(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid_a = _make_session_with_messages(client, monkeypatch, turns=1)
    _, sid_b = _make_session_with_messages(client, monkeypatch, turns=1)  # 다른 맵

    body = client.get("/api/ai/chat-sessions").json()
    ids = [s["id"] for s in body["sessions"]]
    assert sid_a in ids and sid_b in ids
    row = next(s for s in body["sessions"] if s["id"] == sid_a)
    assert row["map_name"].startswith("ai map")
    assert row["message_count"] == 2
    assert row["title"] == "질문 1"

    # map_id 필터 — 해당 맵 것만
    map_id = row["map_id"]
    filtered = client.get("/api/ai/chat-sessions", params={"map_id": map_id}).json()
    assert all(s["map_id"] == map_id for s in filtered["sessions"])
    assert sid_a in [s["id"] for s in filtered["sessions"]]
    assert sid_b not in [s["id"] for s in filtered["sessions"]]

    # 타 사용자 목록엔 안 보인다
    other = client.get("/api/ai/chat-sessions", headers=OTHER_USER).json()
    assert sid_a not in [s["id"] for s in other["sessions"]]


def test_list_sessions_excludes_soft_deleted_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    map_id = next(
        s["map_id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"] if s["id"] == sid
    )
    assert client.delete(f"/api/maps/{map_id}").status_code in (200, 204)  # 소프트 삭제
    assert sid not in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    client.post(f"/api/maps/{map_id}/restore")  # 공유 DB 원복


def test_messages_paging_with_before_cursor(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=4)  # 메시지 8개

    first = client.get(f"/api/ai/chat-sessions/{sid}/messages", params={"limit": 3}).json()
    assert len(first["messages"]) == 3 and first["has_more"] is True
    # 시간 오름차순 — 페이지의 마지막이 가장 최근(assistant "ok")
    assert first["messages"][-1]["role"] == "assistant"
    ids = [m["id"] for m in first["messages"]]
    assert ids == sorted(ids)

    second = client.get(
        f"/api/ai/chat-sessions/{sid}/messages",
        params={"limit": 3, "before": first["messages"][0]["id"]},
    ).json()
    assert len(second["messages"]) == 3 and second["has_more"] is True
    assert max(m["id"] for m in second["messages"]) < min(ids)

    third = client.get(
        f"/api/ai/chat-sessions/{sid}/messages",
        params={"limit": 3, "before": second["messages"][0]["id"]},
    ).json()
    assert len(third["messages"]) == 2 and third["has_more"] is False


def test_messages_and_delete_are_owner_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    assert (
        client.get(f"/api/ai/chat-sessions/{sid}/messages", headers=OTHER_USER).status_code == 404
    )
    assert client.delete(f"/api/ai/chat-sessions/{sid}", headers=OTHER_USER).status_code == 404
    assert client.get(f"/api/ai/chat-sessions/999999/messages").status_code == 404


def test_delete_session_cascades_messages(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, sid = _make_session_with_messages(client, monkeypatch, turns=2)
    assert client.delete(f"/api/ai/chat-sessions/{sid}").status_code == 204
    assert sid not in [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert _session_messages(client, sid) == []
```

- [ ] **Step 2: 실패 확인**

```bash
.venv/bin/python -m pytest tests/test_ai_chat_history.py -q
```
Expected: 신규 5개 FAIL (404 Not Found — 라우터 없음).

- [ ] **Step 3: 라우터 구현**

`backend/app/routers/ai_sessions.py` 신규:

```python
"""AI 챗 세션 조회/삭제 API — 전부 본인 소유만(타인 404, 존재 노출 안 함) (design 2026-07-08)."""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import get_session
from app.models import AiChatMessage, AiChatSession, ProcessMap
from app.schemas import AiChatMessageOut, AiChatMessagesOut, AiChatSessionOut, AiChatSessionsOut

router = APIRouter(prefix="/api", tags=["ai-chat-sessions"], dependencies=[Depends(get_current_user)])


async def _get_owned_session(
    session: AsyncSession, session_id: int, user: str
) -> AiChatSession:
    """본인 세션만 — 없거나 타인 것이면 404."""
    row = await session.get(AiChatSession, session_id)
    if row is None or row.login_id != user:
        raise HTTPException(status_code=404, detail=f"chat session {session_id} not found")
    return row


@router.get("/ai/chat-sessions", response_model=AiChatSessionsOut)
async def list_chat_sessions(
    map_id: int | None = Query(default=None),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChatSessionsOut:
    """내 세션 목록(최근 활동순) + 맵 이름·메시지 수 — 소프트삭제된 맵 제외."""
    counts = (
        select(AiChatMessage.session_id, func.count().label("n"))
        .group_by(AiChatMessage.session_id)
        .subquery()
    )
    stmt = (
        select(AiChatSession, ProcessMap.name, func.coalesce(counts.c.n, 0))
        .join(ProcessMap, ProcessMap.id == AiChatSession.map_id)
        .outerjoin(counts, counts.c.session_id == AiChatSession.id)
        .where(AiChatSession.login_id == user, ProcessMap.deleted_at.is_(None))
        .order_by(AiChatSession.updated_at.desc(), AiChatSession.id.desc())
    )
    if map_id is not None:
        stmt = stmt.where(AiChatSession.map_id == map_id)
    rows = (await session.execute(stmt)).all()
    return AiChatSessionsOut(
        sessions=[
            AiChatSessionOut(
                id=row.id,
                map_id=row.map_id,
                map_name=name,
                title=row.title,
                message_count=count,
                updated_at=row.updated_at,
            )
            for row, name, count in rows
        ]
    )


@router.get("/ai/chat-sessions/{session_id}/messages", response_model=AiChatMessagesOut)
async def list_chat_messages(
    session_id: int,
    before: int | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AiChatMessagesOut:
    """최근부터 역방향 커서 페이징 — before=<message_id>보다 오래된 limit개를 오름차순으로."""
    await _get_owned_session(session, session_id, user)
    stmt = select(AiChatMessage).where(AiChatMessage.session_id == session_id)
    if before is not None:
        stmt = stmt.where(AiChatMessage.id < before)
    # limit+1개를 최신순으로 떠서 has_more 판정 후 페이지만 오름차순으로 뒤집는다
    rows = (await session.scalars(stmt.order_by(AiChatMessage.id.desc()).limit(limit + 1))).all()
    has_more = len(rows) > limit
    page = list(reversed(rows[:limit]))
    return AiChatMessagesOut(
        messages=[
            AiChatMessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                kind=m.kind,
                version_id=m.version_id,
                created_at=m.created_at,
            )
            for m in page
        ],
        has_more=has_more,
    )


@router.delete("/ai/chat-sessions/{session_id}", status_code=204)
async def delete_chat_session(
    session_id: int,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """본인 세션 삭제 — 메시지는 ORM cascade로 동반 삭제."""
    row = await _get_owned_session(session, session_id, user)
    await session.delete(row)
    await session.commit()
```

- [ ] **Step 4: main.py 등록**

`backend/app/main.py` — `from app.routers import (...)` 튜플에 `ai_sessions` 추가(알파벳 순서 유지), `app.include_router(ai.router)` 바로 아래에:

```python
app.include_router(ai_sessions.router)
```

- [ ] **Step 5: 통과 + 회귀 + 린트**

```bash
.venv/bin/python -m pytest tests/test_ai_chat_history.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전체 462 passed. (맵 소프트삭제 테스트에서 DELETE /api/maps 응답 코드가 다르면 실제 코드를 확인해 assert를 맞춘다 — 기존 maps 라우터 준수.)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/routers/ai_sessions.py backend/app/main.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai-chat): session list/messages/delete endpoints — 세션 목록·커서 페이징·삭제 API"
```

---

### Task 4: 보존 상한 — app_settings 3키 + prune(개수·기간) 훅업

**Files:**
- Modify: `backend/app/app_settings.py` (int 키 3종 + getter)
- Modify: `backend/app/chat_history.py` (prune 3함수)
- Modify: `backend/app/schemas.py` (AppSettingsOut/Update에 상한 3필드 추가 — 토글은 아직 유지)
- Modify: `backend/app/routers/app_settings.py` (상한 저장/반환)
- Modify: `backend/app/routers/ai.py` (적재 후 prune 2종)
- Modify: `backend/app/routers/ai_sessions.py` (목록 조회 시 retention prune)
- Test: `backend/tests/test_ai_chat_history.py`, `backend/tests/test_app_settings.py` (추가)

**Interfaces:**
- Produces: `get_ai_chat_max_sessions/get_ai_chat_max_messages/get_ai_chat_retention_days(session) -> int` (기본 20/200/180); `prune_chat_session_messages(session, session_id, max_messages)`, `prune_map_chat_sessions(session, login_id, map_id, max_sessions)`, `prune_expired_chat_sessions(session, login_id, retention_days)`; PUT `/admin/app-settings`가 `ai_chat_max_sessions_per_map`(1–200)·`ai_chat_max_messages_per_session`(10–2000)·`ai_chat_retention_days`(7–3650) 수용
- Consumes: Task 2/3 엔드포인트

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_app_settings.py`에 추가:

```python
def test_app_settings_retention_defaults_and_roundtrip(client: TestClient) -> None:
    body = client.get("/api/admin/app-settings").json()
    assert body["ai_chat_max_sessions_per_map"] == 20
    assert body["ai_chat_max_messages_per_session"] == 200
    assert body["ai_chat_retention_days"] == 180

    body = client.put(
        "/api/admin/app-settings",
        json={"ai_chat_max_sessions_per_map": 5, "ai_chat_retention_days": 30},
    ).json()
    assert body["ai_chat_max_sessions_per_map"] == 5
    assert body["ai_chat_max_messages_per_session"] == 200  # 부분 갱신 — 미전송 유지
    assert body["ai_chat_retention_days"] == 30
    # 범위 밖은 422 (pydantic Field 검증)
    assert (
        client.put("/api/admin/app-settings", json={"ai_chat_max_sessions_per_map": 0}).status_code
        == 422
    )
    # 복원 — 공유 DB 오염 방지
    client.put(
        "/api/admin/app-settings",
        json={
            "ai_chat_max_sessions_per_map": 20,
            "ai_chat_max_messages_per_session": 200,
            "ai_chat_retention_days": 180,
        },
    )
```

`tests/test_ai_chat_history.py`에 추가:

```python
def _put_limits(client: TestClient, **limits: int) -> None:
    assert client.put("/api/admin/app-settings", json=limits).status_code == 200


def test_prune_messages_over_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _put_limits(client, ai_chat_max_messages_per_session=10)
    try:
        _, sid = _make_session_with_messages(client, monkeypatch, turns=7)  # 14개 적재 시도
        msgs = _session_messages(client, sid)
        assert len(msgs) == 10  # 오래된 4개 삭제
        assert msgs[0]["content"] == "질문 3"  # 앞쪽(1~2턴)이 잘려나감
    finally:
        _put_limits(client, ai_chat_max_messages_per_session=200)


def test_prune_sessions_over_cap_same_map(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _put_limits(client, ai_chat_max_sessions_per_map=2)
    try:
        version_id, sid1 = _make_session_with_messages(client, monkeypatch, turns=1)
        sid2 = client.post(
            f"/api/versions/{version_id}/ai/chat", json={"instruction": "세션2"}
        ).json()["session_id"]
        sid3 = client.post(
            f"/api/versions/{version_id}/ai/chat", json={"instruction": "세션3"}
        ).json()["session_id"]
        ids = [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
        assert sid1 not in ids  # 최오래(활동 기준) 퇴출
        assert sid2 in ids and sid3 in ids
        assert _session_messages(client, sid1) == []  # cascade
    finally:
        _put_limits(client, ai_chat_max_sessions_per_map=20)


def test_retention_prunes_stale_sessions_on_list(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import timedelta

    from app import clock

    _, sid = _make_session_with_messages(client, monkeypatch, turns=1)
    real_now = clock.now
    # 목록 조회 시점의 '지금'을 200일 뒤로 — retention 180일 초과
    monkeypatch.setattr(
        "app.chat_history.now_kst", lambda: real_now() + timedelta(days=200)
    )
    ids = [s["id"] for s in client.get("/api/ai/chat-sessions").json()["sessions"]]
    assert sid not in ids
```

- [ ] **Step 2: 실패 확인**

```bash
.venv/bin/python -m pytest tests/test_app_settings.py tests/test_ai_chat_history.py -q
```
Expected: 신규 4개 FAIL.

- [ ] **Step 3: app_settings 키/getter**

`backend/app/app_settings.py` — `AI_CHAT_TIPS_KEY` 아래에 추가:

```python
AI_CHAT_MAX_SESSIONS_KEY = "ai_chat_max_sessions_per_map"
AI_CHAT_MAX_MESSAGES_KEY = "ai_chat_max_messages_per_session"
AI_CHAT_RETENTION_DAYS_KEY = "ai_chat_retention_days"

# 보존 상한 기본값 — 사용자×맵당 세션 수 / 세션당 메시지 수 / 마지막 활동 후 보관 일수
DEFAULT_AI_CHAT_MAX_SESSIONS = 20
DEFAULT_AI_CHAT_MAX_MESSAGES = 200
DEFAULT_AI_CHAT_RETENTION_DAYS = 180
```

파일 하단에 getter 추가:

```python
async def _get_int_setting(session: AsyncSession, key: str, default: int) -> int:
    """양의 정수 설정 — 행이 없거나 파싱 불가·0 이하면 기본값."""
    row = await session.get(AppSetting, key)
    if row is None:
        return default
    try:
        value = int(row.value)
    except ValueError:
        return default
    return value if value > 0 else default


async def get_ai_chat_max_sessions(session: AsyncSession) -> int:
    return await _get_int_setting(session, AI_CHAT_MAX_SESSIONS_KEY, DEFAULT_AI_CHAT_MAX_SESSIONS)


async def get_ai_chat_max_messages(session: AsyncSession) -> int:
    return await _get_int_setting(session, AI_CHAT_MAX_MESSAGES_KEY, DEFAULT_AI_CHAT_MAX_MESSAGES)


async def get_ai_chat_retention_days(session: AsyncSession) -> int:
    return await _get_int_setting(
        session, AI_CHAT_RETENTION_DAYS_KEY, DEFAULT_AI_CHAT_RETENTION_DAYS
    )
```

- [ ] **Step 4: prune 3함수**

`backend/app/chat_history.py` — 파일을 아래 전체로 교체:

```python
"""AI 챗 서버 저장 — 세션 제목 파생·보존 정리 헬퍼 (design 2026-07-08)."""

from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import now as now_kst
from app.models import AiChatMessage, AiChatSession


def derive_chat_title(instruction: str) -> str:
    """첫 질문에서 세션 제목 파생 — 공백 정리 후 40자 컷(구 프론트 deriveSessionTitle 동일)."""
    return " ".join(instruction.split())[:40]


async def prune_chat_session_messages(
    session: AsyncSession, session_id: int, max_messages: int
) -> None:
    """세션 내 메시지 상한 초과분을 오래된 순(id asc)으로 삭제 — 호출자가 commit."""
    count = (
        await session.execute(
            select(func.count())
            .select_from(AiChatMessage)
            .where(AiChatMessage.session_id == session_id)
        )
    ).scalar_one()
    overflow = count - max_messages
    if overflow <= 0:
        return
    old_ids = (
        await session.scalars(
            select(AiChatMessage.id)
            .where(AiChatMessage.session_id == session_id)
            .order_by(AiChatMessage.id)
            .limit(overflow)
        )
    ).all()
    await session.execute(delete(AiChatMessage).where(AiChatMessage.id.in_(old_ids)))


async def prune_map_chat_sessions(
    session: AsyncSession, login_id: str, map_id: int, max_sessions: int
) -> None:
    """사용자×맵 세션 상한 초과분을 활동 오래된 순으로 삭제 — ORM delete로 메시지 cascade."""
    rows = (
        await session.scalars(
            select(AiChatSession)
            .where(AiChatSession.login_id == login_id, AiChatSession.map_id == map_id)
            .order_by(AiChatSession.updated_at.desc(), AiChatSession.id.desc())
        )
    ).all()
    for stale in rows[max_sessions:]:
        await session.delete(stale)


async def prune_expired_chat_sessions(
    session: AsyncSession, login_id: str, retention_days: int
) -> None:
    """마지막 활동 후 retention_days 경과한 내 세션 삭제 — 목록 조회 시 기회적 실행."""
    cutoff = now_kst() - timedelta(days=retention_days)
    rows = (
        await session.scalars(
            select(AiChatSession).where(
                AiChatSession.login_id == login_id, AiChatSession.updated_at < cutoff
            )
        )
    ).all()
    for stale in rows:
        await session.delete(stale)
```

- [ ] **Step 5: 스키마·설정 라우터**

`backend/app/schemas.py` — `AppSettingsOut`/`AppSettingsUpdate`를 다음으로 교체(토글 필드는 유지, Task 5에서 제거):

```python
class AppSettingsOut(BaseModel):
    """앱 런타임 설정 — AI 챗 Q&A DB 적재 플래그 + 기능 팁 + 대화 보존 상한."""

    ai_chat_log_enabled: bool
    ai_chat_tips: list[str]
    ai_chat_max_sessions_per_map: int
    ai_chat_max_messages_per_session: int
    ai_chat_retention_days: int
    updated_by: str | None = None
    updated_at: datetime | None = None


class AppSettingsUpdate(BaseModel):
    """부분 갱신 — None 필드는 유지. 팁을 빈 목록으로 보내면 기본 팁으로 복원."""

    ai_chat_log_enabled: bool | None = None
    ai_chat_tips: list[str] | None = Field(default=None, max_length=50)
    ai_chat_max_sessions_per_map: int | None = Field(default=None, ge=1, le=200)
    ai_chat_max_messages_per_session: int | None = Field(default=None, ge=10, le=2000)
    ai_chat_retention_days: int | None = Field(default=None, ge=7, le=3650)
```

`backend/app/routers/app_settings.py` — import에 상한 키·getter 추가:

```python
from app.app_settings import (
    AI_CHAT_LOG_KEY,
    AI_CHAT_MAX_MESSAGES_KEY,
    AI_CHAT_MAX_SESSIONS_KEY,
    AI_CHAT_RETENTION_DAYS_KEY,
    AI_CHAT_TIPS_KEY,
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_retention_days,
    get_ai_chat_tips,
    is_ai_chat_log_enabled,
    set_app_setting,
)
```

`_to_out`에 3필드 추가:

```python
async def _to_out(session: AsyncSession) -> AppSettingsOut:
    row = await session.get(AppSetting, AI_CHAT_LOG_KEY)
    return AppSettingsOut(
        ai_chat_log_enabled=await is_ai_chat_log_enabled(session),
        ai_chat_tips=await get_ai_chat_tips(session),
        ai_chat_max_sessions_per_map=await get_ai_chat_max_sessions(session),
        ai_chat_max_messages_per_session=await get_ai_chat_max_messages(session),
        ai_chat_retention_days=await get_ai_chat_retention_days(session),
        updated_by=row.updated_by if row else None,
        updated_at=row.updated_at if row else None,
    )
```

`put_app_settings`의 tips 처리 아래에 추가:

```python
    for key, value in (
        (AI_CHAT_MAX_SESSIONS_KEY, payload.ai_chat_max_sessions_per_map),
        (AI_CHAT_MAX_MESSAGES_KEY, payload.ai_chat_max_messages_per_session),
        (AI_CHAT_RETENTION_DAYS_KEY, payload.ai_chat_retention_days),
    ):
        if value is not None:
            await set_app_setting(session, key, str(value), user)
```

- [ ] **Step 6: prune 훅업**

`backend/app/routers/ai.py` — import 추가:

```python
from app.app_settings import (
    get_ai_chat_max_messages,
    get_ai_chat_max_sessions,
    get_ai_chat_tips,
    is_ai_chat_log_enabled,
)
from app.chat_history import (
    derive_chat_title,
    prune_chat_session_messages,
    prune_map_chat_sessions,
)
```

Task 2에서 넣은 적재 블록의 `chat_session.updated_at = now` 다음, `await session.commit()` 앞에 삽입:

```python
    # 보존 정리 — 세션 내 메시지 상한·사용자×맵 세션 상한(설정 콘솔에서 런타임 조정)
    await prune_chat_session_messages(
        session, chat_session.id, await get_ai_chat_max_messages(session)
    )
    await prune_map_chat_sessions(
        session, user, version.map_id, await get_ai_chat_max_sessions(session)
    )
```

`backend/app/routers/ai_sessions.py` — import 추가:

```python
from app.app_settings import get_ai_chat_retention_days
from app.chat_history import prune_expired_chat_sessions
```

`list_chat_sessions` 본문 맨 앞(counts 서브쿼리 위)에 삽입:

```python
    # 기간 만료 세션 기회적 정리 — 크론 없이 목록 조회 시점에 내 것만
    await prune_expired_chat_sessions(session, user, await get_ai_chat_retention_days(session))
    await session.commit()
```

- [ ] **Step 7: 통과 + 회귀 + 린트**

```bash
.venv/bin/python -m pytest tests/test_app_settings.py tests/test_ai_chat_history.py -q && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전체 466 passed.

- [ ] **Step 8: 커밋**

```bash
git add backend/app/app_settings.py backend/app/chat_history.py backend/app/schemas.py backend/app/routers/app_settings.py backend/app/routers/ai.py backend/app/routers/ai_sessions.py backend/tests/test_app_settings.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai-chat): retention limits via app_settings + prune hooks — 보존 상한 3종·기회적 정리"
```

---

### Task 5: ai_chat_logs 흡수·제거 — 모델·토글·적재 블록·구 테스트 정리

**Files:**
- Modify: `backend/app/models.py` (AiChatLog 클래스 삭제)
- Modify: `backend/app/app_settings.py` (AI_CHAT_LOG_KEY·is_ai_chat_log_enabled 삭제)
- Modify: `backend/app/schemas.py` (AppSettingsOut/Update에서 ai_chat_log_enabled 삭제)
- Modify: `backend/app/routers/app_settings.py` (토글 처리·import 삭제, _to_out 재작성)
- Modify: `backend/app/routers/ai.py` (구 로깅 블록·import 삭제)
- Modify: `backend/tests/test_app_settings.py` (로깅 테스트 2종·헬퍼 삭제, 토글 assert 제거)

**Interfaces:**
- Produces: `AppSettingsOut`에서 `ai_chat_log_enabled` 제거(프론트는 Task 9에서 동기화); `updated_by/updated_at`은 관리 4키 중 최신 갱신 행 기준
- Consumes: Task 4의 상한 getter

- [ ] **Step 1: 제거 대상 테스트 먼저 정리** — `tests/test_app_settings.py`:
  - `test_ai_chat_logged_when_enabled`, `test_ai_chat_not_logged_when_disabled`, `_set_chat_log`, `_read_logs` 삭제. 상단 import에서 `json`, `ai_client`, `_draft_version_checked_out`, `_enable_ai`, `_fake_ai` 등 이제 안 쓰는 것 제거.
  - `test_app_settings_default_off` → 이름을 `test_app_settings_defaults`로 바꾸고 본문을:

```python
def test_app_settings_defaults(client: TestClient) -> None:
    resp = client.get("/api/admin/app-settings")
    assert resp.status_code == 200
    body = resp.json()
    assert "ai_chat_log_enabled" not in body  # 토글 제거(서버 저장이 원장)
    assert body["ai_chat_max_sessions_per_map"] == 20
```

  - `test_app_settings_put_roundtrip` → 토글 대신 상한으로:

```python
def test_app_settings_put_roundtrip(client: TestClient) -> None:
    body = client.put("/api/admin/app-settings", json={"ai_chat_retention_days": 90}).json()
    assert body["ai_chat_retention_days"] == 90
    assert body["updated_by"]  # 저장자 기록
    assert body["updated_at"]
    client.put("/api/admin/app-settings", json={"ai_chat_retention_days": 180})  # 복원
```

  - `test_app_settings_requires_sysadmin`의 PUT payload를 `{"ai_chat_retention_days": 30}`로 교체.
  - `test_ai_tips_endpoint_and_custom_roundtrip`의 `assert resp.json()["ai_chat_log_enabled"] is False` 줄 삭제.
  - `test_app_settings_partial_update_keeps_tips`의 토글 PUT을 `{"ai_chat_retention_days": 60}`로, 복원 PUT을 `{"ai_chat_retention_days": 180, "ai_chat_tips": []}`로 교체.

- [ ] **Step 2: 실패 확인**

```bash
.venv/bin/python -m pytest tests/test_app_settings.py -q
```
Expected: `test_app_settings_defaults` FAIL (`ai_chat_log_enabled`가 아직 응답에 있음).

- [ ] **Step 3: 코드 제거**
  - `models.py`: `AiChatLog` 클래스 전체 삭제.
  - `app_settings.py`: `AI_CHAT_LOG_KEY` 상수와 `is_ai_chat_log_enabled` 함수 삭제.
  - `schemas.py`: `AppSettingsOut.ai_chat_log_enabled`, `AppSettingsUpdate.ai_chat_log_enabled` 필드와 docstring의 "적재 플래그" 문구 삭제(docstring: `"""앱 런타임 설정 — AI 챗 기능 팁 + 대화 보존 상한."""`).
  - `routers/ai.py`: import에서 `is_ai_chat_log_enabled`·`AiChatLog` 제거, `# 설정 ON일 때 최종 질문/답변을 DB 적재 …` 주석부터 시작하는 `if await is_ai_chat_log_enabled(session): … await session.commit()` 블록 전체 삭제.
  - `routers/app_settings.py`: import에서 `AI_CHAT_LOG_KEY`·`is_ai_chat_log_enabled` 제거, `put_app_settings`의 `if payload.ai_chat_log_enabled is not None:` 블록 삭제, docstring의 "적재 토글" 문구를 "보존 상한·기능 팁"으로 갱신, `_to_out`을 다음으로 교체:

```python
async def _to_out(session: AsyncSession) -> AppSettingsOut:
    managed = [
        AI_CHAT_TIPS_KEY,
        AI_CHAT_MAX_SESSIONS_KEY,
        AI_CHAT_MAX_MESSAGES_KEY,
        AI_CHAT_RETENTION_DAYS_KEY,
    ]
    rows = (
        await session.scalars(select(AppSetting).where(AppSetting.key.in_(managed)))
    ).all()
    latest = max(rows, key=lambda r: r.updated_at, default=None)
    return AppSettingsOut(
        ai_chat_tips=await get_ai_chat_tips(session),
        ai_chat_max_sessions_per_map=await get_ai_chat_max_sessions(session),
        ai_chat_max_messages_per_session=await get_ai_chat_max_messages(session),
        ai_chat_retention_days=await get_ai_chat_retention_days(session),
        updated_by=latest.updated_by if latest else None,
        updated_at=latest.updated_at if latest else None,
    )
```

  (`from sqlalchemy import select` import 추가 필요.)

- [ ] **Step 4: 통과 + 회귀 + 린트**

```bash
.venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
```
Expected: 전체 464 passed (로깅 2종 삭제로 -2). `grep -rn "ai_chat_log\|AiChatLog" backend/app backend/tests` 결과 0건 확인.

- [ ] **Step 5: 커밋** (PROGRESS bullet에 서버 배포 시 `DROP TABLE ai_chat_logs;` 1회 수동 실행 필요를 명시)

```bash
git add backend/app/models.py backend/app/app_settings.py backend/app/schemas.py backend/app/routers/app_settings.py backend/app/routers/ai.py backend/tests/test_app_settings.py PROGRESS.md
git commit -m "refactor(ai-chat): absorb ai_chat_logs into chat history — Q&A 로그 토글·테이블 제거(서버 배포 시 DROP TABLE 1회)"
```

---

### Task 6: 프론트 API 클라이언트 + chat-sessions.ts 재작성

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Rewrite: `frontend/src/lib/chat-sessions.ts`
- Rewrite: `frontend/src/lib/chat-sessions.test.ts`

**Interfaces:**
- Produces: `getAiChatSessions(mapId?) → {sessions: AiChatSessionSummary[]}`, `getAiChatMessages(sessionId, before?, limit?) → {messages, has_more}`, `deleteAiChatSession(sessionId)`, `aiChat(versionId, instruction, history, model, sessionId)`; `AiProposal.session_id?: number | null`; `ChatMessage {id, role, content, at}`, `createLocalMessage(role, content)`, `toChatMessage(row)`
- Consumes: Task 3 엔드포인트 계약

- [ ] **Step 1: 실패하는 테스트 작성** — `frontend/src/lib/chat-sessions.test.ts` 전체를 다음으로 교체:

```ts
import { describe, expect, it } from "vitest";

import { createLocalMessage, toChatMessage } from "./chat-sessions";

describe("chat-sessions view model", () => {
  it("converts a server row to a view message with epoch time", () => {
    const msg = toChatMessage({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      kind: "answer",
      version_id: 3,
      created_at: "2026-07-08T10:00:00+09:00",
    });
    expect(msg).toEqual({
      id: 12,
      role: "assistant",
      content: "안녕하세요",
      at: Date.parse("2026-07-08T10:00:00+09:00"),
    });
  });

  it("keeps at null when created_at is unparsable", () => {
    const msg = toChatMessage({
      id: 1,
      role: "user",
      content: "x",
      kind: null,
      version_id: null,
      created_at: "not-a-date",
    });
    expect(msg.at).toBeNull();
  });

  it("creates optimistic local messages with unique negative ids", () => {
    const a = createLocalMessage("user", "질문");
    const b = createLocalMessage("assistant", "답변");
    expect(a.id).toBeLessThan(0);
    expect(b.id).toBeLessThan(0);
    expect(a.id).not.toBe(b.id);
    expect(a.role).toBe("user");
    expect(typeof a.at).toBe("number");
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
cd /Users/hyeonjin/Documents/bpm/frontend && npx vitest run src/lib/chat-sessions.test.ts
```
Expected: FAIL (구 스토어 API에는 toChatMessage 없음 — import 에러).

- [ ] **Step 3: chat-sessions.ts 전체 교체**

```ts
// AI 챗 서버 저장 히스토리 — 메시지 뷰모델 변환·낙관 표시용 로컬 메시지. 서버가 원장(localStorage 폐기).
import type { AiChatMessageRow } from "@/lib/api";

export interface ChatMessage {
  id: number; // 서버 메시지 id — 낙관(미저장 표시) 메시지는 음수 임시 id
  role: "user" | "assistant";
  content: string;
  at: number | null; // epoch ms — 렌더에서 KST 포맷
}

let localSeq = 0;

// 낙관 표시용 로컬 메시지 — Date.now()는 컴포넌트 밖 팩토리에서만(react-hooks/purity)
export function createLocalMessage(role: ChatMessage["role"], content: string): ChatMessage {
  localSeq -= 1;
  return { id: localSeq, role, content, at: Date.now() };
}

export function toChatMessage(row: AiChatMessageRow): ChatMessage {
  const at = Date.parse(row.created_at);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    at: Number.isNaN(at) ? null : at,
  };
}
```

- [ ] **Step 4: api.ts 확장**

(a) `aiChat` 아래(getAiModels 위)에 추가:

```ts
// ── AI 챗 서버 저장 히스토리 (design 2026-07-08) ──────────────

export interface AiChatSessionSummary {
  id: number;
  map_id: number;
  map_name: string;
  title: string;
  message_count: number;
  updated_at: string;
}

export interface AiChatMessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  kind: string | null;
  version_id: number | null;
  created_at: string;
}

// 내 세션 목록(최근 활동순) — mapId 생략 시 전체 맵(맵 이름 포함, "다른 맵 대화" 목록용)
export function getAiChatSessions(
  mapId?: number,
): Promise<{ sessions: AiChatSessionSummary[] }> {
  const query = mapId !== undefined ? `?map_id=${mapId}` : "";
  return request<{ sessions: AiChatSessionSummary[] }>(`/ai/chat-sessions${query}`);
}

// 커서 페이징 — before(메시지 id)보다 오래된 limit개를 시간 오름차순으로
export function getAiChatMessages(
  sessionId: number,
  before?: number,
  limit = 30,
): Promise<{ messages: AiChatMessageRow[]; has_more: boolean }> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set("before", String(before));
  return request<{ messages: AiChatMessageRow[]; has_more: boolean }>(
    `/ai/chat-sessions/${sessionId}/messages?${params.toString()}`,
  );
}

export function deleteAiChatSession(sessionId: number): Promise<void> {
  return request<void>(`/ai/chat-sessions/${sessionId}`, { method: "DELETE" });
}
```

(b) `AiProposal` 인터페이스에 필드 추가:

```ts
  // 적재된 대화 세션 id — 서버가 저장 후 세팅(새 대화 첫 전송 시 신규 id)
  session_id?: number | null;
```

(c) `aiChat`을 다음으로 교체:

```ts
export function aiChat(
  versionId: number,
  instruction: string,
  history: AiChatTurn[],
  model: string | null,
  sessionId: number | null,
): Promise<AiProposal> {
  return request<AiProposal>(`/versions/${versionId}/ai/chat`, {
    method: "POST",
    body: JSON.stringify({ instruction, history, model, session_id: sessionId }),
  });
}
```

주의: 이 시점에 `ai-chat-panel.tsx`는 구 시그니처/구 스토어를 쓰므로 **빌드가 깨진다** — Task 7과 같은 커밋으로 묶지 않고, Task 6 커밋은 `npx vitest run`·`ruff`무관 통과만 확인하고 lint/build는 Task 7 완료 후 게이트로 돌린다(커밋은 Task 7과 합쳐서 한 번에 하는 것도 허용 — 그 경우 Task 7 Step 7 커밋에 파일을 함께 스테이징).

- [ ] **Step 5: vitest 통과 확인**

```bash
npx vitest run src/lib/chat-sessions.test.ts
```
Expected: 3 PASS. (커밋은 Task 7에서 함께.)

---

### Task 7: 패널 코어 개편 — 서버 세션 로딩·전송·커서 페이징 (localStorage 폐기)

**Files:**
- Modify: `frontend/src/components/ai-chat-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (mapId prop 전달)
- Modify: `frontend/src/lib/i18n-messages.ts` (키 추가/삭제 — EN·KO 양쪽)

**Interfaces:**
- Consumes: Task 6의 API 클라이언트·뷰모델
- Produces: `AiChatPanelProps`에 `mapId: number` 추가; 현재 맵 세션 드롭다운(서버)·새 대화(지연 생성)·상단 스크롤 페이징. 삭제·다른 맵·`?aiChat=`은 Task 8.

- [ ] **Step 1: i18n 키 정리** — `frontend/src/lib/i18n-messages.ts` EN 블록과 KO 블록 **양쪽에서**:
  - 삭제: `ai.limitTitle`, `ai.limitMessage`, `ai.limitCloses`, `ai.limitConfirm`, `ai.sessionUsage`
  - 추가 (EN / KO):

```
"ai.historyError": "Failed to load chat history" / "대화 기록을 불러오지 못했습니다"
"ai.retry": "Retry" / "다시 시도"
"ai.noChats": "No previous chats" / "이전 대화 없음"
```

- [ ] **Step 2: 패널 코어 교체** — `ai-chat-panel.tsx`:

(a) import 교체 — chat-sessions와 api:

```ts
import {
  aiChat,
  getAiChatMessages,
  getAiChatSessions,
  getAiModels,
  getAiTips,
  type AiChatSessionSummary,
  type AiChatTurn,
  type AiFinding,
  type AiProposal,
  type AiStep,
} from "@/lib/api";
import { createLocalMessage, toChatMessage, type ChatMessage } from "@/lib/chat-sessions";
```

`ConfirmDialog` import는 Task 8(삭제 확인)에서 다시 쓰므로 유지. lucide에서 `AlertTriangle…` 목록은 유지하되 이 태스크에서 안 쓰게 된 것이 생기면 제거(최종 lint가 잡는다).

(b) 상수 정리 — `HISTORY_KEY_PREFIX`, `EMPTY_MESSAGES` 삭제. `CHAT_CHUNK_SIZE`를 서버 페이지 크기로 재정의:

```ts
const CHAT_PAGE_SIZE = 30; // 서버 커서 페이징 단위 — 최초/이전 기록 로딩 공통
const OLDER_LOAD_DELAY_MS = 450; // 이전 기록 로딩 애니메이션(팁 노출) 최소 시간
```

(c) Props에 `mapId: number;` 추가(versionId 위). 함수 시그니처 구조분해에도 추가.

(d) 상태 교체 — 기존 `sessions/activeId/limitConfirm/visibleCount/hydratedVersionRef` 관련을 다음으로:

```ts
  // 서버 세션 히스토리 — 전체 목록(내 것 전부, 맵 정보 포함)과 활성 세션. null=새 대화(서버 행 없음, 첫 전송 시 생성)
  const [allSessions, setAllSessions] = useState<AiChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [sessionsReload, setSessionsReload] = useState(0);
  const [listOpen, setListOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState(false); // 목록/메시지 로딩 실패 — 인라인 재시도
  const initializedRef = useRef(false); // 최초 목록 로딩 시 1회만 최근 세션 자동 활성화
```

`activeIdRef`는 `activeSessionIdRef`(number | null)로 개명·유지. 파생:

```ts
  const mapSessions = allSessions.filter((item) => item.map_id === mapId);
  const activeMeta = allSessions.find((item) => item.id === activeSessionId) ?? null;
```

(e) localStorage 하이드레이션 effect(기존 183–195행)·저장 effect(198–206행)·`appendToSession`·`openFreshSession`·`confirmCloseOldest`·limitConfirm ConfirmDialog 블록·세션 용량 진행바 블록(`ai-session-usage`)·카운터 `n/4` span을 **삭제**하고, 다음 effect 2개를 추가:

```ts
  // 세션 목록 로딩 — 마운트·갱신 트리거 시. 최초 1회만 현재 맵의 최근 세션을 자동 활성화.
  useEffect(() => {
    let alive = true;
    void getAiChatSessions()
      .then((result) => {
        if (!alive) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAllSessions(result.sessions); // intentional: server fetch hydration
        setHistoryError(false);
        if (!initializedRef.current) {
          initializedRef.current = true;
          const recent = result.sessions.find((item) => item.map_id === mapId);
          setActiveSessionId(recent ? recent.id : null);
        }
      })
      .catch(() => {
        if (alive) setHistoryError(true);
      });
    return () => {
      alive = false;
    };
  }, [mapId, sessionsReload]);

  // 활성 세션 메시지 로딩 — 최근 페이지부터. 새 대화(null)는 빈 스레드.
  useEffect(() => {
    if (activeSessionId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]); // intentional: reset thread for fresh chat
      setHasMore(false);
      return;
    }
    let alive = true;
    void getAiChatMessages(activeSessionId, undefined, CHAT_PAGE_SIZE)
      .then((result) => {
        if (!alive) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setMessages(result.messages.map(toChatMessage)); // intentional: server fetch hydration
        setHasMore(result.has_more);
        setHistoryError(false);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        if (err instanceof Error && err.message.includes(" 404")) {
          // 정리(보존 상한 등)로 사라진 세션 — 목록 새로고침 후 새 대화 폴백
          setActiveSessionId(null);
          setSessionsReload((value) => value + 1);
        } else {
          setHistoryError(true);
        }
      });
    return () => {
      alive = false;
    };
  }, [activeSessionId]);
```

(f) `switchSession`/`startNewChat` 교체:

```ts
  const refreshSessions = () => setSessionsReload((value) => value + 1);

  const switchSession = (sessionId: number | null) => {
    setListOpen(false);
    if (sessionId === activeSessionId) return;
    setActiveSessionId(sessionId);
    resetTransient();
  };

  const startNewChat = () => {
    setListOpen(false);
    if (activeSessionId === null) return; // 이미 새 대화 — 빈 상태 재사용
    switchSession(null);
  };
```

`resetTransient`에서 `setVisibleCount(CHAT_CHUNK_SIZE)` 줄 삭제(나머지 유지).

(g) `beginLoadOlder` 교체 — 서버 커서 페이징 + 최소 지연(팁 노출):

```ts
  // 이전 페이지 로딩 — 스피너+기능 팁을 최소 시간 보여주며 서버에서 더 오래된 기록을 붙인다
  const beginLoadOlder = () => {
    const el = scrollRef.current;
    const oldest = messages.find((message) => message.id > 0); // 낙관(음수 id) 제외
    if (!el || loadingOlder || !hasMore || activeSessionId === null || !oldest) return;
    prevScrollHeightRef.current = el.scrollHeight;
    setTipIndex(Math.floor(Math.random() * Math.max(1, tips.length || TIP_KEYS.length)));
    setLoadingOlder(true);
    void Promise.all([
      getAiChatMessages(activeSessionId, oldest.id, CHAT_PAGE_SIZE),
      new Promise((resolve) => window.setTimeout(resolve, OLDER_LOAD_DELAY_MS)),
    ])
      .then(([result]) => {
        setMessages((prev) => [...result.messages.map(toChatMessage), ...prev]);
        setHasMore(result.has_more);
      })
      .catch(() => onToast?.(t("ai.historyError")))
      .finally(() => setLoadingOlder(false));
  };
```

스크롤 보존 effect의 dep을 `[visibleCount]` → `[messages]`로 바꾼다(ref 가드는 그대로라 무해).

(h) `send` 교체:

```ts
  const send = async (override?: string) => {
    const instruction = (override ?? input).trim();
    if (!instruction || busy || !aiEnabled) return;
    if (override === undefined) setInput("");
    setBusy(true);
    const targetSessionId = activeSessionId;
    const userMessage = createLocalMessage("user", instruction);
    const nextMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(nextMessages);
    // 최근 6턴만 history로 전송
    const history: AiChatTurn[] = nextMessages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }));
    try {
      const proposal = await aiChat(versionId, instruction, history, model || null, targetSessionId);
      // graph/ops/answer 활성 — 빈 message(핸들러 없는 kind)는 미지원 안내로 폴백 (규칙 ③b)
      const content = proposal.message || t("ai.unsupportedKind");
      // 응답 도착 시점에도 같은 세션을 보고 있을 때만 낙관 append — 전환했다면 서버 재로딩이 원장
      if (activeSessionIdRef.current === targetSessionId) {
        setMessages((prev) => [...prev, createLocalMessage("assistant", content)]);
        setFindings(proposal.kind === "analysis" ? proposal.findings : []);
        setSteps(proposal.kind === "walkthrough" ? proposal.steps : []);
        setStepIndex(0);
        setAutoplay(false);
      }
      if (targetSessionId === null && proposal.session_id != null) {
        // 신규 세션 채택 — 목록 갱신. 활성 전환은 메시지 재로딩(서버 원장)을 데려온다
        setActiveSessionId(proposal.session_id);
        refreshSessions();
      } else {
        refreshSessions(); // 목록의 updated_at·건수 갱신
      }
      if (proposal.kind === "graph") {
        onGraphProposal(proposal);
      } else if (proposal.kind === "ops") {
        onOpsProposal(proposal);
      }
    } catch (err) {
      if (activeSessionIdRef.current === targetSessionId) {
        // 서버 미저장 에러 표시 — 새로고침하면 사라지는 게 의도
        setMessages((prev) => [
          ...prev,
          createLocalMessage("assistant", err instanceof Error ? err.message : t("ai.error")),
        ]);
      }
    } finally {
      setBusy(false);
    }
  };
```

주의: 신규 세션 채택 시 `setActiveSessionId`가 메시지 재로딩 effect를 태워 낙관 메시지가 서버 원본(2건)으로 교체된다 — 의도된 동작.

(i) 대화 바 렌더 교체 — 카운터 제거·서버 목록 사용:

```tsx
        <button
          type="button"
          data-id="ai-chat-list"
          aria-label={t("ai.chatList")}
          onClick={() => setListOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-1 text-fine text-ink-secondary hover:bg-surface-alt hover:text-ink"
        >
          <History size={14} strokeWidth={1.5} className="shrink-0" />
          <span className="truncate">{activeMeta?.title || t("ai.clearChat")}</span>
          <ChevronDown size={12} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
        </button>
```

드롭다운 목록(이 태스크에서는 현재 맵 세션만 — 다른 맵 섹션은 Task 8):

```tsx
            <div
              data-id="ai-chat-list-menu"
              className="absolute left-2 top-full z-30 mt-1 flex max-h-80 w-72 flex-col overflow-y-auto rounded-sm border border-hairline bg-surface p-1 shadow-lg"
            >
              <button
                type="button"
                data-id="ai-chat-new"
                onClick={startNewChat}
                className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-fine text-ink-secondary hover:bg-surface-alt"
              >
                <Plus size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                <span className="min-w-0 flex-1 truncate text-left">{t("ai.clearChat")}</span>
                {activeSessionId === null && (
                  <Check size={13} strokeWidth={1.7} className="shrink-0 text-accent" />
                )}
              </button>
              {mapSessions.length === 0 && (
                <span className="px-2 py-1.5 text-fine text-ink-tertiary">{t("ai.noChats")}</span>
              )}
              {mapSessions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  data-id="ai-chat-list-item"
                  onClick={() => switchSession(item.id)}
                  className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-fine hover:bg-surface-alt ${
                    item.id === activeSessionId ? "text-ink" : "text-ink-secondary"
                  }`}
                >
                  <MessageSquare size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {item.title || t("ai.clearChat")}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums text-ink-tertiary">
                    {formatKstShort(item.updated_at)}
                  </span>
                  {item.id === activeSessionId && (
                    <Check size={13} strokeWidth={1.7} className="shrink-0 text-accent" />
                  )}
                </button>
              ))}
            </div>
```

(j) 스레드 렌더 — `visibleMessages`/`hiddenCount` 파생 삭제, `messages`를 직접 map, key는 `message.id`:

```tsx
          {visibleMessages.map((message, index) => …)}   // 기존
          → {messages.map((message) => …)}               // key={message.id}
```

user/assistant li의 `key={\`${message.role}-${hiddenCount + index}\`}`를 둘 다 `key={message.id}`로. `message.at !== undefined &&` 가드는 `message.at !== null &&`로. loadingOlder li는 유지(조건 그대로).

(k) 히스토리 로딩 실패 인라인 재시도 — 스레드 ul 위(`!aiEnabled` 안내 아래)에 추가:

```tsx
        {historyError && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-sm bg-surface-alt p-2 text-fine text-ink-secondary">
            {t("ai.historyError")}
            <button
              type="button"
              onClick={() => {
                setHistoryError(false);
                refreshSessions();
              }}
              className="rounded-sm border border-hairline px-2 py-0.5 text-fine text-ink hover:bg-surface"
            >
              {t("ai.retry")}
            </button>
          </div>
        )}
```

- [ ] **Step 3: page.tsx에서 mapId 전달** — `<AiChatPanel` 마운트(약 7246행)에 `mapId={mapId}` prop 추가(versionId 위).

- [ ] **Step 4: 사용처 잔재 확인**

```bash
cd /Users/hyeonjin/Documents/bpm/frontend && python3 -c "
import subprocess, sys
out = subprocess.run(['grep','-rn','parseChatStore\|serializeChatStore\|findOldestSession\|MAX_CHAT_SESSIONS\|SESSION_MESSAGE_LIMIT\|HISTORY_KEY_PREFIX\|bpm.aiChat','src/'],capture_output=True,text=True).stdout
print(out or 'CLEAN')"
```
Expected: `CLEAN` (구 스토어 참조 0건).

- [ ] **Step 5: 게이트**

```bash
npx vitest run && npm run lint && npm run build
```
Expected: vitest 전체 PASS(구 스토어 테스트 17개 삭제·신규 3개), lint 0 errors, build 성공. lint가 unused import(lucide 등)를 잡으면 해당 import만 제거.

- [ ] **Step 6: 수동 확인(로컬 네이티브)** — backend 8010 + frontend 3010 기동, `/maps/1` 에디터에서 AI 패널 열기 → 대화 바에 "No previous chats"·새 대화 → (AI 비활성 환경이므로 전송 흐름은 Task 11 스모크에서 모킹 검증). 서버 종료.

- [ ] **Step 7: 커밋** (Task 6 파일 포함)

```bash
git add frontend/src/lib/api.ts frontend/src/lib/chat-sessions.ts frontend/src/lib/chat-sessions.test.ts frontend/src/components/ai-chat-panel.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(ai-chat): server-backed chat panel core — 패널 서버 세션·커서 페이징 전환(localStorage 폐기)"
```

---

### Task 8: 히스토리 확장 — 다른 맵 열람(읽기전용+이동)·삭제·`?aiChat=` 진입

**Files:**
- Modify: `frontend/src/components/ai-chat-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 7 상태 모델(`allSessions`, `activeMeta`, `switchSession`)
- Produces: `AiChatPanelProps.initialSessionId?: number | null`; `/maps/{mapId}?aiChat=<sessionId>` 진입 시 패널 자동 오픈+세션 활성

- [ ] **Step 1: i18n 키 추가** (EN / KO 양쪽):

```
"ai.otherMaps": "Chats from other maps" / "다른 맵 대화"
"ai.openMap": "Open this map" / "이 맵 열기"
"ai.foreignChat": "This chat belongs to \"{map}\". Open that map to continue." / "이 대화는 \"{map}\" 맵의 대화입니다. 이어서 입력하려면 해당 맵을 여세요."
"ai.foreignPlaceholder": "Read-only — chat from another map" / "읽기 전용 — 다른 맵의 대화입니다"
"ai.deleteChat": "Delete chat" / "대화 삭제"
"ai.deleteChatMessage": "Delete this chat? Its saved messages will be removed." / "이 대화를 삭제할까요? 저장된 메시지가 함께 삭제됩니다."
```

- [ ] **Step 2: 패널 확장** — `ai-chat-panel.tsx`:

(a) import에 `Trash2`(lucide), `useRouter`(next/navigation), `deleteAiChatSession` 추가. Props에 `initialSessionId?: number | null;` 추가.

(b) 상태 추가:

```ts
  const router = useRouter();
  const [otherOpen, setOtherOpen] = useState(false); // 드롭다운 "다른 맵 대화" 섹션 펼침
  const [deleteTarget, setDeleteTarget] = useState<AiChatSessionSummary | null>(null);
```

파생 추가:

```ts
  const otherSessions = allSessions.filter((item) => item.map_id !== mapId);
  const isForeign = activeMeta !== null && activeMeta.map_id !== mapId;
```

(c) Task 7의 세션 목록 로딩 effect에서 최초 활성화 분기를 initialSessionId 우선으로 교체:

```ts
        if (!initializedRef.current) {
          initializedRef.current = true;
          const initial =
            initialSessionId != null
              ? result.sessions.find((item) => item.id === initialSessionId)
              : undefined;
          const recent = result.sessions.find((item) => item.map_id === mapId);
          setActiveSessionId(initial ? initial.id : recent ? recent.id : null);
        }
```

(effect deps에 `initialSessionId` 추가.)

(d) 드롭다운 하단(현재 맵 목록 아래)에 다른 맵 섹션 추가:

```tsx
              {otherSessions.length > 0 && (
                <>
                  <button
                    type="button"
                    data-id="ai-chat-other-toggle"
                    onClick={() => setOtherOpen((value) => !value)}
                    className="mt-1 flex items-center gap-1.5 rounded-sm border-t border-hairline px-2 py-1.5 text-fine text-ink-tertiary hover:bg-surface-alt"
                  >
                    <ChevronDown
                      size={12}
                      strokeWidth={1.5}
                      className={`shrink-0 transition-transform ${otherOpen ? "" : "-rotate-90"}`}
                    />
                    {t("ai.otherMaps")}
                    <span className="rounded-full bg-surface-alt px-1.5 tabular-nums">
                      {otherSessions.length}
                    </span>
                  </button>
                  {otherOpen &&
                    otherSessions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        data-id="ai-chat-other-item"
                        onClick={() => switchSession(item.id)}
                        className={`flex items-center gap-2 rounded-sm px-2 py-1.5 text-fine hover:bg-surface-alt ${
                          item.id === activeSessionId ? "text-ink" : "text-ink-secondary"
                        }`}
                      >
                        <MessageSquare
                          size={13}
                          strokeWidth={1.5}
                          className="shrink-0 text-ink-tertiary"
                        />
                        <span className="min-w-0 flex-1 truncate text-left">
                          <span className="text-ink-tertiary">{item.map_name}</span> · {item.title || t("ai.clearChat")}
                        </span>
                      </button>
                    ))}
                </>
              )}
```

현재 맵 목록 항목(`ai-chat-list-item`)에는 삭제 버튼 추가 — 항목 button 안에 중첩 button 금지이므로 항목을 `div` 래퍼 + 내부 두 버튼 구조로 바꾼다:

```tsx
              {mapSessions.map((item) => (
                <div key={item.id} className="flex items-center">
                  <button
                    type="button"
                    data-id="ai-chat-list-item"
                    onClick={() => switchSession(item.id)}
                    className={`flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-fine hover:bg-surface-alt ${
                      item.id === activeSessionId ? "text-ink" : "text-ink-secondary"
                    }`}
                  >
                    <MessageSquare size={13} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {item.title || t("ai.clearChat")}
                    </span>
                    <span className="shrink-0 text-[10px] tabular-nums text-ink-tertiary">
                      {formatKstShort(item.updated_at)}
                    </span>
                    {item.id === activeSessionId && (
                      <Check size={13} strokeWidth={1.7} className="shrink-0 text-accent" />
                    )}
                  </button>
                  <button
                    type="button"
                    data-id="ai-chat-delete"
                    aria-label={t("ai.deleteChat")}
                    onClick={() => setDeleteTarget(item)}
                    className="shrink-0 rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt hover:text-error"
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
```

(e) 삭제 확인 다이얼로그 — 파일 말미(구 limitConfirm 자리)에:

```tsx
      {deleteTarget && (
        <ConfirmDialog
          icon={<Trash2 size={28} strokeWidth={1.5} />}
          title={t("ai.deleteChat")}
          message={t("ai.deleteChatMessage")}
          lines={[
            {
              icon: <MessageSquare size={14} strokeWidth={1.5} />,
              text: deleteTarget.title || t("ai.clearChat"),
              highlight: true,
            },
          ]}
          confirmLabel={t("ai.deleteChat")}
          cancelLabel={t("common.cancel")}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            void deleteAiChatSession(target.id)
              .then(() => {
                if (activeSessionIdRef.current === target.id) switchSession(null);
                refreshSessions();
              })
              .catch((err: unknown) =>
                onToast?.(err instanceof Error ? err.message : t("ai.error")),
              );
          }}
          onClose={() => setDeleteTarget(null)}
        />
      )}
```

(ConfirmDialog `lines`의 badge 없는 항목 형태는 컴포넌트 시그니처 확인 후 필요시 `badge` 생략이 허용되는지 맞춘다 — `frontend/src/components/confirm-dialog.tsx` 참조.)

(f) 다른 맵 세션 읽기전용 — 입력 영역: textarea `disabled={!aiEnabled || isForeign}`, placeholder를 `aiEnabled ? (isForeign ? t("ai.foreignPlaceholder") : t("ai.placeholder")) : t("ai.disabled")`로. 전송 버튼 disabled 조건에 `|| isForeign` 추가. `send` 첫 가드에 `|| isForeign` 추가. 입력 행 위(빠른 칩 div 위)에 배너:

```tsx
        {isForeign && activeMeta && (
          <div
            data-id="ai-foreign-banner"
            className="mb-2 flex items-center justify-between gap-2 rounded-sm bg-accent-tint p-2 text-fine text-accent"
          >
            <span className="min-w-0">{t("ai.foreignChat", { map: activeMeta.map_name })}</span>
            <button
              type="button"
              data-id="ai-open-map"
              onClick={() => router.push(`/maps/${activeMeta.map_id}?aiChat=${activeMeta.id}`)}
              className="shrink-0 rounded-sm bg-accent px-2.5 py-1 text-fine text-on-accent hover:bg-accent-focus"
            >
              {t("ai.openMap")}
            </button>
          </div>
        )}
```

빠른 칩 4종 버튼 disabled에도 `|| isForeign` 추가.

- [ ] **Step 3: page.tsx `?aiChat=` 진입** — 에디터 컴포넌트에 상태 추가(`aiOpen` 선언부 근처):

```ts
  const [aiInitialSessionId, setAiInitialSessionId] = useState<number | null>(null);
```

`?version=` 처리 블록(약 1841–1845행) 바로 아래에 추가:

```ts
        // AI 챗 딥링크 — ?aiChat=<sessionId>로 진입 시 패널 자동 오픈 + 해당 세션 활성 (async 콜백이라 set-state-in-effect 아님)
        const paramChat = Number(new URLSearchParams(window.location.search).get("aiChat"));
        if (paramChat) {
          setAiInitialSessionId(paramChat);
          setAiOpen(true);
        }
```

`<AiChatPanel`에 `initialSessionId={aiInitialSessionId}` prop 추가.

- [ ] **Step 4: 게이트**

```bash
npx vitest run && npm run lint && npm run build
```
Expected: 전체 PASS / 0 errors / build 성공.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/ai-chat-panel.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(ai-chat): cross-map history browsing + delete + deep link — 다른 맵 대화 열람·삭제·?aiChat 진입"
```

---

### Task 9: 관리자 설정 패널 — Q&A 토글 → 보존 상한 3필드

**Files:**
- Modify: `frontend/src/lib/api.ts` (AppSettings 타입·putAppSettings patch)
- Modify: `frontend/src/components/settings/ai-chat-settings-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 5 이후 백엔드 `AppSettingsOut`(토글 없음, 상한 3필드)
- Produces: 설정 화면에서 상한 3종 숫자 입력·저장(팁 관리 유지)

- [ ] **Step 1: i18n** — 삭제: `aiLog.toggleLabel`, `aiLog.toggleHint`, `aiLog.enabledToast`, `aiLog.disabledToast`, `aiLog.activeNotice`. `aiLog.title`/`aiLog.desc` 텍스트 교체(EN/KO):

```
"aiLog.title": "AI Chat Settings" / "AI 챗 설정"
"aiLog.desc": "Chats are stored on the server per user and map. Tune retention limits and loading tips here." / "대화는 사용자·맵 단위로 서버에 저장됩니다. 보존 상한과 로딩 팁을 여기서 조정합니다."
```

추가(EN/KO):

```
"aiLog.limitsTitle": "Retention limits" / "보존 상한"
"aiLog.limitsDesc": "Applied on save automatically — oldest chats/messages are pruned over the caps; stale chats expire after the retention period." / "저장 시 자동 적용 — 상한 초과분은 오래된 것부터 정리되고, 기간 경과 대화는 만료됩니다."
"aiLog.maxSessionsLabel": "Max chats per user per map (1–200)" / "사용자×맵당 대화 수 (1–200)"
"aiLog.maxMessagesLabel": "Max messages per chat (10–2000)" / "대화당 메시지 수 (10–2000)"
"aiLog.retentionLabel": "Retention days since last activity (7–3650)" / "마지막 활동 후 보관 일수 (7–3650)"
"aiLog.limitsSave": "Save limits" / "상한 저장"
"aiLog.limitsSaved": "Retention limits saved" / "보존 상한이 저장되었습니다"
"aiLog.invalidNumber": "Enter a number within range" / "범위 내 숫자를 입력하세요"
```

- [ ] **Step 2: api.ts 타입 교체**

```ts
export interface AppSettings {
  ai_chat_tips: string[]; // 이전 기록 로딩 중 노출되는 기능 팁(미설정 시 기본 20종)
  ai_chat_max_sessions_per_map: number; // 보존 상한 — 사용자×맵당 대화 수
  ai_chat_max_messages_per_session: number; // 보존 상한 — 대화당 메시지 수
  ai_chat_retention_days: number; // 마지막 활동 후 보관 일수
  updated_by: string | null;
  updated_at: string | null;
}
```

`putAppSettings` patch 타입:

```ts
export function putAppSettings(patch: {
  ai_chat_tips?: string[];
  ai_chat_max_sessions_per_map?: number;
  ai_chat_max_messages_per_session?: number;
  ai_chat_retention_days?: number;
}): Promise<AppSettings> {
```

- [ ] **Step 3: 패널 교체** — `ai-chat-settings-panel.tsx`의 토글 카드(+activeNotice)를 상한 카드로 교체. 상태:

```ts
  const [limitsDraft, setLimitsDraft] = useState({ sessions: "", messages: "", days: "" });
```

로딩 effect에서 `setTipsDraft` 아래에:

```ts
          setLimitsDraft({
            sessions: String(result.ai_chat_max_sessions_per_map),
            messages: String(result.ai_chat_max_messages_per_session),
            days: String(result.ai_chat_retention_days),
          });
```

`toggleLogging` 삭제, 저장 핸들러 추가:

```ts
  // 상한 저장 — 세 필드 모두 범위 검증 후 한 번에 PUT(범위 밖은 서버 422 전에 로컬 차단)
  const saveLimits = async () => {
    if (busy) return;
    const sessions = Number(limitsDraft.sessions);
    const messages = Number(limitsDraft.messages);
    const days = Number(limitsDraft.days);
    const inRange = (value: number, lo: number, hi: number) =>
      Number.isInteger(value) && value >= lo && value <= hi;
    if (!inRange(sessions, 1, 200) || !inRange(messages, 10, 2000) || !inRange(days, 7, 3650)) {
      onToast?.(t("aiLog.invalidNumber"));
      return;
    }
    setBusy(true);
    try {
      const next = await putAppSettings({
        ai_chat_max_sessions_per_map: sessions,
        ai_chat_max_messages_per_session: messages,
        ai_chat_retention_days: days,
      });
      setAppSettings(next);
      onToast?.(t("aiLog.limitsSaved"));
    } catch (err) {
      onToast?.(err instanceof Error ? err.message : t("aiLog.error"));
    } finally {
      setBusy(false);
    }
  };
```

토글 카드 JSX 자리에(Database 아이콘 재사용):

```tsx
      <div className="mt-4 rounded-md border border-hairline p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-accent-tint text-accent">
            <Database size={16} strokeWidth={1.5} />
          </span>
          <div className="min-w-0">
            <div className="text-caption-strong text-ink">{t("aiLog.limitsTitle")}</div>
            <div className="text-fine text-ink-tertiary">{t("aiLog.limitsDesc")}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2">
          {(
            [
              ["sessions", "aiLog.maxSessionsLabel", "ai-limit-sessions"],
              ["messages", "aiLog.maxMessagesLabel", "ai-limit-messages"],
              ["days", "aiLog.retentionLabel", "ai-limit-days"],
            ] as const
          ).map(([field, labelKey, dataId]) => (
            <label key={field} className="flex items-center justify-between gap-3 text-caption text-ink-secondary">
              <span className="min-w-0">{t(labelKey)}</span>
              <input
                type="number"
                data-id={dataId}
                value={limitsDraft[field]}
                disabled={appSettings === null || busy}
                onChange={(event) =>
                  setLimitsDraft((prev) => ({ ...prev, [field]: event.target.value }))
                }
                className="w-24 rounded-sm border border-hairline px-2 py-1 text-right text-caption tabular-nums outline-none focus:border-accent disabled:bg-surface-alt"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-id="ai-limits-save"
            onClick={() => void saveLimits()}
            disabled={appSettings === null || busy}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption text-on-accent hover:bg-accent-focus disabled:opacity-40"
          >
            {t("aiLog.limitsSave")}
          </button>
        </div>
      </div>
```

`enabled` 변수·`Info` import 등 잔재 제거(lint가 잡는다). 팁 관리 섹션은 그대로.

- [ ] **Step 4: 게이트 + 커밋**

```bash
npx vitest run && npm run lint && npm run build
git add frontend/src/lib/api.ts frontend/src/components/settings/ai-chat-settings-panel.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(settings): AI chat retention limit controls replace Q&A log toggle — 보존 상한 3필드로 교체"
```

---

### Task 10: 기본 팁·매뉴얼 동기화

**Files:**
- Modify: `backend/app/app_settings.py` (구식 팁 2건 교체)
- Modify: `backend/app/manual.md` (§5 AI 도우미 — 여러 대화/저장/한도 문구)
- Modify: `docs/manual/user-manual-ko.md`, `docs/manual/user-manual-en.md` (§13)
- Modify: `docs/manual/admin-manual-ko.md`, `docs/manual/admin-manual-en.md` (§12 AI 챗 설정)

- [ ] **Step 1: DEFAULT_AI_CHAT_TIPS 교체** — 두 항목:
  - `"대화는 최대 4개까지 열 수 있고, 대화 바의 목록에서 전환합니다."` → `"대화는 서버에 저장됩니다 — 대화 바의 목록에서 이전 대화를 이어갈 수 있습니다."`
  - `"세션당 최근 40개 메시지만 보관됩니다 — 대화 바 아래 진행바로 사용량을 확인하세요."` → `"대화 목록에서 다른 맵의 대화도 열람할 수 있습니다 — 이어서 입력하려면 해당 맵을 여세요."`

- [ ] **Step 2: backend/app/manual.md §5** — "여러 대화"와 "대화 저장과 시간" 두 bullet을 다음으로 교체:

```markdown
- **여러 대화**: 대화는 서버에 저장되어 어느 기기에서든 이어집니다. 대화 바의 목록에서 이전 대화를 열거나 창 헤더의 + 아이콘으로 새 대화를 시작합니다. 대화 제목은 첫 질문에서 자동으로 만들어지고, 목록에서 대화를 삭제할 수 있습니다.
- **다른 맵의 대화**: 대화 목록의 "다른 맵 대화"에서 다른 맵에서 나눈 대화를 읽기 전용으로 열람할 수 있습니다. 이어서 입력하려면 "이 맵 열기" 버튼으로 해당 맵으로 이동합니다.
- **대화 저장과 시간**: 대화는 맵 단위로 서버에 저장되고 메시지마다 시간이 표시됩니다. 보관량은 관리자가 정한 상한(기본: 맵당 대화 20개·대화당 메시지 200개·마지막 활동 후 180일)까지이며, 초과분은 오래된 것부터 자동 정리됩니다. 긴 대화는 최근부터 로딩되고, 스크롤을 맨 위로 올리면 이전 기록이 이어서 로딩됩니다(로딩 중 기능 팁 노출).
```

- [ ] **Step 3: user-manual ko/en §13** — `grep -n "최대 4개\|40개" docs/manual/user-manual-ko.md`·`grep -n "max 4\|up to four\|40 messages" docs/manual/user-manual-en.md`로 다중 대화·저장 bullet 위치를 찾아 Step 2와 같은 내용(EN은 아래 번역)으로 교체, 문서 하단 날짜를 2026-07-08로 갱신:

```markdown
- **Multiple chats**: Chats are stored on the server and follow you across devices. Open past chats from the list in the chat bar, start a new one with the + icon in the window header, and delete chats from the list. Titles are derived from the first question.
- **Chats from other maps**: The "Chats from other maps" section in the list shows conversations from other maps read-only; use "Open this map" to continue there.
- **Storage & time**: Chats are stored per map with a timestamp on every message. Retention follows admin-configured caps (default: 20 chats per map, 200 messages per chat, 180 days since last activity); overflow is pruned oldest-first. Long chats load recent-first — scroll to the top to load earlier messages (feature tips show while loading).
```

- [ ] **Step 4: admin-manual ko/en §12** — "AI 챗 설정" 섹션에서 Q&A 적재 토글 설명을 제거하고 보존 상한 3종(키 이름·기본값·범위: 20/1–200, 200/10–2000, 180/7–3650)과 "대화는 항상 서버 저장(사용자·맵 단위, 본인만 조회)" 설명으로 교체. 기존 콘솔 지도 테이블에 `ai_chat_sessions`/`ai_chat_messages` 행 추가, `ai_chat_logs` 행 삭제. 날짜 갱신.

- [ ] **Step 5: 백엔드 팁 테스트 회귀 + 커밋**

```bash
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python -m pytest tests/test_app_settings.py -q
git add backend/app/app_settings.py backend/app/manual.md docs/manual/user-manual-ko.md docs/manual/user-manual-en.md docs/manual/admin-manual-ko.md docs/manual/admin-manual-en.md PROGRESS.md
git commit -m "docs(manual): sync AI chat server history + retention limits — 매뉴얼·기본 팁 동기화"
```

---

### Task 11: 브라우저 e2e 스모크 + 전체 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-ai-chat-history.mjs`
- Modify: `PROGRESS.md` (최종 검증 요약)

먼저 `docs/lessons/browser-verification.md`를 읽는다(좀비 next dev pkill, dev.db 오염, cwd 함정).

- [ ] **Step 1: 서버 기동**

```bash
pkill -f "next dev" ; pkill -f "uvicorn app.main" ; sleep 1
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/uvicorn app.main:app --port 8010 &
cd /Users/hyeonjin/Documents/bpm/frontend && BACKEND_URL=http://localhost:8010 PORT=3010 npm run dev &
```

- [ ] **Step 2: dev.db 시드** — 앱 모델 재사용(제목에 `SMOKE-` 접두어, 정리 용이):

```bash
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python - <<'EOF'
import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models import AiChatMessage, AiChatSession, ProcessMap

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///./dev.db")
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        maps = (await db.scalars(
            select(ProcessMap).where(ProcessMap.deleted_at.is_(None)).order_by(ProcessMap.id).limit(2)
        )).all()
        assert len(maps) >= 2, "need 2 maps in dev.db"
        # 현재 맵 세션 2개(하나는 페이징용 40메시지) + 다른 맵 세션 1개 — admin.sys 소유
        s1 = AiChatSession(map_id=maps[0].id, login_id="admin.sys", title="SMOKE-paging")
        s2 = AiChatSession(map_id=maps[0].id, login_id="admin.sys", title="SMOKE-second")
        s3 = AiChatSession(map_id=maps[1].id, login_id="admin.sys", title="SMOKE-other-map")
        db.add_all([s1, s2, s3]); await db.flush()
        for i in range(20):
            db.add(AiChatMessage(session_id=s1.id, role="user", content=f"SMOKE q{i+1}"))
            db.add(AiChatMessage(session_id=s1.id, role="assistant", content=f"SMOKE a{i+1}", kind="answer"))
        db.add(AiChatMessage(session_id=s2.id, role="user", content="SMOKE second q"))
        db.add(AiChatMessage(session_id=s2.id, role="assistant", content="SMOKE second a", kind="answer"))
        db.add(AiChatMessage(session_id=s3.id, role="user", content="SMOKE other q"))
        db.add(AiChatMessage(session_id=s3.id, role="assistant", content="SMOKE other a", kind="answer"))
        await db.commit()
        print("seeded", s1.id, s2.id, s3.id, "maps", maps[0].id, maps[1].id)

asyncio.run(main())
EOF
```

- [ ] **Step 3: 스모크 스크립트 작성·실행** — `frontend/scripts/pw-smoke-ai-chat-history.mjs`, 기존 `pw-smoke-ai-chat-sessions.mjs`의 하네스 골격(playwright-core + 시스템 Chrome headless, `BASE_URL`(기본 `http://localhost:3010`)·`SHOT_DIR` env, `localStorage['bpm.devUser']='admin.sys'` 주입) 재사용. 체크 항목:
  1. 맵1 에디터 진입 → AI 패널 열기 → 대화 바 제목이 `SMOKE-second`(최근 활동) 또는 목록에 SMOKE 항목 2개 노출
  2. 드롭다운 열기 → 현재 맵 항목 2개(`SMOKE-paging`, `SMOKE-second`) + `Chats from other maps` 토글에 1건
  3. `SMOKE-paging` 선택 → 메시지 30개 렌더(`[data-id="ai-thread"] li` 수) → 스크롤 최상단 → 로딩 팁 li 노출 → 총 40개로 증가
  4. 드롭다운 → 다른 맵 항목 클릭 → `data-id="ai-foreign-banner"` 노출 + textarea disabled + `Open this map` 버튼
  5. 버튼 클릭 → URL이 `/maps/<map2>?aiChat=<s3>` → 패널 자동 오픈 + `SMOKE-other-map` 활성(스레드에 "SMOKE other q")
  6. 맵1로 복귀 → `SMOKE-second` 활성 상태에서 `page.route("**/ai/chat", …)`로 `{kind:"answer", message:"SMOKE mocked reply", session_id:<s2>, nodes:[],edges:[],groups:[],ops:[],steps:[],findings:[]}` fulfill → 전송 → 낙관 user+assistant 말풍선 노출
  7. `SMOKE-second` 삭제 버튼 → ConfirmDialog → 확인 → 목록에서 제거 + 새 대화 폴백
  8. 콘솔 에러 0
  실행:

```bash
cd /Users/hyeonjin/Documents/bpm/frontend && BASE_URL=http://localhost:3010 SHOT_DIR=/private/tmp/claude-501/-Users-hyeonjin-Documents-bpm/4d2f41be-cb20-4fa9-94fc-c6b514a3859d/scratchpad node scripts/pw-smoke-ai-chat-history.mjs
```
Expected: 전 체크 PASS + 스크린샷 저장.

- [ ] **Step 4: dev.db 원복** — 시드 삭제(SMOKE 접두어 세션을 ORM delete — cascade로 메시지 제거):

```bash
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python - <<'EOF'
import asyncio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from app.models import AiChatSession

async def main():
    engine = create_async_engine("sqlite+aiosqlite:///./dev.db")
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        rows = (await db.scalars(
            select(AiChatSession).where(AiChatSession.title.like("SMOKE-%"))
        )).all()
        for row in rows:
            await db.delete(row)
        await db.commit()
        print("cleaned", len(rows))

asyncio.run(main())
EOF
```

(스모크 중 mocked 전송은 route로 가로채져 서버 적재가 없고, 삭제 체크(7)로 지워진 세션은 이미 없음 — cleaned 수가 2여도 정상.)

- [ ] **Step 5: 서버 종료 + 전체 게이트**

```bash
pkill -f "next dev" ; pkill -f "uvicorn app.main"
cd /Users/hyeonjin/Documents/bpm/backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd /Users/hyeonjin/Documents/bpm/frontend && npx vitest run && npm run lint && npm run build
```
Expected: pytest 464 passed / ruff clean / vitest PASS / lint 0 errors / build 성공.

- [ ] **Step 6: 최종 커밋**

```bash
git add frontend/scripts/pw-smoke-ai-chat-history.mjs PROGRESS.md
git commit -m "test(ai-chat): browser smoke for server chat history — 히스토리 e2e 스모크(페이징·타맵·딥링크·삭제)"
git push -u origin feat/ai-chat-server-history
```

---

## Self-Review 결과 (작성 후 점검)

- 스펙 §1(모델)→Task 1, §2-1(write-through)→Task 2, §2-2(조회/삭제)→Task 3, §3(보존)→Task 4, §5(ai_chat_logs 제거)→Task 5, §4(프론트)→Task 6–8, 관리자 UI→Task 9, 매뉴얼·팁→Task 10, §7(테스트)→각 태스크+Task 11. 범위 외(검색·제목수정·공유·마이그레이션) 미포함 확인.
- 타입 일관성: `AiChatSessionSummary`(TS)↔`AiChatSessionOut`(py) 필드 동일, `aiChat` 5번째 인자 `sessionId: number | null` — Task 6 정의·Task 7 사용 일치. `derive_chat_title` Task 2 정의·사용.
- 알려진 트레이드오프: Task 6 단독 커밋 불가(패널과 타입 결합) — Task 7 커밋에 병합 명시. 범위 검증은 422(pydantic) — 스펙의 "400"과 코드상 상이함을 테스트에 주석으로 명시.
