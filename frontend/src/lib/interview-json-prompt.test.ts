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

  it("lists the existing L6 maps and how to update or keep them", () => {
    const text = buildInterviewJsonPromptText({
      code: "19-01",
      name: "정제수 일상 점검",
      path: ["EPCV"],
      existingL6: [{ code: "x-01", name: "접수" }],
    });
    expect(text).toContain("[이미 있는 L6]");
    expect(text).toContain("x-01");
    expect(text).toContain("접수");
    expect(text).toContain("같은 taskId로 rows에 넣으면 갱신되고 빼면 그대로 둔다");
    expect(text).not.toContain("—");
  });

  it("omits the existing L6 clause when there is none", () => {
    const text = buildInterviewJsonPromptText({ code: "19-01", name: "정제수 일상 점검", path: ["EPCV"] });
    expect(text).not.toContain("[이미 있는 L6]");
    expect(text).not.toContain("같은 taskId로 rows에 넣으면 갱신되고 빼면 그대로 둔다");
  });
});
