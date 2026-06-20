// 권한 mock 인메모리 스토어 — UI/mock 전용, 새로고침 시 seed로 초기화 / In-memory store, resets to seed on reload.
// 패턴: current-user.ts 와 동일한 모듈-레벨 state + listener Set + useSyncExternalStore.

import { useSyncExternalStore } from 'react';
import { buildSeed, type SeedState } from './permissions-seed';
import type {
  PrincipalType,
  MapRole,
  MapVisibility,
  MapPermission,
  MapApprover,
  DowngradePayload,
  VisibilityChangePayload,
} from './permissions-types';
import { requiresDowngradeApproval, getMapMeta } from './permissions-logic';
import { genId } from '../id';

// StoreState: SeedState에 versionFlow 추가 — SeedState는 변경하지 않음 / Do NOT modify SeedState.
export interface VersionFlowEntry {
  status: 'draft' | 'pending' | 'approved' | 'published' | 'rejected';
  requestedBy: string;
  label: string;
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

// ── 구독 · 조회 · 리셋 ─────────────────────────────────────────

export function subscribePermissions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPermissionState(): StoreState {
  return state;
}

export function resetPermissions(): void {
  state = { ...buildSeed(), versionFlow: {} };
  emit();
}

export function usePermissions(): StoreState {
  return useSyncExternalStore(subscribePermissions, getPermissionState, getPermissionState);
}

// ── 내부 헬퍼 ─────────────────────────────────────────────────

/** 기존 권한 찾기 / Find existing permission for (mapId, principalType, principalId). */
function findPermission(
  mapId: string,
  principalType: PrincipalType,
  principalId: string,
): MapPermission | undefined {
  return state.permissions.find(
    (p) => p.mapId === mapId && p.principalType === principalType && p.principalId === principalId,
  );
}

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

// ── 협업자 액션 ───────────────────────────────────────────────

/**
 * 협업자 추가 또는 역할 상향 — 게이트 없음 즉시 적용 /
 * Upsert collaborator (add or upgrade role); applied immediately.
 */
export function addCollaborator(
  mapId: string,
  principalType: PrincipalType,
  principalId: string,
  role: MapRole,
  by: string,
): void {
  state = {
    ...state,
    permissions: upsertPermission(state.permissions, mapId, principalType, principalId, role, by),
  };
  emit();
}

/**
 * 역할 변경 — editor 하향/제거는 승인 요청(gated:true), 그 외 즉시 /
 * Change role; editor→down/remove gates via approval request.
 */
export function changeRole(
  mapId: string,
  principalType: PrincipalType,
  principalId: string,
  toRole: MapRole,
  by: string,
): { gated: boolean } {
  const existing = findPermission(mapId, principalType, principalId);
  const currentRole = existing?.role ?? null;

  if (currentRole && requiresDowngradeApproval(currentRole, toRole)) {
    // 게이트: 승인 요청 생성 / Gated: create approval request.
    const payload: DowngradePayload = {
      principalType,
      principalId,
      fromRole: currentRole,
      toRole,
    };
    state = {
      ...state,
      requests: [
        ...state.requests,
        {
          id: genId(),
          mapId,
          kind: 'permission_downgrade',
          payload,
          requestedBy: by,
          status: 'pending',
        },
      ],
    };
    emit();
    return { gated: true };
  }

  // 즉시 적용 / Apply immediately.
  state = {
    ...state,
    permissions: upsertPermission(state.permissions, mapId, principalType, principalId, toRole, by),
  };
  emit();
  return { gated: false };
}

/**
 * 협업자 제거 — editor 제거는 승인 요청(gated:true), 그 외 즉시 /
 * Remove collaborator; removing an editor creates an approval request.
 */
export function removeCollaborator(
  mapId: string,
  principalType: PrincipalType,
  principalId: string,
  by: string,
): { gated: boolean } {
  const existing = findPermission(mapId, principalType, principalId);
  const currentRole = existing?.role ?? null;

  if (currentRole && requiresDowngradeApproval(currentRole, null)) {
    // 게이트: 승인 요청 생성(toRole=null = 제거) / Gated: removal request.
    const payload: DowngradePayload = {
      principalType,
      principalId,
      fromRole: currentRole,
      toRole: null,
    };
    state = {
      ...state,
      requests: [
        ...state.requests,
        {
          id: genId(),
          mapId,
          kind: 'permission_downgrade',
          payload,
          requestedBy: by,
          status: 'pending',
        },
      ],
    };
    emit();
    return { gated: true };
  }

  // 즉시 제거 / Remove immediately.
  state = {
    ...state,
    permissions: state.permissions.filter(
      (p) =>
        !(p.mapId === mapId && p.principalType === principalType && p.principalId === principalId),
    ),
  };
  emit();
  return { gated: false };
}

// ── 가시성 액션 ───────────────────────────────────────────────

/**
 * 맵 가시성 변경 요청 — 항상 승인 게이트 /
 * Request visibility change; always gated via approval.
 */
export function requestVisibilityChange(mapId: string, to: MapVisibility, by: string): void {
  const meta = getMapMeta(state, mapId);
  const payload: VisibilityChangePayload = { from: meta.visibility, to };
  state = {
    ...state,
    requests: [
      ...state.requests,
      {
        id: genId(),
        mapId,
        kind: 'visibility_change',
        payload,
        requestedBy: by,
        status: 'pending',
      },
    ],
  };
  emit();
}

// ── 요청 결재 ─────────────────────────────────────────────────

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

// ── 소유권 이전 ───────────────────────────────────────────────

/**
 * 소유자 이전 — 즉시 적용, 승인 불필요 /
 * Transfer ownership immediately (no approval).
 * 현 소유자 → editor 강등, toUser → owner 승격, MapMeta.ownerId 갱신.
 */
export function transferOwner(mapId: string, toUserId: string, by: string): void {
  // 현 소유자 찾기 / Find current owner permission.
  const currentOwnerPerm = state.permissions.find(
    (p) => p.mapId === mapId && p.principalType === 'user' && p.role === 'owner',
  );

  let nextPermissions = state.permissions;

  // 현 소유자를 editor로 강등 / Demote current owner to editor.
  if (currentOwnerPerm) {
    nextPermissions = nextPermissions.map((p) =>
      p.mapId === mapId && p.principalType === 'user' && p.principalId === currentOwnerPerm.principalId
        ? { ...p, role: 'editor' as MapRole }
        : p,
    );
  }

  // toUser를 owner로 upsert / Upsert toUser as owner.
  nextPermissions = upsertPermission(nextPermissions, mapId, 'user', toUserId, 'owner', by);

  // MapMeta.ownerId 갱신 / Update MapMeta.ownerId.
  const metaIdx = state.mapMeta.findIndex((m) => m.mapId === mapId);
  let nextMapMeta = state.mapMeta;
  if (metaIdx >= 0) {
    nextMapMeta = state.mapMeta.map((m, i) => (i === metaIdx ? { ...m, ownerId: toUserId } : m));
  } else {
    nextMapMeta = [...state.mapMeta, { mapId, visibility: 'private', ownerId: toUserId }];
  }

  state = { ...state, permissions: nextPermissions, mapMeta: nextMapMeta };
  emit();
}

// ── 맵 생성 오버레이 ─────────────────────────────────────────

/**
 * 맵 생성 시 초기 권한·승인자 세팅 /
 * Set up initial permissions and approvers when a map is created.
 */
export function createMapPermission(
  mapId: string,
  ownerId: string,
  visibility: MapVisibility,
  collaborators: Array<{ principalType: PrincipalType; principalId: string; role: MapRole }>,
  approverIds: string[],
): void {
  // 소유자 권한 + 협업자 권한 / Owner permission + collaborator permissions.
  const newPerms: MapPermission[] = [
    {
      mapId,
      principalType: 'user',
      principalId: ownerId,
      role: 'owner',
      grantedBy: ownerId,
      grantedAt: GRANTED_AT,
    },
    ...collaborators.map((c) => ({
      mapId,
      principalType: c.principalType,
      principalId: c.principalId,
      role: c.role,
      grantedBy: ownerId,
      grantedAt: GRANTED_AT,
    })),
  ];

  const newApprovers: MapApprover[] = approverIds.map((userId) => ({
    mapId,
    userId,
    assignedBy: ownerId,
  }));

  state = {
    ...state,
    mapMeta: [...state.mapMeta, { mapId, visibility, ownerId }],
    permissions: [...state.permissions, ...newPerms],
    approvers: [...state.approvers, ...newApprovers],
  };
  emit();
}

// ── 버전 게시 ─────────────────────────────────────────────────

/**
 * 버전 게시 요청 — versionFlow에 pending 상태 추가 /
 * Request version publish; sets versionFlow entry to pending.
 */
export function requestVersionPublish(
  mapId: string,
  versionId: string,
  label: string,
  by: string,
): void {
  state = {
    ...state,
    versionFlow: {
      ...state.versionFlow,
      [versionId]: { status: 'pending', requestedBy: by, label },
    },
  };
  emit();
}

// ── 그룹 액션 ─────────────────────────────────────────────────

/**
 * 그룹 생성 요청 — pending 상태로 추가 /
 * Request creation of a new group (pending until approved).
 */
export function requestGroup(
  name: string,
  description: string,
  members: Array<{ type: 'department' | 'user'; id: string }>,
  managerIds: string[],
): void {
  state = {
    ...state,
    groups: [
      ...state.groups,
      { id: genId(), name, description, status: 'pending', managerIds, members },
    ],
  };
  emit();
}

/** 그룹 승인·반려 / Approve or reject a pending group. */
export function decideGroup(groupId: string, decision: 'active' | 'rejected'): void {
  state = {
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? { ...g, status: decision } : g)),
  };
  emit();
}

/** 그룹 멤버 추가 / Add a member to a group. */
export function addGroupMember(
  groupId: string,
  member: { type: 'department' | 'user'; id: string },
): void {
  state = {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId ? { ...g, members: [...g.members, member] } : g,
    ),
  };
  emit();
}

/** 그룹 멤버 제거 / Remove a member from a group. */
export function removeGroupMember(
  groupId: string,
  member: { type: 'department' | 'user'; id: string },
): void {
  state = {
    ...state,
    groups: state.groups.map((g) =>
      g.id === groupId
        ? {
            ...g,
            members: g.members.filter((m) => !(m.type === member.type && m.id === member.id)),
          }
        : g,
    ),
  };
  emit();
}

/** 그룹 관리자 교체 / Replace group managers. */
export function setGroupManagers(groupId: string, managerIds: string[]): void {
  state = {
    ...state,
    groups: state.groups.map((g) => (g.id === groupId ? { ...g, managerIds } : g)),
  };
  emit();
}

// ── 승인자 액션 ───────────────────────────────────────────────

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

/**
 * 사용자 active/inactive 토글 — 비활성 승인자 검증용 데모 /
 * Toggle user active status (demo: verify inactive-approver behavior).
 */
export function toggleUserActive(userId: string): void {
  state = {
    ...state,
    users: state.users.map((u) =>
      u.id === userId ? { ...u, status: u.status === 'active' ? 'inactive' : 'active' } : u,
    ),
  };
  emit();
}
