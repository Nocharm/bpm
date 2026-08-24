// canvas 순수 헬퍼 단위 테스트 — 시작/끝 연결 규칙 + 터미널 표시명 + 회귀 방지.

import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  buildNodeData,
  canSwapTypes,
  getFlowPathBackward,
  getFlowPathForward,
  getNextNodeAlongFlow,
  getPrevNodeAlongFlow,
  hasCustomTerminalLabel,
  hasReciprocalEdge,
  insertNodeAfter,
  isCopyableNodeType,
  makeCopyLabel,
  normalizeNodeType,
  removeOutgoingEdges,
  swapNodeEdges,
  terminalDisplayLabel,
  violatesTerminalRule,
  type ProcessNodeType,
} from "@/lib/canvas";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

describe("violatesTerminalRule (source→target 방향)", () => {
  it("blocks connecting INTO a start node (start cannot receive)", () => {
    expect(violatesTerminalRule("process", "start")).toBe(true);
  });

  it("blocks connecting OUT OF an end node (end cannot send)", () => {
    expect(violatesTerminalRule("end", "process")).toBe(true);
  });

  it("allows start as source and end as target", () => {
    expect(violatesTerminalRule("start", "process")).toBe(false);
    expect(violatesTerminalRule("process", "end")).toBe(false);
  });

  it("allows plain process→process", () => {
    expect(violatesTerminalRule("process", "process")).toBe(false);
  });
});

describe("canSwapTypes (스왑 허용 규칙)", () => {
  it("allows same type", () => {
    expect(canSwapTypes("process", "process")).toBe(true);
    expect(canSwapTypes("decision", "decision")).toBe(true);
    expect(canSwapTypes("start", "start")).toBe(true);
    expect(canSwapTypes("end", "end")).toBe(true);
    expect(canSwapTypes("subprocess", "subprocess")).toBe(true);
  });

  it("allows subprocess ↔ plain process (both directions)", () => {
    expect(canSwapTypes("subprocess", "process")).toBe(true);
    expect(canSwapTypes("process", "subprocess")).toBe(true);
  });

  it("allows decision ↔ activity nodes (both directions)", () => {
    expect(canSwapTypes("process", "decision")).toBe(true);
    expect(canSwapTypes("decision", "process")).toBe(true);
    expect(canSwapTypes("subprocess", "decision")).toBe(true);
    expect(canSwapTypes("decision", "subprocess")).toBe(true);
  });

  it("blocks terminals against anything but their own kind", () => {
    expect(canSwapTypes("start", "end")).toBe(false);
    expect(canSwapTypes("subprocess", "start")).toBe(false);
    expect(canSwapTypes("process", "end")).toBe(false);
    expect(canSwapTypes("decision", "start")).toBe(false);
    expect(canSwapTypes("decision", "end")).toBe(false);
  });

  it("blocks when a type is missing", () => {
    expect(canSwapTypes(undefined, "process")).toBe(false);
    expect(canSwapTypes("process", undefined)).toBe(false);
  });
});

describe("swapNodeEdges (스왑 시 엣지 교환)", () => {
  const typeOf =
    (types: Record<string, ProcessNodeType>) =>
    (id: string): ProcessNodeType | undefined =>
      types[id];

  it("fully exchanges connections for same-kind nodes (기존 동작)", () => {
    const edges = [
      { id: "e1", source: "X", target: "A" },
      { id: "e2", source: "A", target: "Y" },
      { id: "e3", source: "W", target: "B" },
      { id: "e4", source: "B", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "A", "B", typeOf({ A: "process", B: "process" }));
    expect(result.map((e) => [e.source, e.target])).toEqual([
      ["X", "B"],
      ["B", "Y"],
      ["W", "A"],
      ["A", "Z"],
    ]);
  });

  it("decision↔process: 일반 노드는 decision 출력 1개만 가져가고 나머지는 라벨째 잔류", () => {
    const edges = [
      { id: "e0", source: "I", target: "D" },
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "J", target: "N" },
      { id: "e4", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }));
    expect(result.map((e) => [e.source, e.target, e.label ?? ""])).toEqual([
      ["I", "N", ""], // 입력은 전면 교환
      ["N", "X", "Yes"], // 첫 출력 1개만 일반 노드로(라벨 유지)
      ["D", "Y", "No"], // 나머지 분기는 decision에 라벨째 잔류
      ["J", "D", ""],
      ["D", "Z", ""], // 일반 노드의 출력은 decision이 그대로 넘겨받음
    ]);
    // 잔류 분기는 객체 동일성까지 유지(라벨·핸들 무변경)
    expect(result[2]).toBe(edges[2]);
  });

  it("decision↔process: 드래그 방향(a/b)이 바뀌어도 결과는 동일", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const types = typeOf({ D: "decision", N: "process" });
    const forward = swapNodeEdges(edges, "N", "D", types);
    const backward = swapNodeEdges(edges, "D", "N", types);
    expect(backward.map((e) => [e.source, e.target])).toEqual(
      forward.map((e) => [e.source, e.target]),
    );
    expect(forward.map((e) => [e.source, e.target])).toEqual([
      ["N", "X"],
      ["D", "Y"],
      ["D", "Z"],
    ]);
  });

  it("decision↔process: 둘을 직접 잇는 분기(D→N)가 있으면 그 엣지가 가져간 1개(추가 이관 없음)", () => {
    const edges = [
      { id: "e0", source: "I", target: "D" },
      { id: "e1", source: "D", target: "N", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }));
    expect(result.map((e) => [e.source, e.target, e.label ?? ""])).toEqual([
      ["I", "N", ""],
      ["N", "D", "Yes"], // 직접 연결은 끝점째 교환 → N의 유일한 출력
      ["D", "Y", "No"], // 다른 분기는 이관 없이 잔류
      ["D", "Z", ""],
    ]);
    // 일반 노드 출력은 정확히 1개
    expect(result.filter((e) => e.source === "N")).toHaveLength(1);
  });

  it("takenEdgeId 지정 시 그 출력선을 일반 노드가 가져간다(선택 모달 픽)", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }), "e2");
    expect(result.map((e) => [e.source, e.target, e.label ?? ""])).toEqual([
      ["D", "X", "Yes"], // 선택 안 된 분기는 라벨째 잔류
      ["N", "Y", "No"], // 지정한 출력선을 일반 노드가 가져감
      ["D", "Z", ""],
    ]);
  });

  it("takenEdgeId가 decision 출력이 아니면 첫 출력으로 폴백", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }), "e3");
    expect(result[0]).toMatchObject({ source: "N", target: "X" });
    expect(result[1]).toBe(edges[1]);
  });

  it("직접 분기(D→N)가 있으면 takenEdgeId를 무시하고 그 엣지가 가져간 1개(자기루프 방지)", () => {
    const edges = [
      { id: "e1", source: "D", target: "N", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }), "e2");
    expect(result.map((e) => [e.source, e.target])).toEqual([
      ["N", "D"],
      ["D", "Y"],
    ]);
  });

  it("decision↔subprocess: 끝점이 바뀐 엣지는 하위프로세스 전용 핸들로 재조정", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes", sourceHandle: "s-right" },
      { id: "e2", source: "D", target: "Y", label: "No", sourceHandle: "s-bottom" },
      { id: "e3", source: "S", target: "Z", sourceHandle: PRIMARY_END_HANDLE },
    ] as Edge[];
    const result = swapNodeEdges(edges, "S", "D", typeOf({ D: "decision", S: "subprocess" }));
    // 첫 분기를 가져간 subprocess는 대표끝 핸들, decision이 넘겨받은 출력은 변 기본값으로 복원
    expect(result[0]).toMatchObject({ source: "S", target: "X", sourceHandle: PRIMARY_END_HANDLE });
    expect(result[1]).toBe(edges[1]);
    expect(result[2]).toMatchObject({ source: "D", target: "Z", sourceHandle: "s-right" });
  });
});

describe("terminalDisplayLabel", () => {
  it("shows just Start/End for default or empty labels (any locale)", () => {
    expect(terminalDisplayLabel("start", "")).toBe("Start");
    expect(terminalDisplayLabel("start", "시작")).toBe("Start");
    expect(terminalDisplayLabel("start", "Start")).toBe("Start");
    expect(terminalDisplayLabel("end", "종료")).toBe("End");
    expect(terminalDisplayLabel("end", "End")).toBe("End");
  });

  it("appends a custom label in parentheses", () => {
    expect(terminalDisplayLabel("start", "검토 시작")).toBe("Start (검토 시작)");
    expect(terminalDisplayLabel("end", "승인 완료")).toBe("End (승인 완료)");
  });
});

describe("hasCustomTerminalLabel (터미널 필+제목 분리 렌더 판정)", () => {
  it("treats empty/default labels as non-custom (any locale, any case)", () => {
    expect(hasCustomTerminalLabel("")).toBe(false);
    expect(hasCustomTerminalLabel("  ")).toBe(false);
    expect(hasCustomTerminalLabel("Start")).toBe(false);
    expect(hasCustomTerminalLabel("END")).toBe(false);
    expect(hasCustomTerminalLabel("시작")).toBe(false);
    expect(hasCustomTerminalLabel("종료")).toBe(false);
  });

  it("detects user-authored labels", () => {
    expect(hasCustomTerminalLabel("검토 시작")).toBe(true);
    expect(hasCustomTerminalLabel("승인 완료")).toBe(true);
  });
});

describe("hasReciprocalEdge (prevents A↔B 2-node cycle)", () => {
  const edges = [{ id: "e1", source: "A", target: "B" }] as Edge[];

  it("detects that B→A would be reciprocal of existing A→B", () => {
    expect(hasReciprocalEdge(edges, "B", "A")).toBe(true);
  });

  it("allows a non-reciprocal edge A→C", () => {
    expect(hasReciprocalEdge(edges, "A", "C")).toBe(false);
  });

  it("withEdge (via insertNodeAfter) refuses to create the reverse edge", () => {
    // insertNodeAfter(edges, 'A', 'B') builds B→A, the reciprocal of A→B → rejected
    expect(insertNodeAfter(edges, "A", "B", false)).toHaveLength(1);
  });
});

describe("removeOutgoingEdges (single-output auto-swap)", () => {
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "C", target: "A" },
  ] as Edge[];

  it("drops every edge leaving the given source", () => {
    const next = removeOutgoingEdges(edges, "A");
    expect(next.map((e) => e.id)).toEqual(["e2"]); // A→B 제거, C→A 유지
  });

  it("returns the same edges when the source has no outgoing edge", () => {
    expect(removeOutgoingEdges(edges, "B")).toHaveLength(2);
  });
});

describe("flow stepper helpers (F14)", () => {
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
  ] as Edge[];

  it("getNextNodeAlongFlow follows the outgoing edge", () => {
    expect(getNextNodeAlongFlow(edges, "A")).toBe("B");
    expect(getNextNodeAlongFlow(edges, "C")).toBeNull(); // 끝 노드 → 없음
  });

  it("getPrevNodeAlongFlow follows the incoming edge", () => {
    expect(getPrevNodeAlongFlow(edges, "C")).toBe("B");
    expect(getPrevNodeAlongFlow(edges, "A")).toBeNull(); // 시작 노드 → 없음
  });
});

describe("flow path highlight (F14 — growing/shrinking)", () => {
  // A → B → C → D
  const edges = [
    { id: "e1", source: "A", target: "B" },
    { id: "e2", source: "B", target: "C" },
    { id: "e3", source: "C", target: "D" },
  ] as Edge[];

  it("getFlowPathForward returns N forward edges, stops at the end", () => {
    expect(getFlowPathForward(edges, "A", 1)).toEqual(["e1"]);
    expect(getFlowPathForward(edges, "A", 2)).toEqual(["e1", "e2"]);
    expect(getFlowPathForward(edges, "A", 99)).toEqual(["e1", "e2", "e3"]); // 끝에서 중단
  });

  it("getFlowPathBackward returns N backward edges, stops at the start", () => {
    expect(getFlowPathBackward(edges, "D", 1)).toEqual(["e3"]);
    expect(getFlowPathBackward(edges, "D", 2)).toEqual(["e3", "e2"]);
    expect(getFlowPathBackward(edges, "D", 99)).toEqual(["e3", "e2", "e1"]);
  });

  it("getFlowPathForward highlights all branches at a decision (F14)", () => {
    // D --yes--> Y, D --no--> N (분기) → 1홉에 두 분기 엣지 모두
    const branched = [
      { id: "b1", source: "D", target: "Y" },
      { id: "b2", source: "D", target: "N" },
    ] as Edge[];
    expect(getFlowPathForward(branched, "D", 1).sort()).toEqual(["b1", "b2"]);
  });

  it("stops on a cycle instead of looping forever", () => {
    const cyclic = [
      { id: "x", source: "A", target: "B" },
      { id: "y", source: "B", target: "A" },
    ] as Edge[];
    expect(getFlowPathForward(cyclic, "A", 99)).toEqual(["x"]); // A→B, then B→A revisits A → stop
  });
});

describe("isCopyableNodeType", () => {
  it("allows process, decision, end", () => {
    expect(isCopyableNodeType("process")).toBe(true);
    expect(isCopyableNodeType("decision")).toBe(true);
    expect(isCopyableNodeType("end")).toBe(true);
  });
  it("blocks start and subprocess", () => {
    expect(isCopyableNodeType("start")).toBe(false);
    expect(isCopyableNodeType("subprocess")).toBe(false);
  });
});

describe("normalizeNodeType (persisted node_type → live nodeType)", () => {
  it("recognizes section like subprocess (no fallback to process)", () => {
    expect(normalizeNodeType("section")).toBe("section");
    expect(normalizeNodeType("subprocess")).toBe("subprocess");
  });

  it("falls back to process for unknown/legacy values", () => {
    expect(normalizeNodeType("default")).toBe("process");
    expect(normalizeNodeType("bogus")).toBe("process");
  });
});

describe("makeCopyLabel", () => {
  it("appends (2) for a fresh copy", () => {
    expect(makeCopyLabel("새 단계", ["새 단계"])).toBe("새 단계 (2)");
  });
  it("increments an existing (n) suffix instead of nesting", () => {
    expect(makeCopyLabel("새 단계 (2)", ["새 단계", "새 단계 (2)"])).toBe("새 단계 (3)");
  });
  it("skips occupied numbers", () => {
    expect(makeCopyLabel("A", ["A", "A (2)", "A (3)"])).toBe("A (4)");
  });
});

describe("buildNodeData", () => {
  it("섹션 노드는 label=번호·nodeType=section·section_anchor를 갖고 기본필드가 모두 채워진다", () => {
    const d = buildNodeData("section", "6.1", { section_anchor: "_Toc9" });
    expect(d).toMatchObject({ label: "6.1", nodeType: "section", section_anchor: "_Toc9" });
    // 기본 파라미터 필드가 빠지지 않았는지(노드-속성 체크리스트) — 백엔드 소거 방지
    expect(d).toMatchObject({
      description: "", color: "", assignee: "", department: "", system: "",
      duration: "", cost_krw: "", cost_usd: "", headcount: "", annual_count: "", fte: "",
      groupIds: [], hasChildren: false,
    });
  });
  it("일반 노드는 section_anchor 없이 생성된다", () => {
    const d = buildNodeData("process", "Step");
    expect(d.nodeType).toBe("process");
    expect(d.label).toBe("Step");
    expect(d.section_anchor).toBeUndefined();
  });
});
