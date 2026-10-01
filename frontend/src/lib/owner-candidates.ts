// 소유권 이전 후보 — 명시 editor+ user 권한 행 ∪ 오우닝 부서(하위 포함) 소속 디렉터리 유저(권한 행 없는 파생
// editor, 백엔드 permissions/logic.belongs_to_department와 같은 접두 규칙). 위험 구역 피커와 협업자
// 역할 메뉴의 Owner 항목이 같은 후보 집합을 본다 (2026-10-01).

import type { DirectoryUser, MapPermission } from "@/lib/api";

export interface OwnerCandidate {
  userId: string;
  name: string;
  /** 디렉터리에서 찾은 유저 — 없으면(퇴직 등) 권한 행만 있는 후보 */
  user?: DirectoryUser;
  /** explicit: 권한 행 보유, derived: 오우닝 부서 소속(권한 행 없음) */
  source: "explicit" | "derived";
  /** 권한 행의 역할(explicit) — derived는 "editor" */
  role: "editor" | "owner";
}

/** 백엔드 belongs_to_department 미러 — 정확 일치 또는 "/" 경계 접두. */
export function belongsToDepartment(orgPath: string, department: string): boolean {
  if (!department) return false;
  return orgPath === department || orgPath.startsWith(`${department}/`);
}

export function buildOwnerCandidates(
  perms: MapPermission[],
  users: DirectoryUser[],
  owningDepartment: string | null | undefined,
  currentUserId: string,
): OwnerCandidate[] {
  const byId = new Map(users.map((u) => [u.id, u]));
  const seen = new Set<string>();
  const out: OwnerCandidate[] = [];
  for (const p of perms) {
    if (p.principal_type !== "user") continue;
    if (p.role !== "editor" && p.role !== "owner") continue;
    if (p.principal_id === currentUserId || seen.has(p.principal_id)) continue;
    seen.add(p.principal_id);
    const user = byId.get(p.principal_id);
    out.push({ userId: p.principal_id, name: user?.name ?? p.principal_id, user, source: "explicit", role: p.role });
  }
  if (owningDepartment) {
    for (const user of users) {
      if (user.id === currentUserId || seen.has(user.id)) continue;
      if (!belongsToDepartment(user.org_path ?? "", owningDepartment)) continue;
      seen.add(user.id);
      out.push({ userId: user.id, name: user.name || user.id, user, source: "derived", role: "editor" });
    }
  }
  return out;
}
