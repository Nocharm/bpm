import { describe, expect, it } from "vitest";

import { buildOrgTree, collectPillChain, collectSingleChildChain, filterMyDeptMaps, type OrgNode } from "@/lib/org-tree";
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

  it("prunes departments with zero maps but keeps kept paths", () => {
    const depts = [dept("Div"), dept("Div/Empty"), dept("Div/HasMap"), dept("Other")];
    const maps = [makeMap(1, "Div/HasMap")];
    // 기본(keep 없음) — 빈 부서(Div/Empty·Other)는 사라지고 맵 있는 가지만 남는다
    const pruned = buildOrgTree(maps, depts);
    expect(pruned.roots.map((r) => r.path)).toEqual(["Div"]);
    expect(pruned.roots[0].children.map((c) => c.path)).toEqual(["Div/HasMap"]);
    // keepEmptyPaths — 내 부서(Div/Empty)와 조상(Div)은 맵이 없어도 유지
    const kept = buildOrgTree(maps, depts, new Set(["Div", "Div/Empty"]));
    const divChildren = kept.roots.find((r) => r.path === "Div")!.children.map((c) => c.path).sort();
    expect(divChildren).toEqual(["Div/Empty", "Div/HasMap"]);
    expect(kept.roots.map((r) => r.path)).toEqual(["Div"]); // Other(빈·keep 아님)는 여전히 제거
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

describe("collectSingleChildChain", () => {
  it("follows single-child segments until a branch or leaf", () => {
    // Div → Sub(유일) → Team(유일) → {A, B} 분기: Div 펼침이 Sub·Team까지 이어짐
    const maps = [makeMap(1, "Div/Sub/Team/A"), makeMap(2, "Div/Sub/Team/B")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectSingleChildChain(roots, "Div")).toEqual(["Div/Sub", "Div/Sub/Team"]);
  });

  it("continues through nodes that hold their own maps (unconditional chaining)", () => {
    // 중간 노드에 직속 맵이 있어도 하위가 1개면 계속
    const maps = [makeMap(1, "Div/Sub"), makeMap(2, "Div/Sub/Team/Leaf")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectSingleChildChain(roots, "Div")).toEqual(["Div/Sub", "Div/Sub/Team", "Div/Sub/Team/Leaf"]);
  });

  it("returns empty for branching, leaf, or unknown paths", () => {
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeB")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectSingleChildChain(roots, "Div")).toEqual([]); // 하위 2개 — 분기
    expect(collectSingleChildChain(roots, "Div/OfficeA")).toEqual([]); // 말단
    expect(collectSingleChildChain(roots, "Nope")).toEqual([]); // 미존재 경로
  });
});

describe("collectPillChain", () => {
  it("merges pass-through nodes into one row", () => {
    // Div → Sub(유일 자식·맵 없음) → Team(유일 자식·맵 없음) → {A, B} 분기에서 멈춤
    const maps = [makeMap(1, "Div/Sub/Team/A"), makeMap(2, "Div/Sub/Team/B")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual([
      "Div",
      "Div/Sub",
      "Div/Sub/Team",
    ]);
  });

  it("stops at a node that holds its own maps", () => {
    // Sub가 직속 맵을 가지면 병합 중단 — 병합하면 그 맵이 뒤쪽 필 소속으로 보인다.
    // 같은 트리에서 collectSingleChildChain은 계속 내려간다(규칙이 의도적으로 다름).
    const maps = [makeMap(1, "Div/Sub"), makeMap(2, "Div/Sub/Team/Leaf")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual(["Div", "Div/Sub"]);
  });

  it("returns the node alone when it branches or is a leaf", () => {
    const maps = [makeMap(1, "Div/OfficeA"), makeMap(2, "Div/OfficeB")];
    const { roots } = buildOrgTree(maps, []);
    expect(collectPillChain(roots[0]).map((n) => n.path)).toEqual(["Div"]); // 하위 2개 — 분기
    const leaf = roots[0].children[0];
    expect(collectPillChain(leaf).map((n) => n.path)).toEqual([leaf.path]); // 말단
  });
});
