import { describe, expect, it } from "vitest";

import type { Graph, GraphNode, SubprocessRef } from "./api";
import { sumParamField } from "./param-sum";

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id, title: id, description: "", node_type: "process", color: "",
  assignee: "", department: "", system: "", duration: "",
  pos_x: 0, pos_y: 0, sort_order: 0, group_ids: [],
  linked_map_id: null, follow_latest: false, linked_version_id: null, is_primary_end: false,
  ...over,
});

// 노드 스펙 배열 → Graph. 스펙은 id 필수 + 오버라이드만 지정하면 나머지는 node() 기본값으로 채워진다.
const makeGraph = (
  specs: (Partial<GraphNode> & { id: string })[],
  refs: Graph["subprocess_refs"] = undefined,
): Graph => ({ nodes: specs.map((spec) => node(spec.id, spec)), edges: [], groups: [], subprocess_refs: refs });

const SP_REF_DEFAULTS: SubprocessRef = {
  designated: true, department: null, assignee: null, system: null, duration: null,
  cost_krw: null, cost_usd: null, headcount: null, url: null, url_label: null,
};
const spRef = (over: Partial<SubprocessRef> = {}): SubprocessRef => ({ ...SP_REF_DEFAULTS, ...over });

describe("sumParamField", () => {
  it("duration은 분 환산 캐리 합", () => {
    const g = makeGraph([node("a", { duration: "0.45" }), node("b", { duration: "0.30" })]);
    expect(sumParamField(g, "duration")).toBe("1.15");
  });
  it("subprocess 노드는 subprocess_refs의 sp값 사용", () => {
    const g = makeGraph(
      [node("a", { duration: "1" }), node("s", { node_type: "subprocess", linked_map_id: 7 })],
      { 7: spRef({ duration: "0.30" }) },
    );
    expect(sumParamField(g, "duration")).toBe("1.30");
  });
  it("십진수는 스케일 정수 합산 — 부동소수 오차 없음", () => {
    const g = makeGraph([node("a", { cost_krw: "0.1" }), node("b", { cost_krw: "0.2" })]);
    expect(sumParamField(g, "cost_krw")).toBe("0.3");
  });
  it("빈값·무효는 스킵", () => {
    const g = makeGraph([
      node("a", { cost_usd: "" }),
      node("b", { cost_usd: "abc" }),
      node("c", { cost_usd: "2.5" }),
    ]);
    expect(sumParamField(g, "cost_usd")).toBe("2.5");
  });
  it("기여값 0개면 빈 문자열", () => {
    expect(sumParamField(makeGraph([node("a")]), "cost_usd")).toBe("");
  });
  it("ref 없는 subprocess 노드는 스킵", () => {
    const g = makeGraph([node("s", { node_type: "subprocess", linked_map_id: 9 })]);
    expect(sumParamField(g, "duration")).toBe("");
  });

  it("비용은 원·달러를 각각 독립 합산한다", () => {
    const g = makeGraph([
      { id: "a", cost_krw: "1250000", cost_usd: "" },
      { id: "b", cost_krw: "380000", cost_usd: "" },
      { id: "c", cost_krw: "", cost_usd: "1200.50" },
    ]);
    expect(sumParamField(g, "cost_krw")).toBe("1630000");
    expect(sumParamField(g, "cost_usd")).toBe("1200.5");
  });

  it("인원은 값이 있는 노드의 평균 — 소수점 2자리", () => {
    const g = makeGraph([
      { id: "a", headcount: "2" },
      { id: "b", headcount: "1" },
      { id: "c", headcount: "" }, // 분모에서 제외
    ]);
    expect(sumParamField(g, "headcount")).toBe("1.50");
  });

  // 소수점 2자리가 실제 반올림·평균 계산을 거치는지 확인 — 정수 평균이면 우연히 통과하는 케이스를 배제
  it("인원 평균은 나눗셈이 딱 떨어지지 않아도 소수점 2자리로 반올림한다", () => {
    const g = makeGraph([
      { id: "a", headcount: "1" },
      { id: "b", headcount: "1" },
      { id: "c", headcount: "2" },
    ]);
    expect(sumParamField(g, "headcount")).toBe("1.33");
  });

  it("인원 평균은 서브프로세스 노드를 제외한다 (design §4)", () => {
    const g = makeGraph([
      { id: "a", headcount: "2" },
      { id: "b", headcount: "1" },
      { id: "sp", node_type: "subprocess", linked_map_id: 7 },
    ]);
    g.subprocess_refs = { 7: spRef({ headcount: "9", duration: "1", cost_krw: "500" }) };
    expect(sumParamField(g, "headcount")).toBe("1.50"); // SP 인원 9는 무시
    expect(sumParamField(g, "duration")).toBe("1");     // 소요시간·비용은 SP 포함
    expect(sumParamField(g, "cost_krw")).toBe("500");
  });

  it("기여값이 없으면 빈 문자열 — 0과 구분", () => {
    const g = makeGraph([{ id: "a", headcount: "" }]);
    expect(sumParamField(g, "headcount")).toBe("");
    expect(sumParamField(g, "cost_usd")).toBe("");
  });
});
