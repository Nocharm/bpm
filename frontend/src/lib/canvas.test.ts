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
  insertNodeBefore,
  isCopyableNodeType,
  makeCopyLabel,
  normalizeNodeType,
  removeOutgoingEdges,
  highlightEdgeLabel,
  sideFromHandleId,
  styleEdgeLabelPill,
  swapNodeEdges,
  terminalDisplayLabel,
  violatesTerminalRule,
  withSubprocessHandles,
  type ProcessNodeType,
} from "@/lib/canvas";
import { PRIMARY_END_HANDLE, SUBPROCESS_IN_HANDLE } from "@/lib/subprocess-embed";

describe("sideFromHandleId (하위프로세스 in 변형 포함)", () => {
  it("s-/t- 변 id와 in 변형을 변으로 읽고, 끝 키·null은 폴백", () => {
    expect(sideFromHandleId("t-top", "left")).toBe("top");
    expect(sideFromHandleId("in", "right")).toBe("left");
    expect(sideFromHandleId("in:bottom", "left")).toBe("bottom");
    expect(sideFromHandleId(PRIMARY_END_HANDLE, "right")).toBe("right");
    expect(sideFromHandleId("반려", "right")).toBe("right");
    expect(sideFromHandleId(null, "left")).toBe("left");
  });
});

describe("withSubprocessHandles (끝 키·in 변형 보존)", () => {
  const isSub = (id: string) => id.startsWith("S");

  it("SP 타깃: in 변형은 그대로, 변 id·없음은 in", () => {
    expect(withSubprocessHandles({ id: "e", source: "A", target: "S1", targetHandle: "in:top" } as Edge, isSub).targetHandle).toBe("in:top");
    expect(withSubprocessHandles({ id: "e", source: "A", target: "S1", targetHandle: "t-bottom" } as Edge, isSub).targetHandle).toBe(SUBPROCESS_IN_HANDLE);
    expect(withSubprocessHandles({ id: "e", source: "A", target: "S1" } as Edge, isSub).targetHandle).toBe(SUBPROCESS_IN_HANDLE);
  });

  it("SP 소스: 끝 키(대표·보조)는 그대로, 변 id·없음은 대표 끝", () => {
    expect(withSubprocessHandles({ id: "e", source: "S1", target: "B", sourceHandle: "반려" } as Edge, isSub).sourceHandle).toBe("반려");
    expect(withSubprocessHandles({ id: "e", source: "S1", target: "B", sourceHandle: PRIMARY_END_HANDLE } as Edge, isSub).sourceHandle).toBe(PRIMARY_END_HANDLE);
    expect(withSubprocessHandles({ id: "e", source: "S1", target: "B", sourceHandle: "s-right" } as Edge, isSub).sourceHandle).toBe(PRIMARY_END_HANDLE);
    expect(withSubprocessHandles({ id: "e", source: "S1", target: "B" } as Edge, isSub).sourceHandle).toBe(PRIMARY_END_HANDLE);
  });

  it("SP가 아니게 된 끝점(스왑): in 변형은 같은 변의 t-, 끝 키는 s-right로 복원", () => {
    expect(withSubprocessHandles({ id: "e", source: "A", target: "B", targetHandle: "in:top" } as Edge, isSub).targetHandle).toBe("t-top");
    expect(withSubprocessHandles({ id: "e", source: "A", target: "B", sourceHandle: "반려" } as Edge, isSub).sourceHandle).toBe("s-right");
    // 변경 없으면 같은 객체
    const same = { id: "e", source: "A", target: "B", sourceHandle: "s-bottom", targetHandle: "t-top" } as Edge;
    expect(withSubprocessHandles(same, isSub)).toBe(same);
  });
});

describe("insertNodeAfter / insertNodeBefore (하위프로세스 끝 한정)", () => {
  const edges = [
    { id: "p", source: "S", target: "X", sourceHandle: PRIMARY_END_HANDLE },
    { id: "r", source: "S", target: "Y", sourceHandle: "반려" },
  ] as Edge[];

  it("sourceHandle을 주면 그 끝의 엣지만 A로 옮기고 새 S→A 엣지도 그 끝에서 나간다", () => {
    const result = insertNodeAfter(edges, "A", "S", true, false, "반려");
    expect(result.find((e) => e.id === "p")).toBe(edges[0]);
    expect(result.find((e) => e.id === "r")).toMatchObject({ source: "A", target: "Y" });
    const fresh = result.find((e) => e.id !== "p" && e.id !== "r");
    expect(fresh).toMatchObject({ source: "S", target: "A", sourceHandle: "반려" });
  });

  it("sourceHandle 없이 호출하면 기존처럼 모든 출력을 옮긴다", () => {
    const result = insertNodeAfter(edges, "A", "S", true);
    expect(result.filter((e) => e.source === "A")).toHaveLength(2);
  });

  it("insertNodeBefore: 새 S→B 엣지가 지정한 끝에서 나가고, 다른 끝에서 같은 타깃으로 가는 엣지와 중복 판정하지 않는다", () => {
    const withPrimary = [{ id: "p", source: "S", target: "B", sourceHandle: PRIMARY_END_HANDLE }] as Edge[];
    const result = insertNodeBefore(withPrimary, "S", "B", false, "반려");
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ source: "S", target: "B", sourceHandle: "반려" });
    // 같은 끝에서 같은 타깃은 중복 → 추가 없음
    expect(insertNodeBefore(withPrimary, "S", "B", false, PRIMARY_END_HANDLE)).toHaveLength(1);
  });
});

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

  it("pairs: 짝지은 출력은 가는 곳(타깃·타깃 핸들)만 서로 바꾸고 라벨·소스 핸들은 노드에 남는다", () => {
    const edges = [
      { id: "e0", source: "I", target: "D" },
      { id: "e1", source: "D", target: "X", label: "Yes", sourceHandle: "s-right", targetHandle: "t-left" },
      { id: "e2", source: "D", target: "Y", label: "No", sourceHandle: "s-bottom" },
      { id: "e3", source: "J", target: "N" },
      { id: "e4", source: "N", target: "S2", sourceHandle: "s-right", targetHandle: SUBPROCESS_IN_HANDLE },
    ] as Edge[];
    const result = swapNodeEdges(
      edges,
      "N",
      "D",
      typeOf({ D: "decision", N: "process", S2: "subprocess" }),
      [["e4", "e1"]],
    );
    expect(result.map((e) => [e.source, e.target, e.label ?? "", e.sourceHandle ?? "", e.targetHandle ?? ""])).toEqual([
      ["I", "N", "", "", ""], // 입력은 전면 교환
      ["D", "S2", "Yes", "s-right", SUBPROCESS_IN_HANDLE], // Yes는 분기에 남고 가는 곳만 N의 타깃으로(타깃 핸들 동반)
      ["D", "Y", "No", "s-bottom", ""], // 짝 없는 출력은 그대로
      ["J", "D", "", "", ""],
      ["N", "X", "", "s-right", "t-left"], // N의 출력은 Yes가 가던 곳으로
    ]);
    expect(result[2]).toBe(edges[2]);
  });

  it("pairs []: 입력만 교환되고 출력은 전부 제자리(모두 남김)", () => {
    const edges = [
      { id: "e0", source: "I", target: "D" },
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "J", target: "N" },
      { id: "e4", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }), []);
    expect(result.map((e) => [e.source, e.target])).toEqual([
      ["I", "N"],
      ["D", "X"],
      ["D", "Y"],
      ["J", "D"],
      ["N", "Z"],
    ]);
    expect(result[1]).toBe(edges[1]);
  });

  it("pairs: 드래그 방향(a/b)이 바뀌어도 결과는 동일", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const types = typeOf({ D: "decision", N: "process" });
    const forward = swapNodeEdges(edges, "N", "D", types, [["e3", "e1"]]);
    const backward = swapNodeEdges(edges, "D", "N", types, [["e1", "e3"]]);
    expect(backward.map((e) => [e.source, e.target])).toEqual(forward.map((e) => [e.source, e.target]));
    expect(forward.map((e) => [e.source, e.target])).toEqual([
      ["D", "Z"],
      ["D", "Y"],
      ["N", "X"],
    ]);
  });

  it("pairs: 둘을 직접 잇는 엣지(D→N)는 끝점째 교환되고 짝 대상이 아니다(짝에 넣어도 무시), 나머지 출력은 짝 규칙", () => {
    const edges = [
      { id: "e0", source: "I", target: "D" },
      { id: "e1", source: "D", target: "N", label: "Yes" },
      { id: "e2", source: "D", target: "Y", label: "No" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const types = typeOf({ D: "decision", N: "process" });
    const kept = swapNodeEdges(edges, "N", "D", types, []);
    expect(kept.map((e) => [e.source, e.target, e.label ?? ""])).toEqual([
      ["I", "N", ""],
      ["N", "D", "Yes"], // 직접 연결은 끝점째 교환
      ["D", "Y", "No"], // 짝 없는 출력은 잔류
      ["N", "Z", ""],
    ]);
    const paired = swapNodeEdges(edges, "N", "D", types, [["e3", "e2"]]);
    expect(paired.map((e) => [e.source, e.target, e.label ?? ""])).toEqual([
      ["I", "N", ""],
      ["N", "D", "Yes"],
      ["D", "Z", "No"], // No는 분기에 남고 가는 곳만 N의 타깃으로
      ["N", "Y", ""],
    ]);
    // 직접 엣지를 짝에 넣으면 그 짝만 무시(자기루프 방지)
    expect(swapNodeEdges(edges, "N", "D", types, [["e3", "e1"]])).toEqual(kept);
  });

  it("pairs: 짝에 모르는 id가 섞이면 그 짝만 무시", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes" },
      { id: "e3", source: "N", target: "Z" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "D", typeOf({ D: "decision", N: "process" }), [["e3", "nope"]]);
    expect(result.map((e) => [e.source, e.target])).toEqual([
      ["D", "X"],
      ["N", "Z"],
    ]);
  });

  it("subprocess↔decision: 짝지은 끝 엣지는 끝 키를 유지한 채 타깃만 바뀌고, 끝점이 바뀐 직접 엣지는 전용 핸들로 재조정", () => {
    const edges = [
      { id: "e1", source: "D", target: "X", label: "Yes", sourceHandle: "s-right" },
      { id: "e2", source: "D", target: "Y", label: "No", sourceHandle: "s-bottom" },
      { id: "e3", source: "S", target: "Z", sourceHandle: PRIMARY_END_HANDLE },
      { id: "e4", source: "S", target: "W", sourceHandle: "반려" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "S", "D", typeOf({ D: "decision", S: "subprocess" }), [["e4", "e1"]]);
    expect(result[0]).toMatchObject({ source: "D", target: "W", sourceHandle: "s-right" });
    expect(result[1]).toBe(edges[1]);
    expect(result[2]).toBe(edges[2]);
    expect(result[3]).toMatchObject({ source: "S", target: "X", sourceHandle: "반려" });
  });

  it("pairs 미지정 + 직접 엣지(S→N): S가 SP가 아닌 노드로 들어가는 쪽은 변 핸들로, SP로 들어오는 쪽은 in", () => {
    const edges = [
      { id: "e1", source: "S", target: "N", sourceHandle: PRIMARY_END_HANDLE, targetHandle: "t-left" },
      { id: "e2", source: "N", target: "Z", sourceHandle: "s-right" },
    ] as Edge[];
    const result = swapNodeEdges(edges, "N", "S", typeOf({ S: "subprocess", N: "process" }));
    expect(result[0]).toMatchObject({ source: "N", target: "S", sourceHandle: "s-right", targetHandle: SUBPROCESS_IN_HANDLE });
    expect(result[1]).toMatchObject({ source: "S", target: "Z", sourceHandle: PRIMARY_END_HANDLE });
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

  it("sourceHandle을 주면 그 끝에서 나가는 엣지만 제거(하위프로세스 끝당 교체)", () => {
    const ends = [
      { id: "p", source: "S", target: "X", sourceHandle: PRIMARY_END_HANDLE },
      { id: "r", source: "S", target: "Y", sourceHandle: "반려" },
      { id: "o", source: "O", target: "S" },
    ] as Edge[];
    expect(removeOutgoingEdges(ends, "S", "반려").map((e) => e.id)).toEqual(["p", "o"]);
    expect(removeOutgoingEdges(ends, "S").map((e) => e.id)).toEqual(["o"]);
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

describe("flow path highlight (F14 - growing/shrinking)", () => {
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
  it("recognizes subprocess (no fallback to process)", () => {
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
  it("extra로 특화 필드를 덮어쓰고 기본필드가 모두 채워진다", () => {
    const d = buildNodeData("process", "6.1", { url: "https://x" });
    expect(d).toMatchObject({ label: "6.1", nodeType: "process", url: "https://x" });
    // 기본 파라미터 필드가 빠지지 않았는지(노드-속성 체크리스트) — 백엔드 소거 방지
    expect(d).toMatchObject({
      description: "", color: "", assignee: "", department: "", system: "",
      duration: "", cost_krw: "", cost_usd: "", headcount: "", annual_count: "", fte: "",
      groupIds: [], hasChildren: false,
    });
  });
  it("일반 노드는 label·nodeType이 그대로 생성된다", () => {
    const d = buildNodeData("process", "Step");
    expect(d.nodeType).toBe("process");
    expect(d.label).toBe("Step");
  });
});

describe("styleEdgeLabelPill", () => {
  it("라벨 없는 엣지는 그대로 통과", () => {
    const edge = { id: "e1", source: "a", target: "b" } as Edge;
    expect(styleEdgeLabelPill(edge)).toBe(edge);
  });
  it("라벨 엣지는 알약 스타일(labelStyle·bg·패딩)을 받는다", () => {
    const edge = { id: "e1", source: "a", target: "b", label: "custom" } as Edge;
    const styled = styleEdgeLabelPill(edge);
    expect(styled.labelStyle).toMatchObject({ fontSize: 11, fontWeight: 600 });
    expect(styled.labelBgStyle).toMatchObject({ fill: "var(--color-surface)" });
    expect(styled.labelBgPadding).toEqual([6, 3]);
    expect(styled.labelBgBorderRadius).toBe(6);
    expect(styled.style?.stroke).toBeUndefined(); // 기타 라벨은 선 색 미변경
  });
  it("Yes/No 분기는 파스텔 선·마커·라벨 배경 파생", () => {
    const yes = styleEdgeLabelPill({ id: "e1", source: "a", target: "b", label: "Yes" } as Edge);
    expect(yes.style?.stroke).toBe("var(--color-branch-yes)");
    expect(yes.labelBgStyle?.stroke).toBe("var(--color-branch-yes)");
    const no = styleEdgeLabelPill({ id: "e2", source: "a", target: "b", label: "No" } as Edge);
    expect(no.style?.stroke).toBe("var(--color-branch-no)");
  });
  it("기존 style은 보존하고 덧입힌다", () => {
    const styled = styleEdgeLabelPill({
      id: "e1",
      source: "a",
      target: "b",
      label: "Yes",
      style: { strokeDasharray: "6 3" },
    } as Edge);
    expect(styled.style?.strokeDasharray).toBe("6 3");
    expect(styled.style?.stroke).toBe("var(--color-branch-yes)");
  });
});

describe("highlightEdgeLabel", () => {
  const labeled = () =>
    styleEdgeLabelPill({ id: "e1", source: "a", target: "b", label: "custom" } as Edge);
  it("라벨 없는 엣지는 그대로 통과", () => {
    const edge = { id: "e1", source: "a", target: "b" } as Edge;
    expect(highlightEdgeLabel(edge, "selected")).toBe(edge);
  });
  it("선택: 글자·테두리 edge-selected, 12% 틴트 배경, 링", () => {
    const out = highlightEdgeLabel(labeled(), "selected");
    expect(out.labelStyle).toMatchObject({ fill: "var(--color-edge-selected)", fontSize: 11 });
    expect(out.labelBgStyle).toMatchObject({
      fill: "color-mix(in srgb, var(--color-edge-selected) 12%, white)",
      stroke: "var(--color-edge-selected)",
    });
    expect(out.labelBgStyle?.boxShadow).toContain("var(--color-edge-selected)");
  });
  it("in/out: 선 색과 같은 색으로 글자·테두리·틴트, 링 없음", () => {
    const inn = highlightEdgeLabel(labeled(), "in");
    expect(inn.labelStyle?.fill).toBe("var(--color-edge-in)");
    expect(inn.labelBgStyle?.stroke).toBe("var(--color-edge-in)");
    expect(inn.labelBgStyle?.boxShadow).toBeUndefined();
    const out = highlightEdgeLabel(labeled(), "out");
    expect(out.labelStyle?.fill).toBe("var(--color-edge-out)");
    expect(out.labelBgStyle?.fill).toBe("color-mix(in srgb, var(--color-edge-out) 12%, white)");
  });
  it("Yes/No 파스텔 라벨도 하이라이트 색이 덮는다(선과 동일 규칙)", () => {
    const yes = styleEdgeLabelPill({ id: "e1", source: "a", target: "b", label: "Yes" } as Edge);
    const out = highlightEdgeLabel(yes, "out");
    expect(out.labelBgStyle?.stroke).toBe("var(--color-edge-out)");
    expect(out.style?.stroke).toBe("var(--color-branch-yes)"); // 선 색은 호출자(applyFlowHighlight) 담당
  });
});
