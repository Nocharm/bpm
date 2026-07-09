import { describe, expect, it } from "vitest";

import { DEPT_INFO_EXAMPLE, parseDeptInfoJson } from "./dept-info-import";

describe("parseDeptInfoJson", () => {
  it("parses array format, trims values", () => {
    const res = parseDeptInfoJson(
      '[{"dept": " Sourcing Team 1 ", "koreanName": " 구매1팀 ", "manager": " hong.gildong "}]',
    );
    expect(res).toEqual({
      entries: { "Sourcing Team 1": { korean_name: "구매1팀", manager: "hong.gildong" } },
    });
  });

  it("allows missing koreanName or manager (partial entry)", () => {
    const res = parseDeptInfoJson('[{"dept": "A Team", "manager": "kim.cs"}]');
    expect(res).toEqual({ entries: { "A Team": { korean_name: "", manager: "kim.cs" } } });
  });

  it("drops entries with both fields blank and entries without dept", () => {
    const res = parseDeptInfoJson(
      '[{"dept": "A Team", "koreanName": " ", "manager": ""}, {"koreanName": "고아"}]',
    );
    expect(res).toEqual({ entries: {} });
  });

  it("last entry wins on duplicate dept", () => {
    const res = parseDeptInfoJson(
      '[{"dept": "A Team", "koreanName": "에이팀"}, {"dept": "A Team", "koreanName": "A팀"}]',
    );
    expect(res).toEqual({ entries: { "A Team": { korean_name: "A팀", manager: "" } } });
  });

  it("rejects invalid JSON, non-array roots, non-object items", () => {
    expect(parseDeptInfoJson("{oops")).toHaveProperty("error");
    expect(parseDeptInfoJson('{"dept": "A"}')).toHaveProperty("error");
    expect(parseDeptInfoJson('["str"]')).toHaveProperty("error");
  });

  it("rejects non-string field values", () => {
    expect(parseDeptInfoJson('[{"dept": "A Team", "koreanName": 1}]')).toHaveProperty("error");
  });

  it("example string parses cleanly", () => {
    expect(parseDeptInfoJson(DEPT_INFO_EXAMPLE)).toHaveProperty("entries");
  });
});
