# 노드 인터랙션 개편 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 창을 마우스 위치에서 확장 애니메이션으로 열고, 드릴인을 노드 호버 버튼으로 옮기고, 더블클릭을 "다음 클릭 노드와 엣지 연결" 모드로 바꾼다.

**Architecture:** 노드→page 통신은 신규 `NodeActionsContext`(기본값 no-op — Provider 없는 compare 페이지 안전). `ProcessNode`는 호버 시 우상단 드릴 버튼(onDrill 있을 때만). page는 Provider로 감싸고 드릴 시 버튼 클릭 좌표로 새 창을 마우스 중앙 배치 + `window-open` 확장 애니메이션. 더블클릭→`connectSource` 무장, 다음 노드 클릭→엣지 생성(one-shot), Esc/빈곳/포커스전환 취소.

**Tech Stack:** Next 16.2.9, React 19.2.4, @xyflow/react 12, Tailwind 4(토큰), lucide-react. 테스트 러너 없음 → `npx tsc --noEmit` + `npm run lint` + `npm run build` + 수동 검증.

**작업 디렉터리:** `frontend/` (git은 repo root `git -C /Users/hyeonjin/Documents/bpm`). 커밋마다 둘째 `-m`로 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**디자인 룰:** 떠있는 작은 버튼/창은 `shadow` 허용(rules/frontend/design.md §2). 색·아이콘 토큰/Lucide.

---

## File Structure
신규: `frontend/src/lib/node-actions.ts` (context).
수정: `frontend/src/lib/i18n-messages.ts`(connect.banner), `frontend/src/components/process-node.tsx`(드릴 버튼+소스 링), `frontend/src/components/scope-window.tsx`(window-open), `frontend/src/app/globals.css`(window-open keyframe), `frontend/src/app/maps/[mapId]/page.tsx`(Provider·드릴 좌표·연결 모드·배너).

---

## Task 1: NodeActionsContext + i18n 키

**Files:**
- Create: `frontend/src/lib/node-actions.ts`
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1: node-actions.ts 작성**
기본값 no-op으로 — Provider 없는 곳(compare 페이지)에서도 안전. throw 하지 않는다.
```ts
// 노드(ProcessNode)→에디터 통신 — 드릴 트리거·연결 소스. Provider 없으면 no-op(compare 안전).
"use client";

import { createContext, useContext } from "react";

export interface NodeActions {
  onDrill: ((nodeId: string, clientX: number, clientY: number) => void) | null;
  connectSource: string | null;
}

const defaultActions: NodeActions = { onDrill: null, connectSource: null };

export const NodeActionsContext = createContext<NodeActions>(defaultActions);

export function useNodeActions(): NodeActions {
  return useContext(NodeActionsContext);
}
```

- [ ] **Step 2: i18n 키 추가**
`frontend/src/lib/i18n-messages.ts`의 `en`과 `ko` 양쪽에 `window.*` 키 블록 뒤에 추가:
en:
```ts
  "connect.banner": "Connecting from {name} — click a target (Esc to cancel)",
```
ko:
```ts
  "connect.banner": "{name}에서 연결 — 대상 노드를 클릭 (Esc 취소)",
```

- [ ] **Step 3: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint`
Expected: PASS (en/ko 키 대칭 — tsc가 누락 검출).

- [ ] **Step 4: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/lib/node-actions.ts frontend/src/lib/i18n-messages.ts
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(nodes): NodeActions context + connect banner i18n — 노드 액션 컨텍스트" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 2: ProcessNode — 호버 드릴 버튼 + 소스 링

**Files:**
- Modify: `frontend/src/components/process-node.tsx`

현재 구조(참고): `export function ProcessNode({ data, selected }: NodeProps<AppNode>)`, decision 분기는 root `<div className="relative flex h-24 w-24 ...">`, 일반 분기는 root `<div className="relative bg-surface px-3 py-2 text-sm ...">`. `ring` 변수는 diff > selected 우선.

- [ ] **Step 1: import + 시그니처 + context**
- import 추가: `import { SquareArrowOutUpRight } from "lucide-react";`(기존 lucide import 라인에 병합) 및 `import { useNodeActions } from "@/lib/node-actions";`
- 시그니처에 `id` 추가: `export function ProcessNode({ id, data, selected }: NodeProps<AppNode>) {`
- 함수 상단에 `const { onDrill, connectSource } = useNodeActions();`
- `ring` 계산에 연결 소스 우선 반영:
```ts
  const ring =
    connectSource === id
      ? "ring-2 ring-accent"
      : data.diffStatus
        ? DIFF_RINGS[data.diffStatus]
        : selected
          ? "ring-2 ring-accent"
          : "";
```

- [ ] **Step 2: 드릴 버튼 컴포넌트(파일 내 작은 헬퍼) 추가**
`ProcessNode` 위에 작은 내부 컴포넌트 추가(중복 회피):
```tsx
// 호버 시 노드 우상단에 뜨는 드릴(하위 진입) 버튼 — onDrill 있을 때만(compare 등에서는 숨김)
function DrillButton({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const { onDrill } = useNodeActions();
  if (!onDrill) {
    return null;
  }
  return (
    <button
      type="button"
      title={t("node.openChildTitle")}
      className="absolute -right-2 -top-2 z-10 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary opacity-0 shadow-sm hover:bg-surface-alt group-hover:opacity-100"
      onClick={(event) => {
        event.stopPropagation();
        onDrill(nodeId, event.clientX, event.clientY);
      }}
    >
      <SquareArrowOutUpRight size={14} strokeWidth={1.5} />
    </button>
  );
}
```

- [ ] **Step 3: 두 노드 분기에 `group` + `<DrillButton>` 추가**
- decision 분기 root div: className 앞에 `group ` 추가 → `className="group relative flex h-24 w-24 items-center justify-center"`. `<Handle type="source" ... />` 바로 위(또는 badge들 곁)에 `<DrillButton nodeId={id} />` 추가.
- 일반 분기 root div: className에 `group ` 추가 → `` className={`group relative bg-surface px-3 py-2 text-sm ${ring} ${...}`} ``. 마찬가지로 `<DrillButton nodeId={id} />` 추가(닫는 `</div>` 전, source Handle 곁).

- [ ] **Step 4: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. (compare 페이지는 Provider가 없어 `onDrill=null` → 버튼 미표시·크래시 없음. 빌드로 확인.)

- [ ] **Step 5: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/components/process-node.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(nodes): hover drill button + connect-source ring — 호버 드릴 버튼" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 3: window-open 확장 애니메이션

**Files:**
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/scope-window.tsx`

- [ ] **Step 1: globals.css — window-open 추가, 기존 drill 제거**
`globals.css`에서 기존 `@keyframes drill-in-open`과 `.drill-canvas` 블록을 아래로 **교체**(reduced-motion 가드 포함):
```css
/* 창 열림 — 마우스 지점(창 중앙)에서 확장되며 열리는 연출 */
@keyframes window-open {
  from {
    opacity: 0;
    transform: scale(0.4);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.window-open {
  transform-origin: center;
  animation: window-open 180ms var(--ease-overshoot);
}

@media (prefers-reduced-motion: reduce) {
  .window-open {
    animation: none;
  }
}
```
(기존 `drill-in-open`/`.drill-canvas`/그 reduced-motion 블록은 삭제. page.tsx의 `drill-canvas` className은 Task 4에서 제거하므로, 이 시점엔 일시적으로 page에 매칭 안 되는 className이 남지만 무해.)

- [ ] **Step 2: scope-window.tsx 루트에 window-open 클래스**
`ScopeWindow` 루트 `<div>`의 className 문자열에 `window-open`을 추가(마운트 1회 재생). 현재:
```tsx
    <div
      className={`absolute flex flex-col overflow-hidden rounded-sm border bg-surface shadow ${
        active ? "border-hairline" : "border-divider"
      }`}
```
→ `window-open`을 앞에 추가:
```tsx
    <div
      className={`window-open absolute flex flex-col overflow-hidden rounded-sm border bg-surface shadow ${
        active ? "border-hairline" : "border-divider"
      }`}
```

- [ ] **Step 3: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 4: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add frontend/src/app/globals.css frontend/src/components/scope-window.tsx
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(windows): expand-from-center open animation — 창 확장 애니메이션" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Task 4: page.tsx — Provider · 마우스 위치 드릴 · 연결 모드 · 배너

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

READ the file first. Anchors: keydown effect (~383-414), `handleDrillIn` (~696), ReactFlow handlers `onNodeClick`/`onNodeDoubleClick`/`onPaneClick` (~1334-1347), active child wrapper `<div className="drill-canvas h-full w-full">` (~1324), header right cluster (status/save area), outer return `<div className="flex h-full flex-col">`.

- [ ] **Step 1: import + 상태**
imports 추가:
```ts
import { Spline, SquareArrowOutUpRight } from "lucide-react"; // 기존 lucide import 라인에 병합(중복 주의)
import { NodeActionsContext } from "@/lib/node-actions";
```
(SquareArrowOutUpRight는 배너/표시에 안 쓰면 생략 — 실제 사용하는 아이콘만 import. Spline은 배너용.)
`connectSource` 상태 추가(다른 useState 곁):
```ts
  const [connectSource, setConnectSource] = useState<string | null>(null);
```

- [ ] **Step 2: handleDrillIn에 좌표 + 마우스 중앙 배치**
기존 `handleDrillIn`(현재 `(node: AppNode)`)을 좌표 인자 포함으로 교체:
```ts
  const handleDrillIn = useCallback(
    (node: AppNode, clientX: number, clientY: number) => {
      const childKey = node.id;
      if (!windowGeom[childKey]) {
        const w2 = Math.min(Math.min(760, Math.round(bounds.w * 0.82)), bounds.w);
        const h2 = Math.min(Math.min(500, Math.round(bounds.h * 0.82)), bounds.h);
        let cx = bounds.w / 2;
        let cy = bounds.h / 2;
        const el = canvasContainerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          cx = clientX - rect.left;
          cy = clientY - rect.top;
        }
        const x = Math.min(Math.max(cx - w2 / 2, 0), Math.max(0, bounds.w - w2));
        const y = Math.min(Math.max(cy - h2 / 2, 0), Math.max(0, bounds.h - h2));
        setWindowGeom((m) => ({
          ...m,
          [childKey]: { x, y, w: w2, h: h2, minimized: false, maximized: false },
        }));
      }
      void navigateTo([
        ...scopes.slice(0, activeIndex + 1),
        { parentId: node.id, title: node.data.label },
      ]);
    },
    [windowGeom, bounds, navigateTo, scopes, activeIndex],
  );
```
드릴 어댑터(노드 id→노드 조회) 추가(handleDrillIn 아래):
```ts
  const handleDrillById = useCallback(
    (nodeId: string, clientX: number, clientY: number) => {
      const node = nodesRef.current.find((item) => item.id === nodeId);
      if (node) {
        handleDrillIn(node, clientX, clientY);
      }
    },
    [handleDrillIn],
  );
```

- [ ] **Step 3: 연결 완료 헬퍼**
```ts
  // 연결 모드 완료 — connectSource→target 엣지 생성(one-shot)
  const completeConnect = useCallback(
    (targetId: string) => {
      if (!connectSource || connectSource === targetId) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        addEdge({ source: connectSource, target: targetId, id: crypto.randomUUID() }, current),
      );
      scheduleAutoSave();
      setConnectSource(null);
    },
    [connectSource, pushHistory, setEdges, scheduleAutoSave],
  );
```

- [ ] **Step 4: focusScope에서 연결 취소**
`focusScope`의 본문 맨 앞(또는 setActiveIndex 전)에 `setConnectSource(null);` 추가 — 스코프 이동 시 연결 모드 종료.

- [ ] **Step 5: Esc 취소 (keydown effect)**
keydown effect의 입력 필드 가드(`["INPUT","TEXTAREA","SELECT"]` 블록) 바로 다음, ctrl/meta 가드 전에 추가:
```ts
      if (event.key === "Escape") {
        setConnectSource(null);
        return;
      }
```
(이 effect deps는 [undo, redo] 유지 — setConnectSource는 안정 setter.)

- [ ] **Step 6: ReactFlow 핸들러 3개 교체**
- `onNodeDoubleClick`:
```tsx
                      onNodeDoubleClick={(_, node) => {
                        if (readOnly) {
                          return;
                        }
                        setConnectSource(node.id);
                      }}
```
- `onNodeClick`:
```tsx
                      onNodeClick={(_, node) => {
                        if (connectSource && connectSource !== node.id) {
                          completeConnect(node.id);
                          return;
                        }
                        setSelectedId(node.id);
                        setSelectedEdgeId(null);
                      }}
```
- `onPaneClick`(연결 취소 추가):
```tsx
                      onPaneClick={() => {
                        setConnectSource(null);
                        setSelectedId(null);
                        setSelectedEdgeId(null);
                        setMenu(null);
                      }}
```

- [ ] **Step 7: 활성 child wrapper에서 drill-canvas 제거**
`<div className="drill-canvas h-full w-full">` → `<div className="h-full w-full">` (애니메이션은 ScopeWindow의 window-open으로 이동했으므로).

- [ ] **Step 8: 연결 배너**
헤더 우측 상태 영역(저장 상태 표시 곁, 예: `{status && ...}` 근처)에 배너 추가:
```tsx
          {connectSource && (
            <span className="inline-flex items-center gap-1 rounded-sm bg-accent/10 px-2 py-1 text-caption text-accent">
              <Spline size={14} strokeWidth={1.5} />
              {t("connect.banner", {
                name: nodes.find((node) => node.id === connectSource)?.data.label ?? "",
              })}
            </span>
          )}
```

- [ ] **Step 9: NodeActionsContext.Provider로 감싸기**
컴포넌트 `return (` 직후 최상위 `<div className="flex h-full flex-col">`를 Provider로 감싼다. value는 useMemo:
```ts
  const nodeActions = useMemo(
    () => ({ onDrill: handleDrillById, connectSource }),
    [handleDrillById, connectSource],
  );
```
return:
```tsx
  return (
    <NodeActionsContext.Provider value={nodeActions}>
      <div className="flex h-full flex-col">
        ... 기존 내용 ...
      </div>
    </NodeActionsContext.Provider>
  );
```

- [ ] **Step 10: 검증**
Run(frontend/): `npx tsc --noEmit && npm run lint && npm run build`
Expected: PASS. exhaustive-deps: `onNodeClick`는 인라인이라 deps 영향 없음(ReactFlow prop). `completeConnect`/`handleDrillById`/`nodeActions` deps 확인. 미사용 import(Spline/SquareArrowOutUpRight 중 안 쓰는 것) 정리.
ReactFlow 나머지 props(onConnect/onEdgeClick/onPaneContextMenu/onNode·Edge·Selection 핸들러/onBeforeDelete/onMoveStart/selectionOnDrag/panOnDrag/panActivationKeyCode/fitView + Background/Controls)는 변경 없이 유지 확인.

- [ ] **Step 11: 커밋**
```
git -C /Users/hyeonjin/Documents/bpm add "frontend/src/app/maps/[mapId]/page.tsx"
git -C /Users/hyeonjin/Documents/bpm commit -m "feat(editor): mouse-pos drill + dbl-click connect mode + banner — 마우스 드릴·연결 모드" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 최종 검증
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build` PASS.
- [ ] PROGRESS.md 갱신 후 커밋.
- [ ] 사용자 수동 체크리스트:
  1. 노드 호버 → 우상단 버튼 표시 → 클릭하면 그 지점(마우스)에서 자식 창이 확장되며 열림(창 중앙=클릭 지점).
  2. 이미 옮겨둔(저장된) 자식 창은 그 위치에서 열림(애니메이션만).
  3. 노드 더블클릭 → 상단 "Connecting from X" 배너 + 소스 노드 강조 링 → 다른 노드 클릭 → A→B 엣지 생성·배너 종료.
  4. 더블클릭 후 Esc / 빈 곳 클릭 / 다른 창 포커스 → 연결 취소.
  5. 기존 핸들 드래그 연결·박스선택·팬·이동/리사이즈·undo/redo 정상.
  6. compare 화면 정상(드릴 버튼 미표시, 크래시 없음).

---

## Self-Review (작성자 점검)
- **스펙 커버리지:** ①마우스 위치+애니메이션=Task3(window-open)+Task4 Step2; ②호버 버튼=Task1(context)+Task2; ③연결 모드=Task4 Step3·5·6·8. 전 항목 매핑.
- **스펙 이탈(개선):** `useNodeActions`를 throw 대신 기본값 no-op으로 — `ProcessNode`가 compare 페이지(Provider 없음)에서도 렌더되므로 throw면 크래시. 드릴 버튼은 `onDrill` 있을 때만 표시. 스펙보다 안전.
- **플레이스홀더:** 없음. 신규 파일 전체 코드, page는 정확한 앵커+코드. ReactFlow 나머지 props는 "변경 없이 유지" 명시.
- **타입 일관성:** `NodeActions`(onDrill nullable, connectSource), `handleDrillIn(node,x,y)`/`handleDrillById(id,x,y)`/`completeConnect(targetId)`/`connectSource`/`nodeActions` 명칭 일치. `connect.banner` 키 en/ko.
- **위험:** ① 드릴 버튼 `stopPropagation` 누락 시 버튼 클릭이 더블클릭(연결) 트리거 — Task2에 명시. ② Spline/SquareArrowOutUpRight 미사용 import lint — Task4 Step10에서 정리. ③ window-open이 모든 창 마운트 시 재생(루트 포함) — 의도(드릴/재오픈), 수용.
