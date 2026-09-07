// 부서 org_path 목록 → 중첩 트리 + 검색 매치 집합 — 관리자 부서 피커·라이브러리 부서 플라이아웃 공유.

export interface DeptPathOption {
  id: string; // 전체 경로 ("A/B/C") — 세그먼트 내 "/"는 백엔드가 전각 슬래시로 새니타이즈
  name: string; // 리프 세그먼트
  korean_name?: string;
}

export interface DeptTreeNode {
  path: string;
  name: string;
  koreanName: string;
  depth: number;
  children: DeptTreeNode[];
}

/** 경로 목록 → 중첩 트리(루트→리프). 목록에 없는 중간 경로도 노드로 채운다. */
export function buildDeptPathTree(options: DeptPathOption[]): DeptTreeNode[] {
  const koreanByPath = new Map(options.map((o) => [o.id, o.korean_name ?? ""]));
  const byPath = new Map<string, DeptTreeNode>();
  const roots: DeptTreeNode[] = [];
  const ensure = (path: string): DeptTreeNode => {
    const existing = byPath.get(path);
    if (existing) return existing;
    const segments = path.split("/");
    const node: DeptTreeNode = {
      path,
      name: segments[segments.length - 1],
      koreanName: koreanByPath.get(path) ?? "",
      depth: segments.length - 1,
      children: [],
    };
    byPath.set(path, node);
    if (segments.length === 1) {
      roots.push(node);
    } else {
      ensure(segments.slice(0, -1).join("/")).children.push(node);
    }
    return node;
  };
  for (const o of [...options].sort((a, b) => a.id.localeCompare(b.id))) ensure(o.id);
  return roots;
}

/** 검색 매치 경로 집합 — 매치 노드의 조상까지 포함(트리에서 보이도록). */
export function collectDeptMatches(roots: DeptTreeNode[], query: string): Set<string> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const visible = new Set<string>();
  const walk = (node: DeptTreeNode, ancestors: string[]): void => {
    const hit =
      node.name.toLowerCase().includes(q) || node.koreanName.toLowerCase().includes(q);
    if (hit) {
      for (const a of ancestors) visible.add(a);
      const markAll = (n: DeptTreeNode): void => {
        visible.add(n.path);
        n.children.forEach(markAll);
      };
      markAll(node);
    }
    node.children.forEach((c) => walk(c, [...ancestors, node.path]));
  };
  roots.forEach((r) => walk(r, []));
  return visible;
}
