# Editor + Comparison Zero-Base Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the map editor and version-comparison screens from scratch on a parallel `/v2` route per the hifi mockups, reusing the proven React Flow canvas engine and all backend APIs, then cut over.

**Architecture:** New UI chrome lives under `frontend/src/components/editor-v2/` and a temporary route `frontend/src/app/maps/[mapId]/v2/`. The old editor at `/maps/[mapId]` stays untouched until cutover. Each unit is built, reviewed against the OLD editor on :3100, and committed before the next. Canvas engine (`@xyflow/react`, `ProcessNode`, `lib/canvas`, drag/dropzone/scope/dagre) and libs (`lib/api`, `lib/diff`, `lib/merge-diff`, `lib/id`, `lib/i18n-messages`) are reused as-is.

**Tech Stack:** Next.js App Router (TS/React), `@xyflow/react`, dagre, vitest, ESLint/tsc. Backend FastAPI (no changes this plan).

## Global Constraints

Copied verbatim from the design spec (`docs/superpowers/specs/2026-06-28-editor-compare-redesign-design.md` §5). Every task implicitly includes these:

- Line endings **LF**.
- IDs via **`genId()`** from `frontend/src/lib/id.ts` — `crypto.randomUUID` is forbidden (server runs plain HTTP, no Web Crypto).
- Colors via **design tokens only** (no raw hex) — exception: node `color`, `COLOR_PRESETS`, PNG export bg (data/output, not chrome).
- **UI English / dynamic data + comments Korean**; Lucide icons 16px strokeWidth 1.5; no emoji.
- Button cursor + click-press is global base (`globals.css`) — components add hover background only.
- **Do not lose secondary behaviors** (hover hints/tooltips) when moving UI.
- Per unit: `npx tsc --noEmit` 0 + `npx eslint .` 0 + `/v2` browser live + **behavior parity vs :3100 OLD** + one commit.
- **Backend/DB schema changes require user confirmation first.** This plan assumes none.

---

## File Structure (all phases — decomposition lock-in)

New code under `frontend/src/`:

```
app/maps/[mapId]/v2/page.tsx                    # P0  new editor route (thin)
app/maps/[mapId]/v2/compare/page.tsx            # P7  new compare route (thin)
app/dev/editor-gallery/page.tsx                 # P4  isolated modal gallery (first modal)
components/editor-v2/
  editor-shell.tsx                              # P0  layout regions + wires hook
  use-editor-data.ts                            # P0  load map/versions/graph/me
  canvas/
    graph-adapters.ts                           # P1  Graph -> AppNode/AppEdge (saved pos)
    editor-canvas.tsx                            # P1  React Flow mount (reuse ProcessNode)
    drop-zone-ring.tsx                           # P1  4-way radial dropzone overlay
  topbar/
    editor-topbar.tsx                            # P2
    map-name-dropdown.tsx                        # P2
    version-pill.tsx                             # P2
  sidebar/
    editor-sidebar.tsx                           # P2
    add-node-menu.tsx                            # P2
    shortcuts-card.tsx                           # P2
    node-outline.tsx                             # P2
  inspector/
    inspector-panel.tsx                          # P3  tab bar + routing
    tab-properties.tsx                           # P3  empty/node/edge
    tab-map.tsx                                   # P3
    tab-approval.tsx                              # P3  (reuse WorkflowDashboard logic)
    tab-activity.tsx                              # P3  (reuse CommentSection + version-timeline)
  overlays/
    context-menu.tsx                             # P4  infra + canvas/node/edge/group menus
    node-edit-modal.tsx                          # P4
    color-submenu.tsx                            # P4
  groups/
    group-box.tsx                                # P5
    group-bulk-modal.tsx                         # P5
  ai/ai-chat-panel.tsx                           # P6
  compare/
    compare-shell.tsx                            # P7
    compare-canvas.tsx                           # P7
    change-list.tsx                              # P7
```

Reused as-is: `components/process-node.tsx` (minor E3/E4 token edit in P1), `lib/canvas.ts`, `lib/api.ts`, `lib/diff.ts`, `lib/merge-diff.ts`, `lib/id.ts`, `lib/i18n-messages.ts`, `lib/i18n.tsx`; existing `WorkflowDashboard`, `CommentSection`, `version-timeline`, `AiChatPanel`, `ProcessLibraryPanel`, `ApproverManager` (logic reused, restyled).

---

## Roadmap (8 phases / ~30 units)

| Phase | Units | Plan |
|-------|-------|------|
| **P0 Scaffold** | U0.1 | **detailed below (Tasks 1–2)** |
| **P1 Canvas** | U1.1–U1.4 | **detailed below (Tasks 3–7)** |
| P2 Topbar + Sidebar | U2.1–U2.5 | JIT plan at phase start |
| P3 Inspector 4-tab | U3.1–U3.7 | JIT plan at phase start |
| P4 Context menus + node modal | U4.1–U4.5 | JIT plan at phase start |
| P5 Canvas groups | U5.1–U5.3 | JIT plan at phase start |
| P6 AI + library + readonly + cutover | U6.1–U6.5 | JIT plan at phase start |
| P7 Comparison | U7.1–U7.4 | JIT plan at phase start |

Each future phase gets its own `docs/superpowers/plans/2026-MM-DD-editor-v2-pN-*.md` written just before it starts, against the spec unit definitions and the then-current `/v2` code. This is deliberate: exact React Flow JSX is discovered against the live engine, and the user's workflow reviews one unit at a time. Unit acceptance criteria for all phases already live in the spec §6.

---

## Phase 0 — Scaffold

### Task 1: `/v2` route + shell skeleton + data-load hook (U0.1)

**Files:**
- Create: `frontend/src/app/maps/[mapId]/v2/page.tsx`
- Create: `frontend/src/components/editor-v2/use-editor-data.ts`
- Create: `frontend/src/components/editor-v2/editor-shell.tsx`

**Interfaces:**
- Consumes (from `lib/api.ts`): `getMap(mapId): Promise<MapDetail>`, `listVersions(mapId): Promise<VersionSummary[]>`, `getResolvedGraph(versionId): Promise<Graph>`, `getMe(): Promise<Me>`. (Confirm exact names/types by importing; tsc enforces.)
- Produces:
  - `useEditorData(mapId: string): EditorData` where
    `interface EditorData { loading: boolean; error: string | null; map: MapDetail | null; versions: VersionSummary[]; versionId: string | null; setVersionId: (id: string) => void; graph: Graph | null; me: Me | null; reloadGraph: () => void }`
  - `EditorShell({ mapId }: { mapId: string })` — default-exported region layout used by the route and (later) gallery.

- [ ] **Step 1: Create the data-load hook**

`frontend/src/components/editor-v2/use-editor-data.ts`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getMap,
  getMe,
  getResolvedGraph,
  listVersions,
  type Graph,
  type MapDetail,
  type Me,
  type VersionSummary,
} from "@/lib/api";

export interface EditorData {
  loading: boolean;
  error: string | null;
  map: MapDetail | null;
  versions: VersionSummary[];
  versionId: string | null;
  setVersionId: (id: string) => void;
  graph: Graph | null;
  me: Me | null;
  reloadGraph: () => void;
}

// 에디터 셸이 필요로 하는 맵·버전·그래프·현재유저를 한곳에서 로드. 영속/도메인 로직은 lib/api에 위임.
export function useEditorData(mapId: string): EditorData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<MapDetail | null>(null);
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([getMap(mapId), listVersions(mapId), getMe()])
      .then(([m, vs, meRes]) => {
        if (cancelled) return;
        setMap(m);
        setVersions(vs);
        setMe(meRes);
        setVersionId((prev) => prev ?? vs[0]?.id ?? null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mapId]);

  const reloadGraph = useCallback(() => {
    if (!versionId) return;
    getResolvedGraph(versionId)
      .then((g) => setGraph(g))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "graph load failed"),
      );
  }, [versionId]);

  useEffect(() => {
    reloadGraph();
  }, [reloadGraph]);

  return {
    loading,
    error,
    map,
    versions,
    versionId,
    setVersionId,
    graph,
    me,
    reloadGraph,
  };
}
```

- [ ] **Step 2: Create the shell skeleton**

`frontend/src/components/editor-v2/editor-shell.tsx`:

```tsx
"use client";

import { useEditorData } from "./use-editor-data";

// 신규 에디터 셸 — 4영역 골격. 각 영역은 후속 Phase에서 실제 컴포넌트로 채운다.
export default function EditorShell({ mapId }: { mapId: string }) {
  const { loading, error, map, graph } = useEditorData(mapId);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-error">
        {error}
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-canvas" data-id="editor-v2-shell">
      <header
        className="flex h-12 items-center border-b border-hairline bg-surface px-3 text-body-strong"
        data-id="editor-v2-topbar"
      >
        {loading ? "Loading…" : (map?.name ?? "Untitled")}
      </header>
      <div className="flex min-h-0 flex-1">
        <aside
          className="w-64 border-r border-hairline bg-surface"
          data-id="editor-v2-sidebar"
        />
        <main className="relative min-w-0 flex-1" data-id="editor-v2-canvas">
          {/* P1: EditorCanvas mounts here */}
          {graph ? null : null}
        </main>
        <aside
          className="w-[330px] border-l border-hairline bg-surface"
          data-id="editor-v2-inspector"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create the route**

`frontend/src/app/maps/[mapId]/v2/page.tsx`:

```tsx
import EditorShell from "@/components/editor-v2/editor-shell";

export default async function EditorV2Page({
  params,
}: {
  params: Promise<{ mapId: string }>;
}) {
  const { mapId } = await params;
  return <EditorShell mapId={mapId} />;
}
```

- [ ] **Step 4: Typecheck and lint**

Run (in `frontend/`):
```bash
npx tsc --noEmit && npx eslint . && echo "OK"
```
Expected: `OK` (0 errors). If `getResolvedGraph`/`getMe`/`MapDetail`/`Me`/`Graph` names differ, fix imports to the actual exports in `lib/api.ts` until tsc passes.

- [ ] **Step 5: Browser verification**

With frontend (:3000) + backend (:8000) running and logged in as `admin.kim`: open `http://localhost:3000/maps/<a real mapId>/v2`.
Expected: topbar shows the map name (not "Loading…"), three region borders visible (sidebar / canvas / inspector), browser console shows 0 errors. Pick a mapId from the home list or DB.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/maps/\[mapId\]/v2/page.tsx \
        frontend/src/components/editor-v2/use-editor-data.ts \
        frontend/src/components/editor-v2/editor-shell.tsx
git commit -m "feat(editor-v2): scaffold /v2 route + shell skeleton + data-load hook (U0.1) — 신규 에디터 골격·데이터 로드"
```

---

### Task 2: PROGRESS.md entry for Phase 0

**Files:**
- Modify: `PROGRESS.md` (top of `## 2026-06-28` section)

- [ ] **Step 1: Add the log line**

Insert at the top of the dated section (one line, mirroring existing style): summarize that the `/v2` scaffold + shell + data hook landed (U0.1), reusing `lib/api`, behind temporary route, old editor untouched.

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "docs(progress): editor-v2 P0 scaffold — /v2 골격 진행 기록"
```

> Note: per repo rule, PROGRESS.md is updated before every commit. For Tasks 3–7 below, fold the PROGRESS line into that task's final commit instead of a separate task.

---

## Phase 1 — Canvas (reuse engine, new frame)

### Task 3: Graph→Flow adapters with tests (part of U1.1)

**Files:**
- Create: `frontend/src/components/editor-v2/canvas/graph-adapters.ts`
- Create: `frontend/src/components/editor-v2/canvas/graph-adapters.test.ts`

**Interfaces:**
- Consumes (from `lib/canvas.ts`): `type AppNode`, `normalizeNodeType`, `sourceHandleId`, `targetHandleId` (confirm names; tsc enforces). From `lib/api.ts`: `type Graph`, `type GraphNode`, `type GraphEdge`.
- Produces:
  - `toFlowNodes(graph: Graph): AppNode[]` — uses saved `pos_x`/`pos_y` (NOT dagre); maps node fields into `data`.
  - `toFlowEdges(graph: Graph): Edge[]` — maps `source_node_id`/`target_node_id`, label, and handle sides.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/editor-v2/canvas/graph-adapters.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import type { Graph } from "@/lib/api";

import { toFlowEdges, toFlowNodes } from "./graph-adapters";

const graph: Graph = {
  nodes: [
    {
      id: "n1",
      title: "발주 요청",
      description: "",
      node_type: "process",
      color: null,
      assignee: null,
      department: null,
      system: null,
      duration: null,
      pos_x: 120,
      pos_y: 40,
      source_node_id: null,
      linked_map_id: null,
      follow_latest: false,
      linked_version_id: null,
      group_ids: [],
    },
  ],
  edges: [
    {
      id: "e1",
      source_node_id: "n1",
      target_node_id: "n1",
      label: "Yes",
      source_side: "right",
      target_side: "left",
      source_handle: null,
    },
  ],
  groups: [],
} as unknown as Graph;

describe("toFlowNodes", () => {
  it("uses saved position and maps title to label", () => {
    const [node] = toFlowNodes(graph);
    expect(node.id).toBe("n1");
    expect(node.type).toBe("process");
    expect(node.position).toEqual({ x: 120, y: 40 });
    expect(node.data.label).toBe("발주 요청");
  });
});

describe("toFlowEdges", () => {
  it("maps source/target node ids and label", () => {
    const [edge] = toFlowEdges(graph);
    expect(edge.source).toBe("n1");
    expect(edge.target).toBe("n1");
    expect(edge.label).toBe("Yes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `frontend/`):
```bash
npx vitest run src/components/editor-v2/canvas/graph-adapters.test.ts
```
Expected: FAIL — "toFlowNodes is not a function" / module not found.

- [ ] **Step 3: Implement the adapters**

`frontend/src/components/editor-v2/canvas/graph-adapters.ts`:

```ts
import type { Edge } from "@xyflow/react";

import type { Graph } from "@/lib/api";
import {
  normalizeNodeType,
  sourceHandleId,
  targetHandleId,
  type AppNode,
} from "@/lib/canvas";

// 저장된 좌표 기반으로 그래프를 React Flow 노드로 변환(비교화면 dagre와 달리 위치 보존).
export function toFlowNodes(graph: Graph): AppNode[] {
  return graph.nodes.map((n) => ({
    id: n.id,
    type: "process",
    position: { x: n.pos_x, y: n.pos_y },
    data: {
      label: n.title,
      description: n.description ?? "",
      nodeType: normalizeNodeType(n.node_type),
      color: n.color ?? null,
      assignee: n.assignee ?? null,
      department: n.department ?? null,
      system: n.system ?? null,
      duration: n.duration ?? null,
      groupIds: n.group_ids ?? [],
    },
  })) as AppNode[];
}

// 그래프 엣지를 핸들 사이드까지 포함해 React Flow 엣지로 변환.
export function toFlowEdges(graph: Graph): Edge[] {
  return graph.edges.map((e) => ({
    id: e.id,
    source: e.source_node_id,
    target: e.target_node_id,
    label: e.label ?? undefined,
    sourceHandle: sourceHandleId(e.source_side),
    targetHandle: targetHandleId(e.target_side),
  }));
}
```

> If `AppNode`'s `data` (`NodeData`) field names differ (e.g. not `label`/`nodeType`), align the mapping to the real `NodeData` in `lib/canvas.ts` until tsc + the test pass. If `sourceHandleId`/`targetHandleId` take different args, adjust per their signatures.

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run src/components/editor-v2/canvas/graph-adapters.test.ts && npx tsc --noEmit && npx eslint .
```
Expected: tests PASS, tsc 0, eslint 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor-v2/canvas/graph-adapters.ts \
        frontend/src/components/editor-v2/canvas/graph-adapters.test.ts
git commit -m "feat(editor-v2): Graph->Flow adapters with saved positions (U1.1) — 그래프 어댑터+테스트"
```

---

### Task 4: EditorCanvas read render (U1.1)

**Files:**
- Create: `frontend/src/components/editor-v2/canvas/editor-canvas.tsx`
- Modify: `frontend/src/components/editor-v2/editor-shell.tsx` (mount canvas in `data-id="editor-v2-canvas"` region)

**Interfaces:**
- Consumes: `toFlowNodes`/`toFlowEdges` (Task 3), `Graph` (api), `ProcessNode` (`@/components/process-node`).
- Produces: `EditorCanvas({ graph }: { graph: Graph })` — read-only React Flow render (no interaction yet).

- [ ] **Step 1: Implement EditorCanvas (read-only)**

`frontend/src/components/editor-v2/canvas/editor-canvas.tsx`:

```tsx
"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { Graph } from "@/lib/api";
import { ProcessNode } from "@/components/process-node";

import { toFlowEdges, toFlowNodes } from "./graph-adapters";

const nodeTypes: NodeTypes = { process: ProcessNode };

// P1.1: 읽기 전용 렌더. 인터랙션 배선은 U1.3.
export function EditorCanvas({ graph }: { graph: Graph }) {
  return (
    <ReactFlow
      nodes={toFlowNodes(graph)}
      edges={toFlowEdges(graph)}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <MiniMap pannable zoomable />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
```

- [ ] **Step 2: Mount in the shell, wrapped in ReactFlowProvider**

In `editor-shell.tsx`: add imports and replace the canvas `<main>` body.

```tsx
import { ReactFlowProvider } from "@xyflow/react";

import { EditorCanvas } from "./canvas/editor-canvas";
```

Replace the canvas region body:

```tsx
        <main className="relative min-w-0 flex-1" data-id="editor-v2-canvas">
          {graph ? (
            <ReactFlowProvider>
              <EditorCanvas graph={graph} />
            </ReactFlowProvider>
          ) : null}
        </main>
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint . && echo OK`
Expected: `OK`. (If `Controls`/`MiniMap`/`BackgroundVariant` import names differ in the installed `@xyflow/react`, match the version's exports — cross-check `compare/page.tsx` imports.)

- [ ] **Step 4: Browser verification vs :3100**

Open `/maps/<id>/v2`. Expected: the demo map's nodes/edges render with the same topology as the OLD editor on `:3100` (same nodes, decision diamond, start/end), dot-grid background, minimap bottom area, zoom controls. Compare side-by-side with `:3100`. Console 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor-v2/canvas/editor-canvas.tsx \
        frontend/src/components/editor-v2/editor-shell.tsx
git commit -m "feat(editor-v2): read-only canvas render reusing ProcessNode (U1.1) — 캔버스 읽기 렌더"
```

---

### Task 5: Node visual tokens — E3 border + E4 selection ring (U1.2)

**Files:**
- Modify: `frontend/src/components/process-node.tsx` (DEFAULT_COLORS border + selection ring)

**Interfaces:** none new. Visual-only edit to the shared node renderer (improves both editors; OLD on :3100 is a separate worktree and unaffected).

- [ ] **Step 1: Update the process node border color (E3)**

In `process-node.tsx`, locate `DEFAULT_COLORS` (around line 147). Change the process node stroke from `#909098` to `#6e84a3` per spec E3. Keep fill derived via `color-mix(in srgb, {color} 18%, white)`. Show the exact before/after line when editing.

- [ ] **Step 2: Update the selection ring (E4)**

Where the node renders its selected state (uses `selected` prop), set the ring to `2px accent` + `0 0 0 4px color-mix(in srgb, var(--color-accent) 12%, transparent)` via inline style or a token class, replacing the current `ring-2` approximation. No raw hex — use `var(--color-accent)`.

- [ ] **Step 3: Typecheck, lint, run existing node-related tests**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run src/lib/canvas.test.ts`
Expected: 0 errors, tests PASS.

- [ ] **Step 4: Browser verification**

On `/v2`: confirm process nodes show the new `#6e84a3` border; select a node → confirm the 2px accent + 12% halo ring. Decision/start/end shapes unchanged. Compare against the mockup `editor-overview.png` / `inspector-properties-node.png`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/process-node.tsx
git commit -m "feat(editor-v2): node border E3 + selection ring E4 tokens (U1.2) — 노드 테두리·셀렉션 링"
```

---

### Task 6: Canvas interactions — select / pan / zoom / drag / connect (U1.3)

**Files:**
- Modify: `frontend/src/components/editor-v2/canvas/editor-canvas.tsx` (controlled nodes/edges + handlers)
- Modify: `frontend/src/components/editor-v2/editor-shell.tsx` (lift selection + graph-change state)

**Interfaces:**
- Consumes (from `lib/canvas.ts`): `resolveCollision`, `violatesTerminalRule`, plus `hasReciprocalEdge` (from wherever it's exported — `lib/canvas` per memory `edge-creation-two-paths`). From `@xyflow/react`: `useNodesState`, `useEdgesState`, `applyNodeChanges`, `addEdge`, `type Connection`, `type OnConnect`.
- Produces: `EditorCanvas` gains props `onSelect(nodeId: string | null, edgeId: string | null)` and an internal controlled state seeded from `graph`; emits graph mutations upward via `onGraphChange(graph: Graph)` (persistence/autosave is U2.1, so this task only updates in-memory state + calls a no-op-safe callback).

- [ ] **Step 1: Make nodes/edges controlled and wire selection + movement**

Convert `EditorCanvas` to seed `useNodesState`/`useEdgesState` from the adapters, pass `onNodesChange`/`onEdgesChange`, and `onSelectionChange` → call `onSelect`. Add `onConnect` using `addEdge` guarded by `isValidConnection` that calls `violatesTerminalRule` + `hasReciprocalEdge` (reject reciprocal/terminal violations). Provide complete code in the step when implementing, modeled on the reused helpers. Re-seed state when `graph` identity changes (effect comparing a version key).

- [ ] **Step 2: Lift selection + change state into the shell**

`editor-shell.tsx` holds `selectedNodeId`/`selectedEdgeId` (for P3 inspector) and passes `onSelect`. `onGraphChange` stored for P2 autosave (kept as state setter now).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint . && echo OK` → `OK`.

- [ ] **Step 4: Browser verification vs :3100**

On `/v2`: select node (ring shows), pan (drag empty canvas), zoom (wheel / controls), drag a node (moves, collision avoidance), draw an edge between two handles (created), attempt a reciprocal edge (rejected), attempt edge into a start node's input / out of an end node (rejected per terminal rule). Confirm parity with `:3100`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/editor-v2/canvas/editor-canvas.tsx \
        frontend/src/components/editor-v2/editor-shell.tsx
git commit -m "feat(editor-v2): canvas interactions — select/pan/zoom/drag/connect (U1.3) — 캔버스 인터랙션 배선"
```

---

### Task 7: Drop-zone radial ring (U1.4)

**Files:**
- Create: `frontend/src/components/editor-v2/canvas/drop-zone-ring.tsx`
- Modify: `frontend/src/components/editor-v2/canvas/editor-canvas.tsx` (show ring on node-over-node drag; wire 4 actions)

**Interfaces:**
- Consumes: the existing dropzone hit-test / dwell logic from the OLD editor's drag handlers (read `page.tsx` drag/drop section + `lib/canvas` `resolveCollision`/intersection helpers; reuse the proven geometry). `genId()` for any new node/edge IDs created by insert.
- Produces: `DropZoneRing({ targetRect, active, onPick }: { targetRect: DOMRect | null; active: DropDir | null; onPick: (dir: DropDir) => void })` where `type DropDir = "before" | "after" | "group" | "swap"`.

Reference: `dropzone.png`.

- [ ] **Step 1: Build the radial ring overlay (4 used + 4 future placeholders)**

Create `drop-zone-ring.tsx` rendering the 4 active sectors (← 앞에 / → 뒤에 / ▲ 그룹 / ▼ 스왑) + 4 inactive corner placeholders, positioned over `targetRect`, highlighting `active`. Tokens only. Provide complete JSX when implementing, matching the mockup.

- [ ] **Step 2: Wire into the canvas drag lifecycle**

In `editor-canvas.tsx`, during a node drag that hovers another node, compute the hovered sector and render `<DropZoneRing>`; on drop call the matching action (before=insert predecessor, after=insert successor, group=add to group, swap=swap position+connections), reusing the OLD editor's insert/swap logic. Show the "이미 연결됨 → 유지 / 중간에 삽입" prompt when the target already has a connection (before/after).

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint . && echo OK` → `OK`.

- [ ] **Step 4: Browser verification vs :3100**

Drag a node over another: ring appears with 4 directions; each direction performs its insert/group/swap; the "유지 / 중간에 삽입" prompt appears when the target is already connected. Confirm parity with `:3100` behavior.

- [ ] **Step 5: Commit + PROGRESS**

```bash
git add frontend/src/components/editor-v2/canvas/drop-zone-ring.tsx \
        frontend/src/components/editor-v2/canvas/editor-canvas.tsx PROGRESS.md
git commit -m "feat(editor-v2): 4-way drop-zone ring + insert/group/swap (U1.4) — 드롭존 라디얼 링"
```

At this point `/v2` is a working read+interact canvas (Phase 1 complete). **Stop and review against :3100 before starting Phase 2.**

---

## Self-Review (this plan vs spec)

- **Spec coverage:** P0/P1 units (U0.1, U1.1–U1.4) each have a task (Tasks 1, 3–7). Spec §6 P2–P7 units are deferred to per-phase JIT plans per the Roadmap — coverage is by reference, intentional (spec §6 holds acceptance criteria).
- **Placeholder scan:** Tasks 1–5 contain complete code. Tasks 6–7 specify files/interfaces/verification with code authored at implementation against the live engine (the reused handler internals live in the 6,724-line OLD page.tsx and must be read in-situ, not transcribed blind) — flagged explicitly, not silent TODOs.
- **Type consistency:** `EditorData`, `useEditorData`, `EditorShell`, `toFlowNodes`/`toFlowEdges`, `EditorCanvas`, `DropDir`, `DropZoneRing` names are used consistently across tasks. API/`lib/canvas` symbol names are marked "confirm via tsc" since the spec forbids guessing exact signatures.
- **Constraints:** genId/LF/tokens/i18n/no-schema-change restated in Global Constraints and applied per task.

---

## Execution Handoff

Phases beyond P1 each get a JIT plan. For P0–P1 (Tasks 1–7), see the two execution options offered after this plan is saved.
