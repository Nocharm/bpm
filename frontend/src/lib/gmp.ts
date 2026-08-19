import type { CSSProperties } from "react";

// GMP 분류 — 저장값(backend schemas.GMP_VALUES)·표시 라벨·배지 색의 단일 소스 (design 2026-08-19 §1.3)
// 색은 분류가 확정하는 자동 지정(신호등 시맨틱: 규제 강함=red, 간접=amber, 무관=green) — diff 상태
// 토큰(removed/changed/added)을 재사용해 라이트 팔레트와 정합 (사용자 결정 2026-08-20).

export const GMP_OPTIONS = [
  { value: "direct", label: "GMP Direct", colorVar: "--color-removed" },
  { value: "indirect", label: "GMP Indirect", colorVar: "--color-changed" },
  { value: "non_gmp", label: "Non-GMP", colorVar: "--color-added" },
] as const;

export type GmpValue = (typeof GMP_OPTIONS)[number]["value"];

/** 저장값 → 표시 라벨. 미분류(null/빈 값)·미지 값은 "". */
export function formatGmp(value: string | null | undefined): string {
  return GMP_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

/** GMP 배지 inline style — stroke는 상태 토큰, fill은 12% 틴트(노드 파스텔 파생 규칙과 동형). */
export function getGmpBadgeStyle(value: string | null | undefined): CSSProperties | undefined {
  const colorVar = GMP_OPTIONS.find((option) => option.value === value)?.colorVar;
  if (!colorVar) return undefined;
  return {
    color: `var(${colorVar})`,
    backgroundColor: `color-mix(in srgb, var(${colorVar}) 12%, white)`,
  };
}
