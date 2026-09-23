# AI L5 2라운드 스프린트 ③ 캠페인 UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI L5 캠페인 화면의 시각 품질을 올린다 — 분기 노드 마름모, 공용 AI 버튼(그라데이션+쉬머), 플랜 카드 투명화와 순서/삭제/추가 애니메이션, planning 단계 좌측 보드 활용, 주관식 문항의 "AI 제안" 타이핑 입력. 저장소 안 가짜 AI 서버로 캠페인 전 단계 스모크를 재현 가능하게 한다.

**Architecture:** FE만. `AiButton`(`components/ai-button.tsx`)이 AI 액션의 단일 스타일 소스가 되고 스프린트 ②의 `AI_TILE` 상수를 대체한다. 플랜 카드 재정렬은 기존 `lib/use-flip-order.ts`(data-flip-key FLIP)를 재사용하고, 카드 키는 FE 전용 `clientId`(전송 시 제거)로 안정화한다. 주관식 타이핑은 순수 스케줄러 `lib/typewriter.ts` + 훅. 가짜 AI는 `scripts/fake-ai-server.mjs`(OpenAI 호환 `/v1/chat/completions`, system 프롬프트 마커로 라우팅, backend 테스트의 캔드 JSON과 같은 형태)로 ③·④ 스모크의 전제를 저장소에 고정한다.

**Tech Stack:** Next.js/React/Tailwind v4 토큰, vitest, Playwright(`playwright-core` + 시스템 Chrome), Node http(가짜 AI).

**Spec:** `docs/superpowers/specs/2026-09-23-ai-l5-campaign-round2-design.md` §3

## Global Constraints

- 색은 토큰만(raw hex 금지). 아이콘 Lucide 14/16 strokeWidth 1.5. 굵기 300/400/600. 버튼 커서·눌림은 전역 base라 컴포넌트엔 hover 배경만.
- 모션: `ease-smooth`/`ease-spring`, duration 150/350/450/700. `prefers-reduced-motion` 가드 필수.
- UI 문구에 긴 대시(—) 금지. UI 영어 기본, i18n en/ko 동시 추가(`frontend/src/lib/i18n-messages.ts`, en 블록·ko 블록 둘 다).
- 인터랙티브 요소 `data-id`(`surface-role` kebab, 리스트는 키 접미).
- 컴포넌트 추가·삭제·사용처 변경 시 `frontend/`에서 `node scripts/build-component-catalog.mjs` 재생성. 컴포넌트 파일 머리 주석 한 줄.
- `ScopePreview`는 공용(피크·요약 모달·임포트 리포트·캠페인) — `frontend/COMPONENTS.md` 사용처를 확인하고 바꾼다.
- 커밋: `type(scope): English — 한국어` + `PROGRESS.md` 1~3줄 같은 커밋 + trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01Cp6z7UQxkS4JyPnK2oo8Q2`.
- 게이트(frontend/): `npx tsc --noEmit -p tsconfig.json` · `npm run lint` · `npx vitest run` · `node scripts/build-component-catalog.mjs --check`. 검증 포트 3047/8048, 가짜 AI 9999.
- 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/dev`, 브랜치 `dev`. 복합 Bash는 harness가 거부할 수 있으니 단순 명령으로 나눈다. 광범위 `pkill` 금지(PID 지정 kill).
- 프론트 변경 완료 시 Playwright 캡처를 `docs/qa/screens/`에 남기고 공유(SendUserFile).

---

### Task 0: 저장소 안 가짜 AI 서버

**Files:**
- Create: `frontend/scripts/fake-ai-server.mjs`
- Modify(머리 주석 1줄): `frontend/scripts/pw-fw-consult.mjs`, `frontend/scripts/pw-fw-consult-existing.mjs` (전제 문구를 이 파일로)

**Interfaces:**
- 실행: `node scripts/fake-ai-server.mjs` → `http://localhost:9999/v1/chat/completions`(POST) · `/v1/models`(GET). backend는 `AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake`.
- 라우팅(system 메시지 본문 포함 문자열): `"L6 단위 업무"` → 계획 · `"설문지를 만드세요"` → 설문 · `"rows[] 원소"` → 행 · `"연계 캔버스"` → 관계 · 그 외 → `{}`.
- 응답: `{"choices":[{"message":{"content":"<JSON 문자열>"}}],"usage":{"prompt_tokens":10,"completion_tokens":20}}`.

- [ ] **Step 1: 서버 작성**

```js
// frontend/scripts/fake-ai-server.mjs
// 캠페인 스모크용 가짜 AI — OpenAI 호환 /v1/chat/completions. system 프롬프트의 계약 마커로 어떤 단계인지 알아
// backend 테스트(tests/test_framework_interview_runner.py Q_JSON·ROW_JSON)와 같은 모양의 JSON을 돌려준다.
// 실행(frontend/ 에서): node scripts/fake-ai-server.mjs   → backend는 AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake
import http from "node:http";

const PORT = Number(process.env.FAKE_AI_PORT ?? 9999);

const PLAN = {
  cards: [
    { name: "요청 접수", summary: "요청을 받는다", owner_role: "담당자", department: "", depends_on: [] },
    { name: "검토 승인", summary: "검토한다", owner_role: "관리자", department: "", depends_on: ["요청 접수"] },
  ],
};
const QUESTIONNAIRE = {
  questions: [
    { id: "q1", kind: "ordered", maps_to: "activities", text: "활동 순서", options: [{ id: "a1", label: "요청 확인" }, { id: "a2", label: "완결성 판정" }, { id: "a3", label: "접수 등록" }], suggested: ["a1", "a2", "a3"] },
    { id: "q2", kind: "single", maps_to: "roles", text: "담당 역할", options: [{ id: "r1", label: "담당자" }, { id: "r2", label: "관리자" }], suggested: ["r1"] },
    { id: "q3", kind: "multi", maps_to: "systems", text: "사용 시스템", options: [{ id: "s1", label: "ERP" }, { id: "s2", label: "메일" }], suggested: ["s1"] },
    { id: "q4", kind: "text", maps_to: "conditions", text: "시작 조건", options: [], suggested: "요청서 도착" },
    { id: "q5", kind: "text", maps_to: "io", text: "입력물", options: [], suggested: "요청서" },
    { id: "q6", kind: "text", maps_to: "io", text: "산출물", options: [], suggested: "접수증" },
  ],
};
// [L6]\n이름: X 를 읽어 그 이름으로 행을 만든다 — 계획 카드와 이름이 맞아야 등록 리포트가 매칭된다
function rowFor(userText) {
  const name = (/\[L6\]\n이름: (.+)/.exec(userText)?.[1] ?? "요청 접수").trim();
  return {
    l6: name, ownerRole: "담당자", department: "", fields: { start_condition: "요청서 도착", done_criteria: "접수증 발급" },
    actions: [
      { seq: 1, label: "요청 확인", kind: "action", input: "요청서", output: "확인 메모" },
      { seq: 2, label: "완결성 판정", kind: "decision" },
      { seq: 3, label: "접수 등록", kind: "action", input: "확인 메모", output: "접수증", system: "ERP" },
    ],
    relations: { edges: [{ src: 1, dst: 2, kind: "seq" }, { src: 2, dst: 3, kind: "branch", gateway: "exclusive", condition: "완결" }] },
  };
}
// [L6 목록]의 taskId=… 를 순서대로 seq 연결
function relationsFor(userText) {
  const ids = [...userText.matchAll(/taskId=(\S+)/g)].map((m) => m[1]);
  const edges = ids.slice(1).map((dst, i) => ({ src: ids[i], dst, kind: "seq" }));
  return { entry: { taskId: ids[0] ?? "", triggerType: "manual", label: "시작" }, edges };
}

function route(messages) {
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const user = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  if (system.includes("L6 단위 업무")) return PLAN;
  if (system.includes("설문지를 만드세요")) return QUESTIONNAIRE;
  if (system.includes("rows[] 원소")) return rowFor(user);
  if (system.includes("연계 캔버스")) return relationsFor(user);
  return {};
}

http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.endsWith("/models")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "fake" }] }));
    return;
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    let content = "{}";
    try { content = JSON.stringify(route(JSON.parse(body).messages ?? [])); } catch { content = "{}"; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }));
  });
}).listen(PORT, () => console.log(`fake ai on :${PORT}`));
```

- [ ] **Step 2: 기동·수동 확인** — `node scripts/fake-ai-server.mjs`(백그라운드) 후 Node 한 줄로 POST(system "…설문지를 만드세요…") → `questions` 6개 확인. backend를 `AI_ENABLED=true AI_BASE_URL=http://localhost:9999/v1 AI_MODEL=fake DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS=""`로 8048 기동, frontend 3047.

- [ ] **Step 3: 기존 캠페인 스모크 완주** — `BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult.mjs` 와 `pw-fw-consult-existing.mjs` 가 끝까지 PASS(스프린트 ②에서 진입 단계까지만 확인했던 두 스크립트). 두 파일 4행의 전제 주석을 `scripts/fake-ai-server.mjs`로 고친다.

- [ ] **Step 4: 커밋**

```bash
git add frontend/scripts/fake-ai-server.mjs frontend/scripts/pw-fw-consult.mjs frontend/scripts/pw-fw-consult-existing.mjs PROGRESS.md
git commit -m "test(fw-consult): in-repo fake AI server for campaign smokes — 캠페인 스모크용 가짜 AI 서버"
```

---

### Task 1: `AiButton` + 쉬머 (B11)

**Files:**
- Create: `frontend/src/components/ai-button.tsx`, `frontend/src/components/ai-button.test.ts`
- Modify: `frontend/src/app/globals.css` (`.strip-shimmer` 블록 아래에 `.ai-shimmer` 추가)
- Modify(적용): `frontend/src/components/admin/fw-level-actions.tsx`(AI_TILE 제거) · `frontend/src/components/framework-interview/plan-editor.tsx:90`(생성/재생성) · `questionnaire-form.tsx:196`(제안 채우기) · `relations-step.tsx:64`(관계 제안)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
- ```tsx
  export type AiButtonVariant = "primary" | "tile" | "inline";
  export function buildAiButtonClass(variant: AiButtonVariant): string;   // 테스트 대상(순수)
  export function AiButton(props: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: AiButtonVariant; icon?: ReactNode }): JSX.Element
  ```
  기본 아이콘 `Sparkles`(primary/inline 14, tile 16). `primary` = `rounded-sm px-3 py-1.5 text-caption`, `tile` = `h-14 w-full rounded-md px-3 text-left`, `inline` = `rounded-sm px-2 py-1 text-fine`. 공통 `ai-shimmer relative overflow-hidden text-on-accent [background:linear-gradient(135deg,var(--color-accent),var(--color-accent-focus))] hover:brightness-105 disabled:opacity-40`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/components/ai-button.test.ts
import { describe, expect, it } from "vitest";

import { buildAiButtonClass } from "./ai-button";

describe("buildAiButtonClass", () => {
  it("every variant carries the gradient + shimmer hooks", () => {
    for (const v of ["primary", "tile", "inline"] as const) {
      const cls = buildAiButtonClass(v);
      expect(cls).toContain("ai-shimmer");
      expect(cls).toContain("var(--color-accent)");
      expect(cls).toContain("text-on-accent");
    }
  });
  it("tile is a full-width row, inline is compact", () => {
    expect(buildAiButtonClass("tile")).toContain("h-14 w-full");
    expect(buildAiButtonClass("inline")).toContain("text-fine");
    expect(buildAiButtonClass("primary")).toContain("text-caption");
  });
});
```

- [ ] **Step 2: 실패 확인** — `cd frontend && npx vitest run src/components/ai-button.test.ts` → FAIL.

- [ ] **Step 3: CSS** — `globals.css`의 `.strip-shimmer` reduced-motion 블록 바로 아래:

```css
/* AI 액션 버튼 — 액센트 그라데이션 위를 hover 동안 느린 빛띠가 훑는다(4s 반복). 배경은 컴포넌트가 준다. */
@keyframes ai-shimmer {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(220%); }
}
.ai-shimmer::after {
  content: "";
  position: absolute;
  inset: 0;
  width: 40%;
  pointer-events: none;
  background: linear-gradient(110deg, transparent 0%, color-mix(in srgb, white 35%, transparent) 50%, transparent 100%);
  transform: translateX(-120%);
}
.ai-shimmer:hover::after {
  animation: ai-shimmer 4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .ai-shimmer:hover::after { animation: none; }
}
```

- [ ] **Step 4: 컴포넌트**

```tsx
"use client";

// AI 액션 버튼 — 액센트 그라데이션 + hover 쉬머. 캠페인의 제안/재제안/AI 제안/피드백, 관리 패널 AI 타일이 공유 (spec 2026-09-23 §3 B11).

import { Sparkles } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type AiButtonVariant = "primary" | "tile" | "inline";

const BASE =
  "ai-shimmer relative inline-flex items-center gap-1.5 overflow-hidden text-on-accent hover:brightness-105 disabled:opacity-40 " +
  "[background:linear-gradient(135deg,var(--color-accent),var(--color-accent-focus))]";
const VARIANT: Record<AiButtonVariant, string> = {
  primary: "rounded-sm px-3 py-1.5 text-caption",
  tile: "h-14 w-full rounded-md px-3 text-left",
  inline: "rounded-sm px-2 py-1 text-fine",
};

export function buildAiButtonClass(variant: AiButtonVariant): string {
  return `${BASE} ${VARIANT[variant]}`;
}

interface AiButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: AiButtonVariant;
  icon?: ReactNode;  // 기본 Sparkles. null이면 아이콘 없음
}

export function AiButton({ variant = "primary", icon, className, children, type = "button", ...rest }: AiButtonProps) {
  const size = variant === "tile" ? 16 : 14;
  return (
    <button type={type} className={`${buildAiButtonClass(variant)} ${className ?? ""}`} {...rest}>
      {icon === undefined ? <Sparkles size={size} strokeWidth={1.5} className="shrink-0" /> : icon}
      {children}
    </button>
  );
}
```

- [ ] **Step 5: 적용** — `fw-level-actions.tsx`: `AI_TILE` 상수 삭제, 세 AI 버튼을 `<AiButton variant="tile" icon={<Sparkles size={16} …/>|<Play…/>|<Headset…/>} data-id=… disabled=… onClick=…>`로. `plan-editor.tsx` 생성/재생성 버튼 → `<AiButton data-id="fw-consult-generate-plan" disabled={busy} onClick=…>{라벨}</AiButton>`. `questionnaire-form.tsx` 제안 채우기 → `<AiButton variant="inline" className="ml-auto" data-id="fw-consult-fill-all" …>`. `relations-step.tsx` 관계 제안 → `<AiButton className="ml-auto" data-id="fw-consult-propose-relations" …>`. 이때 `Sparkles` import가 남는 파일만 유지.

- [ ] **Step 6: 게이트** — vitest PASS · tsc 0 · eslint 0 · `node scripts/build-component-catalog.mjs` 재생성.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/components/ai-button.tsx frontend/src/components/ai-button.test.ts frontend/src/app/globals.css frontend/src/components/admin/fw-level-actions.tsx frontend/src/components/framework-interview/plan-editor.tsx frontend/src/components/framework-interview/questionnaire-form.tsx frontend/src/components/framework-interview/relations-step.tsx frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(ui): AiButton with gradient and hover shimmer across AI actions — AI 버튼 공용화·쉬머"
```

---

### Task 2: 미리보기 분기 노드 마름모 (B3)

**Files:**
- Modify: `frontend/src/components/scope-preview.tsx` (`boxes.map` rect 렌더)
- Test: `frontend/src/components/scope-preview.test.ts` (신규)

**Interfaces:**
- `export function buildDiamondPoints(x: number, y: number, w: number, h: number): string` — `"cx,y w+x,cy cx,y+h x,cy"` 순(상·우·하·좌).

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/components/scope-preview.test.ts
import { describe, expect, it } from "vitest";

import { buildDiamondPoints } from "./scope-preview";

describe("buildDiamondPoints", () => {
  it("returns the four box-inscribed vertices top,right,bottom,left", () => {
    expect(buildDiamondPoints(10, 20, 100, 50)).toBe("60,20 110,45 60,70 10,45");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/components/scope-preview.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `scope-preview.tsx`에 export 헬퍼를 추가하고, 박스에 `type`을 실어 decision만 `<polygon>`으로.

```ts
// 분기 노드는 실캔버스처럼 마름모 — 박스에 내접하는 네 꼭짓점(상·우·하·좌)
export function buildDiamondPoints(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  return `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
}
```

`boxes` 원소에 `type,` 추가. 렌더:

```tsx
        {boxes.map((box) => {
          const shapeClass = interactive
            ? "cursor-pointer [transition:all_.15s] hover:[stroke-width:3px] hover:[filter:brightness(0.92)]"
            : undefined;
          const shapeStyle = { fill: `color-mix(in srgb, ${box.color} 18%, white)`, stroke: box.color };
          return (
            <g key={box.id}>
              {box.type === "decision" ? (
                <polygon points={buildDiamondPoints(box.x, box.y, box.w, box.h)} strokeWidth={1.5} strokeLinejoin="round" className={shapeClass} style={shapeStyle} />
              ) : (
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={8} strokeWidth={1.5} className={shapeClass} style={shapeStyle} />
              )}
              <text …(기존 그대로) />
            </g>
          );
        })}
```

- [ ] **Step 4: 게이트** — vitest PASS · tsc · eslint. `COMPONENTS.md` 사용처(피크·요약 모달·임포트 리포트·캠페인) 중 Task 5 스모크가 캠페인 미리보기를 캡처한다.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/components/scope-preview.tsx frontend/src/components/scope-preview.test.ts PROGRESS.md
git commit -m "fix(preview): draw decision nodes as diamonds in the SVG preview — 미리보기 분기 노드 마름모"
```

---

### Task 3: 플랜 카드 투명화 + FLIP + 좌측 brief 패널 (B6·B7)

**Files:**
- Create: `frontend/src/lib/plan-cards.ts`, `frontend/src/lib/plan-cards.test.ts`, `frontend/src/components/framework-interview/plan-brief-panel.tsx`
- Modify: `frontend/src/components/framework-interview/plan-editor.tsx` (전면), `frontend/src/app/framework/consult/[sessionId]/page.tsx:160-205` (aside 분기 + PlanEditor props)
- Regenerate: `frontend/COMPONENTS.md`

**Interfaces:**
- `lib/plan-cards.ts`:
  ```ts
  export interface KeyedCard extends FwPlanCard { clientId: string }
  export function withClientIds(cards: FwPlanCard[]): KeyedCard[]          // genId()
  export function stripClientIds(cards: KeyedCard[]): FwPlanCard[]
  export function swapCards(cards: KeyedCard[], i: number, delta: 1 | -1): KeyedCard[]  // 범위 밖이면 그대로(같은 참조)
  export function orderKeyOf(cards: KeyedCard[]): string                    // clientId join — useFlipOrder orderKey
  ```
- `PlanBriefPanel` props: `{ brief: string; onBriefChange(v): void; attachments: FwAttachment[]; busy; onAttach(file); onRemoveAttachment(i); onGenerate(): void; hasCards: boolean }` — plan-editor 좌측 섹션을 그대로 옮긴 것. 생성 버튼은 `AiButton`.
- `PlanEditor` props 변경: `brief`/`onBriefChange`를 부모(page)가 소유 — `onSave(cards, brief)`/`onLock(cards, brief)`/`onGenerate(cards, brief)` 시그니처는 유지하되 brief는 page 상태에서 온다. page는 `step === "plan"`일 때 `<aside>`에 `PlanBriefPanel`, `<section>`에 `PlanEditor`(카드 전폭).
- 카드 스타일: 기본 `border-transparent bg-transparent`, 인풋 `border-transparent bg-transparent`; `hover:border-hairline hover:bg-surface-pearl`; `focus-within:border-hairline focus-within:bg-surface-pearl focus-within:[&_input]:border-hairline focus-within:[&_input]:bg-surface`. 순서/삭제 버튼은 `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`.
- 애니: `<ol ref={listRef}>` + `useFlipOrder(listRef, orderKeyOf(cards))`, 각 `<li data-flip-key={card.clientId} className="group …">`. 삭제는 `closingIds` 상태로 `accordion-close`(240ms, `use-closing-keys.ts` 규칙)를 재생한 뒤 제거, 추가는 새 카드에 `accordion-open`.

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/plan-cards.test.ts
import { describe, expect, it } from "vitest";

import { orderKeyOf, stripClientIds, swapCards, withClientIds } from "./plan-cards";

const card = (name: string) => ({ name, summary: "", owner_role: "", department: "", depends_on: [], mode: "new" as const, existing_code: null });

describe("plan cards", () => {
  it("withClientIds gives unique keys and stripClientIds removes them", () => {
    const keyed = withClientIds([card("A"), card("B")]);
    expect(new Set(keyed.map((c) => c.clientId)).size).toBe(2);
    expect(stripClientIds(keyed)).toEqual([card("A"), card("B")]);
    expect("clientId" in stripClientIds(keyed)[0]).toBe(false);
  });
  it("swapCards moves an item and keeps keys with items", () => {
    const keyed = withClientIds([card("A"), card("B"), card("C")]);
    const moved = swapCards(keyed, 0, 1);
    expect(moved.map((c) => c.name)).toEqual(["B", "A", "C"]);
    expect(moved[1].clientId).toBe(keyed[0].clientId);
    expect(swapCards(keyed, 0, -1)).toBe(keyed);
    expect(swapCards(keyed, 2, 1)).toBe(keyed);
  });
  it("orderKeyOf changes only when order changes", () => {
    const keyed = withClientIds([card("A"), card("B")]);
    expect(orderKeyOf(keyed)).toBe(orderKeyOf([...keyed]));
    expect(orderKeyOf(swapCards(keyed, 0, 1))).not.toBe(orderKeyOf(keyed));
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/plan-cards.test.ts` → FAIL.

- [ ] **Step 3: lib 구현**

```ts
// frontend/src/lib/plan-cards.ts
// 플랜 카드 목록의 FE 전용 키·순서 계산 — FLIP(useFlipOrder)이 카드를 index가 아닌 clientId로 추적한다. 전송 전에 키를 벗긴다 (2026-09-23).

import type { FwPlanCard } from "./api";
import { genId } from "./id";

export interface KeyedCard extends FwPlanCard {
  clientId: string;
}

export function withClientIds(cards: FwPlanCard[]): KeyedCard[] {
  return cards.map((card) => ({ ...card, clientId: genId() }));
}

export function stripClientIds(cards: KeyedCard[]): FwPlanCard[] {
  return cards.map(({ clientId: _clientId, ...card }) => card);
}

export function swapCards(cards: KeyedCard[], i: number, delta: 1 | -1): KeyedCard[] {
  const j = i + delta;
  if (j < 0 || j >= cards.length) return cards;
  const next = [...cards];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export function orderKeyOf(cards: KeyedCard[]): string {
  return cards.map((card) => card.clientId).join("|");
}
```

`_clientId` 미사용 변수는 eslint `no-unused-vars`가 `_` 접두를 허용하는지 확인, 아니면 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 한 줄.

- [ ] **Step 4: PlanBriefPanel 분리** — plan-editor.tsx의 `<section data-id="fw-consult-brief-panel">…</section>`(brief textarea·첨부 목록·생성 버튼)을 그대로 새 파일로 옮기고 props로 배선. 머리 주석: `// 캠페인 ① 좌측 brief+첨부 패널 — planning 단계에 페이지 좌측 보드 자리를 쓴다(잠금 후엔 TaskBoard). PlanEditor와 짝.` 생성 버튼:

```tsx
<AiButton data-id="fw-consult-generate-plan" disabled={busy} onClick={onGenerate}>
  {hasCards ? t("fwConsult.regeneratePlan") : t("fwConsult.generatePlan")}
</AiButton>
```

- [ ] **Step 5: PlanEditor 재작성** — 상태 `const [cards, setCards] = useState<KeyedCard[]>(() => withClientIds(session.plan ?? []))`, `const [closingIds, setClosingIds] = useState<Set<string>>(new Set())`, `const listRef = useRef<HTMLOListElement>(null); useFlipOrder(listRef, orderKeyOf(cards));`. `move(i, delta)` → `setCards((prev) => swapCards(prev, i, delta))`. 삭제:

```ts
  function remove(clientId: string) {
    setClosingIds((prev) => new Set(prev).add(clientId));
    window.setTimeout(() => {
      setCards((prev) => prev.filter((c) => c.clientId !== clientId));
      setClosingIds((prev) => { const next = new Set(prev); next.delete(clientId); return next; });
    }, 240);  // globals.css .accordion-close 재생 시간과 동기(use-closing-keys.ts 규칙)
  }
```

추가: `setCards((prev) => [...prev, { ...EMPTY, clientId: genId() }])` + 마지막 카드는 `accordion-open`(`addedIdRef`에 담아 1회만). 카드 `<li key={card.clientId} data-flip-key={card.clientId} data-id={`fw-consult-plan-card-${i}`} className={`group grid … rounded-md border p-2.5 transition-colors duration-150 ${closingIds.has(card.clientId) ? "accordion-close" : "border-transparent hover:border-hairline hover:bg-surface-pearl focus-within:border-hairline focus-within:bg-surface-pearl"}`}>`. 인풋 클래스 `FIELD`를 `"w-full rounded-sm border border-transparent bg-transparent px-2 py-1 text-caption text-ink focus:border-hairline focus:bg-surface group-focus-within:border-hairline group-focus-within:bg-surface"`로. 우측 화살표/휴지통 열은 `opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100`. 저장/잠금/생성 콜백은 `stripClientIds(cards)`를 넘긴다. 기존 `data-id` 전부 유지(스모크 호환).

- [ ] **Step 6: page.tsx 배선** — brief를 page 상태로 올린다: `const [brief, setBrief] = useState(session.brief)`는 session 로드 후 초기화가 필요하므로 `useState<string | null>(null)`로 두고 `brief ?? session.brief`를 쓴다. `<aside>` 내용: `step === "plan" ? <PlanBriefPanel … onGenerate={() => void run(async () => { await saveFrameworkPlan(session.id, cardsRef.current, false, brief); return generateFrameworkPlan(session.id); })} /> : <TaskBoard …/>`. PlanEditor의 현재 카드를 page가 알아야 하므로 `onCardsChange(cards: FwPlanCard[])` prop을 추가해 `cardsRef`에 미러(렌더 읽기 아님).

- [ ] **Step 7: 게이트 + 카탈로그** — vitest PASS · tsc · eslint(`react-hooks/set-state-in-effect` 없음) · `node scripts/build-component-catalog.mjs`.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/plan-cards.ts frontend/src/lib/plan-cards.test.ts frontend/src/components/framework-interview/plan-brief-panel.tsx frontend/src/components/framework-interview/plan-editor.tsx "frontend/src/app/framework/consult/[sessionId]/page.tsx" frontend/COMPONENTS.md PROGRESS.md
git commit -m "feat(fw-consult): quiet plan cards with FLIP reorder and brief panel on the left board — 플랜 카드 투명화·FLIP·좌측 brief"
```

---

### Task 4: 주관식 "AI 제안" 타이핑 입력 (B10)

**Files:**
- Create: `frontend/src/lib/typewriter.ts`, `frontend/src/lib/typewriter.test.ts`
- Modify: `frontend/src/components/framework-interview/questionnaire-form.tsx` (text 문항 블록)
- Modify: `frontend/src/lib/i18n-messages.ts` (en·ko 각 2키)

**Interfaces:**
- ```ts
  export const TYPE_MS_PER_CHAR = 25;
  export const TYPE_CAP_MS = 1200;
  export function buildTypingSchedule(text: string, msPerChar = TYPE_MS_PER_CHAR, capMs = TYPE_CAP_MS): number[]  // i번째 글자가 보이는 시각(ms), 총 길이는 capMs 이하
  export function useTypewriter(): { typeInto: (text: string, onFrame: (partial: string) => void, onDone: () => void) => () => void }  // 반환값 = 취소
  ```
- i18n: `fwConsult.aiSuggest` "AI suggestion" / "AI 제안", `fwConsult.editAnswer` "Edit" / "수정".
- 동작: text 문항 기본 = 빈 textarea(값 `""`). 옆 `AiButton variant="inline"`(`fw-consult-ai-suggest-${q.id}`) → `typeInto(q.suggested, partial => onChange(q.id, partial))`, 진행 중 버튼 disabled. blur 시 값이 있으면 확정 뷰(텍스트 + hover 시 연필 `fw-consult-edit-answer-${q.id}`), 클릭하면 textarea 복귀·autoFocus. reduced-motion이면 즉시 채움. 기존 `fw-consult-write-own`·`fw-consult-use-suggestion` 제거(`fillAll`은 유지: text는 채우지 않음 — `fillSuggested` 불변).

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/typewriter.test.ts
import { describe, expect, it } from "vitest";

import { buildTypingSchedule } from "./typewriter";

describe("buildTypingSchedule", () => {
  it("spaces characters evenly at msPerChar", () => {
    expect(buildTypingSchedule("abc", 25, 1200)).toEqual([25, 50, 75]);
  });
  it("compresses long text so the whole word finishes within capMs", () => {
    const s = buildTypingSchedule("x".repeat(100), 25, 1200);
    expect(s).toHaveLength(100);
    expect(s[99]).toBe(1200);
    expect(s[0]).toBe(12);
  });
  it("empty text has no frames", () => {
    expect(buildTypingSchedule("", 25, 1200)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/lib/typewriter.test.ts` → FAIL.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/typewriter.ts
// 주관식 "AI 제안" 타이핑 연출 — 글자별 표시 시각을 미리 계산하고(캡 1.2s), 훅은 타이머로 재생하며 취소 가능. reduced-motion이면 즉시 (2026-09-23).

import { useCallback, useEffect, useRef } from "react";

export const TYPE_MS_PER_CHAR = 25;
export const TYPE_CAP_MS = 1200;

export function buildTypingSchedule(text: string, msPerChar = TYPE_MS_PER_CHAR, capMs = TYPE_CAP_MS): number[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  const step = Math.min(msPerChar, capMs / chars.length);
  return chars.map((_, i) => Math.round(step * (i + 1)));
}

export function useTypewriter(): { typeInto: (text: string, onFrame: (partial: string) => void, onDone: () => void) => () => void } {
  const timers = useRef<number[]>([]);
  const clear = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clear, [clear]);
  const typeInto = useCallback((text: string, onFrame: (partial: string) => void, onDone: () => void) => {
    clear();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || text.length === 0) {
      onFrame(text);
      onDone();
      return clear;
    }
    const chars = [...text];
    buildTypingSchedule(text).forEach((at, i) => {
      timers.current.push(window.setTimeout(() => {
        onFrame(chars.slice(0, i + 1).join(""));
        if (i === chars.length - 1) onDone();
      }, at));
    });
    return clear;
  }, [clear]);
  return { typeInto };
}
```

- [ ] **Step 4: 폼 배선** — `questionnaire-form.tsx` text 블록을 교체:

```tsx
            {q.kind === "text" && (
              <TextAnswer
                qid={q.id}
                value={textValue}
                suggested={typeof q.suggested === "string" ? q.suggested : ""}
                onChange={(v) => onChange(q.id, v)}
              />
            )}
```

같은 파일 하단에 내부 컴포넌트:

```tsx
// 주관식 한 칸 — 빈 textarea에서 시작, [AI 제안]이 제안값을 타이핑으로 채우고, blur로 확정(텍스트 뷰), hover 연필로 재편집.
function TextAnswer({ qid, value, suggested, onChange }: { qid: string; value: string; suggested: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const { typeInto } = useTypewriter();
  const [editing, setEditing] = useState(() => value === "");
  const [typing, setTyping] = useState(false);
  const committed = !editing && value !== "";
  return (
    <div className="group flex items-start gap-2">
      {committed ? (
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-caption text-ink" data-id={`fw-consult-answer-view-${qid}`}>{value}</p>
      ) : (
        <textarea
          data-id={`fw-consult-answer-${qid}`}
          autoFocus={editing && value !== ""}
          readOnly={typing}
          className="min-h-16 w-full min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-2 py-1 text-caption text-ink"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => { if (value.trim() !== "") setEditing(false); }}
        />
      )}
      {committed ? (
        <button type="button" data-id={`fw-consult-edit-answer-${qid}`} title={t("fwConsult.editAnswer")}
          className="shrink-0 rounded-sm p-1 text-ink-secondary opacity-0 transition-opacity duration-150 hover:bg-surface-alt group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing(true)}>
          <PenLine size={14} strokeWidth={1.5} />
        </button>
      ) : (
        <AiButton variant="inline" data-id={`fw-consult-ai-suggest-${qid}`} disabled={typing || suggested === ""} className="shrink-0"
          onClick={() => { setTyping(true); typeInto(suggested, onChange, () => { setTyping(false); setEditing(false); }); }}>
          {t("fwConsult.aiSuggest")}
        </AiButton>
      )}
    </div>
  );
}
```

`openText` 상태·`textOpen` 계산·`fw-consult-write-own`/`fw-consult-use-suggestion` 블록 제거. `AnswerReview`의 "빈칸=제안 적용" 표시는 그대로(빈칸 제출은 여전히 허용).

- [ ] **Step 5: i18n** — en `"fwConsult.aiSuggest": "AI suggestion", "fwConsult.editAnswer": "Edit answer"`; ko `"AI 제안"`, `"답 수정"`. 앵커: `"fwConsult.fillAll"` 키 바로 아래(en·ko).

- [ ] **Step 6: 게이트** — vitest PASS · tsc · eslint. 기존 스모크가 `fw-consult-write-own`/`fw-consult-use-suggestion`을 쓰면(`grep -n` 확인) `fw-consult-ai-suggest-*`로 이식.

- [ ] **Step 7: 커밋**

```bash
git add frontend/src/lib/typewriter.ts frontend/src/lib/typewriter.test.ts frontend/src/components/framework-interview/questionnaire-form.tsx frontend/src/lib/i18n-messages.ts PROGRESS.md
git commit -m "feat(fw-consult): typed AI suggestion for free-text answers with blur commit — 주관식 AI 제안 타이핑·blur 확정"
```

---

### Task 5: 스모크 + 캡처

**Files:**
- Create: `frontend/scripts/pw-fw-consult-ux.mjs`
- Capture: `docs/qa/screens/fw-consult-plan-cards.png`, `fw-consult-answer-typing.png`, `fw-consult-relations-diamond.png`

**Interfaces:**
- 전제: Task 0 가짜 AI(:9999) + backend(8048, `AI_BASE_URL=http://localhost:9999/v1`) + frontend(3047).
- 흐름: API로 L1~L5 → 세션 생성 → 페이지 진입(plan) → 좌측 `fw-consult-brief-panel`이 aside 안에 있는지 → [계획 제안](`AiButton` class `ai-shimmer`) → 카드 2장(테두리 투명: `getComputedStyle(li).borderColor` alpha 0) → hover 시 테두리 → 2번 카드 ↑ 클릭 → `data-flip-key` 순서 뒤집힘 + `style.transform`이 한 프레임 안에 설정됨(`requestAnimationFrame` 전 측정) → 카드 추가 → 삭제(240ms 후 사라짐) → 잠금 → 첫 카드 ready 대기 → 문항 q4의 textarea가 빈 값 → [AI 제안] 클릭 → 300ms 뒤 값이 부분 문자열(타이핑 중) → 완료 후 확정 뷰 `fw-consult-answer-view-q4` → hover 연필 → 제출 2장 → 연결 단계 → 미리보기 `polygon` 존재(분기 노드).

- [ ] **Step 1: 스크립트** — `pw-fw-consult.mjs`의 세션 준비·제출 루프를 복제하고 위 단언을 `check`로 쓴다. 타이핑 판정:

```js
await page.locator('[data-id="fw-consult-ai-suggest-q4"]').click();
await page.waitForTimeout(300);
const partial = await page.locator('[data-id="fw-consult-answer-q4"]').inputValue();
check("AI suggestion types progressively", partial.length > 0 && partial.length < "요청서 도착".length, partial);
await page.locator('[data-id="fw-consult-answer-view-q4"]').waitFor({ timeout: 3000 });
check("typed answer commits to the read view", (await page.locator('[data-id="fw-consult-answer-view-q4"]').innerText()) === "요청서 도착");
```

FLIP 판정:

```js
const keysBefore = await page.$$eval('[data-id="fw-consult-plan-cards"] > li', (els) => els.map((e) => e.dataset.flipKey));
await page.locator('[data-id="fw-consult-plan-up-1"]').click();
const moved = await page.evaluate(() => {
  const li = document.querySelector('[data-id="fw-consult-plan-cards"] > li');
  return li instanceof HTMLElement ? li.style.transform : "";
});
check("reorder applies a FLIP transform on the moved card", moved.startsWith("translateY("), moved);
const keysAfter = await page.$$eval('[data-id="fw-consult-plan-cards"] > li', (els) => els.map((e) => e.dataset.flipKey));
check("card keys travel with the cards", keysAfter[0] === keysBefore[1] && keysAfter[1] === keysBefore[0]);
```

(FLIP transform은 `useLayoutEffect` 직후 rAF 전까지만 남으므로 click 직후 동기 evaluate로 잡는다. 놓치면 `transition` 속성이 설정된 것을 대신 본다.)

마름모 판정: `check("branch node renders as a diamond", (await page.locator('[data-id="fw-consult-relations-preview"] svg polygon').count()) >= 1)`.

- [ ] **Step 2: 실행** — `BASE_URL=http://localhost:3047 BACKEND_URL=http://localhost:8048 node scripts/pw-fw-consult-ux.mjs` → 전부 PASS. 기존 `pw-fw-consult.mjs`·`pw-fw-consult-existing.mjs`·`pw-fw-consult-pick-card.mjs`·`pw-fw-consult-plan-shot.mjs`도 재실행해 green.

- [ ] **Step 3: 게이트 전체 + 커밋 + 공유**

```bash
git add frontend/scripts/pw-fw-consult-ux.mjs docs/qa/screens/fw-consult-plan-cards.png docs/qa/screens/fw-consult-answer-typing.png docs/qa/screens/fw-consult-relations-diamond.png PROGRESS.md
git commit -m "test(fw-consult): smoke for the round-2 campaign UX — 캠페인 UX 스모크·캡처"
git push origin dev
```

캡처 3장을 SendUserFile로 공유하고 서버 3개(가짜 AI 포함)를 PID로 회수한다.
