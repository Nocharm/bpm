# 인라인 하위 프로세스 펼치기/접기 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 하위 프로세스 드릴인을 자유 창(`ScopeWindow`)에서 같은 캔버스 인라인 펼치기/접기로 전환한다.

**Architecture:** 펼친 자식을 메모리의 `fullGraph`에서 읽어 `scopeId` 태그를 달고 현재 `nodes`/`edges` state에 합친다. ReactFlow 입력은 파생 useMemo(`displayNodes`/`styledEdges`)에서 A→B 숨김·게이트웨이 합성·통합 `layoutWithDagre(LR)`로 구성한다. 저장은 `scopeId`로 분리해 스코프별 PUT. 백엔드 무변경.

**Tech Stack:** Next.js / React / TypeScript / @xyflow/react / dagre. 설계 근거는 `docs/superpowers/specs/2026-06-17-inline-subprocess-expand.md`.

**검증 전제:** 프론트 단위 테스트 하네스 없음 → 각 Task의 verify는 `npm run lint`·`npx tsc --noEmit`·`npm run build` + 명시된 수동 캔버스 확인. 백엔드 무변경이라 `pytest`/`ruff`는 회귀 확인용으로만.

---

## File Structure

| 파일 | 책임 | 신규/수정 |
|------|------|-----------|
| `frontend/src/lib/expansion-config.ts` | 펼침 캡 상수(노드/깊이) 단일 출처 | **신규** |
| `frontend/src/lib/inline-expand.ts` | 순수 로직: 자식 수집·게이트웨이 합성·깊이/노드수 계산·scope-split | **신규** |
| `frontend/src/lib/canvas.ts` | `AppNode.data`에 `scopeId` 추가, `buildGraph` scope-split 지원 | 수정 |
| `frontend/src/lib/i18n-messages.ts` | 신규 토스트·모달·메뉴 메시지 | 수정 |
| `frontend/src/components/process-node.tsx` | 펼침 토글 버튼(DrillButton 대체) | 수정 |
| `frontend/src/components/expand-invariant-modal.tsx` | 후속없음·삭제불변식 확인 모달 | **신규** |
| `frontend/src/app/maps/[mapId]/page.tsx` | 상태·파생 렌더·저장·생성/삭제·버튼·창 제거 | 수정 |

---

## Phase 1 — 캡 설정 + 순수 로직 모듈 (기반)

### Task 1.1: 펼침 캡 config 모듈

**Files:**
- Create: `frontend/src/lib/expansion-config.ts`

- [ ] **Step 1: 모듈 작성**

```ts
/** 인라인 펼침 상한. 추후 /admin 서버값으로 교체 가능한 단일 seam — 하드코딩 금지(spec D3). */
export interface ExpansionLimits {
  /** 동시 펼침으로 캔버스에 추가되는 인라인 자식 노드 총수 상한 */
  maxNodes: number;
  /** 펼침 중첩 깊이 상한 */
  maxDepth: number;
}

export const EXPANSION_LIMITS: ExpansionLimits = {
  maxNodes: 300,
  maxDepth: 5,
};
```

- [ ] **Step 2: 검증** — `cd frontend && npx tsc --noEmit` → 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/expansion-config.ts
git commit -m "feat(canvas): add expansion limits config module — 펼침 캡 단일 출처"
```

### Task 1.2: 순수 로직 모듈 (자식 수집·게이트웨이·캡 계산)

**Files:**
- Create: `frontend/src/lib/inline-expand.ts`
- Reference: `frontend/src/lib/api.ts`(`VersionGraph`/`Graph`/`GraphNode` 타입), `frontend/src/lib/canvas.ts`(`AppNode`/`Edge`/`toAppNodes`/`toAppEdges`)

- [ ] **Step 1: 자식 수집 — 펼친 집합의 모든 후손 노드/엣지를 fullGraph에서 추출**

`fullGraph.nodes`는 `parent_node_id` 포함 평면 배열. 펼친 노드 id 집합 `expanded`가 주어지면, 각 펼친 노드의 직속 자식 + (그 자식도 펼쳐졌으면) 재귀 후손을 반환.

```ts
import type { VersionGraph, GraphNode, GraphEdge } from "@/lib/api";

/** expanded에 속한 노드들의 후손(재귀) 노드 id 집합 — 중첩 펼침 지원 */
export function collectExpandedDescendants(
  fullGraph: VersionGraph,
  expanded: Set<string>,
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const childrenByParent = new Map<string, GraphNode[]>();
  for (const n of fullGraph.nodes) {
    if (n.parent_node_id == null) continue;
    const list = childrenByParent.get(n.parent_node_id) ?? [];
    list.push(n);
    childrenByParent.set(n.parent_node_id, list);
  }
  const resultNodes: GraphNode[] = [];
  const resultIds = new Set<string>();
  // BFS: 펼친 노드의 자식을 넣고, 그 자식이 펼쳐졌으면 더 내려간다
  const queue = [...expanded];
  while (queue.length) {
    const parentId = queue.shift()!;
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (resultIds.has(child.id)) continue;
      resultIds.add(child.id);
      resultNodes.push(child);
      if (expanded.has(child.id)) queue.push(child.id);
    }
  }
  // 수집된 노드들 사이의 엣지(= 자식 스코프 내부 엣지)만
  const edges = fullGraph.edges.filter(
    (e) => resultIds.has(e.source_node_id) && resultIds.has(e.target_node_id),
  );
  return { nodes: resultNodes, edges };
}
```

> 참고: `GraphEdge`의 정확한 필드명(`source_node_id`/`target_node_id` vs `source`/`target`)은 구현 시 `api.ts`에서 확인해 맞춘다.

- [ ] **Step 2: 게이트웨이 합성 — 펼친 P마다 P→Start, End→후속T**

자식 노드의 타입 판별(`nodeType === "start" | "end"`)로 Start/End를 찾고, 현재 스코프에서 `source === P`인 엣지의 target을 후속 T로 본다.

```ts
import type { Edge } from "@xyflow/react";
import type { AppNode } from "@/lib/canvas";

const GATEWAY_PREFIX = "gw:";

/** 게이트웨이는 view 전용(저장·state 비포함). dagre 입력 + 렌더용. */
export function buildGatewayEdges(
  expanded: Set<string>,
  childNodes: AppNode[],
  scopeEdges: Edge[], // 현재 스코프 state 엣지 (A→B 포함, 숨기기 전)
): Edge[] {
  const startsByParent = new Map<string, string[]>();
  const endsByParent = new Map<string, string[]>();
  for (const n of childNodes) {
    const parent = n.data.scopeId;
    if (parent == null || !expanded.has(parent)) continue;
    if (n.data.nodeType === "start")
      startsByParent.set(parent, [...(startsByParent.get(parent) ?? []), n.id]);
    if (n.data.nodeType === "end")
      endsByParent.set(parent, [...(endsByParent.get(parent) ?? []), n.id]);
  }
  const gateways: Edge[] = [];
  for (const p of expanded) {
    for (const start of startsByParent.get(p) ?? [])
      gateways.push(gateway(`${p}->${start}`, p, start));
    const successors = scopeEdges.filter((e) => e.source === p).map((e) => e.target);
    for (const end of endsByParent.get(p) ?? [])
      for (const t of successors) gateways.push(gateway(`${end}->${t}`, end, t));
  }
  return gateways;
}

function gateway(key: string, source: string, target: string): Edge {
  return { id: `${GATEWAY_PREFIX}${key}`, source, target, data: { gateway: true } };
}

export function isGatewayEdge(edge: Edge): boolean {
  return edge.id.startsWith(GATEWAY_PREFIX);
}
```

- [ ] **Step 3: 캡 계산 — 노드수/깊이**

```ts
import { EXPANSION_LIMITS } from "@/lib/expansion-config";
import type { VersionGraph } from "@/lib/api";

/** expanded 적용 시 인라인 추가 노드수와 최대 펼침 깊이를 캡과 비교 */
export function checkExpansionLimits(
  fullGraph: VersionGraph,
  expanded: Set<string>,
): { nodeCount: number; depth: number; exceeds: boolean } {
  const { nodes } = collectExpandedDescendants(fullGraph, expanded);
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = fullGraph.nodes.find((n) => n.id === id);
    while (cur?.parent_node_id != null) {
      d += 1;
      cur = fullGraph.nodes.find((n) => n.id === cur!.parent_node_id);
    }
    return d;
  };
  const depth = nodes.reduce((max, n) => Math.max(max, depthOf(n.id)), 0);
  const nodeCount = nodes.length;
  return {
    nodeCount,
    depth,
    exceeds: nodeCount > EXPANSION_LIMITS.maxNodes || depth > EXPANSION_LIMITS.maxDepth,
  };
}
```

- [ ] **Step 4: scope-split — state 노드/엣지를 scopeId별로 그룹핑**

```ts
/** 저장용: scopeId별 노드/엣지 묶음. 게이트웨이는 호출 전 제거되어야 함. */
export function splitByScope<N extends { data: { scopeId: string | null } }>(
  nodes: N[],
): Map<string | null, N[]> {
  const map = new Map<string | null, N[]>();
  for (const n of nodes) {
    const k = n.data.scopeId ?? null;
    map.set(k, [...(map.get(k) ?? []), n]);
  }
  return map;
}
```

- [ ] **Step 5: 검증** — `npx tsc --noEmit` → 에러 없음. (단위테스트 하네스 없음 — 추후 vitest 도입 시 이 파일이 첫 대상.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/inline-expand.ts
git commit -m "feat(canvas): add inline-expand pure logic (descendants, gateways, limits, scope-split) — 인라인 펼침 순수 로직"
```

### Task 1.3: `AppNode.data.scopeId` 타입 추가

**Files:**
- Modify: `frontend/src/lib/canvas.ts` (`AppNode`/`NodeData` 타입 정의부)

- [ ] **Step 1:** `NodeData`(또는 `AppNode["data"]` 정의)에 `scopeId: string | null` 추가. 주석: `// 이 노드가 속한 스코프(parent_node_id). 인라인 펼침/scope-split 저장 식별용`.
- [ ] **Step 2:** `toAppNodes(graph, parentId)`가 각 노드에 `scopeId: parentId`를 채우도록 수정. 호출부(`page.tsx:818`)는 `toAppNodes(graph, currentParentId)`로.
- [ ] **Step 3: 검증** — `npx tsc --noEmit` → 기존 호출부 타입 에러를 모두 해소.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): tag AppNode with scopeId — scope-split 식별자"`

---

## Phase 2 — 인라인 펼침/접기 렌더 (창과 병존)

> 이 단계에서는 ScopeWindow를 **제거하지 않는다**. 인라인이 완성될 때까지 양쪽 공존 → 각 단계에서 앱이 동작.

### Task 2.1: `expandedInline` 상태 + 자식 로드

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1:** `const [expandedInline, setExpandedInline] = useState<Set<string>>(new Set());` 추가(`expandedOutline:293` 인근).
- [ ] **Step 2:** 스코프/버전 전환 effect(`807-869`)에서 `setExpandedInline(new Set())`로 초기화(재로딩 시 모두 접힘 — spec 5.2).
- [ ] **Step 3:** 토글 콜백 `toggleInlineExpand(nodeId)`: 캡 검사(`checkExpansionLimits`) 후 `setExpandedInline`에 add/remove. 캡 초과면 모달(Task 4.x와 연동, 우선은 console 경고 후 진행 보류).
- [ ] **Step 4: 검증** — `npx tsc --noEmit`.

### Task 2.2: 파생 렌더 — 자식 합성 + 통합 dagre

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (`displayNodes:2533`, `styledEdges:2545`)

- [ ] **Step 1:** `expandedInline`가 비면 기존 동작 그대로(early return). 비어있지 않으면:
  - `collectExpandedDescendants(fullGraph, expandedInline)` → `toAppNodes(.., 각 노드 parent_node_id)` + `toAppEdges`.
  - 병합 노드 = 현재 `nodes` + 자식 노드. 병합 엣지(레이아웃용) = `현재 edges − {source===펼친P} + buildGatewayEdges(...)`.
  - `layoutWithDagre(병합노드, 레이아웃엣지)` 1회 → 좌표.
  - 메모이즈 의존성: `[nodes, edges, expandedInline, fullGraph]`.
- [ ] **Step 2:** `styledEdges`에서: `source===펼친P`인 엣지 → `hidden:true`. 게이트웨이 엣지 추가(faint, dashed). 선택 노드가 P 서브트리에 속하면 해당 게이트웨이 opacity 상향.
- [ ] **Step 3: 검증(수동)** — `npm run dev`, 자식 있는 노드 펼침 시: 자식이 LR로 P와 후속 사이에 삽입, A→B 사라짐, 게이트웨이 흐리게 표시, 접으면 원복. `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): inline expand renders child scope in unified LR layout — 인라인 펼침 렌더"`

### Task 2.3: 펼침 토글 버튼 (DrillButton 대체)

**Files:**
- Modify: `frontend/src/components/process-node.tsx`(`DrillButton:172`, 사용 `244`/`273`)
- Modify: `frontend/src/lib/node-actions.ts`(`onDrill` → `onToggleExpand`)

- [ ] **Step 1:** `useNodeActions`에 `onToggleExpand?(nodeId)` + `expandedInline` 여부 prop 추가. `DrillButton`을 펼침/접힘 아이콘 토글(Lucide `ChevronRight`/`ChevronDown`, 16px strokeWidth 1.5)로 교체.
- [ ] **Step 2:** `page.tsx`에서 `onDrill: handleDrillById`(`2770`)를 `onToggleExpand: toggleInlineExpand`로 교체(드릴인 진입점은 Phase 6에서 제거하므로 우선 병존 — 토글은 신규 prop으로).
- [ ] **Step 3: 검증** — 버튼 클릭 시 펼침/접힘. tsc/lint.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): node expand/collapse toggle button — 펼침 토글 버튼"`

---

## Phase 3 — 인라인 편집 + scope-split 저장

### Task 3.1: `buildGraph`/저장 scope-split

**Files:**
- Modify: `frontend/src/lib/canvas.ts`(`buildGraph`)
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`(`saveCurrentScope:449-491`)

- [ ] **Step 1:** `buildGraph`가 단일 스코프 대신 `scopeId`별 payload를 만들도록 헬퍼 `buildScopedGraphs(nodes, edges, groups)` 추가: 게이트웨이(`isGatewayEdge`) 제외 → `splitByScope` → 각 스코프 payload(노드 + 그 스코프 source 엣지 + 그 스코프 그룹). 숨긴 A→B는 현재 스코프에 포함.
- [ ] **Step 2:** `saveCurrentScope`가 변경된 각 스코프에 `saveGraph(versionId, scopeId, payload)` PUT(병렬 `Promise.all`). dirty를 스코프별로 좁혀 미변경 스코프는 PUT 생략.
- [ ] **Step 3: 검증(수동)** — 펼친 자식 노드 라벨 수정 → 접고 다시 펼침 시 유지, 부모 스코프 저장이 자식을 덮지 않음(네트워크 탭에서 자식 스코프 PUT 확인). tsc/lint/build.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): scope-split save for inline-edited children — 스코프 분리 저장"`

### Task 3.2: 펼침/접기 비-dirty 보장

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`

- [ ] **Step 1:** `toggleInlineExpand`는 `nodes`/`edges` raw state를 바꾸지 않음(자식은 파생 레이어에서만 합성) → autosave 미발생 확인. 자식 **구조 편집**만 dirty.
- [ ] **Step 2: 검증(수동)** — 펼침/접힘만 반복 시 save 요청 0건(네트워크 탭). tsc/lint.
- [ ] **Step 3: Commit** — `git commit -m "fix(canvas): expand/collapse is pure view (non-dirty) — 펼침 비저장"`

---

## Phase 4 — 모두 펼치기/접기 + 캡 모달

### Task 4.1: 캡 확인 모달 + 모두펼치기/접기 버튼

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`(브레드크럼/Panel 영역 `3060-3071` 인근)
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1:** `expandAll()`: `fullGraph`의 모든 `has_children` 노드 id로 후보 Set 구성 → `checkExpansionLimits` → 초과면 확인 모달(계속 시 진행) → `setExpandedInline(후보)`. `collapseAll()`: `setExpandedInline(new Set())`.
- [ ] **Step 2:** 버튼 2개 추가(Lucide `Maximize2`/`Minimize2`, `text-caption`, 컴팩트). i18n 키 `canvas.expandAll`/`canvas.collapseAll`/`canvas.expandCapWarning`(노드수·깊이 인자).
- [ ] **Step 3: 검증(수동)** — 모두펼치기 시 전 하위 LR 통합, 캡 초과 맵에서 모달, 모두접기 원복. 대량(>100) 시 프리징 없는지(필요 시 setState 1회 배치). tsc/lint/build.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): expand-all / collapse-all with cap modal — 모두 펼치기/접기 + 캡"`

---

## Phase 5 — 하위 프로세스 불변식

### Task 5.1: 생성 자동 생성 + 후속없음 모달

**Files:**
- Create: `frontend/src/components/expand-invariant-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`(컨텍스트 메뉴 `ctx.openChild:2424` 대체)
- Modify: `frontend/src/lib/i18n-messages.ts`

- [ ] **Step 1:** 컨텍스트 메뉴 항목을 "Create subprocess"로(process·자식없음 노드만). 핸들러 `createSubprocess(nodeId)`:
  - 현재 스코프에 `source===nodeId` 엣지 없으면 모달 **[Cancel]/[Pick node]/[Create End]**(`expand-invariant-modal.tsx`).
    - Pick node: 선택 모드 진입 → 클릭한 노드로 `nodeId→picked` 엣지 생성 → 진행.
    - Create End: End 노드 + `nodeId→End` 엣지 생성(현재 스코프) → 진행.
  - 진행: `genId()`로 Start/작업/End + `Start→작업→End` payload → `saveGraph(versionId, nodeId, payload)` → `refreshFullGraph()` → `setExpandedInline(add nodeId)`(자동 펼침).
- [ ] **Step 2:** i18n: `subprocess.createTitle`/`noSuccessor.*`/`pickNode`/`createEnd`.
- [ ] **Step 3: 검증(수동)** — 후속 있는 노드: 즉시 Start/작업/End 생성+펼침. 후속 없는 노드: 모달 3선택 동작. tsc/lint.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): create subprocess auto-gens Start/work/End + no-successor modal — 하위 생성 불변식"`

### Task 5.2: 삭제 불변식 검사 + 복귀

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`(`handleNodesDelete:1645` + 엣지 삭제 경로 + `onBeforeDelete`)
- Reference: `frontend/src/lib/inline-expand.ts`

- [ ] **Step 1:** `inline-expand.ts`에 `checkScopeInvariant(scopeNodes)` 추가: Start≥1 && End≥1 && 작업≥1 여부.
- [ ] **Step 2:** 삭제 시 영향 스코프별로 잔여 노드 검사. 깨지면 ReactFlow `onBeforeDelete`로 가로채 확인 모달 → 확인 시 `saveGraph(versionId, 스코프id, 빈 그래프)`(백엔드 cascade) + 부모 `has_children=false` 복귀 + 인라인 접기. 취소 시 삭제 무효.
- [ ] **Step 3: 검증(수동)** — 자식의 마지막 작업/Start/End 삭제 시도 → 모달 → 확인 시 하위 통째 삭제 + 노드 일반화, 취소 시 원복. tsc/lint/build.
- [ ] **Step 4: Commit** — `git commit -m "feat(canvas): subprocess deletion invariant modal + revert to normal node — 삭제 불변식"`

---

## Phase 6 — ScopeWindow 드릴인 제거 (AI 존속)

### Task 6.1: 드릴인 경로 제거

**Files:**
- Modify: `frontend/src/app/maps/[mapId]/page.tsx`
- Modify: `frontend/src/components/window-dock.tsx`(드릴인 칩 분기)

- [ ] **Step 1:** spec 7장 "제거" 목록 삭제: `scopes.map` ScopeWindow 루프(`3296-3502`), `handleDrillIn`/`handleDrillById`/`handleOpenSummaryChild`/`focusScope`/`closeScope`, `defaultGeom`/`bringToFront`/`zOrder`, 드릴인 컨텍스트/인스펙터 진입점, WindowDock 드릴인 분기.
- [ ] **Step 2: 유지 확인** — AI 블록(`3699-3719`)·`aiDefaultGeom`·`windowGeom`·`navigateTo`(버전전환/검색/아웃라인)·`scope-window.tsx`/`window-store.ts`/`window-dock.tsx`(AI용) 보존. 내 변경으로 생긴 orphan import만 정리(가이드라인 §3).
- [ ] **Step 3: 검증(수동)** — 드릴인 창 더 이상 안 뜸(펼침으로 대체), AI 채팅 창 정상(열기/이동/리사이즈/최소화→dock 복원). `npx tsc --noEmit`·`npm run lint`·`npm run build` 모두 green(미사용 심볼 0).
- [ ] **Step 4: Commit** — `git commit -m "refactor(canvas): remove drill-in ScopeWindow, keep AI chat window — 드릴인 창 제거"`

### Task 6.2: 브레드크럼/아웃라인 처리 (확인 후)

- [ ] **Step 1:** spec 10장-3 확인 결과 반영 — 인라인과 중복되는 브레드크럼/아웃라인 계층 UI 존치/제거 결정 적용. (확인 전엔 건드리지 않음.)

---

## Phase 7 — 마무리

### Task 7.1: 문서 + 진행 기록 + 최종 검증

- [ ] **Step 1:** `PROGRESS.md` 한 줄 갱신(`rules/common/git.md`): 인라인 하위 프로세스 펼치기/접기 전환 요약.
- [ ] **Step 2:** `docs/spec.md` 하위 프로세스 UX 섹션을 인라인 모델로 갱신(드릴인 창 → 펼치기/접기).
- [ ] **Step 3: 최종 검증** — `cd frontend && npm run lint && npx tsc --noEmit && npm run build` 모두 exit 0. `cd backend && .venv/bin/python -m pytest tests/ -q && .venv/bin/ruff check app/ tests/`(회귀 확인). 수동: spec §8 시나리오 전체.
- [ ] **Step 4: Commit** — `git commit -m "docs(progress): inline subprocess expand/collapse — 진행 기록"`

---

## Self-Review 체크 (작성자용)

- **Spec 커버리지**: step2(Phase2) · step3 불변식(Phase5) · step4 엣지가시성(Task2.2) · step5 로딩·캡(Phase2/4) · step6 ScopeWindow(Phase6) · 검증(Phase7) 모두 대응.
- **타입 일관성**: `scopeId`(Task1.3 도입) — `inline-expand.ts`·`buildGraph`·`splitByScope`에서 동일 사용. `GATEWAY_PREFIX`/`isGatewayEdge` 일관.
- **미확정(확인 필요)**: D6 편집성 모델, plan 분할 여부, 브레드크럼/아웃라인 존치(spec 10장).
- **하네스 부재**: 단위테스트 날조 금지 — verify는 tsc/lint/build + 명시된 수동 확인. 순수 로직은 `inline-expand.ts`로 추출해 추후 vitest 도입 시 즉시 테스트 가능.
