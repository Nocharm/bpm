"use client";

// 기간 선택 — 프리셋 3종 + 달력 직접 지정. 시계열 섹션에만 걸린다(스냅샷은 무관).

import { useState } from "react";

import {
  resolvePeriod,
  todayKeyKst,
  type DateRange,
  type PeriodPreset,
} from "@/lib/dashboard-chart";
import { useI18n } from "@/lib/i18n";

const PRESETS: { id: PeriodPreset; labelKey: "dashboard.period7d" | "dashboard.period1m" | "dashboard.period3m" }[] = [
  { id: "7d", labelKey: "dashboard.period7d" },
  { id: "1m", labelKey: "dashboard.period1m" },
  { id: "3m", labelKey: "dashboard.period3m" },
];

export function PeriodFilter({
  range,
  onChange,
}: {
  range: DateRange;
  onChange: (next: DateRange) => void;
}) {
  const { t } = useI18n();
  const [custom, setCustom] = useState(false);
  const today = todayKeyKst();

  // 현재 range가 어느 프리셋과 일치하는지 — 활성 표시용
  const activePreset = PRESETS.find(
    (preset) => {
      const resolved = resolvePeriod(preset.id, today);
      return resolved.from === range.from && resolved.to === range.to;
    },
  )?.id;

  return (
    <div data-id="dashboard-period-filter" className="flex items-center gap-1.5">
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          onClick={() => {
            setCustom(false);
            onChange(resolvePeriod(preset.id, today));
          }}
          className={`rounded-sm px-2.5 py-1 text-fine transition-colors ${
            !custom && activePreset === preset.id
              ? "bg-accent text-on-accent"
              : "border border-hairline text-ink-secondary hover:bg-surface-alt"
          }`}
        >
          {t(preset.labelKey)}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setCustom((prev) => !prev)}
        className={`rounded-sm px-2.5 py-1 text-fine transition-colors ${
          custom
            ? "bg-accent text-on-accent"
            : "border border-hairline text-ink-secondary hover:bg-surface-alt"
        }`}
      >
        {t("dashboard.periodCustom")}
      </button>
      {custom ? (
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(event) => onChange({ ...range, from: event.target.value })}
            aria-label={t("dashboard.periodFrom")}
            className="rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink"
          />
          <span className="text-fine text-ink-tertiary">–</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={today}
            onChange={(event) => onChange({ ...range, to: event.target.value })}
            aria-label={t("dashboard.periodTo")}
            className="rounded-sm border border-hairline bg-surface px-2 py-1 text-fine text-ink"
          />
        </span>
      ) : null}
    </div>
  );
}
