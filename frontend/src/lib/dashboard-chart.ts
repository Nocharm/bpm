// 대시보드 차트 순수 계산 — 축 스케일/틱, 기간 프리셋→KST 날짜범위. DOM·fetch 미접근.

export interface ChartScale {
  max: number;
}

// nice 단계 — 1·2·5 × 10^n 사다리로 올림해 축 눈금을 읽기 좋게 만든다.
const NICE_STEPS = [1, 2, 5];

/** 데이터 최댓값을 nice한 상한으로 올린다. 전부 0이면 max=1(0 나눗셈 차단). */
export function buildScale(values: number[], tickCount = 4): ChartScale {
  const peak = Math.max(0, ...values);
  if (peak <= 0) {
    return { max: 1 };
  }
  const rough = peak / tickCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    (NICE_STEPS.find((candidate) => candidate * magnitude >= rough) ?? 10) * magnitude;
  const max = step * tickCount;
  return { max };
}

export type PeriodPreset = "7d" | "1m" | "3m";

export interface DateRange {
  from: string; // YYYY-MM-DD (KST)
  to: string;
}

// 프리셋 → 오늘 포함 창의 길이(일). 서버는 프리셋을 모르고 날짜만 받는다.
const PRESET_DAYS: Record<PeriodPreset, number> = { "7d": 7, "1m": 30, "3m": 90 };

/** KST 날짜키(YYYY-MM-DD) — 브라우저 tz와 무관하게 Asia/Seoul 기준. */
export function getTodayKeyKst(now: Date = new Date()): string {
  // en-CA 로케일이 ISO 형태(YYYY-MM-DD)를 준다 — 수동 포맷보다 tz 처리가 안전하다.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);
}

/** 날짜키에서 n일 뺀 날짜키. UTC 기준으로 더해 DST·tz 이동의 영향을 받지 않는다. */
export function shiftDays(dateKey: string, days: number): string {
  const shifted = new Date(`${dateKey}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** 프리셋 → 날짜 범위(오늘 포함). 예: 7d + 2026-07-11 → 2026-07-05 ~ 2026-07-11 */
export function resolvePeriod(preset: PeriodPreset, todayKey: string): DateRange {
  return { from: shiftDays(todayKey, -(PRESET_DAYS[preset] - 1)), to: todayKey };
}
