// run-intro — 맵 화면 Run 소개 말풍선의 표시 조건과 브라우저 기록
import { afterEach, describe, expect, it } from "vitest";

import { isRunIntroDone, markRunIntroDone, RUN_INTRO_DONE_KEY, shouldShowRunIntro } from "./run-intro";

const BASE = { isDone: false, canRun: true, isSuppressed: false, hasMyRuns: false };

describe("shouldShowRunIntro", () => {
  it("Run을 시작할 수 있고 해 본 적 없으면 띄운다", () => {
    expect(shouldShowRunIntro(BASE)).toBe(true);
  });

  it("이미 Run을 해 봤으면 띄우지 않는다", () => {
    expect(shouldShowRunIntro({ ...BASE, isDone: true })).toBe(false);
  });

  it("Run 버튼이 꺼진 버전(Draft·결재 중·거절·업무 체계)에서는 띄우지 않는다", () => {
    expect(shouldShowRunIntro({ ...BASE, canRun: false })).toBe(false);
  });

  it("Run 화면이나 새 Run 창이 이미 열려 있으면 띄우지 않는다", () => {
    expect(shouldShowRunIntro({ ...BASE, isSuppressed: true })).toBe(false);
  });

  it("이 맵에 내 Run 기록이 있으면 띄우지 않는다", () => {
    expect(shouldShowRunIntro({ ...BASE, hasMyRuns: true })).toBe(false);
  });
});

describe("run intro 기록", () => {
  afterEach(() => window.localStorage.removeItem(RUN_INTRO_DONE_KEY));

  it("기록 전에는 false, 기록하면 true", () => {
    expect(isRunIntroDone()).toBe(false);
    markRunIntroDone();
    expect(isRunIntroDone()).toBe(true);
  });
});
