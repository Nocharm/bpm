import { describe, expect, it } from "vitest";

import { NODE_DISPLAY_TOGGLES, parseDisplayToggles } from "./node-actions";

describe("parseDisplayToggles", () => {
  it("v2 저장값이 있으면 그대로(유효 필드만)", () => {
    expect(parseDisplayToggles('["assignee","params"]', null)).toEqual(["assignee", "params"]);
    expect(parseDisplayToggles('["assignee","bogus"]', '["system"]')).toEqual(["assignee"]);
  });

  it("v2에서 params를 끈 상태를 존중한다", () => {
    expect(parseDisplayToggles('["assignee"]', null)).toEqual(["assignee"]);
  });

  it("레거시 저장값만 있으면 params를 켜서 이관(칩은 항상 표시였음)", () => {
    expect(parseDisplayToggles(null, '["assignee","url"]')).toEqual(["assignee", "url", "params"]);
    expect(parseDisplayToggles(null, '["duration"]')).toEqual(["params"]);
  });

  it("둘 다 없거나 파싱 불가면 null(기본값 유지)", () => {
    expect(parseDisplayToggles(null, null)).toBeNull();
    expect(parseDisplayToggles("not json", null)).toBeNull();
  });
});

it("NODE_DISPLAY_TOGGLES는 4속성 + params", () => {
  expect(NODE_DISPLAY_TOGGLES).toEqual(["assignee", "department", "system", "url", "params"]);
});
