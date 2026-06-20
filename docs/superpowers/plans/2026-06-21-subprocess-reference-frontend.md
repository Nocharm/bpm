# Subprocess Reference Model — Frontend (Plan 2/3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the canvas editor from inline hierarchical subprocess *editing* to a read-only "process reference (Call Activity)" model — subprocess nodes link to other process maps, expand read-only inline, and the hard-won render polish is preserved by feeding it a synthetic tree.

**Architecture:** The entire render-polish layer (`inlineComposition`/`buildScope`, `ancestorContextNodes`, child materialization, `buildGatewayEdges`, `checkExpansionLimits`) reads one structure: a flat node list with `parent_node_id`. We keep that layer **unchanged in shape** and instead build a **synthetic composite tree** (`buildCompositeTree`) that embeds each expanded/drilled subprocess host's *linked map resolved graph* as namespaced children with a synthetic `parent_node_id`. Editing happens only at the root version (flat, `getGraph(versionId)`); embedded children are read-only. A read-only "deep view" reuses the scope/breadcrumb/ancestor/camera machinery for *viewing* (not editing) nested subprocesses.

**Tech Stack:** Next.js (modified — read `node_modules/next/dist/docs/` before edits), @xyflow/react v12, TypeScript strict. No frontend test runner — pure logic verified by `npx --yes tsx` sanity scripts (assert + exit non-zero on failure); page wiring verified by `npm run lint` + `npx tsc --noEmit` + `npm run build` + Playwright (system Chrome, on-demand). Backend: FastAPI + SQLAlchemy async + pytest.

## Global Constraints

- **Branch:** `feat/subprocess-reference-model` (backend Plan 1 already merged into this branch — do NOT branch again; do NOT merge to main until Plan 2 done).
- **Spec:** `docs/superpowers/specs/2026-06-20-subprocess-reference-model-design.md` is authoritative for behavior.
- **Decision (this session):** read-only deep view is KEPT (repurpose `ancestorContextNodes`/`focusCamRef`/scope navigation for *viewing* nested subprocesses read-only; editing stays root-only).
- **Ids:** generate with `genId()` from `@/lib/id` — NEVER `crypto.randomUUID()` (server is plain-HTTP insecure context).
- **Line endings:** LF only (`.gitattributes` enforces). Never introduce CRLF.
- **Design tokens only:** no raw hex in chrome — use token classes (`bg-surface`, `text-ink`, `border-hairline`, `text-accent`, `--shadow-md`, etc.) per `rules/frontend/design.md`. Node `color`/`COLOR_PRESETS`/PNG bg are data exceptions.
- **UI copy English, dynamic data Korean.** All new UI strings go through i18n (`src/lib/i18n-messages.ts`, both `en` and `ko` — tsc forces parity). Icons: Lucide 16px strokeWidth 1.5, no emoji.
- **Input validation at API boundary (backend).** Frontend surfaces backend 422 detail (already Korean) via toast/status — does NOT re-implement validation.
- **`grep` is ugrep and silently skips bracket dirs** (`[mapId]`). Use `git grep` / `find` / Read — never plain `grep -r` on `src/app/maps/[mapId]/`.
- **Editor is one ~5947-line client component** `src/app/maps/[mapId]/page.tsx`. Most work is here. Read `docs/lessons/` (canvas-react-flow, scope-save-and-coordinates, react-ts-patterns) before touching it.
- **Handle id constants:** primary end handle = `"__primary__"`; subprocess input handle = `"in"`; embed id separator = `"/"`. Defined once in `src/lib/subprocess-embed.ts`, imported everywhere.

---

## File Structure

| File | Responsibility | Action |
|------|----------------|--------|
| `backend/app/routers/library.py` | library list + resolved graph | Modify (enrich list) |
| `backend/tests/test_subprocess.py` | library/validation tests | Modify (assert new fields) |
| `frontend/src/lib/api.ts` | REST client + wire types | Modify (library fns, new node/edge fields, drop `parent`) |
| `frontend/src/lib/canvas.ts` | node geometry/type helpers | Modify (`subprocess` type) |
| `frontend/src/lib/subprocess-embed.ts` | **NEW** pure: composite tree, end derivation, cycle closure, id namespacing | Create |
| `frontend/src/components/process-node.tsx` | node rendering + handles | Modify (subprocess shape + dynamic end handles + update badge) |
| `frontend/src/components/process-library-panel.tsx` | **NEW** draggable process list | Create |
| `frontend/src/app/maps/[mapId]/page.tsx` | editor: state, load/save, expand, drag-drop, inspector | Modify (composite tree swap, remove child editing, drag-create, deep-view, handles, badge) |
| `frontend/src/lib/i18n-messages.ts` | UI copy (en+ko) | Modify (new strings) |

**Task order rationale:** additive backend+client+pure-logic first (Tasks 1-4, nothing breaks), then the composite-tree swap (Task 5, the core), then removal of dead editing paths (Task 6), then deep-view nav (Task 7), then the two user-facing features (Task 8 library drag, Task 9 handles+versioning). The app builds after every task; behavior is incrementally correct.

---

## Task 1: Backend — enrich library list with published version + refs

**Files:**
- Modify: `backend/app/routers/library.py:19-30` (`list_processes`)
- Test: `backend/tests/test_subprocess.py`

**Interfaces:**
- Produces: `GET /api/library/processes` → `list[{map_id:int, name:str, latest_version_id:int|None, latest_published_version_id:int|None, refs:list[int]}]`. `refs` = union of `linked_map_id` across ALL versions' nodes of that map (matches `assert_no_cycle`'s closure source). Consumed by frontend update-badge (Task 9) and library cycle-disable (Task 8).

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_subprocess.py` (follow the existing fixtures/helpers in that file for client + map/version creation; reuse whatever `create map → version → PUT graph` helper the file already defines):

```python
@pytest.mark.asyncio
async def test_library_list_includes_published_and_refs(client):
    # map A published v; map B draft references A → B.refs == [A]
    a = await _make_map_with_published(client, name="A")  # helper from existing tests
    b = await _make_map(client, name="B")
    b_ver = b["versions"][0]["id"]
    await client.put(f"/api/versions/{b_ver}/graph", json={
        "nodes": [
            {"id": "s", "node_type": "start", "title": "S"},
            {"id": "sub", "node_type": "subprocess", "title": "call A", "linked_map_id": a["map_id"]},
        ],
        "edges": [], "groups": [],
    })
    rows = (await client.get("/api/library/processes")).json()
    by_id = {r["map_id"]: r for r in rows}
    assert by_id[a["map_id"]]["latest_published_version_id"] == a["published_version_id"]
    assert by_id[b["map_id"]]["refs"] == [a["map_id"]]
    assert by_id[a["map_id"]]["refs"] == []
```

If the file lacks `_make_map_with_published`/`_make_map` helpers, write minimal inline equivalents using the same client calls other tests in the file already use (create map, create version, submit/approve/publish for the published one). Match the existing test style exactly.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest tests/test_subprocess.py::test_library_list_includes_published_and_refs -q`
Expected: FAIL (KeyError `latest_published_version_id` — field absent).

- [ ] **Step 3: Implement**

Replace `list_processes` in `backend/app/routers/library.py`:

```python
@router.get("/processes")
async def list_processes(session: AsyncSession = Depends(get_session)) -> list[dict]:
    # 맵별 최신/최신발행 버전 — 단일 그룹 쿼리(N+1 회피).
    latest_rows = (
        await session.execute(
            select(ProcessMap.id, ProcessMap.name, func.max(MapVersion.id))
            .outerjoin(MapVersion, MapVersion.map_id == ProcessMap.id)
            .group_by(ProcessMap.id, ProcessMap.name)
            .order_by(ProcessMap.name)
        )
    ).all()
    pub_rows = (
        await session.execute(
            select(MapVersion.map_id, func.max(MapVersion.id))
            .where(MapVersion.status == "published")
            .group_by(MapVersion.map_id)
        )
    ).all()
    published = {mid: vid for mid, vid in pub_rows}
    # 맵별 참조 맵 집합 — 전 버전 노드의 linked_map_id 합집합(순환 차단 클로저와 동일 소스).
    ref_rows = (
        await session.execute(
            select(MapVersion.map_id, Node.linked_map_id)
            .join(Node, Node.version_id == MapVersion.id)
            .where(Node.linked_map_id.is_not(None))
            .distinct()
        )
    ).all()
    refs: dict[int, list[int]] = {}
    for mid, linked in ref_rows:
        refs.setdefault(mid, []).append(linked)
    return [
        {
            "map_id": mid,
            "name": name,
            "latest_version_id": latest,
            "latest_published_version_id": published.get(mid),
            "refs": sorted(refs.get(mid, [])),
        }
        for mid, name, latest in latest_rows
    ]
```

Add `Node` to the imports from `app.models`.

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/python -m pytest tests/test_subprocess.py -q && .venv/bin/ruff check app/ tests/`
Expected: all PASS, ruff clean.

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/library.py backend/tests/test_subprocess.py
git commit -m "feat(library): add latest_published_version_id + refs to process list — 발행본 비교·순환차단 UX 데이터"
```

---

## Task 2: API client + shared wire/canvas types

**Files:**
- Modify: `frontend/src/lib/api.ts` (types lines 31-82; `scopeQuery` 165-167; `getGraph` 169-174; `saveGraph` 240-249; `aiChat` 384-395; add library fns)
- Modify: `frontend/src/lib/canvas.ts` (`ProcessNodeType` 33; `normalizeNodeType` 44; `nodeSizeOf` 63-72; `NodeData` 9-31)

**Interfaces:**
- Produces:
  - `interface LibraryProcess { map_id:number; name:string; latest_version_id:number|null; latest_published_version_id:number|null; refs:number[] }`
  - `listLibraryProcesses(): Promise<LibraryProcess[]>`
  - `getResolvedGraph(mapId:number, followLatest:boolean, pinned:number|null): Promise<Graph>`
  - `GraphNode` gains `linked_map_id:number|null; follow_latest:boolean; linked_version_id:number|null; is_primary_end:boolean`
  - `GraphEdge` gains `source_handle:string|null; target_handle:string|null`
  - `FlatNode.parent_node_id` stays declared (now a **client-synthetic** field set by `buildCompositeTree`; backend sends none → coerce undefined→null on read)
  - `ProcessNodeType` gains `"subprocess"`; `NodeData` gains `linkedMapId?:number|null; followLatest?:boolean; linkedVersionId?:number|null; isPrimaryEnd?:boolean; updateAvailable?:boolean` (the `subEnds?:SubEnd[]` field is added in Task 4, after `subprocess-embed.ts` exists — avoids a forward type dependency here)

- [ ] **Step 1: Update wire types in `api.ts`**

In `GraphNode` (after `has_children?`):
```typescript
  // 하위프로세스 참조 (node_type==="subprocess")
  linked_map_id: number | null;
  follow_latest: boolean;
  linked_version_id: number | null;
  // 대표 끝 (node_type==="end")
  is_primary_end: boolean;
```
In `GraphEdge` (after `target_side`):
```typescript
  source_handle: string | null;
  target_handle: string | null;
```

- [ ] **Step 2: Drop the dead `parent` scoping + add library fns in `api.ts`**

Delete `scopeQuery` (165-167). Change `getGraph`/`saveGraph` to drop the `parentId` param:
```typescript
export function getGraph(versionId: number): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph`);
}
export function saveGraph(versionId: number, graph: Graph): Promise<Graph> {
  return request<Graph>(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: JSON.stringify(graph),
  });
}
```
Change `aiChat` to drop the `parent` argument (backend `AiChatRequest` no longer has it — confirm in `backend/app/schemas.py:236`): remove the `parent` param and the `parent` field from the JSON body.

Add (near `getMap`):
```typescript
export interface LibraryProcess {
  map_id: number;
  name: string;
  latest_version_id: number | null;
  latest_published_version_id: number | null;
  refs: number[];
}

export function listLibraryProcesses(): Promise<LibraryProcess[]> {
  return request<LibraryProcess[]>("/library/processes");
}

export function getResolvedGraph(
  mapId: number,
  followLatest: boolean,
  pinned: number | null,
): Promise<Graph> {
  const params = new URLSearchParams({ follow_latest: String(followLatest) });
  if (pinned !== null) params.set("pinned", String(pinned));
  return request<Graph>(`/library/processes/${mapId}/resolved?${params.toString()}`);
}
```

- [ ] **Step 3: Extend canvas types in `canvas.ts`**

`ProcessNodeType` → add `| "subprocess"`. In `normalizeNodeType` add `subprocess` to the accepted set. In `nodeSizeOf` add a `subprocess` case sized like a process node but a touch taller to fit the link label — return `{ w: 180, h: 64 }`. Add to `NodeData` the optional fields listed in Interfaces — **only** `linkedMapId/followLatest/linkedVersionId/isPrimaryEnd/updateAvailable` here. Do NOT add `subEnds` yet (its type `SubEnd` lives in `subprocess-embed.ts`, created in Task 3; Task 4 adds the `subEnds` field). This keeps Task 2 free of any forward dependency.

- [ ] **Step 4: Update conversion in `page.tsx` (`buildGraph` 394-442, `toAppNodes` 338-359, `toAppEdges` ~360-380)**

In `buildGraph`'s node mapping, carry the 4 new node fields from `AppNode.data` → `GraphNode` (`linked_map_id: node.data.linkedMapId ?? null`, `follow_latest: node.data.followLatest ?? false`, `linked_version_id: node.data.linkedVersionId ?? null`, `is_primary_end: node.data.isPrimaryEnd ?? false`). In its edge mapping carry `source_handle`/`target_handle` from the AppEdge's `sourceHandle`/`targetHandle` (React Flow handle ids). In `toAppNodes` map the 4 fields into `data`. In `toAppEdges`, when `source_handle`/`target_handle` are present prefer them over the side-derived handle ids (subprocess end handles use the raw handle id).

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit`
Expected: no errors. (Build deferred to later tasks that complete the wiring.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/lib/canvas.ts "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(api): subprocess wire types, library client, drop parent scoping — 참조모델 클라이언트 표면"
```

---

## Task 3: Pure module — `subprocess-embed.ts` (composite tree, ends, cycle closure)

**Files:**
- Create: `frontend/src/lib/subprocess-embed.ts`
- Test: `frontend/scripts/sanity-subprocess-embed.ts` (NEW, run via `npx --yes tsx`)

**Interfaces:**
- Produces (all pure, no React/DOM):
  - consts `PRIMARY_END_HANDLE="__primary__"`, `SUBPROCESS_IN_HANDLE="in"`, `EMBED_SEP="/"`
  - `interface SubEnd { key:string; title:string; isPrimary:boolean; nodeId:string }`
  - `embedId(hostId:string, originalId:string):string`
  - `deriveSubEnds(resolved:Graph):SubEnd[]`
  - `buildCompositeTree(rootNodes:FlatNode[], rootEdges:GraphEdge[], hostsToEmbed:Set<string>, getEmbed:(node:FlatNode)=>Graph|null):{nodes:FlatNode[]; edges:GraphEdge[]}`
  - `closesCycle(candidateMapId:number, currentMapId:number, refsByMap:Map<number,number[]>):boolean`
- Consumed by: page.tsx composite tree (Task 5), node handles (Task 4), library disable (Task 8).

- [ ] **Step 1: Write the failing sanity test**

Create `frontend/scripts/sanity-subprocess-embed.ts`:
```typescript
import assert from "node:assert/strict";
import type { FlatNode, Graph, GraphEdge } from "../src/lib/api";
import {
  buildCompositeTree, deriveSubEnds, embedId, closesCycle,
  PRIMARY_END_HANDLE,
} from "../src/lib/subprocess-embed";

const flat = (id: string, t: string, extra: Partial<FlatNode> = {}): FlatNode => ({
  id, title: t, description: "", node_type: "process", color: "",
  assignee: "", department: "", system: "", duration: "", pos_x: 0, pos_y: 0,
  sort_order: 0, group_ids: [], parent_node_id: null, source_node_id: null,
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  ...extra,
});

// deriveSubEnds: primary gets fixed key, others use title; primary first
const resolved: Graph = {
  nodes: [
    flat("s", "Start", { node_type: "start" }),
    flat("e1", "OK", { node_type: "end", is_primary_end: true }),
    flat("e2", "Reject", { node_type: "end" }),
  ],
  edges: [], groups: [],
};
const ends = deriveSubEnds(resolved);
assert.equal(ends.length, 2);
assert.deepEqual(ends.find((x) => x.isPrimary), { key: PRIMARY_END_HANDLE, title: "OK", isPrimary: true, nodeId: "e1" });
assert.equal(ends.find((x) => !x.isPrimary)?.key, "Reject");

// buildCompositeTree: embed host "h" → namespaced children with synthetic parent_node_id
const root: FlatNode[] = [flat("s", "Start", { node_type: "start" }), flat("h", "Call", { node_type: "subprocess", linked_map_id: 7 })];
const rootEdges: GraphEdge[] = [{ id: "r1", source_node_id: "s", target_node_id: "h", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null }];
const sub: Graph = { nodes: [flat("cs", "cStart", { node_type: "start" }), flat("ce", "cEnd", { node_type: "end" })], edges: [{ id: "ce1", source_node_id: "cs", target_node_id: "ce", label: "", source_side: "right", target_side: "left", source_handle: null, target_handle: null }], groups: [] };
const tree = buildCompositeTree(root, rootEdges, new Set(["h"]), (n) => (n.linked_map_id === 7 ? sub : null));
assert.ok(tree.nodes.find((n) => n.id === embedId("h", "cs"))?.parent_node_id === "h");
assert.ok(tree.edges.find((e) => e.id === embedId("h", "ce1")));
assert.ok(tree.nodes.find((n) => n.id === "s")?.parent_node_id === null);

// closesCycle: candidate refs reach current → true
const refs = new Map<number, number[]>([[7, [3]], [3, [1]]]);
assert.equal(closesCycle(7, 1, refs), true);   // 7→3→1
assert.equal(closesCycle(7, 9, refs), false);
assert.equal(closesCycle(1, 1, new Map()), true); // self-reference

console.log("PASS sanity-subprocess-embed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && npx --yes tsx scripts/sanity-subprocess-embed.ts`
Expected: FAIL (cannot find module `subprocess-embed` / exports undefined).

- [ ] **Step 3: Implement `subprocess-embed.ts`**

```typescript
// 하위프로세스 참조 임베드 — 순수 로직. 링크맵 resolved 그래프를 합성 parent_node_id 트리로 끼워
// 기존 렌더 폴리시(buildScope/ancestorContext)가 그대로 소비하게 한다. 부수효과 없음.

import type { FlatNode, Graph, GraphEdge } from "@/lib/api";

export const PRIMARY_END_HANDLE = "__primary__";
export const SUBPROCESS_IN_HANDLE = "in";
export const EMBED_SEP = "/";

export interface SubEnd {
  key: string; // 핸들 id: 대표끝=PRIMARY_END_HANDLE, 그 외=끝 이름(프로세스 내 유니크)
  title: string;
  isPrimary: boolean;
  nodeId: string;
}

/** 임베드 자식 id 네임스페이싱 — 같은 맵을 여러 곳/중첩 임베드해도 React Flow id 충돌 없게. */
export function embedId(hostId: string, originalId: string): string {
  return `${hostId}${EMBED_SEP}${originalId}`;
}

/** 링크된 프로세스의 끝 노드 → 부모가 연결할 출력 핸들. 대표끝 먼저, 고정키. */
export function deriveSubEnds(resolved: Graph): SubEnd[] {
  const ends = resolved.nodes.filter((n) => n.node_type === "end");
  const out: SubEnd[] = [];
  for (const end of ends) {
    const isPrimary = end.is_primary_end;
    out.push({
      key: isPrimary ? PRIMARY_END_HANDLE : end.title,
      title: end.title,
      isPrimary,
      nodeId: end.id,
    });
  }
  // 대표끝을 맨 앞으로
  out.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  return out;
}

/**
 * 합성 트리 — 루트 평면 그래프 + hostsToEmbed에 속한 노드의 링크맵 resolved를 자식으로 끼움.
 * 자식 노드/엣지 id는 호스트 id로 네임스페이스, 자식 parent_node_id는 호스트 id로 설정 → 구버전 fullGraph 모양.
 * getEmbed(node): 그 노드(호스트) 아래 끼울 resolved 그래프(캐시), 없으면 null(미로드/비하위).
 */
export function buildCompositeTree(
  rootNodes: FlatNode[],
  rootEdges: GraphEdge[],
  hostsToEmbed: Set<string>,
  getEmbed: (node: FlatNode) => Graph | null,
): { nodes: FlatNode[]; edges: GraphEdge[] } {
  const outNodes: FlatNode[] = [];
  const outEdges: GraphEdge[] = [...rootEdges];

  const toFlat = (n: Graph["nodes"][number], parent: string | null, prefix: string): FlatNode => ({
    ...n,
    id: prefix ? embedId(prefix, n.id) : n.id,
    parent_node_id: parent,
    source_node_id: null,
  });

  const walk = (nodes: FlatNode[], parent: string | null, prefix: string): void => {
    for (const raw of nodes) {
      const node: FlatNode = prefix
        ? { ...raw, id: embedId(prefix, raw.id), parent_node_id: parent, source_node_id: null }
        : { ...raw, parent_node_id: parent };
      outNodes.push(node);
      if (!hostsToEmbed.has(node.id)) continue;
      const sub = getEmbed(node);
      if (!sub) continue;
      for (const e of sub.edges) {
        outEdges.push({
          ...e,
          id: embedId(node.id, e.id),
          source_node_id: embedId(node.id, e.source_node_id),
          target_node_id: embedId(node.id, e.target_node_id),
        });
      }
      walk(sub.nodes.map((n) => toFlat(n, node.id, node.id)), node.id, "");
    }
  };

  walk(rootNodes, null, "");
  return { nodes: outNodes, edges: outEdges };
}

/** candidate를 currentMap 아래로 끌어오면 순환이 되는가 — refs 클로저가 currentMap에 닿으면 true(자기참조 포함). */
export function closesCycle(
  candidateMapId: number,
  currentMapId: number,
  refsByMap: Map<number, number[]>,
): boolean {
  if (candidateMapId === currentMapId) return true;
  const seen = new Set<number>();
  const stack = [candidateMapId];
  while (stack.length > 0) {
    const m = stack.pop();
    if (m === undefined) continue;
    if (m === currentMapId) return true;
    if (seen.has(m)) continue;
    seen.add(m);
    for (const r of refsByMap.get(m) ?? []) stack.push(r);
  }
  return false;
}
```

Note: `walk`'s `toFlat` double-prefixes — fix by passing already-namespaced nodes. Simpler: in the recursion, map `sub.nodes` to flats with `parent_node_id=node.id` and **original** ids, then `walk(..., prefix=node.id)` namespaces them. Ensure exactly one namespacing per level (the sanity test asserts `embedId("h","cs")`, single level). Adjust until the test passes — do NOT double-apply `embedId`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd frontend && npx --yes tsx scripts/sanity-subprocess-embed.ts && npx tsc --noEmit`
Expected: `PASS sanity-subprocess-embed`, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/subprocess-embed.ts frontend/scripts/sanity-subprocess-embed.ts frontend/src/lib/canvas.ts
git commit -m "feat(canvas): subprocess-embed pure module — composite tree·ends·cycle closure — 합성트리 스파인"
```

---

## Task 4: Subprocess node rendering + dynamic end handles + primary-end toggle

**Files:**
- Modify: `frontend/src/components/process-node.tsx` (`NODE_TYPE_LABEL_KEY` 33-38, `DEFAULT_COLORS` 124-131, `NodeHandles` 199-213, `ProcessNode` 216-283)
- Modify: `frontend/src/lib/i18n-messages.ts` (new strings)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (inspector: end-node primary toggle; subprocess node type in palette/context where node types are offered)

**Interfaces:**
- Consumes: `NodeData.subEnds`, `.linkedMapId`, `.updateAvailable`, `.isPrimaryEnd` (Task 2); `SubEnd`, `PRIMARY_END_HANDLE`, `SUBPROCESS_IN_HANDLE` (Task 3).
- Produces: a subprocess node renders one left target handle id `SUBPROCESS_IN_HANDLE` and, on the right, one source handle per `subEnds[i].key` (vertically distributed); end nodes get an inspector toggle setting `is_primary_end`.

- [ ] **Step 1: Render the subprocess node**

First add `subEnds?: SubEnd[]` to `NodeData` in `canvas.ts` (`import type { SubEnd } from "@/lib/subprocess-embed"` — the file exists now from Task 3), and have `toAppNodes`/`buildGraph` leave it untouched (derived at render, not persisted). Then add `subprocess: "nodeType.subprocess"` to `NODE_TYPE_LABEL_KEY` and a token-derived default color to `DEFAULT_COLORS` (reuse an existing preset stroke, e.g. the `violet` preset value already in `COLOR_PRESETS` — do not introduce raw hex; if `DEFAULT_COLORS` already holds hex for other types, follow that exact existing convention since node `color` is a data value, not chrome). In `ProcessNode`, before the terminal/process return, add a branch `if (data.nodeType === "subprocess")` that renders a rounded-rect (`rounded-sm`, 1.5px stroke, `deriveFill`) showing: a Lucide `Workflow` (or `Layers`) icon 16px, the linked process label (`data.label`), an `ExpandToggleButton` (reuse existing) when `data.subEnds` is non-empty, the update badge when `data.updateAvailable` (small `text-accent` dot + `t("subprocess.updateAvailable")` tooltip), and `<SubprocessHandles ends={data.subEnds ?? []} />`.

- [ ] **Step 2: Dynamic handles**

Add a component:
```tsx
function SubprocessHandles({ ends }: { ends: SubEnd[] }) {
  return (
    <>
      <Handle id={SUBPROCESS_IN_HANDLE} type="target" position={Position.Left} />
      {ends.length === 0 ? (
        <Handle id={PRIMARY_END_HANDLE} type="source" position={Position.Right} />
      ) : (
        ends.map((end, i) => (
          <Handle
            key={end.key}
            id={end.key}
            type="source"
            position={Position.Right}
            style={{ top: `${((i + 1) / (ends.length + 1)) * 100}%` }}
            title={end.title}
          />
        ))
      )}
    </>
  );
}
```
Import `Position` from `@xyflow/react` and `SubEnd`/`PRIMARY_END_HANDLE`/`SUBPROCESS_IN_HANDLE` from `@/lib/subprocess-embed`.

- [ ] **Step 3: Primary-end inspector toggle + i18n**

In `page.tsx` inspector (find the node-properties panel — search `git grep -n 'assignee' src/app/maps/[mapId]/page.tsx` to locate the inspector field block), when the selected node `nodeType === "end"`, render a checkbox bound to `data.isPrimaryEnd` that updates the node (`setNodes` + autosave) setting `isPrimaryEnd`. Add i18n keys to BOTH `en` and `ko` in `i18n-messages.ts`: `nodeType.subprocess` (`"Subprocess"` / `"하위프로세스"`), `subprocess.updateAvailable` (`"Newer published version available"` / `"새 발행본 있음"`), `node.primaryEnd` (`"Primary end"` / `"대표 끝"`).

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`
Expected: build succeeds. Then Playwright (system Chrome, on-demand per `docs/lessons/browser-verification.md`): load a map, programmatically/visually confirm a node with `nodeType:"subprocess"` renders the new shape with a left input handle and right end handles. Record the exact command + observed result in the task report (reading code ≠ verified).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/process-node.tsx frontend/src/lib/i18n-messages.ts "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(node): subprocess node shape + dynamic end handles + primary-end toggle — 참조노드 렌더"
```

---

## Task 5: Composite tree swap — feed render polish from linked maps

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (add resolved-graph cache + loader; redefine `fullGraph` as the composite tree; the `materialize` effect 659-682; `inlineComposition` 3577-3802 child source 3606-3611; `ancestorContextNodes` 3820+ ; `toggleInlineExpand` cascade 3501-3539; `expandAll` 3546-3564)

**Interfaces:**
- Consumes: `buildCompositeTree`, `deriveSubEnds`, `getResolvedGraph` (Tasks 2-3).
- Produces: `fullGraph` (the existing state name, kept) now holds the **composite tree** (root flat + embedded linked-map children with synthetic `parent_node_id`). All existing consumers keep reading `fullGraph` unchanged.

**Context for the implementer:** Today `fullGraph` is fetched once per version via `getFullGraph` (`refreshFullGraph`, 716-727) and children are `fullGraph.nodes.filter(n => n.parent_node_id === host)` — same-version hierarchy. The new model has NO same-version hierarchy; a subprocess host's children come from `getResolvedGraph(host.linked_map_id, host.follow_latest, host.linked_version_id)`. We keep the variable `fullGraph` and every consumer, but rebuild its value from the root graph + a resolved-graph cache.

- [ ] **Step 1: Add resolved-graph cache + loader**

Add state near `fullGraph` (466): `const [resolvedCache, setResolvedCache] = useState<Map<string, Graph>>(new Map());` keyed by a stable host-link key. Add a helper `const linkKey = (n: { linked_map_id:number|null; follow_latest:boolean; linked_version_id:number|null }) => n.linked_map_id == null ? null : `${n.linked_map_id}:${n.follow_latest ? "latest" : n.linked_version_id ?? "latest"}`;`. Add an effect that, whenever the set of hosts needing embed changes (expanded ∪ drill path — see Task 7; for Task 5 use `expandedInline`), for each host not yet cached, calls `getResolvedGraph(...)` and inserts into `resolvedCache` by `linkKey`. Guard against refetch (skip if key present). Resolved graphs are immutable per resolved version → never invalidate except on explicit update (Task 9).

- [ ] **Step 2: Build the root flat graph**

Replace `refreshFullGraph` so the **root** flat nodes come from the current root `getGraph(versionId)` result (the `nodes`/`edges` already loaded as `nodes` state are the root scope in the new model; convert them to `FlatNode[]` with `parent_node_id:null`, or keep using `getFullGraph` which now returns the flat root). Simplest: keep `getFullGraph(versionId)` for the root flat list (backend returns flat nodes, `parent_node_id` absent → coerce to null in `toAppNodes`/here).

- [ ] **Step 3: Compute the composite tree memo and assign it to `fullGraph`**

Introduce `const rootFlat = useMemo(...)` (root flat nodes+edges from getFullGraph result, parent_node_id null). Then:
```typescript
const compositeTree = useMemo<VersionGraph | null>(() => {
  if (!rootFlat) return null;
  const getEmbed = (node: FlatNode): Graph | null => {
    const key = linkKey(node);
    return key ? resolvedCache.get(key) ?? null : null;
  };
  return buildCompositeTree(rootFlat.nodes, rootFlat.edges, expandedInline, getEmbed);
}, [rootFlat, resolvedCache, expandedInline]);
```
Then make `fullGraph` resolve to `compositeTree` for all existing consumers. Two options — pick the lower-churn one after reading the consumers: (a) replace the `fullGraph` state with `compositeTree` (delete the state, alias `const fullGraph = compositeTree`) and keep `fullGraphRef` mirroring it; (b) keep `setFullGraph(compositeTree)` via an effect. Prefer (a) (no setState-in-effect, derived during render). Update `fullGraphRef`/`fullGraphVersionRef` mirrors accordingly.

- [ ] **Step 4: Point the materialize effect + inlineComposition child source at embedded children**

The materialize effect (659-682) and `inlineComposition`'s `kidsFlat = tree.nodes.filter(n => n.parent_node_id === target.id)` (3606) already read `fullGraph`/`tree` — once `fullGraph === compositeTree`, they get embedded children for free. Verify the `toAppNodes({nodes:[flat]...}, expandedId)` calls still produce correct `scopeId` (the host id). No structural change expected; confirm by reading.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`. Then Playwright: seed a map whose node links to another map (or use the demo after Plan 3 — for now, construct via API in the test), expand the subprocess node, confirm the linked map's nodes appear as a read-only lane to the right (pushing right-neighbors, no size change, slide animation). Confirm collapsing removes them. Record commands + observations.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(canvas): composite tree — embed linked-map resolved graphs into render polish — 데이터소스 교체"
```

---

## Task 6: Remove inline child-editing paths

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (remove the editing symbols listed below)
- Modify: `frontend/src/lib/inline-expand.ts` (remove `splitByScope` 145-152, `checkScopeInvariant` 155-170 if now unused)

**Context:** Editing is root-only; embedded children are read-only. Remove every path that edited child scopes via `?parent=` or that created in-version children.

- [ ] **Step 1: Remove child-scope save + edit overlay**

Delete these symbols and their state/refs/effects/usages (use `git grep -n` to find every reference; remove orphaned imports/handlers your deletion creates, per surgical-changes rule):
- `runCreateSubprocess` (771-848), `createSubprocess` (851-863), `subprocessPrompt` state (477-480) + its modal + `pendingSubprocessPick` (482-485) + its pick flow.
- `createChildEdge` (~1879), `addChildNode` (~1953), `saveChildScopeAfterDelete` (~2401), the child-move save (~2428-2451), child-edit overlay: `childEdits`/`setChildEdits`/`childEditsRef` (489, 628, 652-653), `dirtyChildScopesRef` (629) + the debounced child-save flush (~2944-2965) + `childSaveTimerRef`.
- `deleteInvariantPrompt` state (487) + its modal + the invariant delete branch (~1088-1110, ~2460-2490).
- In the scope-load effect (1347+) delete the child-edit/dirty-scope reset lines (1409-1414) now that those states are gone.

- [ ] **Step 2: Make embedded children read-only (no edit distribution)**

In `handleNodesChange` (685-704): children are no longer editable, so child changes must NOT be written back as edits. Keep React Flow *measurement/selection* changes for children (so layout/measure works) but drop position/data *persistence*. Simplest correct rule: keep routing `dimensions`/`select` changes to `setChildNodes`, but ignore `position`/`remove` changes for children (they're derived + read-only). Re-read `docs/lessons/canvas-react-flow.md` before editing this — measurement injection must stay or children render `visibility:hidden`.

In `displayNodes` (3895-3942): embedded children become `selectable:true` (for click-to-expand) but `draggable:false, deletable:false, connectable:false` always (drop the `isActive` editability — there is no active *editable* child scope anymore; editability belongs to the root frame only). Keep the dim/opacity treatment for read-only context.

- [ ] **Step 3: Simplify `saveCurrentScope`**

`saveCurrentScope` (742-767) currently passes `currentParentId` to `saveGraph`. In the new model only the root is editable; remove the `currentParentId` argument (Task 2 dropped it from `saveGraph`). When the active scope is a read-only deep view (Task 7), `saveCurrentScope` must no-op — add `if (currentScopeIsReadOnly) return;` (Task 7 defines that flag; for Task 6 the only scope is root, so saving root is correct).

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`. Expected: clean (all orphan references removed). Playwright: confirm root editing (add/move/delete a root node, rename, group) still works and autosaves; confirm an expanded subprocess child cannot be dragged/deleted/edited. Record commands + observations.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/inline-expand.ts
git commit -m "refactor(canvas): remove inline child-editing paths — 하위 편집 경로 제거(루트 전용 편집)"
```

---

## Task 7: Read-only deep-view navigation (repurpose scope/ancestor/camera)

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`Scope` type 194; scope-load effect 1347-1467; `navigateTo` 1679-1691; `buildScopesTo` 1694-1713; `focusScope`/`closeScope`/breadcrumb 1720-1767; `ancestorContextNodes` 3820+)

**Interfaces:**
- Produces: drilling into a subprocess node opens its linked map **read-only** as the active region, with ancestor wrapping + camera compensation preserved; editing disabled in that scope.

**Context:** Decision this session = keep deep view as read-only. `Scope` becomes a tagged union so the loader knows whether to fetch editable root (`getGraph`) or read-only linked map (`getResolvedGraph`).

- [ ] **Step 1: Extend the `Scope` type**

```typescript
type Scope =
  | { kind: "root"; title: string }
  | { kind: "sub"; hostId: string; mapId: number; pinned: number | null; followLatest: boolean; title: string };
```
Replace `currentParentId` derivation: keep a `currentScope = scopes[activeIndex]`; `currentScopeIsReadOnly = currentScope.kind === "sub"`. Where `currentParentId` was used to identify "which host's children am I in", map it to `currentScope.kind === "sub" ? currentScope.hostId : null` so ancestor/composite logic is unchanged.

- [ ] **Step 2: Branch the scope-load effect**

In the loader (1347+): if `currentScope.kind === "root"` → `getGraph(versionId)` (editable, as today). If `"sub"` → `getResolvedGraph(currentScope.mapId, currentScope.followLatest, currentScope.pinned)` and load nodes as **read-only** (`setNodes(toAppNodes(graph, currentScope.hostId).map(n => ({...n, draggable:false, selectable:true, deletable:false, connectable:false})))`). Keep `focusCamRef` camera compensation (1450-1466) for both. Keep the "expansion stays, active region just moves" expand-preservation logic but base it on the composite tree's `parent_node_id` (already synthetic). The drill path = the `scopes` chain; ensure each `sub` scope's linked map is in `resolvedCache` (trigger the Task-5 loader to include drill-path hosts, not just `expandedInline`).

- [ ] **Step 3: navigate-into-subprocess action**

Add a `drillIntoSubprocess(hostNodeId)` that, given a subprocess node, pushes a `sub` scope (`{kind:"sub", hostId, mapId:node.linkedMapId, pinned:node.linkedVersionId, followLatest:node.followLatest, title:node.label}`) via `navigateTo`. Wire it to the embedded child double-click / the subprocess node's "open" affordance (spec §6: click/double-click = next-level expand; choose double-click to open deep view, single expand toggle stays inline). `navigateTo` no longer needs to `saveCurrentScope` when leaving a read-only scope — guard it (`if (!currentScopeIsReadOnly) await saveCurrentScope();`).

- [ ] **Step 4: ancestorContextNodes**

`ancestorContextNodes` (3820+) reads `currentParentId` and `fullGraph` (now composite tree) — once `currentParentId` maps to `currentScope.hostId`, ancestor wrapping renders for `sub` scopes. Confirm it walks the composite tree's synthetic `parent_node_id` chain correctly. No structural change expected; verify by reading + Playwright.

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`. Playwright: drill into a subprocess (double-click), confirm the linked map opens read-only as active region with dimmed ancestor wrapping + no camera jump; confirm you cannot edit; drill back out via breadcrumb and confirm root editing resumes and expansion is preserved. Record commands + observations.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx"
git commit -m "feat(canvas): read-only deep-view navigation into linked subprocess — 읽기전용 딥뷰"
```

---

## Task 8: Process library panel + drag-to-create

**Files:**
- Create: `frontend/src/components/process-library-panel.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (mount panel; canvas `onDrop`/`onDragOver`)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `listLibraryProcesses`, `LibraryProcess`, `closesCycle`, `getResolvedGraph`, `genId`, `nodeSizeOf`.
- Produces: dragging a library row onto the canvas creates a `subprocess` root node linked to that map.

- [ ] **Step 1: Build the panel**

`ProcessLibraryPanel({ currentMapId, onClose })`: fetch `listLibraryProcesses()` on mount; build `refsByMap = new Map(rows.map(r => [r.map_id, r.refs]))`; client-side search filter (`text-fine` input); each row draggable (`draggable`, `onDragStart` sets `e.dataTransfer.setData("application/bpm-process", String(map_id))`). A row is **disabled** (not draggable, dimmed, tooltip `t("library.cycleBlocked")`) when `map.map_id === currentMapId || closesCycle(map.map_id, currentMapId, refsByMap)`. Use design tokens only (`bg-surface`, `border-hairline`, `--shadow-md`, `text-caption`). Lucide icons 16px.

- [ ] **Step 2: Canvas drop → create subprocess node**

Add `onDragOver` (`e.preventDefault()`) and `onDrop` to the React Flow pane wrapper. On drop: read `map_id` from `dataTransfer`; ignore if absent or read-only; `reactFlow.screenToFlowPosition({x:e.clientX,y:e.clientY})` for position; resolve default pinned via the library row (`latest_published_version_id ?? latest_version_id`); fetch `getResolvedGraph(mapId, false, pinned)` to derive `subEnds = deriveSubEnds(graph)` and the title (the map name from the library row); create an `AppNode` with `id:genId()`, `type:"process"`, `data:{ nodeType:"subprocess", label:mapName, linkedMapId:mapId, linkedVersionId:pinned, followLatest:false, subEnds, ... }`; `setNodes(cur => [...cur, node])`; `scheduleAutoSave()`. Backend rejects cycles on save (422) → surface via existing save-error toast. (Client pre-disables in the panel; the save guard is the backstop.)

- [ ] **Step 3: i18n + mount**

Add `library.title` (`"Process library"`/`"프로세스 라이브러리"`), `library.search` (`"Search…"`/`"검색…"`), `library.cycleBlocked` (`"Would create a reference cycle"`/`"순환 참조가 됩니다"`), `library.empty` (`"No processes"`/`"프로세스 없음"`). Mount the panel in the left sidebar area (follow how `editor-left-sidebar.tsx` is mounted) behind a toggle button.

- [ ] **Step 4: Verify**

Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`. Playwright: open the library, drag a process onto the canvas, confirm a subprocess node appears linked to that map (expand it → embedded read-only lane), confirm a cycle-forming row is disabled. Record commands + observations.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/process-library-panel.tsx "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(library): process library panel + drag-to-create subprocess node — 라이브러리 드래그 생성"
```

---

## Task 9: Multi-exit edge persistence + version update badge/update action

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (connect/onConnect handling; update-badge derivation; update action; follow-latest toggle in inspector)
- Modify: `frontend/src/lib/i18n-messages.ts`

**Interfaces:**
- Consumes: `LibraryProcess.latest_published_version_id`, `deriveSubEnds`, `getResolvedGraph`, `PRIMARY_END_HANDLE`, `SUBPROCESS_IN_HANDLE`.
- Produces: edges from a subprocess end handle persist `source_handle`; edges into a subprocess persist `target_handle="in"`; update badge + "update" action; per-node follow-latest toggle.

- [ ] **Step 1: Persist handle ids on connect**

In the connect path (find via `git grep -n 'onConnect\|applyFlowEdges\|source_side' src/app/maps/[mapId]/page.tsx` — note from memory there are TWO edge-creation paths: handle-drag `onConnect` and node-drop `applyFlowEdges`), when an edge's source is a subprocess node, set `source_handle = connection.sourceHandle` (the end key — `PRIMARY_END_HANDLE` or end title); when target is a subprocess node set `target_handle = SUBPROCESS_IN_HANDLE`. Ensure `buildGraph` already serializes these (Task 2 Step 4) and `toAppEdges` prefers raw handle ids when present (Task 2 Step 4). Branch-label edges from a decision keep the diamond source (existing edge-creation memory — do not regress).

- [ ] **Step 2: Update badge derivation**

When loading the library list (cache it in page state), compute per subprocess node `updateAvailable = !followLatest && linkedVersionId != null && row.latest_published_version_id != null && row.latest_published_version_id > linkedVersionId`. Inject into `data.updateAvailable` so the node badge (Task 4) shows. Recompute on library refresh.

- [ ] **Step 3: Update action + broken secondary-end warning**

Add an "update to latest" action (inspector button on a subprocess node when `updateAvailable`): sets `linkedVersionId = row.latest_published_version_id`, refetches `getResolvedGraph`, recomputes `subEnds`, and detects **broken secondary edges** — root edges whose `source === thisNode.id` and `source_handle` is neither `PRIMARY_END_HANDLE` nor any current end title → mark them broken (visual warning via existing edge styling + a toast `t("subprocess.endRebindWarn")`). Primary end stays bound by `PRIMARY_END_HANDLE`. Persist via autosave.

- [ ] **Step 4: Follow-latest toggle**

In the subprocess inspector, a checkbox bound to `data.followLatest`; toggling sets `followLatest` and clears/keeps `linkedVersionId` per spec §5 (follow_latest ignores pinned at render). Persist + refetch resolved (linkKey changes → Task-5 loader fetches latest).

- [ ] **Step 5: i18n + verify**

Add `subprocess.update` (`"Update to latest"`/`"최신으로 업데이트"`), `subprocess.followLatest` (`"Follow latest published"`/`"최신 발행본 자동 추종"`), `subprocess.endRebindWarn` (`"Some branch connections no longer match the updated ends"`/`"일부 분기 연결이 갱신된 끝과 맞지 않습니다"`). Run: `cd frontend && npm run lint && npx tsc --noEmit && npm run build`. Playwright: create a subprocess linked to a pinned version, publish a newer version of that map, confirm the badge appears, apply update, confirm a secondary-end edge that no longer matches is flagged; confirm a saved+reloaded graph preserves `source_handle`/`target_handle` (roundtrip). Record commands + observations.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/maps/[mapId]/page.tsx" frontend/src/lib/i18n-messages.ts
git commit -m "feat(subprocess): multi-exit handle persistence + version update badge/action — 다중출구·버전갱신"
```

---

## Out of scope for Plan 2 (→ Plan 3)

- Drop nested demo data + re-seed flat demo (1 start, multiple ends, primary end, subprocess links, pinned/follow-latest examples); reset dev.db. **Do not merge to main until Plan 3 reseeds — the current dev.db holds old nested data incompatible with the flat model.**

## Plan self-review notes

- **Spec coverage:** §3.1 node fields → T2; §3.2 edge handles → T2/T9; §3.3 validation → T1 backend (already done in Plan 1) + surfaced via toast; §4 connection/primary/cycle → T8 (cycle-disable) + T9 (handles); §5 version flow → T9; §6 read-only embed + polish kept → T5 (composite tree) + T7 (deep view) + T6 (editing removed); §7 library drag → T8; §8 removals → T6; §9 migration → Plan 3.
- **Decision applied:** read-only deep view kept (T7) per this session's answer; `ancestorContextNodes`/`focusCamRef` repurposed read-only rather than deleted.
- **Type consistency:** `linkKey`, `SubEnd`, `PRIMARY_END_HANDLE`, `SUBPROCESS_IN_HANDLE`, `embedId`, `closesCycle`, `buildCompositeTree`, `deriveSubEnds` are the cross-task contracts — defined in T2/T3, consumed by T4-T9 under those exact names.
- **Known risk:** Tasks 5-7 are large edits to a 5947-line file; each ends buildable + Playwright-verified. If T5's `fullGraph`→`compositeTree` swap surfaces a consumer that mutated `fullGraph` (write, not read), escalate — the composite tree is derived/read-only.
