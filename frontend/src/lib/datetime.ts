// 타임스탬프 표시는 KST(Asia/Seoul) 고정 — 서버/브라우저 tz와 무관하게 한국 시각으로 표기 (요청).
// 백엔드는 tz-aware로 저장(서버 postgres) → 절대시각을 Asia/Seoul로 변환해 표시.

function kstParts(iso: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** ISO → "YYYY-MM-DD HH:mm" (KST). 비면 빈 문자열. */
export function formatKst(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = kstParts(iso);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** ISO → "MM-DD HH:mm" (KST, 컴팩트). 비면 빈 문자열. */
export function formatKstShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const p = kstParts(iso);
  return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
