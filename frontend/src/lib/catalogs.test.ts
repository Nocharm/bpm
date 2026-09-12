// 카탈로그 순수 함수 — 시스템 정규화·별칭 매칭·Other 폴백 규칙 (design 2026-09-11 §4.2, 2026-09-12 §1)
import { describe, expect, it } from "vitest";

import { appendSystemNote, commitRole, commitSystem, formatSystem, normalizeToCatalog, OTHER_SYSTEM } from "./catalogs";

const SYSTEMS = [
  { value: OTHER_SYSTEM, aliases: ["기타"] },
  { value: "LIMS", aliases: ["랩정보", "lab info"] },
  { value: "SAP", aliases: [] },
];

// BE app_settings.commit_role과 동치 (design 2026-09-12)
describe("commitRole", () => {
  const ROLES = [{ value: "Buyer", aliases: ["구매 담당자"] }];
  it("maps an alias or case-variant to the canonical role", () => {
    expect(commitRole(" 구매 담당자 ", ROLES)).toBe("Buyer");
    expect(commitRole("buyer", ROLES)).toBe("Buyer");
  });
  it("keeps a trimmed free-text role when nothing matches (no Other fallback for roles)", () => {
    expect(commitRole("  QA reviewer ", ROLES)).toBe("QA reviewer");
    expect(commitRole("", ROLES)).toBe("");
  });
});

describe("normalizeToCatalog", () => {
  it("matches case-insensitively and returns the catalog spelling", () => {
    expect(normalizeToCatalog(" lims ", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog("other", SYSTEMS)).toBe("Other");
  });
  it("returns null for empty or unknown values", () => {
    expect(normalizeToCatalog("", SYSTEMS)).toBeNull();
    expect(normalizeToCatalog("Excel", SYSTEMS)).toBeNull();
  });
  it("matches an alias and returns the canonical value", () => {
    expect(normalizeToCatalog("랩정보", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog(" LAB INFO ", SYSTEMS)).toBe("LIMS");
    expect(normalizeToCatalog("기타", SYSTEMS)).toBe("Other");
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
  it("alias input stores the canonical system, not Other", () => {
    expect(commitSystem("랩정보", SYSTEMS, "memo")).toEqual({ system: "LIMS", system_fallback: "memo", keptNote: false });
  });
});

describe("appendSystemNote", () => {
  it("returns the raw text when the existing note is empty", () => {
    expect(appendSystemNote("", "Excel macro")).toBe("Excel macro");
  });
  it("appends the raw text on a new line after the existing note", () => {
    expect(appendSystemNote("old", "new")).toBe("old\nnew");
  });
  it("trims trailing whitespace off the existing note and surrounding whitespace off the raw text", () => {
    expect(appendSystemNote("old   \n", "  new  ")).toBe("old\nnew");
  });
});

describe("formatSystem", () => {
  it("renders Other through the label and passes other values through", () => {
    expect(formatSystem("Other", "기타")).toBe("기타");
    expect(formatSystem("SAP", "기타")).toBe("SAP");
    expect(formatSystem(null, "기타")).toBe("");
  });
});
