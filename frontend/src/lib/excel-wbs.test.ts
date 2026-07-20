// WBS 모델 빌더 단위 테스트 — 레벨 경로·SP 무행·start/end 전부 삭제·주석·상한.
// 설계: docs/design/2026-07-17-excel-export-wbs-v2-design.md
import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { buildWbsModel, writeWbsSheet } from "./excel-wbs";
import { COLUMNS } from "./excel-export";

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

  it("locked·fetch 실패 SP는 잎 행(지정정보 상속)이 되고 denied 노트는 레벨 경로에 SP 제목을 단다", async () => {
    const map1: Graph = {
      nodes: [
        makeSubNode("sub1", "SubLocked", 0, 2, { description: "local add", annual_count: "12" }),
        makeSubNode("sub2", "SubGone", 1, 3),
      ],
      edges: [makeEdge("x1", "sub1", "sub2")],
      groups: [],
      subprocess_refs: {
        2: {
          designated: true, department: "Ops", assignee: null, system: null, duration: "72",
          cost_krw: "2000000", cost_usd: null, headcount: "6", url: null, url_label: null,
          sp_description: "base desc",
        },
      },
    };
    const fetchResolved = async (mapId: number): Promise<Graph> => {
      if (mapId === 2) return { nodes: [], edges: [], groups: [], locked: true };
      throw new Error("403");
    };
    const model = await build(map1, { fetchResolved });
    expect(
      model.rows.map((r) => (r.kind === "node" ? [r.no, r.levels, r.title] : [r.kind, r.levels])),
    ).toEqual([
      [1, ["Root"], "SubLocked"],
      ["denied", ["Root", "SubLocked"]],
      [2, ["Root"], "SubGone"],
      ["denied", ["Root", "SubGone"]],
    ]);
    // 잎 행 값 — 1안 SP 행과 동일 소스: 파라미터는 지정정보 상속, 설명은 베이스+추가분 합성
    expect(model.rows[0]).toMatchObject({
      type: "subprocess", duration: "72", cost_krw: "2000000", headcount: "6",
      annual_count: "12", description: "base desc\nlocal add", next: "SubGone",
    });
    expect(model.maxLevel).toBe(2); // denied 노트의 레벨 경로가 2단을 차지
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
