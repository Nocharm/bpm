import { describe, expect, it } from "vitest";

import { getEditableParamFields, PARAM_FIELDS, SP_PARAM_FIELDS } from "./params";

describe("PARAM_FIELDS", () => {
  it("표시 순서는 소요시간 → 비용(원/달러) → 인원 → 연간 건수 → FTE", () => {
    expect([...PARAM_FIELDS]).toEqual([
      "duration",
      "cost_krw",
      "cost_usd",
      "headcount",
      "annual_count",
      "fte",
    ]);
  });
});

describe("getEditableParamFields", () => {
  it("일반 노드는 6필드 전부 편집 가능", () => {
    expect([...getEditableParamFields("process")]).toEqual([...PARAM_FIELDS]);
    expect([...getEditableParamFields("decision")]).toEqual([...PARAM_FIELDS]);
  });

  it("서브프로세스 노드는 연간 건수·FTE만 편집 가능 — 나머지는 링크 맵 지정값", () => {
    expect([...getEditableParamFields("subprocess")]).toEqual(["annual_count", "fte"]);
  });

  it("start/end는 파라미터 없음", () => {
    expect(getEditableParamFields("start")).toHaveLength(0);
    expect(getEditableParamFields("end")).toHaveLength(0);
  });

  it("SP 지정 파라미터는 3종(비용 2필드 포함)", () => {
    expect([...SP_PARAM_FIELDS]).toEqual(["duration", "cost_krw", "cost_usd", "headcount"]);
  });
});
