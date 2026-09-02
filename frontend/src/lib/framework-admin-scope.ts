// Framework 설정 탭 위임 스코프 버튼 게이팅 — 서버 규칙(이동·삭제=seed 자신 금지,
// 임명=대상 level > min(seed level))의 FE 미러. 최종 가드는 서버 403(Track C Task 5) —
// 여기는 UI 노출만 맞춘다. scopeRootIds가 undefined면 sysadmin(전권), 기존 동작 불변.

export type ScopeManageKind = "move" | "delete" | "perms";

export function canManageInScope(
  node: { id: number; level: number },
  kind: ScopeManageKind,
  scopeRootIds: number[] | undefined,
  minSeedLevel: number | undefined,
): boolean {
  if (scopeRootIds === undefined) return true;
  if (kind === "perms") {
    return minSeedLevel !== undefined && node.level > minSeedLevel;
  }
  return !scopeRootIds.includes(node.id);
}
