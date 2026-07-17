/**
 * 부서 org_path('/' 구분)로 맵을 조직도 트리로 묶는 순수 함수 — 홈 좌측 아코디언·즐겨찾기 소스.
 */
import type { DirectoryDept, MapSummary } from "@/lib/api";

export interface OrgNode {
  path: string; // full org_path (root→this)
  name: string; // 리프 세그먼트
  koreanName: string | null;
  children: OrgNode[];
  maps: MapSummary[]; // 이 부서에 직접 소속된 맵
  mapCount: number; // 자신 + 모든 자손 맵 수
}

export function buildOrgTree(
  maps: MapSummary[],
  depts: DirectoryDept[],
): { roots: OrgNode[]; unassigned: MapSummary[] } {
  const koreanByPath = new Map(depts.map((d) => [d.id, d.korean_name ?? null]));
  const byPath = new Map<string, OrgNode>();
  const roots: OrgNode[] = [];
  const unassigned: MapSummary[] = [];

  const ensure = (path: string): OrgNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: OrgNode = {
      path,
      name: segments[segments.length - 1],
      koreanName: koreanByPath.get(path) ?? null,
      children: [],
      maps: [],
      mapCount: 0,
    };
    byPath.set(path, node);
    if (segments.length === 1) {
      roots.push(node);
    } else {
      ensure(segments.slice(0, -1).join("/")).children.push(node);
    }
    return node;
  };

  // dept 목록 먼저 등록(맵 없는 부서도 노드로 보이게)
  for (const d of depts) ensure(d.id);
  // 맵 배치
  for (const m of maps) {
    if (!m.owning_department) {
      unassigned.push(m);
      continue;
    }
    ensure(m.owning_department).maps.push(m);
  }

  // mapCount 롤업(자손 합) — DFS
  const rollup = (node: OrgNode): number => {
    node.mapCount = node.maps.length + node.children.reduce((s, c) => s + rollup(c), 0);
    return node.mapCount;
  };
  for (const r of roots) rollup(r);
  return { roots, unassigned };
}

export function filterMyDeptMaps(maps: MapSummary[], myOrgPath: string): MapSummary[] {
  if (!myOrgPath) return [];
  return maps.filter(
    (m) => m.owning_department === myOrgPath || (m.owning_department?.startsWith(myOrgPath + "/") ?? false),
  );
}
