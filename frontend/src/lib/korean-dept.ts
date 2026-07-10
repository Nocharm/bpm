// 부서원 추출·이름 포맷·유저 추출·옵션 빌더 순수 함수 — 부서 탭·한글이름 모달·피커용(DOM/fetch 없음).
// 부서 확정 한글명·부서장은 dept_info 임포트로 이관(2026-07-09) — 여기 남은 korean_dept 파생은 피커 검색 키워드용.
// 설계: docs/superpowers/specs/2026-07-09-member-card-korean-names-design.md
//      docs/superpowers/specs/2026-07-09-picker-korean-search-design.md

import type { SelectOption } from "@/components/search-select";
import type { AdminUser, EmployeeRow } from "./api";
import type { Lang } from "./i18n-messages";

export function getDeptMembers(users: AdminUser[], orgLevels: string[]): AdminUser[] {
  const path = orgLevels.join("/");
  return users.filter((u) => u.org_levels.join("/") === path);
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

/** 승인자 피커 브라우즈용 — 내 상위 부서장(managerIds 순=리프→루트)을 앞으로, 나머지는 원순서 유지(stable sort). */
export function sortManagersFirst<T>(
  items: T[],
  getUserId: (item: T) => string | null,
  managerIds: string[],
): T[] {
  if (managerIds.length === 0) return items;
  const rank = new Map(managerIds.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(getUserId(a) ?? "") ?? Number.POSITIVE_INFINITY;
    const rb = rank.get(getUserId(b) ?? "") ?? Number.POSITIVE_INFINITY;
    return ra - rb;
  });
}

/** org_path "A/B/C" → 루트부터의 조상 경로들 ["A", "A/B", "A/B/C"]. 레벨별 표시명 조회용. */
export function buildOrgPathChain(orgPath: string): string[] {
  const parts = orgPath.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** org_path → 한글 부서명 조회표. 확정값(dept_info)이 우선, 없으면 직원이 신고한 korean_dept로 폴백.
 *  폴백은 직원이 실제로 소속된 말단 경로만 채운다 — 상위 조직은 dept_info 임포트 전엔 영문으로 남는다. */
export function buildKoreanDeptByPath(
  departments: { id: string; korean_name?: string }[],
  users: { org_path?: string; korean_dept?: string }[],
): Map<string, string> {
  const byPath = new Map<string, string>();
  for (const d of departments) {
    const confirmed = (d.korean_name ?? "").trim();
    if (confirmed) byPath.set(d.id, confirmed);
  }
  for (const [path, observed] of deriveDeptKoreanKeywords(users)) {
    if (!byPath.has(path) && observed[0]) byPath.set(path, observed[0]);
  }
  return byPath;
}

/** 부서 표시명 — 이름과 같은 규칙: ko는 확정 한글명(dept_info), 없으면 영문 폴백. en은 영문 리프. */
export function formatDeptName(
  orgPath: string,
  lang: Lang,
  koreanByPath: Map<string, string>,
): string {
  const parts = orgPath.split("/").filter(Boolean);
  const leaf = parts[parts.length - 1] ?? orgPath;
  if (lang !== "ko") return leaf;
  return (koreanByPath.get(orgPath) ?? "").trim() || leaf;
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

/** 부서 SelectOption 빌더 — dept_info(확정 한글명·부서장) + 소속 유저 distinct 한글부서를 검색 키워드로.
 *  label은 lang 토글(이름과 동일 규칙: ko=`한글 (영문)`), value(저장값)는 영문 유지. */
export function buildDepartmentOptions(
  departments: string[],
  users: { department: string; korean_dept?: string }[],
  lang: Lang,
  deptInfos?: Record<string, { korean_name?: string; manager?: string }>,
): SelectOption[] {
  const byDept = new Map<string, string[]>();
  for (const u of users) {
    const dept = (u.korean_dept ?? "").trim();
    if (!u.department || !dept) continue;
    const list = byDept.get(u.department) ?? [];
    if (!list.includes(dept)) list.push(dept);
    byDept.set(u.department, list);
  }
  return departments.map((d) => {
    const info = deptInfos?.[d];
    const koreanName = (info?.korean_name ?? "").trim();
    const manager = (info?.manager ?? "").trim();
    return {
      value: d,
      label: formatRosterName({ name: d, korean_name: koreanName }, lang),
      keywords:
        [koreanName, manager, ...(byDept.get(d) ?? [])].filter(Boolean).join(" ") || undefined,
    };
  });
}
