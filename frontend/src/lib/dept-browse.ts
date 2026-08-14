// 오우닝 부서 피커 브라우즈 행 조립 — 내 체인 상단 고정(캡) + 나머지 조직도 DFS.
// 세그먼트 단위 정렬이 곧 DFS: 부모 경로가 자식의 접두라 항상 먼저 온다.

import type { PrincipalOption } from "@/components/permissions/principal-picker";

export interface DeptBrowseRow {
  option: PrincipalOption;
  depth: number;
  pinned: boolean;
}

function compareSegments(a: string, b: string): number {
  const as = a.split("/");
  const bs = b.split("/");
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i += 1) {
    const cmp = as[i].localeCompare(bs[i]);
    if (cmp !== 0) return cmp;
  }
  return as.length - bs.length;
}

export function buildDeptBrowseRows(
  deptOptions: PrincipalOption[],
  myOrgPath: string | null,
  pinnedCap = 3,
): DeptBrowseRow[] {
  const isMine = (id: string): boolean =>
    !!myOrgPath && (myOrgPath === id || myOrgPath.startsWith(`${id}/`));
  const mine = deptOptions
    .filter((o) => isMine(o.principalId))
    .sort((a, b) => b.principalId.split("/").length - a.principalId.split("/").length)
    .slice(0, pinnedCap);
  const pinnedIds = new Set(mine.map((o) => o.principalId));
  const rest = deptOptions
    .filter((o) => !pinnedIds.has(o.principalId))
    .sort((a, b) => compareSegments(a.principalId, b.principalId));
  return [
    ...mine.map((option) => ({ option, depth: option.principalId.split("/").length - 1, pinned: true })),
    ...rest.map((option) => ({ option, depth: option.principalId.split("/").length - 1, pinned: false })),
  ];
}
