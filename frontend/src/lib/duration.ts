// duration H.MM 표기 정규화 — 소수부 2자리는 "분"(십진수 아님). 설계 2026-07-11 §2.2.
// 백엔드 app/duration.py와 케이스 동치를 유지할 것(경계 이중 방어).

export const DURATION_PATTERN = /^[0-9]+(\.[0-9]{1,2})?$/;
export const NUMERIC_PATTERN = /^[0-9]+(\.[0-9]+)?$/;

// NFKC(전각 숫자·마침표 → ASCII) 후 trim — 백엔드 duration._clean_number_text와 동치. 전각으로 친 값이 서버엔
// 저장되는데 화면 합계에선 무효로 빠지던 어긋남을 막는다 (리뷰 2026-10-19 F-9)
function cleanNumberText(raw: string): string {
  return raw.normalize("NFKC").trim();
}

/** H.MM 정규화 — 유효하면 정규형("2"·"1.15"), 무효면 null. 빈 문자열은 "". */
export function normalizeDuration(raw: string): string | null {
  const text = cleanNumberText(raw);
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

/** 일반 십진 파라미터(duration 외 — cost_krw·cost_usd·headcount·annual_count·fte) — 유효하면 트림 원문, 무효면 null. */
export function normalizeNumericParam(raw: string): string | null {
  const text = cleanNumberText(raw);
  if (text === "") return "";
  return NUMERIC_PATTERN.test(text) ? text : null;
}

/** H.MM → "1h30m" 표시형(한/영 무관). 편집 중이 아닌 모든 화면 표시에 사용. 무효/빈값 → "". */
export function formatDurationHm(raw: string): string {
  const normalized = normalizeDuration(raw);
  if (normalized === null || normalized === "") return "";
  const [intPart, fracPart = ""] = normalized.split(".");
  const hours = Number.parseInt(intPart, 10);
  const minutes = fracPart === "" ? 0 : Number.parseInt(fracPart, 10);
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h${minutes}m`;
}

/** H.MM → 총 분(정수, "1.30" → 90). 무효/빈값 → null. Excel 시간 셀(분/1440, `[h]:mm`) 변환에 쓴다. */
export function parseDurationMinutes(raw: string): number | null {
  const normalized = normalizeDuration(raw);
  if (normalized === null || normalized === "") return null;
  const [intPart, fracPart = ""] = normalized.split(".");
  return Number.parseInt(intPart, 10) * 60 + (fracPart === "" ? 0 : Number.parseInt(fracPart, 10));
}

/** 천단위 콤마 표시형 — 비용 필드 전용(편집 중이 아닐 때). 소수부는 콤마 없이 보존. 무효/빈값 → "". */
export function formatThousands(raw: string): string {
  const text = raw.trim();
  if (text === "" || !NUMERIC_PATTERN.test(text)) return "";
  const [intPart, fracPart] = text.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fracPart === undefined ? withCommas : `${withCommas}.${fracPart}`;
}

/** 콤마 제거 — CSV·붙여넣기의 "1,250,000" 같은 입력을 받아들이기 위한 역변환. */
export function stripThousands(raw: string): string {
  return raw.replace(/,/g, "");
}
