"use client";

// 카드 시각 표시 — 과거 2주 이내면 상대시간 1필("~분 전"), 그 외엔 날짜(YYYY-MM-DD)·시각(HH:mm) 2필.
// nowMs는 부모가 마운트 시 1회 계산해 주입 — 렌더 본문 Date.now() 금지(React Compiler purity).

import { formatKst } from "@/lib/datetime";
import { useI18n } from "@/lib/i18n";

// 상대시간 표기 상한 — 이 값을 넘으면 날짜/시각 2필로 표시
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

const PILL = "rounded-sm bg-surface-alt px-1.5 py-0.5 text-fine";

export function TimePills({ iso, nowMs }: { iso: string; nowMs: number }) {
  const { t } = useI18n();
  const ms = nowMs - Date.parse(iso);
  // 과거 2주 이내 → 상대시간 1필 (미래·2주 초과는 아래 2필로)
  if (ms >= 0 && ms < TWO_WEEKS_MS) {
    const min = Math.floor(ms / 60000);
    let label: string;
    if (min < 1) {
      label = t("time.now");
    } else if (min < 60) {
      label = t("time.minAgo", { n: min });
    } else {
      const hr = Math.floor(min / 60);
      label = hr < 24 ? t("time.hourAgo", { n: hr }) : t("time.dayAgo", { n: Math.floor(hr / 24) });
    }
    return <span className={`${PILL} text-ink-tertiary`}>{label}</span>;
  }
  // 그 외 → 날짜(YYYY-MM-DD)·시각(HH:mm) 2필
  const [dateStr, timeStr] = formatKst(iso).split(" ");
  return (
    <>
      <span className={`${PILL} text-ink-secondary`}>{dateStr}</span>
      {timeStr && <span className={`${PILL} text-ink-tertiary`}>{timeStr}</span>}
    </>
  );
}
