// 현재 로그인 유저 — 서버(/api/me) 단일 소스. seed 조회로 신원을 만들지 않는다 /
// Current user from server (/api/me) — identity/isSysadmin are server-sourced, not seed-derived.

import { useSyncExternalStore } from 'react';
import { subscribeCurrentUser, getCurrentUser } from '@/lib/current-user';
import type { User, SeedState } from './permissions';
import { usePermissions } from './permissions';

/**
 * 서버 currentUser + seed 보조필드를 합쳐 mock User를 만든다 /
 * Build a mock User from the SERVER current user; seed only fills action-only fields
 * (departmentId/status) for the still-mock management actions (Task 2 replaces them).
 * id/name/isSysadmin은 서버 값이 단일 소스 — seed에 없어도 신원은 서버로 결정.
 */
export function buildCurrentMockUser(
  state: SeedState,
  loginId: string | null | undefined,
  isSysadmin: boolean,
  name?: string,
): User | null {
  if (!loginId) return null;
  const seed = state.users.find((u) => u.id === loginId) ?? null;
  return {
    id: loginId,
    name: name || seed?.name || loginId,
    email: seed?.email ?? '',
    departmentId: seed?.departmentId ?? '',
    status: seed?.status ?? 'active',
    isSysadmin, // 서버 /api/me.is_sysadmin — seed 무시 / server-sourced, never from seed
  };
}

/**
 * 서버 currentUser 구독 + mock store를 합쳐 현재 User를 반환 /
 * Hook returning the current mock User, sourced from the server currentUser singleton.
 */
export function useCurrentMockUser(): User | null {
  const state = usePermissions();
  const currentUser = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, getCurrentUser);
  return buildCurrentMockUser(
    state,
    currentUser?.loginId,
    currentUser?.isSysadmin ?? false,
    currentUser?.name,
  );
}
