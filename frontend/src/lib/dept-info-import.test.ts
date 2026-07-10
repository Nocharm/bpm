import { describe, expect, it } from "vitest";

import { DEPT_INFO_EXAMPLE, parseDeptInfoJson } from "./dept-info-import";

describe("parseDeptInfoJson", () => {
  it("walks the tree and collects every level, ignoring `flat`", () => {
    const res = parseDeptInfoJson(
      JSON.stringify({
        flat: [{ enDeptNm: "Should Be Ignored", deptNm: "무시됨" }],
        tree: [
          {
            deptCd: 1000,
            enDeptNm: "Management Division",
            deptNm: "경영지원본부",
            dheadUserId: "kim.ceo",
            dheadFnm: "김대표",
            children: [
              {
                enDeptNm: "HR Office",
                deptNm: "인사실",
                dheadUserId: "lee.hr",
                children: [{ enDeptNm: "HR Team 1", deptNm: "인사1팀", dheadUserId: "park.t1" }],
              },
            ],
          },
        ],
      }),
    );
    expect(res).toEqual({
      entries: {
        "Management Division": { korean_name: "경영지원본부", manager: "kim.ceo" },
        "HR Office": { korean_name: "인사실", manager: "lee.hr" },
        "HR Team 1": { korean_name: "인사1팀", manager: "park.t1" },
      },
    });
  });

  it("trims values and tolerates missing/null optional fields", () => {
    const res = parseDeptInfoJson(
      '{"tree": [{"enDeptNm": " A Team ", "deptNm": " 에이팀 ", "dheadUserId": null}]}',
    );
    expect(res).toEqual({ entries: { "A Team": { korean_name: "에이팀", manager: "" } } });
  });

  it("skips wrapper nodes without enDeptNm but still walks their children", () => {
    const res = parseDeptInfoJson(
      '{"tree": [{"deptNm": "루트래퍼", "children": [{"enDeptNm": "B Team", "dheadUserId": "kim.b"}]}]}',
    );
    expect(res).toEqual({ entries: { "B Team": { korean_name: "", manager: "kim.b" } } });
  });

  it("drops nodes whose korean name and manager are both blank, but keeps walking children", () => {
    const res = parseDeptInfoJson(
      '{"tree": [{"enDeptNm": "Blank Div", "deptNm": " ", "dheadUserId": "", "children": [{"enDeptNm": "C Team", "deptNm": "씨팀"}]}]}',
    );
    expect(res).toEqual({ entries: { "C Team": { korean_name: "씨팀", manager: "" } } });
  });

  it("last node wins on duplicate enDeptNm", () => {
    const res = parseDeptInfoJson(
      '{"tree": [{"enDeptNm": "A Team", "deptNm": "에이팀"}, {"enDeptNm": "A Team", "deptNm": "A팀"}]}',
    );
    expect(res).toEqual({ entries: { "A Team": { korean_name: "A팀", manager: "" } } });
  });

  it("treats an empty or absent children array as a leaf", () => {
    const res = parseDeptInfoJson(
      '{"tree": [{"enDeptNm": "Leaf One", "deptNm": "리프1", "children": []}, {"enDeptNm": "Leaf Two", "deptNm": "리프2"}]}',
    );
    expect(res).toEqual({
      entries: {
        "Leaf One": { korean_name: "리프1", manager: "" },
        "Leaf Two": { korean_name: "리프2", manager: "" },
      },
    });
  });

  it("rejects invalid JSON and roots without a tree array", () => {
    expect(parseDeptInfoJson("{oops")).toHaveProperty("error");
    expect(parseDeptInfoJson("[]")).toHaveProperty("error");
    expect(parseDeptInfoJson('{"flat": []}')).toHaveProperty("error");
    expect(parseDeptInfoJson('{"tree": {}}')).toHaveProperty("error");
  });

  it("rejects non-object nodes, non-array children, and non-string fields", () => {
    expect(parseDeptInfoJson('{"tree": ["str"]}')).toHaveProperty("error");
    expect(parseDeptInfoJson('{"tree": [{"enDeptNm": "A", "children": {}}]}')).toHaveProperty("error");
    expect(parseDeptInfoJson('{"tree": [{"enDeptNm": "A", "deptNm": 1}]}')).toHaveProperty("error");
    expect(parseDeptInfoJson('{"tree": [{"enDeptNm": 42}]}')).toHaveProperty("error");
  });

  it("example string parses cleanly", () => {
    expect(parseDeptInfoJson(DEPT_INFO_EXAMPLE)).toHaveProperty("entries");
  });
});
