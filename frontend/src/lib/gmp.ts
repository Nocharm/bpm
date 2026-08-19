// GMP 분류 — 저장값(backend schemas.GMP_VALUES)과 표시 라벨의 단일 소스 (design 2026-08-19 §1.3)

export const GMP_OPTIONS = [
  { value: "direct", label: "GMP Direct" },
  { value: "indirect", label: "GMP Indirect" },
  { value: "non_gmp", label: "Non-GMP" },
] as const;

export type GmpValue = (typeof GMP_OPTIONS)[number]["value"];

/** 저장값 → 표시 라벨. 미분류(null/빈 값)·미지 값은 "". */
export function formatGmp(value: string | null | undefined): string {
  return GMP_OPTIONS.find((option) => option.value === value)?.label ?? "";
}
