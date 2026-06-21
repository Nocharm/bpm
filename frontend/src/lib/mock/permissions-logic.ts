import type { SeedState } from './permissions-seed';
import type { MapRole, MapMeta } from './permissions-types';

export function getMapMeta(state: SeedState, mapId: string, fallbackOwnerId = ''): MapMeta {
  const found = state.mapMeta.find((m) => m.mapId === mapId);
  if (found) return found;
  // 오버레이 기본 규칙: 알려지지 않은 실제 맵은 private + created_by(=fallbackOwnerId)
  return { mapId, visibility: 'private', ownerId: fallbackOwnerId };
}

/** 승인자 여부 — 활성 상태 무관, 맵 승인자 목록 포함 여부만 확인
 *  Approver membership check — ignores active status (design §5). */
export function isApprover(state: SeedState, userId: string, mapId: string): boolean {
  return state.approvers.some((a) => a.mapId === mapId && a.userId === userId);
}

export function requiresDowngradeApproval(from: MapRole, to: MapRole | null): boolean {
  // editor → viewer/제거만 승인 게이트 / only editor downgrade/removal gated (설계 §4③)
  return from === 'editor' && (to === 'viewer' || to === null);
}
