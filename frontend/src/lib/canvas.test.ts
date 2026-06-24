// canvas 순수 헬퍼 단위 테스트 — 시작/끝 연결 규칙 + 터미널 표시명 + 회귀 방지.

import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import {
  hasReciprocalEdge,
  insertNodeAfter,
  removeOutgoingEdges,
  terminalDisplayLabel,
  violatesTerminalRule,
} from "@/lib/canvas";

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
