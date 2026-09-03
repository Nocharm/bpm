// 협업자 피커 조직 근접도 정렬 계약 (2026-08-26)
import { describe, expect, it } from "vitest";

import { rankOrgProximity, sortDepartmentsByOrgProximity, sortUsersByOrgProximity } from "@/lib/org-proximity";

const MY = "Center/Office/Team/Part";

describe("rankOrgProximity", () => {
  it("다리 수 - 같은 말단 0, 같은 팀 1, 같은 오피스 2, 같은 센터 3", () => {
    expect(rankOrgProximity(MY, "Center/Office/Team/Part")).toBe(0);
    expect(rankOrgProximity(MY, "Center/Office/Team/Part2")).toBe(1);
    expect(rankOrgProximity(MY, "Center/Office/Team2/PartX")).toBe(2);
    expect(rankOrgProximity(MY, "Center/Office2/TeamY")).toBe(3);
  });

  it("3다리 밖 조직은 4, org 빈 사람은 5(최후순위)", () => {
    expect(rankOrgProximity(MY, "OtherCenter/Office")).toBe(4);
    expect(rankOrgProximity(MY, "")).toBe(5);
  });

  it("내 org 미상 - org 있는 사람 4, 빈 사람 5 (빈 사람 최후순위 유지)", () => {
    expect(rankOrgProximity("", "Center/Office")).toBe(4);
    expect(rankOrgProximity("", "")).toBe(5);
  });

  it("경로 접두 오탐 방지 - 'Part'와 'Part2'는 다른 조직", () => {
    expect(rankOrgProximity("Center/Office/Team/Part", "Center/Office/Team/Part2")).not.toBe(0);
  });
});

describe("sortUsersByOrgProximity", () => {
  it("버킷 오름차순 + 버킷 내 이름순, org 빈 사람은 맨 뒤", () => {
    const users = [
      { name: "Aa NoOrg", org_path: "" },
      { name: "Bb Far", org_path: "OtherCenter/X" },
      { name: "Cc SameTeam", org_path: "Center/Office/Team/Part2" },
      { name: "Dd SamePart", org_path: "Center/Office/Team/Part" },
      { name: "Ab SamePart", org_path: "Center/Office/Team/Part" },
    ];
    expect(sortUsersByOrgProximity(users, MY).map((u) => u.name)).toEqual([
      "Ab SamePart", "Dd SamePart", "Cc SameTeam", "Bb Far", "Aa NoOrg",
    ]);
  });
});

describe("sortDepartmentsByOrgProximity", () => {
  it("내 부서 체인(말단→루트) 고정 상단, 이어 근접도 버킷, 경로 미상은 맨 뒤", () => {
    const paths = new Map([
      ["Far", "OtherCenter/X"],
      ["Team", "Center/Office/Team"],
      ["Part", "Center/Office/Team/Part"],
      ["Office", "Center/Office"],
      ["Center", "Center"],
      ["Sibling", "Center/Office/Team/Part2"],
      ["Cousin", "Center/Office2/TeamY"],
    ]);
    const departments = ["Unknown", "Far", "Team", "Cousin", "Part", "Office", "Sibling", "Center"];
    expect(sortDepartmentsByOrgProximity(departments, paths, MY)).toEqual([
      "Part", "Team", "Office", "Center", "Sibling", "Cousin", "Far", "Unknown",
    ]);
  });

  it("내 org 미상이면 체인 없이 원래 순서(경로 있는 부서 먼저)", () => {
    const paths = new Map([["B", "X/Y"]]);
    expect(sortDepartmentsByOrgProximity(["A", "B"], paths, "")).toEqual(["B", "A"]);
  });
});
