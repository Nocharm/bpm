# 통합(병합) 비교 화면 재작성 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 좌/우 분리 비교 화면을 단일 병합 캔버스로 재작성 — 저장 좌표 무시·연결 기반 자동배치로 추가/삭제 엣지와 추가/삭제/변경 노드를 한 화면에 표현하고, 빈 캔버스(dev-auth 403 레이스) 버그를 함께 고친다.

**Architecture:** 두 버전 그래프를 계보 키(`source_node_id ?? id`)로 합쳐 union 그래프(`merge-diff.ts`)를 만들고, 기존 `layoutWithDagre`(rankdir LR)로 좌표를 산정해 단일 읽기전용 ReactFlow에 렌더한다. 노드/엣지는 status별 색(기존 `ProcessNode` diff 링 + 엣지 dash). 변경 목록 클릭 시 `fitView`로 포커스.

**Tech Stack:** Next.js(클라이언트 컴포넌트) · @xyflow/react · @dagrejs/dagre · 기존 `lib/diff.ts`/`lib/canvas.ts` 재사용.

## Global Constraints

- **언어**: 설명/주석/동적 데이터는 한국어, 식별자·UI 문자열은 영어 (`rules/frontend/design.md` §5).
- **색상**: raw hex 금지 — 토큰만(`var(--color-added|removed|changed)`, `ring-added/removed/changed`, `border-hairline` 등). diff 색 토큰은 `globals.css`에 이미 존재(`--color-added:#16794f` / `--color-removed:#cc3300` / `--color-changed:#9a6b00`).
- **아이콘**: Lucide 16px strokeWidth 1.5, 이모지 금지.
- **TS strict**: `any` 금지, `@ts-ignore` 금지. 함수명은 동사 시작.
- **id 생성 금지 경로**: 이 작업은 노드/엣지 id를 새로 만들지 않음(계보 키 재사용). 만들 일 있으면 `genId()`(`@/lib/id`).
- **테스트**: 프론트엔드에 단위 테스트 프레임워크가 없었으므로 **vitest를 새로 셋업**(사용자 요청, Task 1 Step 0). 순수 로직 `merge-diff.ts`는 vitest 단위 테스트로 검증(node 환경, `@` alias). UI/렌더는 (1) `npm run lint` (2) `npm run build`(tsc) (3) 브라우저 실측으로 — 시드 `seed_compare_demo`의 "Version Comparison Demo (As-Is / To-Be)" 맵이 알려진 오라클(**added 1 · removed 1 · changed 2**, `PROGRESS.md` 2026-06-22 seed 항목). vitest는 devDependency(프로덕션 Docker 이미지 미포함).
- **줄바꿈 LF 고정**.
- **data-id 정책**: 신규/리디자인 구조 요소에 `data-id` 부여(추후 타게팅, 메모리 `frontend-data-id-convention`). 본 화면의 캔버스/변경목록/범례 컨테이너에 부여.

---

### Task 0: dev-auth 레이스 수정 — 빈 캔버스 근본 원인

현재 비교 화면이 "데이터는 있는데 노드가 안 뜨는" 진짜 원인. `DevGate`(auth 비활성/로컬)가 `setDevUser(stored)`를 **useEffect 안**에서 호출하는데, React는 자식(페이지) effect를 부모(DevGate) effect보다 먼저 실행한다. 그래서 페이지의 첫 `getMap`이 `devUser=null`로 나가 `X-Dev-User` 헤더 없이 전송 → 백엔드 `local-dev` 폴백 → 403 → 빈 캔버스. `AuthGate`는 이미 `setAuthToken`을 **렌더 단계에서 동기** 호출(line 57)해 같은 레이스를 막아둠 — `DevGate`만 패턴 미적용.

**Files:**
- Modify: `frontend/src/components/providers.tsx:87-111` (`DevGate`)

**Interfaces:**
- Consumes: `setDevUser`, `getStoredDevUser`, `publishMe` (모두 이미 import됨)
- Produces: 없음 (동작 수정만)

- [ ] **Step 1: 재현 — 브라우저로 빈 캔버스 + 403 확인**

백엔드/프론트 기동(아래 "검증 환경" 참고) 후 시드 compare 데모 맵의 compare 페이지를 **하드 리로드**로 진입.
Run(브라우저 검증 하네스, 시스템 Chrome): `/maps/{compareDemoMapId}/compare` 직접 진입.
Expected: 캔버스 비어 있음. Network 탭에 `GET /api/maps/{id}` 가 **403**(또는 빈 응답) — `X-Dev-User` 요청 헤더 없음 확인. (재현 안 되면 원인이 다름 → STOP하고 보고.)

- [ ] **Step 2: 수정 — setDevUser를 렌더 단계 동기 호출로 이동**

`DevGate`를 아래로 교체. `setDevUser(stored)`를 effect 밖(렌더 본문)으로 올리고, effect는 `publishMe`/리다이렉트만 담당.

```tsx
function DevGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const stored = getStoredDevUser();

  // dev 유저도 렌더 단계에서 동기 반영 — 자식 페이지의 fetch effect가 DevGate effect보다 먼저 실행되는
  // 레이스(첫 GET /maps가 X-Dev-User 없이 나가 local-dev 폴백→403→빈 캔버스) 방지.
  // AuthGate의 setAuthToken(line 57)과 동일한 패턴.
  setDevUser(stored);

  useEffect(() => {
    if (stored) {
      void publishMe();
    } else {
      setCurrentUser(null);
      if (pathname !== "/login") {
        router.replace("/login");
      }
    }
  }, [stored, pathname, router]);

  if (pathname === "/login") {
    return <>{children}</>;
  }
  if (!stored) {
    return null;
  }
  return <>{children}</>;
}
```

- [ ] **Step 3: 검증 — getMap 200 + 캔버스 채워짐**

Run: `npm run lint && npm run build`
Expected: 0 errors.
브라우저: compare 페이지 하드 리로드 → `GET /api/maps/{id}` **200**, 요청에 `X-Dev-User` 헤더 존재, 기존(좌/우) 캔버스에 노드 표시.
회귀 확인: 에디터(`/maps/{id}`)·홈(`/`) 하드 리로드 정상.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/providers.tsx
git commit -m "fix(auth): set dev user synchronously in DevGate render — dev-auth 레이스로 인한 빈 캔버스 수정

DevGate set setDevUser in an effect, but child page fetch effects run
before parent effects, so the first getMap went out without X-Dev-User
and fell back to local-dev (403 → empty canvas). Mirror AuthGate's
synchronous setAuthToken pattern.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XLsAz9Y6sVy8cBvc4N84X3"
```

---

### Task 1: merge-diff.ts — union 그래프 빌더

두 `VersionGraph`를 계보 키로 합쳐 union 노드/엣지 + status를 산출. `diff.ts`의 매칭 헬퍼를 재사용(중복 구현 금지).

**Files:**
- Modify: `frontend/src/lib/diff.ts` (2개 심볼 export 노출)
- Create: `frontend/src/lib/merge-diff.ts`

**Interfaces:**
- Consumes: `FlatNode`, `GraphEdge`, `VersionGraph` (`@/lib/api`); `getLineageKey`, `FIELD_KEYS`, `ChangedField` (`@/lib/diff`)
- Produces:
  - `getLineageKey(node: FlatNode): string` (diff.ts에서 export)
  - `FIELD_KEYS: [keyof FlatNode, ChangedField][]` (diff.ts에서 export)
  - `type MergedNodeStatus = "unchanged" | "added" | "removed" | "changed"`
  - `type MergedEdgeStatus = "unchanged" | "added" | "removed"`
  - `interface MergedNode { id: string; node: FlatNode; status: MergedNodeStatus; changedFields: ChangedField[] }`
  - `interface MergedEdge { id: string; source: string; target: string; label: string; status: MergedEdgeStatus }`
  - `interface MergedGraph { nodes: MergedNode[]; edges: MergedEdge[] }`
  - `buildMergedGraph(base: VersionGraph, target: VersionGraph): MergedGraph`

- [ ] **Step 1: diff.ts 헬퍼 export 노출**

`frontend/src/lib/diff.ts`에서 두 심볼을 export로 변경(시그니처·본문 불변):

line 43 `const FIELD_KEYS` → `export const FIELD_KEYS`
line 55 `function getLineageKey` → `export function getLineageKey`

- [ ] **Step 2: merge-diff.ts 작성**

Create `frontend/src/lib/merge-diff.ts`:

```ts
// 버전 간 그래프를 하나의 합집합(union)으로 병합 — 계보 키로 노드/엣지를 합치고
// added/removed/changed/unchanged 상태 부여. 단일 캔버스 비교 화면이 좌표 무시·연결 기반 diff 렌더에 사용.

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { FIELD_KEYS, getLineageKey, type ChangedField } from "@/lib/diff";

export type MergedNodeStatus = "unchanged" | "added" | "removed" | "changed";
export type MergedEdgeStatus = "unchanged" | "added" | "removed";

export interface MergedNode {
  id: string; // 계보 키 — union 노드의 안정 id (엣지 endpoint와 동일 공간)
  node: FlatNode; // 대표 데이터 (target 우선, 없으면 base)
  status: MergedNodeStatus;
  changedFields: ChangedField[]; // changed일 때만 채움
}

export interface MergedEdge {
  id: string; // `${sourceKey}->${targetKey}`
  source: string; // 계보 키
  target: string; // 계보 키
  label: string;
  status: MergedEdgeStatus;
}

export interface MergedGraph {
  nodes: MergedNode[];
  edges: MergedEdge[];
}

// 계보 키 → 노드. 같은 키가 여러 노드면 마지막 승리(정상 데이터는 1:1).
function indexByLineage(nodes: FlatNode[]): Map<string, FlatNode> {
  return new Map(nodes.map((node) => [getLineageKey(node), node]));
}

function diffFields(base: FlatNode, target: FlatNode): ChangedField[] {
  return FIELD_KEYS.filter(([field]) => base[field] !== target[field]).map(([, key]) => key);
}

// 엣지 endpoint를 계보 키로 변환 — 노드가 없으면 raw id 폴백(댕글링 엣지는 RF가 드롭).
function edgeEndpoints(
  edge: GraphEdge,
  byId: Map<string, FlatNode>,
): { source: string; target: string } {
  const source = byId.get(edge.source_node_id);
  const target = byId.get(edge.target_node_id);
  return {
    source: source ? getLineageKey(source) : edge.source_node_id,
    target: target ? getLineageKey(target) : edge.target_node_id,
  };
}

export function buildMergedGraph(base: VersionGraph, target: VersionGraph): MergedGraph {
  const baseByLineage = indexByLineage(base.nodes);
  const targetByLineage = indexByLineage(target.nodes);

  // 노드 union — 계보 키 합집합
  const allKeys = new Set<string>([...baseByLineage.keys(), ...targetByLineage.keys()]);
  const nodes: MergedNode[] = [];
  for (const key of allKeys) {
    const b = baseByLineage.get(key) ?? null;
    const t = targetByLineage.get(key) ?? null;
    if (t && b) {
      const changedFields = diffFields(b, t);
      nodes.push({
        id: key,
        node: t,
        status: changedFields.length > 0 ? "changed" : "unchanged",
        changedFields,
      });
    } else if (t) {
      nodes.push({ id: key, node: t, status: "added", changedFields: [] });
    } else if (b) {
      nodes.push({ id: key, node: b, status: "removed", changedFields: [] });
    }
  }

  // 엣지 union — (출발 계보 → 도착 계보)로 합집합. 양쪽=unchanged, target만=added, base만=removed.
  const baseById = new Map(base.nodes.map((n) => [n.id, n]));
  const targetById = new Map(target.nodes.map((n) => [n.id, n]));
  const merged = new Map<string, MergedEdge>();
  for (const edge of base.edges) {
    const { source, target: tgt } = edgeEndpoints(edge, baseById);
    const id = `${source}->${tgt}`;
    merged.set(id, { id, source, target: tgt, label: edge.label, status: "removed" });
  }
  for (const edge of target.edges) {
    const { source, target: tgt } = edgeEndpoints(edge, targetById);
    const id = `${source}->${tgt}`;
    const existing = merged.get(id);
    if (existing) {
      existing.status = "unchanged";
      existing.label = edge.label; // target 라벨 우선
    } else {
      merged.set(id, { id, source, target: tgt, label: edge.label, status: "added" });
    }
  }

  return { nodes, edges: [...merged.values()] };
}
```

- [ ] **Step 3: 타입 검증**

Run: `npm run lint && npm run build`
Expected: 0 errors. (런타임 검증은 Task 3 브라우저에서 오라클로.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/diff.ts frontend/src/lib/merge-diff.ts
git commit -m "feat(compare): add buildMergedGraph union builder — 병합 그래프 빌더

Reuses diff.ts lineage matching (getLineageKey/FIELD_KEYS, now exported)
to merge two versions into one union graph keyed by lineage, with per
node/edge added/removed/changed/unchanged status.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XLsAz9Y6sVy8cBvc4N84X3"
```

---

### Task 2: compare/page.tsx 재작성 — 단일 병합 캔버스

좌/우 2캔버스 폐기. base→target 드롭다운 + 단일 읽기전용 ReactFlow. union 노드를 좌표 없이 만든 뒤 `layoutWithDagre`로 배치, `ProcessNode`로 status 색 렌더, 엣지 status별 dash. 변경 목록 + 클릭 포커스.

**Files:**
- Rewrite: `frontend/src/app/maps/[mapId]/compare/page.tsx`
- Modify: `frontend/src/lib/i18n-messages.ts` (신규 키 추가)

**Interfaces:**
- Consumes: `buildMergedGraph`, `MergedGraph`, `MergedNode`, `MergedEdge` (`@/lib/merge-diff`); `layoutWithDagre`, `normalizeNodeType`, `AppNode` (`@/lib/canvas`); `ProcessNode`; `getMap`, `getFullGraph`, `VersionGraph`, `VersionSummary` (`@/lib/api`); `FIELD_KEYS`/`ChangedField` 번역은 기존 `FIELD_MSG` 패턴.
- Produces: 기본 export `ComparePage` (라우트 컴포넌트)

- [ ] **Step 1: i18n 키 추가**

`frontend/src/lib/i18n-messages.ts`의 `compare.*` 블록(en·ko 양쪽)에 아래 키 추가. 기존 `compare.legendAdded/Removed/Changed`·`compare.identical`·`compare.editorLink`·`compare.title`·`compare.selectVersionAria`는 재사용.

| key | en | ko |
|-----|----|----|
| `compare.base` | `Base` | `기준(이전)` |
| `compare.target` | `Target` | `대상(이후)` |
| `compare.changes` | `Changes` | `변경 사항` |
| `compare.edgeAdded` | `Edge added` | `엣지 추가` |
| `compare.edgeRemoved` | `Edge removed` | `엣지 삭제` |
| `compare.mergedSubtitle` | `Differences merged onto one canvas (positions ignored, laid out by connections).` | `차이를 한 캔버스에 병합 (위치 무시, 연결 기반 배치).` |

`compare.summary`(이미 존재, `{a}{r}{c}` 플레이스홀더)는 노드 기준 요약으로 재사용하고, 엣지 카운트는 변경 목록 헤더에 별도 표기.

- [ ] **Step 2: 페이지 전체 재작성**

Replace 전체 파일 `frontend/src/app/maps/[mapId]/compare/page.tsx`:

```tsx
"use client";

// 버전 비교 화면 — 두 버전을 하나의 병합 캔버스로 렌더. 저장 좌표 무시·dagre 연결 기반 배치,
// 추가/삭제 엣지와 추가/삭제/변경 노드를 색으로 표현하고 변경 목록 클릭으로 포커스. (재작성: spec 2026-06-23)

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  MarkerType,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ProcessNode } from "@/components/process-node";
import {
  getFullGraph,
  getMap,
  type VersionGraph,
  type VersionSummary,
} from "@/lib/api";
import { layoutWithDagre, normalizeNodeType, type AppNode } from "@/lib/canvas";
import type { ChangedField } from "@/lib/diff";
import {
  buildMergedGraph,
  type MergedEdge,
  type MergedNode,
  type MergedNodeStatus,
} from "@/lib/merge-diff";
import { useI18n } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n-messages";

const nodeTypes: NodeTypes = { process: ProcessNode };

const FIELD_MSG: Record<ChangedField, MessageKey> = {
  title: "field.title",
  description: "field.description",
  type: "field.type",
  color: "field.color",
  assignee: "field.assignee",
  department: "field.department",
  system: "field.system",
  duration: "field.duration",
  location: "field.location",
};

// 병합 노드 status → ProcessNode diffStatus (unchanged는 중립=undefined)
function toDiffStatus(status: MergedNodeStatus): "added" | "removed" | "changed" | undefined {
  return status === "unchanged" ? undefined : status;
}

// union 노드를 좌표 없는 AppNode로 — 이후 layoutWithDagre가 위치 산정
function buildAppNodes(
  merged: MergedNode[],
  focusId: string | null,
  noteOf: (node: MergedNode) => string | undefined,
): AppNode[] {
  return merged.map((m) => ({
    id: m.id,
    type: "process",
    position: { x: 0, y: 0 },
    selected: focusId === m.id,
    data: {
      label: m.node.title,
      description: m.node.description,
      nodeType: normalizeNodeType(m.node.node_type),
      color: m.node.color,
      assignee: m.node.assignee,
      department: m.node.department,
      system: m.node.system,
      duration: m.node.duration,
      groupIds: m.node.group_ids ?? [],
      hasChildren: false,
      diffStatus: toDiffStatus(m.status),
      diffNote: noteOf(m),
    },
  }));
}

function buildAppEdges(merged: MergedEdge[], focusId: string | null): Edge[] {
  return merged.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: "smoothstep" as const,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--color-border-strong)" },
    selected: focusId === e.id,
    style:
      e.status === "added"
        ? { stroke: "var(--color-added)", strokeWidth: 2 }
        : e.status === "removed"
          ? { stroke: "var(--color-removed)", strokeWidth: 2, strokeDasharray: "6 3" }
          : undefined,
  }));
}

function VersionSelect({
  label,
  versions,
  value,
  onChange,
}: {
  label: string;
  versions: VersionSummary[];
  value: number;
  onChange: (id: number) => void;
}) {
  return (
    <label className="flex items-center gap-1 text-caption text-ink-secondary">
      {label}
      <select
        className="rounded-sm border border-hairline px-2 py-1 text-caption"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            {version.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffLegend() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-ink-secondary text-caption" data-id="compare-legend">
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-added" /> {t("compare.legendAdded")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-removed" /> {t("compare.legendRemoved")}
      </span>
      <span className="flex items-center gap-1">
        <span className="h-3 w-3 rounded border-2 border-changed" /> {t("compare.legendChanged")}
      </span>
    </div>
  );
}

interface ChangeItem {
  key: string;
  focusId: string;
  status: MergedNodeStatus;
  title: string;
  detail?: string;
}

function ComparePane({
  mapId,
  mapName,
  versions,
  baseId,
  targetId,
  baseGraph,
  targetGraph,
  onChangeBase,
  onChangeTarget,
}: {
  mapId: number;
  mapName: string;
  versions: VersionSummary[];
  baseId: number;
  targetId: number;
  baseGraph: VersionGraph;
  targetGraph: VersionGraph;
  onChangeBase: (id: number) => void;
  onChangeTarget: (id: number) => void;
}) {
  const { t } = useI18n();
  const flow = useReactFlow();
  const [focusId, setFocusId] = useState<string | null>(null);

  const merged = useMemo(
    () => buildMergedGraph(baseGraph, targetGraph),
    [baseGraph, targetGraph],
  );

  const noteOf = useCallback(
    (m: MergedNode): string | undefined => {
      if (m.status === "changed") {
        return t("compare.changedFields", {
          fields: m.changedFields.map((f) => t(FIELD_MSG[f])).join(", "),
        });
      }
      if (m.status === "added") return t("compare.statusAdded");
      if (m.status === "removed") return t("compare.statusRemoved");
      return undefined;
    },
    [t],
  );

  // 좌표 없는 union 노드 → dagre 배치 (연결 기반, 저장 pos 무시)
  const laidNodes = useMemo(() => {
    const appNodes = buildAppNodes(merged.nodes, focusId, noteOf);
    const appEdges = buildAppEdges(merged.edges, focusId);
    return layoutWithDagre(appNodes, appEdges);
  }, [merged, focusId, noteOf]);

  const appEdges = useMemo(() => buildAppEdges(merged.edges, focusId), [merged, focusId]);

  const titleByKey = useMemo(
    () => new Map(merged.nodes.map((m) => [m.id, m.node.title])),
    [merged],
  );

  const nodeChanges: ChangeItem[] = useMemo(
    () =>
      merged.nodes
        .filter((m) => m.status !== "unchanged")
        .map((m) => ({
          key: `n-${m.id}`,
          focusId: m.id,
          status: m.status,
          title: m.node.title,
          detail:
            m.status === "changed"
              ? m.changedFields.map((f) => t(FIELD_MSG[f])).join(", ")
              : undefined,
        })),
    [merged, t],
  );

  const edgeChanges: ChangeItem[] = useMemo(
    () =>
      merged.edges
        .filter((e) => e.status !== "unchanged")
        .map((e) => ({
          key: `e-${e.id}`,
          focusId: e.id,
          status: e.status,
          title: `${titleByKey.get(e.source) ?? "?"} → ${titleByKey.get(e.target) ?? "?"}`,
          detail: e.status === "added" ? t("compare.edgeAdded") : t("compare.edgeRemoved"),
        })),
    [merged, titleByKey, t],
  );

  const focusNode = useCallback(
    (id: string) => {
      setFocusId(id);
      flow.fitView({ nodes: [{ id }], duration: 400, maxZoom: 1.3, padding: 0.4 });
    },
    [flow],
  );

  const focusEdge = useCallback(
    (edge: MergedEdge) => {
      setFocusId(edge.id);
      flow.fitView({
        nodes: [{ id: edge.source }, { id: edge.target }],
        duration: 400,
        maxZoom: 1.3,
        padding: 0.4,
      });
    },
    [flow],
  );

  const badgeClass: Record<MergedNodeStatus, string> = {
    added: "bg-added/10 text-added",
    removed: "bg-removed/10 text-removed",
    changed: "bg-changed/10 text-changed",
    unchanged: "",
  };
  const badgeLabel: Record<MergedNodeStatus, string> = {
    added: t("compare.legendAdded"),
    removed: t("compare.legendRemoved"),
    changed: t("compare.legendChanged"),
    unchanged: "",
  };

  const hasChanges = nodeChanges.length + edgeChanges.length > 0;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-hairline px-4 py-2">
        <Link href={`/maps/${mapId}`} className="text-caption text-accent hover:underline">
          ← {t("compare.editorLink")}
        </Link>
        <h1 className="text-tagline text-ink font-medium">
          {mapName} — {t("compare.title")}
        </h1>
        <div className="flex items-center gap-3">
          <VersionSelect
            label={t("compare.base")}
            versions={versions}
            value={baseId}
            onChange={onChangeBase}
          />
          <span className="text-ink-tertiary">→</span>
          <VersionSelect
            label={t("compare.target")}
            versions={versions}
            value={targetId}
            onChange={onChangeTarget}
          />
        </div>
        <div className="ml-auto">
          <DiffLegend />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 bg-canvas" data-id="compare-canvas">
          <ReactFlow
            nodes={laidNodes}
            edges={appEdges}
            nodeTypes={nodeTypes}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            fitView
          >
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1.2}
              color="var(--color-canvas-dot)"
            />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <aside
          className="w-72 shrink-0 overflow-auto border-l border-hairline px-3 py-2"
          data-id="compare-changes"
        >
          <div className="mb-2 text-caption-strong text-ink">{t("compare.changes")}</div>
          {!hasChanges && (
            <div className="text-caption text-ink-tertiary">{t("compare.identical")}</div>
          )}
          <ul className="space-y-1 text-body">
            {nodeChanges.map((c) => (
              <li key={c.key}>
                <button
                  className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                  onClick={() => focusNode(c.focusId)}
                >
                  <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                    {badgeLabel[c.status]}
                  </span>
                  <span className="text-ink">{c.title}</span>
                  {c.detail && <span className="ml-1 text-caption text-ink-secondary">({c.detail})</span>}
                </button>
              </li>
            ))}
            {edgeChanges.map((c) => {
              const edge = merged.edges.find((e) => e.id === c.focusId);
              return (
                <li key={c.key}>
                  <button
                    className="w-full rounded-sm px-1.5 py-1 text-left hover:bg-surface-alt"
                    onClick={() => edge && focusEdge(edge)}
                  >
                    <span className={`mr-2 rounded px-1.5 py-0.5 text-caption ${badgeClass[c.status]}`}>
                      {c.detail}
                    </span>
                    <span className="text-ink-secondary">{c.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const params = useParams<{ mapId: string }>();
  const mapId = Number(params.mapId);

  const [mapName, setMapName] = useState("");
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [baseId, setBaseId] = useState<number | null>(null);
  const [targetId, setTargetId] = useState<number | null>(null);
  const [baseGraph, setBaseGraph] = useState<VersionGraph | null>(null);
  const [targetGraph, setTargetGraph] = useState<VersionGraph | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const detail = await getMap(mapId);
      if (!active) return;
      setMapName(detail.name);
      setVersions(detail.versions);
      // 기본: base=가장 오래된(published 후보), target=최신
      setBaseId(detail.versions[0].id);
      setTargetId(detail.versions[detail.versions.length - 1].id);
    })();
    return () => {
      active = false;
    };
  }, [mapId]);

  useEffect(() => {
    if (baseId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(baseId);
      if (active) setBaseGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [baseId]);

  useEffect(() => {
    if (targetId === null) return;
    let active = true;
    void (async () => {
      const graph = await getFullGraph(targetId);
      if (active) setTargetGraph(graph);
    })();
    return () => {
      active = false;
    };
  }, [targetId]);

  const ready =
    baseId !== null &&
    targetId !== null &&
    versions.length > 0 &&
    baseGraph !== null &&
    targetGraph !== null;

  return (
    <div className="flex h-full flex-col">
      {ready ? (
        <ReactFlowProvider>
          <ComparePane
            mapId={mapId}
            mapName={mapName}
            versions={versions}
            baseId={baseId}
            targetId={targetId}
            baseGraph={baseGraph}
            targetGraph={targetGraph}
            onChangeBase={setBaseId}
            onChangeTarget={setTargetId}
          />
        </ReactFlowProvider>
      ) : (
        <div className="p-8 text-caption text-ink-tertiary">…</div>
      )}
    </div>
  );
}
```

> 참고: `useCallback` import는 `react`에서. `normalizeNodeType`/`AppNode`/`layoutWithDagre`가 `@/lib/canvas`에 있는지 확인(있음). `compare.statusAdded`/`statusRemoved`/`changedFields`는 기존 i18n 키.

- [ ] **Step 3: 빌드·린트**

Run: `npm run lint && npm run build`
Expected: 0 errors. (`useCallback` deps·미사용 import 경고 0.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/maps/[mapId]/compare/page.tsx frontend/src/lib/i18n-messages.ts
git commit -m "feat(compare): single merged canvas with diff overlay + change list — 단일 병합 비교 캔버스

Replace side-by-side panes with one read-only ReactFlow: union nodes laid
out by connections (layoutWithDagre, positions ignored), added/removed/
changed nodes colored via ProcessNode, added/removed edges styled, and a
change list whose items fitView-focus the element.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XLsAz9Y6sVy8cBvc4N84X3"
```

---

### Task 3: 브라우저 검증 — 시드 오라클 + 회귀

**Files:** (코드 변경 없음 — 검증·필요 시 수정 후 재커밋)

**검증 환경 (검증 환경 섹션):**
- backend: `backend/`에서 `python -m scripts.reset_db` (시드, `seed_compare_demo` 포함) 후 `.venv/...uvicorn app.main:app --reload --port 8000` (PowerShell: `.venv\Scripts\uvicorn ...`). **로컬은 pip**(uv 불가).
- frontend: `frontend/`에서 `npm run dev` (:3000, `/api`→8000 프록시). **좀비 next dev 전수 종료** 후 기동(메모리 `browser-test-zombie-frontend`).
- 브라우저: Playwright + 시스템 Chrome(메모리 `browser-verification-harness`). 로그인=임시 아이디 버튼 → 사용자 선택. **dev.db 오염 주의**(`docs/lessons/browser-verification.md`).

- [ ] **Step 1: 오라클 맵 식별**

Run: `python -c "..."` 또는 홈에서 "Version Comparison Demo (As-Is / To-Be)" 맵 id 확인.
Expected: As-Is(published)·To-Be(draft) 2버전 보유.

- [ ] **Step 2: 병합 캔버스 렌더 확인 (Task 0+2 통합)**

`/maps/{id}/compare` 하드 리로드 진입.
Expected:
- `GET /api/maps/{id}` 200(403 아님), 캔버스에 **노드 표시**(빈 화면 아님).
- 단일 캔버스(좌/우 분리 없음), base/target 드롭다운 상단.
- diff 색: **added 노드 1**(초록 링), **removed 노드** 없거나 해당 시 빨강+opacity, **changed 노드 2**(앰버 링). 우측 변경 목록에 노드 항목.

- [ ] **Step 3: 엣지 diff 확인**

Expected: To-Be에만 있는 연결 → **초록 실선**, As-Is에만 있던 연결 → **빨강 점선**. 변경 목록에 `Edge added`/`Edge removed` 항목.
(seed_compare_demo는 노드 added/removed/changed 중심 — 엣지 변화가 없으면, To-Be에서 노드 1개 연결을 임시로 바꿔 엣지 added/removed가 색으로 뜨는지 1회 수동 확인 후 원복. 또는 다른 버전쌍 선택.)

- [ ] **Step 4: 클릭 포커스 + 버전 전환 확인**

Expected:
- 변경 목록 항목 클릭 → 캔버스가 해당 노드/엣지로 `fitView` 이동, 해당 요소 selected 강조.
- base/target 드롭다운 변경 → 다른 버전쌍으로 diff 재계산·재배치.

- [ ] **Step 5: 회귀 확인**

Expected: 에디터(`/maps/{id}`)·홈 정상(Task 0 auth 수정 부작용 없음). pageerror 0(콘솔).

- [ ] **Step 6: 최종 빌드·린트 + PROGRESS 갱신 + Commit**

Run: `npm run lint && npm run build`
Expected: 0 errors.
`PROGRESS.md` 2026-06-23 항목을 "설계"에서 "구현 완료"로 갱신(검증 결과 한 줄).

```bash
git add PROGRESS.md
git commit -m "docs(progress): merged compare view implemented + verified — 병합 비교화면 구현·검증

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01XLsAz9Y6sVy8cBvc4N84X3"
```

---

## Self-Review

**Spec coverage:**
- 단일 병합 캔버스(좌표 무시·dagre) → Task 2 (`buildAppNodes`+`layoutWithDagre`). ✅
- base→target 버전 선택(기본 published vs 최신) → Task 2 (`VersionSelect`, 기본 `[0]`→`[last]`). ✅
- 노드 added/removed/changed + 엣지 added/removed → Task 1(`buildMergedGraph`) + Task 2(색/링). ✅
- 노드 속성 변경(앰버 + 목록) → Task 1(`changedFields`) + Task 2(changed 링·detail). ✅
- 조회 전용 + pan/zoom + 클릭 상세/포커스 → Task 2(`nodesDraggable=false`, `fitView` 포커스). ✅
- "노드 안 뜸" 버그 → Task 0(dev-auth 레이스) + Task 3 검증. ✅
- 범위 밖(서브프로세스 드릴인·편집·엣지 라벨 변경) 미구현 — 의도적. ✅

**Placeholder scan:** 코드 블록은 전부 완전체. Task 3은 검증 태스크라 동적 id/맵은 런타임 확인(플레이스홀더 아님).

**Type consistency:** `MergedNode`/`MergedEdge`/`MergedNodeStatus`/`buildMergedGraph`가 Task 1 정의와 Task 2 사용처 일치. `toDiffStatus`가 `"unchanged"`→`undefined` 매핑해 `ProcessNode` `diffStatus?: "added"|"removed"|"changed"`와 정합. `layoutWithDagre(nodes, edges)` 시그니처 일치(canvas.ts:534).

**리스크:**
- `seed_compare_demo`에 엣지 변화가 없으면 엣지 색 검증은 임시 편집으로(Task 3 Step 3 명시).
- `layoutWithDagre`는 `node.data.nodeType`으로 크기 산정 — `normalizeNodeType` 적용했으므로 OK.
- 댕글링 엣지(노드 없는 endpoint)는 RF가 드롭 — 정상 데이터에선 미발생.
