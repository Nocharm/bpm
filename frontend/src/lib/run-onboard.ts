// 홈 첫 실행 권유 — 실행을 써 본 적 없는 사람에게 "진행 중 실행" 타일로 첫 실행을 권한다. 한 번 펼쳐 보면 끝이고
// 기록은 이 브라우저에만 남긴다(사용자 결정 2026-11-05: 여러 번 보이면 귀찮다, 다른 PC에서 한 번 더 보이는 건 괜찮다).

import type { MapSummary } from "@/lib/api";

export const RUN_ONBOARD_SEEN_KEY = "bpm.runOnboardSeen";
// 권유 칸에 띄울 맵 수 — 고르기 부담 없이 바로 누를 만큼만
export const RUN_ONBOARD_MAP_LIMIT = 3;

export function isRunOnboardSeen(): boolean {
  try {
    return window.localStorage.getItem(RUN_ONBOARD_SEEN_KEY) === "1";
  } catch (err) {
    // 저장소가 막힌 브라우저(사생활 보호 모드 등) — 권유는 보여 주되 기억만 못 한다
    console.warn("run onboard: localStorage read failed", err);
    return false;
  }
}

export function markRunOnboardSeen(): void {
  try {
    window.localStorage.setItem(RUN_ONBOARD_SEEN_KEY, "1");
  } catch (err) {
    console.warn("run onboard: localStorage write failed", err);
  }
}

/** 실행해 볼 맵 — 게시본이 있고 내가 볼 수 있는 맵. 내가 Owner·Editor인 맵이 먼저, 그다음 최근 수정 순. */
export function pickRunOnboardMaps(maps: readonly MapSummary[], limit = RUN_ONBOARD_MAP_LIMIT): MapSummary[] {
  const isMine = (map: MapSummary) => map.my_role === "owner" || map.my_role === "editor";
  return maps
    .filter((map) => map.published_version_number != null && map.my_role !== null && !map.deleted_at)
    .sort((a, b) => Number(isMine(b)) - Number(isMine(a)) || b.updated_at.localeCompare(a.updated_at))
    .slice(0, limit);
}

/** 실행 기록(진행 중·최근 끝남)이 없고, 아직 펼쳐 보지 않았고, 실행해 볼 맵이 있을 때만 권한다. */
export function shouldShowRunOnboard(state: {
  isSeen: boolean;
  openRuns: number;
  endedRuns: number;
  candidateCount: number;
}): boolean {
  return !state.isSeen && state.openRuns === 0 && state.endedRuns === 0 && state.candidateCount > 0;
}

/** 새 실행 창을 바로 여는 맵 주소 — 맵 화면이 최신 게시본에 착지해 새 실행 창을 띄운다. */
export function buildNewRunHref(mapId: number): string {
  return `/maps/${mapId}?newRun=1`;
}

/** 주소의 `?newRun=1` 여부 — 맵 화면 첫 로드가 읽고 바로 지운다(새로고침에 다시 뜨지 않게). */
export function hasNewRunParam(search: string): boolean {
  return new URLSearchParams(search).get("newRun") === "1";
}
