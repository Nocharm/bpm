// CSV 내보내기 단위 테스트 — 왕복 불변(export→re-import 무변경) 위주.
// 설계: docs/superpowers/specs/2026-07-11-numeric-params-excel-csv-export-design.md §3
import { describe, expect, it } from "vitest";

import type { Graph, GraphEdge, GraphNode } from "./api";
import { buildGraphFromCsv } from "./csv-import";
import { buildCsvFromGraph, orderNodesByFlow } from "./csv-export";

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

function makeEdge(id: string, source: string, target: string, label = ""): GraphEdge {
  return { id, source_node_id: source, target_node_id: target, label, source_side: "right", target_side: "left", source_handle: null, target_handle: null };
}

describe("buildCsvFromGraph — round trip", () => {
  it("round-trip: export → re-import produces no changes", () => {
    const csv = [
      "Name,Description,Assignee,Department,System,Duration,Headcount,FTE,Cost_KRW,Annual_Count,URL,URL_Label,Next",
      "A,first step,홍길동,Quality Part 1,SAP,16,1,,,,,,B",
      'B,,,,,0.30,2,,,,,,C:yes;D:no',
      "C,,,,,,,,,,https://example.com/x,Doc,",
      "D,,,,,,,,,,,,",
    ].join("\r\n");
    const first = buildGraphFromCsv(csv);
    expect(first.errors).toEqual([]);
    const graph = first.graph!;
    const { csv: exported, warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual([]);
    const second = buildGraphFromCsv(exported, { base: graph });
    expect(second.errors).toEqual([]);
    expect(second.merge.addedNodeIds).toEqual([]);
    expect(second.merge.removedNodes).toEqual([]);
    expect(second.merge.lostEdges).toEqual([]);
  });

  it("분기 라벨(대상:라벨)이 왕복에서 보존된다", () => {
    const csv = [
      "Name,Description,Assignee,Department,System,Duration,Headcount,FTE,Cost_KRW,Annual_Count,URL,URL_Label,Next",
      "A,,,,,,,,,,,,B",
      "B,,,,,,,,,,,,C:approved;D:rejected",
      "C,,,,,,,,,,,,",
      "D,,,,,,,,,,,,",
    ].join("\r\n");
    const graph = buildGraphFromCsv(csv).graph!;
    const { csv: exported } = buildCsvFromGraph(graph);
    const bCells = exported.split("\r\n").find((line) => line.startsWith("B,"))?.split(",");
    expect(bCells?.[0]).toBe("B"); // Name
    expect(bCells?.[12]).toBe("C:approved;D:rejected"); // Next (13번째 컬럼)
  });

  it("따옴표·쉼표·줄바꿈 셀 이스케이프 — export → re-import에서 원문 보존", () => {
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
    expect(warnings).toEqual(['Secondary end node "Extra End" is not expressible in CSV — skipped']);
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
      'Edge "A" → End (label "reject") is not expressible in CSV — dropped',
      'Decision "A" has fewer than 2 branches — re-import will infer process',
    ]);
    const aCells = csv.split("\r\n").find((line) => line.startsWith("A,"))?.split(",");
    expect(aCells?.[0]).toBe("A"); // Name
    expect(aCells?.[12]).toBe("B:approve"); // Next — reject 브랜치는 드롭됨
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
    expect(warnings).toEqual(['Edge "A" → End is not expressible in CSV — dropped']);
    const aCells = csv.split("\r\n").find((line) => line.startsWith("A,"))?.split(",");
    expect(aCells?.[12]).toBe("B"); // Next — End행 엣지는 드랍, B만 남는다
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
      'Next target "C:review" contains ";" or ":" — re-import will misparse this reference',
      'Edge label "ok;fine" (from "A") contains ";" — re-import will misparse this reference',
    ]);
    const aCells = csv.split("\r\n").find((line) => line.startsWith("A,"))?.split(",");
    expect(aCells?.[12]).toBe("C:review;B:ok;fine"); // 드랍 없이 그대로 직렬화
  });

  it("제목 중복 노드는 그대로 내보내되 경고", () => {
    const graph: Graph = {
      nodes: [makeNode("a1", "A", "process", 1), makeNode("a2", "A", "process", 2)],
      edges: [],
      groups: [],
    };
    const { warnings } = buildCsvFromGraph(graph);
    expect(warnings).toEqual(['Duplicate title "A" — re-import will fail on this file']);
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
    expect(warnings).toEqual(["Start connections differ from computed roots — re-import will recompute them"]);
  });

  it("숫자 파라미터 4필드가 undefined일 때도 안전하게 빈 문자열로 직렬화된다", () => {
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
    const cells = csv.split("\r\n")[1].split(",");
    // Name,Description,Assignee,Department,System,Duration,Headcount,FTE,Cost_KRW,Annual_Count,URL,URL_Label,Next
    expect(cells.slice(6, 10)).toEqual(["", "", "", ""]);
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
