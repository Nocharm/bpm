// 프로세스 라이브러리 필터 필(부서·권한·미등록) — 순수 매칭/영속 헬퍼.
// process-library-panel.tsx의 필터 팝오버·필 렌더는 이 모듈을 소비하는 thin 레이어다.
import type { LibraryProcess } from "./api";

export type LibraryRole = "owner" | "editor" | "viewer";

export interface LibraryFilters {
  departments: string[];
  roles: LibraryRole[];
  // 미등록 맵 표시 — 행 필터가 아니라 fetch 플래그(listLibraryProcesses의 include_undesignated).
  // applyLibraryFilters는 이 필드를 읽지 않지만, 영속·필 렌더 대상이라 필터 모델에 포함한다.
  showUnregistered: boolean;
}

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  departments: [],
  roles: [],
  showUnregistered: false,
};

const VALID_ROLES: readonly LibraryRole[] = ["owner", "editor", "viewer"];

// "A/B/C" → "C" — korean-dept.ts formatDeptName과 동일한 리프 추출(구분자 없으면 원문 그대로).
function getDepartmentLeaf(dept: string): string {
  const parts = dept.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? dept;
}

// 선택값은 행의 전체경로 또는 리프 문자열 그대로와 일치해야 매치 — 서로 다른 상위경로가 리프만
// 우연히 같다고 교차 매치되지 않는다(리프 추출은 행 쪽에만 적용, 선택값은 원문 비교).
function matchesDepartment(rowDept: string | null, selected: string[]): boolean {
  if (selected.length === 0) return true;
  if (rowDept === null) return false;
  const leaf = getDepartmentLeaf(rowDept);
  // 선택 경로의 하위 부서까지 포함(트리 선택) — 레거시 저장값(리프명)은 리프 일치로 유지.
  // 경계는 "/"까지 봐야 한다 — "Growth Center"가 "Growth Center 2/..."를 삼키지 않도록.
  return selected.some((s) => rowDept === s || rowDept.startsWith(`${s}/`) || s === leaf);
}

function matchesRole(myRole: LibraryProcess["my_role"], selected: LibraryRole[]): boolean {
  if (selected.length === 0) return true;
  return myRole !== null && selected.includes(myRole);
}

// 부서(선택 경로의 서브트리 또는 리프 일치) + 역할(any-of) 필터. showUnregistered는 fetch 단계 플래그라 여기선 무시 —
// 호출부가 listLibraryProcesses(filters.showUnregistered)로 별도 반영한다.
export function applyLibraryFilters(
  rows: LibraryProcess[],
  filters: LibraryFilters,
): LibraryProcess[] {
  return rows.filter(
    (row) =>
      matchesDepartment(row.department, filters.departments) &&
      matchesRole(row.my_role, filters.roles),
  );
}

// 활성 필터 총 개수 — 필 렌더 개수·배지 숫자·"필터 전체삭제" 노출 게이팅의 단일 소스.
export function countActiveFilters(filters: LibraryFilters): number {
  return filters.departments.length + filters.roles.length + (filters.showUnregistered ? 1 : 0);
}

// 영속 — framework-tree-state.ts readPersistedTreeState와 동일 관례(try/catch, 손상값은 기본값으로 무시).
const LIBRARY_FILTERS_KEY = "bpm.library.filters";

export function readLibraryFilters(): LibraryFilters {
  try {
    const raw = window.localStorage.getItem(LIBRARY_FILTERS_KEY);
    if (!raw) return EMPTY_LIBRARY_FILTERS;
    const parsed = JSON.parse(raw) as {
      departments?: unknown;
      roles?: unknown;
      showUnregistered?: unknown;
    };
    const departments = Array.isArray(parsed.departments)
      ? parsed.departments.filter((d): d is string => typeof d === "string")
      : [];
    const roles = Array.isArray(parsed.roles)
      ? parsed.roles.filter((r): r is LibraryRole => VALID_ROLES.includes(r as LibraryRole))
      : [];
    return { departments, roles, showUnregistered: parsed.showUnregistered === true };
  } catch {
    return EMPTY_LIBRARY_FILTERS; // 손상된 저장값 무시
  }
}

export function writeLibraryFilters(filters: LibraryFilters): void {
  try {
    window.localStorage.setItem(LIBRARY_FILTERS_KEY, JSON.stringify(filters));
  } catch {
    // 저장 실패(용량 등)는 UX에 치명적이지 않다 — 필터 상태만 복원 안 될 뿐.
  }
}
