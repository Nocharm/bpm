// 버전 상태 분포 — 누적 가로 바 + 클릭 가능한 범례(상태 필터). 내 문서·내 부서 카드가 공유(도넛 대체, 2026-09-11).
"use client";

import type { VersionStatus } from "@/lib/api";
import type { StatusCount } from "@/lib/dashboard-stats";
import { VERSION_STATUS_LABEL_EN, VERSION_STATUS_TONE } from "@/lib/version-status";

interface StatusBarProps {
  counts: StatusCount[];
}

export function StatusBar({ counts }: StatusBarProps) {
  const total = counts.reduce((a, c) => a + c.count, 0);
  if (total === 0) return null;
  return (
    <div className="mx-3 flex h-2 overflow-hidden rounded-full bg-surface-alt" aria-hidden="true">
      {counts.map((c) => (
        <span key={c.status} className={`h-full ${VERSION_STATUS_TONE[c.status].dot}`} style={{ width: `${(c.count / total) * 100}%` }} />
      ))}
    </div>
  );
}

interface StatusLegendProps {
  counts: StatusCount[];
  selected: VersionStatus | null;
  onSelect?: (status: VersionStatus) => void; // 없으면 읽기 전용 범례
}

export function StatusLegend({ counts, selected, onSelect }: StatusLegendProps) {
  return (
    <div className="flex flex-wrap gap-x-1.5 gap-y-1 px-3 pb-2.5 pt-2">
      {counts.map((c) => {
        const active = selected === c.status;
        const inner = (
          <>
            <span className={`inline-block h-2 w-2 rounded-full ${VERSION_STATUS_TONE[c.status].dot}`} />
            <span>{VERSION_STATUS_LABEL_EN[c.status]}</span>
            <span className="text-ink-tertiary tabular-nums">{c.count}</span>
          </>
        );
        const cls = `inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-fine ${
          active ? "border-accent-tint-border bg-accent-tint text-accent-elevated" : "border-transparent text-ink-secondary"
        }`;
        return onSelect ? (
          <button
            key={c.status}
            type="button"
            data-id={`status-legend-${c.status}`}
            aria-pressed={active}
            onClick={(e) => { e.stopPropagation(); onSelect(c.status); }}
            className={`${cls} hover:bg-surface-alt`}
          >
            {inner}
          </button>
        ) : (
          <span key={c.status} className={cls}>{inner}</span>
        );
      })}
    </div>
  );
}
