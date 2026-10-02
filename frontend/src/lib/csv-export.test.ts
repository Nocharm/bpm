// CSV 내보내기 단위 테스트 — 왕복 불변(export→re-import 무변경) 위주.
// 설계: 2026-07-11-numeric-params-excel-csv-export-design.md §3
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { buildGraphFromCsv, buildTemplateCsv, HEADER_COLUMNS } from "./csv-import";
import { buildCsvFromGraph, orderNodesByFlow } from "./csv-export";
import { CSV_COLUMNS } from "./export-columns";
import { getOutputViolations } from "./output-rules";

/** GraphNode 조립 헬퍼 — CSV가 다루는 필드는 over로 채우고 나머지는 빈 기본값. */
function makeNode(id: string, title: string, node_type: string, sort_order: number, over: Partial<GraphNode> = {}): GraphNode {
  return {
    id, title, description: "", node_type, color: "", assignee: "", department: "", system: "",
    duration: "", headcount: "", fte: "", cost_krw: "", cost_usd: "", annual_count: "", url: "", url_label: "",
    pos_x: 0, pos_y: 0, sort_order, group_ids: [], linked_map_id: null,
    follow_latest: false, linked_version_id: null, is_primary_end: false,
    ...over,
  };
}

function makeEdge(id: string, source: string, target: string, label = "", over: Partial<GraphEdge> = {}): GraphEdge {
  return { id, source_node_id: source, target_node_id: target, label, source_side: "right", target_side: "left", source_handle: null, target_handle: null, line_style: "", ...over };
}

/** 헤더 이름으로 행 셀을 집는다 — 열 추가·선택에도 인덱스가 안 어긋나게(따옴표 없는 단순 행 전용). */
function cellsByHeader(csv: string, rowPrefix: string): Record<string, string> {
  const lines = csv.split("\r\n");
  const header = lines[0].split(",");
  const cells = lines.find((line) => line.startsWith(rowPrefix))?.split(",") ?? [];
  return Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]));
}

describe("buildCsvFromGraph - round trip", () => {
  it("round-trip: export → re-import produces no changes", () => {
    const csv = [
      "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next",
      "A,first step,홍길동,Quality Part 1,SAP,16,1250000,,1,1200,0.8,,,B",
      "B,,,,,0.30,,,2,,,,,C:yes;D:no",
      "C,,,,,,,,,,,https://example.com/x,Doc,",
      "D,,,,,,,,,,,,,",
    ].join("\r\n");
    const first = buildGraphFromCsv(csv);
    expect(first.errors).toEqual([]);
    const graph = first.graph!;
    const { csv: exported, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    // 비용은 콤마 없이(raw 숫자) 내보내야 왕복이 무손실 — "1,250,000"이 아니라 "1250000"
    expect(exported).toContain(",1250000,,1,1200,0.8,");
    const second = buildGraphFromCsv(exported, { base: graph });
    expect(second.errors).toEqual([]);
    expect(second.merge.addedNodeIds).toEqual([]);
    expect(second.merge.removedNodes).toEqual([]);
    expect(second.merge.lostEdges).toEqual([]);
    const a = second.graph!.nodes.find((n) => n.title === "A")!;
    expect(a.cost_krw).toBe("1250000");
    expect(a.annual_count).toBe("1200");
    expect(a.fte).toBe("0.8");
  });

  it("Input_Flags 왕복 - optional 줄(선행 빈 줄 포함)이 export→re-import에서 보존된다 (io-linking)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s", "Start", "start", 0),
        makeNode("a", "A", "process", 1, { input: "PR\n참고자료", input_flags: "\noptional" }),
        makeNode("e", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("e1", "s", "a"), makeEdge("e2", "a", "e")],
      groups: [],
    };
    const { csv: exported, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    expect(exported.split("\r\n")[0]).toContain("Input,Input_Flags,Input_Forms,Output,Output_Forms");
    const re = buildGraphFromCsv(exported, { base: graph });
    expect(re.errors).toEqual([]);
    const a = re.graph!.nodes.find((n) => n.title === "A")!;
    expect(a.input).toBe("PR\n참고자료");
    expect(a.input_flags).toBe("\noptional");
  });

  it("분기 라벨(대상:라벨)이 왕복에서 보존된다", () => {
    const csv = [
      "Name,Description,Assignee,Department,System,Duration,Cost_KRW,Cost_USD,Headcount,Annual_Count,FTE,URL,URL_Label,Next",
      "A,,,,,,,,,,,,,B",
      "B,,,,,,,,,,,,,C:approved;D:rejected",
      "C,,,,,,,,,,,,,",
      "D,,,,,,,,,,,,,",
    ].join("\r\n");
    const graph = buildGraphFromCsv(csv).graph!;
    const { csv: exported } = buildCsvFromGraph(graph);
    const bCells = cellsByHeader(exported, "B,");
    expect(bCells.Name).toBe("B");
    expect(bCells.Next).toBe("C:approved;D:rejected");
  });

  it("Parallel=Y 행은 Next가 2개여도 분기가 아니라 병렬 출구 일반 노드로 왕복한다", () => {
    const csv = [
      "Name,Parallel,Next",
      "A,Y,B;C",
      "B,,",
      "C,,",
      "D,maybe,",
    ].join("\r\n");
    const imported = buildGraphFromCsv(csv);
    const a = imported.graph!.nodes.find((n) => n.title === "A")!;
    expect(a.node_type).toBe("process");
    expect(a.parallel_outputs).toEqual(["__primary__"]);
    expect(imported.warnings.some((w) => w.message.includes('Parallel "maybe"'))).toBe(true);

    const { csv: exported } = buildCsvFromGraph(imported.graph!);
    expect(cellsByHeader(exported, "A,").Parallel).toBe("Y");
    const again = buildGraphFromCsv(exported, { base: imported.graph! }).graph!;
    expect(again.nodes.find((n) => n.title === "A")).toMatchObject({ node_type: "process", parallel_outputs: ["__primary__"] });
  });

  it("Parallel 빈 칸은 기존 병렬 설정을 유지하고, Y인데 Next가 1개면 경고한다", () => {
    const first = buildGraphFromCsv(["Name,Parallel,Next", "A,Y,B;C", "B,,", "C,,"].join("\r\n")).graph!;
    const blank = buildGraphFromCsv(["Name,Next", "A,B;C", "B,", "C,"].join("\r\n"), { base: first }).graph!;
    expect(blank.nodes.find((n) => n.title === "A")).toMatchObject({ node_type: "process", parallel_outputs: ["__primary__"] });

    const single = buildGraphFromCsv(["Name,Parallel,Next", "A,Y,B", "B,,"].join("\r\n"));
    expect(single.warnings.some((w) => w.message.includes("needs two or more Next targets"))).toBe(true);
  });

  it("따옴표·쉼표·줄바꿈 셀 이스케이프 - export → re-import에서 원문 보존", () => {
    const rawDescription = 'Review, "carefully" and\nreport to manager';
    const graph: Graph = {
      nodes: [makeNode("a1", "A", "process", 1, { description: rawDescription })],
      edges: [],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    expect(csv).toContain('"Review, ""carefully"" and\nreport to manager"');
    const reimported = buildGraphFromCsv(csv);
    expect(reimported.errors).toEqual([]);
    expect(reimported.graph!.nodes.find((n) => n.title === "A")?.description).toBe(rawDescription);
  });

  it("추가 end 노드는 스킵하고 경고", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
        makeNode("e2", "Extra End", "end", 3, { is_primary_end: false }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "e1")],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual(['Secondary end node "Extra End" is not expressible in CSV - skipped']);
    const lines = csv.split("\r\n");
    expect(lines.length).toBe(2); // header + A만 (start/end/extra end 모두 행이 아님)
    expect(lines[1].startsWith("A,")).toBe(true);
  });

  it("라벨 있는 End행 엣지는 경고와 함께 생략", () => {
    const graph: Graph = {
      nodes: [
        makeNode("a1", "A", "decision", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "a1", "b1", "approve"), makeEdge("x2", "a1", "e1", "reject")],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([
      'Edge "A" → End (label "reject") is not expressible in CSV - dropped',
      'Decision "A" has fewer than 2 branches - re-import will infer process',
    ]);
    const aCells = cellsByHeader(csv, "A,");
    expect(aCells.Name).toBe("A");
    expect(aCells.Next).toBe("B:approve"); // reject 브랜치는 드롭됨
  });

  it("무라벨 End행 엣지도 다른 outgoing과 병존하면 경고와 함께 생략", () => {
    // A(process)의 outgoing 2개 — 무라벨 End행 + 실제 대상 B. Next 없음≠outgoing 있음이라 임포트가 재생성 못 함.
    const graph: Graph = {
      nodes: [
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "a1", "e1"), makeEdge("x2", "a1", "b1")],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual(['Edge "A" → End is not expressible in CSV - dropped']);
    expect(cellsByHeader(csv, "A,").Next).toBe("B"); // End행 엣지는 드랍, B만 남는다
  });

  it("Next 대상 제목의 ;/:와 라벨의 ;는 그대로 내보내되 오파싱 경고", () => {
    // 임포트 파서는 Next를 ";"로 쪼개고 첫 ":"에서 target/label을 가른다 — 재임포트가 조용히 어긋나는 조합
    const graph: Graph = {
      nodes: [
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C:review", "process", 3), // 제목에 ":" — 재임포트가 target "C"/label "review"로 오파싱
      ],
      edges: [makeEdge("x1", "a1", "c1"), makeEdge("x2", "a1", "b1", "ok;fine")],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([
      'Next target "C:review" contains ";" or ":" - re-import will misparse this reference',
      'Edge label "ok;fine" (from "A") contains ";" - re-import will misparse this reference',
    ]);
    // 드랍 없이 그대로 직렬화 — 라벨의 ";"까지 셀에 들어간다(단순 split이라 Next 뒤를 이어 붙여 확인)
    expect(csv.split("\r\n").find((line) => line.startsWith("A,"))?.endsWith(",C:review;B:ok;fine")).toBe(true);
  });

  it("제목 중복 노드는 그대로 내보내되 경고", () => {
    const graph: Graph = {
      nodes: [makeNode("a1", "A", "process", 1), makeNode("a2", "A", "process", 2)],
      edges: [],
      groups: [],
    };
    const { warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual(['Duplicate title "A" - re-import will fail on this file']);
  });

  it("start의 outgoing 대상이 진입 엣지 없는 노드 집합과 다르면 경고", () => {
    // start→B만 연결, A는 진입 엣지 없이 고립(root)인데 start와 미연결
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "b1"), makeEdge("x2", "b1", "e1"), makeEdge("x3", "a1", "e1")],
      groups: [],
    };
    const { warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual(["Start connections differ from computed roots - re-import will recompute them"]);
  });

  it("숫자 파라미터 필드가 undefined일 때도 안전하게 빈 문자열로 직렬화된다", () => {
    const bare: GraphNode = {
      id: "n1", title: "N", description: "", node_type: "process", color: "",
      assignee: "", department: "", system: "", duration: "",
      // headcount/fte/cost_krw/annual_count 의도적으로 생략(undefined) — optional 필드 안전성 검증
      url: "", url_label: "", pos_x: 0, pos_y: 0, sort_order: 1,
      group_ids: [], linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
    };
    const graph: Graph = { nodes: [bare], edges: [], groups: [] };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    const cells = cellsByHeader(csv, "N,");
    for (const header of ["Duration", "Touch_Time", "Cost_KRW", "Cost_USD", "Headcount", "Annual_Count", "FTE"]) {
      expect(cells[header]).toBe("");
    }
  });
});

describe("orderNodesByFlow", () => {
  it("start부터 흐름 순, 미도달은 sort_order 순으로 끝에", () => {
    const start = makeNode("s1", "Start", "start", 0);
    const a = makeNode("a1", "A", "process", 1);
    const b = makeNode("b1", "B", "process", 2);
    const c = makeNode("c1", "C", "process", 5); // 고아 — 아무 엣지에도 연결 없음
    const edges = [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1")];
    const ordered = orderNodesByFlow([c, start, b, a], edges); // 입력 순서는 뒤섞어 sort_order 의존 확인
    expect(ordered.map((n) => n.id)).toEqual(["s1", "a1", "b1", "c1"]);
  });

  it("start 노드가 없으면 sort_order 순으로 정렬한다", () => {
    const a = makeNode("a1", "A", "process", 2);
    const b = makeNode("b1", "B", "process", 1);
    const ordered = orderNodesByFlow([a, b], []);
    expect(ordered.map((n) => n.id)).toEqual(["b1", "a1"]);
  });

  it("사이클이 있어도 무한 루프 없이 각 노드를 한 번씩 방문한다", () => {
    const start = makeNode("s1", "Start", "start", 0);
    const a = makeNode("a1", "A", "process", 1);
    const b = makeNode("b1", "B", "process", 2);
    // B → A로 되돌아가는 사이클
    const edges = [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1"), makeEdge("x3", "b1", "a1")];
    const ordered = orderNodesByFlow([start, a, b], edges);
    expect(ordered.map((n) => n.id)).toEqual(["s1", "a1", "b1"]);
  });
});

// Role 열 왕복 + Other 시스템의 원문 메모 왕복 (design 2026-09-12)
describe("buildCsvFromGraph - role and system catalog round trip", () => {
  const catalogs = {
    assignee_roles: [{ value: "Buyer", aliases: ["구매 담당자"] }],
    systems: [{ value: "Other", aliases: [] }, { value: "SAP ERP", aliases: ["sap"] }],
  };

  it("exports the Role column and the raw note for Other systems", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1, { assignee_role: "Buyer", system: "SAP ERP" }),
        makeNode("b1", "B", "process", 2, { system: "Other", system_fallback: "Legacy ledger" }),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1"), makeEdge("x3", "b1", "e1")],
      groups: [],
    };
    const { csv } = buildCsvFromGraph(graph);
    const lines = csv.split("\r\n");
    expect(lines[0].split(",").slice(0, 6)).toEqual(["Name", "Description", "Assignee", "Role", "Department", "System"]);
    expect(lines[1].split(",").slice(0, 6)).toEqual(["A", "", "", "Buyer", "", "SAP ERP"]);
    expect(lines[2].split(",").slice(0, 6)).toEqual(["B", "", "", "", "", "Legacy ledger"]); // Other → 원문 메모

    // 재임포트(카탈로그 있음) → 무변경: 역할 유지, Other+메모 복원
    const outcome = buildGraphFromCsv(csv, { base: graph, catalogs });
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([]);
    const a = outcome.graph?.nodes.find((n) => n.id === "a1");
    const b = outcome.graph?.nodes.find((n) => n.id === "b1");
    expect(a?.assignee_role).toBe("Buyer");
    expect(a?.system).toBe("SAP ERP");
    expect(b?.system).toBe("Other");
    expect(b?.system_fallback).toBe("Legacy ledger");
  });
});

// 열 정의 단일 소스 가드 — 임포트 HEADER_COLUMNS·내보내기 헤더·템플릿 헤더가 한 목록에서 나온다 (C45)
describe("CSV column single source", () => {
  it("export header, template header and import columns are the same 25 columns", () => {
    const graph: Graph = { nodes: [makeNode("a1", "A", "process", 1)], edges: [], groups: [] };
    const exportHeader = buildCsvFromGraph(graph).csv.split("\r\n")[0];
    const templateLines = buildTemplateCsv().split("\r\n");
    expect(exportHeader).toBe(CSV_COLUMNS.map((c) => c.header).join(","));
    expect(templateLines[0]).toBe(exportHeader);
    expect(exportHeader.toLowerCase().split(",")).toEqual([...HEADER_COLUMNS]);
    expect(HEADER_COLUMNS).toHaveLength(25);
  });
});

// 내보내기 컬럼 선택 (export-column-picker-design 2026-10-02)
describe("buildCsvFromGraph - column selection", () => {
  const graph: Graph = {
    nodes: [
      makeNode("s1", "Start", "start", 0),
      makeNode("a1", "A", "process", 1, { description: "first", system: "SAP" }),
      makeNode("b1", "B", "process", 2),
      makeNode("e1", "End", "end", 3, { is_primary_end: true }),
    ],
    edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "b1"), makeEdge("x3", "b1", "e1")],
    groups: [],
  };

  it("writes only the selected columns in canonical order and always keeps the import columns Name, Parallel, Next", () => {
    const { csv } = buildCsvFromGraph(graph, { columns: ["description"] });
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Description,Parallel,Next");
    expect(lines[1]).toBe("A,first,,B");
    expect(lines.every((line) => line.split(",").length === 4)).toBe(true);
  });

  it("keeps Input_Flags and Input_Forms with Input, and Output_Forms with Output", () => {
    const { csv } = buildCsvFromGraph(graph, { columns: ["input", "output"] });
    expect(csv.split("\r\n")[0]).toBe("Name,Input,Input_Flags,Input_Forms,Output,Output_Forms,Parallel,Next");
  });

  it("writes every column when no selection is given", () => {
    const { csv } = buildCsvFromGraph(graph);
    expect(csv.split("\r\n")[1].split(",")).toHaveLength(CSV_COLUMNS.length);
  });

  it("a subset file re-imports into the same map without changing the omitted columns", () => {
    const { csv } = buildCsvFromGraph(graph, { columns: ["next"] });
    const merged = buildGraphFromCsv(csv, { base: graph });
    expect(merged.errors).toEqual([]);
    expect(merged.graph!.nodes.find((n) => n.id === "a1")).toMatchObject({ description: "first", system: "SAP" });
    expect(merged.merge.lostEdges).toEqual([]);
  });
});

describe("buildCsvFromGraph - GMP and data form columns", () => {
  it("round-trips GMP and per-item forms (leading blank line kept)", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1, {
          input: "PR\nBudget", input_forms: "\nExcel", output: "Result", output_forms: "Word", gmp: "direct", color: "#16794f",
        }),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x2", "a1", "e1")],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    expect(csv.split("\r\n")[0]).toContain("Input_Forms");
    const fresh = buildGraphFromCsv(csv);
    expect(fresh.errors).toEqual([]);
    expect(fresh.graph!.nodes.find((n) => n.title === "A")).toMatchObject({
      input_forms: "\nExcel", output_forms: "Word", gmp: "direct",
    });
    const merged = buildGraphFromCsv(csv, { base: graph }).graph!;
    // 색은 CSV GMP로 바뀌지 않는다(에디터 자동 색 확정은 CSV 미적용)
    expect(merged.nodes.find((n) => n.id === "a1")).toMatchObject({
      input_forms: "\nExcel", output_forms: "Word", gmp: "direct", color: "#16794f",
    });
  });
});

describe("buildCsvFromGraph - structures the table cannot hold", () => {
  it("warns about an edge into a secondary end and keeps the node warning first", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("a1", "A", "process", 1),
        makeNode("e1", "End", "end", 2, { is_primary_end: true }),
        makeNode("e2", "Extra End", "end", 3, { is_primary_end: false }),
      ],
      edges: [makeEdge("x1", "s1", "a1"), makeEdge("x3", "a1", "e2", "reject")],
      groups: [],
    };
    const { warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([
      'Secondary end node "Extra End" is not expressible in CSV - skipped',
      'Edge "A" → secondary end "Extra End" (label "reject") is not expressible in CSV - dropped (re-import connects this row to the primary End)',
    ]);
  });

  it("omits the primary End clause when the row keeps another Next target", () => {
    // Arrange — 분기가 B와 보조 끝으로 갈라진다. Next에 B가 남으니 재임포트는 이 행을 End에 잇지 않는다
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("d1", "D", "decision", 1),
        makeNode("b1", "B", "process", 2),
        makeNode("e1", "End", "end", 3, { is_primary_end: true }),
        makeNode("e2", "Extra End", "end", 4, { is_primary_end: false }),
      ],
      edges: [
        makeEdge("x1", "s1", "d1"),
        makeEdge("x2", "d1", "e2", "reject"),
        makeEdge("x3", "d1", "b1", "ok"),
        makeEdge("x4", "b1", "e1"),
      ],
      groups: [],
    };

    // Act
    const { warnings } = buildCsvFromGraph(graph);

    // Assert
    expect(warnings).toContain(
      'Edge "D" → secondary end "Extra End" (label "reject") is not expressible in CSV - dropped',
    );
    expect(warnings.some((w) => w.includes("re-import connects this row"))).toBe(false);
  });

  it("does not write Parallel=Y for a decision node with a stray flag", () => {
    const graph: Graph = {
      nodes: [
        makeNode("d1", "D", "decision", 1, { parallel_outputs: ["__primary__"] }),
        makeNode("b1", "B", "process", 2),
        makeNode("c1", "C", "process", 3),
      ],
      edges: [makeEdge("x1", "d1", "b1", "yes"), makeEdge("x2", "d1", "c1", "no")],
      groups: [],
    };
    const { csv } = buildCsvFromGraph(graph);
    expect(cellsByHeader(csv, "D,").Parallel).toBe("");
    // 재임포트해도 분기가 병렬 일반 노드로 뒤집히지 않는다
    expect(buildGraphFromCsv(csv).graph!.nodes.find((n) => n.title === "D")?.node_type).toBe("decision");
  });

  // D3 — SP 끝별 출구는 Next로 표현되지 않으니 경고하고, 같은 맵 재가져오기는 기존 연결의 끝·변을 그대로 이월한다
  it("warns about subprocess exits from secondary ends and keeps them when re-imported into the same map", () => {
    const graph: Graph = {
      nodes: [
        makeNode("s1", "Start", "start", 0),
        makeNode("p1", "P", "process", 1),
        makeNode("sp", "SP", "subprocess", 2, { linked_map_id: 7 }),
        makeNode("a1", "A", "process", 3),
        makeNode("b1", "B", "process", 4),
        makeNode("e1", "End", "end", 5, { is_primary_end: true }),
      ],
      edges: [
        makeEdge("x1", "s1", "p1"),
        makeEdge("x2", "p1", "sp", "", { source_side: "bottom", target_handle: "in:top" }),
        makeEdge("x3", "sp", "a1", "", { source_handle: "__primary__" }),
        makeEdge("x4", "sp", "b1", "", { source_handle: "반려" }),
        makeEdge("x5", "a1", "e1"),
        makeEdge("x6", "b1", "e1"),
      ],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([
      'Subprocess "SP" exit "반려" → "B" is not expressible in CSV - re-import keeps it only when the same connection already exists',
    ]);
    const merged = buildGraphFromCsv(csv, { base: graph });
    expect(merged.errors).toEqual([]);
    expect(merged.merge.lostEdges).toEqual([]);
    const edges = merged.graph!.edges;
    const pairOf = (source: string, target: string) =>
      edges.find((e) => e.source_node_id === source && e.target_node_id === target);
    expect(pairOf("sp", "b1")?.source_handle).toBe("반려");
    expect(pairOf("sp", "a1")?.source_handle).toBe("__primary__");
    expect(pairOf("p1", "sp")).toMatchObject({ source_side: "bottom", target_handle: "in:top" });
    // 끝별 출구가 대표 끝으로 모이지 않으니 출력 규칙 위반이 새로 생기지 않는다
    const nodes = merged.graph!.nodes.map((n) => ({ id: n.id, nodeType: n.node_type, parallelOutputs: n.parallel_outputs }));
    const ruleEdges = edges.map((e) => ({ source: e.source_node_id, sourceHandle: e.source_handle }));
    expect(getOutputViolations(nodes, ruleEdges)).toEqual([]);
  });

  it("warns that a per-end parallel exit is not expressible and keeps it on re-import", () => {
    const graph: Graph = {
      nodes: [
        makeNode("sp", "SP", "subprocess", 1, { linked_map_id: 7, parallel_outputs: ["반려"] }),
        makeNode("a1", "A", "process", 2),
        makeNode("b1", "B", "process", 3),
      ],
      edges: [
        makeEdge("x1", "sp", "a1", "", { source_handle: "반려" }),
        makeEdge("x2", "sp", "b1", "", { source_handle: "반려" }),
      ],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toContain('Subprocess "SP" has a parallel exit on end "반려" - per-end parallel is not expressible in CSV');
    const merged = buildGraphFromCsv(csv, { base: graph }).graph!;
    expect(merged.nodes.find((n) => n.id === "sp")?.parallel_outputs).toEqual(["반려"]);
    expect(merged.edges.every((e) => e.source_node_id !== "sp" || e.source_handle === "반려")).toBe(true);
  });

  it("folds two subprocess exits that reach the same target into one Next entry", () => {
    const graph: Graph = {
      nodes: [
        makeNode("sp", "SP", "subprocess", 1, { linked_map_id: 7 }),
        makeNode("a1", "A", "process", 2),
      ],
      edges: [
        makeEdge("x1", "sp", "a1", "", { source_handle: "__primary__" }),
        makeEdge("x2", "sp", "a1", "", { source_handle: "반려" }),
      ],
      groups: [],
    };
    const { csv, warnings } = buildCsvFromGraph(graph);
    expect(cellsByHeader(csv, "SP,").Next).toBe("A");
    expect(warnings).toContain('"SP" reaches "A" more than once - kept once in Next');
    expect(buildGraphFromCsv(csv).errors).toEqual([]);
  });
});
