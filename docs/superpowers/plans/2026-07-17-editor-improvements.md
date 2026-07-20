# 편집 모드 개선 5종 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 에디터(편집 모드)에 노드 복사/붙여넣기·서브프로세스 링크 유일성·SP 설명+등록 알림·Shift 축 고정 드래그·SP 목록 접근+검색 5종을 추가한다.

**Architecture:** 순수 로직(축 고정 계산·복사 라벨·클립보드 직렬화)은 `src/lib/`의 테스트 가능한 헬퍼로 분리해 vitest로 검증하고, 대형 단일 컴포넌트 `page.tsx`의 배선(키보드·드래그·컨텍스트 메뉴)은 헬퍼를 호출만 하게 얇게 유지한 뒤 Playwright 실기동으로 검증한다. 백엔드(기능 2·3)는 FastAPI 라우터/스키마/모델 변경 + pytest TDD.

**Tech Stack:** Next.js(TS, React) + @xyflow/react, FastAPI + SQLAlchemy + Pydantic, vitest, pytest, Playwright(시스템 Chrome).

**Spec:** `docs/superpowers/specs/2026-07-17-editor-improvements-design.md`

## Global Constraints

- **id 생성은 `genId()`(`@/lib/id`)만** — `crypto.randomUUID` 금지(서버 평문 HTTP=insecure context).
- **줄바꿈 LF 고정**(`.gitattributes`).
- **React Compiler 주의**(`frontend/AGENTS.md`): setState만 호출하는 사소한 핸들러는 `useCallback` 대신 **plain 함수**로(선언 deps 불일치 시 `react-hooks/preserve-manual-memoization`로 build 실패). effect 내 동기 setState 금지.
- **UI 문자열은 영어 기본**·동적 데이터만 한글. 아이콘은 **Lucide 16px / strokeWidth 1.5**. 이모지 금지. raw hex 금지(디자인 토큰).
- **i18n 키는 `src/lib/i18n-messages.ts`의 en 블록(~line 1054대)과 ko 블록(~line 2449대) 양쪽에 추가**.
- **신규 DB 컬럼은 `backend/app/db.py` `_ADDED_COLUMNS`에 등록**(서버 자동 ALTER — 운영 리셋 불가).
- **pytest 전체 그린 확인**: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`.
- **`grep`는 ugrep이라 `[mapId]` 브래킷 디렉터리를 건너뜀** — page.tsx 검색은 Read/python/find 사용.
- 복사 대상 노드 타입: **`process`·`decision`·`end`**. 제외: `start`·`subprocess`.
- 복사 라벨 형식: 공백 포함 `" (n)"`, n은 2부터(기존 `makeUniqueLabel` 규칙).

**주요 파일 지도 (실행 순서 4→1→5→2→3):**

| 파일 | 책임 | 기능 |
|------|------|------|
| `frontend/src/lib/drag-constrain.ts` (신규) | Shift 축 고정 순수 계산 | 4 |
| `frontend/src/lib/node-clipboard.ts` (신규) | localStorage 클립보드 R/W + 붙여넣기 그래프 빌더 | 1 |
| `frontend/src/lib/canvas.ts` | `isCopyableNodeType`·`makeCopyLabel` 추가 | 1 |
| `frontend/src/app/maps/[mapId]/page.tsx` | 키보드·드래그·컨텍스트 메뉴 배선 | 1·4·5·2 |
| `frontend/src/components/process-library-panel.tsx` | 검색 향상·자동포커스·이미 링크된 맵 비활성 | 5·2 |
| `backend/app/routers/graph.py` | 중복 링크 422 가드 | 2 |
| `backend/app/models.py`·`db.py`·`schemas.py`·`routers/maps.py` | `sp_description` + 등록 알림 | 3 |
| `frontend/src/lib/api.ts`·`.../subprocess-designation-modal.tsx`·`subprocess-inspector-card.tsx`·`.../subprocess-designation-panel.tsx`·`notification-categories.ts`·`inbox/page.tsx` | `sp_description` FE 3표면 + 알림 카테고리 | 3 |
| `frontend/src/lib/i18n-messages.ts` | 신규 i18n 키 | 1·2·5·3 |

---

# 기능 4 — Shift 드래그 축 고정

### Task 4.1: 축 고정 순수 헬퍼 `drag-constrain.ts`

**Files:**
- Create: `frontend/src/lib/drag-constrain.ts`
- Test: `frontend/src/lib/drag-constrain.test.ts`

**Interfaces:**
- Produces: `constrainToAxis(start: Point, current: Point, shiftHeld: boolean): Point`, `interface Point { x: number; y: number }`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/drag-constrain.test.ts
import { describe, expect, it } from "vitest";

import { constrainToAxis } from "@/lib/drag-constrain";

describe("constrainToAxis", () => {
  const start = { x: 100, y: 100 };

  it("passes current through unchanged when shift is not held", () => {
    expect(constrainToAxis(start, { x: 150, y: 130 }, false)).toEqual({ x: 150, y: 130 });
  });

  it("locks the vertical axis (keeps start.y) when horizontal delta dominates", () => {
    expect(constrainToAxis(start, { x: 180, y: 120 }, true)).toEqual({ x: 180, y: 100 });
  });

  it("locks the horizontal axis (keeps start.x) when vertical delta dominates", () => {
    expect(constrainToAxis(start, { x: 110, y: 190 }, true)).toEqual({ x: 100, y: 190 });
  });

  it("prefers horizontal lock on an exact diagonal tie", () => {
    expect(constrainToAxis(start, { x: 140, y: 140 }, true)).toEqual({ x: 140, y: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/drag-constrain.test.ts`
Expected: FAIL — `constrainToAxis` is not exported / module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/drag-constrain.ts
// Shift 드래그 축 고정 — 시작점 대비 이동량이 큰 축만 남기고 작은 축은 시작값으로 고정.

export interface Point {
  x: number;
  y: number;
}

/** shiftHeld면 dominant 축만 이동(수평 또는 수직 잠금), 아니면 current 그대로. 동률은 수평 잠금. */
export function constrainToAxis(start: Point, current: Point, shiftHeld: boolean): Point {
  if (!shiftHeld) {
    return current;
  }
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: current.x, y: start.y }; // 수평 이동 → 세로 고정
  }
  return { x: start.x, y: current.y }; // 수직 이동 → 가로 고정
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/drag-constrain.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/drag-constrain.ts frontend/src/lib/drag-constrain.test.ts
git commit -m "feat(editor): add constrainToAxis helper for shift-drag — Shift 축 고정 순수 계산"
```

---

### Task 4.2: `page.tsx`에 Shift 축 고정 배선

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Verify: `frontend/scripts/pw-verify-shift-drag.mjs` (신규 Playwright)

**Interfaces:**
- Consumes: `constrainToAxis` (Task 4.1), 기존 `dragStartPosRef`(page.tsx:6860), `dragStartOffsetRef`(page.tsx:928), `handleNodesChange`/`dropDraggingPositions`(page.tsx:1301-1334), `onSelectionDrag`(page.tsx:6893-6908).

- [ ] **Step 1: `shiftHeldRef` + keyup 리스너 추가**

`page.tsx` 상단 ref 선언부(다른 `useRef` 근처)에 추가하고, keydown/keyup 리스너로 Shift 상태를 추적한다(현재 keyup 리스너 없음 → 신설). 입력창 타이핑 중에도 Shift 상태는 추적해도 무방(축 고정은 드래그 중에만 발동).

```tsx
const shiftHeldRef = useRef(false);
useEffect(() => {
  const onKey = (e: KeyboardEvent) => { shiftHeldRef.current = e.shiftKey; };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  return () => {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
  };
}, []);
```

- [ ] **Step 2: import 추가**

`page.tsx` import 그룹(내부 lib)에 `import { constrainToAxis } from "@/lib/drag-constrain";` 추가.

- [ ] **Step 3: 단일 드래그 경로에 축 고정 적용**

`handleNodesChange`(page.tsx:1315-1334) 또는 그 앞단 `dropDraggingPositions`(page.tsx:1301-1312)에서, `type === "position"` 이고 `change.dragging`(드래그 중)인 change에 대해 시작점(`dragStartPosRef.current`, id 일치) 기준으로 `constrainToAxis`를 적용해 `change.position`을 보정한다. 임베드 자식(childNodes) 및 `suppressPosIdsRef` 대상은 기존대로 제외.

```tsx
// dropDraggingPositions 내부 — position change 보정 (기존 필터 로직과 함께)
if (change.type === "position" && change.position && change.dragging) {
  const start = dragStartPosRef.current;
  if (start && start.id === change.id) {
    change.position = { ...change.position, ...constrainToAxis(
      { x: start.x, y: start.y }, change.position, shiftHeldRef.current) };
  }
}
```

- [ ] **Step 4: 다중선택 드래그 경로에 축 고정 적용**

`onSelectionDrag`(page.tsx:6893-6908)에서 각 노드의 라이브 좌표를 `dragLiveById`에 쓸 때, 그 노드의 시작 오프셋(`dragStartOffsetRef.current`, page.tsx:928) 기준으로 동일하게 `constrainToAxis`를 적용한다. 다중선택은 개별 시작점이 다르므로 노드별로 보정한다.

- [ ] **Step 5: RF 키 충돌 회피**

`<ReactFlow>`(page.tsx:6785)에 `selectionKeyCode`/`multiSelectionKeyCode`가 Shift로 매핑돼 노드 드래그와 겹치지 않도록 명시 설정한다. 이미 `selectionOnDrag`(page.tsx:6926)로 pane 드래그 선택이 가능하므로 `selectionKeyCode={null}`(또는 Shift 외 키)로 두어 노드 드래그 중 Shift가 선택박스로 새지 않게 한다. 변경 후 pane 빈 영역 드래그 선택이 여전히 동작하는지 확인.

- [ ] **Step 6: 빌드/린트 통과 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors(React Compiler manual-memoization 경고 없음).

- [ ] **Step 7: Playwright 실기동 검증**

`frontend/scripts/pw-verify-shift-drag.mjs` 작성 — 노드 하나를 Shift 누른 채 대각선으로 드래그 → 드롭 후 위치가 한 축만 변했는지(시작 y 또는 x 유지) 확인. 다중선택 2노드 Shift 드래그도 동일 축만 이동 확인. 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-shift-drag.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/maps/[mapId]/page.tsx frontend/scripts/pw-verify-shift-drag.mjs
git commit -m "feat(editor): shift-drag locks node movement to one axis — Shift 드래그 축 고정(단일·다중·그룹)"
```

---

# 기능 1 — 노드 복사 / 붙여넣기 / Ctrl+드래그 복제

### Task 1.1: `canvas.ts` — `isCopyableNodeType` + `makeCopyLabel`

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (makeUniqueLabel 근처 `:496` 아래)
- Test: `frontend/src/lib/canvas.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Produces: `isCopyableNodeType(nodeType: ProcessNodeType): boolean`, `makeCopyLabel(original: string, taken: string[]): string`

- [ ] **Step 1: Write the failing test** (canvas.test.ts 하단에 추가; import 목록에 두 함수 추가)

```ts
import { isCopyableNodeType, makeCopyLabel } from "@/lib/canvas";

describe("isCopyableNodeType", () => {
  it("allows process, decision, end", () => {
    expect(isCopyableNodeType("process")).toBe(true);
    expect(isCopyableNodeType("decision")).toBe(true);
    expect(isCopyableNodeType("end")).toBe(true);
  });
  it("blocks start and subprocess", () => {
    expect(isCopyableNodeType("start")).toBe(false);
    expect(isCopyableNodeType("subprocess")).toBe(false);
  });
});

describe("makeCopyLabel", () => {
  it("appends (2) for a fresh copy", () => {
    expect(makeCopyLabel("새 단계", ["새 단계"])).toBe("새 단계 (2)");
  });
  it("increments an existing (n) suffix instead of nesting", () => {
    expect(makeCopyLabel("새 단계 (2)", ["새 단계", "새 단계 (2)"])).toBe("새 단계 (3)");
  });
  it("skips occupied numbers", () => {
    expect(makeCopyLabel("A", ["A", "A (2)", "A (3)"])).toBe("A (4)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/canvas.test.ts`
Expected: FAIL — `isCopyableNodeType`/`makeCopyLabel` not exported.

- [ ] **Step 3: Write minimal implementation** (canvas.ts, `makeUniqueLabel` 정의 아래)

```ts
// 복사 가능 노드 타입 — start(싱글턴)·subprocess(링크 유일성)는 제외.
const COPYABLE_NODE_TYPES: ReadonlySet<ProcessNodeType> = new Set(["process", "decision", "end"]);
export function isCopyableNodeType(nodeType: ProcessNodeType): boolean {
  return COPYABLE_NODE_TYPES.has(nodeType);
}

// 복사본 라벨 — 말미 " (n)" 접미를 떼어 base를 구한 뒤 다음 빈 번호 부여(중첩 방지).
export function makeCopyLabel(original: string, taken: string[]): string {
  const base = original.replace(/\s*\(\d+\)\s*$/, "").trim();
  return makeUniqueLabel(base || original, taken);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/canvas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/canvas.ts frontend/src/lib/canvas.test.ts
git commit -m "feat(editor): add isCopyableNodeType + makeCopyLabel — 복사 가능 판정·(n) 증분 라벨"
```

---

### Task 1.2: `node-clipboard.ts` — localStorage 클립보드 + 붙여넣기 빌더

**Files:**
- Create: `frontend/src/lib/node-clipboard.ts`
- Test: `frontend/src/lib/node-clipboard.test.ts`

**Interfaces:**
- Consumes: `NodeData`(`@/lib/canvas`), `makeCopyLabel`(Task 1.1).
- Produces:
  - `interface ClipboardNode { id: string; position: Point; data: NodeData }`
  - `interface ClipboardEdge { source: string; target: string; label?: string }`
  - `interface NodeClipboard { sourceMapId: number | null; nodes: ClipboardNode[]; edges: ClipboardEdge[] }`
  - `writeClipboard(c: NodeClipboard): void`
  - `readClipboard(): NodeClipboard | null`
  - `buildPaste(clip: NodeClipboard, opts: { newId: () => string; existingLabels: string[]; offset: Point }): { nodes: ClipboardNode[]; edges: (ClipboardEdge & { id: string })[] }`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/node-clipboard.test.ts
import { beforeEach, describe, expect, it } from "vitest";

import { buildPaste, readClipboard, writeClipboard, type NodeClipboard } from "@/lib/node-clipboard";
import type { NodeData } from "@/lib/canvas";

function mkData(label: string): NodeData {
  return { label, description: "", nodeType: "process", color: "", assignee: "", department: "",
    system: "", duration: "", groupIds: [], hasChildren: false } as NodeData;
}

const sample: NodeClipboard = {
  sourceMapId: 1,
  nodes: [
    { id: "a", position: { x: 0, y: 0 }, data: mkData("A") },
    { id: "b", position: { x: 40, y: 0 }, data: mkData("B") },
  ],
  edges: [{ source: "a", target: "b" }],
};

describe("clipboard read/write (localStorage)", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a payload", () => {
    writeClipboard(sample);
    expect(readClipboard()).toEqual(sample);
  });
  it("returns null when empty or malformed", () => {
    expect(readClipboard()).toBeNull();
    localStorage.setItem("bpm.nodeClipboard", "{not json");
    expect(readClipboard()).toBeNull();
  });
});

describe("buildPaste", () => {
  it("regenerates ids, offsets positions, remaps internal edges, dedups labels", () => {
    let n = 0;
    const out = buildPaste(sample, { newId: () => `new${n++}`, existingLabels: ["A"], offset: { x: 16, y: 16 } });
    expect(out.nodes.map((x) => x.id)).toEqual(["new0", "new1"]);
    expect(out.nodes[0].position).toEqual({ x: 16, y: 16 });
    expect(out.nodes[1].position).toEqual({ x: 56, y: 16 });
    // A collides with existing → "A (2)"; B is free → "B"
    expect(out.nodes[0].data.label).toBe("A (2)");
    expect(out.nodes[1].data.label).toBe("B");
    // edge remapped to new ids
    expect(out.edges[0]).toMatchObject({ source: "new0", target: "new1" });
    expect(out.edges[0].id).toBe("new2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/node-clipboard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// frontend/src/lib/node-clipboard.ts
// 노드 클립보드 — localStorage에 복사 노드/내부 엣지를 저장(같은 탭·다른 탭·다른 맵 붙여넣기).
// localStorage는 평문 HTTP(insecure context)에서도 동작(Web Crypto만 제약).

import { makeCopyLabel, type NodeData } from "@/lib/canvas";

const KEY = "bpm.nodeClipboard";
const MAX_NODES = 200; // 과대 payload 방지

export interface Point { x: number; y: number; }
export interface ClipboardNode { id: string; position: Point; data: NodeData; }
export interface ClipboardEdge { source: string; target: string; label?: string; }
export interface NodeClipboard {
  sourceMapId: number | null;
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

export function writeClipboard(c: NodeClipboard): void {
  try {
    const trimmed: NodeClipboard = { ...c, nodes: c.nodes.slice(0, MAX_NODES) };
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // 저장 실패(quota/차단)는 조용히 무시 — 복사 실패는 UX상 치명적이지 않음
  }
}

export function readClipboard(): NodeClipboard | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NodeClipboard;
    if (!parsed || !Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 붙여넣기 그래프 — 새 id 발급·위치 오프셋·라벨 dedup·내부 엣지 재매핑. */
export function buildPaste(
  clip: NodeClipboard,
  opts: { newId: () => string; existingLabels: string[]; offset: Point },
): { nodes: ClipboardNode[]; edges: (ClipboardEdge & { id: string })[] } {
  const idMap = new Map<string, string>();
  const taken = [...opts.existingLabels];
  const nodes = clip.nodes.map((n) => {
    const id = opts.newId();
    idMap.set(n.id, id);
    const label = makeCopyLabel(n.data.label, taken);
    taken.push(label);
    return {
      id,
      position: { x: n.position.x + opts.offset.x, y: n.position.y + opts.offset.y },
      data: { ...n.data, label, groupIds: [] as string[] },
    };
  });
  const edges = clip.edges
    .filter((e) => idMap.has(e.source) && idMap.has(e.target))
    .map((e) => ({ id: opts.newId(), source: idMap.get(e.source)!, target: idMap.get(e.target)!, label: e.label }));
  return { nodes, edges };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/node-clipboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/node-clipboard.ts frontend/src/lib/node-clipboard.test.ts
git commit -m "feat(editor): node clipboard (localStorage) + paste graph builder — 크로스탭 클립보드·붙여넣기 빌더"
```

---

### Task 1.3: `page.tsx` — Ctrl+C / Ctrl+V 배선 + 토스트

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`copy.blocked`, `copy.pasted` 키)
- Verify: `frontend/scripts/pw-verify-node-copy.mjs`

**Interfaces:**
- Consumes: `readClipboard`/`writeClipboard`/`buildPaste`(Task 1.2), `isCopyableNodeType`(Task 1.1), 기존 `genId`·`showToast`·`t`·`pushHistory`·`findFreeSpot`(page.tsx:2990)·`reactFlow.screenToFlowPosition`·`setNodes`·`setEdges`·`setSelectedId`·`scheduleAutoSave`·`flashNode`·조합키 핸들러 B(page.tsx:6178 Ctrl 분기).

- [ ] **Step 1: i18n 키 추가** (en 블록 ~1054대, ko 블록 ~2449대 양쪽)

```ts
// en
"copy.blocked": "This node can't be copied — only task, decision, and end nodes.",
"copy.pasted": "Pasted {n} node(s)",
// ko
"copy.blocked": "이 노드는 복사할 수 없습니다 — 일반·분기·끝만 가능합니다.",
"copy.pasted": "{n}개 노드를 붙여넣었습니다",
```
(i18n `t`가 `{n}` 치환을 지원하지 않으면 `t("copy.pasted").replace("{n}", String(count))`로 처리.)

- [ ] **Step 2: import 추가**

```tsx
import { readClipboard, writeClipboard, buildPaste } from "@/lib/node-clipboard";
import { isCopyableNodeType, makeCopyLabel } from "@/lib/canvas"; // makeCopyLabel은 이미 canvas import에 병합 가능
```

- [ ] **Step 3: `handleCopy`/`handlePaste` 구현**

`handleAddNode`(page.tsx:3017) 인근에 두 핸들러를 정의. `handleCopy`는 선택 노드(`selectedId` 또는 다중선택 집합)에서 복사 가능한 것만 골라 내부 엣지와 함께 `writeClipboard`. 하나도 없으면 `showToast(t("copy.blocked"))`. `handlePaste`는 `readClipboard`→같은 맵이면 offset `{16,16}`, 다른 맵이면 뷰포트 중앙 기준 오프셋 계산→`buildPaste`→`pushHistory`→`setNodes(append)`·`setEdges(append)`→새 노드 선택·flash·`scheduleAutoSave`→`showToast(t("copy.pasted") 치환)`.

선택 노드 집합은 React Flow 노드의 `selected` 플래그(`nodes.filter(n => n.selected)`)로 구한다(다중선택 반영). 내부 엣지 = `edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target))`. 클립보드에 담는 `data`는 파생 필드를 배제하기 위해 붙여넣기 빌더가 `{...data, groupIds: []}`만 재설정하므로, 복사 시엔 노드의 현재 `data`를 그대로 담되 subprocess가 아니므로 링크 파생 필드는 비어 있음(복사 대상이 process·decision·end로 한정되므로 안전).

- [ ] **Step 4: 조합키 핸들러에 Ctrl+C / Ctrl+V 연결**

조합키 핸들러 B의 Ctrl/⌘ 분기(page.tsx:6178)에 추가(기존 입력창·모달 가드 뒤):

```tsx
if (event.code === "KeyC") { event.preventDefault(); handleCopy(); return; }
if (event.code === "KeyV") { event.preventDefault(); handlePaste(); return; }
```

`readOnly`면 붙여넣기 무시(가드 추가). React Compiler 대비: `handleCopy`/`handlePaste`가 `useCallback`이면 deps를 정확히(nodes·edges·versionId·showToast·t 등), 아니면 plain 함수로.

- [ ] **Step 5: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Playwright 실기동 — 같은 맵 + 다른 탭**

`pw-verify-node-copy.mjs`: (a) 노드 선택→Ctrl+C→Ctrl+V→새 노드가 오프셋 위치에 라벨 `(2)`로 생성. (b) start 노드 선택→Ctrl+C→토스트 `copy.blocked`, 클립보드 미변경. (c) 다중선택 2노드+엣지 Ctrl+C→Ctrl+V→2노드+엣지 복제. (d) 다른 탭(같은 origin)에서 같은 맵/다른 맵 열어 Ctrl+V→붙여넣기 성공(localStorage 공유). 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-node-copy.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/maps/[mapId]/page.tsx frontend/src/lib/i18n-messages.ts frontend/scripts/pw-verify-node-copy.mjs
git commit -m "feat(editor): Ctrl+C/Ctrl+V node copy-paste with cross-tab clipboard — 노드 복사/붙여넣기(다중+엣지·크로스탭)"
```

---

### Task 1.4: `page.tsx` — Ctrl+드래그 복제 + 잔상 + `+` 배지

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/components/process-node.tsx` (드래그 노드에 `+` 배지 — prop/context 플래그)
- Verify: `frontend/scripts/pw-verify-ctrl-drag.mjs`

**Interfaces:**
- Consumes: `isCopyableNodeType`·`makeCopyLabel`·`genId`·`buildPaste` 또는 직접 복제, 기존 `onNodeDragStart`(6858)·`onNodeDragStop`(6864)·`onSelectionDragStart`(6889)·`shiftHeldRef`(Task 4.1 없이도 무관).

- [ ] **Step 1: `ctrlDrag` 상태 + 잔상 데이터**

`ctrlDragActive`(boolean state)와 `ctrlDragGhosts`(state: `{ id, position, data }[]`)를 선언. `onNodeDragStart`(6858)에서 `event.ctrlKey || event.metaKey`이고 대상(및 다중선택 포함)에서 복사 가능 노드가 있으면: 그 노드들의 시작 위치·data를 `ctrlDragGhosts`에 저장(원본 위치 잔상), `ctrlDragActive=true`. 복사 불가만 있으면 `showToast(t("copy.blocked"))` + 잔상/배지 없이 일반 이동.

- [ ] **Step 2: 잔상 오버레이 렌더**

`ctrlDragGhosts`를 반투명(`opacity 0.4`, dashed 테두리)으로 캔버스에 렌더 — 별도 RF 노드 배열에 합치거나(간단히) `displayNodes`에 임시 ghost 노드로 주입하고 `draggable:false`·`selectable:false`·className `bpm-node-ghost`. `globals.css`에 `.bpm-node-ghost { opacity:.4; }`(dashed는 토큰 `border-divider`).

- [ ] **Step 3: 드래그 노드에 `+` 배지**

`process-node.tsx`에 `showCopyBadge?: boolean` 표시 경로 추가 — `NodeActionsContext` 또는 transient className으로 드래그 중 노드에 Lucide `Plus`(16px, strokeWidth 1.5) 배지를 우상단에 표시. `ctrlDragActive && node.dragging` 조건.

- [ ] **Step 4: 드롭 시 사본 확정**

`onNodeDragStop`(6864)에서 `ctrlDragActive`면: 원본은 시작 위치로 되돌리고(원본 유지), 드롭 위치에는 `genId()`·`makeCopyLabel`로 사본 노드를 생성(기존 엣지 복제 없이 노드만, 또는 선택 집합의 내부 엣지 복제). `ctrlDragGhosts`·`ctrlDragActive` 초기화, `scheduleAutoSave`. 결과: 원본 위치 + 드롭 위치 = 2개.
- Ctrl을 드롭 전에 뗀 경우(`keyup`으로 `ctrlDragActive`를 끄면) 일반 이동으로 처리(사본 없음).

- [ ] **Step 5: 다중선택 Ctrl+드래그**

`onSelectionDragStart`(6889)/`onSelectionDragStop`(6909)에도 동일 로직 — 복사 가능 노드만 사본 생성, 나머지 이동, 제외분 있으면 토스트.

- [ ] **Step 6: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Playwright 실기동**

`pw-verify-ctrl-drag.mjs`: (a) Ctrl+드래그 복사 가능 노드→원본 제자리+드롭 위치 사본(라벨 `(2)`), 드래그 중 잔상·`+` 배지 노출 스크린샷. (b) Ctrl+드래그 start 노드→일반 이동+토스트, 사본 없음. (c) 다중선택 혼합 Ctrl+드래그→가능분만 복제+토스트. 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-ctrl-drag.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/maps/[mapId]/page.tsx frontend/src/components/process-node.tsx frontend/src/app/globals.css frontend/scripts/pw-verify-ctrl-drag.mjs
git commit -m "feat(editor): Ctrl+drag duplicates node with ghost + plus badge — Ctrl+드래그 복제(잔상·+배지)"
```

---

# 기능 5 — SP 목록 접근 확대 + 검색 UX

### Task 5.1: `process-library-panel.tsx` — 검색 향상 + 자동 포커스

**Files:**
- Modify: `frontend/src/components/process-library-panel.tsx`
- Test: `frontend/src/lib/library-search.test.ts` (선택 — filterByQuery 적용 회귀; 또는 Playwright로만)

**Interfaces:**
- Consumes: `filterByQuery`(`@/lib/search`, `search.ts:203`), 기존 `useInfiniteSlice`(패널 import :10).

- [ ] **Step 1: `filterByQuery`로 교체**

패널 필터(`process-library-panel.tsx:38-42`)를 교체:

```tsx
import { filterByQuery } from "@/lib/search";
// ...
const filtered = useMemo(() => {
  const q = query.trim();
  if (!q) return rows;
  return filterByQuery(rows, q, (r) => [
    { field: "name", text: r.name },
    { field: "department", text: r.department },
  ]).map((h) => h.item);
}, [rows, query]);
```
(`useInfiniteSlice(filtered, query)`는 그대로.)

- [ ] **Step 2: 검색창 자동 포커스**

검색 input(`:80-90`)에 `ref` + mount effect:

```tsx
const searchRef = useRef<HTMLInputElement>(null);
useEffect(() => { searchRef.current?.focus(); }, []);
// <input ref={searchRef} ... />
```
패널은 열릴 때마다 새로 마운트(`{libraryOpen && <ProcessLibraryPanel/>}`)되므로 모든 오픈 경로에서 포커스됨.

- [ ] **Step 3: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Playwright — 초성 검색 + 포커스**

`pw-verify-library-search.mjs`: 패널 열기→검색창에 자동 포커스(document.activeElement)→한글 초성(예: "ㄱㅁ")으로 부분/초성 매칭 결과 필터 확인. 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-library-search.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/process-library-panel.tsx frontend/scripts/pw-verify-library-search.mjs
git commit -m "feat(editor): library panel uses fuzzy/chosung search + autofocus — SP 목록 초성 검색·자동포커스"
```

---

### Task 5.2: `page.tsx` — 우클릭 메뉴 항목 + `S` 단축키

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (`library.open` 키)
- Verify: `frontend/scripts/pw-verify-library-open.mjs`

**Interfaces:**
- Consumes: 기존 `menuItems` pane 분기(page.tsx:4554-4566), `moreItem`(4539), `setLibraryOpen`(740), 조합키 핸들러 B(6137), `ContextMenuItem`(context-menu.tsx:29), Lucide `Network`.

- [ ] **Step 1: i18n 키 추가** (en/ko 양쪽)

```ts
"library.open": "Open subprocess library",   // en
"library.open": "서브프로세스 목록 열기",       // ko
```

- [ ] **Step 2: pane 컨텍스트 메뉴 맨 아래 항목 추가**

pane 분기 return 배열(page.tsx:4554-4566)의 `moreItem` 뒤에 divider + 신규 항목:

```tsx
{ divider: true },
{ label: t("library.open"), icon: Network, shortcut: "S", onSelect: () => setLibraryOpen(true) },
```
(`Network` import 확인. `accel`은 align 서브메뉴의 `s`와 top-level에서 구분되나, 혼동 방지 위해 `accel` 생략하고 전역 `S`로만 실행.)

- [ ] **Step 3: 전역 `S` 단축키**

조합키 핸들러 B(page.tsx:6137)의 입력창·모달 가드 뒤, 수정자 없는 분기에 추가:

```tsx
if (!event.ctrlKey && !event.metaKey && !event.altKey && event.code === "KeyS" && !menu) {
  event.preventDefault();
  setLibraryOpen(true);
  return;
}
```
(`!menu`로 컨텍스트 메뉴 열림 중 중복 방지 — align 서브메뉴 accel `s` 보호. `readOnly`여도 목록 열기는 허용 가능하나 기존 동작에 맞춰 판단.)

- [ ] **Step 4: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors(React Compiler 경고 없음 — plain 분기라 무해).

- [ ] **Step 5: Playwright 실기동**

`pw-verify-library-open.mjs`: (a) 캔버스 빈 곳 우클릭→메뉴 맨 아래 "Open subprocess library" 노출→클릭→패널 열림+검색창 포커스. (b) 캔버스 포커스 상태에서 `S`→패널 열림. (c) 입력창 포커스 중 `S`→열리지 않음(가드). 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-library-open.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/maps/[mapId]/page.tsx frontend/src/lib/i18n-messages.ts frontend/scripts/pw-verify-library-open.mjs
git commit -m "feat(editor): open SP library via pane menu + S shortcut — 우클릭 메뉴·S 단축키로 SP 목록"
```

---

# 기능 2 — 서브프로세스 링크 유일성

### Task 2.1: 백엔드 — graph PUT 중복 링크 422 가드

**Files:**
- Modify: `backend/app/routers/graph.py` (upsert `:274-276` 인근) 또는 `backend/app/subprocess.py`(검증 헬퍼)
- Test: `backend/tests/test_graph.py`

**Interfaces:**
- Produces: 같은 `linked_map_id`를 2개 이상 노드가 가지면 422(detail 명시).

- [ ] **Step 1: Write the failing test** (test_graph.py)

```python
def test_graph_rejects_duplicate_subprocess_link(client, seeded_map_with_two_subprocess_slots):
    # 두 노드가 같은 linked_map_id를 링크하는 그래프 PUT → 422
    map_id, target_map_id = seeded_map_with_two_subprocess_slots
    payload = {
        "nodes": [
            {"id": "n1", "title": "S1", "node_type": "subprocess", "linked_map_id": target_map_id, ...},
            {"id": "n2", "title": "S2", "node_type": "subprocess", "linked_map_id": target_map_id, ...},
        ],
        "edges": [],
    }
    r = client.put(f"/api/maps/{map_id}/versions/{ver}/graph", json=payload)
    assert r.status_code == 422
    assert "already linked" in r.json()["detail"].lower()
```
(픽스처는 기존 test_graph 패턴 참고 — 필수 필드는 실제 스키마에 맞춰 채움. 정상 단일 링크는 200으로 통과하는 대조 테스트도 추가.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/test_graph.py -q -k duplicate_subprocess`
Expected: FAIL (현재 200).

- [ ] **Step 3: Write minimal implementation** (graph.py PUT 핸들러, cycle 검사 인근)

```python
# 같은 대상 맵을 2개 이상 노드가 링크하면 거부(링크 유일성)
linked_ids = [n.linked_map_id for n in payload.nodes
              if n.node_type == "subprocess" and n.linked_map_id is not None]
dupes = {mid for mid in linked_ids if linked_ids.count(mid) > 1}
if dupes:
    raise HTTPException(status_code=422, detail=f"Subprocess map already linked in this map: {sorted(dupes)}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: (Step 2 명령) → PASS. 이어서 전체: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q`
Expected: PASS(회귀 없음), `ruff check app/ tests/` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/graph.py backend/tests/test_graph.py
git commit -m "feat(subprocess): reject duplicate linked_map_id in graph PUT — 서브프로세스 링크 유일성 백엔드 가드"
```

---

### Task 2.2: FE — picker 자동 비활성 + 두 진입 경로 차단

**Files:**
- Modify: `frontend/src/components/process-library-panel.tsx` (props `linkedMapIds`, `blocked` 확장)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (링크 집합 전달, `addLinkNodeFromMap` 차단)
- Modify: `frontend/src/lib/i18n-messages.ts` (`library.alreadyLinked`)
- Verify: `frontend/scripts/pw-verify-link-unique.mjs`

**Interfaces:**
- Consumes: 기존 `blocked`(`:102-103`), `currentMapId`. Produces: 패널 props에 `linkedMapIds: Set<number>` 추가.

- [ ] **Step 1: i18n 키 추가** (en/ko)

```ts
"library.alreadyLinked": "Already linked in this map",   // en
"library.alreadyLinked": "이미 이 맵에 링크됨",             // ko
```

- [ ] **Step 2: 패널 props + blocked 확장**

`ProcessLibraryPanelProps`에 `linkedMapIds: Set<number>` 추가. `blocked` 계산(`:102-103`)에 `|| linkedMapIds.has(row.map_id)`를 OR로 추가하고, 사유 툴팁을 분기(cycle vs alreadyLinked)해서 표시.

- [ ] **Step 3: page.tsx에서 링크 집합 전달**

패널 렌더(page.tsx:6717-6722)에 현재 맵 노드에서 파생한 링크 집합 전달:

```tsx
const linkedMapIds = useMemo(
  () => new Set(nodes.filter((n) => n.data.nodeType === "subprocess" && n.data.linkedMapId != null)
    .map((n) => n.data.linkedMapId as number)),
  [nodes],
);
// <ProcessLibraryPanel currentMapId={mapId} linkedMapIds={linkedMapIds} onClose={...} />
```

- [ ] **Step 4: 두 번째 진입 경로 차단**

`addLinkNodeFromMap`(page.tsx:3711-3762)에서 대상 맵이 이미 `linkedMapIds`에 있으면 노드 생성 대신 `showToast(t("library.alreadyLinked"))` 후 반환.

- [ ] **Step 5: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Playwright 실기동**

`pw-verify-link-unique.mjs`: 맵에 서브프로세스 링크 1개 생성→라이브러리 패널 열기→해당 맵 행이 비활성(opacity·not-draggable)+"Already linked" 툴팁. 맵 드롭다운 "링크노드로 추가"로 같은 맵 재시도→토스트. 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-link-unique.mjs`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/process-library-panel.tsx frontend/src/app/maps/[mapId]/page.tsx frontend/src/lib/i18n-messages.ts frontend/scripts/pw-verify-link-unique.mjs
git commit -m "feat(subprocess): disable already-linked maps in picker + block re-add — 링크된 맵 목록 자동 비활성"
```

---

# 기능 3 — 서브프로세스 설명 필드 + 등록 알림

### Task 3.1: 백엔드 — `sp_description` 컬럼 + 스키마 + upsert

**Files:**
- Modify: `backend/app/models.py`(`sp_*` 블록 `:92-113`), `backend/app/db.py`(`_ADDED_COLUMNS` `:16`), `backend/app/schemas.py`(`SubprocessDesignationIn` `:48-91`, `MapOut` `:546-559`, `SubprocessRefOut` `:688-708`), `backend/app/routers/maps.py`(`designate_subprocess` `:542-581`)
- Test: `backend/tests/test_maps.py` (또는 test_subprocess)

**Interfaces:**
- Produces: 지정 API가 `description`을 왕복 저장/응답.

- [ ] **Step 1: Write the failing test**

```python
def test_subprocess_designation_roundtrips_description(client, published_map_owned):
    map_id = published_map_owned
    body = {"department": "D", "description": "설명 텍스트"}
    r = client.put(f"/api/maps/{map_id}/subprocess-designation", json=body)
    assert r.status_code == 200
    assert client.get(f"/api/maps/{map_id}").json()["sp_description"] == "설명 텍스트"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -k roundtrips_description`
Expected: FAIL — no `sp_description`.

- [ ] **Step 3: Write minimal implementation**
- `models.py` `ProcessMap`에 `sp_description: Mapped[str | None] = mapped_column(Text, nullable=True)` 추가(`sp_*` 인접).
- `db.py` `_ADDED_COLUMNS`에 `("process_maps", "sp_description", "TEXT")`(형식은 기존 sp_ 엔트리에 맞춤) 등록.
- `schemas.py` `SubprocessDesignationIn`에 `description: str = ""`(trim 정규화 validator에 포함), `MapOut`·`SubprocessRefOut`에 `sp_description: str | None = None`.
- `maps.py` `designate_subprocess` upsert에 `found_map.sp_description = payload.description or None`.

- [ ] **Step 4: Run test to verify it passes**

Run: (Step 2 명령) PASS → 전체 `pytest tests/ -q` PASS + `ruff check app/ tests/` clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/db.py backend/app/schemas.py backend/app/routers/maps.py backend/tests/test_maps.py
git commit -m "feat(subprocess): add sp_description to designation — 서브프로세스 지정 설명 필드(자동 ALTER)"
```

---

### Task 3.2: 백엔드 — 최초 지정 시 등록 알림

**Files:**
- Modify: `backend/app/routers/maps.py`(`designate_subprocess` `:542-581`, commit `:579`)
- Test: `backend/tests/test_maps.py`

**Interfaces:**
- Consumes: `create_notifications`(`workflow.py:45-81`), `load_active_approvers`(`workflow.py:84-96`), `found_map.owner_id`.
- Produces: type `subprocess_registered` 알림(수신자=오너+승인자, actor 제외), **최초 지정 전이 시에만**.

- [ ] **Step 1: Write the failing test**

```python
async def test_first_designation_notifies_owner_and_approvers(client, ...):
    # owner=U_owner, approver=U_appr, actor=sysadmin이 지정
    # 최초 지정 → U_owner, U_appr에 subprocess_registered 알림 1건씩
    # 재지정(속성 편집) → 추가 알림 없음
    ...
    rows = notifications_for(["U_owner", "U_appr"], type="subprocess_registered")
    assert len(rows) == 2
    # 재지정 후 개수 불변
```
(기존 알림 테스트 패턴(test_versions/test_checkout)·conftest 승인자 시드 참고. actor가 오너면 오너는 제외되는 케이스도 확인.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q -k first_designation_notifies`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation** (`designate_subprocess`, `sp_designated_at is None` 최초 분기 `:566`)

```python
was_new = found_map.sp_designated_at is None
# ... upsert, sp_designated_at 설정 ...
if was_new:
    approvers = await workflow.load_active_approvers(session, map_id)
    recipients = [r for r in dict.fromkeys([found_map.owner_id, *approvers]) if r and r != current_user.login_id]
    if recipients:
        await workflow.create_notifications(
            session, recipients, type="subprocess_registered",
            map_id=map_id, message=f"'{found_map.name}'이(가) 서브프로세스로 등록되었습니다",
        )
# 기존 commit(:579)에서 함께 반영
```

- [ ] **Step 4: Run test to verify it passes**

Run: (Step 2 명령) PASS → 전체 `pytest tests/ -q` PASS + ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/maps.py backend/tests/test_maps.py
git commit -m "feat(subprocess): notify owner+approvers on first designation — 최초 서브프로세스 등록 알림"
```

---

### Task 3.3: FE — `sp_description` 3표면 + 알림 카테고리

**Files:**
- Modify: `frontend/src/lib/api.ts`(`MapSummary` `:35-71`, `SubprocessDesignationBody` `:289-300`, `SubprocessRef` `:137-149`)
- Modify: `frontend/src/components/permissions/subprocess-designation-modal.tsx`(`DesignationForm` `:19-29`)
- Modify: `frontend/src/components/subprocess-inspector-card.tsx`(`attrRows` `:105-113`)
- Modify: `frontend/src/components/permissions/subprocess-designation-panel.tsx`(`:34-44,92-102,127-135`)
- Modify: `frontend/src/lib/notification-categories.ts`(`:12-25`), `frontend/src/app/inbox/page.tsx`(`CATEGORY_ICONS`), `frontend/src/lib/i18n-messages.ts`(`inbox.cat.subprocess`, 설명 라벨)
- Verify: `frontend/scripts/pw-verify-sp-description.mjs`

**Interfaces:**
- Consumes: Task 3.1 응답의 `sp_description`.

- [ ] **Step 1: api.ts 타입 확장**

`MapSummary`·`SubprocessDesignationBody`·`SubprocessRef`에 `sp_description?: string | null` / `description?: string` 추가(각 타입의 sp_ 필드 명명 규칙에 맞춤).

- [ ] **Step 2: 지정 모달 입력**

`subprocess-designation-modal.tsx` `DesignationForm`에 `description` 필드 추가 + 멀티라인 `<textarea>`(디자인 토큰, `text-caption`). 저장 payload에 포함.

- [ ] **Step 3: 인스펙터 카드 표시**

`subprocess-inspector-card.tsx` `attrRows`(`:105-113`)에 설명 행 추가(값 있을 때만, 빈 값이면 생략).

- [ ] **Step 4: 설정 패널 동기화**

`subprocess-designation-panel.tsx`의 필드 목록(`:34-44,92-102,127-135`)에 `description`을 modal과 동일하게 반영(3표면 드리프트 방지).

- [ ] **Step 5: 알림 카테고리 + 아이콘 + i18n**

`notification-categories.ts:12-25`에 `subprocess_registered → "subprocess"` 매핑 추가(신규 카테고리). `inbox/page.tsx` `CATEGORY_ICONS`에 Lucide 아이콘(예: `Network`) 추가, `NOTIFICATION_CATEGORIES`에 `subprocess` 포함. i18n `inbox.cat.subprocess`(en "Subprocess" / ko "서브프로세스") + 설명 라벨 키 추가.

- [ ] **Step 6: 빌드/린트/타입 확인**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Playwright 실기동**

`pw-verify-sp-description.mjs`: 지정 모달에서 설명 입력·저장→인스펙터 카드/설정 패널에 설명 표시. inbox에서 subprocess 카테고리 필터로 등록 알림 노출. 콘솔 에러 0.
Run: `node frontend/scripts/pw-verify-sp-description.mjs`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/components/permissions/subprocess-designation-modal.tsx frontend/src/components/subprocess-inspector-card.tsx frontend/src/components/permissions/subprocess-designation-panel.tsx frontend/src/lib/notification-categories.ts frontend/src/app/inbox/page.tsx frontend/src/lib/i18n-messages.ts frontend/scripts/pw-verify-sp-description.mjs
git commit -m "feat(subprocess): sp_description across 3 surfaces + inbox subprocess category — 설명 3표면·알림 카테고리"
```

---

## 최종 게이트 (전체 완료 후)

- [ ] 백엔드: `AI_ENABLED=false DEV_ENFORCE_PERMISSIONS=false BPM_SYSADMINS="" .venv/bin/python -m pytest tests/ -q` 그린 + `ruff check app/ tests/` clean.
- [ ] 프론트: `npm run lint` 0 err · `npx tsc --noEmit` 0 · `npm test`(vitest) 그린 · `npm run build` OK.
- [ ] Playwright 실기동 스크립트 6종 전부 PASS(서버/원격 IP 또는 dev 프로파일, 콘솔 에러 0).
- [ ] `PROGRESS.md`에 완료 항목 갱신(코드와 같은 커밋 계열).
- [ ] 배포 시 `sp_description` 자동 ALTER 보강 확인.

## Self-Review 결과

- **Spec coverage:** 기능 1(Task 1.1–1.4)·2(2.1–2.2)·3(3.1–3.3)·4(4.1–4.2)·5(5.1–5.2) 전부 태스크 매핑 완료. 잔상/`+`배지(1.4)·크로스탭(1.2/1.3)·초성검색(5.1)·백엔드 가드(2.1)·알림 카테고리(3.3) 포함.
- **Placeholder scan:** 순수 헬퍼·테스트는 완전 코드. page.tsx/백엔드 대형 파일 편집은 정확한 앵커(파일:라인) + 대표 코드 스니펫 제공(서브에이전트가 실제 파일을 읽어 배선). 백엔드 픽스처는 기존 test 패턴 참조로 명시(자유 텍스트 아님).
- **Type consistency:** `constrainToAxis`·`isCopyableNodeType`·`makeCopyLabel`·`buildPaste`/`NodeClipboard`·`linkedMapIds:Set<number>`·`sp_description` 명칭을 태스크 간 일관 사용.
