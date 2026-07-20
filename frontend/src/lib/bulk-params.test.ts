import { describe, expect, it } from "vitest";

import { buildBulkAttrPatch, canBulkEditField, isBulkParamField } from "./bulk-params";

describe("canBulkEditField", () => {
  it("people/system은 process·decision만", () => {
    expect(canBulkEditField("process", "people")).toBe(true);
    expect(canBulkEditField("decision", "system")).toBe(true);
    expect(canBulkEditField("subprocess", "people")).toBe(false);
    expect(canBulkEditField("start", "system")).toBe(false);
  });

  it("subprocess는 annual_count·fte만 파라미터 일괄 대상", () => {
    expect(canBulkEditField("subprocess", "annual_count")).toBe(true);
    expect(canBulkEditField("subprocess", "fte")).toBe(true);
    expect(canBulkEditField("subprocess", "duration")).toBe(false);
    expect(canBulkEditField("subprocess", "cost_krw")).toBe(false);
  });

  it("process는 6필드 전부, start/end는 없음", () => {
    expect(canBulkEditField("process", "cost_usd")).toBe(true);
    expect(canBulkEditField("end", "fte")).toBe(false);
  });
});

describe("buildBulkAttrPatch", () => {
  it("비용 설정은 반대 통화를 명시적으로 비운다", () => {
    expect(buildBulkAttrPatch("cost_krw", "5000")).toEqual({ cost_krw: "5000", cost_usd: "" });
    expect(buildBulkAttrPatch("cost_usd", "10")).toEqual({ cost_usd: "10", cost_krw: "" });
  });

  it("비용 비우기는 양쪽 통화를 함께 비운다", () => {
    expect(buildBulkAttrPatch("cost_krw", "")).toEqual({ cost_krw: "", cost_usd: "" });
    expect(buildBulkAttrPatch("cost_usd", "")).toEqual({ cost_krw: "", cost_usd: "" });
  });

  it("비용 외 필드는 단일 필드 패치", () => {
    expect(buildBulkAttrPatch("system", "SAP")).toEqual({ system: "SAP" });
    expect(buildBulkAttrPatch("duration", "1.15")).toEqual({ duration: "1.15" });
  });
});

describe("isBulkParamField", () => {
  it("system만 false", () => {
    expect(isBulkParamField("system")).toBe(false);
    expect(isBulkParamField("duration")).toBe(true);
    expect(isBulkParamField("fte")).toBe(true);
  });
});
