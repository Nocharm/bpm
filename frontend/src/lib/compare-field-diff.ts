// 비교화면 필드 diff 표시 — 값 생성/삭제/변경 분류 + 텍스트 부분 diff(공통 접두·접미 절단).

export type FieldDiffStatus = "added" | "removed" | "changed";

// 표시값 기준 분류 — 빈 값(공백 포함)은 부재로 본다. None 폴백 적용 전 원시 표시값을 넣을 것.
export function classifyFieldDiff(before: string, after: string): FieldDiffStatus {
  const hasBefore = before.trim() !== "";
  const hasAfter = after.trim() !== "";
  if (!hasBefore && hasAfter) return "added";
  if (hasBefore && !hasAfter) return "removed";
  return "changed";
}

export interface TextDiffParts {
  prefix: string;
  removedMid: string;
  addedMid: string;
  suffix: string;
}

// 공통 접두/접미를 잘라 바뀐 가운데만 남긴다 — 완전히 다르면 전체가 mid로 떨어져
// "전부 강조"로 자연 강등된다. suffix 스캔은 prefix와 겹치지 않게 남은 길이로 제한.
export function splitTextDiff(before: string, after: string): TextDiffParts {
  let p = 0;
  const maxPrefix = Math.min(before.length, after.length);
  while (p < maxPrefix && before[p] === after[p]) p += 1;
  let s = 0;
  const maxSuffix = maxPrefix - p;
  while (s < maxSuffix && before[before.length - 1 - s] === after[after.length - 1 - s]) s += 1;
  return {
    prefix: before.slice(0, p),
    removedMid: before.slice(p, before.length - s),
    addedMid: after.slice(p, after.length - s),
    suffix: s > 0 ? before.slice(before.length - s) : "",
  };
}
