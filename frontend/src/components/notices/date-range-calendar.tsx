"use client";

// 게시기간 date-range 캘린더 — 외부 의존 없는 자체 월 그리드. 값은 "YYYY-MM-DD".

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

import { useI18n } from "@/lib/i18n";

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function DateRangeCalendar({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState(() => {
    const anchor = start ? new Date(`${start}T00:00:00`) : new Date();
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });

  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstWeekday; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  const shift = (delta: number) => {
    const m = view.month + delta;
    setView({ year: view.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
  };

  // 첫 클릭=시작(끝 초기화), 둘째 클릭=끝(순서 보정)
  const pick = (day: number) => {
    const ds = ymd(view.year, view.month, day);
    if (!start || (start && end)) {
      onChange(ds, "");
    } else if (ds < start) {
      onChange(ds, start);
    } else {
      onChange(start, ds);
    }
  };

  const weekdays = t("cal.weekdays").split(",");

  return (
    <div className="rounded-sm border border-hairline p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
        >
          <ChevronLeft size={16} strokeWidth={1.5} />
        </button>
        <span className="text-caption-strong text-ink">
          {view.year}-{String(view.month + 1).padStart(2, "0")}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded-sm p-1 text-ink-tertiary hover:bg-surface-alt"
        >
          <ChevronRight size={16} strokeWidth={1.5} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-fine text-ink-tertiary">
        {weekdays.map((w, i) => (
          <span key={`${w}-${i}`} className="py-1">
            {w}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          if (day === null) {
            return <span key={`blank-${i}`} />;
          }
          const ds = ymd(view.year, view.month, day);
          const isEndpoint = ds === start || ds === end;
          const inRange = start && end ? ds >= start && ds <= end : ds === start;
          return (
            <button
              key={`day-${day}`}
              type="button"
              onClick={() => pick(day)}
              className={
                "rounded-xs py-1 text-fine " +
                (isEndpoint
                  ? "bg-accent text-on-accent"
                  : inRange
                    ? "bg-accent-tint text-accent"
                    : "text-ink hover:bg-surface-alt")
              }
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
}
