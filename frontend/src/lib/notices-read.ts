// 공지 읽음 캐시 — localStorage(bpm.notices.read). 열어본 공지 id 목록.
// 서버에 저장하지 않는 클라이언트 캐시(기기별). recent-maps.ts 패턴.

const KEY = "bpm.notices.read";

// localStorage 조회 — SSR/파싱 실패 시 빈 배열(하이드레이션 안전).
export function getReadNoticeIds(): number[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is number => typeof x === "number")
      : [];
  } catch {
    return [];
  }
}

// 열람 기록 — id를 캐시에 추가하고 갱신된 목록을 반환(호출자 state 갱신용).
export function markNoticeRead(id: number): number[] {
  const ids = getReadNoticeIds();
  if (ids.includes(id)) {
    return ids;
  }
  const next = [id, ...ids];
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }
  return next;
}

// 미열람 수 — 주어진 공지 id들 중 캐시에 없는 것.
export function countUnreadNotices(ids: number[], readIds: number[]): number {
  const read = new Set(readIds);
  return ids.filter((id) => !read.has(id)).length;
}
