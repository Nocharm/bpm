# Approval Workflow Comments + Error Humanization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인 워크플로 4단계(submit/approve/publish/withdraw)에 선택 코멘트를 달고 버전 카드 "코멘트 보기" 모달로 이력을 보여주며, 원시 JSON이 노출되는 에러 표면 ~50곳을 인간화하고, 거절 배너를 재디자인하고, 받은함 거절 사유 유실을 고친다.

**Architecture:** 코멘트 저장은 기존 `VersionEvent.note` 재사용(스키마 무변경 — 바로철회의 이벤트 하드삭제에 코멘트가 자동 동반 삭제됨). 받은함 사유만 `ApprovalRequest.decision_reason` 컬럼 1개 신설(자동 ALTER). FE는 기존 `humanizeApiError`/`ConfirmDialog.input`/`MapDetail.versions[].events`를 확장 재사용.

**Tech Stack:** FastAPI + SQLAlchemy(async) + Pydantic v2 / Next.js + TS + Tailwind v4 토큰 / pytest·vitest·Playwright.

**Spec:** `docs/superpowers/specs/2026-08-14-approval-comments-design.md` (사용자 승인 완료본 — 이 플랜과 어긋나면 스펙이 우선).

## Global Constraints

- **작업 위치**: 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/approval-comments`, 브랜치 `feat/approval-comments`(dev에서 분기). 모든 태스크는 시작 시 `pwd` + `git branch --show-current`로 위치 확인.
- **BE 테스트**: `backend/`에서 `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` (개별 파일은 같은 env로 `tests/<file> -q`). 린트 `.venv/bin/ruff check app/ tests/`.
- **FE 게이트 4종**: `frontend/`에서 `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build`. **`tsc --noEmit` 상시** — vitest/build는 테스트 타입 에러를 못 잡는다.
- **React Compiler**: `useCallback`/`useMemo` 수동 deps가 추론과 어긋나면 lint/build 실패 — 사소한 핸들러는 plain function으로. effect 내 동기 setState 금지(`react-hooks/set-state-in-effect`).
- **디자인**: raw hex 금지(토큰만·`border-error/40 bg-error/10` 패턴 허용), Lucide 16px/strokeWidth 1.5(다이얼로그 상단 아이콘만 28), UI 문구 영어, i18n 키는 **en·ko 동시** 추가(`frontend/src/lib/i18n-messages.ts` — en 객체와 ko 객체 둘 다, 빠지면 tsc 에러). 신규 인터랙티브 요소에 `data-id`(surface-role kebab-case).
- **id 생성은 `genId()`**(`@/lib/id`) — `crypto.randomUUID` 금지(평문 HTTP 서버).
- **코멘트 계약**: 최대 500자, 서버에서 strip 후 빈 값은 None 정규화. reject 사유는 기존 필수 유지.
- **grep 주의**: 이 환경의 grep(ugrep)은 브래킷 디렉터리(`[mapId]`)를 건너뛸 수 있다 — 전수 검증은 `find`+파일별 grep 또는 python으로.
- **커밋**: `type(scope): English summary — 한국어 요약`, 커밋마다 `PROGRESS.md` 1줄 갱신을 같은 커밋에 포함. LF 고정.

---

### Task 1: Worktree + 환경 준비

**Files:** 없음(환경만).

- [ ] **Step 1: 워크트리 생성**

```bash
cd /Users/hyeonjin/Documents/bpm
git worktree add .claude/worktrees/approval-comments -b feat/approval-comments dev
cd .claude/worktrees/approval-comments && pwd && git branch --show-current  # → feat/approval-comments
```

- [ ] **Step 2: 백엔드 venv**

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/approval-comments/backend
uv venv .venv && uv pip install --python .venv/bin/python -r requirements-dev.txt
# uv 없으면: python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_workflow.py -q  # 그린 확인
```

- [ ] **Step 3: 프론트 node_modules**

turbopack이 심링크를 거부하므로 dev 워크트리에서 APFS clone으로 복사(있으면), 없으면 npm install:

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/approval-comments/frontend
[ -d ../../dev/frontend/node_modules ] && cp -Rc ../../dev/frontend/node_modules node_modules || true
npm install   # clone했어도 보강 실행(빠름)
npx tsc --noEmit  # 그린 확인
```

---

### Task 2: BE — 버전 워크플로 코멘트 스레딩 (스키마 무변경)

**Files:**
- Modify: `backend/app/schemas.py` (SubmitIn 확장 + CommentIn 신설, `SubmitIn`은 :581 부근)
- Modify: `backend/app/routers/versions.py` (submit :648 · approve :654-704 · publish :767-838 · withdraw :903-969)
- Test: `backend/tests/test_version_comments.py` (신규)

**Interfaces:**
- Consumes: `record_version_event(session, version_id, event_type, actor, note=None)` (`backend/app/version_events.py:8`).
- Produces: `POST /versions/{id}/submit` body `{to_visibility?, comment?}` · `POST /versions/{id}/approve|publish|withdraw` body `{comment?} | 없음`. 코멘트는 해당 `VersionEvent.note`로 기록되어 `GET /maps/{id}` → `versions[].events[].note`로 조회됨. Task 4의 FE api 함수들이 이 계약을 사용.

- [ ] **Step 1: 실패하는 테스트 작성** — `backend/tests/test_version_comments.py` 신규:

```python
"""버전 워크플로 단계 코멘트 — VersionEvent.note 스레딩 + 바로철회 동반삭제 (spec 2026-08-14)."""

from fastapi.testclient import TestClient

from app.settings import settings

_seq = 0


def _create_map_with_version(client: TestClient) -> tuple[int, int]:
    global _seq
    _seq += 1
    created = client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"cmt map {_seq}"},
    ).json()
    return created["id"], created["versions"][0]["id"]


def _events(client: TestClient, map_id: int, version_id: int) -> list[dict]:
    detail = client.get(f"/api/maps/{map_id}").json()
    version = next(v for v in detail["versions"] if v["id"] == version_id)
    return version["events"]


def _submit(client: TestClient, map_id: int, version_id: int, comment: str | None = None):
    client.put(f"/api/maps/{map_id}/approvers", json={"user_ids": [settings.dev_user]})
    client.post(f"/api/versions/{version_id}/checkout", json={})
    body: dict = {}
    if comment is not None:
        body["comment"] = comment
    return client.post(f"/api/versions/{version_id}/submit", json=body)


def test_submit_comment_recorded(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    assert _submit(client, map_id, version_id, "please review the new branch").status_code == 200

    submitted = [e for e in _events(client, map_id, version_id) if e["event_type"] == "submitted"]
    assert submitted and submitted[-1]["note"] == "please review the new branch"


def test_approve_and_publish_comments_recorded(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id)

    ok_approve = client.post(f"/api/versions/{version_id}/approve", json={"comment": "lgtm"})
    ok_publish = client.post(f"/api/versions/{version_id}/publish", json={"comment": "shipping v1"})

    assert ok_approve.status_code == 200 and ok_publish.status_code == 200
    events = _events(client, map_id, version_id)
    assert next(e for e in events if e["event_type"] == "approved")["note"] == "lgtm"
    assert next(e for e in events if e["event_type"] == "published")["note"] == "shipping v1"


def test_withdraw_after_approval_records_comment(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "cycle 1")
    client.post(f"/api/versions/{version_id}/approve", json={})

    ok = client.post(f"/api/versions/{version_id}/withdraw", json={"comment": "rolling back"})

    assert ok.status_code == 200
    events = _events(client, map_id, version_id)
    assert next(e for e in events if e["event_type"] == "withdrawn")["note"] == "rolling back"
    # 승인 1건 이상 후 회수 → submitted 이력은 유지
    assert any(e["event_type"] == "submitted" and e["note"] == "cycle 1" for e in events)


def test_immediate_withdraw_deletes_submit_comment(client: TestClient) -> None:
    """승인 0건 회수 → submitted 이벤트(코멘트 포함) 하드삭제 + withdrawn 무기록."""
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "will vanish")

    ok = client.post(f"/api/versions/{version_id}/withdraw", json={"comment": "ignored"})

    assert ok.status_code == 200
    types = [e["event_type"] for e in _events(client, map_id, version_id)]
    assert "submitted" not in types and "withdrawn" not in types


def test_blank_comment_normalized_to_none(client: TestClient) -> None:
    map_id, version_id = _create_map_with_version(client)
    _submit(client, map_id, version_id, "   ")

    submitted = [e for e in _events(client, map_id, version_id) if e["event_type"] == "submitted"]
    assert submitted and submitted[-1]["note"] is None
```

- [ ] **Step 2: 실패 확인**

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_version_comments.py -q
```
Expected: 5 FAIL (note가 None이라 assertion 실패 — 422가 아님: pydantic이 미지 필드 무시).

- [ ] **Step 3: schemas.py 구현** — `SubmitIn`(:581) 교체 + `CommentIn` 신설. `field_validator`가 import에 없으면 pydantic import 라인에 추가:

```python
def _normalize_comment(value: str | None) -> str | None:
    """공백만 있는 코멘트는 없음으로 — 이벤트 note에 빈 문자열이 남지 않게."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class SubmitIn(BaseModel):
    """버전 승인요청 동봉 옵션 — 가시성 편승 + 선택 코멘트 (governance A · spec 2026-08-14)."""

    to_visibility: Literal["public", "private"] | None = None
    comment: str | None = Field(None, max_length=500)

    _normalize = field_validator("comment")(classmethod(lambda cls, v: _normalize_comment(v)))


class CommentIn(BaseModel):
    """전이 선택 코멘트(approve/publish/withdraw 공용) — VersionEvent.note로 기록."""

    comment: str | None = Field(None, max_length=500)

    _normalize = field_validator("comment")(classmethod(lambda cls, v: _normalize_comment(v)))
```

(람다 스타일이 ruff에 걸리면 두 클래스에 각각 `@field_validator("comment")` + `@classmethod`의 일반 메서드로 풀어 쓴다 — 동작 동일.)

- [ ] **Step 4: versions.py 배선** — import에 `CommentIn` 추가 후 4곳:

```python
# submit (:648) — 기존 payload 재사용
    record_version_event(
        session, version_id, "submitted", user,
        note=payload.comment if payload is not None else None,
    )

# approve — 시그니처에 body 추가 (:654-658)
async def approve_version(
    version_id: int,
    payload: CommentIn | None = None,
    user: str = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MapVersion:
# … existing is None 블록 안 (:683):
        record_version_event(
            session, version_id, "approved", user,
            note=payload.comment if payload is not None else None,
        )

# publish — 시그니처 동일 추가, "published" 이벤트(:832)에만 note (expired 이벤트는 무변경)
    record_version_event(
        session, version_id, "published", user,
        note=payload.comment if payload is not None else None,
    )

# withdraw — 시그니처 동일 추가, 기록 경로(:952)에만 note (무기록 경로는 코멘트 무시)
        record_version_event(
            session, version_id, "withdrawn", user,
            note=payload.comment if payload is not None else None,
        )
```

- [ ] **Step 5: 통과 확인 + 전체 그린 + ruff**

```bash
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_version_comments.py -q   # 5 PASS
AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q                            # 전체 그린
.venv/bin/ruff check app/ tests/
```

- [ ] **Step 6: 커밋** (PROGRESS.md 1줄 동반)

```bash
git add backend/app/schemas.py backend/app/routers/versions.py backend/tests/test_version_comments.py PROGRESS.md
git commit -m "feat(versions): optional step comments threaded into VersionEvent.note — 전이 4단계 선택 코멘트(스키마 무변경·바로철회 동반삭제)"
```

---

### Task 3: BE — 받은함 거절 사유 저장 (`decision_reason`)

**Files:**
- Modify: `backend/app/models.py` (ApprovalRequest :542-560), `backend/app/db.py` (`_ADDED_COLUMNS` :19), `backend/app/schemas.py` (DecisionIn :235 · ApprovalRequestOut :221), `backend/app/routers/permissions.py` (decide :574-579 · `_notify_permission_decision` :691-724)
- Test: `backend/tests/test_decision_reason.py` (신규)

**Interfaces:**
- Consumes: Task 2의 `_normalize_comment` (schemas.py).
- Produces: `POST /approval-requests/{id}/decide` body `{decision, reason?}` · `ApprovalRequestOut.decision_reason: str | null` · 거절 알림 message 말미 `": {reason}"`. Task 4의 `decideApprovalRequest(requestId, decision, reason?)`가 사용.

- [ ] **Step 1: 실패하는 테스트** — `backend/tests/test_decision_reason.py`:

```python
"""ApprovalRequest 거절 사유 저장 + 알림 동봉 (spec 2026-08-14 §3.2)."""

import asyncio

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Notification

_seq = 0


def _create_map(client: TestClient) -> int:
    global _seq
    _seq += 1
    return client.post(
        "/api/maps",
        json={"owning_department": "Owning Anchor Division", "name": f"dr map {_seq}"},
    ).json()["id"]


def _create_rename_request(client: TestClient, map_id: int) -> int:
    res = client.post(f"/api/maps/{map_id}/rename-requests", json={"to_name": f"renamed {_seq}"})
    assert res.status_code in (200, 201), res.text
    return res.json()["id"]


def _fetch_notifications(map_id: int, type_: str) -> list[Notification]:
    async def _q() -> list[Notification]:
        async with SessionLocal() as session:
            rows = await session.scalars(
                select(Notification).where(
                    Notification.map_id == map_id, Notification.type == type_
                )
            )
            return list(rows)

    return asyncio.run(_q())


def test_reject_stores_reason_and_appends_to_notification(client: TestClient) -> None:
    map_id = _create_map(client)
    req_id = _create_rename_request(client, map_id)

    res = client.post(
        f"/api/approval-requests/{req_id}/decide",
        json={"decision": "reject", "reason": "duplicate name policy"},
    )

    assert res.status_code == 200
    assert res.json()["decision_reason"] == "duplicate name policy"
    notes = _fetch_notifications(map_id, "rename_rejected")
    assert notes and notes[-1].message.endswith(": duplicate name policy")


def test_reject_without_reason_backward_compatible(client: TestClient) -> None:
    map_id = _create_map(client)
    req_id = _create_rename_request(client, map_id)

    res = client.post(f"/api/approval-requests/{req_id}/decide", json={"decision": "reject"})

    assert res.status_code == 200
    assert res.json()["decision_reason"] is None
    notes = _fetch_notifications(map_id, "rename_rejected")
    assert notes and notes[-1].message.endswith("was rejected")
```

(주의: rename-requests 생성 엔드포인트 상태코드가 200인지 201인지는 `backend/app/routers/maps.py:619` 데코레이터로 실측 후 assert를 한 값으로 고정한다. 응답에 `id`가 없으면 `GET /api/maps/{map_id}/rename-requests/pending`으로 id를 얻도록 헬퍼를 조정.)

- [ ] **Step 2: 실패 확인** — `pytest tests/test_decision_reason.py -q` (env 가드 동일). Expected: FAIL (`decision_reason` KeyError 또는 None + message 불일치).

- [ ] **Step 3: 구현**

```python
# models.py — ApprovalRequest 마지막 필드로 (created_at 위/아래 무관, 관례상 decided_at 아래)
    # 거절 사유(선택) — 결정 코멘트. 요청 내용(payload)과 분리 보관 (spec 2026-08-14)
    decision_reason: Mapped[str | None] = mapped_column(String(500), default=None)

# db.py — _ADDED_COLUMNS 말미에
    # 승인요청 거절 사유 — 받은함 거절 코멘트 (spec 2026-08-14)
    ("approval_requests", "decision_reason", "VARCHAR(500)"),

# schemas.py
class DecisionIn(BaseModel):
    decision: Literal["approve", "reject"]
    reason: str | None = Field(None, max_length=500)

    _normalize = field_validator("reason")(classmethod(lambda cls, v: _normalize_comment(v)))

# ApprovalRequestOut에 필드 추가
    decision_reason: str | None = None

# permissions.py — decide reject 분기 (:574)
    if payload.decision == "reject":
        req.status = "rejected"
        req.decision_reason = payload.reason
        await _notify_permission_decision(session, req, outcome="rejected", reason=payload.reason)
        ...

# approve 분기(:584)는 reason 미전달(시그니처 기본값 None)

# _notify_permission_decision(:691) — 시그니처와 3개 message에 사유 동봉
async def _notify_permission_decision(
    session: AsyncSession, req: ApprovalRequest, *, outcome: str, reason: str | None = None
) -> None:
    """승인/반려 결과 → 요청자에게 벨 알림 (design 2026-07-16). 거절 사유는 말미 ': {reason}' 동봉."""
    suffix = f": {reason}" if reason else ""
    # 각 create_notifications의 message 말미에 {suffix} 추가:
    #   f"Your request to rename '{from_name}' to '{to_name}' was {outcome}{suffix}"
    #   f"Your subprocess registration request for '{map_name}' was {outcome}{suffix}"
    #   f"Your request on '{map_name}' was {outcome}{suffix}"
```

- [ ] **Step 4: 통과 + 전체 그린 + ruff** (Task 2 Step 5와 동일 명령).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/permissions.py backend/tests/test_decision_reason.py PROGRESS.md
git commit -m "feat(approvals): persist decision reason + append to rejection notification — 받은함 거절 사유 저장·알림 동봉(자동 ALTER 컬럼)"
```

---

### Task 4: FE — api 레이어(에러 폴백·console.error·코멘트 파라미터) + 토스트 에러 톤

**Files:**
- Modify: `frontend/src/lib/api.ts` (request :234-258 · CSV throw :808 부근 · submitVersion :823 · approveVersion :833 · publishVersion :847 · withdrawVersion :851 · decideApprovalRequest :1004 · `ApprovalRequest` 인터페이스), `frontend/src/lib/api-errors.ts`, `frontend/src/lib/i18n-messages.ts`, `frontend/src/components/toast-stack.tsx`
- Test: `frontend/src/lib/api-errors.test.ts` (신규)

**Interfaces:**
- Produces (Task 5~8이 사용):
  - `humanizeApiError(err, t)` — 매핑 히트 시 i18n 문구, 미스+detail 시 `` `${detail} (HTTP ${status})` ``, detail 파싱 불가 ApiError 시 `t("apiError.requestFailed", {status})`, 비-ApiError는 `err.message`.
  - `submitVersion(versionId, toVisibility?, comment?)` · `approveVersion(versionId, comment?)` · `publishVersion(versionId, comment?)` · `withdrawVersion(versionId, comment?)` · `decideApprovalRequest(requestId, decision, reason?)`.
  - `ToastItem.tone?: "error"` — 에러 토스트는 XCircle 16 + 좌측 `border-error`.

- [ ] **Step 1: 실패하는 테스트** — `frontend/src/lib/api-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ApiError } from "./api";
import { humanizeApiError } from "./api-errors";

const t = (key: string, vars?: Record<string, string | number>) =>
  `${key}${vars?.status != null ? `:${vars.status}` : ""}`;

describe("humanizeApiError", () => {
  it("maps known detail prefixes to i18n keys", () => {
    const err = new ApiError("API POST /x failed: 409", 409, JSON.stringify({ detail: "map has no approvers — assign approvers first" }));
    expect(humanizeApiError(err, t as never)).toBe("apiError.noApprovers");
  });

  it("appends HTTP status to unmapped details", () => {
    const err = new ApiError("API POST /x failed: 403", 403, JSON.stringify({ detail: "only the submitter can publish" }));
    expect(humanizeApiError(err, t as never)).toBe("only the submitter can publish (HTTP 403)");
  });

  it("falls back to generic key when body is not JSON detail", () => {
    const err = new ApiError("API GET /x failed: 502 — <html>bad gateway</html>", 502, "<html>bad gateway</html>");
    expect(humanizeApiError(err, t as never)).toBe("apiError.requestFailed:502");
  });

  it("passes через non-ApiError messages unchanged", () => {
    expect(humanizeApiError(new Error("boom"), t as never)).toBe("boom");
  });
});
```

(4번째 it 설명 문구의 오타는 "passes through"로 작성. `t as never`가 lint에 걸리면 `t`를 `TFunc` 시그니처에 맞춘 타입으로 선언.)

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/api-errors.test.ts`. Expected: 2·3번째 케이스 FAIL.

- [ ] **Step 3: 구현**

`api-errors.ts` — import에 `ApiError` 추가(`from "./api"`), 함수 교체:

```ts
export function humanizeApiError(err: unknown, t: TFunc): string {
  const detail = getApiErrorDetail(err);
  const hit = DETAIL_PREFIX_MAP.find(([prefix]) => detail.startsWith(prefix));
  if (hit) return t(hit[1]);
  if (err instanceof ApiError) {
    // 미매핑 폴백 — 현장 제보용 상태코드 꼬리표. detail 파싱 실패(비 JSON 응답)면 원문 대신 일반 문구.
    return detail !== err.message
      ? `${detail} (HTTP ${err.status})`
      : t("apiError.requestFailed", { status: err.status });
  }
  return detail;
}
```

`api.ts` — request throw(:245) 직전과 CSV throw(:808 부근) 직전에 각각:

```ts
    // 원문(JSON body 포함)은 콘솔에 보존 — UI는 humanizeApiError로 정제 (spec 2026-08-14 §4)
    console.error(`API ${init?.method ?? "GET"} ${path} failed: ${response.status}`, detail);
```

(CSV 쪽은 그 스코프의 메서드/경로 변수명에 맞춰 동일 형태.)

버전 액션 함수 교체:

```ts
export function submitVersion(
  versionId: number,
  toVisibility?: "public" | "private",
  comment?: string,
): Promise<VersionSummary> {
  const body: Record<string, string> = {};
  if (toVisibility) body.to_visibility = toVisibility;
  if (comment) body.comment = comment;
  return request<VersionSummary>(`/versions/${versionId}/submit`, {
    method: "POST",
    ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {}),
  });
}

export function approveVersion(versionId: number, comment?: string): Promise<VersionSummary> {
  return request<VersionSummary>(`/versions/${versionId}/approve`, {
    method: "POST",
    ...(comment ? { body: JSON.stringify({ comment }) } : {}),
  });
}
// publishVersion / withdrawVersion 도 approveVersion과 동일 형태로 comment? 추가.

export function decideApprovalRequest(
  requestId: number,
  decision: "approve" | "reject",
  reason?: string,
): Promise<ApprovalRequest> {
  return request<ApprovalRequest>(`/approval-requests/${requestId}/decide`, {
    method: "POST",
    body: JSON.stringify({ decision, ...(reason ? { reason } : {}) }),
  });
}
```

`ApprovalRequest` 인터페이스(api.ts :861 부근)에 `decision_reason: string | null;` 추가.

`i18n-messages.ts` — en(:1614 뒤)과 ko(:3223 뒤) `apiError` 블록 말미에:

```ts
  "apiError.requestFailed": "Request failed (HTTP {status})",   // en
  "apiError.requestFailed": "요청이 실패했습니다 (HTTP {status})", // ko
```

`toast-stack.tsx` — `ToastItem`에 `tone?: "error"`, `Toast`가 tone을 받아 렌더:

```tsx
import { XCircle } from "lucide-react";

export interface ToastItem {
  id: string;
  message: string;
  /** 에러 토스트 — XCircle + 좌측 에러 보더 (spec 2026-08-14 §4) */
  tone?: "error";
}

function Toast({ message, tone, onDone }: { message: string; tone?: "error"; onDone: () => void }) {
  // …기존 state/effect 유지, 반환 JSX만:
  return (
    <div
      className={`flex items-start gap-1.5 rounded-md bg-ink px-3 py-2 text-caption text-surface shadow-lg ${
        tone === "error" ? "border-l-2 border-error" : ""
      }`}
      style={{ /* 기존 transform/opacity/transition 유지 */ }}
    >
      {tone === "error" && <XCircle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-error" />}
      {message}
    </div>
  );
}
// ToastStack 매핑에 tone={toast.tone} 전달
```

- [ ] **Step 4: 게이트** — `npx vitest run src/lib/api-errors.test.ts`(PASS) → `npm run lint` · `npx tsc --noEmit`.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/api-errors.ts frontend/src/lib/api-errors.test.ts frontend/src/lib/i18n-messages.ts frontend/src/components/toast-stack.tsx PROGRESS.md
git commit -m "feat(fe-api): error fallback with HTTP tail + console preservation + comment params — 에러 폴백·원문 콘솔 보존·코멘트 파라미터·토스트 에러 톤"
```

---

### Task 5: FE — Group A 에러 표면 전수 스윕 (~50곳)

**Files (Modify):** 아래 체크리스트 전부. 변환 규칙은 기계적:

1. `err instanceof Error ? err.message : String(err)` (또는 `e.message` 원시 노출) → `humanizeApiError(err, t)`.
2. 파일에 `humanizeApiError` import가 없으면 `import { humanizeApiError } from "@/lib/api-errors";` 추가. `t`가 없으면 `const { t } = useI18n();` 추가(`@/lib/i18n`).
3. **토스트로 가는 에러**는 tone 동반: 페이지 로컬 `showToast(message)` 헬퍼를 `showToast(message, tone?: "error")`로 확장(`setToasts`에 `tone` 전달)하고 에러 지점만 `"error"` 전달. 컴포넌트 `onToast` prop은 시그니처 유지 — 호스트에서 `(m) => showToast(m, "error")`로 감싼다(해당 패널들의 onToast는 전부 에러 전용).
4. `setError`/`setStatus`/배너류(텍스트 렌더)는 메시지 인간화만, tone 없음.

**Interfaces:** Consumes Task 4의 `humanizeApiError`·`ToastItem.tone`.

**대상 체크리스트 (explorer 실측 — 라인은 ±수 라인 드리프트 가능, 파일 내 해당 패턴 전수 적용):**

- [ ] `frontend/src/app/page.tsx` — :141, :155, :338(→setError) · :366(→setCopyError) · :983(→showToast, tone)
- [ ] `frontend/src/app/maps/[mapId]/page.tsx` — showToast 지점(:1801, :2657, :2673, :2763, :2808, :2875, :2596, :2608, :2621, :2932, :2941, :2966, :2979, :2989, :2998, :3012, :3024, :3040, :4932, :5047, :5072, :2552 — tone "error") · setStatus 지점(:2163, :2429, :2480) · :1601(setSaveErrorDetail 배너)
- [ ] `frontend/src/app/maps/[mapId]/compare/page.tsx` — :1219
- [ ] `frontend/src/app/maps/[mapId]/settings/page.tsx` — showToast 확장 + **:119 정규식 필터 교체**:

```ts
    // 읽기 전용(viewer 등)은 권한 로드 시 401/403 다발 — 예상된 접근 거부는 토스트 미노출 (B2).
    // 인간화 후 포맷('(HTTP 403)' 꼬리표)과 미스윕 원시 포맷('failed: 403') 둘 다 매칭.
    if (/failed: 40[13]/.test(message) || /\(HTTP 40[13]\)$/.test(message)) return;
```

  또한 각 패널 `onToast={showToast}` → `onToast={(m) => showToast(m, "error")}` (approvers/visibility/versions/danger 등 이 페이지의 onToast 전달부 전수).
- [ ] `frontend/src/components/permissions/versions-publish-panel.tsx` — :183, :194 (기존 :212는 이미 humanize)
- [ ] `frontend/src/components/permissions/approvers-panel.tsx` — :77, :89, :112, :211
- [ ] `frontend/src/components/permissions/danger-zone.tsx` — :58, :95, :107
- [ ] `frontend/src/components/permissions/subprocess-designation-panel.tsx` — :59, :120 / `subprocess-designation-modal.tsx` — :75, :99, :125
- [ ] `frontend/src/components/permissions/create-map-dialog.tsx` — :354
- [ ] `frontend/src/components/map-settings/checkout-requests-panel.tsx` — :56, :67, :88
- [ ] `frontend/src/components/admin/approval-queue.tsx` — :150, :170, :212 / `table-viewer.tsx` — :69, :113, :157 / `notification-purge-modal.tsx` — :53, :82 / `department-table.tsx` — :174, :196 / `employee-table.tsx` — :72, :155 / `deleted-maps-panel.tsx` — :47, :60 / `deleted-groups-panel.tsx` — :46, :59
- [ ] `frontend/src/components/groups/groups-panel.tsx` — :109, :125, :267 / `group-actions.tsx` — :77, :87, :96, :105, :120 / `group-detail.tsx` — :302, :321, :334
- [ ] `frontend/src/components/approver-manager.tsx` — :76 / `subprocess-inspector-card.tsx` — :180 / `node-summary-modal.tsx` — :373 / `word-quick-create-dialog.tsx` — :57
- [ ] `frontend/src/components/ai-chat-panel.tsx` — :382, :903 / `settings/ai-chat-settings-panel.tsx` — :64, :79, :99 / `interview/interview-preview.tsx` — :273
- [ ] `frontend/src/components/dashboard/access-sidebar.tsx` — :55-57 로컬 `describeError` 헬퍼 제거하고 호출부를 `humanizeApiError(err, t)`로

**비대상(건드리지 않음):** Group B(`getApiErrorDetail`만 쓰는 지점 — consult/framework/map-details-panel/kb-manage-panel/subprocess-registration-cta/interview-preview 일부/permission-staging) · `frontend/src/lib/permission-staging.ts`(수집만, 호출자가 humanize).

- [ ] **Step 1: 위 체크리스트 순서대로 변환** (파일 단위로 진행, 각 파일 저장 후 다음).
- [ ] **Step 2: 전수 검증 grep** — ugrep 브래킷 함정 때문에 python으로:

```bash
cd frontend && python3 - <<'EOF'
import pathlib, re
pat = re.compile(r"instanceof Error \? (err|e)\.message")
for p in pathlib.Path("src").rglob("*.ts*"):
    for i, line in enumerate(p.read_text().splitlines(), 1):
        if pat.search(line):
            print(f"{p}:{i}: {line.strip()}")
EOF
```
Expected 잔존: `lib/permission-staging.ts`·`lib/api.ts`(getApiErrorDetail 내부)·테스트 파일 정도 — Group A 목록의 파일이 나오면 미스윕.

- [ ] **Step 3: 게이트** — `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build`.
- [ ] **Step 4: 커밋**

```bash
git add -- frontend/src PROGRESS.md
git commit -m "refactor(fe): humanize all raw API error surfaces (Group A sweep) — 원시 JSON 에러 표면 전수 인간화·에러 토스트 톤"
```

---

### Task 6: FE — 거절 배너 재디자인 (에디터 헤더)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (:7374-7378), `frontend/src/lib/i18n-messages.ts`

**Interfaces:** Consumes 에디터 컴포넌트 스코프의 `currentVersion`·`workflow`(WorkflowState | null — `rejected_by` 보유)·`nameById`. Produces `data-id="wf-rejected-banner"`.

- [ ] **Step 1: 배너 교체** — :7374-7378의 `<span className="text-caption text-error">…</span>` 블록을:

```tsx
          {currentVersion?.status === "rejected" && currentVersion.reject_reason && (
            <span
              data-id="wf-rejected-banner"
              className="flex max-w-96 items-center gap-1.5 rounded-sm border border-error/40 bg-error/10 px-2 py-1 text-caption text-error"
              title={currentVersion.reject_reason}
            >
              <XCircle size={16} strokeWidth={1.5} className="shrink-0" />
              <span className="text-caption-strong">{t("wf.rejectedLabel")}</span>
              {workflow?.rejected_by && (
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-error/40 bg-surface px-1.5 py-0.5 text-fine">
                  <User size={12} strokeWidth={1.5} />
                  {nameById.get(workflow.rejected_by) ?? workflow.rejected_by}
                </span>
              )}
              <span className="truncate">{currentVersion.reject_reason}</span>
            </span>
          )}
```

`XCircle`·`User`가 에디터 import에 없으면 lucide import 라인에 추가. `workflow`가 currentVersion과 다른 버전을 가리키는 상태가 가능하면(구현 시 실측) `workflow?.rejected_by` 조건에 `workflow.status === "rejected"`를 추가해 방어.

- [ ] **Step 2: i18n** — en에 `"wf.rejectedLabel": "Rejected",` ko에도 `"wf.rejectedLabel": "Rejected",`(상태 라벨 영어 고정 규칙). 기존 `"wf.rejectedBanner"` 키는 이 교체로 미사용 — **en·ko 양쪽에서 제거**(tsc가 잔존 참조를 잡아줌).
- [ ] **Step 3: 게이트** — `npm run lint` · `npx tsc --noEmit` · `npm run build`.
- [ ] **Step 4: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(editor): redesigned rejected banner with rejecter pill — 거절 배너 재디자인(에러 틴트 칩·거절자 필·사유 툴팁)"
```

---

### Task 7: FE — 전이 모달 4종 코멘트 입력 + 받은함 사유 전달

**Files:**
- Modify: `frontend/src/components/version/submit-confirm-dialog.tsx` · `approve-confirm-dialog.tsx` · `publish-confirm-dialog.tsx` · `withdraw-confirm-dialog.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (다이얼로그 마운트 :9754-9836) · `frontend/src/components/permissions/versions-publish-panel.tsx` (마운트 :385-464)
- Modify: `frontend/src/app/inbox/page.tsx` (:290-317 actApproval · :1069-1098 reject 다이얼로그)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: Task 4의 `submitVersion/approveVersion/publishVersion/withdrawVersion(…, comment?)` · `decideApprovalRequest(id, decision, reason?)` · `ConfirmDialog.input`.
- Produces: 4종 다이얼로그 신규 props — `comment: string; onCommentChange: (value: string) => void;` (withdraw만 추가로 `showCommentInput: boolean`).

- [ ] **Step 1: i18n 키** — en/ko 양쪽 `wf.` 블록에:

```ts
  "wf.commentPlaceholder": "Add a comment (optional)",   // ko: "코멘트 입력 (선택)"
```

- [ ] **Step 2: 다이얼로그 4종에 props + input 추가** — 각 파일에서 props 인터페이스에 `comment: string; onCommentChange: (value: string) => void;` 추가하고 `ConfirmDialog`에 `input={{ value: comment, onChange: onCommentChange, placeholder: t("wf.commentPlaceholder") }}` 전달. withdraw는 `showCommentInput: boolean`도 받아 `input={showCommentInput ? { … } : undefined}`. (submit 다이얼로그의 `bundleSlot` children은 그대로 — ConfirmDialog 레이아웃상 textarea가 children 위에 렌더됨.)

- [ ] **Step 3: 에디터 마운트 배선** — 에디터 컴포넌트에 상태 1개 추가(동시에 한 다이얼로그만 열림):

```ts
  const [transitionComment, setTransitionComment] = useState("");
```

4개 다이얼로그 오픈 세터(`setSubmitConfirmOpen(true)` 등) 직전마다 `setTransitionComment("")` 리셋. 각 마운트에 `comment={transitionComment} onCommentChange={setTransitionComment}` 전달, onConfirm에서:

```ts
// submit(:9766): void runTransition((id) => submitVersion(id, bundleValue ?? undefined, transitionComment.trim() || undefined));
// approve(:9785): void runTransition((id) => approveVersion(id, transitionComment.trim() || undefined));
// publish(:9797): void runTransition((id) => publishVersion(id, transitionComment.trim() || undefined));
// withdraw(:9812): void runTransition((id) => withdrawVersion(id, transitionComment.trim() || undefined));
```

withdraw 마운트에 `showCommentInput={workflow?.status === "rejected" || (workflow?.approvals.length ?? 0) >= 1}` — 무기록 바로철회(승인 0건 pending)에선 입력란 숨김(서버 §3.1 대칭). 셀프 게시 팝오버 경로는 무변경(코멘트 없음).

- [ ] **Step 4: 설정 패널 배선** — `VersionRow`에 동일 패턴: `const [transitionComment, setTransitionComment] = useState("");`, 각 오픈 onClick에 리셋 추가, 마운트 4곳(:385-464)에 props 전달, onConfirm 4곳을 위 시그니처로. withdraw `showCommentInput={wf.status === "rejected" || wf.approvals.length >= 1}`.

- [ ] **Step 5: 받은함 사유 전달** — `frontend/src/app/inbox/page.tsx`:

```ts
// :832 부근, isVersion 옆에
  const isApprovalRequest = approval.kind === "approval_request";

// reject 다이얼로그(:1076-1084) input 게이트 확장 — 버전=필수 사유, 승인요청=선택 사유
          input={
            isVersion || isApprovalRequest
              ? {
                  value: rejectReason,
                  onChange: setRejectReason,
                  placeholder: isVersion ? t("wf.rejectReason") : t("wf.commentPlaceholder"),
                }
              : undefined
          }
// confirmDisabled는 기존대로 isVersion만 필수

// actApproval(:301) — 사유 전달
          await decideApprovalRequest(a.id, approve ? "approve" : "reject", approve ? undefined : reason.trim() || undefined);
```

(설정 `pending-approvals-panel.tsx`·admin `approval-queue.tsx`의 decide 호출은 reason 미전달로 그대로 유효 — 범위 밖.)

- [ ] **Step 6: 게이트** — `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build`.
- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/version frontend/src/components/permissions/versions-publish-panel.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/app/inbox/page.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(workflow): optional comments on 4 transition dialogs + inbox reject reason — 전이 모달 코멘트·받은함 거절 사유 전달(무기록 철회는 입력 숨김)"
```

---

### Task 8: FE — 버전 카드 "코멘트 보기" 모달 (클릭점→중앙 확대)

**Files:**
- Create: `frontend/src/components/version/comment-history-modal.tsx`
- Modify: `frontend/src/app/globals.css` (keyframes 추가, `.window-open` 블록 :164-179 아래), `frontend/src/components/permissions/versions-publish-panel.tsx`, `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `VersionEvent`(`@/lib/api` :25-31, `note` 포함) · `VersionDetail extends VersionSummary { events }`(:33-35) · `getMap → MapDetail.versions: VersionDetail[]` · `formatKstShort`(`@/lib/datetime`).
- Produces: `CommentHistoryModal({ label, events, nameById, origin, onClose })` · `data-id="version-comments-modal"` · 행 버튼 `data-id="version-comments-open-{versionId}"` · CSS 클래스 `comment-modal-in`(변수 `--from-dx/--from-dy`).

- [ ] **Step 1: globals.css keyframes** — `.window-open` 리듀스드 모션 가드(:216-220) 아래에:

```css
/* 코멘트 이력 모달 — 클릭 지점에서 화면 중앙으로 확대되며 등장 (spec 2026-08-14 §5.4).
   시작 오프셋은 카드 인라인 CSS 변수 --from-dx/--from-dy(클릭점 − 뷰포트 중앙)로 주입. */
@keyframes comment-modal-in {
  from {
    opacity: 0;
    transform: translate(var(--from-dx, 0px), var(--from-dy, 0px)) scale(0.3);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.comment-modal-in {
  animation: comment-modal-in 350ms var(--ease-overshoot);
}

@media (prefers-reduced-motion: reduce) {
  .comment-modal-in {
    animation: none;
  }
}
```

- [ ] **Step 2: i18n 키** — en/ko:

```ts
  "wf.commentsTitle": "Comments — {label}",   // ko: "코멘트 — {label}"
  "wf.commentsEmpty": "No comments yet.",     // ko: "아직 코멘트가 없습니다."
  "wf.viewComments": "View comments",         // ko: "코멘트 보기"
```

- [ ] **Step 3: 모달 컴포넌트 생성** — `frontend/src/components/version/comment-history-modal.tsx`:

```tsx
"use client";

// 버전 코멘트 이력 모달 — note 있는 전이 이벤트만 시간순 나열.
// 등장: 클릭 지점→중앙 확대(comment-modal-in), 닫힘: 바깥 mousedown 즉시 + Escape (spec 2026-08-14 §5.4).
// ModalBackdrop(mousedown-origin 판정)을 쓰지 않는 이유: 읽기전용 모달이라 드래그-이탈 오발 리스크를
// 수용하고 즉시 닫힘(사용자 명시 요구)을 우선한다.

import { useEffect, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle, MessageSquare, Send, Undo2, Upload, User, XCircle, type LucideIcon,
} from "lucide-react";

import { type VersionEvent } from "@/lib/api";
import { formatKstShort } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

const EVENT_ICONS: Record<string, LucideIcon> = {
  submitted: Send,
  approved: CheckCircle,
  rejected: XCircle,
  published: Upload,
  withdrawn: Undo2,
};

interface CommentHistoryModalProps {
  label: string;
  events: VersionEvent[];
  nameById: Map<string, string>;
  /** 클릭 지점 — 등장 애니메이션 시작 오프셋 계산용. */
  origin: { x: number; y: number };
  onClose: () => void;
}

export function CommentHistoryModal({ label, events, nameById, origin, onClose }: CommentHistoryModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const commented = events.filter((evt) => evt.note);
  // 클릭점 − 뷰포트 중앙 = 시작 오프셋 (카드는 flex 중앙 정렬이라 최종 위치가 중앙)
  const fromDx = origin.x - window.innerWidth / 2;
  const fromDy = origin.y - window.innerHeight / 2;
  const originVars = { "--from-dx": `${fromDx}px`, "--from-dy": `${fromDy}px` } as CSSProperties;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        data-id="version-comments-modal"
        className="comment-modal-in flex w-full max-w-md flex-col gap-3 rounded-md bg-surface p-5 shadow-lg"
        style={originVars}
      >
        <h2 className="flex items-center gap-1.5 text-body-strong text-ink">
          <MessageSquare size={16} strokeWidth={1.5} className="shrink-0 text-accent" />
          <span className="truncate">{t("wf.commentsTitle", { label })}</span>
        </h2>
        {commented.length === 0 ? (
          <p className="text-caption text-ink-tertiary">{t("wf.commentsEmpty")}</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {commented.map((evt) => {
              const Icon = EVENT_ICONS[evt.event_type] ?? MessageSquare;
              const iconTone = evt.event_type === "rejected" ? "text-error" : "text-ink-secondary";
              return (
                <li key={evt.id} className="rounded-sm border border-hairline bg-surface-alt p-2.5">
                  <div className="flex items-center gap-1.5">
                    <Icon size={16} strokeWidth={1.5} className={`shrink-0 ${iconTone}`} />
                    <span className="inline-flex items-center gap-1 rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-fine text-ink">
                      <User size={12} strokeWidth={1.5} />
                      {nameById.get(evt.actor) ?? evt.actor}
                    </span>
                    <span className="ml-auto shrink-0 text-fine text-ink-tertiary">
                      {formatKstShort(evt.created_at)}
                    </span>
                  </div>
                  <p className="mt-1.5 break-keep whitespace-pre-wrap text-caption text-ink">{evt.note}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
```

(`as CSSProperties`는 CSS 커스텀 변수 주입의 표준 예외 — 사유 주석 유지. `formatKstShort` export명이 다르면 `lib/datetime.ts` 실측으로 맞춘다.)

- [ ] **Step 4: 패널 배선** — `versions-publish-panel.tsx`:

1. import에 `MessageSquare`(lucide) · `CommentHistoryModal` · `type VersionDetail, type VersionEvent` 추가, `getMap` 기존 유지.
2. 내부 fetch 상태를 이벤트 보존형으로: `useState<VersionSummary[]>([])` → `useState<VersionDetail[]>([])` (`getMap`이 `MapDetail`을 반환하므로 `detail.versions` 그대로 대입 가능).
3. 액션 후 이벤트 리프레시 — 부모 컴포넌트에 `const [eventsReloadKey, setEventsReloadKey] = useState(0);` 추가, 내부 fetch effect deps에 `eventsReloadKey` 포함(effect 가드 `if (versionsProp) return;` 유지). 행에 내려주는 `onChanged`를 래핑:

```tsx
          onChanged={() => {
            setEventsReloadKey((k) => k + 1);
            onChanged?.();
          }}
```

4. 행에 events 전달 — `VersionRowProps`에 `events?: VersionEvent[];` 추가하고 매핑에서:

```tsx
          events={versionsProp ? undefined : fetchedVersions.find((v) => v.id === version.id)?.events}
```

5. `VersionRow` 안: 상태 `const [commentsOrigin, setCommentsOrigin] = useState<{ x: number; y: number } | null>(null);`, 파생 `const commentCount = (events ?? []).filter((e) => e.note).length;`. 액션 div(:266) 첫 자식으로:

```tsx
        {commentCount > 0 && (
          <button
            type="button"
            data-id={`version-comments-open-${versionId}`}
            title={t("wf.viewComments")}
            className="flex items-center gap-1 rounded-sm border border-hairline px-2 py-1 text-fine text-ink-secondary hover:bg-surface-alt"
            onClick={(event) => setCommentsOrigin({ x: event.clientX, y: event.clientY })}
          >
            <MessageSquare size={16} strokeWidth={1.5} />
            {commentCount}
          </button>
        )}
```

6. 행 말미(다른 다이얼로그 마운트 옆)에:

```tsx
      {commentsOrigin && (
        <CommentHistoryModal
          label={label}
          events={events ?? []}
          nameById={nameById}
          origin={commentsOrigin}
          onClose={() => setCommentsOrigin(null)}
        />
      )}
```

- [ ] **Step 5: 게이트** — `npm run lint` · `npx tsc --noEmit` · `npx vitest run` · `npm run build`.
- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/version/comment-history-modal.tsx frontend/src/components/permissions/versions-publish-panel.tsx frontend/src/app/globals.css frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(versions): comment history modal with click-origin zoom — 버전 카드 코멘트 보기 모달(클릭점→중앙 확대·바깥 mousedown 닫힘)"
```

---

### Task 9: 최종 게이트 + 브라우저 실구동 검증

**Files:** 검증 전용(코드 수정 없음 — 발견 결함은 해당 태스크로 돌아가 수정 후 재검증).

- [ ] **Step 1: 전체 게이트 재실행**

```bash
cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/
cd ../frontend && npm run lint && npx tsc --noEmit && npx vitest run && npm run build
```

- [ ] **Step 2: 브라우저 검증 (Playwright + 시스템 Chrome)** — `docs/lessons/browser-verification.md`의 하네스 절차를 따른다(⚠️ dev.db 오염 함정 — 필요 시 리셋 `python -m scripts.reset_db`, 좀비 next dev 3000 점유 전수 pkill). dev 서버 2개(백엔드 8000·프론트 3000, `DEV_ENFORCE_PERMISSIONS=false`) 띄우고 확인 항목:

1. **코멘트 왕복**: 맵 설정→Versions에서 승인 요청 모달에 코멘트 입력→제출→행에 MessageSquare 버튼+카운트 1 표시→클릭→모달이 클릭 지점에서 중앙으로 커지며 등장(스크린샷 2프레임)→코멘트 행(아이콘·작성자 필·KST 시각·본문) 확인.
2. **바깥 mousedown 닫힘**: 모달 밖 `mousedown`만으로 즉시 닫힘(`page.mouse.down()`에 닫혀야 함) + Escape 닫힘.
3. **바로철회 대칭**: 승인 0건 pending을 철회(모달에 코멘트 입력란 없어야 함)→행의 코멘트 버튼이 사라짐(submit 코멘트 동반 삭제).
4. **거절 배너**: reject(사유 입력)→에디터 헤더에 틴트 칩+거절자 필+사유 렌더(`[data-id="wf-rejected-banner"]`).
5. **에러 인간화**: 우회 409 유발(예: draft 버전에 devtools fetch로 `/api/versions/{id}/approve` 호출 후 UI 액션, 또는 두 탭 경합) — 토스트에 JSON 중괄호 없이 `… (HTTP 409)` 형식+XCircle 톤 확인. 콘솔에 원문 JSON `console.error` 확인.
6. **받은함 사유**: 다른 유저(dev 유저 전환은 `page.goto`로)로 rename 요청→받은함에서 거절+사유 입력→요청자 알림 메시지 말미에 `: {사유}` 확인.

각 항목의 실측 결과(통과/실패 + 증적 스크린샷 경로)를 작업 로그에 남긴다. CSS 애니메이션 검증은 백그라운드 탭 스로틀 주의 — 포그라운드로.

- [ ] **Step 3: PROGRESS 최종 정리 + 마무리** — 브랜치 커밋들이 전부 그린인 상태에서 superpowers:finishing-a-development-branch 스킬로 dev 머지 절차 진행(사용자 확인 후).

---

## Self-Review 결과 (플랜 작성자 체크)

- **스펙 커버리지**: §3.1→Task 2 · §3.2→Task 3 · §4→Task 4·5 · §5.1→Task 6 · §5.2/§5.3→Task 7 · §5.4→Task 8 · §7→Task 9. 누락 없음.
- **타입 일관성**: `CommentIn`/`SubmitIn.comment`(BE) ↔ `comment?` 파라미터(FE Task 4) ↔ 다이얼로그 `comment/onCommentChange`(Task 7) 일치. `decision_reason`(Task 3 BE) ↔ `ApprovalRequest.decision_reason`(Task 4 FE 타입) 일치. `CommentHistoryModal` props(Task 8 생성부=사용부) 일치.
- **플레이스홀더**: 라인 번호는 "±드리프트 가능" 명시 외 TBD 없음. 실측 지시 2건(rename-requests 상태코드, formatKstShort export명)은 검증 방법 명시.
