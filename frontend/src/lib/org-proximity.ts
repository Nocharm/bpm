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
