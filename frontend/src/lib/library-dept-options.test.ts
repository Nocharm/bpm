import { describe, expect, it } from "vitest";

import {
  buildDeptPathIndex,
  buildLibraryDeptOptions,
  buildMyDeptChain,
  resolveDepartmentPaths,
} from "./library-dept-options";

// sp_department는 리프명으로 저장된 경우가 많다 — 같은 리프가 두 상위에 있는 조직도로 중의성까지 본다.
const ORG_DIR = [
  { id: "Growth Center", name: "Growth Center", korean_name: "" },
  {
    id: "Growth Center/Marketing Office/Brand Team/Brand Part 1",
    name: "Brand Part 1",
    korean_name: "",
  },
  { id: "Operations Center", name: "Operations Center", korean_name: "" },
  { id: "Operations Center/Delivery Office/Brand Part 1", name: "Brand Part 1", korean_name: "" },
];

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

  it("리프명으로 저장된 행 부서는 조직도 경로로 흡수 — 중복 루트를 만들지 않는다", () => {
    const out = buildLibraryDeptOptions(ORG_DIR, ["Brand Part 1", "QC Group"]);
    expect(out.map((o) => o.id)).toEqual([
      "Growth Center",
      "Growth Center/Marketing Office/Brand Team/Brand Part 1",
      "Operations Center",
      "Operations Center/Delivery Office/Brand Part 1",
      "QC Group",
    ]);
  });
});

describe("resolveDepartmentPaths", () => {
  const index = buildDeptPathIndex(ORG_DIR);

  it("이미 전체 경로면 그대로", () => {
    expect(resolveDepartmentPaths("Growth Center", index)).toEqual(["Growth Center"]);
  });

  it("리프명은 같은 리프를 가진 조직도 경로 전부로 해석(중의성 허용)", () => {
    expect(resolveDepartmentPaths("Brand Part 1", index)).toEqual([
      "Growth Center/Marketing Office/Brand Team/Brand Part 1",
      "Operations Center/Delivery Office/Brand Part 1",
    ]);
  });

  it("조직도에 없는 값은 원문 그대로(자기 자신이 루트)", () => {
    expect(resolveDepartmentPaths("QC Group", index)).toEqual(["QC Group"]);
  });
});

describe("buildMyDeptChain", () => {
  it("org_path는 루트→나 체인, 비면 빈 배열", () => {
    expect(buildMyDeptChain("A/B/C")).toEqual(["A", "A/B", "A/B/C"]);
    expect(buildMyDeptChain("")).toEqual([]);
    expect(buildMyDeptChain(null)).toEqual([]);
  });
});
