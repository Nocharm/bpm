# 노드 인터랙션 개편 설계 (마우스 위치 창 열림 · 호버 드릴 버튼 · 더블클릭 연결)

작성일: 2026-06-13
대상: `frontend/` (순수 프론트엔드 — 백엔드 변경 0)

## 배경 / 목표

OS형 자유 창 위에 노드 인터랙션을 개편한다:
1. 새 창이 **현재 마우스 위치에서 확장되며 열리는** 연출(창 중앙 = 마우스 지점).
2. 드릴인(하위 진입) 트리거를 더블클릭에서 **노드 호버 시 나타나는 버튼**으로 이동.
3. 더블클릭은 **연결 모드** — 더블클릭한 노드와 다음 클릭한 노드를 엣지로 연결.

## 확정 결정 (브레인스토밍)
- **연결 모드**: 한 번 연결 후 종료(one-shot). 취소는 Esc / 빈 곳 클릭 / 창 포커스 전환.
- **창 열림 위치**: 새 창(저장된 geom 없음)만 마우스 중앙으로, 저장된 창은 위치 유지. 애니메이션은 항상 창 중앙에서 확장.
- **드릴 버튼**: 노드 우상단 작은 아이콘.

## 비범위
- 백엔드/API 변경 없음.
- 기존 핸들 드래그 연결(`onConnect`)·박스선택·팬·undo/redo·체크아웃·검색은 그대로(연결 모드는 추가 경로).
- 창 이동/리사이즈/최소·최대·닫기/영속(직전 기능)은 변경 없음.

---

## ① 노드↔page 통신 — `frontend/src/lib/node-actions.ts` (신규)

ReactFlow 커스텀 노드(`ProcessNode`)가 page의 핸들러를 호출하도록 React context로 전달(노드 `data`에 콜백 주입 회피).
```ts
import { createContext, useContext } from "react";

export interface NodeActions {
  onDrill: (nodeId: string, clientX: number, clientY: number) => void;
  connectSource: string | null; // 연결 모드 소스 노드 id(강조용)
}

export const NodeActionsContext = createContext<NodeActions | null>(null);

export function useNodeActions(): NodeActions {
  const ctx = useContext(NodeActionsContext);
  if (!ctx) {
    throw new Error("useNodeActions must be used within NodeActionsContext");
  }
  return ctx;
}
```
page.tsx가 ReactFlow를 포함한 영역을 `<NodeActionsContext.Provider value={{ onDrill, connectSource }}>`로 감싼다.

## ② ProcessNode — 호버 드릴 버튼 + 소스 링

`frontend/src/components/process-node.tsx`:
- `ProcessNode({ id, data, selected })` — `NodeProps`의 `id` 사용.
- `const { onDrill, connectSource } = useNodeActions();`
- 노드 루트 컨테이너에 `group` 클래스. 우상단에 hover 시 나타나는 버튼:
  ```tsx
  <button
    type="button"
    title={t("node.openChildTitle")}
    className="absolute -right-2 -top-2 rounded-xs border border-hairline bg-surface p-0.5 text-ink-secondary opacity-0 shadow-sm hover:bg-surface-alt group-hover:opacity-100"
    onClick={(e) => { e.stopPropagation(); onDrill(id, e.clientX, e.clientY); }}
  >
    <SquareArrowOutUpRight size={14} strokeWidth={1.5} />
  </button>
  ```
  (떠있는 작은 버튼이므로 `shadow-sm` 허용 — 룰 §2 오버레이성. 위치는 기존 뱃지와 겹치지 않게 우상단 안쪽으로 조정 가능.)
- 연결 소스 강조: `connectSource === id` 이면 노드에 `ring-2 ring-accent`(기존 diff/선택 링보다 우선 또는 병행 — 구현 시 ring 우선순위 정리).
- import: `import { SquareArrowOutUpRight } from "lucide-react";` + 기존 아이콘 유지.

주의: 두 노드 모양 분기(마름모/일반)에 각각 `group` + 버튼을 둔다. 버튼은 `stopPropagation`으로 노드 클릭/더블클릭과 분리.

## ③ page.tsx — 드릴(마우스 위치) + 연결 모드

### 상태
```ts
  const [connectSource, setConnectSource] = useState<string | null>(null);
```

### handleDrillIn(node, clientX, clientY) — 마우스 중앙 + 애니메이션
기존 `handleDrillIn(node)`를 좌표 인자 추가로 변경. 자식 scopeKey = `node.id`. 저장된 geom 없을 때만 마우스 중앙 배치:
```ts
  const handleDrillIn = useCallback(
    (node: AppNode, clientX: number, clientY: number) => {
      const childKey = node.id;
      if (!windowGeom[childKey]) {
        const w = Math.min(760, Math.round(bounds.w * 0.82));
        const h = Math.min(500, Math.round(bounds.h * 0.82));
        let cx = bounds.w / 2;
        let cy = bounds.h / 2;
        const el = canvasContainerRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          cx = clientX - rect.left;
          cy = clientY - rect.top;
        }
        const w2 = Math.min(w, bounds.w);
        const h2 = Math.min(h, bounds.h);
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
Provider 어댑터: `onDrill = (id, x, y) => { const n = nodesRef.current.find((nd) => nd.id === id); if (n) handleDrillIn(n, x, y); }` (useCallback, deps [handleDrillIn]).

### 연결 모드
- ReactFlow `onNodeDoubleClick`:
  ```ts
  onNodeDoubleClick={(_, node) => {
    if (readOnly) return;
    setConnectSource(node.id);
  }}
  ```
- `onNodeClick`:
  ```ts
  onNodeClick={(_, node) => {
    if (connectSource && connectSource !== node.id) {
      pushHistory();
      setEdges((cur) => addEdge({ source: connectSource, target: node.id, id: crypto.randomUUID() }, cur));
      scheduleAutoSave();
      setConnectSource(null);
      return;
    }
    setSelectedId(node.id);
    setSelectedEdgeId(null);
  }}
  ```
  (deps에 connectSource, pushHistory, setEdges, scheduleAutoSave 등 추가.)
- `onPaneClick`: 기존 동작 + `setConnectSource(null)`.
- Esc 취소: 기존 keydown effect 또는 작은 effect에 `if (event.key === "Escape") setConnectSource(null)` 추가(입력 필드 포커스 가드 유지).
- 포커스 전환(focusScope) 시작에 `setConnectSource(null)` 추가(다른 스코프로 가면 연결 취소).

### 연결 배너
`connectSource`가 있을 때 헤더(또는 캔버스 상단)에 배너:
```tsx
{connectSource && (
  <span className="flex items-center gap-1 rounded-sm bg-accent/10 px-2 py-1 text-caption text-accent">
    <Spline size={14} strokeWidth={1.5} />
    {t("connect.banner", { name: nodes.find((n) => n.id === connectSource)?.data.label ?? "" })}
  </span>
)}
```
import: `Spline`(lucide).

### Provider
`return` 최상위(또는 ReactFlow 포함 영역)를 `<NodeActionsContext.Provider value={...}>`로 감싼다. value는 `useMemo`로 `{ onDrill, connectSource }`.

## ④ ScopeWindow — 마운트 시 확장 애니메이션

`frontend/src/components/scope-window.tsx`:
- 루트 div className에 `window-open` 추가(마운트 1회 재생). 기존 page의 활성 child 래퍼 `drill-canvas` 클래스는 제거(중복 애니메이션 방지) — 래퍼는 `h-full w-full`만.

## ⑤ globals.css — window-open 키프레임

기존 `drill-in-open`/`.drill-canvas`를 대체(또는 병행 제거)하고:
```css
@keyframes window-open {
  from { opacity: 0; transform: scale(0.4); }
  to   { opacity: 1; transform: scale(1); }
}
.window-open {
  transform-origin: center;
  animation: window-open 180ms var(--ease-overshoot);
}
@media (prefers-reduced-motion: reduce) {
  .window-open { animation: none; }
}
```
(page.tsx의 `drill-canvas` 사용처가 사라지면 `.drill-canvas`/`drill-in-open`은 제거.)

## ⑥ i18n 키 (i18n-messages.ts, en/ko 양쪽)
```
"connect.banner": "Connecting from {name} — click a target (Esc to cancel)"  /  "{name}에서 연결 — 대상 노드를 클릭 (Esc 취소)"
```
(드릴 버튼 title은 기존 `node.openChildTitle` 재사용.)

---

## 영향 파일 요약
신규: `frontend/src/lib/node-actions.ts`
수정: `frontend/src/components/process-node.tsx`, `frontend/src/app/maps/[mapId]/page.tsx`, `frontend/src/components/scope-window.tsx`, `frontend/src/app/globals.css`, `frontend/src/lib/i18n-messages.ts`

## 검증
- 태스크별 `tsc`/`lint`/`build`.
- 수동(원격 사용자): 노드 호버 시 우상단 버튼 → 클릭하면 마우스 지점에서 창이 확장되며 열림. 더블클릭 → 배너 표시 → 다른 노드 클릭 → 엣지 생성·배너 종료. Esc/빈 곳 클릭으로 취소. 기존 핸들 드래그 연결·이동/리사이즈 정상.

## 구현 주의
- 호버 버튼은 `stopPropagation`으로 노드 click/dblclick과 분리 — 안 그러면 버튼 클릭이 더블클릭 연결을 트리거.
- 연결 모드 중 노드 클릭은 사이드바 선택 대신 연결 — 사용자가 혼동하지 않게 배너/커서로 모드 표시.
- 떠있는 작은 버튼·창은 shadow 허용(룰 §2). 색·아이콘 토큰 준수.
- `onDrill`/`connectSource`는 `useMemo`로 묶어 Provider value 안정화(불필요 리렌더 완화).
