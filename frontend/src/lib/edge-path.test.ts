// edge-path 계약 — 선 모양별 해석 체인(팬 → 우회 → RF+최소 높이)과 라벨 앵커, 장애물 캐시
import { getStraightPath, Position, type Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { toEdgeObstacle } from "@/lib/edge-detour";
import { getEdgeObstacles, resolveEdgePath } from "@/lib/edge-path";
import { getBezierPathWithStub, getSmoothStepPathWithStub, type EdgeEndsArgs } from "@/lib/edge-stub";

// 소스 우측 핸들(170,18) → 타깃 좌측 핸들(400,218) — 마주 보는 수평쌍, 기본 회랑 x=285
const LR: EdgeEndsArgs = {
  sourceX: 170,
  sourceY: 18,
  targetX: 400,
  targetY: 218,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};
const targetLane = { t: { k: 0, idx: 0, n: 2, r: 14 } };
// 소스 행(y=18)의 x 250..300을 막는 장애물 — 팬 경로와 기본 회랑을 모두 막고, 회랑 237만 남긴다
const rowBlocker = toEdgeObstacle("o", { x: 250, y: 0, w: 50, h: 40 });

describe("resolveEdgePath - 직선·곡선", () => {
  it("직선은 RF 직선 경로와 중점 라벨", () => {
    const result = resolveEdgePath({ ...LR, variant: "straight" });
    const [path, labelX, labelY] = getStraightPath(LR);
    expect(result).toEqual({ path, labelX, labelY, route: "straight" });
  });

  it("곡선은 팬이 없으면 최소 높이 곡선(t=0.5 라벨), 있으면 팬 곡선", () => {
    const [path, labelX, labelY] = getBezierPathWithStub(LR);
    expect(resolveEdgePath({ ...LR, variant: "default" })).toEqual({ path, labelX, labelY, route: "bezier" });
    expect(resolveEdgePath({ ...LR, variant: "default", fan: targetLane }).route).toBe("fan");
  });

  it("직선·곡선은 장애물을 넘겨도 모양을 바꾸지 않는다", () => {
    expect(resolveEdgePath({ ...LR, variant: "default", obstacles: [rowBlocker] }).route).toBe("bezier");
  });
});

describe("resolveEdgePath - 꺾은선 체인", () => {
  it("장애물이 없으면 RF+최소 높이 경로", () => {
    const [path, labelX, labelY] = getSmoothStepPathWithStub(LR);
    expect(resolveEdgePath({ ...LR, variant: "smoothstep" })).toEqual({ path, labelX, labelY, route: "step" });
  });

  it("팬 경로가 다른 노드를 관통하지 않으면 팬", () => {
    const result = resolveEdgePath({ ...LR, variant: "smoothstep", fan: targetLane, obstacles: [] });
    expect(result.route).toBe("fan");
    expect(result.path).toContain("A 14 14 0 0 0 400,218");
  });

  it("팬 경로가 막히면 우회로 내려가고, 라벨은 가려지지 않는 구간 중앙", () => {
    const result = resolveEdgePath({ ...LR, variant: "smoothstep", fan: targetLane, obstacles: [rowBlocker] });
    expect(result.route).toBe("detour");
    expect(result.path.startsWith("M 170,18 L 232,18")).toBe(true);
    // 소스 행 구간(203.5,18)은 장애물 라벨 판정 안 → 회랑 세로 구간 중앙
    expect([result.labelX, result.labelY]).toEqual([237, 118]);
  });

  it("양끝 노드는 장애물이 아니다 — 소스 id 장애물이 회랑을 덮어도 우회하지 않는다", () => {
    const self = toEdgeObstacle("src", { x: 250, y: 0, w: 50, h: 40 });
    const result = resolveEdgePath({ ...LR, variant: "smoothstep", obstacles: [self], sourceId: "src", targetId: "dst" });
    expect(result.route).toBe("step");
  });

  it("같은 변(위→위) 쌍은 장애물이 있어도 우회 없이 40px 최소 높이 경로", () => {
    const topTop: EdgeEndsArgs = {
      sourceX: 100,
      sourceY: 200,
      targetX: 500,
      targetY: 210,
      sourcePosition: Position.Top,
      targetPosition: Position.Top,
    };
    const blocker = toEdgeObstacle("o", { x: 250, y: 150, w: 100, h: 100 });
    const result = resolveEdgePath({ ...topTop, variant: "smoothstep", obstacles: [blocker] });
    expect(result.route).toBe("step");
    expect(result.path).toBe(getSmoothStepPathWithStub(topTop)[0]);
  });
});

function makeNode(id: string, x: number, y: number, extra: Partial<Node> = {}): Node {
  return { id, position: { x, y }, data: {}, measured: { width: 170, height: 52 }, ...extra };
}

describe("getEdgeObstacles - 노드 배열별 캐시", () => {
  it("숨김·미측정 노드는 빼고 MARGIN 12로 부풀린다", () => {
    const list = getEdgeObstacles([
      makeNode("a", 0, 0),
      makeNode("hidden", 0, 0, { hidden: true }),
      makeNode("unmeasured", 0, 0, { measured: undefined }),
    ]);
    expect(list.map((o) => o.id)).toEqual(["a"]);
    expect([list[0].left, list[0].right, list[0].top, list[0].bottom]).toEqual([-12, 182, -12, 64]);
  });

  it("같은 배열이면 같은 목록, 두 RF 인스턴스의 배열을 번갈아 불러도 서로 캐시를 밀어내지 않는다", () => {
    const editorNodes = [makeNode("a", 0, 0)];
    const previewNodes = [makeNode("b", 300, 0)];
    const first = getEdgeObstacles(editorNodes);
    const preview = getEdgeObstacles(previewNodes);
    expect(getEdgeObstacles(editorNodes)).toBe(first);
    expect(getEdgeObstacles(previewNodes)).toBe(preview);
    expect(preview[0].id).toBe("b");
  });
});
