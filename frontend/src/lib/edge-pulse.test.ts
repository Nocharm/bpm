import { describe, expect, it } from "vitest";

import {
  assignEdgePulses,
  buildPulseTimeline,
  DECISION_SLOT_S,
  getDecisionTravel,
  PARALLEL_CYCLE_S,
} from "./edge-pulse";

const node = (id: string, nodeType: string, parallelOutputs?: string[]) => ({ id, nodeType, parallelOutputs, color: "#c7a062" });

describe("assignEdgePulses", () => {
  it("gives every branch of a parallel exit the parallel pulse", () => {
    const pulses = assignEdgePulses(
      [node("A", "process", ["__primary__"])],
      [{ id: "e1", source: "A" }, { id: "e2", source: "A" }],
    );
    expect(pulses.get("e1")).toEqual({ kind: "parallel" });
    expect(pulses.get("e2")).toEqual({ kind: "parallel" });
  });

  it("numbers decision branches in order and skips hidden edges", () => {
    const pulses = assignEdgePulses(
      [node("D", "decision")],
      [{ id: "y", source: "D" }, { id: "h", source: "D", hidden: true }, { id: "n", source: "D" }],
    );
    expect(pulses.get("y")).toEqual({ kind: "decision", index: 0, count: 2, color: "#c7a062" });
    expect(pulses.get("n")).toEqual({ kind: "decision", index: 1, count: 2, color: "#c7a062" });
    expect(pulses.has("h")).toBe(false);
  });

  it("leaves plain outputs and single edges without a pulse", () => {
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
  });
});

describe("buildPulseTimeline", () => {
  it("runs parallel pulses over the whole edge on a shared cycle", () => {
    const timeline = buildPulseTimeline({ kind: "parallel" }, 0);
    expect(timeline.dur).toBe(PARALLEL_CYCLE_S);
    expect(timeline.begin).toBe(0);
    expect(timeline.motionKeyPoints).toBe("0;1;1");
  });

  it("shows a decision branch only in its own slot and travels a short way", () => {
    const timeline = buildPulseTimeline({ kind: "decision", index: 1, count: 2, color: "x" }, 0.2);
    expect(timeline.dur).toBe(DECISION_SLOT_S * 2);
    expect(timeline.begin).toBe(DECISION_SLOT_S);
    expect(timeline.motionKeyPoints).toBe("0;0;0.2;0.2");
    expect(timeline.motionKeyTimes).toBe("0;0.2;0.425;1");
    expect(timeline.opacityValues.split(";")).toHaveLength(timeline.opacityKeyTimes.split(";").length);
  });
});

describe("getDecisionTravel", () => {
  it("caps the travel to half of the edge", () => {
    expect(getDecisionTravel(0, 0, 40, 0)).toBe(0.5);
    expect(getDecisionTravel(0, 0, 280, 0)).toBeCloseTo(0.2);
  });
});
