// 연결선 전달물 계약 — 명시 링크의 흐름 경로 투영(직접·경유), 서브프로세스 같은 이름 매칭, 역행·무경로 제외
import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { SubprocessRef } from "@/lib/api";
import { buildEdgeCarry } from "@/lib/edge-carry";
import type { IoNode, SpRefMap } from "@/lib/io-items";

function makeNode(id: string, data: Partial<IoNode["data"]> = {}): IoNode {
  return { id, data: { label: id.toUpperCase(), nodeType: "process", ...data } };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

const NO_REFS: SpRefMap = new Map();

describe("buildEdgeCarry - 명시 링크", () => {
  // A(원본 구매요청서) → D → T(미러)
  const nodes = [
    makeNode("a", { output: "구매요청서", output_ids: "io1" }),
    makeNode("d"),
    makeNode("t", { input: "구매요청서", input_links: "io1" }),
  ];
  const edges = [makeEdge("a", "d"), makeEdge("d", "t")];

  it("원본 다음 엣지는 직접, 그 뒤 엣지는 경유", () => {
    const carry = buildEdgeCarry(nodes, edges, NO_REFS);
    expect(carry.get("a-d")).toEqual([
      { key: "io1", text: "구매요청서", originId: "a", originLabel: "A", via: false },
    ]);
    expect(carry.get("d-t")?.[0]).toMatchObject({ text: "구매요청서", originLabel: "A", via: true });
  });

  it("흐름상 뒤에서 앞으로 가는 링크(경로 없음)는 싣지 않는다", () => {
    const carry = buildEdgeCarry(nodes, [makeEdge("t", "d"), makeEdge("d", "a")], NO_REFS);
    expect(carry.size).toBe(0);
  });

  it("직접 항목이 경유 항목보다 앞에 온다", () => {
    const withOwn = [
      ...nodes.slice(0, 1),
      makeNode("d", { output: "판정 결과", output_ids: "io2" }),
      makeNode("t", { input: "구매요청서\n판정 결과", input_links: "io1\nio2" }),
    ];
    const items = buildEdgeCarry(withOwn, edges, NO_REFS).get("d-t") ?? [];
    expect(items.map((item) => [item.text, item.via])).toEqual([
      ["판정 결과", false],
      ["구매요청서", true],
    ]);
  });
});

describe("buildEdgeCarry - 서브프로세스 같은 이름 매칭", () => {
  const refs: SpRefMap = new Map([
    [7, { designated: true, input: "견적서", output: "재무 의견서" } as unknown as SubprocessRef],
  ]);

  it("SP 입력은 앞쪽에서 같은 이름을 내는 가장 가까운 노드와 잇는다", () => {
    const nodes = [
      makeNode("a", { output: "견적서" }),
      makeNode("b", { output: "견적서" }),
      makeNode("s", { nodeType: "subprocess", linkedMapId: 7 }),
    ];
    const edges = [makeEdge("a", "b"), makeEdge("b", "s")];
    const carry = buildEdgeCarry(nodes, edges, refs);
    expect(carry.get("b-s")?.[0]).toMatchObject({ text: "견적서", originId: "b", via: false });
    expect(carry.has("a-b")).toBe(false);
  });

  it("SP 출력은 뒤쪽에서 같은 이름을 받는 노드와 잇고, 명시 링크가 걸린 입력 줄은 건너뛴다", () => {
    const nodes = [
      makeNode("s", { nodeType: "subprocess", linkedMapId: 7 }),
      makeNode("c", { input: "재무 의견서" }),
      makeNode("e", { input: "재무 의견서", input_links: "other" }),
    ];
    const edges = [makeEdge("s", "c"), makeEdge("s", "e")];
    const carry = buildEdgeCarry(nodes, edges, refs);
    expect(carry.get("s-c")?.[0]).toMatchObject({ text: "재무 의견서", originLabel: "S", via: false });
    expect(carry.has("s-e")).toBe(false);
  });

  it("지정되지 않은 SP는 매칭하지 않는다", () => {
    const undesignated: SpRefMap = new Map([[7, { designated: false } as unknown as SubprocessRef]]);
    const nodes = [makeNode("a", { output: "견적서" }), makeNode("s", { nodeType: "subprocess", linkedMapId: 7 })];
    expect(buildEdgeCarry(nodes, [makeEdge("a", "s")], undesignated).size).toBe(0);
  });
});
