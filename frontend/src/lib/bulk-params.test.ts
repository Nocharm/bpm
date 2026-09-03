import { describe, expect, it } from "vitest";

import { buildBulkAttrPatch, canBulkEditField, isBulkParamField } from "./bulk-params";

describe("canBulkEditField", () => {
  it("people/system은 process·decision만", () => {
    expect(canBulkEditField("process", "people")).toBe(true);
    expect(canBulkEditField("decision", "system")).toBe(true);
    expect(canBulkEditField("subprocess", "people")).toBe(false);
    expect(canBulkEditField("start", "system")).toBe(false);
  });

  it("IO·조건도 process·decision만 - SP는 링크 맵 상속이라 제외", () => {
    expect(canBulkEditField("process", "input")).toBe(true);
    expect(canBulkEditField("decision", "end_condition")).toBe(true);
    expect(canBulkEditField("subprocess", "input")).toBe(false);
    expect(canBulkEditField("start", "output")).toBe(false);
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

  it("IO append(줄 경계 접두 보존)는 정렬 열 유지, 교체·비우기는 정렬 열 소거", () => {
    const existing = { input: "PR\n견적", output: "PO" };
    // append — 기존이 줄 경계 접두로 남으므로 폼·링크 정렬 유효
    expect(buildBulkAttrPatch("input", "PR\n견적\n계약", existing)).toEqual({ input: "PR\n견적\n계약" });
    expect(buildBulkAttrPatch("input", "PR\n견적", existing)).toEqual({ input: "PR\n견적" });
    // 교체 — 인덱스 정렬이 깨지므로 줄 1:1 열을 함께 소거
    expect(buildBulkAttrPatch("input", "발주서", existing))
      .toEqual({ input: "발주서", input_forms: "", input_links: "", input_flags: "" });
    expect(buildBulkAttrPatch("output", "", existing))
      .toEqual({ output: "", output_forms: "", output_ids: "", output_links: "" });
    // 기존이 비어 있으면 정렬 열도 원래 없음 — 소거 패치 포함(무해)
    expect(buildBulkAttrPatch("input", "신규", { input: "", output: "" }))
      .toEqual({ input: "신규", input_forms: "", input_links: "", input_flags: "" });
  });

  it("정렬이 깨지는 IO 교체·비우기는 링크 열도 함께 소거(io-linking §3)", () => {
    const existing = { input: "PR\n견적", output: "PO" };
    // 교체 — 잔존 input_links가 새 텍스트의 엉뚱한 행을 가리키면 전파가 그 행을 원본 값으로 덮어쓴다
    expect(buildBulkAttrPatch("input", "발주서", existing)).toEqual({
      input: "발주서", input_forms: "", input_links: "", input_flags: "",
    });
    // 비우기 — 잔존 output_ids가 남으면 정합화가 지운 항목의 그룹을 되살린다
    expect(buildBulkAttrPatch("output", "", existing)).toEqual({
      output: "", output_forms: "", output_ids: "", output_links: "",
    });
    // append(줄 경계 접두 보존)는 정렬이 유지되므로 링크 열도 보존 — 그룹이 끊기면 안 된다
    expect(buildBulkAttrPatch("input", "PR\n견적\n계약", existing)).toEqual({ input: "PR\n견적\n계약" });
    expect(buildBulkAttrPatch("output", "PO\n검수서", existing)).toEqual({ output: "PO\n검수서" });
  });

  it("조건 필드는 단일 필드 패치(폼 무관)", () => {
    expect(buildBulkAttrPatch("start_condition", "주기 도래")).toEqual({ start_condition: "주기 도래" });
  });
});

describe("isBulkParamField", () => {
  it("system만 false", () => {
    expect(isBulkParamField("system")).toBe(false);
    expect(isBulkParamField("duration")).toBe(true);
    expect(isBulkParamField("fte")).toBe(true);
  });
});

describe("touch_time - 7번째 파라미터 일괄 편집 (design 2026-08-19 §2)", () => {
  it("일반 노드는 편집 가능, SP 노드는 상속 필드라 불가", () => {
    expect(canBulkEditField("process", "touch_time")).toBe(true);
    expect(canBulkEditField("decision", "touch_time")).toBe(true);
    expect(canBulkEditField("subprocess", "touch_time")).toBe(false);
    expect(canBulkEditField("start", "touch_time")).toBe(false);
  });

  it("패치는 단일 필드 통과(비용 배타 무관)", () => {
    expect(buildBulkAttrPatch("touch_time", "2.15")).toEqual({ touch_time: "2.15" });
    expect(buildBulkAttrPatch("touch_time", "")).toEqual({ touch_time: "" });
  });

  it("isBulkParamField가 touch_time을 파라미터로 인식", () => {
    expect(isBulkParamField("touch_time")).toBe(true);
  });
});
