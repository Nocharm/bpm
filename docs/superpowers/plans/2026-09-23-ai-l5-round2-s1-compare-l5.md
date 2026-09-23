# AI L5 2라운드 스프린트 ① 비교 화면·L5 드롭존 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 비교 화면의 변경 하이라이트를 분기 노드 앰버와 구분되는 전용 diff 토큰으로 옮기고, 초기 base/target 중복을 없애고, 우측 인스펙터 폭을 드래그로 조절하게 하며, L5 다크 캔버스에서 드롭존이 보이게 한다.

**Architecture:** FE만. 새 색 토큰 `--color-diff-changed`는 `globals.css @theme`에 한 줄, 소비처는 `ProcessNode`의 diff 맵과 `compare/page.tsx`의 diff 의미 클래스. 초기 버전 선택은 순수 함수 `pickInitialCompareVersions`로 빼서 vitest로 고정. 폭 조절은 공용 훅 `useResizableWidth`(스프린트 ④ 연결 패널이 재사용). 드롭존은 편집기의 `isFrameworkMap`으로 색 기반만 분기.

**Tech Stack:** Next.js/React/Tailwind v4 토큰, vitest, Playwright(`playwright-core` + 시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-09-23-ai-l5-campaign-round2-design.md` §1

## Global Constraints

- 색은 토큰만(raw hex 금지, 토큰 정의 자체는 `globals.css @theme`에서만). 아이콘 Lucide 14/16 strokeWidth 1.5. 굵기 300/400/600.
- UI 문구에 긴 대시(—) 금지. UI 영어 기본, i18n en/ko 동시 추가(`frontend/src/lib/i18n-messages.ts`, en 블록과 ko 블록 둘 다).
- 인터랙티브 요소 `data-id`(`surface-role` kebab).
- 다크모드 분기 금지. L5 하늘 프레임(`.bpm-l5-sky`) 위 크롬은 라이트 유지.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 갱신 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트(frontend/): `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`.
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 복합 Bash는 harness가 거부할 수 있으니 단순 명령으로 나눈다. 광범위 `pkill` 금지. 로컬 3000/8000은 db-viewer가 점유할 수 있어 검증은 3047/8048 사용.
- 프론트 변경 완료 시 Playwright 캡처를 `docs/qa/screens/`에 남기고 사용자에게 공유(SendUserFile).

---

### Task 1: diff 변경 전용 토큰 `--color-diff-changed` (C2)

**Files:**
- Modify: `frontend/src/app/globals.css:54-56` (`@theme` 안 `--color-changed` 바로 아래)
- Modify: `frontend/src/components/process-node.tsx:764-778` (`DIFF_COLOR`, `DIFF_BADGE_BG`)
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx` 라인 481, 498, 641, 689, 1249, 1263, 1698, 1946, 2036, 2082, 2226, 2273, 2391, 2436
- Test: `frontend/src/components/process-node.diff-token.test.ts` (신규)

**Interfaces:**
- Produces: Tailwind 유틸 `border-diff-changed` · `bg-diff-changed` · `text-diff-changed` · `bg-diff-changed/10` · CSS 변수 `var(--color-diff-changed)`.
- 불변: `--color-changed`(리포트·거버넌스 경고 톤, `STATUS_DOT.pending`)는 그대로 남긴다.

- [ ] **Step 1: 실패하는 테스트 작성** — compare 페이지와 ProcessNode 소스에 diff 의미 `changed` 토큰이 남아 있지 않은지 문자열로 검사한다(소스 텍스트 회귀 가드).

```ts
// frontend/src/components/process-node.diff-token.test.ts
// diff 변경 톤은 전용 토큰(--color-diff-changed)만 쓴다 — 경고용 --color-changed와 섞이면 분기 노드 앰버와 다시 겹친다 (spec 2026-09-23 §1 C2).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("diff changed token", () => {
  it("globals.css defines --color-diff-changed inside @theme", () => {
    const css = read("../app/globals.css");
    expect(css).toMatch(/--color-diff-changed:\s*#0f766e;/);
  });
  it("ProcessNode diff maps use the diff token, not the warning token", () => {
    const src = read("./process-node.tsx");
    expect(src).toContain('changed: "var(--color-diff-changed)"');
    expect(src).toContain('changed: "bg-diff-changed"');
    expect(src).not.toContain('changed: "var(--color-changed)"');
  });
  it("compare page keeps the warning token only for the pending version dot", () => {
    const src = read("../app/maps/[mapId]/compare/page.tsx");
    const warningUses = src.match(/(?<![a-z-])(?:bg|text|border)-changed(?![a-z-])|var\(--color-changed\)/g) ?? [];
    // STATUS_DOT.pending 한 곳만 허용
    expect(warningUses).toEqual(["bg-changed"]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/components/process-node.diff-token.test.ts`
Expected: FAIL (토큰 미정의, ProcessNode가 `var(--color-changed)` 사용).

- [ ] **Step 3: 토큰 정의**

`frontend/src/app/globals.css` 56행 `--color-changed: #9a6b00;` 바로 아래에 추가:

```css
  /* 비교 diff "변경" 전용 — 경고용 --color-changed(앰버)가 decision 기본 stroke(#c7a062)와 겹쳐 분리 (2026-09-23) */
  --color-diff-changed: #0f766e;
```

- [ ] **Step 4: ProcessNode diff 맵 교체**

`frontend/src/components/process-node.tsx`:

```ts
const DIFF_COLOR: Record<DiffStatus, string> = {
  added: "var(--color-added)",
  removed: "var(--color-removed)",
  changed: "var(--color-diff-changed)",
};
// ...
const DIFF_BADGE_BG: Record<DiffStatus, string> = {
  added: "bg-added",
  removed: "bg-removed",
  changed: "bg-diff-changed",
};
```

- [ ] **Step 5: compare 페이지 교체** — 아래 라인의 `changed` 토큰만 `diff-changed`로. `STATUS_DOT.pending: "bg-changed"`(507행)는 건드리지 않는다.

| 라인 | 전 | 후 |
|---|---|---|
| 481 | `"var(--color-changed)"` | `"var(--color-diff-changed)"` |
| 498 | `{ stroke: "var(--color-changed)", strokeWidth: 2 }` | `{ stroke: "var(--color-diff-changed)", strokeWidth: 2 }` |
| 641 | `border-changed` | `border-diff-changed` |
| 689 | `bg-changed/10 ... text-changed` | `bg-diff-changed/10 ... text-diff-changed` |
| 1249 | `"bg-changed/10 text-changed"` | `"bg-diff-changed/10 text-diff-changed"` |
| 1263 | `"bg-changed"` | `"bg-diff-changed"` |
| 1698 | `dot: "bg-changed"` | `dot: "bg-diff-changed"` |
| 1946, 2036, 2273, 2391 | `text-changed` | `text-diff-changed` |
| 2082, 2226 | `bg-changed/10 ... text-changed` | `bg-diff-changed/10 ... text-diff-changed` |
| 2436 | `border-changed/30 bg-changed/10` | `border-diff-changed/30 bg-diff-changed/10` |

- [ ] **Step 6: 테스트·게이트 통과 확인**

Run: `cd frontend && npx vitest run src/components/process-node.diff-token.test.ts` → PASS.
Run: `cd frontend && npx tsc --noEmit -p tsconfig.json` → 오류 0.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/app/globals.css frontend/src/components/process-node.tsx "frontend/src/app/maps/[mapId]/compare/page.tsx" frontend/src/components/process-node.diff-token.test.ts PROGRESS.md
git commit -m "fix(compare): split diff changed tone from the warning amber — 비교 변경 톤을 전용 토큰으로 분리"
```

---

### Task 2: 초기 base/target 중복 해소 (C3)

**Files:**
- Create: `frontend/src/lib/compare-initial.ts`
- Test: `frontend/src/lib/compare-initial.test.ts`
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx:2517-2530` (초기 선택 블록)

**Interfaces:**
- Produces: `pickInitialCompareVersions(versions: {id:number; status:string}[], isFramework: boolean, search: URLSearchParams): { baseId: number; targetId: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/compare-initial.test.ts
import { describe, expect, it } from "vitest";

import { pickInitialCompareVersions } from "./compare-initial";

const v = (id: number, status: string) => ({ id, status });

describe("pickInitialCompareVersions", () => {
  it("base=last published, target=latest other version", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 1, targetId: 2 });
  });
  it("published is the latest: target falls back to the previous version, never equal to base", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "published")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 2, targetId: 1 });
  });
  it("single version: base and target are the same (nothing else to pick)", () => {
    const out = pickInitialCompareVersions([v(7, "draft")], false, new URLSearchParams());
    expect(out).toEqual({ baseId: 7, targetId: 7 });
  });
  it("framework maps use the last confirmed snapshot as base", () => {
    const out = pickInitialCompareVersions([v(1, "confirmed"), v(2, "confirmed"), v(3, "draft")], true, new URLSearchParams());
    expect(out).toEqual({ baseId: 2, targetId: 3 });
  });
  it("deep link ids win when they exist", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft"), v(3, "draft")], false, new URLSearchParams("base=2&target=1"));
    expect(out).toEqual({ baseId: 2, targetId: 1 });
  });
  it("unknown deep link ids fall back to defaults", () => {
    const out = pickInitialCompareVersions([v(1, "published"), v(2, "draft")], false, new URLSearchParams("base=99"));
    expect(out).toEqual({ baseId: 1, targetId: 2 });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/compare-initial.test.ts` → FAIL (모듈 없음).

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/compare-initial.ts
// 비교 화면 초기 base/target — 게시본(framework는 확정본) vs 그것을 제외한 최신. 둘이 같게 떨어지던 진입 상태를 막는다 (2026-09-23).

interface VersionLike {
  id: number;
  status: string;
}

export function pickInitialCompareVersions(
  versions: VersionLike[],
  isFramework: boolean,
  search: URLSearchParams,
): { baseId: number; targetId: number } {
  const anchorStatus = isFramework ? "confirmed" : "published";
  const anchors = versions.filter((version) => version.status === anchorStatus);
  const base = anchors.length > 0 ? anchors[anchors.length - 1] : versions[0];
  // 딥링크 ?base=&target= 우선 — 모르는 id는 기본값
  const pick = (key: string): number | null => {
    const id = Number(search.get(key));
    return id && versions.some((version) => version.id === id) ? id : null;
  };
  const baseId = pick("base") ?? base.id;
  const others = versions.filter((version) => version.id !== baseId);
  const defaultTarget = others.length > 0 ? others[others.length - 1].id : baseId;
  return { baseId, targetId: pick("target") ?? defaultTarget };
}
```

- [ ] **Step 4: 페이지 배선** — `compare/page.tsx` 2517~2530행의 base 계산·`pick` 정의·두 `set` 호출을 아래로 교체하고 상단 import에 `import { pickInitialCompareVersions } from "@/lib/compare-initial";` 추가.

```ts
        const picked = pickInitialCompareVersions(
          detail.versions,
          detail.mode === "framework",
          new URLSearchParams(window.location.search),
        );
        setBaseId(picked.baseId);
        setTargetId(picked.targetId);
```

- [ ] **Step 5: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/compare-initial.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.json` → 0.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/compare-initial.ts frontend/src/lib/compare-initial.test.ts "frontend/src/app/maps/[mapId]/compare/page.tsx" PROGRESS.md
git commit -m "fix(compare): never open with base equal to target — 초기 진입 base/target 중복 해소"
```

---

### Task 3: 공용 폭 조절 훅 + 인스펙터 드래그 (C1)

**Files:**
- Create: `frontend/src/lib/use-resizable-width.ts`
- Test: `frontend/src/lib/use-resizable-width.test.ts`
- Modify: `frontend/src/app/maps/[mapId]/compare/page.tsx:1874-1878` (인스펙터 `<aside>`)
- Modify: `frontend/src/lib/i18n-messages.ts` (en 블록·ko 블록 각 1키)

**Interfaces:**
- Produces:
  ```ts
  export function readStoredWidth(raw: string | null, min: number, max: number, fallback: number): number
  export function useResizableWidth(opts: { storageKey: string; min: number; max: number; fallback: number; edge: "left" | "right" }): { width: number; onPointerDown: (e: React.PointerEvent) => void }
  ```
  `edge`는 패널이 화면 어느 쪽에 붙어 있는지 — `"right"`면 폭 = `window.innerWidth - clientX`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/use-resizable-width.test.ts
import { describe, expect, it } from "vitest";

import { readStoredWidth } from "./use-resizable-width";

describe("readStoredWidth", () => {
  it("returns the stored value when inside [min, max]", () => {
    expect(readStoredWidth("320", 240, 520, 288)).toBe(320);
  });
  it("falls back when missing, NaN or out of range", () => {
    expect(readStoredWidth(null, 240, 520, 288)).toBe(288);
    expect(readStoredWidth("abc", 240, 520, 288)).toBe(288);
    expect(readStoredWidth("100", 240, 520, 288)).toBe(288);
    expect(readStoredWidth("900", 240, 520, 288)).toBe(288);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/use-resizable-width.test.ts` → FAIL.

- [ ] **Step 3: 구현** — 캠페인 페이지 `handleDividerDown`(`framework/consult/[sessionId]/page.tsx:126-133`) 패턴을 훅으로 일반화.

```ts
// frontend/src/lib/use-resizable-width.ts
// 드래그로 조절하는 사이드 패널 폭 — localStorage 기억, [min,max] 클램프. 비교 인스펙터·캠페인 연결 패널 공용 (2026-09-23).

import { useCallback, useState } from "react";

export function readStoredWidth(raw: string | null, min: number, max: number, fallback: number): number {
  const stored = Number(raw);
  return raw !== null && Number.isFinite(stored) && stored >= min && stored <= max ? stored : fallback;
}

interface ResizableWidthOptions {
  storageKey: string;
  min: number;
  max: number;
  fallback: number;
  // 패널이 붙은 화면 변 — right면 폭은 오른쪽 끝에서 커서까지
  edge: "left" | "right";
}

export function useResizableWidth({ storageKey, min, max, fallback, edge }: ResizableWidthOptions): {
  width: number;
  onPointerDown: (event: React.PointerEvent) => void;
} {
  const [width, setWidth] = useState(() =>
    typeof window === "undefined" ? fallback : readStoredWidth(window.localStorage.getItem(storageKey), min, max, fallback),
  );
  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const measure = (clientX: number) =>
        Math.min(max, Math.max(min, edge === "right" ? window.innerWidth - clientX : clientX));
      const onMove = (ev: PointerEvent) => setWidth(measure(ev.clientX));
      const finish = (ev: PointerEvent) => {
        window.localStorage.setItem(storageKey, String(measure(ev.clientX)));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [storageKey, min, max, edge],
  );
  return { width, onPointerDown };
}
```

- [ ] **Step 4: 인스펙터 배선** — `compare/page.tsx`의 페이지 컴포넌트(`inspectorOpen` 상태가 있는 798행 컴포넌트) 안에 훅 호출을 추가하고, 1874~1878행 `<aside className="flex w-72 shrink-0 ...">`를 디바이더 + 폭 style로 바꾼다.

```tsx
// 컴포넌트 상단(798행 부근)
const inspector = useResizableWidth({ storageKey: "bpm.compareInspectorWidth", min: 240, max: 520, fallback: 288, edge: "right" });
```

```tsx
        {inspectorOpen && (
          <>
            <div
              className="flex w-1.5 shrink-0 cursor-col-resize items-center justify-center bg-hairline transition-colors duration-150 hover:bg-accent/40"
              role="separator" aria-orientation="vertical" aria-label={t("compare.resizeInspector")} tabIndex={0}
              onPointerDown={inspector.onPointerDown} data-id="compare-inspector-divider"
            />
            <aside
              className="flex shrink-0 flex-col border-l border-hairline bg-surface"
              style={{ width: inspector.width }}
              data-id="compare-inspector"
            >
```

닫는 `</aside>`(2458행) 뒤에 `</>`를 닫는다. 상단 import에 `import { useResizableWidth } from "@/lib/use-resizable-width";`.

- [ ] **Step 5: i18n** — `i18n-messages.ts` en 블록의 `"compare.` 키 묶음 끝에 `"compare.resizeInspector": "Resize inspector",`, ko 블록 같은 자리에 `"compare.resizeInspector": "인스펙터 폭 조절",`.

- [ ] **Step 6: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/use-resizable-width.test.ts` → PASS. `npx tsc --noEmit -p tsconfig.json` → 0. `npm run lint` → 0.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/use-resizable-width.ts frontend/src/lib/use-resizable-width.test.ts "frontend/src/app/maps/[mapId]/compare/page.tsx" frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(compare): drag-resizable inspector 240-520px — 비교 인스펙터 폭 드래그 조절"
```

---

### Task 4: L5 다크 캔버스 드롭존 가시성 (D1)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:10382-10420` (`zone-fan` SVG 스타일)

**Interfaces:**
- Consumes: 같은 컴포넌트의 `isFrameworkMap`(1046행). 부채꼴 JSX가 같은 컴포넌트 스코프인지 먼저 확인(다른 함수면 prop으로 넘긴다).

- [ ] **Step 1: 스코프 확인**

Run: `cd frontend && grep -n "isFrameworkMap" "src/app/maps/[mapId]/page.tsx" | head` — 10380행대 JSX가 1046행 선언과 같은 함수 본문(`export default function`) 안이면 그대로 진행.

- [ ] **Step 2: 색 기반 분기** — 부채꼴 블록 바로 위(10380행 `return (` 직전)에 두 상수를 두고 스타일 4곳의 색을 교체한다.

```tsx
              // L5 하늘 프레임 위에서는 회색 기반색이 묻힌다 — 밝은 캔버스색·하늘 액센트로 바꾼다 (2026-09-23)
              const zoneNeutral = isFrameworkMap ? "var(--color-canvas)" : "var(--color-ink-tertiary)";
              const zoneAccent = isFrameworkMap ? "var(--color-accent-sky)" : "var(--color-accent)";
```

```tsx
                    {diagAxes.map((axis, i) => (
                      <path
                        key={`d${i}`}
                        d={sector(axis, DHALF, ri, ro)}
                        style={{
                          fill: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 10 : 4}%, transparent)`,
                          stroke: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 45 : 36}%, transparent)`,
                          strokeWidth: 1.5,
                          strokeDasharray: "4 4",
                          strokeLinejoin: "round",
                        }}
                      />
                    ))}
```

```tsx
                      const style = blocked
                        ? {
                            fill: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 14 : 7}%, transparent)`,
                            stroke: `color-mix(in srgb, ${zoneNeutral} ${isFrameworkMap ? 35 : 25}%, transparent)`,
                            strokeWidth: 1.5,
                          }
                        : active
                          ? {
                              fill: `color-mix(in srgb, ${zoneAccent} 34%, transparent)`,
                              stroke: zoneAccent,
                              strokeWidth: 2.5,
                            }
                          : {
                              fill: `color-mix(in srgb, ${zoneAccent} ${isFrameworkMap ? 24 : 18}%, transparent)`,
                              stroke: `color-mix(in srgb, ${zoneAccent} ${isFrameworkMap ? 55 : 32}%, transparent)`,
                              strokeWidth: 1.5,
                            };
```

- [ ] **Step 3: 게이트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json` → 0, `npm run lint` → 0.

- [ ] **Step 4: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "fix(editor): make drop zones visible on the L5 sky canvas — L5 다크 캔버스 드롭존 가시성"
```

---

### Task 5: Playwright 스모크 + 캡처 공유

**Files:**
- Create: `frontend/scripts/pw-compare-inspector.mjs`
- Capture: `docs/qa/screens/compare-inspector-resized.png`, `docs/qa/screens/l5-dropzone-dark.png`

**Interfaces:**
- Consumes: Task 1~4 결과. 시드 `backend/scripts/reset_db.py`(비교 데모 맵 이름 `/comparison/i`, 로컬 전용).

- [ ] **Step 1: 서버 기동(백그라운드, 턴 끝 회수)** — backend `.venv/bin/uvicorn app.main:app --port 8048`, frontend `BACKEND_URL=http://localhost:8048 npm run dev -- --port 3047 --webpack`. 로컬 sqlite는 `python -m scripts.reset_db`로 시드(운영 금지).

- [ ] **Step 2: 스모크 작성** — `pw-verify-compare.mjs`의 데모 맵 탐색과 `pw-fw-consult-new-l5.mjs`의 `check` 패턴을 따른다.

```js
// frontend/scripts/pw-compare-inspector.mjs
// 비교 화면 2라운드 검증 — 초기 base≠target, 인스펙터 드래그 폭(240~520 클램프+localStorage), 변경 노드 diff 토큰.
// 실행(frontend/ 에서): BASE_URL=http://localhost:3047 node scripts/pw-compare-inspector.mjs  (reset_db 시드 전제)
import { chromium } from "playwright-core";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const ADMIN = "admin.sys";
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript((user) => { window.localStorage.setItem("bpm.devUser", user); window.localStorage.setItem("bpm.lang", "en"); }, ADMIN);
const maps = await (await ctx.request.get(`${BASE}/api/maps`, { headers: { "X-Dev-User": ADMIN } })).json();
const demo = maps.find((m) => /comparison/i.test(m.name));
if (!demo) { console.log("FAIL compare demo map not found"); await browser.close(); process.exit(1); }

const page = await ctx.newPage();
await page.goto(`${BASE}/maps/${demo.id}/compare`);
const inspector = page.locator('[data-id="compare-inspector"]');
await inspector.waitFor();

// 초기 base ≠ target — 두 셀렉트의 표시 라벨이 다르다
const baseLabel = await page.locator('[data-id="compare-base-select"]').innerText().catch(() => "");
const targetLabel = await page.locator('[data-id="compare-target-select"]').innerText().catch(() => "");
check("initial base and target differ", baseLabel !== "" && baseLabel !== targetLabel, `${baseLabel} vs ${targetLabel}`);

// 인스펙터 기본 폭 288
const w0 = (await inspector.boundingBox()).width;
check("inspector default width is 288", Math.abs(w0 - 288) < 2, String(w0));

// 디바이더를 왼쪽으로 200px 드래그 → 488
const divider = page.locator('[data-id="compare-inspector-divider"]');
const box = await divider.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x - 200, box.y + 200, { steps: 8 });
await page.mouse.up();
const w1 = (await inspector.boundingBox()).width;
check("drag widens the inspector by 200", Math.abs(w1 - (w0 + 200)) < 4, String(w1));

// 최대 520 클램프
await page.mouse.move(box.x - 200 + 3, box.y + 200);
await page.mouse.down();
await page.mouse.move(box.x - 900, box.y + 200, { steps: 8 });
await page.mouse.up();
const w2 = (await inspector.boundingBox()).width;
check("width clamps at 520", Math.abs(w2 - 520) < 2, String(w2));
check("width persists to localStorage", (await page.evaluate(() => window.localStorage.getItem("bpm.compareInspectorWidth"))) === "520");

// 리로드 후 유지
await page.reload();
await inspector.waitFor();
check("width survives reload", Math.abs((await inspector.boundingBox()).width - 520) < 2);

// 변경 노드 테두리가 diff 토큰 색(teal)이다 — 계산된 색이 앰버(#9a6b00 = rgb(154,107,0))가 아니다
const changedStroke = await page.evaluate(() => {
  const node = document.querySelector('[data-diff-status="changed"]');
  return node ? getComputedStyle(node).borderColor : null;
});
check("changed node border uses the diff token (not amber)", changedStroke !== null && changedStroke !== "rgb(154, 107, 0)", String(changedStroke));

await page.screenshot({ path: "../docs/qa/screens/compare-inspector-resized.png" });
await browser.close();
console.log(`${results.filter(Boolean).length}/${results.length}`);
process.exit(results.every(Boolean) ? 0 : 1);
```

셀렉터 메모: `compare-base-select`/`compare-target-select`/`data-diff-status`가 현재 코드에 없으면 실행 전에 compare 페이지의 실제 `data-id`(1606·1617행 `SearchSelect` 래퍼)와 `ProcessNode`가 노드 루트에 다는 속성명을 grep으로 확인해 스모크 쪽을 맞춘다. 앱에 속성을 새로 달아야 하면 `ProcessNode` 루트에 `data-diff-status={diff}` 한 줄만 추가(Task 1 커밋에 포함).

- [ ] **Step 3: 실행**

Run: `cd frontend && BASE_URL=http://localhost:3047 node scripts/pw-compare-inspector.mjs` → `7/7`.

- [ ] **Step 4: L5 드롭존 캡처** — 시드의 framework L5 연계 맵(`GET /api/maps`에서 `mode === "framework"`)을 에디터로 열고, 노드 하나를 드래그 중인 프레임을 캡처한다(`page.mouse.down` 후 `move` 상태에서 `screenshot`) → `docs/qa/screens/l5-dropzone-dark.png`. 별도 스크립트 없이 `pw-compare-inspector.mjs` 끝에 블록으로 붙여도 된다(맵이 없으면 건너뛰고 로그).

- [ ] **Step 5: 게이트 전체 + 커밋 + 공유**

Run(frontend/): `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check` → 전부 green.

```bash
git add frontend/scripts/pw-compare-inspector.mjs docs/qa/screens/compare-inspector-resized.png docs/qa/screens/l5-dropzone-dark.png PROGRESS.md
git commit -m "test(compare): smoke for inspector resize, initial pick and diff tone — 비교 스모크"
git push origin dev
```

SendUserFile로 두 캡처를 공유하고, 백그라운드 서버를 회수한다.
