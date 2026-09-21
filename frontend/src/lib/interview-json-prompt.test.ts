import { describe, expect, it } from "vitest";

import { buildInterviewJsonPromptText } from "./interview-json-prompt";

describe("external AI prompt for interview JSON 0.5", () => {
  it("carries the schema skeleton, key rules and the target L5", () => {
    const text = buildInterviewJsonPromptText({ code: "19-01-02-01-01", name: "정제수 일상 점검", path: ["EPCV", "Facility", "유틸리티 운전", "정제수 시스템 운전"] });
    expect(text).toContain('"schema_version": "0.5-bpm-interface-draft"');
    expect(text).toContain("19-01-02-01-01");
    expect(text).toContain("EPCV > Facility > 유틸리티 운전 > 정제수 시스템 운전 > 정제수 일상 점검");
    for (const key of ["taskId", "l6", "ownerRole", "fields", "actions", "relations", "entry", "edges", "externalTasks"]) {
      expect(text).toContain(key);
    }
    expect(text).toContain("src/dst");
    expect(text).not.toContain("—");
    const skeletonStart = text.indexOf("{");
    const skeleton = text.slice(skeletonStart, text.lastIndexOf("}") + 1);
    expect(() => JSON.parse(skeleton)).not.toThrow();
  });

  it("works without a target", () => {
    expect(buildInterviewJsonPromptText()).toContain("nodeCode");
  });
});
