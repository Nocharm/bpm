// 확정 게이트 6행 합성 — 위반만 담긴 failures를 고정 6행으로 펼치는지 검증
import { describe, expect, it } from "vitest";

import type { ConfirmReadiness } from "./api";
import { buildGateChecklist, GATE_CODES } from "./framework-gates";

describe("buildGateChecklist", () => {
  it("readiness가 null이면 6행 모두 통과로 취급", () => {
    const rows = buildGateChecklist(null);
    expect(rows).toHaveLength(GATE_CODES.length);
    expect(rows.every((row) => row.passed && row.count === 0 && row.nodeIds.length === 0)).toBe(true);
  });

  it("failures에 있는 코드만 위반 행으로 표시", () => {
    const readiness: ConfirmReadiness = {
      ready: false,
      failures: [
        { code: "placeholder", count: 2, node_ids: ["n1", "n2"] },
        { code: "noexit_cycle", count: 1, node_ids: ["n3"] },
      ],
    };
    const rows = buildGateChecklist(readiness);
    const byCode = new Map(rows.map((row) => [row.code, row]));

    expect(byCode.get("placeholder")).toEqual({
      code: "placeholder",
      passed: false,
      count: 2,
      nodeIds: ["n1", "n2"],
    });
    expect(byCode.get("noexit_cycle")).toEqual({
      code: "noexit_cycle",
      passed: false,
      count: 1,
      nodeIds: ["n3"],
    });
    // 나머지 4개는 통과
    expect(rows.filter((row) => row.passed)).toHaveLength(GATE_CODES.length - 2);
  });
});
