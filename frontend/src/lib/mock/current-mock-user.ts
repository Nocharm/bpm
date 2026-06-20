// 현재 로그인 유저를 mock SeedState의 User로 매핑 / Map logged-in user to mock seed User.

import { useSyncExternalStore } from 'react';
import { subscribeCurrentUser, getCurrentUser } from '@/lib/current-user';
import type { User, SeedState } from './permissions';
import { usePermissions } from './permissions';

/**
 * loginId로 seed users에서 User를 조회 / Look up mock User by loginId.
 */
export function getCurrentMockUser(state: SeedState, loginId: string | null | undefined): User | null {
  if (!loginId) return null;
  return state.users.find((u) => u.id === loginId) ?? null;
}

/**
 * 로그인 유저와 권한 스토어를 결합해 현재 mock User를 반환하는 훅 /
 * Hook that combines the permission store and the live loginId subscription to return the matching mock User.
 */
export function useCurrentMockUser(): User | null {
  const state = usePermissions();
  const currentUser = useSyncExternalStore(subscribeCurrentUser, getCurrentUser, getCurrentUser);
  return getCurrentMockUser(state, currentUser?.loginId);
}
