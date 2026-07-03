import { describe, expect, it } from "vitest";

import {
  addAssignee,
  deptOf,
  driftedAssignees,
  formatAssignees,
  parseAssignees,
} from "./assignee";

const USERS = [
  { name: "홍길동", department: "구매팀" },
  { name: "김철수", department: "구매팀" },
  { name: "이영희", department: "품질팀" },
];

describe("parse/format", () => {
  it("parses comma list, trims, drops blanks", () => {
    expect(parseAssignees("홍길동, 김철수 ,")).toEqual(["홍길동", "김철수"]);
    expect(parseAssignees("")).toEqual([]);
  });
  it("formats with comma-space", () => {
    expect(formatAssignees(["홍길동", "김철수"])).toBe("홍길동, 김철수");
  });
});

describe("deptOf", () => {
  it("returns current dept or null", () => {
    expect(deptOf("홍길동", USERS)).toBe("구매팀");
    expect(deptOf("없음", USERS)).toBeNull();
  });
});

describe("addAssignee", () => {
  it("sets department from the first assignee when empty", () => {
    expect(addAssignee("", [], "홍길동", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동"],
    });
  });
  it("adds a same-department assignee", () => {
    expect(addAssignee("구매팀", ["홍길동"], "김철수", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동", "김철수"],
    });
  });
  it("rejects a different-department assignee (unchanged)", () => {
    expect(addAssignee("구매팀", ["홍길동"], "이영희", USERS)).toEqual({
      department: "구매팀",
      assignees: ["홍길동"],
    });
  });
  it("de-dupes", () => {
    expect(addAssignee("구매팀", ["홍길동"], "홍길동", USERS).assignees).toEqual(["홍길동"]);
  });
});

describe("driftedAssignees", () => {
  it("flags assignees whose current dept differs or is missing", () => {
    // 이영희 was assigned but is now 품질팀 while node is 구매팀 → drift
    expect(driftedAssignees("구매팀", ["홍길동", "이영희", "없음"], USERS)).toEqual([
      "이영희",
      "없음",
    ]);
    expect(driftedAssignees("구매팀", ["홍길동", "김철수"], USERS)).toEqual([]);
  });
});
