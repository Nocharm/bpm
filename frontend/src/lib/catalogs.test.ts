// 카탈로그 순수 함수 — 시스템 정규화·Other 폴백 규칙 (design 2026-09-11 §4.2)
import { describe, expect, it } from "vitest";

import { commitSystem, formatSystem, normalizeToCatalog, OTHER_SYSTEM } from "./catalogs";

const SYSTEMS = [OTHER_SYSTEM, "LIMS", "SAP"];

describe("normalizeToCatalog", () => {
  it("matches case-insensitively and returns the catalog spelling", () => {
    expect(normalizeToCatalog(" lims ", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog("other", SYSTEMS)).toBe("Other");
  });
  it("returns null for empty or unknown values", () => {
    expect(normalizeToCatalog("", SYSTEMS)).toBeNull();
    expect(normalizeToCatalog("Excel", SYSTEMS)).toBeNull();
  });
});

describe("commitSystem", () => {
  it("empty input clears the system and keeps the note", () => {
    expect(commitSystem("  ", SYSTEMS, "memo")).toEqual({ system: "", system_fallback: "memo", keptNote: false });
  });
  it("catalog match stores the catalog spelling and keeps the note", () => {
    expect(commitSystem("sap", SYSTEMS, "memo")).toEqual({ system: "SAP", system_fallback: "memo", keptNote: false });
  });
  it("unknown value becomes Other and fills an empty note with the raw text", () => {
    expect(commitSystem(" Excel macro ", SYSTEMS, "")).toEqual({
      system: "Other", system_fallback: "Excel macro", keptNote: false,
    });
  });
  it("unknown value keeps an existing different note and flags it", () => {
    expect(commitSystem("Excel macro", SYSTEMS, "old memo")).toEqual({
      system: "Other", system_fallback: "old memo", keptNote: true,
    });
  });
  it("unknown value equal to the note is not flagged", () => {
    expect(commitSystem("old memo", SYSTEMS, "old memo")).toEqual({
      system: "Other", system_fallback: "old memo", keptNote: false,
    });
  });
});

describe("formatSystem", () => {
  it("renders Other through the label and passes other values through", () => {
    expect(formatSystem("Other", "기타")).toBe("기타");
    expect(formatSystem("SAP", "기타")).toBe("SAP");
    expect(formatSystem(null, "기타")).toBe("");
  });
});
