// 관리 패널 레벨별 타일 액션의 순수 계산 — 서브트리 세션 수·형제 이름 중복·L5의 진행 세션. 컴포넌트는 fw-level-actions.tsx (2026-09-23).

import type { CategoryNode, FwInterviewSession } from "./api";

export function countSessionsUnder(sessions: Pick<FwInterviewSession, "category_path_ids">[], categoryId: number): number {
  return sessions.filter((session) => session.category_path_ids.includes(categoryId)).length;
}

export function findDuplicateSibling(children: Pick<CategoryNode, "name">[], name: string): boolean {
  const wanted = name.trim();
  return children.some((child) => child.name.trim() === wanted);
}

export function findSessionFor<T extends Pick<FwInterviewSession, "id" | "category_id">>(sessions: T[], categoryId: number): T | null {
  return sessions.find((session) => session.category_id === categoryId) ?? null;
}
