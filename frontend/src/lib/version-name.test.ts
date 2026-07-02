import { describe, expect, it } from "vitest";

import { formatVersionMarker, formatVersionName, nextVersionNumber } from "@/lib/version-name";

describe("formatVersionName", () => {
  it("returns 'v{n} · {label}' when version_number is present", () => {
    // Arrange
    const version = { version_number: 3, label: "To-Be" };
    // Act
    const result = formatVersionName(version);
    // Assert
    expect(result).toBe("v3 · To-Be");
  });

  it("returns label only when version_number is null", () => {
    // Arrange
    const version = { version_number: null, label: "Draft" };
    // Act
    const result = formatVersionName(version);
    // Assert
    expect(result).toBe("Draft");
  });

  it("returns 'v0 · {label}' when version_number is 0 (falsy but not null)", () => {
    // Arrange — function uses != null so 0 must produce a prefix
    const version = { version_number: 0, label: "X" };
    // Act
    const result = formatVersionName(version);
    // Assert
    expect(result).toBe("v0 · X");
  });
});

describe("nextVersionNumber", () => {
  it("returns max version_number + 1", () => {
    expect(nextVersionNumber([{ version_number: 1 }, { version_number: 2 }, { version_number: null }])).toBe(3);
  });
  it("returns 1 when no version has a number", () => {
    expect(nextVersionNumber([{ version_number: null }, { version_number: null }])).toBe(1);
  });
});

describe("formatVersionMarker", () => {
  const all = [{ version_number: 1 }, { version_number: 2 }, { version_number: null }];

  it("returns 'v{n}' for a numbered version", () => {
    expect(formatVersionMarker({ version_number: 2 }, all)).toBe("v2");
  });

  it("returns 'version {n}' with long option", () => {
    expect(formatVersionMarker({ version_number: 2 }, all, { long: true })).toBe("version 2");
  });

  it("returns '(Draft)v.{next}' for a draft (no number)", () => {
    expect(formatVersionMarker({ version_number: null }, all)).toBe("(Draft)v.3");
  });

  it("marks the first draft as (Draft)v.1 when nothing is numbered", () => {
    expect(formatVersionMarker({ version_number: null }, [{ version_number: null }])).toBe("(Draft)v.1");
  });
});
