# AI L5 2라운드 스프린트 ② 관리 패널 진입 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설정 > Categories & import 우측 상세 패널의 AI L5 블록을 "선택 레벨에 따라 배타적으로 바뀌는 타일 액션"(L1~3 하위 드릴 · L4 새 L5 만들기 · L5 AI로 작업/이어서)으로 바꾸고, 인터뷰 JSON 임포트를 프롬프트 복사 버튼과 한 행인 독립 섹션으로 분리한다.

**Architecture:** 새 컴포넌트 `FwLevelActions`(`components/admin/fw-level-actions.tsx`)가 레벨 분기 렌더를 전담하고, `framework-panel.tsx`는 상태(선택·트리·세션)와 콜백만 넘긴다. 세션 배지는 백엔드 목록 응답에 `category_path_ids`를 더해 클라이언트가 서브트리로 집계한다. 새 L5 이름은 기존 `PromptDialog`로 받고 형제 이름 중복은 FE에서 즉시, BE는 같은 부모 아래 같은 이름 409로 이중 가드. AI 타일 스타일은 스프린트 ③의 `AiButton`이 오기 전이므로 이 스프린트에서는 `AI_TILE` 클래스 상수(액센트 그라데이션, 쉬머 없음)로 두고 ③에서 교체한다.

**Tech Stack:** FastAPI + SQLAlchemy async + Pydantic v2(Python 3.11 문법만), Next.js/React/Tailwind v4 토큰, vitest, Playwright(`playwright-core` + 시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-23-ai-l5-campaign-round2-design.md` §2

## Global Constraints

- Python 3.11 문법만(`backend/ruff.toml target-version py311`). PEP 695 등 금지.
- UI 문구·프롬프트에 긴 대시(—) 금지. UI 영어 기본, i18n en/ko 동시 추가(`frontend/src/lib/i18n-messages.ts`, en 블록과 ko 블록 둘 다).
- 색은 토큰만(raw hex 금지). 아이콘 Lucide 14/16 strokeWidth 1.5. 굵기 300/400/600. 버튼 커서·눌림은 전역 base라 컴포넌트엔 hover 배경만.
- 인터랙티브 요소 `data-id`(`surface-role` kebab, 리스트는 키 접미).
- 오버레이 z 사다리: 모달 1200 · 토스트 1300 · 포털 드롭다운 1350.
- 컴포넌트 추가·삭제 시 `frontend/`에서 `node scripts/build-component-catalog.mjs` 재생성. 모든 컴포넌트 파일 머리 주석 한 줄.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 갱신 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트: backend(backend/) `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` + `.venv/bin/ruff check app/ tests/`; frontend(frontend/) `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`. pytest는 병렬 실행 금지(sqlite 충돌).
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 복합 Bash는 harness가 거부할 수 있으니 단순 명령으로 나눈다. 광범위 `pkill` 금지. 검증 포트 3047/8048.
- 프론트 변경 완료 시 Playwright 캡처를 `docs/qa/screens/`에 남기고 공유(SendUserFile).

---

### Task 1: 같은 부모 아래 같은 이름 409 (BE)

**Files:**
- Modify: `backend/app/routers/categories.py:1249-1253` (`create_category`, `code` 중복 검사 앞)
- Test: `backend/tests/test_categories_api.py` (기존 create 테스트 옆에 추가)

**Interfaces:**
- Produces: `POST /categories` → 409 `detail="name 'X' already exists under this parent"`. 비교는 `name.strip()` 정확 일치(대소문자 구분), 같은 `parent_id`(루트끼리는 `parent_id IS NULL`).

- [ ] **Step 1: 실패하는 테스트 작성** — 파일 안의 기존 `create` 테스트가 쓰는 fixture 이름(`client`, 헤더 dict)을 그대로 쓴다. 아래는 `client`(AsyncClient)와 `ADMIN_HEADERS`가 있다고 가정한 형태이며, 파일 상단 정의명에 맞춘다.

```python
async def test_create_category_rejects_duplicate_name_under_same_parent(client):
    root = (await client.post("/api/categories", json={"name": "Dup Root", "parent_id": None}, headers=ADMIN_HEADERS)).json()
    first = await client.post("/api/categories", json={"name": "Same", "parent_id": root["id"]}, headers=ADMIN_HEADERS)
    assert first.status_code == 200
    second = await client.post("/api/categories", json={"name": " Same ", "parent_id": root["id"]}, headers=ADMIN_HEADERS)
    assert second.status_code == 409
    assert "already exists under this parent" in second.json()["detail"]
    # 다른 부모 아래 같은 이름은 허용
    other = (await client.post("/api/categories", json={"name": "Other Root", "parent_id": None}, headers=ADMIN_HEADERS)).json()
    allowed = await client.post("/api/categories", json={"name": "Same", "parent_id": other["id"]}, headers=ADMIN_HEADERS)
    assert allowed.status_code == 200
```

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_categories_api.py -q -k duplicate_name` → FAIL(두 번째가 200).

- [ ] **Step 3: 구현** — `create_category`에서 `code = payload.code` 직전에 삽입.

```python
    # 같은 부모 아래 같은 이름은 관리 트리에서 구분이 안 된다 — trim 정확 일치로 막는다 (2026-09-23)
    name = payload.name.strip()
    dup_name = await session.scalar(
        select(ProcessCategory.id).where(
            ProcessCategory.parent_id == payload.parent_id, ProcessCategory.name == name,
        )
    )
    if dup_name is not None:
        raise HTTPException(status_code=409, detail=f"name '{name}' already exists under this parent")
```

그리고 아래 `ProcessCategory(... name=payload.name ...)`를 `name=name`으로.

- [ ] **Step 4: 통과 확인 + 린트**

Run: 같은 pytest 명령 → PASS. `cd backend && .venv/bin/ruff check app/ tests/` → clean. 전체 `tests/test_categories_api.py`도 green인지 확인(기존 테스트가 같은 부모에 같은 이름을 두 번 만들면 그 테스트의 이름을 바꾼다).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/routers/categories.py backend/tests/test_categories_api.py PROGRESS.md
git commit -m "feat(categories): reject duplicate names under one parent — 같은 부모 아래 이름 중복 409"
```

---

### Task 2: 세션 목록에 `category_path_ids` (BE + FE 타입)

**Files:**
- Modify: `backend/app/schemas.py:2801-2818` (`FrameworkInterviewOut`)
- Modify: `backend/app/routers/framework_interviews.py:64-80` (`_out`)
- Modify: `frontend/src/lib/api.ts:2931-2948` (`FwInterviewSession`)
- Test: `backend/tests/test_framework_interview_api.py`

**Interfaces:**
- Produces: `FrameworkInterviewOut.category_path_ids: list[int]` = root→self 조상 id 체인(자기 포함). FE `FwInterviewSession.category_path_ids: number[]`.

- [ ] **Step 1: 실패하는 테스트 작성** — 파일의 기존 세션 생성 헬퍼(카테고리 L1~L5 생성 후 `POST /api/framework-interviews`)를 재사용.

```python
async def test_session_out_carries_category_path_ids(client, seeded_l5):
    # seeded_l5: 기존 픽스처 또는 헬퍼 — L1..L5 id 리스트를 돌려준다
    ids = seeded_l5
    res = await client.post("/api/framework-interviews", json={"category_id": ids[-1], "lang": "ko"}, headers=ADMIN_HEADERS)
    assert res.status_code == 200
    assert res.json()["category_path_ids"] == ids
    listed = await client.get("/api/framework-interviews?active=true", headers=ADMIN_HEADERS)
    assert listed.json()[0]["category_path_ids"] == ids
```

픽스처가 없으면 테스트 안에서 `for level in range(5): post /api/categories` 로 체인을 만들고 id 리스트를 모은다.

- [ ] **Step 2: 실패 확인**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_framework_interview_api.py -q -k category_path_ids` → FAIL(KeyError).

- [ ] **Step 3: 구현**

`schemas.py` `FrameworkInterviewOut`에 `category_id: int` 아래:

```python
    category_path_ids: list[int] = []  # root→self 조상 id 체인(자기 포함) — 관리 패널 타일의 서브트리 세션 배지용
```

`framework_interviews.py` `_out`: 함수 시작부에 체인 계산을 추가하고 생성자에 넘긴다. 조상 걷기는 `load_category_chain`(assemble.py)이 전 카테고리를 읽으므로 목록 N건에 N번 부르지 않도록 `_out`용 경량 헬퍼를 둔다.

```python
async def _category_path_ids(db: AsyncSession, category_id: int) -> list[int]:
    """root→self id 체인 — 부모 포인터를 따라 올라간다(카테고리 깊이 최대 5)."""
    ids: list[int] = []
    current = await db.get(ProcessCategory, category_id)
    while current is not None:
        ids.append(current.id)
        current = await db.get(ProcessCategory, current.parent_id) if current.parent_id else None
    ids.reverse()
    return ids
```

`_out` 안: `category = await db.get(...)` 다음 줄에 `path_ids = await _category_path_ids(db, s.category_id)`, 생성자에 `category_path_ids=path_ids,` 추가.

`frontend/src/lib/api.ts` `FwInterviewSession`에 `category_id: number;` 아래 `category_path_ids: number[];`.

- [ ] **Step 4: 통과 확인**

Run: pytest 같은 명령 → PASS. `ruff check` clean. `cd frontend && npx tsc --noEmit -p tsconfig.json` → 0(테스트 픽스처에서 `FwInterviewSession`을 만드는 곳이 있으면 `category_path_ids: []` 추가).

- [ ] **Step 5: 커밋**

```bash
git add backend/app/schemas.py backend/app/routers/framework_interviews.py backend/tests/test_framework_interview_api.py frontend/src/lib/api.ts PROGRESS.md
git commit -m "feat(fw-interview): expose category_path_ids on sessions — 세션 응답에 조상 id 체인"
```

---

### Task 3: 서브트리 세션 집계 순수 함수 (FE)

**Files:**
- Create: `frontend/src/lib/fw-level-actions.ts`
- Test: `frontend/src/lib/fw-level-actions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function countSessionsUnder(sessions: Pick<FwInterviewSession, "category_path_ids">[], categoryId: number): number
  export function findDuplicateSibling(children: Pick<CategoryNode, "name">[], name: string): boolean
  export function findSessionFor(sessions: Pick<FwInterviewSession, "id" | "category_id">[], categoryId: number): { id: number } | null
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/fw-level-actions.test.ts
import { describe, expect, it } from "vitest";

import { countSessionsUnder, findDuplicateSibling, findSessionFor } from "./fw-level-actions";

describe("countSessionsUnder", () => {
  const sessions = [
    { category_path_ids: [1, 10, 100, 1000, 10000] },
    { category_path_ids: [1, 10, 101, 1010, 10100] },
    { category_path_ids: [2, 20, 200, 2000, 20000] },
  ];
  it("counts sessions whose chain contains the id", () => {
    expect(countSessionsUnder(sessions, 1)).toBe(2);
    expect(countSessionsUnder(sessions, 10)).toBe(2);
    expect(countSessionsUnder(sessions, 100)).toBe(1);
    expect(countSessionsUnder(sessions, 2)).toBe(1);
    expect(countSessionsUnder(sessions, 999)).toBe(0);
  });
});

describe("findDuplicateSibling", () => {
  it("matches trimmed exact names, case-sensitive", () => {
    const children = [{ name: "Order Intake" }, { name: "Billing" }];
    expect(findDuplicateSibling(children, " Billing ")).toBe(true);
    expect(findDuplicateSibling(children, "billing")).toBe(false);
    expect(findDuplicateSibling(children, "Shipping")).toBe(false);
  });
});

describe("findSessionFor", () => {
  it("returns the session bound to the category or null", () => {
    const sessions = [{ id: 5, category_id: 100 }, { id: 6, category_id: 200 }];
    expect(findSessionFor(sessions, 200)).toEqual({ id: 6, category_id: 200 });
    expect(findSessionFor(sessions, 300)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/fw-level-actions.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/fw-level-actions.ts
// 관리 패널 레벨별 타일 액션의 순수 계산 — 서브트리 세션 수·형제 이름 중복·L5의 진행 세션. 컴포넌트는 fw-level-actions.tsx (2026-09-23).

import type { CategoryNode, FwInterviewSession } from "./api";

export function countSessionsUnder(sessions: Pick<FwInterviewSession, "category_path_ids">[], categoryId: number): number {
  return sessions.filter((session) => session.category_path_ids.includes(categoryId)).length;
}

export function findDuplicateSibling(children: Pick<CategoryNode, "name">[], name: string): boolean {
  const wanted = name.trim();
  return children.some((child) => child.name.trim() === wanted);
}

export function findSessionFor<T extends Pick<FwInterviewSession, "id" | "category_id">>(sessions: T[], categoryId: number): T | null {
  return sessions.find((session) => session.category_id === categoryId) ?? null;
}
```

- [ ] **Step 4: 통과 확인**

Run: 같은 vitest → PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/fw-level-actions.ts frontend/src/lib/fw-level-actions.test.ts PROGRESS.md
git commit -m "feat(fw-admin): pure helpers for level tile actions — 레벨 타일 순수 계산"
```

---

### Task 4: `FwLevelActions` 컴포넌트 + 패널 배선 (A1)

**Files:**
- Create: `frontend/src/components/admin/fw-level-actions.tsx`
- Modify: `frontend/src/components/admin/framework-panel.tsx` — 상태/핸들러(195-263행), AI 블록 JSX(962-1030행), `NamePrompt` 타입(151-154행)과 `handleNameSubmit`(530-552행), PromptDialog 렌더(1208-1224행)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko 각 8키)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
- Consumes: Task 2 `category_path_ids`, Task 3 헬퍼, `LevelPill`(`components/level-pill.tsx`, props `level`·`size`), `PromptDialog`(`error` prop으로 인라인 에러).
- Produces:
  ```tsx
  interface FwLevelActionsProps {
    selectedNode: CategoryNode | null;
    children: CategoryNode[] | undefined;   // 선택 노드의 자식(미로드면 undefined)
    childrenLoading: boolean;
    sessions: FwInterviewSession[];          // 진행 중 세션 전체
    busy: boolean;
    onPick: (node: CategoryNode) => void;    // 하위 타일 클릭 = 선택 이동
    onCreateL5: () => void;                  // L4에서 이름 모달 열기
    onStart: (l5Id: number) => void;         // 새 세션
    onResume: (sessionId: number) => void;   // 진행 세션으로 이동
  }
  export function FwLevelActions(props: FwLevelActionsProps): JSX.Element
  ```
- 제거: `fw-consult-new-name` 인풋 · `fw-consult-create` · `fw-consult-start` · `fw-consult-sessions-toggle`(+ 포털 `fw-consult-sessions-panel`, 관련 `sessionsOpen/sessionsPos/sessionsBtnRef` 상태와 두 useEffect). 세션 목록은 타일 배지·L5 "이어서" 타일로 대체된다.
- 신규 data-id: `fw-level-actions` · `fw-level-tile-${id}` · `fw-level-tile-badge-${id}` · `fw-level-more` · `fw-level-create-l5` · `fw-level-start` · `fw-level-resume` · `fw-level-empty`.

- [ ] **Step 1: i18n 키 추가** — en 블록 `"fwConsult.` 묶음 끝과 ko 블록 같은 자리에:

```ts
  // en
  "fwLevel.childrenTitle": "Go deeper",
  "fwLevel.more": "+{n} more in the tree",
  "fwLevel.sessions": "{n} in progress",
  "fwLevel.createL5": "Create L5 and start with AI",
  "fwLevel.createL5Hint": "Adds a new L5 under this L4 and opens the AI campaign",
  "fwLevel.start": "Work with AI",
  "fwLevel.resume": "Resume AI session",
  "fwLevel.duplicateName": "An L5 with this name already exists here",
  // ko
  "fwLevel.childrenTitle": "하위로 이동",
  "fwLevel.more": "트리에 {n}개 더 있음",
  "fwLevel.sessions": "진행 중 {n}",
  "fwLevel.createL5": "L5 만들고 AI로 시작",
  "fwLevel.createL5Hint": "이 L4 아래 새 L5를 만들고 AI 캠페인을 엽니다",
  "fwLevel.start": "AI로 작업",
  "fwLevel.resume": "AI 세션 이어서",
  "fwLevel.duplicateName": "같은 이름의 L5가 이미 있습니다",
```

- [ ] **Step 2: 컴포넌트 작성**

```tsx
"use client";

// 관리 패널 레벨별 타일 액션 — L1~3은 하위 타일 드릴(좌측 트리와 싱크), L4는 새 L5 만들기, L5는 AI로 작업/이어서. framework-panel 전용 (spec 2026-09-23 §2 A1).

import { Headset, Play, Sparkles } from "lucide-react";

import type { CategoryNode, FwInterviewSession } from "@/lib/api";
import { countSessionsUnder, findSessionFor } from "@/lib/fw-level-actions";
import { useI18n } from "@/lib/i18n";
import { LevelPill } from "@/components/level-pill";

const TILE_ROWS_VISIBLE = 2.5;     // 2열 타일 2행 반까지만 보이고 나머지는 페이드+"+N"
const TILE_HEIGHT_PX = 56;
const TILE_GAP_PX = 6;
const LIST_MAX_HEIGHT = Math.round(TILE_HEIGHT_PX * TILE_ROWS_VISIBLE + TILE_GAP_PX * 2);

const TILE = "flex h-14 min-w-0 items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 text-left hover:bg-surface-alt disabled:opacity-40";
// AI 액션 타일 — 스프린트 ③ AiButton으로 교체 예정(그라데이션만, 쉬머 없음)
const AI_TILE = "flex h-14 w-full items-center gap-2 rounded-md px-3 text-left text-on-accent hover:brightness-105 disabled:opacity-40 [background:linear-gradient(135deg,var(--color-accent),var(--color-accent-focus))]";

interface FwLevelActionsProps {
  selectedNode: CategoryNode | null;
  children: CategoryNode[] | undefined;
  childrenLoading: boolean;
  sessions: FwInterviewSession[];
  busy: boolean;
  onPick: (node: CategoryNode) => void;
  onCreateL5: () => void;
  onStart: (l5Id: number) => void;
  onResume: (sessionId: number) => void;
}

export function FwLevelActions({ selectedNode, children, childrenLoading, sessions, busy, onPick, onCreateL5, onStart, onResume }: FwLevelActionsProps) {
  const { t } = useI18n();
  if (!selectedNode) {
    return <p data-id="fw-level-empty" className="text-fine text-ink-tertiary">{t("framework.adminDetailEmpty")}</p>;
  }
  const level = selectedNode.level;

  if (level <= 3) {
    const rows = children ?? [];
    const visibleCap = Math.ceil(TILE_ROWS_VISIBLE) * 2;
    const hidden = Math.max(0, rows.length - visibleCap);
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <span className="text-fine text-ink-tertiary">{t("fwLevel.childrenTitle")}</span>
        <div className="relative overflow-hidden" style={{ maxHeight: LIST_MAX_HEIGHT }}>
          <div className="grid grid-cols-2 gap-1.5">
            {rows.map((child) => {
              const n = countSessionsUnder(sessions, child.id);
              return (
                <button key={child.id} type="button" data-id={`fw-level-tile-${child.id}`} className={TILE} disabled={busy} onClick={() => onPick(child)}>
                  <LevelPill level={child.level} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-caption text-ink">{child.name}</span>
                  {n > 0 && (
                    <span data-id={`fw-level-tile-badge-${child.id}`} className="shrink-0 rounded-full bg-accent-tint px-1.5 text-fine text-accent" title={t("fwLevel.sessions", { n })}>
                      {n}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {hidden > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface-pearl to-transparent" />
          )}
        </div>
        {childrenLoading && <span className="text-fine text-ink-tertiary">…</span>}
        {hidden > 0 && <span data-id="fw-level-more" className="text-fine text-ink-tertiary">{t("fwLevel.more", { n: hidden })}</span>}
      </div>
    );
  }

  if (level === 4) {
    return (
      <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
        <button type="button" data-id="fw-level-create-l5" className={AI_TILE} disabled={busy} title={t("fwLevel.createL5Hint")} onClick={onCreateL5}>
          <Sparkles size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.createL5")}</span>
        </button>
      </div>
    );
  }

  const session = findSessionFor(sessions, selectedNode.id);
  return (
    <div data-id="fw-level-actions" className="flex flex-col gap-1.5">
      {session ? (
        <button type="button" data-id="fw-level-resume" className={AI_TILE} disabled={busy} onClick={() => onResume(session.id)}>
          <Play size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.resume")}</span>
          <span className="shrink-0 text-fine opacity-80">{session.progress.drawn}/{session.progress.total}</span>
        </button>
      ) : (
        <button type="button" data-id="fw-level-start" className={AI_TILE} disabled={busy} onClick={() => onStart(selectedNode.id)}>
          <Headset size={16} strokeWidth={1.5} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate text-caption">{t("fwLevel.start")}</span>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 패널 상태·핸들러 정리** (`framework-panel.tsx`)

1. `NamePrompt` 유니온에 `| { kind: "add-l5"; parentId: number }` 추가. `handleNameSubmit`에 분기 추가 — 생성 후 세션까지 연다:

```ts
        } else if (prompt.kind === "add-l5") {
          const created = await createCategory({ name, parent_id: prompt.parentId });
          setOpenIds((prev) => new Set(prev).add(prompt.parentId));
          await refreshTree([prompt.parentId]);
          const session = await createFrameworkInterview({ category_id: created.id, lang });
          router.push(`/framework/consult/${session.id}`);
          return;
        }
```

2. `PromptDialog` 렌더의 `title`에 `add-l5` 분기(`t("fwConsult.newL5Name")` 재사용)와 `error` prop 배선: `namePrompt.kind === "add-l5" && findDuplicateSibling(childrenByParent.get(namePrompt.parentId) ?? [], nameDraft) ? t("fwLevel.duplicateName") : null`. `PromptDialog`가 입력값을 밖으로 알리지 않으면 `onChange?: (value: string) => void` prop을 `prompt-dialog.tsx`에 1줄 추가하고 `nameDraft` 상태를 패널에 둔다. 중복이면 `onConfirm`에서 아무것도 하지 않는다(모달 유지).

3. `handleStartConsult`를 `handleStartConsult(l5Id: number)`로 단순화(`mode` 인자·`newL5Name` 상태 제거):

```ts
  async function handleStartConsult(l5Id: number) {
    setConsultBusy(true);
    try {
      const session = await createFrameworkInterview({ category_id: l5Id, lang });
      router.push(`/framework/consult/${session.id}`);
    } catch (err) {
      onToast(getApiErrorDetail(err));  // 409 = 진행 중 세션 존재
      listFrameworkInterviews(true).then(setActiveSessions).catch(() => undefined);
    } finally {
      setConsultBusy(false);
    }
  }
```

4. 선택 노드의 자식 로드 — 선택이 L1~3이고 `childrenByParent`에 없으면 로드한다(`toggleOpen`의 로드 코드와 같은 호출). 선택 변경 effect:

```ts
  useEffect(() => {
    if (!selectedNode || selectedNode.level > 3 || childrenByParent.has(selectedNode.id) || loadingIds.has(selectedNode.id)) return;
    const id = selectedNode.id;
    setLoadingIds((prev) => new Set(prev).add(id));
    listCategoryNodes(id)
      .then((nodes) => setChildrenByParent((prev) => new Map(prev).set(id, nodes)))
      .catch((err: unknown) => onToast(getApiErrorDetail(err)))
      .finally(() => setLoadingIds((prev) => { const next = new Set(prev); next.delete(id); return next; }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedNode.id·level만 본다: Map/Set 참조로 걸면 로드 완료마다 재실행
  }, [selectedNode?.id, selectedNode?.level]);
```

5. 세션 드롭다운 관련(`sessionsBtnRef`, `sessionsOpen`, `sessionsPos`, `closeSessions`, 두 `useEffect`, 포털 JSX 1177-1204행, `SESSIONS_*` 상수, `ChevronDown` import가 다른 곳에서 안 쓰이면 import도) 제거.

- [ ] **Step 4: AI 블록 JSX 교체** — 962~1030행 `framework-admin-ai` div 내부를 헤더 한 줄 + `FwLevelActions`로:

```tsx
        {!scopeRootIds && (
          <div data-id="framework-admin-ai" className="flex shrink-0 flex-col gap-2 rounded-md border border-hairline bg-surface p-2.5">
            <div className="flex items-center gap-1.5">
              <Headset size={14} strokeWidth={1.5} className="shrink-0 text-accent" />
              <span className="text-caption text-ink">{t("fwConsult.aiBlock")}</span>
            </div>
            <FwLevelActions
              selectedNode={selectedNode}
              children={selectedNode ? childrenByParent.get(selectedNode.id) : undefined}
              childrenLoading={selectedNode ? loadingIds.has(selectedNode.id) : false}
              sessions={activeSessions}
              busy={consultBusy}
              onPick={(node) => {
                setSelectedId(node.id);
                setOpenIds((prev) => new Set(prev).add(node.id));
                // 좌측 트리도 그 행으로 — 기존 검색 히트 스크롤과 같은 방식(525행)
                window.setTimeout(() => document.querySelector(`[data-id="framework-admin-node-${node.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
              }}
              onCreateL5={() => { if (selectedNode) setNamePrompt({ kind: "add-l5", parentId: selectedNode.id }); }}
              onStart={(id) => void handleStartConsult(id)}
              onResume={(sessionId) => router.push(`/framework/consult/${sessionId}`)}
            />
          </div>
        )}
```

`InterviewJsonPromptButton`은 이 블록에서 빼고 Task 5의 임포트 섹션으로 옮긴다(`consultTarget`·`fetchedTarget` 상태는 유지).

- [ ] **Step 5: 게이트 + 카탈로그**

Run(frontend/): `npx tsc --noEmit -p tsconfig.json` → 0 · `npm run lint` → 0 · `npx vitest run` → green · `node scripts/build-component-catalog.mjs` 재생성 후 `--check` 통과.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/components/admin/fw-level-actions.tsx frontend/src/components/admin/framework-panel.tsx frontend/src/components/prompt-dialog.tsx frontend/src/lib/i18n-messages.ts frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-admin): level-aware tile actions replace the AI L5 block — 레벨별 타일 액션"
```

---

### Task 5: 인터뷰 임포트 독립 섹션 + 프롬프트 복사 토스트 (A2)

**Files:**
- Modify: `frontend/src/components/framework-interview/interview-json-prompt-button.tsx` (`onCopied` prop)
- Modify: `frontend/src/components/admin/framework-panel.tsx:1035-1070` (임포트 픽 버튼 → 섹션 카드)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko 각 2키)
- Test: `frontend/src/components/framework-interview/interview-json-prompt-button.test.tsx` (신규, `@testing-library/react`가 devDependencies에 있으면; 없으면 스모크로 대체하고 이 Step은 건너뛴다)

**Interfaces:**
- Produces: `InterviewJsonPromptButton({ target, disabled, onCopied?: () => void, tone?: "outline" | "tint" })`. `tone="tint"`는 `bg-accent-tint text-accent border-accent/30`.
- 신규 data-id: `interview-import-section`.

- [ ] **Step 1: i18n**

```ts
  // en
  "framework.interviewSectionTitle": "Interview JSON",
  "fwConsult.promptCopiedToast": "External AI prompt copied to clipboard",
  // ko
  "framework.interviewSectionTitle": "인터뷰 JSON",
  "fwConsult.promptCopiedToast": "외부 AI 프롬프트를 클립보드에 복사했습니다",
```

- [ ] **Step 2: 버튼 prop 추가** (`interview-json-prompt-button.tsx`)

```tsx
const TONE = {
  outline: "border-hairline bg-surface text-ink-secondary hover:bg-surface-alt",
  tint: "border-accent/30 bg-accent-tint text-accent hover:bg-accent-tint/80",
} as const;

export function InterviewJsonPromptButton({ target, disabled, onCopied, tone = "outline" }: {
  target?: InterviewPromptTarget; disabled?: boolean; onCopied?: () => void; tone?: keyof typeof TONE;
}) {
  // ...
  const handleCopy = async () => {
    const ok = await copyText(buildInterviewJsonPromptText(target));
    setCopyState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    window.setTimeout(() => setCopyState("idle"), ok ? 1200 : 1600);
  };
  // className={`inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-caption disabled:opacity-50 ${TONE[tone]}`}
```

- [ ] **Step 3: 패널 임포트 섹션** — 1035~1070행의 `<input type=file>`+픽 버튼 블록을 카드로 감싼다(`mt-auto`는 카드로 이동).

```tsx
        {!scopeRootIds && (
          <div data-id="interview-import-section" className="mt-auto flex shrink-0 flex-col gap-2 rounded-md border border-hairline bg-surface p-2.5">
            <div className="flex items-center gap-1.5">
              <FileJson size={14} strokeWidth={1.5} className="shrink-0 text-ink-tertiary" />
              <span className="text-caption text-ink">{t("framework.interviewSectionTitle")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <input ref={interviewInputRef} ... (기존 그대로) />
              <button type="button" data-id="interview-import-pick" disabled={interviewBusy} className={IMPORT_FILE_BTN} onClick={() => interviewInputRef.current?.click()}>
                <Upload size={14} strokeWidth={1.5} className="shrink-0" />
                <span className="truncate">{t("framework.interviewImportPick")}</span>
                {interviewFiles.length > 0 && (
                  <span data-id="interview-import-pick-count" className="shrink-0 rounded-full bg-accent-tint px-1.5 text-fine text-accent">{interviewFiles.length}</span>
                )}
              </button>
              <InterviewJsonPromptButton target={consultTarget} tone="tint" onCopied={() => onToast(t("fwConsult.promptCopiedToast"))} />
            </div>
          </div>
        )}
```

- [ ] **Step 4: 게이트**

Run(frontend/): `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check` → 전부 green.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/framework-interview/interview-json-prompt-button.tsx frontend/src/components/admin/framework-panel.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(fw-admin): split interview import into its own section with tinted prompt copy — 임포트 섹션 분리·복사 토스트"
```

---

### Task 6: 스모크 이식 + 신규 스모크 + 캡처

**Files:**
- Create: `frontend/scripts/pw-fw-level-actions.mjs`
- Modify(구 id 제거): `frontend/scripts/pw-fw-consult-new-l5.mjs`, `pw-fw-consult-existing.mjs`, `pw-fw-admin-layout-shot.mjs`, `pw-fw-consult.mjs`, `pw-smoke-field-promotion.mjs`, `pw-smoke-interview-import.mjs`
- Capture: `docs/qa/screens/framework-admin-selected.png`(갱신), `docs/qa/screens/fw-level-tiles.png`, `docs/qa/screens/fw-level-create-l5.png`

**Interfaces:**
- 구 → 신 셀렉터: `fw-consult-new-name`+`fw-consult-create` → `fw-level-create-l5` 클릭 후 `PromptDialog` 입력(`[data-id="prompt-dialog-input"]`; 실제 id는 `prompt-dialog.tsx`에서 grep) · `fw-consult-start` → `fw-level-start` · `fw-consult-sessions-toggle`/`fw-consult-resume-${id}` → `fw-level-resume`(해당 L5 선택 상태) · `interview-import-pick`은 유지(섹션만 바뀜).

- [ ] **Step 1: 서버 기동** — backend `AI_ENABLED=true`(가짜 AI 불필요, 세션 생성만) 8048, frontend 3047 `--webpack`.

- [ ] **Step 2: 신규 스모크**

```js
// frontend/scripts/pw-fw-level-actions.mjs
// 관리 패널 레벨별 타일 — L1~3 하위 타일 드릴(트리 싱크), L4 새 L5 모달+중복 차단, L5 AI로 작업/이어서, 세션 배지 롤업.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-level-actions.mjs
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";
const ADMIN = "admin.sys";
const H = { "X-Dev-User": ADMIN, "Content-Type": "application/json" };
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };
async function post(path, body) {
  const r = await fetch(`${BACKEND}${path}`, { method: "POST", headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`);
  return r.json();
}

// L1 > L2 > L3 > L4 > L5(기존, 세션 1개) + L4 아래 형제 L5 "Taken"
const tag = Date.now().toString(36);
const chain = [];
let parent = null;
for (let level = 1; level <= 4; level++) { const n = await post("/api/categories", { name: `lvl-L${level}-${tag}`, parent_id: parent }); chain.push(n); parent = n.id; }
const l4 = chain[3];
const existingL5 = await post("/api/categories", { name: `lvl-L5-${tag}`, parent_id: l4.id });
await post("/api/categories", { name: `Taken-${tag}`, parent_id: l4.id });
const session = await post("/api/framework-interviews", { category_id: existingL5.id, lang: "en" });

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const page = await ctx.newPage();
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-detail"]').waitFor();
check("no selection shows the empty hint", await page.locator('[data-id="fw-level-empty"]').isVisible());

// L1 선택(검색 히트) → 하위 타일에 L2가 보이고 배지 1(서브트리 세션 롤업)
await page.locator('[data-id="framework-admin-search"]').fill(chain[0].name);
await page.locator(`[data-id="framework-admin-search-result-${chain[0].id}"]`).click();
const l2Tile = page.locator(`[data-id="fw-level-tile-${chain[1].id}"]`);
await l2Tile.waitFor();
check("L1 selection lists L2 child tiles", true);
check("subtree session badge rolls up to L2 tile", (await page.locator(`[data-id="fw-level-tile-badge-${chain[1].id}"]`).innerText()) === "1");
await page.screenshot({ path: "../docs/qa/screens/fw-level-tiles.png" });

// 타일 클릭 → 선택 이동 + 좌측 트리 aria-current 싱크
await l2Tile.click();
await page.locator(`[data-id="framework-admin-node-${chain[1].id}"][aria-current="true"]`).waitFor({ timeout: 10000 });
check("tile click moves selection and syncs the tree", true);
await page.locator(`[data-id="fw-level-tile-${chain[2].id}"]`).click();
await page.locator(`[data-id="fw-level-tile-${l4.id}"]`).click();

// L4 → 새 L5 타일 → 모달 → 중복 이름 차단 → 정상 이름으로 세션 생성
await page.locator('[data-id="fw-level-create-l5"]').click();
const input = page.locator('[data-id="prompt-dialog-input"]');
await input.fill(`Taken-${tag}`);
check("duplicate sibling name shows the inline error", await page.getByText("already exists here").isVisible());
await page.screenshot({ path: "../docs/qa/screens/fw-level-create-l5.png" });
await input.fill(`fresh-${tag}`);
await page.locator('[data-id="prompt-dialog-confirm"]').click();
await page.waitForURL(/\/framework\/consult\/\d+/, { timeout: 15000 });
check("fresh name creates the L5 and opens the campaign", true);

// 뒤로 → 기존 L5 선택 → "이어서" 타일
await page.goto(`${BASE}/settings?tab=framework`);
await page.locator('[data-id="framework-admin-search"]').fill(existingL5.name);
await page.locator(`[data-id="framework-admin-search-result-${existingL5.id}"]`).click();
await page.locator('[data-id="fw-level-resume"]').waitFor();
check("L5 with a live session shows the resume tile", true);
await page.screenshot({ path: "../docs/qa/screens/framework-admin-selected.png" });

// 임포트 섹션 + 프롬프트 복사 토스트
check("interview import section is its own card", await page.locator('[data-id="interview-import-section"] [data-id="interview-import-pick"]').isVisible());
await page.locator('[data-id="interview-import-section"] [data-id="fw-consult-copy-prompt"]').click();
check("prompt copy raises a toast", await page.getByText("copied to clipboard").isVisible({ timeout: 3000 }).catch(() => false));

await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
```

`prompt-dialog-input`/`prompt-dialog-confirm`은 `prompt-dialog.tsx`의 실제 `data-id`로 맞춘다(없으면 추가).

- [ ] **Step 3: 구 스모크 6종 이식** — 각 파일에서 구 id를 인터페이스 표대로 바꾼다. `pw-fw-consult-new-l5.mjs`는 인풋+버튼 대신 타일→모달 흐름으로, `pw-fw-consult.mjs`/`pw-fw-consult-existing.mjs`는 `fw-consult-start`→`fw-level-start`, 세션 드롭다운 단언은 `fw-level-resume`로. 실행해 전부 기존 PASS 수 유지.

Run(frontend/): `BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-level-actions.mjs` → `9/9`, 이식 6종 각각 green.

- [ ] **Step 4: 게이트 전체 + 커밋 + 공유**

Run(frontend/) 4종 게이트 green, backend pytest+ruff green.

```bash
git add frontend/scripts/pw-fw-level-actions.mjs frontend/scripts/pw-fw-consult-new-l5.mjs frontend/scripts/pw-fw-consult-existing.mjs frontend/scripts/pw-fw-admin-layout-shot.mjs frontend/scripts/pw-fw-consult.mjs frontend/scripts/pw-smoke-field-promotion.mjs frontend/scripts/pw-smoke-interview-import.mjs docs/qa/screens/fw-level-tiles.png docs/qa/screens/fw-level-create-l5.png docs/qa/screens/framework-admin-selected.png PROGRESS.md
git commit -m "test(fw-admin): smoke for level tile actions and port six smokes off the old ids — 타일 액션 스모크·구 스모크 이식"
git push origin dev
```

캡처 3장을 SendUserFile로 공유하고 백그라운드 서버를 회수한다.
