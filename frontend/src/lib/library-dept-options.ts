// 라이브러리 부서 필터의 트리 소스 — 조직도 부서 ∪ 행에만 있는 부서(컨설턴트 임포트 등), 내 체인.
import type { DirectoryDept } from "@/lib/api";
import type { DeptPathOption } from "@/lib/dept-path-tree";
import { buildOrgPathChain } from "@/lib/korean-dept";

/** 조직도 부서를 우선 채우고, 행에만 있는 경로(조직도에 없는 임포트 부서)를 한글명 없이 덧붙인다. */
export function buildLibraryDeptOptions(
  directoryDepts: DirectoryDept[],
  rowDepartments: (string | null)[],
): DeptPathOption[] {
  const byId = new Map<string, DeptPathOption>();
  for (const d of directoryDepts) byId.set(d.id, { id: d.id, name: d.name, korean_name: d.korean_name });
  for (const path of rowDepartments) {
    if (!path || byId.has(path)) continue;
    const segments = path.split("/");
    byId.set(path, { id: path, name: segments[segments.length - 1], korean_name: "" });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** org_path → 루트부터 내 부서까지의 조상 체인. 부서 미지정(빈 값)이면 빈 배열. */
export function buildMyDeptChain(orgPath: string | null): string[] {
  return orgPath ? buildOrgPathChain(orgPath) : [];
}
