import { describe, expect, it } from "vitest";

import { pickActiveSection } from "./section-spy";

describe("pickActiveSection", () => {
  it("returns null without sections", () => {
    expect(pickActiveSection([], false)).toBeNull();
  });

  it("picks the first section at the top of the page", () => {
    const sections = [
      { id: "info", top: 24 },
      { id: "visibility", top: 400 },
    ];
    expect(pickActiveSection(sections, false)).toBe("info");
  });

  it("picks the last section whose head passed the line", () => {
    const sections = [
      { id: "info", top: -700 },
      { id: "visibility", top: -200 },
      { id: "collaborators", top: 40 },
      { id: "approvers", top: 500 },
    ];
    expect(pickActiveSection(sections, false)).toBe("collaborators");
  });

  it("picks the last section at the bottom even when its head never reaches the line", () => {
    const sections = [
      { id: "versions", top: -100 },
      { id: "checkout", top: 380 },
      { id: "danger", top: 620 },
    ];
    expect(pickActiveSection(sections, true)).toBe("danger");
  });
});
