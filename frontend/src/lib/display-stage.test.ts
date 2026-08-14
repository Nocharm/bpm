import { describe, expect, it } from "vitest";

import { pickDisplayStage } from "./display-stage";

describe("pickDisplayStage", () => {
  const widths = [500, 420, 360, 300]; // S0~S3 소요 폭

  it("최상 단계가 들어가면 0", () => {
    expect(pickDisplayStage(508, widths)).toBe(0);
  });

  it("여유 미달 시 다음 단계로 내려간다(margin 8 포함)", () => {
    expect(pickDisplayStage(507, widths)).toBe(1);
    expect(pickDisplayStage(428, widths)).toBe(1);
    expect(pickDisplayStage(427, widths)).toBe(2);
  });

  it("측정된 전 단계가 안 들어가면 최종 강등(stageWidths.length)", () => {
    expect(pickDisplayStage(307, widths)).toBe(4);
  });

  it("측정 전(0 이하 폭 존재)·빈 배열은 0 유지(강등 금지)", () => {
    expect(pickDisplayStage(400, [500, 0, 360, 300])).toBe(0);
    expect(pickDisplayStage(400, [])).toBe(0);
  });
});
