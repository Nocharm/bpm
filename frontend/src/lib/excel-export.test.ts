// Excel 모델 빌더 단위 테스트 — 재귀 인라인·순환·다이아몬드 메모이즈·locked·행 상한·next End 표기·
// 회당 파라미터 6종(서브프로세스 sp_* 소스 포함)·컬럼 헤더/서식(Task 9).
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §4,
//       docs/superpowers/specs/2026-07-13-node-params-redefinition-design.md §5.2
import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphGroup, GraphNode } from "./api";
import { buildExcelModel, COLUMNS, writeExcelSheet } from "./excel-export";

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
  return { id, source_node_id: source, target_node_id: target, label, source_side: "right", target_side: "left", source_handle: null, target_handle: null };
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
      ["Start", 1],
      ["P", 1],
      ["End", 1],
      ["End", 0],
    ]);
  });

  it("rootMapId 전달 시 루트 상호참조 순환은 재펼침 없이 즉시 circular 1행 — 루트 맵 re-fetch 없음", async () => {
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
      ["Start", 1], ["SubToMap1", 1],
      ["circular", 2],
      ["End", 1], ["End", 0],
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
      ["Start", 1], ["SubToMap1", 1],
      ["Start", 2], ["SubToMap2", 2],
      ["circular", 3],
      ["End", 2], ["End", 1], ["End", 0],
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
    expect(kinds).toEqual(["Start", "SubToMap2", "SubToMap3", "SubToMap2Again", "circular", "End"]);
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
      ["End", 0],
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
    expect(model.rows.map((r) => (r.kind === "node" ? r.title : r.kind))).toEqual(["Start", "Sub", "denied", "End"]);
  });

  it("행 상한 초과 시 rowLimit 행과 truncated=true", async () => {
    // maxRows: 5 로 작게 줘서 검증 — start,a,b,c,d,end 6개 노드
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C", "process", 3),
        makeNode("d1", "D", "process", 4),
        makeNode("e1", "End", "end", 5, { is_primary_end: true }),
      ],
      edges: [
        makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1"), makeEdge("x3", "b1", "c1"),
        makeEdge("x4", "c1", "d1"), makeEdge("x5", "d1", "e1"),
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
    // maxRows:3 → Start(1), Sub(2), map2.Start(3)에서 rowLimit 도달 → rowLimit 1행, 이후 전부 중단(맵1의 End 미포함)
    const model = await buildExcelModel({
      graph: map1, mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-11T00:00:00+09:00",
      fetchResolved, maxRows: 3,
    });
    expect(model.truncated).toBe(true);
    expect(model.rows.filter((r) => r.kind === "rowLimit").length).toBe(1);
    const kinds = model.rows.map((r) => (r.kind === "node" ? r.title : r.kind));
    expect(kinds).toEqual(["Start", "Sub", "Start", "rowLimit"]);
  });

  it("start/end 포함 전체 노드가 행으로 나오고 next에 End도 표기", async () => {
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
    expect(nodeRows.map((r) => r.title)).toEqual(["Start", "A", "B", "End"]);
    const aRow = nodeRows.find((r) => r.title === "A");
    expect(aRow?.next).toBe("B:approve;End:reject");
    const bRow = nodeRows.find((r) => r.title === "B");
    expect(bRow?.next).toBe("End");
    const endRow = nodeRows.find((r) => r.title === "End");
    expect(endRow?.next).toBe("");
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

  it("일반 노드 행이 회당 파라미터 6종을 담는다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("p1", "P", "process", 1, {
          duration: "1.30", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
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
      duration: "1.30", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
    });
  });

  it("서브프로세스 행의 duration/비용/headcount는 링크 맵의 sp_* 지정값에서, annual_count/fte는 노드 자신의 값에서 온다", async () => {
    const map1: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        // 노드 자신에 남은 duration/cost_krw/cost_usd/headcount(비편집 필드의 잔존값)는 무시돼야 한다
        makeSubNode("sub1", "Sub", 1, 2, {
          duration: "9.99", cost_krw: "999", cost_usd: "999", headcount: "99",
          annual_count: "1200", fte: "0.8",
        }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "sub1"), makeEdge("x2", "sub1", "e1")],
      groups: [],
      // 백엔드 get_subprocess_refs는 호출 그래프 자신의 서브프로세스 노드 기준으로 채운다 — map1이 가짐
      subprocess_refs: {
        2: {
          designated: true, department: null, assignee: null, system: null,
          duration: "2.15", cost_krw: "500000", cost_usd: null, headcount: "3", url: null, url_label: null,
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
      duration: "2.15", cost_krw: "500000", cost_usd: "", headcount: "3",
      annual_count: "1200", fte: "0.8",
    });
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
});

describe("COLUMNS", () => {
  it("헤더가 새 라벨·순서를 따른다(design 2026-07-13 §5.2)", () => {
    expect(COLUMNS.map((c) => c.header)).toEqual([
      "No", "Name", "Type", "Description", "Assignee", "Department", "System",
      "Duration (h)", "Cost (KRW)", "Cost (USD)", "Headcount", "Annual volume", "FTE",
      "URL", "Groups", "Next",
    ]);
  });
});

describe("writeExcelSheet", () => {
  function findColumnIndex(header: string): number {
    const index = COLUMNS.findIndex((c) => c.header === header);
    if (index < 0) throw new Error(`unknown column: ${header}`);
    return index + 1;
  }

  // exceljs Workbook 대상 순수 검증(다운로드 Blob/anchor와 분리) — 메타 3행+헤더 1행 다음이 첫 데이터 행(5)
  function buildSheetWithOneRow(over: Partial<Record<string, string>> = {}) {
    const base = {
      duration: "1.30", cost_krw: "1250000", cost_usd: "", headcount: "2", annual_count: "1200", fte: "0.8",
      ...over,
    };
    const workbook = new Workbook();
    writeExcelSheet(workbook, {
      mapName: "Map1", versionLabel: "v1", exportedAt: "2026-07-13T00:00:00+09:00", truncated: false,
      rows: [{
        kind: "node", depth: 0, title: "P", type: "process", description: "", assignee: "",
        department: "", system: "", url: "", urlLabel: "", groups: "", next: "", ...base,
      }],
    });
    const sheet = workbook.getWorksheet("Process Map");
    if (!sheet) throw new Error("sheet missing");
    return sheet.getRow(5);
  }

  it("6개 숫자 컬럼에 지정된 numFmt를 적용하고, 텍스트 컬럼엔 서식을 남기지 않는다", () => {
    const dataRow = buildSheetWithOneRow();
    expect(dataRow.getCell(findColumnIndex("Duration (h)")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Cost (KRW)")).numFmt).toBe("#,##0");
    expect(dataRow.getCell(findColumnIndex("Cost (USD)")).numFmt).toBe("#,##0.00");
    expect(dataRow.getCell(findColumnIndex("Headcount")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Annual volume")).numFmt).toBe("#,##0");
    expect(dataRow.getCell(findColumnIndex("FTE")).numFmt).toBe("0.00");
    expect(dataRow.getCell(findColumnIndex("Name")).numFmt).toBeUndefined();
  });

  it("숫자 셀은 텍스트가 아니라 실제 숫자로 들어간다", () => {
    const dataRow = buildSheetWithOneRow();
    expect(dataRow.getCell(findColumnIndex("Cost (KRW)")).value).toBe(1250000);
    expect(dataRow.getCell(findColumnIndex("FTE")).value).toBe(0.8);
  });

  it("빈 파라미터 값은 0이 아니라 빈 셀로 남는다", () => {
    const dataRow = buildSheetWithOneRow({ cost_krw: "", cost_usd: "", headcount: "", annual_count: "", fte: "" });
    for (const header of ["Cost (KRW)", "Cost (USD)", "Headcount", "Annual volume", "FTE"]) {
      const value = dataRow.getCell(findColumnIndex(header)).value;
      expect(value).not.toBe(0);
    }
  });
});
