import { describe, expect, it } from "vitest";

import type { InterviewMessage, WorkingGraph } from "./api";
import {
  INTERVIEW_STAGES,
  WORD_INTERVIEW_STAGES,
  addedNodeKeys,
  choiceOptionsOf,
  deriveOutline,
  deriveParamsEditorRows,
  deriveParamsTable,
  deriveSequencePreview,
  diffFromCurrentKeys,
  getGraphSignature,
  highlightConnectedEdges,
  layoutWorkingGraph,
  stageIndex,
  stagesForMode,
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
      ["scope", "io", "activities", "branches", "roles", "review"],
    );
    expect(stageIndex("activities")).toBe(2);
  });
});

describe("stagesForMode", () => {
  it("returns the word 3-stage set for word mode, 7-stage otherwise", () => {
    expect(stagesForMode("word").map((s) => s.key)).toEqual(["scope", "draft", "review"]);
    expect(stagesForMode(undefined)).toBe(INTERVIEW_STAGES);
    expect(WORD_INTERVIEW_STAGES).toHaveLength(3);
  });

  it("stageIndex is mode-aware", () => {
    expect(stageIndex("review", "word")).toBe(2);
    expect(stageIndex("review")).toBe(5); // params 제외(2026-07-28) — 일반 6단계
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

describe("highlightConnectedEdges", () => {
  const edges = [
    { id: "e1", source: "a", target: "b" },
    { id: "e2", source: "b", target: "c" },
    { id: "e3", source: "c", target: "d" },
  ];

  it("포커스 노드에 닿는 엣지만 액센트 스타일 (2026-07-30)", () => {
    const out = highlightConnectedEdges(edges, new Set(["b"]));
    expect(out[0].style?.stroke).toBe("var(--color-accent)");
    expect(out[1].style?.stroke).toBe("var(--color-accent)");
    expect(out[2].style).toBeUndefined();
  });

  it("빈 키셋이면 원본 배열 그대로", () => {
    expect(highlightConnectedEdges(edges, new Set())).toBe(edges);
  });
});

describe("diffFromCurrentKeys", () => {
  const node = (key: string, title: string, description = "") => ({
    key, title, node_type: "process", description, attributes: null, group_key: null,
  });
  const current: WorkingGraph = { nodes: [node("c1", "요청서 작성", "기존 설명")], edges: [], groups: [] };

  it("새 제목=added, 같은 제목·설명 변경=changed, 동일 내용은 무표시 (2026-07-30)", () => {
    const option: WorkingGraph = {
      nodes: [
        node("k1", "요청서 작성", "기존 설명"),
        node("k2", "요청서 작성 ", "새 설명 / New description"),
        node("k3", "견적 비교"),
      ],
      edges: [], groups: [],
    };
    const diff = diffFromCurrentKeys(option, current);
    expect(diff.added).toEqual(new Set(["k3"]));
    expect(diff.changed).toEqual(new Set(["k2"]));
  });

  it("현재 맵이 없으면 전부 added", () => {
    const option: WorkingGraph = { nodes: [node("k1", "A")], edges: [], groups: [] };
    expect(diffFromCurrentKeys(option, null).added).toEqual(new Set(["k1"]));
  });
});

describe("deriveOutline (speed redesign — facts 수집 패널)", () => {
  it("flattens facts in stage order with clamped one-line values", () => {
    const outline = deriveOutline({
      io: { trigger: "요청 접수", inputs: "" },
      scope: { process_name: "구매", purpose: "표준화" },
    });
    expect(outline.map((e) => e.stage)).toEqual(["scope", "io"]); // 스테이지 순서 우선
    expect(outline[0].items).toEqual([
      ["process_name", "구매"],
      ["purpose", "표준화"],
    ]);
    expect(outline[1].items).toEqual([["trigger", "요청 접수"]]); // 빈 값 제외
  });

  it("joins array values and clamps long ones", () => {
    const outline = deriveOutline({ activities: { activities: ["요청", "비교", "발주"] } });
    expect(outline[0].items[0][1]).toBe("요청 · 비교 · 발주");
    const long = deriveOutline({ scope: { purpose: "가".repeat(80) } });
    expect(long[0].items[0][1].length).toBeLessThanOrEqual(60);
    expect(long[0].items[0][1].endsWith("…")).toBe(true);
  });

  it("returns empty for null facts", () => {
    expect(deriveOutline(null)).toEqual([]);
  });
});

describe("deriveSequencePreview", () => {
  it("prefers array values from activities facts", () => {
    expect(deriveSequencePreview({ activities: { activities: ["A", "B", "C"] } }))
      .toEqual(["A", "B", "C"]);
  });

  it("falls back to separator strings and caps at 8", () => {
    expect(deriveSequencePreview({ activities: { activities: "요청 → 비교 → 발주" } }))
      .toEqual(["요청", "비교", "발주"]);
    const many = Array.from({ length: 12 }, (_, i) => `단계${i}`).join(", ");
    expect(deriveSequencePreview({ activities: { activities: many } })).toHaveLength(8);
  });

  it("returns empty without activities facts", () => {
    expect(deriveSequencePreview({ scope: { process_name: "구매" } })).toEqual([]);
  });
});

describe("deriveParamsTable (params 표 확정 흐름)", () => {
  it("keeps only known param fields with non-empty values", () => {
    const rows = deriveParamsTable({
      params: { params_table: {
        "요청서 작성": { duration: "0.30", headcount: 2, note: "무시", cost_krw: "" },
        "빈 활동": { duration: "" },
      } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].activity).toBe("요청서 작성");
    expect(rows[0].values).toEqual({ duration: "0.30", headcount: "2" });
  });

  it("returns empty without params_table", () => {
    expect(deriveParamsTable({ params: { params_done: "yes" } })).toEqual([]);
    expect(deriveParamsTable(null)).toEqual([]);
  });
});

describe("getGraphSignature", () => {
  const base = (): WorkingGraph => ({
    nodes: [
      { key: "s", title: "시작", node_type: "start", description: "", attributes: null, group_key: null },
      { key: "a", title: "요청서 작성", node_type: "process", description: "", attributes: null, group_key: null },
    ],
    edges: [{ source: "s", target: "a", label: "" }],
    groups: [],
  });

  it("설명·attributes 차이는 같은 서명 — 텍스트 턴마다 카메라를 뺏지 않는다 (T12)", () => {
    const changed = base();
    changed.nodes[1] = { ...changed.nodes[1], description: "설명 추가", attributes: { duration: "0.30" } };
    expect(getGraphSignature(changed)).toBe(getGraphSignature(base()));
  });

  it("제목·엣지 변경은 다른 서명 — 구조 변화만 fitView", () => {
    const renamed = base();
    renamed.nodes[1] = { ...renamed.nodes[1], title: "Draft request" };
    expect(getGraphSignature(renamed)).not.toBe(getGraphSignature(base()));
    const rewired = base();
    rewired.edges = [{ source: "a", target: "s", label: "" }];
    expect(getGraphSignature(rewired)).not.toBe(getGraphSignature(base()));
    expect(getGraphSignature(null)).toBe("");
  });
});

describe("deriveParamsEditorRows", () => {
  const graph: WorkingGraph = {
    nodes: [
      { key: "s", title: "시작", node_type: "start", description: "", attributes: null, group_key: null },
      { key: "a", title: "요청서 작성", node_type: "process", description: "", attributes: null, group_key: null },
      { key: "b", title: "견적 비교", node_type: "process", description: "", attributes: null, group_key: null },
      { key: "e", title: "끝", node_type: "end", description: "", attributes: null, group_key: null },
    ],
    edges: [],
    groups: [],
  };

  it("작업본의 모든 활동을 나열 — 수집 없는 노드도 빈 값으로 편집 가능 (2026-07-30)", () => {
    const rows = deriveParamsEditorRows(graph, { params: { params_table: { "요청서 작성": { duration: "0.30" } } } });
    expect(rows.map((r) => r.activity)).toEqual(["요청서 작성", "견적 비교"]);
    expect(rows[0].values.duration).toBe("0.30");
    expect(rows[1].values).toEqual({});
  });

  it("맵에 없는 수집 항목(제목 불일치)은 뒤에 유지", () => {
    const rows = deriveParamsEditorRows(graph, { params: { params_table: { "옛 활동": { fte: "1" } } } });
    expect(rows.map((r) => r.activity)).toEqual(["요청서 작성", "견적 비교", "옛 활동"]);
  });
});
