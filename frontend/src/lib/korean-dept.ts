// 부서 한글명 매핑·유저 추출 순수 함수 — 부서 탭·한글이름 모달용(DOM/fetch 없음).
// 설계: docs/superpowers/specs/2026-07-09-dept-korean-mapping-design.md

import type { AdminUser, EmployeeRow } from "./api";
import type { Lang } from "./i18n-messages";

export interface DeptKoreanCandidate {
  value: string;
  count: number;
}

export function getDeptMembers(users: AdminUser[], orgLevels: string[]): AdminUser[] {
  const path = orgLevels.join("/");
  return users.filter((u) => u.org_levels.join("/") === path);
}

export function aggregateDeptKoreanDepts(members: AdminUser[]): DeptKoreanCandidate[] {
  const counts = new Map<string, number>();
  for (const member of members) {
    if (!member.korean_dept) continue;
    counts.set(member.korean_dept, (counts.get(member.korean_dept) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** 명단 필 표기 — 언어 토글 연동: ko는 한글(영문), en은 영문(한글). 없는 쪽은 생략. */
export function formatRosterName(
  user: Pick<AdminUser, "name" | "korean_name">,
  lang: Lang,
): string {
  const primary = lang === "ko" ? user.korean_name : user.name;
  const secondary = lang === "ko" ? user.name : user.korean_name;
  if (!primary) return secondary;
  return secondary ? `${primary} (${secondary})` : primary;
}

export type ExportOption = "missing" | "deptSample" | "random50" | "all";

export function buildExportIds(
  rows: EmployeeRow[],
  option: ExportOption,
  rng: () => number = Math.random,
): string[] {
  switch (option) {
    case "missing":
      return rows.filter((r) => !r.korean_name).map((r) => r.login_id);
    case "all":
      return rows.map((r) => r.login_id);
    case "deptSample": {
      const byDept = new Map<string, EmployeeRow[]>();
      for (const r of rows) {
        const group = byDept.get(r.department);
        if (group) group.push(r);
        else byDept.set(r.department, [r]);
      }
      return [...byDept.values()].map(
        (group) => group[Math.floor(rng() * group.length)].login_id,
      );
    }
    case "random50": {
      const pool = [...rows];
      const picked: string[] = [];
      while (picked.length < 50 && pool.length > 0) {
        const i = Math.floor(rng() * pool.length);
        picked.push(pool[i].login_id);
        pool.splice(i, 1);
      }
      return picked;
    }
  }
}
