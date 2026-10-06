import { describe, expect, it } from "vitest";

import type { FlatNode, GraphEdge, VersionGraph } from "@/lib/api";
import { toEdgeObstacle } from "@/lib/edge-detour";
import {
  assignPreviewBackLanes,
  buildDiamondPoints,
  buildPreviewBackPoints,
  buildPreviewForwardPath,
  buildPreviewScene,
  computePreviewViewBox,
  getPreviewAnchor,
  getPreviewNodeSize,
  resolvePreviewSides,
  type PreviewBox,
} from "@/lib/preview-geometry";

const box = (x: number, y: number, w = 100, h = 40): PreviewBox => ({ x, y, w, h, cx: x + w / 2, cy: y + h / 2 });

function makeNode(id: string, x: number, y: number, extra: Partial<FlatNode> = {}): FlatNode {
  return {
    id,
    title: id,
    description: "",
    node_type: "process",
    color: "",
    assignee: "",
    department: "",
    system: "",
    duration: "",
    pos_x: x,
    pos_y: y,
    sort_order: 0,
    group_ids: [],
    linked_map_id: null,
    follow_latest: true,
    linked_version_id: null,
    is_primary_end: false,
    parent_node_id: null,
    source_node_id: null,
    ...extra,
  };
}

function makeEdge(id: string, source: string, target: string, extra: Partial<GraphEdge> = {}): GraphEdge {
  return {
    id,
    source_node_id: source,
    target_node_id: target,
    label: "",
    source_side: "right",
    target_side: "left",
    source_handle: null,
    target_handle: null,
    line_style: "",
    ...extra,
  };
}

// 경로 문자열의 모든 y 좌표 — "x,y" 쌍에서 뽑는다
function getPathYs(d: string): number[] {
  return [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[2]));
}

describe("buildDiamondPoints", () => {
  it("returns the four box-inscribed vertices top,right,bottom,left", () => {
    expect(buildDiamondPoints(10, 20, 100, 50)).toBe("60,20 110,45 60,70 10,45");
  });
});

describe("getPreviewNodeSize", () => {
  it("uses the saved subprocess width clamped to the editor grip range", () => {
    expect(getPreviewNodeSize({ node_type: "subprocess", title: "x", width: 200 }).w).toBe(200);
    expect(getPreviewNodeSize({ node_type: "subprocess", title: "x", width: 400 }).w).toBe(216);
    expect(getPreviewNodeSize({ node_type: "subprocess", title: "x", width: null }).w).toBe(180);
  });

  it("grows the height per explicit line break and stops at the max line count", () => {
    expect(getPreviewNodeSize({ node_type: "process", title: "a", width: null }).h).toBe(52);
    expect(getPreviewNodeSize({ node_type: "process", title: "a\nb", width: null }).h).toBe(72);
    expect(getPreviewNodeSize({ node_type: "process", title: "a\nb\nc\nd\ne", width: null }).h).toBe(92);
  });
});

describe("getPreviewAnchor / resolvePreviewSides", () => {
  it("anchors left/right on the title line for process nodes and mid-height otherwise", () => {
    expect(getPreviewAnchor({ ...box(0, 0, 100, 52), type: "process" }, "right")).toEqual({ x: 100, y: 18 });
    expect(getPreviewAnchor({ ...box(0, 0, 116, 96), type: "decision" }, "left")).toEqual({ x: 0, y: 48 });
    expect(getPreviewAnchor(box(0, 0), "bottom")).toEqual({ x: 50, y: 40 });
  });

  it("reads saved handles first, the in-door variant for subprocess targets, and the right exit for subprocess sources", () => {
    expect(resolvePreviewSides(makeEdge("e", "a", "b", { source_handle: "s-bottom", target_handle: "t-bottom" }), "process")).toEqual({ source: "bottom", target: "bottom" });
    expect(resolvePreviewSides(makeEdge("e", "a", "b", { target_handle: "in:top" }), "process")).toEqual({ source: "right", target: "top" });
    expect(resolvePreviewSides(makeEdge("e", "a", "b", { source_handle: "Reject", source_side: "bottom" }), "subprocess").source).toBe("right");
  });
});

describe("buildPreviewForwardPath", () => {
  it("drops a same-row skip edge into a lane below the row so it is not buried under the nodes it skips", () => {
    // A→D, B·C가 같은 줄 사이에 있다 — 기존 직선은 B·C 밑에 묻혀 순차 흐름처럼 보였다
    const a = { ...box(0, 0, 100, 52), type: "process" as const, id: "A" };
    const d = { ...box(600, 0, 100, 52), type: "process" as const, id: "D" };
    const obstacles = [a, box(200, 0, 100, 52), box(400, 0, 100, 52), d].map((b, i) => toEdgeObstacle(["A", "B", "C", "D"][i], b));
    const { d: path, points } = buildPreviewForwardPath(a, d, { source: "right", target: "left" }, "", obstacles);
    expect(points).not.toBeNull();
    expect(Math.max(...getPathYs(path))).toBeGreaterThan(52); // 노드 줄(0~52) 아래로 내려간다
  });

  it("keeps an unobstructed forward edge on the editor smoothstep path", () => {
    const { points } = buildPreviewForwardPath(box(0, 0), box(300, 0), { source: "right", target: "left" }, "smoothstep");
    expect(points).toBeNull();
  });

  it("honours a straight line style", () => {
    const { d } = buildPreviewForwardPath(box(0, 0), box(300, 0), { source: "right", target: "left" }, "straight");
    expect(d).toBe("M 100,20L 300,20");
  });
});

describe("buildPreviewBackPoints", () => {
  it("routes above both nodes with the 40px minimum rise and 10px per lane", () => {
    expect(buildPreviewBackPoints(box(400, 0), box(0, 0), false, 0)).toEqual([
      { x: 450, y: 0 }, { x: 450, y: -40 }, { x: 50, y: -40 }, { x: 50, y: 0 },
    ]);
    expect(buildPreviewBackPoints(box(400, 0), box(0, 0), false, 1)[1].y).toBe(-50);
  });

  it("routes below when the saved sides are bottom", () => {
    const points = buildPreviewBackPoints(box(400, 0), box(0, 0), true, 0);
    expect(points[0]).toEqual({ x: 450, y: 40 });
    expect(points[1].y).toBe(80);
  });

  it("lifts the corridor over a raised side branch between the endpoints", () => {
    // 사이에 위로 올라간 곁가지(y=-100) — 두 끝점만 보면 통로(y=-40)가 그 노드를 관통한다
    const branch = toEdgeObstacle("B", box(200, -100, 100, 52));
    const points = buildPreviewBackPoints({ ...box(400, 0), id: "S" }, { ...box(0, 0), id: "T" }, false, 0, [branch]);
    expect(points[1].y).toBeLessThan(-100 - 12);
  });
});

describe("assignPreviewBackLanes", () => {
  const edge = (id: string, source: string, target: string) => ({ id, source_node_id: source, target_node_id: target });

  it("same target: nearer source is the inner lane (rainbow); forward edges get no lane", () => {
    const centers = new Map([["T", box(0, 0)], ["M", box(300, 0)], ["N", box(600, 0)]]);
    const lanes = assignPreviewBackLanes([edge("m", "M", "T"), edge("n", "N", "T"), edge("f", "T", "M")], centers);
    expect(lanes.get("m")).toBe(0);
    expect(lanes.get("n")).toBe(1);
    expect(lanes.has("f")).toBe(false);
  });

  it("same source to two earlier targets: nearer target is inner; an edge in both groups takes the larger lane", () => {
    const centers = new Map([["A", box(0, 0)], ["B", box(300, 0)], ["S", box(600, 0)], ["R", box(900, 0)]]);
    const lanes = assignPreviewBackLanes([edge("sb", "S", "B"), edge("sa", "S", "A"), edge("rb", "R", "B")], centers);
    expect(lanes.get("sb")).toBe(0);
    expect(lanes.get("sa")).toBe(1);
    expect(lanes.get("rb")).toBe(1);
  });

  it("two back edges leaving the same source never share a lane even when the target groups agree", () => {
    const centers = new Map([["Y", box(-300, 0)], ["T", box(0, 0)], ["M", box(300, 0)], ["N", box(600, 0)]]);
    const lanes = assignPreviewBackLanes([edge("m", "M", "T"), edge("n", "N", "T"), edge("ny", "N", "Y")], centers);
    expect(lanes.get("n")).not.toBe(lanes.get("ny"));
    expect(lanes.get("m")).toBe(0);
  });

  it("uses the auto-layout back-edge threshold: a reject edge to a lower-left row is not a lane", () => {
    // flow-layout isBackEdge — |dy| ≥ 150이면 역행 통로가 아니다(전체 도식 위를 가로지르던 것)
    const centers = new Map([["S", box(600, 0)], ["T", box(0, 300)]]);
    expect(assignPreviewBackLanes([edge("r", "S", "T")], centers).has("r")).toBe(false);
  });
});

describe("buildPreviewScene", () => {
  const graphOf = (nodes: FlatNode[], edges: GraphEdge[]): VersionGraph => ({ nodes, edges });

  it("renders saved labels and mirrors subprocess end titles on unlabeled secondary exits", () => {
    const graph = graphOf(
      [
        makeNode("D", 0, 0, { node_type: "decision" }),
        makeNode("Y", 300, 0),
        makeNode("SP", 300, 200, { node_type: "subprocess" }),
        makeNode("R", 600, 300),
      ],
      [
        makeEdge("yes", "D", "Y", { label: "Yes" }),
        makeEdge("toSp", "D", "SP", { label: "No" }),
        makeEdge("rej", "SP", "R", { source_handle: "Reject" }),
      ],
    );
    const scene = buildPreviewScene(graph, null);
    const byId = new Map(scene?.edges.map((e) => [e.id, e]));
    expect(byId.get("yes")?.label).toBe("Yes");
    expect(byId.get("yes")?.stroke).toBe("var(--color-branch-yes)");
    expect(byId.get("rej")?.label).toBe("Reject");
    expect(byId.get("rej")?.mirrored).toBe(true);
    expect(byId.get("rej")?.labelStyle?.border).toContain("dashed");
  });

  it("extends the viewBox to cover a bottom back-edge lane", () => {
    const graph = graphOf(
      [makeNode("A", 0, 0), makeNode("B", 400, 0)],
      [makeEdge("ab", "A", "B"), makeEdge("ba", "B", "A", { source_side: "bottom", target_side: "bottom" })],
    );
    const vb = computePreviewViewBox(graph, null);
    // 아래 통로 = 노드 바닥 52 + 40 → 여백 16까지 담는다
    expect(vb && vb.y + vb.h).toBeGreaterThanOrEqual(52 + 40 + 16);
    expect(buildPreviewScene(graph, null)?.edges.find((e) => e.id === "ba")?.back).toBe(true);
  });

  it("returns null for an empty scope", () => {
    expect(buildPreviewScene(graphOf([makeNode("A", 0, 0, { parent_node_id: "host" })], []), null)).toBeNull();
  });
});
