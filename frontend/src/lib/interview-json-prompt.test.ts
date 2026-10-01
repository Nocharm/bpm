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

  it("lists the same fields keys as the adapter in the rule line and the skeleton", () => {
    // 어댑터 backend/scripts/consultant_interview.py _FIELD_KEYS 사본(별칭 done_criterial 제외) — 어댑터가 바뀌면 같이 옮긴다
    const adapterFieldKeys = [
      "start_condition", "input_data", "output_data", "done_criteria", "systems", "total_time", "total_time_min",
      "touch_time", "touch_time_min", "frequency", "annual_count", "headcount", "fte", "gmp", "artifact_role",
    ];
    const text = buildInterviewJsonPromptText();
    const skeleton: unknown = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const rows = typeof skeleton === "object" && skeleton !== null && "rows" in skeleton ? skeleton.rows : [];
    const firstRow: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const fields = typeof firstRow === "object" && firstRow !== null && "fields" in firstRow ? firstRow.fields : {};
    expect(Object.keys(fields ?? {}).sort()).toEqual([...adapterFieldKeys].sort());
    const ruleLine = text.split("\n").find((line) => line.startsWith("- fields: ")) ?? "";
    for (const key of adapterFieldKeys) expect(ruleLine).toContain(key);
    expect(text).toContain("분 단위 정수");
  });

  it("states one connection per activity and the parallel branch form", () => {
    const text = buildInterviewJsonPromptText();
    expect(text).toContain("한 활동에서 나가는 연결은 하나입니다");
    expect(text).toContain("branch + parallel");
  });

  it("forbids loop or bypass next to parallel branches of the same activity", () => {
    const text = buildInterviewJsonPromptText();
    const ruleLine = text.split("\n").find((line) => line.includes("loop나 bypass를 같이 내보내지 마세요")) ?? "";
    expect(ruleLine).toContain("branch + parallel");
    expect(ruleLine).toContain("decision");
    expect(ruleLine).not.toContain("—");
  });

  it("uses only adapter action keys in the skeleton action", () => {
    // 어댑터 backend/scripts/consultant_interview.py _ACTION_KEYS 사본 — 어댑터가 바뀌면 같이 옮긴다
    const adapterActionKeys = [
      "seq", "label", "name", "kind", "variant", "rule", "input", "output", "system", "screen", "dataForm", "quote",
    ];
    // 골격에 일부러 싣지 않는 키 — 인터뷰 현장 기록(화면·데이터 폼·발언 인용)이라 문서를 읽는 외부 AI가 지어내지 않게 한다
    const omittedFromSkeleton = ["screen", "dataForm", "quote"];
    const text = buildInterviewJsonPromptText();
    const skeleton: unknown = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const rows = typeof skeleton === "object" && skeleton !== null && "rows" in skeleton ? skeleton.rows : [];
    const firstRow: unknown = Array.isArray(rows) ? rows[0] : undefined;
    const actions = typeof firstRow === "object" && firstRow !== null && "actions" in firstRow ? firstRow.actions : [];
    const firstAction: unknown = Array.isArray(actions) ? actions[0] : undefined;
    const actionKeys = typeof firstAction === "object" && firstAction !== null ? Object.keys(firstAction) : [];

    expect(actionKeys.sort()).toEqual(adapterActionKeys.filter((key) => !omittedFromSkeleton.includes(key)).sort());
  });

  it("works without a target", () => {
    expect(buildInterviewJsonPromptText()).toContain("nodeCode");
  });

  it("shows input/output as arrays in the skeleton", () => {
    const text = buildInterviewJsonPromptText(undefined);
    expect(text).toMatch(/"input":\s*\[\]/);
    expect(text).toMatch(/"output":\s*\[\]/);
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
