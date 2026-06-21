import type { SeedState } from './permissions-seed';
import type { MapRole, MapMeta, MapApprover } from './permissions-types';

export function roleRank(role: MapRole): number {
  return role === 'owner' ? 3 : role === 'editor' ? 2 : 1;
}

export function getMapMeta(state: SeedState, mapId: string, fallbackOwnerId = ''): MapMeta {
  const found = state.mapMeta.find((m) => m.mapId === mapId);
  if (found) return found;
  // 오버레이 기본 규칙: 알려지지 않은 실제 맵은 private + created_by(=fallbackOwnerId)
  return { mapId, visibility: 'private', ownerId: fallbackOwnerId };
}

export function getGroupMembership(state: SeedState, userId: string): string[] {
  const user = state.users.find((u) => u.id === userId);
  const deptId = user?.departmentId;
  return state.groups
    .filter((g) => g.status === 'active')
    .filter((g) => g.members.some((m) =>
      (m.type === 'user' && m.id === userId) ||
      (m.type === 'department' && m.id === deptId)))
    .map((g) => g.id);
}

/** 승인자 여부 — 활성 상태 무관, 맵 승인자 목록 포함 여부만 확인
 *  Approver membership check — ignores active status (design §5). */
export function isApprover(state: SeedState, userId: string, mapId: string): boolean {
  return state.approvers.some((a) => a.mapId === mapId && a.userId === userId);
}

export function getEffectiveRole(state: SeedState, userId: string, mapId: string): MapRole | null {
  const user = state.users.find((u) => u.id === userId);
  if (user?.isSysadmin) return 'owner';
  const meta = getMapMeta(state, mapId);
  const groupIds = getGroupMembership(state, userId);
  const deptId = user?.departmentId;
  const applicable = state.permissions.filter((p) =>
    p.mapId === mapId && (
      (p.principalType === 'user' && p.principalId === userId) ||
      (p.principalType === 'group' && groupIds.includes(p.principalId)) ||
      (p.principalType === 'department' && p.principalId === deptId)));
  let best: MapRole | null = applicable.length
    ? applicable.reduce((acc, p) => (roleRank(p.role) > roleRank(acc) ? p.role : acc), applicable[0].role)
    : null;
  if (!best && meta.visibility === 'public') best = 'viewer';
  // 설계 §5: 승인자는 암묵적 viewer — 기존 역할이 없을 때만 올림 (상위 역할 하향 없음)
  // Design §5: approvers are implicit viewers — floor to viewer only when no role computed (never caps higher).
  if (!best && isApprover(state, userId, mapId)) best = 'viewer';
  return best;
}

/** 승인자는 getEffectiveRole에서 viewer로 올라오므로 별도 처리 불필요
 *  Approvers are covered via getEffectiveRole (§5 floor) — no redundant check needed. */
export function isVisibleToUser(state: SeedState, userId: string, mapId: string): boolean {
  return getEffectiveRole(state, userId, mapId) !== null;
}

export function canComment(state: SeedState, userId: string, mapId: string): boolean {
  return getEffectiveRole(state, userId, mapId) !== null; // viewer 이상 / viewer+
}

export function isDowngrade(from: MapRole, to: MapRole | null): boolean {
  if (to === null) return true;
  return roleRank(to) < roleRank(from);
}

export function requiresDowngradeApproval(from: MapRole, to: MapRole | null): boolean {
  // editor → viewer/제거만 승인 게이트 / only editor downgrade/removal gated (설계 §4③)
  return from === 'editor' && (to === 'viewer' || to === null);
}

export function getActiveApprovers(state: SeedState, mapId: string): MapApprover[] {
  const activeIds = new Set(state.users.filter((u) => u.status === 'active').map((u) => u.id));
  return state.approvers.filter((a) => a.mapId === mapId && activeIds.has(a.userId));
}

export function hasActiveApprover(state: SeedState, mapId: string): boolean {
  return getActiveApprovers(state, mapId).length > 0;
}
