import { describe, expect, it } from "vitest";

import { buildDeptBrowseRows } from "./dept-browse";
import type { PrincipalOption } from "@/components/permissions/principal-picker";

const dept = (id: string): PrincipalOption => ({
  principalType: "department",
  principalId: id,
  displayName: id.split("/").pop() ?? id,
});

const OPTIONS = [
  dept("HQ"),
  dept("HQ/Div A"),
  dept("HQ/Div A/Team 1"),
  dept("HQ/Div A/Team 2"),
  dept("HQ/Div B"),
  dept("HQ/Div B/Team 3"),
];

describe("buildDeptBrowseRows", () => {
  it("내 체인은 깊은 단위 먼저 최대 3개 pinned, 트리 섹션에서 제외된다", () => {
    const rows = buildDeptBrowseRows(OPTIONS, "HQ/Div A/Team 1", 3);
    const pinned = rows.filter((r) => r.pinned).map((r) => r.option.principalId);
    expect(pinned).toEqual(["HQ/Div A/Team 1", "HQ/Div A", "HQ"]);
    const tree = rows.filter((r) => !r.pinned).map((r) => r.option.principalId);
    expect(tree).toEqual(["HQ/Div A/Team 2", "HQ/Div B", "HQ/Div B/Team 3"]);
  });

  it("체인이 캡보다 길면 얕은 조상이 트리 섹션에 남는다", () => {
    const rows = buildDeptBrowseRows(OPTIONS, "HQ/Div A/Team 1", 2);
    const pinned = rows.filter((r) => r.pinned).map((r) => r.option.principalId);
    expect(pinned).toEqual(["HQ/Div A/Team 1", "HQ/Div A"]);
    expect(rows.filter((r) => !r.pinned).map((r) => r.option.principalId)).toContain("HQ");
  });

  it("트리 섹션은 DFS 순서(부모 먼저·형제 하위 묶임) + depth 부여", () => {
    const rows = buildDeptBrowseRows(OPTIONS, null);
    expect(rows.map((r) => r.option.principalId)).toEqual([
      "HQ",
      "HQ/Div A",
      "HQ/Div A/Team 1",
      "HQ/Div A/Team 2",
      "HQ/Div B",
      "HQ/Div B/Team 3",
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 2, 1, 2]);
    expect(rows.every((r) => !r.pinned)).toBe(true);
  });
});
