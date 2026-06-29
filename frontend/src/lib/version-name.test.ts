import { describe, expect, it } from "vitest";

import { formatVersionName } from "@/lib/version-name";

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
