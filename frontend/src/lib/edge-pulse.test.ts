import { describe, expect, it } from "vitest";

import {
  assignEdgePulses,
  buildDecisionTimeline,
  buildDecisionWinners,
  buildPulseTimeline,
  DECISION_CYCLES,
  DECISION_SPEED_PX_S,
  DECISION_WINNER_REACH,
  FOCUS_SPEED,
  getDecisionCycle,
  getDecisionTravel,
  getPulseStillAt,
  PARALLEL_CYCLE_S,
  PARALLEL_REACH,
  type DecisionPulse,
} from "./edge-pulse";

const node = (id: string, nodeType: string, parallelOutputs?: string[]) => ({ id, nodeType, parallelOutputs, color: "#c7a062" });

const nums = (value: string | null): number[] => (value ?? "").split(";").map(Number);

const decision = (index: number, winners: number[], extra: Partial<DecisionPulse> = {}): DecisionPulse => ({
  kind: "decision",
  group: "D",
  index,
  count: 2,
  color: "x",
  winners,
  ...extra,
});

// 회차 c 구간 [c/K, (c+1)/K)에 속한 keyPoints 최댓값
const getRoundMax = (keyTimes: string, keyPoints: string, round: number, rounds: number): number => {
  const times = nums(keyTimes);
  const points = nums(keyPoints);
  return Math.max(...points.filter((_, i) => times[i] >= round / rounds && times[i] < (round + 1) / rounds));
};

describe("assignEdgePulses", () => {
  it("gives every branch of a parallel exit the parallel pulse in one group", () => {
    const pulses = assignEdgePulses(
      [node("A", "process", ["__primary__"])],
      [{ id: "e1", source: "A" }, { id: "e2", source: "A" }],
    );
    expect(pulses.get("e1")?.kind).toBe("parallel");
    expect(pulses.get("e2")?.kind).toBe("parallel");
    expect(pulses.get("e1")?.group).toBe(pulses.get("e2")?.group);
  });

  it("pulses a start fan-out as parallel without a flag", () => {
    const pulses = assignEdgePulses(
      [node("S0", "start")],
      [{ id: "s1", source: "S0" }, { id: "s2", source: "S0" }],
    );
    expect(pulses.get("s1")?.kind).toBe("parallel");
    expect(pulses.get("s2")?.kind).toBe("parallel");
  });

  it("numbers decision branches in order, shares one winner sequence and skips hidden edges", () => {
    const pulses = assignEdgePulses(
      [node("D", "decision")],
      [{ id: "y", source: "D" }, { id: "h", source: "D", hidden: true }, { id: "n", source: "D" }],
    );
    const yes = pulses.get("y");
    const no = pulses.get("n");
    expect(yes).toMatchObject({ kind: "decision", group: "D", index: 0, count: 2, color: "#c7a062" });
    expect(no).toMatchObject({ kind: "decision", group: "D", index: 1, count: 2 });
    expect(yes?.kind === "decision" && no?.kind === "decision" && yes.winners === no.winners).toBe(true);
    expect(pulses.has("h")).toBe(false);
  });

  it("leaves plain outputs and single edges without a pulse and groups per exit", () => {
    const pulses = assignEdgePulses(
      [node("A", "process"), node("D", "decision"), node("S", "subprocess", ["Hold"])],
      [
        { id: "a1", source: "A" },
        { id: "a2", source: "A" },
        { id: "d1", source: "D" },
        { id: "s1", source: "S", sourceHandle: "__primary__" },
        { id: "s2", source: "S", sourceHandle: "Hold" },
        { id: "s3", source: "S", sourceHandle: "Hold" },
      ],
    );
    expect([...pulses.keys()]).toEqual(["s2", "s3"]);
    expect(pulses.get("s2")?.group).toBe(pulses.get("s3")?.group);
  });
});

describe("buildDecisionWinners", () => {
  it("is deterministic per node id and stays within the branch range", () => {
    const first = buildDecisionWinners("node-1", 3);
    expect(buildDecisionWinners("node-1", 3)).toEqual(first);
    expect(first).toHaveLength(DECISION_CYCLES);
    expect(first.every((w) => Number.isInteger(w) && w >= 0 && w < 3)).toBe(true);
  });

  it("lets every branch win at least once when there are no more branches than rounds", () => {
    for (const seed of ["a", "node-1", "decision-xyz", "42"]) {
      for (const count of [2, 3, 5, DECISION_CYCLES]) {
        const winners = buildDecisionWinners(seed, count);
        expect(new Set(winners).size).toBe(count);
      }
    }
  });
});

describe("buildPulseTimeline (parallel)", () => {
  it("travels to 75% at the old speed and keeps the 4.2s re-emission cycle", () => {
    const timeline = buildPulseTimeline({ kind: "parallel", group: "g" }, 0);
    expect(timeline.dur).toBe(PARALLEL_CYCLE_S);
    expect(timeline.motionKeyPoints).toBe(`0;${PARALLEL_REACH};${PARALLEL_REACH}`);
    // 예전 끝까지(1.0)를 0.7에 — 같은 속도면 0.75는 0.525에 도달
    expect(timeline.motionKeyTimes).toBe("0;0.525;1");
    const opacity = nums(timeline.opacityValues);
    expect(opacity[nums(timeline.opacityKeyTimes).indexOf(0.525)]).toBe(0);
  });

  it("speeds up 1.25x and turns fully opaque when focused", () => {
    const timeline = buildPulseTimeline({ kind: "parallel", group: "g", focused: true }, 0);
    expect(timeline.dur).toBeCloseTo(PARALLEL_CYCLE_S / FOCUS_SPEED);
    expect(Math.max(...nums(timeline.opacityValues))).toBe(1);
  });

  it("raises the base opacity on the dark L5 sky", () => {
    const light = Math.max(...nums(buildPulseTimeline({ kind: "parallel", group: "g" }, 0).opacityValues));
    const dark = Math.max(...nums(buildPulseTimeline({ kind: "parallel", group: "g", onDark: true }, 0).opacityValues));
    expect(dark).toBeGreaterThan(light);
  });
});

describe("buildDecisionTimeline", () => {
  const winners = [0, 1, 1, 0];
  const stop = 0.15;

  it("keeps keyTimes strictly increasing from 0 to 1 with matching value counts", () => {
    const timeline = buildDecisionTimeline(decision(1, winners), stop);
    for (const [times, values] of [
      [timeline.motionKeyTimes, timeline.motionKeyPoints],
      [timeline.opacityKeyTimes, timeline.opacityValues],
      [timeline.radiusKeyTimes, timeline.radiusValues],
    ] as const) {
      const keys = nums(times);
      expect(keys[0]).toBe(0);
      expect(keys[keys.length - 1]).toBe(1);
      keys.slice(1).forEach((t, i) => expect(t).toBeGreaterThan(keys[i]));
      expect(nums(values)).toHaveLength(keys.length);
    }
    expect(timeline.motionKeySplines.split(";")).toHaveLength(nums(timeline.motionKeyTimes).length - 1);
  });

  it("keeps values in range", () => {
    const timeline = buildDecisionTimeline(decision(0, winners), stop);
    expect(nums(timeline.motionKeyPoints).every((p) => p >= 0 && p <= DECISION_WINNER_REACH)).toBe(true);
    expect(nums(timeline.opacityValues).every((o) => o >= 0 && o <= 1)).toBe(true);
    expect(nums(timeline.radiusValues).every((r) => r > 0)).toBe(true);
  });

  it("lets exactly the winner of each round reach 0.5 while losers never pass the stop point", () => {
    const branches = [0, 1].map((index) => buildDecisionTimeline(decision(index, winners), stop));
    winners.forEach((winner, round) => {
      branches.forEach((timeline, index) => {
        const max = getRoundMax(timeline.motionKeyTimes, timeline.motionKeyPoints, round, winners.length);
        if (index === winner) expect(max).toBe(DECISION_WINNER_REACH);
        else expect(max).toBeLessThanOrEqual(stop);
      });
    });
  });

  it("runs all siblings on the same clock (same dur, one cycle per winner)", () => {
    const [a, b] = [0, 1].map((index) => buildDecisionTimeline(decision(index, winners), stop));
    expect(a.dur).toBe(b.dur);
    expect(a.cycle).toBeCloseTo(getDecisionCycle(2));
    expect(a.dur).toBeCloseTo(getDecisionCycle(2) * winners.length);
    // 모든 갈래가 같은 시각에 멈춤 지점에 닿는다(동시 출발·동시 정지)
    expect(nums(a.motionKeyTimes)[1]).toBe(nums(b.motionKeyTimes)[1]);
  });

  it("speeds focused siblings up by the same factor", () => {
    const normal = buildDecisionTimeline(decision(0, winners), stop);
    const focused = buildDecisionTimeline(decision(0, winners, { focused: true }), stop);
    expect(focused.dur).toBeCloseTo(normal.dur / FOCUS_SPEED);
    expect(focused.cycle).toBeCloseTo(normal.cycle / FOCUS_SPEED);
    expect(focused.motionKeyTimes).toBe(normal.motionKeyTimes);
  });
});

describe("getDecisionTravel", () => {
  it("stops after about one second at the decision speed, capped at 35% of the edge", () => {
    expect(getDecisionTravel(0, 0, 40, 0)).toBe(0.35);
    // 약 105px 이상이면 분기 속도 그대로(상한 미적용)
    expect(getDecisionTravel(0, 0, 120, 0)).toBeCloseTo(DECISION_SPEED_PX_S / 120);
    expect(getDecisionTravel(0, 0, 400, 0)).toBeCloseTo(DECISION_SPEED_PX_S / 400);
  });

  it("dims a focused decision dot slightly so its blinks still lift", () => {
    const focused = buildDecisionTimeline(decision(0, [0, 1], { focused: true }), 0.15);
    const values = nums(focused.opacityValues);
    expect(Math.max(...values)).toBe(1);
    expect(values).toContain(0.9);
  });
});

describe("getPulseStillAt", () => {
  it("freezes a parallel dot where its live run fades out", () => {
    // Arrange
    const pulse = { kind: "parallel" as const, group: "a::__primary__" };

    // Act
    const at = getPulseStillAt(pulse, 0.2);

    // Assert
    expect(at).toBe(PARALLEL_REACH);
  });

  it("freezes a decision dot at the shared stop point so it reads as a pause before the pick", () => {
    // Arrange
    const pulse: DecisionPulse = { kind: "decision", group: "d", index: 1, count: 2, color: "#c7a062", winners: [0, 1] };

    // Act
    const at = getPulseStillAt(pulse, 0.27);

    // Assert
    expect(at).toBe(0.27);
  });
});
