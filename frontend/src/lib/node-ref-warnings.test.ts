import { describe, expect, it } from "vitest";

import type { DirectoryDept, DirectoryUser } from "@/lib/api";
import { buildNodeRefCheck, collectNodeWarnings } from "@/lib/node-ref-warnings";

const depts: DirectoryDept[] = [
  { id: "QC Department", name: "QC Department", korean_name: "" },
  { id: "QC Department/QC Support Team", name: "QC Support Team", korean_name: "" },
];

function makeUser(over: Partial<DirectoryUser> & { id: string; name: string }): DirectoryUser {
  return { department: "", title: "", org_path: "", role: "", korean_name: "", korean_dept: "", position: "", ...over };
}

const users: DirectoryUser[] = [
  makeUser({ id: "hj.lee", name: "Hyeonjin Lee", department: "QC Support Team", korean_name: "이현진" }),
  makeUser({ id: "mj.kim", name: "Minjae Kim", department: "QA Team" }),
  makeUser({ id: "no.access", name: "Sealed Person", department: "QC Support Team" }),
];

// 열람권한자는 두 명뿐 — Sealed Person은 재직 중이나 이 맵을 못 본다
const check = buildNodeRefCheck(users, depts, new Set(["Hyeonjin Lee", "Minjae Kim", "이현진"]));

describe("collectNodeWarnings", () => {
  it("조직도에 있는 부서 + 같은 부서 담당자는 경고가 없다", () => {
    expect(collectNodeWarnings("QC Support Team", "Hyeonjin Lee", check)).toEqual([]);
  });

  it("조직도에 없는 부서는 deptOrphan", () => {
    expect(collectNodeWarnings("Ghost Team", "", check)).toEqual([
      { kind: "deptOrphan", value: "Ghost Team" },
    ]);
  });

  it("임포트가 남긴 전체 경로도 리프 집합에 없어 deptOrphan — 감사와 같은 판정", () => {
    const warnings = collectNodeWarnings("Quality Center/QC Department/QC Support Team", "", check);
    expect(warnings.map((w) => w.kind)).toEqual(["deptOrphan"]);
  });

  it("재직자 명단에 없는 담당자는 assigneeOrphan", () => {
    expect(collectNodeWarnings("QC Support Team", "Gone Person", check)).toEqual([
      { kind: "assigneeOrphan", value: "Gone Person" },
    ]);
  });

  it("재직 중이나 열람권한이 없으면 assigneeNoAccess — 종전엔 '부서 불일치'로 뭉쳐 있었다", () => {
    expect(collectNodeWarnings("QC Support Team", "Sealed Person", check)).toEqual([
      { kind: "assigneeNoAccess", value: "Sealed Person" },
    ]);
  });

  it("담당자 부서가 노드 부서와 다르면 assigneeDrift + 현재 부서를 싣는다", () => {
    expect(collectNodeWarnings("QC Support Team", "Minjae Kim", check)).toEqual([
      { kind: "assigneeDrift", value: "Minjae Kim", personDept: "QA Team" },
    ]);
  });

  it("노드 부서가 비면 비교 대상이 없어 드리프트로 치지 않는다", () => {
    expect(collectNodeWarnings("", "Minjae Kim", check)).toEqual([]);
  });

  it("한글명으로 저장된 담당자도 같은 사람으로 해석한다", () => {
    expect(collectNodeWarnings("QC Support Team", "이현진", check)).toEqual([]);
  });

  it("부서·담당자 경고가 함께 나면 부서가 먼저", () => {
    const warnings = collectNodeWarnings("Ghost Team", "Gone Person", check);
    expect(warnings.map((w) => w.kind)).toEqual(["deptOrphan", "assigneeOrphan"]);
  });
});
