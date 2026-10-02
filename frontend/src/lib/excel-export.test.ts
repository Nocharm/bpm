// Excel 모델 빌더 단위 테스트 — 재귀 인라인·순환·다이아몬드 메모이즈·locked·행 상한·next End 표기·
// 회당 파라미터 7종(서브프로세스 sp_* 소스 포함)·컬럼 헤더/서식(Task 9)·열 선택·IO/GMP/병렬 열.
// 설계: 2026-07-11-numeric-params-excel-csv-export-design.md §4,
//       2026-07-13-node-params-redefinition-design.md §5.2
import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphGroup, GraphNode } from "./api";
import { buildExcelModel, COLUMNS, formatExcelNextCell, writeExcelSheet } from "./excel-export";
import { EXCEL_COLUMNS } from "./export-columns";

/** GraphNode 조립 헬퍼 — csv-export.test.ts 스타일 재사용. */
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
  return { id, source_node_id: source, target_node_id: target, label, source_side: "right", target_side: "left", source_handle: null, target_handle: null, line_style: "" };
}

function makeSubNode(id: string, title: string, sort_order: number, linkedMapId: number, over: Partial<GraphNode> = {}): GraphNode {
  return makeNode(id, title, "subprocess", sort_order, {
    linked_map_id: linkedMapId, follow_latest: true, linked_version_id: null,
    ...over,
  });
}

describe("buildExcelModel", () => {
  it("서브프로세스를 재귀 인라인하고 depth를 매긴다", async () => {
    // 맵1: start→sub(linked 2)→end / 맵2: start→P→end
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
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
    const registry: Record<number, Graph> = { 2: map2 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.truncated).toBe(false);
    const rows = model.rows;
    expect(rows.map((r) => (r.kind === "node" ? [r.title, r.depth] : [r.kind, r.depth]))).toEqual([
      ["Start", 0],
      ["Sub", 0],
      ["P", 1],
    ]);
  });

  it("rootMapId 전달 시 루트 상호참조 순환은 재펼침 없이 즉시 circular 1행 - 루트 맵 re-fetch 없음", async () => {
    // 맵1(루트, rootMapId:1) sub→맵2(id2), 맵2 sub→맵1(id1) — 조상 경로가 루트를 포함해 즉시 차단(design §4)
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "SubToMap2", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = {
      nodes: [
        makeNode("s2", "Start", "start", 0),
        makeSubNode("sub2", "SubToMap1", 1, 1),
        makeNode("e2", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("y1", "s2", "sub2"), makeEdge("y2", "sub2", "e2")],
      groups: [],
    };
    const registry: Record<number, Graph> = { 1: map1, 2: map2 };
    const fetchedIds: number[] = [];
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      fetchedIds.push(mapId);
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved, rootMapId: 1,
    });
    expect(model.rows.filter((r) => r.kind === "circular")).toEqual([
      { kind: "circular", depth: 2, title: "SubToMap1" },
    ]);
    expect(fetchedIds).toEqual([2]); // 루트 맵(1)은 re-fetch되지 않는다
    const kindsWithDepth = model.rows.map((r) => [r.kind === "node" ? r.title : r.kind, r.depth]);
    expect(kindsWithDepth).toEqual([
      ["Start", 0], ["SubToMap2", 0],
      ["SubToMap1", 1],
      ["circular", 2],
    ]);
  });

  it("rootMapId 생략 시(하위호환) 루트 상호참조는 한 바퀴 더 인라인된 뒤 circular 1행으로 닫힌다", async () => {
    // 하위호환 박제: rootMapId 없이는 ancestry가 빈 Set으로 시작 — 맵2 안의 "맵1 역참조"는 맵2 시점(ancestry={2})엔
    // 걸리지 않고, 맵1을 한 번 더 확장(depth2)한 뒤 그 복제본의 참조(linked=2 ∈ ancestry={2,1})에서 닫힌다.
    // 유한 정지·circular 정확히 1행은 여전히 보장.
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "SubToMap2", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = {
      nodes: [
        makeNode("s2", "Start", "start", 0),
        makeSubNode("sub2", "SubToMap1", 1, 1),
        makeNode("e2", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("y1", "s2", "sub2"), makeEdge("y2", "sub2", "e2")],
      groups: [],
    };
    const registry: Record<number, Graph> = { 1: map1, 2: map2 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    const circularRows = model.rows.filter((r) => r.kind === "circular");
    expect(circularRows).toEqual([{ kind: "circular", depth: 3, title: "SubToMap2" }]);
    const kindsWithDepth = model.rows.map((r) => [r.kind === "node" ? r.title : r.kind, r.depth]);
    expect(kindsWithDepth).toEqual([
      ["Start", 0], ["SubToMap2", 0],
      ["SubToMap1", 1],
      ["SubToMap2", 2],
      ["circular", 3],
    ]);
  });

  it("서로 다른(루트 아닌) 두 서브맵 간의 순환은 즉시 circular 1행으로 차단된다", async () => {
    // 맵1(루트) sub→맵2(id2), 맵2 sub→맵3(id3), 맵3 sub→맵2(id2) — 루트 자기참조가 아니므로
    // ancestry가 맵2 진입 시점부터 이미 {2}를 담고 있어, 맵3에서 맵2를 다시 참조하는 순간 즉시 차단된다.
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "SubToMap2", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = {
      nodes: [makeSubNode("sub2", "SubToMap3", 0, 3)],
      edges: [],
      groups: [],
    };
    const map3: Graph = {
      nodes: [makeSubNode("sub3", "SubToMap2Again", 0, 2)],
      edges: [],
      groups: [],
    };
    const registry: Record<number, Graph> = { 2: map2, 3: map3 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.rows.filter((r) => r.kind === "circular")).toEqual([
      { kind: "circular", depth: 3, title: "SubToMap2Again" },
    ]);
    const kinds = model.rows.map((r) => (r.kind === "node" ? r.title : r.kind));
    expect(kinds).toEqual(["Start", "SubToMap2", "SubToMap3", "SubToMap2Again", "circular"]);
  });

  it("같은 맵 2회 참조는 각각 인라인(다이아몬드), fetch는 1회(메모이즈)", async () => {
    // 맵1: start→subA(linked 2)→subB(linked 2)→end — 둘 다 같은 (mapId,followLatest,pinned)
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("subA", "SubA", 1, 2),
        makeSubNode("subB", "SubB", 2, 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [
        makeEdge("x1", "s1", "subA"),
        makeEdge("x2", "subA", "subB"),
        makeEdge("x3", "subB", "e1"),
      ],
      groups: [],
    };
    const sharedMap: Graph = {
      nodes: [makeNode("shared1", "Shared", "process", 0)],
      edges: [],
      groups: [],
    };
    let callCount = 0;
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      callCount += 1;
      if (mapId !== 2) throw new Error("not found");
      return sharedMap;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    expect(callCount).toBe(1); // 메모이즈 — 동일 (mapId,followLatest,pinned)는 1회만 fetch
    const kinds = model.rows.map((r) => (r.kind === "node" ? [r.title, r.depth] : [r.kind, r.depth]));
    expect(kinds).toEqual([
      ["Start", 0],
      ["SubA", 0],
      ["Shared", 1],
      ["SubB", 0],
      ["Shared", 1],
    ]);
  });

  it("locked 맵은 denied 1행", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const lockedGraph: Graph = { nodes: [], edges: [], groups: [], locked: true };
    const fetchResolved = async (): Promise<Graph> => lockedGraph;
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.rows.filter((r) => r.kind === "denied")).toEqual([{ kind: "denied", depth: 1, title: "Sub" }]);
  });

  it("fetch 실패(reject)도 denied 1행으로 수렴하고 전체를 죽이지 않는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => {
      throw new Error("403 forbidden");
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    expect(model.rows.map((r) => (r.kind === "node" ? r.title : r.kind))).toEqual(["Start", "Sub", "denied"]);
  });

  it("행 상한 초과 시 rowLimit 행과 truncated=true", async () => {
    // maxRows: 5 로 작게 줘서 검증 — start,a,b,c,d,f 6개 행 후보(기본 End는 행 미생성)
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C", "process", 3),
        makeNode("d1", "D", "process", 4),
        makeNode("f1", "F", "process", 5),
        makeNode("e1", "End", "end", 6, { is_primary_end: true }),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1"), makeEdge("x3", "b1", "c1"),
        makeEdge("x4", "c1", "d1"), makeEdge("x5", "d1", "f1"), makeEdge("x6", "f1", "e1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => {
      throw new Error("unused");
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved, maxRows: 5,
    });
    expect(model.truncated).toBe(true);
    const kinds = model.rows.map((r) => (r.kind === "node" ? r.title : r.kind));
    expect(kinds).toEqual(["Start", "A", "B", "C", "D", "rowLimit"]);
    // rowLimit 행은 정확히 1개 — 재귀 레벨마다 중복 생성되지 않는다
    expect(model.rows.filter((r) => r.kind === "rowLimit").length).toBe(1);
  });

  it("행 상한이 서브프로세스 재귀 중에 걸려도 rowLimit은 1개뿐이고 상위 레벨로 잔여 노드를 이어가지 않는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = {
      nodes: [
        makeNode("s2", "Start", "start", 0),
        makeNode("p2a", "P2A", "process", 1),
        makeNode("p2b", "P2B", "process", 2),
        makeNode("e2", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("y1", "s2", "p2a"), makeEdge("y2", "p2a", "p2b"), makeEdge("y3", "p2b", "e2")],
      groups: [],
    };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId === 2) return map2;
      throw new Error("not found");
    };
    // maxRows:3 → Start(1), Sub(2), map2의 start는 행 미생성이라 P2A(3), P2B에서 rowLimit → 이후 전부 중단
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved, maxRows: 3,
    });
    expect(model.truncated).toBe(true);
    expect(model.rows.filter((r) => r.kind === "rowLimit").length).toBe(1);
    const kinds = model.rows.map((r) => (r.kind === "node" ? r.title : r.kind));
    expect(kinds).toEqual(["Start", "Sub", "P2A", "rowLimit"]);
  });

  it("루트 start는 남고 기본 end 행은 빠지되 next엔 End 표기가 유지된다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "decision", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"),
        makeEdge("x2", "a1", "b1", "approve"),
        makeEdge("x3", "a1", "e1", "reject"),
        makeEdge("x4", "b1", "e1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => {
      throw new Error("unused");
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B [2:approve]"]);
    const aRow = nodeRows.find((r) => r.title === "A");
    expect(aRow?.next).toBe("3. B [approve]; End [reject]");
    const bRow = nodeRows[2];
    expect(bRow?.next).toBe("End");
  });

  it("groups 라벨 조인은 링크 맵 자신의 groups 기준(부모 맵 그룹 아님)", async () => {
    const parentGroups: GraphGroup[] = [{ id: "gp1", parent_group_id: null, label: "ParentGroupLabel", color: "" }];
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2, { group_ids: ["gp1"] }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: parentGroups,
    };
    const childGroups: GraphGroup[] = [{ id: "gc1", parent_group_id: null, label: "ChildGroupLabel", color: "" }];
    const map2: Graph = {
      nodes: [makeNode("p2", "P", "process", 0, { group_ids: ["gc1"] })],
      edges: [],
      groups: childGroups,
    };
    const registry: Record<number, Graph> = { 2: map2 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    const subRow = nodeRows.find((r) => r.title === "Sub");
    expect(subRow?.groups).toBe("ParentGroupLabel");
    const pRow = nodeRows.find((r) => r.title === "P");
    expect(pRow?.groups).toBe("ChildGroupLabel"); // 부모(gp1)가 아니라 map2 자신의 groups에서 해석
  });

  it("일반 노드 행이 회당 파라미터 7종을 담는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("p1", "P", "process", 1, {
          duration: "1.30", touch_time: "", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
        }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "p1"), makeEdge("x2", "p1", "e1")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => {
      throw new Error("unused");
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-13T00:00:00+09:00",
      fetchResolved,
    });
    const row = model.rows.find((r) => r.kind === "node" && r.title === "P");
    expect(row).toMatchObject({
      duration: "1.30", touch_time: "", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
    });
  });

  it("서브프로세스 행의 duration/비용/headcount는 링크 맵의 sp_* 지정값에서, annual_count/fte는 노드 자신의 값에서 온다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        // 노드 자신에 남은 duration/cost_krw/cost_usd/headcount(비편집 필드의 잔존값)는 무시돼야 한다
        makeSubNode("sub1", "Sub", 1, 2, {
          duration: "9.99", touch_time: "9.99", cost_krw: "999", cost_usd: "999", headcount: "99",
          annual_count: "1200", fte: "0.8",
        }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
      // 백엔드 get_subprocess_refs는 호출 그래프 자신의 서브프로세스 노드 기준으로 채운다 — map1이 가짐
      subprocess_refs: {
        2: {
          name: null, designated: true, department: null, assignee: null, system: null,
          duration: "2.15", cost_krw: "500000", cost_usd: null, headcount: "3", touch_time: "0.30", input: null, output: null, input_forms: null, output_forms: null, input_ids: null, output_ids: null, start_condition: null, end_condition: null, frequency_fallback: null, gmp: null, url: null, url_label: null,
          sp_description: null,
        },
      },
    };
    const map2: Graph = { nodes: [makeNode("s2", "Start", "start", 0)], edges: [], groups: [] };
    const registry: Record<number, Graph> = { 2: map2 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-13T00:00:00+09:00",
      fetchResolved,
    });
    const subRow = model.rows.find((r) => r.kind === "node" && r.title === "Sub");
    expect(subRow).toMatchObject({
      duration: "2.15", touch_time: "0.30", cost_krw: "500000", cost_usd: "", headcount: "3",
      annual_count: "1200", fte: "0.8",
    });
  });

  it("서브프로세스 행 description은 링크 맵 description(베이스, SubprocessRefOut.sp_description 키)+줄바꿈+노드 추가분으로 합성된다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2, { description: "우리 팀 메모" }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
      subprocess_refs: {
        2: {
          name: null, designated: true, department: null, assignee: null, system: null,
          duration: null, cost_krw: null, cost_usd: null, headcount: null, touch_time: null, input: null, output: null, input_forms: null, output_forms: null, input_ids: null, output_ids: null, start_condition: null, end_condition: null, frequency_fallback: null, gmp: null, url: null, url_label: null,
          sp_description: "표준 절차 설명",
        },
      },
    };
    const map2: Graph = { nodes: [makeNode("s2", "Start", "start", 0)], edges: [], groups: [] };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId !== 2) throw new Error("not found");
      return map2;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-18T00:00:00+09:00",
      fetchResolved,
    });
    const subRow = model.rows.find((r) => r.kind === "node" && r.title === "Sub");
    expect(subRow).toMatchObject({ description: "표준 절차 설명\n우리 팀 메모" });
    // 일반 노드는 합성 없음
    const startRow = model.rows.find((r) => r.kind === "node" && r.title === "Start");
    expect(startRow).toMatchObject({ description: "" });
  });

  it("서브프로세스가 미지정(subprocess_refs 없음)이면 duration/비용/headcount는 빈 문자열", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeSubNode("sub1", "Sub", 1, 2, { duration: "9.99", cost_krw: "999" }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
    };
    const map2: Graph = { nodes: [], edges: [], groups: [] };
    const registry: Record<number, Graph> = { 2: map2 };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      const g = registry[mapId];
      if (!g) throw new Error("not found");
      return g;
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-13T00:00:00+09:00",
      fetchResolved,
    });
    const subRow = model.rows.find((r) => r.kind === "node" && r.title === "Sub");
    expect(subRow).toMatchObject({ duration: "", cost_krw: "", cost_usd: "", headcount: "" });
  });

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
    // 기본 end는 행이 없어 번호 없이 제목만, 커스텀 end는 행 번호로 가리킨다
    expect(aRow && aRow.kind === "node" ? aRow.next : "").toBe("  END ; 3. 출하 종료");
  });

  it("규칙3: 빈 제목 end도 기본 end로 보고 행을 만들지 않는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("e1", " ", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "e1")],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };

    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00",
      fetchResolved,
    });

    expect(model.rows.filter((r) => r.kind === "node").map((r) => r.title)).toEqual(["Start", "A"]);
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
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("3. B; 4. C");
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
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("3. B");
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
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "B [2:yes]", "C"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("3. B [yes]; 4. C");
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
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "A [2:go]", "B [2:go]"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("3. A [go]; 4. B [go]");
  });

  it("규칙4: 라벨 분기 대상 Name에 [디시전No:라벨] 주석 - 역방향(앞 행) 대상도 최종 No 참조", async () => {
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
    expect(nodeRows.find((r) => r.no === 3)?.next).toBe("2. A [retry]; 4. B [pass]");
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

  it("규칙4: 라벨 전파 - 라벨 디시전→무라벨 디시전 경유 최종 대상에도 주석", async () => {
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

  it("Next는 대상을 줄 번호로 가리킨다 — 같은 제목의 두 대상이 따로 남고, 제목·라벨의 ':'·';'가 구분자와 섞이지 않는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("h1", "Hub", "decision", 1),
        makeNode("f1", "Fix", "process", 2),
        makeNode("f2", "Fix", "process", 3),
        makeNode("p1", "Step 1: Prep", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "h1"),
        makeEdge("x2", "h1", "f1", "a"), makeEdge("x3", "h1", "f2", "b"),
        makeEdge("x4", "h1", "p1", "late; partial"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00", fetchResolved,
    });
    const hub = model.rows.find((r) => r.kind === "node" && r.title === "Hub");
    expect(hub && hub.kind === "node" ? hub.next : "").toBe("3. Fix [a]; 4. Fix [b]; 5. Step 1: Prep [late; partial]");
  });

  it("formatExcelNextCell - 행이 있으면 'N. 제목', 없으면 제목만, 라벨은 [대괄호]", () => {
    const rowNo = new Map([["b", 4]]);
    expect(formatExcelNextCell(
      [{ targetId: "b", title: "B", label: "" }, { targetId: "e", title: "End", label: "done" }],
      (id) => rowNo.get(id),
    )).toBe("4. B; End [done]");
  });

  it("재수렴: 삭제 디시전 경유로 같은 대상에 두 번 도달해도 next는 중복 없이 1회 표기", async () => {
    // A→P(무라벨)→B, P→Q(무라벨)→B — 중복 제거 전엔 A.next가 "B;B"
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
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B"]);
    expect(nodeRows.find((r) => r.title === "A")?.next).toBe("3. B");
  });

  it("재수렴: 라벨 디시전이 삭제 디시전 경유로 같은 대상에 재수렴해도 주석은 1회", async () => {
    // D ─go→ P(무라벨)→B, P→Q(무라벨)→B — 중복 제거 전엔 "B [2:go] [2:go]"
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("p1", "P", "decision", 2),
        makeNode("q1", "Q", "decision", 3),
        makeNode("b1", "B", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"), makeEdge("x2", "d1", "p1", "go"),
        makeEdge("x3", "p1", "b1"), makeEdge("x4", "p1", "q1"), makeEdge("x5", "q1", "b1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "B [2:go]"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("3. B [go]");
  });

  it("행 상한 도달 시 이미 출력된 행의 주석은 보존된다", async () => {
    // maxRows:3 — Start, D, T까지 출력 후 U에서 상한. T의 [2:ok] 주석은 살아야 한다(break 전환)
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("t1", "T", "process", 2),
        makeNode("u1", "U", "process", 3),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"), makeEdge("x2", "d1", "t1", "ok"), makeEdge("x3", "t1", "u1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved, maxRows: 3,
    });
    expect(model.truncated).toBe(true);
    const kinds = model.rows.map((r) => (r.kind === "node" ? r.title : r.kind));
    expect(kinds).toEqual(["Start", "D", "T [2:ok]", "rowLimit"]);
  });

  it("혼합 디시전의 무라벨 분기가 삭제 디시전을 가리켜도 flow-through된다", async () => {
    // D: yes→B(주석) + 무라벨→P(삭제 디시전)→C — D.next는 "B:yes;C", C는 주석 없음
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("p1", "P", "decision", 3),
        makeNode("c1", "C", "process", 4),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "b1", "yes"), makeEdge("x3", "d1", "p1"),
        makeEdge("x4", "p1", "c1"),
      ],
      groups: [],
    };
    const fetchResolved = async (): Promise<Graph> => { throw new Error("unused"); };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00",
      fetchResolved,
    });
    const nodeRows = model.rows.filter((r) => r.kind === "node");
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "D", "B [2:yes]", "C"]);
    expect(nodeRows.find((r) => r.title === "D")?.next).toBe("3. B [yes]; 4. C");
  });
});

describe("COLUMNS", () => {
  it("헤더가 새 라벨·순서를 따른다(design 2026-07-13 §5.2, 열 선택 2026-10-02)", () => {
    expect(COLUMNS.map((c) => c.header)).toEqual([
      "No", "Name", "Type", "Description", "Assignee", "Role", "Department", "System",
      "Duration (h)", "Touch time (h)", "Cost (KRW)", "Cost (USD)", "Headcount", "Annual volume", "FTE",
      "Input", "Output", "Start condition", "End condition", "GMP", "Parallel",
      "URL", "Groups", "Next",
    ]);
  });

  it("열 정의는 export-columns의 EXCEL_COLUMNS 키·헤더 순서를 그대로 따른다", () => {
    expect(COLUMNS.map((c) => [c.key, c.header])).toEqual(EXCEL_COLUMNS.map((c) => [c.key, c.header]));
  });
});

const emptyRowFields = {
  no: 1, title: "P", type: "process", description: "", assignee: "", assignee_role: "", department: "", system: "",
  duration: "", touch_time: "", cost_krw: "", cost_usd: "", headcount: "", annual_count: "", fte: "",
  input: "", output: "", start_condition: "", end_condition: "", gmp: "", parallel: "",
  url: "", urlLabel: "", groups: "", next: "",
};

describe("writeExcelSheet", () => {
  function findColumnIndex(header: string): number {
    const index = COLUMNS.findIndex((c) => c.header === header);
    if (index < 0) throw new Error(`unknown column: ${header}`);
    return index + 1;
  }

  // exceljs Workbook 대상 순수 검증(다운로드 Blob/anchor와 분리) — 메타 3행+헤더 1행 다음이 첫 데이터 행(5)
  function buildSheetWithOneRow(over: Partial<Record<string, string>> = {}, columns?: Parameters<typeof writeExcelSheet>[2]) {
    const base = {
      duration: "1.30", touch_time: "0.45", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
      ...over,
    };
    const workbook = new Workbook();
    writeExcelSheet(workbook, {
      mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-13T00:00:00+09:00", truncated: false,
      rows: [{ kind: "node", depth: 0, ...emptyRowFields, next: "Q", ...base }],
    }, columns);
    const sheet = workbook.getWorksheet("Process Map");
    if (!sheet) throw new Error("sheet missing");
    return sheet;
  }

  it("7개 숫자 컬럼에 지정된 numFmt를 적용하고, 텍스트 컬럼엔 서식을 남기지 않는다", () => {
    const dataRow = buildSheetWithOneRow().getRow(5);
    expect(dataRow.getCell(findColumnIndex("Duration (h)")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Touch time (h)")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Cost (KRW)")).numFmt).toBe("#,##0");
    expect(dataRow.getCell(findColumnIndex("Cost (USD)")).numFmt).toBe("#,##0.00");
    expect(dataRow.getCell(findColumnIndex("Headcount")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Annual volume")).numFmt).toBe("#,##0");
    expect(dataRow.getCell(findColumnIndex("FTE")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Name")).numFmt).toBeUndefined();
  });

  it("숫자 셀은 텍스트가 아니라 실제 숫자로 들어간다", () => {
    const dataRow = buildSheetWithOneRow().getRow(5);
    expect(dataRow.getCell(findColumnIndex("Cost (KRW)")).value).toBe(1250000);
    expect(dataRow.getCell(findColumnIndex("Touch time (h)")).value).toBe(0.45);
    expect(dataRow.getCell(findColumnIndex("FTE")).value).toBe(0.8);
  });

  it("빈 파라미터 값은 0이 아니라 빈 셀로 남는다", () => {
    const dataRow = buildSheetWithOneRow({ cost_krw: "", cost_usd: "", headcount: "", annual_count: "", fte: "" }).getRow(5);
    for (const header of ["Cost (KRW)", "Cost (USD)", "Headcount", "Annual volume", "FTE"]) {
      const value = dataRow.getCell(findColumnIndex(header)).value;
      expect(value).not.toBe(0);
    }
  });

  it("데이터 행 셀 수 = 열 수, 마지막 셀은 Next (값 배열 수기 복제 가드)", () => {
    const values = (buildSheetWithOneRow().getRow(5).values as unknown[]).slice(1);
    expect(values).toHaveLength(COLUMNS.length);
    expect(values[values.length - 1]).toBe("Q");
  });

  it("No 셀은 모델의 row.no를 그대로 기록한다", () => {
    const workbook = new Workbook();
    writeExcelSheet(workbook, {
      mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-17T00:00:00+09:00", truncated: false,
      rows: [{ kind: "node", depth: 0, ...emptyRowFields, no: 7 }],
    });
    const sheet = workbook.getWorksheet("Process Map");
    expect(sheet?.getRow(5).getCell(1).value).toBe(7);
  });

  it("열 선택 - 선택한 열+잠금 열(No·Name·Type·Parallel·Next)만 정식 순서로, 서식·하이퍼링크 위치도 선택 열에서 파생", () => {
    const sheet = buildSheetWithOneRow({ url: "https://example.com/doc", urlLabel: "Doc" }, ["url", "cost_krw"]);
    expect((sheet.getRow(4).values as unknown[]).slice(1)).toEqual(["No", "Name", "Type", "Cost (KRW)", "Parallel", "URL", "Next"]);
    const r = sheet.getRow(5);
    expect(r.getCell(4).numFmt).toBe("#,##0");
    expect(r.getCell(6).value).toEqual({ text: "Doc", hyperlink: "https://example.com/doc" });
    expect(r.getCell(7).value).toBe("Q");
    expect(sheet.getColumn(4).width).toBe(14);
  });
});

describe("buildExcelModel - IO·조건·GMP·병렬·식별 열", () => {
  const unusedFetch = async (): Promise<Graph> => {
    throw new Error("unused");
  };
  const spRef = (over: Record<string, unknown> = {}) => ({
    name: null, designated: true, department: null, assignee: null, system: null,
    duration: null, cost_krw: null, cost_usd: null, headcount: null, touch_time: null, input: null, output: null,
    input_forms: null, output_forms: null, input_ids: null, output_ids: null, start_condition: null, end_condition: null,
    frequency_fallback: null, gmp: null, url: null, url_label: null, sp_description: null,
    ...over,
  });

  it("일반 노드 - IO 셀은 항목마다 [optional]·폼을 붙이고, 조건·GMP 라벨·병렬 Y·Other 원문 시스템을 싣는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("p1", "P", "process", 1, {
          input: "PR\nBudget", input_flags: "\noptional", input_forms: "Paper\nExcel",
          output: "Result", output_forms: "Word", start_condition: "PR submitted", end_condition: "Done",
          gmp: "direct", parallel_outputs: ["__primary__"], system: "Other", system_fallback: "Legacy ledger",
        }),
        makeNode("d1", "D", "decision", 2, { parallel_outputs: ["__primary__"] }),
      ],
      edges: [],
      groups: [],
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00", fetchResolved: unusedFetch,
    });
    const rows = model.rows.filter((r) => r.kind === "node");
    expect(rows.find((r) => r.title === "P")).toMatchObject({
      input: "PR · Paper\nBudget [optional] · Excel",
      output: "Result · Word",
      start_condition: "PR submitted",
      end_condition: "Done",
      gmp: "GMP Direct",
      parallel: "Y",
      system: "Legacy ledger",
    });
    // 분기 노드에 남은 병렬 플래그는 표기하지 않는다(병렬 대상 아님)
    expect(rows.find((r) => r.title === "D")?.parallel).toBe("");
  });

  it("병렬 열은 실제 병렬 갈래도 Y — 시작 노드 팬아웃·레거시 gateway=parallel, 한 갈래 시작은 빈칸", async () => {
    const legacy = (id: string, source: string, target: string): GraphEdge => ({ ...makeEdge(id, source, target), gateway: "parallel" });
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C", "process", 3),
        makeNode("d1", "D", "process", 4),
        makeNode("s2", "Lone start", "start", 5),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "s1", "b1"),
        legacy("x3", "a1", "c1"), legacy("x4", "a1", "d1"),
        makeEdge("x5", "s2", "c1"),
      ],
      groups: [],
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00", fetchResolved: unusedFetch,
    });
    const rows = model.rows.filter((r) => r.kind === "node");
    expect(rows.find((r) => r.title === "Start")?.parallel).toBe("Y");
    expect(rows.find((r) => r.title === "A")?.parallel).toBe("Y");
    expect(rows.find((r) => r.title === "B")?.parallel).toBe("");
  });

  it("지정된 SP 행 - 이름·담당·역할·부서·시스템·URL·IO·조건·GMP는 링크 맵 지정값, Next의 SP 대상도 현재 이름", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("a1", "A", "process", 0),
        makeSubNode("sub1", "Old name", 1, 2, {
          assignee: "stale", department: "Stale dept", system: "Stale", url: "https://stale.example.com",
          input: "stale input",
        }),
      ],
      edges: [makeEdge("x1", "a1", "sub1")],
      groups: [],
      subprocess_refs: {
        2: spRef({
          name: "Renamed", assignee: "kim", assignee_role: "Owner", department: "Ops", system: "SAP",
          url: "https://sp.example.com", url_label: "SP doc", input: "Order\nSpec", input_forms: "\nPDF",
          start_condition: "Order in", gmp: "non_gmp",
        }),
      },
    };
    const fetchResolved = async (): Promise<Graph> => ({ nodes: [makeNode("k1", "Child", "process", 0)], edges: [], groups: [] });
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00", fetchResolved,
    });
    const rows = model.rows.filter((r) => r.kind === "node");
    expect(rows.find((r) => r.title === "A")?.next).toBe("2. Renamed");
    expect(rows.find((r) => r.type === "subprocess")).toMatchObject({
      title: "Renamed", assignee: "kim", assignee_role: "Owner", department: "Ops", system: "SAP",
      url: "https://sp.example.com", urlLabel: "SP doc", input: "Order\nSpec · PDF", start_condition: "Order in",
      gmp: "Non-GMP",
    });
  });

  it("미지정 SP 행은 노드 값으로 폴백한다", async () => {
    const map1: Graph = {
      nodes: [makeSubNode("sub1", "Sub", 1, 2, { assignee: "lee", department: "QA" })],
      edges: [],
      groups: [],
      subprocess_refs: { 2: spRef({ designated: false, assignee: "kim", department: "Ops" }) },
    };
    const fetchResolved = async (): Promise<Graph> => ({ nodes: [], edges: [], groups: [] });
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00", fetchResolved,
    });
    expect(model.rows.find((r) => r.kind === "node")).toMatchObject({ assignee: "lee", department: "QA" });
  });

  it("SP 출구 - 무라벨 엣지는 끝 제목을 라벨로 표기하고, 병렬 셀은 병렬로 켠 끝 이름을 나열한다", async () => {
    const map1: Graph = {
      nodes: [
        makeSubNode("sub1", "Sub", 0, 2, { parallel_outputs: ["반려"] }),
        makeNode("b1", "B", "process", 1),
        makeNode("c1", "C", "process", 2),
        makeNode("d1", "D", "process", 3),
      ],
      edges: [
        { ...makeEdge("x1", "sub1", "b1"), source_handle: "__primary__" },
        { ...makeEdge("x2", "sub1", "c1"), source_handle: "반려" },
        { ...makeEdge("x3", "sub1", "d1", "직접 라벨"), source_handle: "반려" },
      ],
      groups: [],
    };
    const child: Graph = {
      nodes: [
        makeNode("ce1", "승인 완료", "end", 0, { is_primary_end: true }),
        makeNode("ce2", "반려", "end", 1),
      ],
      edges: [],
      groups: [],
    };
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-10-02T00:00:00+09:00",
      fetchResolved: async () => child,
    });
    const subRow = model.rows.find((r) => r.kind === "node" && r.type === "subprocess");
    expect(subRow).toMatchObject({ next: "4. B [승인 완료]; 5. C [반려]; 6. D [직접 라벨]", parallel: "반려" });
  });
});
