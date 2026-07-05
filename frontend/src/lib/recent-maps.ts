// 최근 열어본 맵 — localStorage(bpm.recentMaps). {id, at} 최신순, 최대 11개.
// 에디터 진입 시 기록하고 홈 리스트에서 조회한다. 백엔드 변경 없는 클라이언트 캐시.

export interface RecentMapEntry {
  id: number;
  at: number; // epoch ms — 마지막 열람 시각
}

const KEY = "bpm.recentMaps";
const MAX = 11; // 캐시 상한(밴드 초기 2 + "더보기" +3 × 3페이지)

// 순수 로직 — id를 맨 앞으로(중복 제거) 후 max개로 절단. 단위 테스트 대상.
export function mergeRecentEntry(
  entries: RecentMapEntry[],
  id: number,
  at: number,
  max: number = MAX,
): RecentMapEntry[] {
  const rest = entries.filter((e) => e.id !== id);
  return [{ id, at }, ...rest].slice(0, max);
}

// 순수 로직 — recentIds(최신순) 기준으로 items를 recent/rest로 분할.
// recent는 recentIds 순, rest는 원본 순. 단위 테스트 대상.
export function partitionByRecency<T>(
  items: T[],
  getId: (item: T) => number,
  recentIds: number[],
): { recent: T[]; rest: T[] } {
  const rank = new Map<number, number>();
  recentIds.forEach((id, i) => rank.set(id, i));
  const recent = items
    .filter((it) => rank.has(getId(it)))
    .sort((a, b) => (rank.get(getId(a)) ?? 0) - (rank.get(getId(b)) ?? 0));
  const rest = items.filter((it) => !rank.has(getId(it)));
  return { recent, rest };
}

// localStorage 조회 — SSR/파싱 실패 시 빈 배열(하이드레이션 안전).
export function getRecentMaps(): RecentMapEntry[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (e): e is RecentMapEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as RecentMapEntry).id === "number" &&
        typeof (e as RecentMapEntry).at === "number",
    );
  } catch {
    return [];
  }
}

// 진입 기록 — 현재 시각으로 id를 맨 앞으로 병합해 저장(이벤트/effect 컨텍스트 전용).
export function recordRecentMap(id: number): void {
  if (typeof window === "undefined") {
    return;
  }
  const next = mergeRecentEntry(getRecentMaps(), id, Date.now());
  window.localStorage.setItem(KEY, JSON.stringify(next));
}
