// 맵 화면 Run 소개 말풍선 — Run 버튼 아래에 잠깐 떴다가 스스로 사라진다. Run을 한 번이라도 시작하면 더는 뜨지 않고,
// 기록은 이 브라우저에만 남긴다(사용자 결정 2026-11-08: 홈 첫 실행 권유와 같은 기준, 그냥 사라지게 두면 다음 진입에 다시 뜬다).

export const RUN_INTRO_DONE_KEY = "bpm.runIntroDone";
// 맵이 그려진 뒤 말풍선이 뜨기까지 — 화면이 자리 잡기 전에 뜨면 눈에 안 들어온다
export const RUN_INTRO_DELAY_MS = 800;
// 말풍선이 떠 있는 시간 — 마우스를 올린 동안은 멈춘다. 6초는 길다는 사용자 피드백(2026-11-09)으로 3초
export const RUN_INTRO_SHOW_MS = 3000;

export function isRunIntroDone(): boolean {
  try {
    return window.localStorage.getItem(RUN_INTRO_DONE_KEY) === "1";
  } catch (err) {
    // 저장소가 막힌 브라우저(사생활 보호 모드 등) — 소개는 보여 주되 기억만 못 한다
    console.warn("run intro: localStorage read failed", err);
    return false;
  }
}

export function markRunIntroDone(): void {
  try {
    window.localStorage.setItem(RUN_INTRO_DONE_KEY, "1");
  } catch (err) {
    console.warn("run intro: localStorage write failed", err);
  }
}

/**
 * 아직 Run을 해 본 적 없고 다른 Run 화면(실행 중·새 Run 창)이 없을 때 띄운다. 업무 체계 캔버스만 빼고 Draft·게시본 없는 맵에서도
 * 뜨며, 그때는 말풍선이 게시본 안내를 덧붙인다(사용자 결정 2026-11-09).
 */
export function shouldShowRunIntro(state: {
  isDone: boolean;
  isRunMap: boolean;
  isSuppressed: boolean;
  hasMyRuns: boolean;
}): boolean {
  return !state.isDone && state.isRunMap && !state.isSuppressed && !state.hasMyRuns;
}
