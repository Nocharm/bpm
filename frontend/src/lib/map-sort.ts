// 홈 맵 목록 정렬 — 부서 뷰 필터 행의 Sort 드롭다운(단일 선택)이 고르고, 조직도·나의 부서·검색 결과·
// 업무 체계 요약 카드의 소속 맵 목록이 같은 함수를 쓴다(사용자 지시 2026-09-21). 기본 updated = 서버 목록 순
// (updated_at desc)과 같다.

export type MapSortKey = "updated" | "name" | "created";
export const MAP_SORT_KEYS: readonly MapSortKey[] = ["updated", "name", "created"];
export const DEFAULT_MAP_SORT: MapSortKey = "updated";

export function isMapSortKey(value: unknown): value is MapSortKey {
  return typeof value === "string" && (MAP_SORT_KEYS as readonly string[]).includes(value);
}

interface SortableMap {
  name: string;
  updated_at: string;
  created_at: string;
}

// 안정 정렬(원본 불변) — 같은 값은 입력 순서를 지킨다
export function sortMaps<T extends SortableMap>(maps: readonly T[], key: MapSortKey): T[] {
  const out = [...maps];
  if (key === "name") out.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  else if (key === "created") out.sort((a, b) => b.created_at.localeCompare(a.created_at));
  else out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}
