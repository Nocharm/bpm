# AI 사용량 계측·집계(B1) + 매뉴얼 섹션 선별(B2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** vLLM 응답 usage를 호출별 이벤트로 저장해 관리자 대시보드에 집계 표시하고(B1), 매뉴얼 30k 단순 절단을 질문 관련 섹션 선별로 대체한다(B2).

**Architecture:** `ai_client.call_ai`를 `AiReply(content, prompt_tokens, completion_tokens)` 반환으로 확장(교체 경계 파일 원칙)하고, `_ask_and_validate`가 시도 전체의 usage를 누적해 핸들러가 성공/실패 이벤트(`ai_usage_events`, create_all 자동 생성)를 기록한다. 집계는 기존 sysadmin 라우터 `dashboard.py`에 엔드포인트 추가 + `DashboardPanel` 스텁 확장. B2는 순수 함수 `select_manual_sections`(## 분할·2-gram 점수·TOC+budget)를 `_load_manual_text` 뒤에 끼운다.

**Tech Stack:** FastAPI + SQLAlchemy(async), Next.js/React, pytest, vitest, playwright-core

**Spec:** `docs/superpowers/specs/2026-07-11-ai-usage-manual-select-design.md`

## Global Constraints

- 브랜치: 워크트리 `ai-usage-manual` (EnterWorktree, origin/main 기준). **머지는 사용자 최종 확인 후 — 브랜치 완료 시점에 멈춘다.**
- 질문 원문은 어떤 테이블에도 저장하지 않는다(구 ai_chat_logs 폐기 취지).
- `tests/test_ai.py`의 `_fake_ai` 시그니처 변경은 한 곳만 — 다른 테스트 파일은 import로 전파.
- 이벤트 기록 실패가 API 응답(성공 200/실패 502)을 바꾸면 안 된다.
- 신규 테이블은 models.py 클래스 추가만(create_all 자동, `LoginRecord` 선례) — `_ADDED_COLUMNS` 불필요(신규 테이블이므로).
- 시간은 `app.clock.now`(KST) — 프론트 표시는 기존 포맷 관례.
- UI 텍스트 영어, i18n EN/KO 양쪽, raw hex 금지, 신규 구조 요소 data-id. 프론트 게이트에 `tsc --noEmit` 필수.
- ⚠️ 브래킷 경로 검색은 `git grep`.
- 커밋 직전 `PROGRESS.md`에 새 섹션 `## 2026-07-11 — AI 사용량 계측·매뉴얼 선별 (worktree-ai-usage-manual)`(첫 커밋에서 생성) 아래 한 줄 추가, 코드와 같은 커밋.
- 커밋 메시지 `type(scope): English summary — 한국어 요약` + 트레일러 2줄(Co-Authored-By: Claude Fable 5 / Claude-Session 링크).
- 게이트: backend `.venv/bin/python -m pytest tests/ -q`+`.venv/bin/ruff check app/ tests/`, frontend `npx vitest run`+`node_modules/.bin/tsc --noEmit -p tsconfig.json`+`npm run lint`+`npm run build`.

---

### Task 1: ai_client AiReply + usage 누적 (TDD)

**Files:**
- Modify: `backend/app/ai_client.py`
- Modify: `backend/app/routers/ai.py` (`_ask_and_validate`)
- Test: `backend/tests/test_ai.py`

**Interfaces:**
- Consumes: 현행 `call_ai(messages, model) -> str`(ai_client.py:83-101, `data["usage"]` 폐기 중), `_ask_and_validate(messages, model) -> AiProposal`(ai.py:105-123), `_fake_ai(content)`(test_ai.py:101-105, content 문자열 반환 목).
- Produces: `AiReply` dataclass(`content: str, prompt_tokens: int | None, completion_tokens: int | None`), `call_ai(...) -> AiReply`, `_ask_and_validate(...) -> tuple[AiProposal, AiUsageTotals]` — `AiUsageTotals`는 `ai.py` 모듈의 dataclass(`prompt_tokens: int | None, completion_tokens: int | None`, 시도 전체 누적). `_fake_ai`는 AiReply 반환(기본 usage: prompt 100/completion 50 — 테스트 단언용 고정값). Task 2가 이 튜플을 소비.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai.py`의 `_fake_ai`(:101-105)를 다음으로 교체:

```python
def _fake_ai(content: str, prompt_tokens: int | None = 100, completion_tokens: int | None = 50):
    async def _call(messages: list[dict], model: str | None = None) -> ai_client.AiReply:
        return ai_client.AiReply(
            content=content, prompt_tokens=prompt_tokens, completion_tokens=completion_tokens
        )

    return _call
```

파일 끝에 추가:

```python
# ── usage 계측 — AiReply·누적 (design 2026-07-11 B1) ─────────────


def test_call_ai_returns_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    """OpenAI 호환 usage를 AiReply로 반환 — usage 없는 비표준 응답은 None 방어."""
    import httpx2

    class _Resp:
        def raise_for_status(self) -> None: ...
        def json(self) -> dict:
            return {
                "choices": [{"message": {"content": "{}"}}],
                "usage": {"prompt_tokens": 321, "completion_tokens": 45},
            }

    class _Client:
        def __init__(self, *args, **kwargs) -> None: ...
        async def __aenter__(self) -> "_Client":
            return self
        async def __aexit__(self, *exc) -> None: ...
        async def post(self, *args, **kwargs) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx2, "AsyncClient", _Client)
    reply = asyncio_run_reply()
    assert reply.content == "{}"
    assert reply.prompt_tokens == 321
    assert reply.completion_tokens == 45


def asyncio_run_reply():
    import asyncio

    from app.ai_client import call_ai

    return asyncio.run(call_ai([{"role": "user", "content": "x"}]))


def test_call_ai_usage_absent_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx2

    class _Resp:
        def raise_for_status(self) -> None: ...
        def json(self) -> dict:
            return {"choices": [{"message": {"content": "ok"}}]}

    class _Client:
        def __init__(self, *args, **kwargs) -> None: ...
        async def __aenter__(self) -> "_Client":
            return self
        async def __aexit__(self, *exc) -> None: ...
        async def post(self, *args, **kwargs) -> _Resp:
            return _Resp()

    monkeypatch.setattr(httpx2, "AsyncClient", _Client)
    reply = asyncio_run_reply()
    assert reply.content == "ok"
    assert reply.prompt_tokens is None
    assert reply.completion_tokens is None
```

(주의: `asyncio_run_reply`는 위처럼 헬퍼로 빼되 두 테스트 사이 한 번만 정의. 기존 테스트 파일이 pytest-asyncio를 쓰면 그 관례를 따르라 — `git grep -n "asyncio" backend/tests/test_ai.py`로 확인 후 기존 async 테스트 관례가 있으면 그 형태로.)

- [ ] **Step 2: 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai.py -q`
Expected: FAIL — `AiReply` 부재(AttributeError/ImportError), 기존 `_fake_ai` 사용 테스트들은 문자열 반환 가정과 충돌.

- [ ] **Step 3: 구현**

**(a)** `backend/app/ai_client.py` — dataclass 추가 + call_ai 반환 교체:

```python
@dataclass(frozen=True)
class AiReply:
    """chat/completions 1회 응답 — 본문 + usage(비표준 서버는 None)."""

    content: str
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
```

`call_ai` 끝부분(:100-101) 교체:

```python
    usage = data.get("usage") or {}
    return AiReply(
        content=data["choices"][0]["message"]["content"],
        prompt_tokens=usage.get("prompt_tokens"),
        completion_tokens=usage.get("completion_tokens"),
    )
```

(시그니처의 반환 타입 힌트도 `-> AiReply`로. docstring에 usage 반환 명시.)

**(b)** `backend/app/routers/ai.py` — 모듈 상단에 dataclass 추가(import `dataclass` from dataclasses):

```python
@dataclass
class AiUsageTotals:
    """한 요청의 AI 호출 usage 누적 — 재프롬프트 재시도분 포함(둘 다 과금되므로 합산)."""

    prompt_tokens: int | None = None
    completion_tokens: int | None = None

    def add(self, reply: ai_client.AiReply) -> None:
        if reply.prompt_tokens is not None:
            self.prompt_tokens = (self.prompt_tokens or 0) + reply.prompt_tokens
        if reply.completion_tokens is not None:
            self.completion_tokens = (self.completion_tokens or 0) + reply.completion_tokens
```

`_ask_and_validate`를 usage 누적·튜플 반환으로 교체:

```python
async def _ask_and_validate(
    messages: list[dict], model: str | None
) -> tuple[AiProposal, AiUsageTotals]:
    """AI 호출 + JSON 검증. 검증 실패 시 1회 재프롬프트, 그래도 실패면 502.

    usage는 시도 전체를 누적해 반환 — 실패로 끝나도 호출자가 기록할 수 있게
    HTTPException에 totals를 실어 던진다(exc.usage_totals).
    """
    totals = AiUsageTotals()
    for attempt in range(2):
        try:
            reply = await ai_client.call_ai(messages, model)
        except Exception as exc:  # noqa: BLE001 -- 외부 AI 서버 오류는 502로 일괄 변환
            # exc는 내부 GPU 주소를 담을 수 있어 클라이언트엔 노출 금지 — 서버 로그에만 기록
            logger.warning("AI server call failed: %s", exc)
            http_exc = HTTPException(status_code=502, detail="AI server error")
            http_exc.usage_totals = totals  # type: ignore[attr-defined]
            raise http_exc from exc
        totals.add(reply)
        try:
            return AiProposal.model_validate_json(_extract_json(reply.content)), totals
        except ValueError as exc:
            # 원본 출력(모델 텍스트, 비밀 아님)을 서버 로그에만 기록 — 502 원인 진단용. 클라이언트엔 일반 메시지만.
            logger.warning(
                "AI response invalid (attempt %d): %s | raw=%.800s", attempt, exc, reply.content
            )
            if attempt == 0:
                messages = [*messages, {"role": "user", "content": "유효한 JSON 한 개만 반환하세요."}]
                continue
    http_exc = HTTPException(status_code=502, detail="AI returned invalid response")
    http_exc.usage_totals = totals  # type: ignore[attr-defined]
    raise http_exc
```

핸들러의 호출부(:169)를 `proposal, usage = await _ask_and_validate(messages, payload.model)`로 (usage는 Task 2가 사용 — 이 태스크에서는 변수만 받아둔다. ruff의 unused 경고가 나면 `_usage`로 받았다가 Task 2에서 개명).

- [ ] **Step 4: 전체 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 PASS(기존 `_fake_ai` 소비 테스트 전부 — test_ai_chat_history 포함 — AiReply 전파로 통과), ruff 클린.

- [ ] **Step 5: 커밋**

```bash
git add backend/app/ai_client.py backend/app/routers/ai.py backend/tests/test_ai.py PROGRESS.md
git commit -m "feat(ai): return usage from AI adapter — AiReply·usage 누적 반환"
```

(PROGRESS 한 줄: `- B1 1/3: call_ai가 usage를 AiReply로 반환, _ask_and_validate가 시도 전체 누적(실패 시 HTTPException에 동봉).`)

---

### Task 2: ai_usage_events 테이블 + 성공/실패 기록 (TDD)

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/routers/ai.py` (핸들러)
- Test: `backend/tests/test_ai_chat_history.py`

**Interfaces:**
- Consumes: Task 1의 `tuple[AiProposal, AiUsageTotals]`·`exc.usage_totals`, 기존 write-through 블록(ai.py:179-215), `_fake_ai(content, prompt_tokens, completion_tokens)`.
- Produces: `AiUsageEvent` ORM(테이블 `ai_usage_events`) — Task 3의 집계가 소비. 필드: `id, occurred_at, login_id, map_id, version_id, model, kind, prompt_tokens, completion_tokens, ok`.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_ai_chat_history.py` 끝에 추가 (`_read_table` 헬퍼 재사용):

```python
# ── AI 사용량 이벤트 (design 2026-07-11 B1) ─────────────


def test_ai_usage_event_recorded_on_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)
    monkeypatch.setattr(
        ai_client,
        "call_ai",
        _fake_ai(json.dumps({"kind": "answer", "message": "hi"}), prompt_tokens=1234, completion_tokens=56),
    )
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_usage_events"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "질문"})
    assert resp.status_code == 200
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    event = events[-1]
    assert event["ok"] in (True, 1)  # sqlite bool 표현 관용
    assert event["kind"] == "answer"
    assert event["prompt_tokens"] == 1234
    assert event["completion_tokens"] == 56
    assert event["version_id"] == version_id
    assert event["login_id"]  # 호출 사용자 기록


def test_ai_usage_event_recorded_on_failure(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    _enable_ai(monkeypatch)

    async def _boom(messages: list[dict], model: str | None = None):
        raise RuntimeError("gpu down")

    monkeypatch.setattr(ai_client, "call_ai", _boom)
    version_id = _draft_version_checked_out(client)
    before = len(_read_table(client, "ai_usage_events"))
    resp = client.post(f"/api/versions/{version_id}/ai/chat", json={"instruction": "유령?"})
    assert resp.status_code == 502
    events = _read_table(client, "ai_usage_events")
    assert len(events) == before + 1
    event = events[-1]
    assert event["ok"] in (False, 0)
    assert event["kind"] is None
    assert event["prompt_tokens"] is None
    # 실패 시에도 대화 메시지는 저장되지 않는다(기존 계약 유지)
    # — test_chat_no_rows_when_ai_fails가 이미 보증하므로 여기선 이벤트만 단언
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_ai_chat_history.py -q`
Expected: FAIL — `ai_usage_events` 테이블 부재(admin tables 404 또는 KeyError).

- [ ] **Step 3: 구현**

**(a)** `backend/app/models.py` — `LoginRecord` 클래스 아래에 추가:

```python
class AiUsageEvent(Base):
    """AI 호출 1건의 usage 기록 — 원문(질문 내용) 없이 계량만. 대시보드 집계용 (design 2026-07-11)."""

    __tablename__ = "ai_usage_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, index=True
    )
    login_id: Mapped[str] = mapped_column(String(100), index=True)
    # FK 아님 — 맵/버전이 삭제돼도 통계 보존 (ai_chat_messages.version_id와 동일 관례)
    map_id: Mapped[int] = mapped_column(Integer)
    version_id: Mapped[int] = mapped_column(Integer)
    model: Mapped[str] = mapped_column(String(200), default="")  # 요청 선택자(빈값=서버 기본)
    kind: Mapped[str | None] = mapped_column(String(20), default=None)  # 실패 시 None
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, default=None)
    ok: Mapped[bool] = mapped_column(Boolean, default=True)
```

(`Boolean`이 models.py import에 없으면 sqlalchemy import에 추가 — `git grep -n "from sqlalchemy import" backend/app/models.py`로 확인.)

**(b)** `backend/app/routers/ai.py` 핸들러 — `_ask_and_validate` 호출을 try로 감싸 실패 이벤트 기록:

```python
    try:
        proposal, usage = await _ask_and_validate(messages, payload.model)
    except HTTPException as exc:
        totals = getattr(exc, "usage_totals", None)
        # 실패도 계량 — 이벤트 기록이 502 전파를 막지 않게 별도 커밋·예외 무시
        try:
            session.add(
                AiUsageEvent(
                    login_id=user,
                    map_id=version.map_id,
                    version_id=version_id,
                    model=payload.model or "",
                    kind=None,
                    prompt_tokens=getattr(totals, "prompt_tokens", None),
                    completion_tokens=getattr(totals, "completion_tokens", None),
                    ok=False,
                )
            )
            await session.commit()
        except Exception:  # noqa: BLE001 -- 계량 실패는 원 응답(502)을 바꾸지 않는다
            await session.rollback()
            logger.warning("AI usage event insert failed (failure path)")
        raise
```

성공 경로: write-through 블록의 `await session.commit()` **직전**(prune 다음)에 성공 이벤트를 같은 트랜잭션에 동봉:

```python
    # 사용량 이벤트 — 대화와 같은 트랜잭션(원문 없이 계량만)
    session.add(
        AiUsageEvent(
            login_id=user,
            map_id=version.map_id,
            version_id=version_id,
            model=payload.model or "",
            kind=proposal.kind,
            prompt_tokens=usage.prompt_tokens,
            completion_tokens=usage.completion_tokens,
            ok=True,
        )
    )
```

import에 `AiUsageEvent` 추가(models import 라인).

- [ ] **Step 4: 전체 통과 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 PASS + ruff 클린. (`test_chat_tables_registered`에 `ai_usage_events`가 자동 노출되는지는 무관 — 그 테스트는 2테이블 포함 여부만 단언.)

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models.py backend/app/routers/ai.py backend/tests/test_ai_chat_history.py PROGRESS.md
git commit -m "feat(ai): record per-call usage events — 호출별 사용량 이벤트(성공 동봉·실패 별도 커밋)"
```

(PROGRESS 한 줄: `- B1 2/3: ai_usage_events 테이블(create_all 자동)·성공은 write-through 동봉·실패는 ok=false 별도 커밋(502 전파 유지).`)

---

### Task 3: 집계 API — GET /api/dashboard/ai-usage (TDD)

**Files:**
- Modify: `backend/app/routers/dashboard.py`
- Modify: `backend/app/schemas.py` (`DashboardMetricsOut` 부근)
- Test: `backend/tests/test_dashboard.py` (기존 파일 있으면 추가, 없으면 생성 — `git grep -l "dashboard" backend/tests/`로 확인)

**Interfaces:**
- Consumes: Task 2의 `AiUsageEvent`, 기존 `require_sysadmin` 전역 게이트(dashboard.py:15), `now_kst`.
- Produces: `GET /api/dashboard/ai-usage` → `AiUsageOut` — Task 5 프론트가 소비. 스키마:

```python
class AiUsagePeriodOut(BaseModel):
    calls: int
    failed: int
    prompt_tokens: int
    completion_tokens: int


class AiUsageTopUserOut(BaseModel):
    login_id: str
    name: str
    calls: int
    total_tokens: int


class AiUsageTopMapOut(BaseModel):
    map_id: int
    name: str
    calls: int
    total_tokens: int


class AiUsageOut(BaseModel):
    last7: AiUsagePeriodOut
    last30: AiUsagePeriodOut
    top_users: list[AiUsageTopUserOut]  # 30일, total_tokens desc, 5개
    top_maps: list[AiUsageTopMapOut]
```

- [ ] **Step 1: 실패하는 테스트 작성**

테스트 파일에 (act_as/enforce 불필요 — 기본 스위트는 전원 sysadmin):

```python
"""대시보드 AI 사용량 집계 (design 2026-07-11 B1)."""

import asyncio
from datetime import timedelta

from fastapi.testclient import TestClient

from app.clock import now as now_kst
from app.db import SessionLocal
from app.models import AiUsageEvent


def _seed_events(rows: list[dict]) -> None:
    async def _run() -> None:
        async with SessionLocal() as session:
            for row in rows:
                session.add(AiUsageEvent(**row))
            await session.commit()

    asyncio.run(_run())


def test_ai_usage_aggregates_and_top_lists(client: TestClient) -> None:
    old = now_kst() - timedelta(days=40)  # 30일 창 밖 — 집계 제외 확인용
    _seed_events(
        [
            {"login_id": "user.a", "map_id": 901, "version_id": 1, "kind": "answer",
             "prompt_tokens": 1000, "completion_tokens": 100, "ok": True},
            {"login_id": "user.a", "map_id": 901, "version_id": 1, "kind": "graph",
             "prompt_tokens": 2000, "completion_tokens": 200, "ok": True},
            {"login_id": "user.b", "map_id": 902, "version_id": 2, "kind": None,
             "prompt_tokens": None, "completion_tokens": None, "ok": False},
            {"login_id": "user.c", "map_id": 903, "version_id": 3, "kind": "answer",
             "prompt_tokens": 10, "completion_tokens": 1, "ok": True, "occurred_at": old},
        ]
    )
    body = client.get("/api/dashboard/ai-usage").json()
    assert body["last30"]["calls"] >= 3          # 40일 전 행 제외
    assert body["last30"]["failed"] >= 1
    assert body["last30"]["prompt_tokens"] >= 3000
    top = body["top_users"]
    assert top[0]["login_id"] == "user.a" and top[0]["total_tokens"] >= 3300
    assert any(m["map_id"] == 901 for m in body["top_maps"])
    assert len(top) <= 5 and len(body["top_maps"]) <= 5
```

(공유 DB라 `>=` 단언 — 다른 테스트의 이벤트와 공존. user.a의 total은 이 시드만으로 3300.)

- [ ] **Step 2: 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_dashboard.py -q`
Expected: FAIL — 404 (엔드포인트 부재).

- [ ] **Step 3: 구현**

`backend/app/schemas.py`의 `DashboardMetricsOut` 아래에 위 Interfaces 블록의 스키마 4종 추가.

`backend/app/routers/dashboard.py`에 추가:

```python
@router.get("/dashboard/ai-usage", response_model=AiUsageOut)
async def get_ai_usage(session: AsyncSession = Depends(get_session)) -> AiUsageOut:
    """AI 호출 사용량 — 7/30일 합계와 30일 상위 사용자/맵 (ai_usage_events 집계)."""

    async def period(days: int) -> AiUsagePeriodOut:
        since = now_kst() - timedelta(days=days)
        row = (
            await session.execute(
                select(
                    func.count().label("calls"),
                    func.sum(case((AiUsageEvent.ok.is_(False), 1), else_=0)).label("failed"),
                    func.coalesce(func.sum(AiUsageEvent.prompt_tokens), 0).label("prompt"),
                    func.coalesce(func.sum(AiUsageEvent.completion_tokens), 0).label("completion"),
                ).where(AiUsageEvent.occurred_at >= since)
            )
        ).one()
        return AiUsagePeriodOut(
            calls=row.calls or 0, failed=row.failed or 0,
            prompt_tokens=row.prompt or 0, completion_tokens=row.completion or 0,
        )

    since30 = now_kst() - timedelta(days=30)
    total_expr = func.coalesce(func.sum(AiUsageEvent.prompt_tokens), 0) + func.coalesce(
        func.sum(AiUsageEvent.completion_tokens), 0
    )
    user_rows = (
        await session.execute(
            select(AiUsageEvent.login_id, func.count().label("calls"), total_expr.label("total"))
            .where(AiUsageEvent.occurred_at >= since30)
            .group_by(AiUsageEvent.login_id)
            .order_by(total_expr.desc())
            .limit(5)
        )
    ).all()
    # 이름 해석 — Employee 스냅샷(없으면 login_id)
    names = {
        emp.login_id: emp.name
        for emp in (
            await session.scalars(
                select(Employee).where(Employee.login_id.in_([r.login_id for r in user_rows]))
            )
        ).all()
    }
    map_rows = (
        await session.execute(
            select(AiUsageEvent.map_id, func.count().label("calls"), total_expr.label("total"))
            .where(AiUsageEvent.occurred_at >= since30)
            .group_by(AiUsageEvent.map_id)
            .order_by(total_expr.desc())
            .limit(5)
        )
    ).all()
    map_names = {
        m.id: m.name
        for m in (
            await session.scalars(
                select(ProcessMap).where(ProcessMap.id.in_([r.map_id for r in map_rows]))
            )
        ).all()
    }
    return AiUsageOut(
        last7=await period(7),
        last30=await period(30),
        top_users=[
            AiUsageTopUserOut(
                login_id=r.login_id, name=names.get(r.login_id) or r.login_id,
                calls=r.calls, total_tokens=r.total or 0,
            )
            for r in user_rows
        ],
        top_maps=[
            AiUsageTopMapOut(
                map_id=r.map_id, name=map_names.get(r.map_id) or "(deleted)",
                calls=r.calls, total_tokens=r.total or 0,
            )
            for r in map_rows
        ],
    )
```

import 추가: `case`(sqlalchemy), `AiUsageEvent, Employee, ProcessMap`(models), 스키마 4종.

- [ ] **Step 4: 전체 통과 + 커밋**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 PASS.

```bash
git add backend/app/routers/dashboard.py backend/app/schemas.py backend/tests/test_dashboard.py PROGRESS.md
git commit -m "feat(dashboard): AI usage aggregation endpoint — 사용량 집계 API(7/30일·상위 사용자/맵)"
```

(PROGRESS 한 줄: `- B1 3/3 백엔드: GET /api/dashboard/ai-usage — SQL 집계(합계·실패·상위5), sysadmin 전역 게이트.`)

---

### Task 4: 매뉴얼 섹션 선별 — manual_select.py (TDD)

**Files:**
- Create: `backend/app/manual_select.py`
- Modify: `backend/app/routers/ai.py` (`_load_manual_text` 적용부)
- Test: `backend/tests/test_manual_select.py` (신규)

**Interfaces:**
- Consumes: `_load_manual_text`(ai.py:75-93, ko 우선 합본 + `text[:_MANUAL_AI_LIMIT]`), `payload.instruction`.
- Produces: `select_manual_sections(text: str, instruction: str, budget: int) -> str` — 순수 함수. ai.py는 `_MANUAL_SELECT_BUDGET = 12000` 상수로 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_manual_select.py` 생성:

```python
"""매뉴얼 섹션 선별 — 질문 관련 섹션만 budget 내 (design 2026-07-11 B2)."""

from app.manual_select import select_manual_sections

_MANUAL = """# 사용자 매뉴얼

인트로 프리앰블.

## 1. 시작하기
로그인과 홈 화면 설명. """ + ("가" * 300) + """

## 2. 버전 관리
버전 생성과 게시 절차. """ + ("나" * 300) + """

## 3. 승인 워크플로우
승인 요청과 반려 처리. """ + ("다" * 300) + """
"""


def test_small_manual_passes_through_unchanged() -> None:
    assert select_manual_sections(_MANUAL, "아무 질문", budget=100_000) == _MANUAL


def test_selects_matching_section_within_budget() -> None:
    out = select_manual_sections(_MANUAL, "승인 워크플로우에서 반려는 어떻게 해?", budget=700)
    assert "## 3. 승인 워크플로우" in out
    assert "반려 처리" in out           # 매칭 섹션 본문 포함
    assert "나" * 50 not in out          # 무관 섹션 본문 제외
    # TOC는 항상 — 미포함 섹션도 헤딩은 보인다
    assert "2. 버전 관리" in out


def test_toc_and_preamble_always_present() -> None:
    out = select_manual_sections(_MANUAL, "승인", budget=700)
    assert "# 사용자 매뉴얼" in out or "인트로 프리앰블" in out
    assert "1. 시작하기" in out  # TOC 라인


def test_zero_score_falls_back_to_leading_sections() -> None:
    out = select_manual_sections(_MANUAL, "xyz qqq", budget=700)
    assert "## 1. 시작하기" in out  # 원문 앞쪽 우선


def test_sections_are_whole_units_and_order_preserved() -> None:
    out = select_manual_sections(_MANUAL, "버전 게시와 승인", budget=1500)
    # 두 섹션이 들어가면 원문 순서(2 → 3)
    idx2, idx3 = out.find("## 2. 버전 관리"), out.find("## 3. 승인 워크플로우")
    assert idx2 != -1 and idx3 != -1 and idx2 < idx3


def test_no_headings_returns_truncated_text() -> None:
    plain = "헤딩 없는 매뉴얼 " * 200
    out = select_manual_sections(plain, "질문", budget=500)
    assert len(out) <= 500
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && .venv/bin/python -m pytest tests/test_manual_select.py -q`
Expected: FAIL — ModuleNotFoundError.

- [ ] **Step 3: 구현**

`backend/app/manual_select.py` 생성:

```python
"""매뉴얼 섹션 선별 — 질문과 어휘가 겹치는 섹션만 budget 내로 (design 2026-07-11 B2)."""

import re

_HEADING = re.compile(r"^## ", re.MULTILINE)
_TITLE_WEIGHT = 3  # 제목 매칭 가중 — 본문 우연 일치보다 제목 일치가 신호가 강하다


def _bigrams(text: str) -> set[str]:
    """공백·기호 제거 후 2-gram — 형태소 분석 없이 한국어 어휘 겹침을 근사."""
    compact = re.sub(r"[\s\W_]+", "", text)
    return {compact[i : i + 2] for i in range(len(compact) - 1)}


def select_manual_sections(text: str, instruction: str, budget: int) -> str:
    """## 헤딩 단위로 질문 관련 섹션을 골라 budget(자) 내로 구성.

    전체가 budget 이하면 원문 그대로(소형 매뉴얼 무변화). TOC(전체 헤딩 목록)와
    프리앰블은 항상 포함해 모델이 매뉴얼 지형을 잃지 않게 한다. 전 섹션 0점이면
    원문 앞쪽 섹션 순(보수적 폴백 — 종전 절단과 유사).
    """
    if len(text) <= budget:
        return text

    matches = list(_HEADING.finditer(text))
    if not matches:
        return text[:budget]

    preamble = text[: matches[0].start()].rstrip()
    sections: list[tuple[str, str]] = []  # (제목 줄, 섹션 전문)
    for i, m in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[m.start() : end].rstrip()
        title = body.splitlines()[0].removeprefix("## ").strip()
        sections.append((title, body))

    query = _bigrams(instruction)
    scored = []
    for index, (title, body) in enumerate(sections):
        score = len(query & _bigrams(title)) * _TITLE_WEIGHT + len(query & _bigrams(body))
        scored.append((score, index))
    if all(score == 0 for score, _ in scored):
        picked_order = list(range(len(sections)))  # 폴백 — 원문 앞쪽부터
    else:
        picked_order = [index for _, index in sorted(scored, key=lambda x: (-x[0], x[1]))]

    toc = "\n".join(f"- {title}" for title, _ in sections)
    header = f"{preamble}\n\n[매뉴얼 목차]\n{toc}\n" if preamble else f"[매뉴얼 목차]\n{toc}\n"
    remaining = budget - len(header)
    chosen: set[int] = set()
    for index in picked_order:
        body = sections[index][1]
        if len(body) + 1 > remaining:
            continue
        chosen.add(index)
        remaining -= len(body) + 1
    parts = [header] + [sections[i][1] for i in sorted(chosen)]  # 원문 순서 복원
    return "\n".join(parts)
```

`backend/app/routers/ai.py`:
- import: `from app.manual_select import select_manual_sections`
- 상수: `_MANUAL_SELECT_BUDGET = 12000  # 섹션 선별 예산(자) — 전체가 이하면 무변화` (`_MANUAL_AI_LIMIT` 옆)
- `_load_manual_text`는 그대로 두고, 핸들러에서 적용:

```python
    manual_text = select_manual_sections(
        await _load_manual_text(session), payload.instruction, _MANUAL_SELECT_BUDGET
    )
```

(기존 `_MANUAL_AI_LIMIT` 30k 절단은 `_load_manual_text` 안에 최종 가드로 유지.)

- [ ] **Step 4: 전체 통과 + 커밋**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전체 PASS (기존 test_ai의 매뉴얼 주입 단언은 소형 매뉴얼이라 무변화 경로).

```bash
git add backend/app/manual_select.py backend/app/routers/ai.py backend/tests/test_manual_select.py PROGRESS.md
git commit -m "feat(ai): select manual sections by question relevance — 매뉴얼 섹션 선별(2-gram·TOC·budget 12k)"
```

(PROGRESS 한 줄: `- B2: 매뉴얼 30k 절단 → 섹션 선별(## 분할·2-gram 점수·TOC 상시·budget 12k, 소형 매뉴얼 무변화).`)

---

### Task 5: 대시보드 AI usage 섹션 (frontend)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/settings/dashboard-panel.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 3의 `GET /api/dashboard/ai-usage` 응답(AiUsageOut 형태), 기존 `StatCard`(dashboard-panel.tsx:14-22)·`getDashboard` 패턴(api.ts).
- Produces: `getAiUsage(): Promise<AiUsageMetrics>`(api.ts), DashboardPanel의 AI usage 섹션(`data-id="dashboard-ai-usage"`).

- [ ] **Step 1: api.ts 타입+함수**

`getDashboard` 정의 옆에 추가 (`git grep -n "getDashboard" frontend/src/lib/api.ts`):

```ts
export interface AiUsagePeriod {
  calls: number;
  failed: number;
  prompt_tokens: number;
  completion_tokens: number;
}

export interface AiUsageTopUser {
  login_id: string;
  name: string;
  calls: number;
  total_tokens: number;
}

export interface AiUsageTopMap {
  map_id: number;
  name: string;
  calls: number;
  total_tokens: number;
}

export interface AiUsageMetrics {
  last7: AiUsagePeriod;
  last30: AiUsagePeriod;
  top_users: AiUsageTopUser[];
  top_maps: AiUsageTopMap[];
}

export function getAiUsage(): Promise<AiUsageMetrics> {
  return request<AiUsageMetrics>("/dashboard/ai-usage");
}
```

- [ ] **Step 2: i18n 키 (EN/KO 양쪽 — dashboard.* 블록 옆)**

EN:

```ts
  "dashboard.aiHeading": "AI usage",
  "dashboard.aiCalls7d": "Calls (7d)",
  "dashboard.aiFailRate7d": "Fail rate (7d)",
  "dashboard.aiTokens7d": "Tokens (7d)",
  "dashboard.aiTokens30d": "Tokens (30d)",
  "dashboard.aiTopUsers": "Top users (30d)",
  "dashboard.aiTopMaps": "Top maps (30d)",
  "dashboard.aiCallsShort": "{n} calls",
  "dashboard.aiEmpty": "No AI calls recorded yet.",
```

KO:

```ts
  "dashboard.aiHeading": "AI 사용량",
  "dashboard.aiCalls7d": "호출 (7일)",
  "dashboard.aiFailRate7d": "실패율 (7일)",
  "dashboard.aiTokens7d": "토큰 (7일)",
  "dashboard.aiTokens30d": "토큰 (30일)",
  "dashboard.aiTopUsers": "상위 사용자 (30일)",
  "dashboard.aiTopMaps": "상위 맵 (30일)",
  "dashboard.aiCallsShort": "{n}회",
  "dashboard.aiEmpty": "기록된 AI 호출이 없습니다.",
```

- [ ] **Step 3: DashboardPanel 섹션 추가**

`dashboard-panel.tsx`: import에 `getAiUsage, type AiUsageMetrics` 추가, `opened` effect에서 병렬 조회로 확장:

```ts
  const [aiUsage, setAiUsage] = useState<AiUsageMetrics | null>(null);
```

기존 effect의 `getDashboard()` 체인과 나란히(같은 effect 안):

```ts
    getAiUsage()
      .then((data) => {
        if (alive) setAiUsage(data);
      })
      .catch(() => {});
```

상세 화면(opened)의 `metricsComingSoon` 각주 **위**에 섹션 추가:

```tsx
        <div data-id="dashboard-ai-usage" className="flex flex-col gap-3">
          <h2 className="text-body-strong text-ink">{t("dashboard.aiHeading")}</h2>
          {aiUsage && aiUsage.last30.calls === 0 ? (
            <p className="text-caption text-ink-tertiary">{t("dashboard.aiEmpty")}</p>
          ) : (
            <>
              <div className="grid max-w-2xl grid-cols-4 gap-3">
                <StatCard label={t("dashboard.aiCalls7d")} value={value(aiUsage?.last7.calls)} />
                <StatCard
                  label={t("dashboard.aiFailRate7d")}
                  value={
                    aiUsage && aiUsage.last7.calls > 0
                      ? `${Math.round((aiUsage.last7.failed / aiUsage.last7.calls) * 100)}%`
                      : "—"
                  }
                />
                <StatCard
                  label={t("dashboard.aiTokens7d")}
                  value={value(
                    aiUsage ? aiUsage.last7.prompt_tokens + aiUsage.last7.completion_tokens : undefined,
                  )}
                />
                <StatCard
                  label={t("dashboard.aiTokens30d")}
                  value={value(
                    aiUsage ? aiUsage.last30.prompt_tokens + aiUsage.last30.completion_tokens : undefined,
                  )}
                />
              </div>
              <div className="grid max-w-2xl grid-cols-2 gap-3">
                {(
                  [
                    ["dashboard.aiTopUsers", aiUsage?.top_users, (row: AiUsageTopUser) => row.name] as const,
                    ["dashboard.aiTopMaps", aiUsage?.top_maps, (row: AiUsageTopMap) => row.name] as const,
                  ] as const
                ).map(([labelKey, rows, nameOf]) => (
                  <div key={labelKey} className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-4 py-3">
                    <span className="text-fine uppercase tracking-wide text-ink-tertiary">{t(labelKey)}</span>
                    <ul className="flex flex-col gap-0.5">
                      {(rows ?? []).map((row) => (
                        <li key={nameOf(row)} className="flex items-center justify-between gap-2 text-caption text-ink">
                          <span className="min-w-0 truncate">{nameOf(row)}</span>
                          <span className="shrink-0 tabular-nums text-ink-tertiary">
                            {row.total_tokens.toLocaleString()} · {t("dashboard.aiCallsShort", { n: row.calls })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
```

**구현 노트:** 위 top 리스트 map의 제네릭/`as const` 조합이 tsc에서 까다로우면 두 블록을 풀어서(Top users 블록·Top maps 블록 각각) 작성해도 된다 — 중복 10줄이 타입 곡예보다 낫다. `key`는 `login_id`/`map_id` 사용으로 교체.

- [ ] **Step 4: 게이트 + 커밋**

Run: `cd frontend && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint && npm run build`
Expected: 전부 PASS/0 errors.

```bash
git add frontend/src/lib/api.ts frontend/src/components/settings/dashboard-panel.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(dashboard): AI usage section — 대시보드 AI 사용량 섹션(StatCard 4종·상위 사용자/맵)"
```

(PROGRESS 한 줄: `- B1 프론트: Dashboard 탭 스텁에 AI usage 섹션(StatCard 4·상위 2표·빈 상태), i18n 9키.`)

---

### Task 6: 브라우저 검증 + 최종 게이트

**Files:**
- Create: `frontend/scripts/pw-verify-ai-usage.mjs`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: Task 1-5 전체. 기존 pw-verify 관례(playwright-core + 시스템 Chrome + `bpm.devUser`=admin.sys). 데모 시드(`.venv/bin/python -m scripts.reset_db`).
- Produces: 검증 스크립트 + PROGRESS 완료 기록. **머지하지 않는다 — 사용자 최종 확인 대기.**

- [ ] **Step 1: 검증 스크립트 작성**

골자 — AI 호출은 mock 불가(백엔드 내부 계량이 목적)이므로 **sqlite에 이벤트를 직접 시드**하고 대시보드 렌더를 검증. AI 엔드포인트 실호출 검증은 pytest가 이미 담당:

```js
// AI 사용량 대시보드 검증 — 시드 이벤트 → 설정>Analytics>Dashboard에서 카드·상위 목록 렌더.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-usage.mjs
// 전제: backend(8010, reset_db 후 아래 시드) + 프론트(3010). 이벤트 시드는 이 스크립트가 sqlite로 직접 수행.
import { execSync } from "node:child_process";
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3010";
const DB = process.env.DEV_DB ?? "../backend/dev.db";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// 이벤트 2건 시드 — 성공(토큰)·실패. sqlite raw INSERT는 tz-aware DateTime 문자열 비교 함정이 있어
// 앱 모델(clock.now KST)로 시드한다 — 백엔드 venv 파이썬 인라인.
execSync(
  `cd ../backend && .venv/bin/python -c "
import asyncio
from app.db import SessionLocal
from app.models import AiUsageEvent

async def seed():
    async with SessionLocal() as s:
        s.add(AiUsageEvent(login_id='verify.user', map_id=1, version_id=1, model='', kind='answer', prompt_tokens=1234, completion_tokens=56, ok=True))
        s.add(AiUsageEvent(login_id='verify.user', map_id=1, version_id=1, model='', kind=None, prompt_tokens=None, completion_tokens=None, ok=False))
        await s.commit()

asyncio.run(seed())
"`,
  { stdio: "inherit" },
);

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
});
const page = await ctx.newPage();

await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
// Analytics > Dashboard 탭 → 진입 카드 클릭
await page.getByText(/Dashboard|대시보드/).first().click();
await page.waitForTimeout(400);
await page.locator("button", { hasText: /Open|열기/ }).first().click().catch(() => undefined);
const section = page.locator('[data-id="dashboard-ai-usage"]');
await section.waitFor({ state: "visible", timeout: 8000 }).catch(() => undefined);
check("1 AI usage section visible", await section.isVisible().catch(() => false));
const text = (await section.innerText().catch(() => "")) ?? "";
check("2 token totals rendered", /1,?290|1,?234/.test(text), text.slice(0, 120));
check("3 top user listed", text.includes("verify.user") || /verify/.test(text));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
```

(주의: 설정 콘솔의 탭 네비 실제 셀렉터/문구는 실행하며 확인·조정 — 진입 카드 문구는 i18n `dashboard.openCard`. 시드 사용자 admin.sys가 sysadmin이어야 Analytics 카테고리가 보인다. 시드는 **백엔드 서버 기동 전에** 실행해도 되고 후라도 무방 — 대시보드는 조회 시점 집계. `DB` 상수는 python 시드 방식에선 미사용이면 삭제.)

- [ ] **Step 2: 서버 기동 + 실행**

```bash
lsof -ti :3010 -ti :8010 2>/dev/null | xargs kill -9 2>/dev/null
cd backend && .venv/bin/python -m scripts.reset_db
.venv/bin/uvicorn app.main:app --port 8010 &            # AI_ENABLED 불필요(시드 직접)
cd ../frontend && npm install --no-save playwright-core
BACKEND_URL=http://localhost:8010 npx next dev -p 3010 &
# curl --retry-connrefused 준비 대기 후:
BASE_URL=http://localhost:3010 node scripts/pw-verify-ai-usage.mjs
# 종료: lsof -ti :3010 -ti :8010 | xargs kill -9
```

Expected: 전 체크 PASS.

- [ ] **Step 3: 최종 게이트 + 커밋 (머지 금지)**

```bash
cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npx vitest run && node_modules/.bin/tsc --noEmit -p tsconfig.json && npm run lint && npm run build
```

Expected: 전부 PASS/0 errors.

PROGRESS.md 마무리(검증 결과 + `- 완료: B1 사용량 계측/집계·B2 매뉴얼 선별. 배포: 신규 테이블 create_all 자동 — 수동 DDL 불요. 머지는 사용자 확인 대기.`).

```bash
git add frontend/scripts/pw-verify-ai-usage.mjs PROGRESS.md
git commit -m "test(dashboard): browser verify for AI usage section — 사용량 대시보드 브라우저 검증"
```

**여기서 멈춘다 — main 머지는 사용자 최종 확인 후.**
