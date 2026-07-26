import { describe, expect, it } from "vitest";

import type { InterviewMessage, WorkingGraph } from "./api";
import {
  INTERVIEW_STAGES,
  addedNodeKeys,
  choiceOptionsOf,
  distinctiveNodeKeys,
  layoutWorkingGraph,
  stageIndex,
} from "./interview";

const GRAPH: WorkingGraph = {
  nodes: [
    { key: "s", title: "시작", node_type: "start", description: "", attributes: null, group_key: null },
    { key: "a", title: "요청서 작성", node_type: "process", description: "", attributes: null, group_key: null },
  ],
  edges: [{ source: "s", target: "a", label: "" }],
  groups: [],
};

function msg(over: Partial<InterviewMessage>): InterviewMessage {
  return {
    id: 1, seq: 1, role: "consultant", kind: "question", content: "",
    payload: null, stage: "scope", superseded: false, created_at: "2026-07-23T00:00:00+09:00",
    ...over,
  };
}

describe("INTERVIEW_STAGES", () => {
  it("고정 7단계 순서", () => {
    expect(INTERVIEW_STAGES.map((s) => s.key)).toEqual(
      ["scope", "io", "activities", "branches", "roles", "params", "review"],
    );
    expect(stageIndex("activities")).toBe(2);
  });
});

describe("choiceOptionsOf", () => {
  it("마지막 메시지가 choices일 때만 옵션 반환", () => {
    const options = [{ id: "opt-1", title: "표준안", summary: "", graph: GRAPH }];
    const withChoices = [msg({}), msg({ id: 2, seq: 2, kind: "choices", payload: { options } })];
    expect(choiceOptionsOf(withChoices)?.[0].id).toBe("opt-1");
    const answered = [...withChoices, msg({ id: 3, seq: 3, role: "user", kind: "choice" })];
    expect(choiceOptionsOf(answered)).toBeNull();
  });
});

describe("addedNodeKeys", () => {
  it("이전 대비 새 키만", () => {
    const next: WorkingGraph = { ...GRAPH, nodes: [...GRAPH.nodes, { key: "b", title: "검토", node_type: "process", description: "", attributes: null, group_key: null }] };
    expect(addedNodeKeys(GRAPH, next)).toEqual(new Set(["b"]));
    expect(addedNodeKeys(null, GRAPH)).toEqual(new Set());  // 첫 그래프는 전체 하이라이트 안 함
  });
});

describe("layoutWorkingGraph", () => {
  it("dagre 배치 후 좌표·diffStatus 부여", () => {
    const { nodes, edges } = layoutWorkingGraph(GRAPH, new Set(["a"]));
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
    const a = nodes.find((n) => n.id === "a");
    expect(a?.data.diffStatus).toBe("added");
    expect(typeof a?.position.x).toBe("number");
    expect(layoutWorkingGraph(null, new Set()).nodes).toHaveLength(0);
  });
});

describe("distinctiveNodeKeys", () => {
  const opt = (id: string, titles: string[]) => ({
    id, title: id, summary: "",
    graph: {
      nodes: titles.map((t, i) => ({
        key: `${id}-n${i}`, title: t, node_type: "process",
        description: "", attributes: null, group_key: null,
      })),
      edges: [], groups: [],
    },
  });

  it("모든 안에 공통인 제목은 제외, 다른 부분만 안별로 하이라이트", () => {
    const a = opt("opt-1", ["시작", "요청서 작성", "끝"]);
    const b = opt("opt-2", ["시작", "요청서 작성", "검토 승인", "끝"]);
    const keys = distinctiveNodeKeys([a, b]);
    expect(keys.get("opt-1")).toEqual(new Set());
    expect(keys.get("opt-2")).toEqual(new Set(["opt-2-n2"]));
  });

  it("단일 안이면 하이라이트 없음", () => {
    const a = opt("opt-1", ["시작", "끝"]);
    expect(distinctiveNodeKeys([a]).get("opt-1")).toEqual(new Set());
  });
});
