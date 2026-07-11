// duration H.MM 표기 정규화 — 소수부 2자리는 "분"(십진수 아님). 설계 2026-07-11 §2.2.
// 백엔드 app/duration.py와 케이스 동치를 유지할 것(경계 이중 방어).

export const DURATION_PATTERN = /^\d+(\.\d{1,2})?$/;
export const NUMERIC_PATTERN = /^\d+(\.\d+)?$/;

/** H.MM 정규화 — 유효하면 정규형("2"·"1.15"), 무효면 null. 빈 문자열은 "". */
export function normalizeDuration(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  if (!DURATION_PATTERN.test(text)) return null;
  const [intPart, fracPart = ""] = text.split(".");
  let hours = Number.parseInt(intPart, 10);
  // 1자리 소수부는 10분 단위 — "0.3" = 30분
  let minutes = fracPart === "" ? 0 : Number.parseInt(fracPart.padEnd(2, "0"), 10);
  hours += Math.floor(minutes / 60);
  minutes %= 60;
  return minutes === 0 ? String(hours) : `${hours}.${String(minutes).padStart(2, "0")}`;
}

/** 일반 십진 파라미터(headcount·etf·cost·extra) — 유효하면 트림 원문, 무효면 null. */
export function normalizeNumericParam(raw: string): string | null {
  const text = raw.trim();
  if (text === "") return "";
  return NUMERIC_PATTERN.test(text) ? text : null;
}
