import { describe, expect, it } from "vitest";

import { buildLibraryDeptOptions, buildMyDeptChain } from "./library-dept-options";

describe("buildLibraryDeptOptions", () => {
  it("조직도 부서 ∪ 행에만 있는 부서를 합치고 id순 정렬", () => {
    const dir = [
      { id: "A", name: "A", korean_name: "에이" },
      { id: "A/B", name: "B", korean_name: "" },
    ];
    const out = buildLibraryDeptOptions(dir, ["A/B", "QC Group", null, "QC Group"]);
    expect(out.map((o) => o.id)).toEqual(["A", "A/B", "QC Group"]);
    expect(out[2]).toEqual({ id: "QC Group", name: "QC Group", korean_name: "" });
    expect(out[0].korean_name).toBe("에이");
  });
});

describe("buildMyDeptChain", () => {
  it("org_path는 루트→나 체인, 비면 빈 배열", () => {
    expect(buildMyDeptChain("A/B/C")).toEqual(["A", "A/B", "A/B/C"]);
    expect(buildMyDeptChain("")).toEqual([]);
    expect(buildMyDeptChain(null)).toEqual([]);
  });
});
