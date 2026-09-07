// 라이브러리 부서 필터의 트리 소스 — 조직도 부서 ∪ 행에만 있는 부서(컨설턴트 임포트 등), 내 체인.
import type { DirectoryDept } from "@/lib/api";
import type { DeptPathOption } from "@/lib/dept-path-tree";
import { buildOrgPathChain } from "@/lib/korean-dept";

/** 조직도 경로 조회표 — 전체 경로 집합 + 리프명 역인덱스(같은 리프가 여러 상위에 있을 수 있다). */
export interface DeptPathIndex {
  paths: Set<string>;
  byLeaf: Map<string, string[]>;
}

export function buildDeptPathIndex(directoryDepts: DirectoryDept[]): DeptPathIndex {
  const paths = new Set<string>();
  const byLeaf = new Map<string, string[]>();
  for (const d of directoryDepts) {
    paths.add(d.id);
    const leaf = d.id.split("/").at(-1) ?? d.id;
    const found = byLeaf.get(leaf);
    if (found) found.push(d.id);
    else byLeaf.set(leaf, [d.id]);
  }
  return { paths, byLeaf };
}

/** 행에 저장된 부서값 → 조직도 전체 경로 후보. sp_department는 리프명만 담기는 일이 많아
 *  트리·필터가 상위 부서를 못 찾는다. 중의성(같은 리프 여러 상위)은 후보 전부를 돌려 허용한다. */
export function resolveDepartmentPaths(value: string, index: DeptPathIndex): string[] {
  if (index.paths.has(value)) return [value];
  return index.byLeaf.get(value) ?? [value];
}

/** 조직도 부서를 우선 채우고, 조직도로 해석되지 않는 행 값(임포트 부서 등)만 자기 루트로 덧붙인다. */
export function buildLibraryDeptOptions(
  directoryDepts: DirectoryDept[],
  rowDepartments: (string | null)[],
  // 호출자가 이미 만든 인덱스를 넘기면 재계산하지 않는다(패널은 필터와 같은 인덱스를 공유)
  index: DeptPathIndex = buildDeptPathIndex(directoryDepts),
): DeptPathOption[] {
  const byId = new Map<string, DeptPathOption>();
  for (const d of directoryDepts) byId.set(d.id, { id: d.id, name: d.name, korean_name: d.korean_name });
  for (const value of rowDepartments) {
    if (!value) continue;
    // 경로거나 리프명으로 해석되는 값은 트리에 이미 있다 — 중복 루트를 만들지 않는다
    if (index.paths.has(value) || index.byLeaf.has(value)) continue;
    const segments = value.split("/");
    byId.set(value, { id: value, name: segments[segments.length - 1], korean_name: "" });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** org_path → 루트부터 내 부서까지의 조상 체인. 부서 미지정(빈 값)이면 빈 배열. */
export function buildMyDeptChain(orgPath: string | null): string[] {
  return orgPath ? buildOrgPathChain(orgPath) : [];
}
