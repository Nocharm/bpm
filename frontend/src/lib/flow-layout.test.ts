// lib/flow-layout 테스트 — 주 경로(최장 경로) 탐색·백본/곁가지 직선화·라벨 간격·영역 클러스터·부분 정렬·방향별 핸들 재지정.
import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import type { AppNode, ProcessNodeType } from "@/lib/canvas";
import { EDGE_LABEL_PAD_X, estimateEdgeLabelWidth, nodeSizeOf } from "@/lib/canvas";
import { autoLayoutFlow, autoLayoutSubsetFlow, findMainPath, inferFlowDir } from "@/lib/flow-layout";

function makeNode(
  id: string,
  nodeType: ProcessNodeType,
  extra: Partial<AppNode["data"]> = {},
): AppNode {
  return {
    id,
    type: "process",
    position: { x: 0, y: 0 },
    data: {
      label: id,
      description: "",
      nodeType,
      color: "",
      assignee: "",
      department: "",
      system: "",
      duration: "",
      groupIds: [],
      hasChildren: false,
      ...extra,
    },
  } as AppNode;
}

const makeEdge = (id: string, source: string, target: string): Edge => ({ id, source, target });

// 시작 → a → 끝(대표) 본류 + a에서 갈라지는 곁가지 b
const nodes = [
  makeNode("start", "start"),
  makeNode("a", "process"),
  makeNode("b", "process"),
  makeNode("end", "end", { isPrimaryEnd: true }),
];
const edges = [
  makeEdge("e1", "start", "a"),
  makeEdge("e2", "a", "end"),
  makeEdge("e3", "a", "b"),
];

const centerY = (node: AppNode) => node.position.y + nodeSizeOf(node.data.nodeType).h / 2;
const centerX = (node: AppNode) => node.position.x + nodeSizeOf(node.data.nodeType).w / 2;

describe("findMainPath", () => {
  it("returns the start→primary-end path, excluding side branches", () => {
    const path = findMainPath(nodes, edges);
    expect([...path].sort()).toEqual(["a", "end", "start"]);
  });

  it("returns empty when start or end is missing", () => {
    expect(findMainPath([makeNode("x", "process")], []).size).toBe(0);
  });
});

describe("autoLayoutFlow", () => {
  it("LR: main-path nodes snap to one horizontal backbone, branch pushed off", () => {
    const result = autoLayoutFlow(nodes, edges, "LR");
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const startY = centerY(byId.get("start") as AppNode);
    expect(Math.abs(centerY(byId.get("a") as AppNode) - startY)).toBeLessThan(1);
    expect(Math.abs(centerY(byId.get("end") as AppNode) - startY)).toBeLessThan(1);
    // 곁가지는 백본에서 이격
    expect(Math.abs(centerY(byId.get("b") as AppNode) - startY)).toBeGreaterThan(30);
  });

  it("TB: main-path nodes snap to one vertical backbone and handles flip to bottom→top", () => {
    const result = autoLayoutFlow(nodes, edges, "TB");
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const startX = centerX(byId.get("start") as AppNode);
    expect(Math.abs(centerX(byId.get("a") as AppNode) - startX)).toBeLessThan(1);
    expect(Math.abs(centerX(byId.get("end") as AppNode) - startX)).toBeLessThan(1);
    const mainEdge = result.edges.find((edge) => edge.id === "e2");
    expect(mainEdge?.sourceHandle).toBe("s-bottom");
    expect(mainEdge?.targetHandle).toBe("t-top");
  });

  it("LR: flow edges use right→left handles", () => {
    const result = autoLayoutFlow(nodes, edges, "LR");
    const mainEdge = result.edges.find((edge) => edge.id === "e1");
    expect(mainEdge?.sourceHandle).toBe("s-right");
    expect(mainEdge?.targetHandle).toBe("t-left");
  });

  it("subprocess target takes the picked side as an in-handle variant, subprocess source keeps its end key", () => {
    // TB에서는 하류 진입이 위 변 — 좌측 "in" 그대로면 자동정렬이 SP 타깃을 재지정하지 않은 것
    const asProcess = autoLayoutFlow([...nodes, makeNode("sub", "process")], [...edges, { id: "e4", source: "a", target: "sub" }], "TB");
    const pickedSide = asProcess.edges.find((edge) => edge.id === "e4")?.targetHandle?.replace(/^t-/, "");
    expect(pickedSide).not.toBe("left");
    const withSub = [...nodes, makeNode("sub", "subprocess")];
    const subEdge: Edge = { id: "e4", source: "a", target: "sub", targetHandle: "in" };
    const outEdge: Edge = { id: "e5", source: "sub", target: "c", sourceHandle: "반려" };
    const result = autoLayoutFlow(withSub, [...edges, subEdge, outEdge], "TB");
    const laidSubEdge = result.edges.find((edge) => edge.id === "e4");
    // 같은 자리의 일반 노드가 받았을 변을 들어오는 문 변형으로(left → "in")
    expect(laidSubEdge?.targetHandle).toBe(`in:${pickedSide}`);
    expect(laidSubEdge?.sourceHandle).toMatch(/^s-(top|bottom|right|left)$/);
    // 소스 끝(끝 키)은 보존
    expect(result.edges.find((edge) => edge.id === "e5")?.sourceHandle).toBe("반려");
  });
});

const labeled = (id: string, source: string, target: string, label: string): Edge => ({ id, source, target, label });
const byIdOf = (list: AppNode[]) => new Map(list.map((node) => [node.id, node]));
const pick = (list: AppNode[], id: string) => byIdOf(list).get(id) as AppNode;
const boxOf = (node: AppNode) => {
  const size = nodeSizeOf(node.data.nodeType);
  return { x1: node.position.x, y1: node.position.y, x2: node.position.x + size.w, y2: node.position.y + size.h };
};
const overlaps = (a: AppNode, b: AppNode) => {
  const p = boxOf(a);
  const q = boxOf(b);
  return p.x1 < q.x2 && p.x2 > q.x1 && p.y1 < q.y2 && p.y2 > q.y1;
};

// 시작 → a → D ─예→ b → c → d → 끝, D ─아니오→ 끝(반려 지름길)
const shortcutNodes = [
  makeNode("start", "start"),
  makeNode("a", "process"),
  makeNode("D", "decision"),
  makeNode("b", "process"),
  makeNode("c", "process"),
  makeNode("d", "process"),
  makeNode("end", "end", { isPrimaryEnd: true }),
];
const shortcutEdges = [
  makeEdge("1", "start", "a"),
  makeEdge("2", "a", "D"),
  labeled("3", "D", "b", "Yes"),
  makeEdge("4", "b", "c"),
  makeEdge("5", "c", "d"),
  makeEdge("6", "d", "end"),
  labeled("7", "D", "end", "No"),
];

// 시작 → D ─예→ y → 끝, D ─아니오→ n → 끝 (두 갈래 길이 같음)
const forkNodes = [
  makeNode("start", "start"),
  makeNode("D", "decision"),
  makeNode("y", "process"),
  makeNode("n", "process"),
  makeNode("end", "end", { isPrimaryEnd: true }),
];
const forkYes = labeled("y1", "D", "y", "Yes");
const forkNo = labeled("n1", "D", "n", "No");
const forkRest = [makeEdge("s", "start", "D"), makeEdge("ye", "y", "end"), makeEdge("ne", "n", "end")];

describe("findMainPath — longest forward path", () => {
  it("prefers the long real flow over a reject shortcut to the end", () => {
    const path = findMainPath(shortcutNodes, shortcutEdges);
    expect([...path].sort()).toEqual(["D", "a", "b", "c", "d", "end", "start"]);
  });

  it("breaks equal-length ties toward the yes branch, whatever the edge order", () => {
    const first = findMainPath(forkNodes, [forkRest[0], forkNo, forkYes, ...forkRest.slice(1)]);
    const second = findMainPath(forkNodes, [forkRest[0], forkYes, forkNo, ...forkRest.slice(1)]);
    expect(first.has("y")).toBe(true);
    expect(first.has("n")).toBe(false);
    expect([...second].sort()).toEqual([...first].sort());
  });

  it("accepts Korean approve labels as yes", () => {
    const edges = [forkRest[0], labeled("n1", "D", "n", "반려"), labeled("y1", "D", "y", "승인"), ...forkRest.slice(1)];
    expect(findMainPath(forkNodes, edges).has("y")).toBe(true);
  });

  it("ignores loop-back edges so a rework cycle does not become the path", () => {
    // 시작 → a → b → 끝, b → a 재작업 루프
    const loopNodes = [makeNode("start", "start"), makeNode("a", "process"), makeNode("b", "process"), makeNode("end", "end")];
    const loopEdges = [makeEdge("1", "start", "a"), makeEdge("2", "a", "b"), makeEdge("3", "b", "a"), makeEdge("4", "b", "end")];
    expect([...findMainPath(loopNodes, loopEdges)].sort()).toEqual(["a", "b", "end", "start"]);
  });
});

describe("autoLayoutFlow — layout quality", () => {
  it("keeps the long flow on the backbone and routes the shortcut under it", () => {
    const result = autoLayoutFlow(shortcutNodes, shortcutEdges, "LR");
    const line = centerY(pick(result.nodes, "start"));
    for (const id of ["a", "D", "b", "c", "d", "end"]) {
      expect(Math.abs(centerY(pick(result.nodes, id)) - line)).toBeLessThan(1);
    }
    const shortcut = result.edges.find((edge) => edge.id === "7");
    expect(shortcut?.sourceHandle).toBe("s-bottom");
    expect(shortcut?.targetHandle).toBe("t-bottom");
  });

  it("puts the yes branch above the no branch regardless of edge and node array order", () => {
    const first = autoLayoutFlow(forkNodes, [forkRest[0], forkYes, forkNo, ...forkRest.slice(1)], "LR");
    const second = autoLayoutFlow(forkNodes, [forkRest[0], forkNo, forkYes, ...forkRest.slice(1)], "LR");
    // 노드 나열 순서까지 뒤집어도 라벨이 위·아래를 정한다(파이썬 배리센터 동점 깨기와 같은 결과)
    const swapped = [forkNodes[0], forkNodes[1], forkNodes[3], forkNodes[2], forkNodes[4]];
    const third = autoLayoutFlow(swapped, [forkRest[0], forkNo, forkYes, ...forkRest.slice(1)], "LR");
    expect(centerY(pick(first.nodes, "y"))).toBeLessThan(centerY(pick(first.nodes, "n")));
    expect(centerY(pick(third.nodes, "y"))).toBeLessThan(centerY(pick(third.nodes, "n")));
    expect(first.nodes.map((node) => node.position)).toEqual(second.nodes.map((node) => node.position));
  });

  it("reserves room for a long branch label between ranks", () => {
    const label = "a long label that wraps at the max width";
    const nodes = [
      makeNode("start", "start"),
      makeNode("D", "decision"),
      makeNode("x", "process"),
      makeNode("y", "process"),
      makeNode("end", "end", { isPrimaryEnd: true }),
    ];
    const edges = [
      makeEdge("1", "start", "D"),
      labeled("2", "D", "x", label),
      labeled("3", "D", "y", "No"),
      makeEdge("4", "x", "end"),
      makeEdge("5", "y", "end"),
    ];
    const result = autoLayoutFlow(nodes, edges, "LR");
    const gap = boxOf(pick(result.nodes, "x")).x1 - boxOf(pick(result.nodes, "D")).x2;
    // 라벨 상자(추정폭 + 좌우 패딩) + 양옆 여백 20px
    expect(gap).toBeGreaterThanOrEqual(estimateEdgeLabelWidth(label) + EDGE_LABEL_PAD_X + 40);
    // 라벨 없는 구간은 기본 간격 그대로
    const plainGap = boxOf(pick(result.nodes, "D")).x1 - boxOf(pick(result.nodes, "start")).x2;
    expect(plainGap).toBeLessThan(gap);
  });

  it("straightens a side chain instead of stepping it column by column", () => {
    // 시작 → a → D ─예→ 끝, D ─아니오→ r1 → r2 → a(재작업 루프)
    const nodes = [
      makeNode("start", "start"),
      makeNode("a", "process"),
      makeNode("D", "decision"),
      makeNode("r1", "process"),
      makeNode("r2", "process"),
      makeNode("end", "end", { isPrimaryEnd: true }),
    ];
    const edges = [
      makeEdge("1", "start", "a"),
      makeEdge("2", "a", "D"),
      labeled("3", "D", "end", "Yes"),
      labeled("4", "D", "r1", "No"),
      makeEdge("5", "r1", "r2"),
      makeEdge("6", "r2", "a"),
    ];
    const result = autoLayoutFlow(nodes, edges, "LR");
    expect(Math.abs(centerY(pick(result.nodes, "r1")) - centerY(pick(result.nodes, "r2")))).toBeLessThan(1);
    expect(centerX(pick(result.nodes, "r1"))).toBeGreaterThan(centerX(pick(result.nodes, "D")));
  });

  it("drops edges whose ends are not on the canvas", () => {
    const result = autoLayoutFlow([makeNode("a", "process"), makeNode("b", "process")], [makeEdge("1", "a", "b"), makeEdge("2", "b", "ghost")], "LR");
    expect(centerX(pick(result.nodes, "b"))).toBeGreaterThan(centerX(pick(result.nodes, "a")));
  });

  it("keeps group members contiguous so a non-member does not sit inside the group box", () => {
    // 시작에서 세 갈래 — 영역 g = {a, c}. 영역 없이는 정규 순서대로 a, b, c가 쌓여 b가 a·c 사이에 낀다
    const groupNodes = [
      makeNode("start", "start"),
      makeNode("a", "process", { groupIds: ["g"] }),
      makeNode("b", "process"),
      makeNode("c", "process", { groupIds: ["g"] }),
    ];
    const groupEdges = [makeEdge("1", "start", "a"), makeEdge("2", "start", "b"), makeEdge("3", "start", "c")];
    const isInside = (nodes: AppNode[]) => {
      const members = [pick(nodes, "a"), pick(nodes, "c")].map(boxOf);
      const top = Math.min(...members.map((box) => box.y1));
      const bottom = Math.max(...members.map((box) => box.y2));
      const middle = centerY(pick(nodes, "b"));
      return middle > top && middle < bottom;
    };
    expect(isInside(autoLayoutFlow(groupNodes, groupEdges, "LR").nodes)).toBe(true);
    expect(isInside(autoLayoutFlow(groupNodes, groupEdges, "LR", { groups: [{ id: "g" }] }).nodes)).toBe(false);
  });

  it("survives nested and partially overlapping groups together with labels and loops", () => {
    const tangled = [
      makeNode("start", "start"),
      makeNode("a", "process", { groupIds: ["outer", "inner"] }),
      makeNode("D", "decision", { groupIds: ["outer", "inner", "side"] }),
      makeNode("b", "process", { groupIds: ["outer"] }),
      makeNode("c", "process", { groupIds: ["side"] }),
      makeNode("end", "end", { isPrimaryEnd: true }),
    ];
    const tangledEdges = [
      makeEdge("1", "start", "a"),
      makeEdge("2", "a", "D"),
      labeled("3", "D", "b", "Yes"),
      labeled("4", "D", "c", "아주 긴 반려 사유 라벨이 여기에 들어갑니다"),
      makeEdge("5", "c", "a"),
      makeEdge("6", "b", "end"),
    ];
    const groups = [{ id: "outer" }, { id: "inner" }, { id: "side" }];
    for (const dir of ["LR", "TB"] as const) {
      const result = autoLayoutFlow(tangled, tangledEdges, dir, { groups });
      for (const node of result.nodes) {
        expect(Number.isFinite(node.position.x) && Number.isFinite(node.position.y)).toBe(true);
      }
      for (const [i, first] of result.nodes.entries()) {
        for (const second of result.nodes.slice(i + 1)) expect(overlaps(first, second)).toBe(false);
      }
    }
  });

  it("preserveHandles keeps every edge handle (L5 canvas branch exits)", () => {
    const fanned: Edge[] = [
      { id: "e1", source: "start", target: "a", sourceHandle: "s-top", targetHandle: "t-bottom" },
      { id: "e2", source: "a", target: "end", sourceHandle: "s-bottom", targetHandle: "t-top" },
    ];
    const result = autoLayoutFlow(nodes, fanned, "LR", { preserveHandles: true });
    expect(result.edges).toEqual(fanned);
  });
});

describe("inferFlowDir", () => {
  it("reads TB from bottom→top handles and defaults to LR", () => {
    const tb = autoLayoutFlow(nodes, edges, "TB");
    expect(inferFlowDir(tb.edges)).toBe("TB");
    expect(inferFlowDir(autoLayoutFlow(nodes, edges, "LR").edges)).toBe("LR");
    expect(inferFlowDir([])).toBe("LR");
  });
});

describe("autoLayoutSubsetFlow", () => {
  const subsetNodes = () => {
    const list = [makeNode("a", "process"), makeNode("b", "process"), makeNode("c", "process"), makeNode("z", "process")];
    list[0].position = { x: 0, y: 0 };
    list[1].position = { x: 0, y: 100 };
    list[2].position = { x: 0, y: 200 };
    list[3].position = { x: 250, y: 0 }; // 선택 밖 이웃
    return list;
  };
  const subsetEdges: Edge[] = [
    { id: "1", source: "a", target: "b", sourceHandle: "s-bottom", targetHandle: "t-top" },
    { id: "2", source: "b", target: "c", sourceHandle: "s-bottom", targetHandle: "t-top" },
    { id: "3", source: "c", target: "z", sourceHandle: "s-bottom", targetHandle: "t-top" },
  ];

  it("pushes an unselected neighbour out of the re-laid block", () => {
    const result = autoLayoutSubsetFlow(subsetNodes(), subsetEdges, new Set(["a", "b", "c"]), "LR");
    const z = pick(result.nodes, "z");
    for (const id of ["a", "b", "c"]) expect(overlaps(pick(result.nodes, id), z)).toBe(false);
    // 블록 안 좌상단은 제자리
    expect(pick(result.nodes, "a").position).toEqual({ x: 0, y: 0 });
  });

  it("re-picks handles only for edges inside the selection", () => {
    const result = autoLayoutSubsetFlow(subsetNodes(), subsetEdges, new Set(["a", "b", "c"]), "LR");
    const inside = result.edges.find((edge) => edge.id === "1");
    expect([inside?.sourceHandle, inside?.targetHandle]).toEqual(["s-right", "t-left"]);
    const crossing = result.edges.find((edge) => edge.id === "3");
    expect([crossing?.sourceHandle, crossing?.targetHandle]).toEqual(["s-bottom", "t-top"]);
  });
});

describe("estimateEdgeLabelWidth (consultant_layout.estimate_label_width 동치)", () => {
  it("matches the Python estimate: CJK ~1em, widest logical line, clamped to the max width", () => {
    expect(estimateEdgeLabelWidth("")).toBe(0);
    expect(estimateEdgeLabelWidth("표준기 선정")).toBeCloseTo(5 * 11 + 3.5);
    expect(estimateEdgeLabelWidth("짧음\n아주 많이 긴 조건 문장입니다")).toBeGreaterThan(estimateEdgeLabelWidth("짧음"));
    expect(estimateEdgeLabelWidth("가".repeat(200))).toBe(160);
  });
});
