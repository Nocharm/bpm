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
  keepEmptyPaths: Set<string> = new Set(),
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

  // 빈 부서(자신+자손에 맵 0개) 가지치기 — 조직도 노이즈 제거. 단, keepEmptyPaths(내 부서 및 그 조상)
  // 는 맵이 없어도 앵커로 유지한다. keepEmptyPaths엔 내 org_path의 모든 접두 경로가 들어와야 체인이 산다.
  const prune = (nodes: OrgNode[]): OrgNode[] =>
    nodes
      .filter((n) => n.mapCount > 0 || keepEmptyPaths.has(n.path))
      .map((n) => ({ ...n, children: prune(n.children) }));

  return { roots: prune(roots), unassigned };
}

export function filterMyDeptMaps(maps: MapSummary[], myOrgPath: string): MapSummary[] {
  if (!myOrgPath) return [];
  return maps.filter(
    (m) => m.owning_department === myOrgPath || (m.owning_department?.startsWith(myOrgPath + "/") ?? false),
  );
}

// 부서 경로 기준 분리 — direct는 그 부서 소유 맵만, descendants는 하위 부서(자손) 소유 맵.
// 대시보드 내 부서 카드용: 상위 부서를 고르면 그 부서 맵만 목록에 올리고 하위는 건수로만 알린다(사용자 지시 2026-09-11).
export function splitDeptMaps(maps: MapSummary[], path: string): { direct: MapSummary[]; descendants: MapSummary[] } {
  if (!path) return { direct: [], descendants: [] };
  const direct: MapSummary[] = [];
  const descendants: MapSummary[] = [];
  for (const m of maps) {
    if (m.owning_department === path) direct.push(m);
    else if (m.owning_department?.startsWith(path + "/")) descendants.push(m);
  }
  return { direct, descendants };
}

// 단일 하위 체인 수집 — path 노드를 펼칠 때 하위 부서가 정확히 1개뿐인 구간을 이어서 반환(반복).
// 수동 펼침 UX용: 선택지 없는 중간 단계 클릭 반복을 없앤다. 하위 2개 이상·말단이면 멈춤.
export function collectSingleChildChain(roots: OrgNode[], path: string): string[] {
  const find = (nodes: OrgNode[]): OrgNode | null => {
    for (const n of nodes) {
      if (n.path === path) return n;
      if (path.startsWith(`${n.path}/`)) return find(n.children);
    }
    return null;
  };
  const chain: string[] = [];
  let node = find(roots);
  while (node && node.children.length === 1) {
    node = node.children[0];
    chain.push(node.path);
  }
  return chain;
}
