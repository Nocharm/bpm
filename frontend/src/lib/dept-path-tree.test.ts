import { describe, expect, it } from "vitest";

import { buildDeptPathTree, collectDeptMatches } from "./dept-path-tree";

describe("buildDeptPathTree", () => {
  it("목록에 없는 중간 경로를 채우고 세그먼트별로 중첩한다", () => {
    const roots = buildDeptPathTree([
      { id: "A/B/C", name: "C" },
      { id: "A", name: "A" },
    ]);
    expect(roots.map((r) => r.path)).toEqual(["A"]);
    expect(roots[0].children[0].path).toBe("A/B");
    expect(roots[0].children[0].children[0].path).toBe("A/B/C");
    expect(roots[0].children[0].depth).toBe(1);
  });
});

describe("collectDeptMatches", () => {
  it("빈 검색어는 null, 매치는 조상+후손까지 포함", () => {
    const roots = buildDeptPathTree([
      { id: "A/B/C", name: "C" },
      { id: "A/D", name: "D" },
    ]);
    expect(collectDeptMatches(roots, "  ")).toBeNull();
    const hit = collectDeptMatches(roots, "b");
    expect(hit && [...hit].sort()).toEqual(["A", "A/B", "A/B/C"]);
  });
});
