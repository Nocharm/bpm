// 조직 근접도 정렬 — 협업자 피커의 기본(무검색) 노출 순서. 검색 랭킹(lib/search)과 무관.
// 다리 수 = 내 말단 조직에서 몇 단계 올라간 조상을 공유하는가 (0=같은 말단, 1=같은 팀, …).

/** 근접도 버킷 — 0~3: 3다리 내(우선 노출) · 4: org 있으나 3다리 밖 · 5: org 전부 빈 사람(최후순위). */
export function rankOrgProximity(myPath: string, theirPath: string): number {
  if (!theirPath) return 5;
  if (!myPath) return 4; // 내 org 미상 — org 있는 사람은 동순위(이름순 유지)
  const mine = myPath.split("/").filter(Boolean);
  for (let hops = 0; hops <= 3 && hops < mine.length; hops++) {
    const prefix = mine.slice(0, mine.length - hops).join("/");
    if (theirPath === prefix || theirPath.startsWith(`${prefix}/`)) return hops;
  }
  return 4;
}

/** 근접도 버킷 오름차순, 버킷 내에서는 기존 이름순 유지. */
export function sortUsersByOrgProximity<T extends { name: string; org_path?: string }>(
  users: T[],
  myPath: string,
): T[] {
  return [...users].sort((a, b) => {
    const diff = rankOrgProximity(myPath, a.org_path ?? "") - rankOrgProximity(myPath, b.org_path ?? "");
    if (diff !== 0) return diff;
    return a.name.localeCompare(b.name);
  });
}

/** 부서 피커 기본(무검색) 순서 — 내 부서 체인(말단→루트)을 맨 위에 고정하고, 나머지는 근접도 버킷
 *  오름차순·버킷 내 원래 순서. 새 맵 오우닝 부서 피커(principal-picker pinned)와 같은 규칙
 *  (사용자 요청 2026-09-03). pathByDept는 부서명→org_path(소속 직원에서 파생), 없으면 최후순위. */
export function sortDepartmentsByOrgProximity(
  departments: readonly string[],
  pathByDept: ReadonlyMap<string, string>,
  myPath: string,
): string[] {
  const mine = myPath.split("/").filter(Boolean);
  // 내 경로 자체(0) 또는 그 조상(1=상위 …)이면 체인 순위, 아니면 -1
  const chainRank = (path: string): number => {
    if (!path || mine.length === 0) return -1;
    const parts = path.split("/").filter(Boolean);
    if (parts.length > mine.length) return -1;
    for (let i = 0; i < parts.length; i++) if (parts[i] !== mine[i]) return -1;
    return mine.length - parts.length;
  };
  return departments
    .map((dept, index) => {
      const path = pathByDept.get(dept) ?? "";
      const chain = chainRank(path);
      return { dept, index, chain, rank: chain >= 0 ? -1 : rankOrgProximity(myPath, path) };
    })
    .sort((a, b) => {
      if (a.chain >= 0 && b.chain >= 0) return a.chain - b.chain;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.index - b.index;
    })
    .map((entry) => entry.dept);
}
