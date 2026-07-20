# Excel 출력 양식 2안(WBS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 서브프로세스 계층을 레벨 컬럼으로 펼치는 WBS 엑셀 시트를 추가하고, Excel 버튼을 형식 선택 모달(토글 탭+미리보기+다운로드)로 바꾼다.

**Architecture:** 신규 `frontend/src/lib/excel-wbs.ts`에 `buildWbsModel`(잎 행+levels 경로, 1안과 동형의 규칙 엔진)과 `writeWbsSheet`(동적 레벨 컬럼·회색 톤다운). `excel-export.ts`는 공유 조각(`getNodeRunParams`·`NOTE_TEXT`·`HEADER_FILL`) export + 다운로드 공용화(`downloadWorkbookXlsx`). 에디터 Excel 버튼은 신규 `excel-export-modal.tsx`를 연다. 스펙: `docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md`.

**Tech Stack:** TypeScript, vitest(모델·시트), exceljs 동적 import, Playwright 실기동(모달·다운로드).

## Global Constraints

- 1안 출력(`buildExcelModel`/`writeExcelSheet`)의 규칙·형식 **무변경** — 기존 excel-export 테스트 34개가 그대로 그린이어야 한다. CSV/Word/PNG·백엔드 0줄.
- 2안 행 규칙: **start/end 전부 삭제**(커스텀 제목 end 포함, Next의 End 텍스트는 유지) · 무라벨 디시전 삭제+flow-through(라벨 전파) · `[No:라벨]` 주석(행 객체 참조·재수렴 중복 제거) · No 1..n 연속 — 1안 대비 차이는 start/end 범위와 SP 무행뿐.
- **SP는 행 미차지**(미연결 SP 포함), 레벨 값 = SP 노드 타이틀(루트만 맵 이름), 레벨 컬럼 수 = 만난 최대 깊이(동적).
- 레벨 셀 회색 `FF9CA3AF`·헤더 연보라 `HEADER_FILL`은 출력물이라 raw ARGB 허용(design.md §1 예외). **UI(모달)는 토큰만** — raw hex 금지.
- exceljs는 동적 import 유지(정적 import 시 에디터 번들 오염 — frontend/AGENTS.md).
- 모달 토글 탭은 top-nav 한/영 세그먼트 디자인(`top-nav.tsx:207`), 모달 셸은 node-summary-modal 패턴(overlay `z-[1200] backdrop-blur-sm`). i18n은 `useI18n()`(`@/lib/i18n`), 문구는 en/ko 양쪽 추가.
- React Compiler 함정: 트리비얼 핸들러는 plain function, `react-hooks/set-state-in-effect` 위반 금지(effect 내 동기 setState 금지 — 비동기 .then 내 setState는 허용).
- 주석·테스트 설명은 한국어, 코드 식별자·커밋 제목은 영어. 커밋: `type(scope): English summary — 한국어 요약` + 하네스 트레일러.
- 모든 명령은 워크트리 `frontend/`(`/Users/hyeonjin/Documents/bpm/.claude/worktrees/excel-export/frontend`)에서. **메인 체크아웃 커밋 금지** — 시작 전 `pwd`·`git branch --show-current`(=`worktree-excel-export`) 확인.
- `grep`은 ugrep이라 `[mapId]` 브래킷 디렉터리를 건너뜀 — page.tsx 검색은 python/find 사용.

## 파일 구조

| 파일 | 작업 | 역할 |
|------|------|------|
| `frontend/src/lib/excel-export.ts` | Modify | 공유 export(`getNodeRunParams`·`NOTE_TEXT`·`HEADER_FILL`) + `downloadWorkbookXlsx` 추출 |
| `frontend/src/lib/excel-wbs.ts` | Create | `WbsModel`·`buildWbsModel`·`writeWbsSheet`·`downloadWbsExcel` |
| `frontend/src/lib/excel-wbs.test.ts` | Create | 모델 11·시트 4 테스트 |
| `frontend/src/components/excel-export-modal.tsx` | Create | 형식 토글 탭·미리보기(8행)·다운로드 모달 |
| `frontend/src/app/maps/[mapId]/page.tsx` | Modify | Excel 버튼 → 모달, 빌더 재구성 |
| `frontend/src/lib/i18n-messages.ts` | Modify | 모달 문구 en/ko |
| `frontend/scripts/pw-verify-excel-wbs.mjs` | Create | 실기동: 모달 플로우 + 양 형식 다운로드 파싱 |

---

### Task 1: `buildWbsModel` — WBS 모델 빌더 (공유 헬퍼 export 포함)

**Files:**
- Modify: `frontend/src/lib/excel-export.ts` (export 3개 추가)
- Create: `frontend/src/lib/excel-wbs.ts`
- Create: `frontend/src/lib/excel-wbs.test.ts`

**Interfaces:**
- Consumes: `orderNodesByFlow`(csv-export), `getNodeRunParams`/`NOTE_TEXT`/`EXCEL_MAX_ROWS`(excel-export — 이 태스크에서 export로 전환), `Graph`/`GraphEdge`/`GraphNode`(api).
- Produces: `buildWbsModel(opts): Promise<WbsModel>`(opts는 `buildExcelModel`과 동일 시그니처), `WbsModel { mapName; versionLabel; exportedAt; maxLevel: number; rows: WbsRow[]; truncated }`, `WbsNodeRow { kind:"node"; no; levels: string[]; title; type; description; assignee; department; system; duration; cost_krw; cost_usd; headcount; annual_count; fte; url; urlLabel; groups; next }`, `WbsNoteRow { kind:"circular"|"denied"|"rowLimit"; levels: string[]; title }` — Task 2(시트)·Task 3(모달)이 소비.

- [ ] **Step 1: 공유 헬퍼 export** — `excel-export.ts`에서 `function getNodeRunParams` → `export function getNodeRunParams`, `const NOTE_TEXT` → `export const NOTE_TEXT`, `const HEADER_FILL` → `export const HEADER_FILL`(주석 그대로). 동작 무변경 — `npx vitest run src/lib/excel-export.test.ts` 34 pass 확인.

- [ ] **Step 2: 실패 테스트 작성** — `frontend/src/lib/excel-wbs.test.ts` 신규(헬퍼는 excel-export.test.ts 스타일 복제):

```ts
// WBS 모델 빌더 단위 테스트 — 레벨 경로·SP 무행·start/end 전부 삭제·주석·상한.
// 설계: docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { buildWbsModel } from "./excel-wbs";

/** GraphNode 조립 헬퍼 — excel-export.test.ts 스타일 재사용. */
function makeNode(id: string, title: string, node_type: string, sort_order: number, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, title, description: "", node_type, color: "", assignee: "", department: "", system: "",
    duration: "", headcount: "", fte: "", cost_krw: "", cost_usd: "", annual_count: "", url: "", url_label: "",
    pos_x: 0, pos_y: 0, sort_order, group_ids: [], linked_map_id: null,
    follow_latest: false, linked_version_id: null, is_primary_end: false,
    ...over,
  };
}

function makeEdge(id: string, source: string, target: string, label = ""): GraphEdge {
  return { id, source_node_id: source, target_node_id: target, label, source_side: "right", target_side: "left", source_handle: null, target_handle: null };
}

function makeSubNode(id: string, title: string, sort_order: number, linkedMapId: number, over: Partial<GraphNode> = {}): GraphNode {
  return makeNode(id, title, "subprocess", sort_order, {
    linked_map_id: linkedMapId, follow_latest: true, linked_version_id: null,
    ...over,
  });
}

const unusedFetch = async (): Promise<Graph> => { throw new Error("unused"); };

async function build(graph: Graph, over: Partial<Parameters<typeof buildWbsModel>[0]> = {}) {
  return buildWbsModel({
    graph, mapName: "Root", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
    fetchResolved: unusedFetch, ...over,
  });
}

describe("buildWbsModel", () => {
  it("SP는 행 미차지 — 잎 행이 레벨 경로를 달고 제자리 전개되고 maxLevel이 최대 깊이", async () => {
    // Root: start→A→Sub(맵2)→end / 맵2: start→P→end
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeSubNode("sub1", "Sub", 2, 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "sub1"), makeEdge("x3", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = {
      nodes: [
        makeNode("s2", "Start", "start", 0),
        makeNode("p2", "P", "process", 1),
        makeNode("e2", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("y1", "s2", "p2"), makeEdge("y2", "p2", "e2")],
      groups: [],
    };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId !== 2) throw new Error("not found");
      return map2;
    };
    const model = await build(map1, { fetchResolved });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => [r.no, r.levels, r.title])).toEqual([
      [1, ["Root"], "A"],
      [2, ["Root", "Sub"], "P"],
    ]);
    expect(model.maxLevel).toBe(2);
  });

  it("start/end는 커스텀 제목 포함 전부 삭제되고 next의 End 텍스트는 유지된다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Kickoff", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("e1", "출하 종료", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "e1")],
      groups: [],
    };
    const model = await build(map1);
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["A"]);
    expect(nodeRows[0]?.next).toBe("출하 종료");
  });

  it("무라벨 디시전 삭제+flow-through·재수렴 중복 제거 — 1안과 동일 규칙", async () => {
    // A→P(무라벨)→B, P→Q(무라벨)→B — A.next "B" (중복 없이)
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("p1", "P", "decision", 2),
        makeNode("q1", "Q", "decision", 3),
        makeNode("b1", "B", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "p1"),
        makeEdge("x3", "p1", "b1"), makeEdge("x4", "p1", "q1"), makeEdge("x5", "q1", "b1"),
      ],
      groups: [],
    };
    const model = await build(map1);
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["A", "B"]);
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("B");
  });

  it("규칙4 주석: 일반 대상은 [No:라벨], SP 대상은 행이 없어 주석 소멸(next 라벨은 잔존)", async () => {
    // D ─ok→ Sub(맵2, 행 없음) / D ─no→ B — B만 [1:no], D.next엔 Sub:ok 잔존
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeSubNode("sub1", "Sub", 2, 2),
        makeNode("b1", "B", "process", 3),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "sub1", "ok"), makeEdge("x3", "d1", "b1", "no"),
      ],
      groups: [],
    };
    const map2: Graph = { nodes: [makeNode("p2", "P", "process", 0)], edges: [], groups: [] };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId !== 2) throw new Error("not found");
      return map2;
    };
    const model = await build(map1, { fetchResolved });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => [r.no, r.title])).toEqual([
      [1, "D"], [2, "P"], [3, "B [1:no]"],
    ]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("Sub:ok;B:no");
  });

  it("다이아몬드: 같은 맵 2회 참조는 블록 2회 전개, 레벨 경로·주석 번호가 인스턴스별", async () => {
    // Root: start→SubA(2)→SubB(2)→end / 맵2: D ─ok→ T
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("subA", "SubA", 1, 2),
        makeSubNode("subB", "SubB", 2, 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "subA"), makeEdge("x2", "subA", "subB"), makeEdge("x3", "subB", "e1")],
      groups: [],
    };
    const sharedMap: Graph = {
      nodes: [makeNode("dd", "D", "decision", 0), makeNode("tt", "T", "process", 1)],
      edges: [makeEdge("y1", "dd", "tt", "ok")],
      groups: [],
    };
    let callCount = 0;
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      callCount += 1;
      if (mapId !== 2) throw new Error("not found");
      return sharedMap;
    };
    const model = await build(map1, { fetchResolved });
    expect(callCount).toBe(1); // 메모이즈 유지
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => [r.no, r.levels, r.title])).toEqual([
      [1, ["Root", "SubA"], "D"], [2, ["Root", "SubA"], "T [1:ok]"],
      [3, ["Root", "SubB"], "D"], [4, ["Root", "SubB"], "T [3:ok]"],
    ]);
  });

  it("rootMapId 순환은 circular 노트 행(레벨 경로 포함)으로 즉시 차단", async () => {
    const map1: Graph = {
      nodes: [makeNode("s1", "Start", "start", 0), makeSubNode("sub1", "SubToRoot", 1, 1)],
      edges: [makeEdge("x1", "s1", "sub1")],
      groups: [],
    };
    const model = await build(map1, { rootMapId: 1 });
    expect(model.rows).toEqual([{ kind: "circular", levels: ["Root"], title: "SubToRoot" }]);
  });

  it("locked·fetch 실패는 denied 노트 행", async () => {
    const map1: Graph = {
      nodes: [makeSubNode("sub1", "SubLocked", 0, 2), makeSubNode("sub2", "SubGone", 1, 3)],
      edges: [],
      groups: [],
    };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId === 2) return { nodes: [], edges: [], groups: [], locked: true };
      throw new Error("403");
    };
    const model = await build(map1, { fetchResolved });
    expect(model.rows).toEqual([
      { kind: "denied", levels: ["Root"], title: "SubLocked" },
      { kind: "denied", levels: ["Root"], title: "SubGone" },
    ]);
  });

  it("행 상한 도달 시 rowLimit 1개 + truncated, 이미 출력된 행의 주석은 보존", async () => {
    // maxRows:2 — D, T 출력 후 U에서 상한. T의 [1:ok]는 살아야 한다
    const map1: Graph = {
      nodes: [
        makeNode("d1", "D", "decision", 0),
        makeNode("t1", "T", "process", 1),
        makeNode("u1", "U", "process", 2),
      ],
      edges: [makeEdge("x1", "d1", "t1", "ok"), makeEdge("x2", "t1", "u1")],
      groups: [],
    };
    const model = await build(map1, { maxRows: 2 });
    expect(model.truncated).toBe(true);
    expect(model.rows.map((r) => (r.kind === "node" ? r.title : r.kind))).toEqual(["D", "T [1:ok]", "rowLimit"]);
  });

  it("미연결 SP(linked_map_id null)는 행 미생성", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("a1", "A", "process", 0),
        makeNode("orphan", "OrphanSub", "subprocess", 1),
      ],
      edges: [makeEdge("x1", "a1", "orphan")],
      groups: [],
    };
    const model = await build(map1);
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["A"]);
    expect(nodeRows[0]?.next).toBe("OrphanSub"); // next 텍스트는 유지(End와 동일 원칙)
  });

  it("잎 노드의 groups 라벨은 자기 맵 groups 기준으로 조인된다", async () => {
    const map1: Graph = {
      nodes: [makeNode("a1", "A", "process", 0, { group_ids: ["g1"] })],
      edges: [],
      groups: [{ id: "g1", parent_group_id: null, label: "Intake", color: "" }],
    };
    const model = await build(map1);
    const row = model.rows.find((r) => r.kind === "node");
    expect(row && row.kind === "node" ? row.groups : "").toBe("Intake");
  });

  it("행이 하나도 없으면 maxLevel은 1", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("e1", "End", "end", 1, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "e1")],
      groups: [],
    };
    const model = await build(map1);
    expect(model.rows).toEqual([]);
    expect(model.maxLevel).toBe(1);
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/excel-wbs.test.ts`
Expected: 모듈 없음으로 전체 FAIL.

- [ ] **Step 4: 구현** — `frontend/src/lib/excel-wbs.ts` 신규:

```ts
// WBS(레벨 컬럼) Excel 모델 — 잎 업무 행 + 조상 경로(levels). 규칙 엔진은 1안(excel-export.ts)과
// 동형이되 start/end 전부 삭제·SP 무행이 다르다. 시트 기록은 Task 2에서 추가.
// 설계: docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md
import type { Graph, GraphEdge, GraphNode } from "./api";
import { orderNodesByFlow } from "./csv-export";
import { EXCEL_MAX_ROWS, getNodeRunParams } from "./excel-export";

export interface WbsNodeRow {
  kind: "node";
  no: number; // 최종 행 번호(1..n) — 삭제 규칙 적용 후 모델에서 부여
  levels: string[]; // 조상 경로 — [루트 맵 이름, SP 노드 타이틀…]. 길이 = 소속 레벨
  title: string;
  type: string;
  description: string;
  assignee: string;
  department: string;
  system: string;
  duration: string;
  cost_krw: string;
  cost_usd: string;
  headcount: string;
  annual_count: string;
  fte: string;
  url: string;
  urlLabel: string;
  groups: string;
  next: string;
}

export interface WbsNoteRow {
  kind: "circular" | "denied" | "rowLimit";
  levels: string[];
  title: string;
}

export type WbsRow = WbsNodeRow | WbsNoteRow;

export interface WbsModel {
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  maxLevel: number; // 레벨 컬럼 수 — rows의 levels 최대 길이(행 없으면 1)
  rows: WbsRow[];
  truncated: boolean;
}

export async function buildWbsModel({
  graph,
  mapName,
  versionLabel,
  exportedAt,
  fetchResolved,
  maxRows = EXCEL_MAX_ROWS,
  rootMapId,
}: {
  graph: Graph;
  mapName: string;
  versionLabel: string;
  exportedAt: string;
  fetchResolved: (mapId: number, followLatest: boolean, pinned: number | null) => Promise<Graph>;
  maxRows?: number;
  rootMapId?: number;
}): Promise<WbsModel> {
  const rows: WbsRow[] = [];
  let truncated = false;
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 안전, 1안과 동일)
  const annotations: Array<{ target: WbsNodeRow; decision: WbsNodeRow; label: string }> = [];
  const cache = new Map<string, Promise<Graph>>();
  const fetchMemo = (mapId: number, followLatest: boolean, pinned: number | null): Promise<Graph> => {
    const key = `${mapId}:${followLatest}:${pinned}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = fetchResolved(mapId, followLatest, pinned);
    cache.set(key, p);
    return p;
  };

  const emit = async (g: Graph, levels: string[], ancestry: ReadonlySet<number>): Promise<void> => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const groupLabel = new Map(g.groups.map((gr) => [gr.id, gr.label]));
    const outgoing = new Map<string, GraphEdge[]>();
    for (const e of g.edges) {
      const list = outgoing.get(e.source_node_id);
      if (list) list.push(e);
      else outgoing.set(e.source_node_id, [e]);
    }
    const ordered = orderNodesByFlow(g.nodes, g.edges);
    // 1안과 동일: 나가는 엣지가 있고 전부 무라벨인 디시전 = 단순 병렬 분기(엣지 없는 디시전은 WIP로 유지)
    const isRemovedDecision = (n: GraphNode): boolean => {
      if (n.node_type !== "decision") return false;
      const out = outgoing.get(n.id) ?? [];
      return out.length > 0 && out.every((e) => e.label === "");
    };
    // 2안: start/end 전부 삭제(커스텀 제목 포함 — 구조 노드 완전 배제)·미연결 SP도 행 미차지
    const isRowRemoved = (n: GraphNode): boolean =>
      n.node_type === "start" || n.node_type === "end" || isRemovedDecision(n) ||
      (n.node_type === "subprocess" && n.linked_map_id === null);
    // 1안과 동일: 삭제 디시전 flow-through + 라벨 전파(next·주석 공용, seen은 순환 가드)
    const resolveTargets = (
      edge: GraphEdge,
      label: string,
      seen: ReadonlySet<string>,
    ): Array<{ node: GraphNode; label: string }> => {
      const target = byId.get(edge.target_node_id);
      if (!target) return [];
      if (!isRemovedDecision(target)) return [{ node: target, label }];
      if (seen.has(target.id)) return [];
      const nextSeen = new Set([...seen, target.id]);
      return (outgoing.get(target.id) ?? []).flatMap((e) => resolveTargets(e, label, nextSeen));
    };

    const rowByNodeId = new Map<string, WbsNodeRow>(); // 스코프(맵 인스턴스) 한정

    for (const node of ordered) {
      if (isRowRemoved(node)) continue; // 삭제 노드는 상한(maxRows)을 소비하지 않는다
      if (rows.length >= maxRows) {
        // return이 아닌 break — 주석 수집 패스를 실행해 이미 출력된 행의 주석 보존(1안과 동일)
        if (!truncated) rows.push({ kind: "rowLimit", levels, title: "" });
        truncated = true;
        break;
      }
      if (node.node_type === "subprocess" && node.linked_map_id !== null) {
        // SP는 행 미차지 — 레벨 경로에 노드 타이틀을 붙이고 링크 맵의 잎 행들을 제자리 전개
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", levels, title: node.title });
          continue;
        }
        let resolved: Graph;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          rows.push({ kind: "denied", levels, title: node.title });
          continue;
        }
        if (resolved.locked) {
          rows.push({ kind: "denied", levels, title: node.title });
          continue;
        }
        await emit(resolved, [...levels, node.title], new Set([...ancestry, node.linked_map_id]));
        continue;
      }
      // Set 중복 제거 — 삭제 디시전 경유 재수렴 시 같은 (대상, 라벨) 2회 도달 방지(1안과 동일)
      const next = Array.from(new Set(
        (outgoing.get(node.id) ?? [])
          .flatMap((e) => resolveTargets(e, e.label, new Set()))
          .map(({ node: t, label }) => (label === "" ? t.title : `${t.title}:${label}`)),
      )).join(";");
      const row: WbsNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        levels,
        title: node.title,
        type: node.node_type,
        description: node.description,
        assignee: node.assignee,
        department: node.department,
        system: node.system,
        ...getNodeRunParams(g, node),
        annual_count: node.annual_count ?? "",
        fte: node.fte ?? "",
        url: node.url ?? "",
        urlLabel: node.url_label ?? "",
        groups: node.group_ids.map((id) => groupLabel.get(id) ?? "").filter(Boolean).join(", "),
        next,
      };
      rows.push(row);
      rowByNodeId.set(node.id, row);
    }

    // 규칙4 주석 수집 — SP는 rowByNodeId에 없어 주석 자동 소멸. 재수렴 중복 방지 포함(1안과 동일)
    for (const node of ordered) {
      if (node.node_type !== "decision") continue;
      const decisionRow = rowByNodeId.get(node.id);
      if (!decisionRow) continue;
      const seenPairs = new Map<WbsNodeRow, Set<string>>();
      for (const e of outgoing.get(node.id) ?? []) {
        if (e.label === "") continue;
        for (const { node: t, label } of resolveTargets(e, e.label, new Set())) {
          const targetRow = rowByNodeId.get(t.id);
          if (!targetRow) continue;
          const labels = seenPairs.get(targetRow) ?? new Set<string>();
          if (labels.has(label)) continue;
          labels.add(label);
          seenPairs.set(targetRow, labels);
          annotations.push({ target: targetRow, decision: decisionRow, label });
        }
      }
    }
  };

  await emit(graph, [mapName], new Set(rootMapId != null ? [rootMapId] : []));

  // 번호 부여(1..n 연속) → 주석 조립 — next는 emit 시점 확정이라 주석이 섞이지 않는다
  let no = 0;
  for (const row of rows) {
    if (row.kind === "node") {
      no += 1;
      row.no = no;
    }
  }
  for (const { target, decision, label } of annotations) {
    target.title += ` [${decision.no}:${label}]`;
  }

  const maxLevel = rows.reduce((m, r) => Math.max(m, r.levels.length), 1);
  return { mapName, versionLabel, exportedAt, maxLevel, rows, truncated };
}
```

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/excel-wbs.test.ts src/lib/excel-export.test.ts`
Expected: 신규 11 + 기존 34 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/excel-export.ts src/lib/excel-wbs.ts src/lib/excel-wbs.test.ts
git commit -m "feat(excel-wbs): WBS model builder with level-path rows — 레벨 경로 WBS 모델(SP 무행·start/end 전부 삭제)"
```

---

### Task 2: `writeWbsSheet` + 다운로드 공용화

**Files:**
- Modify: `frontend/src/lib/excel-export.ts` (`downloadWorkbookXlsx` 추출)
- Modify: `frontend/src/lib/excel-wbs.ts` (시트 기록·다운로드)
- Test: `frontend/src/lib/excel-wbs.test.ts`

**Interfaces:**
- Consumes: Task 1의 `WbsModel`, excel-export의 `COLUMNS`·`NOTE_TEXT`·`HEADER_FILL`.
- Produces: `writeWbsSheet(workbook, model): void`, `downloadWbsExcel(model, fileName): Promise<void>`, excel-export의 `downloadWorkbookXlsx(write: (wb: import("exceljs").Workbook) => void, fileName: string): Promise<void>` — Task 3(모달)이 `downloadExcel`/`downloadWbsExcel` 소비.

- [ ] **Step 1: 실패 테스트 작성** — `excel-wbs.test.ts`에 추가 (파일 상단 import에 `import { Workbook } from "exceljs";`와 `import { buildWbsModel, writeWbsSheet } from "./excel-wbs";`로 갱신, `COLUMNS`는 `import { COLUMNS } from "./excel-export";`):

```ts
describe("writeWbsSheet", () => {
  function buildSheet(model: Parameters<typeof writeWbsSheet>[1]) {
    const workbook = new Workbook();
    writeWbsSheet(workbook, model);
    const sheet = workbook.getWorksheet("WBS");
    if (!sheet) throw new Error("sheet missing");
    return sheet;
  }
  const baseRow = {
    kind: "node" as const, no: 1, levels: ["Root", "Sub"], title: "P", type: "process",
    description: "", assignee: "", department: "", system: "",
    duration: "1.30", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
    url: "https://example.com/doc", urlLabel: "Doc", groups: "", next: "Next step",
  };
  const model = {
    mapName: "Root", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
    maxLevel: 2, truncated: false, rows: [baseRow],
  };

  it("동적 헤더: No, Level 1..N, Task, 그리고 1안 속성 꼬리(Type~Next)", () => {
    const sheet = buildSheet(model);
    const header = sheet.getRow(4).values as unknown[];
    expect(header.slice(1)).toEqual([
      "No", "Level 1", "Level 2", "Task",
      ...COLUMNS.slice(2).map((c) => c.header),
    ]);
  });

  it("레벨 셀은 모든 행에 반복 기재 + 회색 폰트, No·Task는 모델 그대로", () => {
    const sheet = buildSheet(model);
    const r = sheet.getRow(5);
    expect(r.getCell(1).value).toBe(1);
    expect(r.getCell(2).value).toBe("Root");
    expect(r.getCell(3).value).toBe("Sub");
    expect(r.getCell(4).value).toBe("P");
    expect(r.getCell(2).font?.color?.argb).toBe("FF9CA3AF");
    expect(r.getCell(3).font?.color?.argb).toBe("FF9CA3AF");
  });

  it("numFmt는 레벨 수만큼 시프트된 위치에 적용되고 숫자 셀은 실제 숫자", () => {
    const sheet = buildSheet(model);
    const r = sheet.getRow(5);
    // Task(4열) 다음이 Type(5열) — Duration은 COLUMNS 꼬리에서 찾은 인덱스 + 시프트
    const tail = COLUMNS.slice(2);
    const durationCol = 5 + tail.findIndex((c) => c.header === "Duration (h)");
    expect(r.getCell(durationCol).numFmt).toBe("0.00");
    expect(r.getCell(durationCol).value).toBe(1.3);
    const krwCol = 5 + tail.findIndex((c) => c.header === "Cost (KRW)");
    expect(r.getCell(krwCol).numFmt).toBe("#,##0");
    expect(r.getCell(krwCol).value).toBe(1250000);
  });

  it("URL 하이퍼링크·노트 행 이탤릭이 시프트된 위치에 기록된다", () => {
    const sheet = buildSheet({
      ...model,
      rows: [baseRow, { kind: "denied" as const, levels: ["Root"], title: "Sub" }],
    });
    const tail = COLUMNS.slice(2);
    const urlCol = 5 + tail.findIndex((c) => c.header === "URL");
    const r5 = sheet.getRow(5);
    expect(r5.getCell(urlCol).value).toEqual({ text: "Doc", hyperlink: "https://example.com/doc" });
    const r6 = sheet.getRow(6);
    expect(r6.getCell(4).value).toBe("(access denied)");
    expect(r6.getCell(4).font?.italic).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/excel-wbs.test.ts`
Expected: 신규 4개 FAIL(`writeWbsSheet` 미존재), Task 1 테스트 PASS.

- [ ] **Step 3: 구현**

1. `excel-export.ts` — `downloadExcel`을 분해:
```ts
/** 워크북 조립 콜백 → .xlsx 다운로드 — exceljs 동적 import 공용(1안/2안 시트가 공유). */
export async function downloadWorkbookXlsx(
  write: (workbook: import("exceljs").Workbook) => void,
  fileName: string,
): Promise<void> {
  const { Workbook } = await import("exceljs");
  const workbook = new Workbook();
  write(workbook);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** ExcelModel → .xlsx 파일 다운로드. */
export async function downloadExcel(model: ExcelModel, fileName: string): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeExcelSheet(workbook, model), fileName);
}
```
(기존 `downloadExcel` 본문·주석을 대체 — dynamic import 관련 기존 주석은 `downloadWorkbookXlsx`로 이동.)

2. `excel-wbs.ts` — import에 `NOTE_TEXT`·`HEADER_FILL`·`COLUMNS`·`downloadWorkbookXlsx` 추가 후 파일 끝에:
```ts
const LEVEL_FONT_ARGB = "FF9CA3AF"; // 레벨 경로 회색 톤다운 — 출력물이라 raw hex 허용(design.md §1 예외)

/** WbsModel → "WBS" 워크시트 기록 — 동적 레벨 컬럼(No | Level 1..N | Task | 1안 속성 꼬리). */
export function writeWbsSheet(workbook: import("exceljs").Workbook, model: WbsModel): void {
  const sheet = workbook.addWorksheet("WBS", { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.addRow([model.mapName]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([`Version: ${model.versionLabel}    Exported: ${model.exportedAt}${model.truncated ? "    (truncated)" : ""}`]);
  sheet.addRow([]);
  // 속성 꼬리는 1안 COLUMNS의 Type~Next 정의 재사용 — numFmt를 인덱스가 아닌 정의에서 파생(1안 교훈)
  const tail = COLUMNS.slice(2);
  const headerRow = sheet.addRow([
    "No",
    ...Array.from({ length: model.maxLevel }, (_, i) => `Level ${i + 1}`),
    "Task",
    ...tail.map((c) => c.header),
  ]);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.border = { bottom: { style: "thin" } };
  });
  const taskCol = 2 + model.maxLevel; // 1=No, 2..1+N=레벨, 그 다음이 Task
  sheet.getColumn(1).width = 6;
  for (let i = 0; i < model.maxLevel; i += 1) sheet.getColumn(2 + i).width = 18;
  sheet.getColumn(taskCol).width = 32;
  tail.forEach((c, i) => {
    sheet.getColumn(taskCol + 1 + i).width = c.width;
  });
  const urlCol = taskCol + 1 + tail.findIndex((c) => c.header === "URL");

  for (const row of model.rows) {
    const levelCells = Array.from({ length: model.maxLevel }, (_, i) => row.levels[i] ?? "");
    if (row.kind !== "node") {
      const r = sheet.addRow(["", ...levelCells, NOTE_TEXT[row.kind]]);
      r.getCell(taskCol).font = { italic: true };
      for (let i = 0; i < model.maxLevel; i += 1) r.getCell(2 + i).font = { color: { argb: LEVEL_FONT_ARGB } };
      continue;
    }
    const num = (v: string) => (v === "" ? "" : Number(v));
    const r = sheet.addRow([
      row.no, ...levelCells, row.title, row.type, row.description, row.assignee, row.department, row.system,
      num(row.duration), num(row.cost_krw), num(row.cost_usd), num(row.headcount), num(row.annual_count), num(row.fte),
      "", row.groups, row.next,
    ]);
    for (let i = 0; i < model.maxLevel; i += 1) r.getCell(2 + i).font = { color: { argb: LEVEL_FONT_ARGB } };
    tail.forEach((c, i) => {
      if ("numFmt" in c) r.getCell(taskCol + 1 + i).numFmt = c.numFmt;
    });
    if (row.url) {
      r.getCell(urlCol).value = { text: row.urlLabel || row.url, hyperlink: row.url };
      r.getCell(urlCol).font = { color: { argb: "FF6A41FF" }, underline: true };
    }
  }
}

/** WbsModel → .xlsx 다운로드 — 1안과 동일한 공용 다운로드 경로. */
export async function downloadWbsExcel(model: WbsModel, fileName: string): Promise<void> {
  await downloadWorkbookXlsx((workbook) => writeWbsSheet(workbook, model), fileName);
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/excel-wbs.test.ts src/lib/excel-export.test.ts`
Expected: 전체 PASS(1안 34 포함).

- [ ] **Step 5: 커밋**

```bash
git add src/lib/excel-export.ts src/lib/excel-wbs.ts src/lib/excel-wbs.test.ts
git commit -m "feat(excel-wbs): WBS sheet writer with dynamic level columns — 동적 레벨 컬럼 시트+다운로드 공용화"
```

---

### Task 3: 형식 선택 모달 + 에디터 연결 + i18n

**Files:**
- Create: `frontend/src/components/excel-export-modal.tsx`
- Modify: `frontend/src/app/maps/[mapId]/page.tsx` (Excel 버튼 → 모달)
- Modify: `frontend/src/lib/i18n-messages.ts` (en/ko)

**Interfaces:**
- Consumes: `ExcelModel`·`downloadExcel`(excel-export), `WbsModel`·`downloadWbsExcel`(excel-wbs), `useI18n`(`@/lib/i18n`).
- Produces: `ExcelExportModal` 컴포넌트 — props `{ open: boolean; onClose: () => void; buildMap: () => Promise<ExcelModel>; buildWbs: () => Promise<WbsModel>; fileNameFor: (format: "map" | "wbs") => string }`.

- [ ] **Step 1: i18n 키 추가** — `i18n-messages.ts`의 en 블록(`"inspector.exportExcel"` 근처)과 ko 블록 대응 위치에:

```ts
  // en
  "export.modalTitle": "Export to Excel",
  "export.formatMap": "Process Map",
  "export.formatWbs": "WBS",
  "export.previewLabel": "Preview (first 8 rows)",
  "export.previewLoading": "Building preview…",
  "export.previewError": "Failed to build the export model",
  "export.previewEmpty": "No rows to export",
  "export.truncatedNote": "Row limit reached — output truncated",
  "export.download": "Download",
  "export.cancel": "Cancel",
```
```ts
  // ko
  "export.modalTitle": "Excel 내보내기",
  "export.formatMap": "Process Map",
  "export.formatWbs": "WBS",
  "export.previewLabel": "미리보기 (앞 8행)",
  "export.previewLoading": "미리보기 생성 중…",
  "export.previewError": "내보내기 모델 생성에 실패했습니다",
  "export.previewEmpty": "내보낼 행이 없습니다",
  "export.truncatedNote": "행 상한 도달 — 출력이 잘렸습니다",
  "export.download": "Download",
  "export.cancel": "Cancel",
```
(기존 `"export.excelTruncated"` 키는 그대로 두되 page.tsx에서 더는 호출하지 않음 — 모달의 truncatedNote가 대체.)

- [ ] **Step 2: 모달 컴포넌트** — `frontend/src/components/excel-export-modal.tsx` 신규:

```tsx
// Excel 내보내기 형식 선택 모달 — 토글 탭(top-nav 한/영 세그먼트 디자인) + 첫 8행 미리보기 + 다운로드.
// 모델은 탭 활성화 시 lazy 빌드(모달 열려있는 동안 캐시). 설계: 2026-07-17-excel-export-wbs-v2-design.md
"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

import { downloadExcel, type ExcelModel } from "@/lib/excel-export";
import { downloadWbsExcel, type WbsModel } from "@/lib/excel-wbs";
import { useI18n } from "@/lib/i18n";

export type ExcelExportFormat = "map" | "wbs";

interface ExcelExportModalProps {
  open: boolean;
  onClose: () => void;
  buildMap: () => Promise<ExcelModel>;
  buildWbs: () => Promise<WbsModel>;
  fileNameFor: (format: ExcelExportFormat) => string;
}

type PreviewState<T> = { status: "idle" } | { status: "ready"; model: T } | { status: "error" };

const PREVIEW_ROWS = 8;

export function ExcelExportModal({ open, onClose, buildMap, buildWbs, fileNameFor }: ExcelExportModalProps) {
  const { t } = useI18n();
  const [format, setFormat] = useState<ExcelExportFormat>("map");
  const [mapState, setMapState] = useState<PreviewState<ExcelModel>>({ status: "idle" });
  const [wbsState, setWbsState] = useState<PreviewState<WbsModel>>({ status: "idle" });
  const [downloading, setDownloading] = useState(false);

  // 닫힐 때 캐시 초기화 — 다음 오픈 시 캔버스 최신 상태로 재빌드 (setState는 전부 비동기/이벤트 경로)
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => {
      setFormat("map");
      setMapState({ status: "idle" });
      setWbsState({ status: "idle" });
    }, 0);
    return () => clearTimeout(timer);
  }, [open]);

  // 활성 탭 모델 lazy 빌드 — idle일 때만, 결과는 .then에서 반영(동기 setState 금지 룰 준수)
  useEffect(() => {
    if (!open) return;
    if (format === "map" && mapState.status === "idle") {
      buildMap()
        .then((model) => setMapState({ status: "ready", model }))
        .catch(() => setMapState({ status: "error" }));
    }
    if (format === "wbs" && wbsState.status === "idle") {
      buildWbs()
        .then((model) => setWbsState({ status: "ready", model }))
        .catch(() => setWbsState({ status: "error" }));
    }
  }, [open, format, mapState.status, wbsState.status, buildMap, buildWbs]);

  if (!open) return null;

  const active = format === "map" ? mapState : wbsState;

  const handleDownload = async () => {
    if (active.status !== "ready" || downloading) return;
    setDownloading(true);
    try {
      if (format === "map") await downloadExcel((active as { model: ExcelModel }).model, fileNameFor("map"));
      else await downloadWbsExcel((active as { model: WbsModel }).model, fileNameFor("wbs"));
      onClose();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      data-id="excel-export-modal"
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-scrim backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[80%] w-[560px] flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
          <span className="text-body-strong text-ink">{t("export.modalTitle")}</span>
          <div className="ml-auto inline-flex items-center rounded-sm border border-hairline bg-surface-alt p-0.5 text-fine">
            {(["map", "wbs"] as const).map((code) => (
              <button
                key={code}
                type="button"
                data-id={`excel-format-${code}`}
                aria-pressed={format === code}
                className={
                  "rounded-xs px-1.5 py-0.5 " +
                  (format === code
                    ? "bg-accent-tint font-semibold text-accent"
                    : "text-ink-tertiary hover:text-ink-secondary")
                }
                onClick={() => setFormat(code)}
              >
                {code === "map" ? t("export.formatMap") : t("export.formatWbs")}
              </button>
            ))}
          </div>
          <button type="button" aria-label="Close" className="rounded-sm p-1 text-ink-muted hover:bg-surface-alt" onClick={onClose}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-40 flex-1 overflow-auto px-4 py-3">
          <div className="mb-1.5 text-caption text-ink-secondary">{t("export.previewLabel")}</div>
          {active.status === "idle" && <div className="text-caption text-ink-tertiary">{t("export.previewLoading")}</div>}
          {active.status === "error" && <div className="text-caption text-error">{t("export.previewError")}</div>}
          {active.status === "ready" && (
            <ExportPreviewTable format={format} model={(active as { model: ExcelModel | WbsModel }).model} emptyText={t("export.previewEmpty")} />
          )}
          {active.status === "ready" && (active as { model: ExcelModel | WbsModel }).model.truncated && (
            <div className="mt-1.5 text-fine text-ink-tertiary">{t("export.truncatedNote")}</div>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-hairline px-4 py-2">
          <button
            type="button"
            className="rounded-sm border border-hairline px-3 py-1.5 text-caption text-ink-secondary hover:bg-surface-alt"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-id="excel-export-download"
            disabled={active.status !== "ready" || downloading}
            className="rounded-sm bg-accent px-3 py-1.5 text-caption font-medium text-on-accent hover:bg-accent-focus disabled:opacity-50"
            onClick={() => void handleDownload()}
          >
            {t("export.download")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 미리보기 표 — Process Map: No·Name(들여쓰기)·Type·Next / WBS: No·Level 1..N(회색)·Task. */
function ExportPreviewTable({ format, model, emptyText }: { format: ExcelExportFormat; model: ExcelModel | WbsModel; emptyText: string }) {
  const rows = model.rows.slice(0, PREVIEW_ROWS);
  if (rows.length === 0) return <div className="text-caption text-ink-tertiary">{emptyText}</div>;
  const cellCls = "border-b border-hairline px-2 py-1 whitespace-nowrap";
  if (format === "map") {
    const nodeRows = rows as ExcelModel["rows"];
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-fine text-ink">
          <thead>
            <tr className="text-left text-ink-secondary">
              <th className={cellCls}>No</th><th className={cellCls}>Name</th><th className={cellCls}>Type</th><th className={cellCls}>Next</th>
            </tr>
          </thead>
          <tbody>
            {nodeRows.map((row, i) => (
              <tr key={i}>
                <td className={cellCls}>{row.kind === "node" ? row.no : ""}</td>
                <td className={cellCls} style={{ paddingLeft: `${8 + row.depth * 14}px` }}>
                  {row.kind === "node" ? row.title : <span className="italic text-ink-tertiary">({row.kind})</span>}
                </td>
                <td className={cellCls}>{row.kind === "node" ? row.type : ""}</td>
                <td className={cellCls}>{row.kind === "node" ? row.next : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const wbs = model as WbsModel;
  const wbsRows = rows as WbsModel["rows"];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-fine text-ink">
        <thead>
          <tr className="text-left text-ink-secondary">
            <th className={cellCls}>No</th>
            {Array.from({ length: wbs.maxLevel }, (_, i) => (
              <th key={i} className={cellCls}>{`Level ${i + 1}`}</th>
            ))}
            <th className={cellCls}>Task</th>
          </tr>
        </thead>
        <tbody>
          {wbsRows.map((row, i) => (
            <tr key={i}>
              <td className={cellCls}>{row.kind === "node" ? row.no : ""}</td>
              {Array.from({ length: wbs.maxLevel }, (_, li) => (
                <td key={li} className={`${cellCls} text-ink-tertiary`}>{row.levels[li] ?? ""}</td>
              ))}
              <td className={cellCls}>
                {row.kind === "node" ? row.title : <span className="italic text-ink-tertiary">({row.kind})</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```
주의: `bg-scrim` 토큰이 없으면 기존 모달들이 쓰는 오버레이 배경 클래스를 그대로 따른다(`node-summary-modal.tsx:371` 실물 확인 — backdrop-blur만일 수 있음). 버튼 커서·눌림은 전역 base가 처리하므로 hover 배경만 추가.

- [ ] **Step 3: page.tsx 연결** — python으로 위치 탐색(`ugrep 브래킷 함정`):

1. import 추가: `import { ExcelExportModal, type ExcelExportFormat } from "@/components/excel-export-modal";`, `import { buildWbsModel } from "@/lib/excel-wbs";` (기존 `buildExcelModel, downloadExcel` import에서 `downloadExcel` 제거 — 모달이 다운로드 담당).
2. 상태 추가(다른 모달 state 근처): `const [excelExportOpen, setExcelExportOpen] = useState(false);`
3. 기존 `handleExportExcel`(useCallback)을 **빌더 2개 + 파일명 함수로 대체**:
```tsx
  // Excel 모달용 모델 빌더 — 저장 경로와 동일 소스(buildGraph)로 미저장 편집분까지 반영
  const buildMapExcelModel = useCallback(() => {
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    return buildExcelModel({
      graph,
      mapName,
      versionLabel,
      exportedAt: formatKst(new Date().toISOString()),
      fetchResolved: (id, follow, pinned) => getResolvedGraph(id, follow, pinned),
      rootMapId: mapId,
    });
  }, [versions, versionId, mapName, mapId]);

  const buildWbsExcelModel = useCallback(() => {
    const graph = buildGraph(nodesRef.current, edgesRef.current, groupsRef.current);
    const versionLabel = versions.find((version) => version.id === versionId)?.label ?? "";
    return buildWbsModel({
      graph,
      mapName,
      versionLabel,
      exportedAt: formatKst(new Date().toISOString()),
      fetchResolved: (id, follow, pinned) => getResolvedGraph(id, follow, pinned),
      rootMapId: mapId,
    });
  }, [versions, versionId, mapName, mapId]);

  const excelFileNameFor = useCallback(
    (format: ExcelExportFormat) =>
      format === "wbs" ? buildExportFileName("xlsx").replace(/\.xlsx$/, "_WBS.xlsx") : buildExportFileName("xlsx"),
    [buildExportFileName],
  );
```
4. Excel 버튼(`data-id="export-excel"`)의 onClick을 `onClick={() => setExcelExportOpen(true)}`로 교체(버튼 마크업·아이콘 유지).
5. 페이지의 다른 모달 렌더 지점 근처에:
```tsx
      <ExcelExportModal
        open={excelExportOpen}
        onClose={() => setExcelExportOpen(false)}
        buildMap={buildMapExcelModel}
        buildWbs={buildWbsExcelModel}
        fileNameFor={excelFileNameFor}
      />
```
6. `handleExportExcel`에서만 쓰던 것들 정리: `downloadExcel` import, `t("err.exportExcel")`/`showToast(t("export.excelTruncated"))` 호출부(다른 사용처 없으면 import·키는 잔존 가능 — 코드만 제거).

- [ ] **Step 4: 게이트 확인**

Run: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`
Expected: vitest 전체 PASS, tsc 0, lint 0 err(기존 경고 1 허용 — `react-hooks/preserve-manual-memoization`·`set-state-in-effect` 신규 경고가 나오면 수정), build 성공.

- [ ] **Step 5: 커밋**

```bash
git add src/components/excel-export-modal.tsx "src/app/maps/[mapId]/page.tsx" src/lib/i18n-messages.ts
git commit -m "feat(editor): excel export format modal with toggle tabs and preview — 형식 토글 탭+미리보기 모달"
```

---

### Task 4: 전체 게이트 + PROGRESS

**Files:**
- Modify: `PROGRESS.md` (워크트리 루트)

- [ ] **Step 1: 게이트** — `npx vitest run` / `npx tsc --noEmit` / `npm run lint` / `npm run build` 전부 그린 확인(각 요약 라인 기록).

- [ ] **Step 2: PROGRESS.md 최상단에 추가**

```markdown
## 2026-07-17 — Excel 출력 양식 2안(WBS) + 형식 선택 모달 (worktree-excel-export)
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-wbs-v2-design.md`. 신규 `lib/excel-wbs.ts` — 잎 업무 행+레벨 경로(`levels`), SP 무행(레벨 값=SP 노드 타이틀·루트=맵 이름), start/end 전부 삭제(Next 종착 텍스트 유지), 무라벨 디시전 flow-through·`[No:라벨]` 주석(SP 대상 소멸)은 1안과 동일 체계. 시트 "WBS": 동적 Level 1..N 컬럼(회색 `FF9CA3AF`)+1안 속성 꼬리(numFmt 정의 파생).
- Excel 버튼 → 형식 선택 모달(`components/excel-export-modal.tsx`): 한/영 세그먼트 토글 디자인 탭(Process Map/WBS)+첫 8행 미리보기(lazy 빌드·캐시)+Download. 파일명 WBS는 `_WBS` 접미. 다운로드는 `downloadWorkbookXlsx` 공용화(exceljs 동적 import 유지).
- 게이트: vitest 전체·tsc·lint·build 그린.
```

- [ ] **Step 3: 커밋**

```bash
git add PROGRESS.md
git commit -m "docs(progress): excel WBS variant + export modal implemented — 2안 WBS+모달 기록"
```

---

### Task 5: 실기동 검증 — 모달 플로우 + 양 형식 다운로드 파싱

**Files:**
- Create: `frontend/scripts/pw-verify-excel-wbs.mjs`
- Modify: `PROGRESS.md` (검증 줄 추가)

**Interfaces:**
- Consumes: 에디터 `[data-id="export-excel"]`(모달 오픈으로 변경됨), 모달 `[data-id="excel-export-modal"]`·`[data-id="excel-format-wbs"]`·`[data-id="excel-export-download"]`, 백엔드 맵 생성·그래프 PUT·**서브프로세스 지정**(레벨 2 검증용).
- 참고 스크립트: `scripts/pw-verify-excel-format-v1.mjs`(맵 생성·checkout·다운로드 파싱), `scripts/pw-verify-sp-params.mjs`(**게시+SP 지정 절차** — 자식 맵을 published로 만들고 지정하는 API 시퀀스는 이 스크립트의 방식을 그대로 재사용).

- [ ] **Step 1: 서버 기동** — v1 스크립트와 동일(pkill 좀비 정리 → backend reset_db+uvicorn :8000 → frontend :3000 — 3001 폴백 시 재-pkill).

- [ ] **Step 2: 스크립트 작성** — 시나리오(체크 12개):

픽스처: 부모 맵 A(스크래치): `Start → Prepare → SubWork(SP→자식 맵 B) → Approve?(yes→Ship, no→End) → Ship → End(기본)`. 자식 맵 B(스크래치): `Start → Pick items → Pack items → End(기본)` — B는 게시+SP 지정(pw-verify-sp-params.mjs 절차). 두 맵 모두 종료 시 소프트삭제.

1. Excel 버튼 클릭 → `[data-id="excel-export-modal"]` 표시(즉시 다운로드 아님)
2. 기본 탭 Process Map 미리보기 렌더(표에 "Prepare" 텍스트 등장 대기)
3. Process Map 탭에서 Download → xlsx 파싱: 시트명 "Process Map", 헤더 16컬럼, SubWork 행 존재+자식 잎 들여쓰기 행(1안 회귀)
4. 모달 재오픈 → `[data-id="excel-format-wbs"]` 클릭 → WBS 미리보기 렌더("Level 1" 헤더 등장 대기)
5. WBS Download → xlsx 파싱: 시트명 "WBS", 헤더 `No, Level 1, Level 2, Task, Type, …, Next`
6. WBS 행: start/end 타입 행 0개(Type 컬럼 기준)
7. WBS 행: SubWork(서브프로세스) Task 행 없음 — 대신 Pick items/Pack items 행의 Level 2가 "SubWork"
8. 루트 잎 행(Prepare)의 Level 1 = 맵 A 이름·Level 2 빈칸
9. Approve? 디시전 행 존재(라벨 분기 유지), Ship 행 제목 `Ship [<Approve? no>:yes]` 주석
10. WBS No 컬럼 1..n 연속
11. 레벨 셀 회색 폰트(`FF9CA3AF`) — exceljs `font.color.argb`로 1셀 검사
12. 콘솔 에러 0

구현 뼈대는 `pw-verify-excel-format-v1.mjs`를 복제해 다운로드를 2회로 확장(각 `waitForEvent("download")`), 지정 절차만 sp-params 스크립트에서 이식한다. 다운로드 트리거는 모달 Download 버튼(`[data-id="excel-export-download"]`, disabled 해제 대기 후 클릭).

- [ ] **Step 3: 실행·통과 확인**

Run: `node scripts/pw-verify-excel-wbs.mjs`
Expected: `12/12 passed`, exit 0. 실패 시 detail로 원인 구분(지정 API 422면 sp-params 스크립트의 게시·지정 시퀀스와 대조).

- [ ] **Step 4: 서버 정리 + PROGRESS + 커밋**

`pkill -f "next dev"; pkill -f "uvicorn app.main"` 후 PROGRESS의 Task 4 항목에 줄 추가: `- 실기동 검증 pw-verify-excel-wbs.mjs 12/12 PASS(모달 플로우·양 형식 다운로드 파싱 — WBS 레벨 컬럼·SP 무행·start/end 0행·주석·1안 회귀·콘솔 0).`

```bash
git add scripts/pw-verify-excel-wbs.mjs PROGRESS.md
git commit -m "test(excel-wbs): browser verification for WBS variant and export modal — 실기동 12종"
```

---

## Self-Review 결과

- **스펙 커버리지**: 시트 레이아웃(Task 2)·행 규칙 4종(Task 1)·모달 UX(Task 3)·노트 행/상한/다이아몬드(Task 1·2)·실기동(Task 5) 전부 태스크에 매핑. 1안 무변경 제약은 각 태스크 게이트(기존 34 테스트 그린)로 강제.
- **플레이스홀더**: 없음 — 모든 코드 스텝에 실제 코드(Task 5 스크립트만 뼈대+참조 스크립트 지정 — 지정 절차가 기존 스크립트에 실존하므로 이식 지시가 정확).
- **타입 일관성**: `WbsModel`/`WbsNodeRow.levels`(Task 1 정의 → Task 2 writer·Task 3 미리보기 소비), `downloadWorkbookXlsx`(Task 2 정의 → 1안 downloadExcel·2안 downloadWbsExcel 공용), 모달 props(Task 3 정의 = page.tsx 전달 값) 일치 확인.
