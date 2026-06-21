// 권한 mock 인메모리 스토어 — UI/mock 전용, 새로고침 시 seed로 초기화 / In-memory store, resets to seed on reload.
// 패턴: current-user.ts 와 동일한 모듈-레벨 state + listener Set + useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { buildSeed, type SeedState } from './permissions-seed';
import type {
  PrincipalType,
  MapRole,
  MapPermission,
  MapApprover,
  DowngradePayload,
  VisibilityChangePayload,
} from './permissions-types';

// StoreState: SeedState에 versionFlow 추가 — SeedState는 변경하지 않음 / Do NOT modify SeedState.
export interface VersionFlowEntry {
  status: 'draft' | 'pending' | 'approved' | 'published' | 'rejected';
  requestedBy: string;
  label: string;
  /** 승인·반려한 사용자 ID (approve/reject 시 기록) / User who approved or rejected. */
  approvedBy?: string;
  /** 최종 게시한 사용자 ID (publish 시 기록) / User who published. */
  publishedBy?: string;
}

export type StoreState = SeedState & {
  versionFlow: Record<string, VersionFlowEntry>;
};

// 권한 부여 시각 — 실제 시계 호출 없이 고정값 사용 / Fixed grant timestamp (no Date.now per design).
const GRANTED_AT = '2026-06-20T00:00:00Z';
const DECIDED_AT = '2026-06-20T00:00:00Z';

// 모듈-레벨 state + listener 집합 / Module-level state + listener set.
let state: StoreState = { ...buildSeed(), versionFlow: {} };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// ── 구독 · 조회 ────────────────────────────────────────────────

export function subscribePermissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPermissionState(): StoreState {
  return state;
}

export function usePermissions(): StoreState {
  return useSyncExternalStore(subscribePermissions, getPermissionState, getPermissionState);
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────

/** 권한 upsert (role 교체 또는 신규 추가) — 불변 / Immutable upsert of a permission. */
function upsertPermission(
  permissions: MapPermission[],
  mapId: string,
  principalType: PrincipalType,
  principalId: string,
  role: MapRole,
  by: string,
): MapPermission[] {
  const idx = permissions.findIndex(
    (p) => p.mapId === mapId && p.principalType === principalType && p.principalId === principalId,
  );
  if (idx >= 0) {
    // 기존 항목 role만 교체 / Replace role of existing entry.
    return permissions.map((p, i) => (i === idx ? { ...p, role } : p));
  }
  // 신규 추가 / Append new entry.
  return [
    ...permissions,
    { mapId, principalType, principalId, role, grantedBy: by, grantedAt: GRANTED_AT },
  ];
}

// ── 요청 결재 ─────────────────────────────────────────────────
// Kept: admin MAP-preview queue (approval-queue.tsx) uses decideRequest for cross-map
// permission/visibility requests. No cross-map approval-request list endpoint exists yet;
// to be replaced when that backend endpoint is added.
// 관리자 MAP 미리보기 큐(approval-queue.tsx)가 cross-map 권한·가시성 결재에 사용.
// cross-map 결재 목록 엔드포인트가 없어 유지; 해당 엔드포인트 추가 시 대체 예정.

/**
 * 요청 승인·반려 — 승인 시 payload에 따라 권한/가시성 반영 /
 * Approve or reject a request; approval applies the effect.
 */
export function decideRequest(
  requestId: string,
  decision: 'approved' | 'rejected',
  by: string,
): void {
  const req = state.requests.find((r) => r.id === requestId);
  if (!req) return;

  let nextPermissions = state.permissions;
  let nextMapMeta = state.mapMeta;

  if (decision === 'approved') {
    if (req.kind === 'permission_downgrade') {
      const p = req.payload as DowngradePayload;
      if (p.toRole === null) {
        // 제거 / Remove.
        nextPermissions = state.permissions.filter(
          (perm) =>
            !(
              perm.mapId === req.mapId &&
              perm.principalType === p.principalType &&
              perm.principalId === p.principalId
            ),
        );
      } else {
        // 역할 하향 / Downgrade role.
        nextPermissions = upsertPermission(
          state.permissions,
          req.mapId,
          p.principalType,
          p.principalId,
          p.toRole,
          by,
        );
      }
    } else if (req.kind === 'visibility_change') {
      const p = req.payload as VisibilityChangePayload;
      const idx = state.mapMeta.findIndex((m) => m.mapId === req.mapId);
      if (idx >= 0) {
        nextMapMeta = state.mapMeta.map((m, i) =>
          i === idx ? { ...m, visibility: p.to } : m,
        );
      } else {
        // 알 수 없는 맵 — 새 메타 추가 / Unknown map: append meta.
        nextMapMeta = [...state.mapMeta, { mapId: req.mapId, visibility: p.to, ownerId: by }];
      }
    }
    // version_publish 승인 처리는 후속 태스크 / version_publish approval is a LATER task (YAGNI).
  }

  // 요청 상태 갱신 / Update request status.
  const nextStatus = decision === 'approved' ? 'applied' : 'rejected';
  state = {
    ...state,
    permissions: nextPermissions,
    mapMeta: nextMapMeta,
    requests: state.requests.map((r) =>
      r.id === requestId
        ? { ...r, status: nextStatus, decidedBy: by, decidedAt: DECIDED_AT }
        : r,
    ),
  };
  emit();
}

// ── 승인자 액션 ───────────────────────────────────────────────
// Kept: reassign-approver-modal.tsx still imports setApprovers from this mock store
// (inline approver reassignment UI). To be replaced with real API call when modal is wired.
// reassign-approver-modal.tsx 가 setApprovers를 이 mock 스토어에서 임포트함(인라인 승인자 재지정 UI).
// 모달을 실 API로 연결할 때 대체 예정.

/**
 * 맵 승인자 교체 — 기존 항목 삭제 후 신규 삽입 /
 * Replace all approvers for a map.
 */
export function setApprovers(mapId: string, userIds: string[], by: string): void {
  const others = state.approvers.filter((a) => a.mapId !== mapId);
  const fresh: MapApprover[] = userIds.map((userId) => ({ mapId, userId, assignedBy: by }));
  state = { ...state, approvers: [...others, ...fresh] };
  emit();
}
