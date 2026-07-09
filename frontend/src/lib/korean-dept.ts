// 부서 한글명 집계·유저 추출·옵션 빌더 순수 함수 — 부서 탭·한글이름 모달·피커용(DOM/fetch 없음).
// 매핑 일괄 갱신(PUT /korean-dept) 룰은 철회됨 — 이 파일은 관찰용 집계만 담당.
// 설계: docs/superpowers/specs/2026-07-09-member-card-korean-names-design.md
//      docs/superpowers/specs/2026-07-09-picker-korean-search-design.md

import type { SelectOption } from "@/components/search-select";
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

/** org_path 정확 일치 그룹별 distinct 한글부서 — 피커 부서 항목 검색 키워드 파생. */
export function deriveDeptKoreanKeywords(
  users: { org_path?: string; korean_dept?: string }[],
): Map<string, string[]> {
  const byPath = new Map<string, string[]>();
  for (const u of users) {
    const path = u.org_path ?? "";
    const dept = (u.korean_dept ?? "").trim();
    if (!path || !dept) continue;
    const list = byPath.get(path) ?? [];
    if (!list.includes(dept)) list.push(dept);
    byPath.set(path, list);
  }
  return byPath;
}

/** 담당자 SelectOption 빌더 — value는 저장값(영문 name) 불변, label만 언어 연동. */
export function buildAssigneeOptions(
  users: { id: string; name: string; department: string; korean_name?: string; korean_dept?: string }[],
  lang: Lang,
): SelectOption[] {
  return users.map((u) => ({
    value: u.name,
    label: formatRosterName({ name: u.name, korean_name: u.korean_name ?? "" }, lang),
    sub: [u.id, u.department].filter(Boolean).join(" · ") || undefined,
    keywords: [u.id, u.korean_name ?? ""].filter(Boolean).join(" "),
  }));
}

/** 부서 SelectOption 빌더 — 소속 유저들의 distinct 한글부서를 검색 키워드로. */
export function buildDepartmentOptions(
  departments: string[],
  users: { department: string; korean_dept?: string }[],
): SelectOption[] {
  const byDept = new Map<string, string[]>();
  for (const u of users) {
    const dept = (u.korean_dept ?? "").trim();
    if (!u.department || !dept) continue;
    const list = byDept.get(u.department) ?? [];
    if (!list.includes(dept)) list.push(dept);
    byDept.set(u.department, list);
  }
  return departments.map((d) => ({
    value: d,
    label: d,
    keywords: byDept.get(d)?.join(" ") || undefined,
  }));
}
