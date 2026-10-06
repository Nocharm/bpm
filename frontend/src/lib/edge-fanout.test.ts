// edge-fanout 계약 — 같은 핸들 형제의 레인 배정(그룹 키·가족·정렬)과 팬 경로 기하
import { Position, type Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import type { AppNode } from "@/lib/canvas";
import {
  assignFanLanes,
  buildFanBezierPath,
  buildFanGeom,
  buildFanStepPath,
  injectFanLanes,
  spreadStraightEndpoints,
  type FanNodeGeom,
  type FanPathArgs,
} from "@/lib/edge-fanout";

// 프로세스 노드 170×52 — 좌/우 핸들은 y+18(라벨 라인), 상/하는 가로 중앙
const proc = (x: number, y: number): FanNodeGeom => ({ x, y, w: 170, h: 52, nodeType: "process" });

function edge(id: string, source: string, target: string, sourceHandle = "s-right", targetHandle = "t-left"): Edge {
  return { id, source, target, sourceHandle, targetHandle };
}

describe("assignFanLanes - 그룹 키", () => {
  it("형제가 하나뿐인 끝은 팬 없음(맵에 없음)", () => {
    const geom = new Map([["A", proc(0, 0)], ["T", proc(400, 0)]]);
    const lanes = assignFanLanes([edge("e1", "A", "T")], geom);
    expect(lanes.size).toBe(0);
  });

  it("같은 변의 s-/t- 핸들은 같은 픽셀이라 한 그룹 — 들어오는 엣지와 나가는 엣지가 함께 레인을 받는다", () => {
    // T 위쪽 변: M→T 루프백(t-top)과 T→N 루프아웃(s-top)
    const geom = new Map([["T", proc(0, 200)], ["M", proc(300, 200)], ["N", proc(600, 200)]]);
    const lanes = assignFanLanes(
      [edge("in", "M", "T", "s-top", "t-top"), edge("out", "T", "N", "s-top", "t-top")],
      geom,
    );
    expect(lanes.get("in")?.t).toBeDefined();
    expect(lanes.get("out")?.s).toBeDefined();
    // 타깃 측 레인과 소스 측 레인이 같은 그룹 크기(n=2)를 본다
    expect(lanes.get("in")?.t?.n).toBe(2);
    expect(lanes.get("out")?.s?.n).toBe(2);
  });

  it("하위프로세스 들어오는 문 변형(in:top)은 위 변 앵커 — 같은 문으로 오는 엣지끼리 형제, 좌측 in과는 별도", () => {
    const geom = new Map([
      ["S", { x: 0, y: 200, w: 180, h: 64, nodeType: "subprocess" as const }],
      ["A", proc(-100, 0)],
      ["B", proc(100, 0)],
      ["L", proc(-400, 200)],
    ]);
    const lanes = assignFanLanes(
      [
        edge("a", "A", "S", "s-bottom", "in:top"),
        edge("b", "B", "S", "s-bottom", "in:top"),
        edge("l", "L", "S", "s-right", "in"),
      ],
      geom,
    );
    expect(lanes.get("a")?.t?.n).toBe(2);
    expect(lanes.get("b")?.t?.n).toBe(2);
    expect(lanes.get("l")).toBeUndefined();
  });

  it("hidden 엣지는 그룹에서 제외된다", () => {
    const geom = new Map([["A", proc(0, 0)], ["B", proc(0, 120)], ["T", proc(400, 60)]]);
    const lanes = assignFanLanes([edge("e1", "A", "T"), { ...edge("e2", "B", "T"), hidden: true }], geom);
    expect(lanes.size).toBe(0);
  });

  it("ctrl-ghost: 접두 노드는 원본 기하를 쓴다", () => {
    const geom = new Map([["A", proc(0, 0)], ["B", proc(0, 120)], ["T", proc(400, 60)]]);
    const lanes = assignFanLanes(
      [edge("e1", "ctrl-ghost:A", "T"), edge("e2", "B", "T")],
      geom,
    );
    expect(lanes.get("e1")?.t).toBeDefined();
    expect(lanes.get("e2")?.t).toBeDefined();
  });
});

describe("assignFanLanes - 가족과 정렬", () => {
  it("대향 진입: 먼 소스가 안쪽(k=0), 가까운 소스가 바깥. 같은 줄은 k=-1", () => {
    // T 좌측 핸들 (400, 218). A는 200px 위, B는 60px 위, C는 같은 줄, D는 100px 아래
    const geom = new Map([
      ["T", proc(400, 200)],
      ["A", proc(0, 0)],
      ["B", proc(0, 140)],
      ["C", proc(0, 200)],
      ["D", proc(0, 300)],
    ]);
    const lanes = assignFanLanes(
      [edge("a", "A", "T"), edge("b", "B", "T"), edge("c", "C", "T"), edge("d", "D", "T")],
      geom,
    );
    expect(lanes.get("a")?.t?.k).toBe(0);
    expect(lanes.get("b")?.t?.k).toBe(1);
    expect(lanes.get("c")?.t?.k).toBe(-1);
    // 아래쪽 가족은 독립 — 혼자라 k=0
    expect(lanes.get("d")?.t?.k).toBe(0);
    // 소스 끝은 각자 단독이라 팬 없음
    expect(lanes.get("a")?.s).toBeUndefined();
  });

  it("동측(루프백) 진입: 가까운 소스가 안쪽(무지개)", () => {
    // T 위쪽 핸들로 오른쪽 M(가까움)·N(멂)의 top→top 루프백
    const geom = new Map([["T", proc(0, 200)], ["M", proc(300, 200)], ["N", proc(600, 200)]]);
    const lanes = assignFanLanes(
      [edge("m", "M", "T", "s-top", "t-top"), edge("n", "N", "T", "s-top", "t-top")],
      geom,
    );
    expect(lanes.get("m")?.t?.k).toBe(0);
    expect(lanes.get("n")?.t?.k).toBe(1);
  });

  it("동률(측면 거리 같음)은 엣지 id 오름차순으로 결정적", () => {
    const geom = new Map([["T", proc(400, 200)], ["A", proc(0, 0)], ["B", proc(100, 0)]]);
    const first = assignFanLanes([edge("z", "A", "T"), edge("y", "B", "T")], geom);
    const second = assignFanLanes([edge("y", "B", "T"), edge("z", "A", "T")], geom);
    expect(first.get("y")?.t?.k).toBe(0);
    expect(first.get("z")?.t?.k).toBe(1);
    expect(second.get("y")?.t?.k).toBe(0);
    expect(second.get("z")?.t?.k).toBe(1);
  });

  it("소스 끝(아웃 팬)도 같은 규칙 — 먼 타깃이 안쪽", () => {
    // S 우측 핸들에서 위쪽 멀리 A, 위쪽 가까이 B, 아래 C로 나감
    const geom = new Map([["S", proc(0, 200)], ["A", proc(400, 0)], ["B", proc(400, 140)], ["C", proc(400, 320)]]);
    const lanes = assignFanLanes([edge("a", "S", "A"), edge("b", "S", "B"), edge("c", "S", "C")], geom);
    expect(lanes.get("a")?.s?.k).toBe(0);
    expect(lanes.get("b")?.s?.k).toBe(1);
    expect(lanes.get("c")?.s?.k).toBe(0);
    expect(lanes.get("a")?.t).toBeUndefined();
  });

  it("idx/n은 그룹 전체를 측면 좌표 오름차순으로 센 결정적 순번(직선 끝점 분산용)", () => {
    const geom = new Map([["T", proc(400, 200)], ["A", proc(0, 0)], ["C", proc(0, 200)], ["D", proc(0, 300)]]);
    const lanes = assignFanLanes([edge("d", "D", "T"), edge("a", "A", "T"), edge("c", "C", "T")], geom);
    expect(lanes.get("a")?.t).toMatchObject({ idx: 0, n: 3 });
    expect(lanes.get("c")?.t).toMatchObject({ idx: 1, n: 3 });
    expect(lanes.get("d")?.t).toMatchObject({ idx: 2, n: 3 });
  });

  it("레인 반경 r을 배정한다 — 공칭 14+10k, 가까운 형제의 측면 거리·수평 여유에 맞춰 안쪽부터 압축(최소 간격 6)", () => {
    // T 좌측 핸들 (400,218). 위쪽 소스 셋: 200px·60px·30px 위 → 공칭 [14,24,34]인데 30px 위 소스는 34가 안 들어간다
    const geom = new Map([["T", proc(400, 200)], ["A", proc(0, 0)], ["B", proc(0, 140)], ["C", proc(0, 170)]]);
    const lanes = assignFanLanes([edge("a", "A", "T"), edge("b", "B", "T"), edge("c", "C", "T")], geom);
    expect(lanes.get("c")?.t).toMatchObject({ k: 2, r: 24 }); // 30 - 6(여유)
    expect(lanes.get("b")?.t).toMatchObject({ k: 1, r: 18 }); // 24 - 6(최소 간격)
    expect(lanes.get("a")?.t).toMatchObject({ k: 0, r: 12 });
  });

  it("수평 여유(u)가 좁은 가까운 소스는 (u-20-핸들 돌출 11)/2 로 캡 — 먼 소스도 그 아래로 압축된다", () => {
    // B의 우측 핸들이 T 좌측 핸들에서 70px 앞(u=70) → r ≤ (70-31)/2 = 19.5 (라이브 끝점은 핸들 박스 바깥변이라 추정보다 5.5px씩 가깝다)
    const geom = new Map([["T", proc(400, 200)], ["A", proc(0, 0)], ["B", proc(160, 140)]]);
    const lanes = assignFanLanes([edge("a", "A", "T"), edge("b", "B", "T")], geom);
    expect(lanes.get("b")?.t).toMatchObject({ k: 1, r: 19.5 });
    expect(lanes.get("a")?.t).toMatchObject({ k: 0, r: 13.5 });
  });

  it("압축해도 6px 미만이면 그 끝은 팬 없음(r=0) — 나머지 형제는 영향 없음", () => {
    // 8px 위 소스는 레인이 안 들어간다(8-6=2). 먼 소스 A는 공칭 14 유지
    const geom = new Map([["T", proc(400, 200)], ["A", proc(0, 0)], ["B", proc(0, 192)]]);
    const lanes = assignFanLanes([edge("a", "A", "T"), edge("b", "B", "T")], geom);
    expect(lanes.get("b")?.t?.r).toBe(0);
    expect(lanes.get("a")?.t).toMatchObject({ k: 0, r: 14 });
  });

  it("같은 측면에 동측·대향이 섞이면 동측(루프백)이 안쪽(위·아래 변은 최소 높이 40부터), 대향은 그 바깥에서 시작한다", () => {
    // T 위쪽 핸들: 오른쪽 같은 줄 L(top→top 루프백)과 위-오른쪽 A(bottom→top 대향)
    const geom = new Map([["T", proc(0, 400)], ["L", proc(400, 400)], ["A", proc(300, 0)]]);
    const lanes = assignFanLanes(
      [edge("l", "L", "T", "s-top", "t-top"), edge("a", "A", "T", "s-bottom", "t-top")],
      geom,
    );
    expect(lanes.get("l")?.t).toMatchObject({ r: 40 });
    expect(lanes.get("a")?.t).toMatchObject({ r: 50 });
  });

  it("하위프로세스 끝 핸들은 우측 한 점에 겹치므로 끝 키가 달라도 한 팬 그룹이다", () => {
    const sp: FanNodeGeom = { x: 0, y: 200, w: 180, h: 64, nodeType: "subprocess" };
    const geom = new Map([["S", sp], ["T", proc(400, 0)], ["U", proc(400, 400)]]);
    const lanes = assignFanLanes([edge("p", "S", "T", "__primary__"), edge("e2", "S", "U", "e2")], geom);
    expect(lanes.get("p")?.s?.n).toBe(2);
    expect(lanes.get("e2")?.s?.n).toBe(2);
    expect(lanes.get("p")?.s?.idx).not.toBe(lanes.get("e2")?.s?.idx);
  });

  it("TB 흐름(bottom→top)에서도 측면축은 x — 먼 소스가 안쪽", () => {
    const geom = new Map([["T", proc(300, 400)], ["A", proc(0, 0)], ["B", proc(200, 100)]]);
    const lanes = assignFanLanes(
      [edge("a", "A", "T", "s-bottom", "t-top"), edge("b", "B", "T", "s-bottom", "t-top")],
      geom,
    );
    expect(lanes.get("a")?.t?.k).toBe(0);
    expect(lanes.get("b")?.t?.k).toBe(1);
  });
});

// LR 대향 기본 인자 — 소스 우측 핸들(170,18) → 타깃 좌측 핸들(400,218), 소스가 200px 위
const LR: FanPathArgs = {
  sourceX: 170,
  sourceY: 18,
  targetX: 400,
  targetY: 218,
  sourcePosition: Position.Right,
  targetPosition: Position.Left,
};
// 대향 가족 공칭 반경(14+10k)의 레인. 동측(루프백)은 기저 34라 r을 직접 넘긴다
const lane = (k: number, idx = 0, n = 2) => ({ k, idx, n, r: k < 0 ? 0 : 14 + k * 10 });
const laneR = (k: number, r: number, n = 2) => ({ k, idx: 0, n, r });

describe("buildFanGeom / injectFanLanes - 표면 배선 헬퍼", () => {
  const node = (id: string, nodeType: AppNode["data"]["nodeType"], x: number, y: number, measured?: { width: number; height: number }): AppNode =>
    ({ id, type: "process", position: { x, y }, measured, data: { label: id, nodeType } }) as unknown as AppNode;

  it("실측 크기가 있으면 그것을, 없으면 타입 기본 크기를 쓴다", () => {
    const geom = buildFanGeom([node("A", "process", 10, 20, { width: 200, height: 80 }), node("D", "decision", 0, 0)]);
    expect(geom.get("A")).toMatchObject({ x: 10, y: 20, w: 200, h: 80, nodeType: "process" });
    expect(geom.get("D")).toMatchObject({ x: 0, y: 0, w: 116, h: 96, nodeType: "decision" });
  });

  it("팬이 있는 엣지에만 data.fan을 얹고 기존 data는 보존, 팬 없는 엣지는 같은 객체를 돌려준다", () => {
    const geom = buildFanGeom([node("A", "process", 0, 0), node("B", "process", 0, 120), node("T", "process", 400, 60), node("Z", "process", 800, 60)]);
    const plain: Edge = { ...edge("z", "T", "Z"), data: { gateway: true } };
    const list: Edge[] = [{ ...edge("a", "A", "T"), data: { gateway: null } }, edge("b", "B", "T"), plain];
    const out = injectFanLanes(list, geom);
    expect(out[0].data).toMatchObject({ gateway: null, fan: { t: { n: 2 } } });
    expect(out[1].data).toMatchObject({ fan: { t: { n: 2 } } });
    expect(out[2]).toBe(plain);
  });
});

describe("buildFanStepPath - 꺾은선 게이트 포인트 + 원호", () => {
  it("대향 타깃 팬 k=0: 소스 행 수평 → 핸들 앞 14px 레인 → 반경 14 원호로 접선 진입, 끝점 불변", () => {
    const result = buildFanStepPath(LR, { t: lane(0) });
    expect(result).not.toBeNull();
    expect(result!.d).toBe("M 170,18 L 381,18 Q 386,18 386,23 L 386,204 A 14 14 0 0 0 400,218");
    // 라벨은 최장 직선 구간(소스 행 수평) 중앙
    expect([result!.labelX, result!.labelY]).toEqual([278, 18]);
    // 장애물 검사용 폴리라인은 라운드 전 꼭짓점(코너·게이트·아크 꼭짓점·끝점)
    expect(result!.points).toEqual([
      { x: 170, y: 18 },
      { x: 386, y: 18 },
      { x: 386, y: 204 },
      { x: 386, y: 218 },
      { x: 400, y: 218 },
    ]);
  });

  it("k=1은 레인이 10px 더 바깥(x=376)·반경 24 — 안쪽 아크와 끝점에서만 만난다", () => {
    const result = buildFanStepPath(LR, { t: lane(1) });
    expect(result!.d).toContain("L 376,194 A 24 24 0 0 0 400,218");
  });

  it("같은 줄(k=-1)은 팬 없음 → null(호출자가 현행 경로)", () => {
    expect(buildFanStepPath(LR, { t: lane(-1) })).toBeNull();
  });

  it("레인 반경이 측면 거리에 막히면(레인 구간이 안 남음) 팬 없음 → null, NaN 경로를 내지 않는다", () => {
    // 10px 위: 반경 14 레인이 안 들어간다(리뷰 C1/C4/C7 — 이전엔 r=|v|로 0길이 구간 → 'NaN' 경로)
    expect(buildFanStepPath({ ...LR, sourceY: 208 }, { t: lane(0) })).toBeNull();
    expect(buildFanStepPath({ ...LR, sourceY: 214 }, { t: lane(0) })).toBeNull();
    // 레인 반경(r)이 배정값보다 2px 넘게 깎여야 하면(측면 거리·수평 여유 부족) 순서가 뒤집히므로 null
    expect(buildFanStepPath({ ...LR, sourceY: 195 }, { t: laneR(1, 24) })).toBeNull(); // 23-6=17 < 22
    expect(buildFanStepPath({ ...LR, sourceX: 350 }, { t: laneR(1, 24) })).toBeNull(); // (50-20)/2=15 < 22
    expect(buildFanStepPath({ ...LR, sourceY: 188 }, { t: laneR(1, 24) })).not.toBeNull(); // 30-6=24 OK
  });

  it("측면 오프셋·레인 전수 스윕에서 결과는 null이거나 NaN 없는 유한 경로", () => {
    for (let v = -60; v <= 60; v += 2) {
      for (let k = 0; k < 4; k += 1) {
        const r = 14 + k * 10;
        const res = buildFanStepPath({ ...LR, sourceY: 218 + v }, { t: { k, idx: 0, n: 4, r } });
        if (res) {
          expect(res.d).not.toContain("NaN");
          expect(res.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
        }
        const both = buildFanStepPath({ ...LR, sourceY: 218 + v }, { s: { k, idx: 0, n: 4, r }, t: { k, idx: 0, n: 4, r } });
        if (both) expect(both.d).not.toContain("NaN");
      }
    }
  });

  it("양끝 팬(LR): 소스 원호 → 중간 높이 수평 → 타깃 원호, 내부 모서리는 5px 라운드", () => {
    const result = buildFanStepPath(LR, { s: lane(0), t: lane(0) });
    expect(result!.d).toBe(
      "M 170,18 A 14 14 0 0 1 184,32 L 184,113 Q 184,118 189,118 L 381,118 Q 386,118 386,123 L 386,204 A 14 14 0 0 0 400,218",
    );
    expect([result!.labelX, result!.labelY]).toEqual([285, 118]);
  });

  it("양끝 팬에서 같은 방향 2코너 경로의 중간 구간은 소스 레인(r-14)만큼 비켜 선다 — 같은 쌍의 왕복 엣지가 겹치지 않게", () => {
    // 소스 r=24(k=1)·타깃 r=14: 중간 수평이 절반(118)이 아니라 +10 → 128... 게이트 y가 42/204라 절반은 123, 편향 후 133
    const result = buildFanStepPath(LR, { s: laneR(1, 24), t: lane(0) });
    expect(result!.d).toBe(
      "M 170,18 A 24 24 0 0 1 194,42 L 194,128 Q 194,133 199,133 L 381,133 Q 386,133 386,138 L 386,204 A 14 14 0 0 0 400,218",
    );
    // 라벨도 중간 구간 중앙(290)에서 소스 레인 × 4 = 40px 앞으로 — 나란한 왕복 엣지의 라벨이 포개지지 않게
    expect([result!.labelX, result!.labelY]).toEqual([330, 133]);
    // 소스 레인이 안쪽(14)이면 그대로 중앙
    const inner = buildFanStepPath(LR, { s: lane(0), t: lane(0) });
    expect([inner!.labelX, inner!.labelY]).toEqual([285, 118]);
  });

  // 위쪽 변 레인 반경은 배정(assignGroup)에서 최소 높이 40부터 — 종전 기대값(34·44)은 raw 위쪽 끝이 34px만 뜨던 버그를 담았다
  it("루프백(top→top, 동측 가족): 위쪽 변 레인은 최소 높이 40부터(반경 40+10k), 무지개로 위쪽 핸들에 진입", () => {
    const back: FanPathArgs = {
      sourceX: 385,
      sourceY: 200,
      targetX: 85,
      targetY: 200,
      sourcePosition: Position.Top,
      targetPosition: Position.Top,
    };
    const inner = buildFanStepPath(back, { t: laneR(0, 40) });
    expect(inner!.d).toBe("M 385,200 L 385,165 Q 385,160 380,160 L 125,160 A 40 40 0 0 0 85,200");
    const outer = buildFanStepPath(back, { t: laneR(1, 50) });
    expect(outer!.d).toContain("L 135,150 A 50 50 0 0 0 85,200");
  });

  it("raw 위·아래 끝도 최소 높이 40 — 레인까지 40px 못 뜨면 null(현행 경로가 40px 스텁으로 그린다)", () => {
    const back: FanPathArgs = {
      sourceX: 385,
      sourceY: 200,
      targetX: 85,
      targetY: 200,
      sourcePosition: Position.Top,
      targetPosition: Position.Top,
    };
    // 반경 34 레인 = raw 위쪽 소스가 34px만 뜬다(종전엔 20px 스텁만 요구해 통과)
    expect(buildFanStepPath(back, { t: laneR(0, 34) })).toBeNull();
    // 아래 핸들 → 좌측 레인(같은 방향 2코너): 수직 여유 34px(< 40+1)면 null — 종전엔 20px만 뜨고 꺾었다
    const branch: FanPathArgs = {
      sourceX: 58,
      sourceY: 170,
      targetX: 400,
      targetY: 218,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Left,
    };
    expect(buildFanStepPath(branch, { t: lane(0) })).toBeNull();
    // 좌·우 raw 끝은 그대로 20px 스텁(LR 기본 케이스 회귀 없음)
    expect(buildFanStepPath(LR, { t: lane(0) })).not.toBeNull();
  });

  it("분기 아래 핸들 → 노드 좌측 핸들(출발·도착 방향 같음): 중간 높이에서 한 번 꺾어 레인으로", () => {
    const branch: FanPathArgs = {
      sourceX: 58,
      sourceY: 96,
      targetX: 400,
      targetY: 218,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Left,
    };
    const result = buildFanStepPath(branch, { t: lane(0) });
    expect(result!.d).toBe(
      "M 58,96 L 58,145 Q 58,150 63,150 L 381,150 Q 386,150 386,155 L 386,204 A 14 14 0 0 0 400,218",
    );
  });

  it("소스에서 레인까지 20px 스텁을 못 채우면 null(현행 경로)", () => {
    expect(buildFanStepPath({ ...LR, sourceX: 380 }, { t: lane(0) })).toBeNull();
    expect(buildFanStepPath({ ...LR, sourceX: 420 }, { t: lane(0) })).toBeNull();
  });

  it("TB 대향(bottom→top): 같은 규칙을 90도 돌린 것 — 가로 레인 + 원호", () => {
    const tb: FanPathArgs = {
      sourceX: 85,
      sourceY: 52,
      targetX: 385,
      targetY: 400,
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    };
    const result = buildFanStepPath(tb, { t: lane(0) });
    expect(result!.d).toBe("M 85,52 L 85,381 Q 85,386 90,386 L 371,386 A 14 14 0 0 1 385,400");
  });
});

describe("buildFanBezierPath - 곡선 제어점 중첩", () => {
  it("팬 끝의 제어점만 1.2r로 당기고 다른 끝은 RF 기본(0.5·거리)", () => {
    const result = buildFanBezierPath(LR, { t: lane(0) });
    expect(result).not.toBeNull();
    const [d, labelX, labelY] = result!;
    expect(d).toBe("M 170,18 C 285,18 383.2,218 400,218");
    // t=0.5 지점(0.125·P0 + 0.375·C1 + 0.375·C2 + 0.125·P3)
    expect(labelX).toBeCloseTo(321.825, 3);
    expect(labelY).toBeCloseTo(118, 6);
  });

  it("같은 줄(k=-1)이나 팬 없음은 null", () => {
    expect(buildFanBezierPath(LR, { t: lane(-1) })).toBeNull();
    expect(buildFanBezierPath(LR, {})).toBeNull();
  });
});

describe("spreadStraightEndpoints - 직선 끝점 분산", () => {
  it("그룹 순번을 중심 기준 ±3.5px 간격으로 변과 평행하게 벌린다", () => {
    expect(spreadStraightEndpoints(LR, { t: lane(0, 0, 3) }).targetY).toBe(214.5);
    expect(spreadStraightEndpoints(LR, { t: lane(0, 1, 3) }).targetY).toBe(218);
    expect(spreadStraightEndpoints(LR, { t: lane(0, 2, 3) }).targetY).toBe(221.5);
  });

  it("핸들 11px 안(±4.5)으로 클립하고, 소스 끝도 같은 규칙", () => {
    expect(spreadStraightEndpoints(LR, { t: lane(0, 3, 4) }).targetY).toBe(222.5);
    expect(spreadStraightEndpoints(LR, { s: lane(0, 0, 2) }).sourceY).toBe(16.25);
  });

  it("상/하 변은 x로 벌린다", () => {
    const tb = { ...LR, sourcePosition: Position.Bottom, targetPosition: Position.Top };
    expect(spreadStraightEndpoints(tb, { t: lane(0, 0, 2) }).targetX).toBe(398.25);
  });
});
