import { describe, expect, it } from "vitest";

import { buildOrgTree, filterMyDeptMaps, type OrgNode } from "@/lib/org-tree";
import type { DirectoryDept, MapSummary } from "@/lib/api";

function makeMap(id: number, dept: string | null): MapSummary {
  return {
    id, name: `Map ${id}`, description: "", created_by: "u", created_at: "", updated_at: "",
    my_role: "owner", visibility: "public", latest_version_status: "draft",
    owning_department: dept,
  } as MapSummary;
}
function dept(id: string, korean: string = ""): DirectoryDept {
  return { id, name: id.split("/").pop() ?? id, korean_name: korean, manager: "" } as DirectoryDept;
}

describe("buildOrgTree", () => {
  it("nests by org_path prefix and rolls up mapCount", () => {
    const depts = [dept("Div"), dept("Div/OfficeA"), dept("Div/OfficeB")];
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeA"), makeMap(3, "Div/OfficeB")];
    const { roots, unassigned } = buildOrgTree(maps, depts);
    expect(unassigned).toEqual([]);
    expect(roots).toHaveLength(1);
    const div = roots[0];
    expect(div.path).toBe("Div");
    expect(div.mapCount).toBe(3); // 자손 합산
    const offices = div.children.map((c: OrgNode) => c.path).sort();
    expect(offices).toEqual(["Div/OfficeA", "Div/OfficeB"]);
    const officeA = div.children.find((c: OrgNode) => c.path === "Div/OfficeA")!;
    expect(officeA.maps.map((m) => m.id).sort()).toEqual([1, 2]);
    expect(officeA.mapCount).toBe(2);
  });

  it("routes null owning_department to unassigned", () => {
    const { roots, unassigned } = buildOrgTree([makeMap(9, null)], []);
    expect(roots).toEqual([]);
    expect(unassigned.map((m) => m.id)).toEqual([9]);
  });

  it("creates missing intermediate nodes when a dept row is absent", () => {
    // dept 목록에 'Div'만 있고 리프가 없어도 맵의 org_path로 노드를 만든다
    const { roots } = buildOrgTree([makeMap(1, "Div/Sub/Team")], [dept("Div")]);
    expect(roots[0].path).toBe("Div");
    expect(roots[0].children[0].path).toBe("Div/Sub");
    expect(roots[0].children[0].children[0].path).toBe("Div/Sub/Team");
    expect(roots[0].children[0].children[0].maps.map((m) => m.id)).toEqual([1]);
  });
});

describe("filterMyDeptMaps", () => {
  it("matches my org_path and its descendants only", () => {
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeA/Team"), makeMap(3, "Div/OfficeB"), makeMap(4, null)];
    expect(filterMyDeptMaps(maps, "Div/OfficeA").map((m) => m.id).sort()).toEqual([1, 2]);
  });
});
