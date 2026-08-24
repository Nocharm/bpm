# Height-Shift (노드 간격 자동 재조정) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 표시 높이(측정)로 커진 노드 아래의 노드들을 렌더 시점에만 밀어내 겹침을 없앤다 — 저장 좌표 불변.

**Architecture:** `lib/height-shift.ts`(순수 함수)가 노드 실측 높이에서 Y 계단함수 스텝을 만들고, 오프셋 조회·역변환은 기존 `lib/inline-shift.ts`(`offsetAtSavedX`/`displayToSavedX`)를 축만 바꿔 재사용한다. `page.tsx`는 `displayNodes` 메모에서 오프셋을 합성하고, 드래그·생성 등 화면→저장 변환 지점에서 역변환한다. 전환은 오프셋 rAF 트윈.

**Tech Stack:** TypeScript, React 19(+React Compiler), @xyflow/react, vitest, Playwright(playwright-core+시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-08-23-node-spacing-design.md` — 플랜과 충돌 시 스펙이 우선.

## Global Constraints

- **저장 좌표 절대 불변** — 오프셋은 `displayNodes` 파생에서만. 메인 `nodes` state에 표시 좌표를 쓰지 않는다(예외: 드래그/생성은 역변환 **후의 저장 좌표**만 기록).
- 앵커 타입 allowlist: `process·decision·start·end·subprocess`. `section`은 앵커·피밀림 모두 제외.
- `EPSILON = 4`(px) 미만 extra는 무시. 기준 높이는 `nodeSizeOf(type).h`(process 52·decision 96·start/end 40·subprocess 64).
- 인라인 펼침 중(`inlineComposition != null`)엔 스텝 `[]`(비활성).
- React Compiler: 수동 `useMemo`/`useCallback` deps는 추론과 일치해야 lint/build 통과. effect 내 동기 setState 금지(`set-state-in-effect`).
- `.react-flow__node` 대상 CSS가 필요하면 globals.css 금지 — page.tsx raw `<style>`(Turbopack purge).
- id 생성은 `genId()`(`crypto.randomUUID` 금지). UI 신규 문구에 em dash(—) 금지 — 하이픈.
- 게이트(매 태스크): `npx vitest run` 전체 그린 · `npx tsc --noEmit` · `npm run lint` 0 · 커밋 전 `npm run build`.
- 커밋 규칙: `type(scope): English — 한국어` + PROGRESS.md 1줄 같은 커밋. 백엔드 무변경(위반 시 중단·보고).

## File Structure

| 파일 | 책임 |
|---|---|
| Create `frontend/src/lib/height-shift.ts` | 실측→Y 스텝 생성(밴드 병합)·노드별 오프셋 맵 (순수 함수) |
| Create `frontend/src/lib/height-shift.test.ts` | 위 모듈 vitest |
| Modify `frontend/src/app/maps/[mapId]/page.tsx` | ySteps 메모·displayNodes 합성·드래그/생성 역변환·트윈 |
| Create `frontend/scripts/pw-smoke-height-shift.mjs` | e2e 스모크(펼침 밀림·복원·드래그 라운드트립) |

---

### Task 0: 워크트리 부트스트랩

**Files:** 없음(환경만). 워크트리 `/Users/hyeonjin/Documents/bpm/.claude/worktrees/node-spacing`, 브랜치 `feat/node-spacing`.

- [ ] **Step 1: node_modules 복제 + 보강** (turbopack이 심링크 거부 — APFS clone 선례)

```bash
cd /Users/hyeonjin/Documents/bpm/.claude/worktrees/node-spacing/frontend
cp -Rc /Users/hyeonjin/Documents/bpm/.claude/worktrees/io-linking/frontend/node_modules node_modules
npm install
```

- [ ] **Step 2: 기준선 그린 확인**

Run: `npx vitest run 2>&1 | tail -2 && npx tsc --noEmit && npm run lint`
Expected: 740 passed · 타입 에러 0 · lint 0. 실패하면 환경 문제 — 진행 중단·보고.

---

### Task 1: `lib/height-shift.ts` — 스텝 생성·오프셋 맵 (TDD)

**Files:**
- Create: `frontend/src/lib/height-shift.ts`
- Test: `frontend/src/lib/height-shift.test.ts`

**Interfaces:**
- Consumes: `ShiftStep`·`offsetAtSavedX`(`@/lib/inline-shift`), `AppNode`·`nodeSizeOf`·`estimateNodeWidth`·`estimateNodeHeight`(`@/lib/canvas`).
- Produces: `buildHeightSteps(nodes: AppNode[]): ShiftStep[]` · `buildYOffsets(nodes: AppNode[], steps: ShiftStep[]): Map<string, number>` · `getDisplayHeight(node: AppNode): number` — Task 2~4가 이 시그니처 그대로 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/height-shift.test.ts
// height-shift 스텝 생성·밴드 병합·오프셋 계약 (spec §4)
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import { buildHeightSteps, buildYOffsets, getDisplayHeight } from "@/lib/height-shift";

function makeNode(
  id: string,
  y: number,
  opts: { type?: string; measuredH?: number; label?: string } = {},
): AppNode {
  const node = {
    id,
    type: "process",
    position: { x: 0, y },
    data: {
      label: opts.label ?? id,
      nodeType: opts.type ?? "process",
      color: "",
      groupIds: [],
      hasChildren: false,
    },
  } as unknown as AppNode;
  if (opts.measuredH !== undefined) {
    (node as { measured?: { width: number; height: number } }).measured = {
      width: 170,
      height: opts.measuredH,
    };
  }
  return node;
}

describe("getDisplayHeight", () => {
  it("measured 우선, 미측정은 estimateNodeHeight 폴백(짧은 라벨 process = 기준 52)", () => {
    expect(getDisplayHeight(makeNode("a", 0, { measuredH: 300 }))).toBe(300);
    expect(getDisplayHeight(makeNode("b", 0))).toBe(52);
  });
});

describe("buildHeightSteps", () => {
  it("성장 없음(전부 기준 이하) → 빈 배열", () => {
    expect(buildHeightSteps([makeNode("a", 0, { measuredH: 52 }), makeNode("b", 200)])).toEqual([]);
  });

  it("EPSILON(4px) 미만 extra는 무시", () => {
    expect(buildHeightSteps([makeNode("a", 0, { measuredH: 55 })])).toEqual([]);
  });

  it("단일 성장 노드 → 밴드 1개 {x: y+기준높이, footprint: extra}", () => {
    const steps = buildHeightSteps([makeNode("a", 100, { measuredH: 252 })]);
    expect(steps).toEqual([{ x: 152, footprint: 200 }]);
  });

  it("같은 행(저장 Y 구간 겹침) 두 성장 노드 → 한 밴드로 병합, extra는 max", () => {
    const steps = buildHeightSteps([
      makeNode("a", 100, { measuredH: 352 }), // 구간 [100,152], extra 300
      makeNode("b", 120, { measuredH: 172 }), // 구간 [120,172], 겹침, extra 120
    ]);
    expect(steps).toEqual([{ x: 172, footprint: 300 }]); // bottom=max, extra=max
  });

  it("수직 스택(구간 비겹침) 두 성장 노드 → 밴드 2개(합산은 오프셋 조회에서)", () => {
    const steps = buildHeightSteps([
      makeNode("a", 0, { measuredH: 152 }),   // [0,52] extra 100
      makeNode("b", 300, { measuredH: 252 }), // [300,352] extra 200
    ]);
    expect(steps).toEqual([
      { x: 52, footprint: 100 },
      { x: 352, footprint: 200 },
    ]);
  });

  it("section 노드는 대형 측정이라도 앵커 제외", () => {
    expect(buildHeightSteps([makeNode("s", 0, { type: "section", measuredH: 800 })])).toEqual([]);
  });

  it("subprocess는 기준 64 — 측정 300이면 extra 236", () => {
    expect(buildHeightSteps([makeNode("sp", 10, { type: "subprocess", measuredH: 300 })])).toEqual([
      { x: 74, footprint: 236 },
    ]);
  });
});

describe("buildYOffsets", () => {
  it("밴드 위/경계(y == bottom)는 0, 아래는 누적합 — section 노드는 항상 0", () => {
    const nodes = [
      makeNode("a", 0, { measuredH: 152 }),   // 밴드 [x:52, fp:100]
      makeNode("b", 300, { measuredH: 252 }), // 밴드 [x:352, fp:200]
      makeNode("above", 20),
      makeNode("boundary", 52),
      makeNode("mid", 200),
      makeNode("below", 500),
      makeNode("sec", 500, { type: "section" }),
    ];
    const offsets = buildYOffsets(nodes, buildHeightSteps(nodes));
    expect(offsets.get("above") ?? 0).toBe(0);
    expect(offsets.get("boundary") ?? 0).toBe(0); // strict < 계약 (spec §9)
    expect(offsets.get("mid")).toBe(100);
    expect(offsets.get("below")).toBe(300); // 100+200 스택 합산
    expect(offsets.get("a") ?? 0).toBe(0); // 자기 밴드는 자기보다 아래 — 자기 미포함
    expect(offsets.get("b")).toBe(100);
    expect(offsets.get("sec") ?? 0).toBe(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/height-shift.test.ts`
Expected: FAIL — "Cannot find module '@/lib/height-shift'" 류.

- [ ] **Step 3: 최소 구현**

```ts
// frontend/src/lib/height-shift.ts
// 표시 높이(실측)로 커진 노드 아래를 저장 Y 계단함수로 밀어내는 스텝 생성 — 저장 좌표 불변.
// 오프셋 조회·역변환은 lib/inline-shift(offsetAtSavedX/displayToSavedX)를 Y축으로 재사용.
// 설계: docs/superpowers/specs/2026-08-23-node-spacing-design.md §4
import {
  estimateNodeHeight,
  estimateNodeWidth,
  nodeSizeOf,
  type AppNode,
  type ProcessNodeType,
} from "@/lib/canvas";
import { offsetAtSavedX, type ShiftStep } from "@/lib/inline-shift";

// 4px 미만 성장은 무시 — 폰트 렌더 편차로 인한 미세 지터 방지
const EPSILON = 4;

// 콘텐츠로 높이가 자라는 타입만 앵커 — section(Word 맵 영역 박스)은 의도된 대형이라 제외
const ANCHOR_TYPES = new Set<ProcessNodeType>(["process", "decision", "start", "end", "subprocess"]);

/** 표시 높이 — React Flow 실측 우선, 미측정(첫 페인트)은 라벨 기반 추정 폴백. */
export function getDisplayHeight(node: AppNode): number {
  const measured = node.measured?.height;
  if (measured !== undefined && measured > 0) return measured;
  const type = node.data.nodeType;
  return estimateNodeHeight(node.data.label, type, estimateNodeWidth(node.data.label, type));
}

/**
 * 커진 노드들로 Y 계단함수 스텝 생성. 앵커 구간 [savedY, savedY+기준높이]가 겹치는(같은 행)
 * 앵커는 한 밴드로 병합해 bottom=max·extra=max — 나란한 성장이 아래를 이중으로 밀지 않게.
 * 반환 ShiftStep은 x 필드에 Y값을 실음(inline-shift 1D 재사용).
 */
export function buildHeightSteps(nodes: AppNode[]): ShiftStep[] {
  const anchors = nodes
    .filter((node) => ANCHOR_TYPES.has(node.data.nodeType))
    .map((node) => {
      const base = nodeSizeOf(node.data.nodeType).h;
      return {
        top: node.position.y,
        bottom: node.position.y + base,
        extra: getDisplayHeight(node) - base,
      };
    })
    .filter((anchor) => anchor.extra >= EPSILON)
    .sort((a, b) => a.top - b.top);
  const steps: ShiftStep[] = [];
  let band: { top: number; bottom: number; extra: number } | null = null;
  for (const anchor of anchors) {
    if (band && anchor.top <= band.bottom) {
      band.bottom = Math.max(band.bottom, anchor.bottom);
      band.extra = Math.max(band.extra, anchor.extra);
    } else {
      if (band) steps.push({ x: band.bottom, footprint: band.extra });
      band = { ...anchor };
    }
  }
  if (band) steps.push({ x: band.bottom, footprint: band.extra });
  return steps;
}

/** 노드별 표시 Y 오프셋 — section은 피밀림도 제외(0). 오프셋 0인 노드는 맵에서 생략. */
export function buildYOffsets(nodes: AppNode[], steps: ShiftStep[]): Map<string, number> {
  const offsets = new Map<string, number>();
  if (steps.length === 0) return offsets;
  for (const node of nodes) {
    if (node.data.nodeType === "section") continue;
    const offset = offsetAtSavedX(node.position.y, steps);
    if (offset > 0) offsets.set(node.id, offset);
  }
  return offsets;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/lib/height-shift.test.ts` → 전부 PASS.
- [ ] **Step 5: 전체 게이트** — `npx vitest run && npx tsc --noEmit && npm run lint` 그린.
- [ ] **Step 6: 커밋** (PROGRESS.md 1줄 포함)

```bash
git add frontend/src/lib/height-shift.ts frontend/src/lib/height-shift.test.ts PROGRESS.md
git commit -m "feat(canvas): height-shift step builder with band merge — 실측 높이 Y 스텝 생성·밴드 병합"
```

---

### Task 2: 에디터 합성 — displayNodes 오프셋 + 드래그 역변환

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` — ①`displayNodes` useMemo(6296~) ②`dropDraggingPositions`(1604~) ③상태 선언부(다른 canvas 관련 useMemo 근처)

**Interfaces:**
- Consumes: Task 1의 `buildHeightSteps`/`buildYOffsets`, 기존 `displayToSavedX`(이미 import됨: `@/lib/inline-shift`).
- Produces: `ySteps: ShiftStep[]`(메모) · `yStepsRef: RefObject<ShiftStep[]>` · `yOffsets: Map<string,number>`(메모) — Task 3·4가 사용.

- [ ] **Step 1: 스텝·오프셋 메모 추가** — `displayNodes` useMemo 선언보다 위(예: `inlineComposition` 소비 지점 근처)에:

```ts
// height-shift(#1): 표시 높이로 커진 노드 아래를 렌더 시점에만 밀어냄 — 저장 좌표 불변.
// 인라인 펼침 중엔 비활성(자식 합성 좌표와 결합 금지, spec §7). 설계: 2026-08-23-node-spacing-design.md
const ySteps = useMemo(
  () => (inlineComposition ? [] : buildHeightSteps(nodes)),
  [inlineComposition, nodes],
);
const yStepsRef = useRef<ShiftStep[]>([]);
useEffect(() => {
  yStepsRef.current = ySteps;
}, [ySteps]);
const yOffsets = useMemo(() => buildYOffsets(nodes, ySteps), [nodes, ySteps]);
```

import 추가: `import { buildHeightSteps, buildYOffsets } from "@/lib/height-shift";` — `ShiftStep` 타입은 기존 inline-shift import에 합류.

- [ ] **Step 2: displayNodes 합성** — `displayNodes` useMemo의 `mapped` map 콜백 마지막 `return injectSubEnds(withGmpPreview);` 를 다음으로 교체(그리고 memo deps에 `yOffsets` 추가):

```ts
      const injected = injectSubEnds(withGmpPreview);
      // height-shift 오프셋 — 저장 좌표는 nodes state에 그대로, 표시 위치만 이동
      const yOff = yOffsets.get(node.id) ?? 0;
      return yOff === 0
        ? injected
        : { ...injected, position: { x: injected.position.x, y: injected.position.y + yOff } };
```

- [ ] **Step 3: 드래그 역변환** — `dropDraggingPositions`(1604~)의 axis 보정 루프 안, `constrainToAxis` 적용 **다음**에 Y 역변환을 추가. RF가 흘려보내는 position은 표시 좌표이므로 저장 좌표로 환산해 state에 넣는다(스텝 비활성 시 항등이라 모드 분기 불요):

```ts
      const ySteps2 = yStepsRef.current;
      for (const change of changes) {
        if (change.type === "position" && change.position && ySteps2.length > 0) {
          change.position = {
            x: change.position.x,
            y: displayToSavedX(change.position.y, ySteps2),
          };
        }
      }
```

주의: 기존 `starts.size > 0` 블록과 별개의 독립 루프로 둔다(축 고정 없어도 동작해야 함). `dragStartPositionsRef`의 시작 좌표는 표시 좌표이고 비교 대상 change.position도 표시 좌표라 axis 보정은 그대로 두면 된다(역변환은 그 후).

- [ ] **Step 4: 게이트** — `npx vitest run && npx tsc --noEmit && npm run lint && npm run build` 전부 그린. React Compiler가 `displayNodes` deps 불일치를 잡으면 선언 배열에 `yOffsets`가 들어갔는지 확인.
- [ ] **Step 5: 수동 확인(로컬 dev)** — BE(:8000)+FE(:3000) 기동, admin.sys 데모 맵에서 IO 표시 켜고 Show more 클릭 → 아래 노드가 즉시 내려가는지, Show less → 복귀, 아래 노드 드래그 후 새로고침해도 위치 유지(저장 좌표 오염 없음)를 눈으로 확인. 결과를 보고서에 명시(스모크는 Task 5).
- [ ] **Step 6: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(editor): compose height-shift offsets in displayNodes, invert on drag — 표시 오프셋 합성·드래그 역변환"
```

---

### Task 3: 화면→저장 변환 지점 스윕 (노드 생성·붙여넣기·드롭)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` — `screenToFlowPosition` 소비 지점 중 **노드 위치를 만들어 nodes/graph에 쓰는 곳**.

**Interfaces:**
- Consumes: Task 2의 `yStepsRef`, 기존 `displayToSavedX`.

- [ ] **Step 1: 대상 열거** — `grep -n "screenToFlowPosition" "src/app/maps/[mapId]/page.tsx"` (현 시점 3418·3425·3523·4417·4442·4483·4668). 각 지점을 읽고 "결과가 새 노드 position 또는 붙여넣기 기준 좌표로 저장되는가"로 분류한다. 카메라 이동(fitView 중심 계산)·메뉴 앵커용은 제외.
- [ ] **Step 2: 헬퍼 추가 + 적용** — 상태 선언부(Task 2 Step 1 근처)에:

```ts
// 화면 클릭점 → 저장 Y(height-shift 역변환) — 새 노드 생성·붙여넣기 좌표 전용
const toSavedPoint = useCallback((point: { x: number; y: number }) => {
  const steps = yStepsRef.current;
  return steps.length === 0 ? point : { x: point.x, y: displayToSavedX(point.y, steps) };
}, []);
```

분류된 각 생성 지점에서 `const point = reactFlow.screenToFlowPosition(...)` 직후 `const saved = toSavedPoint(point)`로 감싸 저장·노드 생성에는 `saved`를 쓴다. 제외한 지점은 코드 주석 없이 그대로 두되, 태스크 보고서에 "지점별 판정 표"를 남긴다.

- [ ] **Step 3: 게이트** — vitest·tsc·lint·build 그린.
- [ ] **Step 4: 수동 확인** — 커진 노드 아래(밀린 영역)에서 우클릭 → 노드 추가 → 새 노드가 클릭 지점에 나타나는지(리로드 후에도 상대 위치 자연스러움) 확인.
- [ ] **Step 5: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "fix(editor): route node creation points through height-shift inverse — 생성 좌표 역변환 스윕"
```

---

### Task 4: 오프셋 rAF 트윈 (350ms) + 즉시 적용 3조건

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` — Task 2의 `yOffsets` 소비를 애니메이션 값으로 교체.

**Interfaces:**
- Consumes: Task 2의 `yOffsets`(목표값). `dragStartPositionsRef`(드래그 중 판정), `inlineComposition`.
- Produces: `renderYOffsets: ReadonlyMap<string, number>` — displayNodes가 이것만 읽는다.

- [ ] **Step 1: 트윈 상태 + rAF 드라이버** — Task 2 Step 1 블록 아래에 추가:

```ts
// 오프셋 전환 트윈 — CSS transition은 엣지(SVG 재계산)가 안 따라와 분리돼 보임 → 값 자체를 rAF 보간.
// 즉시 적용 3조건: 첫 산출(로드 정착)·드래그 중·prefers-reduced-motion. (spec §6)
const [renderYOffsets, setRenderYOffsets] = useState<ReadonlyMap<string, number>>(new Map());
const renderYOffsetsRef = useRef(renderYOffsets);
useEffect(() => {
  renderYOffsetsRef.current = renderYOffsets;
}, [renderYOffsets]);
const yTweenInitRef = useRef(false);
useEffect(() => {
  const from = renderYOffsetsRef.current;
  const to = yOffsets;
  // 동일하면 스킵 — set-state-in-effect 회피 겸 무한 루프 방지
  if (from.size === to.size && [...to].every(([id, v]) => from.get(id) === v)) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dragging = dragStartPositionsRef.current.size > 0;
  const instant = !yTweenInitRef.current || dragging || reduced;
  yTweenInitRef.current = true;
  if (instant) {
    const raf = requestAnimationFrame(() => setRenderYOffsets(to));
    return () => cancelAnimationFrame(raf);
  }
  const start = performance.now();
  const DURATION = 350;
  const ids = new Set([...from.keys(), ...to.keys()]);
  let raf = 0;
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / DURATION);
    // ease-smooth 근사(cubic ease-out) — 프레임마다 노드·엣지가 함께 이동
    const e = 1 - Math.pow(1 - t, 3);
    const next = new Map<string, number>();
    for (const id of ids) {
      const a = from.get(id) ?? 0;
      const b = to.get(id) ?? 0;
      const v = a + (b - a) * e;
      if (v !== 0) next.set(id, v);
    }
    setRenderYOffsets(t >= 1 ? to : next);
    if (t < 1) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}, [yOffsets]);
```

- [ ] **Step 2: displayNodes 소비 교체** — Task 2 Step 2의 `yOffsets.get(node.id)` → `renderYOffsets.get(node.id)` 로 바꾸고 memo deps도 `renderYOffsets`로 교체. 드래그 역변환(`yStepsRef`)·생성 역변환은 **목표 스텝 그대로 유지**(트윈 중간값으로 역변환하지 않는다 — 드래그 시작 시 instant 조건이 목표로 스냅).
- [ ] **Step 3: 게이트** — vitest·tsc·lint·build 그린(특히 `set-state-in-effect`: rAF 경유라 통과해야 정상 — lint가 잡으면 rAF 경유가 깨진 것).
- [ ] **Step 4: 수동 확인** — Show more/less 토글 시 아래 노드가 350ms 부드럽게 이동하며 **엣지가 노드에 붙어 함께** 움직이는지, 로드 직후엔 출렁임 없이 즉시 자리 잡는지 확인.
- [ ] **Step 5: 커밋**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" PROGRESS.md
git commit -m "feat(editor): tween height-shift offsets via raf — 오프셋 rAF 트윈·즉시 적용 3조건"
```

---

### Task 5: Playwright 스모크 + 풀 게이트

**Files:**
- Create: `frontend/scripts/pw-smoke-height-shift.mjs`

**Interfaces:**
- Consumes: 기존 스모크 하네스 관례 — `frontend/scripts/pw-smoke-io-links.mjs`를 골격으로 복제(부트스트랩: directory→POST /maps→checkout→PUT graph, X-Dev-User: admin.sys, teardown: `frontend/scripts/_purge-test-map.py` id-스코프 퍼지, 콘솔 에러 리스너 0 필수, 스크린샷은 저장소 밖).

- [ ] **Step 1: 스모크 작성** — 시나리오(체크포인트 ≥10):
  1. 좀비 정리 후 BE(:8000)·FE(:3000) 기동, 테스트 맵 시드: 노드 A(0,0) — input 8줄(`input` 개행 8항목), 노드 B(0,280), 노드 C(400,280), A→B 엣지.
  2. `addInitScript`로 `localStorage["bpm.nodeDisplayFields.v2"] = JSON.stringify(["assignee","params","input","output"])` 주입 후 에디터 오픈.
  3. A의 IO 리스트 캡 상태에서 B의 `transform` translateY 실측 → `y_capped` 기록.
  4. A `[data-id="node-io-list-input-more"]` 클릭(Show more) → 400ms 대기 → B translateY 증가 확인(`y_expanded - y_capped ≈ A 높이 증가분 ±2px`), C도 동일량 이동(행 보존).
  5. Show less → B·C 원위치 복원(±1px).
  6. 저장 좌표 불변: GET graph → B.pos_y == 280 그대로.
  7. 펼친 상태에서 B를 (0,+120) 드래그 → 2.5s 대기(autosave) → GET graph → B.pos_y ≈ 280+120 ±2 (표시 오프셋이 저장에 새지 않음 — 오프셋만큼 어긋나면 FAIL).
  8. 콘솔 에러 0, teardown 퍼지 + 잔류 0 확인.
- [ ] **Step 2: 실행** — `node scripts/pw-smoke-height-shift.mjs` 전 체크 PASS까지 수정 루프(동일 실패 2회면 중단·보고).
- [ ] **Step 3: 풀 게이트** — FE 4종 + BE 무변경 확인(`git status`에 backend/ 변화 없음).
- [ ] **Step 4: 커밋**

```bash
git add frontend/scripts/pw-smoke-height-shift.mjs PROGRESS.md
git commit -m "test(canvas): height-shift e2e smoke — 밀림·복원·드래그 라운드트립 스모크"
```

---

## 플랜 밖(오케스트레이터 몫)

최종 whole-branch 리뷰 → 브라우저 QA 라운드(M3 워스트 시드 재현: 캡/전체 펼침 겹침 0 바운딩 박스 검사 + 스크린샷 사용자 공유) → 푸시. 머지 시 스펙·플랜 스냅샷 폐기 정책 적용.
