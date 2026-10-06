// lib/edge-rewire 테스트 — 출구 연결 판정(병렬·충돌·중복)·삽입 재배선 검증(역행 쌍)·끝점 재연결·변 다시 고르기.
import { describe, expect, it } from "vitest";
import type { Edge } from "@xyflow/react";

import { type AppNode, insertNodeAfter, type ProcessNodeType } from "@/lib/canvas";
import {
  applyReconnect,
  checkReconnect,
  decideExitConnection,
  decideReconnectLabel,
  type ExitConnectEdge,
  findRewireProblem,
  inferFlowDirFromPositions,
  isSourceExitChange,
  repickEdgeSides,
} from "@/lib/edge-rewire";
import { PRIMARY_END_HANDLE } from "@/lib/subprocess-embed";

function exitEdge(id: string, source: string, target: string, extra: Partial<ExitConnectEdge> = {}): ExitConnectEdge {
  return { id, source, target, sourceHandle: null, gateway: null, ...extra };
}

function edge(id: string, source: string, target: string, extra: Partial<Edge> = {}): Edge {
  return { id, source, target, sourceHandle: "s-right", targetHandle: "t-left", ...extra };
}

function makeNode(id: string, nodeType: ProcessNodeType, x: number, y: number): AppNode {
  return {
    id,
    type: "process",
    position: { x, y },
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
    },
  };
}

describe("decideExitConnection (핸들 연결·드롭 삽입 공용)", () => {
  const proc = { id: "B", nodeType: "process" };

  it("출력이 없으면 free, 단일 출구에 다른 출력이 있으면 conflict", () => {
    expect(decideExitConnection(proc, [], null, "A", { countSameTarget: true })).toBe("free");
    const edges = [exitEdge("e1", "B", "C")];
    expect(decideExitConnection(proc, edges, null, "A", { countSameTarget: true })).toBe("conflict");
  });

  it("같은 대상 출력은 countSameTarget일 때만 충돌(핸들 연결) — 드롭 삽입은 무변경으로 본다", () => {
    const edges = [exitEdge("e1", "B", "A")];
    expect(decideExitConnection(proc, edges, null, "A", { countSameTarget: true })).toBe("conflict");
    expect(decideExitConnection(proc, edges, null, "A", { countSameTarget: false })).toBe("free");
  });

  it("병렬 출구(속성)는 모달 없이 갈래 추가, 같은 대상 갈래가 있으면 duplicate", () => {
    const parallel = { ...proc, parallelOutputs: [PRIMARY_END_HANDLE] };
    const edges = [exitEdge("e1", "B", "C"), exitEdge("e2", "B", "D")];
    expect(decideExitConnection(parallel, edges, null, "A", { countSameTarget: false })).toBe("branch");
    expect(decideExitConnection(parallel, edges, null, "C", { countSameTarget: false })).toBe("duplicate");
  });

  it("레거시 gateway=parallel 출구와 시작 노드도 병렬로 읽는다(출력 규칙과 같은 소스)", () => {
    const legacy = [exitEdge("e1", "B", "C", { gateway: "parallel" }), exitEdge("e2", "B", "D", { gateway: "parallel" })];
    expect(decideExitConnection(proc, legacy, null, "A", { countSameTarget: true })).toBe("branch");
    const start = { id: "S", nodeType: "start" };
    expect(decideExitConnection(start, [exitEdge("e1", "S", "C")], null, "A", { countSameTarget: true })).toBe("branch");
  });

  it("SP는 출구(끝 키)별로 센다 — 다른 끝의 출력은 충돌이 아니다", () => {
    const sp = { id: "P", nodeType: "subprocess" };
    const edges = [exitEdge("e1", "P", "C", { sourceHandle: PRIMARY_END_HANDLE })];
    expect(decideExitConnection(sp, edges, "반려", "A", { countSameTarget: true })).toBe("free");
    expect(decideExitConnection(sp, edges, PRIMARY_END_HANDLE, "A", { countSameTarget: true })).toBe("conflict");
  });

  it("excludeEdgeId는 개수에서만 빼고 병렬 판정엔 남긴다", () => {
    const legacy = [exitEdge("e1", "B", "C", { gateway: "parallel" }), exitEdge("e2", "B", "D", { gateway: "parallel" })];
    expect(
      decideExitConnection(proc, legacy, null, "X", { countSameTarget: true, excludeEdgeId: "e2" }),
    ).toBe("branch");
  });
});

describe("findRewireProblem (삽입 재배선 검증)", () => {
  it("시나리오 1: S→C, C→T에서 S→T '삽입'이 T→C를 만들어 T↔C 역행 쌍이 되면 문제", () => {
    // Arrange
    const before = [edge("sc", "S", "C"), edge("ct", "C", "T")];
    // Act — applyEdgeAction("insert")와 같은 호출: S의 기존 출력을 T 뒤로 재연결 + S→T
    const after = insertNodeAfter(before, "T", "S", true);
    // Assert
    const problem = findRewireProblem(before, after, [["S", "T"], ["T", "C"]]);
    expect(problem).not.toBeNull();
    expect(problem && new Set(problem)).toEqual(new Set(["T", "C"]));
  });

  it("시나리오 2: X→T가 있는데 S→X에 T를 끼우면 T→X가 조용히 빠진다 — 필요한 연결 누락으로 잡는다", () => {
    const before = [edge("sx", "S", "X"), edge("xt", "X", "T")];
    let after = before.filter((item) => item.id !== "sx");
    after = insertNodeAfter(after, "T", "S", false);
    after = insertNodeAfter(after, "X", "T", false);
    expect(findRewireProblem(before, after, [["S", "T"], ["T", "X"]])).toEqual(["T", "X"]);
  });

  it("정상 삽입과 이미 있던 역행 쌍(레거시 데이터)은 문제 아님", () => {
    const before = [edge("ab", "A", "B"), edge("ba", "B", "A"), edge("bc", "B", "C")];
    const after = insertNodeAfter(before, "N", "C", false);
    expect(findRewireProblem(before, after, [["C", "N"]])).toBeNull();
  });
});

describe("checkReconnect / applyReconnect (끝점 재연결)", () => {
  const proc = (id: string) => ({ id, nodeType: "process" });

  it("자기루프·역행 쌍을 막는다", () => {
    const edges = [exitEdge("ab", "A", "B"), exitEdge("cb", "C", "B")];
    const toSelf = { source: "A", target: "A", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(edges, "ab", toSelf, proc("A"))).toBe("selfLoop");
    // C→B의 도착을 A로 옮기면 될 일, B에서 C로 나가게 하면 C→B와 역행 — cb 자신은 제외하고 ab를 B→C로
    const edges2 = [exitEdge("ab", "A", "B"), exitEdge("cb", "C", "B")];
    const reverse = { source: "B", target: "C", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(edges2, "ab", reverse, proc("B"))).toBe("reciprocal");
  });

  it("단일 출구 출력 규칙 — 출력이 이미 있는 노드로 출발을 옮기면 outputConflict, 도착만 옮기면 통과", () => {
    const edges = [exitEdge("ab", "A", "B"), exitEdge("cd", "C", "D")];
    const moveSource = { source: "C", target: "B", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(edges, "ab", moveSource, proc("C"))).toBe("outputConflict");
    const moveTarget = { source: "A", target: "D", sourceHandle: "s-right", targetHandle: "t-top" };
    expect(checkReconnect(edges, "ab", moveTarget, proc("A"))).toBeNull();
  });

  it("같은 출구 같은 대상(다른 변)은 duplicate, 병렬 출구의 같은 대상 갈래도 duplicate", () => {
    const edges = [exitEdge("ab", "A", "B"), exitEdge("cb", "C", "B")];
    const toSameTarget = { source: "A", target: "B", sourceHandle: "s-bottom", targetHandle: "t-top" };
    // ab 자신을 옮기는 건 통과(다른 핸들로 이동)
    expect(checkReconnect(edges, "ab", toSameTarget, proc("A"))).toBeNull();
    const parallel = { id: "P", nodeType: "process", parallelOutputs: [PRIMARY_END_HANDLE] };
    const pEdges = [exitEdge("p1", "P", "X"), exitEdge("p2", "P", "Y"), exitEdge("zq", "Z", "Q")];
    const intoSibling = { source: "P", target: "X", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(pEdges, "zq", intoSibling, parallel)).toBe("duplicate");
    const newBranch = { source: "P", target: "Q", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(pEdges, "zq", newBranch, parallel)).toBeNull();
  });

  it("decision 출발은 출력 규칙 밖 — 완전 중복만 막는다", () => {
    const edges = [exitEdge("d1", "D", "X", { sourceHandle: "s-right" }), exitEdge("ab", "A", "B")];
    const decision = { id: "D", nodeType: "decision" };
    const toY = { source: "D", target: "Y", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(checkReconnect(edges, "ab", toY, decision)).toBeNull();
    const dup = { source: "D", target: "X", sourceHandle: "s-right", targetHandle: "t-top" };
    expect(checkReconnect(edges, "ab", dup, decision)).toBe("duplicate");
  });

  it("applyReconnect는 id·라벨·선 모양·gateway를 유지하고 SP 끝점 핸들을 정규화한다", () => {
    const old = edge("e1", "A", "B", { label: "Yes", type: "default", data: { gateway: "parallel" } });
    const next = { source: "A", target: "P", sourceHandle: "s-bottom", targetHandle: "t-left" };
    const moved = applyReconnect(old, next, (id) => id === "P");
    expect(moved).toMatchObject({
      id: "e1",
      label: "Yes",
      type: "default",
      data: { gateway: "parallel" },
      source: "A",
      target: "P",
      sourceHandle: "s-bottom",
      targetHandle: "in",
    });
  });
});

describe("isSourceExitChange (재연결 출구 선택 목록)", () => {
  it("출발 노드가 바뀌거나 같은 노드의 다른 출구 핸들이면 true — 보조 끝을 같은 SP 한 점에 다시 놓은 경우 포함", () => {
    const old = edge("e1", "P", "B", { sourceHandle: "반려" });
    expect(isSourceExitChange(old, { source: "Q", sourceHandle: "반려" })).toBe(true);
    expect(isSourceExitChange(old, { source: "P", sourceHandle: PRIMARY_END_HANDLE })).toBe(true);
  });

  it("도착 끝만 옮긴 재연결(출발·출구 그대로)은 false", () => {
    const old = edge("e1", "P", "B", { sourceHandle: "반려" });
    expect(isSourceExitChange(old, { source: "P", sourceHandle: "반려" })).toBe(false);
  });
});

describe("decideReconnectLabel (재연결 분기 라벨)", () => {
  const types: Record<string, ProcessNodeType> = { A: "process", C: "process", D: "decision", E: "decision" };
  const typeOf = (id: string): ProcessNodeType | undefined => types[id];

  it("출발을 판단 노드로 옮기면 분기 라벨을 묻는다(다른 판단 노드에서 옮겨 와도)", () => {
    expect(decideReconnectLabel(edge("e", "A", "B"), { source: "D" }, typeOf)).toBe("ask");
    expect(decideReconnectLabel(edge("e", "E", "B", { label: "Yes" }), { source: "D" }, typeOf)).toBe("ask");
  });

  it("판단 노드에서 일반 노드로 출발을 옮기면 라벨을 지운다", () => {
    expect(decideReconnectLabel(edge("e", "D", "B", { label: "No" }), { source: "A" }, typeOf)).toBe("clear");
  });

  it("도착만 옮기거나 일반 노드끼리 출발을 옮기면 라벨 유지", () => {
    expect(decideReconnectLabel(edge("e", "D", "B", { label: "No" }), { source: "D" }, typeOf)).toBe("keep");
    expect(decideReconnectLabel(edge("e", "A", "B", { label: "memo" }), { source: "C" }, typeOf)).toBe("keep");
  });

  it("applyReconnect 라벨 인자 — 문자열이면 바꾸고 빈 문자열이면 지운다", () => {
    const old = edge("e1", "D", "B", { label: "No" });
    const next = { source: "A", target: "B", sourceHandle: "s-right", targetHandle: "t-left" };
    expect(applyReconnect(old, next, () => false, "").label).toBeUndefined();
    expect(applyReconnect(old, { ...next, source: "E" }, () => false, "Yes").label).toBe("Yes");
    expect(applyReconnect(old, next, () => false).label).toBe("No");
  });
});

describe("inferFlowDirFromPositions / repickEdgeSides (연결 변 다시 고르기)", () => {
  it("엣지 거리 합이 가로가 크면 LR, 세로가 크면 TB", () => {
    const nodes = [makeNode("A", "process", 0, 0), makeNode("B", "process", 400, 0), makeNode("C", "process", 0, 300)];
    expect(inferFlowDirFromPositions(nodes, [edge("ab", "A", "B")])).toBe("LR");
    expect(inferFlowDirFromPositions(nodes, [edge("ac", "A", "C")])).toBe("TB");
    expect(inferFlowDirFromPositions(nodes, [])).toBe("LR");
  });

  it("LR 정방향은 오른쪽→왼쪽, 아래쪽 노드로 가는 연결은 아래→위", () => {
    // Arrange — A 오른쪽에 B, A 바로 아래에 C. 기존 변은 엉뚱한 쪽
    const nodes = [makeNode("A", "process", 0, 0), makeNode("B", "process", 400, 0), makeNode("C", "process", 0, 300)];
    const edges = [
      edge("ab", "A", "B", { sourceHandle: "s-top", targetHandle: "t-bottom" }),
      edge("ac", "A", "C", { sourceHandle: "s-right", targetHandle: "t-left" }),
    ];
    // Act
    const result = repickEdgeSides(nodes, edges, new Set(["ab", "ac"]), "LR");
    // Assert
    expect(result[0]).toMatchObject({ sourceHandle: "s-right", targetHandle: "t-left" });
    expect(result[1]).toMatchObject({ sourceHandle: "s-bottom", targetHandle: "t-top" });
  });

  it("역행(왼쪽 같은 줄)은 자동정렬과 같은 위→위 루프", () => {
    const nodes = [makeNode("A", "process", 400, 0), makeNode("B", "process", 0, 0)];
    const result = repickEdgeSides(nodes, [edge("ab", "A", "B")], new Set(["ab"]), "LR");
    expect(result[0]).toMatchObject({ sourceHandle: "s-top", targetHandle: "t-top" });
  });

  it("SP 출발은 끝 키 유지, SP 도착은 고른 변의 들어오는 문 — 대상 밖 엣지와 무변경 엣지는 같은 객체", () => {
    const nodes = [
      makeNode("P", "subprocess", 0, 0),
      makeNode("Q", "subprocess", 0, 300),
      makeNode("X", "process", 400, 0),
    ];
    const pq = edge("pq", "P", "Q", { sourceHandle: "반려", targetHandle: "in" });
    const px = edge("px", "P", "X", { sourceHandle: PRIMARY_END_HANDLE, targetHandle: "t-left" });
    const result = repickEdgeSides(nodes, [pq, px], new Set(["pq", "px"]), "LR");
    expect(result[0]).toMatchObject({ sourceHandle: "반려", targetHandle: "in:top" });
    expect(result[1]).toBe(px);
    const untouched = repickEdgeSides(nodes, [pq], new Set(["other"]), "LR");
    expect(untouched[0]).toBe(pq);
  });
});
