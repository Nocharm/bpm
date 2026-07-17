# Excel 출력 양식 개선 1안 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 엑셀 내보내기에서 구조 노드 행(첫 start 외 start·기본 제목 end·무라벨 디시전)을 제거하고, 라벨 분기의 대상 노드 Name에 `[디시전No:라벨]` 주석을 붙인다.

**Architecture:** `frontend/src/lib/excel-export.ts`의 `buildExcelModel` emit 내부에서 행 미생성(삭제 규칙)·flow-through Next·행 객체 참조 주석을 처리하고, 행 번호(No)를 모델로 이동해 emit 종료 후 번호 부여→주석 조립한다. `writeExcelSheet`는 지역 카운터 대신 `row.no`를 기록. 스펙: `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md`.

**Tech Stack:** TypeScript(Next.js lib 모듈), vitest, exceljs(동적 import 유지), Playwright(playwright-core)+시스템 Chrome 실기동 검증.

## Global Constraints

- CSV 내보내기(`csv-export.ts`)는 **절대 수정 금지** — csv-import 왕복 계약.
- `frontend/src/lib/params.ts`·백엔드 수정 없음. 프론트 1파일+테스트+검증 스크립트만.
- 주석·테스트 설명은 한국어, 코드 식별자·커밋 제목은 영어 (rules/guidelines.md §5).
- 커밋 메시지: `type(scope): English summary — 한국어 요약` + 하네스 트레일러(Co-Authored-By/Claude-Session).
- exceljs는 동적 import 유지(에디터 번들 오염 금지, frontend/AGENTS.md).
- 모든 명령은 워크트리 `frontend/`( `/Users/hyeonjin/Documents/bpm/.claude/worktrees/excel-export/frontend` )에서 실행. **이 워크트리 밖(메인 체크아웃)에서 커밋 금지** — 시작 전 `pwd`·`git branch --show-current`(=`worktree-excel-export`) 확인.
- `grep`은 ugrep이라 `[mapId]` 브래킷 디렉터리를 건너뜀 — page.tsx 검색은 python/find 사용 (이번 계획에선 page.tsx 수정 없음).

## 파일 구조

| 파일 | 역할 |
|------|------|
| `frontend/src/lib/excel-export.ts` | 모델 빌더+시트 기록 — 삭제 규칙·flow-through·주석·No 부여 전부 여기 |
| `frontend/src/lib/excel-export.test.ts` | 모델·시트 단위 테스트 — 신규 규칙 테스트 + 기존 픽스처 기대값 보정 |
| `frontend/scripts/pw-verify-excel-format-v1.mjs` | 신규 실기동 검증(스크래치 맵 → 다운로드 xlsx 파싱 → 규칙 4종 단언) |

기존 `scripts/pw-verify-export.mjs`는 구 15컬럼(ETF/Cost/Extra) 기준의 낡은 스크립트 — 이번 범위에서 수정하지 않는다(멘션만).

---

### Task 1: 규칙 2·3 — start/end 행 제거 (모델)

**Files:**
- Modify: `frontend/src/lib/excel-export.ts` (emit 루프)
- Test: `frontend/src/lib/excel-export.test.ts`

**Interfaces:**
- Consumes: 기존 `buildExcelModel` 시그니처(무변경), `orderNodesByFlow`(csv-export).
- Produces: emit 내부 `outgoing: Map<string, GraphEdge[]>`, `ordered`, `isRowRemoved(n)` — Task 2·3이 이 구조 위에 쌓는다.

- [ ] **Step 1: 신규 실패 테스트 2개 작성** — `describe("buildExcelModel")` 블록 끝(507행 `});` 직전)에 추가:

```ts
  it("규칙3: 기본 제목 end는 대소문자·공백 무관 삭제, 커스텀 제목 end는 유지", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("e1", "  END ", "end", 2, { is_primary_end: true }),
        makeNode("e2", "출하 종료", "end", 3),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "e1"), makeEdge("x3", "a1", "e2")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const titles = model.rows.filter((r) => r.kind === "node").map((r) => r.title);
    expect(titles).toEqual(["Start", "A", "출하 종료"]);
    // 행만 삭제 — next의 종착 표기는 유지된다
    const aRow = model.rows.find((r) => r.kind === "node" && r.title === "A");
    expect(aRow && aRow.kind === "node" ? aRow.next : "").toBe("  END ;출하 종료");
  });

  it("규칙2: 루트에 start가 2개면 BFS 기점만 남는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("s2", "Start 2", "start", 5),
      ],
      edges: [makeEdge("x1", "s1", "a1")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.rows.filter((r) => r.kind === "node").map((r) => r.title)).toEqual(["Start", "A"]);
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 신규 2개 FAIL (기존 동작은 start/end 행을 전부 생성), 나머지 PASS.

- [ ] **Step 3: 구현** — `excel-export.ts`의 `emit` 함수를 아래로 교체 (import에 `GraphEdge` 타입 추가: `import type { Graph, GraphEdge, GraphNode } from "./api";`):

```ts
  const emit = async (g: Graph, depth: number, ancestry: ReadonlySet<number>): Promise<void> => {
    const byId = new Map(g.nodes.map((n) => [n.id, n]));
    const groupLabel = new Map(g.groups.map((gr) => [gr.id, gr.label]));
    const outgoing = new Map<string, GraphEdge[]>();
    for (const e of g.edges) {
      const list = outgoing.get(e.source_node_id);
      if (list) list.push(e);
      else outgoing.set(e.source_node_id, [e]);
    }
    const ordered = orderNodesByFlow(g.nodes, g.edges);
    // 규칙2: 루트 스코프 BFS 기점 start만 유지 — 서브프로세스 인라인·미도달 추가 start는 행 미생성
    const keptStartId = depth === 0 ? ordered.find((n) => n.node_type === "start")?.id : undefined;
    // 규칙3: 기본 제목 end는 행 미생성(커스텀 제목 end는 유지) — next의 "End" 표기는 그대로 남는다
    const isDefaultEnd = (n: GraphNode): boolean =>
      n.node_type === "end" && n.title.trim().toLowerCase() === "end";
    const isRowRemoved = (n: GraphNode): boolean =>
      (n.node_type === "start" && n.id !== keptStartId) || isDefaultEnd(n);

    for (const node of ordered) {
      if (isRowRemoved(node)) continue; // 삭제 행은 상한(maxRows)을 소비하지 않는다
      if (rows.length >= maxRows) {
        // 재귀 레벨 무관 상한 공유 — truncated 이미 true면 rowLimit 재생성 없이 즉시 중단 전파
        if (!truncated) rows.push({ kind: "rowLimit", depth, title: "" });
        truncated = true;
        return;
      }
      const next = (outgoing.get(node.id) ?? [])
        .map((e) => {
          const target = byId.get(e.target_node_id);
          if (!target) return null;
          return e.label === "" ? target.title : `${target.title}:${e.label}`;
        })
        .filter((s): s is string => s !== null)
        .join(";");
      rows.push({
        kind: "node",
        depth,
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
      });
      if (node.node_type === "subprocess" && node.linked_map_id !== null && !truncated) {
        if (ancestry.has(node.linked_map_id)) {
          rows.push({ kind: "circular", depth: depth + 1, title: node.title });
          continue;
        }
        let resolved: Graph;
        try {
          resolved = await fetchMemo(node.linked_map_id, node.follow_latest, node.linked_version_id);
        } catch {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        if (resolved.locked) {
          rows.push({ kind: "denied", depth: depth + 1, title: node.title });
          continue;
        }
        await emit(resolved, depth + 1, new Set([...ancestry, node.linked_map_id]));
      }
    }
  };
```

파일 상단 주석(1~4행)에 스펙 참조 1줄 추가: `//       docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md (구조 노드 정리+분기 주석)`.

- [ ] **Step 4: 기존 테스트 기대값 보정** — start/end 행 제거로 깨지는 9곳. 각 위치의 기대 배열만 교체:

1. **34행 테스트** (66~73행 `toEqual`):
```ts
    expect(rows.map((r) => (r.kind === "node" ? [r.title, r.depth] : [r.kind, r.depth]))).toEqual([
      ["Start", 0],
      ["Sub", 0],
      ["P", 1],
    ]);
```
2. **76행 테스트** (113~118행):
```ts
    expect(kindsWithDepth).toEqual([
      ["Start", 0], ["SubToMap2", 0],
      ["SubToMap1", 1],
      ["circular", 2],
    ]);
```
3. **121행 테스트** (156~162행):
```ts
    expect(kindsWithDepth).toEqual([
      ["Start", 0], ["SubToMap2", 0],
      ["SubToMap1", 1],
      ["SubToMap2", 2],
      ["circular", 3],
    ]);
```
4. **165행 테스트** (201행):
```ts
    expect(kinds).toEqual(["Start", "SubToMap2", "SubToMap3", "SubToMap2Again", "circular"]);
```
5. **204행 테스트** (237~244행):
```ts
    expect(kinds).toEqual([
      ["Start", 0],
      ["SubA", 0],
      ["Shared", 1],
      ["SubB", 0],
      ["Shared", 1],
    ]);
```
6. **266행 테스트** (283행):
```ts
    expect(model.rows.map((r) => (r.kind === "node" ? r.title : r.kind))).toEqual(["Start", "Sub", "denied"]);
```
7. **286행 테스트(행 상한)**: 기본 End가 행에서 빠져 5행 정확히 채우고 끝나므로 초과가 안 생김 — process 노드 1개를 추가해 상한 초과 유지. 노드 배열에 `makeNode("f1", "F", "process", 5),`를 `d1` 다음에 추가하고 `e1`의 sort_order를 6으로, 엣지를 `makeEdge("x5", "d1", "f1"), makeEdge("x6", "f1", "e1")`로 교체. 주석(287행)을 `// maxRows: 5 로 작게 줘서 검증 — start,a,b,c,d,f 6개 행 후보(기본 End는 행 미생성)`로 갱신. 기대값(312행)은 동일:
```ts
    expect(kinds).toEqual(["Start", "A", "B", "C", "D", "rowLimit"]);
```
8. **317행 테스트** (341행 주석과 349행): 주석을 `// maxRows:3 → Start(1), Sub(2), map2의 start는 행 미생성이라 P2A(3), P2B에서 rowLimit → 이후 전부 중단`으로, 기대값을:
```ts
    expect(kinds).toEqual(["Start", "Sub", "P2A", "rowLimit"]);
```
9. **352행 테스트**: 이름과 기대값을 재작성(픽스처는 그대로) — `it("루트 start는 남고 기본 end 행은 빠지되 next엔 End 표기가 유지된다", ...)`:
```ts
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B"]);
    const aRow = nodeRows.find((r) => r.title === "A");
    expect(aRow?.next).toBe("B:approve;End:reject");
    const bRow = nodeRows.find((r) => r.title === "B");
    expect(bRow?.next).toBe("End");
```
(끝의 `endRow` 2줄은 삭제 — End 행이 더는 없다.)

385·419·444·483행 테스트는 유지 노드(title find 기반)만 단언하므로 무수정.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/excel-export.ts src/lib/excel-export.test.ts
git commit -m "feat(excel-export): drop non-first start and default-titled end rows — 첫 start 외·기본 end 행 제거"
```

---

### Task 2: 규칙 1 — 무라벨 디시전 행 제거 + Next flow-through

**Files:**
- Modify: `frontend/src/lib/excel-export.ts` (Task 1의 emit 내부)
- Test: `frontend/src/lib/excel-export.test.ts`

**Interfaces:**
- Consumes: Task 1의 `outgoing`·`ordered`·`isRowRemoved`.
- Produces: `resolveTargets(edge, label, seen): Array<{ node: GraphNode; label: string }>` — Task 3의 규칙4 주석 수집이 재사용.

- [ ] **Step 1: 실패 테스트 5개 작성** — `describe("buildExcelModel")` 끝에 추가 (공용 `fetchResolved`는 각 테스트에서 `async (): Promise<Graph> => { throw new Error("unused"); }`):

```ts
  it("규칙1: 전부 무라벨 디시전은 행에서 빠지고 선행 노드 next가 대상들로 flow-through된다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("p1", "Par", "decision", 2),
        makeNode("b1", "B", "process", 3),
        makeNode("c1", "C", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "p1"),
        makeEdge("x3", "p1", "b1"), makeEdge("x4", "p1", "c1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B", "C"]);
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("B;C");
  });

  it("규칙1: 연쇄 무라벨 디시전은 재귀 통과하고 삭제 디시전 간 순환은 무한루프 없이 닫힌다", async () => {
    // A→P1→P2→B, P2→P1 역엣지 — P1·P2 모두 무라벨 디시전(삭제), A.next는 "B"
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("p1", "P1", "decision", 2),
        makeNode("p2", "P2", "decision", 3),
        makeNode("b1", "B", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "p1"), makeEdge("x3", "p1", "p2"),
        makeEdge("x4", "p2", "b1"), makeEdge("x5", "p2", "p1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B"]);
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("B");
  });

  it("규칙1: 일부 분기만 라벨이면(혼합) 행 유지", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C", "process", 3),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "b1", "yes"),
        makeEdge("x3", "d1", "c1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "B", "C"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("B:yes;C");
  });

  it("규칙1: 나가는 엣지 없는 디시전은 유지(WIP 보호)", async () => {
    const map1: Graph = {
      nodes: [makeNode("s1", "Start", "start", 0), makeNode("d1", "D", "decision", 1)],
      edges: [makeEdge("x1", "s1", "d1")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.rows.filter((r) => r.kind === "node").map((r) => r.title)).toEqual(["Start", "D"]);
  });

  it("라벨 디시전→무라벨 디시전 경유 시 라벨이 최종 대상까지 전파된다(next)", async () => {
    // D ─go→ P(무라벨 디시전) → A,B — D.next는 "A:go;B:go"
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("p1", "P", "decision", 2),
        makeNode("a1", "A", "process", 3),
        makeNode("b1", "B", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "p1", "go"),
        makeEdge("x3", "p1", "a1"), makeEdge("x4", "p1", "b1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "A", "B"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("A:go;B:go");
  });
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 신규 5개 중 4개 FAIL("엣지 없는 디시전 유지"는 현행도 유지라 PASS 가능), 기존 PASS.

- [ ] **Step 3: 구현** — emit 내부에 추가/교체:

`keptStartId` 선언 **위**에 추가:
```ts
    // 규칙1: 나가는 엣지가 있고 전부 무라벨인 디시전 = 단순 병렬 분기 — 행 미생성(엣지 없는 디시전은 WIP로 유지)
    const isRemovedDecision = (n: GraphNode): boolean => {
      if (n.node_type !== "decision") return false;
      const out = outgoing.get(n.id) ?? [];
      return out.length > 0 && out.every((e) => e.label === "");
    };
```

`isRowRemoved`를 교체:
```ts
    const isRowRemoved = (n: GraphNode): boolean =>
      (n.node_type === "start" && n.id !== keptStartId) || isDefaultEnd(n) || isRemovedDecision(n);
```

`isRowRemoved` 아래에 추가:
```ts
    // 삭제된 무라벨 디시전을 통과(flow-through)해 최종 (대상, 라벨)로 전개 — 라벨은 최종 대상까지 전파.
    // next 표기와 규칙4 주석이 공용. seen은 삭제 디시전끼리의 순환 가드.
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
```

루프 내 `next` 계산을 교체:
```ts
      const next = (outgoing.get(node.id) ?? [])
        .flatMap((e) => resolveTargets(e, e.label, new Set()))
        .map(({ node: t, label }) => (label === "" ? t.title : `${t.title}:${label}`))
        .join(";");
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 전체 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/lib/excel-export.ts src/lib/excel-export.test.ts
git commit -m "feat(excel-export): drop unlabeled parallel decisions with flow-through next — 무라벨 병렬 디시전 행 제거+Next 이어붙임"
```

---

### Task 3: 규칙 4 — No 모델 이동 + 분기 주석 `[디시전No:라벨]`

**Files:**
- Modify: `frontend/src/lib/excel-export.ts` (`ExcelNodeRow`·`buildExcelModel` finalize·`writeExcelSheet`)
- Test: `frontend/src/lib/excel-export.test.ts`

**Interfaces:**
- Consumes: Task 2의 `resolveTargets`·`isRowRemoved`.
- Produces: `ExcelNodeRow.no: number`(1..n, 모델에서 확정) — `writeExcelSheet`·검증 스크립트(Task 5)가 이 값을 신뢰.

- [ ] **Step 1: 실패 테스트 4개 작성** — `describe("buildExcelModel")` 끝에 추가:

```ts
  it("규칙4: 라벨 분기 대상 Name에 [디시전No:라벨] 주석 — 역방향(앞 행) 대상도 최종 No 참조", async () => {
    // start→A→D, D→A "retry"(역방향), D→B "pass" — A(2행)는 D(3행)보다 앞
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("d1", "D", "decision", 2),
        makeNode("b1", "B", "process", 3),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "d1"),
        makeEdge("x3", "d1", "a1", "retry"), makeEdge("x4", "d1", "b1", "pass"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => [r.no, r.title])).toEqual([
      [1, "Start"], [2, "A [3:retry]"], [3, "D"], [4, "B [3:pass]"],
    ]);
    // next는 주석 없는 원제목 기준 — 주석이 섞이지 않는다
    expect(nodeRows.find((r) => r.no === 3)?.next).toBe("A:retry;B:pass");
  });

  it("규칙4: 복수 디시전의 대상이면 주석이 연접된다", async () => {
    // D1→T "a", D1→D2 "next", D2→T "b" — T에 [2:a] [3:b]
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D1", "decision", 1),
        makeNode("d2", "D2", "decision", 2),
        makeNode("t1", "T", "process", 3),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "t1", "a"), makeEdge("x3", "d1", "d2", "next"),
        makeEdge("x4", "d2", "t1", "b"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D1", "D2 [2:next]", "T [2:a] [3:b]"]);
  });

  it("규칙4: 라벨 전파 — 라벨 디시전→무라벨 디시전 경유 최종 대상에도 주석", async () => {
    // D ─go→ P(무라벨, 행 삭제) → A,B — A·B에 [2:go]
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("p1", "P", "decision", 2),
        makeNode("a1", "A", "process", 3),
        makeNode("b1", "B", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"), makeEdge("x2", "d1", "p1", "go"),
        makeEdge("x3", "p1", "a1"), makeEdge("x4", "p1", "b1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "A [2:go]", "B [2:go]"]);
  });

  it("규칙4: 다이아몬드 이중 인라인에서 주석 번호가 인스턴스별로 분리된다", async () => {
    // map1: start→subA(2)→subB(2) / 공유 맵: D ─ok→ T — 인스턴스별 D의 No로 각각 주석
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("subA", "SubA", 1, 2),
        makeSubNode("subB", "SubB", 2, 2),
      ],
      edges: [makeEdge("x1", "s1", "subA"), makeEdge("x2", "subA", "subB")],
      groups: [],
    };
    const sharedMap: Graph = {
      nodes: [makeNode("dd", "D", "decision", 0), makeNode("tt", "T", "process", 1)],
      edges: [makeEdge("y1", "dd", "tt", "ok")],
      groups: [],
    };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId !== 2) throw new Error("not found");
      return sharedMap;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => [r.no, r.title])).toEqual([
      [1, "Start"], [2, "SubA"], [3, "D"], [4, "T [3:ok]"],
      [5, "SubB"], [6, "D"], [7, "T [6:ok]"],
    ]);
  });
```

- [ ] **Step 2: 타입/기존 테스트 갱신** — `no` 필드 추가로 깨지는 곳 선반영:

1. **352행(현재 이름 "루트 start는 남고…") 테스트**: 기대값 3곳 교체 —
```ts
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B [2:approve]"]);
    const aRow = nodeRows.find((r) => r.title === "A");
    expect(aRow?.next).toBe("B:approve;End:reject");
    const bRow = nodeRows[2];
    expect(bRow?.next).toBe("End");
```
(reject 분기의 대상 기본 End는 행이 없으므로 주석 소멸 — titles 배열에 `[2:reject]`가 어디에도 없음이 그 단언이다.)
2. **`buildSheetWithOneRow`(527행) 행 리터럴**: `kind: "node",` 뒤에 `no: 1,` 추가.
3. **`describe("writeExcelSheet")` 끝에 신규 테스트**:
```ts
  it("No 셀은 모델의 row.no를 그대로 기록한다", () => {
    const workbook = new Workbook();
    writeExcelSheet(workbook, {
      mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00", truncated: false,
      rows: [{
        kind: "node", no: 7, depth: 0, title: "P", type: "process", description: "", assignee: "",
        department: "", system: "", duration: "", cost_krw: "", cost_usd: "", headcount: "",
        annual_count: "", fte: "", url: "", urlLabel: "", groups: "", next: "",
      }],
    });
    const sheet = workbook.getWorksheet("Process Map");
    expect(sheet?.getRow(5).getCell(1).value).toBe(7);
  });
```

- [ ] **Step 3: 실패 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 신규 4개 + 갱신분 FAIL (`no` 필드 부재는 TS 에러로도 드러남).

- [ ] **Step 4: 구현**

1. `ExcelNodeRow`에 필드 추가 (`kind` 다음 줄):
```ts
  no: number; // 최종 행 번호(1..n) — 삭제 규칙 적용 후 모델에서 부여, 시트는 그대로 기록
```
2. `buildExcelModel` 상단(rows 선언 옆)에 주석 수집 배열:
```ts
  // 규칙4 주석 — 행 "객체" 참조로 기록해 번호 부여 후 일괄 조립(역방향 분기·다이아몬드 이중 인라인 안전)
  const annotations: Array<{ target: ExcelNodeRow; decision: ExcelNodeRow; label: string }> = [];
```
3. emit 내 `resolveTargets` 아래에 스코프 행 매핑:
```ts
    const rowByNodeId = new Map<string, ExcelNodeRow>(); // 스코프(맵 인스턴스) 한정 — 이중 인라인 안전
```
4. 루프의 `rows.push({...})`를 행 객체로 분리(모양 동일, `no: 0` 추가)하고 매핑 등록:
```ts
      const row: ExcelNodeRow = {
        kind: "node",
        no: 0, // finalize에서 부여
        depth,
        ...(기존 필드 그대로)...
        next,
      };
      rows.push(row);
      rowByNodeId.set(node.id, row);
```
5. emit의 for 루프 **종료 후**(함수 끝) 주석 수집 패스 추가:
```ts
    // 규칙4: 유지된 디시전의 라벨 분기 → 최종 대상 행에 (디시전 행, 라벨) 기록 — 대상 행이 삭제됐으면 소멸
    for (const node of ordered) {
      if (node.node_type !== "decision") continue;
      const decisionRow = rowByNodeId.get(node.id);
      if (!decisionRow) continue; // 무라벨(삭제) 디시전
      for (const e of outgoing.get(node.id) ?? []) {
        if (e.label === "") continue;
        for (const { node: t, label } of resolveTargets(e, e.label, new Set())) {
          const targetRow = rowByNodeId.get(t.id);
          if (targetRow) annotations.push({ target: targetRow, decision: decisionRow, label });
        }
      }
    }
```
(상한 도달 시 emit이 중간 `return`하면 이 패스를 건너뜀 — truncated 출력의 주석 일부 소실은 허용.)
6. `await emit(...)` 뒤 finalize:
```ts
  // 번호 부여(삭제 후 1..n 연속) → 주석 조립. next 문자열은 emit 시점 확정이라 주석이 섞이지 않는다.
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
```
7. `writeExcelSheet`: `let no = 0;`과 `no += 1;` 삭제, `sheet.addRow([no, ...])`의 첫 원소를 `row.no`로 교체.

- [ ] **Step 5: 통과 확인**

Run: `npx vitest run src/lib/excel-export.test.ts`
Expected: 전체 PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/excel-export.ts src/lib/excel-export.test.ts
git commit -m "feat(excel-export): branch annotations [decisionNo:label] with model-side numbering — 분기 주석+No 모델 이동"
```

---

### Task 4: 전체 게이트 + PROGRESS

**Files:**
- Modify: `PROGRESS.md` (저장소 루트)

- [ ] **Step 1: 전체 게이트 실행** (frontend/에서)

```bash
npx vitest run
npx tsc --noEmit
npm run lint
npm run build
```
Expected: vitest 전체 PASS(기존 417+신규), tsc 0 에러, lint 0 에러(pre-existing 경고 1 허용), build 성공. vitest·next build는 테스트 파일 타입 에러를 못 잡으므로 tsc 상시 실행(레포 확립 관행).

- [ ] **Step 2: PROGRESS.md 최상단에 항목 추가**

```markdown
## 2026-07-17 — Excel 출력 양식 개선 1안 구현 (worktree-excel-export)
- 설계 `docs/superpowers/specs/2026-07-17-excel-export-format-v1-design.md` 4규칙 구현: ①무라벨 병렬 디시전 행 제거+Next flow-through(라벨은 최종 대상까지 전파) ②첫 start 외 start 행 제거 ③기본 제목("end", trim·대소문자 무시) end 행 제거(Next의 End 표기는 유지) ④라벨 분기 대상 Name에 `[디시전No:라벨]` 주석(행 객체 참조로 역방향·다이아몬드 안전). No는 모델에서 확정(`ExcelNodeRow.no`).
- CSV 내보내기는 왕복 계약이라 미적용. 게이트: vitest 전체·tsc·lint·build 그린.
```

- [ ] **Step 3: 커밋**

```bash
git add PROGRESS.md
git commit -m "docs(progress): excel export format v1 implemented — 엑셀 양식 1안 구현 기록"
```

---

### Task 5: 실기동 검증 — 다운로드 xlsx 파싱으로 4규칙 단언

**Files:**
- Create: `frontend/scripts/pw-verify-excel-format-v1.mjs`
- Modify: `PROGRESS.md` (검증 결과 줄 추가)

**Interfaces:**
- Consumes: Task 3까지의 출력(xlsx 헤더 4행·데이터 5행부터, No=1열·Name=2열·Next=16열), 에디터 `[data-id="export-excel"]` 버튼, 백엔드 `POST /maps`(Start/End 자동 시드)·`PUT /versions/{id}/graph`.

- [ ] **Step 1: 서버 기동** (좀비 정리 후 — docs/lessons/browser-verification.md)

```bash
pkill -f "next dev"; pkill -f "uvicorn app.main"; sleep 1
cd ../backend && ( [ -d .venv ] || (python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt) ) && .venv/bin/python -m scripts.reset_db && (.venv/bin/uvicorn app.main:app --port 8000 &)
cd ../frontend && npm i --no-save playwright-core && (npm run dev &)
```
Expected: :8000·:3000 기동(프론트가 3001로 폴백하면 좀비 잔존 — 다시 pkill). 백그라운드 서버는 턴 경계에서 회수될 수 있으므로 기동→검증→종료를 한 흐름으로.

- [ ] **Step 2: 검증 스크립트 작성** — `scripts/pw-verify-excel-format-v1.mjs`:

```js
// Excel 출력 양식 1안 — 브라우저 실기동 검증.
// 스크래치 맵에 제어 픽스처(start·무라벨 디시전·라벨 디시전·기본/커스텀 end)를 넣고
// [data-id="export-excel"] 다운로드 → exceljs 파싱 → 4규칙(행 제거·flow-through·주석·No 연속) 단언.
// 실행 (frontend/ 에서): node scripts/pw-verify-excel-format-v1.mjs
// 전제: backend :8000(reset_db 시드), frontend :3000, playwright-core(--no-save)·exceljs(dependencies)
import { chromium } from "playwright-core";
import ExcelJS from "exceljs";
import { mkdirSync } from "node:fs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = "/tmp/pw-verify-excel-format-v1";
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await ctx.addInitScript(() => {
  window.localStorage.setItem("bpm.devUser", "admin.sys");
  window.localStorage.setItem("bpm.lang", "en");
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});

const api = (path, { method = "GET", body } = {}) =>
  page.evaluate(
    async ({ path, method, body }) => {
      const res = await fetch(`/api${path}`, {
        method,
        headers: { "Content-Type": "application/json", "X-Dev-User": "admin.sys" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
      return text ? JSON.parse(text) : null;
    },
    { path, method, body },
  );

try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 15000 });
} catch {
  console.error(`FATAL frontend not reachable at ${BASE}`);
  await browser.close();
  process.exit(1);
}

let mapId = null;
try {
  const stamp = Date.now();
  const dir0 = await api("/directory");
  const owningDept = dir0.departments[0]?.id;
  if (!owningDept) throw new Error("directory has no departments");

  const created = await api("/maps", {
    method: "POST",
    body: { name: `Excel Format V1 ${stamp}`, description: "", visibility: "public", owning_department: owningDept },
  });
  mapId = created.id;
  const versionId = created.versions[0].id;

  // 픽스처: Start→Prepare→Par(무라벨 디시전)→{Branch B, Branch C}→Approve?(yes→Ship, no→End)→Ship→Archived
  const N = (id, title, node_type, sort_order, extra = {}) => ({
    id, title, node_type, pos_x: sort_order * 160, pos_y: 0, sort_order, ...extra,
  });
  const E = (id, source_node_id, target_node_id, label = "") => ({ id, source_node_id, target_node_id, label });
  await api(`/versions/${versionId}/graph`, {
    method: "PUT",
    body: {
      nodes: [
        N("s", "Start", "start", 0),
        N("a", "Prepare", "process", 1),
        N("p", "Par", "decision", 2),
        N("b", "Branch B", "process", 3),
        N("c", "Branch C", "process", 4),
        N("d", "Approve?", "decision", 5),
        N("ship", "Ship", "process", 6),
        N("e", "End", "end", 7, { is_primary_end: true }),
        N("arch", "Archived", "end", 8),
      ],
      edges: [
        E("x1", "s", "a"), E("x2", "a", "p"), E("x3", "p", "b"), E("x4", "p", "c"),
        E("x5", "b", "d"), E("x6", "c", "d"),
        E("x7", "d", "ship", "yes"), E("x8", "d", "e", "no"), E("x9", "ship", "arch"),
      ],
      groups: [],
    },
  });

  await page.goto(`${BASE}/maps/${mapId}?version=${versionId}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".react-flow__node", { timeout: 20000 });
  await page.waitForTimeout(800);

  // 내보내기 3버튼은 인스펙터 "Map" 탭 안
  const exportVisible = await page.locator('[data-id="export-excel"]').isVisible().catch(() => false);
  if (!exportVisible) {
    await page.locator('button[aria-label="Map"]').first().click();
    await page.waitForSelector('[data-id="export-excel"]', { timeout: 5000 });
  }
  const dlPromise = page.waitForEvent("download");
  await page.locator('[data-id="export-excel"]').click();
  const dl = await dlPromise;
  const xlsxPath = `${OUT}/export.xlsx`;
  await dl.saveAs(xlsxPath);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsxPath);
  const sheet = wb.worksheets[0];
  const rows = []; // { no, name, next }
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber < 5) return;
    rows.push({ no: row.getCell(1).value, name: String(row.getCell(2).value ?? ""), next: String(row.getCell(16).value ?? "") });
  });

  check("규칙1: 무라벨 디시전(Par) 행 없음", rows.every((r) => !r.name.startsWith("Par")), rows.map((r) => r.name).join("|"));
  check("규칙2: Start 행은 정확히 1개", rows.filter((r) => r.name === "Start").length === 1);
  check("규칙3: 기본 End 행 없음·커스텀 end(Archived) 유지",
    rows.every((r) => r.name !== "End") && rows.some((r) => r.name === "Archived"));
  const prepare = rows.find((r) => r.name === "Prepare");
  check("규칙1: Prepare.next가 flow-through로 대상들", prepare?.next === "Branch B;Branch C", prepare?.next);
  const approve = rows.find((r) => r.name.startsWith("Approve?"));
  check("디시전 행 next는 기존 표기 유지(End 텍스트 포함)", approve?.next === "Ship:yes;End:no", approve?.next);
  check("규칙4: Ship에 [디시전No:yes] 주석", rows.some((r) => r.name === `Ship [${approve?.no}:yes]`),
    rows.map((r) => r.name).join("|"));
  check("규칙4: 삭제 행(기본 End) 주석 소멸", rows.every((r) => !r.name.includes(":no]")));
  check("No 재부여 1..n 연속", rows.map((r) => r.no).join(",") === rows.map((_, i) => i + 1).join(","),
    rows.map((r) => r.no).join(","));
  const header = sheet.getRow(4).values.slice(1, 17).map(String);
  check("헤더 16컬럼 무변경", header[0] === "No" && header[1] === "Name" && header[15] === "Next", header.join(","));
} catch (err) {
  results.push({ name: "fatal", ok: false });
  console.error(`FATAL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  if (mapId !== null) await api(`/maps/${mapId}`, { method: "DELETE" }).catch(() => {});
}

console.log(`\nconsole errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 5).forEach((e) => console.log("  " + e.slice(0, 200)));
check("콘솔 에러 0", consoleErrors.length === 0, `${consoleErrors.length} error(s)`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 3: 실행·통과 확인**

Run: `node scripts/pw-verify-excel-format-v1.mjs`
Expected: `10/10 passed`, exit 0. 실패 시 detail 출력으로 원인 파악(맵 생성 422면 `POST /maps` 필수 필드 변화 — 백엔드 `app/routers/maps.py` 확인).

- [ ] **Step 4: 서버 정리 + PROGRESS 검증 줄 추가 + 커밋**

```bash
pkill -f "next dev"; pkill -f "uvicorn app.main"
```
PROGRESS.md의 Task 4 항목에 줄 추가: `- 실기동 검증 pw-verify-excel-format-v1.mjs 10/10 PASS(스크래치 맵 픽스처 → xlsx 파싱 — 행 제거·flow-through·주석·No 연속·콘솔 0).`

```bash
git add scripts/pw-verify-excel-format-v1.mjs PROGRESS.md
git commit -m "test(excel-export): browser verification for format v1 rules — 실기동 xlsx 파싱 검증 10종"
```

---

## Self-Review 결과

- **스펙 커버리지**: 규칙1(Task 2)·규칙2/3(Task 1)·규칙4+No(Task 3)·Next 3원칙(Task 1 End 유지, Task 2 flow-through·라벨 전파, 디시전 Next 유지는 무변경으로 충족)·테스트 목록 §"테스트" 10항목 → 신규 테스트 11개+기존 갱신 9곳으로 전부 매핑. CSV 미적용은 무수정으로 충족.
- **플레이스홀더**: 없음(모든 코드 스텝에 실제 코드).
- **타입 일관성**: `resolveTargets`(Task 2 정의→Task 3 소비), `ExcelNodeRow.no`(Task 3 정의→`writeExcelSheet`·Task 5 소비) 시그니처 일치 확인.
