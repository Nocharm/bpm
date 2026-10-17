// 드롭 대상 스토어 — 같은 값이면 구독자를 깨우지 않는다(드래그 프레임마다 호출되는 세터).
import { afterEach, describe, expect, it } from "vitest";

import { getDropTarget, getGroupDropTarget, setDropTarget, setGroupDropTarget } from "@/lib/drop-target";

afterEach(() => {
  setDropTarget(null);
  setGroupDropTarget(null);
});

describe("drop-target store", () => {
  it("applies functional updates like a state setter", () => {
    setGroupDropTarget("g1");
    setGroupDropTarget((cur) => (cur === "g1" ? "g2" : cur));
    expect(getGroupDropTarget()).toBe("g2");
  });

  it("keeps identity when the updater returns the current value", () => {
    const target = {
      id: "n1",
      zone: null,
      rect: { left: 0, top: 0, width: 10, height: 10, radius: 20 },
      frontBlocked: false,
      backBlocked: false,
      swapBlocked: false,
    };
    setDropTarget(target);
    setDropTarget((cur) => cur);
    expect(getDropTarget()).toBe(target);
  });
});
