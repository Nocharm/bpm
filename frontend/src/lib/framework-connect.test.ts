// 플레이스홀더 연결 후보 랭킹 — 정확 일치 > 포함 > 토큰 겹침 > 이름순 (design §10.1 후차 연결)
import { describe, expect, it } from "vitest";

import type { MapSummary } from "./api";
import { rankConnectCandidates } from "./framework-connect";

function makeMap(id: number, name: string): MapSummary {
  return { id, name } as MapSummary;
}

describe("rankConnectCandidates", () => {
  it("정확 일치가 최상단 + exact 플래그", () => {
    const ranked = rankConnectCandidates("설비 예방점검", [
      makeMap(1, "설비 예방점검 계획"),
      makeMap(2, "설비 예방점검"),
      makeMap(3, "완제품 출하"),
    ]);
    expect(ranked[0].map.id).toBe(2);
    expect(ranked[0].exact).toBe(true);
    expect(ranked[1].map.id).toBe(1);
    expect(ranked[1].exact).toBe(false);
  });

  it("공백·대소문자 차이는 정확 일치로 취급", () => {
    const ranked = rankConnectCandidates("cip 세척", [makeMap(1, "CIP  세척")]);
    expect(ranked[0].exact).toBe(true);
  });

  it("포함이 토큰 겹침보다 앞선다", () => {
    const ranked = rankConnectCandidates("일탈 처리", [
      makeMap(1, "일탈 보고 및 종결"), // 토큰 '일탈'만 겹침
      makeMap(2, "일탈 처리 접수"), // 제목을 통째로 포함
    ]);
    expect(ranked[0].map.id).toBe(2);
  });

  it("무관 후보는 이름순으로 뒤에 온다", () => {
    const ranked = rankConnectCandidates("일탈 처리", [
      makeMap(1, "출하 승인"),
      makeMap(2, "검체 관리"),
    ]);
    expect(ranked.map((r) => r.map.id)).toEqual([2, 1]);
    expect(ranked.every((r) => r.score === 0)).toBe(true);
  });
});
