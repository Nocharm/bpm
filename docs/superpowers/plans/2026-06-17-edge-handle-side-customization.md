# Edge Handle Side Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엣지마다 시작(source)·끝(target) 핸들이 노드의 어느 변(상/하/좌/우)에 붙는지 커스텀할 수 있게 한다.

**Architecture:** 핸들 변은 엣지 속성(`source_side`/`target_side`)으로 백엔드에 영속. 노드는 4변 각각에 source·target 핸들(총 8개)을 렌더하고, 엣지는 ReactFlow 네이티브 `sourceHandle`/`targetHandle`(`s-{side}`/`t-{side}`)로 해당 핸들에 연결. 엣지 우클릭 시 십자 패드 2개로 변을 즉시 변경(메뉴 유지). diff는 엣지를 source→target 계보로만 비교하므로 변은 자연히 비교 제외(무변경).

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic(backend), Next.js + React + @xyflow/react v12(frontend). 백엔드 테스트 pytest. 프론트는 테스트 러너 없음 → tsc + eslint + `next build` + 수동(서버/원격 IP) 검증.

**Migration:** Edge 컬럼 2개 추가는 `create_all`이 기존 테이블에 반영 못 함 → **1회 drop+recreate**(로컬 sqlite 파일 삭제·재시드, 서버 테이블/볼륨 초기화). 영구 `drop_all` 코드 금지.

---

## File Structure

- `backend/app/models.py` — `Edge`에 `source_side`/`target_side` 컬럼 추가.
- `backend/app/schemas.py` — `EdgeIn`에 동일 필드 추가(저장·로드 라운드트립은 기존 `model_dump()`/`model_validate()`가 처리).
- `backend/tests/test_graph.py` — 변 라운드트립 테스트 추가.
- `frontend/src/lib/canvas.ts` — `HandleSide` 타입·핸들 id/Position 헬퍼(순수함수).
- `frontend/src/lib/api.ts` — `GraphEdge`에 `source_side`/`target_side` 필드.
- `frontend/src/app/maps/[mapId]/page.tsx` — 로드/저장 직렬화, `setEdgeSide` 핸들러, 엣지 메뉴 항목.
- `frontend/src/components/process-node.tsx` — 8핸들 렌더(공용 `NodeHandles`).
- `frontend/src/components/context-menu.tsx` — `pad` 항목 종류 + `CrossPad` 렌더(클릭해도 안 닫힘).
- `frontend/src/app/globals.css` — 핸들 시각 처리(작게/hover 강조).
- `frontend/src/lib/i18n-messages.ts` — 메뉴 라벨 키.

---

## Task 1: Backend — Edge `source_side`/`target_side` 컬럼 + 라운드트립

**Files:**
- Modify: `backend/app/models.py:112-122` (Edge 클래스)
- Modify: `backend/app/schemas.py:100-106` (EdgeIn)
- Test: `backend/tests/test_graph.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_graph.py` 끝에 추가:

```python
def test_edge_handle_side_roundtrips(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "A", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "n2", "title": "B", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [
            {
                "id": "e1",
                "source_node_id": "n1",
                "target_node_id": "n2",
                "label": "",
                "source_side": "top",
                "target_side": "bottom",
            }
        ],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    edge = saved["edges"][0]
    assert edge["source_side"] == "top"
    assert edge["target_side"] == "bottom"


def test_edge_handle_side_defaults(client: TestClient) -> None:
    version_id = _create_version(client)
    graph = {
        "nodes": [
            {"id": "n1", "title": "A", "pos_x": 0, "pos_y": 0, "sort_order": 0},
            {"id": "n2", "title": "B", "pos_x": 200, "pos_y": 0, "sort_order": 1},
        ],
        "edges": [{"id": "e1", "source_node_id": "n1", "target_node_id": "n2"}],
    }

    client.put(f"/api/versions/{version_id}/graph", json=graph)
    saved = client.get(f"/api/versions/{version_id}/graph").json()

    edge = saved["edges"][0]
    assert edge["source_side"] == "right"
    assert edge["target_side"] == "left"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_graph.py::test_edge_handle_side_roundtrips tests/test_graph.py::test_edge_handle_side_defaults -v`
(PowerShell: `.venv\Scripts\python -m pytest tests/test_graph.py::test_edge_handle_side_roundtrips tests/test_graph.py::test_edge_handle_side_defaults -v`)
Expected: FAIL — `KeyError: 'source_side'` (필드 없음).

- [ ] **Step 3: Add columns to Edge model**

`backend/app/models.py`, Edge 클래스의 `label` 줄 아래에 추가:

```python
    label: Mapped[str] = mapped_column(String(200), default="")
    # 엣지 핸들이 붙는 노드 변 — 시각 전용, diff 비교 제외(2026-06-17)
    source_side: Mapped[str] = mapped_column(String(10), default="right")
    target_side: Mapped[str] = mapped_column(String(10), default="left")
```

- [ ] **Step 4: Add fields to EdgeIn schema**

`backend/app/schemas.py`, `EdgeIn`의 `label` 줄 아래에 추가:

```python
    id: str
    source_node_id: str
    target_node_id: str
    label: str = ""
    source_side: str = "right"
    target_side: str = "left"
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && .venv/bin/python -m pytest tests/test_graph.py -v`
Expected: PASS (기존 graph 테스트도 모두 green — `model_dump()`/`model_validate()`가 새 필드 자동 처리).

- [ ] **Step 6: Run full backend suite + lint**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS, lint clean.

- [ ] **Step 7: Commit**

```bash
git add backend/app/models.py backend/app/schemas.py backend/tests/test_graph.py
git commit -m "feat(edge): persist source_side/target_side on edges — 핸들 변 영속

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Frontend — `HandleSide` 타입 + 핸들/Position 헬퍼

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (`import` 영역 + 신규 export)

- [ ] **Step 1: Ensure `Position` is imported**

`frontend/src/lib/canvas.ts` 상단 xyflow import를 확인/수정:

```ts
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
```

(`Position`이 이미 있으면 그대로. 없으면 추가 — `MarkerType`은 기존에 import됨.)

- [ ] **Step 2: Add HandleSide type and helpers**

`makeUniqueLabel` 함수 위(또는 `EDGE_DEFAULTS` 근처)에 추가:

```ts
// 엣지 핸들이 붙는 노드 변 — 엣지의 source/target 각각에 적용(2026-06-17)
export type HandleSide = "left" | "right" | "top" | "bottom";

const SIDE_TO_POSITION: Record<HandleSide, Position> = {
  left: Position.Left,
  right: Position.Right,
  top: Position.Top,
  bottom: Position.Bottom,
};

export function toPosition(side: HandleSide): Position {
  return SIDE_TO_POSITION[side];
}

export function sourceHandleId(side: HandleSide): string {
  return `s-${side}`;
}

export function targetHandleId(side: HandleSide): string {
  return `t-${side}`;
}

const HANDLE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// "s-top"/"t-left" → "top"/"left". 미일치 시 fallback(구 데이터·null 대비).
export function sideFromHandleId(
  id: string | null | undefined,
  fallback: HandleSide,
): HandleSide {
  if (!id) {
    return fallback;
  }
  const side = id.replace(/^[st]-/, "");
  return (HANDLE_SIDES as string[]).includes(side) ? (side as HandleSide) : fallback;
}
```

- [ ] **Step 3: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0 (아직 미사용이라 unused 경고 없음 — export라 OK).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/canvas.ts
git commit -m "feat(edge): HandleSide type + handle-id/Position helpers — 변 헬퍼

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Frontend — `GraphEdge` 타입에 변 필드

**Files:**
- Modify: `frontend/src/lib/api.ts:55-60` (GraphEdge)

- [ ] **Step 1: Add fields to GraphEdge**

```ts
export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  label: string;
  source_side: string;
  target_side: string;
}
```

- [ ] **Step 2: Verify compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: FAIL — `buildGraph`의 edges map이 `source_side`/`target_side` 누락으로 타입 에러(다음 태스크에서 채움). 에러 메시지에 `page.tsx`의 `buildGraph` 위치가 찍히면 정상.

- [ ] **Step 3: Commit (defer until Task 4 compiles)**

이 태스크는 단독으로 컴파일이 깨지므로 Task 4와 함께 커밋한다. 여기서는 커밋하지 않는다.

---

## Task 4: Frontend — 로드/저장 직렬화

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:208-216` (`toAppEdges`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx:248-255` (`buildGraph` edges)

- [ ] **Step 1: Import helpers**

`page.tsx`의 `@/lib/canvas` import 블록(약 44-72행)에 추가:

```ts
  makeUniqueLabel,
  sideFromHandleId,
  sourceHandleId,
  targetHandleId,
  type HandleSide,
  normalizeNodeType,
```

(`makeUniqueLabel`/`normalizeNodeType`는 기존 줄 — 알파벳 순서 맞춰 `sideFromHandleId`/`sourceHandleId`/`targetHandleId`/`type HandleSide` 추가.)

- [ ] **Step 2: Map sides on load (`toAppEdges`)**

```ts
function toAppEdges(graph: Graph): Edge[] {
  return graph.edges.map((edge) => ({
    ...EDGE_DEFAULTS,
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    label: edge.label || undefined,
    sourceHandle: sourceHandleId((edge.source_side as HandleSide) || "right"),
    targetHandle: targetHandleId((edge.target_side as HandleSide) || "left"),
  }));
}
```

- [ ] **Step 3: Map sides on save (`buildGraph`)**

```ts
    edges: edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map<GraphEdge>((edge) => ({
        id: edge.id,
        source_node_id: edge.source,
        target_node_id: edge.target,
        label: typeof edge.label === "string" ? edge.label : "",
        source_side: sideFromHandleId(edge.sourceHandle, "right"),
        target_side: sideFromHandleId(edge.targetHandle, "left"),
      })),
```

- [ ] **Step 4: Verify compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: exit 0 (Task 3 타입 에러 해소).

- [ ] **Step 5: Commit (Task 3 + 4 together)**

```bash
git add frontend/src/lib/api.ts "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(edge): serialize source_side/target_side on graph load/save — 변 직렬화

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend — 노드 8핸들 렌더 + 시각 처리

**Files:**
- Modify: `frontend/src/components/process-node.tsx` (import + 핸들 렌더 2곳)
- Modify: `frontend/src/app/globals.css` (핸들 스타일)

- [ ] **Step 1: Update imports in process-node.tsx**

```ts
import { Handle, type NodeProps, Position } from "@xyflow/react";
import { Fragment, useRef } from "react";
```

그리고 canvas import에 `toPosition`, `type HandleSide` 추가:

```ts
import { type AppNode, type HandleSide, type ProcessNodeType, toPosition } from "@/lib/canvas";
```

(`Position`은 더 이상 직접 안 쓰면 제거 가능하나, 유지해도 무방. unused면 eslint가 잡으니 Step 4에서 확인 후 제거.)

- [ ] **Step 2: Add shared NodeHandles component**

`ProcessNode` 함수 위에 추가:

```tsx
const NODE_SIDES: HandleSide[] = ["left", "right", "top", "bottom"];

// 4변 각각에 source·target 핸들(총 8개) — 엣지가 어느 변에든 붙도록. id로 엣지가 지정.
function NodeHandles() {
  return (
    <>
      {NODE_SIDES.map((side) => (
        <Fragment key={side}>
          <Handle id={`t-${side}`} type="target" position={toPosition(side)} />
          <Handle id={`s-${side}`} type="source" position={toPosition(side)} />
        </Fragment>
      ))}
    </>
  );
}
```

- [ ] **Step 3: Replace handle pairs in both render branches**

decision 분기(약 210·227행)의

```tsx
        <Handle type="target" position={Position.Left} />
```
…와 끝의
```tsx
        <Handle type="source" position={Position.Right} />
```
두 줄을 제거하고, decision 컨테이너 안 적절한 위치(예: 닫는 `</div>` 직전)에 `<NodeHandles />` 한 개로 대체.

일반 노드 분기(약 245·258행)도 동일하게 두 `<Handle .../>` 줄 제거 후 `<NodeHandles />`로 대체.

- [ ] **Step 4: Add subtle handle styling**

`frontend/src/app/globals.css`의 엣지 스타일 근처(예: `.react-flow__edge-path` 블록 뒤)에 추가:

```css
/* 핸들 — 노드당 8개라 평소엔 작게·은은하게, 노드 hover·연결 중에만 또렷하게 */
.react-flow__handle {
  width: 7px;
  height: 7px;
  background: var(--color-border-strong);
  border: 1px solid var(--color-surface);
  opacity: 0.4;
  transition: opacity 120ms var(--ease-smooth);
}
.react-flow__node:hover .react-flow__handle,
.react-flow__handle:hover,
.react-flow__handle.connectionindicator {
  opacity: 1;
}
```

- [ ] **Step 5: Verify lint + build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 전부 통과. (Position 미사용 eslint 에러가 나면 process-node.tsx import에서 `Position` 제거.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/process-node.tsx frontend/src/app/globals.css
git commit -m "feat(edge): render 4-side source/target handles on nodes — 8핸들 렌더

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend — context-menu `pad`(십자 패드) 항목 종류

**Files:**
- Modify: `frontend/src/components/context-menu.tsx`

- [ ] **Step 1: Import deps**

```ts
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronRight, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";

import type { HandleSide } from "@/lib/canvas";
```

- [ ] **Step 2: Add `pad` variant to ContextMenuItem**

```ts
export type ContextMenuItem =
  | { divider: true }
  | { colors: string[]; current: string; onPick: (color: string) => void; moreLabel?: string }
  | { pad: true; label: string; current: HandleSide; onPick: (side: HandleSide) => void }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; submenu: ContextMenuItem[]; disabled?: boolean }
  | { divider?: false; label: string; icon?: LucideIcon; accel?: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void };
```

- [ ] **Step 3: Render `pad` in MenuList**

`MenuList`의 분기 체인(약 132-143행)에서 `"colors" in item` 다음에 추가:

```tsx
        ) : "pad" in item ? (
          <CrossPad key={`pad-${index}`} item={item} />
        ) : "submenu" in item ? (
```

- [ ] **Step 4: Add CrossPad component**

`ColorRow` 컴포넌트 아래에 추가:

```tsx
// 십자 방향 패드 — 버튼 위치가 실제 노드 변에 매핑. 클릭해도 메뉴는 닫지 않음(연속 조정).
const PAD_BUTTONS: { side: HandleSide; icon: LucideIcon; col: string; row: string }[] = [
  { side: "top", icon: ArrowUp, col: "col-start-2", row: "row-start-1" },
  { side: "left", icon: ArrowLeft, col: "col-start-1", row: "row-start-2" },
  { side: "right", icon: ArrowRight, col: "col-start-3", row: "row-start-2" },
  { side: "bottom", icon: ArrowDown, col: "col-start-2", row: "row-start-3" },
];

function CrossPad({
  item,
}: {
  item: { label: string; current: HandleSide; onPick: (side: HandleSide) => void };
}) {
  return (
    <div className="px-3 py-1.5">
      <p className="mb-1 text-fine text-ink-tertiary">{item.label}</p>
      <div className="grid w-[84px] grid-cols-3 grid-rows-3 gap-0.5">
        {PAD_BUTTONS.map(({ side, icon: Icon, col, row }) => (
          <button
            key={side}
            type="button"
            // 메뉴 유지 — onClose 호출하지 않음. mousedown 가드가 바깥 클릭만 닫음.
            onClick={() => item.onPick(side)}
            aria-label={side}
            className={`flex h-6 w-6 items-center justify-center rounded-xs border ${col} ${row} ${
              item.current === side
                ? "border-accent bg-accent-tint text-accent"
                : "border-hairline text-ink-tertiary hover:bg-surface-alt"
            }`}
          >
            <Icon size={13} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify lint + build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 통과(아직 `pad` 항목을 쓰는 곳은 없지만 타입·렌더 정의는 유효).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/context-menu.tsx
git commit -m "feat(menu): cross-pad context-menu item (stays open on click) — 십자 패드 항목

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — 엣지 메뉴 배선 + i18n

**Files:**
- Modify: `frontend/src/lib/i18n-messages.ts` (en + ko, `branch.*` 근처)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`setEdgeSide` 핸들러 + `menuItems`의 edge 분기)

- [ ] **Step 1: Add i18n keys**

`i18n-messages.ts`의 `en` 객체 `"branch.other"` 줄 아래:

```ts
  "edge.sourceSide": "Start side",
  "edge.targetSide": "End side",
```

`ko` 객체의 동일 위치(같은 키)에:

```ts
  "edge.sourceSide": "시작 변",
  "edge.targetSide": "끝 변",
```

(en/ko 키 누락 시 tsc가 잡으므로 양쪽 모두 추가.)

- [ ] **Step 2: Add setEdgeSide handler in page.tsx**

`updateSelectedEdgeLabel`(약 2045행) 근처, 다른 엣지 핸들러 옆에 추가:

```ts
  const setEdgeSide = useCallback(
    (edgeId: string, end: "source" | "target", side: HandleSide) => {
      if (readOnly) {
        return;
      }
      pushHistory();
      setEdges((current) =>
        current.map((edge) =>
          edge.id === edgeId
            ? {
                ...edge,
                ...(end === "source"
                  ? { sourceHandle: sourceHandleId(side) }
                  : { targetHandle: targetHandleId(side) }),
              }
            : edge,
        ),
      );
      scheduleAutoSave();
    },
    [readOnly, pushHistory, setEdges, scheduleAutoSave],
  );
```

- [ ] **Step 3: Add edge branch to menuItems**

`menuItems` useMemo(약 2151행) 안, `if (menu.kind === "node")` 분기 앞에 추가:

```ts
    if (menu.kind === "edge") {
      const edge = edges.find((e) => e.id === menu.targetId);
      if (!edge || readOnly) {
        return [];
      }
      return [
        {
          pad: true,
          label: t("edge.sourceSide"),
          current: sideFromHandleId(edge.sourceHandle, "right"),
          onPick: (side: HandleSide) => setEdgeSide(edge.id, "source", side),
        },
        { divider: true },
        {
          pad: true,
          label: t("edge.targetSide"),
          current: sideFromHandleId(edge.targetHandle, "left"),
          onPick: (side: HandleSide) => setEdgeSide(edge.id, "target", side),
        },
      ];
    }
```

- [ ] **Step 4: Add deps to menuItems useMemo**

`menuItems` useMemo 의존성 배열에 `edges`, `setEdgeSide`, `t`가 없으면 추가(이미 있으면 그대로).

- [ ] **Step 5: Verify lint + build**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 통과.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/i18n-messages.ts "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(edge): right-click cross-pad to set edge handle sides — 엣지 변 메뉴 배선

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 통합 검증 + 마이그레이션 + 진행 기록

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Backend full suite + lint**

Run: `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`
Expected: 전부 PASS.

- [ ] **Step 2: Frontend full check**

Run: `cd frontend && npx tsc --noEmit && npm run lint && npm run build`
Expected: 전부 PASS.

- [ ] **Step 3: Apply schema (drop+recreate, 1회)**

로컬(sqlite): 백엔드 DB 파일 삭제 후 서버 재기동(`create_all`이 새 스키마 생성) + 시드 재실행.

```bash
cd backend
# DB 파일 경로는 .env/settings 확인(예: bpm.db). 삭제:
rm -f bpm.db
.venv/bin/python scripts/seed_dummy.py --reset
```
(PowerShell: `Remove-Item bpm.db -ErrorAction SilentlyContinue; .venv\Scripts\python scripts\seed_dummy.py --reset`)

서버(postgres): 배포 시 1회 테이블/볼륨 초기화. **영구 drop_all 코드 추가 금지.**

- [ ] **Step 4: Manual verification (서버/원격 IP — secure context 차이 주의)**

다음을 직접 확인:
1. 엣지 우클릭 → 십자 패드 2개(Start/End) 표시, 현재 변 accent 강조.
2. 방향 버튼 클릭 → 엣지가 해당 변으로 즉시 재연결, **메뉴 유지**(연속 클릭 가능). 바깥 클릭/Esc로 닫힘.
3. 새로고침 후 변 유지(영속 확인).
4. 버전 비교(compare) 화면에서 변만 바꾼 엣지가 added/removed/changed로 잡히지 **않음**.
5. 노드 hover 시 8핸들이 또렷해지고 평소엔 은은함.

- [ ] **Step 5: Update PROGRESS.md**

`## 2026-06-17` 섹션 맨 위에 추가:

```markdown
- 엣지 핸들 변 커스텀 — 엣지마다 시작/끝이 붙는 노드 변(상/하/좌/우)을 우클릭 십자 패드로 변경. `source_side`/`target_side` 엣지 컬럼 영속(기본 우/좌), 노드는 4변 source·target 핸들(8개) 렌더, 엣지는 sourceHandle/targetHandle로 연결. diff는 엣지를 source→target 계보로만 비교해 변은 비교 제외(diff.ts 무변경). 스키마는 1회 drop+recreate. (스펙: docs/superpowers/specs/2026-06-17-edge-handle-side-customization-design.md)
```

- [ ] **Step 6: Commit + push**

```bash
git add PROGRESS.md
git commit -m "docs(progress): edge handle side customization — 진행 기록

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
git push origin feat/ui-ux-improvements
```

---

## 검증 요약

- **백엔드**: pytest(라운드트립·기본값) + ruff.
- **프론트**: tsc + eslint + `next build` (테스트 러너 없음) + 수동(서버/원격 IP)에서 패드 동작·영속·diff 무영향 확인.
- **마이그레이션**: 1회 drop+recreate. 영구 drop_all 금지.
