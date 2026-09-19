import { describe, expect, it } from "vitest";

import {
  NODE_DISPLAY_TOGGLES,
  parseDisplayToggles,
  setDisplayCategory,
  toggleDisplayToggle,
} from "./node-actions";

describe("toggleDisplayToggle / setDisplayCategory", () => {
  it("단일 토글은 있으면 빼고 없으면 뒤에 붙인다", () => {
    expect(toggleDisplayToggle(["assignee", "params"], "params")).toEqual(["assignee"]);
    expect(toggleDisplayToggle(["assignee"], "system")).toEqual(["assignee", "system"]);
  });

  it("카테고리 켜기는 빠진 것만 덧붙이고 기존 순서를 유지한다", () => {
    expect(setDisplayCategory(["params", "system"], ["assignee", "system", "url"], true)).toEqual([
      "params", "system", "assignee", "url",
    ]);
  });

  it("카테고리 끄기는 해당 필드만 제거한다(전체 끄기 = 빈 배열)", () => {
    expect(setDisplayCategory(["params", "system", "assignee"], ["assignee", "system"], false)).toEqual(["params"]);
    expect(setDisplayCategory(["params", "system"], NODE_DISPLAY_TOGGLES, false)).toEqual([]);
  });
});

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

it("NODE_DISPLAY_TOGGLES는 속성 4 + IO 2 + 조건 묶음 1 + params + gmp", () => {
  expect(NODE_DISPLAY_TOGGLES).toEqual([
    "assignee", "department", "system", "url",
    "input", "output", "conditions",
    "params", "gmp",
  ]);
});
